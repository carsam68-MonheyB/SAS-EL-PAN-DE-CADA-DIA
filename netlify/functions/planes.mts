// Plan de producción: captura de piezas por SKU, explosión de recetas
// (masas, lotes y materia prima), existencias para el requerimiento neto,
// aprobación, cancelación, requisición de compra en borrador y Excel.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { invalido, noEncontrado } from "../../src/servidor/errores";
import { libroExcel, respuestaExcel } from "../../src/servidor/excel";
import { leerCuerpo } from "../../src/servidor/http";
import { guardarRegistros } from "../../src/servidor/layouts/servicio";
import {
  aprobarPlan, cancelarPlan, cargarPlan, explotarPlan, generarRequisicion, guardarExistencias, requisicionesDePlan, type ExplosionJson,
} from "../../src/servidor/recetas";
import { existenciasParaPlan } from "../../src/servidor/inventarios";
import { ruta } from "../../src/servidor/ruta";
import type { Cliente } from "../../src/servidor/transaccion";

const NUMERO = z.string().trim().regex(/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/, "Número no válido (punto decimal).");

async function explosionDe(c: Cliente, plan: any): Promise<ExplosionJson | null> {
  if (plan.estatus === "BORRADOR") return explotarPlan(c, plan.id);
  return plan.explosion ?? null;
}

