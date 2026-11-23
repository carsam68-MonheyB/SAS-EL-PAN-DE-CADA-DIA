// Contabilidad (Fase 7): reglas de contabilización, pólizas automáticas desde
// inventarios, producción, punto de venta y compras, pólizas manuales con
// autorización, balanza, libro diario, auxiliares, estados financieros,
// conciliación del inventario contra el kárdex y cierre de periodo.
//
// Las pólizas automáticas se generan con `contabilizar`: busca los documentos
// que aún no tienen póliza, arma sus líneas por concepto y las convierte en
// partidas con las reglas. Si falta una regla, el documento queda pendiente
// (no se inventa cuenta) y se contabiliza en cuanto se capture la regla.
import { armarPartidas, balanceGeneral, balanza, estadoResultados, folioPoliza, saldoNatural, type CuentaBalanza, type Linea, type Regla } from "../dominio/contabilidad";
import { D, type Dec } from "../dominio/recetas";
import { ErrorApp, invalido, noEncontrado, prohibido } from "./errores";
import type { Cliente } from "./transaccion";
import type { UsuarioActual } from "./usuarios";

const d = (x: string | number | null | undefined) => new D(x ?? 0);
const r2s = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
const FORMA: Record<string, string> = { "01": "CAJA_EFECTIVO", "04": "TARJETAS_POR_COBRAR", "28": "TARJETAS_POR_COBRAR", "03": "BANCOS" };
const formaConcepto = (clave: string | null) => (clave === null ? "ANTICIPOS_CLIENTES" : FORMA[clave] ?? "CAJA_EFECTIVO");
const grupo = (tipoAlmacen: string) => (tipoAlmacen === "PEP" ? "PEP" : tipoAlmacen === "PT" ? "PT" : "MP");

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------
export async function leerReglas(c: Cliente): Promise<Regla[]> {
  return (await c.query(
    "SELECT k.clave AS concepto, r.sucursal_id, r.cuenta_id FROM regla_contable r JOIN concepto_contable k ON k.id = r.concepto_id WHERE r.activo",
  )).rows.map((x) => ({ concepto: x.concepto, sucursalId: x.sucursal_id, cuentaId: x.cuenta_id }));
}

export async function listarReglas(c: Cliente) {
  const conceptos = (await c.query("SELECT clave, nombre, grupo, descripcion FROM concepto_contable ORDER BY orden")).rows;
  const reglas = (await c.query(
    `SELECT k.clave AS concepto, s.clave AS sucursal, cc.clave AS cuenta, cc.nombre AS cuenta_nombre, r.activo
       FROM regla_contable r JOIN concepto_contable k ON k.id = r.concepto_id JOIN cuenta_contable cc ON cc.id = r.cuenta_id
       LEFT JOIN sucursal s ON s.id = r.sucursal_id ORDER BY k.orden, s.clave NULLS FIRST`,
  )).rows;
  return conceptos.map((k) => ({ ...k, reglas: reglas.filter((r) => r.concepto === k.clave) }));
}

/** Alta o cambio de la cuenta de un concepto (general o de una sucursal). Cuenta vacía = desactivar. */
export async function guardarRegla(c: Cliente, d0: { concepto: string; sucursal?: string | null; cuenta?: string | null }) {
  const k = (await c.query("SELECT id FROM concepto_contable WHERE clave = upper($1)", [d0.concepto])).rows[0];
  if (!k) throw invalido(`No existe el concepto ${d0.concepto}.`);
  const s = d0.sucursal ? (await c.query("SELECT id FROM sucursal WHERE clave = upper($1)", [d0.sucursal])).rows[0] : null;
  if (d0.sucursal && !s) throw invalido(`No existe la sucursal ${d0.sucursal}.`);
  const previa = (await c.query("SELECT id FROM regla_contable WHERE concepto_id = $1 AND sucursal_id IS NOT DISTINCT FROM $2", [k.id, s?.id ?? null])).rows[0];
  if (!d0.cuenta) {
    if (previa) await c.query("UPDATE regla_contable SET activo = false WHERE id = $1", [previa.id]);
    return { concepto: d0.concepto.toUpperCase(), cuenta: null };
  }
  const cta = (await c.query("SELECT id, afectable, activo FROM cuenta_contable WHERE clave = $1", [d0.cuenta])).rows[0];
  if (!cta) throw invalido(`No existe la cuenta ${d0.cuenta}.`);
  if (!cta.afectable || !cta.activo) throw invalido(`La cuenta ${d0.cuenta} no es afectable o está inactiva: elige una subcuenta.`);
  if (previa) await c.query("UPDATE regla_contable SET cuenta_id = $2, activo = true WHERE id = $1", [previa.id, cta.id]);
  else await c.query("INSERT INTO regla_contable (concepto_id, sucursal_id, cuenta_id) VALUES ($1, $2, $3)", [k.id, s?.id ?? null, cta.id]);
  return { concepto: d0.concepto.toUpperCase(), cuenta: d0.cuenta };
}

// ---------------------------------------------------------------------------
// Periodos y folios
// ---------------------------------------------------------------------------
async function periodoDe(c: Cliente, fecha: string, bloquear = false) {
  const [a, m] = fecha.split("-").map(Number);
  await c.query("INSERT INTO periodo_contable (ejercicio, mes) VALUES ($1, $2) ON CONFLICT DO NOTHING", [a, m]);
  return (await c.query(`SELECT id, ejercicio, mes, estatus, folios FROM periodo_contable WHERE ejercicio = $1 AND mes = $2 ${bloquear ? "FOR UPDATE" : ""}`, [a, m])).rows[0];
}

interface NuevaPoliza {
  tipo: "I" | "E" | "D"; fecha: string; concepto: string; origen: string; origenId: string | null; origenFolio: string | null;
  estatus: "APLICADA" | "POR_AUTORIZAR"; partidas: { cuentaId: string; sucursalId: string | null; centroCostoId: string | null; texto: string; cargo: Dec; abono: Dec; referencia?: string | null }[];
  total: Dec; usuarioId: string;
}

