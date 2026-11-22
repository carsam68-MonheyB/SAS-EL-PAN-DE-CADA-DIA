// Compras: motor genérico de autorizaciones (por permiso y límite de monto),
// requisiciones, órdenes de compra, recepción con entrada al inventario,
// facturas XML con cotejo a 3 vías, cuentas por pagar y pagos autorizados.
import { dentroDeAlcanceAlmacen } from "../dominio/permisos";
import { cotejar, importeOC } from "../dominio/compras";
import { D, type Dec } from "../dominio/recetas";
import { factorConversion } from "../dominio/unidades";
import { leerCfdi } from "./cfdi";
import { ErrorApp, invalido, noEncontrado, prohibido } from "./errores";
import { hoyNegocio } from "./fechas";
import { entradaPorRecepcion } from "./inventarios";
import { leerUnidades } from "./recetas";
import type { Cliente } from "./transaccion";
import type { UsuarioActual } from "./usuarios";

const m2 = (x: Dec | string | number) => new D(x).toFixed(2);
const r2 = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP);
const dec = (v: string, nombre: string) => {
  let d: Dec;
  try { d = new D(String(v).replaceAll(",", "")); } catch { throw invalido(`${nombre}: número no válido.`); }
  if (!d.isFinite()) throw invalido(`${nombre}: número no válido.`);
  return d;
};
const config = async (c: Cliente, clave: string) => (await c.query("SELECT valor FROM configuracion WHERE clave = $1", [clave])).rows[0]?.valor as string | undefined;

// ---------------------------------------------------------------------------
// Motor de autorizaciones
// ---------------------------------------------------------------------------
type TipoDoc = "REQUISICION" | "ORDEN_COMPRA" | "FACTURA" | "PAGO";
const REGLAS: Record<TipoDoc, { permiso: string; operacion: string | null; nombre: string }> = {
  REQUISICION: { permiso: "compras.requisiciones:autorizar", operacion: "compras.requisicion", nombre: "Requisición" },
  ORDEN_COMPRA: { permiso: "compras.requisiciones:autorizar", operacion: "compras.requisicion", nombre: "Orden de compra (rebasa lo autorizado)" },
  FACTURA: { permiso: "compras.facturas:autorizar", operacion: null, nombre: "Factura con diferencias en el cotejo" },
  PAGO: { permiso: "compras.cxp:autorizar", operacion: "compras.pago", nombre: "Pago a proveedor" },
};

/** Límite del usuario para una operación: undefined = sin límite configurado para ella; null = sin tope; número = tope. */
async function limiteDe(c: Cliente, usuarioId: string, operacion: string | null): Promise<{ aplica: boolean; tope: Dec | null }> {
  if (!operacion) return { aplica: false, tope: null };
  const todas = (await c.query("SELECT count(*)::int AS n FROM limite_autorizacion WHERE operacion = $1", [operacion])).rows[0].n;
  if (!todas) return { aplica: false, tope: null };
  const { rows } = await c.query(
    "SELECT l.monto_hasta::text FROM limite_autorizacion l JOIN usuario_rol ur ON ur.rol_id = l.rol_id JOIN rol r ON r.id = l.rol_id AND r.activo WHERE ur.usuario_id = $1 AND l.operacion = $2",
    [usuarioId, operacion],
  );
  if (!rows.length) return { aplica: true, tope: new D(0) };
  if (rows.some((r) => r.monto_hasta === null)) return { aplica: true, tope: null };
  return { aplica: true, tope: rows.reduce((m, r) => D.max(m, new D(r.monto_hasta)), new D(0)) };
}

async function solicitar(c: Cliente, tipo: TipoDoc, documentoId: string, folio: string, monto: Dec, solicitanteId: string) {
  const r = REGLAS[tipo];
  await c.query(
    "INSERT INTO solicitud_autorizacion (tipo_documento, documento_id, folio, monto, permiso, operacion, solicitante_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [tipo, documentoId, folio, m2(monto), r.permiso, r.operacion, solicitanteId],
  );
}

async function cancelarSolicitud(c: Cliente, tipo: TipoDoc, documentoId: string, motivo: string) {
  await c.query("UPDATE solicitud_autorizacion SET estatus = 'CANCELADA', motivo = $3 WHERE tipo_documento = $1 AND documento_id = $2 AND estatus = 'PENDIENTE'", [tipo, documentoId, motivo]);
}

/** Solicitudes pendientes que este usuario puede firmar (permiso, límite y no ser el solicitante). */
export async function pendientes(c: Cliente, u: UsuarioActual) {
  const { rows } = await c.query(
    `SELECT s.id, s.tipo_documento, s.documento_id, s.folio, s.monto::text, s.creado_en, us.usuario AS solicitante, s.solicitante_id, s.permiso, s.operacion
       FROM solicitud_autorizacion s JOIN usuario us ON us.id = s.solicitante_id WHERE s.estatus = 'PENDIENTE' ORDER BY s.creado_en`,
  );
  const out = [];
  for (const s of rows) {
    if (!u.permisos.has(s.permiso)) continue;
    const lim = await limiteDe(c, u.id, s.operacion);
    const cubre = !lim.aplica || lim.tope === null || new D(s.monto).lte(lim.tope);
    out.push({ ...s, nombre: REGLAS[s.tipo_documento as TipoDoc].nombre, propia: s.solicitante_id === u.id, cubre, limite: lim.tope?.toFixed(2) ?? null });
  }
  return out;
}

