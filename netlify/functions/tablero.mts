// Tablero y reportes de gestión (4.10). Cada quien ve solo los reportes de sus
// módulos y de su alcance (sucursales y almacenes); costos y márgenes solo con
// el permiso de datos sensibles. Todo se exporta a Excel.
import type { Config, Context } from "@netlify/functions";
import { invalido, prohibido } from "../../src/servidor/errores";
import { libroExcel, respuestaExcel, type Hoja } from "../../src/servidor/excel";
import { hoyNegocio } from "../../src/servidor/fechas";
import { fechaParam } from "../../src/servidor/inventarios-consultas";
import { ruta, type ContextoAutenticado } from "../../src/servidor/ruta";
import * as t from "../../src/servidor/tablero";

/** Qué reportes ve cada quien (según los módulos que maneja). */
export function reportesVisibles(ctx: Pick<ContextoAutenticado, "puede">) {
  const costos = ctx.puede("datos.costos:ver");
  const ventas = ctx.puede(["pos.ventas:ver", "contabilidad.reportes:ver", "produccion.plan:ver"]);
  return {
    ventas, costos,
    margen: ventas && costos,
    mermas: ctx.puede(["produccion.mermas:ver", "inventarios.merma_sucursal:ver", "contabilidad.reportes:ver"]),
    rotacion: ctx.puede("inventarios.existencias:ver"),
    compras: costos && ctx.puede(["compras.ordenes:ver", "compras.facturas:ver", "contabilidad.reportes:ver"]),
    exportar: ctx.puede("reportes.tablero:exportar"),
  };
}

const n = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(x));
const col = (titulo: string, clave: string, ancho?: number) => ({ titulo, clave, ...(ancho ? { ancho } : {}) });
const num = <T extends Record<string, unknown>>(filas: T[], claves: string[]) => filas.map((f) => ({ ...f, ...Object.fromEntries(claves.map((k) => [k, n(f[k])])) }));

