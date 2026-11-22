// Servicio de recetas: lee versiones de la base, las normaliza (unidades y %
// panadero), activa versiones, calcula el costo estándar y explota planes.
import Decimal from "decimal.js";
import {
  costear, D, explotar, grafoIntermedios, buscarCiclo, margen, normalizarReceta, precioSinImpuestos,
  type BaseGif, type CostoArticulo, type Dec, type FilaComponente, type FilaEncabezado, type FilaEtapa, type FormulaMerma,
  type RecetaN1, type RecetaN2, type Recetas, type ResultadoExplosion,
} from "../dominio/recetas";
import { factorConversion, type ConversionGeneral, type UnidadPropia } from "../dominio/unidades";
import { ErrorApp, invalido, noEncontrado } from "./errores";
import { hoyNegocio } from "./fechas";
import type { Cliente } from "./transaccion";

/** Decimal → texto con hasta `dp` decimales (sin ceros sobrantes). */
export const num = (x: Dec | Decimal | null | undefined, dp = 6): string | null => (x === null || x === undefined ? null : new D(x).toDecimalPlaces(dp).toFixed());

export async function formulaMerma(c: Cliente): Promise<FormulaMerma> {
  const v = (await c.query("SELECT valor FROM configuracion WHERE clave = 'recetas.formula_merma'")).rows[0]?.valor;
  return v === "MULTIPLICAR" ? "MULTIPLICAR" : "DIVIDIR";
}

export interface Version {
  receta_id: string;
  articulo_id: string;
  clave: string;
  nombre: string;
  nivel: "N1" | "N2";
  version: number;
  estatus: "BORRADOR" | "ACTIVA";
  vigente_desde: string;
  unidad_base: string;
  captura: "CANTIDAD" | "PCT_PANADERO" | null;
  tamano_lote: string | null;
  rendimiento_lote: string | null;
  merma_proceso_pct: string | null;
  regla_lote: "COMPLETO" | "EXACTO" | null;
  capacidad_amasadora: string | null;
  merma_formado_pct: string | null;
  merma_horneado_pct: string | null;
  piezas_por_lote: string | null;
  comentario: string | null;
  activada_en: string | null;
  activada_por: string | null;
  componentes: (FilaComponente & { nombre: string; merma: string })[];
  etapas: (FilaEtapa & { nombre: string })[];
}

export interface Unidades {
  generales: ConversionGeneral[];
  propias: Map<string, UnidadPropia[]>;
}

export async function leerUnidades(c: Cliente): Promise<Unidades> {
  const generales: ConversionGeneral[] = (await c.query(
    "SELECT d.clave AS de, a.clave AS a, cu.factor::text AS factor FROM conversion_unidad cu JOIN unidad d ON d.id = cu.de_unidad_id JOIN unidad a ON a.id = cu.a_unidad_id WHERE cu.activo",
  )).rows;
  const propias = new Map<string, UnidadPropia[]>();
  for (const r of (await c.query("SELECT a.clave AS articulo, u.clave AS unidad, au.factor_a_base::text AS f FROM articulo_unidad au JOIN articulo a ON a.id = au.articulo_id JOIN unidad u ON u.id = au.unidad_id WHERE au.activo")).rows) {
    propias.set(r.articulo, [...(propias.get(r.articulo) ?? []), { unidad: r.unidad, factorABase: r.f }]);
  }
  return { generales, propias };
}

const SELECT_RECETA = `
  SELECT r.id::text AS receta_id, r.articulo_id::text, a.clave, a.nombre, r.nivel, r.version, r.estatus, r.vigente_desde::text,
         u.clave AS unidad_base, r.captura, r.tamano_lote::text, r.rendimiento_lote::text, r.merma_proceso_pct::text, r.regla_lote,
         r.capacidad_amasadora::text, r.merma_formado_pct::text, r.merma_horneado_pct::text, r.piezas_por_lote::text, r.comentario,
         r.activada_en, ua.usuario AS activada_por
    FROM receta r JOIN articulo a ON a.id = r.articulo_id JOIN unidad u ON u.id = a.unidad_base_id
    LEFT JOIN usuario ua ON ua.id = r.activada_por`;

