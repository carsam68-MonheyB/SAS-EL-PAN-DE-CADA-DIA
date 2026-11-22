// Cálculos de producción (críticos, con pruebas): consumo y minutos estándar de
// una orden, costo real (materiales consumidos + mano de obra + indirectos
// aplicados), balance de masa y de piezas, variaciones contra el estándar y el
// estado de costo de producción y ventas. Aritmética decimal exacta.
//
// Convenciones (las mismas del costo estándar, src/dominio/recetas.ts):
//  * N1 (masa o intermedio): la orden se mide en unidad base del intermedio (kg);
//    los componentes de la receta son por lote y el lote rinde `rendimiento`.
//  * N2 (producto): la orden se mide en piezas buenas; la masa y los insumos se
//    consumen sobre piezas formadas y el empaque sobre piezas buenas.
//  * Mano de obra: minutos × costo por minuto de la etapa.
//  * Indirectos (GIF): KG_MASA × kg producidos (N1), MINUTO_MOD × minutos,
//    PIEZA × piezas formadas (N2).
import { conMerma, consumoN2, D, type BaseGif, type Dec, type FormulaMerma, type RecetaN1, type RecetaN2, type TipoComponente } from "./recetas";

const cero = () => new D(0);
const suma = (xs: Dec[]) => xs.reduce((s, x) => s.plus(x), cero());

export interface ComponenteEstandar { clave: string; tipo: TipoComponente; cantidad: Dec }
export interface EtapaEstandar { etapa: string; minutos: Dec }
export interface EstandarOrden { componentes: ComponenteEstandar[]; etapas: EtapaEstandar[]; lotes: Dec | null; formadas: Dec | null }

/** Consumo y minutos estándar de una orden N1 para `kg` producidos (o para `lotes` dados). */
export function estandarN1(r: RecetaN1, kg: Dec, formula: FormulaMerma, lotesDados?: Dec | null): EstandarOrden {
  if (kg.lt(0)) throw new Error("La cantidad no puede ser negativa.");
  const lotes = lotesDados ?? kg.div(r.rendimiento);
  return {
    lotes,
    formadas: null,
    componentes: r.componentes.map((c) => ({ clave: c.clave, tipo: c.tipo, cantidad: conMerma(c.cantidad.mul(lotes), c.mermaPct, formula) })),
    // En N1 una etapa por PIEZA se toma por unidad base producida.
    etapas: r.etapas.map((e) => ({ etapa: e.etapa, minutos: e.base === "LOTE" ? e.minutos.mul(lotes) : e.minutos.mul(kg) })),
  };
}

/** Consumo y minutos estándar de una orden N2 para `piezas` buenas. */
export function estandarN2(r: RecetaN2, piezas: Dec, formula: FormulaMerma): EstandarOrden {
  if (piezas.lt(0)) throw new Error("Las piezas no pueden ser negativas.");
  const formadas = conMerma(piezas, r.mermaHorneadoPct, formula);
  return {
    lotes: null,
    formadas,
    componentes: r.componentes.map((c) => ({ clave: c.clave, tipo: c.tipo, cantidad: consumoN2(r, c, piezas, formula) })),
    etapas: r.etapas.map((e) => {
      let minutos = e.minutos.mul(formadas);
      if (e.base === "LOTE") minutos = r.piezasPorLote ? minutos.div(r.piezasPorLote) : cero();
      return { etapa: e.etapa, minutos };
    }),
  };
}

// ---------------------------------------------------------------------------
// Costo real
// ---------------------------------------------------------------------------
export interface Tasas { tarifas: Map<string, Dec | null>; gif: Map<BaseGif, Dec> }
export interface CostoReal {
  mp: Dec; mod: Dec; gif: Dec; total: Dec; unitario: Dec | null; minutos: Dec;
  etapas: { etapa: string; minutos: Dec; costoMinuto: Dec | null; importe: Dec }[];
  gifDetalle: { base: BaseGif; cantidad: Dec; tasa: Dec; importe: Dec }[];
  faltantes: string[];
}

/**
 * Costo de una orden: materiales (lo que realmente salió del almacén de
 * producción, a su costo de inventario) + mano de obra + indirectos aplicados.
 */
