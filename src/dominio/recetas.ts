// Recetas multinivel: porcentaje panadero, detección de ciclos, explosión
// N2 → N1 → N0 con lotes, requerimiento neto y costo estándar en cadena.
// Funciones puras con aritmética decimal exacta (cálculo crítico, con pruebas).
//
// Convenciones (documentadas en el README, sección Fase 2):
//  * Las cantidades ya vienen convertidas a la unidad base de cada componente.
//  * N1: cantidades por LOTE; el lote rinde `rendimiento` unidades base del intermedio.
//  * N2: cantidades por pieza buena (o por unidad de venta).
//  * Un % de merma se aplica con la fórmula configurada (recetas.formula_merma):
//      DIVIDIR      → cantidad ÷ (1 − merma)
//      MULTIPLICAR  → cantidad × (1 + merma)
//  * Merma de horneado: piezas a formar = piezas buenas con merma de horneado.
//    Todo lo que se consume al formar (masa, intermedios, insumos) se calcula
//    sobre piezas formadas; el EMPAQUE, sobre piezas buenas.
//  * Merma de formado (recortes): solo a los componentes de tipo MASA.
import Decimal from "decimal.js";
import { factorConversion, type ConversionGeneral, type UnidadPropia } from "./unidades";

export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;
const cero = () => new D(0);
const uno = () => new D(1);

export type FormulaMerma = "DIVIDIR" | "MULTIPLICAR";
export type TipoComponente = "MASA" | "INTERMEDIO" | "INSUMO" | "EMPAQUE";
export type BaseGif = "KG_MASA" | "MINUTO_MOD" | "PIEZA";

/** Factor que se multiplica por la cantidad neta para cubrir la merma. */
export function factorMerma(pct: Decimal.Value, formula: FormulaMerma): Dec {
  const p = new D(pct).div(100);
  if (p.isZero()) return uno();
  if (p.lt(0) || p.gte(1)) throw new Error("La merma debe estar entre 0 y menos de 100 %.");
  return formula === "DIVIDIR" ? uno().div(uno().minus(p)) : uno().plus(p);
}

/** Cantidad con merma. Se divide (no se multiplica por el recíproco) para que 39.2 ÷ 0.98 dé 40 exacto. */
export function conMerma(cantidad: Decimal.Value, pct: Decimal.Value, formula: FormulaMerma): Dec {
  const q = new D(cantidad);
  const p = new D(pct).div(100);
  if (p.isZero()) return q;
  if (p.lt(0) || p.gte(1)) throw new Error("La merma debe estar entre 0 y menos de 100 %.");
  return formula === "DIVIDIR" ? q.div(uno().minus(p)) : q.mul(uno().plus(p));
}

/**
 * Porcentaje panadero: la harina (o harinas) suman 100 % y cada ingrediente es
 * un % de la harina. Con el tamaño total del lote se obtiene la harina:
 *   harina = tamaño × 100 ÷ Σ%   y   ingrediente = harina × % ÷ 100.
 */
export function cantidadesPorPctPanadero(tamanoLote: Decimal.Value, pcts: Decimal.Value[]): Dec[] {
  const suma = pcts.reduce<Dec>((s, p) => s.plus(p), cero());
  if (suma.lte(0)) throw new Error("Los porcentajes deben sumar más de cero.");
  const harina = new D(tamanoLote).mul(100).div(suma);
  return pcts.map((p) => harina.mul(p).div(100));
}

// ---------------------------------------------------------------------------
// Ciclos y orden topológico (un intermedio puede usar otro intermedio)
// ---------------------------------------------------------------------------

/** Busca un ciclo en el grafo "A usa B". Devuelve la ruta [A, B, …, A] o null. */
export function buscarCiclo(grafo: Map<string, Iterable<string>>): string[] | null {
  const estado = new Map<string, 1 | 2>(); // 1 = en la ruta, 2 = terminado
  const ruta: string[] = [];
  const visitar = (n: string): string[] | null => {
    estado.set(n, 1);
    ruta.push(n);
    for (const h of grafo.get(n) ?? []) {
      if (estado.get(h) === 1) return [...ruta.slice(ruta.indexOf(h)), h];
      if (!estado.has(h)) {
        const c = visitar(h);
        if (c) return c;
      }
    }
    ruta.pop();
    estado.set(n, 2);
    return null;
  };
  for (const n of [...grafo.keys()].sort()) {
    if (!estado.has(n)) {
      const c = visitar(n);
      if (c) return c;
    }
  }
  return null;
}

