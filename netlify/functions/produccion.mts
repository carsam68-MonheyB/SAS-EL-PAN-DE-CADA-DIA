// Producción y costos (Fase 5): órdenes de producción N1/N2 (desde el plan o a
// mano), vales de surtido por orden, avance por etapa, cierre con costo real,
// balance de masa y piezas, trazabilidad por lote, variaciones, rendimiento,
// sobrantes y estado de costo de producción y ventas. Cada acción valida su
// permiso y el alcance del usuario sobre el almacén de producción.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { invalido, noEncontrado } from "../../src/servidor/errores";
import { libroExcel, respuestaExcel } from "../../src/servidor/excel";
import { hoyNegocio } from "../../src/servidor/fechas";
import { leerCuerpo } from "../../src/servidor/http";
import { fechaParam } from "../../src/servidor/inventarios-consultas";
import * as p from "../../src/servidor/produccion";
import { ruta } from "../../src/servidor/ruta";

const NUM = z.string().trim().regex(/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/, "Número no válido (punto decimal).");
const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD.");
const TEXTO = (n: number) => z.string().trim().max(n).optional().nullable();
const CLAVE = z.string().trim().min(1).max(30);

// Sin permiso de ver costos se ocultan importes, costos y la parte en pesos del balance.
const CAMPOS_COSTO = new Set([
  "costo_mp", "costo_mod", "costo_gif", "costo_total", "costo_unitario", "costo_estandar", "importe", "importe_real", "importe_estandar",
  "variacion", "variacion_cantidad", "variacion_precio", "total_estandar", "valor", "mod", "gif", "total",
]);
function sinCostos<T>(x: T): T {
  if (Array.isArray(x)) return x.map(sinCostos) as T;
  if (x && typeof x === "object" && !(x instanceof Date)) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, CAMPOS_COSTO.has(k) ? null : sinCostos(v)])) as T;
  return x;
}

