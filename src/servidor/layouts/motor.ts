// Motor genérico de layouts: valida (simulación sin guardar), aplica en UNA
// transacción, exporta en el mismo layout y genera plantillas con instrucciones.
import Decimal from "decimal.js";
import { formatearDecimal, formatearFecha, leerDecimal, leerEntero, leerFecha, leerSiNo, normalizarEncabezado } from "../../dominio/formatos";
import type { Cliente } from "../transaccion";
import { escribirDelimitado, escribirExcelLayout, letraColumna, type ColumnaExcel, type TablaLeida } from "./archivos";
import type { Ayuda, Campo, FilaValidada, Layout, Mensaje } from "./tipos";

export type Modo = "alta" | "actualizacion" | "ambos";

export interface ResultadoValidacion {
  filas: FilaValidada[];
  mensajes: Mensaje[];
  renglones: number;
  altas: number;
  actualizaciones: number;
  sinCambios: number;
  errores: number;
  advertencias: number;
}

const COLUMNA_ERROR = "ERROR";

/** Campos que el usuario puede ver/capturar (sin los sensibles que no tiene). */
export function camposVisibles(layout: Layout, permisos: ReadonlySet<string>): Campo[] {
  return layout.campos.filter((c) => !c.sensible || permisos.has(c.sensible));
}

function quitarAcentos(t: string) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/** Convierte el texto de una celda en el valor para la base (sin referencias). */
function convertir(campo: Campo, texto: string): { ok: true; valor: unknown } | { ok: false; mensaje: string } {
  switch (campo.tipo) {
    case "texto":
    case "ref":
    case "sat": {
      const v = campo.mayusculas || campo.tipo !== "texto" ? texto.toUpperCase() : texto;
      if (campo.max && v.length > campo.max) return { ok: false, mensaje: `Máximo ${campo.max} caracteres (trae ${v.length}).` };
      if (campo.patron && !campo.patron.test(v)) return { ok: false, mensaje: `"${texto}" no es válido: ${campo.patronTexto ?? "formato incorrecto"}.` };
      return { ok: true, valor: v };
    }
    case "entero":
      return leerEntero(texto, { minimo: campo.minimo, maximo: campo.maximo });
    case "decimal":
      return leerDecimal(texto, { decimales: campo.decimales, minimo: campo.minimo, mayorQueCero: campo.mayorQueCero });
    case "fecha":
      return leerFecha(texto);
    case "sino":
      return leerSiNo(texto);
    case "opcion": {
      const o = campo.opciones!.find((x) => quitarAcentos(x) === quitarAcentos(texto));
      return o ? { ok: true, valor: o } : { ok: false, mensaje: `"${texto}" no es válido. Valores permitidos: ${campo.opciones!.join(", ")}.` };
    }
  }
}

/** Valor de la base (como texto) → texto del layout. */
function aTextoLayout(campo: Campo, valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  switch (campo.tipo) {
    case "decimal":
      return formatearDecimal(new Decimal(valor).toFixed(), campo.decimales === 2 ? 2 : 0);
    case "entero":
      return formatearDecimal(valor);
    case "fecha":
      return formatearFecha(valor);
    case "sino":
      return valor === "true" || valor === "t" ? "SI" : "NO";
    default:
      return valor;
  }
}

function iguales(campo: Campo, nuevo: unknown, actual: string | null | undefined): boolean {
  if (nuevo === null || nuevo === undefined) return actual === null || actual === undefined;
  if (actual === null || actual === undefined) return false;
  if (campo.tipo === "decimal") return new Decimal(String(nuevo)).eq(actual);
  if (campo.tipo === "sino") return String(nuevo) === String(actual === "true");
  return String(nuevo) === String(actual);
}

async function configNumero(c: Cliente, clave: string, porOmision: number): Promise<number> {
  const r = await c.query("SELECT valor FROM configuracion WHERE clave = $1", [clave]);
  return r.rows[0] ? Number(r.rows[0].valor) : porOmision;
}

