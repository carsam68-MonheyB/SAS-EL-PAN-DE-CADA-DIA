// Cálculos contables: partidas desde conceptos con reglas por sucursal, redondeo
// que cuadra, balanza con acumulación a mayor y estados financieros. A mano.
import { describe, expect, it } from "vitest";
import { armarPartidas, balanceGeneral, balanza, cuentaDe, estadoResultados, folioPoliza, rubroDe } from "../src/dominio/contabilidad";
import { D } from "../src/dominio/recetas";

const d = (x: string | number) => new D(x);
const L = (concepto: string, importe: string, sucursalId: string | null = null) => ({ concepto, importe: d(importe), sucursalId, texto: concepto });
const REGLAS = [
  { concepto: "CAJA_EFECTIVO", sucursalId: null, cuentaId: "caja-general" },
  { concepto: "CAJA_EFECTIVO", sucursalId: "suc1", cuentaId: "caja-suc1" },
  { concepto: "VENTAS", sucursalId: null, cuentaId: "ventas" },
  { concepto: "IVA_TRASLADADO", sucursalId: null, cuentaId: "iva" },
  { concepto: "INV_MP", sucursalId: null, cuentaId: "inv-mp" },
  { concepto: "INV_PEP", sucursalId: null, cuentaId: "inv-pep" },
];

describe("reglas y partidas", () => {
  it("la regla de la sucursal gana a la general", () => {
    expect(cuentaDe(REGLAS, "CAJA_EFECTIVO", "suc1")).toBe("caja-suc1");
    expect(cuentaDe(REGLAS, "CAJA_EFECTIVO", "mat")).toBe("caja-general");
    expect(cuentaDe(REGLAS, "BANCOS", null)).toBeNull();
  });

  it("venta de $116 en efectivo en SUC1: caja 116 / ventas 100 / IVA 16; junta líneas de la misma cuenta", () => {
    const r = armarPartidas([L("CAJA_EFECTIVO", "100", "suc1"), L("CAJA_EFECTIVO", "16", "suc1"), L("VENTAS", "-100", "suc1"), L("IVA_TRASLADADO", "-16", "suc1")], REGLAS);
    if ("faltan" in r) throw new Error("faltan reglas");
    expect(r.partidas.map((p) => [p.cuentaId, p.cargo.toFixed(2), p.abono.toFixed(2)])).toEqual([["caja-suc1", "116.00", "0.00"], ["ventas", "0.00", "100.00"], ["iva", "0.00", "16.00"]]);
    expect(r.total.toFixed(2)).toBe("116.00");
  });

  it("sin regla para un concepto no se arma la póliza y dice cuál falta", () => {
    expect(armarPartidas([L("BANCOS", "10"), L("VENTAS", "-10")], REGLAS)).toEqual({ faltan: ["BANCOS"] });
  });

  it("redondeo: importes de inventario con 6 decimales siempre cuadran a centavos", () => {
    // 3 surtidos de 1.333333: suben a 1.33 cada uno (3.99) contra 4.00 (redondeo de 3.999999)
    const r = armarPartidas([L("INV_PEP", "1.333333"), L("INV_PEP", "1.333333"), L("INV_PEP", "1.333334"), L("INV_MP", "-4")], REGLAS);
    if ("faltan" in r) throw new Error("faltan reglas");
    const c = r.partidas.reduce((s, p) => s.plus(p.cargo), d(0));
    const a = r.partidas.reduce((s, p) => s.plus(p.abono), d(0));
    expect([c.toFixed(2), a.toFixed(2)]).toEqual(["4.00", "4.00"]);
    const r2 = armarPartidas([L("INV_PEP", "0.004"), L("INV_PEP", "0.004"), L("INV_MP", "-0.008")], REGLAS);
    if ("faltan" in r2) throw new Error("faltan reglas");
    // 0.008 → 0.01 de abono; el cargo junto (0.008) también sube a 0.01
    expect(r2.partidas.map((p) => [p.cargo.toFixed(2), p.abono.toFixed(2)])).toEqual([["0.01", "0.00"], ["0.00", "0.01"]]);
  });

  it("líneas que no cuadran son un error de programación", () => {
    expect(() => armarPartidas([L("VENTAS", "10")], REGLAS)).toThrow(/no cuadran/);
  });

  it("folio por tipo, ejercicio y mes", () => {
    expect(folioPoliza("D", 2026, 11, 7)).toBe("D-202611-0007");
  });
});

