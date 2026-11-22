// Órdenes de producción (Fase 5): se generan desde un plan aprobado (o a mano),
// se surten con vales a producción en proceso, registran su avance por etapa y,
// al cerrarse, consumen lo real del almacén PEP y dan entrada al producto a su
// costo real. El balance de masa y piezas y las variaciones contra el estándar
// quedan fotografiados en la orden. También: trazabilidad por lote, reportes de
// variaciones y rendimiento, sobrantes y estado de costo de producción y ventas.
import { balanceOrden, costoOrden, estadoCostos, estandarN1, estandarN2, variacionTotal, type EstandarOrden, type Grupo, type SaldoGrupo } from "../dominio/produccion";
import { D, type BaseGif, type Dec, type RecetaN1, type RecetaN2 } from "../dominio/recetas";
import { ErrorApp, invalido, noEncontrado, prohibido } from "./errores";
import { hoyNegocio } from "./fechas";
import { almacenPorClave, consumoPorOrden, entradaPorOrden, exigirAlmacen, surtir, type Almacen } from "./inventarios";
import { calcularCostos, datosCosto, formulaMerma, num, recetasVigentes, type ExplosionJson } from "./recetas";
import type { Cliente } from "./transaccion";
import type { UsuarioActual } from "./usuarios";

type Alc = UsuarioActual["alcance"];
/** Una orden se ve si el almacén de producción está en el alcance o en una sucursal donde el usuario tiene almacenes. */
const VISIBLE = `($1::boolean OR pep.id = ANY($2::uuid[]) OR pep.sucursal_id = ANY($3::uuid[]) OR pep.sucursal_id IN (SELECT sucursal_id FROM almacen WHERE id = ANY($2::uuid[])))`;
const pa = (a: Alc) => [a.todas, a.almacenes, a.sucursales];

async function config(c: Cliente) {
  const v = new Map((await c.query("SELECT clave, valor FROM configuracion WHERE clave LIKE 'produccion.tolerancia_%'")).rows.map((r) => [r.clave, r.valor]));
  const t = (k: string, def: string) => new D(v.get(`produccion.tolerancia_${k}`) ?? def);
  return { masaPct: t("masa_pct", "3"), piezasPct: t("piezas_pct", "5"), consumoPct: t("consumo_pct", "5"), surtidoPct: t("surtido_pct", "5") };
}

async function tasasDe(c: Cliente, fecha: string) {
  const d = await datosCosto(c, fecha);
  return {
    tarifas: new Map([...d.tarifas].map(([k, v]) => [k, v === null ? null : new D(v)])),
    gif: new Map([...d.gif].map(([k, v]) => [k as BaseGif, new D(v)])),
  };
}

/** Costo estándar a la fecha: N0 = costo de referencia; N1 y N2 = costo estándar de la receta vigente. */
async function costosEstandar(c: Cliente, fecha: string): Promise<Map<string, Dec | null>> {
  const m = new Map<string, Dec | null>();
  for (const r of (await c.query("SELECT clave, costo_referencia::text AS c FROM articulo WHERE tipo IN ('INSUMO', 'EMPAQUE')")).rows) m.set(r.clave, r.c === null ? null : new D(r.c));
  for (const a of (await calcularCostos(c, fecha)).articulos) m.set(a.clave, a.costo?.total ? new D(a.costo.total) : null);
  return m;
}

/** Almacén PT de la sucursal del PEP (destino de los productos). */
async function ptDeSucursal(c: Cliente, pep: Almacen): Promise<string> {
  const id = (await c.query("SELECT id FROM almacen WHERE tipo = 'PT' AND activo AND sucursal_id = $1 ORDER BY clave LIMIT 1", [pep.sucursal_id])).rows[0]?.id;
  if (!id) throw invalido(`La sucursal ${pep.sucursal} no tiene almacén de producto terminado.`);
  return id;
}

async function pepPorOmision(c: Cliente, sucursalId: string | null): Promise<string> {
  const a = (await c.query(
    `SELECT a.clave FROM almacen a JOIN sucursal s ON s.id = a.sucursal_id
      WHERE a.tipo = 'PEP' AND a.activo AND ($1::uuid IS NULL AND s.es_planta OR a.sucursal_id = $1) ORDER BY a.clave LIMIT 1`,
    [sucursalId],
  )).rows[0];
  if (!a) throw invalido("No hay un almacén de producción en proceso (PEP) para el plan.");
  return a.clave;
}

// ---------------------------------------------------------------------------
// Alta de órdenes
// ---------------------------------------------------------------------------
interface NuevaOrden {
  planId: string | null; fecha: string; articulo: { id: string; clave: string; tipo: string; unidad: string };
  version: number; recetaId: string; pep: Almacen; destinoId: string; cantidad: Dec; lotes: Dec | null; comentario: string | null;
}

async function insertarOrden(c: Cliente, u: UsuarioActual, o: NuevaOrden, std: EstandarOrden, costos: Map<string, Dec | null>) {
  const nivel = o.articulo.tipo === "SKU" ? "N2" : "N1";
  const r = (await c.query(
    `INSERT INTO orden_produccion (plan_id, nivel, articulo_id, receta_id, receta_version, fecha, almacen_pep_id, almacen_destino_id, cantidad_plan, lotes_plan, formadas_plan, costo_estandar, comentario, liberada_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id, folio`,
    [o.planId, nivel, o.articulo.id, o.recetaId, o.version, o.fecha, o.pep.id, o.destinoId, o.cantidad.toFixed(), nivel === "N1" ? num(std.lotes) : null,
      nivel === "N2" ? num(std.formadas) : null, num(costos.get(o.articulo.clave) ?? null), o.comentario, u.id],
  )).rows[0] as { id: string; folio: string };
  await c.query(
    `INSERT INTO orden_componente (orden_id, articulo_id, tipo, cantidad_estandar, costo_estandar)
     SELECT $1, a.id, x.tipo, x.cantidad, x.costo FROM jsonb_to_recordset($2::jsonb) AS x(clave text, tipo text, cantidad numeric, costo numeric) JOIN articulo a ON a.clave = x.clave`,
    [r.id, JSON.stringify(std.componentes.map((x) => ({ clave: x.clave, tipo: x.tipo, cantidad: num(x.cantidad), costo: num(costos.get(x.clave) ?? null) })))],
  );
  await c.query(
    `INSERT INTO orden_etapa (orden_id, etapa_id, minutos_estandar)
     SELECT $1, e.id, x.minutos FROM jsonb_to_recordset($2::jsonb) AS x(etapa text, minutos numeric) JOIN etapa_produccion e ON e.clave = x.etapa`,
    [r.id, JSON.stringify(std.etapas.map((x) => ({ etapa: x.etapa, minutos: x.minutos.toDecimalPlaces(4).toFixed() })))],
  );
  return r;
}

function estandarDe(nivel: "N1" | "N2", receta: RecetaN1 | RecetaN2, cantidad: Dec, formula: "DIVIDIR" | "MULTIPLICAR", lotes: Dec | null) {
  return nivel === "N1" ? estandarN1(receta as RecetaN1, cantidad, formula, lotes) : estandarN2(receta as RecetaN2, cantidad, formula);
}

