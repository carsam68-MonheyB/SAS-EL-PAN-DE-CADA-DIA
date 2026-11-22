// Fase 4 de punta a punta contra Postgres real: requisición autorizada por
// nivel y monto, orden de compra (con reautorización si rebasa lo autorizado),
// recepción con entrada al inventario, factura XML con cotejo a 3 vías,
// cuenta por pagar, pago autorizado con segregación y reportes. Datos FICTICIOS.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { prepararInventarios, type Entorno } from "./inventarios-apoyo";

let e: Entorno;
const xml = (n: string) => readFileSync(`datos-ejemplo/fase-4/${n}`, "utf8");
const pendienteDe = async (rol: string, folio: string) => (await e.nav[rol]!.get("/api/compras/autorizaciones")).datos.pendientes.find((s: any) => s.folio === folio);

beforeAll(async () => {
  e = await prepararInventarios("erp_prueba_compras");
  await e.pool.query("UPDATE configuracion SET valor = 'NO' WHERE clave = 'compras.permitir_entrada_sin_oc'");
  await e.cargar("cnt", "cuentas_bancarias", "fase-4/40-cuentas-bancarias.txt");
}, 180_000);

let req1: any, req2: any, oc1: any, oc2: any;

describe("requisiciones y autorización por nivel", () => {
  it("el almacenista pide 4 bultos de harina y 2 de azúcar: se estima con el costo de referencia ($1,850 + $2,400)", async () => {
    const r = await e.nav.alm!.post("/api/compras/requisiciones", { requerido_para: "2099-01-05", enviar: true, renglones: [{ articulo: "PRUEBA-HAR-01", cantidad: "4", unidad: "BULTO" }, { articulo: "PRUEBA-AZU-01", cantidad: "2", unidad: "BULTO" }] });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.monto_estimado).toBe("4250.00");
    req1 = r.datos;
    expect((await e.nav.alm!.get(`/api/compras/requisiciones/${req1.folio}`)).datos.estatus).toBe("ENVIADA");
  });

  it("autoriza el nivel 1 (hasta $10,000); el almacenista no puede", async () => {
    const s = await pendienteDe("aut1", req1.folio);
    expect(s).toMatchObject({ cubre: true, propia: false });
    expect((await e.nav.alm!.post(`/api/compras/autorizaciones/${s.id}/autorizar`, {})).estado).toBe(403);
    const a = await e.nav.aut1!.post(`/api/compras/autorizaciones/${s.id}/autorizar`, {});
    expect(a.estado, JSON.stringify(a.datos)).toBe(200);
    expect((await e.nav.com!.get(`/api/compras/requisiciones/${req1.folio}`)).datos.estatus).toBe("AUTORIZADA");
  });

  it("arriba de $10,000 la autoriza dirección (nivel 2); un rechazo exige motivo", async () => {
    const r = await e.nav.alm!.post("/api/compras/requisiciones", { enviar: true, renglones: [{ articulo: "PRUEBA-HAR-01", cantidad: "30", unidad: "BULTO" }] });
    req2 = r.datos;
    expect(req2.monto_estimado).toBe("13875.00");
    const s = await pendienteDe("aut1", req2.folio);
    expect(s.cubre).toBe(false);
    expect((await e.nav.aut1!.post(`/api/compras/autorizaciones/${s.id}/autorizar`, {})).datos.mensaje).toMatch(/límite/);
    expect((await e.nav.dir!.post(`/api/compras/autorizaciones/${s.id}/rechazar`, {})).estado).toBe(400);
    expect((await e.nav.dir!.post(`/api/compras/autorizaciones/${s.id}/autorizar`, { comentario: "OK temporada" })).estado).toBe(200);
  });
});