/** Orden en que cada nodo aparece antes que todos los que usa. Lanza error si hay ciclo. */
export function ordenTopologico(grafo: Map<string, Iterable<string>>): string[] {
  const ciclo = buscarCiclo(grafo);
  if (ciclo) throw new Error(`Receta circular: ${ciclo.join(" → ")}`);
  const nodos = new Set<string>();
  for (const [n, hs] of grafo) {
    nodos.add(n);
    for (const h of hs) nodos.add(h);
  }
  const visitados = new Set<string>();
  const posorden: string[] = [];
  const visitar = (n: string) => {
    visitados.add(n);
    for (const h of grafo.get(n) ?? []) if (!visitados.has(h)) visitar(h);
    posorden.push(n);
  };
  for (const n of [...nodos].sort()) if (!visitados.has(n)) visitar(n);
  return posorden.reverse();
}

// ---------------------------------------------------------------------------
// Recetas normalizadas
// ---------------------------------------------------------------------------

export interface ComponenteNormal {
  clave: string;
  tipo: TipoComponente;
  /** En unidad base del componente: por lote (N1) o por pieza buena (N2). */
  cantidad: Dec;
  mermaPct: Dec;
}

export interface EtapaNormal {
  etapa: string;
  minutos: Dec;
  base: "LOTE" | "PIEZA";
}

export interface RecetaN1 {
  clave: string;
  version: number;
  /** Unidades base del intermedio que rinde un lote. */
  rendimiento: Dec;
  regla: "COMPLETO" | "EXACTO";
  capacidad: Dec | null;
  componentes: ComponenteNormal[];
  etapas: EtapaNormal[];
}

export interface RecetaN2 {
  clave: string;
  version: number;
  mermaFormadoPct: Dec;
  mermaHorneadoPct: Dec;
  piezasPorLote: Dec | null;
  componentes: ComponenteNormal[];
  etapas: EtapaNormal[];
}

export interface Recetas {
  n1: Map<string, RecetaN1>;
  n2: Map<string, RecetaN2>;
}

/** Datos de unidades de un artículo para convertir cantidades. */
export interface UnidadesArticulo {
  base: string;
  propias: UnidadPropia[];
}

export interface FilaEncabezado {
  clave: string;
  version: number;
  nivel: "N1" | "N2";
  unidadBase: string;
  captura: "CANTIDAD" | "PCT_PANADERO" | null;
  tamanoLote: string | null;
  rendimientoLote: string | null;
  mermaProcesoPct: string | null;
  regla: "COMPLETO" | "EXACTO" | null;
  capacidad: string | null;
  mermaFormadoPct: string | null;
  mermaHorneadoPct: string | null;
  piezasPorLote: string | null;
}

export interface FilaComponente {
  clave: string;
  tipo: TipoComponente;
  cantidad: string | null;
  unidad: string | null;
  pct: string | null;
  mermaPct: string;
  unidades: UnidadesArticulo;
}

export interface FilaEtapa {
  etapa: string;
  minutos: string;
  base: "LOTE" | "PIEZA";
}

export type Normalizada<T> = { ok: true; receta: T; tamanoLote: Dec | null } | { ok: false; problemas: string[] };

/**
 * Convierte la captura (unidades libres o % panadero) a cantidades en unidad
 * base de cada componente. Devuelve los problemas que impiden usar la receta.
 */
