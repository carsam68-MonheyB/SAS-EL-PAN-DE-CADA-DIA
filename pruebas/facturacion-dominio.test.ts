// Cálculos de facturación hechos a mano: neto de devoluciones, conceptos para el
// portal del SAT (individual y global), impuestos por tasa, forma de pago y cotejo.
import { describe, expect, it } from "vitest";
import {
  conceptosGlobal, conceptosNominativa, cotejar, diasEntre, formaPagoPredominante, netoRenglon, netoTicket, resumenImpuestos, type RenglonTicket,
} from "../src/dominio/facturacion";
import { leerCfdi } from "../src/servidor/cfdi";
import { xmlDePrueba } from "../src/servidor/facturacion";
import { D } from "../src/dominio/recetas";

const d = (x: string | number) => new D(x);
// Concha $14.00 con IVA 16 %: base 12.07 + IVA 1.93. Bolillo $3.00 al 0 %.
const R = (o: Omit<Partial<RenglonTicket>, "importe" | "base" | "iva"> & { importe: string; base: string; iva: string }): RenglonTicket => ({
  articulo: "PRUEBA-X", descripcion: "PRUEBA", cantidad: d(1), ieps: d(0), tasaIva: d("0.16"), tasaIeps: null, devuelto: d(0),
  ...o, importe: d(o.importe), base: d(o.base), iva: d(o.iva),
});
const conchas = R({ articulo: "PRUEBA-CONCHA", descripcion: "Concha", cantidad: d(3), importe: "42.00", base: "36.21", iva: "5.79", claveProdServ: "50181900", claveUnidad: "H87", objetoImp: "02" });
const bolillos = R({ articulo: "PRUEBA-BOLILLO", descripcion: "Bolillo", cantidad: d(10), importe: "30.00", base: "30.00", iva: "0.00", tasaIva: d(0), claveProdServ: "50181900", claveUnidad: "H87", objetoImp: "02" });

describe("neto de devoluciones", () => {
  it("sin devolución queda igual", () => {
    expect(netoRenglon(conchas)).toEqual({ base: d("36.21"), ieps: d(0), iva: d("5.79"), total: d("42.00") });
  });

  it("devuelve 1 de 3 conchas ($14): queda $28 = 24.14 + IVA 3.86 (el IVA baja en proporción)", () => {
    const n = netoRenglon({ ...conchas, devuelto: d(14), cantidadDevuelta: d(1) });
    expect([n.base, n.iva, n.total].map((x) => x.toFixed(2))).toEqual(["24.14", "3.86", "28.00"]);
  });

  it("devolución completa: todo en cero; más de lo vendido es un error", () => {
    expect(netoRenglon({ ...conchas, devuelto: d(42) }).total.toFixed(2)).toBe("0.00");
    expect(() => netoRenglon({ ...conchas, devuelto: d(43) })).toThrow();
  });

  it("ticket: suma de renglones", () => {
    const t = netoTicket([conchas, bolillos]);
    expect([t.base, t.iva, t.total].map((x) => x.toFixed(2))).toEqual(["66.21", "5.79", "72.00"]);
  });
});

describe("conceptos para el portal", () => {
  it("individual: un concepto por renglón con valor unitario sin IVA y su traslado", () => {
    const c = conceptosNominativa([{ ...conchas, devuelto: d(14), cantidadDevuelta: d(1) }, bolillos]);
    expect(c.map((x) => [x.noIdentificacion, x.cantidad.toFixed(), x.valorUnitario.toFixed(), x.importe.toFixed(2)])).toEqual([
      ["PRUEBA-CONCHA", "2", "12.07", "24.14"], ["PRUEBA-BOLILLO", "10", "3", "30.00"],
    ]);
    expect(c[0]!.traslados.map((t) => [t.impuesto, t.tasa.toFixed(2), t.base.toFixed(2), t.importe.toFixed(2)])).toEqual([["IVA", "0.16", "24.14", "3.86"]]);
  });

  it("individual: un renglón devuelto completo no se factura", () => {
    expect(conceptosNominativa([{ ...conchas, devuelto: d(42), cantidadDevuelta: d(3) }, bolillos]).map((x) => x.noIdentificacion)).toEqual(["PRUEBA-BOLILLO"]);
  });

  it("global: un concepto por ticket y tasa, con el folio, clave 01010101 y unidad ACT", () => {
    const c = conceptosGlobal([{ folio: "T-1", renglones: [conchas, bolillos] }, { folio: "T-2", renglones: [bolillos] }, { folio: "T-3", renglones: [{ ...bolillos, devuelto: d(30) }] }]);
    expect(c.map((x) => [x.noIdentificacion, x.claveProdServ, x.claveUnidad, x.cantidad.toFixed(), x.importe.toFixed(2), x.traslados[0]!.tasa.toFixed(2)])).toEqual([
      ["T-1", "01010101", "ACT", "1", "36.21", "0.16"], ["T-1", "01010101", "ACT", "1", "30.00", "0.00"], ["T-2", "01010101", "ACT", "1", "30.00", "0.00"],
    ]);
    const imp = resumenImpuestos(c);
    expect(imp.map((t) => [t.impuesto, t.tasa.toFixed(2), t.base.toFixed(2), t.importe.toFixed(2)])).toEqual([["IVA", "0.00", "60.00", "0.00"], ["IVA", "0.16", "36.21", "5.79"]]);
  });

  it("con IEPS: el IVA se calcula sobre la base más el IEPS", () => {
    const r = R({ importe: "116.00", base: "92.59", iva: "16.00", ieps: d("7.41"), tasaIeps: d("0.08") });
    const [c] = conceptosNominativa([r]);
    expect(c!.traslados.map((t) => [t.impuesto, t.base.toFixed(2), t.importe.toFixed(2)])).toEqual([["IEPS", "92.59", "7.41"], ["IVA", "100.00", "16.00"]]);
  });
});

