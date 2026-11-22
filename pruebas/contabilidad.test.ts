// Fase 7 de punta a punta contra Postgres real: catálogo y reglas por layout,
// pólizas automáticas de inventario y punto de venta (una sola vez por documento),
// pendientes por falta de regla, pólizas manuales con autorización y
// segregación, balanza, auxiliar, estados financieros, conciliación del
// inventario contra el kárdex y cierre de periodo. Datos FICTICIOS.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prepararInventarios, type Entorno } from "./inventarios-apoyo";

let e: Entorno;
let hoy: string;
const caj = () => e.nav.caj!;

beforeAll(async () => {
  e = await prepararInventarios("erp_prueba_contabilidad");
  hoy = (await e.pool.query("SELECT (now() AT TIME ZONE 'America/Mexico_City')::date::text AS h")).rows[0].h;
  for (const archivo of ["fase-3/31-inventario-inicial.txt", "fase-6/32-inventario-inicial-sucursal.txt"]) {
    const c = await e.cargar("jpr", "inventario_inicial", archivo);
    expect((await e.nav.con!.post(`/api/cargas/${c.id}/autorizar`)).estado).toBe(200);
  }
  await e.pool.query(
    `INSERT INTO precio_venta (articulo_id, sucursal_id, precio, vigente_desde)
     SELECT a.id, NULL, x.precio, (now() AT TIME ZONE 'America/Mexico_City')::date
       FROM (VALUES ('PRUEBA-CONCHA-V', 14.00), ('PRUEBA-BOLILLO', 3.00)) AS x(art, precio) JOIN articulo a ON a.clave = x.art`,
  );
  // Una venta en efectivo y una con tarjeta en la Sucursal 1.
  const est = await caj().get("/api/pos/estado");
  await caj().post("/api/auth/caja", { caja_id: est.datos.cajas[0].id });
  expect((await caj().post("/api/pos/turno", { fondo: "500" })).estado).toBe(200);
  const v1 = await caj().post("/api/pos/ventas", { id: randomUUID(), renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "3" }, { articulo: "PRUEBA-BOLILLO", cantidad: "10" }], pagos: [{ forma: "01", importe: "100" }] });
  expect(v1.estado, JSON.stringify(v1.datos)).toBe(200);
  const v2 = await caj().post("/api/pos/ventas", { id: randomUUID(), renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "2" }], pagos: [{ forma: "04", importe: "28", referencia: "AUT-1" }] });
  expect(v2.estado, JSON.stringify(v2.datos)).toBe(200);
  // Surtido a producción.
  const s = await e.nav.alm!.post("/api/inventarios/surtidos", { origen: "MP-MAT", destino: "PEP-MAT", renglones: [{ articulo: "PRUEBA-HAR-01", cantidad: "10" }] });
  expect(s.estado, JSON.stringify(s.datos)).toBe(200);
}, 240_000);

const partidas = async (origenFolio: string) => (await e.pool.query(
  `SELECT cc.clave AS cuenta, pp.cargo::text, pp.abono::text FROM poliza p JOIN poliza_partida pp ON pp.poliza_id = p.id JOIN cuenta_contable cc ON cc.id = pp.cuenta_id
    WHERE p.origen_folio = $1 ORDER BY pp.orden`, [origenFolio],
)).rows;

describe("catálogo y reglas", () => {
  it("el contador carga el catálogo de cuentas y las reglas por layout; el almacenista no ve contabilidad", async () => {
    await e.cargar("cnt", "cuentas", "fase-7/70-catalogo-cuentas.txt");
    await e.cargar("cnt", "reglas_contables", "fase-7/71-reglas-contables.txt");
    const r = await e.nav.cnt!.get("/api/contabilidad/reglas");
    expect(r.estado).toBe(200);
    expect(r.datos.conceptos.find((k: any) => k.clave === "CAJA_EFECTIVO").reglas.map((x: any) => [x.sucursal, x.cuenta])).toEqual([[null, "1101-01"], ["SUC1", "1101-02"]]);
    expect((await e.nav.alm!.get("/api/contabilidad/balanza")).estado).toBe(403);
    // Una regla no apunta a una cuenta de mayor.
    expect((await e.nav.cnt!.put("/api/contabilidad/reglas", { concepto: "BANCOS", cuenta: "1102" })).estado).toBe(400);
  });
});

