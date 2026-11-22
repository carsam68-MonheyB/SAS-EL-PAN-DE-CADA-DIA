// Fase 6 de punta a punta contra Postgres real: sesión de caja, turno, ventas
// con salida de inventario (sin existencia no se vende), pagos sin datos de
// tarjeta, descuentos, retiros y devoluciones autorizadas con PIN, pedidos con
// anticipo, cortes X y Z con arqueo, y reportes de oficina. Datos FICTICIOS.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prepararInventarios, type Entorno } from "./inventarios-apoyo";
import { revisarContabilidad } from "./apoyo-contable";

let e: Entorno;
const ENC = { usuario: "prueba.enc", pin: "4826" };
const CON = { usuario: "prueba.con", pin: "4830" };
const caj = () => e.nav.caj!;
const vender = (cuerpo: Record<string, unknown>) => caj().post("/api/pos/ventas", { id: randomUUID(), ...cuerpo });
const efectivo = (importe: string) => ({ forma: "01", importe });

beforeAll(async () => {
  e = await prepararInventarios("erp_prueba_pos");
  await e.cargar("con", "causas_merma", "fase-3/29-causas-merma.txt");
  const c = await e.cargar("jpr", "inventario_inicial", "fase-6/32-inventario-inicial-sucursal.txt");
  expect((await e.nav.con!.post(`/api/cargas/${c.id}/autorizar`)).estado).toBe(200);
  // Precios vigentes hoy (en la práctica se capturan con la carga de precios y su autorización).
  await e.pool.query(
    `INSERT INTO precio_venta (articulo_id, sucursal_id, precio, vigente_desde)
     SELECT a.id, s.id, x.precio, (now() AT TIME ZONE 'America/Mexico_City')::date
       FROM (VALUES ('PRUEBA-CONCHA-V', NULL, 14.00), ('PRUEBA-CONCHA-C', NULL, 15.00), ('PRUEBA-BOLILLO', NULL, 3.00), ('PRUEBA-TELERA', 'SUC1', 3.50)) AS x(art, suc, precio)
       JOIN articulo a ON a.clave = x.art LEFT JOIN sucursal s ON s.clave = x.suc`,
  );
  for (const [rol, pin] of [["caj", "4821"], ["enc", ENC.pin], ["con", CON.pin]] as const) {
    expect((await e.nav[rol]!.post("/api/auth/mi-pin", { password: e.password, pin })).estado).toBe(200);
  }
}, 180_000);

describe("caja y turno", () => {
  it("sin sesión de caja no se vende; el cajero elige su caja y abre turno con fondo", async () => {
    expect((await caj().post("/api/pos/turno", { fondo: "500" })).estado).toBe(409);
    const est = await caj().get("/api/pos/estado");
    expect(est.datos.sin_caja).toBe(true);
    expect(est.datos.cajas.map((x: any) => x.clave)).toEqual(["CAJA-SUC1-1"]);
    expect((await caj().post("/api/auth/caja", { caja_id: est.datos.cajas[0].id })).estado).toBe(200);
    const t = await caj().post("/api/pos/turno", { fondo: "500" });
    expect(t.estado, JSON.stringify(t.datos)).toBe(200);
    expect((await caj().post("/api/pos/turno", { fondo: "500" })).estado).toBe(409);
    const p = await caj().get("/api/pos/productos");
    expect(p.datos.productos.find((x: any) => x.clave === "PRUEBA-CONCHA-V")).toMatchObject({ precio: "14.00", existencia: "50.000000" });
  });
});