/** Genera las órdenes N1 (masas e intermedios a preparar) y N2 (productos) de un plan aprobado. */
export async function generarOrdenes(c: Cliente, u: UsuarioActual, planId: string, almacen?: string | null) {
  const p = (await c.query("SELECT id, folio, fecha::text, estatus, sucursal_id, explosion FROM plan_produccion WHERE id = $1 FOR UPDATE", [planId])).rows[0];
  if (!p) throw noEncontrado("No existe ese plan.");
  if (p.estatus !== "APROBADO") throw invalido("Las órdenes se generan de un plan aprobado.");
  const ya = (await c.query("SELECT count(*)::int AS n FROM orden_produccion WHERE plan_id = $1 AND estatus <> 'CANCELADA'", [planId])).rows[0].n;
  if (ya) throw new ErrorApp(409, "duplicado", `El plan ${p.folio} ya tiene sus órdenes de producción.`);
  const pep = await almacenPorClave(c, almacen || await pepPorOmision(c, p.sucursal_id));
  if (pep.tipo !== "PEP") throw invalido("Las órdenes se producen en un almacén de producción en proceso (PEP).");
  if (p.sucursal_id && pep.sucursal_id !== p.sucursal_id) throw invalido("El almacén de producción debe ser de la sucursal del plan.");
  exigirAlmacen(u, pep);
  const pt = await ptDeSucursal(c, pep);
  const exp = p.explosion as ExplosionJson;
  const vig = await recetasVigentes(c, p.fecha);
  const formula = await formulaMerma(c);
  const costos = await costosEstandar(c, p.fecha);
  const arts = new Map((await c.query("SELECT a.id, a.clave, a.tipo, u.clave AS unidad FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id")).rows.map((r) => [r.clave, r]));
  const recetaId = (clave: string, version: number) => vig.versiones.get(clave)?.version === version ? vig.versiones.get(clave)!.receta_id : null;

  const ordenes = new Map<string, { id: string; folio: string }>();
  const pendientes: { clave: string; nivel: "N1" | "N2"; version: number; cantidad: Dec; lotes: Dec | null }[] = [
    ...exp.intermedios.filter((i) => !i.sin_receta && new D(i.lotes ?? 0).gt(0)).map((i) => ({ clave: i.clave, nivel: "N1" as const, version: i.version!, cantidad: new D(i.producido!), lotes: new D(i.lotes!) })),
    ...exp.skus.filter((s) => s.version !== null && new D(s.piezas ?? 0).gt(0)).map((s) => ({ clave: s.clave, nivel: "N2" as const, version: s.version!, cantidad: new D(s.piezas!), lotes: null })),
  ];
  if (!pendientes.length) throw invalido("El plan no tiene nada que producir.");
  for (const x of pendientes) {
    const rid = recetaId(x.clave, x.version);
    const receta = x.nivel === "N1" ? vig.recetas.n1.get(x.clave) : vig.recetas.n2.get(x.clave);
    if (!rid || !receta) throw new ErrorApp(409, "regla", `La receta vigente de ${x.clave} ya no es la versión ${x.version} con que se aprobó el plan: cancela el plan y vuelve a aprobarlo.`);
    const std = estandarDe(x.nivel, receta, x.cantidad, formula, x.lotes);
    ordenes.set(x.clave, await insertarOrden(c, u, {
      planId, fecha: p.fecha, articulo: arts.get(x.clave)!, version: x.version, recetaId: rid, pep, destinoId: x.nivel === "N1" ? pep.id : pt,
      cantidad: x.cantidad, lotes: x.lotes, comentario: `Generada del plan ${p.folio}`,
    }, std, costos));
  }
  // Dependencias: la orden que usa un intermedio depende de la orden que lo prepara.
  for (const i of exp.intermedios) {
    const origen = ordenes.get(i.clave);
    if (!origen) continue;
    for (const o of i.origen) {
      const destino = ordenes.get(o.de);
      if (destino) await c.query("INSERT INTO orden_dependencia (orden_id, orden_origen_id, cantidad) VALUES ($1, $2, $3)", [destino.id, origen.id, o.cantidad]);
    }
  }
  return { plan: p.folio, ordenes: [...ordenes.values()].map((o) => o.folio) };
}

/** Orden capturada a mano (reproceso, pedido especial o producción fuera del plan). */
export async function crearOrden(c: Cliente, u: UsuarioActual, d: { articulo: string; cantidad: string; fecha?: string | null; almacen: string; comentario?: string | null }) {
  const pep = await almacenPorClave(c, d.almacen);
  if (pep.tipo !== "PEP") throw invalido("Las órdenes se producen en un almacén de producción en proceso (PEP).");
  exigirAlmacen(u, pep);
  const art = (await c.query("SELECT a.id, a.clave, a.tipo, u.clave AS unidad FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id WHERE a.clave = upper($1) AND a.activo", [d.articulo])).rows[0];
  if (!art || !["INTERMEDIO", "SKU"].includes(art.tipo)) throw invalido("La orden es de una masa, un intermedio o un producto terminado activo.");
  let cantidad: Dec;
  try { cantidad = new D(d.cantidad.replaceAll(",", "")); } catch { throw invalido("Cantidad no válida."); }
  if (!cantidad.isFinite() || cantidad.lte(0)) throw invalido("La cantidad debe ser mayor que cero.");
  if (art.unidad === "PZA" && !cantidad.isInteger()) throw invalido("Las piezas van en números enteros.");
  const fecha = d.fecha || await hoyNegocio(c);
  const vig = await recetasVigentes(c, fecha);
  const nivel = art.tipo === "SKU" ? "N2" : "N1";
  const receta = nivel === "N1" ? vig.recetas.n1.get(art.clave) : vig.recetas.n2.get(art.clave);
  const v = vig.versiones.get(art.clave);
  if (!receta || !v) throw invalido(`${art.clave} no tiene receta activa vigente al ${fecha.split("-").reverse().join("/")}.`);
  const std = estandarDe(nivel, receta, cantidad, await formulaMerma(c), null);
  const o = await insertarOrden(c, u, {
    planId: null, fecha, articulo: art, version: v.version, recetaId: v.receta_id, pep, destinoId: nivel === "N1" ? pep.id : await ptDeSucursal(c, pep),
    cantidad, lotes: null, comentario: d.comentario?.trim() || null,
  }, std, await costosEstandar(c, fecha));
  return o;
}

// ---------------------------------------------------------------------------
// Operación
// ---------------------------------------------------------------------------
async function ordenBloqueada(c: Cliente, u: UsuarioActual, id: string, alcancePep = true) {
  const o = (await c.query(
    `SELECT o.*, o.fecha::text AS fecha, a.clave AS articulo, a.tipo AS articulo_tipo, ua.clave AS unidad,
            pep.clave AS pep, pep.sucursal_id AS pep_sucursal, pep.tipo AS pep_tipo
       FROM orden_produccion o JOIN articulo a ON a.id = o.articulo_id JOIN unidad ua ON ua.id = a.unidad_base_id
       JOIN almacen pep ON pep.id = o.almacen_pep_id WHERE o.id = $1 FOR UPDATE OF o`,
    [id],
  )).rows[0];
  if (!o) throw noEncontrado("No existe esa orden de producción.");
  if (alcancePep) exigirAlmacen(u, { id: o.almacen_pep_id, sucursal_id: o.pep_sucursal, clave: o.pep } as Almacen);
  return o;
}