describe("pólizas automáticas", () => {
  it("sin la regla de costo de ventas, las salidas por venta quedan pendientes y lo demás se contabiliza", async () => {
    expect((await e.nav.cnt!.put("/api/contabilidad/reglas", { concepto: "COSTO_VENTAS", cuenta: null })).estado).toBe(200);
    const g = await e.nav.cnt!.post("/api/contabilidad/contabilizar");
    expect(g.estado, JSON.stringify(g.datos)).toBe(200);
    expect(g.datos.pendientes).toHaveLength(2);
    expect(g.datos.pendientes[0].motivo).toBe("Falta la cuenta de: COSTO_VENTAS.");
    // Inventario inicial MP-MAT, PT-MAT y PT-SUC1, surtido, 2 ventas
    expect(g.datos.generadas).toBe(6);
  });

  it("al capturar la regla se contabilizan; volver a generar no duplica", async () => {
    expect((await e.nav.cnt!.put("/api/contabilidad/reglas", { concepto: "COSTO_VENTAS", cuenta: "5101-01" })).estado).toBe(200);
    const g = await e.nav.cnt!.post("/api/contabilidad/contabilizar");
    expect([g.datos.generadas, g.datos.pendientes.length]).toEqual([2, 0]);
    expect((await e.nav.cnt!.post("/api/contabilidad/contabilizar")).datos.generadas).toBe(0);
  });

  it("venta en efectivo en SUC1: caja de la sucursal contra ventas e IVA; con tarjeta va a tarjetas por depositar", async () => {
    const v = (await e.pool.query("SELECT folio, total::text, iva::text FROM venta ORDER BY folio")).rows;
    const p1 = await partidas(v[0].folio);
    expect(p1[0]).toEqual({ cuenta: "1101-02", cargo: "72.00", abono: "0.00" });
    expect(p1.find((x) => x.cuenta === "4101-01")!.abono).toBe((72 - Number(v[0].iva)).toFixed(2));
    expect((await partidas(v[1].folio))[0]).toEqual({ cuenta: "1104-01", cargo: "28.00", abono: "0.00" });
    const tipo = (await e.pool.query("SELECT tipo FROM poliza WHERE origen = 'VENTA' LIMIT 1")).rows[0].tipo;
    expect(tipo).toBe("I");
  });

  it("surtido: producción en proceso contra materia prima por el mismo importe; inventario inicial contra saldos iniciales", async () => {
    const mov = (await e.pool.query("SELECT folio FROM movimiento WHERE tipo = 'SURTIDO_SALIDA'")).rows[0].folio;
    expect(await partidas(mov)).toEqual([{ cuenta: "1105-02", cargo: "185.00", abono: "0.00" }, { cuenta: "1105-01", cargo: "0.00", abono: "185.00" }]);
    const ini = (await e.pool.query("SELECT m.folio FROM movimiento m JOIN almacen a ON a.id = m.almacen_id WHERE m.tipo = 'INICIAL' AND a.clave = 'PT-MAT'")).rows[0].folio;
    expect(await partidas(ini)).toEqual([{ cuenta: "1105-03", cargo: "438.00", abono: "0.00" }, { cuenta: "3101-02", cargo: "0.00", abono: "438.00" }]);
  });

  it("las partidas no se modifican y una póliza automática no se cancela desde contabilidad", async () => {
    await expect(e.pool.query("UPDATE poliza_partida SET cargo = cargo + 1")).rejects.toThrow();
    await expect(e.pool.query("DELETE FROM poliza")).rejects.toThrow();
    const id = (await e.pool.query("SELECT id FROM poliza WHERE origen = 'VENTA' LIMIT 1")).rows[0].id;
    expect((await e.nav.cnt!.post(`/api/contabilidad/polizas/${id}/cancelar`, { motivo: "PRUEBA" })).estado).toBe(409);
  });
});

