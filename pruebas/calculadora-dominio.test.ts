// Calculadora de costo por minuto de mano de obra y de tasa de gastos indirectos (P35, P36).
import { describe, expect, it } from "vitest";
import { costoMinutoMod, tasaGif } from "../src/dominio/calculadora";

describe("costo por minuto de mano de obra", () => {
  it("nómina 24,000 + 35 % de carga, 2 personas × 26 días × 480 min × 85 % → 32,400 ÷ 21,216 min", () => {
    const r = costoMinutoMod({ nomina_mensual: "24000", carga_social_pct: "35", personas: "2", dias_mes: "26", minutos_jornada: "480", aprovechamiento_pct: "85" });
    expect(r.costo_mensual.toFixed()).toBe("32400");
    expect(r.minutos_productivos.toFixed()).toBe("21216");
    expect(r.costo_minuto.toDecimalPlaces(6).toFixed()).toBe("1.527149");
  });

  it("sin carga social y 100 % de aprovechamiento es nómina ÷ minutos (exacto, sin redondeos binarios)", () => {
    const r = costoMinutoMod({ nomina_mensual: "0.3", carga_social_pct: "0", personas: "1", dias_mes: "1", minutos_jornada: "3", aprovechamiento_pct: "100" });
    expect(r.costo_minuto.toFixed()).toBe("0.1");
  });

  it("rechaza ceros, negativos y aprovechamiento mayor que 100 %", () => {
    const base = { nomina_mensual: "1000", carga_social_pct: "30", personas: "1", dias_mes: "26", minutos_jornada: "480", aprovechamiento_pct: "85" };
    expect(() => costoMinutoMod({ ...base, personas: "0" })).toThrow(/personas/);
    expect(() => costoMinutoMod({ ...base, minutos_jornada: "0" })).toThrow(/minutos/);
    expect(() => costoMinutoMod({ ...base, carga_social_pct: "-1" })).toThrow(/negativo/);
    expect(() => costoMinutoMod({ ...base, aprovechamiento_pct: "101" })).toThrow(/100/);
  });
});

describe("tasa de gastos indirectos", () => {
  it("gas 9,000 + luz 3,000 = 12,000 ÷ 5,000 kg de masa → 2.40 por kg", () => {
    const r = tasaGif({ gastos: [{ concepto: "Gas", importe_mensual: "9000" }, { concepto: "Luz", importe_mensual: "3000" }], cantidad_base_mensual: "5000" });
    expect(r.total_gastos.toFixed()).toBe("12000");
    expect(r.tasa.toFixed()).toBe("2.4");
  });

  it("suma decimales exactos (0.1 + 0.2 = 0.3)", () => {
    expect(tasaGif({ gastos: [{ concepto: "a", importe_mensual: "0.1" }, { concepto: "b", importe_mensual: "0.2" }], cantidad_base_mensual: "1" }).tasa.toFixed()).toBe("0.3");
  });

  it("pide al menos un gasto y una base mayor que cero", () => {
    expect(() => tasaGif({ gastos: [], cantidad_base_mensual: "1" })).toThrow();
    expect(() => tasaGif({ gastos: [{ concepto: "a", importe_mensual: "1" }], cantidad_base_mensual: "0" })).toThrow(/base/);
  });
});
