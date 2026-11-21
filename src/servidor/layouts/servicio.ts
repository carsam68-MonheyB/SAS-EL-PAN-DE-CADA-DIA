// Servicio de cargas: permisos por layout, simulación, aplicación y autorización.
import { ErrorApp, invalido, noEncontrado, prohibido } from "../errores";
import type { Cliente } from "../transaccion";
import { ErrorArchivo, escribirDelimitado, leerArchivo, type Formato, type TablaLeida } from "./archivos";
import { buscarLayout } from "./definiciones";
import { aplicarCarga, validarCarga, type Modo, type ResultadoValidacion } from "./motor";
import type { Layout } from "./tipos";

export const BYTES_MAXIMOS = 4 * 1024 * 1024;

export interface PermisosLayout {
  ver: boolean;
  crear: boolean;
  editar: boolean;
  importar: boolean;
  exportar: boolean;
  autorizar: boolean;
}

const alguno = (permisos: ReadonlySet<string>, lista: string[] | undefined) => !!lista?.some((p) => permisos.has(p));

export function permisosDeLayout(layout: Layout, permisos: ReadonlySet<string>): PermisosLayout {
  const crear = alguno(permisos, layout.permisos.crear);
  const editar = alguno(permisos, layout.permisos.editar);
  const importar = permisos.has("cargas.layout:importar") && (crear || editar);
  return {
    ver: alguno(permisos, layout.permisos.ver) || crear || editar,
    crear,
    editar,
    importar,
    // Se puede exportar con el permiso de exportar, o para editar y volver a subir.
    exportar: alguno(permisos, layout.permisos.exportar) || (editar && importar),
    autorizar: !!layout.autorizacion && permisos.has(layout.autorizacion.permiso),
  };
}

export function obtenerLayout(clave: string, permisos: ReadonlySet<string>, necesita: keyof PermisosLayout): { layout: Layout; puede: PermisosLayout } {
  const layout = buscarLayout(clave);
  if (!layout) throw noEncontrado("No existe ese layout.");
  const puede = permisosDeLayout(layout, permisos);
  if (!puede.ver || !puede[necesita]) throw prohibido();
  return { layout, puede };
}

export function exigirModo(puede: PermisosLayout, modo: Modo) {
  if ((modo === "alta" || modo === "ambos") && !puede.crear) throw prohibido("No tienes permiso para dar de alta en este catálogo.");
  if ((modo === "actualizacion" || modo === "ambos") && !puede.editar) throw prohibido("No tienes permiso para modificar este catálogo.");
}

async function leer(bytes: Uint8Array, nombre: string): Promise<TablaLeida> {
  try {
    return await leerArchivo(bytes, nombre);
  } catch (e) {
    if (e instanceof ErrorArchivo) throw invalido(e.message);
    throw e;
  }
}

function resumen(r: ResultadoValidacion) {
  return { renglones: r.renglones, altas: r.altas, actualizaciones: r.actualizaciones, sin_cambios: r.sinCambios, errores: r.errores, advertencias: r.advertencias, detalle: r.mensajes };
}

async function guardarResultado(c: Cliente, id: string, r: ResultadoValidacion, estatus: string) {
  await c.query(
    `UPDATE carga_layout SET renglones = $2, altas = $3, actualizaciones = $4, errores = $5, advertencias = $6, detalle = $7, estatus = $8 WHERE id = $1`,
    [id, r.renglones, r.altas, r.actualizaciones, r.errores, r.advertencias, JSON.stringify(r.mensajes), estatus],
  );
}

/** Valida el archivo (sin tocar los catálogos) y registra la carga en la bitácora. */
export async function simular(c: Cliente, usuarioId: string, permisos: ReadonlySet<string>, d: { layout: string; modo: Modo; nombre: string; bytes: Uint8Array; formato?: "pantalla" }) {
  const { layout, puede } = obtenerLayout(d.layout, permisos, "ver");
  if (d.formato !== "pantalla" && !puede.importar) throw prohibido("No tienes permiso para cargar este layout.");
  exigirModo(puede, d.modo);
  if (d.bytes.length > BYTES_MAXIMOS) throw invalido("El archivo pesa más de 4 MB. Divídelo en varios.");
  const tabla = await leer(d.bytes, d.formato === "pantalla" ? "captura.txt" : d.nombre);
  const r = await validarCarga(c, layout, tabla, d.modo, permisos);
  const { rows } = await c.query(
    `INSERT INTO carga_layout (layout, modo, formato, nombre_archivo, codificacion, usuario_id, estatus)
     VALUES ($1, $2, $3, $4, $5, $6, 'validada') RETURNING id`,
    [layout.clave, d.modo, d.formato ?? (tabla.formato as Formato), d.nombre.slice(0, 200), tabla.codificacion, usuarioId],
  );
  const id = rows[0].id as string;
  await c.query("INSERT INTO carga_archivo (carga_id, contenido) VALUES ($1, $2)", [id, Buffer.from(d.bytes)]);
  await guardarResultado(c, id, r, r.errores ? "con_errores" : "validada");
  return { id, layout: layout.clave, requiere_autorizacion: !!layout.autorizacion, ...resumen(r) };
}