/** Lee versiones con sus componentes y etapas activos. */
async function leerVersiones(c: Cliente, where: string, params: unknown[], unidades: Unidades): Promise<Version[]> {
  const versiones: Version[] = (await c.query(`${SELECT_RECETA} WHERE ${where}`, params)).rows.map((r) => ({ ...r, version: Number(r.version), componentes: [], etapas: [] }));
  if (!versiones.length) return versiones;
  const pares = JSON.stringify(versiones.map((v) => ({ a: v.articulo_id, v: v.version })));
  const porLlave = new Map(versiones.map((v) => [`${v.articulo_id}#${v.version}`, v]));
  const comps = await c.query(
    `SELECT rc.receta_articulo_id::text || '#' || rc.receta_version AS k, rc.tipo, ca.clave, ca.nombre, cu.clave AS base,
            rc.cantidad::text AS cantidad, u.clave AS unidad, rc.pct_panadero::text AS pct, rc.merma_pct::text AS merma
       FROM jsonb_to_recordset($1::jsonb) AS x(a uuid, v int)
       JOIN receta_componente rc ON rc.receta_articulo_id = x.a AND rc.receta_version = x.v AND rc.activo
       JOIN articulo ca ON ca.id = rc.componente_id JOIN unidad cu ON cu.id = ca.unidad_base_id
       LEFT JOIN unidad u ON u.id = rc.unidad_id
      ORDER BY CASE rc.tipo WHEN 'MASA' THEN 1 WHEN 'INTERMEDIO' THEN 2 WHEN 'INSUMO' THEN 3 ELSE 4 END, ca.clave`,
    [pares],
  );
  for (const r of comps.rows) {
    porLlave.get(r.k)?.componentes.push({
      clave: r.clave, nombre: r.nombre, tipo: r.tipo, cantidad: r.cantidad, unidad: r.unidad, pct: r.pct, mermaPct: r.merma, merma: r.merma,
      unidades: { base: r.base, propias: unidades.propias.get(r.clave) ?? [] },
    });
  }
  const etapas = await c.query(
    `SELECT rc.receta_articulo_id::text || '#' || rc.receta_version AS k, e.clave, e.nombre, rc.minutos::text, rc.base
       FROM jsonb_to_recordset($1::jsonb) AS x(a uuid, v int)
       JOIN receta_etapa rc ON rc.receta_articulo_id = x.a AND rc.receta_version = x.v AND rc.activo
       JOIN etapa_produccion e ON e.id = rc.etapa_id ORDER BY e.orden, e.clave`,
    [pares],
  );
  for (const r of etapas.rows) porLlave.get(r.k)?.etapas.push({ etapa: r.clave, nombre: r.nombre, minutos: r.minutos, base: r.base });
  return versiones;
}

function encabezado(v: Version): FilaEncabezado {
  return {
    clave: v.clave, version: v.version, nivel: v.nivel, unidadBase: v.unidad_base, captura: v.captura, tamanoLote: v.tamano_lote,
    rendimientoLote: v.rendimiento_lote, mermaProcesoPct: v.merma_proceso_pct, regla: v.regla_lote, capacidad: v.capacidad_amasadora,
    mermaFormadoPct: v.merma_formado_pct, mermaHorneadoPct: v.merma_horneado_pct, piezasPorLote: v.piezas_por_lote,
  };
}

export function normalizar(v: Version, unidades: Unidades) {
  return normalizarReceta(encabezado(v), v.componentes, v.etapas, unidades.generales);
}

export interface Vigentes {
  recetas: Recetas;
  versiones: Map<string, Version>;
  problemas: Map<string, string[]>;
  tamanos: Map<string, Dec | null>;
}