export function normalizarReceta(
  enc: FilaEncabezado,
  comps: FilaComponente[],
  etapas: FilaEtapa[],
  generales: ConversionGeneral[],
): Normalizada<RecetaN1> | Normalizada<RecetaN2> {
  const problemas: string[] = [];
  if (!comps.length) problemas.push("No tiene componentes.");
  const componentes: ComponenteNormal[] = [];
  const pct = enc.nivel === "N1" && enc.captura === "PCT_PANADERO";

  if (pct) {
    const sinPct = comps.filter((c) => c.pct === null);
    if (sinPct.length) problemas.push(`Se captura en % panadero y a ${sinPct.map((c) => c.clave).join(", ")} le falta el %.`);
    if (!enc.tamanoLote) problemas.push("Falta el tamaño del lote (necesario para el % panadero).");
    if (!sinPct.length && enc.tamanoLote && comps.length) {
      const cantidades = cantidadesPorPctPanadero(enc.tamanoLote, comps.map((c) => c.pct!));
      comps.forEach((c, i) => {
        const f = factorConversion(enc.unidadBase, c.unidades.base, c.unidades, generales);
        if (!f) problemas.push(`${c.clave}: no hay conversión de ${enc.unidadBase} a ${c.unidades.base}.`);
        else componentes.push({ clave: c.clave, tipo: c.tipo, cantidad: cantidades[i]!.mul(f), mermaPct: new D(c.mermaPct) });
      });
    }
  } else {
    for (const c of comps) {
      if (c.cantidad === null || c.unidad === null) {
        problemas.push(`${c.clave}: falta la cantidad o la unidad.`);
        continue;
      }
      const f = factorConversion(c.unidad, c.unidades.base, c.unidades, generales);
      if (!f) problemas.push(`${c.clave}: no hay conversión de ${c.unidad} a ${c.unidades.base}. Cárgala en Conversiones o en Unidades por artículo.`);
      else componentes.push({ clave: c.clave, tipo: c.tipo, cantidad: new D(c.cantidad).mul(f), mermaPct: new D(c.mermaPct) });
    }
  }
  const etapasN: EtapaNormal[] = etapas.map((e) => ({ etapa: e.etapa, minutos: new D(e.minutos), base: e.base }));

  if (enc.nivel === "N1") {
    if (etapasN.some((e) => e.base !== "LOTE")) problemas.push("En masas e intermedios la mano de obra se captura por LOTE.");
    // Tamaño del lote: el capturado, o la suma de ingredientes si todos se pueden expresar en la unidad del intermedio.
    let tamano: Dec | null = enc.tamanoLote ? new D(enc.tamanoLote) : null;
    if (!tamano && componentes.length === comps.length && comps.length) {
      let suma: Dec | null = cero();
      for (let i = 0; i < comps.length && suma; i++) {
        const c = comps[i]!;
        const f = factorConversion(c.unidades.base, enc.unidadBase, c.unidades, generales);
        suma = f ? suma.plus(componentes[i]!.cantidad.mul(f)) : null;
      }
      tamano = suma;
    }
    let rendimiento: Dec | null = enc.rendimientoLote ? new D(enc.rendimientoLote) : null;
    if (!rendimiento) {
      if (tamano) rendimiento = tamano.mul(uno().minus(new D(enc.mermaProcesoPct ?? 0).div(100)));
      else problemas.push(`No se puede sumar la fórmula en ${enc.unidadBase}: captura el TAMANO_LOTE o el RENDIMIENTO_LOTE.`);
    }
    if (!enc.regla) problemas.push("Falta la regla de lote (COMPLETO o EXACTO).");
    if (problemas.length) return { ok: false, problemas };
    return {
      ok: true,
      tamanoLote: tamano,
      receta: { clave: enc.clave, version: enc.version, rendimiento: rendimiento!, regla: enc.regla!, capacidad: enc.capacidad ? new D(enc.capacidad) : null, componentes, etapas: etapasN },
    };
  }

  if (etapasN.some((e) => e.base === "LOTE") && !enc.piezasPorLote) problemas.push("Hay mano de obra por LOTE: falta PIEZAS_POR_LOTE en el encabezado.");
  if (problemas.length) return { ok: false, problemas };
  return {
    ok: true,
    tamanoLote: null,
    receta: {
      clave: enc.clave,
      version: enc.version,
      mermaFormadoPct: new D(enc.mermaFormadoPct ?? 0),
      mermaHorneadoPct: new D(enc.mermaHorneadoPct ?? 0),
      piezasPorLote: enc.piezasPorLote ? new D(enc.piezasPorLote) : null,
      componentes,
      etapas: etapasN,
    },
  };
}

/** Cantidad de un componente N2 para cierto número de piezas buenas. */
export function consumoN2(r: RecetaN2, c: ComponenteNormal, piezas: Dec, formula: FormulaMerma): Dec {
  const formadas = conMerma(piezas, r.mermaHorneadoPct, formula);
  const base = c.tipo === "EMPAQUE" ? piezas : formadas;
  let q = conMerma(c.cantidad.mul(base), c.mermaPct, formula);
  if (c.tipo === "MASA") q = conMerma(q, r.mermaFormadoPct, formula);
  return q;
}