describe("ventas", () => {
  let primera: string;
  it("3 conchas y 10 bolillos = $72.00; paga con $100 y recibe $28.00 de cambio; sale del inventario al costo", async () => {
    const id = randomUUID();
    const r = await caj().post("/api/pos/ventas", { id, renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "3" }, { articulo: "PRUEBA-BOLILLO", cantidad: "10" }], pagos: [efectivo("100")] });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos).toMatchObject({ total: "72.00", cambio: "28.00", folio: "CAJA-SUC1-1-000001" });
    primera = r.datos.folio;
    expect(await e.existencia("PT-SUC1", "PRUEBA-CONCHA-V")).toEqual({ cantidad: "47", valor: "225.6" });
    const v = (await e.pool.query("SELECT costo_importe::text FROM venta_renglon r JOIN venta v ON v.id = r.venta_id WHERE v.id = $1 ORDER BY orden", [id])).rows;
    expect(v.map((x) => Number(x.costo_importe))).toEqual([14.4, 15]);
    // Reenviar la misma venta (ej. se cortó la red) no la duplica.
    const otra = await caj().post("/api/pos/ventas", { id, renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "3" }], pagos: [efectivo("100")] });
    expect(otra.datos).toMatchObject({ folio: primera, repetida: true });
    expect(await e.existencia("PT-SUC1", "PRUEBA-CONCHA-V")).toEqual({ cantidad: "47", valor: "225.6" });
  });

  it("no se vende sin existencia (P71), sin tasa de IVA, ni cobrando de menos", async () => {
    const sin = await vender({ renglones: [{ articulo: "PRUEBA-CONCHA-C", cantidad: "31" }], pagos: [efectivo("500")] });
    expect(sin.estado).toBe(409);
    expect(sin.datos.mensaje).toMatch(/Sin existencia suficiente/);
    expect((await vender({ renglones: [{ articulo: "PRUEBA-TELERA", cantidad: "1" }], pagos: [efectivo("10")] })).datos.mensaje).toMatch(/IVA/);
    expect((await vender({ renglones: [{ articulo: "PRUEBA-BOLILLO", cantidad: "1.5" }], pagos: [efectivo("10")] })).estado).toBe(400);
    expect((await vender({ renglones: [{ articulo: "PRUEBA-BOLILLO", cantidad: "5" }], pagos: [efectivo("10")] })).datos.mensaje).toMatch(/Falta por cobrar \$5.00/);
    expect((await e.pool.query("SELECT count(*)::int AS n FROM venta")).rows[0].n).toBe(1);
  });

  it("con tarjeta solo se guarda la referencia del voucher: un número de tarjeta se rechaza", async () => {
    const mala = await vender({ renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "2" }], pagos: [{ forma: "04", importe: "28", referencia: "4152 3133 0000 1234" }] });
    expect(mala.estado).toBe(400);
    expect(mala.datos.mensaje).toMatch(/número de la tarjeta/);
    expect((await vender({ renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "2" }], pagos: [{ forma: "04", importe: "28" }] })).estado).toBe(400);
    const ok = await vender({ renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "2" }], pagos: [{ forma: "04", importe: "28", referencia: "AUT-482913" }] });
    expect(ok.estado, JSON.stringify(ok.datos)).toBe(200);
    expect((await vender({ renglones: [{ articulo: "PRUEBA-BOLILLO", cantidad: "1" }], pagos: [{ forma: "04", importe: "5", referencia: "AUT-1" }] })).datos.mensaje).toMatch(/cambio/);
  });

  it("el descuento lo autoriza el contador o el contralor con su PIN (P50), no el encargado ni el cajero", async () => {
    const cuerpo = { renglones: [{ articulo: "PRUEBA-BOLILLO", cantidad: "5", descuento: "3" }], pagos: [efectivo("20")] };
    expect((await vender(cuerpo)).datos.error).toBe("requiere_autorizacion");
    expect((await vender({ ...cuerpo, autorizacion: { usuario: "prueba.caj", pin: "4821" } })).datos.mensaje).toMatch(/propias/);
    expect((await vender({ ...cuerpo, autorizacion: { usuario: "prueba.enc", pin: "0000" } })).datos.mensaje).toMatch(/PIN incorrecto/);
    expect((await vender({ ...cuerpo, autorizacion: ENC })).datos.mensaje).toMatch(/no tiene permiso/);
    const r = await vender({ ...cuerpo, autorizacion: CON });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos).toMatchObject({ total: "12.00", cambio: "8.00" });
    expect((await e.pool.query("SELECT count(*)::int AS n FROM bitacora_acceso WHERE evento = 'autorizacion_caja' AND NOT exito")).rows[0].n).toBe(3);
  });

  it("el ticket trae renglones, pagos y cambio; la venta no se puede modificar", async () => {
    const t = await caj().get(`/api/pos/ventas/${primera}`);
    expect(t.datos.renglones).toHaveLength(2);
    expect(t.datos.pagos).toEqual([{ forma: "Efectivo", importe: "72.00", referencia: null }]);
    expect(t.datos.cambio).toBe("28.00");
    await expect(e.pool.query("UPDATE venta SET total = 1")).rejects.toThrow(/no se modifica/);
    await expect(e.pool.query("UPDATE venta_pago SET importe = 1")).rejects.toThrow();
  });
});

