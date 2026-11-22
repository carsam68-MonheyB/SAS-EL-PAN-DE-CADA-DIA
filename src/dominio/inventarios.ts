// Valuación de inventarios (cálculo crítico, con pruebas): costo promedio
// ponderado y PEPS por almacén, y asignación de lotes por caducidad (FEFO).
// Aritmética decimal exacta; los importes se redondean a 6 decimales y, cuando
// sale todo lo que queda (de la existencia o de una capa), se toma el valor
// restante completo para que el saldo nunca quede con centavos "huérfanos".
import { D, type Dec } from "./recetas";

export type Metodo = "PROMEDIO" | "PEPS";
const r6 = (x: Dec) => x.toDecimalPlaces(6, D.ROUND_HALF_UP);

export class FaltaExistencia extends Error {}

export interface Saldo { cantidad: Dec; valor: Dec }
export interface Capa { id: string; cantidad: Dec; valor: Dec }

/** Importe de una entrada: cantidad × costo unitario. */
export function importeEntrada(cantidad: Dec, costoUnitario: Dec): Dec {
  if (cantidad.lte(0)) throw new Error("La cantidad debe ser mayor que cero.");
  if (costoUnitario.lt(0)) throw new Error("El costo no puede ser negativo.");
  return r6(cantidad.mul(costoUnitario));
}

/** Salida a costo promedio: importe = cantidad × (valor ÷ existencia). */
export function salidaPromedio(saldo: Saldo, cantidad: Dec): Dec {
  if (cantidad.lte(0)) throw new Error("La cantidad debe ser mayor que cero.");
  if (cantidad.gt(saldo.cantidad)) throw new FaltaExistencia(`No alcanza: hay ${saldo.cantidad.toFixed()} y se piden ${cantidad.toFixed()}.`);
  if (cantidad.eq(saldo.cantidad)) return saldo.valor;
  return D.min(saldo.valor, r6(cantidad.mul(saldo.valor).div(saldo.cantidad)));
}

/** Salida PEPS: consume las capas en el orden recibido (la más antigua primero). */
export function salidaPeps(capas: Capa[], cantidad: Dec): { importe: Dec; consumos: { id: string; cantidad: Dec; importe: Dec }[] } {
  if (cantidad.lte(0)) throw new Error("La cantidad debe ser mayor que cero.");
  const total = capas.reduce((s, c) => s.plus(c.cantidad), new D(0));
  if (cantidad.gt(total)) throw new FaltaExistencia(`No alcanza: hay ${total.toFixed()} y se piden ${cantidad.toFixed()}.`);
  let falta = cantidad;
  let importe = new D(0);
  const consumos: { id: string; cantidad: Dec; importe: Dec }[] = [];
  for (const c of capas) {
    if (falta.lte(0)) break;
    if (c.cantidad.lte(0)) continue;
    const toma = D.min(falta, c.cantidad);
    const i = toma.eq(c.cantidad) ? c.valor : D.min(c.valor, r6(toma.mul(c.valor).div(c.cantidad)));
    consumos.push({ id: c.id, cantidad: toma, importe: i });
    importe = importe.plus(i);
    falta = falta.minus(toma);
  }
  return { importe, consumos };
}

/** Costo unitario mostrado en el kárdex (importe ÷ cantidad). */
export function costoUnitario(importe: Dec, cantidad: Dec): Dec {
  return cantidad.isZero() ? new D(0) : r6(importe.abs().div(cantidad.abs()));
}

export interface LoteDisponible { id: string; cantidad: Dec; caducidad: string | null; orden: number }

/** Asigna una salida a lotes: primero el que caduca antes (FEFO); sin caducidad, el más antiguo. */
export function asignarLotes(lotes: LoteDisponible[], cantidad: Dec): { lote_id: string; cantidad: Dec }[] {
  const disponibles = lotes.filter((l) => l.cantidad.gt(0)).sort((a, b) =>
    a.caducidad === b.caducidad ? a.orden - b.orden : a.caducidad === null ? 1 : b.caducidad === null ? -1 : a.caducidad < b.caducidad ? -1 : 1);
  const total = disponibles.reduce((s, l) => s.plus(l.cantidad), new D(0));
  if (cantidad.gt(total)) throw new FaltaExistencia(`No alcanza en lotes: hay ${total.toFixed()} y se piden ${cantidad.toFixed()}.`);
  const r: { lote_id: string; cantidad: Dec }[] = [];
  let falta = cantidad;
  for (const l of disponibles) {
    if (falta.lte(0)) break;
    const toma = D.min(falta, l.cantidad);
    r.push({ lote_id: l.id, cantidad: toma });
    falta = falta.minus(toma);
  }
  return r;
}

/** Diferencia de un conteo: físico − teórico (positivo = sobrante, negativo = faltante). */
export function diferenciaConteo(fisico: Dec, teorico: Dec): Dec {
  return fisico.minus(teorico);
}