export function costoOrden(o: { nivel: "N1" | "N2"; cantidad: Dec; formadas: Dec | null; materiales: Dec; etapas: EtapaEstandar[] }, t: Tasas): CostoReal {
  const faltantes: string[] = [];
  const etapas = o.etapas.map((e) => {
    const tarifa = t.tarifas.get(e.etapa) ?? null;
    if (tarifa === null && e.minutos.gt(0)) faltantes.push(`etapa ${e.etapa} sin tarifa de mano de obra`);
    return { etapa: e.etapa, minutos: e.minutos, costoMinuto: tarifa, importe: tarifa ? e.minutos.mul(tarifa) : cero() };
  });
  const minutos = suma(etapas.map((e) => e.minutos));
  const gifDetalle: CostoReal["gifDetalle"] = [];
  const agregar = (base: BaseGif, cantidad: Dec) => {
    const tasa = t.gif.get(base);
    if (tasa && cantidad.gt(0)) gifDetalle.push({ base, cantidad, tasa, importe: cantidad.mul(tasa) });
  };
  if (o.nivel === "N1") agregar("KG_MASA", o.cantidad);
  agregar("MINUTO_MOD", minutos);
  if (o.nivel === "N2") agregar("PIEZA", o.formadas ?? o.cantidad);
  const mod = suma(etapas.map((e) => e.importe));
  const gif = suma(gifDetalle.map((g) => g.importe));
  const total = o.materiales.plus(mod).plus(gif);
  return { mp: o.materiales, mod, gif, total, unitario: o.cantidad.gt(0) ? total.div(o.cantidad) : null, minutos, etapas, gifDetalle, faltantes };
}

// ---------------------------------------------------------------------------
// Balance de masa y piezas, y variaciones
// ---------------------------------------------------------------------------
export interface ComponenteCierre {
  clave: string; tipo: TipoComponente;
  /** Estándar para lo realmente producido. */
  estandar: Dec;
  real: Dec;
  importeReal: Dec;
  costoEstandar: Dec | null;
  /** Cuenta para el balance de masa (N2: la masa; N1: los componentes en la misma unidad que el intermedio). */
  esMasa: boolean;
}
export interface ToleranciasProduccion { masaPct: Dec; piezasPct: Dec; consumoPct: Dec }

export interface Balance {
  masa: { estandar: Dec; real: Dec; diferencia: Dec; pct: Dec | null; dentro: boolean } | null;
  piezas: { esperadas: Dec; buenas: Dec; formadas: Dec | null; merma: Dec; sinExplicar: Dec | null; diferencia: Dec; pct: Dec | null; dentro: boolean } | null;
  consumos: {
    clave: string; tipo: TipoComponente; estandar: Dec; real: Dec; diferencia: Dec; pct: Dec | null; dentro: boolean;
    importeEstandar: Dec | null; importeReal: Dec; variacionCantidad: Dec | null; variacionPrecio: Dec | null;
  }[];
  fuera: string[];
}

const pctDe = (dif: Dec, base: Dec) => (base.isZero() ? null : dif.div(base).mul(100));
const dentroDe = (dif: Dec, base: Dec, tol: Dec) => (base.isZero() ? dif.isZero() : dif.abs().div(base).mul(100).lte(tol));

/**
 * Balance de una orden al cerrarla.
 *  * Masa: lo consumido contra lo que corresponde a lo producido.
 *  * Piezas (N2): las buenas contra las que debía rendir la masa consumida.
 *  * Consumos: cada material contra su estándar; la variación se separa en
 *    cantidad ((real − estándar) × costo estándar) y precio (importe real − real × costo estándar).
 */