/**
 * Valida todo el archivo sin guardar nada. `permisos` define qué campos sensibles
 * puede capturar el usuario.
 */
export async function validarCarga(c: Cliente, layout: Layout, tabla: TablaLeida, modo: Modo, permisos: ReadonlySet<string>): Promise<ResultadoValidacion> {
  const mensajes: Mensaje[] = [];
  const global = (mensaje: string) => mensajes.push({ renglon: 1, campo: "", severidad: "error", mensaje });
  const visibles = camposVisibles(layout, permisos);
  const porNombre = new Map(layout.campos.map((f) => [f.nombre, f]));

  if (layout.modos && !layout.modos.includes(modo)) global(`Este layout no admite el modo "${modo}".`);

  // Encabezados
  const columnas: (Campo | null)[] = [];
  const vistos = new Set<string>();
  for (const e of tabla.encabezados) {
    const n = normalizarEncabezado(e);
    if (n === COLUMNA_ERROR || n === "") {
      columnas.push(null);
      continue;
    }
    const campo = porNombre.get(n);
    if (!campo) {
      global(`La columna "${e}" no pertenece al layout "${layout.nombre}". Descarga la plantilla vigente.`);
      columnas.push(null);
      continue;
    }
    if (campo.sensible && !permisos.has(campo.sensible)) {
      global(`No tienes permiso para capturar la columna ${campo.nombre}. Quítala del archivo.`);
      columnas.push(null);
      continue;
    }
    if (vistos.has(n)) global(`La columna ${n} está repetida.`);
    vistos.add(n);
    columnas.push(campo);
  }
  for (const k of layout.llave) if (!vistos.has(k) && porNombre.get(k)!.obligatorio) global(`Falta la columna ${k}, que identifica cada registro.`);
  if (modo !== "actualizacion") {
    for (const f of visibles) if (f.obligatorio && f.porOmision === undefined && !vistos.has(f.nombre)) global(`Falta la columna obligatoria ${f.nombre}.`);
  }
  const maximo = await configNumero(c, "cargas.renglones_maximos", 5000);
  if (tabla.filas.length > maximo) global(`El archivo trae ${tabla.filas.length} renglones; el máximo por carga es ${maximo}. Divídelo en varios archivos.`);
  if (!tabla.filas.length) global("El archivo no trae renglones con datos.");

  const vacio = (): ResultadoValidacion => ({ filas: [], mensajes, renglones: tabla.filas.length, altas: 0, actualizaciones: 0, sinCambios: 0, errores: mensajes.length, advertencias: 0 });
  if (mensajes.length) return vacio();

  // 1) Conversión de cada celda
  const filas: FilaValidada[] = tabla.filas.map((t) => {
    const f: FilaValidada = { renglon: t.renglon, celdas: {}, valores: {}, presentes: new Set(), accion: "alta", existente: null, id: null };
    columnas.forEach((campo, i) => {
      if (!campo) return;
      const texto = (t.celdas[i] ?? "").trim();
      f.celdas[campo.nombre] = texto;
      if (texto === "") return;
      const r = convertir(campo, texto);
      if (r.ok) {
        f.valores[campo.nombre] = r.valor;
        f.presentes.add(campo.nombre);
      } else mensajes.push({ renglon: t.renglon, campo: campo.nombre, severidad: "error", mensaje: r.mensaje });
    });
    return f;
  });

  // 2) Referencias a otros catálogos (una consulta por catálogo)
  for (const campo of layout.campos) {
    if (campo.tipo === "ref") {
      const claves = [...new Set(filas.map((f) => f.valores[campo.nombre]).filter((v): v is string => typeof v === "string"))];
      if (!claves.length) continue;
      const r = campo.ref!;
      const { rows } = await c.query(
        `SELECT r.id, r.clave, r.activo, ${r.filtro ? `(${r.filtro})` : "true"} AS aplica FROM ${r.tabla} r WHERE r.clave = ANY($1)`,
        [claves],
      );
      const mapa = new Map(rows.map((x) => [x.clave as string, x]));
      for (const f of filas) {
        const v = f.valores[campo.nombre];
        if (typeof v !== "string") continue;
        const x = mapa.get(v);
        const fallo = (m: string) => {
          mensajes.push({ renglon: f.renglon, campo: campo.nombre, severidad: "error", mensaje: m });
          delete f.valores[campo.nombre];
        };
        if (!x) fallo(`${r.etiqueta} "${v}" no existe. Dalo de alta primero.`);
        else if (!x.aplica) fallo(`"${v}" no es válido para este campo (${r.etiqueta.toLowerCase()} de otro tipo).`);
        else if (!x.activo) fallo(`${r.etiqueta} "${v}" está dado de baja.`);
        else f.valores[campo.nombre] = r.guarda === "clave" ? x.clave : x.id;
      }
    }
    if (campo.tipo === "sat") {
      const claves = [...new Set(filas.map((f) => f.valores[campo.nombre]).filter((v): v is string => typeof v === "string"))];
      if (!claves.length) continue;
      const total = (await c.query("SELECT count(*)::int n FROM sat_catalogo WHERE catalogo = $1", [campo.sat])).rows[0].n;
      if (!total) {
        mensajes.push({ renglon: 1, campo: campo.nombre, severidad: "advertencia", mensaje: `No se ha cargado el catálogo ${campo.sat} del SAT: la columna ${campo.nombre} no se pudo validar.` });
        continue;
      }
      const { rows } = await c.query("SELECT upper(clave) AS clave, activo FROM sat_catalogo WHERE catalogo = $1 AND upper(clave) = ANY($2)", [campo.sat, claves]);
      const mapa = new Map(rows.map((x) => [x.clave as string, x.activo as boolean]));
      for (const f of filas) {
        const v = f.valores[campo.nombre];
        if (typeof v !== "string") continue;
        if (!mapa.has(v)) {
          mensajes.push({ renglon: f.renglon, campo: campo.nombre, severidad: "error", mensaje: `"${v}" no existe en el catálogo ${campo.sat} del SAT.` });
          delete f.valores[campo.nombre];
        } else if (!mapa.get(v)) {
          mensajes.push({ renglon: f.renglon, campo: campo.nombre, severidad: "error", mensaje: `"${v}" ya no está vigente en el catálogo ${campo.sat} del SAT.` });
        }
      }
    }
  }

  // 3) Llave: vacía, duplicada en el archivo, existente en la base
  const llaves = new Map<string, number>();
  const conLlave: { f: FilaValidada; partes: (string | null)[] }[] = [];
  for (const f of filas) {
    const faltan = layout.llave.filter((k) => {
      const campo = porNombre.get(k)!;
      // Una llave opcional (ej. sucursal vacía = todas) vale como vacía.
      return !campo.obligatorio && campo.porOmision === undefined ? false : f.valores[k] === undefined;
    });
    const errorEnLlave = mensajes.some((m) => m.renglon === f.renglon && layout.llave.includes(m.campo));
    if (faltan.length && !errorEnLlave) {
      for (const k of faltan) mensajes.push({ renglon: f.renglon, campo: k, severidad: "error", mensaje: "Campo obligatorio: identifica el registro." });
    }
    if (faltan.length || errorEnLlave) {
      f.accion = "error";
      continue;
    }
    const partes = layout.llave.map((k) => (f.valores[k] === undefined || f.valores[k] === null ? null : String(f.valores[k])));
    const texto = partes.join("\u0001");
    const previo = llaves.get(texto);
    if (previo !== undefined) {
      mensajes.push({ renglon: f.renglon, campo: layout.llave[0]!, severidad: "error", mensaje: `Registro repetido en el archivo (ya viene en el renglón ${previo}).` });
      f.accion = "error";
      continue;
    }
    llaves.set(texto, f.renglon);
    conLlave.push({ f, partes });
  }
  if (conLlave.length) {
    const cols = layout.llave.map((k) => porNombre.get(k)!.columna);
    const arreglos = cols.map((_, i) => conLlave.map((x) => x.partes[i]));
    const { rows } = await c.query(
      `SELECT k.i, t.id::text AS id, ${layout.filtro ? `(${layout.filtro})` : "true"} AS aplica,
              (SELECT jsonb_object_agg(key, value) FROM jsonb_each_text(to_jsonb(t))) AS fila
         FROM unnest(${cols.map((_, i) => `$${i + 1}::text[]`).join(", ")}) WITH ORDINALITY AS k(${cols.map((_, i) => `c${i}`).join(", ")}, i)
         JOIN ${layout.tabla} t ON ${cols.map((col, i) => `t.${col}::text IS NOT DISTINCT FROM k.c${i}`).join(" AND ")}`,
      arreglos,
    );
    const porIndice = new Map(rows.map((r) => [Number(r.i) - 1, r]));
    conLlave.forEach((x, i) => {
      const r = porIndice.get(i);
      if (r && !r.aplica) {
        mensajes.push({ renglon: x.f.renglon, campo: layout.llave[0]!, severidad: "error", mensaje: "Esa clave ya existe en otro catálogo (otro tipo de artículo). Usa otra clave." });
        x.f.accion = "error";
        return;
      }
      if (r) {
        x.f.existente = r.fila;
        x.f.id = r.id;
      }
    });
  }

  // 4) Modo, obligatorios, campos que no cambian
  const pctAlerta = layout.campos.some((f) => f.alertaCambio) ? await configNumero(c, "cargas.alerta_cambio_costo_pct", 10) : 0;
  for (const f of filas) {
    if (f.accion === "error") continue;
    if (f.existente) {
      if (modo === "alta") {
        mensajes.push({ renglon: f.renglon, campo: layout.llave[0]!, severidad: "error", mensaje: "Ya existe. Para cambiarlo usa el modo actualización (o alta y actualización)." });
        f.accion = "error";
        continue;
      }
      f.accion = "actualizacion";
      for (const campo of layout.campos) {
        if (campo.soloAlta && f.presentes.has(campo.nombre) && !iguales(campo, f.valores[campo.nombre], f.existente[campo.columna])) {
          mensajes.push({ renglon: f.renglon, campo: campo.nombre, severidad: "error", mensaje: "Este dato no se puede cambiar una vez dado de alta." });
        }
        if (campo.alertaCambio && f.presentes.has(campo.nombre) && f.existente[campo.columna]) {
          const antes = new Decimal(f.existente[campo.columna]!);
          const ahora = new Decimal(String(f.valores[campo.nombre]));
          if (!antes.isZero()) {
            const pct = ahora.minus(antes).abs().div(antes).mul(100);
            if (pct.gt(pctAlerta)) {
              mensajes.push({ renglon: f.renglon, campo: campo.nombre, severidad: "advertencia", mensaje: `Cambia ${pct.toDecimalPlaces(1).toFixed()}% (de ${formatearDecimal(antes.toFixed())} a ${formatearDecimal(ahora.toFixed())}).` });
            }
          }
        }
      }
      const cambia = layout.campos.some((campo) => f.presentes.has(campo.nombre) && !layout.llave.includes(campo.nombre) && !iguales(campo, f.valores[campo.nombre], f.existente![campo.columna]));
      if (!cambia) f.accion = "sin_cambios";
    } else {
      if (modo === "actualizacion") {
        mensajes.push({ renglon: f.renglon, campo: layout.llave[0]!, severidad: "error", mensaje: "No existe. Para darlo de alta usa el modo alta (o alta y actualización)." });
        f.accion = "error";
        continue;
      }
      for (const campo of layout.campos) {
        if (f.presentes.has(campo.nombre) || mensajes.some((m) => m.renglon === f.renglon && m.campo === campo.nombre)) continue;
        if (campo.porOmision !== undefined) {
          const r = convertir(campo, campo.porOmision);
          if (r.ok) f.valores[campo.nombre] = r.valor;
        } else if (campo.obligatorio && (!campo.sensible || permisos.has(campo.sensible))) {
          mensajes.push({ renglon: f.renglon, campo: campo.nombre, severidad: "error", mensaje: "Campo obligatorio." });
        }
      }
    }
  }

  // 5) Reglas propias del layout
  const datos = layout.preparar ? await layout.preparar(c, filas.filter((f) => f.accion !== "error")) : undefined;
  for (const f of filas) {
    if (f.accion === "error" || !layout.validar) continue;
    const ayuda: Ayuda = {
      error: (campo, mensaje) => mensajes.push({ renglon: f.renglon, campo, severidad: "error", mensaje }),
      advertencia: (campo, mensaje) => mensajes.push({ renglon: f.renglon, campo, severidad: "advertencia", mensaje }),
      datos,
      cliente: c,
    };
    await layout.validar(f, ayuda);
  }

  const conError = new Set(mensajes.filter((m) => m.severidad === "error").map((m) => m.renglon));
  for (const f of filas) if (conError.has(f.renglon)) f.accion = "error";
  mensajes.sort((a, b) => a.renglon - b.renglon);
  return {
    filas,
    mensajes,
    renglones: filas.length,
    altas: filas.filter((f) => f.accion === "alta").length,
    actualizaciones: filas.filter((f) => f.accion === "actualizacion").length,
    sinCambios: filas.filter((f) => f.accion === "sin_cambios").length,
    errores: mensajes.filter((m) => m.severidad === "error").length,
    advertencias: mensajes.filter((m) => m.severidad === "advertencia").length,
  };
}

