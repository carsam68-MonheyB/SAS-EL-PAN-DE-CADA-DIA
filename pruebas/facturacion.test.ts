// Fase 8 de punta a punta contra Postgres real: solicitudes de factura el mismo
// día, datos para el portal del SAT (individual y global diaria), registro del
// XML descargado con cotejo contra los tickets, notas de crédito, cancelaciones
// autorizadas por el contralor, recibo de anticipo, conciliación y UUID en las
// pólizas. XML de PRUEBA (no timbrados por el SAT). Datos FICTICIOS.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { revisarContabilidad } from "./apoyo-contable";
import { prepararInventarios, type Entorno } from "./inventarios-apoyo";

let e: Entorno;
const ENC = { usuario: "prueba.enc", pin: "4826" };
const caj = () => e.nav.caj!;
const efectivo = (importe: string) => ({ forma: "01", importe });
const vender = async (renglones: { articulo: string; cantidad: string }[], pagos: { forma: string; importe: string; referencia?: string }[]) => {
  const r = await caj().post("/api/pos/ventas", { id: randomUUID(), renglones, pagos });
  expect(r.estado, JSON.stringify(r.datos)).toBe(200);
  return r.datos.folio as string;
};
const CLIENTE = { rfc: "PEGJ800101AB1", razon_social: "PRUEBA Juan Pérez", regimen_fiscal: "612", codigo_postal: "06000", uso_cfdi: "G03", correo: "prueba@example.com" };
const xmlPrueba = async (cuerpo: Record<string, unknown>) => {
  const r = await e.nav.cnt!.post("/api/facturacion/xml/prueba", cuerpo);
  expect(r.estado, JSON.stringify(r.datos)).toBe(200);
  return r.datos.xml as string;
};
const uuidDe = (xml: string) => /UUID="([0-9A-F-]{36})"/.exec(xml)![1]!;
let hoy: string;
let ayer: string;
const t: Record<string, string> = {};

beforeAll(async () => {
  e = await prepararInventarios("erp_prueba_facturacion");
  await e.cargar("con", "causas_merma", "fase-3/29-causas-merma.txt");
  const c = await e.cargar("jpr", "inventario_inicial", "fase-6/32-inventario-inicial-sucursal.txt");
  expect((await e.nav.con!.post(`/api/cargas/${c.id}/autorizar`)).estado).toBe(200);
  await e.cargar("cnt", "sat", "fase-8/80-sat-receptor.txt");
  await e.pool.query(
    `INSERT INTO precio_venta (articulo_id, sucursal_id, precio, vigente_desde)
     SELECT a.id, NULL, x.precio, (now() AT TIME ZONE 'America/Mexico_City')::date
       FROM (VALUES ('PRUEBA-CONCHA-V', 14.00), ('PRUEBA-CONCHA-C', 15.00), ('PRUEBA-BOLILLO', 3.00)) AS x(art, precio) JOIN articulo a ON a.clave = x.art`,
  );
  for (const [rol, pin] of [["caj", "4821"], ["enc", ENC.pin]] as const) {
    expect((await e.nav[rol]!.post("/api/auth/mi-pin", { password: e.password, pin })).estado).toBe(200);
  }
  const est = await caj().get("/api/pos/estado");
  expect((await caj().post("/api/auth/caja", { caja_id: est.datos.cajas[0].id })).estado).toBe(200);
  expect((await caj().post("/api/pos/turno", { fondo: "500" })).estado).toBe(200);
  hoy = est.datos.hoy ?? (await e.pool.query("SELECT (now() AT TIME ZONE 'America/Mexico_City')::date::text AS d")).rows[0].d;
  ayer = (await e.pool.query("SELECT ($1::date - 1)::text AS d", [hoy])).rows[0].d;
  t.v1 = await vender([{ articulo: "PRUEBA-CONCHA-V", cantidad: "3" }, { articulo: "PRUEBA-BOLILLO", cantidad: "10" }], [efectivo("100")]); // $72
  t.v2 = await vender([{ articulo: "PRUEBA-CONCHA-V", cantidad: "2" }], [{ forma: "04", importe: "28", referencia: "AUT-1" }]); // $28
  t.v3 = await vender([{ articulo: "PRUEBA-BOLILLO", cantidad: "5" }], [efectivo("15")]); // $15, se pasa a ayer
  // Ticket de ayer (sin factura global): solo se puede fechar así en la prueba.
  await e.pool.query("ALTER TABLE venta DISABLE TRIGGER venta_validar");
  await e.pool.query("UPDATE venta SET fecha_negocio = $2 WHERE folio = $1", [t.v3, ayer]);
  await e.pool.query("ALTER TABLE venta ENABLE TRIGGER venta_validar");
}, 180_000);