const C = (id: string, clave: string, nivel: number, naturaleza: "DEUDORA" | "ACREEDORA", padre: string | null, agrupador: string | null = null) =>
  ({ id, clave, nombre: clave, nivel, naturaleza, padre, afectable: nivel > 1, agrupador });
const CUENTAS = [
  C("caja", "1101", 1, "DEUDORA", null, "101"), C("caja-mat", "1101-01", 2, "DEUDORA", "1101", "101.01"), C("caja-suc", "1101-02", 2, "DEUDORA", "1101", "101.01"),
  C("ventas", "4101", 1, "ACREEDORA", null, "401"), C("ventas-pan", "4101-01", 2, "ACREEDORA", "4101", "401.01"),
  C("capital", "3101", 1, "ACREEDORA", null, "301"), C("capital-s", "3101-01", 2, "ACREEDORA", "3101", "301.01"),
  C("costo", "5101", 1, "DEUDORA", null, "501"), C("costo-pan", "5101-01", 2, "DEUDORA", "5101", "501.01"),
];

describe("balanza de comprobación", () => {
  it("saldo inicial, cargos, abonos y final; las cuentas de mayor suman a sus subcuentas y la balanza cuadra", () => {
    const b = balanza(CUENTAS, [
      { cuentaId: "caja-mat", anteriorCargo: d(1000), anteriorAbono: d(0), cargos: d(500), abonos: d(200) },
      { cuentaId: "caja-suc", anteriorCargo: d(0), anteriorAbono: d(0), cargos: d(300), abonos: d(0) },
      { cuentaId: "capital-s", anteriorCargo: d(0), anteriorAbono: d(1000), cargos: d(0), abonos: d(0) },
      { cuentaId: "ventas-pan", anteriorCargo: d(0), anteriorAbono: d(0), cargos: d(0), abonos: d(800) },
      { cuentaId: "costo-pan", anteriorCargo: d(0), anteriorAbono: d(0), cargos: d(200), abonos: d(0) },
    ]);
    const caja = b.renglones.find((r) => r.clave === "1101")!;
    expect([caja.inicial, caja.cargos, caja.abonos, caja.final].map((x) => x.toFixed())).toEqual(["1000", "800", "200", "1600"]);
    expect(b.renglones.find((r) => r.clave === "4101")!.final.toFixed()).toBe("800");
    expect([b.totales.cargos.toFixed(), b.totales.abonos.toFixed(), b.cuadra]).toEqual(["1000", "1000", true]);
  });
});

describe("estados financieros", () => {
  it("rubro por el código agrupador (o la cuenta)", () => {
    expect([rubroDe("101.01", "x"), rubroDe(null, "4101"), rubroDe("701", "x"), rubroDe("801", "x")]).toEqual(["ACTIVO", "INGRESOS", "OTROS", "ORDEN"]);
  });

  it("estado de resultados: ventas 800 − costo 200 = 600; balance: caja 1,600 = capital 1,000 + resultado 600", () => {
    const saldos = [
      { clave: "1101-01", nombre: "Caja", agrupador: "101.01", cargos: d(1800), abonos: d(200) },
      { clave: "3101-01", nombre: "Capital", agrupador: "301.01", cargos: d(0), abonos: d(1000) },
      { clave: "4101-01", nombre: "Ventas", agrupador: "401.01", cargos: d(0), abonos: d(800) },
      { clave: "5101-01", nombre: "Costo", agrupador: "501.01", cargos: d(200), abonos: d(0) },
    ];
    const er = estadoResultados(saldos);
    expect([er.totales.ingresos, er.totales.costos, er.totales.utilidadBruta, er.totales.neta].map((x) => x.toFixed())).toEqual(["800", "200", "600", "600"]);
    const bg = balanceGeneral(saldos, er.totales.neta);
    expect([bg.totales.activo.toFixed(), bg.totales.capital.toFixed(), bg.anteriores.toFixed(), bg.cuadra]).toEqual(["1600", "1600", "0", true]);
    // Si 200 de la utilidad son de un ejercicio anterior, aparecen como resultados anteriores.
    expect(balanceGeneral(saldos, d(400)).anteriores.toFixed()).toBe("200");
  });
});
