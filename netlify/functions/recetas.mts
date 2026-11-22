// Recetas: lista de masas, intermedios y SKU con sus versiones, detalle de una
// receta (fórmula, etapas, revisión y costo) y activación de versiones.
import type { Config, Context } from "@netlify/functions";
import { invalido } from "../../src/servidor/errores";
import { hoyNegocio } from "../../src/servidor/fechas";
import { activarVersion, calcularCostos, revisarVersion, versionesDe } from "../../src/servidor/recetas";
import { ruta } from "../../src/servidor/ruta";

function estado(v: { estatus: string; vigente_desde: string; version: number }, vigente: number | null, hoy: string) {
  if (v.estatus === "BORRADOR") return "Borrador";
  if (v.version === vigente) return "Vigente";
  return v.vigente_desde > hoy ? "Programada" : "Histórica";
}

const manejador = ruta({ permiso: "produccion.recetas:ver" }, async (ctx) => {
  const clave = ctx.params.clave;
  const m = ctx.req.method;
  const verCantidades = ctx.puede("datos.receta_completa:ver");

  if (!clave && m === "GET") {
    return ctx.tx(async (c) => {
      const hoy = await hoyNegocio(c);
      const { rows } = await c.query(
        `SELECT a.clave, a.nombre, a.tipo, u.clave AS unidad, f.nombre AS familia, a.activo,
                coalesce(jsonb_agg(jsonb_build_object('version', r.version, 'estatus', r.estatus, 'vigente_desde', r.vigente_desde::text) ORDER BY r.version DESC)
                  FILTER (WHERE r.id IS NOT NULL), '[]') AS versiones
           FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id LEFT JOIN familia f ON f.id = a.familia_id
           LEFT JOIN receta r ON r.articulo_id = a.id
          WHERE a.tipo IN ('INTERMEDIO', 'SKU')
          GROUP BY a.id, u.clave, f.nombre ORDER BY a.tipo, a.clave`,
      );
      return {
        hoy,
        articulos: rows.map((a) => {
          const activas = a.versiones.filter((v: any) => v.estatus === "ACTIVA" && v.vigente_desde <= hoy).sort((x: any, y: any) => (x.vigente_desde < y.vigente_desde ? 1 : -1));
          const vigente = activas[0]?.version ?? null;
          return { ...a, nivel: a.tipo === "SKU" ? "N2" : "N1", vigente, versiones: a.versiones.map((v: any) => ({ ...v, estado: estado(v, vigente, hoy) })) };
        }),
      };
    });
  }

  if (clave && !ctx.params.version && m === "GET") {
    return ctx.tx(async (c) => {
      const hoy = await hoyNegocio(c);
      const { versiones, unidades } = await versionesDe(c, clave);
      if (!versiones.length) {
        const a = (await c.query("SELECT clave, nombre, tipo FROM articulo WHERE clave = $1 AND tipo IN ('INTERMEDIO', 'SKU')", [clave])).rows[0];
        if (!a) throw invalido("No existe esa masa, intermedio o producto.");
        return { clave: a.clave, nombre: a.nombre, nivel: a.tipo === "SKU" ? "N2" : "N1", versiones: [], ver_cantidades: verCantidades, costo: null };
      }
      const vigente = versiones.filter((v) => v.estatus === "ACTIVA" && v.vigente_desde <= hoy).sort((x, y) => (x.vigente_desde < y.vigente_desde ? 1 : -1))[0]?.version ?? null;
      const detalle = [];
      for (const v of versiones) {
        const rev = await revisarVersion(c, v, unidades);
        detalle.push({
          version: v.version, estatus: v.estatus, estado: estado(v, vigente, hoy), vigente_desde: v.vigente_desde, activada_en: v.activada_en, activada_por: v.activada_por,
          unidad_base: v.unidad_base, captura: v.captura, tamano_lote: v.tamano_lote, rendimiento_lote: v.rendimiento_lote, merma_proceso_pct: v.merma_proceso_pct,
          regla_lote: v.regla_lote, capacidad_amasadora: v.capacidad_amasadora, merma_formado_pct: v.merma_formado_pct, merma_horneado_pct: v.merma_horneado_pct,
          piezas_por_lote: v.piezas_por_lote, comentario: v.comentario,
          tamano_calculado: verCantidades ? rev.tamanoLote : null, rendimiento_calculado: verCantidades ? rev.rendimiento : null,
          componentes: v.componentes.map((x) => ({ clave: x.clave, nombre: x.nombre, tipo: x.tipo, unidad_base: x.unidades.base, merma_pct: x.merma, ...(verCantidades ? { cantidad: x.cantidad, unidad: x.unidad, pct: x.pct } : {}) })),
          etapas: v.etapas.map((e) => ({ etapa: e.etapa, nombre: e.nombre, minutos: e.minutos, base: e.base })),
          problemas: rev.problemas,
          avisos: rev.avisos,
        });
      }
      let costo = null;
      if (vigente !== null && ctx.puede("datos.costos:ver")) costo = (await calcularCostos(c, hoy)).articulos.find((a) => a.clave === clave)?.costo ?? null;
      return {
        clave, nombre: versiones[0]!.nombre, nivel: versiones[0]!.nivel, unidad: versiones[0]!.unidad_base, vigente, ver_cantidades: verCantidades,
        puede_activar: ctx.puede("produccion.recetas:editar"), costo, versiones: detalle,
      };
    });
  }

  if (clave && ctx.params.version && ctx.params.accion === "activar" && m === "POST") {
    ctx.exigir("produccion.recetas:editar");
    const version = Number(ctx.params.version);
    if (!Number.isInteger(version) || version < 1) throw invalido("Versión no válida.");
    return ctx.tx((c) => activarVersion(c, ctx.usuario.id, clave, version));
  }

  throw invalido("Operación no reconocida.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/recetas", "/api/recetas/:clave", "/api/recetas/:clave/:version/:accion"] };
export { manejador };