/** Recetas activas que aplican en una fecha (la de mayor vigente_desde ≤ fecha). */
export async function recetasVigentes(c: Cliente, fecha: string, unidades?: Unidades): Promise<Vigentes> {
  const u = unidades ?? (await leerUnidades(c));
  const versiones = await leerVersiones(
    c,
    `r.id IN (SELECT DISTINCT ON (articulo_id) id FROM receta WHERE estatus = 'ACTIVA' AND vigente_desde <= $1 ORDER BY articulo_id, vigente_desde DESC, version DESC)`,
    [fecha],
    u,
  );
  const recetas: Recetas = { n1: new Map(), n2: new Map() };
  const problemas = new Map<string, string[]>();
  const tamanos = new Map<string, Dec | null>();
  for (const v of versiones) {
    const r = normalizar(v, u);
    if (!r.ok) {
      problemas.set(v.clave, r.problemas);
      continue;
    }
    tamanos.set(v.clave, r.tamanoLote);
    if (v.nivel === "N1") recetas.n1.set(v.clave, r.receta as RecetaN1);
    else recetas.n2.set(v.clave, r.receta as RecetaN2);
  }
  // Una receta circular (no debería pasar: se valida al cargar y al activar) no se usa.
  const ciclo = buscarCiclo(grafoIntermedios(recetas.n1.values()));
  if (ciclo) for (const k of ciclo) {
    recetas.n1.delete(k);
    problemas.set(k, [`Receta circular: ${ciclo.join(" → ")}.`]);
  }
  return { recetas, versiones: new Map(versiones.map((v) => [v.clave, v])), problemas, tamanos };
}

// ---------------------------------------------------------------------------
// Consulta, revisión y activación de versiones
// ---------------------------------------------------------------------------

export async function versionesDe(c: Cliente, claveArticulo: string) {
  const u = await leerUnidades(c);
  return { versiones: await leerVersiones(c, "a.clave = $1 ORDER BY r.version DESC", [claveArticulo], u), unidades: u };
}

/** Revisa una versión: problemas que impiden activarla y avisos. */
export async function revisarVersion(c: Cliente, v: Version, unidades: Unidades): Promise<{ problemas: string[]; avisos: string[]; tamanoLote: string | null; rendimiento: string | null }> {
  const r = normalizar(v, unidades);
  const problemas = r.ok ? [] : [...r.problemas];
  const avisos: string[] = [];
  const vig = await recetasVigentes(c, v.vigente_desde, unidades);
  if (r.ok && v.nivel === "N1") {
    vig.recetas.n1.set(v.clave, r.receta as RecetaN1);
    const ciclo = buscarCiclo(grafoIntermedios(vig.recetas.n1.values()));
    if (ciclo) problemas.push(`Receta circular: ${ciclo.join(" → ")}.`);
  }
  for (const comp of v.componentes) {
    if ((comp.tipo === "MASA" || comp.tipo === "INTERMEDIO") && !vig.recetas.n1.has(comp.clave)) {
      avisos.push(`${comp.clave} no tiene receta activa al ${v.vigente_desde.split("-").reverse().join("/")}: actívala para poder explotar y costear.`);
    }
  }
  return {
    problemas,
    avisos,
    tamanoLote: r.ok ? num(r.tamanoLote) : null,
    rendimiento: r.ok && v.nivel === "N1" ? num((r.receta as RecetaN1).rendimiento) : null,
  };
}

