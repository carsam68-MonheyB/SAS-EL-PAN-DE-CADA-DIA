// Tablero y reportes de gestión (4.10): ventas por día, hora, sucursal, cajero,
// SKU y familia; margen por SKU (contra costo estándar y real); mermas por SKU y
// causa; rotación y días de inventario de materia prima y producto terminado;
// compras por proveedor y variación de precios de insumos. Cada quien ve solo
// los reportes de sus módulos y su alcance (lo decide la función de Netlify).
import { netoRenglon } from "../dominio/facturacion";
import type { Alcance } from "../dominio/permisos";
import { D, type Dec } from "../dominio/recetas";
import { margen, rotacion, variacionPrecio } from "../dominio/tablero";
import { ALCANCE, paramsAlcance } from "./inventarios-consultas";
import type { Cliente } from "./transaccion";

const m2 = (x: Dec) => x.toFixed(2);
const pct = (x: Dec | null) => (x === null ? null : x.toFixed(2));
const cero = () => new D(0);
const ZONA = "America/Mexico_City";
export const AGRUPACIONES = ["dia", "hora", "sucursal", "cajero", "sku", "familia"] as const;
export type Agrupacion = (typeof AGRUPACIONES)[number];

// ---------------------------------------------------------------------------
// Ventas (neto de devoluciones)
// ---------------------------------------------------------------------------
interface RenglonVendido {
  venta_id: string; dia: string; hora: number; sucursal: string; cajero: string; cajero_nombre: string; sku: string; sku_nombre: string;
  familia: string; familia_nombre: string; articulo_id: string; cantidad: Dec; neto_cantidad: Dec; base: Dec; total: Dec; costo: Dec; oferta: Dec; descuento: Dec;
}

async function renglonesVendidos(c: Cliente, a: Alcance, desde: string, hasta: string, sucursal: string | null): Promise<RenglonVendido[]> {
  const rows = (await c.query(
    `SELECT v.id AS venta_id, v.fecha_negocio::text AS dia, extract(hour FROM coalesce(v.fecha_caja, v.fecha) AT TIME ZONE '${ZONA}')::int AS hora,
            s.clave AS sucursal, u.usuario AS cajero, u.nombre AS cajero_nombre, ar.id AS articulo_id, ar.clave AS sku, ar.nombre AS sku_nombre,
            coalesce(f.clave, 'SIN-FAMILIA') AS familia, coalesce(f.nombre, 'Sin familia') AS familia_nombre,
            r.cantidad::text, r.cantidad_devuelta::text, r.importe::text, r.base::text, r.ieps::text, r.iva::text, r.costo_importe::text,
            r.descuento::text, r.descuento_oferta::text,
            coalesce((SELECT sum(dr.importe) FROM devolucion_renglon dr WHERE dr.venta_renglon_id = r.id), 0)::text AS devuelto
       FROM venta v JOIN venta_renglon r ON r.venta_id = v.id JOIN sucursal s ON s.id = v.sucursal_id JOIN usuario u ON u.id = v.cajero_id
       JOIN articulo ar ON ar.id = r.articulo_id LEFT JOIN familia f ON f.id = ar.familia_id
      WHERE v.fecha_negocio BETWEEN $1 AND $2 AND ($3::boolean OR v.sucursal_id = ANY($4::uuid[])) AND ($5::text IS NULL OR s.clave = upper($5))`,
    [desde, hasta, a.todas, a.sucursales, sucursal],
  )).rows;
  return rows.map((r) => {
    const cantidad = new D(r.cantidad);
    const neto = netoRenglon({
      articulo: r.sku, descripcion: r.sku_nombre, cantidad, importe: new D(r.importe), base: new D(r.base), ieps: new D(r.ieps), iva: new D(r.iva),
      tasaIva: null, tasaIeps: null, devuelto: new D(r.devuelto),
    });
    const netoCantidad = cantidad.minus(r.cantidad_devuelta);
    return {
      venta_id: r.venta_id, dia: r.dia, hora: r.hora, sucursal: r.sucursal, cajero: r.cajero, cajero_nombre: r.cajero_nombre, sku: r.sku, sku_nombre: r.sku_nombre,
      familia: r.familia, familia_nombre: r.familia_nombre, articulo_id: r.articulo_id, cantidad, neto_cantidad: netoCantidad, base: neto.base, total: neto.total,
      // El costo real de lo devuelto regresa al inventario: se descuenta en proporción a las piezas.
      costo: new D(r.costo_importe).mul(netoCantidad).div(cantidad), oferta: new D(r.descuento_oferta), descuento: new D(r.descuento),
    };
  });
}

