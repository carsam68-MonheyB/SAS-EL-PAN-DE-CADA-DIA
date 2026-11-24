// XML del SAT (opción 1): el contador sube el ZIP de la descarga masiva del portal;
// el sistema guarda cada XML una vez, rechaza lo que no es de la empresa y lo compara
// con lo registrado en Facturación y Compras. Datos FICTICIOS (PRUEBA).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { prepararInventarios, type Entorno } from "./inventarios-apoyo";

let e: Entorno;
const zip = readFileSync("datos-ejemplo/fase-8/81-descarga-SAT-PRUEBA.zip").toString("base64");
const NOV = "desde=2026-11-01&hasta=2026-11-30";

beforeAll(async () => {
  e = await prepararInventarios("erp_prueba_xml_sat");
}, 180_000);

describe("XML del SAT", () => {
  it("solo el contador sube el ZIP; el encargado no ve las facturas de la empresa", async () => {
    expect((await e.nav.enc!.get(`/api/facturacion/sat/conciliacion?${NOV}`)).estado).toBe(403);
    expect((await e.nav.enc!.post("/api/facturacion/sat/cargas", { nombre: "x.zip", contenido: zip })).estado).toBe(403);
    expect((await e.nav.con!.post("/api/facturacion/sat/cargas", { nombre: "x.zip", contenido: zip })).estado).toBe(403);
    expect((await e.nav.con!.get(`/api/facturacion/sat/conciliacion?${NOV}`)).estado).toBe(200);
  });

  it("lee el ZIP: 2 emitidas y 2 recibidas; rechaza la de otra empresa, el XML dañado y lo que no es XML", async () => {
    const r = await e.nav.cnt!.post("/api/facturacion/sat/cargas", { nombre: "81-descarga-SAT-PRUEBA.zip", contenido: zip });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos).toMatchObject({ folio: "SAT-000001", rfc: "EKU9003173C9", rfc_deducido: true, archivos: 7, nuevos: 4, repetidos: 0 });
    const motivos = r.datos.rechazos.map((x: any) => `${x.archivo}: ${x.motivo}`).join("\n");
    expect(motivos).toMatch(/otra-empresa\.xml: No es de la empresa/);
    expect(motivos).toMatch(/danado\.xml/);
    expect(motivos).toMatch(/LEEME\.txt: No es un XML/);
  });

  it("subir el mismo ZIP otra vez no duplica nada", async () => {
    const r = await e.nav.cnt!.post("/api/facturacion/sat/cargas", { nombre: "otra-vez.zip", contenido: zip });
    expect(r.datos).toMatchObject({ folio: "SAT-000002", nuevos: 0, repetidos: 4 });
    expect((await e.pool.query("SELECT count(*)::int AS n FROM cfdi_sat")).rows[0].n).toBe(4);
    expect((await e.nav.cnt!.get("/api/facturacion/sat/cargas")).datos.cargas).toHaveLength(2);
  });

  it("compara contra el sistema: lo que está en el SAT y falta registrar, y lo registrado que no vino en el SAT", async () => {
    // Una factura emitida registrada en el sistema que coincide con el ZIP, y otra que no vino en el ZIP.
    const usuario = (await e.pool.query("SELECT id FROM usuario WHERE usuario = 'prueba.cnt'")).rows[0].id;
    for (const [uuid, total, fecha] of [["00000000-0000-4000-8000-0000000000E1", "1250.75", "2026-11-20"], ["00000000-0000-4000-8000-0000000000B9", "99.00", "2026-11-23"]]) {
      await e.pool.query(
        `INSERT INTO cfdi_emitido (uuid_cfdi, clase, tipo_comprobante, fecha_emision, fecha_negocio, receptor_rfc, subtotal, iva, ieps, total, xml, xml_sha256, registrado_por)
         VALUES ($1, 'GLOBAL', 'I', $3::date + time '19:30', $3, 'XAXX010101000', $2, 0, 0, $2, '<x/>', 'x', $4)`,
        [uuid, total, fecha, usuario],
      );
    }
    const r = (await e.nav.cnt!.get(`/api/facturacion/sat/conciliacion?${NOV}`)).datos;
    expect(r.resumen).toEqual({ registrado: 1, falta_registrar: 3, no_en_sat: 1 });
    const por = Object.fromEntries(r.filas.map((x: any) => [x.uuid, x]));
    expect(por["00000000-0000-4000-8000-0000000000E1"]).toMatchObject({ situacion: "REGISTRADO", total_sat: "1250.75", total_sistema: "1250.75", direccion: "EMITIDO" });
    expect(por["00000000-0000-4000-8000-0000000000F1"]).toMatchObject({ situacion: "FALTA_REGISTRAR", direccion: "RECIBIDO", emisor_rfc: "XAXX010101000" });
    expect(por["00000000-0000-4000-8000-0000000000B9"]).toMatchObject({ situacion: "NO_EN_SAT" });
    const rec = (await e.nav.cnt!.get(`/api/facturacion/sat/conciliacion?${NOV}&direccion=RECIBIDO`)).datos;
    expect(rec.filas.map((x: any) => x.uuid).sort()).toEqual(["00000000-0000-4000-8000-0000000000F1", "00000000-0000-4000-8000-0000000000F2"]);
    expect((await e.nav.cnt!.get(`/api/facturacion/sat/conciliacion?${NOV}&formato=xlsx`)).estado).toBe(200);
  });

  it("el XML se descarga para registrarlo en Facturación o Compras; no se modifica ni se borra", async () => {
    const r = await e.nav.cnt!.get("/api/facturacion/sat/00000000-0000-4000-8000-0000000000F2/xml");
    expect(r.estado).toBe(200);
    expect(new TextDecoder().decode(r.datos)).toMatch(/PRUEBA Mantequilla/);
    expect((await e.nav.cnt!.get("/api/facturacion/sat/00000000-0000-4000-8000-0000000000FF/xml")).estado).toBe(404);
    await expect(e.pool.query("DELETE FROM cfdi_sat")).rejects.toThrow();
    await expect(e.pool.query("UPDATE cfdi_sat SET total = 0")).rejects.toThrow();
  });

  it("con el RFC de la empresa configurado, lo que no es de ese RFC se rechaza; un archivo que no es ZIP se explica", async () => {
    await e.pool.query("UPDATE configuracion SET valor = 'AAA010101AAA' WHERE clave = 'empresa.rfc'");
    const r = await e.nav.cnt!.post("/api/facturacion/sat/cargas", { nombre: "81.zip", contenido: zip });
    expect(r.datos).toMatchObject({ rfc: "AAA010101AAA", rfc_deducido: false, nuevos: 1 });
    expect(r.datos.rechazos.filter((x: any) => /No es de la empresa/.test(x.motivo))).toHaveLength(4);
    await e.pool.query("UPDATE configuracion SET valor = '' WHERE clave = 'empresa.rfc'");
    const malo = await e.nav.cnt!.post("/api/facturacion/sat/cargas", { nombre: "x.zip", contenido: Buffer.from("no soy zip").toString("base64") });
    expect(malo.estado).toBe(400);
    expect(malo.datos.mensaje).toMatch(/no es un ZIP válido/);
  });
});