describe("órdenes de compra", () => {
  it("OC de harina a $450 el bulto ($1,800) queda emitida: no rebasa lo autorizado ($1,850)", async () => {
    const d = (await e.nav.com!.get(`/api/compras/requisiciones/${req1.folio}`)).datos;
    const har = d.renglones.find((x: any) => x.articulo === "PRUEBA-HAR-01");
    expect((await e.nav.com!.post("/api/compras/ordenes", { requisicion: req1.folio, proveedor: "PRUEBA-PROV-01", almacen: "MP-MAT", fecha_entrega: "2099-01-05", renglones: [{ requisicion_renglon_id: har.id, cantidad: "5", unidad: "BULTO", precio: "450", tasa_iva: "PRUEBA-IVA" }] })).datos.mensaje).toMatch(/quedan 100/);
    const r = await e.nav.com!.post("/api/compras/ordenes", { requisicion: req1.folio, proveedor: "PRUEBA-PROV-01", almacen: "MP-MAT", fecha_entrega: "2099-01-05", renglones: [{ requisicion_renglon_id: har.id, cantidad: "4", unidad: "BULTO", precio: "450", tasa_iva: "PRUEBA-IVA" }] });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos).toMatchObject({ estatus: "EMITIDA", total: "1800.00", autorizado: "1850.00" });
    oc1 = r.datos;
  });

  it("OC de azúcar a $1,300 el bulto ($2,600) rebasa lo autorizado + 5 % ($2,520): vuelve a autorización", async () => {
    const d = (await e.nav.com!.get(`/api/compras/requisiciones/${req1.folio}`)).datos;
    const azu = d.renglones.find((x: any) => x.articulo === "PRUEBA-AZU-01");
    const r = await e.nav.com!.post("/api/compras/ordenes", { requisicion: req1.folio, proveedor: "PRUEBA-PROV-02", almacen: "MP-MAT", fecha_entrega: "2099-01-05", renglones: [{ requisicion_renglon_id: azu.id, cantidad: "2", unidad: "BULTO", precio: "1300", tasa_iva: "PRUEBA-IVA" }] });
    expect(r.datos).toMatchObject({ estatus: "POR_AUTORIZAR", total: "2600.00" });
    oc2 = r.datos;
    expect((await e.nav.com!.get(`/api/compras/requisiciones/${req1.folio}`)).datos.estatus).toBe("ORDENADA");
    // No se recibe sin autorización
    expect((await e.nav.alm!.post(`/api/compras/ordenes/${oc2.folio}/recibir`, { renglones: [{ oc_renglon_id: "00000000-0000-0000-0000-000000000000", cantidad: "1" }] })).estado).toBe(409);
    const s = await pendienteDe("aut1", oc2.folio);
    expect((await e.nav.aut1!.post(`/api/compras/autorizaciones/${s.id}/autorizar`, {})).estado).toBe(200);
  });
});

describe("recepción y entrada al inventario", () => {
  it("el almacenista ve la orden sin precios y recibe los 4 bultos: entran 100 kg a $18.00", async () => {
    const o = (await e.nav.alm!.get(`/api/compras/ordenes/${oc1.folio}`)).datos;
    expect(o.total).toBeNull();
    expect(o.renglones[0].precio).toBeNull();
    const rid = o.renglones[0].id;
    expect((await e.nav.alm!.post(`/api/compras/ordenes/${oc1.folio}/recibir`, { renglones: [{ oc_renglon_id: rid, cantidad: "5" }] })).datos.mensaje).toMatch(/solo tiene 4/);
    const r = await e.nav.alm!.post(`/api/compras/ordenes/${oc1.folio}/recibir`, { remision: "PRUEBA-REM-1", renglones: [{ oc_renglon_id: rid, cantidad: "4", lote: "PRUEBA-HAR-C", caducidad: "2027-05-31" }] });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.estatus).toBe("RECIBIDA");
    expect(await e.existencia("MP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "100", valor: "1800" });
    const mov = (await e.pool.query("SELECT id FROM movimiento WHERE documento_tipo = 'RECEPCION'")).rows[0].id;
    await e.otorgar("ALM", "compras.recepcion:cancelar");
    expect((await e.nav.alm!.post(`/api/inventarios/movimientos/${mov}/cancelar`, { motivo: "Prueba" })).estado).toBe(409);
  });

  it("la entrada por compra sin orden de compra ya está desactivada", async () => {
    const r = await e.nav.alm!.post("/api/inventarios/compras", { almacen: "MP-MAT", renglones: [{ articulo: "PRUEBA-AZU-01", cantidad: "1", costo_unitario: "1" }] });
    expect(r.estado).toBe(409);
  });
});

describe("factura XML y cotejo a 3 vías", () => {
  it("el XML del proveedor equivocado se rechaza", async () => {
    const r = await e.nav.com!.post(`/api/compras/ordenes/${oc2.folio}/factura`, { xml: xml("41-factura-PRUEBA-harina.xml") });
    expect(r.estado).toBe(400);
    expect(JSON.stringify(r.datos)).toMatch(/RFC emisor/);
  });

  it("la factura que coincide con OC y recepción queda cotejada y genera la cuenta por pagar (vence a 15 días)", async () => {
    const prev = await e.nav.com!.post(`/api/compras/ordenes/${oc1.folio}/factura-revisar`, { xml: xml("41-factura-PRUEBA-harina.xml") });
    expect(prev.datos.cotejo_ok).toBe(true);
    const r = await e.nav.com!.post(`/api/compras/ordenes/${oc1.folio}/factura`, { xml: xml("41-factura-PRUEBA-harina.xml") });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.estatus).toBe("COTEJADA");
    const x = (await e.pool.query("SELECT importe::text, saldo::text, vencimiento::text FROM cxp_documento")).rows;
    expect(x).toEqual([{ importe: "1800.00", saldo: "1800.00", vencimiento: "2026-12-07" }]);
    expect((await e.nav.com!.post(`/api/compras/ordenes/${oc1.folio}/factura`, { xml: xml("41-factura-PRUEBA-harina.xml") })).datos.detalles[0].mensaje).toMatch(/ya está registrada/);
  });

  it("una factura con precio distinto queda con diferencias: el contralor la rechaza y no genera cuenta por pagar", async () => {
    const r = await e.nav.com!.post(`/api/compras/ordenes/${oc1.folio}/factura`, { xml: xml("42-factura-PRUEBA-con-diferencia.xml") });
    expect(r.datos.estatus).toBe("CON_DIFERENCIAS");
    expect(r.datos.diferencias.filter((d: any) => !d.dentro).map((d: any) => d.tipo).sort()).toEqual(["CANTIDAD", "PRECIO", "TOTAL"]);
    const s = (await e.nav.con!.get("/api/compras/autorizaciones")).datos.pendientes.find((p: any) => p.tipo_documento === "FACTURA");
    expect((await e.nav.con!.post(`/api/compras/autorizaciones/${s.id}/rechazar`, { comentario: "El proveedor debe corregir el precio" })).estado).toBe(200);
    expect((await e.pool.query("SELECT count(*)::int AS n FROM cxp_documento")).rows[0].n).toBe(1);
  });
});

