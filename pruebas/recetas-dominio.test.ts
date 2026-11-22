// Cálculos críticos de la Fase 2: % panadero, mermas, ciclos, explosión,
// lotes, requerimiento neto, piezas que alcanzan y costo estándar en cadena.
// Los valores esperados están calculados a mano (ver comentarios).
import { describe, expect, it } from "vitest";
import {
  D, buscarCiclo, cantidadesPorPctPanadero, costear, explotar, factorMerma, margen, normalizarReceta, ordenTopologico, precioSinImpuestos,
  type ComponenteNormal, type FilaComponente, type FilaEncabezado, type RecetaN1, type RecetaN2, type Recetas,
} from "../src/dominio/recetas";

const d = (x: string | number) => new D(x);
const comp = (clave: string, tipo: ComponenteNormal["tipo"], cantidad: string, mermaPct = "0"): ComponenteNormal => ({ clave, tipo, cantidad: d(cantidad), mermaPct: d(mermaPct) });
const n1 = (clave: string, rendimiento: string, regla: "COMPLETO" | "EXACTO", componentes: ComponenteNormal[], extra: Partial<RecetaN1> = {}): RecetaN1 => ({ clave, version: 1, rendimiento: d(rendimiento), regla, capacidad: null, componentes, etapas: [], ...extra });
const n2 = (clave: string, componentes: ComponenteNormal[], extra: Partial<RecetaN2> = {}): RecetaN2 => ({ clave, version: 1, mermaFormadoPct: d(0), mermaHorneadoPct: d(0), piezasPorLote: null, componentes, etapas: [], ...extra });
const recetas = (a: RecetaN1[], b: RecetaN2[]): Recetas => ({ n1: new Map(a.map((r) => [r.clave, r])), n2: new Map(b.map((r) => [r.clave, r])) });
const txt = (x: { toFixed(): string }) => x.toFixed();

// Masa M: lote de 10 kg con 6 kg de harina y 1.5 kg de azúcar.
// SKU S: 60 g (0.06 kg) de masa por pieza y 1 bolsa.
const M = n1("M", "10", "COMPLETO", [comp("HARINA", "INSUMO", "6"), comp("AZUCAR", "INSUMO", "1.5")]);
const S = n2("S", [comp("M", "MASA", "0.06"), comp("BOLSA", "EMPAQUE", "1")]);

describe("merma y % panadero", () => {
  it("DIVIDIR: 100 g con 10 % de merma = 111.11… g; MULTIPLICAR: 110 g", () => {
    expect(d(100).mul(factorMerma(10, "DIVIDIR")).toDecimalPlaces(4).toFixed()).toBe("111.1111");
    expect(d(100).mul(factorMerma(10, "MULTIPLICAR")).toFixed()).toBe("110");
    expect(factorMerma(0, "DIVIDIR").toFixed()).toBe("1");
    expect(() => factorMerma(100, "DIVIDIR")).toThrow();
  });

  it("lote de 10 kg con harina 100 %, agua 60 %, azúcar 40 % → 5, 3 y 2 kg", () => {
    expect(cantidadesPorPctPanadero("10", ["100", "60", "40"]).map(txt)).toEqual(["5", "3", "2"]);
  });

  it("los ingredientes en % panadero suman exactamente el tamaño del lote", () => {
    const q = cantidadesPorPctPanadero("10", ["100", "60", "2", "1"]);
    expect(q.reduce((s, x) => s.plus(x), d(0)).toDecimalPlaces(20).toFixed()).toBe("10");
    expect(q[1]!.div(q[0]!).toDecimalPlaces(20).toFixed()).toBe("0.6");
  });
});

