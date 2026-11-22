// Valuación de inventarios: costo promedio, PEPS y lotes por caducidad (FEFO).
// Valores esperados calculados a mano.
import { describe, expect, it } from "vitest";
import { asignarLotes, costoUnitario, FaltaExistencia, importeEntrada, salidaPeps, salidaPromedio, type Capa } from "../src/dominio/inventarios";
import { D } from "../src/dominio/recetas";

const d = (x: string | number) => new D(x);

describe("costo promedio", () => {
  it("10 kg a $10 + 10 kg a $20 = 20 kg por $300 (promedio $15); salen 5 kg → $75", () => {
    const valor = importeEntrada(d(10), d(10)).plus(importeEntrada(d(10), d(20)));
    expect(valor.toFixed()).toBe("300");
    expect(salidaPromedio({ cantidad: d(20), valor }, d(5)).toFixed()).toBe("75");
  });

  it("3 kg por $10: sale 1 kg → $3.333333 y al sacar el resto se toma el valor restante exacto (sin centavos huérfanos)", () => {
    const s1 = salidaPromedio({ cantidad: d(3), valor: d(10) }, d(1));
    expect(s1.toFixed()).toBe("3.333333");
    const s2 = salidaPromedio({ cantidad: d(2), valor: d(10).minus(s1) }, d(2));
    expect(s1.plus(s2).toFixed()).toBe("10");
  });

  it("no permite sacar más de lo que hay", () => {
    expect(() => salidaPromedio({ cantidad: d(2), valor: d(10) }, d("2.000001"))).toThrow(FaltaExistencia);
  });

  it("costo unitario del kárdex = importe ÷ cantidad", () => {
    expect(costoUnitario(d("-75"), d("-5")).toFixed()).toBe("15");
  });
});

describe("PEPS", () => {
  const capas: Capa[] = [
    { id: "a", cantidad: d(10), valor: d(100) },  // 10 kg a $10
    { id: "b", cantidad: d(10), valor: d(200) },  // 10 kg a $20
  ];

  it("salen 15 kg: 10 de la capa más antigua ($100) y 5 de la siguiente ($100) = $200", () => {
    const r = salidaPeps(capas, d(15));
    expect(r.importe.toFixed()).toBe("200");
    expect(r.consumos.map((c) => [c.id, c.cantidad.toFixed(), c.importe.toFixed()])).toEqual([["a", "10", "100"], ["b", "5", "100"]]);
  });

  it("salir todo da exactamente la suma de las capas", () => {
    expect(salidaPeps([{ id: "x", cantidad: d(3), valor: d(10) }, { id: "y", cantidad: d(1), valor: d("0.01") }], d(4)).importe.toFixed()).toBe("10.01");
  });

  it("salta capas agotadas y rechaza si no alcanza", () => {
    expect(salidaPeps([{ id: "z", cantidad: d(0), valor: d(0) }, ...capas], d(1)).consumos[0]!.id).toBe("a");
    expect(() => salidaPeps(capas, d(21))).toThrow(FaltaExistencia);
  });
});

describe("lotes por caducidad (FEFO)", () => {
  const lotes = [
    { id: "L3", cantidad: d(5), caducidad: null, orden: 1 },
    { id: "L2", cantidad: d(5), caducidad: "2099-02-01", orden: 2 },
    { id: "L1", cantidad: d(5), caducidad: "2099-01-15", orden: 3 },
  ];

  it("sale primero lo que caduca antes; los lotes sin caducidad al final", () => {
    expect(asignarLotes(lotes, d(12)).map((x) => [x.lote_id, x.cantidad.toFixed()])).toEqual([["L1", "5"], ["L2", "5"], ["L3", "2"]]);
  });

  it("con la misma caducidad sale primero el más antiguo", () => {
    const r = asignarLotes([{ id: "B", cantidad: d(1), caducidad: "2099-01-01", orden: 2 }, { id: "A", cantidad: d(1), caducidad: "2099-01-01", orden: 1 }], d(1));
    expect(r[0]!.lote_id).toBe("A");
  });

  it("rechaza si los lotes no alcanzan", () => {
    expect(() => asignarLotes(lotes, d(16))).toThrow(FaltaExistencia);
  });
});
