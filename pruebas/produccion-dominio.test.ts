// Cálculos de producción: estándar de la orden, costo real, balance de masa y
// piezas, variaciones y estado de costo de producción y ventas. Valores
// esperados calculados a mano.
import { describe, expect, it } from "vitest";
import { balanceOrden, costoOrden, estadoCostos, estandarN1, estandarN2, variacionTotal } from "../src/dominio/produccion";
import { D, type RecetaN1, type RecetaN2 } from "../src/dominio/recetas";

const d = (x: string | number) => new D(x);
const s = (x: InstanceType<typeof D> | null | undefined, dp = 6) => (x === null || x === undefined ? null : x.toDecimalPlaces(dp).toFixed());

// Masa blanca: lote de 15 kg harina + 9 kg agua + 0.3 kg sal + 0.15 kg levadura = 24.45 kg; rinde 24 kg.
const BLANCA: RecetaN1 = {
  clave: "MASA", version: 1, rendimiento: d(24), regla: "COMPLETO", capacidad: null,
  componentes: [
    { clave: "HAR", tipo: "INSUMO", cantidad: d(15), mermaPct: d(0) },
    { clave: "AGU", tipo: "INSUMO", cantidad: d(9), mermaPct: d(0) },
    { clave: "SAL", tipo: "INSUMO", cantidad: d("0.3"), mermaPct: d(0) },
    { clave: "LEV", tipo: "INSUMO", cantidad: d("0.15"), mermaPct: d(0) },
  ],
  etapas: [{ etapa: "AMASADO", minutos: d(25), base: "LOTE" }],
};
// Bolillo: 80 g de masa por pieza, merma de formado 2 %, 60 piezas por lote, 12 min de formado por lote.
const BOLILLO: RecetaN2 = {
  clave: "BOL", version: 1, mermaFormadoPct: d(2), mermaHorneadoPct: d(0), piezasPorLote: d(60),
  componentes: [{ clave: "MASA", tipo: "MASA", cantidad: d("0.08"), mermaPct: d(0) }],
  etapas: [{ etapa: "FORMADO", minutos: d(12), base: "LOTE" }],
};
// Concha: 60 g masa, 15 g cubierta, 1 bolsa; merma de horneado 4 %; 0.5 min de formado por pieza.
const CONCHA: RecetaN2 = {
  clave: "CON", version: 1, mermaFormadoPct: d(0), mermaHorneadoPct: d(4), piezasPorLote: null,
  componentes: [
    { clave: "DULCE", tipo: "MASA", cantidad: d("0.06"), mermaPct: d(0) },
    { clave: "CUB", tipo: "INTERMEDIO", cantidad: d("0.015"), mermaPct: d(0) },
    { clave: "BOLSA", tipo: "EMPAQUE", cantidad: d(1), mermaPct: d(0) },
  ],
  etapas: [{ etapa: "FORMADO", minutos: d("0.5"), base: "PIEZA" }],
};

describe("estándar de una orden", () => {
  it("N1: 48 kg de masa blanca = 2 lotes → 30 kg de harina, 18 de agua y 50 minutos de amasado", () => {
    const e = estandarN1(BLANCA, d(48), "DIVIDIR");
    expect(s(e.lotes)).toBe("2");
    expect(e.componentes.map((c) => [c.clave, s(c.cantidad)])).toEqual([["HAR", "30"], ["AGU", "18"], ["SAL", "0.6"], ["LEV", "0.3"]]);
    expect(s(e.etapas[0]!.minutos)).toBe("50");
  });

  it("N1 con lotes dados (regla de lote completo): 40 kg planeados con 2 lotes consumen como 2 lotes", () => {
    const e = estandarN1(BLANCA, d(40), "DIVIDIR", d(2));
    expect(s(e.componentes[0]!.cantidad)).toBe("30");
  });

  it("N2: 490 bolillos = 490 × 80 g ÷ 0.98 = 40 kg de masa; formado 490 ÷ 60 × 12 = 98 minutos", () => {
    const e = estandarN2(BOLILLO, d(490), "DIVIDIR");
    expect(s(e.componentes[0]!.cantidad)).toBe("40");
    expect(s(e.formadas)).toBe("490");
    expect(s(e.etapas[0]!.minutos)).toBe("98");
  });

  it("N2 con merma de horneado: 240 conchas buenas = 250 formadas; masa sobre formadas y bolsa sobre buenas", () => {
    const e = estandarN2(CONCHA, d(240), "DIVIDIR");
    expect(s(e.formadas)).toBe("250");
    expect(e.componentes.map((c) => [c.clave, s(c.cantidad)])).toEqual([["DULCE", "15"], ["CUB", "3.75"], ["BOLSA", "240"]]);
    expect(s(e.etapas[0]!.minutos)).toBe("125");
  });
});