describe("efectivo y devoluciones", () => {
  it("retiro de $50 autorizado por el encargado", async () => {
    expect((await caj().post("/api/pos/efectivo", { tipo: "RETIRO", importe: "50", motivo: "Depósito parcial" })).estado).toBe(403);
    const r = await caj().post("/api/pos/efectivo", { tipo: "RETIRO", importe: "50", motivo: "Depósito parcial", autorizacion: ENC });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect((await caj().post("/api/pos/efectivo", { tipo: "RETIRO", importe: "100000", motivo: "Demasiado", autorizacion: ENC })).estado).toBe(400);
  });

  it("devolución de 1 concha: autoriza el encargado, regresa $14.00 y la pieza vuelve al inventario con su costo", async () => {
    const r = await caj().post("/api/pos/devoluciones", { venta: "CAJA-SUC1-1-000001", motivo: "Cliente la cambió", regresa_inventario: true, renglones: [{ orden: 1, cantidad: "1" }], autorizacion: ENC });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.importe).toBe("14.00");
    expect(await e.existencia("PT-SUC1", "PRUEBA-CONCHA-V")).toEqual({ cantidad: "46", valor: "220.8" });
    expect((await caj().post("/api/pos/devoluciones", { venta: "CAJA-SUC1-1-000001", motivo: "Otra", regresa_inventario: true, renglones: [{ orden: 1, cantidad: "3" }], autorizacion: ENC })).datos.mensaje).toMatch(/Solo quedan 2/);
    const v = (await e.pool.query("SELECT estatus, devuelto::text FROM venta WHERE folio = 'CAJA-SUC1-1-000001'")).rows[0];
    expect(v).toEqual({ estatus: "DEVUELTA_PARCIAL", devuelto: "14.00" });
  });
});