const CLAVE: Record<Agrupacion, (r: RenglonVendido) => [string, string]> = {
  dia: (r) => [r.dia, r.dia],
  hora: (r) => [String(r.hora).padStart(2, "0"), `${String(r.hora).padStart(2, "0")}:00 a ${String(r.hora).padStart(2, "0")}:59`],
  sucursal: (r) => [r.sucursal, r.sucursal],
  cajero: (r) => [r.cajero, r.cajero_nombre],
  sku: (r) => [r.sku, r.sku_nombre],
  familia: (r) => [r.familia, r.familia_nombre],
};

export async function ventas(c: Cliente, a: Alcance, f: { desde: string; hasta: string; sucursal?: string | null; por: Agrupacion }) {
  const rs = await renglonesVendidos(c, a, f.desde, f.hasta, f.sucursal ?? null);
  const g = new Map<string, { clave: string; nombre: string; tickets: Set<string>; cantidad: Dec; base: Dec; total: Dec; oferta: Dec; descuento: Dec }>();
  for (const r of rs) {
    const [clave, nombre] = CLAVE[f.por](r);
    const x = g.get(clave) ?? { clave, nombre, tickets: new Set<string>(), cantidad: cero(), base: cero(), total: cero(), oferta: cero(), descuento: cero() };
    x.tickets.add(r.venta_id); x.cantidad = x.cantidad.plus(r.neto_cantidad); x.base = x.base.plus(r.base); x.total = x.total.plus(r.total);
    x.oferta = x.oferta.plus(r.oferta); x.descuento = x.descuento.plus(r.descuento);
    g.set(clave, x);
  }
  const total = rs.reduce((s, r) => s.plus(r.total), cero());
  const orden = f.por === "dia" || f.por === "hora" ? (a: { clave: string }, b: { clave: string }) => a.clave.localeCompare(b.clave) : (a: { total: Dec }, b: { total: Dec }) => b.total.comparedTo(a.total);
  const filas = [...g.values()].sort(orden as any).map((x) => ({
    clave: x.clave, nombre: x.nombre, tickets: x.tickets.size, cantidad: x.cantidad.toFixed(), venta_sin_impuestos: m2(x.base), venta: m2(x.total),
    ticket_promedio: f.por === "sku" || f.por === "familia" ? null : m2(x.total.div(x.tickets.size || 1)),
    descuento_oferta: m2(x.oferta), otros_descuentos: m2(x.descuento.minus(x.oferta)), participacion: total.isZero() ? "0.00" : x.total.div(total).mul(100).toFixed(2),
  }));
  const tickets = new Set(rs.map((r) => r.venta_id)).size;
  return {
    desde: f.desde, hasta: f.hasta, por: f.por, filas,
    totales: { tickets, venta: m2(total), venta_sin_impuestos: m2(rs.reduce((s, r) => s.plus(r.base), cero())), ticket_promedio: tickets ? m2(total.div(tickets)) : "0.00",
      descuento_oferta: m2(rs.reduce((s, r) => s.plus(r.oferta), cero())) },
  };
}

