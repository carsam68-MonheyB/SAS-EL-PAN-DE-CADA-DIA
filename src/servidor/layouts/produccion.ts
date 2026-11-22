// Layouts de la Fase 2: etapas, turnos, tarifas de mano de obra, tasas de GIF,
// recetas de masas/intermedios (N1) y de SKU (N2) con sus renglones, etapas por
// receta y plan de producción. Usan el mismo motor que los catálogos de la 1B.
import Decimal from "decimal.js";
import { factorConversion, type ConversionGeneral, type UnidadPropia } from "../../dominio/unidades";
import { hoyNegocio } from "../fechas";
import type { Cliente } from "../transaccion";
import type { Ayuda, Campo, FilaValidada, Layout } from "./tipos";

const CLAVE_PATRON = /^[A-Z0-9-]+$/;
const clave = (ejemplo: string, max = 20): Campo => ({
  nombre: "CLAVE", columna: "clave", tipo: "texto", obligatorio: true, mayusculas: true, max,
  patron: CLAVE_PATRON, patronTexto: "solo letras sin acento, números y guion (-)", ejemplo, descripcion: "Clave única del registro.",
});
const nombre = (ejemplo: string): Campo => ({ nombre: "NOMBRE", columna: "nombre", tipo: "texto", obligatorio: true, max: 120, ejemplo, descripcion: "Nombre o descripción." });
const ACTIVO: Campo = { nombre: "ACTIVO", columna: "activo", tipo: "sino", porOmision: "SI", ejemplo: "SI", descripcion: "NO = dado de baja. Nunca se borra." };
const PCT = (nombreCampo: string, columna: string, descripcion: string, ejemplo = "0"): Campo => ({
  nombre: nombreCampo, columna, tipo: "decimal", minimo: 0, decimales: 4, porOmision: "0", ejemplo, descripcion: `${descripcion} En %, de 0 a menos de 100 (ej. 3 = 3 %).`,
});
const VERSION = (columna: string): Campo => ({ nombre: "VERSION", columna, tipo: "entero", obligatorio: true, minimo: 1, maximo: 9999, soloAlta: true, ejemplo: "1", descripcion: "Número de versión de la receta (1, 2, 3…)." });
const VIGENTE_DESDE: Campo = { nombre: "VIGENTE_DESDE", columna: "vigente_desde", tipo: "fecha", obligatorio: true, ejemplo: "01/12/2026", descripcion: "Primer día en que aplica." };

const RECETAS = {
  ver: ["produccion.recetas:ver"],
  crear: ["produccion.recetas:crear"],
  editar: ["produccion.recetas:editar"],
  exportar: ["produccion.recetas:exportar"],
};
const SENSIBLE_RECETA = "datos.receta_completa:ver";

const ARTICULO = (etiqueta: string, tipos: string[]) => ({ tabla: "articulo", etiqueta, filtro: `r.tipo IN (${tipos.map((t) => `'${t}'`).join(", ")})` });
const UNIDAD = { tabla: "unidad", etiqueta: "La unidad" } as const;

/** Valor final de un campo: el nuevo si viene en el archivo; si no, el de la base. */
function actual(f: FilaValidada, layout: Layout, nombreCampo: string): string | null {
  const campo = layout.campos.find((x) => x.nombre === nombreCampo);
  if (!campo) return null;
  if (f.presentes.has(campo.nombre) || !f.existente) {
    const v = f.valores[campo.nombre];
    return v === undefined || v === null ? null : String(v);
  }
  return f.existente[campo.columna] ?? null;
}

function validarPct(f: FilaValidada, layout: Layout, ayuda: Ayuda, campos: string[]) {
  for (const n of campos) {
    const v = actual(f, layout, n);
    if (v !== null && new Decimal(v).gte(100)) ayuda.error(n, "El porcentaje debe ser menor que 100.");
  }
}

/** Encabezados de receta (articulo_id + versión) que toca el archivo. */
async function encabezados(c: Cliente, filas: FilaValidada[], campoArticulo: string) {
  const pares = filas.filter((f) => f.valores[campoArticulo] && f.valores.VERSION !== undefined).map((f) => ({ a: f.valores[campoArticulo], v: f.valores.VERSION }));
  const { rows } = await c.query(
    `SELECT r.articulo_id::text || '#' || r.version AS k, r.estatus, r.nivel, r.captura, a.clave, u.clave AS unidad
       FROM jsonb_to_recordset($1::jsonb) AS x(a uuid, v int)
       JOIN receta r ON r.articulo_id = x.a AND r.version = x.v
       JOIN articulo a ON a.id = r.articulo_id JOIN unidad u ON u.id = a.unidad_base_id`,
    [JSON.stringify(pares)],
  );
  return new Map(rows.map((r) => [r.k as string, r]));
}