describe("recibo de anticipo (P64)", () => {
  it("el anticipo y cada abono tienen su recibo, que no es factura; al entregar se factura todo", async () => {
    const p = await caj().post("/api/pos/pedidos", {
      cliente_nombre: "PRUEBA Cliente", fecha_entrega: "2099-01-01", renglones: [{ articulo: "PRUEBA-CONCHA-C", cantidad: "4" }], anticipo: { forma: "28", importe: "20", referencia: "AUT-2" },
    });
    expect(p.estado, JSON.stringify(p.datos)).toBe(200);
    expect(p.datos.anticipo.recibo).toMatchObject({ folio: "REC-000001", pedido: p.datos.folio, importe: "20.00", total: "60.00", anticipado: "20.00", saldo: "40.00", forma: "Tarjeta de débito" });
    expect(p.datos.anticipo.recibo.leyenda).toMatch(/no es un comprobante fiscal/);
    const a = await caj().post(`/api/pos/pedidos/${p.datos.id}/abonar`, efectivo("10"));
    expect(a.datos.recibo).toMatchObject({ folio: "REC-000002", anticipado: "30.00", saldo: "30.00" });
    expect((await e.nav.enc!.get("/api/pos/anticipos/REC-000001")).datos).toMatchObject({ anticipado: "20.00", saldo: "40.00" });
    const v = await caj().post(`/api/pos/pedidos/${p.datos.id}/entregar`, { venta_id: randomUUID(), pagos: [efectivo("30")] });
    expect(v.estado, JSON.stringify(v.datos)).toBe(200);
    t.v4 = v.datos.folio;
  });
});

describe("solicitud de factura", () => {
  it("el cajero no tiene acceso; el encargado consulta el ticket de su sucursal", async () => {
    expect((await caj().get(`/api/facturacion/tickets/${t.v1}`)).estado).toBe(403);
    const r = await e.nav.enc!.get(`/api/facturacion/tickets/${t.v1}`);
    expect(r.datos).toMatchObject({ folio: t.v1, se_puede_solicitar: true, neto: { total: "72.00" } });
  });

  it("valida RFC, régimen y uso contra el catálogo del SAT; con RFC genérico no se pide", async () => {
    const enc = e.nav.enc!;
    expect((await enc.post("/api/facturacion/solicitudes", { ...CLIENTE, venta: t.v1, rfc: "XAXX010101000" })).datos.mensaje).toMatch(/genérico/);
    expect((await enc.post("/api/facturacion/solicitudes", { ...CLIENTE, venta: t.v1, rfc: "MAL" })).estado).toBe(400);
    expect((await enc.post("/api/facturacion/solicitudes", { ...CLIENTE, venta: t.v1, regimen_fiscal: "999" })).datos.mensaje).toMatch(/c_RegimenFiscal/);
    expect((await enc.post("/api/facturacion/solicitudes", { ...CLIENTE, venta: t.v1, uso_cfdi: "Z99" })).datos.mensaje).toMatch(/c_UsoCFDI/);
    const s = await enc.post("/api/facturacion/solicitudes", { ...CLIENTE, venta: t.v1 });
    expect(s.estado, JSON.stringify(s.datos)).toBe(200);
    expect(s.datos).toMatchObject({ folio: "SOL-000001", ticket: t.v1, total: "72.00" });
    expect((await enc.post("/api/facturacion/solicitudes", { ...CLIENTE, venta: t.v1 })).datos.mensaje).toMatch(/ya tiene la solicitud/);
    // Los datos del cliente se recuerdan para la siguiente vez.
    expect((await enc.get(`/api/facturacion/clientes/${CLIENTE.rfc}`)).datos.cliente).toMatchObject({ razon_social: "PRUEBA JUAN PÉREZ", uso_cfdi: "G03" });
  });

  it("P49: se pide el mismo día; con 1 día de plazo configurado, el ticket de ayer sí se acepta", async () => {
    const r = await e.nav.enc!.get(`/api/facturacion/tickets/${t.v3}`);
    expect(r.datos).toMatchObject({ se_puede_solicitar: false, motivo: "La factura se pide el mismo día de la compra." });
    await e.pool.query("UPDATE configuracion SET valor = '1' WHERE clave = 'fiscal.dias_solicitud'");
    expect((await e.nav.enc!.get(`/api/facturacion/tickets/${t.v3}`)).datos.se_puede_solicitar).toBe(true);
    await e.pool.query("UPDATE configuracion SET valor = '0' WHERE clave = 'fiscal.dias_solicitud'");
  });

  it("los datos fiscales no se modifican: se cancela la solicitud", async () => {
    await expect(e.pool.query("UPDATE solicitud_factura SET rfc = 'AAA010101AAA'")).rejects.toThrow(/no se modifican/);
    await expect(e.pool.query("DELETE FROM solicitud_factura")).rejects.toThrow();
  });
});