/** Quita el ruido de la división periódica (ej. 2.0000…0001) antes de redondear lotes. */
const limpio = (x: Dec) => x.toDecimalPlaces(12);

const esIntermedio = (t: TipoComponente) => t === "MASA" || t === "INTERMEDIO";

/** Grafo "intermedio usa intermedio" de las recetas N1. */
export function grafoIntermedios(n1: Iterable<RecetaN1>): Map<string, string[]> {
  const g = new Map<string, string[]>();
  for (const r of n1) g.set(r.clave, r.componentes.filter((c) => esIntermedio(c.tipo)).map((c) => c.clave));
  return g;
}

// ---------------------------------------------------------------------------
// Explosión del plan de producción
// ---------------------------------------------------------------------------

export interface Disponible {
  existencia: Decimal.Value;
  transito?: Decimal.Value;
}

export interface EntradaExplosion {
  plan: { sku: string; piezas: Decimal.Value }[];
  recetas: Recetas;
  /** Existencias (y pedidos en tránsito para MP) por artículo, en unidad base. */
  disponibles: Map<string, Disponible>;
  formula: FormulaMerma;
}

export interface Origen {
  de: string;
  cantidad: Dec;
}

export interface ResultadoN1 {
  clave: string;
  version: number | null;
  bruto: Dec;
  existencia: Dec;
  aPreparar: Dec;
  rendimiento: Dec | null;
  regla: "COMPLETO" | "EXACTO" | null;
  lotes: Dec;
  producido: Dec;
  sobrante: Dec;
  amasadas: Dec | null;
  origen: Origen[];
  sinReceta: boolean;
}

export interface ResultadoN0 {
  clave: string;
  bruto: Dec;
  existencia: Dec;
  transito: Dec;
  disponible: Dec;
  neto: Dec;
  origen: Origen[];
}

export interface ResultadoSku {
  clave: string;
  version: number | null;
  piezas: Dec;
  piezasFormadas: Dec;
  alcanzan: Dec;
  completo: boolean;
  limitantes: string[];
}

export interface ResultadoExplosion {
  skus: ResultadoSku[];
  intermedios: ResultadoN1[];
  materiales: ResultadoN0[];
  problemas: { articulo: string; mensaje: string }[];
}

interface Acumulado {
  nivel: "N1" | "N0";
  bruto: Dec;
  porSku: Map<string, Dec>;
  origen: Map<string, Dec>;
}

