// Cálculos de compras (críticos, con pruebas): importes de la orden de compra,
// cotejo a 3 vías (orden de compra, recepción y factura) con tolerancias y
// antigüedad de saldos de cuentas por pagar. Aritmética decimal exacta.
import { D, type Dec } from "./recetas";

const r2 = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP);

/** Importe e IVA de un renglón de OC: cantidad × precio (sin IVA) y su IVA. */
export function importeOC(cantidad: Dec, precio: Dec, tasaIva: Dec): { importe: Dec; iva: Dec } {
  if (cantidad.lte(0)) throw new Error("La cantidad debe ser mayor que cero.");
  if (precio.lt(0) || tasaIva.lt(0)) throw new Error("Precio o tasa no válidos.");
  const importe = r2(cantidad.mul(precio));
  return { importe, iva: r2(importe.mul(tasaIva)) };
}

export interface RenglonCotejo { id: string; descripcion: string; precio: Dec; tasaIva: Dec; porFacturar: Dec } // por facturar = recibido − ya facturado (unidad de la OC)
export interface ConceptoCotejo { orden: number; descripcion: string; ocRenglonId: string | null; cantidad: Dec; valorUnitario: Dec; importe: Dec; descuento: Dec; iva: Dec }
export interface Tolerancias { cantidadPct: Dec; precioPct: Dec; importe: Dec }
export interface Diferencia { ocRenglonId: string | null; tipo: "CANTIDAD" | "PRECIO" | "IMPUESTO" | "TOTAL" | "SIN_RELACION"; esperado: Dec | null; facturado: Dec | null; dentro: boolean; descripcion: string }

const fuera = (dif: Dec, base: Dec, pct: Dec) => (base.isZero() ? !dif.isZero() : dif.abs().div(base.abs()).mul(100).gt(pct));

/**
 * Cotejo a 3 vías. Cada concepto de la factura se relaciona con un renglón de
 * la OC; se compara la cantidad contra lo recibido pendiente de facturar, el
 * precio contra el de la OC, el IVA contra la tasa de la OC y el total de la
 * factura contra lo esperado (cantidad facturada × precio de OC + IVA).
 */
export function cotejar(renglones: RenglonCotejo[], conceptos: ConceptoCotejo[], totalFactura: Dec, t: Tolerancias): Diferencia[] {
  const difs: Diferencia[] = [];
  const porRenglon = new Map<string, ConceptoCotejo[]>();
  for (const c of conceptos) {
    if (!c.ocRenglonId || !renglones.some((r) => r.id === c.ocRenglonId)) {
      difs.push({ ocRenglonId: null, tipo: "SIN_RELACION", esperado: null, facturado: c.importe, dentro: false, descripcion: `Concepto ${c.orden} (${c.descripcion}) no corresponde a ningún renglón de la orden de compra.` });
      continue;
    }
    porRenglon.set(c.ocRenglonId, [...(porRenglon.get(c.ocRenglonId) ?? []), c]);
  }
  let esperadoTotal = new D(0);
  for (const [id, cs] of porRenglon) {
    const r = renglones.find((x) => x.id === id)!;
    const cantidad = cs.reduce((s, c) => s.plus(c.cantidad), new D(0));
    const dc = cantidad.minus(r.porFacturar);
    difs.push({ ocRenglonId: id, tipo: "CANTIDAD", esperado: r.porFacturar, facturado: cantidad, dentro: !fuera(dc, r.porFacturar, t.cantidadPct),
      descripcion: dc.isZero() ? `${r.descripcion}: la cantidad coincide con lo recibido.` : `${r.descripcion}: se facturan ${cantidad.toFixed()} y se recibieron ${r.porFacturar.toFixed()} pendientes de facturar.` });
    for (const c of cs) {
      const precioNeto = c.cantidad.isZero() ? c.valorUnitario : c.importe.minus(c.descuento).div(c.cantidad);
      const dp = precioNeto.minus(r.precio);
      difs.push({ ocRenglonId: id, tipo: "PRECIO", esperado: r.precio, facturado: precioNeto.toDecimalPlaces(6), dentro: !fuera(dp, r.precio, t.precioPct),
        descripcion: dp.isZero() ? `${r.descripcion}: el precio coincide con la orden de compra.` : `${r.descripcion}: precio facturado $${precioNeto.toDecimalPlaces(4).toFixed()} contra $${r.precio.toFixed()} de la orden de compra.` });
      const ivaEsperado = r2(c.importe.minus(c.descuento).mul(r.tasaIva));
      const di = c.iva.minus(ivaEsperado);
      difs.push({ ocRenglonId: id, tipo: "IMPUESTO", esperado: ivaEsperado, facturado: c.iva, dentro: di.abs().lte(t.importe),
        descripcion: di.isZero() ? `${r.descripcion}: el IVA coincide.` : `${r.descripcion}: IVA facturado $${c.iva.toFixed(2)} contra $${ivaEsperado.toFixed(2)} esperado.` });
    }
    const imp = r2(cantidad.mul(r.precio));
    esperadoTotal = esperadoTotal.plus(imp).plus(r2(imp.mul(r.tasaIva)));
  }
  const dt = totalFactura.minus(esperadoTotal);
  const tolTotal = D.max(t.importe, esperadoTotal.abs().mul(t.precioPct).div(100));
  difs.push({ ocRenglonId: null, tipo: "TOTAL", esperado: r2(esperadoTotal), facturado: totalFactura, dentro: dt.abs().lte(tolTotal),
    descripcion: dt.isZero() ? "El total de la factura coincide con lo recibido a precio de la orden de compra." : `Total facturado $${totalFactura.toFixed(2)} contra $${r2(esperadoTotal).toFixed(2)} esperado (diferencia $${r2(dt).toFixed(2)}).` });
  return difs;
}

/** Antigüedad de saldos al día de hoy (fechas AAAA-MM-DD). */
export function antiguedad(docs: { vencimiento: string; saldo: Dec }[], hoy: string) {
  const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  const r = { por_vencer: new D(0), d1_30: new D(0), d31_60: new D(0), d61_90: new D(0), mas_90: new D(0), total: new D(0) };
  for (const d of docs) {
    const v = dias(d.vencimiento, hoy); // días vencido (negativo o cero = aún no vence)
    const k = v <= 0 ? "por_vencer" : v <= 30 ? "d1_30" : v <= 60 ? "d31_60" : v <= 90 ? "d61_90" : "mas_90";
    r[k] = r[k].plus(d.saldo);
    r.total = r.total.plus(d.saldo);
  }
  return r;
}