/** Unidades de los artículos (base y propias) y conversiones generales. */
async function unidadesDe(c: Cliente, ids: unknown[]) {
  const arts = new Map<string, { clave: string; tipo: string; base: string; propias: UnidadPropia[] }>();
  for (const r of (await c.query("SELECT a.id::text, a.clave, a.tipo, u.clave AS base FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id WHERE a.id = ANY($1::uuid[])", [ids])).rows) {
    arts.set(r.id, { clave: r.clave, tipo: r.tipo, base: r.base, propias: [] });
  }
  for (const r of (await c.query("SELECT au.articulo_id::text AS id, u.clave AS unidad, au.factor_a_base::text AS f FROM articulo_unidad au JOIN unidad u ON u.id = au.unidad_id WHERE au.activo AND au.articulo_id = ANY($1::uuid[])", [ids])).rows) {
    arts.get(r.id)?.propias.push({ unidad: r.unidad, factorABase: r.f });
  }
  const unidades = new Map((await c.query("SELECT id::text, clave FROM unidad")).rows.map((u) => [u.id as string, u.clave as string]));
  const generales: ConversionGeneral[] = (await c.query(
    "SELECT d.clave AS de, a.clave AS a, cu.factor::text AS factor FROM conversion_unidad cu JOIN unidad d ON d.id = cu.de_unidad_id JOIN unidad a ON a.id = cu.a_unidad_id WHERE cu.activo",
  )).rows;
  return { arts, unidades, generales };
}

/** Ruta desde → … → hasta en el grafo "usa" (null si no hay). */
function rutaEntre(grafo: Map<string, Set<string>>, desde: string, hasta: string): string[] | null {
  const previo = new Map<string, string | null>([[desde, null]]);
  const cola = [desde];
  while (cola.length) {
    const n = cola.shift()!;
    if (n === hasta) {
      const ruta: string[] = [];
      for (let x: string | null = n; x !== null; x = previo.get(x)!) ruta.unshift(x);
      return ruta;
    }
    for (const h of grafo.get(n) ?? []) if (!previo.has(h)) (previo.set(h, n), cola.push(h));
  }
  return null;
}

function exigirBorrador(f: FilaValidada, ayuda: Ayuda, campoArticulo: string, hoja: string) {
  const enc = ayuda.datos.encabezados.get(`${f.valores[campoArticulo]}#${f.valores.VERSION}`);
  if (!enc) {
    ayuda.error("VERSION", `No existe esa versión de la receta. Carga primero su encabezado en "${hoja}".`);
    return null;
  }
  if (enc.estatus !== "BORRADOR") {
    ayuda.error("VERSION", `La versión ${f.valores.VERSION} de ${enc.clave} ya está activa: no se modifica. Crea una versión nueva.`);
    return null;
  }
  return enc;
}

function validarUnidad(f: FilaValidada, layout: Layout, ayuda: Ayuda) {
  const unidadId = actual(f, layout, "UNIDAD");
  const compId = actual(f, layout, "COMPONENTE");
  if (!unidadId || !compId) return;
  const comp = ayuda.datos.unidades.arts.get(compId);
  const unidad = ayuda.datos.unidades.unidades.get(unidadId);
  if (comp && unidad && !factorConversion(unidad, comp.base, comp, ayuda.datos.unidades.generales)) {
    ayuda.error("UNIDAD", `No hay conversión de ${unidad} a ${comp.base} (unidad base de ${comp.clave}). Cárgala en "Conversiones de unidades" o en "Unidades por artículo".`);
  }
}

async function validarFechaReceta(f: FilaValidada, ayuda: Ayuda) {
  if (f.existente?.estatus && f.existente.estatus !== "BORRADOR") {
    return ayuda.error("VERSION", "Esta versión ya está activa: no se modifica. Crea una versión nueva con otro número.");
  }
  const desde = f.valores.VIGENTE_DESDE as string | undefined;
  if (desde && desde < ayuda.datos.hoy) ayuda.error("VIGENTE_DESDE", "La vigencia no puede empezar antes de hoy.");
}

// ---------------------------------------------------------------------------
// Catálogos de producción y costos
// ---------------------------------------------------------------------------

const etapas: Layout = {
  clave: "etapas", secuencia: 19, grupo: "Producción", nombre: "Etapas de producción",
  descripcion: "Etapas del proceso (ej. pesado, amasado, formado, fermentación, horneado, decorado, empaque). Las define el negocio (pregunta P28).",
  tabla: "etapa_produccion", llave: ["CLAVE"], orden: "t.orden, t.clave",
  permisos: { ver: ["produccion.recetas:ver", "produccion.plan:ver", "produccion.ordenes:ver"], crear: RECETAS.crear, editar: RECETAS.editar, exportar: RECETAS.exportar },
  campos: [
    clave("AMASADO"),
    nombre("Amasado"),
    { nombre: "ORDEN", columna: "orden", tipo: "entero", obligatorio: true, minimo: 1, maximo: 999, ejemplo: "2", descripcion: "Orden de la etapa en el proceso." },
    { nombre: "REGISTRA_MERMA", columna: "registra_merma", tipo: "sino", porOmision: "NO", ejemplo: "SI", descripcion: "SI si en esta etapa se registra avance y merma (Fase 5)." },
    ACTIVO,
  ],
};