export function explotar(e: EntradaExplosion): ResultadoExplosion {
  const req = new Map<string, Acumulado>();
  const problemas: ResultadoExplosion["problemas"] = [];
  const agregar = (clave: string, nivel: "N1" | "N0", cantidad: Dec, de: string, porSku: Map<string, Dec>) => {
    let a = req.get(clave);
    if (!a) req.set(clave, (a = { nivel, bruto: cero(), porSku: new Map(), origen: new Map() }));
    a.bruto = a.bruto.plus(cantidad);
    a.origen.set(de, (a.origen.get(de) ?? cero()).plus(cantidad));
    for (const [s, q] of porSku) a.porSku.set(s, (a.porSku.get(s) ?? cero()).plus(q));
  };
  const disp = (clave: string) => {
    const d = e.disponibles.get(clave);
    return { existencia: new D(d?.existencia ?? 0), transito: new D(d?.transito ?? 0) };
  };

  // 1) N2 → componentes (masas, intermedios, insumos y empaques directos)
  const skus: ResultadoSku[] = [];
  const piezasPorSku = new Map<string, Dec>();
  for (const linea of e.plan) {
    const piezas = new D(linea.piezas);
    if (piezas.lte(0)) continue;
    piezasPorSku.set(linea.sku, (piezasPorSku.get(linea.sku) ?? cero()).plus(piezas));
  }
  for (const [sku, piezas] of piezasPorSku) {
    const r = e.recetas.n2.get(sku);
    if (!r) {
      problemas.push({ articulo: sku, mensaje: "No tiene receta vigente en la fecha del plan." });
      skus.push({ clave: sku, version: null, piezas, piezasFormadas: piezas, alcanzan: cero(), completo: false, limitantes: ["sin receta"] });
      continue;
    }
    skus.push({ clave: sku, version: r.version, piezas, piezasFormadas: conMerma(piezas, r.mermaHorneadoPct, e.formula), alcanzan: piezas, completo: true, limitantes: [] });
    for (const c of r.componentes) {
      const q = consumoN2(r, c, piezas, e.formula);
      agregar(c.clave, esIntermedio(c.tipo) ? "N1" : "N0", q, sku, new Map([[sku, q]]));
    }
  }

  // 2) Intermedios en orden: un intermedio se procesa cuando ya se sumó todo lo que lo usa.
  const grafo = grafoIntermedios(e.recetas.n1.values());
  for (const [clave, a] of req) if (a.nivel === "N1" && !grafo.has(clave)) grafo.set(clave, []);
  const intermedios: ResultadoN1[] = [];
  for (const clave of ordenTopologico(grafo)) {
    const a = req.get(clave);
    if (!a) continue;
    const r = e.recetas.n1.get(clave);
    const { existencia } = disp(clave);
    const aPreparar = D.max(0, a.bruto.minus(existencia));
    const origen = [...a.origen].map(([de, cantidad]) => ({ de, cantidad }));
    if (!r) {
      if (aPreparar.gt(0)) problemas.push({ articulo: clave, mensaje: "Masa o intermedio sin receta vigente: solo se cubre con existencia." });
      intermedios.push({ clave, version: null, bruto: a.bruto, existencia, aPreparar, rendimiento: null, regla: null, lotes: cero(), producido: cero(), sobrante: cero(), amasadas: null, origen, sinReceta: true });
      continue;
    }
    let lotes = cero();
    let producido = cero();
    if (aPreparar.gt(0)) {
      if (r.regla === "COMPLETO") {
        lotes = limpio(aPreparar.div(r.rendimiento)).ceil();
        producido = lotes.mul(r.rendimiento);
      } else {
        lotes = aPreparar.div(r.rendimiento);
        producido = aPreparar;
      }
    }
    const amasadas = r.capacidad && producido.gt(0) ? limpio(producido.div(r.capacidad)).ceil() : null;
    intermedios.push({ clave, version: r.version, bruto: a.bruto, existencia, aPreparar, rendimiento: r.rendimiento, regla: r.regla, lotes, producido, sobrante: producido.minus(aPreparar), amasadas, origen, sinReceta: false });
    if (lotes.isZero()) continue;
    for (const c of r.componentes) {
      const q = conMerma(c.cantidad.mul(lotes), c.mermaPct, e.formula);
      // Lo que pide cada SKU se reparte en proporción a lo que pidió de este intermedio.
      const porSku = new Map([...a.porSku].map(([s, x]) => [s, q.mul(x).div(a.bruto)] as [string, Dec]));
      agregar(c.clave, esIntermedio(c.tipo) ? "N1" : "N0", q, clave, porSku);
    }
  }

  // 3) Materias primas: requerimiento neto = bruto − existencia − en tránsito
  const materiales: ResultadoN0[] = [];
  for (const [clave, a] of [...req].sort(([x], [y]) => x.localeCompare(y))) {
    if (a.nivel !== "N0") continue;
    const { existencia, transito } = disp(clave);
    const disponible = existencia.plus(transito);
    materiales.push({ clave, bruto: a.bruto, existencia, transito, disponible, neto: D.max(0, a.bruto.minus(disponible)), origen: [...a.origen].map(([de, cantidad]) => ({ de, cantidad })) });
  }

  // 4) Piezas que alcanzan: si falta un material, cada SKU que lo usa se reduce en
  //    la proporción disponible ÷ requerido del material más escaso (estimación).
  const faltantes: { clave: string; razon: Dec; porSku: Map<string, Dec> }[] = [];
  for (const m of materiales) if (m.neto.gt(0)) faltantes.push({ clave: m.clave, razon: m.disponible.div(m.bruto), porSku: req.get(m.clave)!.porSku });
  for (const i of intermedios) if (i.sinReceta && i.aPreparar.gt(0)) faltantes.push({ clave: i.clave, razon: i.existencia.div(i.bruto), porSku: req.get(i.clave)!.porSku });
  for (const s of skus) {
    if (s.version === null) continue;
    let razon = uno();
    for (const f of faltantes) {
      if (!(f.porSku.get(s.clave)?.gt(0))) continue;
      s.limitantes.push(f.clave);
      razon = D.min(razon, f.razon);
    }
    if (razon.lt(1)) {
      s.completo = false;
      s.alcanzan = s.piezas.mul(razon).toDecimalPlaces(s.piezas.isInteger() ? 0 : 3, Decimal.ROUND_DOWN);
    }
  }
  skus.sort((x, y) => x.clave.localeCompare(y.clave));
  return { skus, intermedios, materiales, problemas };
}

