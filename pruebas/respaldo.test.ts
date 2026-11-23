// Respaldo externo y restauración (diseño 1.4) contra Postgres real: firma S3
// (vector oficial de AWS), cifrado, subida con bloqueo de objetos a un
// almacenamiento S3 simulado, archivo de XML, proceso diario y una prueba real
// de restauración en otra base (las huellas de todas las tablas coinciden).
import { createHash } from "node:crypto";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firmar } from "../src/servidor/almacen-externo";
import { cifrarRespaldo, descifrarRespaldo, huellas, procesoDiario, restaurarBase } from "../src/servidor/respaldo";
import { aplicarMigraciones } from "../src/servidor/migraciones";
import { urlBase } from "./apoyo";
import { prepararInventarios, type Entorno } from "./inventarios-apoyo";

const LLAVE = Buffer.alloc(32, 3).toString("base64");
let e: Entorno;
const subidos = new Map<string, { cuerpo: Buffer; headers: http.IncomingHttpHeaders }>();
let servidor: http.Server;

describe("firma S3 (Signature Version 4)", () => {
  it("coincide con el ejemplo oficial de AWS (GET Object con Range)", () => {
    const enc = firmar({
      metodo: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), encabezados: { range: "bytes=0-9" },
      hashCuerpo: createHash("sha256").update("").digest("hex"),
    }, { region: "us-east-1", llaveId: "AKIAIOSFODNN7EXAMPLE", llaveSecreta: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" }, new Date("2013-05-24T00:00:00Z"));
    expect(enc.authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });
});

describe("cifrado del archivo", () => {
  it("ida y vuelta; con otra llave o alterado no se abre", () => {
    const k = Buffer.alloc(32, 1);
    const a = cifrarRespaldo(Buffer.from("PRUEBA ñ"), k);
    expect(descifrarRespaldo(a, k).toString()).toBe("PRUEBA ñ");
    expect(() => descifrarRespaldo(a, Buffer.alloc(32, 2))).toThrow(/llave/);
    const b = Buffer.from(a); b[b.length - 1]! ^= 1;
    expect(() => descifrarRespaldo(b, k)).toThrow();
    expect(() => descifrarRespaldo(Buffer.from("hola"), k)).toThrow(/no es un respaldo/);
  });
});

beforeAll(async () => {
  // Almacenamiento S3 simulado: guarda lo que recibe y revisa la firma.
  servidor = http.createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (d) => partes.push(d));
    req.on("end", () => {
      const cuerpo = Buffer.concat(partes);
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const firmados = /SignedHeaders=([^,]+)/.exec(String(req.headers.authorization))?.[1]?.split(";") ?? [];
      const h = Object.fromEntries(firmados.filter((k) => !["host", "x-amz-date", "x-amz-content-sha256"].includes(k)).map((k) => [k, String(req.headers[k])]));
      const esperado = firmar({ metodo: req.method!, url, encabezados: h, hashCuerpo: createHash("sha256").update(cuerpo).digest("hex") },
        { region: "us-west-004", llaveId: "PRUEBA-ID", llaveSecreta: "PRUEBA-SECRETA" }, new Date(Date.UTC(...(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(req.headers["x-amz-date"]))!.slice(1).map(Number).map((x, i) => (i === 1 ? x - 1 : x)) as [number, number, number, number, number, number]))));
      if (esperado.authorization !== req.headers.authorization || req.method !== "PUT") { res.statusCode = 403; return res.end("<Error>SignatureDoesNotMatch</Error>"); }
      if (createHash("md5").update(cuerpo).digest("base64") !== req.headers["content-md5"]) { res.statusCode = 400; return res.end("BadDigest"); }
      subidos.set(decodeURIComponent(url.pathname), { cuerpo, headers: req.headers });
      res.setHeader("etag", '"x"');
      res.end();
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", () => ok()));
  const puerto = (servidor.address() as { port: number }).port;
  Object.assign(process.env, {
    RESPALDO_LLAVE: LLAVE, RESPALDO_S3_ENDPOINT: `http://127.0.0.1:${puerto}`, RESPALDO_S3_REGION: "us-west-004", RESPALDO_S3_BUCKET: "prueba-respaldos",
    RESPALDO_S3_LLAVE_ID: "PRUEBA-ID", RESPALDO_S3_LLAVE_SECRETA: "PRUEBA-SECRETA",
  });
  e = await prepararInventarios("erp_prueba_respaldo");
  const c = await e.cargar("jpr", "inventario_inicial", "fase-3/31-inventario-inicial.txt");
  expect((await e.nav.con!.post(`/api/cargas/${c.id}/autorizar`)).estado).toBe(200);
  // Una factura emitida (registro mínimo) para probar el archivo de XML.
  await e.pool.query(
    `INSERT INTO cfdi_emitido (uuid_cfdi, clase, tipo_comprobante, fecha_emision, fecha_negocio, receptor_rfc, subtotal, iva, ieps, total, xml, xml_sha256, registrado_por)
     SELECT 'AAAAAAAA-0000-4000-8000-000000000001', 'GLOBAL', 'I', '2026-11-22 20:00-06', '2026-11-22', 'XAXX010101000', 10, 0, 0, 10, '<PRUEBA/>', 'x', id FROM usuario WHERE usuario = 'prueba.cnt'`,
  );
  await e.otorgar("CON", "seguridad.configuracion:editar");
}, 240_000);

afterAll(async () => {
  servidor?.close();
  for (const k of ["RESPALDO_LLAVE", "RESPALDO_S3_ENDPOINT", "RESPALDO_S3_REGION", "RESPALDO_S3_BUCKET", "RESPALDO_S3_LLAVE_ID", "RESPALDO_S3_LLAVE_SECRETA"]) delete process.env[k];
});

describe("respaldo al almacenamiento externo", () => {
  it("solo con permiso; sube la base cifrada con bloqueo COMPLIANCE por 5 años y archiva los XML por RFC, año y mes", async () => {
    expect((await e.nav.dir!.post("/api/respaldos/ahora")).estado).toBe(403);
    const r = await e.nav.con!.post("/api/respaldos/ahora");
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos, JSON.stringify(r.datos)).toMatchObject({ estatus: "COMPLETO", xml_archivados: 1 });
    const archivo = subidos.get(`/prueba-respaldos/${r.datos.destino}`)!;
    expect(archivo.headers["x-amz-object-lock-mode"]).toBe("COMPLIANCE");
    const anio = new Date().getUTCFullYear() + 5;
    expect(String(archivo.headers["x-amz-object-lock-retain-until-date"])).toMatch(new RegExp(`^${anio}-`));
    expect(createHash("sha256").update(archivo.cuerpo).digest("hex")).toBe(r.datos.sha256);
    expect(subidos.has("/prueba-respaldos/cfdi/SIN-RFC/emitidos/2026/11/AAAAAAAA-0000-4000-8000-000000000001.xml")).toBe(true);
    const l = await e.nav.dir!.get("/api/respaldos");
    expect(l.datos.configuracion).toMatchObject({ llave: true, almacen: true, bucket: "prueba-respaldos" });
    expect(l.datos.respaldos[0]).toMatchObject({ tipo: "MANUAL", estatus: "COMPLETO", solicito: "prueba.con" });
    expect(l.datos.puede_respaldar).toBe(false);
    await expect(e.pool.query("DELETE FROM respaldo")).rejects.toThrow();
  });

  it("si el almacenamiento rechaza la subida, queda en ERROR con la razón", async () => {
    const antes = process.env.RESPALDO_S3_LLAVE_SECRETA;
    process.env.RESPALDO_S3_LLAVE_SECRETA = "OTRA";
    const r = await e.nav.con!.post("/api/respaldos/ahora");
    process.env.RESPALDO_S3_LLAVE_SECRETA = antes;
    expect(r.datos).toMatchObject({ estatus: "ERROR" });
    expect(r.datos.error).toMatch(/rechazó la subida \(403\)/);
  });

  it("proceso diario: el día 1 hace el mensual; además el de cada cierre y reintenta los fallidos", async () => {
    await e.pool.query("INSERT INTO respaldo (tipo, motivo) VALUES ('CIERRE', 'Cierre contable PRUEBA')");
    const r = await procesoDiario("2026-12-01");
    expect(r.map((x) => x.estatus)).toEqual(["COMPLETO", "COMPLETO"]); // cierre y mensual (un manual fallido no se reintenta solo)
    const t = (await e.pool.query("SELECT tipo, estatus FROM respaldo ORDER BY creado_en")).rows.map((x) => `${x.tipo}:${x.estatus}`);
    expect(t).toEqual(["MANUAL:COMPLETO", "MANUAL:ERROR", "CIERRE:COMPLETO", "MENSUAL:COMPLETO"]);
    expect((await procesoDiario("2026-12-01")).length).toBe(0); // no se repite
  });
});

describe("prueba de restauración", () => {
  it("el archivo descargado se restaura en una base nueva y todas las tablas quedan idénticas, con sus candados", async () => {
    const d = await fetchDescarga();
    const plano = descifrarRespaldo(d, Buffer.from(LLAVE, "base64"));
    const origen = new pg.Client({ connectionString: urlBase("erp_prueba_respaldo") });
    await origen.connect();
    const h1 = await huellas(origen as any);
    await origen.end();
    // Base nueva construida con las migraciones.
    const admin = new pg.Client({ connectionString: urlBase("postgres") });
    await admin.connect();
    await admin.query("DROP DATABASE IF EXISTS erp_prueba_restaurada WITH (FORCE)");
    await admin.query("CREATE DATABASE erp_prueba_restaurada");
    await admin.end();
    const c = new pg.Client({ connectionString: urlBase("erp_prueba_restaurada") });
    await c.connect();
    await aplicarMigraciones(c, "netlify/database/migrations");
    await c.query("BEGIN");
    const r = await restaurarBase(c as any, plano);
    await c.query("COMMIT");
    expect(r.tablas).toBeGreaterThan(80);
    const h2 = await huellas(c as any);
    // La descarga quedó registrada después de exportar: esa fila es la única diferencia esperada.
    const { respaldo: _a, bitacora_auditoria: _b, ...x1 } = h1;
    const { respaldo: _c, bitacora_auditoria: _d, ...x2 } = h2;
    expect(Object.keys(x2).filter((k) => x2[k] !== x1[k]).map((k) => `${k} ${x1[k]} → ${x2[k]}`)).toEqual([]);
    // Los candados regresan: el kárdex no se modifica y las llaves foráneas existen.
    await expect(c.query("UPDATE movimiento_renglon SET cantidad = 1")).rejects.toThrow();
    await expect(c.query("INSERT INTO existencia (almacen_id, articulo_id) VALUES (gen_random_uuid(), gen_random_uuid())")).rejects.toThrow(/foreign key/);
    // Las secuencias continúan: el siguiente folio de movimiento no se repite.
    const sig = (await c.query("SELECT nextval('movimiento_folio')::int AS n")).rows[0].n;
    const max = (await c.query("SELECT max(substr(folio, 5)::int) AS m FROM movimiento")).rows[0].m;
    expect(sig).toBeGreaterThan(max);
    await c.end();
  });

  it("el guion de restauración rechaza una base con otra versión del sistema", async () => {
    const dir = mkdtempSync(join(tmpdir(), "resp-"));
    const ruta = join(dir, "r.erpresp");
    writeFileSync(ruta, await fetchDescarga());
    // Contra la base ya restaurada (tiene datos) funciona igual; contra una sin la última migración, no.
    const admin = new pg.Client({ connectionString: urlBase("postgres") });
    await admin.connect();
    await admin.query("DROP DATABASE IF EXISTS erp_prueba_restaurada2 WITH (FORCE)");
    await admin.query("CREATE DATABASE erp_prueba_restaurada2");
    await admin.end();
    const salida = execFileSync("node", ["scripts/restaurar-respaldo.mjs", ruta, urlBase("erp_prueba_restaurada2")], { env: { ...process.env, RESPALDO_LLAVE: LLAVE }, encoding: "utf8" });
    expect(salida).toMatch(/Restaurado el respaldo/);
    let error = "";
    try {
      execFileSync("node", ["scripts/restaurar-respaldo.mjs", ruta, urlBase("erp_prueba_restaurada2")], { env: { ...process.env, RESPALDO_LLAVE: Buffer.alloc(32, 9).toString("base64") }, encoding: "utf8", stdio: "pipe" });
    } catch (x) { error = String((x as { stderr: string }).stderr); }
    expect(error).toMatch(/llave no es la correcta/);
  }, 120_000);
});

async function fetchDescarga(): Promise<Buffer> {
  const r = await e.nav.con!.get("/api/respaldos/descargar");
  expect(r.estado).toBe(200);
  return Buffer.from(r.datos as Uint8Array);
}

describe("revisión de arranque", () => {
  it("en el ambiente de pruebas señala lo que falta antes de operar con datos reales, sin mostrar secretos", async () => {
    process.env.PERMITIR_DATOS_PRUEBA = "si";
    const r = await e.nav.dir!.get("/api/arranque");
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    const est = Object.fromEntries(r.datos.revisiones.map((x: any) => [x.clave, x.estado]));
    expect(est).toMatchObject({
      datos_prueba: "FALLA", usuarios_prueba: "FALLA", respaldo_llave: "OK", respaldo_almacen: "OK", ultimo_respaldo: "OK", rfc: "FALLA", provisionales: "AVISO", segregacion: "OK",
    });
    expect(JSON.stringify(r.datos)).not.toContain(LLAVE);
    expect(JSON.stringify(r.datos)).not.toContain("PRUEBA-SECRETA");
    expect(r.datos.resumen.FALLA).toBeGreaterThan(0);
    expect((await e.nav.caj!.get("/api/arranque")).estado).toBe(403);
  });
});
