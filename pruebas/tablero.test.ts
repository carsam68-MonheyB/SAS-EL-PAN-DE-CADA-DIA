// Tablero y reportes de gestión (4.10) contra Postgres real: ventas por día,
// hora, sucursal, cajero, SKU y familia (neto de devoluciones), margen por SKU,
// mermas, rotación, compras y variación de precios; permisos por módulo y
// alcance; exportación a Excel. Datos FICTICIOS.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prepararInventarios, type Entorno } from "./inventarios-apoyo";

let e: Entorno;
let hoy: string;
const ENC = { usuario: "prueba.enc", pin: "4826" };
const caj = () => e.nav.caj!;
const q = (extra = "") => `desde=${hoy}&hasta=${hoy}${extra}`;

beforeAll(async () => {
  e = await prepararInventarios("erp_prueba_tablero");
  const { cargar, nav } = e;
  await cargar("con", "causas_merma", "fase-3/29-causas-merma.txt");
  for (const [r, l, f] of [["jpr", "etapas", "19-etapas.txt"], ["jpr", "turnos", "20-turnos.txt"], ["con", "tarifas_mod", "21-tarifas-mano-de-obra.txt"], ["con", "tasas_gif", "22-tasas-gif.txt"],
    ["jpr", "recetas_intermedios", "23-recetas-masas.txt"], ["jpr", "formulas_intermedios", "24-formulas-masas.txt"], ["jpr", "recetas_sku", "25-recetas-productos.txt"],
    ["jpr", "componentes_sku", "26-componentes-productos.txt"], ["jpr", "etapas_receta", "27-etapas-por-receta.txt"]] as const) await cargar(r, l, `fase-2/${f}`);
  for (const k of ["PRUEBA-MASA-DULCE", "PRUEBA-COBERTURA", "PRUEBA-MASA-BLANCA", "PRUEBA-CONCHA-V", "PRUEBA-CONCHA-C", "PRUEBA-BOLILLO", "PRUEBA-TELERA"]) {
    expect((await nav.jpr!.post(`/api/recetas/${k}/1/activar`)).estado).toBe(200);
  }
  for (const f of ["fase-3/31-inventario-inicial.txt", "fase-6/32-inventario-inicial-sucursal.txt"]) {
    const c = await cargar("jpr", "inventario_inicial", f);
    expect((await nav.con!.post(`/api/cargas/${c.id}/autorizar`)).estado).toBe(200);
  }
  hoy = (await e.pool.query("SELECT (now() AT TIME ZONE 'America/Mexico_City')::date::text AS h")).rows[0].h;
  // Las recetas de ejemplo rigen desde 2027: el costeo se calcula a esa fecha (el reporte usa el último guardado).
  const k = await nav.con!.post("/api/costos/costeos", { fecha: "2099-01-01", comentario: "PRUEBA" });
  expect(k.estado, JSON.stringify(k.datos)).toBe(200);
  await e.pool.query(
    `INSERT INTO precio_venta (articulo_id, sucursal_id, precio, vigente_desde)
     SELECT a.id, NULL, x.precio, $1::date FROM (VALUES ('PRUEBA-CONCHA-V', 14.00), ('PRUEBA-CONCHA-C', 15.00), ('PRUEBA-BOLILLO', 3.00)) AS x(art, precio) JOIN articulo a ON a.clave = x.art`,
    [hoy],
  );
  for (const [rol, pin] of [["caj", "4821"], ["enc", ENC.pin]] as const) expect((await nav[rol]!.post("/api/auth/mi-pin", { password: e.password, pin })).estado).toBe(200);
  const est = await caj().get("/api/pos/estado");
  await caj().post("/api/auth/caja", { caja_id: est.datos.cajas[0].id });
  await caj().post("/api/pos/turno", { fondo: "500" });
  const v1 = await caj().post("/api/pos/ventas", { id: randomUUID(), renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "3" }, { articulo: "PRUEBA-BOLILLO", cantidad: "10" }], pagos: [{ forma: "01", importe: "100" }] });
  expect(v1.estado, JSON.stringify(v1.datos)).toBe(200);
  expect((await caj().post("/api/pos/ventas", { id: randomUUID(), renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "2" }], pagos: [{ forma: "04", importe: "28", referencia: "AUT-1" }] })).estado).toBe(200);
  expect((await caj().post("/api/pos/devoluciones", { venta: v1.datos.folio, motivo: "PRUEBA", regresa_inventario: true, renglones: [{ orden: 1, cantidad: "1" }], autorizacion: ENC })).estado).toBe(200);
  // Merma de 5 conchas de chocolate en la sucursal ($5.10 c/u) y compras de harina a dos precios.
  const m = await nav.enc!.post("/api/inventarios/mermas", { almacen: "PT-SUC1", causa: "PRUEBA-NO-VENDIDO", renglones: [{ articulo: "PRUEBA-CONCHA-C", cantidad: "5" }] });
  expect((await nav.con!.post(`/api/inventarios/mermas/${m.datos.id}/autorizar`)).estado).toBe(200);
  for (const [cant, costo] of [["2", "450"], ["1", "500"]]) {
    const r = await nav.alm!.post("/api/inventarios/compras", { almacen: "MP-MAT", proveedor: "PRUEBA-PROV-01", referencia: `PRUEBA-${costo}`, renglones: [{ articulo: "PRUEBA-HAR-01", cantidad: cant, unidad: "BULTO", costo_unitario: costo, lote: `PRUEBA-HAR-${costo}`, caducidad: "2027-04-30" }] });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
  }
}, 300_000);