const turnos: Layout = {
  clave: "turnos", secuencia: 20, grupo: "Producción", nombre: "Turnos de producción",
  descripcion: "Turnos de producción (pregunta P13). El plan de producción se hace por fecha y, si se usa, por turno.",
  tabla: "turno_produccion", llave: ["CLAVE"],
  permisos: { ver: ["produccion.plan:ver", "produccion.recetas:ver"], crear: ["produccion.plan:crear", "produccion.recetas:crear"], editar: ["produccion.plan:editar", "produccion.recetas:editar"], exportar: ["produccion.plan:exportar", "produccion.recetas:exportar"] },
  campos: [
    clave("MATUTINO"),
    nombre("Turno matutino"),
    { nombre: "HORA_INICIO", columna: "hora_inicio", tipo: "texto", max: 5, patron: /^([01][0-9]|2[0-3]):[0-5][0-9]$/, patronTexto: "hora HH:MM de 24 horas (ej. 03:00)", ejemplo: "03:00", descripcion: "Hora de inicio." },
    { nombre: "HORA_FIN", columna: "hora_fin", tipo: "texto", max: 5, patron: /^([01][0-9]|2[0-3]):[0-5][0-9]$/, patronTexto: "hora HH:MM de 24 horas (ej. 11:00)", ejemplo: "11:00", descripcion: "Hora de fin." },
    ACTIVO,
  ],
};

const COSTOS = { ver: ["datos.costos:ver"], crear: ["configuracion.parametros:editar"], editar: ["configuracion.parametros:editar"], exportar: ["configuracion.parametros:editar"] };

async function prepararVigencia(c: Cliente) {
  return { hoy: await hoyNegocio(c) };
}
function validarVigencia(f: FilaValidada, ayuda: Ayuda) {
  const desde = f.valores.VIGENTE_DESDE as string;
  if (f.existente && desde <= ayuda.datos.hoy) ayuda.error("VIGENTE_DESDE", "Esa tarifa ya está vigente o es histórica: no se corrige, captura una nueva con otra fecha.");
  else if (!f.existente && desde < ayuda.datos.hoy) ayuda.error("VIGENTE_DESDE", "La vigencia no puede empezar antes de hoy.");
}

const tarifasMod: Layout = {
  clave: "tarifas_mod", secuencia: 21, grupo: "Producción", nombre: "Costo de mano de obra por minuto",
  descripcion: "Costo de mano de obra directa por minuto en cada etapa, con fecha de vigencia (pregunta P35). Una tarifa nueva reemplaza a la anterior desde su fecha; el historial no se borra.",
  tabla: "tarifa_mod", llave: ["ETAPA", "VIGENTE_DESDE"], permisos: COSTOS,
  orden: "(SELECT clave FROM etapa_produccion e WHERE e.id = t.etapa_id), t.vigente_desde",
  notas: ["Ejemplo de cálculo: nómina mensual de la etapa ÷ minutos trabajados al mes. El criterio lo define el negocio."],
  campos: [
    { nombre: "ETAPA", columna: "etapa_id", tipo: "ref", ref: { tabla: "etapa_produccion", etiqueta: "La etapa" }, obligatorio: true, ejemplo: "AMASADO", descripcion: "Clave de la etapa." },
    VIGENTE_DESDE,
    { nombre: "COSTO_MINUTO", columna: "costo_minuto", tipo: "decimal", obligatorio: true, minimo: 0, decimales: 6, sensible: "datos.costos:ver", alertaCambio: true, ejemplo: "2.50", descripcion: "Costo por minuto de mano de obra en esa etapa." },
  ],
  preparar: prepararVigencia,
  validar: validarVigencia,
};

const tasasGif: Layout = {
  clave: "tasas_gif", secuencia: 22, grupo: "Producción", nombre: "Tasas de gastos indirectos (GIF)",
  descripcion: "Tasa predeterminada de gastos indirectos de fabricación por base de prorrateo, con vigencia (pregunta P36). Se puede usar una base o varias.",
  tabla: "tasa_gif", llave: ["BASE", "VIGENTE_DESDE"], permisos: COSTOS, orden: "t.base, t.vigente_desde",
  notas: [
    "KG_MASA: pesos por cada unidad (kg) de masa o intermedio producida; se suma al costo del intermedio.",
    "MINUTO_MOD: pesos por cada minuto de mano de obra directa (en masas y en SKU).",
    "PIEZA: pesos por cada pieza formada de SKU.",
  ],
  campos: [
    { nombre: "BASE", columna: "base", tipo: "opcion", obligatorio: true, opciones: ["KG_MASA", "MINUTO_MOD", "PIEZA"], ejemplo: "KG_MASA", descripcion: "Base de prorrateo." },
    VIGENTE_DESDE,
    { nombre: "TASA", columna: "tasa", tipo: "decimal", obligatorio: true, minimo: 0, decimales: 6, sensible: "datos.costos:ver", alertaCambio: true, ejemplo: "1.20", descripcion: "Pesos por unidad de la base." },
  ],
  preparar: prepararVigencia,
  validar: validarVigencia,
};