export async function activarVersion(c: Cliente, usuarioId: string, claveArticulo: string, version: number) {
  const fila = (await c.query("SELECT r.id, r.estatus, r.articulo_id, r.vigente_desde::text FROM receta r JOIN articulo a ON a.id = r.articulo_id WHERE a.clave = $1 AND r.version = $2 FOR UPDATE OF r", [claveArticulo, version])).rows[0];
  if (!fila) throw noEncontrado("No existe esa versión de receta.");
  if (fila.estatus !== "BORRADOR") throw new ErrorApp(409, "estatus", "Esa versión ya está activa.");
  if (fila.vigente_desde < (await hoyNegocio(c))) throw invalido("La vigencia empieza antes de hoy. Corrige VIGENTE_DESDE en el encabezado (re-carga el encabezado en modo actualización).");
  const otra = (await c.query("SELECT version FROM receta WHERE articulo_id = $1 AND estatus = 'ACTIVA' AND vigente_desde = $2", [fila.articulo_id, fila.vigente_desde])).rows[0];
  if (otra) throw invalido(`La versión ${otra.version} ya está activa desde esa misma fecha. Usa otra fecha de inicio.`);
  const { versiones, unidades } = await versionesDe(c, claveArticulo);
  const v = versiones.find((x) => x.version === version)!;
  const rev = await revisarVersion(c, v, unidades);
  if (rev.problemas.length) throw invalido("La receta tiene problemas y no se puede activar.", rev.problemas.map((m) => ({ campo: "", mensaje: m })));
  await c.query("UPDATE receta SET estatus = 'ACTIVA', activada_por = $2, activada_en = now() WHERE id = $1", [fila.id, usuarioId]);
  return { clave: claveArticulo, version, estatus: "ACTIVA", avisos: rev.avisos };
}

// ---------------------------------------------------------------------------
// Costo estándar
// ---------------------------------------------------------------------------

export async function datosCosto(c: Cliente, fecha: string) {
  const costosN0 = new Map<string, string | null>((await c.query("SELECT clave, costo_referencia::text AS costo FROM articulo WHERE tipo IN ('INSUMO', 'EMPAQUE')")).rows.map((r) => [r.clave, r.costo]));
  const tarifas = new Map<string, string>((await c.query(
    "SELECT DISTINCT ON (t.etapa_id) e.clave, t.costo_minuto::text AS v FROM tarifa_mod t JOIN etapa_produccion e ON e.id = t.etapa_id WHERE t.vigente_desde <= $1 ORDER BY t.etapa_id, t.vigente_desde DESC",
    [fecha],
  )).rows.map((r) => [r.clave, r.v]));
  const gif = new Map<BaseGif, string>((await c.query("SELECT DISTINCT ON (base) base, tasa::text AS v FROM tasa_gif WHERE vigente_desde <= $1 ORDER BY base, vigente_desde DESC", [fecha])).rows.map((r) => [r.base, r.v]));
  return { costosN0, tarifas, gif };
}

function costoJson(x: CostoArticulo | undefined) {
  if (!x) return null;
  return {
    mp: num(x.mp), mod: num(x.mod), gif: num(x.gif), total: num(x.total), completo: x.completo, faltantes: x.faltantes,
    rendimiento: num(x.rendimiento),
    componentes: x.componentes.map((l) => ({ clave: l.clave, tipo: l.tipo, cantidad: num(l.cantidad), costo_unitario: num(l.costoUnitario), importe: num(l.importe) })),
    etapas: x.etapas.map((l) => ({ etapa: l.etapa, minutos: num(l.minutos), costo_minuto: num(l.costoMinuto), importe: num(l.importe) })),
    gif_detalle: x.gifDetalle.map((l) => ({ base: l.base, cantidad: num(l.cantidad), tasa: num(l.tasa), importe: num(l.importe) })),
  };
}

/**
 * Costo estándar de todas las recetas vigentes en la fecha, con precio y
 * margen de cada SKU. Con `cambios` (costo nuevo por insumo) calcula también
 * el impacto: costo y margen nuevos de toda la cadena.
 */