async function insertarPoliza(c: Cliente, p: NuevaPoliza) {
  const per = await periodoDe(c, p.fecha, true);
  if (per.estatus === "CERRADO") throw new ErrorApp(409, "periodo", `El periodo ${String(per.mes).padStart(2, "0")}/${per.ejercicio} está cerrado.`);
  const n = Number(per.folios?.[p.tipo] ?? 0) + 1;
  await c.query("UPDATE periodo_contable SET folios = folios || jsonb_build_object($2::text, $3::int) WHERE id = $1", [per.id, p.tipo, n]);
  const folio = folioPoliza(p.tipo, per.ejercicio, per.mes, n);
  const id = (await c.query(
    `INSERT INTO poliza (folio, tipo, periodo_id, fecha, concepto, origen, origen_id, origen_folio, estatus, total, registrado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [folio, p.tipo, per.id, p.fecha, p.concepto, p.origen, p.origenId, p.origenFolio, p.estatus, p.total.toFixed(2), p.usuarioId],
  )).rows[0].id as string;
  for (const [i, x] of p.partidas.entries()) {
    await c.query(
      "INSERT INTO poliza_partida (poliza_id, orden, cuenta_id, centro_costo_id, sucursal_id, concepto, cargo, abono, referencia) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [id, i + 1, x.cuentaId, x.centroCostoId, x.sucursalId, x.texto, x.cargo.toFixed(2), x.abono.toFixed(2), x.referencia ?? null],
    );
  }
  return { id, folio };
}

// ---------------------------------------------------------------------------
// Documentos por contabilizar
// ---------------------------------------------------------------------------
interface Documento { origen: string; id: string; folio: string; fecha: string; tipo: "I" | "E" | "D"; concepto: string; lineas: Linea[] }

const NOMBRE_MOV: Record<string, string> = {
  INICIAL: "Inventario inicial", ENTRADA_COMPRA: "Entrada por compra", ENTRADA_PRODUCCION: "Entrada de producción sin orden", SURTIDO_SALIDA: "Surtido a producción",
  TRASPASO_ENVIO: "Envío de traspaso", TRASPASO_RECEPCION: "Recepción de traspaso", MERMA: "Merma", AJUSTE_ENTRADA: "Ajuste por conteo (sobrante)",
  AJUSTE_SALIDA: "Ajuste por conteo (faltante)", VENTA: "Costo de venta", DEVOLUCION_VENTA: "Costo de devolución de venta",
};

/** Contrapartida del inventario según el tipo de movimiento (null = no se contabiliza aquí). */
function contrapartida(tipo: string, g: string, destino: string | null): string | null {
  switch (tipo) {
    case "INICIAL": return "SALDOS_INICIALES_INV";
    case "ENTRADA_COMPRA": return "PROV_POR_FACTURAR";
    case "ENTRADA_PRODUCCION": return "PRODUCCION_SIN_ORDEN";
    case "SURTIDO_SALIDA": return `INV_${destino ?? "PEP"}`;
    case "TRASPASO_ENVIO": case "TRASPASO_RECEPCION": return "MERCANCIA_EN_TRANSITO";
    case "MERMA": return `MERMA_${g}`;
    case "AJUSTE_ENTRADA": return "AJUSTE_SOBRANTE";
    case "AJUSTE_SALIDA": return "AJUSTE_FALTANTE";
    case "VENTA": case "DEVOLUCION_VENTA": return "COSTO_VENTAS";
    default: return null;
  }
}

const SIN_POLIZA = (origen: string, alias: string) => `NOT EXISTS (SELECT 1 FROM poliza pz WHERE pz.origen = '${origen}' AND pz.origen_id = ${alias}.id)`;

async function documentos(c: Cliente, desde: string | null): Promise<Documento[]> {
  const docs: Documento[] = [];
  const f = (col: string) => `($1::date IS NULL OR ${col} >= $1)`;

  // Inventarios: un movimiento del kárdex = una póliza (las cancelaciones invierten por su propio signo).
  for (const m of (await c.query(
    `SELECT m.id, m.folio, m.tipo, m.fecha_negocio::text AS fecha, m.referencia, coalesce(o.tipo, m.tipo) AS base,
            coalesce(o.documento_tipo, m.documento_tipo) AS documento, al.tipo AS almacen_tipo, al.sucursal_id, al.centro_costo_id,
            (SELECT sum(r.importe) FROM movimiento_renglon r WHERE r.movimiento_id = m.id)::text AS importe,
            (SELECT ad.tipo FROM surtido s JOIN almacen ad ON ad.id = s.almacen_destino_id WHERE s.salida_id = coalesce(o.id, m.id)) AS destino
       FROM movimiento m JOIN almacen al ON al.id = m.almacen_id LEFT JOIN movimiento o ON o.id = m.cancela_id
      WHERE ${SIN_POLIZA("MOVIMIENTO", "m")} AND ${f("m.fecha_negocio")}
      ORDER BY m.fecha_negocio, m.folio`,
    [desde],
  )).rows) {
    if (m.documento === "ORDEN_PRODUCCION" || m.base === "SURTIDO_ENTRADA" || m.base === "CONSUMO_PRODUCCION") continue;
    const v = d(m.importe);
    const g = grupo(m.almacen_tipo);
    const contra = contrapartida(m.base, g, m.destino ? grupo(m.destino) : null);
    if (!contra || v.isZero()) continue;
    const texto = `${m.tipo === "CANCELACION" ? "Cancelación: " : ""}${NOMBRE_MOV[m.base] ?? m.base} ${m.folio}`;
    docs.push({
      origen: "MOVIMIENTO", id: m.id, folio: m.folio, fecha: m.fecha, tipo: "D", concepto: texto,
      lineas: [
        { concepto: `INV_${g}`, importe: v, sucursalId: m.sucursal_id, centroCostoId: m.centro_costo_id, texto },
        { concepto: contra, importe: v.neg(), sucursalId: m.sucursal_id, centroCostoId: contra.startsWith("INV_") ? m.centro_costo_id : null, texto },
      ],
    });
  }

  // Faltantes de traspasos recibidos.
  for (const t of (await c.query(
    `SELECT t.id, t.folio, (t.recibido_en AT TIME ZONE 'America/Mexico_City')::date::text AS fecha, ao.sucursal_id, sum(tr.importe_faltante)::text AS faltante
       FROM traspaso t JOIN traspaso_renglon tr ON tr.traspaso_id = t.id JOIN almacen ao ON ao.id = t.almacen_origen_id
      WHERE t.estatus = 'RECIBIDO' AND ${SIN_POLIZA("TRASPASO_FALTANTE", "t")} AND ${f("(t.recibido_en AT TIME ZONE 'America/Mexico_City')::date")}
      GROUP BY t.id, t.folio, t.recibido_en, ao.sucursal_id HAVING sum(tr.importe_faltante) > 0`,
    [desde],
  )).rows) {
    const v = d(t.faltante);
    const texto = `Faltante del traspaso ${t.folio}`;
    docs.push({ origen: "TRASPASO_FALTANTE", id: t.id, folio: t.folio, fecha: t.fecha, tipo: "D", concepto: texto, lineas: [
      { concepto: "FALTANTE_TRASPASO", importe: v, sucursalId: t.sucursal_id, texto }, { concepto: "MERCANCIA_EN_TRANSITO", importe: v.neg(), sucursalId: t.sucursal_id, texto },
    ] });
  }

  // Órdenes de producción cerradas: producto a su costo real contra consumo, mano de obra e indirectos.
  for (const o of (await c.query(
    `SELECT o.id, o.folio, me.fecha_negocio::text AS fecha, ad.tipo AS destino, pep.sucursal_id, pep.centro_costo_id,
            o.costo_total::text AS total, o.costo_mp::text AS mp, o.costo_mod::text AS mod, o.costo_gif::text AS gif, a.clave AS articulo
       FROM orden_produccion o JOIN movimiento me ON me.id = o.entrada_id JOIN almacen ad ON ad.id = o.almacen_destino_id
       JOIN almacen pep ON pep.id = o.almacen_pep_id JOIN articulo a ON a.id = o.articulo_id
      WHERE o.estatus = 'CERRADA' AND ${SIN_POLIZA("ORDEN_PRODUCCION", "o")} AND ${f("me.fecha_negocio")}`,
    [desde],
  )).rows) {
    const texto = `Orden de producción ${o.folio} (${o.articulo})`;
    const s = o.sucursal_id;
    docs.push({ origen: "ORDEN_PRODUCCION", id: o.id, folio: o.folio, fecha: o.fecha, tipo: "D", concepto: texto, lineas: [
      { concepto: `INV_${grupo(o.destino)}`, importe: d(o.total), sucursalId: s, centroCostoId: o.centro_costo_id, texto },
      { concepto: "INV_PEP", importe: d(o.mp).neg(), sucursalId: s, centroCostoId: o.centro_costo_id, texto },
      { concepto: "MOD_APLICADA", importe: d(o.mod).neg(), sucursalId: s, texto },
      { concepto: "GIF_APLICADOS", importe: d(o.gif).neg(), sucursalId: s, texto },
    ] });
  }

  // Ventas: cobros por forma de pago (o anticipo aplicado) contra ventas e impuestos.
  for (const v of (await c.query(
    `SELECT v.id, v.folio, v.fecha_negocio::text AS fecha, v.sucursal_id, v.total::text, v.iva::text, v.ieps::text,
            (SELECT json_agg(json_build_object('forma', fp.clave, 'importe', vp.importe::text)) FROM venta_pago vp LEFT JOIN forma_pago fp ON fp.id = vp.forma_pago_id WHERE vp.venta_id = v.id) AS pagos
       FROM venta v WHERE ${SIN_POLIZA("VENTA", "v")} AND ${f("v.fecha_negocio")} ORDER BY v.fecha_negocio, v.folio`,
    [desde],
  )).rows) {
    const texto = `Venta ${v.folio}`;
    const lineas: Linea[] = (v.pagos ?? []).map((p: any) => ({ concepto: formaConcepto(p.forma), importe: d(p.importe), sucursalId: v.sucursal_id, texto }));
    lineas.push(
      { concepto: "VENTAS", importe: d(v.total).minus(d(v.iva)).minus(d(v.ieps)).neg(), sucursalId: v.sucursal_id, texto },
      { concepto: "IVA_TRASLADADO", importe: d(v.iva).neg(), sucursalId: v.sucursal_id, texto },
      { concepto: "IEPS_TRASLADADO", importe: d(v.ieps).neg(), sucursalId: v.sucursal_id, texto },
    );
    docs.push({ origen: "VENTA", id: v.id, folio: v.folio, fecha: v.fecha, tipo: "I", concepto: texto, lineas });
  }

  // Devoluciones de venta: devoluciones e impuestos contra lo que se regresó al cliente.
  for (const x of (await c.query(
    `SELECT dv.id, dv.folio, t.fecha_negocio::text AS fecha, v.sucursal_id, dv.importe::text, fp.clave AS forma,
            (SELECT round(coalesce(sum(vr.iva * dr.cantidad / vr.cantidad), 0), 2) FROM devolucion_renglon dr JOIN venta_renglon vr ON vr.id = dr.venta_renglon_id WHERE dr.devolucion_id = dv.id)::text AS iva,
            (SELECT round(coalesce(sum(vr.ieps * dr.cantidad / vr.cantidad), 0), 2) FROM devolucion_renglon dr JOIN venta_renglon vr ON vr.id = dr.venta_renglon_id WHERE dr.devolucion_id = dv.id)::text AS ieps
       FROM devolucion dv JOIN venta v ON v.id = dv.venta_id JOIN turno_caja t ON t.id = dv.turno_id
       LEFT JOIN movimiento_caja mc ON mc.id = dv.movimiento_caja_id LEFT JOIN forma_pago fp ON fp.id = mc.forma_pago_id
      WHERE ${SIN_POLIZA("DEVOLUCION", "dv")} AND ${f("t.fecha_negocio")}`,
    [desde],
  )).rows) {
    const texto = `Devolución ${x.folio}`;
    const total = d(x.importe);
    docs.push({ origen: "DEVOLUCION", id: x.id, folio: x.folio, fecha: x.fecha, tipo: "E", concepto: texto, lineas: [
      { concepto: "DEVOLUCIONES_VENTAS", importe: total.minus(d(x.iva)).minus(d(x.ieps)), sucursalId: x.sucursal_id, texto },
      { concepto: "IVA_TRASLADADO", importe: d(x.iva), sucursalId: x.sucursal_id, texto },
      { concepto: "IEPS_TRASLADADO", importe: d(x.ieps), sucursalId: x.sucursal_id, texto },
      { concepto: FORMA[x.forma] ?? "CAJA_EFECTIVO", importe: total.neg(), sucursalId: x.sucursal_id, texto },
    ] });
  }

  // Movimientos de efectivo de la caja y anticipos.
  for (const x of (await c.query(
    `SELECT mc.id, mc.tipo, t.folio, t.fecha_negocio::text AS fecha, cj.sucursal_id, mc.importe::text, fp.clave AS forma, p.folio AS pedido
       FROM movimiento_caja mc JOIN turno_caja t ON t.id = mc.turno_id JOIN caja cj ON cj.id = t.caja_id
       LEFT JOIN forma_pago fp ON fp.id = mc.forma_pago_id LEFT JOIN pedido p ON p.id = mc.documento_id
      WHERE mc.tipo IN ('RETIRO', 'INGRESO', 'ANTICIPO', 'DEVOLUCION_ANTICIPO') AND ${SIN_POLIZA("MOVIMIENTO_CAJA", "mc")} AND ${f("t.fecha_negocio")}`,
    [desde],
  )).rows) {
    const v = d(x.importe);
    const s = x.sucursal_id;
    const par = (cargo: string, abono: string, texto: string, tipo: "I" | "E" | "D") =>
      docs.push({ origen: "MOVIMIENTO_CAJA", id: x.id, folio: x.pedido ?? x.folio, fecha: x.fecha, tipo, concepto: texto, lineas: [
        { concepto: cargo, importe: v, sucursalId: s, texto }, { concepto: abono, importe: v.neg(), sucursalId: s, texto },
      ] });
    if (x.tipo === "RETIRO") par("EFECTIVO_EN_TRANSITO", "CAJA_EFECTIVO", `Retiro de efectivo, turno ${x.folio}`, "D");
    else if (x.tipo === "INGRESO") par("CAJA_EFECTIVO", "EFECTIVO_EN_TRANSITO", `Ingreso de efectivo, turno ${x.folio}`, "D");
    else if (x.tipo === "ANTICIPO") par(formaConcepto(x.forma), "ANTICIPOS_CLIENTES", `Anticipo del pedido ${x.pedido}`, "I");
    else par("ANTICIPOS_CLIENTES", "CAJA_EFECTIVO", `Devolución del anticipo del pedido ${x.pedido}`, "E");
  }

  // Pedidos cancelados con anticipo retenido.
  for (const p of (await c.query(
    `SELECT p.id, p.folio, (coalesce(p.actualizado_en, p.creado_en) AT TIME ZONE 'America/Mexico_City')::date::text AS fecha, p.sucursal_id, p.anticipado::text
       FROM pedido p WHERE p.estatus = 'CANCELADO' AND p.destino_anticipo = 'RETENIDO' AND p.anticipado > 0 AND ${SIN_POLIZA("PEDIDO_RETENIDO", "p")}
        AND ${f("(coalesce(p.actualizado_en, p.creado_en) AT TIME ZONE 'America/Mexico_City')::date")}`,
    [desde],
  )).rows) {
    const texto = `Anticipo retenido del pedido cancelado ${p.folio}`;
    docs.push({ origen: "PEDIDO_RETENIDO", id: p.id, folio: p.folio, fecha: p.fecha, tipo: "D", concepto: texto, lineas: [
      { concepto: "ANTICIPOS_CLIENTES", importe: d(p.anticipado), sucursalId: p.sucursal_id, texto }, { concepto: "ANTICIPOS_RETENIDOS", importe: d(p.anticipado).neg(), sucursalId: p.sucursal_id, texto },
    ] });
  }

  // Diferencias del corte Z.
  for (const k of (await c.query(
    `SELECT k.id, t.folio, t.fecha_negocio::text AS fecha, cj.sucursal_id, k.diferencia::text
       FROM corte k JOIN turno_caja t ON t.id = k.turno_id JOIN caja cj ON cj.id = t.caja_id
      WHERE k.tipo = 'Z' AND k.diferencia <> 0 AND ${SIN_POLIZA("CORTE", "k")} AND ${f("t.fecha_negocio")}`,
    [desde],
  )).rows) {
    const v = d(k.diferencia);
    const texto = `${v.lt(0) ? "Faltante" : "Sobrante"} en el corte Z del turno ${k.folio}`;
    docs.push({ origen: "CORTE", id: k.id, folio: k.folio, fecha: k.fecha, tipo: "D", concepto: texto, lineas: v.lt(0)
      ? [{ concepto: "FALTANTES_CAJA", importe: v.neg(), sucursalId: k.sucursal_id, texto }, { concepto: "CAJA_EFECTIVO", importe: v, sucursalId: k.sucursal_id, texto }]
      : [{ concepto: "CAJA_EFECTIVO", importe: v, sucursalId: k.sucursal_id, texto }, { concepto: "SOBRANTES_CAJA", importe: v.neg(), sucursalId: k.sucursal_id, texto }] });
  }

  // Facturas de proveedor que pasaron a cuentas por pagar.
  for (const x of (await c.query(
    `SELECT f.id, coalesce(f.serie || '-', '') || coalesce(f.folio, left(f.uuid_cfdi, 8)) AS folio, (f.fecha AT TIME ZONE 'America/Mexico_City')::date::text AS fecha,
            al.sucursal_id, f.total::text, f.iva::text, f.retenciones::text, p.clave AS proveedor
       FROM factura_proveedor f JOIN proveedor p ON p.id = f.proveedor_id LEFT JOIN orden_compra oc ON oc.id = f.oc_id LEFT JOIN almacen al ON al.id = oc.almacen_id
      WHERE f.estatus IN ('COTEJADA', 'AUTORIZADA') AND ${SIN_POLIZA("FACTURA_PROVEEDOR", "f")} AND ${f("(f.fecha AT TIME ZONE 'America/Mexico_City')::date")}`,
    [desde],
  )).rows) {
    const texto = `Factura ${x.folio} de ${x.proveedor}`;
    const total = d(x.total), iva = d(x.iva), ret = d(x.retenciones);
    docs.push({ origen: "FACTURA_PROVEEDOR", id: x.id, folio: x.folio, fecha: x.fecha, tipo: "D", concepto: texto, lineas: [
      { concepto: "PROV_POR_FACTURAR", importe: total.minus(iva).plus(ret), sucursalId: x.sucursal_id, texto },
      { concepto: "IVA_POR_ACREDITAR", importe: iva, sucursalId: x.sucursal_id, texto },
      { concepto: "RETENCIONES_POR_PAGAR", importe: ret.neg(), sucursalId: x.sucursal_id, texto },
      { concepto: "PROVEEDORES", importe: total.neg(), sucursalId: x.sucursal_id, texto },
    ] });
  }

  // Pagos hechos: proveedores contra bancos y el IVA pagado pasa a acreditable.
  for (const x of (await c.query(
    `SELECT pg.id, pg.folio, pg.fecha_pago::text AS fecha, pg.importe::text, pg.referencia, pv.clave AS proveedor,
            (SELECT round(coalesce(sum(f.iva * pa.importe / f.total), 0), 2) FROM pago_aplicacion pa JOIN cxp_documento cx ON cx.id = pa.cxp_id JOIN factura_proveedor f ON f.id = cx.factura_id WHERE pa.pago_id = pg.id AND f.total > 0)::text AS iva
       FROM pago_proveedor pg JOIN proveedor pv ON pv.id = pg.proveedor_id
      WHERE pg.estatus = 'PAGADO' AND ${SIN_POLIZA("PAGO_PROVEEDOR", "pg")} AND ${f("pg.fecha_pago")}`,
    [desde],
  )).rows) {
    const texto = `Pago ${x.folio} a ${x.proveedor} (${x.referencia})`;
    docs.push({ origen: "PAGO_PROVEEDOR", id: x.id, folio: x.folio, fecha: x.fecha, tipo: "E", concepto: texto, lineas: [
      { concepto: "PROVEEDORES", importe: d(x.importe), sucursalId: null, texto }, { concepto: "BANCOS", importe: d(x.importe).neg(), sucursalId: null, texto },
      { concepto: "IVA_ACREDITABLE", importe: d(x.iva), sucursalId: null, texto }, { concepto: "IVA_POR_ACREDITAR", importe: d(x.iva).neg(), sucursalId: null, texto },
    ] });
  }
  return docs.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.folio.localeCompare(b.folio));
}

export interface Pendiente { origen: string; folio: string; fecha: string; concepto: string; motivo: string }

/**
 * Genera las pólizas de los documentos que aún no tienen. Con `aplicar = false`
 * solo dice qué se contabilizaría y qué queda pendiente (y por qué).
 */
export async function contabilizar(c: Cliente, usuarioId: string, aplicar = true) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext('contabilizar'))");
  const inicio = (await c.query("SELECT valor FROM configuracion WHERE clave = 'contabilidad.fecha_inicio'")).rows[0]?.valor || null;
  const reglas = await leerReglas(c);
  const cerrados = new Set((await c.query("SELECT ejercicio || '-' || lpad(mes::text, 2, '0') AS k FROM periodo_contable WHERE estatus = 'CERRADO'")).rows.map((r) => r.k));
  const generadas: string[] = [];
  const pendientes: Pendiente[] = [];
  for (const doc of await documentos(c, inicio)) {
    const p = { origen: doc.origen, folio: doc.folio, fecha: doc.fecha, concepto: doc.concepto };
    if (cerrados.has(doc.fecha.slice(0, 7))) { pendientes.push({ ...p, motivo: "El periodo está cerrado." }); continue; }
    const r = armarPartidas(doc.lineas, reglas);
    if ("faltan" in r) { pendientes.push({ ...p, motivo: `Falta la cuenta de: ${r.faltan.join(", ")}.` }); continue; }
    if (!aplicar) { generadas.push(doc.folio); continue; }
    const pz = await insertarPoliza(c, {
      tipo: doc.tipo, fecha: doc.fecha, concepto: doc.concepto, origen: doc.origen, origenId: doc.id, origenFolio: doc.folio,
      estatus: "APLICADA", partidas: r.partidas, total: r.total, usuarioId,
    });
    generadas.push(pz.folio);
  }
  return { generadas: generadas.length, folios: generadas.slice(0, 200), pendientes };
}

// ---------------------------------------------------------------------------
// Pólizas manuales
// ---------------------------------------------------------------------------
export async function crearPolizaManual(c: Cliente, u: UsuarioActual, x: { tipo: "I" | "E" | "D"; fecha: string; concepto: string; partidas: { cuenta: string; cargo?: string | null; abono?: string | null; concepto?: string | null; centro_costo?: string | null; sucursal?: string | null }[] }) {
  if (x.partidas.length < 2) throw invalido("Una póliza lleva al menos dos partidas.");
  const errores: string[] = [];
  const partidas: NuevaPoliza["partidas"] = [];
  for (const [i, p] of x.partidas.entries()) {
    const n = `Partida ${i + 1}`;
    const cta = (await c.query("SELECT id, afectable, activo FROM cuenta_contable WHERE clave = $1", [p.cuenta.trim()])).rows[0];
    if (!cta) { errores.push(`${n}: no existe la cuenta ${p.cuenta}.`); continue; }
    if (!cta.afectable || !cta.activo) { errores.push(`${n}: la cuenta ${p.cuenta} no es afectable o está inactiva.`); continue; }
    let cargo: Dec, abono: Dec;
    try { cargo = d((p.cargo || "0").replaceAll(",", "")); abono = d((p.abono || "0").replaceAll(",", "")); } catch { errores.push(`${n}: importe no válido.`); continue; }
    if (cargo.lt(0) || abono.lt(0) || cargo.decimalPlaces() > 2 || abono.decimalPlaces() > 2) { errores.push(`${n}: importes positivos con hasta 2 decimales.`); continue; }
    if (cargo.gt(0) === abono.gt(0)) { errores.push(`${n}: lleva cargo o abono (uno de los dos).`); continue; }
    const cc = p.centro_costo ? (await c.query("SELECT id FROM centro_costo WHERE clave = upper($1)", [p.centro_costo])).rows[0]?.id : null;
    if (p.centro_costo && !cc) { errores.push(`${n}: no existe el centro de costo ${p.centro_costo}.`); continue; }
    const su = p.sucursal ? (await c.query("SELECT id FROM sucursal WHERE clave = upper($1)", [p.sucursal])).rows[0]?.id : null;
    if (p.sucursal && !su) { errores.push(`${n}: no existe la sucursal ${p.sucursal}.`); continue; }
    partidas.push({ cuentaId: cta.id, sucursalId: su ?? null, centroCostoId: cc ?? null, texto: p.concepto?.trim() || x.concepto, cargo, abono });
  }
  if (errores.length) throw invalido("Revisa las partidas.", errores.map((mensaje) => ({ campo: "partidas", mensaje })));
  const cargos = partidas.reduce((s, p) => s.plus(p.cargo), new D(0));
  const abonos = partidas.reduce((s, p) => s.plus(p.abono), new D(0));
  if (!cargos.eq(abonos)) throw invalido(`La póliza no cuadra: cargos $${r2s(cargos)} y abonos $${r2s(abonos)}.`);
  return insertarPoliza(c, { tipo: x.tipo, fecha: x.fecha, concepto: x.concepto.trim(), origen: "MANUAL", origenId: null, origenFolio: null, estatus: "POR_AUTORIZAR", partidas, total: cargos, usuarioId: u.id });
}

async function polizaBloqueada(c: Cliente, id: string) {
  const p = (await c.query("SELECT p.*, pe.estatus AS periodo_estatus FROM poliza p JOIN periodo_contable pe ON pe.id = p.periodo_id WHERE p.id::text = $1 OR p.folio = upper($1) FOR UPDATE OF p", [id])).rows[0];
  if (!p) throw noEncontrado("No existe esa póliza.");
  if (p.periodo_estatus === "CERRADO") throw new ErrorApp(409, "periodo", "El periodo de la póliza está cerrado.");
  return p;
}

export async function resolverPoliza(c: Cliente, u: UsuarioActual, id: string, decision: "autorizar" | "rechazar", motivo: string | null) {
  const p = await polizaBloqueada(c, id);
  if (p.estatus !== "POR_AUTORIZAR") throw new ErrorApp(409, "estatus", "La póliza no está pendiente de autorización.");
  if (p.registrado_por === u.id) throw prohibido("Quien captura una póliza no puede autorizarla (segregación de funciones).");
  if (decision === "rechazar" && !motivo?.trim()) throw invalido("Escribe el motivo del rechazo.");
  await c.query("UPDATE poliza SET estatus = $2, autorizado_por = $3, autorizado_en = now(), motivo = $4 WHERE id = $1",
    [p.id, decision === "autorizar" ? "APLICADA" : "RECHAZADA", u.id, motivo?.trim() || null]);
  return { folio: p.folio, estatus: decision === "autorizar" ? "APLICADA" : "RECHAZADA" };
}

export async function cancelarPoliza(c: Cliente, u: UsuarioActual, id: string, motivo: string) {
  const p = await polizaBloqueada(c, id);
  if (p.origen !== "MANUAL") throw new ErrorApp(409, "regla", "Una póliza automática no se cancela: se revierte cancelando el documento que la originó.");
  if (!["POR_AUTORIZAR", "APLICADA"].includes(p.estatus)) throw new ErrorApp(409, "estatus", "La póliza ya está cancelada o rechazada.");
  await c.query("UPDATE poliza SET estatus = 'CANCELADA', cancelado_por = $2, cancelado_en = now(), motivo = $3 WHERE id = $1", [p.id, u.id, motivo.trim()]);
  return { folio: p.folio, estatus: "CANCELADA" };
}

// ---------------------------------------------------------------------------
// Consultas y reportes (solo pólizas aplicadas)
// ---------------------------------------------------------------------------
export async function listarPolizas(c: Cliente, f: { desde: string; hasta: string; tipo?: string | null; estatus?: string | null; origen?: string | null }) {
  return (await c.query(
    `SELECT p.id, p.folio, p.tipo, p.fecha::text, p.concepto, p.origen, p.origen_folio, p.estatus, p.total::text, u.usuario AS registro, ua.usuario AS autorizo
       FROM poliza p JOIN usuario u ON u.id = p.registrado_por LEFT JOIN usuario ua ON ua.id = p.autorizado_por
      WHERE p.fecha BETWEEN $1 AND $2 AND ($3::text IS NULL OR p.tipo = $3) AND ($4::text IS NULL OR p.estatus = $4) AND ($5::text IS NULL OR p.origen = $5)
      ORDER BY p.fecha, p.folio LIMIT 2000`,
    [f.desde, f.hasta, f.tipo ?? null, f.estatus ?? null, f.origen ?? null],
  )).rows;
}

export async function detallePoliza(c: Cliente, id: string) {
  const p = (await c.query(
    `SELECT p.*, p.fecha::text AS fecha, u.usuario AS registro, ua.usuario AS autorizo, ux.usuario AS cancelo, pe.estatus AS periodo_estatus
       FROM poliza p JOIN usuario u ON u.id = p.registrado_por LEFT JOIN usuario ua ON ua.id = p.autorizado_por LEFT JOIN usuario ux ON ux.id = p.cancelado_por
       JOIN periodo_contable pe ON pe.id = p.periodo_id WHERE p.id::text = $1 OR p.folio = upper($1)`,
    [id],
  )).rows[0];
  if (!p) throw noEncontrado("No existe esa póliza.");
  const partidas = (await c.query(
    `SELECT pp.orden, cc.clave AS cuenta, cc.nombre AS cuenta_nombre, pp.concepto, pp.cargo::text, pp.abono::text, s.clave AS sucursal, ce.clave AS centro_costo, pp.referencia
       FROM poliza_partida pp JOIN cuenta_contable cc ON cc.id = pp.cuenta_id LEFT JOIN sucursal s ON s.id = pp.sucursal_id LEFT JOIN centro_costo ce ON ce.id = pp.centro_costo_id
      WHERE pp.poliza_id = $1 ORDER BY pp.orden`,
    [p.id],
  )).rows;
  // Comprobantes fiscales del documento (para la contabilidad electrónica): la factura
  // individual o global de una venta y la factura de un proveedor.
  const cfdis = (await c.query(
    `SELECT e.uuid_cfdi AS uuid, e.clase, e.receptor_rfc AS rfc, e.total::text, e.estatus FROM cfdi_venta cv JOIN cfdi_emitido e ON e.id = cv.cfdi_id
      WHERE $1 = 'VENTA' AND cv.venta_id = $2 AND cv.vigente
     UNION ALL
     SELECT f.uuid_cfdi, 'PROVEEDOR', pr.rfc, f.total::text, f.estatus FROM factura_proveedor f JOIN proveedor pr ON pr.id = f.proveedor_id
      WHERE $1 = 'FACTURA_PROVEEDOR' AND f.id = $2`,
    [p.origen, p.origen_id],
  )).rows;
  return { poliza: p, partidas, cfdis };
}

async function cuentas(c: Cliente): Promise<CuentaBalanza[]> {
  return (await c.query("SELECT id, clave, nombre, nivel, naturaleza, cuenta_padre AS padre, afectable, codigo_agrupador AS agrupador FROM cuenta_contable ORDER BY clave")).rows;
}

async function movimientos(c: Cliente, desde: string | null, hasta: string) {
  return (await c.query(
    `SELECT pp.cuenta_id, coalesce(sum(pp.cargo) FILTER (WHERE p.fecha < $1), 0)::text AS ac, coalesce(sum(pp.abono) FILTER (WHERE p.fecha < $1), 0)::text AS aa,
            coalesce(sum(pp.cargo) FILTER (WHERE p.fecha >= coalesce($1, '0001-01-01'::date)), 0)::text AS c, coalesce(sum(pp.abono) FILTER (WHERE p.fecha >= coalesce($1, '0001-01-01'::date)), 0)::text AS a
       FROM poliza_partida pp JOIN poliza p ON p.id = pp.poliza_id WHERE p.estatus = 'APLICADA' AND p.fecha <= $2 GROUP BY pp.cuenta_id`,
    [desde, hasta],
  )).rows.map((r) => ({ cuentaId: r.cuenta_id, anteriorCargo: d(r.ac), anteriorAbono: d(r.aa), cargos: d(r.c), abonos: d(r.a) }));
}

export async function balanzaComprobacion(c: Cliente, desde: string, hasta: string) {
  const b = balanza(await cuentas(c), await movimientos(c, desde, hasta));
  return {
    desde, hasta, cuadra: b.cuadra,
    totales: { cargos: r2s(b.totales.cargos), abonos: r2s(b.totales.abonos) },
    renglones: b.renglones.map((r) => ({ clave: r.clave, nombre: r.nombre, nivel: r.nivel, naturaleza: r.naturaleza, afectable: r.afectable, agrupador: r.agrupador, inicial: r2s(r.inicial), cargos: r2s(r.cargos), abonos: r2s(r.abonos), final: r2s(r.final) })),
  };
}

export async function auxiliar(c: Cliente, cuenta: string, desde: string, hasta: string) {
  const cta = (await c.query("SELECT id, clave, nombre, naturaleza FROM cuenta_contable WHERE clave = $1", [cuenta])).rows[0];
  if (!cta) throw noEncontrado(`No existe la cuenta ${cuenta}.`);
  // Una cuenta de mayor incluye a todas sus subcuentas.
  const ids = (await c.query(
    "WITH RECURSIVE t AS (SELECT id, clave FROM cuenta_contable WHERE id = $1 UNION SELECT h.id, h.clave FROM cuenta_contable h JOIN t ON h.cuenta_padre = t.clave) SELECT id FROM t",
    [cta.id],
  )).rows.map((r) => r.id);
  const ini = (await c.query(
    "SELECT coalesce(sum(pp.cargo), 0)::text AS c, coalesce(sum(pp.abono), 0)::text AS a FROM poliza_partida pp JOIN poliza p ON p.id = pp.poliza_id WHERE p.estatus = 'APLICADA' AND pp.cuenta_id = ANY($1) AND p.fecha < $2",
    [ids, desde],
  )).rows[0];
  let saldo = saldoNatural(cta.naturaleza, d(ini.c), d(ini.a));
  const inicial = r2s(saldo);
  const movs = (await c.query(
    `SELECT p.id AS poliza_id, p.fecha::text, p.folio, p.origen_folio, cc.clave AS cuenta, pp.concepto, pp.cargo::text, pp.abono::text
       FROM poliza_partida pp JOIN poliza p ON p.id = pp.poliza_id JOIN cuenta_contable cc ON cc.id = pp.cuenta_id
      WHERE p.estatus = 'APLICADA' AND pp.cuenta_id = ANY($1) AND p.fecha BETWEEN $2 AND $3 ORDER BY p.fecha, p.folio, pp.orden`,
    [ids, desde, hasta],
  )).rows.map((m) => {
    saldo = saldo.plus(saldoNatural(cta.naturaleza, d(m.cargo), d(m.abono)));
    return { ...m, saldo: r2s(saldo) };
  });
  return { cuenta: cta.clave, nombre: cta.nombre, naturaleza: cta.naturaleza, desde, hasta, inicial, final: r2s(saldo), movimientos: movs };
}

export async function diario(c: Cliente, desde: string, hasta: string) {
  const pz = (await c.query(
    `SELECT p.id, p.folio, p.tipo, p.fecha::text, p.concepto, p.origen_folio, p.total::text FROM poliza p
      WHERE p.estatus = 'APLICADA' AND p.fecha BETWEEN $1 AND $2 ORDER BY p.fecha, p.folio LIMIT 1000`,
    [desde, hasta],
  )).rows;
  const partidas = pz.length ? (await c.query(
    `SELECT pp.poliza_id, cc.clave AS cuenta, cc.nombre AS cuenta_nombre, pp.concepto, pp.cargo::text, pp.abono::text
       FROM poliza_partida pp JOIN cuenta_contable cc ON cc.id = pp.cuenta_id WHERE pp.poliza_id = ANY($1) ORDER BY pp.orden`,
    [pz.map((p) => p.id)],
  )).rows : [];
  return { desde, hasta, polizas: pz.map((p) => ({ ...p, partidas: partidas.filter((x) => x.poliza_id === p.id) })) };
}

async function saldosPorCuenta(c: Cliente, desde: string | null, hasta: string) {
  return (await c.query(
    `SELECT cc.clave, cc.nombre, cc.codigo_agrupador AS agrupador, sum(pp.cargo)::text AS cargos, sum(pp.abono)::text AS abonos
       FROM poliza_partida pp JOIN poliza p ON p.id = pp.poliza_id JOIN cuenta_contable cc ON cc.id = pp.cuenta_id
      WHERE p.estatus = 'APLICADA' AND p.fecha <= $2 AND ($1::date IS NULL OR p.fecha >= $1) GROUP BY cc.clave, cc.nombre, cc.codigo_agrupador ORDER BY cc.clave`,
    [desde, hasta],
  )).rows.map((r) => ({ ...r, cargos: d(r.cargos), abonos: d(r.abonos) }));
}

export async function estadosFinancieros(c: Cliente, desde: string, hasta: string) {
  const er = estadoResultados(await saldosPorCuenta(c, desde, hasta));
  const ejercicio = estadoResultados(await saldosPorCuenta(c, `${hasta.slice(0, 4)}-01-01`, hasta));
  const bg = balanceGeneral(await saldosPorCuenta(c, null, hasta), ejercicio.totales.neta);
  const l = (xs: { clave: string; nombre: string; importe: Dec }[]) => xs.map((x) => ({ ...x, importe: r2s(x.importe) }));
  return {
    desde, hasta,
    resultados: { ingresos: l(er.ingresos), costos: l(er.costos), gastos: l(er.gastos), otros: l(er.otros), totales: Object.fromEntries(Object.entries(er.totales).map(([k, v]) => [k, r2s(v)])) },
    balance: {
      activo: l(bg.activo), pasivo: l(bg.pasivo), capital: l(bg.capital), anteriores: r2s(bg.anteriores), resultado_ejercicio: r2s(bg.resultadoEjercicio),
      totales: Object.fromEntries(Object.entries(bg.totales).map(([k, v]) => [k, r2s(v)])), cuadra: bg.cuadra, diferencia: r2s(bg.diferencia),
    },
  };
}

/** Conciliación: valor del inventario en el kárdex contra el saldo de sus cuentas contables. */
export async function conciliacionInventario(c: Cliente, hasta: string) {
  const kardex = (await c.query(
    `SELECT CASE WHEN al.tipo IN ('MP', 'INS') THEN 'MP' ELSE al.tipo END AS g, coalesce(sum(r.importe), 0)::text AS v
       FROM movimiento_renglon r JOIN movimiento m ON m.id = r.movimiento_id JOIN almacen al ON al.id = r.almacen_id WHERE m.fecha_negocio <= $1 GROUP BY 1`,
    [hasta],
  )).rows;
  const contable = (await c.query(
    `SELECT replace(k.clave, 'INV_', '') AS g, array_agg(DISTINCT cc.clave) AS cuentas,
            coalesce((SELECT sum(pp.cargo - pp.abono) FROM poliza_partida pp JOIN poliza p ON p.id = pp.poliza_id
                       WHERE p.estatus = 'APLICADA' AND p.fecha <= $1 AND pp.cuenta_id IN (SELECT r2.cuenta_id FROM regla_contable r2 WHERE r2.concepto_id = k.id AND r2.activo)), 0)::text AS v
       FROM concepto_contable k JOIN regla_contable r ON r.concepto_id = k.id AND r.activo JOIN cuenta_contable cc ON cc.id = r.cuenta_id
      WHERE k.clave IN ('INV_MP', 'INV_PEP', 'INV_PT') GROUP BY k.id, k.clave`,
    [hasta],
  )).rows;
  const nombres: Record<string, string> = { MP: "Materia prima", PEP: "Producción en proceso", PT: "Producto terminado" };
  return {
    hasta,
    grupos: ["MP", "PEP", "PT"].map((g) => {
      const k = d(kardex.find((x) => x.g === g)?.v);
      const ct = contable.find((x) => x.g === g);
      const v = d(ct?.v);
      // El kárdex lleva 6 decimales y cada póliza se redondea a centavos: una diferencia de centavos es redondeo.
      const dif = k.minus(v).abs();
      return { grupo: g, nombre: nombres[g], kardex: r2s(k), contable: ct ? r2s(v) : null, cuentas: ct?.cuentas ?? [], diferencia: ct ? r2s(k.minus(v)) : null, cuadra: !!ct && dif.lt(1), redondeo: !!ct && dif.gte("0.005") && dif.lt(1) };
    }),
  };
}

// ---------------------------------------------------------------------------
// Cierre de periodo
// ---------------------------------------------------------------------------
export async function periodos(c: Cliente) {
  return (await c.query(
    `SELECT pe.ejercicio, pe.mes, pe.estatus, pe.cerrado_en, uc.usuario AS cerro, pe.reabierto_en, ur.usuario AS reabrio, pe.motivo_reapertura,
            (SELECT count(*)::int FROM poliza p WHERE p.periodo_id = pe.id AND p.estatus = 'APLICADA') AS polizas,
            (SELECT count(*)::int FROM poliza p WHERE p.periodo_id = pe.id AND p.estatus = 'POR_AUTORIZAR') AS por_autorizar
       FROM periodo_contable pe LEFT JOIN usuario uc ON uc.id = pe.cerrado_por LEFT JOIN usuario ur ON ur.id = pe.reabierto_por
      ORDER BY pe.ejercicio DESC, pe.mes DESC`,
  )).rows;
}

/** Cierra un mes: contabiliza lo pendiente y revisa que no quede nada sin póliza, nada por autorizar y que la balanza cuadre. */
export async function cerrarPeriodo(c: Cliente, u: UsuarioActual, ejercicio: number, mes: number) {
  const ini = `${ejercicio}-${String(mes).padStart(2, "0")}-01`;
  const fin = (await c.query("SELECT (date_trunc('month', $1::date) + interval '1 month - 1 day')::date::text AS f", [ini])).rows[0].f;
  const per = await periodoDe(c, ini, true);
  if (per.estatus === "CERRADO") throw new ErrorApp(409, "estatus", "El periodo ya está cerrado.");
  const abiertos = (await c.query("SELECT ejercicio, mes FROM periodo_contable WHERE estatus = 'ABIERTO' AND (ejercicio, mes) < ($1, $2) ORDER BY 1, 2 LIMIT 1", [ejercicio, mes])).rows[0];
  if (abiertos) throw new ErrorApp(409, "regla", `Primero cierra ${String(abiertos.mes).padStart(2, "0")}/${abiertos.ejercicio}.`);
  const gen = await contabilizar(c, u.id);
  const problemas: string[] = gen.pendientes.filter((p) => p.fecha >= ini && p.fecha <= fin).map((p) => `${p.folio} (${p.concepto}): ${p.motivo}`);
  const porAutorizar = (await c.query("SELECT string_agg(folio, ', ') AS f FROM poliza WHERE periodo_id = $1 AND estatus = 'POR_AUTORIZAR'", [per.id])).rows[0].f;
  if (porAutorizar) problemas.push(`Pólizas manuales sin autorizar: ${porAutorizar}.`);
  const b = await balanzaComprobacion(c, ini, fin);
  if (!b.cuadra) problemas.push("La balanza no cuadra.");
  if (problemas.length) throw new ErrorApp(409, "cierre", "No se puede cerrar el periodo todavía.", problemas.map((mensaje) => ({ campo: "periodo", mensaje })));
  await c.query("UPDATE periodo_contable SET estatus = 'CERRADO', cerrado_por = $2, cerrado_en = now() WHERE id = $1", [per.id, u.id]);
  // Al cierre de cada mes contable se respalda la base fuera de Netlify (lo hace el proceso diario).
  await c.query("INSERT INTO respaldo (tipo, motivo, solicitado_por) VALUES ('CIERRE', $1, $2)", [`Cierre contable ${String(mes).padStart(2, "0")}/${ejercicio}`, u.id]);
  return { ejercicio, mes, estatus: "CERRADO", polizas_generadas: gen.generadas };
}

export async function reabrirPeriodo(c: Cliente, u: UsuarioActual, ejercicio: number, mes: number, motivo: string) {
  const per = (await c.query("SELECT id, estatus FROM periodo_contable WHERE ejercicio = $1 AND mes = $2 FOR UPDATE", [ejercicio, mes])).rows[0];
  if (!per) throw noEncontrado("No existe ese periodo.");
  if (per.estatus !== "CERRADO") throw new ErrorApp(409, "estatus", "El periodo no está cerrado.");
  const posterior = (await c.query("SELECT 1 FROM periodo_contable WHERE estatus = 'CERRADO' AND (ejercicio, mes) > ($1, $2)", [ejercicio, mes])).rowCount;
  if (posterior) throw new ErrorApp(409, "regla", "Hay periodos posteriores cerrados: se reabre primero el más reciente.");
  await c.query("UPDATE periodo_contable SET estatus = 'ABIERTO', reabierto_por = $2, reabierto_en = now(), motivo_reapertura = $3 WHERE id = $1", [per.id, u.id, motivo.trim()]);
  return { ejercicio, mes, estatus: "ABIERTO" };
}