describe("factura individual", () => {
  let xml: string;
  it("datos para capturar en el portal: receptor, conceptos por renglón, forma de pago y totales", async () => {
    const p = await e.nav.cnt!.get("/api/facturacion/portal/individual?solicitudes=SOL-000001");
    expect(p.estado, JSON.stringify(p.datos)).toBe(200);
    expect(p.datos.receptor).toMatchObject({ rfc: CLIENTE.rfc, regimen_fiscal: "612", uso_cfdi: "G03", codigo_postal: "06000" });
    expect(p.datos).toMatchObject({ metodo_pago: "PUE", forma_pago: "01", totales: { total: "72.00" }, faltan_datos: [] });
    expect(p.datos.conceptos.map((x: any) => [x.no_identificacion, x.clave_prod_serv, x.cantidad, x.importe])).toEqual([["PRUEBA-CONCHA-V", "50181900", "3", "42.00"], ["PRUEBA-BOLILLO", "50181900", "10", "30.00"]]);
  });

  it("el XML de otro RFC o con otros importes no se registra; el bueno sí y la solicitud queda facturada", async () => {
    xml = await xmlPrueba({ clase: "NOMINATIVA", solicitudes: ["SOL-000001"] });
    const otroRfc = xml.replace(`Rfc="${CLIENTE.rfc}"`, 'Rfc="AAA010101AAA"');
    const r1 = await e.nav.enc!.post("/api/facturacion/xml/revisar", { clase: "NOMINATIVA", xml: otroRfc, solicitudes: ["SOL-000001"] });
    expect(r1.datos.errores.join(" ")).toMatch(/AAA010101AAA/);
    const caro = xml.replace(' Total="72.00"', ' Total="80.00"');
    const r2 = await e.nav.enc!.post("/api/facturacion/xml/revisar", { clase: "NOMINATIVA", xml: caro, solicitudes: ["SOL-000001"] });
    expect(r2.datos.errores).toContain("Total: los tickets suman $72.00 y la factura dice $80.00.");
    // RFC de la empresa configurado: el XML emitido por otro RFC no entra.
    await e.pool.query("UPDATE configuracion SET valor = 'PRU010101AAA' WHERE clave = 'empresa.rfc'");
    expect((await e.nav.enc!.post("/api/facturacion/xml/revisar", { clase: "NOMINATIVA", xml, solicitudes: ["SOL-000001"] })).datos.errores.join(" ")).toMatch(/no la emitió la empresa/);
    await e.pool.query("UPDATE configuracion SET valor = '' WHERE clave = 'empresa.rfc'");
    const ok = await e.nav.enc!.post("/api/facturacion/xml", { clase: "NOMINATIVA", xml, solicitudes: ["SOL-000001"] });
    expect(ok.estado, JSON.stringify(ok.datos)).toBe(200);
    expect(ok.datos).toMatchObject({ uuid: uuidDe(xml), total: "72.00", tickets: [{ folio: t.v1, total: "72.00" }] });
    const s = await e.nav.enc!.get("/api/facturacion/solicitudes");
    expect(s.datos.solicitudes.find((x: any) => x.folio === "SOL-000001")).toMatchObject({ estatus: "FACTURADA", uuid: uuidDe(xml) });
    expect((await e.nav.enc!.post("/api/facturacion/xml", { clase: "NOMINATIVA", xml, solicitudes: ["SOL-000001"] })).estado).toBe(409);
    expect((await e.nav.enc!.get(`/api/facturacion/tickets/${t.v1}`)).datos.motivo).toMatch(/ya está en la factura individual/);
  });

  it("solo el contador y el encargado registran XML; el XML se descarga tal cual", async () => {
    expect((await e.nav.con!.post("/api/facturacion/xml/revisar", { clase: "NOMINATIVA", xml, solicitudes: ["SOL-000001"] })).estado).toBe(403);
    const r = await e.nav.con!.get(`/api/facturacion/facturas/${uuidDe(xml)}/xml`);
    expect(r.estado).toBe(200);
  });

  it("la factura registrada no se modifica ni se borra", async () => {
    await expect(e.pool.query("UPDATE cfdi_emitido SET total = 1")).rejects.toThrow(/no se modifica/);
    await expect(e.pool.query("DELETE FROM cfdi_emitido")).rejects.toThrow();
    await expect(e.pool.query("UPDATE cfdi_venta SET total = 1")).rejects.toThrow();
  });
});