describe("pedidos con anticipo", () => {
  let pedido: string;
  it("pedido de 10 conchas de chocolate ($150) con $50 de anticipo y un abono de $20", async () => {
    const r = await caj().post("/api/pos/pedidos", {
      cliente_nombre: "PRUEBA Cliente", telefono: "5500000000", fecha_entrega: "2099-01-01", notas: "Para fiesta",
      renglones: [{ articulo: "PRUEBA-CONCHA-C", cantidad: "10", especificaciones: "Con chispas" }], anticipo: efectivo("50"),
    });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    pedido = r.datos.id;
    expect(r.datos.total).toBe("150.00");
    expect((await caj().post(`/api/pos/pedidos/${pedido}/abonar`, efectivo("200"))).estado).toBe(400);
    expect((await caj().post(`/api/pos/pedidos/${pedido}/abonar`, efectivo("20"))).estado).toBe(200);
  });

  it("al entregar se vende a los precios pactados, se aplica lo anticipado ($70) y se cobra el saldo ($80)", async () => {
    expect((await caj().post(`/api/pos/pedidos/${pedido}/entregar`, { venta_id: randomUUID(), pagos: [efectivo("70")] })).datos.mensaje).toMatch(/Falta por cobrar \$10.00/);
    const r = await caj().post(`/api/pos/pedidos/${pedido}/entregar`, { venta_id: randomUUID(), pagos: [efectivo("80")] });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos).toMatchObject({ total: "150.00", cambio: "0.00" });
    expect(await e.existencia("PT-SUC1", "PRUEBA-CONCHA-C")).toEqual({ cantidad: "20", valor: "102" });
    const t = await caj().get(`/api/pos/ventas/${r.datos.folio}`);
    expect(t.datos.pagos.map((p: any) => [p.forma, p.importe])).toEqual(expect.arrayContaining([["Anticipo", "70.00"], ["Efectivo", "80.00"]]));
    expect((await caj().post(`/api/pos/pedidos/${pedido}/abonar`, efectivo("1"))).estado).toBe(409);
  });

  it("un pedido sin anticipo lo autoriza el contador o el contralor (P60)", async () => {
    const cuerpo = { cliente_nombre: "PRUEBA Sin anticipo", fecha_entrega: "2099-01-03", renglones: [{ articulo: "PRUEBA-BOLILLO", cantidad: "20" }] };
    expect((await caj().post("/api/pos/pedidos", cuerpo)).datos.error).toBe("requiere_autorizacion");
    expect((await caj().post("/api/pos/pedidos", { ...cuerpo, autorizacion: ENC })).datos.mensaje).toMatch(/no tiene permiso/);
    const r = await caj().post("/api/pos/pedidos", { ...cuerpo, autorizacion: CON });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
  });

  it("pedido por WhatsApp desde oficina para la Sucursal 1 (P59): sin anticipo y con autorización", async () => {
    const cuerpo = { cliente_nombre: "PRUEBA WhatsApp", telefono: "5511111111", fecha_entrega: "2099-01-04", origen: "WHATSAPP", sucursal: "SUC1", renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "6" }] };
    expect((await e.nav.enc!.post("/api/pos/pedidos", { ...cuerpo, anticipo: efectivo("10"), autorizacion: CON })).datos.mensaje).toMatch(/se cobra en la caja/);
    expect((await e.nav.enc!.post("/api/pos/pedidos", { ...cuerpo, sucursal: "MAT", autorizacion: CON })).estado).toBe(403);
    const r = await e.nav.enc!.post("/api/pos/pedidos", { ...cuerpo, autorizacion: CON });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    const p = (await e.pool.query("SELECT origen, autorizo_sin_anticipo_id IS NOT NULL AS autorizado FROM pedido WHERE id = $1", [r.datos.id])).rows[0];
    expect(p).toEqual({ origen: "WHATSAPP", autorizado: true });
  });

  it("cancelar un pedido requiere autorización; el anticipo se devuelve en efectivo", async () => {
    const p = await caj().post("/api/pos/pedidos", { cliente_nombre: "PRUEBA Otro", fecha_entrega: "2099-01-02", renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "2" }], anticipo: efectivo("10") });
    expect((await caj().post(`/api/pos/pedidos/${p.datos.id}/cancelar`, { destino: "DEVUELTO", motivo: "Ya no lo quiere" })).estado).toBe(403);
    const r = await caj().post(`/api/pos/pedidos/${p.datos.id}/cancelar`, { destino: "DEVUELTO", motivo: "Ya no lo quiere", autorizacion: ENC });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos).toMatchObject({ anticipo: "10.00", destino: "DEVUELTO" });
  });
});