const manejador = ruta({ permiso: ["produccion.ordenes:ver", "produccion.ordenes:crear"] }, async (ctx) => {
  const { recurso, id, accion } = ctx.params;
  const m = ctx.req.method;
  const u = ctx.usuario;
  const a = u.alcance;
  const sp = ctx.url.searchParams;
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw noEncontrado();
  const verCostos = ctx.puede("datos.costos:ver");
  const salida = <T,>(x: T) => (verCostos ? x : sinCostos(x));
  const periodo = async () => {
    const hoy = await ctx.tx((c) => hoyNegocio(c));
    const desde = fechaParam(sp.get("desde"), "Desde") ?? `${hoy.slice(0, 8)}01`;
    const hasta = fechaParam(sp.get("hasta"), "Hasta") ?? hoy;
    if (desde > hasta) throw invalido("La fecha inicial es posterior a la final.");
    return { desde, hasta };
  };

  // ---- Opciones para las pantallas ----
  if (recurso === "opciones" && m === "GET") {
    return ctx.tx(async (c) => ({
      almacenes: (await c.query(
        `SELECT al.clave, al.nombre, al.tipo, s.clave AS sucursal FROM almacen al JOIN sucursal s ON s.id = al.sucursal_id
          WHERE al.activo AND al.tipo IN ('MP', 'INS', 'PEP') AND ($1::boolean OR al.id = ANY($2::uuid[]) OR al.sucursal_id = ANY($3::uuid[])) ORDER BY al.tipo, al.clave`,
        [a.todas, a.almacenes, a.sucursales],
      )).rows,
      articulos: (await c.query("SELECT a.clave, a.nombre, a.tipo, u.clave AS unidad FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id WHERE a.activo AND a.tipo IN ('INTERMEDIO', 'SKU') ORDER BY a.tipo, a.clave")).rows,
      etapas: (await c.query("SELECT clave, nombre, registra_merma FROM etapa_produccion WHERE activo ORDER BY orden")).rows,
      causas: (await c.query("SELECT clave, nombre FROM causa_merma WHERE activo AND aplica IN ('MP', 'TODOS') ORDER BY clave")).rows,
      planes: (await c.query(
        `SELECT pl.id, pl.folio, pl.fecha::text, (SELECT count(*)::int FROM orden_produccion o WHERE o.plan_id = pl.id AND o.estatus <> 'CANCELADA') AS ordenes
           FROM plan_produccion pl WHERE pl.estatus = 'APROBADO' ORDER BY pl.fecha DESC LIMIT 50`,
      )).rows,
      ver_costos: verCostos,
      puede: {
        crear: ctx.puede("produccion.ordenes:crear"), avance: ctx.puede("produccion.ordenes:editar"), cerrar: ctx.puede("produccion.ordenes:cerrar"),
        cancelar: ctx.puede("produccion.ordenes:cancelar"), surtir: ctx.puede("inventarios.surtido:crear"), reportes: ctx.puede("produccion.ordenes:ver") && verCostos,
      },
    }));
  }

  // ---- Órdenes ----
  if (recurso === "ordenes") {
    if (!id && m === "GET") {
      ctx.exigir("produccion.ordenes:ver");
      return ctx.tx(async (c) => salida({ ordenes: await p.listarOrdenes(c, a, { desde: fechaParam(sp.get("desde"), "Desde"), hasta: fechaParam(sp.get("hasta"), "Hasta"), estatus: sp.get("estatus"), plan_id: sp.get("plan") }) }));
    }
    if (!id && m === "POST") {
      ctx.exigir("produccion.ordenes:crear");
      const d = await leerCuerpo(ctx.req, z.object({ articulo: CLAVE, cantidad: NUM, fecha: FECHA.optional().nullable(), almacen: z.string().max(20), comentario: TEXTO(300) }));
      return ctx.tx((c) => p.crearOrden(c, u, d));
    }
    if (id && !accion && m === "GET") {
      ctx.exigir("produccion.ordenes:ver");
      return ctx.tx(async (c) => salida(await p.detalleOrden(c, a, id)));
    }
    if (id && accion === "surtir" && m === "POST") {
      ctx.exigir("inventarios.surtido:crear");
      const d = await leerCuerpo(ctx.req, z.object({
        origen: z.string().max(20), motivo: TEXTO(300),
        renglones: z.array(z.object({ articulo: CLAVE, cantidad: NUM, lote: TEXTO(40) })).min(1, "Captura al menos un renglón.").max(200),
      }));
      return ctx.tx((c) => p.surtirOrden(c, u, id, d));
    }
    if (id && accion === "avance" && m === "POST") {
      ctx.exigir("produccion.ordenes:editar");
      const d = await leerCuerpo(ctx.req, z.object({ etapa: CLAVE, cantidad: NUM.optional().nullable(), merma: NUM.optional().nullable(), causa: TEXTO(20), minutos: NUM.optional().nullable(), comentario: TEXTO(300) }));
      return ctx.tx((c) => p.registrarAvance(c, u, id, d));
    }
    if (id && accion === "cerrar" && m === "POST") {
      ctx.exigir("produccion.ordenes:cerrar");
      const d = await leerCuerpo(ctx.req, z.object({
        cantidad: NUM, piezas_formadas: NUM.optional().nullable(), justificacion: TEXTO(500),
        consumos: z.array(z.object({ articulo: CLAVE, cantidad: NUM })).max(200).optional().nullable(),
        minutos: z.array(z.object({ etapa: CLAVE, minutos: NUM })).max(50).optional().nullable(),
      }));
      return ctx.tx(async (c) => salida(await p.cerrarOrden(c, u, id, d)));
    }
    if (id && accion === "cancelar" && m === "POST") {
      ctx.exigir("produccion.ordenes:cancelar");
      const d = await leerCuerpo(ctx.req, z.object({ motivo: z.string().trim().min(3, "Escribe el motivo.").max(300) }));
      return ctx.tx((c) => p.cancelarOrden(c, u, id, d.motivo));
    }
  }

  // ---- Generar las órdenes de un plan aprobado ----
  if (recurso === "planes" && id && accion === "generar" && m === "POST") {
    ctx.exigir("produccion.ordenes:crear");
    const d = await leerCuerpo(ctx.req, z.object({ almacen: TEXTO(20) }));
    return ctx.tx((c) => p.generarOrdenes(c, u, id, d.almacen));
  }

  // ---- Trazabilidad y sobrantes ----
  if (recurso === "trazabilidad" && m === "GET") {
    ctx.exigir("produccion.ordenes:ver");
    return ctx.tx((c) => p.trazabilidad(c, a, { lote: sp.get("lote"), orden: sp.get("orden") }));
  }
  if (recurso === "sobrantes" && m === "GET") {
    ctx.exigir("produccion.ordenes:ver");
    return ctx.tx(async (c) => salida({ sobrantes: await p.sobrantes(c, a) }));
  }

  // ---- Reportes de costos (requieren ver costos) ----
  if (["variaciones", "rendimiento", "estado-costos"].includes(recurso ?? "") && m === "GET") {
    ctx.exigir("produccion.ordenes:ver");
    const { desde, hasta } = await periodo();
    const xlsx = sp.get("formato") === "xlsx";
    if (recurso === "rendimiento") {
      const r = await ctx.tx((c) => p.rendimiento(c, a, desde, hasta));
      if (!xlsx) return { desde, hasta, ...r };
      ctx.exigir("produccion.ordenes:exportar");
      return respuestaExcel(await libroExcel([
        { nombre: "Por producto", columnas: [{ titulo: "Producto", clave: "clave" }, { titulo: "Nombre", clave: "nombre" }, { titulo: "Nivel", clave: "nivel" }, { titulo: "Unidad", clave: "unidad" }, { titulo: "Órdenes", clave: "ordenes" }, { titulo: "Planeado", clave: "planeado" }, { titulo: "Real", clave: "real" }, { titulo: "Formadas", clave: "formadas" }, { titulo: "Merma", clave: "merma" }, { titulo: "Cumplimiento %", clave: "cumplimiento_pct" }], filas: r.productos },
        { nombre: "Merma por causa", columnas: [{ titulo: "Etapa", clave: "etapa" }, { titulo: "Causa", clave: "causa" }, { titulo: "Producto", clave: "producto" }, { titulo: "Merma", clave: "merma" }], filas: r.por_causa },
        { nombre: "Por persona", columnas: [{ titulo: "Usuario", clave: "usuario" }, { titulo: "Nombre", clave: "nombre" }, { titulo: "Órdenes", clave: "ordenes" }, { titulo: "Cantidad", clave: "cantidad" }, { titulo: "Merma", clave: "merma" }, { titulo: "Merma %", clave: "merma_pct" }], filas: r.por_persona },
        { nombre: "Por turno", columnas: [{ titulo: "Turno", clave: "turno" }, { titulo: "Órdenes", clave: "ordenes" }, { titulo: "Piezas", clave: "piezas" }, { titulo: "Merma", clave: "merma" }], filas: r.por_turno },
      ], "Rendimiento y merma"), `rendimiento-${desde}-${hasta}.xlsx`);
    }
    ctx.exigir("datos.costos:ver");
    if (recurso === "variaciones") {
      const r = await ctx.tx((c) => p.variaciones(c, a, desde, hasta));
      if (!xlsx) return { desde, hasta, ...r };
      ctx.exigir("produccion.ordenes:exportar");
      return respuestaExcel(await libroExcel([
        { nombre: "Órdenes", columnas: [{ titulo: "Folio", clave: "folio" }, { titulo: "Fecha", clave: "fecha" }, { titulo: "Producto", clave: "articulo" }, { titulo: "Unidad", clave: "unidad" }, { titulo: "Planeado", clave: "cantidad_plan" }, { titulo: "Real", clave: "cantidad_real" }, { titulo: "Materiales", clave: "costo_mp" }, { titulo: "Mano de obra", clave: "costo_mod" }, { titulo: "Indirectos", clave: "costo_gif" }, { titulo: "Costo real", clave: "costo_total" }, { titulo: "Costo estándar", clave: "total_estandar" }, { titulo: "Variación", clave: "variacion" }, { titulo: "Fuera de tolerancia", clave: "fuera_tolerancia" }, { titulo: "Justificación", clave: "justificacion" }], filas: r.ordenes },
        { nombre: "Materiales", columnas: [{ titulo: "Material", clave: "clave" }, { titulo: "Nombre", clave: "nombre" }, { titulo: "Unidad", clave: "unidad" }, { titulo: "Estándar", clave: "estandar" }, { titulo: "Real", clave: "real" }, { titulo: "Importe estándar", clave: "importe_estandar" }, { titulo: "Importe real", clave: "importe_real" }, { titulo: "Variación por cantidad", clave: "variacion_cantidad" }, { titulo: "Variación por precio", clave: "variacion_precio" }], filas: r.materiales },
      ], "Variaciones de producción"), `variaciones-${desde}-${hasta}.xlsx`);
    }
    const r = await ctx.tx((c) => p.estadoDeCostos(c, a, desde, hasta, sp.get("sucursal")));
    if (!xlsx) return r;
    ctx.exigir("produccion.ordenes:exportar");
    return respuestaExcel(await libroExcel([
      { nombre: "Estado de costos", columnas: [{ titulo: "Concepto", clave: "concepto" }, { titulo: "Importe", clave: "importe" }], filas: r.lineas },
      { nombre: "Comprobaciones", columnas: [{ titulo: "Comprobación", clave: "concepto" }, { titulo: "Diferencia", clave: "diferencia" }], filas: r.comprobaciones },
    ], "Estado de costo de producción y ventas"), `estado-costos-${desde}-${hasta}.xlsx`);
  }

  throw invalido("Operación no reconocida.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/produccion/:recurso", "/api/produccion/:recurso/:id", "/api/produccion/:recurso/:id/:accion"] };
export { manejador };