export function balanceOrden(x: {
  nivel: "N1" | "N2"; buenas: Dec; formadas: Dec | null; mermaAvance: Dec; componentes: ComponenteCierre[]; tolerancias: ToleranciasProduccion;
}): Balance {
  const fuera: string[] = [];
  const consumos = x.componentes.map((c) => {
    const diferencia = c.real.minus(c.estandar);
    const dentro = dentroDe(diferencia, c.estandar, x.tolerancias.consumoPct);
    if (!dentro) fuera.push(`${c.clave}: se consumió ${c.real.toDecimalPlaces(3).toFixed()} contra ${c.estandar.toDecimalPlaces(3).toFixed()} estándar (${pctDe(diferencia, c.estandar)?.toDecimalPlaces(2).toFixed() ?? "—"} %).`);
    const importeEstandar = c.costoEstandar ? c.estandar.mul(c.costoEstandar) : null;
    return {
      clave: c.clave, tipo: c.tipo, estandar: c.estandar, real: c.real, diferencia, pct: pctDe(diferencia, c.estandar), dentro,
      importeEstandar, importeReal: c.importeReal,
      variacionCantidad: c.costoEstandar ? diferencia.mul(c.costoEstandar) : null,
      variacionPrecio: c.costoEstandar ? c.importeReal.minus(c.real.mul(c.costoEstandar)) : null,
    };
  });

  const masas = x.componentes.filter((c) => c.esMasa);
  let masa: Balance["masa"] = null;
  if (masas.length) {
    const estandar = suma(masas.map((c) => c.estandar));
    const real = suma(masas.map((c) => c.real));
    const diferencia = real.minus(estandar);
    const dentro = dentroDe(diferencia, estandar, x.tolerancias.masaPct);
    if (!dentro) fuera.push(`Balance de masa: se usaron ${real.toDecimalPlaces(3).toFixed()} kg contra ${estandar.toDecimalPlaces(3).toFixed()} kg que corresponden a lo producido (${pctDe(diferencia, estandar)?.toDecimalPlaces(2).toFixed() ?? "—"} %).`);
    masa = { estandar, real, diferencia, pct: pctDe(diferencia, estandar), dentro };
  }

  let piezas: Balance["piezas"] = null;
  if (x.nivel === "N2") {
    // Piezas que debía rendir la masa usada: masa real ÷ masa estándar por pieza buena.
    let esperadas = x.buenas;
    if (masa && x.buenas.gt(0) && masa.estandar.gt(0)) esperadas = masa.real.div(masa.estandar.div(x.buenas));
    esperadas = esperadas.toDecimalPlaces(2, D.ROUND_HALF_UP);
    const diferencia = x.buenas.minus(esperadas);
    const dentro = dentroDe(diferencia, esperadas, x.tolerancias.piezasPct);
    if (!dentro) fuera.push(`Balance de piezas: salieron ${x.buenas.toFixed()} piezas buenas y la masa usada debía rendir ${esperadas.toFixed()} (${pctDe(diferencia, esperadas)?.toDecimalPlaces(2).toFixed() ?? "—"} %).`);
    const sinExplicar = x.formadas ? x.formadas.minus(x.buenas).minus(x.mermaAvance) : null;
    if (sinExplicar && !sinExplicar.isZero()) fuera.push(`Piezas sin explicar: se formaron ${x.formadas!.toFixed()}, salieron ${x.buenas.toFixed()} buenas y se registraron ${x.mermaAvance.toFixed()} de merma (faltan ${sinExplicar.toFixed()}).`);
    piezas = { esperadas, buenas: x.buenas, formadas: x.formadas, merma: x.mermaAvance, sinExplicar, diferencia, pct: pctDe(diferencia, esperadas), dentro };
  }
  return { masa, piezas, consumos, fuera };
}

/** Variación total de la orden contra el estándar de lo realmente producido. */
export function variacionTotal(costoReal: Dec, costoEstandarUnitario: Dec | null, cantidad: Dec): { estandar: Dec | null; diferencia: Dec | null; pct: Dec | null } {
  if (!costoEstandarUnitario) return { estandar: null, diferencia: null, pct: null };
  const estandar = costoEstandarUnitario.mul(cantidad);
  const diferencia = costoReal.minus(estandar);
  return { estandar, diferencia, pct: pctDe(diferencia, estandar) };
}

// ---------------------------------------------------------------------------
// Estado de costo de producción y ventas
// ---------------------------------------------------------------------------
export type Grupo = "MP" | "PEP" | "PT";
export interface SaldoGrupo { inicial: Dec; final: Dec; tipos: Map<string, Dec> } // importe neto por tipo de movimiento (+ entra, − sale)
export interface LineaEstado { concepto: string; importe: Dec; nivel: 0 | 1 }

/**
 * Estado de costo de producción y de lo vendido, a partir del kárdex valuado.
 * Cuadra por construcción con los saldos de MP, PEP y PT; las dos comprobaciones
 * (producción terminada y costo de ventas) deben dar cero.
 */