describe("cortes", () => {
  // Efectivo esperado: fondo 500 + ventas en efectivo (72 + 12 + 80) + anticipos (50 + 20 + 10)
  //                    − retiro 50 − devolución 14 − anticipo devuelto 10 = 670
  it("corte X: resumen del turno sin cerrarlo", async () => {
    const r = await caj().post("/api/pos/cortes", { tipo: "X" });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.resumen).toMatchObject({ efectivo_esperado: "670.00", ventas: 4, total: "262.00", retiros: "50.00", devoluciones: "14.00", anticipos: "80.00" });
    expect(r.datos.resumen.por_forma.map((f: any) => [f.clave, f.importe])).toEqual([["01", "164.00"], ["04", "28.00"]]);
  });

  it("corte Z: el cajero no lo cierra solo; con arqueo de $670 y autorización del encargado se cierra el turno", async () => {
    const den = [{ valor: "500", cantidad: 1 }, { valor: "100", cantidad: 1 }, { valor: "50", cantidad: 1 }, { valor: "20", cantidad: 1 }];
    expect((await caj().post("/api/pos/cortes", { tipo: "Z", denominaciones: den })).estado).toBe(403);
    expect((await caj().post("/api/pos/cortes", { tipo: "Z", denominaciones: [{ valor: "7", cantidad: 1 }], autorizacion: ENC })).estado).toBe(400);
    const r = await caj().post("/api/pos/cortes", { tipo: "Z", denominaciones: den, autorizacion: ENC });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos).toMatchObject({ contado: "670.00", esperado: "670.00", diferencia: "0.00" });
    expect((await vender({ renglones: [{ articulo: "PRUEBA-BOLILLO", cantidad: "1" }], pagos: [efectivo("3")] })).datos.error).toBe("sin_turno");
  });

  it("un faltante en el corte exige comentario", async () => {
    await caj().post("/api/pos/turno", { fondo: "100" });
    expect((await caj().post("/api/pos/cortes", { tipo: "Z", denominaciones: [{ valor: "50", cantidad: 1 }], autorizacion: ENC })).datos.mensaje).toMatch(/diferencia de \$-50.00/);
    const r = await caj().post("/api/pos/cortes", { tipo: "Z", denominaciones: [{ valor: "50", cantidad: 1 }], comentario: "Faltante en revisión", autorizacion: ENC });
    expect(r.datos.diferencia).toBe("-50.00");
  });
});

describe("venta sin conexión (P43)", () => {
  it("una venta hecha sin internet se registra al reconectar con su hora real y su folio provisional, sin duplicarse", async () => {
    await caj().post("/api/pos/turno", { fondo: "0" });
    const id = randomUUID();
    const cuerpo = { id, renglones: [{ articulo: "PRUEBA-BOLILLO", cantidad: "4" }], pagos: [efectivo("12")], sin_conexion: { fecha_caja: "2026-11-22T15:30:00-06:00", folio_local: "SC-CAJA-SUC1-1-0001" } };
    const r = await caj().post("/api/pos/ventas", cuerpo);
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect((await caj().post("/api/pos/ventas", cuerpo)).datos.repetida).toBe(true);
    const v = (await e.pool.query("SELECT sin_conexion, folio_local FROM venta WHERE id = $1", [id])).rows[0];
    expect(v).toEqual({ sin_conexion: true, folio_local: "SC-CAJA-SUC1-1-0001" });
  });
});

describe("oficina", () => {
  it("el contralor consulta ventas y cortes de todas las sucursales y exporta a Excel; el cajero no", async () => {
    const v = await e.nav.con!.get("/api/pos/ventas");
    expect(v.estado).toBe(200);
    expect(v.datos.ventas).toHaveLength(5);
    expect(v.datos.ventas.every((x: any) => x.costo !== undefined)).toBe(true);
    expect((await e.nav.con!.get("/api/pos/ventas?formato=xlsx")).datos).toBeInstanceOf(Uint8Array);
    const k = await e.nav.con!.get("/api/pos/cortes");
    expect(k.datos.cortes.filter((x: any) => x.tipo === "Z")).toHaveLength(2);
    expect((await caj().get("/api/pos/ventas?formato=xlsx")).estado).toBe(403);
  });

  it("el inventario cuadra con el kárdex y la bitácora está íntegra", async () => {
    expect((await e.pool.query("SELECT * FROM inventario_diferencias()")).rows).toEqual([]);
    expect((await e.pool.query("SELECT bitacora_auditoria_verificar() AS roto")).rows[0].roto).toBeNull();
  });
});

describe("contabilidad (Fase 7)", () => {
  it("todas las operaciones se contabilizan con las reglas de ejemplo, la balanza cuadra y el inventario contable es igual al kárdex", async () => {
    const r = await revisarContabilidad(e);
    const origenes = new Set(((await e.pool.query("SELECT DISTINCT origen FROM poliza")).rows).map((x: any) => x.origen));
    expect(origenes.size).toBeGreaterThan(1);
    void r;
  });
});