describe("ventas (neto de devoluciones)", () => {
  it("por SKU: 4 conchas $56 y 10 bolillos $30; 2 tickets, total $86", async () => {
    const r = await e.nav.con!.get(`/api/tablero/ventas?${q("&por=sku")}`);
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.filas.map((x: any) => [x.clave, x.cantidad, x.venta, x.tickets])).toEqual([["PRUEBA-CONCHA-V", "4", "56.00", 2], ["PRUEBA-BOLILLO", "10", "30.00", 1]]);
    expect(r.datos.totales).toMatchObject({ tickets: 2, venta: "86.00", ticket_promedio: "43.00" });
  });

  it("por día, hora, sucursal, cajero y familia", async () => {
    for (const [por, clave] of [["dia", hoy], ["sucursal", "SUC1"], ["cajero", "prueba.caj"]]) {
      const r = await e.nav.con!.get(`/api/tablero/ventas?${q(`&por=${por}`)}`);
      expect(r.datos.filas.map((x: any) => [x.clave, x.venta, x.tickets])).toEqual([[clave, "86.00", 2]]);
    }
    const h = await e.nav.con!.get(`/api/tablero/ventas?${q("&por=hora")}`);
    expect(h.datos.filas).toHaveLength(1);
    expect(h.datos.filas[0].clave).toMatch(/^\d{2}$/);
    const f = await e.nav.con!.get(`/api/tablero/ventas?${q("&por=familia")}`);
    expect(f.datos.filas.map((x: any) => [x.clave, x.venta])).toEqual([["PRUEBA-PAN-DULCE", "56.00"], ["PRUEBA-PAN-BLANCO", "30.00"]]);
    expect((await e.nav.con!.get(`/api/tablero/ventas?${q("&por=planeta")}`)).estado).toBe(400);
  });
});

describe("margen por SKU", () => {
  it("contra el costo real del kárdex (concha $4.80) y el estándar del último costeo", async () => {
    const r = await e.nav.con!.get(`/api/tablero/margen?${q()}`);
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    const concha = r.datos.filas.find((x: any) => x.sku === "PRUEBA-CONCHA-V");
    expect(concha).toMatchObject({ cantidad: "4", venta_sin_impuestos: "56.00", costo_real: "19.20", margen_real: "36.80", margen_real_pct: "65.71" });
    expect(concha.costo_estandar_unitario).not.toBeNull();
    expect(Number(concha.margen_estandar)).toBeCloseTo(56 - Number(concha.costo_estandar), 2);
    expect(r.datos.totales).toMatchObject({ venta_sin_impuestos: "86.00", costo_real: "34.20", margen_real: "51.80" });
  });
});