export async function calcularCostos(c: Cliente, fecha: string, cambios?: Map<string, string>) {
  const vig = await recetasVigentes(c, fecha);
  const datos = await datosCosto(c, fecha);
  const formula = await formulaMerma(c);
  const base = costear({ recetas: vig.recetas, ...datos, formula });
  const nuevo = cambios?.size ? costear({ recetas: vig.recetas, ...datos, costosN0: new Map([...datos.costosN0, ...cambios]), formula }) : null;

  const precios = new Map((await c.query(
    `SELECT DISTINCT ON (articulo_id) articulo_id::text, precio::text FROM precio_venta
      WHERE sucursal_id IS NULL AND vigente_desde <= $1 ORDER BY articulo_id, vigente_desde DESC`,
    [fecha],
  )).rows.map((r) => [r.articulo_id, r.precio]));
  const articulos = (await c.query(
    `SELECT a.id::text, a.clave, a.nombre, a.tipo, u.clave AS unidad,
            iva.tipo_factor AS iva_tipo, iva.tasa::text AS iva_tasa, ieps.tipo_factor AS ieps_tipo, ieps.tasa::text AS ieps_tasa
       FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id
       LEFT JOIN tasa_impuesto iva ON iva.id = a.tasa_iva_id LEFT JOIN tasa_impuesto ieps ON ieps.id = a.tasa_ieps_id
      WHERE a.activo AND a.tipo IN ('INTERMEDIO', 'SKU') ORDER BY a.tipo, a.clave`,
  )).rows;

  const conMargen = (art: any, costo: CostoArticulo | undefined) => {
    const precio = precios.get(art.id) ?? null;
    if (art.tipo !== "SKU" || !precio || !costo) return { precio, precio_sin_impuestos: null, margen: null, margen_pct: null };
    const sin = precioSinImpuestos(precio, art.iva_tipo ? { tipoFactor: art.iva_tipo, tasa: art.iva_tasa } : null, art.ieps_tipo ? { tipoFactor: art.ieps_tipo, tasa: art.ieps_tasa } : null);
    if (!sin) return { precio, precio_sin_impuestos: null, margen: null, margen_pct: null };
    const m = margen(sin, costo.total);
    return { precio, precio_sin_impuestos: num(sin, 4), margen: num(m.importe, 4), margen_pct: num(m.pct, 2) };
  };

  return {
    fecha,
    formula_merma: formula,
    faltan_tarifas: !datos.tarifas.size,
    faltan_gif: !datos.gif.size,
    articulos: articulos.map((a) => {
      const v = vig.versiones.get(a.clave);
      const costo = base.get(a.clave);
      const x = costo ? { ...costoJson(costo)!, ...conMargen(a, costo) } : null;
      const n = nuevo?.get(a.clave);
      const cambio = n && costo ? { ...costoJson(n)!, ...conMargen(a, n), diferencia: num(n.total.minus(costo.total)), diferencia_pct: costo.total.isZero() ? null : num(n.total.minus(costo.total).div(costo.total).mul(100), 2) } : null;
      return {
        articulo_id: a.id, clave: a.clave, nombre: a.nombre, nivel: a.tipo === "SKU" ? "N2" : "N1", unidad: a.unidad,
        version: v?.version ?? null, receta_id: v?.receta_id ?? null,
        problemas: vig.problemas.get(a.clave) ?? (v ? [] : ["Sin receta activa en esta fecha."]),
        costo: x,
        nuevo: cambio,
      };
    }),
  };
}

export async function guardarCosteo(c: Cliente, usuarioId: string, fecha: string, comentario: string | null) {
  const r = await calcularCostos(c, fecha);
  const conCosto = r.articulos.filter((a) => a.costo && a.receta_id);
  if (!conCosto.length) throw invalido("No hay recetas activas para costear en esa fecha.");
  const id = (await c.query("INSERT INTO costeo (fecha, comentario, usuario_id) VALUES ($1, $2, $3) RETURNING id", [fecha, comentario, usuarioId])).rows[0].id as string;
  await c.query(
    `INSERT INTO costo_estandar (costeo_id, receta_id, articulo_id, costo_mp, costo_mod, costo_gif, costo_total, completo, precio_sin_impuestos, margen, desglose)
     SELECT $1, x.receta_id, x.articulo_id, x.mp, x.mod, x.gif, x.total, x.completo, x.psi, x.margen, x.desglose
       FROM jsonb_to_recordset($2::jsonb) AS x(receta_id uuid, articulo_id uuid, mp numeric, mod numeric, gif numeric, total numeric, completo boolean, psi numeric, margen numeric, desglose jsonb)`,
    [id, JSON.stringify(conCosto.map((a) => ({
      receta_id: a.receta_id, articulo_id: a.articulo_id, mp: a.costo!.mp, mod: a.costo!.mod, gif: a.costo!.gif, total: a.costo!.total,
      completo: a.costo!.completo, psi: a.costo!.precio_sin_impuestos, margen: a.costo!.margen,
      desglose: { version: a.version, ...a.costo, formula_merma: r.formula_merma },
    })))],
  );
  return { id, fecha, articulos: conCosto.length };
}

