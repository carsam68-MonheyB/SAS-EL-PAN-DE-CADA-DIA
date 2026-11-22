// Cálculos del punto de venta (críticos, con pruebas): desglose de impuestos
// de un precio que ya los incluye, cobro con varias formas de pago y cambio,
// efectivo esperado en el corte y arqueo por denominaciones.
// Aritmética decimal exacta; los importes son en centavos (2 decimales).
import { D, type Dec } from "./recetas";

export interface Tasa { tipoFactor: "Tasa" | "Cuota" | "Exento"; tasa: string | null }
const r2 = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP);

/** Importe de un renglón: precio × cantidad − descuento (a centavos). */
export function importeRenglon(precio: Dec, cantidad: Dec, descuento: Dec): Dec {
  if (cantidad.lte(0)) throw new Error("La cantidad debe ser mayor que cero.");
  if (descuento.lt(0)) throw new Error("El descuento no puede ser negativo.");
  const bruto = r2(precio.mul(cantidad));
  if (descuento.gt(bruto)) throw new Error("El descuento no puede ser mayor que el importe.");
  return bruto.minus(descuento);
}

/**
 * Desglose de un importe que ya incluye impuestos: base + IEPS + IVA = importe
 * exactamente (la diferencia de redondeo queda en la base). El IVA se calcula
 * sobre la base más el IEPS.
 */
export function desglosar(importe: Dec, iva: Tasa | null, ieps: Tasa | null): { base: Dec; ieps: Dec; iva: Dec } {
  if (!iva) throw new Error("El producto no tiene tasa de IVA en el catálogo.");
  const tasa = (t: Tasa | null) => {
    if (!t || t.tipoFactor === "Exento") return new D(0);
    if (t.tipoFactor === "Cuota") throw new Error("El IEPS por cuota todavía no se maneja en caja.");
    return new D(t.tasa ?? 0);
  };
  const te = tasa(ieps);
  const ti = tasa(iva);
  const baseExacta = importe.div(te.plus(1).mul(ti.plus(1)));
  const montoIeps = r2(baseExacta.mul(te));
  const montoIva = r2(baseExacta.mul(te.plus(1)).mul(ti));
  return { base: importe.minus(montoIeps).minus(montoIva), ieps: montoIeps, iva: montoIva };
}

export interface PagoCaptura { efectivo: boolean; importe: Dec }

/**
 * Valida el cobro: lo que no es efectivo no puede pasar de lo que se debe; el
 * cambio sale solo del efectivo. Regresa el cambio y lo que se aplica de cada pago.
 */
export function cobrar(porCobrar: Dec, pagos: PagoCaptura[]): { cambio: Dec; aplicados: Dec[]; recibido: Dec } {
  if (pagos.some((p) => p.importe.lte(0))) throw new Error("Cada pago debe ser mayor que cero.");
  const recibido = pagos.reduce((s, p) => s.plus(p.importe), new D(0));
  if (recibido.lt(porCobrar)) throw new Error(`Falta por cobrar $${porCobrar.minus(recibido).toFixed(2)}.`);
  const noEfectivo = pagos.filter((p) => !p.efectivo).reduce((s, p) => s.plus(p.importe), new D(0));
  if (noEfectivo.gt(porCobrar)) throw new Error("Los pagos con tarjeta o transferencia no pueden pasar del total: el cambio solo se da en efectivo.");
  let cambio = recibido.minus(porCobrar);
  // El cambio se descuenta de los pagos en efectivo (del último al primero).
  const aplicados = pagos.map((p) => p.importe);
  for (let i = pagos.length - 1; i >= 0 && cambio.gt(0); i--) {
    if (!pagos[i]!.efectivo) continue;
    const quita = D.min(cambio, aplicados[i]!);
    aplicados[i] = aplicados[i]!.minus(quita);
    cambio = cambio.minus(quita);
  }
  return { cambio: recibido.minus(porCobrar), aplicados, recibido };
}

export interface MovimientosTurno {
  fondo: Dec;
  ventasEfectivo: Dec;        // efectivo aplicado a ventas (ya sin cambio)
  ingresos: Dec;
  anticiposEfectivo: Dec;
  retiros: Dec;
  devolucionesEfectivo: Dec;  // devoluciones de venta y de anticipos pagadas en efectivo
}

/** Efectivo que debe haber en la caja. */
export function efectivoEsperado(m: MovimientosTurno): Dec {
  return m.fondo.plus(m.ventasEfectivo).plus(m.ingresos).plus(m.anticiposEfectivo).minus(m.retiros).minus(m.devolucionesEfectivo);
}

/** Total contado en el arqueo: Σ denominación × cantidad. */
export function arqueo(conteo: { valor: Dec; cantidad: number }[]): Dec {
  return conteo.reduce((s, x) => {
    if (!Number.isInteger(x.cantidad) || x.cantidad < 0) throw new Error("Las cantidades del arqueo son números enteros, cero o mayores.");
    return s.plus(x.valor.mul(x.cantidad));
  }, new D(0));
}

/** Importe de una devolución parcial proporcional a lo devuelto (a centavos). */
export function importeDevolucion(importeRenglon: Dec, cantidadVendida: Dec, cantidadDevuelta: Dec, yaDevuelto: Dec, importeYaDevuelto: Dec): Dec {
  if (cantidadDevuelta.lte(0)) throw new Error("La cantidad a devolver debe ser mayor que cero.");
  const restante = cantidadVendida.minus(yaDevuelto);
  if (cantidadDevuelta.gt(restante)) throw new Error(`Solo quedan ${restante.toFixed()} por devolver.`);
  // Si se devuelve todo lo que queda, el importe es exactamente lo que falta devolver.
  if (cantidadDevuelta.eq(restante)) return importeRenglon.minus(importeYaDevuelto);
  return r2(importeRenglon.mul(cantidadDevuelta).div(cantidadVendida));
}