describe("pagos y reportes", () => {
  let pago: any;
  it("antigüedad de saldos: $1,800 por vencer con PRUEBA-PROV-01", async () => {
    const r = await e.nav.cnt!.get("/api/compras/cxp");
    expect(r.datos.antiguedad).toEqual([expect.objectContaining({ proveedor: "PRUEBA-PROV-01", por_vencer: "1800.00", total: "1800.00" })]);
    expect((await e.nav.cnt!.get("/api/compras/cxp?formato=xlsx")).datos).toBeInstanceOf(Uint8Array);
  });

  it("el contador programa el pago; no puede pagar de más", async () => {
    const cxp = (await e.nav.cnt!.get("/api/compras/cxp")).datos.documentos[0].id;
    expect((await e.nav.cnt!.post("/api/compras/pagos", { proveedor: "PRUEBA-PROV-01", forma: "03", fecha_programada: "2099-01-10", aplicaciones: [{ cxp_id: cxp, importe: "2000" }] })).estado).toBe(400);
    const r = await e.nav.cnt!.post("/api/compras/pagos", { proveedor: "PRUEBA-PROV-01", cuenta: "PRUEBA-BANCO-1", forma: "03", fecha_programada: "2099-01-10", aplicaciones: [{ cxp_id: cxp, importe: "1800" }] });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    pago = r.datos;
    // Lo ya programado se descuenta de lo que se puede pagar.
    expect((await e.nav.cnt!.post("/api/compras/pagos", { proveedor: "PRUEBA-PROV-01", forma: "03", fecha_programada: "2099-01-10", aplicaciones: [{ cxp_id: cxp, importe: "1" }] })).estado).toBe(400);
  });

  it("quien recibió la mercancía no autoriza su pago; el contralor sí (hasta $20,000) y luego se marca pagado", async () => {
    await e.otorgar("ALM", "compras.cxp:autorizar");
    const sa = await pendienteDe("alm", pago.folio);
    expect((await e.nav.alm!.post(`/api/compras/autorizaciones/${sa.id}/autorizar`, {})).datos.mensaje).toMatch(/Recibiste mercancía/);
    expect((await e.nav.cnt!.post(`/api/compras/pagos/${pago.id}/pagado`, { fecha_pago: "2099-01-10", referencia: "SPEI-PRUEBA-1" })).estado).toBe(409);
    expect((await e.nav.con!.post(`/api/compras/autorizaciones/${sa.id}/autorizar`, {})).estado).toBe(200);
    const r = await e.nav.cnt!.post(`/api/compras/pagos/${pago.id}/pagado`, { fecha_pago: "2099-01-10", referencia: "SPEI-PRUEBA-1" });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect((await e.pool.query("SELECT saldo::text, estatus FROM cxp_documento")).rows[0]).toEqual({ saldo: "0.00", estatus: "PAGADO" });
  });

  it("comparativo de precios: harina con PRUEBA-PROV-01 a $18.00 por kg", async () => {
    const r = await e.nav.com!.get("/api/compras/comparativo");
    const har = r.datos.articulos.find((a: any) => a.clave === "PRUEBA-HAR-01");
    expect(har.proveedores[0]).toMatchObject({ proveedor: "PRUEBA-PROV-01", ultimo: "18.0000" });
  });

  it("las firmas no se modifican y todo cuadra", async () => {
    await expect(e.pool.query("UPDATE firma_autorizacion SET decision = 'RECHAZA'")).rejects.toThrow();
    await expect(e.pool.query("UPDATE factura_proveedor SET total = 1")).rejects.toThrow(/no se modifica/);
    expect((await e.pool.query("SELECT * FROM inventario_diferencias()")).rows).toEqual([]);
    expect((await e.pool.query("SELECT bitacora_auditoria_verificar() AS roto")).rows[0].roto).toBeNull();
  });
});