describe("factura global diaria", () => {
  let global: string;
  it("incluye los tickets del día no facturados; los que tienen solicitud pendiente van aparte", async () => {
    expect((await e.nav.enc!.post("/api/facturacion/solicitudes", { ...CLIENTE, venta: t.v2 })).estado).toBe(200); // SOL-000002
    // El encargado solo hace la global de su sucursal.
    expect((await e.nav.enc!.get(`/api/facturacion/portal/global?fecha=${hoy}`)).estado).toBe(403);
    const g = await e.nav.enc!.get(`/api/facturacion/portal/global?fecha=${hoy}&sucursal=SUC1`);
    expect(g.estado, JSON.stringify(g.datos)).toBe(200);
    expect(g.datos).toMatchObject({ tickets: 1, ya_facturados: 1, receptor: { rfc: "XAXX010101000" }, informacion_global: { periodicidad: "01", meses: hoy.slice(5, 7) } });
    expect(g.datos.con_solicitud).toEqual([{ folio: t.v2, solicitud: "SOL-000002", total: "28.00" }]);
    expect(g.datos.conceptos.map((x: any) => [x.no_identificacion, x.clave_prod_serv, x.clave_unidad, x.importe])).toEqual([[t.v4, "01010101", "ACT", "60.00"]]);
    // El anticipo del pedido se declara con la forma en que se cobró: débito $20 + efectivo $10 + efectivo $30.
    expect(g.datos.forma_pago).toBe("01");
  });

  it("se registra con el XML del portal; después ya no se aceptan solicitudes de esos tickets", async () => {
    const xml = await xmlPrueba({ clase: "GLOBAL", fecha: hoy, sucursal: "SUC1" });
    global = uuidDe(xml);
    const malo = xml.replace('Periodicidad="01"', 'Periodicidad="04"');
    expect((await e.nav.cnt!.post("/api/facturacion/xml/revisar", { clase: "GLOBAL", xml: malo })).datos.errores.join(" ")).toMatch(/diaria/);
    const r = await e.nav.cnt!.post("/api/facturacion/xml", { clase: "GLOBAL", xml });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos).toMatchObject({ fecha_negocio: hoy, total: "60.00", tickets: [{ folio: t.v4 }] });
    expect((await e.nav.enc!.get(`/api/facturacion/tickets/${t.v4}`)).datos.motivo).toMatch(/factura global/);
    // El ticket con solicitud sigue pudiéndose facturar aparte.
    expect((await e.nav.cnt!.get("/api/facturacion/portal/individual?solicitudes=SOL-000002")).datos.tickets[0].facturable).toBe(true);
  });

  it("una global que trae un ticket ya facturado no se registra", async () => {
    const xml = await xmlPrueba({ clase: "NOMINATIVA", solicitudes: ["SOL-000002"] });
    // Se hace pasar por global con el folio de un ticket ya facturado.
    const falsa = xml.replace(`Rfc="${CLIENTE.rfc}"`, 'Rfc="XAXX010101000"').replace('NoIdentificacion="PRUEBA-CONCHA-V"', `NoIdentificacion="${t.v1}"`)
      .replace("<cfdi:Emisor", `<cfdi:InformacionGlobal Periodicidad="01" Meses="${hoy.slice(5, 7)}" Año="${hoy.slice(0, 4)}"/>\n  <cfdi:Emisor`);
    const r = await e.nav.cnt!.post("/api/facturacion/xml/revisar", { clase: "GLOBAL", xml: falsa });
    expect(r.datos.errores.join(" ")).toMatch(/ya está en la factura individual/);
  });

  it("solo existe un recorrido por factura: el detalle muestra sus tickets", async () => {
    const d = await e.nav.con!.get(`/api/facturacion/facturas/${global}`);
    expect(d.datos.tickets.map((x: any) => [x.folio, x.total])).toEqual([[t.v4, "60.00"]]);
    expect(d.datos.cfdi.xml).toBeUndefined();
  });
});