// ---------------------------------------------------------------------------
// Plan de producción: explosión, existencias, aprobación y requisición
// ---------------------------------------------------------------------------

export async function cargarPlan(c: Cliente, id: string, bloquear = false) {
  const p = (await c.query(
    `SELECT p.id, p.folio, p.fecha::text, p.estatus, p.explosion, p.creado_en, p.aprobado_en, p.cancelado_en, p.motivo_cancelacion,
            t.clave AS turno, s.clave AS sucursal, ua.usuario AS aprobado_por, uc.usuario AS cancelado_por
       FROM plan_produccion p LEFT JOIN turno_produccion t ON t.id = p.turno_id LEFT JOIN sucursal s ON s.id = p.sucursal_id
       LEFT JOIN usuario ua ON ua.id = p.aprobado_por LEFT JOIN usuario uc ON uc.id = p.cancelado_por
      WHERE p.id = $1 ${bloquear ? "FOR UPDATE OF p" : ""}`,
    [id],
  )).rows[0];
  if (!p) throw noEncontrado("No existe ese plan.");
  return p;
}

type Articulos = Map<string, { id: string; clave: string; nombre: string; tipo: string; unidad: string; unidad_compra: string | null }>;

async function leerArticulos(c: Cliente): Promise<Articulos> {
  return new Map((await c.query(
    "SELECT a.id::text, a.clave, a.nombre, a.tipo, u.clave AS unidad, uc.clave AS unidad_compra FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id LEFT JOIN unidad uc ON uc.id = a.unidad_compra_id",
  )).rows.map((r) => [r.clave, r]));
}

function explosionJson(r: ResultadoExplosion, arts: Articulos, unidades: Unidades, problemasRecetas: Map<string, string[]>) {
  const info = (k: string) => ({ nombre: arts.get(k)?.nombre ?? k, unidad: arts.get(k)?.unidad ?? "" });
  const origen = (o: { de: string; cantidad: Dec }[]) => o.map((x) => ({ de: x.de, cantidad: num(x.cantidad) }));
  const problemas = [...r.problemas];
  const vistos = new Set([...r.skus.map((s) => s.clave), ...r.intermedios.map((i) => i.clave)]);
  for (const [k, ps] of problemasRecetas) if (vistos.has(k)) for (const m of ps) problemas.push({ articulo: k, mensaje: m });
  return {
    skus: r.skus.map((s) => ({ clave: s.clave, ...info(s.clave), version: s.version, piezas: num(s.piezas), piezas_formadas: num(s.piezasFormadas), alcanzan: num(s.alcanzan), completo: s.completo, limitantes: s.limitantes })),
    intermedios: r.intermedios.map((i) => ({
      clave: i.clave, ...info(i.clave), version: i.version, bruto: num(i.bruto), existencia: num(i.existencia), a_preparar: num(i.aPreparar), rendimiento: num(i.rendimiento),
      regla: i.regla, lotes: num(i.lotes), producido: num(i.producido), sobrante: num(i.sobrante), amasadas: num(i.amasadas), sin_receta: i.sinReceta, origen: origen(i.origen),
    })),
    materiales: r.materiales.map((m) => {
      const a = arts.get(m.clave);
      const f = a?.unidad_compra && a.unidad_compra !== a.unidad ? factorConversion(a.unidad, a.unidad_compra, { base: a.unidad, propias: unidades.propias.get(m.clave) ?? [] }, unidades.generales) : null;
      return {
        clave: m.clave, ...info(m.clave), bruto: num(m.bruto), existencia: num(m.existencia), en_transito: num(m.transito), disponible: num(m.disponible), neto: num(m.neto),
        unidad_compra: f ? a!.unidad_compra : null, neto_compra: f ? num(m.neto.mul(f)) : null, origen: origen(m.origen),
      };
    }),
    problemas,
  };
}

