// Cálculos del tablero (4.10) hechos a mano: margen, rotación y días de
// inventario, y variación de precios de compra.
import { describe, expect, it } from "vitest";
import { D } from "../src/dominio/recetas";
import { agrupar, margen, rotacion, variacionPrecio } from "../src/dominio/tablero";

const d = (x: string | number) => new D(x);

describe("margen", () => {
  it("venta $56 − costo $19.20 = $36.80 (65.71 %); sin venta no hay %", () => {
    const m = margen(d(56), d("19.2"));
    expect([m.margen.toFixed(2), m.pct!.toFixed(2)]).toEqual(["36.80", "65.71"]);
    expect(margen(d(0), d(5)).pct).toBeNull();
  });
});

describe("rotación y días de inventario", () => {
  it("inicial 100 y final 60 (promedio 80), salen 240 en 30 días: rota 3 veces, 10 días de inventario", () => {
    const r = rotacion(d(100), d(60), d(240), 30);
    expect([r.promedio.toFixed(), r.rotacion!.toFixed(), r.dias!.toFixed()]).toEqual(["80", "3", "10"]);
  });
  it("sin salidas no rota (0) y no hay días; sin inventario pero con salidas no se puede calcular", () => {
    expect(rotacion(d(10), d(10), d(0), 7)).toMatchObject({ dias: null });
    expect(rotacion(d(10), d(10), d(0), 7).rotacion!.toFixed()).toBe("0");
    expect(rotacion(d(0), d(0), d(5), 7)).toMatchObject({ rotacion: null, dias: null });
    expect(() => rotacion(d(1), d(1), d(1), 0)).toThrow();
  });
});

describe("variación de precios de compra", () => {
  it("harina: 50 kg a $18 y luego 25 kg a $20 → promedio $18.6667 y +11.11 %", () => {
    const v = variacionPrecio([{ fecha: "2026-11-20", cantidad: d(25), costoUnitario: d(20) }, { fecha: "2026-11-02", cantidad: d(50), costoUnitario: d(18) }])!;
    expect([v.compras, v.importe.toFixed(), v.promedio.toFixed(4), v.primero.toFixed(), v.ultimo.toFixed(), v.minimo.toFixed(), v.maximo.toFixed(), v.variacionPct!.toFixed(2)])
      .toEqual([2, "1400", "18.6667", "18", "20", "18", "20", "11.11"]);
  });
  it("sin compras no hay variación; precio inicial en cero no da %", () => {
    expect(variacionPrecio([])).toBeNull();
    expect(variacionPrecio([{ fecha: "2026-11-01", cantidad: d(1), costoUnitario: d(0) }, { fecha: "2026-11-02", cantidad: d(1), costoUnitario: d(1) }])!.variacionPct).toBeNull();
  });
});

describe("agrupar", () => {
  it("suma por clave y cuenta registros", () => {
    const g = agrupar([{ k: "a", v: d(1) }, { k: "b", v: d(2) }, { k: "a", v: d(3) }], (x) => x.k, ["v"]);
    expect([...g.entries()].map(([k, x]) => [k, x.v!.toFixed(), x.n])).toEqual([["a", "4", 2], ["b", "2", 1]]);
  });
});
