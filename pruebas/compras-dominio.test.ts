// Cálculos de compras: importes de OC, cotejo a 3 vías, antigüedad de saldos y
// lectura del XML del proveedor. Valores esperados calculados a mano.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { antiguedad, cotejar, importeOC } from "../src/dominio/compras";
import { D } from "../src/dominio/recetas";
import { leerCfdi } from "../src/servidor/cfdi";

const d = (x: string | number) => new D(x);
const TOL = { cantidadPct: d(0), precioPct: d(1), importe: d(1) };
const R = [{ id: "r1", descripcion: "Harina", precio: d(450), tasaIva: d(0), porFacturar: d(4) }, { id: "r2", descripcion: "Bolsa", precio: d("0.35"), tasaIva: d("0.16"), porFacturar: d(1000) }];
const C = (r: string | null, cantidad: string, vu: string, iva = "0") => ({ orden: 1, descripcion: "x", ocRenglonId: r, cantidad: d(cantidad), valorUnitario: d(vu), importe: d(cantidad).mul(vu).toDecimalPlaces(2), descuento: d(0), iva: d(iva) });

describe("importes de OC", () => {
  it("4 bultos a $450 con IVA 0 % = $1,800; 1,000 bolsas a $0.35 con IVA 16 % = $350 + $56", () => {
    expect(importeOC(d(4), d(450), d(0))).toEqual({ importe: d(1800), iva: d(0) });
    const b = importeOC(d(1000), d("0.35"), d("0.16"));
    expect([b.importe.toFixed(2), b.iva.toFixed(2)]).toEqual(["350.00", "56.00"]);
  });
});

describe("cotejo a 3 vías", () => {
  it("factura igual a lo recibido y a la OC: todo dentro de tolerancia", () => {
    const difs = cotejar(R, [C("r1", "4", "450"), C("r2", "1000", "0.35", "56")], d(2206), TOL);
    expect(difs.every((x) => x.dentro)).toBe(true);
  });

  it("precio de $470 contra $450 (4.4 %) queda fuera de la tolerancia de 1 %; también el total", () => {
    const difs = cotejar(R, [C("r1", "4", "470")], d(1880), TOL);
    expect(difs.find((x) => x.tipo === "PRECIO")!.dentro).toBe(false);
    expect(difs.find((x) => x.tipo === "TOTAL")).toMatchObject({ dentro: false });
    expect(difs.find((x) => x.tipo === "CANTIDAD")!.dentro).toBe(true);
  });

  it("facturar más de lo recibido, IVA mal calculado o un concepto sin relación se marcan", () => {
    const difs = cotejar(R, [C("r1", "5", "450"), C("r2", "1000", "0.35", "60"), C(null, "1", "10")], d(2310), TOL);
    expect(difs.find((x) => x.tipo === "CANTIDAD" && x.ocRenglonId === "r1")!.dentro).toBe(false);
    expect(difs.find((x) => x.tipo === "IMPUESTO" && x.ocRenglonId === "r2")!.dentro).toBe(false);
    expect(difs.some((x) => x.tipo === "SIN_RELACION" && !x.dentro)).toBe(true);
  });

  it("un centavo de redondeo en el total cabe en la tolerancia de $1", () => {
    expect(cotejar(R, [C("r1", "4", "450")], d("1800.01"), TOL).find((x) => x.tipo === "TOTAL")!.dentro).toBe(true);
  });
});

describe("antigüedad de saldos", () => {
  it("clasifica por días vencidos al 22/11/2026", () => {
    const r = antiguedad([
      { vencimiento: "2026-11-30", saldo: d(100) }, { vencimiento: "2026-11-22", saldo: d(1) },
      { vencimiento: "2026-11-01", saldo: d(200) }, { vencimiento: "2026-10-01", saldo: d(300) },
      { vencimiento: "2026-09-01", saldo: d(400) }, { vencimiento: "2026-06-01", saldo: d(500) },
    ], "2026-11-22");
    expect(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.toNumber()]))).toEqual({ por_vencer: 101, d1_30: 200, d31_60: 300, d61_90: 400, mas_90: 500, total: 1501 });
  });
});

describe("lectura del XML (CFDI)", () => {
  it("extrae emisor, UUID, totales y conceptos del ejemplo ficticio", () => {
    const c = leerCfdi(readFileSync("datos-ejemplo/fase-4/41-factura-PRUEBA-harina.xml", "utf8"));
    expect(c).toMatchObject({ version: "4.0", uuid: "00000000-0000-4000-8000-000000000001", emisorRfc: "XAXX010101000", tipo: "I", metodoPago: "PPD" });
    expect(c.total.toFixed(2)).toBe("1800.00");
    expect(c.conceptos).toHaveLength(1);
    expect(c.conceptos[0]).toMatchObject({ noIdentificacion: "HAR-25" });
    expect(c.conceptos[0]!.cantidad.toFixed()).toBe("4");
  });

  it("rechaza DOCTYPE/ENTITY, XML sin timbre y archivos que no son CFDI", () => {
    expect(() => leerCfdi('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x/>')).toThrow(/no permitidas/);
    const sinTimbre = readFileSync("datos-ejemplo/fase-4/41-factura-PRUEBA-harina.xml", "utf8").replace(/<cfdi:Complemento>.*<\/cfdi:Complemento>/s, "");
    expect(() => leerCfdi(sinTimbre)).toThrow(/timbrado/);
    expect(() => leerCfdi("<hola/>")).toThrow(/no es un CFDI/);
    expect(() => leerCfdi("no es xml <<<")).toThrow();
  });
});