describe("ciclos", () => {
  it("detecta una receta que se usa a sí misma, directa o indirectamente", () => {
    expect(buscarCiclo(new Map([["A", ["A"]]]))).toEqual(["A", "A"]);
    expect(buscarCiclo(new Map([["A", ["B"]], ["B", ["C"]], ["C", ["A"]]]))).toEqual(["A", "B", "C", "A"]);
    expect(buscarCiclo(new Map([["A", ["B", "C"]], ["B", ["C"]], ["C", []]]))).toBeNull();
  });

  it("orden topológico: cada intermedio antes que los que usa", () => {
    const orden = ordenTopologico(new Map([["MASA", ["MADRE"]], ["MADRE", []], ["OTRA", ["MADRE"]]]));
    expect(orden.indexOf("MASA")).toBeLessThan(orden.indexOf("MADRE"));
    expect(orden.indexOf("OTRA")).toBeLessThan(orden.indexOf("MADRE"));
    expect(() => ordenTopologico(new Map([["A", ["B"]], ["B", ["A"]]]))).toThrow(/circular/);
  });
});

describe("normalización de recetas", () => {
  const kgG = [{ de: "KG", a: "G", factor: "1000" }];
  const unidadesKg: FilaComponente["unidades"] = { base: "KG", propias: [] };
  const enc = (extra: Partial<FilaEncabezado>): FilaEncabezado => ({ clave: "M", version: 1, nivel: "N1", unidadBase: "KG", captura: "CANTIDAD", tamanoLote: null, rendimientoLote: null, mermaProcesoPct: "0", regla: "COMPLETO", capacidad: null, mermaFormadoPct: null, mermaHorneadoPct: null, piezasPorLote: null, ...extra });
  const fila = (clave: string, cantidad: string | null, unidad: string | null, pct: string | null = null, unidades = unidadesKg): FilaComponente => ({ clave, tipo: "INSUMO", cantidad, unidad, pct, mermaPct: "0", unidades });

  it("convierte gramos a kg y calcula el rendimiento con la merma de proceso", () => {
    const r = normalizarReceta(enc({ mermaProcesoPct: "2" }), [fila("HARINA", "6000", "G"), fila("AZUCAR", "1500", "G"), fila("HUEVO", "10", "PZA", null, { base: "KG", propias: [{ unidad: "PZA", factorABase: "0.05" }] })], [], kgG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.receta.componentes.map((c) => txt(c.cantidad))).toEqual(["6", "1.5", "0.5"]);
    expect(txt(r.tamanoLote!)).toBe("8");                 // 6 + 1.5 + 0.5
    expect(txt((r.receta as RecetaN1).rendimiento)).toBe("7.84"); // 8 × (1 − 0.02)
  });

  it("% panadero: usa el tamaño del lote y convierte a la unidad del componente", () => {
    const r = normalizarReceta(enc({ captura: "PCT_PANADERO", tamanoLote: "10", rendimientoLote: "9.5" }), [fila("HARINA", null, null, "100"), fila("AGUA", null, null, "60", { base: "G", propias: [] }), fila("AZUCAR", null, null, "40")], [], kgG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.receta.componentes.map((c) => txt(c.cantidad))).toEqual(["5", "3000", "2"]);
    expect(txt((r.receta as RecetaN1).rendimiento)).toBe("9.5");
  });

  it("reporta lo que impide usar la receta", () => {
    const r = normalizarReceta(enc({ regla: null }), [fila("LECHE", "1", "L")], [], kgG);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problemas.join(" ")).toMatch(/no hay conversión de L a KG/);
    expect(r.problemas.join(" ")).toMatch(/regla de lote/);
    const vacia = normalizarReceta(enc({}), [], [], kgG);
    expect(!vacia.ok && vacia.problemas[0]).toMatch(/No tiene componentes/);
  });
});

