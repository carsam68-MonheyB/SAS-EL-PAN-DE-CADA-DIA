// Cálculos críticos del punto de venta: impuestos, cobro y cambio, corte y arqueo.
// Valores esperados calculados a mano.
import { describe, expect, it } from "vitest";
import { arqueo, cobrar, desglosar, efectivoEsperado, importeDevolucion, importeRenglon } from "../src/dominio/pos";
import { D } from "../src/dominio/recetas";

const d = (x: string | number) => new D(x);
const IVA16 = { tipoFactor: "Tasa" as const, tasa: "0.16" };
const IVA0 = { tipoFactor: "Tasa" as const, tasa: "0" };
const IEPS8 = { tipoFactor: "Tasa" as const, tasa: "0.08" };
const txt = (x: { base: any; ieps: any; iva: any }) => [x.base.toFixed(2), x.ieps.toFixed(2), x.iva.toFixed(2)];

describe("importe y desglose de impuestos", () => {
  it("3 conchas de $14.00 con $2.00 de descuento = $40.00", () => {
    expect(importeRenglon(d(14), d(3), d(2)).toFixed(2)).toBe("40.00");
    expect(() => importeRenglon(d(14), d(1), d(15))).toThrow();
  });

  it("pan con IVA 0 %: todo es base", () => {
    expect(txt(desglosar(d("42.00"), IVA0, null))).toEqual(["42.00", "0.00", "0.00"]);
  });

  it("$116.00 con IVA 16 % = 100.00 + 16.00", () => {
    expect(txt(desglosar(d("116.00"), IVA16, null))).toEqual(["100.00", "0.00", "16.00"]);
  });

  it("IEPS 8 % e IVA 16 % sobre base + IEPS: $125.28 = 100.00 + 8.00 + 17.28", () => {
    expect(txt(desglosar(d("125.28"), IVA16, IEPS8))).toEqual(["100.00", "8.00", "17.28"]);
  });

  it("la suma siempre cuadra al centavo aunque haya redondeo ($10.00 con IVA 16 %)", () => {
    const r = desglosar(d("10.00"), IVA16, null);
    expect(txt(r)).toEqual(["8.62", "0.00", "1.38"]);
    expect(r.base.plus(r.ieps).plus(r.iva).toFixed(2)).toBe("10.00");
  });

  it("sin tasa de IVA o con IEPS por cuota no se puede vender", () => {
    expect(() => desglosar(d(10), null, null)).toThrow(/IVA/);
    expect(() => desglosar(d(10), IVA16, { tipoFactor: "Cuota", tasa: "1" })).toThrow(/cuota/);
  });
});

describe("cobro y cambio", () => {
  it("total $47.00 pagado con un billete de $100: cambio $53.00 y se aplican $47.00 en efectivo", () => {
    const r = cobrar(d(47), [{ efectivo: true, importe: d(100) }]);
    expect(r.cambio.toFixed(2)).toBe("53.00");
    expect(r.aplicados.map((x) => x.toFixed(2))).toEqual(["47.00"]);
  });

  it("pago mixto: $30 con tarjeta y $50 en efectivo para $47 → cambio $33, efectivo aplicado $17", () => {
    const r = cobrar(d(47), [{ efectivo: false, importe: d(30) }, { efectivo: true, importe: d(50) }]);
    expect(r.cambio.toFixed(2)).toBe("33.00");
    expect(r.aplicados.map((x) => x.toFixed(2))).toEqual(["30.00", "17.00"]);
  });

  it("no cobra de menos ni da cambio de una tarjeta", () => {
    expect(() => cobrar(d(47), [{ efectivo: true, importe: d(40) }])).toThrow(/Falta por cobrar \$7.00/);
    expect(() => cobrar(d(47), [{ efectivo: false, importe: d(50) }])).toThrow(/cambio/);
  });
});

describe("corte de caja", () => {
  it("fondo 500 + ventas 1,200 + ingresos 100 + anticipos 300 − retiros 1,000 − devoluciones 47 = 1,053", () => {
    expect(efectivoEsperado({ fondo: d(500), ventasEfectivo: d(1200), ingresos: d(100), anticiposEfectivo: d(300), retiros: d(1000), devolucionesEfectivo: d(47) }).toFixed(2)).toBe("1053.00");
  });

  it("arqueo: 2 de $500 + 2 de $20 + 5 de $2 + 6 de $0.50 = $1,053.00", () => {
    expect(arqueo([{ valor: d(500), cantidad: 2 }, { valor: d(20), cantidad: 2 }, { valor: d(2), cantidad: 5 }, { valor: d("0.5"), cantidad: 6 }]).toFixed(2)).toBe("1053.00");
    expect(() => arqueo([{ valor: d(1), cantidad: 1.5 }])).toThrow();
  });
});

describe("devoluciones parciales", () => {
  it("de 3 piezas por $10.00 se devuelve 1 ($3.33), luego 1 ($3.33) y la última toma el resto ($3.34)", () => {
    const a = importeDevolucion(d(10), d(3), d(1), d(0), d(0));
    const b = importeDevolucion(d(10), d(3), d(1), d(1), a);
    const c = importeDevolucion(d(10), d(3), d(1), d(2), a.plus(b));
    expect([a, b, c].map((x) => x.toFixed(2))).toEqual(["3.33", "3.33", "3.34"]);
    expect(() => importeDevolucion(d(10), d(3), d(2), d(2), d("6.66"))).toThrow(/Solo quedan 1/);
  });
});