// ---------------------------------------------------------------------------
// Margen por SKU: contra el costo estándar (el último costeo guardado al cierre del
// periodo) y el real (costo de salida del kárdex)
// ---------------------------------------------------------------------------
export async function margenes(c: Cliente, a: Alcance, f: { desde: string; hasta: string; sucursal?: string | null }) {
  const rs = await renglonesVendidos(c, a, f.desde, f.hasta, f.sucursal ?? null);
  const estandar = new Map((await c.query(
    `SELECT DISTINCT ON (ce.articulo_id) ce.articulo_id, ce.costo_total::text, ce.completo, k.fecha::text
       FROM costo_estandar ce JOIN costeo k ON k.id = ce.costeo_id WHERE (k.creado_en AT TIME ZONE '${ZONA}')::date <= $1 ORDER BY ce.articulo_id, k.creado_en DESC`,
    [f.hasta],
  )).rows.map((x) => [x.articulo_id, x]));
  const g = new Map<string, { sku: string; nombre: string; familia: string; articulo_id: string; cantidad: Dec; base: Dec; real: Dec }>();
  for (const r of rs) {
    const x = g.get(r.sku) ?? { sku: r.sku, nombre: r.sku_nombre, familia: r.familia_nombre, articulo_id: r.articulo_id, cantidad: cero(), base: cero(), real: cero() };
    x.cantidad = x.cantidad.plus(r.neto_cantidad); x.base = x.base.plus(r.base); x.real = x.real.plus(r.costo);
    g.set(r.sku, x);
  }
  let tb = cero(), te = cero(), tr = cero(), sinEstandar = 0;
  const filas = [...g.values()].sort((a, b) => b.base.comparedTo(a.base)).map((x) => {
    const e = estandar.get(x.articulo_id);
    const costoEst = e ? new D(e.costo_total).mul(x.cantidad) : null;
    const mr = margen(x.base, x.real);
    const me = costoEst ? margen(x.base, costoEst) : null;
    tb = tb.plus(x.base); tr = tr.plus(x.real);
    if (costoEst) te = te.plus(costoEst); else sinEstandar++;
    return {
      sku: x.sku, nombre: x.nombre, familia: x.familia, cantidad: x.cantidad.toFixed(), venta_sin_impuestos: m2(x.base), precio_promedio: x.cantidad.isZero() ? null : x.base.div(x.cantidad).toFixed(4),
      costo_estandar_unitario: e ? new D(e.costo_total).toFixed(4) : null, costeo: e?.fecha ?? null, costo_estandar_completo: e?.completo ?? null,
      costo_estandar: costoEst ? m2(costoEst) : null, margen_estandar: me ? m2(me.margen) : null, margen_estandar_pct: me ? pct(me.pct) : null,
      costo_real: m2(x.real), margen_real: m2(mr.margen), margen_real_pct: pct(mr.pct),
      diferencia_costo: costoEst ? m2(x.real.minus(costoEst)) : null,
    };
  });
  const totReal = margen(tb, tr);
  return { desde: f.desde, hasta: f.hasta, filas, sin_estandar: sinEstandar,
    totales: { venta_sin_impuestos: m2(tb), costo_real: m2(tr), margen_real: m2(totReal.margen), margen_real_pct: pct(totReal.pct), costo_estandar: m2(te) } };
}

// ---------------------------------------------------------------------------
// Mermas por SKU y causa (inventario y producción)
// ---------------------------------------------------------------------------
export async function mermas(c: Cliente, a: Alcance, f: { desde: string; hasta: string }) {
  // Kárdex: movimientos de merma no cancelados (en almacenes del alcance).
  const inv = (await c.query(
    `SELECT ar.clave, ar.nombre, ar.tipo, coalesce(cm.clave, 'SIN-CAUSA') AS causa, coalesce(cm.nombre, 'Sin causa') AS causa_nombre, al.clave AS almacen,
            sum(-mr.cantidad)::text AS cantidad, sum(-mr.importe)::text AS valor, u.clave AS unidad
       FROM movimiento m JOIN movimiento_renglon mr ON mr.movimiento_id = m.id JOIN almacen al ON al.id = m.almacen_id
       JOIN articulo ar ON ar.id = mr.articulo_id JOIN unidad u ON u.id = ar.unidad_base_id LEFT JOIN causa_merma cm ON cm.id = mr.causa_id
      WHERE m.tipo = 'MERMA' AND m.cancelado_por_id IS NULL AND m.fecha_negocio BETWEEN $4 AND $5 AND ${ALCANCE("al")}
      GROUP BY ar.clave, ar.nombre, ar.tipo, cm.clave, cm.nombre, al.clave, u.clave`,
    [...paramsAlcance(a), f.desde, f.hasta],
  )).rows;
  // Producción: merma registrada en el avance por etapa (valuada al costo estándar).
  const prod = (await c.query(
    `SELECT ar.id AS articulo_id, ar.clave, ar.nombre, ar.tipo, cm.clave AS causa, cm.nombre AS causa_nombre, al.clave AS almacen, sum(oa.merma)::text AS cantidad, u.clave AS unidad,
            (SELECT ce.costo_total FROM costo_estandar ce JOIN costeo k ON k.id = ce.costeo_id WHERE ce.articulo_id = ar.id AND (k.creado_en AT TIME ZONE '${ZONA}')::date <= $5 ORDER BY k.creado_en DESC LIMIT 1)::text AS costo
       FROM orden_avance_vigente oa JOIN orden_produccion o ON o.id = oa.orden_id JOIN articulo ar ON ar.id = o.articulo_id JOIN unidad u ON u.id = ar.unidad_base_id
       JOIN causa_merma cm ON cm.id = oa.causa_id JOIN almacen al ON al.id = o.almacen_destino_id
      WHERE oa.merma > 0 AND o.estatus <> 'CANCELADA' AND (oa.creado_en AT TIME ZONE '${ZONA}')::date BETWEEN $4 AND $5 AND ${ALCANCE("al")}
      GROUP BY ar.id, ar.clave, ar.nombre, ar.tipo, cm.clave, cm.nombre, al.clave, u.clave`,
    [...paramsAlcance(a), f.desde, f.hasta],
  )).rows;
  const filas = [
    ...inv.map((x) => ({ origen: "Inventario", sku: x.clave, nombre: x.nombre, tipo: x.tipo, causa: x.causa, causa_nombre: x.causa_nombre, almacen: x.almacen, unidad: x.unidad,
      cantidad: new D(x.cantidad).toFixed(), valor: m2(new D(x.valor)), valuacion: "Costo real (kárdex)" })),
    ...prod.map((x) => ({ origen: "Producción", sku: x.clave, nombre: x.nombre, tipo: x.tipo, causa: x.causa, causa_nombre: x.causa_nombre, almacen: x.almacen, unidad: x.unidad,
      cantidad: new D(x.cantidad).toFixed(), valor: x.costo ? m2(new D(x.costo).mul(x.cantidad)) : null, valuacion: x.costo ? "Costo estándar" : "Sin costo estándar" })),
  ].sort((a, b) => Number(b.valor ?? 0) - Number(a.valor ?? 0));
  const sumar = (clave: (x: (typeof filas)[number]) => string, nombre: (x: (typeof filas)[number]) => string) => {
    const m = new Map<string, { clave: string; nombre: string; valor: Dec; registros: number }>();
    for (const x of filas) {
      const k = clave(x);
      const y = m.get(k) ?? { clave: k, nombre: nombre(x), valor: cero(), registros: 0 };
      y.valor = y.valor.plus(x.valor ?? 0); y.registros++;
      m.set(k, y);
    }
    return [...m.values()].sort((a, b) => b.valor.comparedTo(a.valor)).map((y) => ({ ...y, valor: m2(y.valor) }));
  };
  return {
    desde: f.desde, hasta: f.hasta, filas,
    por_causa: sumar((x) => x.causa, (x) => x.causa_nombre), por_sku: sumar((x) => x.sku, (x) => x.nombre),
    total: m2(filas.reduce((s, x) => s.plus(x.valor ?? 0), cero())),
  };
}