// ---------------------------------------------------------------------------
// Recetas N1: encabezado y fórmula por lote
// ---------------------------------------------------------------------------

const recetasIntermedios: Layout = {
  clave: "recetas_intermedios", secuencia: 23, grupo: "Recetas", nombre: "Recetas de masas e intermedios (N1)",
  descripcion: "Encabezado de cada versión de receta de masa o intermedio: tamaño del lote, rendimiento, merma de proceso, regla de lote y capacidad de la amasadora. Los ingredientes van en \"Fórmulas de masas e intermedios\".",
  tabla: "receta", llave: ["INTERMEDIO", "VERSION"], filtro: "t.nivel = 'N1'", fijos: { nivel: "N1" }, permisos: RECETAS,
  orden: "(SELECT clave FROM articulo a WHERE a.id = t.articulo_id), t.version",
  notas: [
    "Las cantidades del lote van en la unidad base del intermedio (normalmente KG).",
    "CAPTURA = CANTIDAD: cada ingrediente con su cantidad y unidad. CAPTURA = PCT_PANADERO: cada ingrediente como % de la harina (harina = 100 %) y es obligatorio el TAMANO_LOTE: el sistema calcula harina = TAMANO_LOTE × 100 ÷ suma de %.",
    "RENDIMIENTO_LOTE: lo que rinde el lote ya preparado. Si se deja vacío se calcula: TAMANO_LOTE (o la suma de ingredientes) × (1 − MERMA_PROCESO_PCT).",
    "REGLA_LOTE = COMPLETO: se preparan lotes completos y el excedente queda como sobrante esperado. EXACTO: se prepara la cantidad justa (pregunta P29).",
    "Una versión nueva queda en BORRADOR y se puede corregir. Cuando está completa se ACTIVA en la pantalla Recetas; ya activa no cambia.",
  ],
  campos: [
    { nombre: "INTERMEDIO", columna: "articulo_id", tipo: "ref", ref: ARTICULO("La masa o intermedio", ["INTERMEDIO"]), obligatorio: true, soloAlta: true, ejemplo: "PRUEBA-MASA-DULCE", descripcion: "Clave de la masa o intermedio (catálogo N1)." },
    VERSION("version"),
    VIGENTE_DESDE,
    { nombre: "CAPTURA", columna: "captura", tipo: "opcion", opciones: ["CANTIDAD", "PCT_PANADERO"], porOmision: "CANTIDAD", ejemplo: "PCT_PANADERO", descripcion: "Cómo se escriben los ingredientes." },
    { nombre: "TAMANO_LOTE", columna: "tamano_lote", tipo: "decimal", mayorQueCero: true, decimales: 6, ejemplo: "20", descripcion: "Masa total del lote (suma de ingredientes) en la unidad base del intermedio." },
    { nombre: "RENDIMIENTO_LOTE", columna: "rendimiento_lote", tipo: "decimal", mayorQueCero: true, decimales: 6, ejemplo: "19.6", descripcion: "Lo que rinde un lote, en la unidad base del intermedio." },
    PCT("MERMA_PROCESO_PCT", "merma_proceso_pct", "Merma del proceso de preparación.", "2"),
    { nombre: "REGLA_LOTE", columna: "regla_lote", tipo: "opcion", obligatorio: true, opciones: ["COMPLETO", "EXACTO"], ejemplo: "COMPLETO", descripcion: "Lote completo o cantidad exacta." },
    { nombre: "CAPACIDAD_AMASADORA", columna: "capacidad_amasadora", tipo: "decimal", mayorQueCero: true, decimales: 6, ejemplo: "25", descripcion: "Máximo por amasada (para calcular cuántas amasadas son)." },
    { nombre: "COMENTARIO", columna: "comentario", tipo: "texto", max: 300, ejemplo: "Versión inicial", descripcion: "Nota libre." },
  ],
  async preparar(c) {
    return { hoy: await hoyNegocio(c) };
  },
  async validar(f, ayuda) {
    await validarFechaReceta(f, ayuda);
    validarPct(f, recetasIntermedios, ayuda, ["MERMA_PROCESO_PCT"]);
    if (actual(f, recetasIntermedios, "CAPTURA") === "PCT_PANADERO" && !actual(f, recetasIntermedios, "TAMANO_LOTE")) {
      ayuda.error("TAMANO_LOTE", "Con captura en % panadero el tamaño del lote es obligatorio.");
    }
  },
};