const manejador = ruta({ permiso: "reportes.tablero:ver", metodos: ["GET"] }, async (ctx) => {
  const { reporte } = ctx.params;
  const sp = ctx.url.searchParams;
  const ve = reportesVisibles(ctx);
  const a = ctx.usuario.alcance;
  const hoy = await ctx.tx((c) => hoyNegocio(c));
  const desde = fechaParam(sp.get("desde"), "Desde") ?? `${hoy.slice(0, 8)}01`;
  const hasta = fechaParam(sp.get("hasta"), "Hasta") ?? hoy;
  if (desde > hasta) throw invalido("La fecha inicial es posterior a la final.");
  if ((Date.parse(hasta) - Date.parse(desde)) / 86_400_000 > 400) throw invalido("El periodo es de máximo 400 días.");
  const xlsx = sp.get("formato") === "xlsx";
  if (xlsx && !ve.exportar) throw prohibido("No tienes permiso para exportar reportes.");
  const exigir = (ok: boolean) => { if (!ok) throw prohibido("Ese reporte no es de tus módulos."); };
  const excel = async (hojas: Hoja[], titulo: string, archivo: string) => respuestaExcel(await libroExcel(hojas, titulo), `${archivo}-${desde}-${hasta}.xlsx`);

  if (reporte === "opciones") {
    return ctx.tx(async (c) => ({
      hoy, visibles: ve,
      sucursales: (await c.query("SELECT clave, nombre FROM sucursal WHERE activo AND vende_al_publico AND ($1::boolean OR id = ANY($2::uuid[])) ORDER BY clave", [a.todas, a.sucursales])).rows,
    }));
  }

  if (reporte === "resumen") {
    return ctx.tx((c) => t.resumen(c, a, { desde, hasta }, { ventas: ve.ventas, costos: ve.margen, mermas: ve.mermas, compras: ve.compras }));
  }

  if (reporte === "ventas") {
    exigir(ve.ventas);
    const por = (sp.get("por") ?? "dia") as t.Agrupacion;
    if (!t.AGRUPACIONES.includes(por)) throw invalido("Agrupación no válida.");
    const r = await ctx.tx((c) => t.ventas(c, a, { desde, hasta, sucursal: sp.get("sucursal"), por }));
    if (!xlsx) return r;
    const titulo: Record<t.Agrupacion, string> = { dia: "Día", hora: "Hora", sucursal: "Sucursal", cajero: "Cajero", sku: "Producto", familia: "Familia" };
    return excel([{ nombre: "Ventas", columnas: [col(titulo[por], "clave"), col("Nombre", "nombre", 30), col("Tickets", "tickets"), col("Cantidad", "cantidad"),
      col("Venta sin impuestos", "venta_sin_impuestos"), col("Venta", "venta"), col("Ticket promedio", "ticket_promedio"), col("Descuento de oferta", "descuento_oferta"),
      col("Otros descuentos", "otros_descuentos"), col("% del total", "participacion")],
    filas: num(r.filas, ["cantidad", "venta_sin_impuestos", "venta", "ticket_promedio", "descuento_oferta", "otros_descuentos", "participacion"]) }], `Ventas por ${titulo[por].toLowerCase()}`, `ventas-${por}`);
  }

  if (reporte === "margen") {
    exigir(ve.margen);
    const r = await ctx.tx((c) => t.margenes(c, a, { desde, hasta, sucursal: sp.get("sucursal") }));
    if (!xlsx) return r;
    return excel([{ nombre: "Margen por SKU", columnas: [col("SKU", "sku"), col("Producto", "nombre", 30), col("Familia", "familia"), col("Cantidad", "cantidad"),
      col("Venta sin impuestos", "venta_sin_impuestos"), col("Precio promedio", "precio_promedio"), col("Costo estándar unitario", "costo_estandar_unitario"), col("Costeo del", "costeo"),
      col("Costo estándar", "costo_estandar"), col("Margen estándar", "margen_estandar"), col("% margen estándar", "margen_estandar_pct"),
      col("Costo real", "costo_real"), col("Margen real", "margen_real"), col("% margen real", "margen_real_pct"), col("Real − estándar", "diferencia_costo")],
    filas: num(r.filas, ["cantidad", "venta_sin_impuestos", "precio_promedio", "costo_estandar_unitario", "costo_estandar", "margen_estandar", "margen_estandar_pct", "costo_real", "margen_real", "margen_real_pct", "diferencia_costo"]) }], "Margen por SKU", "margen");
  }

  if (reporte === "mermas") {
    exigir(ve.mermas);
    const r = await ctx.tx((c) => t.mermas(c, a, { desde, hasta }));
    // Sin permiso de costos se ven cantidades, no valores.
    if (!ve.costos) Object.assign(r, { filas: r.filas.map((x) => ({ ...x, valor: null })), por_causa: r.por_causa.map((x) => ({ ...x, valor: null })), por_sku: r.por_sku.map((x) => ({ ...x, valor: null })), total: null });
    if (!xlsx) return r;
    return excel([
      { nombre: "Mermas", columnas: [col("Origen", "origen"), col("Almacén", "almacen"), col("SKU", "sku"), col("Producto", "nombre", 30), col("Causa", "causa_nombre", 24), col("Cantidad", "cantidad"), col("Unidad", "unidad"), col("Valor", "valor"), col("Valuación", "valuacion")], filas: num(r.filas, ["cantidad", "valor"]) },
      { nombre: "Por causa", columnas: [col("Causa", "nombre", 30), col("Registros", "registros"), col("Valor", "valor")], filas: num(r.por_causa, ["valor"]) },
      { nombre: "Por SKU", columnas: [col("SKU", "clave"), col("Producto", "nombre", 30), col("Registros", "registros"), col("Valor", "valor")], filas: num(r.por_sku, ["valor"]) },
    ], "Mermas", "mermas");
  }

  if (reporte === "rotacion") {
    exigir(ve.rotacion);
    const grupo = sp.get("grupo") === "PT" ? "PT" : "MP";
    const r = await ctx.tx((c) => t.rotaciones(c, a, { desde, hasta, grupo }));
    if (!ve.costos) Object.assign(r, { filas: r.filas.map((x) => ({ ...x, inicial_valor: null, final_valor: null, salidas_valor: null })), totales: [] });
    if (!xlsx) return r;
    return excel([
      { nombre: "Por artículo", columnas: [col("Almacén", "almacen"), col("Clave", "sku"), col("Artículo", "nombre", 30), col("Unidad", "unidad"), col("Inicial", "inicial_cantidad"), col("Final", "final_cantidad"),
        col("Salidas", "salidas_cantidad"), col("Rotación", "rotacion"), col("Días de inventario", "dias"), col("Valor inicial", "inicial_valor"), col("Valor final", "final_valor"), col("Costo de salidas", "salidas_valor")],
      filas: num(r.filas, ["inicial_cantidad", "final_cantidad", "salidas_cantidad", "rotacion", "dias", "inicial_valor", "final_valor", "salidas_valor"]) },
      ...(r.totales.length ? [{ nombre: "Por almacén", columnas: [col("Almacén", "almacen"), col("Valor inicial", "inicial_valor"), col("Valor final", "final_valor"), col("Promedio", "promedio_valor"), col("Costo de salidas", "salidas_valor"), col("Rotación", "rotacion"), col("Días de inventario", "dias")],
        filas: num(r.totales, ["inicial_valor", "final_valor", "promedio_valor", "salidas_valor", "rotacion", "dias"]) }] : []),
    ], `Rotación de ${grupo === "MP" ? "materia prima" : "producto terminado"}`, `rotacion-${grupo}`);
  }

  if (reporte === "compras") {
    exigir(ve.compras);
    const r = await ctx.tx((c) => t.compras(c, a, { desde, hasta }));
    if (!xlsx) return r;
    return excel([
      { nombre: "Por proveedor", columnas: [col("Proveedor", "proveedor"), col("Razón social", "nombre", 34), col("Importe", "importe"), col("% del total", "participacion"), col("Entradas", "entradas"), col("Insumos", "insumos")], filas: num(r.proveedores, ["importe", "participacion"]) },
      { nombre: "Precios de insumos", columnas: [col("Lugar", "lugar"), col("Clave", "clave"), col("Insumo", "nombre", 30), col("Unidad", "unidad"), col("Proveedores", "proveedores"), col("Compras", "compras"),
        col("Cantidad", "cantidad"), col("Importe", "importe"), col("Primer precio", "primero"), col("Último precio", "ultimo"), col("Mínimo", "minimo"), col("Máximo", "maximo"), col("Promedio", "promedio"), col("Variación %", "variacion_pct")],
      filas: num(r.insumos, ["cantidad", "importe", "primero", "ultimo", "minimo", "maximo", "promedio", "variacion_pct"]) },
    ], "Compras y precios de insumos", "compras");
  }

  throw invalido("Reporte no reconocido.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: "/api/tablero/:reporte" };
export { manejador };