describe("explosión del plan", () => {
  it("N2 → N1 → N0 con lote completo", () => {
    // 500 piezas × 0.06 kg = 30 kg de masa → 3 lotes de 10 kg → harina 18, azúcar 4.5, 500 bolsas.
    const r = explotar({ plan: [{ sku: "S", piezas: 500 }], recetas: recetas([M], [S]), disponibles: new Map(), formula: "DIVIDIR" });
    const m = r.intermedios[0]!;
    expect([txt(m.bruto), txt(m.lotes), txt(m.producido), txt(m.sobrante)]).toEqual(["30", "3", "30", "0"]);
    expect(Object.fromEntries(r.materiales.map((x) => [x.clave, txt(x.bruto)]))).toEqual({ AZUCAR: "4.5", BOLSA: "500", HARINA: "18" });
    expect(r.problemas).toEqual([]);
  });

  it("descuenta la masa en existencia y redondea al lote completo (sobrante esperado)", () => {
    // 32 kg − 5 en existencia = 27 kg → 3 lotes = 30 kg → sobra 3 kg.
    const r = explotar({ plan: [{ sku: "S", piezas: 400 }, { sku: "S2", piezas: 400 }], recetas: recetas([M], [S, { ...S, clave: "S2", componentes: [comp("M", "MASA", "0.02")] }]), disponibles: new Map([["M", { existencia: 5 }]]), formula: "DIVIDIR" });
    const m = r.intermedios[0]!;
    expect([txt(m.bruto), txt(m.aPreparar), txt(m.lotes), txt(m.sobrante)]).toEqual(["32", "27", "3", "3"]);
    expect(m.origen.map((o) => [o.de, txt(o.cantidad)])).toEqual([["S", "24"], ["S2", "8"]]);   // masas compartidas se agrupan
    expect(txt(r.materiales.find((x) => x.clave === "HARINA")!.bruto)).toBe("18");
  });

  it("lote exacto: se prepara la cantidad justa", () => {
    // 25 kg ÷ 10 = 2.5 lotes → harina 15.
    const r = explotar({ plan: [{ sku: "S", piezas: 500 }], recetas: recetas([{ ...M, regla: "EXACTO", capacidad: d(12) }], [S]), disponibles: new Map([["M", { existencia: 5 }]]), formula: "DIVIDIR" });
    const m = r.intermedios[0]!;
    expect([txt(m.lotes), txt(m.producido), txt(m.sobrante), txt(m.amasadas!)]).toEqual(["2.5", "25", "0", "3"]); // 25 kg en amasadora de 12 → 3 amasadas
    expect(txt(r.materiales.find((x) => x.clave === "HARINA")!.bruto)).toBe("15");
  });

  it("mermas de formado, horneado y del componente (fórmula MULTIPLICAR)", () => {
    // 100 piezas buenas, horneado 5 % → 105 piezas formadas.
    // Masa: 0.05 × 105 × 1.02 (formado 2 %) = 5.355 kg. Ajonjolí: 0.002 × 105 × 1.10 = 0.231. Bolsa: 100 (piezas buenas).
    const s = n2("S", [comp("M", "MASA", "0.05"), comp("AJONJOLI", "INSUMO", "0.002", "10"), comp("BOLSA", "EMPAQUE", "1")], { mermaFormadoPct: d(2), mermaHorneadoPct: d(5) });
    const r = explotar({ plan: [{ sku: "S", piezas: 100 }], recetas: recetas([{ ...M, regla: "EXACTO" }], [s]), disponibles: new Map(), formula: "MULTIPLICAR" });
    expect(txt(r.skus[0]!.piezasFormadas)).toBe("105");
    expect(txt(r.intermedios[0]!.bruto)).toBe("5.355");
    expect(Object.fromEntries(r.materiales.filter((x) => x.clave !== "HARINA" && x.clave !== "AZUCAR").map((x) => [x.clave, txt(x.bruto)]))).toEqual({ AJONJOLI: "0.231", BOLSA: "100" });
  });

  it("intermedio dentro de otro intermedio (masa madre) y requerimiento neto", () => {
    // M usa 2 kg de masa madre MM por lote. 3 lotes de M → 6 kg de MM → EXACTO 1.5 lotes de 4 kg → harina 1.5 × 2 = 3.
    // Harina total = 18 + 3 = 21. Existencia 10 + tránsito 5 = 15 → neto 6.
    const MM = n1("MM", "4", "EXACTO", [comp("HARINA", "INSUMO", "2"), comp("AGUA", "INSUMO", "2")]);
    const Mm = { ...M, componentes: [...M.componentes, comp("MM", "INTERMEDIO", "2")] };
    const r = explotar({ plan: [{ sku: "S", piezas: 500 }], recetas: recetas([Mm, MM], [S]), disponibles: new Map([["HARINA", { existencia: 10, transito: 5 }], ["AGUA", { existencia: 99 }], ["AZUCAR", { existencia: 99 }], ["BOLSA", { existencia: 999 }]]), formula: "DIVIDIR" });
    expect(r.intermedios.map((x) => [x.clave, txt(x.bruto), txt(x.lotes)])).toEqual([["M", "30", "3"], ["MM", "6", "1.5"]]);
    const h = r.materiales.find((x) => x.clave === "HARINA")!;
    expect([txt(h.bruto), txt(h.disponible), txt(h.neto)]).toEqual(["21", "15", "6"]);
    // Faltan 6 de 21: alcanza 15/21 del plan → 500 × 15 ÷ 21 = 357.14 → 357 piezas.
    expect([txt(r.skus[0]!.alcanzan), r.skus[0]!.completo, r.skus[0]!.limitantes]).toEqual(["357", false, ["HARINA"]]);
  });

  it("solo se limita el SKU que usa el material faltante", () => {
    const T = n2("T", [comp("BOLSA", "EMPAQUE", "1")]);
    const r = explotar({ plan: [{ sku: "S", piezas: 500 }, { sku: "T", piezas: 10 }], recetas: recetas([M], [S, T]), disponibles: new Map([["HARINA", { existencia: 9 }], ["AZUCAR", { existencia: 99 }], ["BOLSA", { existencia: 1000 }]]), formula: "DIVIDIR" });
    expect(r.skus.map((x) => [x.clave, txt(x.alcanzan), x.completo])).toEqual([["S", "250", false], ["T", "10", true]]);
  });

  it("sin ruido de redondeo: 490 piezas × 80 g ÷ (1 − 2 %) = 40 kg exactos → 2 lotes de 20, no 3", () => {
    const B = n2("B", [comp("M", "MASA", "0.08")], { mermaFormadoPct: d(2) });
    const r = explotar({ plan: [{ sku: "B", piezas: 490 }], recetas: recetas([{ ...M, rendimiento: d(20) }], [B]), disponibles: new Map(), formula: "DIVIDIR" });
    expect([txt(r.intermedios[0]!.bruto), txt(r.intermedios[0]!.lotes), txt(r.intermedios[0]!.sobrante)]).toEqual(["40", "2", "0"]);
  });

  it("SKU sin receta: se reporta y no se explota", () => {
    const r = explotar({ plan: [{ sku: "X", piezas: 10 }, { sku: "S", piezas: 0 }], recetas: recetas([M], [S]), disponibles: new Map(), formula: "DIVIDIR" });
    expect(r.problemas).toEqual([{ articulo: "X", mensaje: "No tiene receta vigente en la fecha del plan." }]);
    expect(r.materiales).toEqual([]);
    expect(r.skus.map((s) => s.clave)).toEqual(["X"]);
  });
});