describe("pólizas manuales", () => {
  let apertura: string;
  it("el contador captura la aportación de capital; no deja descuadrada ni en cuenta de mayor", async () => {
    const base = { tipo: "D", fecha: hoy, concepto: "PRUEBA aportación de capital" };
    const mal = await e.nav.cnt!.post("/api/contabilidad/polizas", { ...base, partidas: [{ cuenta: "1102-01", cargo: "10000" }, { cuenta: "3101-01", abono: "9000" }] });
    expect(mal.estado).toBe(400);
    expect(mal.datos.mensaje).toMatch(/no cuadra/);
    expect((await e.nav.cnt!.post("/api/contabilidad/polizas", { ...base, partidas: [{ cuenta: "1102", cargo: "10000" }, { cuenta: "3101-01", abono: "10000" }] })).estado).toBe(400);
    const ok = await e.nav.cnt!.post("/api/contabilidad/polizas", { ...base, partidas: [{ cuenta: "1102-01", cargo: "10,000.00" }, { cuenta: "3101-01", abono: "10000" }] });
    expect(ok.estado, JSON.stringify(ok.datos)).toBe(200);
    expect(ok.datos.folio).toMatch(/^D-\d{6}-\d{4}$/);
    apertura = ok.datos.id;
  });

  it("queda por autorizar: el contador no la autoriza; el contralor sí; quien la captura no la autoriza", async () => {
    expect((await e.nav.cnt!.post(`/api/contabilidad/polizas/${apertura}/autorizar`, {})).estado).toBe(403);
    expect((await e.nav.con!.post(`/api/contabilidad/polizas/${apertura}/autorizar`, {})).datos.estatus).toBe("APLICADA");
    await e.otorgar("CON", "contabilidad.polizas:crear");
    const propia = await e.nav.con!.post("/api/contabilidad/polizas", { tipo: "D", fecha: hoy, concepto: "PRUEBA reclasificación", partidas: [{ cuenta: "1101-01", cargo: "1" }, { cuenta: "1102-01", abono: "1" }] });
    expect(propia.estado).toBe(200);
    const r = await e.nav.con!.post(`/api/contabilidad/polizas/${propia.datos.id}/autorizar`, {});
    expect(r.estado).toBe(403);
    expect(r.datos.mensaje).toMatch(/segregación/);
    expect((await e.nav.cnt!.post(`/api/contabilidad/polizas/${propia.datos.id}/cancelar`, { motivo: "PRUEBA no procede" })).datos.estatus).toBe("CANCELADA");
  });
});

describe("reportes", () => {
  it("balanza: cuadra, las cuentas de mayor suman a sus subcuentas", async () => {
    const b = await e.nav.con!.get(`/api/contabilidad/balanza?desde=${hoy}&hasta=${hoy}`);
    expect(b.estado).toBe(200);
    expect(b.datos.cuadra).toBe(true);
    expect(b.datos.totales.cargos).toBe(b.datos.totales.abonos);
    const caja = b.datos.renglones.find((r: any) => r.clave === "1101");
    expect(caja.final).toBe("72.00");
    expect(b.datos.renglones.find((r: any) => r.clave === "1102-01").final).toBe("10000.00");
    expect((await e.nav.con!.get(`/api/contabilidad/balanza?desde=${hoy}&hasta=${hoy}&formato=xlsx`)).encabezados.get("content-type")).toMatch(/spreadsheet/);
  });

  it("auxiliar de caja de la sucursal con saldo corrido", async () => {
    const a = (await e.nav.cnt!.get(`/api/contabilidad/auxiliar?cuenta=1101-02&desde=${hoy}&hasta=${hoy}`)).datos;
    expect([a.inicial, a.final, a.movimientos.length]).toEqual(["0.00", "72.00", 1]);
  });

  it("estados financieros: el balance cuadra con el resultado del ejercicio", async () => {
    const r = (await e.nav.dir!.get(`/api/contabilidad/estados?desde=${hoy}&hasta=${hoy}`)).datos;
    expect(r.balance.cuadra).toBe(true);
    const ventas = Number(r.resultados.totales.ingresos);
    const costo = Number(r.resultados.totales.costos);
    expect(ventas).toBeGreaterThan(0);
    expect(Number(r.resultados.totales.neta)).toBeCloseTo(ventas - costo, 2);
  });

  it("conciliación: el inventario contable es igual al kárdex en materia prima, producción en proceso y producto terminado", async () => {
    const k = (await e.nav.con!.get(`/api/contabilidad/conciliacion?hasta=${hoy}`)).datos;
    expect(k.grupos.map((g: any) => [g.grupo, g.cuadra])).toEqual([["MP", true], ["PEP", true], ["PT", true]]);
    expect(k.grupos.find((g: any) => g.grupo === "PEP").kardex).toBe("185.00");
  });
});