const formulasIntermedios: Layout = {
  clave: "formulas_intermedios", secuencia: 24, grupo: "Recetas", nombre: "Fórmulas de masas e intermedios (N1)",
  descripcion: "Un renglón por ingrediente de cada versión de receta de masa o intermedio. Un intermedio puede llevar otro (ej. masa madre).",
  tabla: "receta_componente", llave: ["INTERMEDIO", "VERSION", "COMPONENTE"], permisos: RECETAS,
  filtro: "(SELECT tipo FROM articulo a WHERE a.id = t.receta_articulo_id) = 'INTERMEDIO'",
  orden: "(SELECT clave FROM articulo a WHERE a.id = t.receta_articulo_id), t.receta_version, (SELECT clave FROM articulo a WHERE a.id = t.componente_id)",
  notas: [
    "Si la receta se captura por CANTIDAD: llena CANTIDAD y UNIDAD y deja vacío PCT_PANADERO. Si se captura en PCT_PANADERO: llena solo PCT_PANADERO.",
    "La cantidad es por lote. Un mismo componente no se repite en la misma versión.",
    "Una receta no puede contenerse a sí misma, ni directa ni indirectamente.",
    "Para quitar un ingrediente de una versión en borrador escribe NO en ACTIVO.",
  ],
  campos: [
    { nombre: "INTERMEDIO", columna: "receta_articulo_id", tipo: "ref", ref: ARTICULO("La masa o intermedio", ["INTERMEDIO"]), obligatorio: true, ejemplo: "PRUEBA-MASA-DULCE", descripcion: "Masa o intermedio al que pertenece la fórmula." },
    VERSION("receta_version"),
    { nombre: "COMPONENTE", columna: "componente_id", tipo: "ref", ref: ARTICULO("El componente", ["INSUMO", "EMPAQUE", "INTERMEDIO"]), obligatorio: true, ejemplo: "PRUEBA-HAR-01", descripcion: "Insumo, empaque u otro intermedio." },
    { nombre: "CANTIDAD", columna: "cantidad", tipo: "decimal", mayorQueCero: true, decimales: 6, sensible: SENSIBLE_RECETA, ejemplo: "10000", descripcion: "Cantidad por lote (captura por CANTIDAD)." },
    { nombre: "UNIDAD", columna: "unidad_id", tipo: "ref", ref: UNIDAD, ejemplo: "G", descripcion: "Unidad de la cantidad." },
    { nombre: "PCT_PANADERO", columna: "pct_panadero", tipo: "decimal", mayorQueCero: true, decimales: 6, sensible: SENSIBLE_RECETA, ejemplo: "100", descripcion: "% sobre la harina (captura en PCT_PANADERO)." },
    PCT("MERMA_PCT", "merma_pct", "Merma propia del ingrediente."),
    ACTIVO,
  ],
  async preparar(c, filas) {
    const ids = [...new Set(filas.flatMap((f) => [f.valores.INTERMEDIO, f.valores.COMPONENTE]).filter(Boolean))];
    const datos = { encabezados: await encabezados(c, filas, "INTERMEDIO"), unidades: await unidadesDe(c, ids), grafo: new Map<string, Set<string>>(), nombres: new Map<string, string>() };
    // Grafo "intermedio usa intermedio" con lo que ya existe más lo que trae el archivo.
    const { rows } = await c.query(
      `SELECT rc.receta_articulo_id::text AS p, rc.componente_id::text AS h, pa.clave AS cp, ha.clave AS ch
         FROM receta_componente rc JOIN articulo pa ON pa.id = rc.receta_articulo_id JOIN articulo ha ON ha.id = rc.componente_id
        WHERE rc.activo AND ha.tipo = 'INTERMEDIO'`,
    );
    const arista = (p: string, h: string) => datos.grafo.set(p, (datos.grafo.get(p) ?? new Set()).add(h));
    for (const r of rows) {
      arista(r.p, r.h);
      datos.nombres.set(r.p, r.cp).set(r.h, r.ch);
    }
    for (const [id, a] of datos.unidades.arts) datos.nombres.set(id, a.clave);
    for (const f of filas) {
      const p = f.valores.INTERMEDIO as string;
      const h = f.valores.COMPONENTE as string;
      if (p === h || datos.unidades.arts.get(h)?.tipo !== "INTERMEDIO") continue;
      if (f.valores.ACTIVO === false) datos.grafo.get(p)?.delete(h);
      else arista(p, h);
    }
    return datos;
  },
  validar(f, ayuda) {
    const enc = exigirBorrador(f, ayuda, "INTERMEDIO", recetasIntermedios.nombre);
    validarPct(f, formulasIntermedios, ayuda, ["MERMA_PCT"]);
    const p = f.valores.INTERMEDIO as string;
    const h = f.valores.COMPONENTE as string;
    if (p === h) return ayuda.error("COMPONENTE", "Una receta no puede llevarse a sí misma.");
    if (ayuda.datos.unidades.arts.get(h)?.tipo === "INTERMEDIO" && f.valores.ACTIVO !== false) {
      const ruta = rutaEntre(ayuda.datos.grafo, h, p);
      if (ruta) ayuda.error("COMPONENTE", `Receta circular: ${[p, ...ruta].map((x) => ayuda.datos.nombres.get(x) ?? x).join(" → ")}.`);
    }
    if (!enc) return;
    const cantidad = actual(f, formulasIntermedios, "CANTIDAD");
    const unidad = actual(f, formulasIntermedios, "UNIDAD");
    const pct = actual(f, formulasIntermedios, "PCT_PANADERO");
    if (enc.captura === "PCT_PANADERO") {
      if (!pct) ayuda.error("PCT_PANADERO", "La receta se captura en % panadero: falta el porcentaje.");
      if (cantidad || unidad) ayuda.error("CANTIDAD", "La receta se captura en % panadero: deja vacías CANTIDAD y UNIDAD.");
    } else {
      if (!cantidad) ayuda.error("CANTIDAD", "Falta la cantidad por lote.");
      if (!unidad) ayuda.error("UNIDAD", "Falta la unidad.");
      if (pct) ayuda.error("PCT_PANADERO", "La receta se captura por CANTIDAD: deja vacío el % panadero.");
      validarUnidad(f, formulasIntermedios, ayuda);
    }
  },
};