// ---------------------------------------------------------------------------
// Costo estándar en cadena: N0 → N1 (por unidad base) → N2 (por pieza)
// ---------------------------------------------------------------------------

export interface EntradaCosto {
  recetas: Recetas;
  /** Costo por unidad base de cada insumo o empaque (null = sin costo). */
  costosN0: Map<string, Decimal.Value | null>;
  /** Costo por minuto de cada etapa (null o ausente = sin tarifa). */
  tarifas: Map<string, Decimal.Value | null>;
  /** Tasa de GIF vigente por base de prorrateo. */
  gif: Map<BaseGif, Decimal.Value>;
  formula: FormulaMerma;
}

export interface LineaCosto {
  clave: string;
  tipo: TipoComponente;
  cantidad: Dec;
  costoUnitario: Dec | null;
  importe: Dec;
}

export interface CostoArticulo {
  clave: string;
  nivel: "N1" | "N2";
  version: number;
  /** Importes por unidad base del intermedio (N1) o por pieza buena (N2). */
  mp: Dec;
  mod: Dec;
  gif: Dec;
  total: Dec;
  completo: boolean;
  faltantes: string[];
  /** N1: cantidades e importes por lote; N2: por pieza buena. */
  componentes: LineaCosto[];
  etapas: { etapa: string; minutos: Dec; costoMinuto: Dec | null; importe: Dec }[];
  gifDetalle: { base: BaseGif; cantidad: Dec; tasa: Dec; importe: Dec }[];
  /** N1: unidades que rinde el lote sobre las que se reparte. */
  rendimiento: Dec | null;
}