export async function resolver(c: Cliente, u: UsuarioActual, solicitudId: string, decision: "AUTORIZA" | "RECHAZA", comentario: string | null) {
  const s = (await c.query("SELECT * FROM solicitud_autorizacion WHERE id = $1 FOR UPDATE", [solicitudId])).rows[0];
  if (!s) throw noEncontrado("No existe esa solicitud.");
  if (s.estatus !== "PENDIENTE") throw new ErrorApp(409, "estatus", "La solicitud ya se resolvió.");
  if (!u.permisos.has(s.permiso)) throw prohibido("No tienes permiso para autorizar esta solicitud.");
  if (s.solicitante_id === u.id) throw prohibido("Quien solicita no puede autorizar su propia solicitud (segregación de funciones).");
  if (decision === "RECHAZA" && !comentario?.trim()) throw invalido("Escribe el motivo del rechazo.");
  if (s.tipo_documento === "PAGO" && decision === "AUTORIZA") {
    // Quien recibió la mercancía no autoriza su pago.
    const recibio = (await c.query(
      `SELECT 1 FROM pago_aplicacion pa JOIN cxp_documento x ON x.id = pa.cxp_id JOIN factura_proveedor f ON f.id = x.factura_id
         JOIN recepcion r ON r.oc_id = f.oc_id WHERE pa.pago_id = $1 AND r.recibio_id = $2 LIMIT 1`,
      [s.documento_id, u.id],
    )).rowCount;
    if (recibio) throw prohibido("Recibiste mercancía de estas facturas: no puedes autorizar su pago (segregación de funciones).");
  }
  const lim = await limiteDe(c, u.id, s.operacion);
  if (decision === "AUTORIZA" && lim.aplica && lim.tope !== null && new D(s.monto).gt(lim.tope)) {
    throw prohibido(`Son $${m2(s.monto)} y tu límite de autorización es $${m2(lim.tope)}: debe autorizar alguien con un límite mayor.`);
  }
  await c.query("INSERT INTO firma_autorizacion (solicitud_id, usuario_id, decision, comentario, limite) VALUES ($1, $2, $3, $4, $5)",
    [s.id, u.id, decision, comentario, lim.tope?.toFixed(2) ?? null]);
  await c.query("UPDATE solicitud_autorizacion SET estatus = $2, motivo = $3 WHERE id = $1", [s.id, decision === "AUTORIZA" ? "AUTORIZADA" : "RECHAZADA", comentario]);
  const ok = decision === "AUTORIZA";
  switch (s.tipo_documento as TipoDoc) {
    case "REQUISICION":
      await c.query("UPDATE requisicion SET estatus = $2, comentario = CASE WHEN $3::text IS NULL THEN comentario ELSE coalesce(comentario || ' · ', '') || $3 END WHERE id = $1",
        [s.documento_id, ok ? "AUTORIZADA" : "RECHAZADA", ok ? null : `Rechazada: ${comentario}`]);
      break;
    case "ORDEN_COMPRA":
      if (ok) await c.query("UPDATE orden_compra SET estatus = 'EMITIDA' WHERE id = $1", [s.documento_id]);
      else await liberarOC(c, s.documento_id, "RECHAZADA", comentario);
      break;
    case "FACTURA":
      await c.query("UPDATE factura_proveedor SET estatus = $2 WHERE id = $1", [s.documento_id, ok ? "AUTORIZADA" : "RECHAZADA"]);
      if (ok) await crearCxp(c, s.documento_id);
      break;
    case "PAGO":
      await c.query("UPDATE pago_proveedor SET estatus = $2, comentario = CASE WHEN $3::text IS NULL THEN comentario ELSE coalesce(comentario || ' · ', '') || $3 END WHERE id = $1",
        [s.documento_id, ok ? "AUTORIZADO" : "RECHAZADO", ok ? null : `Rechazado: ${comentario}`]);
      break;
  }
  return { folio: s.folio, estatus: ok ? "AUTORIZADA" : "RECHAZADA" };
}

// ---------------------------------------------------------------------------
// Requisiciones
// ---------------------------------------------------------------------------
interface ArtCompra { id: string; clave: string; nombre: string; tipo: string; unidad: string; unidad_id: string; costo: string | null; tasa_iva: string | null; tasa_iva_clave: string | null }
async function articulosCompra(c: Cliente, claves: string[]) {
  const { rows } = await c.query(
    `SELECT a.id, a.clave, a.nombre, a.tipo, u.clave AS unidad, u.id AS unidad_id, a.costo_referencia::text AS costo, t.tasa::text AS tasa_iva, t.clave AS tasa_iva_clave
       FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id LEFT JOIN tasa_impuesto t ON t.id = a.tasa_iva_id
      WHERE a.clave = ANY($1) AND a.activo AND a.tipo IN ('INSUMO', 'EMPAQUE')`,
    [claves.map((x) => x.toUpperCase())],
  );
  const m = new Map<string, ArtCompra>(rows.map((r) => [r.clave, r]));
  const faltan = [...new Set(claves.map((x) => x.toUpperCase()))].filter((x) => !m.has(x));
  if (faltan.length) throw invalido(`No es un insumo o empaque activo: ${faltan.join(", ")}.`);
  return m;
}

async function aBase(c: Cliente, art: { clave: string; unidad: string }, cantidad: Dec, unidad: string | null | undefined) {
  if (!unidad || unidad.toUpperCase() === art.unidad) return { base: cantidad, factor: new D(1) };
  const u = await leerUnidades(c);
  const f = factorConversion(unidad.toUpperCase(), art.unidad, { base: art.unidad, propias: u.propias.get(art.clave) ?? [] }, u.generales);
  if (!f) throw invalido(`${art.clave}: no hay conversión de ${unidad.toUpperCase()} a ${art.unidad}.`);
  return { base: cantidad.mul(f).toDecimalPlaces(6, D.ROUND_HALF_UP), factor: new D(f) };
}