const tiposCache = new Map<string, Map<string, string>>();
async function tiposDeColumnas(c: Cliente, tabla: string): Promise<Map<string, string>> {
  let m = tiposCache.get(tabla);
  if (!m) {
    const { rows } = await c.query(
      "SELECT attname, format_type(atttypid, atttypmod) AS tipo FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped",
      [tabla],
    );
    m = new Map(rows.map((r) => [r.attname as string, r.tipo as string]));
    tiposCache.set(tabla, m);
  }
  return m;
}

/** Aplica en la transacción actual. Si hay un solo error no se llama (lo impide el servicio). */
export async function aplicarCarga(c: Cliente, layout: Layout, r: ResultadoValidacion, cargaId: string | null): Promise<void> {
  if (r.errores) throw new Error("No se aplica una carga con errores.");
  const tipos = await tiposDeColumnas(c, layout.tabla);
  const definicion = (cols: string[]) => cols.map((col) => `${col} ${tipos.get(col)}`).join(", ");

  // Altas: todas las columnas del layout (+ fijas)
  const altas = r.filas.filter((f) => f.accion === "alta");
  if (altas.length) {
    const fijos = layout.fijos ?? {};
    const cols = [...new Set([...layout.campos.map((f) => f.columna), ...Object.keys(fijos)])];
    const datos = altas.map((f) => {
      const o: Record<string, unknown> = { ...fijos };
      for (const campo of layout.campos) o[campo.columna] = f.valores[campo.nombre] ?? null;
      if (cols.includes("carga_id")) o.carga_id = cargaId;
      return o;
    });
    if (tipos.has("carga_id") && !cols.includes("carga_id")) {
      cols.push("carga_id");
      datos.forEach((d) => (d.carga_id = cargaId));
    }
    await c.query(`INSERT INTO ${layout.tabla} (${cols.join(", ")}) SELECT ${cols.join(", ")} FROM jsonb_to_recordset($1) AS x(${definicion(cols)})`, [JSON.stringify(datos)]);
  }

  // Actualizaciones: solo las columnas que traían valor, agrupadas por conjunto de columnas
  const grupos = new Map<string, FilaValidada[]>();
  for (const f of r.filas.filter((x) => x.accion === "actualizacion")) {
    const cols = layout.campos.filter((campo) => f.presentes.has(campo.nombre) && !layout.llave.includes(campo.nombre)).map((campo) => campo.columna);
    const k = cols.join(",");
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  for (const [k, filas] of grupos) {
    const cols = k.split(",").filter(Boolean);
    if (!cols.length) continue;
    const datos = filas.map((f) => {
      const o: Record<string, unknown> = { id: f.id };
      for (const campo of layout.campos) if (cols.includes(campo.columna)) o[campo.columna] = f.valores[campo.nombre] ?? null;
      return o;
    });
    await c.query(
      `UPDATE ${layout.tabla} t SET ${cols.map((col) => `${col} = x.${col}`).join(", ")}
         FROM jsonb_to_recordset($1) AS x(id uuid, ${definicion(cols)}) WHERE t.id = x.id`,
      [JSON.stringify(datos)],
    );
  }
  if (layout.despues) await layout.despues(c, r.filas.filter((f) => f.accion === "alta" || f.accion === "actualizacion"), cargaId);
}

// ---------------------------------------------------------------------------
// Exportación, plantillas e instrucciones
// ---------------------------------------------------------------------------

/** Lee los registros del layout ya en formato de texto del layout. */
export async function leerRegistros(c: Cliente, layout: Layout, permisos: ReadonlySet<string>, opciones: { buscar?: string; limite?: number } = {}): Promise<{ encabezados: string[]; filas: string[][]; ids: string[] }> {
  const campos = camposVisibles(layout, permisos);
  const joins: string[] = [];
  const select = campos.map((campo, i) => {
    if (campo.tipo === "ref" && campo.ref!.guarda !== "clave") {
      joins.push(`LEFT JOIN ${campo.ref!.tabla} j${i} ON j${i}.id = t.${campo.columna}`);
      return `j${i}.clave AS c${i}`;
    }
    return `t.${campo.columna}::text AS c${i}`;
  });
  const where: string[] = [];
  const params: unknown[] = [];
  if (layout.filtro) where.push(`(${layout.filtro})`);
  if (opciones.buscar) {
    params.push(`%${opciones.buscar}%`);
    const ors = campos
      .map((f, i) => {
        if (f.tipo === "ref" && f.ref!.guarda !== "clave") return `j${i}.clave ILIKE $1`;
        if (f.tipo === "texto" || f.tipo === "ref" || f.tipo === "sat") return `t.${f.columna}::text ILIKE $1`;
        return null;
      })
      .filter(Boolean);
    if (ors.length) where.push(`(${ors.join(" OR ")})`);
  }
  const { rows } = await c.query(
    `SELECT t.id::text AS id, ${select.join(", ")} FROM ${layout.tabla} t ${joins.join(" ")}
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${layout.orden ?? "t.clave"} ${opciones.limite ? `LIMIT ${Math.floor(opciones.limite)}` : ""}`,
    params,
  );
  return {
    encabezados: campos.map((f) => f.nombre),
    filas: rows.map((r) => campos.map((f, i) => aTextoLayout(f, r[`c${i}`]))),
    ids: rows.map((r) => r.id),
  };
}

function textoValores(campo: Campo): string {
  if (campo.tipo === "opcion") return campo.opciones!.join(", ");
  if (campo.tipo === "sino") return "SI, NO";
  if (campo.tipo === "ref") return `Clave existente en ${campo.ref!.etiqueta.toLowerCase()}s (hoja Listas)`;
  if (campo.tipo === "sat") return `Clave del catálogo ${campo.sat} del SAT`;
  if (campo.tipo === "fecha") return "DD/MM/AAAA (ej. 21/11/2026)";
  if (campo.tipo === "decimal") return `Número; punto decimal, coma de miles opcional${campo.decimales !== undefined ? `; hasta ${campo.decimales} decimales` : ""}${campo.mayorQueCero ? "; mayor que 0" : campo.minimo !== undefined ? `; mínimo ${campo.minimo}` : ""}`;
  if (campo.tipo === "entero") return `Número entero${campo.minimo !== undefined ? `; mínimo ${campo.minimo}` : ""}`;
  return campo.patronTexto ?? "Texto";
}

const NOMBRE_TIPO: Record<string, string> = { texto: "Texto", entero: "Entero", decimal: "Número", fecha: "Fecha", sino: "SI / NO", opcion: "Lista", ref: "Clave de catálogo", sat: "Clave SAT" };

export function notasGenerales(layout: Layout): string[] {
  return [
    `Layout: ${layout.nombre}`,
    layout.descripcion,
    `Se identifica cada registro por: ${layout.llave.join(" + ")}.`,
    "Formato de México: fechas DD/MM/AAAA (21/11/2026); números con punto decimal y coma de miles opcional (1,250.75 o 1250.75).",
    "TXT: separado por pipe | (o tabulador). CSV: separado por coma; los números con coma de miles van entre comillas.",
    "Acentos y ñ: se aceptan archivos en UTF-8 o en Windows-1252 (como los guarda Excel).",
    "Modos de carga: ALTA (solo registros nuevos), ACTUALIZACIÓN (solo existentes, por su clave) o AMBOS.",
    "En actualización, una celda vacía deja el dato como está. Nunca se borra nada: para dar de baja escribe NO en ACTIVO.",
    "Primero se valida (simulación) sin guardar nada. Si hay un solo error no se guarda ningún renglón; descarga el reporte, corrige la columna ERROR y vuelve a subir el archivo completo.",
    "Encabezados en café oscuro = obligatorios en un alta. No cambies los nombres de las columnas.",
    ...(layout.autorizacion ? ["Esta carga requiere autorización antes de aplicarse; la autoriza una persona distinta de quien la sube."] : []),
    ...(layout.notas ?? []),
  ];
}

export function filasInstrucciones(layout: Layout, permisos: ReadonlySet<string>): string[][] {
  return camposVisibles(layout, permisos).map((f) => [
    f.nombre,
    layout.llave.includes(f.nombre) ? "Sí (llave)" : f.obligatorio ? (f.porOmision !== undefined ? `No (si se omite: ${f.porOmision})` : "Sí") : f.porOmision !== undefined ? `No (si se omite: ${f.porOmision})` : "No",
    NOMBRE_TIPO[f.tipo]!,
    f.max ? String(f.max) : "",
    textoValores(f),
    f.ejemplo,
    f.descripcion + (f.soloAlta ? " No se puede cambiar después del alta." : ""),
  ]);
}

export const COLUMNAS_INSTRUCCIONES = ["Campo", "Obligatorio", "Tipo", "Longitud máx.", "Valores válidos", "Ejemplo", "Descripción"];

/** Texto de instrucciones para acompañar un TXT o CSV. */
export function instruccionesTexto(layout: Layout, permisos: ReadonlySet<string>): Uint8Array {
  const lineas = [...notasGenerales(layout), "", COLUMNAS_INSTRUCCIONES.join(" | "), ...filasInstrucciones(layout, permisos).map((f) => f.join(" | "))];
  return new TextEncoder().encode("﻿" + lineas.join("\r\n") + "\r\n");
}

export async function listasDeCatalogo(c: Cliente, campo: Campo): Promise<string[]> {
  if (campo.tipo === "opcion") return campo.opciones!;
  if (campo.tipo === "sino") return ["SI", "NO"];
  if (campo.tipo === "ref") {
    const r = campo.ref!;
    const { rows } = await c.query(`SELECT r.clave FROM ${r.tabla} r WHERE r.activo ${r.filtro ? `AND (${r.filtro})` : ""} ORDER BY r.clave LIMIT 2000`);
    return rows.map((x) => x.clave);
  }
  if (campo.tipo === "sat") {
    const { rows } = await c.query("SELECT clave FROM sat_catalogo WHERE catalogo = $1 AND activo ORDER BY clave LIMIT 1001", [campo.sat]);
    return rows.length > 1000 ? [] : rows.map((x) => x.clave);
  }
  return [];
}

/**
 * Genera el archivo del layout: plantilla vacía, exportación con datos o
 * reporte de errores (los mismos renglones + columna ERROR).
 */
export async function archivoLayout(
  c: Cliente,
  layout: Layout,
  permisos: ReadonlySet<string>,
  formato: "xlsx" | "txt" | "csv",
  contenido: { encabezados: string[]; filas: string[][] } | null,
): Promise<Uint8Array> {
  const campos = camposVisibles(layout, permisos);
  const encabezados = contenido?.encabezados ?? campos.map((f) => f.nombre);
  const filas = contenido?.filas ?? [];
  if (formato !== "xlsx") return escribirDelimitado(encabezados, filas, formato);

  const porNombre = new Map(campos.map((f) => [f.nombre, f]));
  const listas: { titulo: string; valores: string[] }[] = [];
  const columnas: ColumnaExcel[] = [];
  for (const e of encabezados) {
    const f = porNombre.get(e);
    const col: ColumnaExcel = { encabezado: e, tipo: f && (f.tipo === "decimal" || f.tipo === "entero") ? "numero" : "texto", obligatoria: !!f && (f.obligatorio || layout.llave.includes(f.nombre)) && f.porOmision === undefined, ancho: e === COLUMNA_ERROR ? 60 : undefined };
    if (f && ["opcion", "sino", "ref", "sat"].includes(f.tipo)) {
      const valores = await listasDeCatalogo(c, f);
      if (valores.length) {
        listas.push({ titulo: f.nombre, valores });
        col.lista = `Listas!$${letraColumna(listas.length)}$2:$${letraColumna(listas.length)}$${valores.length + 1}`;
      }
    }
    columnas.push(col);
  }
  return escribirExcelLayout(
    { columnas, filas, instrucciones: { columnas: COLUMNAS_INSTRUCCIONES, filas: filasInstrucciones(layout, permisos), notas: notasGenerales(layout) }, listas },
    layout.nombre,
  );
}

/** Reporte de errores: los renglones originales con la columna ERROR. */
export function reporteErrores(tabla: TablaLeida, mensajes: Mensaje[]): { encabezados: string[]; filas: string[][] } {
  const idxError = tabla.encabezados.findIndex((e) => normalizarEncabezado(e) === COLUMNA_ERROR);
  const encabezados = tabla.encabezados.filter((_, i) => i !== idxError).map((e) => normalizarEncabezado(e));
  const generales = mensajes.filter((m) => m.renglon === 1).map((m) => `${m.severidad === "error" ? "ERROR" : "AVISO"}: ${m.mensaje}`);
  const filas = tabla.filas.map((f) => {
    const celdas = f.celdas.slice(0, tabla.encabezados.length).filter((_, i) => i !== idxError);
    while (celdas.length < encabezados.length) celdas.push("");
    const propios = mensajes.filter((m) => m.renglon === f.renglon).map((m) => `${m.severidad === "error" ? "" : "AVISO "}${m.campo ? m.campo + ": " : ""}${m.mensaje}`);
    return [...celdas, propios.join(" · ")];
  });
  if (generales.length && filas[0]) filas[0][filas[0].length - 1] = [...generales, filas[0][filas[0].length - 1]].filter(Boolean).join(" · ");
  return { encabezados: [...encabezados, COLUMNA_ERROR], filas };
}