export type ExplosionJson = ReturnType<typeof explosionJson>;

/** Explosión del plan con las recetas vigentes en su fecha y las existencias capturadas. */
export async function explotarPlan(c: Cliente, planId: string): Promise<ExplosionJson> {
  const p = await cargarPlan(c, planId);
  const lineas = (await c.query("SELECT a.clave AS sku, pr.piezas::text FROM plan_renglon pr JOIN articulo a ON a.id = pr.articulo_id WHERE pr.plan_id = $1 AND pr.activo", [planId])).rows;
  const disponibles = new Map((await c.query("SELECT a.clave, pe.existencia::text, pe.en_transito::text FROM plan_existencia pe JOIN articulo a ON a.id = pe.articulo_id WHERE pe.plan_id = $1", [planId])).rows.map((r) => [r.clave, { existencia: r.existencia, transito: r.en_transito }]));
  const unidades = await leerUnidades(c);
  const vig = await recetasVigentes(c, p.fecha, unidades);
  const r = explotar({ plan: lineas, recetas: vig.recetas, disponibles, formula: await formulaMerma(c) });
  return explosionJson(r, await leerArticulos(c), unidades, vig.problemas);
}

export async function guardarExistencias(c: Cliente, planId: string, lista: { articulo: string; existencia: string; en_transito: string }[]) {
  const p = await cargarPlan(c, planId, true);
  if (p.estatus !== "BORRADOR") throw new ErrorApp(409, "estatus", "El plan ya no está en borrador.");
  const arts = await leerArticulos(c);
  const malos = lista.filter((x) => !arts.has(x.articulo) || arts.get(x.articulo)!.tipo === "SKU");
  if (malos.length) throw invalido(`Artículo no válido: ${malos.map((x) => x.articulo).join(", ")}.`);
  await c.query(
    `INSERT INTO plan_existencia (plan_id, articulo_id, existencia, en_transito)
     SELECT $1, a.id, x.existencia, x.en_transito FROM jsonb_to_recordset($2::jsonb) AS x(articulo text, existencia numeric, en_transito numeric)
       JOIN articulo a ON a.clave = x.articulo
     ON CONFLICT (plan_id, articulo_id) DO UPDATE SET existencia = EXCLUDED.existencia, en_transito = EXCLUDED.en_transito
      WHERE plan_existencia.existencia IS DISTINCT FROM EXCLUDED.existencia OR plan_existencia.en_transito IS DISTINCT FROM EXCLUDED.en_transito`,
    [planId, JSON.stringify(lista)],
  );
}

export async function aprobarPlan(c: Cliente, usuarioId: string, planId: string) {
  const p = await cargarPlan(c, planId, true);
  if (p.estatus !== "BORRADOR") throw new ErrorApp(409, "estatus", `El plan está ${p.estatus.toLowerCase()}.`);
  const exp = await explotarPlan(c, planId);
  if (!exp.skus.length) throw invalido("El plan no tiene piezas que producir.");
  if (exp.problemas.length) throw invalido("El plan tiene problemas y no se puede aprobar.", exp.problemas.map((x) => ({ campo: x.articulo, mensaje: `${x.articulo}: ${x.mensaje}` })));
  await c.query("UPDATE plan_produccion SET estatus = 'APROBADO', explosion = $2, aprobado_por = $3, aprobado_en = now() WHERE id = $1", [planId, JSON.stringify(exp), usuarioId]);
  return { id: planId, estatus: "APROBADO" };
}

