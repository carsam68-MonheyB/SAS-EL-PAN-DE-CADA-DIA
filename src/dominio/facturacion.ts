// Cálculos de facturación (críticos, con pruebas): importe neto de un ticket
// después de devoluciones, conceptos para capturar en el portal del SAT
// (factura individual y global diaria), impuestos agrupados por tasa, forma de
// pago que se declara y cotejo del XML descargado contra sus tickets.
// Aritmética decimal exacta; importes a centavos.
import { D, type Dec } from "./recetas";

const r2 = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP);
const cero = () => new D(0);

/** RFC genérico del SAT para la factura global (público en general). */
export const RFC_PUBLICO_GENERAL = "XAXX010101000";
export const RFC_EXTRANJERO = "XEXX010101000";
/** Claves que pide el SAT en cada concepto de la factura global. */
export const GLOBAL_CLAVE_PROD_SERV = "01010101";
export const GLOBAL_CLAVE_UNIDAD = "ACT";

export interface RenglonTicket {
  articulo: string; descripcion: string; cantidad: Dec; importe: Dec; base: Dec; ieps: Dec; iva: Dec;
  tasaIva: Dec | null; tasaIeps: Dec | null; devuelto: Dec; // importe devuelto de este renglón
  claveProdServ?: string | null; claveUnidad?: string | null; unidad?: string | null; objetoImp?: string | null; cantidadDevuelta?: Dec;
}
export interface Neto { base: Dec; ieps: Dec; iva: Dec; total: Dec }

/**
 * Lo que queda de un renglón después de devoluciones. Los impuestos bajan en la
 * misma proporción que el importe (a centavos) y la base absorbe el redondeo,
 * así base + IEPS + IVA = importe neto siempre.
 */
export function netoRenglon(r: RenglonTicket): Neto {
  if (r.devuelto.lt(0) || r.devuelto.gt(r.importe)) throw new Error("El importe devuelto no es válido.");
  const total = r.importe.minus(r.devuelto);
  if (r.devuelto.isZero()) return { base: r.base, ieps: r.ieps, iva: r.iva, total };
  if (total.isZero()) return { base: cero(), ieps: cero(), iva: cero(), total };
  const f = total.div(r.importe);
  const ieps = r2(r.ieps.mul(f));
  const iva = r2(r.iva.mul(f));
  return { base: total.minus(ieps).minus(iva), ieps, iva, total };
}

export function sumar(xs: Neto[]): Neto {
  return xs.reduce((s, x) => ({ base: s.base.plus(x.base), ieps: s.ieps.plus(x.ieps), iva: s.iva.plus(x.iva), total: s.total.plus(x.total) }),
    { base: cero(), ieps: cero(), iva: cero(), total: cero() });
}

export const netoTicket = (rs: RenglonTicket[]) => sumar(rs.map(netoRenglon));

export interface Traslado { impuesto: "IVA" | "IEPS"; tasa: Dec; base: Dec; importe: Dec }
export interface ConceptoPortal {
  claveProdServ: string | null; noIdentificacion: string; cantidad: Dec; claveUnidad: string | null; unidad: string | null; descripcion: string;
  valorUnitario: Dec; importe: Dec; objetoImp: string | null; traslados: Traslado[];
}

/** Traslados de un importe neto: el IEPS sobre la base; el IVA sobre la base más el IEPS. */
function traslados(n: Neto, tasaIva: Dec | null, tasaIeps: Dec | null): Traslado[] {
  const t: Traslado[] = [];
  if (tasaIeps) t.push({ impuesto: "IEPS", tasa: tasaIeps, base: n.base, importe: n.ieps });
  if (tasaIva) t.push({ impuesto: "IVA", tasa: tasaIva, base: n.base.plus(n.ieps), importe: n.iva });
  return t;
}

/** Factura individual: un concepto por renglón del ticket (lo neto de devoluciones). */
export function conceptosNominativa(rs: RenglonTicket[]): ConceptoPortal[] {
  return rs.flatMap((r) => {
    const n = netoRenglon(r);
    if (n.total.isZero()) return [];
    const cantidad = r.cantidadDevuelta && r.cantidadDevuelta.gt(0) ? r.cantidad.minus(r.cantidadDevuelta) : r.cantidad;
    const cant = cantidad.gt(0) ? cantidad : r.cantidad;
    return [{
      claveProdServ: r.claveProdServ ?? null, noIdentificacion: r.articulo, cantidad: cant, claveUnidad: r.claveUnidad ?? null, unidad: r.unidad ?? null,
      descripcion: r.descripcion, valorUnitario: n.base.div(cant).toDecimalPlaces(6, D.ROUND_HALF_UP), importe: n.base, objetoImp: r.objetoImp ?? null,
      traslados: traslados(n, r.tasaIva, r.tasaIeps),
    }];
  });
}