export async function cargarCarga(c: Cliente, id: string, bloquear = false) {
  const { rows } = await c.query(`SELECT * FROM carga_layout WHERE id = $1 ${bloquear ? "FOR UPDATE" : ""}`, [id]);
  if (!rows[0]) throw noEncontrado("No existe esa carga.");
  return rows[0];
}

async function revalidar(c: Cliente, carga: any, permisos: ReadonlySet<string>) {
  const layout = buscarLayout(carga.layout)!;
  const archivo = (await c.query("SELECT contenido FROM carga_archivo WHERE carga_id = $1", [carga.id])).rows[0].contenido as Buffer;
  const nombre = carga.formato === "pantalla" ? "captura.txt" : carga.nombre_archivo;
  const tabla = await leer(new Uint8Array(archivo), nombre);
  return { layout, tabla, r: await validarCarga(c, layout, tabla, carga.modo, permisos) };
}

/**
 * Confirma una carga validada: se valida de nuevo contra los datos actuales y
 * se aplica completa en esta transacción, o queda pendiente de autorización.
 */
export async function aplicar(c: Cliente, usuarioId: string, permisos: ReadonlySet<string>, id: string) {
  const carga = await cargarCarga(c, id, true);
  if (carga.usuario_id !== usuarioId) throw prohibido("Solo quien subió la carga puede confirmarla.");
  if (carga.estatus !== "validada") throw new ErrorApp(409, "estatus", `La carga está "${carga.estatus}": no se puede aplicar.`);
  const { puede } = obtenerLayout(carga.layout, permisos, "ver");
  exigirModo(puede, carga.modo);
  const { layout, r } = await revalidar(c, carga, permisos);
  if (r.errores) {
    await guardarResultado(c, id, r, "con_errores");
    return { id, estatus: "con_errores", ...resumen(r) };
  }
  if (layout.autorizacion) {
    await guardarResultado(c, id, r, "pendiente_autorizacion");
    return { id, estatus: "pendiente_autorizacion", ...resumen(r) };
  }
  await aplicarCarga(c, layout, r, id);
  await guardarResultado(c, id, r, "aplicada");
  await c.query("UPDATE carga_layout SET aplicado_por = $2, aplicado_en = now() WHERE id = $1", [id, usuarioId]);
  return { id, estatus: "aplicada", ...resumen(r) };
}

/** Autoriza y aplica (o rechaza) una carga pendiente. Quien autoriza no puede ser quien la subió. */
export async function resolverAutorizacion(c: Cliente, usuarioId: string, permisos: ReadonlySet<string>, id: string, decision: "autorizar" | "rechazar", motivo?: string) {
  const carga = await cargarCarga(c, id, true);
  const layout = buscarLayout(carga.layout)!;
  if (!layout.autorizacion || !permisos.has(layout.autorizacion.permiso)) throw prohibido("No tienes permiso para autorizar esta carga.");
  if (carga.estatus !== "pendiente_autorizacion") throw new ErrorApp(409, "estatus", `La carga está "${carga.estatus}": no está pendiente de autorización.`);
  if (carga.usuario_id === usuarioId) throw prohibido("No puedes autorizar una carga que tú subiste (segregación de funciones).");
  if (decision === "rechazar") {
    if (!motivo?.trim()) throw invalido("Escribe el motivo del rechazo.");
    await c.query("UPDATE carga_layout SET estatus = 'rechazada', motivo_rechazo = $2, autorizado_por = $3, autorizado_en = now() WHERE id = $1", [id, motivo.trim(), usuarioId]);
    return { id, estatus: "rechazada" };
  }
  const { r } = await revalidar(c, carga, permisos);
  if (r.errores) {
    await guardarResultado(c, id, r, "con_errores");
    return { id, estatus: "con_errores", ...resumen(r) };
  }
  await aplicarCarga(c, layout, r, id);
  await guardarResultado(c, id, r, "aplicada");
  await c.query("UPDATE carga_layout SET autorizado_por = $2, autorizado_en = now(), aplicado_por = $2, aplicado_en = now() WHERE id = $1", [id, usuarioId]);
  return { id, estatus: "aplicada", ...resumen(r) };
}

/**
 * Alta o cambio de UN registro desde la pantalla. Usa exactamente la misma
 * validación que el layout. Si el catálogo requiere autorización (precios),
 * queda como carga pendiente.
 */
export async function guardarRegistro(c: Cliente, usuarioId: string, permisos: ReadonlySet<string>, clave: string, modo: "alta" | "actualizacion", valores: Record<string, string>) {
  const { layout, puede } = obtenerLayout(clave, permisos, "ver");
  exigirModo(puede, modo);
  const encabezados = Object.keys(valores);
  const bytes = escribirDelimitado(encabezados, [encabezados.map((k) => valores[k] ?? "")], "txt");
  if (layout.autorizacion) {
    const s = await simular(c, usuarioId, permisos, { layout: clave, modo, nombre: "Captura en pantalla", bytes, formato: "pantalla" });
    if (s.errores) return { ok: false as const, ...s };
    return { ok: true as const, ...(await aplicar(c, usuarioId, permisos, s.id)) };
  }
  const tabla = await leer(bytes, "captura.txt");
  const r = await validarCarga(c, layout, tabla, modo, permisos);
  if (r.errores) return { ok: false as const, ...resumen(r) };
  await aplicarCarga(c, layout, r, null);
  return { ok: true as const, estatus: "aplicada", ...resumen(r) };
}