describe("cierre de periodo", () => {
  it("no cierra con una póliza manual sin autorizar; el contador no cierra", async () => {
    const per = hoy.slice(0, 7);
    const pend = await e.nav.cnt!.post("/api/contabilidad/polizas", { tipo: "D", fecha: hoy, concepto: "PRUEBA pendiente", partidas: [{ cuenta: "1101-01", cargo: "5" }, { cuenta: "1102-01", abono: "5" }] });
    expect((await e.nav.cnt!.post(`/api/contabilidad/periodos/${per}/cerrar`)).estado).toBe(403);
    const r = await e.nav.con!.post(`/api/contabilidad/periodos/${per}/cerrar`);
    expect(r.estado).toBe(409);
    expect(JSON.stringify(r.datos.detalles)).toMatch(new RegExp(`${pend.datos.folio}`));
    expect((await e.nav.con!.post(`/api/contabilidad/polizas/${pend.datos.id}/rechazar`, { motivo: "PRUEBA no va" })).datos.estatus).toBe("RECHAZADA");
  });

  it("cierra; ya no entran pólizas en el mes (ni manuales ni de ventas nuevas) hasta reabrirlo con motivo", async () => {
    const per = hoy.slice(0, 7);
    const c = await e.nav.con!.post(`/api/contabilidad/periodos/${per}/cerrar`);
    expect(c.estado, JSON.stringify(c.datos)).toBe(200);
    const m = await e.nav.cnt!.post("/api/contabilidad/polizas", { tipo: "D", fecha: hoy, concepto: "PRUEBA tarde", partidas: [{ cuenta: "1101-01", cargo: "5" }, { cuenta: "1102-01", abono: "5" }] });
    expect(m.estado).toBe(409);
    await caj().post("/api/pos/ventas", { id: randomUUID(), renglones: [{ articulo: "PRUEBA-BOLILLO", cantidad: "1" }], pagos: [{ forma: "01", importe: "3" }] });
    const g = await e.nav.cnt!.post("/api/contabilidad/contabilizar");
    expect(g.datos.generadas).toBe(0);
    expect(g.datos.pendientes.every((p: any) => p.motivo === "El periodo está cerrado.")).toBe(true);
    await expect(e.pool.query("UPDATE poliza SET concepto = 'x' WHERE origen = 'VENTA'")).rejects.toThrow(/cerrado/);
    expect((await e.nav.con!.post(`/api/contabilidad/periodos/${per}/reabrir`, { motivo: "PRUEBA venta tardía" })).datos.estatus).toBe("ABIERTO");
    expect((await e.nav.cnt!.post("/api/contabilidad/contabilizar")).datos.generadas).toBe(2);
    const p = (await e.nav.con!.get("/api/contabilidad/periodos")).datos.periodos[0];
    expect([p.estatus, p.motivo_reapertura]).toEqual(["ABIERTO", "PRUEBA venta tardía"]);
  });
});
