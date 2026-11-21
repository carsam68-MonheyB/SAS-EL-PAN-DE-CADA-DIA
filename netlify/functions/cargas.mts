// Cargas masivas por layout: subir y validar (simulación), confirmar, autorizar o
// rechazar, reporte de errores en el mismo layout y archivo original.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { invalido, noEncontrado, prohibido } from "../../src/servidor/errores";
import { leerCuerpo, respuestaArchivo } from "../../src/servidor/http";
import { leerArchivo } from "../../src/servidor/layouts/archivos";
import { buscarLayout } from "../../src/servidor/layouts/definiciones";
import { archivoLayout, reporteErrores } from "../../src/servidor/layouts/motor";
import { aplicar, BYTES_MAXIMOS, cargarCarga, permisosDeLayout, resolverAutorizacion, simular } from "../../src/servidor/layouts/servicio";
import { ruta } from "../../src/servidor/ruta";

const manejador = ruta({}, async (ctx) => {
  const permisos = ctx.usuario.permisos;
  const id = ctx.params.id;
  const accion = ctx.params.accion;
  const m = ctx.req.method;

  const puedeVerCarga = (carga: any) => {
    const layout = buscarLayout(carga.layout);
    if (!layout) return false;
    const p = permisosDeLayout(layout, permisos);
    return carga.usuario_id === ctx.usuario.id || p.autorizar || (p.ver && (p.importar || p.exportar));
  };

  if (!id && m === "GET") {
    const layout = ctx.url.searchParams.get("layout") || null;
    const estatus = ctx.url.searchParams.get("estatus") || null;
    const { rows } = await ctx.tx((c) =>
      c.query(
        `SELECT cl.id, cl.layout, cl.modo, cl.formato, cl.nombre_archivo, cl.renglones, cl.altas, cl.actualizaciones,
                cl.errores, cl.advertencias, cl.estatus, cl.creado_en, cl.usuario_id, u.usuario, u.nombre AS nombre_usuario,
                ua.usuario AS autorizado_por, cl.autorizado_en, cl.aplicado_en, cl.motivo_rechazo
           FROM carga_layout cl JOIN usuario u ON u.id = cl.usuario_id LEFT JOIN usuario ua ON ua.id = cl.autorizado_por
          WHERE ($1::text IS NULL OR cl.layout = $1) AND ($2::text IS NULL OR cl.estatus = $2)
          ORDER BY cl.creado_en DESC LIMIT 300`,
        [layout, estatus],
      ),
    );
    return {
      cargas: rows.filter(puedeVerCarga).map((r) => {
        const l = buscarLayout(r.layout)!;
        const p = permisosDeLayout(l, permisos);
        return {
          ...r,
          layout_nombre: l.nombre,
          es_mia: r.usuario_id === ctx.usuario.id,
          puede_autorizar: r.estatus === "pendiente_autorizacion" && p.autorizar && r.usuario_id !== ctx.usuario.id,
        };
      }),
    };
  }

  if (!id && m === "POST") {
    const d = await leerCuerpo(ctx.req, z.object({
      layout: z.string().max(40),
      modo: z.enum(["alta", "actualizacion", "ambos"]),
      nombre_archivo: z.string().trim().min(1).max(200),
      contenido: z.string().max(Math.ceil((BYTES_MAXIMOS * 4) / 3) + 8, "El archivo pesa más de 4 MB."),
    }));
    const bytes = new Uint8Array(Buffer.from(d.contenido, "base64"));
    if (!bytes.length) throw invalido("El archivo está vacío.");
    return ctx.tx((c) => simular(c, ctx.usuario.id, permisos, { layout: d.layout, modo: d.modo, nombre: d.nombre_archivo, bytes }));
  }

  if (!id) throw invalido("Operación no reconocida.");

  if (m === "GET" && !accion) {
    return ctx.tx(async (c) => {
      const carga = await cargarCarga(c, id);
      if (!puedeVerCarga(carga)) throw noEncontrado("No existe esa carga.");
      const l = buscarLayout(carga.layout)!;
      const p = permisosDeLayout(l, permisos);
      return {
        ...carga,
        layout_nombre: l.nombre,
        es_mia: carga.usuario_id === ctx.usuario.id,
        puede_autorizar: carga.estatus === "pendiente_autorizacion" && p.autorizar && carga.usuario_id !== ctx.usuario.id,
      };
    });
  }

  if (m === "GET" && (accion === "errores" || accion === "archivo")) {
    return ctx.tx(async (c) => {
      const carga = await cargarCarga(c, id);
      if (!puedeVerCarga(carga)) throw noEncontrado("No existe esa carga.");
      const contenido = (await c.query("SELECT contenido FROM carga_archivo WHERE carga_id = $1", [id])).rows[0].contenido as Buffer;
      const nombreOriginal = carga.formato === "pantalla" ? "captura.txt" : carga.nombre_archivo;
      if (accion === "archivo") {
        const ext = nombreOriginal.toLowerCase().split(".").pop()!;
        return respuestaArchivo(new Uint8Array(contenido), nombreOriginal, ext);
      }
      const layout = buscarLayout(carga.layout)!;
      const tabla = await leerArchivo(new Uint8Array(contenido), nombreOriginal);
      const formato = (ctx.url.searchParams.get("formato") ?? (tabla.formato === "xlsx" ? "xlsx" : "txt")) as "xlsx" | "txt" | "csv";
      if (!["xlsx", "txt", "csv"].includes(formato)) throw invalido("Formato no válido.");
      const datos = await archivoLayout(c, layout, permisos, formato, reporteErrores(tabla, carga.detalle));
      return respuestaArchivo(datos, `${layout.clave}-errores.${formato}`, formato);
    });
  }

  if (m === "POST" && accion === "aplicar") {
    return ctx.tx((c) => aplicar(c, ctx.usuario.id, permisos, id));
  }

  if (m === "POST" && (accion === "autorizar" || accion === "rechazar")) {
    const d = await leerCuerpo(ctx.req, z.object({ motivo: z.string().max(500).optional() }));
    return ctx.tx((c) => resolverAutorizacion(c, ctx.usuario.id, permisos, id, accion, d.motivo));
  }

  throw prohibido();
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/cargas", "/api/cargas/:id", "/api/cargas/:id/:accion"] };
export { manejador };