describe("forma de pago y cotejo", () => {
  it("se declara la forma con mayor importe (sumando todas sus partes)", () => {
    expect(formaPagoPredominante([{ clave: "01", importe: d(30) }, { clave: "04", importe: d(40) }, { clave: "01", importe: d(20) }])).toBe("01");
    expect(formaPagoPredominante([{ clave: "28", importe: d(10) }, { clave: "01", importe: d(10) }])).toBe("28");
    expect(formaPagoPredominante([])).toBeNull();
  });

  it("cotejo: dentro de la tolerancia no hay diferencias; fuera dice cuál", () => {
    const e = { base: d("66.21"), ieps: d(0), iva: d("5.79"), total: d("72.00") };
    expect(cotejar(e, { subtotal: d("66.20"), descuento: d(0), iva: d("5.80"), ieps: d(0), total: d("72.00") }, d("0.10"))).toEqual([]);
    expect(cotejar(e, { subtotal: d("70"), descuento: d(0), iva: d("5.79"), ieps: d(0), total: d("75.79") }, d("0.10")).map((x) => x.campo)).toEqual(["Subtotal (sin impuestos)", "Total"]);
  });

  it("días entre fechas", () => {
    expect([diasEntre("2026-11-22", "2026-11-22"), diasEntre("2026-11-30", "2026-12-01"), diasEntre("2026-02-28", "2026-03-01")]).toEqual([0, 1, 1]);
  });
});

describe("XML de prueba", () => {
  it("el XML que genera el sistema para ensayar se lee igual que uno del portal (con información global)", () => {
    const conceptos = conceptosGlobal([{ folio: "T-1", renglones: [conchas, bolillos] }]).map((x) => ({
      clave_prod_serv: x.claveProdServ, no_identificacion: x.noIdentificacion, cantidad: x.cantidad.toFixed(), clave_unidad: x.claveUnidad, unidad: null, descripcion: x.descripcion,
      valor_unitario: x.valorUnitario.toFixed(), importe: x.importe.toFixed(2), objeto_imp: x.objetoImp,
      traslados: x.traslados.map((t) => ({ impuesto: t.impuesto, tasa: t.tasa.toFixed(6), base: t.base.toFixed(2), importe: t.importe.toFixed(2) })),
    }));
    const xml = xmlDePrueba({ emisorRfc: "EKU9003173C9", tipo: "I", fecha: "2026-11-22T20:00:00", formaPago: "01", conceptos, informacionGlobal: { periodicidad: "01", meses: "11", anio: 2026 },
      receptor: { rfc: "XAXX010101000", nombre: "PUBLICO EN GENERAL", regimen: "616", cp: "00000", uso: "S01" } });
    const c = leerCfdi(xml);
    expect([c.total.toFixed(2), c.subtotal.toFixed(2), c.iva.toFixed(2), c.receptorRfc, c.usoCfdi]).toEqual(["72.00", "66.21", "5.79", "XAXX010101000", "S01"]);
    expect(c.informacionGlobal).toEqual({ periodicidad: "01", meses: "11", anio: 2026 });
    expect(c.conceptos.map((x) => x.noIdentificacion)).toEqual(["T-1", "T-1"]);
  });
});