const manejador = ruta({ permiso: "produccion.plan:ver" }, async (ctx) => {
  const id = ctx.params.id;
  const accion = ctx.params.accion;
  const m = ctx.req.method;
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw noEncontrado("No existe ese plan.");

  if (!id && m === "GET") {
    const { rows } = await ctx.tx((c) => c.query(
      `SELECT p.id, p.folio, p.fecha::text, p.estatus, t.clave AS turno, s.clave AS sucursal, p.creado_en, p.aprobado_en,
              count(r.id) FILTER (WHERE r.piezas > 0)::int AS productos, coalesce(sum(r.piezas), 0)::text AS piezas
         FROM plan_produccion p LEFT JOIN turno_produccion t ON t.id = p.turno_id LEFT JOIN sucursal s ON s.id = p.sucursal_id
         LEFT JOIN plan_renglon r ON r.plan_id = p.id
        GROUP BY p.id, t.clave, s.clave ORDER BY p.fecha DESC, p.folio DESC LIMIT 300`,
    ));
    return { planes: rows };
  }

  if (!id && m === "POST") {
    ctx.exigir(["produccion.plan:crear", "produccion.plan:editar"]);
    const d = await leerCuerpo(ctx.req, z.object({
      fecha: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "Fecha DD/MM/AAAA."),
      turno: z.string().max(20).optional().default(""),
      sucursal: z.string().max(20).optional().default(""),
      renglones: z.array(z.object({ sku: z.string().min(1).max(30), piezas: NUMERO })).min(1).max(2000),
    }));
    const modo = ctx.puede("produccion.plan:crear") && ctx.puede("produccion.plan:editar") ? "ambos" : ctx.puede("produccion.plan:crear") ? "alta" : "actualizacion";
    return ctx.tx(async (c) => {
      const r = await guardarRegistros(c, ctx.usuario.id, ctx.usuario.permisos, "plan_produccion", modo,
        d.renglones.map((x) => ({ FECHA: d.fecha, TURNO: d.turno, SUCURSAL: d.sucursal, SKU: x.sku, PIEZAS: x.piezas })));
      if (!r.ok) throw invalido("Revisa el plan.", r.detalle.filter((x) => x.severidad === "error").map((x) => ({ campo: x.campo, mensaje: `Renglón ${x.renglon - 1}: ${x.campo ? x.campo + ": " : ""}${x.mensaje}` })));
      const [dia, mes, anio] = d.fecha.split("/");
      const plan = (await c.query(
        `SELECT p.id FROM plan_produccion p LEFT JOIN turno_produccion t ON t.id = p.turno_id LEFT JOIN sucursal s ON s.id = p.sucursal_id
          WHERE p.fecha = $1 AND p.estatus <> 'CANCELADO' AND coalesce(t.clave, '') = upper($2) AND coalesce(s.clave, '') = upper($3)`,
        [`${anio}-${mes}-${dia}`, d.turno, d.sucursal],
      )).rows[0];
      return { id: plan?.id ?? null, advertencias: r.detalle.filter((x) => x.severidad === "advertencia") };
    });
  }

  if (id && !accion && m === "GET") {
    return ctx.tx(async (c) => {
      const plan = await cargarPlan(c, id);
      const renglones = (await c.query(
        "SELECT a.clave, a.nombre, u.clave AS unidad, r.piezas::text FROM plan_renglon r JOIN articulo a ON a.id = r.articulo_id JOIN unidad u ON u.id = a.unidad_base_id WHERE r.plan_id = $1 ORDER BY a.clave",
        [id],
      )).rows;
      const existencias = (await c.query("SELECT a.clave, pe.existencia::text, pe.en_transito::text FROM plan_existencia pe JOIN articulo a ON a.id = pe.articulo_id WHERE pe.plan_id = $1", [id])).rows;
      const { explosion, ...cabecera } = plan;
      return {
        plan: cabecera,
        renglones,
        existencias,
        explosion: await explosionDe(c, plan),
        requisiciones: await requisicionesDePlan(c, id),
        puede: {
          editar: plan.estatus === "BORRADOR" && ctx.puede(["produccion.plan:crear", "produccion.plan:editar"]),
          aprobar: plan.estatus === "BORRADOR" && ctx.puede("produccion.plan:autorizar"),
          cancelar: plan.estatus !== "CANCELADO" && ctx.puede("produccion.plan:cancelar"),
          requisicion: plan.estatus === "APROBADO" && ctx.puede("compras.requisiciones:crear"),
        },
      };
    });
  }

  if (id && accion === "existencias" && m === "PUT") {
    ctx.exigir(["produccion.plan:crear", "produccion.plan:editar"]);
    const d = await leerCuerpo(ctx.req, z.object({
      existencias: z.array(z.object({ articulo: z.string().max(30), existencia: NUMERO, en_transito: NUMERO })).max(5000),
    }));
    await ctx.tx((c) => guardarExistencias(c, id, d.existencias.map((x) => ({ ...x, existencia: x.existencia.replaceAll(",", ""), en_transito: x.en_transito.replaceAll(",", "") }))));
    return { ok: true };
  }

  // Toma la existencia y lo que viene en tránsito del inventario (Fase 3) en lugar de capturarlos.
  if (id && accion === "existencias-inventario" && m === "POST") {
    ctx.exigir(["produccion.plan:crear", "produccion.plan:editar"]);
    return ctx.tx(async (c) => {
      const inv = await existenciasParaPlan(c, id);
      const previas = (await c.query("SELECT a.clave FROM plan_existencia pe JOIN articulo a ON a.id = pe.articulo_id WHERE pe.plan_id = $1", [id])).rows.map((r) => r.clave);
      const lista = new Map(previas.map((k) => [k, { articulo: k, existencia: "0", en_transito: "0" }]));
      for (const r of inv) lista.set(r.articulo, r);
      if (lista.size) await guardarExistencias(c, id, [...lista.values()]);
      return { articulos: inv.length };
    });
  }

  if (id && accion === "aprobar" && m === "POST") {
    ctx.exigir("produccion.plan:autorizar");
    return ctx.tx((c) => aprobarPlan(c, ctx.usuario.id, id));
  }

  if (id && accion === "cancelar" && m === "POST") {
    ctx.exigir("produccion.plan:cancelar");
    const d = await leerCuerpo(ctx.req, z.object({ motivo: z.string().trim().min(1, "Escribe el motivo.").max(300) }));
    return ctx.tx((c) => cancelarPlan(c, ctx.usuario.id, id, d.motivo));
  }

  if (id && accion === "requisicion" && m === "POST") {
    ctx.exigir("compras.requisiciones:crear");
    return ctx.tx((c) => generarRequisicion(c, ctx.usuario.id, id));
  }

  if (id && accion === "exportar" && m === "GET") {
    const { plan, exp, renglones } = await ctx.tx(async (c) => {
      const plan = await cargarPlan(c, id);
      const renglones = (await c.query("SELECT a.clave, a.nombre, r.piezas::text FROM plan_renglon r JOIN articulo a ON a.id = r.articulo_id WHERE r.plan_id = $1 ORDER BY a.clave", [id])).rows;
      return { plan, exp: await explosionDe(c, plan), renglones };
    });
    if (!exp) throw invalido("El plan no tiene explosión.");
    const n = (x: string | null) => (x === null ? null : Number(x));
    const origen = (o: { de: string; cantidad: string | null }[]) => o.map((x) => `${x.de}: ${x.cantidad}`).join(" · ");
    const datos = await libroExcel([
      { nombre: "Plan", columnas: [{ titulo: "SKU", clave: "clave" }, { titulo: "Nombre", clave: "nombre", ancho: 32 }, { titulo: "Piezas buenas", clave: "piezas" }, { titulo: "Piezas a formar", clave: "formadas" }, { titulo: "Piezas que alcanzan", clave: "alcanzan" }, { titulo: "Material que limita", clave: "limita", ancho: 40 }],
        filas: renglones.map((r) => { const s = exp.skus.find((x) => x.clave === r.clave); return { clave: r.clave, nombre: r.nombre, piezas: n(r.piezas), formadas: n(s?.piezas_formadas ?? null), alcanzan: n(s?.alcanzan ?? null), limita: s?.limitantes.join(", ") ?? "" }; }) },
      { nombre: "Masas e intermedios", columnas: [{ titulo: "Clave", clave: "clave" }, { titulo: "Nombre", clave: "nombre", ancho: 30 }, { titulo: "Unidad", clave: "unidad", ancho: 8 }, { titulo: "Requerido", clave: "bruto" }, { titulo: "Existencia", clave: "existencia" }, { titulo: "A preparar", clave: "a_preparar" }, { titulo: "Rinde por lote", clave: "rendimiento" }, { titulo: "Regla", clave: "regla", ancho: 10 }, { titulo: "Lotes", clave: "lotes" }, { titulo: "Se produce", clave: "producido" }, { titulo: "Sobrante esperado", clave: "sobrante" }, { titulo: "Amasadas", clave: "amasadas" }, { titulo: "Lo piden", clave: "origen", ancho: 50 }],
        filas: exp.intermedios.map((i) => ({ ...i, bruto: n(i.bruto), existencia: n(i.existencia), a_preparar: n(i.a_preparar), rendimiento: n(i.rendimiento), lotes: n(i.lotes), producido: n(i.producido), sobrante: n(i.sobrante), amasadas: n(i.amasadas), origen: origen(i.origen) })) },
      { nombre: "Materia prima", columnas: [{ titulo: "Clave", clave: "clave" }, { titulo: "Nombre", clave: "nombre", ancho: 30 }, { titulo: "Unidad", clave: "unidad", ancho: 8 }, { titulo: "Requerimiento bruto", clave: "bruto" }, { titulo: "Existencia", clave: "existencia" }, { titulo: "En tránsito", clave: "en_transito" }, { titulo: "Requerimiento neto", clave: "neto" }, { titulo: "Neto en unidad de compra", clave: "neto_compra" }, { titulo: "Unidad de compra", clave: "unidad_compra", ancho: 10 }, { titulo: "Lo piden", clave: "origen", ancho: 50 }],
        filas: exp.materiales.map((x) => ({ ...x, bruto: n(x.bruto), existencia: n(x.existencia), en_transito: n(x.en_transito), neto: n(x.neto), neto_compra: n(x.neto_compra), origen: origen(x.origen) })) },
      { nombre: "Problemas", columnas: [{ titulo: "Artículo", clave: "articulo" }, { titulo: "Problema", clave: "mensaje", ancho: 80 }], filas: exp.problemas },
    ], `Explosión ${plan.folio}`);
    return respuestaExcel(datos, `explosion-${plan.folio}.xlsx`);
  }

  throw invalido("Operación no reconocida.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/planes", "/api/planes/:id", "/api/planes/:id/:accion"] };
export { manejador };