// ---------------------------------------------------------------------------
// Recetas N2 (SKU): encabezado y componentes por pieza
// ---------------------------------------------------------------------------

const recetasSku: Layout = {
  clave: "recetas_sku", secuencia: 25, grupo: "Recetas", nombre: "Recetas de productos terminados (N2)",
  descripcion: "Encabezado de cada versión de receta de SKU: mermas de formado y de horneado y piezas por lote. Los componentes van en \"Componentes de recetas de SKU\".",
  tabla: "receta", llave: ["SKU", "VERSION"], filtro: "t.nivel = 'N2'", fijos: { nivel: "N2" }, permisos: RECETAS,
  orden: "(SELECT clave FROM articulo a WHERE a.id = t.articulo_id), t.version",
  notas: [
    "MERMA_HORNEADO_PCT (piezas dañadas): se forman más piezas para que salgan las piezas buenas del plan.",
    "MERMA_FORMADO_PCT (recortes): se aplica solo a los componentes de tipo MASA.",
    "PIEZAS_POR_LOTE: piezas de una tanda (charola, horneada). Obligatorio si alguna etapa de esta receta se captura por LOTE.",
    "Una versión nueva queda en BORRADOR y se puede corregir. Cuando está completa se ACTIVA en la pantalla Recetas; ya activa no cambia.",
  ],
  campos: [
    { nombre: "SKU", columna: "articulo_id", tipo: "ref", ref: ARTICULO("El producto", ["SKU"]), obligatorio: true, soloAlta: true, ejemplo: "PRUEBA-CONCHA-V", descripcion: "Clave del producto terminado." },
    VERSION("version"),
    VIGENTE_DESDE,
    PCT("MERMA_FORMADO_PCT", "merma_formado_pct", "Recortes de masa al formar.", "2"),
    PCT("MERMA_HORNEADO_PCT", "merma_horneado_pct", "Piezas dañadas en horneado.", "3"),
    { nombre: "PIEZAS_POR_LOTE", columna: "piezas_por_lote", tipo: "decimal", mayorQueCero: true, decimales: 4, ejemplo: "40", descripcion: "Piezas por tanda (si hay mano de obra por LOTE)." },
    { nombre: "COMENTARIO", columna: "comentario", tipo: "texto", max: 300, ejemplo: "Versión inicial", descripcion: "Nota libre." },
  ],
  async preparar(c) {
    return { hoy: await hoyNegocio(c) };
  },
  async validar(f, ayuda) {
    await validarFechaReceta(f, ayuda);
    validarPct(f, recetasSku, ayuda, ["MERMA_FORMADO_PCT", "MERMA_HORNEADO_PCT"]);
  },
};

const TIPO_ARTICULO: Record<string, string> = { MASA: "INTERMEDIO", INTERMEDIO: "INTERMEDIO", INSUMO: "INSUMO", EMPAQUE: "EMPAQUE" };