// ---------------------------------------------------------------------------
// Rotación y días de inventario (materia prima y producto terminado)
// ---------------------------------------------------------------------------
const SALIDAS: Record<"MP" | "PT", string[]> = {
  MP: ["SURTIDO_SALIDA", "MERMA", "AJUSTE_SALIDA"],
  PT: ["VENTA", "MERMA", "AJUSTE_SALIDA"],
};

export async function rotaciones(c: Cliente, a: Alcance, f: { desde: string; hasta: string; grupo: "MP" | "PT" }) {
  const dias = Math.round((Date.parse(`${f.hasta}T00:00:00Z`) - Date.parse(`${f.desde}T00:00:00Z`)) / 86_400_000) + 1;
  const rows = (await c.query(
    `WITH alm AS (SELECT al.id, al.clave FROM almacen al WHERE al.tipo = $4 AND ${ALCANCE("al")}),
     saldo AS (
       SELECT DISTINCT ON (mr.almacen_id, mr.articulo_id, corte) mr.almacen_id, mr.articulo_id, corte, mr.saldo_cantidad, mr.saldo_valor
         FROM movimiento_renglon mr JOIN movimiento m ON m.id = mr.movimiento_id JOIN alm ON alm.id = mr.almacen_id
        CROSS JOIN LATERAL (VALUES ('I', $5::date - 1), ('F', $6::date)) AS c(corte, fecha)
        WHERE m.fecha_negocio <= c.fecha
        ORDER BY mr.almacen_id, mr.articulo_id, corte, mr.consecutivo DESC),
     sal AS (
       SELECT mr.almacen_id, mr.articulo_id, sum(-mr.cantidad) AS cantidad, sum(-mr.importe) AS valor
         FROM movimiento_renglon mr JOIN movimiento m ON m.id = mr.movimiento_id JOIN alm ON alm.id = mr.almacen_id
        WHERE m.tipo = ANY($7) AND m.cancelado_por_id IS NULL AND mr.cantidad < 0 AND m.fecha_negocio BETWEEN $5 AND $6
        GROUP BY mr.almacen_id, mr.articulo_id),
     llaves AS (SELECT almacen_id, articulo_id FROM saldo UNION SELECT almacen_id, articulo_id FROM sal)
     SELECT alm.clave AS almacen, ar.clave, ar.nombre, u.clave AS unidad,
            coalesce(i.saldo_cantidad, 0)::text AS inicial_cantidad, coalesce(i.saldo_valor, 0)::text AS inicial_valor,
            coalesce(fi.saldo_cantidad, 0)::text AS final_cantidad, coalesce(fi.saldo_valor, 0)::text AS final_valor,
            coalesce(sal.cantidad, 0)::text AS salidas_cantidad, coalesce(sal.valor, 0)::text AS salidas_valor
       FROM llaves k JOIN alm ON alm.id = k.almacen_id JOIN articulo ar ON ar.id = k.articulo_id JOIN unidad u ON u.id = ar.unidad_base_id
       LEFT JOIN saldo i ON i.almacen_id = k.almacen_id AND i.articulo_id = k.articulo_id AND i.corte = 'I'
       LEFT JOIN saldo fi ON fi.almacen_id = k.almacen_id AND fi.articulo_id = k.articulo_id AND fi.corte = 'F'
       LEFT JOIN sal ON sal.almacen_id = k.almacen_id AND sal.articulo_id = k.articulo_id
      ORDER BY alm.clave, ar.nombre`,
    [...paramsAlcance(a), f.grupo, f.desde, f.hasta, SALIDAS[f.grupo]],
  )).rows;
  const filas = rows.map((x) => {
    const rc = rotacion(new D(x.inicial_cantidad), new D(x.final_cantidad), new D(x.salidas_cantidad), dias);
    const rv = rotacion(new D(x.inicial_valor), new D(x.final_valor), new D(x.salidas_valor), dias);
    return {
      almacen: x.almacen, sku: x.clave, nombre: x.nombre, unidad: x.unidad,
      inicial_cantidad: new D(x.inicial_cantidad).toFixed(), final_cantidad: new D(x.final_cantidad).toFixed(), salidas_cantidad: new D(x.salidas_cantidad).toFixed(),
      inicial_valor: m2(new D(x.inicial_valor)), final_valor: m2(new D(x.final_valor)), salidas_valor: m2(new D(x.salidas_valor)),
      // Por artículo se mide en cantidad; el total del almacén, en valor.
      rotacion: rc.rotacion?.toFixed(2) ?? null, dias: rc.dias?.toFixed(1) ?? null, sin_movimiento: new D(x.salidas_cantidad).lte(0) && rc.promedio.gt(0),
      _rv: rv,
    };
  });
  const totales = [...new Set(filas.map((x) => x.almacen))].map((almacen) => {
    const xs = filas.filter((x) => x.almacen === almacen);
    const s = (k: "inicial_valor" | "final_valor" | "salidas_valor") => xs.reduce((t, x) => t.plus(x[k]), cero());
    const r = rotacion(s("inicial_valor"), s("final_valor"), s("salidas_valor"), dias);
    return { almacen, inicial_valor: m2(s("inicial_valor")), final_valor: m2(s("final_valor")), salidas_valor: m2(s("salidas_valor")), promedio_valor: m2(r.promedio),
      rotacion: r.rotacion?.toFixed(2) ?? null, dias: r.dias?.toFixed(1) ?? null };
  });
  return { desde: f.desde, hasta: f.hasta, grupo: f.grupo, dias_periodo: dias, filas: filas.map(({ _rv, ...x }) => x), totales };
}