/** Monto estimado de una requisición: Σ cantidad base × costo de referencia (sin IVA). */
async function estimarRequisicion(c: Cliente, id: string) {
  await c.query(
    `UPDATE requisicion_renglon rr SET costo_estimado = coalesce(rr.costo_estimado, a.costo_referencia, 0)
       FROM articulo a WHERE a.id = rr.articulo_id AND rr.requisicion_id = $1`,
    [id],
  );
  const monto = (await c.query("SELECT coalesce(sum(cantidad * costo_estimado), 0)::text AS m FROM requisicion_renglon WHERE requisicion_id = $1", [id])).rows[0].m;
  await c.query("UPDATE requisicion SET monto_estimado = $2 WHERE id = $1", [id, m2(r2(new D(monto)))]);
  return r2(new D(monto));
}

export async function crearRequisicion(c: Cliente, u: UsuarioActual, d: { requerido_para?: string | null; comentario?: string | null; sucursal?: string | null; enviar?: boolean; renglones: { articulo: string; cantidad: string; unidad?: string | null; comentario?: string | null }[] }) {
  if (!d.renglones.length) throw invalido("Captura al menos un insumo.");
  const arts = await articulosCompra(c, d.renglones.map((r) => r.articulo));
  let sucursalId: string | null = null;
  if (d.sucursal) {
    sucursalId = (await c.query("SELECT id FROM sucursal WHERE clave = upper($1) AND activo", [d.sucursal])).rows[0]?.id ?? null;
    if (!sucursalId) throw invalido(`No existe la sucursal ${d.sucursal}.`);
  }
  const req = (await c.query(
    "INSERT INTO requisicion (origen, solicitante_id, requerido_para, comentario, sucursal_id) VALUES ('MANUAL', $1, $2, $3, $4) RETURNING id, folio",
    [u.id, d.requerido_para ?? null, d.comentario ?? null, sucursalId],
  )).rows[0];
  const vistos = new Set<string>();
  for (const r of d.renglones) {
    const a = arts.get(r.articulo.toUpperCase())!;
    if (vistos.has(a.clave)) throw invalido(`${a.clave} está repetido: júntalo en un solo renglón.`);
    vistos.add(a.clave);
    const cantidad = dec(r.cantidad, a.clave);
    if (cantidad.lte(0)) throw invalido(`${a.clave}: la cantidad debe ser mayor que cero.`);
    const { base } = await aBase(c, a, cantidad, r.unidad);
    await c.query("INSERT INTO requisicion_renglon (requisicion_id, articulo_id, cantidad, unidad_id, comentario) VALUES ($1, $2, $3, $4, $5)",
      [req.id, a.id, base.toFixed(), a.unidad_id, r.comentario ?? null]);
  }
  const monto = await estimarRequisicion(c, req.id);
  if (d.enviar) await enviarRequisicion(c, u, req.id);
  return { ...req, monto_estimado: m2(monto) };
}

async function requisicionBloqueada(c: Cliente, id: string) {
  const r = (await c.query("SELECT * FROM requisicion WHERE id::text = $1 OR folio = upper($1) FOR UPDATE", [id])).rows[0];
  if (!r) throw noEncontrado("No existe esa requisición.");
  return r;
}

export async function enviarRequisicion(c: Cliente, u: UsuarioActual, id: string) {
  const r = await requisicionBloqueada(c, id);
  if (r.estatus !== "BORRADOR") throw new ErrorApp(409, "estatus", "Solo se envía una requisición en borrador.");
  if (r.solicitante_id !== u.id && !u.permisos.has("compras.requisiciones:editar")) throw prohibido("Solo quien la solicitó (o compras) la envía a autorización.");
  const monto = await estimarRequisicion(c, r.id);
  if (monto.lte(0)) throw invalido("La requisición no tiene monto estimado: revisa el costo de referencia de los insumos.");
  await c.query("UPDATE requisicion SET estatus = 'ENVIADA' WHERE id = $1", [r.id]);
  await solicitar(c, "REQUISICION", r.id, r.folio, monto, r.solicitante_id);
  return { folio: r.folio, monto_estimado: m2(monto) };
}

export async function cancelarRequisicion(c: Cliente, u: UsuarioActual, id: string, motivo: string) {
  const r = await requisicionBloqueada(c, id);
  if (!["BORRADOR", "ENVIADA", "AUTORIZADA", "RECHAZADA"].includes(r.estatus)) throw new ErrorApp(409, "estatus", "La requisición ya está ordenada o cancelada.");
  if (!(u.permisos.has("compras.requisiciones:cancelar") || (r.solicitante_id === u.id && r.estatus === "BORRADOR"))) throw prohibido("No tienes permiso para cancelar esta requisición.");
  const ordenado = (await c.query("SELECT coalesce(sum(cantidad_ordenada), 0)::text AS o FROM requisicion_renglon WHERE requisicion_id = $1", [r.id])).rows[0].o;
  if (new D(ordenado).gt(0)) throw new ErrorApp(409, "regla", "Ya hay órdenes de compra de esta requisición: cancela primero esas órdenes.");
  await c.query("UPDATE requisicion SET estatus = 'CANCELADA', comentario = coalesce(comentario || ' · ', '') || $2 WHERE id = $1", [r.id, `Cancelada: ${motivo}`]);
  await cancelarSolicitud(c, "REQUISICION", r.id, motivo);
  return { folio: r.folio };
}