describe("mermas, rotación y compras", () => {
  it("mermas por SKU y causa: 5 conchas de chocolate no vendidas = $25.50", async () => {
    const r = await e.nav.con!.get(`/api/tablero/mermas?${q()}`);
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.filas.map((x: any) => [x.origen, x.sku, x.causa, x.cantidad, x.valor])).toEqual([["Inventario", "PRUEBA-CONCHA-C", "PRUEBA-NO-VENDIDO", "5", "25.50"]]);
    expect(r.datos.total).toBe("25.50");
  });

  it("rotación de producto terminado: concha de vainilla en SUC1, inicial 0, final 46, salen 5 en 1 día: rota 0.22 veces, 4.6 días", async () => {
    const r = await e.nav.con!.get(`/api/tablero/rotacion?${q("&grupo=PT")}`);
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    const x = r.datos.filas.find((f: any) => f.almacen === "PT-SUC1" && f.sku === "PRUEBA-CONCHA-V");
    expect(x).toMatchObject({ inicial_cantidad: "0", final_cantidad: "46", salidas_cantidad: "5", rotacion: "0.22", dias: "4.6" });
    expect(r.datos.totales.map((t: any) => t.almacen)).toEqual(["PT-MAT", "PT-SUC1"]);
  });

  it("compras por proveedor y variación del precio de la harina: $18 → $20 por kg (+11.11 %)", async () => {
    const r = await e.nav.com!.get(`/api/tablero/compras?${q()}`);
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.proveedores).toEqual([expect.objectContaining({ proveedor: "PRUEBA-PROV-01", importe: "1400.00", entradas: 2, participacion: "100.00" })]);
    expect(r.datos.insumos[0]).toMatchObject({ clave: "PRUEBA-HAR-01", compras: 2, primero: "18.0000", ultimo: "20.0000", promedio: "18.6667", variacion_pct: "11.11" });
  });
});

describe("permisos: cada quien ve los reportes de sus módulos y su alcance", () => {
  it("compras no ve ventas ni márgenes; producción no ve compras; el cajero no ve el tablero", async () => {
    expect((await e.nav.com!.get(`/api/tablero/ventas?${q()}`)).estado).toBe(403);
    expect((await e.nav.com!.get(`/api/tablero/margen?${q()}`)).estado).toBe(403);
    expect((await e.nav.jpr!.get(`/api/tablero/compras?${q()}`)).estado).toBe(403);
    expect((await e.nav.jpr!.get(`/api/tablero/margen?${q()}`)).estado).toBe(200);
    expect((await caj().get(`/api/tablero/resumen?${q()}`)).estado).toBe(403);
  });

  it("el encargado ve ventas y mermas de su sucursal, sin costos ni márgenes, y no exporta", async () => {
    const enc = e.nav.enc!;
    expect((await enc.get(`/api/tablero/ventas?${q()}`)).datos.totales.venta).toBe("86.00");
    expect((await enc.get(`/api/tablero/margen?${q()}`)).estado).toBe(403);
    const m = await enc.get(`/api/tablero/mermas?${q()}`);
    expect(m.datos.filas[0]).toMatchObject({ cantidad: "5", valor: null });
    const r = await enc.get(`/api/tablero/rotacion?${q("&grupo=PT")}`);
    expect(r.datos.filas.every((x: any) => x.almacen === "PT-SUC1" && x.final_valor === null)).toBe(true);
    expect((await enc.get(`/api/tablero/ventas?${q("&formato=xlsx")}`)).estado).toBe(403);
    const o = await enc.get("/api/tablero/opciones");
    expect(o.datos.visibles).toMatchObject({ ventas: true, margen: false, compras: false, mermas: true, exportar: false });
  });

  it("el contralor exporta a Excel; el resumen junta ventas, margen, mermas y compras", async () => {
    for (const r of ["ventas?por=sku", "margen", "mermas", "rotacion?grupo=MP", "compras"]) {
      const x = await e.nav.con!.get(`/api/tablero/${r}${r.includes("?") ? "&" : "?"}${q("&formato=xlsx")}`);
      expect(x.estado, r).toBe(200);
    }
    const s = await e.nav.con!.get(`/api/tablero/resumen?${q()}`);
    expect(s.datos.ventas).toMatchObject({ venta: "86.00", tickets: 2 });
    expect(s.datos.margen).toMatchObject({ margen_real: "51.80" });
    expect(s.datos.mermas.total).toBe("25.50");
    expect(s.datos.compras).toMatchObject({ total: "1400.00", alzas: [expect.objectContaining({ clave: "PRUEBA-HAR-01" })] });
  });
});