// ---------------------------------------------------------------------------
// Compras por proveedor y variación de precios de insumos
// ---------------------------------------------------------------------------
export async function compras(c: Cliente, a: Alcance, f: { desde: string; hasta: string }) {
  const rows = (await c.query(
    `SELECT p.clave AS proveedor, p.razon_social, ar.clave, ar.nombre, u.clave AS unidad, m.fecha_negocio::text AS fecha, m.folio,
            mr.cantidad::text, mr.costo_unitario::text, mr.importe::text
       FROM movimiento m JOIN movimiento_renglon mr ON mr.movimiento_id = m.id JOIN almacen al ON al.id = m.almacen_id
       JOIN articulo ar ON ar.id = mr.articulo_id JOIN unidad u ON u.id = ar.unidad_base_id LEFT JOIN proveedor p ON p.id = m.proveedor_id
      WHERE m.tipo = 'ENTRADA_COMPRA' AND m.cancelado_por_id IS NULL AND mr.cantidad > 0 AND m.fecha_negocio BETWEEN $4 AND $5 AND ${ALCANCE("al")}
      ORDER BY m.fecha_negocio, mr.consecutivo`,
    [...paramsAlcance(a), f.desde, f.hasta],
  )).rows;
  const prov = new Map<string, { proveedor: string; nombre: string; importe: Dec; entradas: Set<string>; insumos: Set<string> }>();
  const ins = new Map<string, { clave: string; nombre: string; unidad: string; proveedores: Set<string>; compras: { fecha: string; cantidad: Dec; costoUnitario: Dec }[] }>();
  for (const r of rows) {
    const pk = r.proveedor ?? "SIN-PROVEEDOR";
    const p = prov.get(pk) ?? { proveedor: pk, nombre: r.razon_social ?? "Sin proveedor", importe: cero(), entradas: new Set<string>(), insumos: new Set<string>() };
    p.importe = p.importe.plus(r.importe); p.entradas.add(r.folio); p.insumos.add(r.clave);
    prov.set(pk, p);
    const i = ins.get(r.clave) ?? { clave: r.clave, nombre: r.nombre, unidad: r.unidad, proveedores: new Set<string>(), compras: [] as { fecha: string; cantidad: Dec; costoUnitario: Dec }[] };
    i.proveedores.add(pk); i.compras.push({ fecha: r.fecha, cantidad: new D(r.cantidad), costoUnitario: new D(r.costo_unitario) });
    ins.set(r.clave, i);
  }
  const total = [...prov.values()].reduce((s, p) => s.plus(p.importe), cero());
  const proveedores = [...prov.values()].sort((a, b) => b.importe.comparedTo(a.importe)).map((p) => ({
    proveedor: p.proveedor, nombre: p.nombre, importe: m2(p.importe), entradas: p.entradas.size, insumos: p.insumos.size,
    participacion: total.isZero() ? "0.00" : p.importe.div(total).mul(100).toFixed(2),
  }));
  // Insumos clave: los de mayor importe comprado primero.
  const insumos = [...ins.values()].map((i) => ({ i, v: variacionPrecio(i.compras)! })).sort((a, b) => b.v.importe.comparedTo(a.v.importe)).map(({ i, v }, n) => ({
    lugar: n + 1, clave: i.clave, nombre: i.nombre, unidad: i.unidad, proveedores: [...i.proveedores].join(", "), compras: v.compras, cantidad: v.cantidad.toFixed(),
    importe: m2(v.importe), primero: v.primero.toFixed(4), ultimo: v.ultimo.toFixed(4), minimo: v.minimo.toFixed(4), maximo: v.maximo.toFixed(4),
    promedio: v.promedio.toFixed(4), variacion_pct: pct(v.variacionPct),
  }));
  return { desde: f.desde, hasta: f.hasta, total: m2(total), proveedores, insumos };
}

