// Costo estándar: cálculo en cadena a una fecha, simulación del impacto de un
// cambio de costo de insumos en el margen, fotos guardadas (historial) y Excel.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { invalido, noEncontrado } from "../../src/servidor/errores";
import { libroExcel, respuestaExcel } from "../../src/servidor/excel";
import { hoyNegocio } from "../../src/servidor/fechas";
import { leerCuerpo } from "../../src/servidor/http";
import { calcularCostos, guardarCosteo } from "../../src/servidor/recetas";
import { ruta } from "../../src/servidor/ruta";
import type { Cliente } from "../../src/servidor/transaccion";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaMx = (f: string) => f.split("-").reverse().join("/");

async function fechaPedida(c: Cliente, valor: string | null | undefined) {
  if (!valor) return hoyNegocio(c);
  if (!FECHA.test(valor)) throw invalido("Fecha no válida (AAAA-MM-DD).");
  return valor;
}

const manejador = ruta({ permiso: "datos.costos:ver" }, async (ctx) => {
  const recurso = ctx.params.recurso;
  const id = ctx.params.id;
  const m = ctx.req.method;
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw noEncontrado("No existe ese costeo.");
  const verCantidades = ctx.puede("datos.receta_completa:ver");
  // Sin permiso de ver la receta completa, el desglose muestra importes pero no cantidades.
  const recortar = <T extends { costo: any; nuevo: any }>(a: T): T => {
    if (verCantidades) return a;
    const sin = (x: any) => x && { ...x, componentes: x.componentes.map((l: any) => ({ ...l, cantidad: null })), etapas: x.etapas.map((l: any) => ({ ...l, minutos: null })) };
    return { ...a, costo: sin(a.costo), nuevo: sin(a.nuevo) };
  };

  if (!recurso && m === "GET") {
    return ctx.tx(async (c) => {
      const r = await calcularCostos(c, await fechaPedida(c, ctx.url.searchParams.get("fecha")));
      return { ...r, articulos: r.articulos.map(recortar) };
    });
  }

  if (recurso === "simular" && m === "POST") {
    const d = await leerCuerpo(ctx.req, z.object({
      fecha: z.string().optional(),
      cambios: z.array(z.object({ articulo: z.string().max(30), costo: z.string().regex(/^\d+(\.\d{1,6})?$/, "Costo no válido (punto decimal, hasta 6 decimales).") })).min(1).max(500),
    }));
    return ctx.tx(async (c) => {
      const validos = new Set((await c.query("SELECT clave FROM articulo WHERE tipo IN ('INSUMO', 'EMPAQUE') AND clave = ANY($1)", [d.cambios.map((x) => x.articulo)])).rows.map((r) => r.clave));
      const malos = d.cambios.filter((x) => !validos.has(x.articulo));
      if (malos.length) throw invalido(`No son insumos ni empaques: ${malos.map((x) => x.articulo).join(", ")}.`);
      const r = await calcularCostos(c, await fechaPedida(c, d.fecha), new Map(d.cambios.map((x) => [x.articulo, x.costo])));
      return { ...r, articulos: r.articulos.map(recortar) };
    });
  }

  if (recurso === "exportar" && m === "GET") {
    const r = await ctx.tx(async (c) => calcularCostos(c, await fechaPedida(c, ctx.url.searchParams.get("fecha"))));
    const filas = r.articulos.map((a) => ({
      clave: a.clave, nombre: a.nombre, nivel: a.nivel, version: a.version ?? "", unidad: a.nivel === "N1" ? `por ${a.unidad}` : `por ${a.unidad}`,
      mp: a.costo ? Number(a.costo.mp) : null, mod: a.costo ? Number(a.costo.mod) : null, gif: a.costo ? Number(a.costo.gif) : null, total: a.costo ? Number(a.costo.total) : null,
      precio: a.costo?.precio ? Number(a.costo.precio) : null, sin: a.costo?.precio_sin_impuestos ? Number(a.costo.precio_sin_impuestos) : null,
      margen: a.costo?.margen ? Number(a.costo.margen) : null, pct: a.costo?.margen_pct ? Number(a.costo.margen_pct) : null,
      notas: [...a.problemas, ...(a.costo && !a.costo.completo ? [`Incompleto: ${a.costo.faltantes.join("; ")}`] : [])].join(" · "),
    }));
    const datos = await libroExcel([{
      nombre: `Costos ${fechaMx(r.fecha).replaceAll("/", "-")}`,
      columnas: [
        { titulo: "Clave", clave: "clave" }, { titulo: "Nombre", clave: "nombre", ancho: 32 }, { titulo: "Nivel", clave: "nivel", ancho: 8 }, { titulo: "Versión", clave: "version", ancho: 9 },
        { titulo: "Unidad", clave: "unidad", ancho: 10 }, { titulo: "Materia prima", clave: "mp" }, { titulo: "Mano de obra", clave: "mod" }, { titulo: "GIF", clave: "gif" },
        { titulo: "Costo estándar", clave: "total" }, { titulo: "Precio al público", clave: "precio" }, { titulo: "Precio sin impuestos", clave: "sin" },
        { titulo: "Margen", clave: "margen" }, { titulo: "Margen %", clave: "pct", ancho: 10 }, { titulo: "Notas", clave: "notas", ancho: 60 },
      ],
      filas,
    }], "Costo estándar");
    return respuestaExcel(datos, `costo-estandar-${r.fecha}.xlsx`);
  }

  if (recurso === "costeos" && !id && m === "GET") {
    const { rows } = await ctx.tx((c) => c.query(
      `SELECT k.id, k.fecha::text, k.comentario, k.creado_en, u.usuario, count(ce.id)::int AS articulos
         FROM costeo k JOIN usuario u ON u.id = k.usuario_id LEFT JOIN costo_estandar ce ON ce.costeo_id = k.id
        GROUP BY k.id, u.usuario ORDER BY k.creado_en DESC LIMIT 200`,
    ));
    return { costeos: rows };
  }

  if (recurso === "costeos" && id && m === "GET") {
    return ctx.tx(async (c) => {
      const k = (await c.query("SELECT k.id, k.fecha::text, k.comentario, k.creado_en, u.usuario FROM costeo k JOIN usuario u ON u.id = k.usuario_id WHERE k.id = $1", [id])).rows[0];
      if (!k) throw noEncontrado("No existe ese costeo.");
      const { rows } = await c.query(
        `SELECT a.clave, a.nombre, r.nivel, r.version, ce.costo_mp::text AS mp, ce.costo_mod::text AS mod, ce.costo_gif::text AS gif, ce.costo_total::text AS total,
                ce.completo, ce.precio_sin_impuestos::text, ce.margen::text
           FROM costo_estandar ce JOIN articulo a ON a.id = ce.articulo_id JOIN receta r ON r.id = ce.receta_id
          WHERE ce.costeo_id = $1 ORDER BY r.nivel, a.clave`,
        [id],
      );
      return { ...k, articulos: rows };
    });
  }

  if (recurso === "costeos" && !id && m === "POST") {
    ctx.exigir(["configuracion.parametros:editar", "produccion.recetas:editar"]);
    const d = await leerCuerpo(ctx.req, z.object({ fecha: z.string().optional(), comentario: z.string().trim().max(300).optional() }));
    return ctx.tx(async (c) => guardarCosteo(c, ctx.usuario.id, await fechaPedida(c, d.fecha), d.comentario || null));
  }

  throw invalido("Operación no reconocida.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/costos", "/api/costos/:recurso", "/api/costos/:recurso/:id"] };
export { manejador };