const componentesSku: Layout = {
  clave: "componentes_sku", secuencia: 26, grupo: "Recetas", nombre: "Componentes de recetas de SKU (N2)",
  descripcion: "Un renglón por componente de cada versión de receta de SKU: masa (gramos de masa cruda por pieza), otros intermedios (cubiertas, rellenos), insumos directos y empaques.",
  tabla: "receta_componente", llave: ["SKU", "VERSION", "COMPONENTE"], permisos: RECETAS,
  filtro: "(SELECT tipo FROM articulo a WHERE a.id = t.receta_articulo_id) = 'SKU'",
  orden: "(SELECT clave FROM articulo a WHERE a.id = t.receta_articulo_id), t.receta_version, t.tipo, (SELECT clave FROM articulo a WHERE a.id = t.componente_id)",
  notas: [
    "La cantidad es por pieza buena (o por unidad de venta si el SKU se vende a granel).",
    "TIPO = MASA para la masa principal (peso de formado); INTERMEDIO para cubiertas, rellenos, betunes; INSUMO para insumos directos; EMPAQUE para bolsas y etiquetas.",
    "Un mismo componente no se repite en la misma versión. Para quitarlo de una versión en borrador escribe NO en ACTIVO.",
  ],
  campos: [
    { nombre: "SKU", columna: "receta_articulo_id", tipo: "ref", ref: ARTICULO("El producto", ["SKU"]), obligatorio: true, ejemplo: "PRUEBA-CONCHA-V", descripcion: "Producto al que pertenece la receta." },
    VERSION("receta_version"),
    { nombre: "TIPO", columna: "tipo", tipo: "opcion", obligatorio: true, opciones: ["MASA", "INTERMEDIO", "INSUMO", "EMPAQUE"], ejemplo: "MASA", descripcion: "Tipo de componente." },
    { nombre: "COMPONENTE", columna: "componente_id", tipo: "ref", ref: ARTICULO("El componente", ["INSUMO", "EMPAQUE", "INTERMEDIO"]), obligatorio: true, ejemplo: "PRUEBA-MASA-DULCE", descripcion: "Clave del componente." },
    { nombre: "CANTIDAD", columna: "cantidad", tipo: "decimal", mayorQueCero: true, decimales: 6, sensible: SENSIBLE_RECETA, ejemplo: "60", descripcion: "Cantidad por pieza." },
    { nombre: "UNIDAD", columna: "unidad_id", tipo: "ref", ref: UNIDAD, obligatorio: true, ejemplo: "G", descripcion: "Unidad de la cantidad." },
    PCT("MERMA_PCT", "merma_pct", "Merma propia del componente."),
    ACTIVO,
  ],
  async preparar(c, filas) {
    const ids = [...new Set(filas.flatMap((f) => [f.valores.SKU, f.valores.COMPONENTE]).filter(Boolean))];
    return { encabezados: await encabezados(c, filas, "SKU"), unidades: await unidadesDe(c, ids) };
  },
  validar(f, ayuda) {
    exigirBorrador(f, ayuda, "SKU", recetasSku.nombre);
    validarPct(f, componentesSku, ayuda, ["MERMA_PCT"]);
    const tipo = actual(f, componentesSku, "TIPO");
    const comp = ayuda.datos.unidades.arts.get(actual(f, componentesSku, "COMPONENTE") ?? "");
    if (tipo && comp && TIPO_ARTICULO[tipo] !== comp.tipo) ayuda.error("TIPO", `${comp.clave} es ${comp.tipo}; el TIPO debe ser ${comp.tipo === "INTERMEDIO" ? "MASA o INTERMEDIO" : comp.tipo}.`);
    if (!actual(f, componentesSku, "CANTIDAD")) ayuda.error("CANTIDAD", "Falta la cantidad por pieza.");
    validarUnidad(f, componentesSku, ayuda);
  },
};

const etapasReceta: Layout = {
  clave: "etapas_receta", secuencia: 27, grupo: "Recetas", nombre: "Etapas y mano de obra por receta",
  descripcion: "Minutos de mano de obra por etapa en cada versión de receta (para el costo). En masas e intermedios es por LOTE; en SKU puede ser por PIEZA o por LOTE.",
  tabla: "receta_etapa", llave: ["ARTICULO", "VERSION", "ETAPA"], permisos: RECETAS,
  orden: "(SELECT clave FROM articulo a WHERE a.id = t.receta_articulo_id), t.receta_version, (SELECT orden FROM etapa_produccion e WHERE e.id = t.etapa_id)",
  campos: [
    { nombre: "ARTICULO", columna: "receta_articulo_id", tipo: "ref", ref: ARTICULO("La masa, intermedio o producto", ["INTERMEDIO", "SKU"]), obligatorio: true, ejemplo: "PRUEBA-MASA-DULCE", descripcion: "Clave de la masa, intermedio o SKU." },
    VERSION("receta_version"),
    { nombre: "ETAPA", columna: "etapa_id", tipo: "ref", ref: { tabla: "etapa_produccion", etiqueta: "La etapa" }, obligatorio: true, ejemplo: "AMASADO", descripcion: "Clave de la etapa." },
    { nombre: "MINUTOS", columna: "minutos", tipo: "decimal", obligatorio: true, mayorQueCero: true, decimales: 4, ejemplo: "25", descripcion: "Minutos de mano de obra." },
    { nombre: "BASE", columna: "base", tipo: "opcion", obligatorio: true, opciones: ["LOTE", "PIEZA"], ejemplo: "LOTE", descripcion: "Minutos por LOTE o por PIEZA." },
    ACTIVO,
  ],
  async preparar(c, filas) {
    return { encabezados: await encabezados(c, filas, "ARTICULO") };
  },
  validar(f, ayuda) {
    const enc = exigirBorrador(f, ayuda, "ARTICULO", "Recetas de masas e intermedios / de productos terminados");
    if (enc?.nivel === "N1" && actual(f, etapasReceta, "BASE") !== "LOTE") ayuda.error("BASE", "En masas e intermedios la mano de obra se captura por LOTE.");
  },
};

// ---------------------------------------------------------------------------
// Plan de producción
// ---------------------------------------------------------------------------