/** Partes de un ticket con la misma combinación de tasas (un ticket puede mezclar tasas). */
function porTasa(rs: RenglonTicket[]) {
  const m = new Map<string, { tasaIva: Dec | null; tasaIeps: Dec | null; netos: Neto[] }>();
  for (const r of rs) {
    const k = `${r.tasaIva?.toFixed(6) ?? "-"}|${r.tasaIeps?.toFixed(6) ?? "-"}`;
    if (!m.has(k)) m.set(k, { tasaIva: r.tasaIva, tasaIeps: r.tasaIeps, netos: [] });
    m.get(k)!.netos.push(netoRenglon(r));
  }
  return [...m.values()].map((g) => ({ tasaIva: g.tasaIva, tasaIeps: g.tasaIeps, neto: sumar(g.netos) }));
}

/**
 * Factura global: un concepto por ticket (por cada combinación de tasas del ticket),
 * con el folio del ticket como número de identificación, clave 01010101 y unidad ACT.
 */
export function conceptosGlobal(tickets: { folio: string; renglones: RenglonTicket[] }[]): ConceptoPortal[] {
  return tickets.flatMap((t) => porTasa(t.renglones).filter((g) => g.neto.total.gt(0)).map((g) => ({
    claveProdServ: GLOBAL_CLAVE_PROD_SERV, noIdentificacion: t.folio, cantidad: new D(1), claveUnidad: GLOBAL_CLAVE_UNIDAD, unidad: null, descripcion: "Venta",
    valorUnitario: g.neto.base, importe: g.neto.base, objetoImp: "02", traslados: traslados(g.neto, g.tasaIva, g.tasaIeps),
  })));
}

/** Resumen de impuestos por tasa, como lo pide el apartado de impuestos del comprobante. */
export function resumenImpuestos(conceptos: ConceptoPortal[]) {
  const m = new Map<string, Traslado>();
  for (const t of conceptos.flatMap((c) => c.traslados)) {
    const k = `${t.impuesto}|${t.tasa.toFixed(6)}`;
    const a = m.get(k);
    m.set(k, a ? { ...a, base: a.base.plus(t.base), importe: a.importe.plus(t.importe) } : { ...t });
  }
  return [...m.values()].sort((a, b) => a.impuesto.localeCompare(b.impuesto) || a.tasa.comparedTo(b.tasa));
}

/**
 * Forma de pago que se declara: si se pagó con varias, la de mayor importe
 * (en empate, la primera en el orden de la caja).
 */
export function formaPagoPredominante(pagos: { clave: string; importe: Dec }[]): string | null {
  const m = new Map<string, Dec>();
  for (const p of pagos) m.set(p.clave, (m.get(p.clave) ?? cero()).plus(p.importe));
  let mejor: [string, Dec] | null = null;
  for (const e of m) if (!mejor || e[1].gt(mejor[1])) mejor = e;
  return mejor?.[0] ?? null;
}

export interface Diferencia { campo: string; esperado: Dec; factura: Dec }
/** Compara los importes de la factura con los de sus tickets; diferencias de más de la tolerancia. */
export function cotejar(esperado: Neto, factura: { subtotal: Dec; descuento: Dec; iva: Dec; ieps: Dec; total: Dec }, tolerancia: Dec): Diferencia[] {
  const pares: [string, Dec, Dec][] = [
    ["Subtotal (sin impuestos)", esperado.base, factura.subtotal.minus(factura.descuento)],
    ["IVA", esperado.iva, factura.iva],
    ["IEPS", esperado.ieps, factura.ieps],
    ["Total", esperado.total, factura.total],
  ];
  return pares.filter(([, e, f]) => e.minus(f).abs().gt(tolerancia)).map(([campo, e, f]) => ({ campo, esperado: e, factura: f }));
}

/** Días transcurridos entre dos fechas AAAA-MM-DD. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}