describe("devoluciones y notas de crédito", () => {
  it("una devolución de un ticket facturado pide nota de crédito; al registrarla deja de avisar", async () => {
    const d = await caj().post("/api/pos/devoluciones", { venta: t.v1, motivo: "Cliente la cambió", regresa_inventario: true, renglones: [{ orden: 1, cantidad: "1" }], autorizacion: ENC });
    expect(d.estado, JSON.stringify(d.datos)).toBe(200);
    const c1 = await e.nav.con!.get(`/api/facturacion/conciliacion?desde=${ayer}&hasta=${hoy}`);
    expect(c1.datos.alertas.devoluciones_sin_nota.map((x: any) => [x.folio, x.por_acreditar])).toEqual([[t.v1, "14.00"]]);
    const uuid = (await e.pool.query("SELECT uuid_cfdi FROM cfdi_emitido WHERE clase = 'NOMINATIVA'")).rows[0].uuid_cfdi;
    const nota = await xmlPrueba({ clase: "EGRESO", relacionado: uuid, importe: "14.00" });
    const r = await e.nav.cnt!.post("/api/facturacion/xml", { clase: "EGRESO", xml: nota });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.relacionado).toBe(uuid);
    const c2 = await e.nav.con!.get(`/api/facturacion/conciliacion?desde=${ayer}&hasta=${hoy}`);
    expect(c2.datos.alertas.devoluciones_sin_nota).toEqual([]);
  });
});

describe("cancelación (la captura el contador, la autoriza el contralor)", () => {
  let uuid: string;
  it("se registra la factura de SOL-000002 y luego se cancela", async () => {
    const xml = await xmlPrueba({ clase: "NOMINATIVA", solicitudes: ["SOL-000002"] });
    uuid = uuidDe(xml);
    expect((await e.nav.cnt!.post("/api/facturacion/xml", { clase: "NOMINATIVA", xml, solicitudes: ["SOL-000002"] })).estado).toBe(200);
    expect((await e.nav.cnt!.post(`/api/facturacion/facturas/${uuid}/cancelar`, { motivo_sat: "01", nota: "Error en el RFC" })).datos.mensaje).toMatch(/sustituye/);
    expect((await e.nav.enc!.post(`/api/facturacion/facturas/${uuid}/cancelar`, { motivo_sat: "02", nota: "Error" })).estado).toBe(403);
    const s = await e.nav.cnt!.post(`/api/facturacion/facturas/${uuid}/cancelar`, { motivo_sat: "02", nota: "Datos del cliente equivocados" });
    expect(s.estado, JSON.stringify(s.datos)).toBe(200);
    expect((await e.nav.cnt!.post(`/api/facturacion/facturas/${uuid}/autorizar-cancelacion`, {})).estado).toBe(403);
    const a = await e.nav.con!.post(`/api/facturacion/facturas/${uuid}/autorizar-cancelacion`, {});
    expect(a.estado, JSON.stringify(a.datos)).toBe(200);
    expect(a.datos).toMatchObject({ estatus: "CANCELADA", solicitudes_pendientes: ["SOL-000002"] });
    // El ticket se puede volver a facturar.
    expect((await e.nav.cnt!.get("/api/facturacion/portal/individual?solicitudes=SOL-000002")).datos.tickets[0].facturable).toBe(true);
    await expect(e.pool.query("UPDATE cfdi_emitido SET estatus = 'VIGENTE' WHERE uuid_cfdi = $1", [uuid])).rejects.toThrow(/ya está cancelada/);
  });
});