const planProduccion: Layout = {
  clave: "plan_produccion", secuencia: 28, grupo: "Producción", nombre: "Plan de producción",
  descripcion: "Piezas de cada SKU a producir por fecha (y turno o sucursal, si se usan). El plan se crea solo con su primer renglón y queda en BORRADOR hasta que se aprueba.",
  tabla: "plan_renglon", llave: ["FECHA", "TURNO", "SUCURSAL", "SKU"], llaveEnFiltro: true,
  filtro: "t.plan_id IN (SELECT p.id FROM plan_produccion p WHERE p.estatus <> 'CANCELADO')",
  permisos: { ver: ["produccion.plan:ver"], crear: ["produccion.plan:crear"], editar: ["produccion.plan:editar"], exportar: ["produccion.plan:exportar", "produccion.plan:editar"] },
  orden: "t.fecha, (SELECT clave FROM turno_produccion x WHERE x.id = t.turno_id) NULLS FIRST, (SELECT clave FROM sucursal s WHERE s.id = t.sucursal_id) NULLS FIRST, (SELECT clave FROM articulo a WHERE a.id = t.articulo_id)",
  notas: ["Las piezas son piezas BUENAS (lo que se quiere vender); el sistema agrega las mermas de la receta.", "Para quitar un producto del plan escribe 0 en PIEZAS."],
  campos: [
    { nombre: "FECHA", columna: "fecha", tipo: "fecha", obligatorio: true, ejemplo: "01/12/2026", descripcion: "Día de producción." },
    { nombre: "TURNO", columna: "turno_id", tipo: "ref", ref: { tabla: "turno_produccion", etiqueta: "El turno" }, ejemplo: "", descripcion: "Turno (vacío = todo el día)." },
    { nombre: "SUCURSAL", columna: "sucursal_id", tipo: "ref", ref: { tabla: "sucursal", etiqueta: "La sucursal" }, ejemplo: "", descripcion: "Sucursal a la que se destina (vacía = general)." },
    { nombre: "SKU", columna: "articulo_id", tipo: "ref", ref: ARTICULO("El producto", ["SKU"]), obligatorio: true, ejemplo: "PRUEBA-CONCHA-V", descripcion: "Clave del producto." },
    { nombre: "PIEZAS", columna: "piezas", tipo: "decimal", obligatorio: true, minimo: 0, decimales: 4, ejemplo: "120", descripcion: "Piezas buenas a producir (o kg si se vende a granel)." },
  ],
  async preparar(c, filas) {
    const hoy = await hoyNegocio(c);
    const planes = (await c.query(
      `SELECT p.fecha::text AS fecha, coalesce(p.turno_id::text, '') AS turno, coalesce(p.sucursal_id::text, '') AS suc, p.estatus, p.folio
         FROM plan_produccion p WHERE p.estatus <> 'CANCELADO' AND p.fecha = ANY($1::date[])`,
      [[...new Set(filas.map((f) => f.valores.FECHA).filter(Boolean))]],
    )).rows;
    const ids = [...new Set(filas.map((f) => f.valores.SKU).filter(Boolean))];
    const skus = new Map((await c.query(
      `SELECT a.id::text, a.clave, u.magnitud,
              (SELECT array_agg(r.vigente_desde::text) FROM receta r WHERE r.articulo_id = a.id AND r.estatus = 'ACTIVA') AS vigencias
         FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id WHERE a.id = ANY($1::uuid[])`,
      [ids],
    )).rows.map((r) => [r.id as string, r]));
    return { hoy, planes, skus };
  },
  validar(f, ayuda) {
    const { hoy, planes, skus } = ayuda.datos;
    const fecha = f.valores.FECHA as string;
    if (fecha < hoy) ayuda.error("FECHA", "No se planea una fecha pasada.");
    const plan = planes.find((p: any) => p.fecha === fecha && p.turno === (f.valores.TURNO ?? "") && p.suc === (f.valores.SUCURSAL ?? ""));
    if (plan && plan.estatus !== "BORRADOR") ayuda.error("FECHA", `El plan ${plan.folio} ya está ${plan.estatus.toLowerCase()}: no se modifica.`);
    const sku = skus.get(f.valores.SKU as string);
    if (!sku) return;
    const piezas = f.valores.PIEZAS;
    if (sku.magnitud === "PIEZA" && piezas !== undefined && !new Decimal(String(piezas)).isInteger()) ayuda.error("PIEZAS", `${sku.clave} se vende por pieza: escribe piezas enteras.`);
    if (!(sku.vigencias ?? []).some((v: string) => v <= fecha)) ayuda.advertencia("SKU", `${sku.clave} no tiene receta activa para esa fecha: no se podrá explotar ni aprobar el plan.`);
  },
};

export const LAYOUTS_PRODUCCION: Layout[] = [etapas, turnos, tarifasMod, tasasGif, recetasIntermedios, formulasIntermedios, recetasSku, componentesSku, etapasReceta, planProduccion];
