// Cálculos del tablero y reportes de gestión (4.10), críticos y con pruebas:
// margen por SKU (contra costo estándar y real), rotación y días de inventario,
// y variación de precios de compra. Aritmética decimal exacta.
import { D, type Dec } from "./recetas";

const cero = () => new D(0);

export interface Margen { margen: Dec; pct: Dec | null }
/** Margen sobre la venta sin impuestos: venta − costo y su % de la venta. */
export function margen(ventaSinImpuestos: Dec, costo: Dec): Margen {
  const m = ventaSinImpuestos.minus(costo);
  return { margen: m, pct: ventaSinImpuestos.isZero() ? null : m.div(ventaSinImpuestos).mul(100) };
}

export interface Rotacion { promedio: Dec; rotacion: Dec | null; dias: Dec | null }
/**
 * Rotación = lo que salió (consumo o venta, al costo) ÷ inventario promedio
 * ((inicial + final) ÷ 2). Días de inventario = días del periodo ÷ rotación.
 * Sin salidas no hay rotación (el inventario no se movió); sin inventario no hay días.
 */
export function rotacion(inicial: Dec, final: Dec, salidas: Dec, diasPeriodo: number): Rotacion {
  if (diasPeriodo <= 0) throw new Error("El periodo debe tener al menos un día.");
  const promedio = inicial.plus(final).div(2);
  if (salidas.lte(0) || promedio.lte(0)) return { promedio, rotacion: salidas.gt(0) ? null : cero(), dias: null };
  const r = salidas.div(promedio);
  return { promedio, rotacion: r, dias: new D(diasPeriodo).div(r) };
}

export interface Compra { fecha: string; cantidad: Dec; costoUnitario: Dec }
export interface VariacionPrecio {
  compras: number; cantidad: Dec; importe: Dec; promedio: Dec; primero: Dec; ultimo: Dec; minimo: Dec; maximo: Dec; variacionPct: Dec | null;
}
/**
 * Precio de un insumo en el periodo: primero, último, mínimo, máximo y promedio
 * ponderado por cantidad; variación = (último − primero) ÷ primero.
 */
export function variacionPrecio(compras: Compra[]): VariacionPrecio | null {
  const xs = compras.filter((x) => x.cantidad.gt(0)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!xs.length) return null;
  const cantidad = xs.reduce((s, x) => s.plus(x.cantidad), cero());
  const importe = xs.reduce((s, x) => s.plus(x.cantidad.mul(x.costoUnitario)), cero());
  const primero = xs[0]!.costoUnitario;
  const ultimo = xs[xs.length - 1]!.costoUnitario;
  return {
    compras: xs.length, cantidad, importe, promedio: importe.div(cantidad), primero, ultimo,
    minimo: D.min(...xs.map((x) => x.costoUnitario)), maximo: D.max(...xs.map((x) => x.costoUnitario)),
    variacionPct: primero.isZero() ? null : ultimo.minus(primero).div(primero).mul(100),
  };
}

/** Suma por clave, conservando el orden de aparición. */
export function agrupar<T>(xs: T[], clave: (x: T) => string, campos: (keyof T)[]): Map<string, Record<string, Dec> & { n: number }> {
  const m = new Map<string, Record<string, Dec> & { n: number }>();
  for (const x of xs) {
    const k = clave(x);
    const a = m.get(k) ?? Object.assign(Object.fromEntries(campos.map((c) => [c, cero()])), { n: 0 }) as Record<string, Dec> & { n: number };
    for (const c of campos) a[c as string] = a[c as string]!.plus(x[c] as unknown as Dec);
    a.n += 1;
    m.set(k, a);
  }
  return m;
}