const abierta = (o: { estatus: string; folio: string }) => {
  if (o.estatus !== "LIBERADA" && o.estatus !== "EN_PROCESO") throw new ErrorApp(409, "estatus", `La orden ${o.folio} está ${o.estatus.toLowerCase().replace("_", " ")}.`);
};

/** Lo surtido a la orden (vales no cancelados), por artículo. */
async function surtidoDe(c: Cliente, ordenId: string): Promise<Map<string, Dec>> {
  const { rows } = await c.query(
    `SELECT r.articulo_id, sum(r.cantidad)::text AS q FROM surtido s JOIN movimiento m ON m.id = s.entrada_id AND m.cancelado_por_id IS NULL
       JOIN movimiento_renglon r ON r.movimiento_id = m.id WHERE s.orden_id = $1 GROUP BY r.articulo_id`,
    [ordenId],
  );
  return new Map(rows.map((r) => [r.articulo_id, new D(r.q)]));
}

/** Vale de surtido de la orden: materia prima e insumos al almacén de producción en proceso. */
export async function surtirOrden(c: Cliente, u: UsuarioActual, id: string, d: { origen: string; renglones: { articulo: string; cantidad: string; lote?: string | null }[]; motivo?: string | null }) {
  // El almacenista surte desde su almacén (se valida el alcance sobre el origen, como en todo vale).
  const o = await ordenBloqueada(c, u, id, false);
  abierta(o);
  const origen = await almacenPorClave(c, d.origen);
  if (origen.sucursal_id !== o.pep_sucursal) throw invalido("El vale se surte desde un almacén de la misma sucursal que la orden.");
  const comps = (await c.query("SELECT oc.articulo_id, a.clave, oc.tipo, oc.cantidad_estandar::text AS std FROM orden_componente oc JOIN articulo a ON a.id = oc.articulo_id WHERE oc.orden_id = $1", [id])).rows;
  const porClave = new Map(comps.map((x) => [x.clave, x]));
  const malos = d.renglones.filter((r) => !porClave.has(r.articulo.toUpperCase()) || ["MASA", "INTERMEDIO"].includes(porClave.get(r.articulo.toUpperCase())!.tipo));
  if (malos.length) throw invalido(`No es materia prima ni empaque de la receta de esta orden: ${malos.map((r) => r.articulo).join(", ")}. Las masas e intermedios salen de sus propias órdenes.`);
  const tol = (await config(c)).surtidoPct;
  const previo = await surtidoDe(c, id);
  const exceso: string[] = [];
  const nuevo = new Map<string, Dec>();
  for (const r of d.renglones) {
    const k = r.articulo.toUpperCase();
    let q: Dec;
    try { q = new D(r.cantidad.replaceAll(",", "")); } catch { throw invalido(`${k}: cantidad no válida.`); }
    nuevo.set(k, (nuevo.get(k) ?? new D(0)).plus(q));
  }
  for (const [k, q] of nuevo) {
    const x = porClave.get(k)!;
    const total = (previo.get(x.articulo_id) ?? new D(0)).plus(q);
    const limite = new D(x.std).mul(new D(100).plus(tol)).div(100);
    if (total.gt(limite)) exceso.push(`${k}: se surtirían ${total.toDecimalPlaces(3).toFixed()} contra ${new D(x.std).toDecimalPlaces(3).toFixed()} estándar`);
  }
  if (exceso.length && !d.motivo?.trim()) {
    throw new ErrorApp(409, "tolerancia", `El vale pasa del estándar más ${tol.toFixed()} %: escribe el motivo.`, exceso.map((mensaje) => ({ campo: "motivo", mensaje })));
  }
  const s = await surtir(c, u, {
    origen: d.origen, destino: o.pep, plan_id: o.plan_id, orden_id: id, referencia: o.folio,
    comentario: [`Vale de la orden ${o.folio}`, exceso.length ? `Sobre estándar: ${d.motivo!.trim()}` : d.motivo?.trim()].filter(Boolean).join(" · "),
    renglones: d.renglones.map((r) => ({ articulo: r.articulo, cantidad: r.cantidad, lote: r.lote ?? null })),
  });
  return { ...s, sobre_estandar: exceso };
}

/** Avance por etapa: piezas (o kg) que terminaron la etapa, merma con su causa y minutos. */
export async function registrarAvance(c: Cliente, u: UsuarioActual, id: string, d: { etapa: string; cantidad?: string | null; merma?: string | null; causa?: string | null; minutos?: string | null; comentario?: string | null }) {
  const o = await ordenBloqueada(c, u, id);
  abierta(o);
  const etapa = (await c.query("SELECT id, clave, registra_merma FROM etapa_produccion WHERE clave = upper($1) AND activo", [d.etapa])).rows[0];
  if (!etapa) throw invalido(`No existe la etapa ${d.etapa}.`);
  const dec = (v: string | null | undefined, n: string) => {
    if (v === null || v === undefined || v === "") return new D(0);
    let x: Dec;
    try { x = new D(v.replaceAll(",", "")); } catch { throw invalido(`${n} no válida.`); }
    if (x.lt(0)) throw invalido(`${n} no puede ser negativa.`);
    return x;
  };
  const cantidad = dec(d.cantidad, "La cantidad");
  const merma = dec(d.merma, "La merma");
  const minutos = d.minutos ? dec(d.minutos, "Los minutos") : null;
  if (o.nivel === "N2" && (!cantidad.isInteger() || !merma.isInteger())) throw invalido("Las piezas van en números enteros.");
  if (merma.gt(0) && !etapa.registra_merma) throw invalido(`En la etapa ${etapa.clave} no se registra merma (catálogo de etapas).`);
  let causaId: string | null = null;
  if (merma.gt(0)) {
    if (!d.causa) throw invalido("Indica la causa de la merma.");
    causaId = (await c.query("SELECT id FROM causa_merma WHERE clave = upper($1) AND activo", [d.causa])).rows[0]?.id ?? null;
    if (!causaId) throw invalido(`No existe la causa de merma ${d.causa}.`);
  }
  if (cantidad.isZero() && merma.isZero() && !minutos?.gt(0)) throw invalido("Captura la cantidad, la merma o los minutos de la etapa.");
  await c.query(
    "INSERT INTO orden_avance (orden_id, etapa_id, cantidad, merma, causa_id, minutos, comentario, usuario_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [id, etapa.id, cantidad.toFixed(), merma.toFixed(), causaId, minutos?.toFixed() ?? null, d.comentario?.trim() || null, u.id],
  );
  if (o.estatus === "LIBERADA") await c.query("UPDATE orden_produccion SET estatus = 'EN_PROCESO', iniciada_por = $2, iniciada_en = now() WHERE id = $1", [id, u.id]);
  return { folio: o.folio, estatus: "EN_PROCESO" };
}

export interface DatosCierre {
  cantidad: string;
  piezas_formadas?: string | null;
  consumos?: { articulo: string; cantidad: string }[] | null;
  minutos?: { etapa: string; minutos: string }[] | null;
  justificacion?: string | null;
}

/**
 * Cierre: consume lo real desde PEP, da entrada al producto a su costo real y
 * guarda balance y variaciones. Fuera de tolerancia exige justificación.
 */