export async function cancelarPlan(c: Cliente, usuarioId: string, planId: string, motivo: string) {
  const p = await cargarPlan(c, planId, true);
  if (p.estatus === "CANCELADO") throw new ErrorApp(409, "estatus", "El plan ya está cancelado.");
  if (!motivo.trim()) throw invalido("Escribe el motivo de la cancelación.");
  await c.query("UPDATE plan_produccion SET estatus = 'CANCELADO', cancelado_por = $2, cancelado_en = now(), motivo_cancelacion = $3 WHERE id = $1", [planId, usuarioId, motivo.trim()]);
  await c.query("UPDATE requisicion SET estatus = 'CANCELADA', comentario = coalesce(comentario || ' · ', '') || 'Cancelada con el plan' WHERE plan_id = $1 AND estatus = 'BORRADOR'", [planId]);
  return { id: planId, estatus: "CANCELADO" };
}

/** Requisición en borrador con el requerimiento neto de materia prima del plan aprobado. */
export async function generarRequisicion(c: Cliente, usuarioId: string, planId: string) {
  const p = await cargarPlan(c, planId, true);
  if (p.estatus !== "APROBADO") throw invalido("Primero aprueba el plan.");
  const ya = (await c.query("SELECT folio FROM requisicion WHERE plan_id = $1 AND estatus <> 'CANCELADA'", [planId])).rows[0];
  if (ya) throw new ErrorApp(409, "duplicado", `El plan ya tiene la requisición ${ya.folio}.`);
  const exp = p.explosion as ExplosionJson;
  const netos = exp.materiales.filter((m) => new D(m.neto ?? 0).gt(0));
  if (!netos.length) throw invalido("Con las existencias capturadas no hace falta comprar nada para este plan.");
  const req = (await c.query(
    "INSERT INTO requisicion (origen, plan_id, solicitante_id, requerido_para, comentario) VALUES ('EXPLOSION', $1, $2, $3, $4) RETURNING id, folio",
    [planId, usuarioId, p.fecha, `Generada desde el plan ${p.folio}`],
  )).rows[0];
  await c.query(
    `INSERT INTO requisicion_renglon (requisicion_id, articulo_id, cantidad, unidad_id, cantidad_compra, unidad_compra_id)
     SELECT $1, a.id, x.cantidad, a.unidad_base_id, x.compra, uc.id
       FROM jsonb_to_recordset($2::jsonb) AS x(clave text, cantidad numeric, compra numeric, unidad_compra text)
       JOIN articulo a ON a.clave = x.clave LEFT JOIN unidad uc ON uc.clave = x.unidad_compra`,
    [req.id, JSON.stringify(netos.map((m) => ({
      clave: m.clave,
      cantidad: new D(m.neto!).toDecimalPlaces(6, Decimal.ROUND_UP).toFixed(),
      compra: m.neto_compra ? new D(m.neto_compra).toDecimalPlaces(6, Decimal.ROUND_UP).toFixed() : null,
      unidad_compra: m.neto_compra ? m.unidad_compra : null,
    })))],
  );
  return { id: req.id, folio: req.folio, renglones: netos.length };
}

export async function requisicionesDePlan(c: Cliente, planId: string) {
  const reqs = (await c.query("SELECT r.id, r.folio, r.estatus, r.requerido_para::text, r.creado_en, u.usuario AS solicitante FROM requisicion r JOIN usuario u ON u.id = r.solicitante_id WHERE r.plan_id = $1 ORDER BY r.creado_en", [planId])).rows;
  for (const r of reqs) {
    r.renglones = (await c.query(
      `SELECT a.clave, a.nombre, rr.cantidad::text, u.clave AS unidad, rr.cantidad_compra::text, uc.clave AS unidad_compra
         FROM requisicion_renglon rr JOIN articulo a ON a.id = rr.articulo_id JOIN unidad u ON u.id = rr.unidad_id LEFT JOIN unidad uc ON uc.id = rr.unidad_compra_id
        WHERE rr.requisicion_id = $1 ORDER BY a.clave`,
      [r.id],
    )).rows;
  }
  return reqs;
}
