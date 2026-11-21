// Catálogos por layout: lista de catálogos visibles, consulta, exportación en el
// mismo layout, plantilla con instrucciones y captura de un registro en pantalla.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { invalido } from "../../src/servidor/errores";
import { leerCuerpo, respuestaArchivo } from "../../src/servidor/http";
import { LAYOUTS } from "../../src/servidor/layouts/definiciones";
import { archivoLayout, camposVisibles, instruccionesTexto, leerRegistros, listasDeCatalogo, notasGenerales } from "../../src/servidor/layouts/motor";
import { guardarRegistro, obtenerLayout, permisosDeLayout } from "../../src/servidor/layouts/servicio";
import { ruta } from "../../src/servidor/ruta";

function formatoPedido(url: URL): "xlsx" | "txt" | "csv" {
  const f = url.searchParams.get("formato") ?? "xlsx";
  if (f !== "xlsx" && f !== "txt" && f !== "csv") throw invalido("Formato no válido: xlsx, txt o csv.");
  return f;
}

const manejador = ruta({}, async (ctx) => {
  const permisos = ctx.usuario.permisos;
  const clave = ctx.params.layout;
  const accion = ctx.params.accion;

  if (!clave && ctx.req.method === "GET") {
    return {
      layouts: LAYOUTS.map((l) => ({ l, puede: permisosDeLayout(l, permisos) }))
        .filter((x) => x.puede.ver)
        .map(({ l, puede }) => ({
          clave: l.clave,
          nombre: l.nombre,
          grupo: l.grupo,
          descripcion: l.descripcion,
          secuencia: l.secuencia,
          llave: l.llave,
          requiere_autorizacion: !!l.autorizacion,
          modos: l.modos ?? ["alta", "actualizacion", "ambos"],
          notas: notasGenerales(l),
          puede,
          campos: camposVisibles(l, permisos).map((f) => ({
            nombre: f.nombre, tipo: f.tipo, descripcion: f.descripcion, ejemplo: f.ejemplo,
            obligatorio: !!f.obligatorio, por_omision: f.porOmision ?? null, opciones: f.opciones ?? null,
            ref: f.ref?.tabla ?? null, sat: f.sat ?? null, solo_alta: !!f.soloAlta, max: f.max ?? null,
          })),
        })),
    };
  }

  if (ctx.req.method === "GET" && accion === "registros") {
    const { layout } = obtenerLayout(clave!, permisos, "ver");
    const buscar = ctx.url.searchParams.get("buscar")?.trim() || undefined;
    return ctx.tx(async (c) => leerRegistros(c, layout, permisos, { buscar, limite: 1000 }));
  }

  if (ctx.req.method === "GET" && accion === "exportar") {
    const { layout } = obtenerLayout(clave!, permisos, "exportar");
    const formato = formatoPedido(ctx.url);
    const datos = await ctx.tx(async (c) => archivoLayout(c, layout, permisos, formato, await leerRegistros(c, layout, permisos)));
    return respuestaArchivo(datos, `${layout.clave}-datos.${formato}`, formato);
  }

  if (ctx.req.method === "GET" && accion === "plantilla") {
    const { layout, puede } = obtenerLayout(clave!, permisos, "ver");
    if (!puede.importar && !puede.crear) ctx.exigir("cargas.layout:importar");
    const formato = formatoPedido(ctx.url);
    const datos = await ctx.tx((c) => archivoLayout(c, layout, permisos, formato, null));
    return respuestaArchivo(datos, `${layout.clave}-plantilla.${formato}`, formato);
  }

  if (ctx.req.method === "GET" && accion === "instrucciones") {
    const { layout } = obtenerLayout(clave!, permisos, "ver");
    return respuestaArchivo(instruccionesTexto(layout, permisos), `${layout.clave}-instrucciones.txt`, "txt");
  }

  if (ctx.req.method === "GET" && accion === "opciones") {
    // Valores válidos para los campos de lista en el formulario de captura.
    const { layout, puede } = obtenerLayout(clave!, permisos, "ver");
    if (!puede.crear && !puede.editar) ctx.exigir("__sin_permiso__");
    return ctx.tx(async (c) => {
      const r: Record<string, string[]> = {};
      for (const f of camposVisibles(layout, permisos)) {
        if (["ref", "sat", "opcion", "sino"].includes(f.tipo)) r[f.nombre] = await listasDeCatalogo(c, f);
      }
      return r;
    });
  }

  if (ctx.req.method === "POST" && accion === "registro") {
    const d = await leerCuerpo(ctx.req, z.object({
      modo: z.enum(["alta", "actualizacion"]),
      valores: z.record(z.string(), z.string().max(1000)),
    }));
    const r = await ctx.tx((c) => guardarRegistro(c, ctx.usuario.id, permisos, clave!, d.modo, d.valores));
    if (!r.ok) throw invalido("Revisa los datos capturados.", r.detalle.filter((m) => m.severidad === "error").map((m) => ({ campo: m.campo, mensaje: m.campo ? `${m.campo}: ${m.mensaje}` : m.mensaje })));
    return r;
  }

  throw invalido("Operación no reconocida.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/layouts", "/api/layouts/:layout/:accion"] };
export { manejador };