export async function cerrarOrden(c: Cliente, u: UsuarioActual, id: string, d: DatosCierre) {
  const o = await ordenBloqueada(c, u, id);
  abierta(o);
  // Matriz aprobada: el maestro de masas cierra las órdenes de masa; las de producto, el jefe de producción.
  if (o.nivel === "N2" && !u.permisos.has("produccion.ordenes:crear")) throw prohibido("Las órdenes de producto terminado las cierra el jefe de producción.");
  const dec = (v: string, n: string) => {
    let x: Dec;
    try { x = new D(v.replaceAll(",", "")); } catch { throw invalido(`${n}: número no válido.`); }
    if (!x.isFinite() || x.lt(0)) throw invalido(`${n}: no puede ser negativo.`);
    return x;
  };
  const real = dec(d.cantidad, o.nivel === "N2" ? "Piezas buenas" : "Cantidad producida");
  if (real.lte(0)) throw invalido("Indica cuánto se produjo. Si no se produjo nada, cancela la orden.");
  if (o.nivel === "N2" && !real.isInteger()) throw invalido("Las piezas van en números enteros.");
  const ratio = real.div(new D(o.cantidad_plan));

  const comps = (await c.query(
    `SELECT oc.id, oc.articulo_id, a.clave, oc.tipo, u.clave AS unidad, oc.cantidad_estandar::text AS std, oc.costo_estandar::text AS costo
       FROM orden_componente oc JOIN articulo a ON a.id = oc.articulo_id JOIN unidad u ON u.id = a.unidad_base_id WHERE oc.orden_id = $1 ORDER BY a.clave`,
    [id],
  )).rows;
  const capturados = new Map<string, Dec>();
  for (const x of d.consumos ?? []) {
    const k = x.articulo.toUpperCase();
    if (!comps.some((y) => y.clave === k)) throw invalido(`${k} no es componente de la receta de esta orden.`);
    capturados.set(k, dec(x.cantidad, k));
  }
  const avance = (await c.query(
    "SELECT e.clave, coalesce(sum(av.merma), 0)::text AS merma, sum(av.minutos)::text AS minutos FROM orden_avance av JOIN etapa_produccion e ON e.id = av.etapa_id WHERE av.orden_id = $1 GROUP BY e.clave",
    [id],
  )).rows;
  const mermaAvance = avance.reduce((s, x) => s.plus(x.merma), new D(0));
  let formadas: Dec | null = null;
  if (o.nivel === "N2") {
    if (d.piezas_formadas) formadas = dec(d.piezas_formadas, "Piezas formadas");
    else formadas = avance.length ? real.plus(mermaAvance) : new D(o.formadas_plan).mul(ratio).toDecimalPlaces(0, D.ROUND_HALF_UP);
    if (!formadas.isInteger()) throw invalido("Las piezas formadas van en números enteros.");
    if (formadas.lt(real)) throw invalido("Las piezas formadas no pueden ser menos que las buenas.");
  }

  // 1) Consumo real desde producción en proceso
  const consumo = comps.map((x) => ({ ...x, estandar: new D(x.std).mul(ratio), real: capturados.get(x.clave) ?? new D(x.std).mul(ratio).toDecimalPlaces(6, D.ROUND_HALF_UP) }));
  const mov = await consumoPorOrden(c, u.id, o.almacen_pep_id, { id, folio: o.folio, plan_id: o.plan_id }, consumo.map((x) => ({ articulo_id: x.articulo_id, cantidad: x.real })));
  const importe = new Map<string, Dec>();
  for (const p of mov.porciones) importe.set(p.articulo_id, (importe.get(p.articulo_id) ?? new D(0)).plus(p.importe));
  const materiales = [...importe.values()].reduce((s, x) => s.plus(x), new D(0));

  // 2) Mano de obra e indirectos con los minutos reales (capturados, del avance o estándar)
  const etapas = (await c.query("SELECT oe.id, e.clave, oe.minutos_estandar::text AS std FROM orden_etapa oe JOIN etapa_produccion e ON e.id = oe.etapa_id WHERE oe.orden_id = $1 ORDER BY e.orden", [id])).rows;
  const minCapt = new Map((d.minutos ?? []).map((x) => [x.etapa.toUpperCase(), dec(x.minutos, `Minutos de ${x.etapa}`)]));
  for (const k of minCapt.keys()) if (!etapas.some((e) => e.clave === k)) throw invalido(`La etapa ${k} no es de la receta de esta orden.`);
  const minAv = new Map(avance.filter((x) => x.minutos !== null).map((x) => [x.clave, new D(x.minutos)]));
  const minutos = etapas.map((e) => ({ id: e.id, etapa: e.clave, std: new D(e.std).mul(ratio), minutos: minCapt.get(e.clave) ?? minAv.get(e.clave) ?? new D(e.std).mul(ratio).toDecimalPlaces(4, D.ROUND_HALF_UP) }));
  const tasas = await tasasDe(c, o.fecha);
  const costo = costoOrden({ nivel: o.nivel, cantidad: real, formadas, materiales, etapas: minutos.map((x) => ({ etapa: x.etapa, minutos: x.minutos })) }, tasas);
  const costoStd = costoOrden({ nivel: o.nivel, cantidad: real, formadas, materiales: new D(0), etapas: minutos.map((x) => ({ etapa: x.etapa, minutos: x.std })) }, tasas);

  // 3) Balance y tolerancias
  const tol = await config(c);
  const bal = balanceOrden({
    // Las piezas sin explicar se revisan solo con piezas formadas capturadas o con avance registrado (no con el estándar).
    nivel: o.nivel, buenas: real, formadas: d.piezas_formadas || avance.length ? formadas : null, mermaAvance, tolerancias: tol,
    componentes: consumo.map((x) => ({
      clave: x.clave, tipo: x.tipo, estandar: x.estandar, real: x.real, importeReal: importe.get(x.articulo_id) ?? new D(0),
      costoEstandar: x.costo === null ? null : new D(x.costo), esMasa: o.nivel === "N2" ? x.tipo === "MASA" : x.unidad === o.unidad,
    })),
  });
  if (bal.fuera.length && !d.justificacion?.trim()) {
    throw new ErrorApp(409, "tolerancia", "La orden está fuera de tolerancia: escribe la justificación para cerrarla.", bal.fuera.map((mensaje) => ({ campo: "justificacion", mensaje })));
  }

  // 4) Entrada del producto a su costo real
  const ent = await entradaPorOrden(c, u.id, o.almacen_destino_id, { id, folio: o.folio, plan_id: o.plan_id, fecha: o.fecha }, o.articulo_id, real, costo.total);
  for (const p of mov.porciones) {
    await c.query("INSERT INTO lote_genealogia (orden_id, lote_hijo_id, articulo_padre_id, lote_padre_id, cantidad, importe) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, ent.loteId, p.articulo_id, p.lote_id, p.cantidad.toFixed(), p.importe.toFixed()]);
  }
  for (const x of consumo) {
    await c.query("UPDATE orden_componente SET cantidad_real = $2, estandar_real = $3, importe_real = $4 WHERE id = $1",
      [x.id, x.real.toFixed(), num(x.estandar), (importe.get(x.articulo_id) ?? new D(0)).toFixed()]);
  }
  for (const [i, x] of minutos.entries()) {
    const e = costo.etapas[i]!;
    await c.query("UPDATE orden_etapa SET minutos_reales = $2, costo_minuto = $3, importe = $4 WHERE id = $1", [x.id, x.minutos.toFixed(), num(e.costoMinuto), num(e.importe)]);
  }
  const variacion = variacionTotal(costo.total, o.costo_estandar === null ? null : new D(o.costo_estandar), real);
  const n2 = (x: Dec | null | undefined) => num(x ?? null);
  const balance = {
    masa: bal.masa && { estandar: n2(bal.masa.estandar), real: n2(bal.masa.real), diferencia: n2(bal.masa.diferencia), pct: num(bal.masa.pct, 4), dentro: bal.masa.dentro },
    piezas: bal.piezas && {
      esperadas: n2(bal.piezas.esperadas), buenas: n2(bal.piezas.buenas), formadas: n2(bal.piezas.formadas), merma: n2(bal.piezas.merma),
      sin_explicar: n2(bal.piezas.sinExplicar), diferencia: n2(bal.piezas.diferencia), pct: num(bal.piezas.pct, 4), dentro: bal.piezas.dentro,
    },
    consumos: bal.consumos.map((x) => ({
      clave: x.clave, tipo: x.tipo, estandar: n2(x.estandar), real: n2(x.real), diferencia: n2(x.diferencia), pct: num(x.pct, 4), dentro: x.dentro,
      importe_estandar: n2(x.importeEstandar), importe_real: n2(x.importeReal), variacion_cantidad: n2(x.variacionCantidad), variacion_precio: n2(x.variacionPrecio),
    })),
    mod: { real: n2(costo.mod), estandar: n2(costoStd.mod), variacion: n2(costo.mod.minus(costoStd.mod)) },
    gif: { real: n2(costo.gif), estandar: n2(costoStd.gif), variacion: n2(costo.gif.minus(costoStd.gif)), detalle: costo.gifDetalle.map((g) => ({ base: g.base, cantidad: n2(g.cantidad), tasa: n2(g.tasa), importe: n2(g.importe) })) },
    total: { real: n2(costo.total), estandar: n2(variacion.estandar), variacion: n2(variacion.diferencia), pct: num(variacion.pct, 4) },
    fuera: bal.fuera,
    avisos: costo.faltantes,
  };
  await c.query(
    `UPDATE orden_produccion SET estatus = 'CERRADA', cantidad_real = $2, piezas_formadas = $3, costo_mp = $4, costo_mod = $5, costo_gif = $6, costo_total = $7,
            costo_unitario = $8, minutos_reales = $9, balance = $10, fuera_tolerancia = $11, justificacion = $12, consumo_id = $13, entrada_id = $14, lote_id = $15,
            cerrada_por = $16, cerrada_en = now(), iniciada_por = coalesce(iniciada_por, $16), iniciada_en = coalesce(iniciada_en, now())
      WHERE id = $1`,
    [id, real.toFixed(), formadas?.toFixed() ?? null, costo.mp.toFixed(), costo.mod.toFixed(), costo.gif.toFixed(), costo.total.toFixed(), num(costo.unitario),
      costo.minutos.toDecimalPlaces(4).toFixed(), JSON.stringify(balance), bal.fuera.length > 0, d.justificacion?.trim() || null, mov.movimiento.id, ent.movimiento.id, ent.loteId, u.id],
  );
  return { folio: o.folio, estatus: "CERRADA", consumo: mov.movimiento.folio, entrada: ent.movimiento.folio, costo_total: num(costo.total, 2), costo_unitario: num(costo.unitario, 4), fuera_tolerancia: bal.fuera.length > 0, balance };
}

export async function cancelarOrden(c: Cliente, u: UsuarioActual, id: string, motivo: string) {
  const o = await ordenBloqueada(c, u, id);
  abierta(o);
  const dep = (await c.query(
    `SELECT string_agg(x.folio, ', ') AS f FROM orden_dependencia d JOIN orden_produccion x ON x.id = d.orden_id
      WHERE d.orden_origen_id = $1 AND x.estatus IN ('LIBERADA', 'EN_PROCESO')`,
    [id],
  )).rows[0].f;
  await c.query("UPDATE orden_produccion SET estatus = 'CANCELADA', cancelada_por = $2, cancelada_en = now(), motivo_cancelacion = $3 WHERE id = $1", [id, u.id, motivo.trim()]);
  const surtido = (await surtidoDe(c, id)).size > 0;
  return {
    folio: o.folio, estatus: "CANCELADA",
    avisos: [
      ...(surtido ? ["Lo surtido a esta orden sigue en producción en proceso: úsalo en otra orden o cancela el vale para regresarlo al almacén."] : []),
      ...(dep ? [`Las órdenes ${dep} usaban lo que iba a producir esta orden.`] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
export async function listarOrdenes(c: Cliente, a: Alc, f: { desde?: string | null; hasta?: string | null; estatus?: string | null; plan_id?: string | null }) {
  const { rows } = await c.query(
    `SELECT o.id, o.folio, o.nivel, o.fecha::text, o.estatus, a.clave AS articulo, a.nombre, u.clave AS unidad, o.cantidad_plan::text, o.cantidad_real::text,
            o.costo_unitario::text, o.costo_estandar::text, o.fuera_tolerancia, p.folio AS plan, pep.clave AS almacen
       FROM orden_produccion o JOIN articulo a ON a.id = o.articulo_id JOIN unidad u ON u.id = a.unidad_base_id
       JOIN almacen pep ON pep.id = o.almacen_pep_id LEFT JOIN plan_produccion p ON p.id = o.plan_id
      WHERE ${VISIBLE} AND ($4::date IS NULL OR o.fecha >= $4) AND ($5::date IS NULL OR o.fecha <= $5) AND ($6::text IS NULL OR o.estatus = $6) AND ($7::uuid IS NULL OR o.plan_id = $7)
      ORDER BY o.fecha DESC, o.nivel, o.folio LIMIT 500`,
    [...pa(a), f.desde ?? null, f.hasta ?? null, f.estatus ?? null, f.plan_id ?? null],
  );
  return rows;
}

export async function detalleOrden(c: Cliente, a: Alc, id: string) {
  const o = (await c.query(
    `SELECT o.*, o.fecha::text AS fecha, a.clave AS articulo, a.nombre, a.tipo AS articulo_tipo, u.clave AS unidad, p.folio AS plan, pep.clave AS almacen_pep, dst.clave AS almacen_destino,
            ul.usuario AS liberada_por_usuario, uc.usuario AS cerrada_por_usuario, ux.usuario AS cancelada_por_usuario, l.codigo AS lote,
            mc.folio AS consumo, me.folio AS entrada
       FROM orden_produccion o JOIN articulo a ON a.id = o.articulo_id JOIN unidad u ON u.id = a.unidad_base_id
       JOIN almacen pep ON pep.id = o.almacen_pep_id JOIN almacen dst ON dst.id = o.almacen_destino_id LEFT JOIN plan_produccion p ON p.id = o.plan_id
       LEFT JOIN usuario ul ON ul.id = o.liberada_por LEFT JOIN usuario uc ON uc.id = o.cerrada_por LEFT JOIN usuario ux ON ux.id = o.cancelada_por
       LEFT JOIN lote l ON l.id = o.lote_id LEFT JOIN movimiento mc ON mc.id = o.consumo_id LEFT JOIN movimiento me ON me.id = o.entrada_id
      WHERE o.id = $4 AND ${VISIBLE}`,
    [...pa(a), id],
  )).rows[0];
  if (!o) throw noEncontrado("No existe esa orden de producción.");
  const surtido = await surtidoDe(c, id);
  const existenciaPep = new Map((await c.query("SELECT articulo_id, cantidad::text FROM existencia WHERE almacen_id = $1", [o.almacen_pep_id])).rows.map((r) => [r.articulo_id, r.cantidad]));
  const componentes = (await c.query(
    `SELECT oc.articulo_id, a.clave, a.nombre, oc.tipo, u.clave AS unidad, oc.cantidad_estandar::text, oc.cantidad_real::text, oc.estandar_real::text,
            oc.importe_real::text AS importe, oc.costo_estandar::text AS costo_unitario
       FROM orden_componente oc JOIN articulo a ON a.id = oc.articulo_id JOIN unidad u ON u.id = a.unidad_base_id WHERE oc.orden_id = $1
      ORDER BY CASE oc.tipo WHEN 'MASA' THEN 1 WHEN 'INTERMEDIO' THEN 2 WHEN 'INSUMO' THEN 3 ELSE 4 END, a.clave`,
    [id],
  )).rows.map(({ articulo_id, ...x }) => ({ ...x, surtido: num(surtido.get(articulo_id) ?? new D(0)), en_pep: existenciaPep.get(articulo_id) ?? "0" }));
  const etapas = (await c.query(
    `SELECT e.clave, e.nombre, e.registra_merma, oe.minutos_estandar::text, oe.minutos_reales::text, oe.costo_minuto::text AS costo_unitario, oe.importe::text AS importe
       FROM orden_etapa oe JOIN etapa_produccion e ON e.id = oe.etapa_id WHERE oe.orden_id = $1 ORDER BY e.orden`,
    [id],
  )).rows;
  const avances = (await c.query(
    `SELECT av.creado_en, e.clave AS etapa, av.cantidad::text, av.merma::text, cm.clave AS causa, av.minutos::text, av.comentario, us.usuario
       FROM orden_avance av JOIN etapa_produccion e ON e.id = av.etapa_id LEFT JOIN causa_merma cm ON cm.id = av.causa_id JOIN usuario us ON us.id = av.usuario_id
      WHERE av.orden_id = $1 ORDER BY av.creado_en`,
    [id],
  )).rows;
  const vales = (await c.query(
    `SELECT s.id, s.folio, s.creado_en, s.comentario, us.usuario, ao.clave AS origen, m.cancelado_por_id IS NOT NULL AS cancelado, m.folio AS movimiento
       FROM surtido s JOIN usuario us ON us.id = s.usuario_id JOIN almacen ao ON ao.id = s.almacen_origen_id JOIN movimiento m ON m.id = s.entrada_id
      WHERE s.orden_id = $1 ORDER BY s.creado_en`,
    [id],
  )).rows;
  const depende = (await c.query(
    `SELECT x.id, x.folio, a.clave AS articulo, x.estatus, d.cantidad::text FROM orden_dependencia d JOIN orden_produccion x ON x.id = d.orden_origen_id JOIN articulo a ON a.id = x.articulo_id WHERE d.orden_id = $1 ORDER BY x.folio`,
    [id],
  )).rows;
  const abastece = (await c.query(
    `SELECT x.id, x.folio, a.clave AS articulo, x.estatus, d.cantidad::text FROM orden_dependencia d JOIN orden_produccion x ON x.id = d.orden_id JOIN articulo a ON a.id = x.articulo_id WHERE d.orden_origen_id = $1 ORDER BY x.folio`,
    [id],
  )).rows;
  const lotes = (await c.query(
    `SELECT a.clave AS articulo, l.codigo AS lote, l.caducidad::text, sum(g.cantidad)::text AS cantidad, sum(g.importe)::text AS importe
       FROM lote_genealogia g JOIN articulo a ON a.id = g.articulo_padre_id LEFT JOIN lote l ON l.id = g.lote_padre_id WHERE g.orden_id = $1
      GROUP BY a.clave, l.codigo, l.caducidad ORDER BY a.clave, l.codigo`,
    [id],
  )).rows;
  return { orden: o, componentes, etapas, avances, vales, depende, abastece, lotes };
}

/** Trazabilidad de un lote: hacia atrás (de qué se hizo) y hacia adelante (en qué se usó y a dónde se vendió). */
export async function trazabilidad(c: Cliente, a: Alc, f: { lote?: string | null; orden?: string | null }) {
  let ordenes: string[] = [];
  let lotes: { id: string; articulo: string; codigo: string; caducidad: string | null }[] = [];
  if (f.lote) {
    lotes = (await c.query("SELECT l.id, a.clave AS articulo, l.codigo, l.caducidad::text FROM lote l JOIN articulo a ON a.id = l.articulo_id WHERE l.codigo = $1", [f.lote.trim()])).rows;
    if (!lotes.length) throw noEncontrado(`No existe el lote ${f.lote}.`);
  } else if (f.orden) {
    const o = (await c.query("SELECT id FROM orden_produccion WHERE folio = upper($1)", [f.orden.trim()])).rows[0];
    if (!o) throw noEncontrado(`No existe la orden ${f.orden}.`);
    ordenes = [o.id];
  } else throw invalido("Indica un lote o un folio de orden.");
  // Órdenes que produjeron el lote (hacia atrás) o que lo consumieron (hacia adelante).
  const productoras = lotes.length ? (await c.query("SELECT id FROM orden_produccion WHERE lote_id = ANY($1) AND estatus = 'CERRADA'", [lotes.map((l) => l.id)])).rows.map((r) => r.id) : ordenes;
  const consumidoras = lotes.length ? (await c.query("SELECT DISTINCT orden_id AS id FROM lote_genealogia WHERE lote_padre_id = ANY($1)", [lotes.map((l) => l.id)])).rows.map((r) => r.id) : ordenes;
  const atras = (await c.query(
    `WITH RECURSIVE t(id, nivel) AS (SELECT unnest($4::uuid[]), 0 UNION SELECT d.orden_origen_id, t.nivel + 1 FROM orden_dependencia d JOIN t ON t.id = d.orden_id WHERE t.nivel < 10)
     SELECT DISTINCT ON (o.folio, a2.clave, l.codigo) o.folio, t.nivel, a.clave AS producto, a2.clave AS material, l.codigo AS lote, l.caducidad::text, g.cantidad::text
       FROM t JOIN orden_produccion o ON o.id = t.id JOIN almacen pep ON pep.id = o.almacen_pep_id JOIN articulo a ON a.id = o.articulo_id
       JOIN lote_genealogia g ON g.orden_id = o.id JOIN articulo a2 ON a2.id = g.articulo_padre_id LEFT JOIN lote l ON l.id = g.lote_padre_id
      WHERE ${VISIBLE} ORDER BY o.folio, a2.clave, l.codigo`,
    [...pa(a), productoras],
  )).rows;
  const adelante = (await c.query(
    `WITH RECURSIVE t(id, nivel) AS (SELECT unnest($4::uuid[]), 0 UNION SELECT d.orden_id, t.nivel + 1 FROM orden_dependencia d JOIN t ON t.id = d.orden_origen_id JOIN orden_produccion x ON x.id = d.orden_id AND x.estatus = 'CERRADA' WHERE t.nivel < 10)
     SELECT o.folio, t.nivel, o.fecha::text, a.clave AS producto, o.estatus, o.cantidad_real::text AS cantidad, l.codigo AS lote, dst.clave AS almacen
       FROM t JOIN orden_produccion o ON o.id = t.id JOIN almacen pep ON pep.id = o.almacen_pep_id JOIN articulo a ON a.id = o.articulo_id
       JOIN almacen dst ON dst.id = o.almacen_destino_id LEFT JOIN lote l ON l.id = o.lote_id
      WHERE ${VISIBLE} ORDER BY t.nivel, o.folio`,
    [...pa(a), consumidoras],
  )).rows;
  // Ventas y traspasos de los lotes producidos (si el producto maneja lote).
  const lotesHijos = (await c.query(
    `WITH RECURSIVE t(id, nivel) AS (SELECT unnest($1::uuid[]), 0 UNION SELECT d.orden_id, t.nivel + 1 FROM orden_dependencia d JOIN t ON t.id = d.orden_origen_id JOIN orden_produccion x ON x.id = d.orden_id AND x.estatus = 'CERRADA' WHERE t.nivel < 10)
     SELECT DISTINCT o.lote_id FROM t JOIN orden_produccion o ON o.id = t.id WHERE o.lote_id IS NOT NULL`,
    [consumidoras],
  )).rows.map((r) => r.lote_id).concat(lotes.map((l) => l.id));
  const salidas = lotesHijos.length ? (await c.query(
    `SELECT m.tipo, m.folio, m.fecha_negocio::text AS fecha, al.clave AS almacen, a.clave AS articulo, l.codigo AS lote, (-r.cantidad)::text AS cantidad
       FROM movimiento_renglon r JOIN movimiento m ON m.id = r.movimiento_id JOIN almacen al ON al.id = r.almacen_id JOIN articulo a ON a.id = r.articulo_id JOIN lote l ON l.id = r.lote_id
      WHERE r.lote_id = ANY($1) AND r.cantidad < 0 AND m.tipo IN ('VENTA', 'TRASPASO_ENVIO', 'MERMA') ORDER BY m.fecha, m.folio`,
    [lotesHijos],
  )).rows : [];
  return { lotes, atras, adelante, salidas };
}

/** Variaciones de las órdenes cerradas en el periodo (por fecha de producción). */
export async function variaciones(c: Cliente, a: Alc, desde: string, hasta: string) {
  const ordenes = (await c.query(
    `SELECT o.id, o.folio, o.fecha::text, o.nivel, a.clave AS articulo, a.nombre, u.clave AS unidad, o.cantidad_plan::text, o.cantidad_real::text,
            o.costo_mp::text, o.costo_mod::text, o.costo_gif::text, o.costo_total::text, o.costo_unitario::text, o.costo_estandar::text,
            (o.costo_estandar * o.cantidad_real)::text AS total_estandar, (o.costo_total - o.costo_estandar * o.cantidad_real)::text AS variacion,
            o.fuera_tolerancia, o.justificacion, o.balance -> 'masa' ->> 'pct' AS masa_pct, o.balance -> 'piezas' ->> 'pct' AS piezas_pct, us.usuario AS cerro
       FROM orden_produccion o JOIN articulo a ON a.id = o.articulo_id JOIN unidad u ON u.id = a.unidad_base_id JOIN almacen pep ON pep.id = o.almacen_pep_id
       JOIN usuario us ON us.id = o.cerrada_por
      WHERE o.estatus = 'CERRADA' AND o.fecha BETWEEN $4 AND $5 AND ${VISIBLE} ORDER BY o.fecha, o.folio`,
    [...pa(a), desde, hasta],
  )).rows;
  const materiales = (await c.query(
    `SELECT a.clave, a.nombre, u.clave AS unidad, sum(oc.estandar_real)::text AS estandar, sum(oc.cantidad_real)::text AS real,
            sum(oc.importe_real)::text AS importe_real, sum(oc.estandar_real * oc.costo_estandar)::text AS importe_estandar,
            sum((oc.cantidad_real - oc.estandar_real) * oc.costo_estandar)::text AS variacion_cantidad,
            sum(oc.importe_real - oc.cantidad_real * oc.costo_estandar)::text AS variacion_precio
       FROM orden_componente oc JOIN orden_produccion o ON o.id = oc.orden_id JOIN almacen pep ON pep.id = o.almacen_pep_id
       JOIN articulo a ON a.id = oc.articulo_id JOIN unidad u ON u.id = a.unidad_base_id
      WHERE o.estatus = 'CERRADA' AND o.fecha BETWEEN $4 AND $5 AND ${VISIBLE}
      GROUP BY a.clave, a.nombre, u.clave ORDER BY a.clave`,
    [...pa(a), desde, hasta],
  )).rows;
  return { ordenes, materiales };
}

/** Rendimiento y merma: por producto, por etapa y causa, y por quien registró el avance. */
export async function rendimiento(c: Cliente, a: Alc, desde: string, hasta: string) {
  const mermas = "LEFT JOIN (SELECT orden_id, sum(merma) AS merma FROM orden_avance GROUP BY orden_id) mv ON mv.orden_id = o.id";
  const productos = (await c.query(
    `SELECT a.clave, a.nombre, o.nivel, u.clave AS unidad, count(*)::int AS ordenes, sum(o.cantidad_plan)::text AS planeado, sum(o.cantidad_real)::text AS real,
            sum(o.piezas_formadas)::text AS formadas, round(sum(o.cantidad_real) / nullif(sum(o.cantidad_plan), 0) * 100, 2)::text AS cumplimiento_pct,
            coalesce(sum(mv.merma), 0)::text AS merma
       FROM orden_produccion o JOIN articulo a ON a.id = o.articulo_id JOIN unidad u ON u.id = a.unidad_base_id JOIN almacen pep ON pep.id = o.almacen_pep_id ${mermas}
      WHERE o.estatus = 'CERRADA' AND o.fecha BETWEEN $4 AND $5 AND ${VISIBLE}
      GROUP BY a.clave, a.nombre, o.nivel, u.clave ORDER BY o.nivel, a.clave`,
    [...pa(a), desde, hasta],
  )).rows;
  const porCausa = (await c.query(
    `SELECT e.clave AS etapa, coalesce(cm.clave, '—') AS causa, ar.clave AS producto, sum(av.merma)::text AS merma
       FROM orden_avance av JOIN etapa_produccion e ON e.id = av.etapa_id LEFT JOIN causa_merma cm ON cm.id = av.causa_id
       JOIN orden_produccion o ON o.id = av.orden_id JOIN articulo ar ON ar.id = o.articulo_id JOIN almacen pep ON pep.id = o.almacen_pep_id
      WHERE av.merma > 0 AND o.estatus = 'CERRADA' AND o.fecha BETWEEN $4 AND $5 AND ${VISIBLE}
      GROUP BY e.clave, e.orden, cm.clave, ar.clave ORDER BY e.orden, cm.clave, ar.clave`,
    [...pa(a), desde, hasta],
  )).rows;
  const porPersona = (await c.query(
    `SELECT us.usuario, us.nombre, count(DISTINCT av.orden_id)::int AS ordenes, sum(av.cantidad)::text AS cantidad, sum(av.merma)::text AS merma,
            round(sum(av.merma) / nullif(sum(av.cantidad) + sum(av.merma), 0) * 100, 2)::text AS merma_pct
       FROM orden_avance av JOIN usuario us ON us.id = av.usuario_id JOIN orden_produccion o ON o.id = av.orden_id JOIN almacen pep ON pep.id = o.almacen_pep_id
      WHERE o.estatus = 'CERRADA' AND o.fecha BETWEEN $4 AND $5 AND ${VISIBLE}
      GROUP BY us.usuario, us.nombre ORDER BY us.usuario`,
    [...pa(a), desde, hasta],
  )).rows;
  const porTurno = (await c.query(
    `SELECT coalesce(t.clave, 'SIN TURNO') AS turno, count(*)::int AS ordenes, sum(o.cantidad_real) FILTER (WHERE o.nivel = 'N2')::text AS piezas,
            coalesce(sum(mv.merma) FILTER (WHERE o.nivel = 'N2'), 0)::text AS merma
       FROM orden_produccion o JOIN almacen pep ON pep.id = o.almacen_pep_id LEFT JOIN plan_produccion p ON p.id = o.plan_id LEFT JOIN turno_produccion t ON t.id = p.turno_id ${mermas}
      WHERE o.estatus = 'CERRADA' AND o.fecha BETWEEN $4 AND $5 AND ${VISIBLE}
      GROUP BY t.clave ORDER BY 1`,
    [...pa(a), desde, hasta],
  )).rows;
  return { productos, por_causa: porCausa, por_persona: porPersona, por_turno: porTurno };
}

/** Sobrantes en producción en proceso: masas e intermedios que quedaron, si se reutilizan y cuándo caducan. */
export async function sobrantes(c: Cliente, a: Alc) {
  const { rows } = await c.query(
    `SELECT al.clave AS almacen, a.clave, a.nombre, a.tipo, u.clave AS unidad, e.cantidad::text, e.valor::text, a.sobrante_reutilizable, a.vida_util_horas,
            (SELECT max(m.fecha) FROM movimiento_renglon r JOIN movimiento m ON m.id = r.movimiento_id WHERE r.almacen_id = e.almacen_id AND r.articulo_id = e.articulo_id AND r.cantidad > 0) AS ultima_entrada
       FROM existencia e JOIN almacen al ON al.id = e.almacen_id JOIN articulo a ON a.id = e.articulo_id JOIN unidad u ON u.id = a.unidad_base_id
      WHERE al.tipo = 'PEP' AND e.cantidad > 0 AND ($1::boolean OR al.id = ANY($2::uuid[]) OR al.sucursal_id = ANY($3::uuid[]))
      ORDER BY al.clave, a.tipo DESC, a.clave`,
    pa(a),
  );
  return rows.map((r) => {
    const vence = r.vida_util_horas && r.ultima_entrada ? new Date(new Date(r.ultima_entrada).getTime() + r.vida_util_horas * 3600_000) : null;
    return { ...r, vence, vencido: vence ? vence.getTime() < Date.now() : false, accion: r.tipo !== "INTERMEDIO" ? "Usar en otra orden o regresar al almacén (cancelar el vale)" : r.sobrante_reutilizable ? "Se reutiliza: queda disponible para el siguiente plan" : "No se reutiliza: registrar merma" };
  });
}

/** Estado de costo de producción y ventas del periodo, desde el kárdex valuado. */
export async function estadoDeCostos(c: Cliente, a: Alc, desde: string, hasta: string, sucursal?: string | null) {
  let sucursalId: string | null = null;
  if (sucursal) {
    sucursalId = (await c.query("SELECT id FROM sucursal WHERE clave = upper($1)", [sucursal])).rows[0]?.id ?? null;
    if (!sucursalId) throw invalido(`No existe la sucursal ${sucursal}.`);
  }
  if (!a.todas && (!sucursalId || !a.sucursales.includes(sucursalId))) throw prohibido("El estado de costos de toda la empresa lo consulta quien tiene alcance a todas las sucursales; elige una de tus sucursales.");
  const filtro = "($3::uuid IS NULL OR al.sucursal_id = $3)";
  const grupo = "CASE WHEN al.tipo IN ('MP', 'INS') THEN 'MP' ELSE al.tipo END";
  const saldos = (await c.query(
    `SELECT ${grupo} AS g, coalesce(sum(r.importe) FILTER (WHERE m.fecha_negocio < $1), 0)::text AS inicial, coalesce(sum(r.importe) FILTER (WHERE m.fecha_negocio <= $2), 0)::text AS final
       FROM movimiento_renglon r JOIN movimiento m ON m.id = r.movimiento_id JOIN almacen al ON al.id = r.almacen_id WHERE ${filtro} GROUP BY 1`,
    [desde, hasta, sucursalId],
  )).rows;
  const tipos = (await c.query(
    `SELECT ${grupo} AS g, coalesce(o.tipo, m.tipo) AS tipo, sum(r.importe)::text AS importe
       FROM movimiento_renglon r JOIN movimiento m ON m.id = r.movimiento_id JOIN almacen al ON al.id = r.almacen_id LEFT JOIN movimiento o ON o.id = m.cancela_id
      WHERE m.fecha_negocio BETWEEN $1 AND $2 AND ${filtro} GROUP BY 1, 2`,
    [desde, hasta, sucursalId],
  )).rows;
  const g: Record<Grupo, SaldoGrupo> = { MP: vacio(), PEP: vacio(), PT: vacio() };
  for (const s of saldos) Object.assign(g[s.g as Grupo], { inicial: new D(s.inicial), final: new D(s.final) });
  for (const t of tipos) g[t.g as Grupo].tipos.set(t.tipo, new D(t.importe));
  const ap = (await c.query(
    `SELECT coalesce(sum(o.costo_mod), 0)::text AS mod, coalesce(sum(o.costo_gif), 0)::text AS gif
       FROM orden_produccion o JOIN movimiento m ON m.id = o.entrada_id JOIN almacen al ON al.id = o.almacen_destino_id
      WHERE m.fecha_negocio BETWEEN $1 AND $2 AND ${filtro}`,
    [desde, hasta, sucursalId],
  )).rows[0];
  const e = estadoCostos(g, { mod: new D(ap.mod), gif: new D(ap.gif) });
  const r2 = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
  return {
    desde, hasta, sucursal: sucursal?.toUpperCase() ?? null,
    lineas: e.lineas.map((l) => ({ concepto: l.concepto, importe: r2(l.importe), nivel: l.nivel })),
    comprobaciones: e.comprobaciones.map((x) => ({ concepto: x.concepto, diferencia: r2(x.diferencia), cuadra: x.diferencia.abs().lt("0.005") })),
    saldos: Object.fromEntries((Object.keys(g) as Grupo[]).map((k) => [k, { inicial: r2(g[k].inicial), final: r2(g[k].final), movimientos: Object.fromEntries([...g[k].tipos].map(([t, v]) => [t, r2(v)])) }])),
    contabilidad: "La conciliación contra las cuentas contables se agrega en la Fase 7 (contabilidad).",
  };
}
const vacio = (): SaldoGrupo => ({ inicial: new D(0), final: new D(0), tipos: new Map() });
