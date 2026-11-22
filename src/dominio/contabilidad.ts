// Cálculos contables (críticos, con pruebas): de las líneas que genera cada
// operación (por concepto) a las partidas de la póliza (por cuenta), con
// redondeo a centavos que siempre cuadra; balanza de comprobación con
// acumulación a cuentas de mayor; estado de resultados y balance general.
import { D, type Dec } from "./recetas";

const cero = () => new D(0);
const r2 = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP);

/** Línea de una operación: importe positivo = cargo, negativo = abono. */
export interface Linea { concepto: string; importe: Dec; sucursalId: string | null; centroCostoId?: string | null; texto: string }
export interface Regla { concepto: string; sucursalId: string | null; cuentaId: string }
export interface Partida { cuentaId: string; sucursalId: string | null; centroCostoId: string | null; texto: string; cargo: Dec; abono: Dec }

/** Cuenta para un concepto: la regla de la sucursal y, si no hay, la general. */
export function cuentaDe(reglas: Regla[], concepto: string, sucursalId: string | null): string | null {
  return reglas.find((r) => r.concepto === concepto && r.sucursalId !== null && r.sucursalId === sucursalId)?.cuentaId
    ?? reglas.find((r) => r.concepto === concepto && r.sucursalId === null)?.cuentaId
    ?? null;
}

/**
 * Convierte las líneas en partidas: resuelve la cuenta de cada concepto, junta
 * las que van a la misma cuenta (y sucursal y centro de costo) del mismo lado,
 * redondea a centavos y, si el redondeo deja diferencia, la absorbe la partida
 * más grande del lado que corresponde. Si falta alguna regla regresa los conceptos.
 */
export function armarPartidas(lineas: Linea[], reglas: Regla[]): { partidas: Partida[]; total: Dec } | { faltan: string[] } {
  const suma = lineas.reduce((s, l) => s.plus(l.importe), cero());
  if (!suma.abs().lt("0.000001")) throw new Error(`Las líneas no cuadran (diferencia ${suma.toFixed()}).`);
  const faltan = [...new Set(lineas.filter((l) => !l.importe.isZero() && !cuentaDe(reglas, l.concepto, l.sucursalId)).map((l) => l.concepto))];
  if (faltan.length) return { faltan };
  const grupos = new Map<string, Partida & { neto: Dec }>();
  for (const l of lineas) {
    if (l.importe.isZero()) continue;
    const cuentaId = cuentaDe(reglas, l.concepto, l.sucursalId)!;
    const lado = l.importe.gt(0) ? "C" : "A";
    const k = [cuentaId, l.sucursalId, l.centroCostoId ?? null, lado].join("|");
    const g = grupos.get(k);
    if (g) g.neto = g.neto.plus(l.importe);
    else grupos.set(k, { cuentaId, sucursalId: l.sucursalId, centroCostoId: l.centroCostoId ?? null, texto: l.texto, cargo: cero(), abono: cero(), neto: l.importe });
  }
  const partidas = [...grupos.values()].map((g) => ({ ...g, cargo: g.neto.gt(0) ? r2(g.neto) : cero(), abono: g.neto.lt(0) ? r2(g.neto.neg()) : cero() }))
    .filter((p) => p.cargo.gt(0) || p.abono.gt(0));
  let dif = partidas.reduce((s, p) => s.plus(p.cargo).minus(p.abono), cero());
  if (!dif.isZero()) {
    // Faltan centavos de un lado: se suman a la partida más grande de ese lado.
    const lado = dif.lt(0) ? "cargo" : "abono";
    const mayor = partidas.filter((p) => p[lado].gt(0)).sort((a, b) => b[lado].comparedTo(a[lado]))[0]!;
    mayor[lado] = mayor[lado].plus(dif.abs());
    dif = cero();
  }
  const total = partidas.reduce((s, p) => s.plus(p.cargo), cero());
  // Primero los cargos y después los abonos, como se presenta una póliza.
  const ordenadas = [...partidas.filter((p) => p.cargo.gt(0)), ...partidas.filter((p) => p.abono.gt(0))];
  return { partidas: ordenadas.map(({ neto: _n, ...p }) => p), total };
}