describe("costo estándar", () => {
  const costos = new Map<string, string | null>([["HARINA", "20"], ["AZUCAR", "30"], ["BOLSA", "0.5"]]);

  it("en cadena: insumos → masa por kg → pieza", () => {
    // Lote de M: 6 × 20 + 1.5 × 30 = 165 → 16.5 por kg. S: 0.06 × 16.5 + 0.5 = 1.49.
    const c = costear({ recetas: recetas([M], [S]), costosN0: costos, tarifas: new Map(), gif: new Map(), formula: "DIVIDIR" });
    expect(txt(c.get("M")!.total)).toBe("16.5");
    expect(txt(c.get("S")!.total)).toBe("1.49");
    expect(c.get("S")!.completo).toBe(true);
  });

  it("con mano de obra por lote y por pieza y gastos indirectos", () => {
    // M: amasado 30 min/lote × $2 = 60 → 6/kg; GIF $1 por kg de masa → 1/kg. M = 16.5 + 6 + 1 = 23.5/kg.
    // S: masa 0.06 × 23.5 = 1.41; bolsa 0.5; horneado 0.1 min/pieza × $3 = 0.3; GIF $0.05 por pieza.
    // S = 1.41 + 0.5 + 0.3 + 0.05 = 2.26.
    const m = { ...M, etapas: [{ etapa: "AMASADO", minutos: d(30), base: "LOTE" as const }] };
    const s = { ...S, etapas: [{ etapa: "HORNEADO", minutos: d("0.1"), base: "PIEZA" as const }] };
    const c = costear({ recetas: recetas([m], [s]), costosN0: costos, tarifas: new Map([["AMASADO", "2"], ["HORNEADO", "3"]]), gif: new Map([["KG_MASA", "1"], ["PIEZA", "0.05"]]), formula: "DIVIDIR" });
    const cm = c.get("M")!;
    expect([txt(cm.mp), txt(cm.mod), txt(cm.gif), txt(cm.total)]).toEqual(["16.5", "6", "1", "23.5"]);
    const cs = c.get("S")!;
    expect([txt(cs.mp), txt(cs.mod), txt(cs.gif), txt(cs.total)]).toEqual(["1.91", "0.3", "0.05", "2.26"]);
  });

  it("mano de obra por lote en un SKU se reparte entre las piezas del lote", () => {
    // 20 min por charola de 40 piezas × $3 = 60 ÷ 40 = 1.5 por pieza (más 0.99 de masa y 0.5 de bolsa).
    const s = { ...S, piezasPorLote: d(40), etapas: [{ etapa: "FORMADO", minutos: d(20), base: "LOTE" as const }] };
    const c = costear({ recetas: recetas([M], [s]), costosN0: costos, tarifas: new Map([["FORMADO", "3"]]), gif: new Map(), formula: "DIVIDIR" });
    expect(txt(c.get("S")!.mod)).toBe("1.5");
    expect(txt(c.get("S")!.total)).toBe("2.99");
  });

  it("marca el costo incompleto y dice qué falta; un cambio de costo se refleja en toda la cadena", () => {
    const sinAzucar = costear({ recetas: recetas([M], [S]), costosN0: new Map([["HARINA", "20"], ["BOLSA", "0.5"]]), tarifas: new Map(), gif: new Map(), formula: "DIVIDIR" });
    expect(sinAzucar.get("S")!.completo).toBe(false);
    expect(sinAzucar.get("S")!.faltantes).toEqual(["M › AZUCAR (sin costo)"]);
    // Harina de 20 a 25: lote 6 × 25 + 45 = 195 → 19.5/kg → S = 0.06 × 19.5 + 0.5 = 1.67.
    const caro = costear({ recetas: recetas([M], [S]), costosN0: new Map([...costos, ["HARINA", "25"]]), tarifas: new Map(), gif: new Map(), formula: "DIVIDIR" });
    expect(txt(caro.get("S")!.total)).toBe("1.67");
  });

  it("precio sin impuestos y margen", () => {
    // IVA 16 %: 116 → 100. IVA 0 % e IEPS 8 %: 10.80 → 10. IEPS por cuota: no se desglosa con %.
    expect(txt(precioSinImpuestos("116", { tipoFactor: "Tasa", tasa: "0.16" }, null)!)).toBe("100");
    expect(txt(precioSinImpuestos("10.80", { tipoFactor: "Tasa", tasa: "0" }, { tipoFactor: "Tasa", tasa: "0.08" })!)).toBe("10");
    expect(precioSinImpuestos("10", { tipoFactor: "Tasa", tasa: "0" }, { tipoFactor: "Cuota", tasa: "1" })).toBeNull();
    expect(precioSinImpuestos("10", null, null)).toBeNull();
    const m = margen(d(10), d("2.26"));
    expect([txt(m.importe), txt(m.pct!)]).toEqual(["7.74", "77.4"]);
  });
});