describe("costo real", () => {
  const tasas = { tarifas: new Map([["AMASADO", d("2.5")], ["FORMADO", d(2)]]), gif: new Map([["KG_MASA", d("1.5")], ["MINUTO_MOD", d("0.1")], ["PIEZA", d("0.05")]] as const) };

  it("N1: $600 de materiales + 50 min × $2.50 + GIF (48 kg × $1.50 + 50 min × $0.10) = $802; $16.7083 por kg", () => {
    const c = costoOrden({ nivel: "N1", cantidad: d(48), formadas: null, materiales: d(600), etapas: [{ etapa: "AMASADO", minutos: d(50) }] }, tasas);
    expect([s(c.mp), s(c.mod), s(c.gif), s(c.total), s(c.unitario, 4)]).toEqual(["600", "125", "77", "802", "16.7083"]);
    expect(c.faltantes).toEqual([]);
  });

  it("N2: GIF por pieza sobre piezas formadas (250) y por minuto; una etapa sin tarifa se reporta", () => {
    const c = costoOrden({ nivel: "N2", cantidad: d(240), formadas: d(250), materiales: d(500), etapas: [{ etapa: "FORMADO", minutos: d(125) }, { etapa: "HORNEADO", minutos: d(50) }] }, tasas);
    // MOD 125 × 2 = 250; GIF 175 min × 0.10 = 17.5 + 250 × 0.05 = 12.5
    expect([s(c.mod), s(c.gif), s(c.total)]).toEqual(["250", "30", "780"]);
    expect(c.faltantes).toEqual(["etapa HORNEADO sin tarifa de mano de obra"]);
    expect(s(c.unitario, 4)).toBe("3.25");
  });

  it("variación total contra el estándar de lo producido", () => {
    const v = variacionTotal(d(802), d(16), d(48));
    expect([s(v.estandar), s(v.diferencia), s(v.pct, 4)]).toEqual(["768", "34", "4.4271"]);
    expect(variacionTotal(d(802), null, d(48)).diferencia).toBeNull();
  });
});

describe("balance de masa y piezas", () => {
  const TOL = { masaPct: d(3), piezasPct: d(5), consumoPct: d(5) };

  it("bolillo: 41 kg de masa para 490 piezas (estándar 40): 2.5 % dentro de 3 %; las 41 kg debían rendir 502.25 piezas", () => {
    const b = balanceOrden({
      nivel: "N2", buenas: d(490), formadas: d(490), mermaAvance: d(0), tolerancias: TOL,
      componentes: [{ clave: "MASA", tipo: "MASA", estandar: d(40), real: d(41), importeReal: d(700), costoEstandar: d(16), esMasa: true }],
    });
    expect(b.masa!.dentro).toBe(true);
    expect(s(b.masa!.pct, 2)).toBe("2.5");
    expect(s(b.piezas!.esperadas)).toBe("502.25");
    expect(b.piezas!.dentro).toBe(true); // −2.44 %
    // Variación: cantidad (41 − 40) × 16 = 16; precio 700 − 41 × 16 = 44
    expect([s(b.consumos[0]!.variacionCantidad), s(b.consumos[0]!.variacionPrecio), s(b.consumos[0]!.importeEstandar)]).toEqual(["16", "44", "640"]);
    expect(b.fuera).toEqual([]);
  });

  it("fuera de tolerancia: 44 kg de masa (10 %), consumo de cubierta 20 % arriba y piezas sin explicar", () => {
    const b = balanceOrden({
      nivel: "N2", buenas: d(240), formadas: d(250), mermaAvance: d(6), tolerancias: TOL,
      componentes: [
        { clave: "DULCE", tipo: "MASA", estandar: d(15), real: d("16.5"), importeReal: d(300), costoEstandar: d(18), esMasa: true },
        { clave: "CUB", tipo: "INTERMEDIO", estandar: d("3.75"), real: d("4.5"), importeReal: d(100), costoEstandar: null, esMasa: false },
      ],
    });
    expect(b.masa!.dentro).toBe(false);
    expect(b.fuera.join(" | ")).toMatch(/Balance de masa.*16\.5.*15/);
    expect(b.fuera.join(" | ")).toMatch(/CUB: se consumió 4\.5 contra 3\.75/);
    expect(b.fuera.join(" | ")).toMatch(/faltan 4/);
    expect(b.consumos[1]!.variacionCantidad).toBeNull();
    // 16.5 kg debían rendir 264 piezas; salieron 240 (−9.09 %)
    expect(s(b.piezas!.esperadas)).toBe("264");
    expect(b.piezas!.dentro).toBe(false);
  });

  it("N1: sin balance de piezas; un estándar en cero con consumo real queda fuera", () => {
    const b = balanceOrden({
      nivel: "N1", buenas: d(24), formadas: null, mermaAvance: d(0), tolerancias: TOL,
      componentes: [{ clave: "HAR", tipo: "INSUMO", estandar: d(0), real: d(1), importeReal: d(18), costoEstandar: d(18), esMasa: true }],
    });
    expect(b.piezas).toBeNull();
    expect(b.consumos[0]!.dentro).toBe(false);
    expect(b.consumos[0]!.pct).toBeNull();
  });
});