/** Folio de póliza: tipo-AAAAMM-consecutivo (D-202611-0001). */
export function folioPoliza(tipo: "I" | "E" | "D", ejercicio: number, mes: number, n: number): string {
  return `${tipo}-${ejercicio}${String(mes).padStart(2, "0")}-${String(n).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Balanza de comprobación
// ---------------------------------------------------------------------------
export interface CuentaBalanza { id: string; clave: string; nombre: string; nivel: number; naturaleza: "DEUDORA" | "ACREEDORA"; padre: string | null; afectable: boolean; agrupador: string | null }
export interface MovimientoCuenta { cuentaId: string; anteriorCargo: Dec; anteriorAbono: Dec; cargos: Dec; abonos: Dec }
export interface RenglonBalanza extends CuentaBalanza { inicial: Dec; cargos: Dec; abonos: Dec; final: Dec }

/** Saldo con el signo de la naturaleza de la cuenta (deudora: cargos − abonos). */
export const saldoNatural = (n: "DEUDORA" | "ACREEDORA", cargos: Dec, abonos: Dec) => (n === "DEUDORA" ? cargos.minus(abonos) : abonos.minus(cargos));

/** Balanza: cada cuenta con su saldo inicial, cargos, abonos y saldo final; las de mayor acumulan a sus subcuentas. */
export function balanza(cuentas: CuentaBalanza[], movs: MovimientoCuenta[]) {
  const porClave = new Map(cuentas.map((c) => [c.clave, c]));
  const acum = new Map(cuentas.map((c) => [c.id, { ac: cero(), aa: cero(), c: cero(), a: cero() }]));
  for (const m of movs) {
    let cta = cuentas.find((c) => c.id === m.cuentaId);
    const vistos = new Set<string>();
    while (cta && !vistos.has(cta.id)) {
      vistos.add(cta.id);
      const x = acum.get(cta.id)!;
      x.ac = x.ac.plus(m.anteriorCargo); x.aa = x.aa.plus(m.anteriorAbono); x.c = x.c.plus(m.cargos); x.a = x.a.plus(m.abonos);
      cta = cta.padre ? porClave.get(cta.padre) : undefined;
    }
  }
  const renglones: RenglonBalanza[] = cuentas.map((c) => {
    const x = acum.get(c.id)!;
    const inicial = saldoNatural(c.naturaleza, x.ac, x.aa);
    return { ...c, inicial, cargos: x.c, abonos: x.a, final: inicial.plus(saldoNatural(c.naturaleza, x.c, x.a)) };
  }).filter((r) => !r.inicial.isZero() || !r.cargos.isZero() || !r.abonos.isZero() || !r.final.isZero());
  const mayor = renglones.filter((r) => r.nivel === 1 || !r.padre);
  const totales = {
    cargos: mayor.reduce((s, r) => s.plus(r.cargos), cero()),
    abonos: mayor.reduce((s, r) => s.plus(r.abonos), cero()),
    deudor: mayor.reduce((s, r) => s.plus(r.naturaleza === "DEUDORA" ? r.final : r.final.neg()), cero()),
  };
  return { renglones: renglones.sort((a, b) => a.clave.localeCompare(b.clave)), totales, cuadra: totales.cargos.eq(totales.abonos) && totales.deudor.isZero() };
}

// ---------------------------------------------------------------------------
// Estados financieros (por el primer dígito del código agrupador del SAT)
// ---------------------------------------------------------------------------
export type Rubro = "ACTIVO" | "PASIVO" | "CAPITAL" | "INGRESOS" | "COSTOS" | "GASTOS" | "OTROS" | "ORDEN";
export function rubroDe(agrupador: string | null, clave: string): Rubro {
  const d = (agrupador || clave).trim()[0];
  return ({ "1": "ACTIVO", "2": "PASIVO", "3": "CAPITAL", "4": "INGRESOS", "5": "COSTOS", "6": "GASTOS", "7": "OTROS" } as Record<string, Rubro>)[d ?? ""] ?? "ORDEN";
}

export interface SaldoCuenta { clave: string; nombre: string; agrupador: string | null; cargos: Dec; abonos: Dec }

/** Estado de resultados: ingresos − costos − gastos ± otros (resultado integral de financiamiento y otros). */
export function estadoResultados(saldos: SaldoCuenta[]) {
  const de = (r: Rubro) => saldos.filter((s) => rubroDe(s.agrupador, s.clave) === r);
  const linea = (s: SaldoCuenta, signo: 1 | -1) => ({ clave: s.clave, nombre: s.nombre, importe: signo === 1 ? s.abonos.minus(s.cargos) : s.cargos.minus(s.abonos) });
  const ingresos = de("INGRESOS").map((s) => linea(s, 1));
  const costos = de("COSTOS").map((s) => linea(s, -1));
  const gastos = de("GASTOS").map((s) => linea(s, -1));
  const otros = de("OTROS").map((s) => linea(s, 1));
  const t = (xs: { importe: Dec }[]) => xs.reduce((s, x) => s.plus(x.importe), cero());
  const utilidadBruta = t(ingresos).minus(t(costos));
  const operacion = utilidadBruta.minus(t(gastos));
  return { ingresos, costos, gastos, otros, totales: { ingresos: t(ingresos), costos: t(costos), utilidadBruta, gastos: t(gastos), operacion, otros: t(otros), neta: operacion.plus(t(otros)) } };
}

/**
 * Balance general a una fecha. Sin cierre anual todavía, el resultado de los
 * ejercicios anteriores y el del ejercicio se calculan de las cuentas de resultados.
 */
export function balanceGeneral(saldosAlCorte: SaldoCuenta[], resultadoEjercicio: Dec) {
  const de = (r: Rubro, signo: 1 | -1) => saldosAlCorte.filter((s) => rubroDe(s.agrupador, s.clave) === r)
    .map((s) => ({ clave: s.clave, nombre: s.nombre, importe: signo === 1 ? s.cargos.minus(s.abonos) : s.abonos.minus(s.cargos) }))
    .filter((x) => !x.importe.isZero());
  const activo = de("ACTIVO", 1);
  const pasivo = de("PASIVO", -1);
  const capital = de("CAPITAL", -1);
  const t = (xs: { importe: Dec }[]) => xs.reduce((s, x) => s.plus(x.importe), cero());
  const resultadosTotales = saldosAlCorte.filter((s) => ["INGRESOS", "COSTOS", "GASTOS", "OTROS"].includes(rubroDe(s.agrupador, s.clave))).reduce((s, x) => s.plus(x.abonos).minus(x.cargos), cero());
  const anteriores = resultadosTotales.minus(resultadoEjercicio);
  const totalCapital = t(capital).plus(anteriores).plus(resultadoEjercicio);
  const diferencia = t(activo).minus(t(pasivo)).minus(totalCapital);
  return { activo, pasivo, capital, anteriores, resultadoEjercicio, totales: { activo: t(activo), pasivo: t(pasivo), capital: totalCapital, pasivoMasCapital: t(pasivo).plus(totalCapital) }, diferencia, cuadra: diferencia.isZero() };
}