// ---------------------------------------------------------------------------
// Órdenes de compra
// ---------------------------------------------------------------------------
export async function crearOC(c: Cliente, u: UsuarioActual, d: {
  requisicion: string; proveedor: string; almacen: string; fecha_entrega: string; condiciones?: string | null; comentario?: string | null;
  renglones: { requisicion_renglon_id: string; cantidad: string; unidad?: string | null; precio: string; tasa_iva: string }[];
}) {
  const req = await requisicionBloqueada(c, d.requisicion);
  if (!["AUTORIZADA", "ORDENADA"].includes(req.estatus)) throw new ErrorApp(409, "regla", "Solo se ordena lo de una requisición autorizada.");
  const prov = (await c.query("SELECT id, clave FROM proveedor WHERE clave = upper($1) AND activo", [d.proveedor])).rows[0];
  if (!prov) throw invalido(`No existe el proveedor ${d.proveedor}.`);
  const alm = (await c.query("SELECT id, tipo FROM almacen WHERE clave = upper($1) AND activo", [d.almacen])).rows[0];
  if (!alm || !["MP", "INS"].includes(alm.tipo)) throw invalido("La mercancía se recibe en un almacén de materia prima o de insumos.");
  if (d.fecha_entrega < await hoyNegocio(c)) throw invalido("La fecha de entrega no puede ser anterior a hoy.");
  if (!d.renglones.length) throw invalido("La orden no tiene renglones.");
  const tasas = new Map((await c.query("SELECT clave, tasa::text, tipo_factor FROM tasa_impuesto WHERE impuesto = 'IVA' AND activo")).rows.map((t) => [t.clave, t.tipo_factor === "Exento" ? "0" : t.tasa]));
  const rs = (await c.query(
    `SELECT rr.id, rr.articulo_id, rr.cantidad::text, rr.cantidad_ordenada::text, rr.costo_estimado::text, a.clave, a.nombre, u.clave AS unidad
       FROM requisicion_renglon rr JOIN articulo a ON a.id = rr.articulo_id JOIN unidad u ON u.id = a.unidad_base_id WHERE rr.requisicion_id = $1 FOR UPDATE OF rr`,
    [req.id],
  )).rows;
  let subtotal = new D(0), iva = new D(0), autorizado = new D(0);
  const lineas = [];
  for (const [i, x] of d.renglones.entries()) {
    const rr = rs.find((r) => r.id === x.requisicion_renglon_id);
    if (!rr) throw invalido(`El renglón ${i + 1} no es de la requisición ${req.folio}.`);
    const cantidad = dec(x.cantidad, rr.clave);
    if (cantidad.lte(0)) throw invalido(`${rr.clave}: la cantidad debe ser mayor que cero.`);
    const precio = dec(x.precio, `${rr.clave} precio`);
    const tasa = tasas.get(x.tasa_iva?.toUpperCase());
    if (tasa === undefined) throw invalido(`${rr.clave}: elige una tasa de IVA del catálogo.`);
    const { base, factor } = await aBase(c, rr, cantidad, x.unidad);
    const pendiente = new D(rr.cantidad).minus(rr.cantidad_ordenada);
    if (base.gt(pendiente)) throw invalido(`${rr.clave}: se ordenarían ${base.toFixed()} ${rr.unidad} y en la requisición quedan ${pendiente.toFixed()} por ordenar.`);
    const im = importeOC(cantidad, precio, new D(tasa));
    subtotal = subtotal.plus(im.importe); iva = iva.plus(im.iva);
    autorizado = autorizado.plus(r2(base.mul(rr.costo_estimado ?? 0)));
    const unidadId = (await c.query("SELECT id FROM unidad WHERE clave = $1", [(x.unidad || rr.unidad).toUpperCase()])).rows[0]?.id;
    lineas.push({ orden: i + 1, rr, cantidad, unidadId, factor, precio, tasa, im, base });
  }
  const tol = new D((await config(c, "compras.tolerancia_oc_pct")) ?? "0");
  const excede = subtotal.gt(autorizado.mul(tol.div(100).plus(1)));
  const total = subtotal.plus(iva);
  const oc = (await c.query(
    `INSERT INTO orden_compra (proveedor_id, requisicion_id, almacen_id, fecha_entrega, estatus, subtotal, iva, total, autorizado_requisicion, condiciones, comentario, creado_por_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, folio`,
    [prov.id, req.id, alm.id, d.fecha_entrega, excede ? "POR_AUTORIZAR" : "EMITIDA", m2(subtotal), m2(iva), m2(total), m2(autorizado), d.condiciones ?? null, d.comentario ?? null, u.id],
  )).rows[0];
  for (const l of lineas) {
    await c.query(
      `INSERT INTO oc_renglon (oc_id, orden, requisicion_renglon_id, articulo_id, cantidad, unidad_id, factor_base, precio, tasa_iva, importe, iva)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [oc.id, l.orden, l.rr.id, l.rr.articulo_id, l.cantidad.toFixed(), l.unidadId, l.factor.toFixed(), l.precio.toFixed(), l.tasa, m2(l.im.importe), m2(l.im.iva)],
    );
    await c.query("UPDATE requisicion_renglon SET cantidad_ordenada = cantidad_ordenada + $2 WHERE id = $1", [l.rr.id, l.base.toFixed()]);
    // Último precio del proveedor (para el comparativo y la siguiente orden).
    await c.query(
      `INSERT INTO articulo_proveedor (articulo_id, proveedor_id, unidad_compra_id, ultimo_precio) VALUES ($1, $2, $3, $4)
       ON CONFLICT (articulo_id, proveedor_id) DO UPDATE SET unidad_compra_id = EXCLUDED.unidad_compra_id, ultimo_precio = EXCLUDED.ultimo_precio`,
      [l.rr.articulo_id, prov.id, l.unidadId, l.precio.toFixed()],
    );
  }
  const falta = (await c.query("SELECT count(*)::int AS n FROM requisicion_renglon WHERE requisicion_id = $1 AND cantidad_ordenada < cantidad", [req.id])).rows[0].n;
  if (!falta) await c.query("UPDATE requisicion SET estatus = 'ORDENADA' WHERE id = $1", [req.id]);
  if (excede) await solicitar(c, "ORDEN_COMPRA", oc.id, oc.folio, total, u.id);
  return { ...oc, estatus: excede ? "POR_AUTORIZAR" : "EMITIDA", subtotal: m2(subtotal), iva: m2(iva), total: m2(total), autorizado: m2(autorizado) };
}

/** Regresa a la requisición lo que una OC no recibió (al cancelar, cerrar o rechazar). */
async function liberarOC(c: Cliente, ocId: string, estatus: "CANCELADA" | "RECHAZADA" | "RECIBIDA", motivo: string | null) {
  const rs = (await c.query("SELECT requisicion_renglon_id, (cantidad - cantidad_recibida) * factor_base AS libre FROM oc_renglon WHERE oc_id = $1", [ocId])).rows;
  for (const r of rs) await c.query("UPDATE requisicion_renglon SET cantidad_ordenada = greatest(cantidad_ordenada - $2, 0) WHERE id = $1", [r.requisicion_renglon_id, r.libre]);
  const oc = (await c.query("UPDATE orden_compra SET estatus = $2, motivo_cancelacion = $3 WHERE id = $1 RETURNING requisicion_id", [ocId, estatus, motivo])).rows[0];
  await c.query("UPDATE requisicion SET estatus = 'AUTORIZADA' WHERE id = $1 AND estatus = 'ORDENADA' AND EXISTS (SELECT 1 FROM requisicion_renglon WHERE requisicion_id = $1 AND cantidad_ordenada < cantidad)", [oc.requisicion_id]);
}

export async function cancelarOC(c: Cliente, u: UsuarioActual, id: string, motivo: string) {
  const oc = (await c.query("SELECT * FROM orden_compra WHERE id::text = $1 OR folio = upper($1) FOR UPDATE", [id])).rows[0];
  if (!oc) throw noEncontrado("No existe esa orden de compra.");
  if (!["POR_AUTORIZAR", "EMITIDA", "PARCIAL"].includes(oc.estatus)) throw new ErrorApp(409, "estatus", "La orden ya está cerrada o cancelada.");
  const recibido = (await c.query("SELECT coalesce(sum(cantidad_recibida), 0)::text AS r FROM oc_renglon WHERE oc_id = $1", [oc.id])).rows[0].r;
  // Con algo recibido no se cancela: se cierra lo que falta.
  await liberarOC(c, oc.id, new D(recibido).gt(0) ? "RECIBIDA" : "CANCELADA", motivo);
  await cancelarSolicitud(c, "ORDEN_COMPRA", oc.id, motivo);
  return { folio: oc.folio, estatus: new D(recibido).gt(0) ? "RECIBIDA" : "CANCELADA" };
}

// ---------------------------------------------------------------------------
// Recepción
// ---------------------------------------------------------------------------
export async function recibir(c: Cliente, u: UsuarioActual, id: string, d: { remision?: string | null; comentario?: string | null; renglones: { oc_renglon_id: string; cantidad: string; lote?: string | null; caducidad?: string | null }[] }) {
  const oc = (await c.query("SELECT o.*, a.sucursal_id, p.clave AS proveedor FROM orden_compra o JOIN almacen a ON a.id = o.almacen_id JOIN proveedor p ON p.id = o.proveedor_id WHERE o.id::text = $1 OR o.folio = upper($1) FOR UPDATE OF o", [id])).rows[0];
  if (!oc) throw noEncontrado("No existe esa orden de compra.");
  if (!["EMITIDA", "PARCIAL"].includes(oc.estatus)) throw new ErrorApp(409, "estatus", oc.estatus === "POR_AUTORIZAR" ? "La orden de compra aún no está autorizada: no se puede recibir." : "La orden de compra ya no está abierta.");
  if (!dentroDeAlcanceAlmacen(u.alcance, oc.almacen_id, oc.sucursal_id)) throw prohibido("El almacén de la orden no está dentro de tus almacenes asignados.");
  const rs = new Map((await c.query("SELECT id, articulo_id, cantidad::text, cantidad_recibida::text, factor_base::text, precio::text FROM oc_renglon WHERE oc_id = $1 FOR UPDATE", [oc.id])).rows.map((r) => [r.id, r]));
  const partidas = [];
  const filas = [];
  for (const x of d.renglones) {
    const r = rs.get(x.oc_renglon_id);
    if (!r) throw invalido("Hay renglones que no son de esta orden de compra.");
    const cantidad = dec(x.cantidad, "Cantidad");
    if (cantidad.lte(0)) continue;
    const pendiente = new D(r.cantidad).minus(r.cantidad_recibida);
    if (cantidad.gt(pendiente)) throw invalido(`Se reciben ${cantidad.toFixed()} y la orden solo tiene ${pendiente.toFixed()} pendientes de ese renglón.`);
    const factor = new D(r.factor_base);
    partidas.push({ articulo_id: r.articulo_id, cantidad: cantidad.mul(factor).toDecimalPlaces(6, D.ROUND_HALF_UP), costo: new D(r.precio).div(factor).toDecimalPlaces(6, D.ROUND_HALF_UP), lote: x.lote?.trim() || null, caducidad: x.caducidad || null });
    filas.push({ r, cantidad, lote: x.lote?.trim() || null, caducidad: x.caducidad || null });
  }
  if (!filas.length) throw invalido("Indica qué se recibió.");
  const rec = (await c.query("SELECT gen_random_uuid() AS id, 'REC-' || lpad(nextval('recepcion_folio')::text, 6, '0') AS folio")).rows[0];
  const mov = await entradaPorRecepcion(c, u.id, oc.almacen_id, { recepcionId: rec.id, folio: rec.folio, proveedorId: oc.proveedor_id, oc: oc.folio, remision: d.remision ?? null }, partidas);
  await c.query("INSERT INTO recepcion (id, folio, oc_id, almacen_id, movimiento_id, remision, comentario, recibio_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [rec.id, rec.folio, oc.id, oc.almacen_id, mov.id, d.remision ?? null, d.comentario ?? null, u.id]);
  for (const f of filas) {
    await c.query("INSERT INTO recepcion_renglon (recepcion_id, oc_renglon_id, cantidad, lote, caducidad) VALUES ($1, $2, $3, $4, $5)", [rec.id, f.r.id, f.cantidad.toFixed(), f.lote, f.caducidad]);
    await c.query("UPDATE oc_renglon SET cantidad_recibida = cantidad_recibida + $2 WHERE id = $1", [f.r.id, f.cantidad.toFixed()]);
  }
  const falta = (await c.query("SELECT count(*)::int AS n FROM oc_renglon WHERE oc_id = $1 AND cantidad_recibida < cantidad", [oc.id])).rows[0].n;
  await c.query("UPDATE orden_compra SET estatus = $2 WHERE id = $1", [oc.id, falta ? "PARCIAL" : "RECIBIDA"]);
  return { folio: rec.folio, movimiento: mov.folio, oc: oc.folio, estatus: falta ? "PARCIAL" : "RECIBIDA" };
}

// ---------------------------------------------------------------------------
// Facturas y cotejo a 3 vías
// ---------------------------------------------------------------------------
async function prepararFactura(c: Cliente, ocId: string, xml: string, relaciones?: { orden: number; oc_renglon_id: string | null }[]) {
  const cfdi = leerCfdi(xml);
  const oc = (await c.query("SELECT o.*, p.rfc, p.clave AS proveedor, p.dias_credito FROM orden_compra o JOIN proveedor p ON p.id = o.proveedor_id WHERE o.id::text = $1 OR o.folio = upper($1)", [ocId])).rows[0];
  if (!oc) throw noEncontrado("No existe esa orden de compra.");
  if (["POR_AUTORIZAR", "CANCELADA", "RECHAZADA"].includes(oc.estatus)) throw new ErrorApp(409, "estatus", "La orden de compra no está vigente.");
  const errores: string[] = [];
  if (cfdi.tipo !== "I") errores.push(`El CFDI es de tipo ${cfdi.tipo}; aquí solo se registran facturas de ingreso (I).`);
  if (cfdi.moneda !== "MXN") errores.push(`La factura está en ${cfdi.moneda}; por ahora solo se aceptan pesos (MXN).`);
  if (cfdi.emisorRfc !== oc.rfc) errores.push(`El RFC emisor (${cfdi.emisorRfc}) no es el del proveedor de la orden (${oc.rfc}).`);
  const rfcEmpresa = ((await config(c, "empresa.rfc")) ?? "").trim().toUpperCase();
  if (rfcEmpresa && cfdi.receptorRfc !== rfcEmpresa) errores.push(`La factura no está a nombre de la empresa (receptor ${cfdi.receptorRfc}).`);
  const ya = (await c.query("SELECT f.id, o.folio FROM factura_proveedor f JOIN orden_compra o ON o.id = f.oc_id WHERE f.uuid_cfdi = $1", [cfdi.uuid])).rows[0];
  if (ya) errores.push(`Esa factura (UUID ${cfdi.uuid}) ya está registrada en la orden ${ya.folio}.`);
  if (errores.length) throw invalido("La factura no se puede registrar.", errores.map((mensaje) => ({ campo: "xml", mensaje })));
  const rs = (await c.query(
    `SELECT r.id, r.orden, r.precio::text, r.tasa_iva::text, r.cantidad_recibida::text, a.clave, a.nombre, ap.clave_proveedor,
            coalesce((SELECT sum(fc.cantidad) FROM factura_concepto fc JOIN factura_proveedor f ON f.id = fc.factura_id
                       WHERE fc.oc_renglon_id = r.id AND f.estatus NOT IN ('RECHAZADA', 'CANCELADA')), 0)::text AS facturado
       FROM oc_renglon r JOIN articulo a ON a.id = r.articulo_id LEFT JOIN articulo_proveedor ap ON ap.articulo_id = r.articulo_id AND ap.proveedor_id = $2
      WHERE r.oc_id = $1 ORDER BY r.orden`,
    [oc.id, oc.proveedor_id],
  )).rows;
  // Relación concepto → renglón: la que indique el usuario; si no, por clave del proveedor; si no, por orden.
  const rel = new Map((relaciones ?? []).map((r) => [r.orden, r.oc_renglon_id]));
  const conceptos = cfdi.conceptos.map((x, i) => {
    let id: string | null | undefined = rel.get(x.orden);
    if (id === undefined) id = rs.find((r) => r.clave_proveedor && r.clave_proveedor === x.noIdentificacion)?.id ?? (cfdi.conceptos.length === rs.length ? rs[i]!.id : rs.length === 1 ? rs[0]!.id : null);
    return { ...x, ocRenglonId: id ?? null };
  });
  const tol = {
    cantidadPct: new D((await config(c, "compras.tolerancia_cantidad_pct")) ?? "0"),
    precioPct: new D((await config(c, "compras.tolerancia_precio_pct")) ?? "0"),
    importe: new D((await config(c, "compras.tolerancia_importe")) ?? "0"),
  };
  const difs = cotejar(
    rs.map((r) => ({ id: r.id, descripcion: `${r.clave} ${r.nombre}`, precio: new D(r.precio), tasaIva: new D(r.tasa_iva), porFacturar: new D(r.cantidad_recibida).minus(r.facturado) })),
    conceptos, cfdi.total, tol,
  );
  return { cfdi, oc, rs, conceptos, difs, ok: difs.every((x) => x.dentro) };
}

const vistaFactura = (p: Awaited<ReturnType<typeof prepararFactura>>) => ({
  uuid: p.cfdi.uuid, serie: p.cfdi.serie, folio: p.cfdi.folio, fecha_local: p.cfdi.fecha.slice(0, 16).replace(/^(\d{4})-(\d{2})-(\d{2})T/, "$3/$2/$1 "), emisor: p.cfdi.emisorNombre, total: m2(p.cfdi.total), metodo_pago: p.cfdi.metodoPago,
  conceptos: p.conceptos.map((x) => ({ orden: x.orden, descripcion: x.descripcion, no_identificacion: x.noIdentificacion, cantidad: x.cantidad.toFixed(), valor_unitario: x.valorUnitario.toFixed(), importe: m2(x.importe), iva: m2(x.iva), oc_renglon_id: x.ocRenglonId })),
  renglones_oc: p.rs.map((r) => ({ id: r.id, orden: r.orden, articulo: r.clave, nombre: r.nombre, precio: r.precio, recibido: r.cantidad_recibida, facturado: r.facturado })),
  diferencias: p.difs.map((x) => ({ tipo: x.tipo, oc_renglon_id: x.ocRenglonId, esperado: x.esperado?.toFixed() ?? null, facturado: x.facturado?.toFixed() ?? null, dentro: x.dentro, descripcion: x.descripcion })),
  cotejo_ok: p.ok,
});

export async function revisarFactura(c: Cliente, ocId: string, xml: string, relaciones?: { orden: number; oc_renglon_id: string | null }[]) {
  return vistaFactura(await prepararFactura(c, ocId, xml, relaciones));
}

export async function registrarFactura(c: Cliente, u: UsuarioActual, ocId: string, xml: string, relaciones?: { orden: number; oc_renglon_id: string | null }[]) {
  const p = await prepararFactura(c, ocId, xml, relaciones);
  const f = (await c.query(
    `INSERT INTO factura_proveedor (uuid_cfdi, proveedor_id, oc_id, serie, folio, fecha, moneda, metodo_pago, forma_pago, subtotal, descuento, iva, ieps, retenciones, total, xml, estatus, registrado_por)
     VALUES ($1, $2, $3, $4, $5, ($6::timestamp AT TIME ZONE 'America/Mexico_City'), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
    // La fecha del CFDI viene en hora local de México, sin zona horaria.
    [p.cfdi.uuid, p.oc.proveedor_id, p.oc.id, p.cfdi.serie, p.cfdi.folio, p.cfdi.fecha.slice(0, 19), p.cfdi.moneda, p.cfdi.metodoPago, p.cfdi.formaPago, m2(p.cfdi.subtotal),
      m2(p.cfdi.descuento), m2(p.cfdi.iva), m2(p.cfdi.ieps), m2(p.cfdi.retenciones), m2(p.cfdi.total), xml, p.ok ? "COTEJADA" : "CON_DIFERENCIAS", u.id],
  )).rows[0];
  for (const x of p.conceptos) {
    await c.query(
      `INSERT INTO factura_concepto (factura_id, orden, descripcion, no_identificacion, clave_prod_serv, cantidad, valor_unitario, importe, descuento, iva, oc_renglon_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [f.id, x.orden, x.descripcion, x.noIdentificacion, x.claveProdServ, x.cantidad.toFixed(), x.valorUnitario.toFixed(), m2(x.importe), m2(x.descuento), m2(x.iva), x.ocRenglonId],
    );
  }
  for (const x of p.difs) {
    await c.query("INSERT INTO cotejo_diferencia (factura_id, oc_renglon_id, tipo, esperado, facturado, dentro_tolerancia, descripcion) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [f.id, x.ocRenglonId, x.tipo, x.esperado?.toFixed() ?? null, x.facturado?.toFixed() ?? null, x.dentro, x.descripcion]);
  }
  if (p.ok) await crearCxp(c, f.id);
  else await solicitar(c, "FACTURA", f.id, `${p.cfdi.serie ?? ""}${p.cfdi.folio ?? p.cfdi.uuid.slice(0, 8)}`, p.cfdi.total, u.id);
  return { id: f.id, estatus: p.ok ? "COTEJADA" : "CON_DIFERENCIAS", ...vistaFactura(p) };
}

async function crearCxp(c: Cliente, facturaId: string) {
  const f = (await c.query("SELECT f.id, f.proveedor_id, f.fecha, f.total, p.dias_credito FROM factura_proveedor f JOIN proveedor p ON p.id = f.proveedor_id WHERE f.id = $1", [facturaId])).rows[0];
  await c.query(
    `INSERT INTO cxp_documento (proveedor_id, factura_id, fecha, vencimiento, importe, saldo)
     VALUES ($1, $2, ($3::timestamptz)::date, ($3::timestamptz)::date + $4::int, $5, $5)`,
    [f.proveedor_id, f.id, f.fecha, f.dias_credito, f.total],
  );
}

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------
export async function programarPago(c: Cliente, u: UsuarioActual, d: { proveedor: string; cuenta?: string | null; forma: "01" | "02" | "03"; fecha_programada: string; comentario?: string | null; aplicaciones: { cxp_id: string; importe: string }[] }) {
  const prov = (await c.query("SELECT id, clave FROM proveedor WHERE clave = upper($1)", [d.proveedor])).rows[0];
  if (!prov) throw invalido(`No existe el proveedor ${d.proveedor}.`);
  let cuentaId: string | null = null;
  if (d.cuenta) {
    cuentaId = (await c.query("SELECT id FROM cuenta_bancaria WHERE clave = upper($1) AND activo", [d.cuenta])).rows[0]?.id ?? null;
    if (!cuentaId) throw invalido(`No existe la cuenta bancaria ${d.cuenta}.`);
  }
  if (!d.aplicaciones.length) throw invalido("Indica qué facturas se pagan.");
  let total = new D(0);
  const apps = [];
  for (const a of d.aplicaciones) {
    const x = (await c.query("SELECT id, proveedor_id, saldo::text, estatus FROM cxp_documento WHERE id = $1 FOR UPDATE", [a.cxp_id])).rows[0];
    if (!x || x.proveedor_id !== prov.id) throw invalido("Hay facturas que no son de este proveedor.");
    if (x.estatus !== "ABIERTO") throw invalido("Hay facturas que ya están pagadas o canceladas.");
    const importe = dec(a.importe, "Importe");
    if (importe.lte(0) || importe.decimalPlaces() > 2) throw invalido("Importe no válido.");
    // Lo ya comprometido en pagos programados o autorizados reduce lo que se puede pagar.
    const comprometido = (await c.query(
      "SELECT coalesce(sum(pa.importe), 0)::text AS i FROM pago_aplicacion pa JOIN pago_proveedor p ON p.id = pa.pago_id WHERE pa.cxp_id = $1 AND p.estatus IN ('POR_AUTORIZAR', 'AUTORIZADO')",
      [x.id],
    )).rows[0].i;
    const disponible = new D(x.saldo).minus(comprometido);
    if (importe.gt(disponible)) throw invalido(`Se pagarían $${m2(importe)} y de esa factura quedan $${m2(disponible)} por pagar (descontando pagos ya programados).`);
    total = total.plus(importe);
    apps.push({ id: x.id, importe });
  }
  const p = (await c.query(
    "INSERT INTO pago_proveedor (proveedor_id, cuenta_bancaria_id, forma_pago, importe, fecha_programada, comentario, registrado_por) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, folio",
    [prov.id, cuentaId, d.forma, m2(total), d.fecha_programada, d.comentario ?? null, u.id],
  )).rows[0];
  for (const a of apps) await c.query("INSERT INTO pago_aplicacion (pago_id, cxp_id, importe) VALUES ($1, $2, $3)", [p.id, a.id, m2(a.importe)]);
  await solicitar(c, "PAGO", p.id, p.folio, total, u.id);
  return { ...p, importe: m2(total) };
}

export async function marcarPagado(c: Cliente, u: UsuarioActual, id: string, d: { fecha_pago: string; referencia: string }) {
  const p = (await c.query("SELECT * FROM pago_proveedor WHERE id::text = $1 OR folio = upper($1) FOR UPDATE", [id])).rows[0];
  if (!p) throw noEncontrado("No existe ese pago.");
  if (p.estatus !== "AUTORIZADO") throw new ErrorApp(409, "estatus", p.estatus === "POR_AUTORIZAR" ? "El pago aún no está autorizado." : "El pago ya no está pendiente.");
  if (/\d{13,19}/.test(d.referencia.replace(/[\s-]/g, ""))) throw invalido("Escribe la referencia o folio del banco, no números de tarjeta o de cuenta completos.");
  for (const a of (await c.query("SELECT cxp_id, importe::text FROM pago_aplicacion WHERE pago_id = $1", [p.id])).rows) {
    const x = (await c.query("UPDATE cxp_documento SET saldo = saldo - $2 WHERE id = $1 RETURNING saldo::text", [a.cxp_id, a.importe])).rows[0];
    if (new D(x.saldo).isZero()) await c.query("UPDATE cxp_documento SET estatus = 'PAGADO' WHERE id = $1", [a.cxp_id]);
  }
  await c.query("UPDATE pago_proveedor SET estatus = 'PAGADO', fecha_pago = $2, referencia = $3, pagado_por = $4 WHERE id = $1", [p.id, d.fecha_pago, d.referencia, u.id]);
  return { folio: p.folio };
}

export async function cancelarPago(c: Cliente, u: UsuarioActual, id: string, motivo: string) {
  const p = (await c.query("SELECT * FROM pago_proveedor WHERE id::text = $1 OR folio = upper($1) FOR UPDATE", [id])).rows[0];
  if (!p) throw noEncontrado("No existe ese pago.");
  if (!["POR_AUTORIZAR", "AUTORIZADO"].includes(p.estatus)) throw new ErrorApp(409, "estatus", "Un pago hecho no se cancela aquí (se registra la devolución del proveedor).");
  await c.query("UPDATE pago_proveedor SET estatus = 'CANCELADO', comentario = coalesce(comentario || ' · ', '') || $2 WHERE id = $1", [p.id, `Cancelado: ${motivo}`]);
  await cancelarSolicitud(c, "PAGO", p.id, motivo);
  return { folio: p.folio };
}