export function costear(e: EntradaCosto): Map<string, CostoArticulo> {
  const res = new Map<string, CostoArticulo>();
  const unitario = (c: ComponenteNormal): { costo: Dec | null; faltan: string[] } => {
    if (esIntermedio(c.tipo)) {
      const x = res.get(c.clave);
      if (!x) return { costo: null, faltan: [`${c.clave} (sin receta vigente)`] };
      return { costo: x.total, faltan: x.completo ? [] : x.faltantes.map((f) => `${c.clave} › ${f}`) };
    }
    const v = e.costosN0.get(c.clave);
    return v === null || v === undefined ? { costo: null, faltan: [`${c.clave} (sin costo)`] } : { costo: new D(v), faltan: [] };
  };
  const tarifa = (etapa: string) => {
    const v = e.tarifas.get(etapa);
    return v === null || v === undefined ? null : new D(v);
  };
  const tasaGif = (b: BaseGif) => (e.gif.has(b) ? new D(e.gif.get(b)!) : null);

  // N1: primero los que no usan otros intermedios
  const orden = ordenTopologico(grafoIntermedios(e.recetas.n1.values())).reverse();
  for (const clave of orden) {
    const r = e.recetas.n1.get(clave);
    if (!r) continue;
    const faltantes: string[] = [];
    const componentes: LineaCosto[] = r.componentes.map((c) => {
      const cantidad = conMerma(c.cantidad, c.mermaPct, e.formula);
      const u = unitario(c);
      faltantes.push(...u.faltan);
      return { clave: c.clave, tipo: c.tipo, cantidad, costoUnitario: u.costo, importe: u.costo ? cantidad.mul(u.costo) : cero() };
    });
    const etapas = r.etapas.map((x) => {
      const t = tarifa(x.etapa);
      if (!t) faltantes.push(`etapa ${x.etapa} (sin tarifa de mano de obra)`);
      return { etapa: x.etapa, minutos: x.minutos, costoMinuto: t, importe: t ? x.minutos.mul(t) : cero() };
    });
    const minutos = etapas.reduce((s, x) => s.plus(x.minutos), cero());
    const gifDetalle: CostoArticulo["gifDetalle"] = [];
    const kg = tasaGif("KG_MASA");
    if (kg) gifDetalle.push({ base: "KG_MASA", cantidad: r.rendimiento, tasa: kg, importe: r.rendimiento.mul(kg) });
    const pm = tasaGif("MINUTO_MOD");
    if (pm && minutos.gt(0)) gifDetalle.push({ base: "MINUTO_MOD", cantidad: minutos, tasa: pm, importe: minutos.mul(pm) });
    const suma = (xs: { importe: Dec }[]) => xs.reduce((s, x) => s.plus(x.importe), cero());
    const mp = suma(componentes).div(r.rendimiento);
    const mod = suma(etapas).div(r.rendimiento);
    const gif = suma(gifDetalle).div(r.rendimiento);
    res.set(clave, { clave, nivel: "N1", version: r.version, mp, mod, gif, total: mp.plus(mod).plus(gif), completo: !faltantes.length, faltantes, componentes, etapas, gifDetalle, rendimiento: r.rendimiento });
  }

  // N2: por pieza buena
  for (const r of e.recetas.n2.values()) {
    const faltantes: string[] = [];
    const formadas = conMerma(1, r.mermaHorneadoPct, e.formula);
    const componentes: LineaCosto[] = r.componentes.map((c) => {
      const cantidad = consumoN2(r, c, uno(), e.formula);
      const u = unitario(c);
      faltantes.push(...u.faltan);
      return { clave: c.clave, tipo: c.tipo, cantidad, costoUnitario: u.costo, importe: u.costo ? cantidad.mul(u.costo) : cero() };
    });
    const etapas = r.etapas.map((x) => {
      const t = tarifa(x.etapa);
      if (!t) faltantes.push(`etapa ${x.etapa} (sin tarifa de mano de obra)`);
      // Minutos por pieza buena: se trabaja sobre las piezas formadas.
      let minutos = x.minutos.mul(formadas);
      if (x.base === "LOTE") {
        if (r.piezasPorLote) minutos = minutos.div(r.piezasPorLote);
        else {
          faltantes.push(`etapa ${x.etapa} (falta piezas por lote)`);
          minutos = cero();
        }
      }
      return { etapa: x.etapa, minutos, costoMinuto: t, importe: t ? minutos.mul(t) : cero() };
    });
    const minutos = etapas.reduce((s, x) => s.plus(x.minutos), cero());
    const gifDetalle: CostoArticulo["gifDetalle"] = [];
    const pm = tasaGif("MINUTO_MOD");
    if (pm && minutos.gt(0)) gifDetalle.push({ base: "MINUTO_MOD", cantidad: minutos, tasa: pm, importe: minutos.mul(pm) });
    const pz = tasaGif("PIEZA");
    if (pz) gifDetalle.push({ base: "PIEZA", cantidad: formadas, tasa: pz, importe: formadas.mul(pz) });
    const suma = (xs: { importe: Dec }[]) => xs.reduce((s, x) => s.plus(x.importe), cero());
    const mp = suma(componentes);
    const mod = suma(etapas);
    const gif = suma(gifDetalle);
    res.set(r.clave, { clave: r.clave, nivel: "N2", version: r.version, mp, mod, gif, total: mp.plus(mod).plus(gif), completo: !faltantes.length, faltantes, componentes, etapas, gifDetalle, rendimiento: null });
  }
  return res;
}

export interface TasaImpuesto {
  tipoFactor: "Tasa" | "Cuota" | "Exento";
  tasa: Decimal.Value | null;
}

/**
 * Precio sin impuestos a partir del precio al público (que ya los incluye).
 * El IEPS se calcula sobre el precio sin impuestos y el IVA sobre el precio
 * más IEPS:  público = base × (1 + IEPS) × (1 + IVA).
 * Devuelve null si falta el IVA o si el IEPS es por cuota (no se desglosa con %).
 */
export function precioSinImpuestos(precioPublico: Decimal.Value, iva: TasaImpuesto | null, ieps: TasaImpuesto | null): Dec | null {
  if (!iva) return null;
  const f = (t: TasaImpuesto | null) => {
    if (!t || t.tipoFactor === "Exento") return uno();
    if (t.tipoFactor === "Cuota") return null;
    return uno().plus(t.tasa ?? 0);
  };
  const fi = f(iva);
  const fe = f(ieps);
  if (!fi || !fe) return null;
  return new D(precioPublico).div(fe.mul(fi));
}

/** Margen bruto contra el costo estándar: importe y % sobre el precio sin impuestos. */
export function margen(precioSinImp: Dec, costo: Dec): { importe: Dec; pct: Dec | null } {
  const importe = precioSinImp.minus(costo);
  return { importe, pct: precioSinImp.isZero() ? null : importe.div(precioSinImp).mul(100) };
}