describe("conciliación vendido contra facturado", () => {
  it("por día: lo vendido, lo facturado individual y global, y el día anterior sin global", async () => {
    const r = await e.nav.con!.get(`/api/facturacion/conciliacion?desde=${ayer}&hasta=${hoy}`);
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    const dia = r.datos.dias.find((x: any) => x.fecha === hoy);
    // Hoy: 72 − 14 devuelto + 28 + 60 = 146; individual 72 (v1), global 60 (v4); v2 sin facturar (su factura se canceló).
    expect([dia.vendido, dia.individual, dia.global, dia.sin_facturar, dia.importe_sin_facturar, dia.solicitudes_pendientes]).toEqual(["146.00", "72.00", "60.00", 1, "28.00", 1]);
    expect(r.datos.alertas.dias_sin_global).toEqual([{ fecha: ayer, sucursal: "SUC1", tickets: 1, importe: "15.00" }]);
    const x = await e.nav.con!.get(`/api/facturacion/conciliacion?desde=${ayer}&hasta=${hoy}&formato=xlsx`);
    expect(x.estado).toBe(200);
  });
});

describe("contabilidad", () => {
  it("todo se contabiliza y la póliza de la venta muestra el UUID de su factura", async () => {
    await revisarContabilidad(e);
    const p = (await e.pool.query("SELECT p.id FROM poliza p JOIN venta v ON v.id = p.origen_id WHERE p.origen = 'VENTA' AND v.folio = $1", [t.v1])).rows[0];
    const d = await e.nav.cnt!.get(`/api/contabilidad/polizas/${p.id}`);
    const uuid = (await e.pool.query("SELECT uuid_cfdi FROM cfdi_emitido WHERE clase = 'NOMINATIVA' AND estatus = 'VIGENTE'")).rows[0].uuid_cfdi;
    expect(d.datos.cfdis).toEqual([expect.objectContaining({ uuid, clase: "NOMINATIVA", rfc: CLIENTE.rfc })]);
  });
});

describe("decisión: los datos se piden el día de la compra y la factura llega por correo al día siguiente", () => {
  it("el correo es obligatorio en la solicitud", async () => {
    const { correo: _c, ...sinCorreo } = CLIENTE;
    const r = await e.nav.enc!.post("/api/facturacion/solicitudes", { ...sinCorreo, venta: t.v3 });
    expect(r.estado).toBe(400);
  });

  it("se registra cuándo se envió la factura; solo si ya está facturada y una sola vez", async () => {
    expect((await e.nav.cnt!.post("/api/facturacion/solicitudes/SOL-000002/enviada")).datos.mensaje).toMatch(/Primero registra la factura/);
    const r = await e.nav.cnt!.post("/api/facturacion/solicitudes/SOL-000001/enviada");
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos).toMatchObject({ correo: "prueba@example.com", enviada: true });
    expect((await e.nav.cnt!.post("/api/facturacion/solicitudes/SOL-000001/enviada")).estado).toBe(409);
    const l = await e.nav.cnt!.get("/api/facturacion/solicitudes");
    expect(l.datos.solicitudes.find((x: any) => x.folio === "SOL-000001")).toMatchObject({ envio: "prueba.cnt", atrasada: false });
  });

  it("un ticket con solicitud no cuenta para la global; pasado el plazo, la solicitud sale atrasada", async () => {
    await e.pool.query("UPDATE configuracion SET valor = '1' WHERE clave = 'fiscal.dias_solicitud'");
    const s = await e.nav.enc!.post("/api/facturacion/solicitudes", { ...CLIENTE, venta: t.v3 });
    expect(s.estado, JSON.stringify(s.datos)).toBe(200);
    await e.pool.query("UPDATE configuracion SET valor = '0' WHERE clave = 'fiscal.dias_solicitud'");
    let r = await e.nav.con!.get(`/api/facturacion/conciliacion?desde=${ayer}&hasta=${hoy}`);
    expect(r.datos.alertas.dias_sin_global).toEqual([]);
    expect(r.datos.alertas.solicitudes_atrasadas).toEqual([]);
    await e.pool.query("UPDATE configuracion SET valor = '0' WHERE clave = 'fiscal.dias_entrega_factura'");
    r = await e.nav.con!.get(`/api/facturacion/conciliacion?desde=${ayer}&hasta=${hoy}`);
    expect(r.datos.alertas.solicitudes_atrasadas.map((x: any) => [x.folio, x.estatus])).toEqual([[s.datos.folio, "PENDIENTE"]]);
    await e.pool.query("UPDATE configuracion SET valor = '1' WHERE clave = 'fiscal.dias_entrega_factura'");
  });
});