describe("estado de costo de producción y ventas", () => {
  it("un día: compras 1,000; surtido 600; masa 600 → 802; bolillo consume 700 de masa y entra a 780; ventas 500", () => {
    const g = {
      MP: { inicial: d(3000), final: d(3400), tipos: new Map([["ENTRADA_COMPRA", d(1000)], ["SURTIDO_SALIDA", d(-600)]]) },
      // PEP: entra surtido 600, entra masa 802, sale consumo de masa 600 (N1) y 700 (N2), merma de 20
      PEP: { inicial: d(100), final: d(182), tipos: new Map([["SURTIDO_ENTRADA", d(600)], ["ENTRADA_PRODUCCION", d(802)], ["CONSUMO_PRODUCCION", d(-1300)], ["MERMA", d(-20)]]) },
      PT: { inicial: d(200), final: d(450), tipos: new Map([["ENTRADA_PRODUCCION", d(780)], ["VENTA", d(-500)], ["DEVOLUCION_VENTA", d(10)], ["MERMA", d(-40)]]) },
    };
    // Valor agregado = 802 + 780 − 1,300 = 282 = MOD + GIF (202 de la masa + 80 del bolillo)
    const e = estadoCostos(g, { mod: d(200), gif: d(82) });
    expect(e.comprobaciones.map((c) => s(c.diferencia))).toEqual(["0", "0", "0"]);
    expect([s(e.totales.surtido), s(e.totales.costoProduccion), s(e.totales.terminada), s(e.totales.costoVentas)]).toEqual(["600", "882", "780", "490"]);
    expect(e.lineas.some((l) => l.concepto.includes("sin orden"))).toBe(false);
  });

  it("la carga inicial de producto terminado va en su propia línea, no como merma o ajuste", () => {
    const vacio = { inicial: d(0), final: d(0), tipos: new Map<string, InstanceType<typeof D>>() };
    const e = estadoCostos({ MP: vacio, PEP: vacio, PT: { inicial: d(0), final: d(400), tipos: new Map([["INICIAL", d(438)], ["VENTA", d(-38)]]) } }, { mod: d(0), gif: d(0) });
    expect(s(e.lineas.find((l) => l.concepto.includes("Carga de inventario inicial de producto"))!.importe)).toBe("438");
    expect(s(e.lineas.find((l) => l.concepto.includes("traspasos de producto terminado"))!.importe)).toBe("0");
    expect(s(e.totales.costoVentas)).toBe("38");
    expect(e.comprobaciones.map((c) => s(c.diferencia))).toEqual(["0", "0", "0"]);
  });

  it("una entrada de producción sin orden aparece en su propia línea", () => {
    const vacio = { inicial: d(0), final: d(0), tipos: new Map<string, InstanceType<typeof D>>() };
    const e = estadoCostos({ MP: vacio, PEP: vacio, PT: { inicial: d(0), final: d(48), tipos: new Map([["ENTRADA_PRODUCCION", d(48)]]) } }, { mod: d(0), gif: d(0) });
    expect(s(e.lineas.find((l) => l.concepto.includes("sin orden"))!.importe)).toBe("48");
    expect(e.comprobaciones.map((c) => s(c.diferencia))).toEqual(["0", "0", "0"]);
  });
});