// ---------------------------------------------------------------------------
// Tablero: resumen del periodo
// ---------------------------------------------------------------------------
export async function resumen(c: Cliente, a: Alcance, f: { desde: string; hasta: string }, ve: { ventas: boolean; costos: boolean; mermas: boolean; compras: boolean }) {
  const r: Record<string, unknown> = { desde: f.desde, hasta: f.hasta };
  if (ve.ventas) {
    const v = await ventas(c, a, { ...f, por: "dia" });
    r.ventas = { ...v.totales, por_dia: v.filas.map((x) => ({ dia: x.clave, venta: x.venta, tickets: x.tickets })) };
    r.por_hora = (await ventas(c, a, { ...f, por: "hora" })).filas.map((x) => ({ hora: x.clave, venta: x.venta, tickets: x.tickets }));
    r.top_sku = (await ventas(c, a, { ...f, por: "sku" })).filas.slice(0, 5).map((x) => ({ sku: x.clave, nombre: x.nombre, venta: x.venta, cantidad: x.cantidad }));
    if (ve.costos) r.margen = (await margenes(c, a, f)).totales;
  }
  if (ve.mermas) {
    const mm = await mermas(c, a, f);
    r.mermas = { total: mm.total, por_causa: mm.por_causa.slice(0, 5) };
  }
  if (ve.compras) {
    const cc = await compras(c, a, f);
    r.compras = { total: cc.total, alzas: cc.insumos.filter((x) => Number(x.variacion_pct ?? 0) > 0).sort((a, b) => Number(b.variacion_pct) - Number(a.variacion_pct)).slice(0, 5) };
  }
  return r;
}