export function estadoCostos(g: Record<Grupo, SaldoGrupo>, aplicado: { mod: Dec; gif: Dec }) {
  const t = (grupo: Grupo, tipo: string) => g[grupo].tipos.get(tipo) ?? cero();
  const resto = (grupo: Grupo, excluir: string[]) => suma([...g[grupo].tipos].filter(([k]) => !excluir.includes(k)).map(([, v]) => v));

  const surtido = t("MP", "SURTIDO_SALIDA").neg();
  const compras = t("MP", "ENTRADA_COMPRA").plus(t("MP", "INICIAL"));
  const otrosMp = resto("MP", ["SURTIDO_SALIDA", "ENTRADA_COMPRA", "INICIAL"]);
  // Valor agregado en producción = entradas de producción − consumos (mano de obra e indirectos aplicados).
  // (las órdenes consumen siempre del almacén de producción en proceso).
  const agregado = t("PEP", "ENTRADA_PRODUCCION").plus(t("PT", "ENTRADA_PRODUCCION")).plus(t("PEP", "CONSUMO_PRODUCCION"));
  const sinOrden = agregado.minus(aplicado.mod).minus(aplicado.gif);
  const costoProduccion = surtido.plus(agregado);
  // Lo que se movió en PEP que no es surtido, producción ni consumo (mermas, ajustes, conteos).
  const otrosPep = resto("PEP", ["SURTIDO_ENTRADA", "ENTRADA_PRODUCCION", "CONSUMO_PRODUCCION"]).plus(t("PEP", "SURTIDO_ENTRADA")).minus(surtido);
  const terminada = costoProduccion.plus(g.PEP.inicial).minus(g.PEP.final).plus(otrosPep);
  const entradaPt = t("PT", "ENTRADA_PRODUCCION");
  const cargaPt = t("PT", "INICIAL");
  const otrosPt = resto("PT", ["ENTRADA_PRODUCCION", "VENTA", "DEVOLUCION_VENTA", "INICIAL"]);
  const costoVentas = entradaPt.plus(g.PT.inicial).plus(cargaPt).minus(g.PT.final).plus(otrosPt);
  const ventasKardex = t("PT", "VENTA").plus(t("PT", "DEVOLUCION_VENTA")).neg();

  const lineas: LineaEstado[] = [
    { concepto: "Inventario inicial de materia prima", importe: g.MP.inicial, nivel: 1 },
    { concepto: "+ Compras y entradas iniciales", importe: compras, nivel: 1 },
    { concepto: "± Mermas, ajustes y traspasos de materia prima", importe: otrosMp, nivel: 1 },
    { concepto: "− Inventario final de materia prima", importe: g.MP.final.neg(), nivel: 1 },
    { concepto: "= Materia prima surtida a producción", importe: surtido, nivel: 0 },
    { concepto: "+ Mano de obra aplicada", importe: aplicado.mod, nivel: 1 },
    { concepto: "+ Gastos indirectos aplicados", importe: aplicado.gif, nivel: 1 },
    ...(sinOrden.isZero() ? [] : [{ concepto: "+ Entradas de producción sin orden (Fase 3)", importe: sinOrden, nivel: 1 as const }]),
    { concepto: "= Costo de producción del periodo", importe: costoProduccion, nivel: 0 },
    { concepto: "+ Inventario inicial de producción en proceso", importe: g.PEP.inicial, nivel: 1 },
    { concepto: "± Carga inicial, mermas y ajustes en producción en proceso", importe: otrosPep, nivel: 1 },
    { concepto: "− Inventario final de producción en proceso", importe: g.PEP.final.neg(), nivel: 1 },
    { concepto: "= Costo de la producción terminada", importe: terminada, nivel: 0 },
    { concepto: "+ Inventario inicial de producto terminado", importe: g.PT.inicial, nivel: 1 },
    ...(cargaPt.isZero() ? [] : [{ concepto: "+ Carga de inventario inicial de producto terminado", importe: cargaPt, nivel: 1 as const }]),
    { concepto: "± Mermas, ajustes y traspasos de producto terminado", importe: otrosPt, nivel: 1 },
    { concepto: "− Inventario final de producto terminado", importe: g.PT.final.neg(), nivel: 1 },
    { concepto: "= Costo de lo vendido", importe: costoVentas, nivel: 0 },
  ];
  const mpCuadra = g.MP.inicial.plus(compras).plus(otrosMp).minus(surtido).minus(g.MP.final);
  return {
    lineas,
    comprobaciones: [
      { concepto: "Materia prima: saldo inicial + movimientos − saldo final", diferencia: mpCuadra },
      { concepto: "Producción terminada contra entradas a producto terminado", diferencia: terminada.minus(entradaPt) },
      { concepto: "Costo de lo vendido contra salidas por venta del kárdex", diferencia: costoVentas.minus(ventasKardex) },
    ],
    totales: { surtido, mod: aplicado.mod, gif: aplicado.gif, costoProduccion, terminada, costoVentas },
  };
}

