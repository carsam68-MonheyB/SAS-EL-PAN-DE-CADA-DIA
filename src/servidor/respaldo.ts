// Respaldo externo y restauración (diseño 1.4). El respaldo es la base completa,
// tabla por tabla, en JSON (los valores salen tal cual de Postgres, sin pasar por
// números de JavaScript), comprimido con gzip y cifrado con AES-256-GCM usando
// RESPALDO_LLAVE. Formato del archivo: "ERPRESP1" + iv (12) + etiqueta (16) + cifrado.
// La restauración se hace sobre una base nueva construida con las migraciones.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { configS3, subir, type ConfigS3 } from "./almacen-externo";
import { obtenerPool } from "./db";
import { enTransaccion, type Cliente } from "./transaccion";

const MAGIA = Buffer.from("ERPRESP1");
/** Tablas que no se respaldan: sesiones y estimación de consumo (se regeneran). */
const EXCLUIDAS = new Set(["sesion", "actividad_bd"]);

export function llaveRespaldo(env: Record<string, string | undefined> = process.env): Buffer | null {
  const v = env.RESPALDO_LLAVE;
  if (!v) return null;
  const k = Buffer.from(v, "base64");
  if (k.length !== 32) throw new Error("RESPALDO_LLAVE debe ser de 32 bytes en base64.");
  return k;
}

export function cifrarRespaldo(plano: Buffer, llave: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", llave, iv);
  const cifrado = Buffer.concat([c.update(gzipSync(plano, { level: 9 })), c.final()]);
  return Buffer.concat([MAGIA, iv, c.getAuthTag(), cifrado]);
}

export function descifrarRespaldo(archivo: Buffer, llave: Buffer): Buffer {
  if (archivo.length < MAGIA.length + 28 || !archivo.subarray(0, MAGIA.length).equals(MAGIA)) throw new Error("El archivo no es un respaldo de este sistema.");
  const iv = archivo.subarray(8, 20);
  const etiqueta = archivo.subarray(20, 36);
  const d = createDecipheriv("aes-256-gcm", llave, iv);
  d.setAuthTag(etiqueta);
  try {
    return gunzipSync(Buffer.concat([d.update(archivo.subarray(36)), d.final()]));
  } catch {
    throw new Error("No se pudo descifrar: la llave no es la correcta o el archivo está dañado.");
  }
}

/** Tablas de negocio del esquema public, en orden alfabético. */
async function tablas(c: Cliente): Promise<string[]> {
  const r = await c.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  return r.rows.map((x) => x.tablename as string).filter((t) => !EXCLUIDAS.has(t));
}

const ident = (t: string) => `"${t.replaceAll('"', '""')}"`;

/**
 * Exporta la base a un documento JSON por líneas: encabezado (migraciones y
 * secuencias) y una línea por tabla. Todo dentro de una transacción de solo
 * lectura con instantánea fija (la abre quien llama), para que sea consistente.
 */
export async function exportarBase(c: Cliente): Promise<{ plano: Buffer; tablas: number; filas: number }> {
  const hay = (await c.query("SELECT to_regclass('netlify.migrations') IS NOT NULL AS hay")).rows[0].hay;
  const migraciones = hay ? (await c.query("SELECT name FROM netlify.migrations ORDER BY name")).rows.map((x) => x.name as string) : [];
  const secuencias = (await c.query("SELECT sequencename AS nombre, last_value::text AS valor FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename")).rows;
  const lineas: string[] = [JSON.stringify({ formato: "erp-respaldo", version: 1, creado: new Date().toISOString(), migraciones, secuencias })];
  let filas = 0;
  const ts = await tablas(c);
  for (const t of ts) {
    const r = (await c.query(`SELECT count(*)::int AS n, coalesce(jsonb_agg(to_jsonb(x))::text, '[]') AS datos FROM ${ident(t)} x`)).rows[0];
    filas += r.n;
    // Se concatena el texto del JSON de Postgres (jsonb: sin saltos de línea; los numeric no pierden precisión).
    lineas.push(`{"tabla":${JSON.stringify(t)},"filas":${r.n},"datos":${r.datos}}`);
  }
  return { plano: Buffer.from(lineas.join("\n"), "utf8"), tablas: ts.length, filas };
}

/**
 * Restaura un respaldo sobre una base nueva construida con las mismas migraciones.
 * Lo ejecuta el dueño de las tablas: quita temporalmente las llaves foráneas y los
 * disparadores (que impiden modificar datos ya registrados), reemplaza el
 * contenido de cada tabla, regresa las secuencias y vuelve a crear las llaves
 * foráneas (eso valida la integridad de los datos). Todo en una transacción.
 */
export async function restaurarBase(c: Cliente, plano: Buffer, opciones: { permitirOtrasMigraciones?: boolean } = {}) {
  const [cabeza, ...resto] = plano.toString("utf8").split("\n");
  const enc = JSON.parse(cabeza!);
  if (enc.formato !== "erp-respaldo") throw new Error("El archivo no es un respaldo de este sistema.");
  const aplicadas = (await c.query("SELECT name FROM netlify.migrations ORDER BY name")).rows.map((x) => x.name as string);
  if (!opciones.permitirOtrasMigraciones && JSON.stringify(aplicadas) !== JSON.stringify(enc.migraciones)) {
    throw new Error(`La base destino tiene otras migraciones que el respaldo (respaldo: ${enc.migraciones.at(-1)}; destino: ${aplicadas.at(-1)}). Construye la base con la versión del sistema del respaldo.`);
  }
  const ts = await tablas(c);
  const fks = (await c.query(
    `SELECT con.conname AS nombre, cl.relname AS tabla, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE con.contype = 'f' AND n.nspname = 'public'`,
  )).rows;
  for (const f of fks) await c.query(`ALTER TABLE ${ident(f.tabla)} DROP CONSTRAINT ${ident(f.nombre)}`);
  for (const t of ts) await c.query(`ALTER TABLE ${ident(t)} DISABLE TRIGGER USER`);
  for (const t of ts) await c.query(`DELETE FROM ${ident(t)}`);
  const resumen: { tabla: string; filas: number }[] = [];
  for (const linea of resto) {
    if (!linea.trim()) continue;
    // Solo se lee el nombre; los datos pasan como texto a Postgres.
    const m = /^\{"tabla":("(?:[^"\\]|\\.)*"),"filas":(\d+),"datos":/.exec(linea);
    if (!m) throw new Error("Respaldo dañado: renglón de tabla no válido.");
    const tabla = JSON.parse(m[1]!) as string;
    if (!ts.includes(tabla)) throw new Error(`La tabla ${tabla} del respaldo no existe en la base destino.`);
    const datos = linea.slice(m[0].length, -1);
    const r = await c.query(`INSERT INTO ${ident(tabla)} SELECT * FROM json_populate_recordset(NULL::${ident(tabla)}, $1::json)`, [datos]);
    if (r.rowCount !== Number(m[2])) throw new Error(`La tabla ${tabla} no quedó completa (${r.rowCount} de ${m[2]}).`);
    resumen.push({ tabla, filas: r.rowCount ?? 0 });
  }
  for (const s of enc.secuencias as { nombre: string; valor: string | null }[]) {
    if (s.valor !== null) await c.query("SELECT setval($1, $2::bigint, true)", [`public.${ident(s.nombre)}`, s.valor]);
  }
  for (const t of ts) await c.query(`ALTER TABLE ${ident(t)} ENABLE TRIGGER USER`);
  for (const f of fks) await c.query(`ALTER TABLE ${ident(f.tabla)} ADD CONSTRAINT ${ident(f.nombre)} ${f.def}`);
  return { creado: enc.creado as string, migracion: enc.migraciones.at(-1) as string, tablas: resumen.length, filas: resumen.reduce((s, x) => s + x.filas, 0), detalle: resumen };
}

/** Huella de cada tabla (número de filas y md5 del contenido ordenado) para comparar dos bases. */
export async function huellas(c: Cliente): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of await tablas(c)) {
    const r = (await c.query(`SELECT count(*)::text || ':' || coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') AS h FROM ${ident(t)} x`)).rows[0];
    out[t] = r.h;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Respaldo hacia el almacenamiento externo
// ---------------------------------------------------------------------------
const anios = async (c: Cliente) => Number((await c.query("SELECT valor FROM configuracion WHERE clave = 'respaldo.anios_conservacion'")).rows[0]?.valor ?? "5");
const rfcEmpresa = async (c: Cliente) => ((await c.query("SELECT valor FROM configuracion WHERE clave = 'empresa.rfc'")).rows[0]?.valor ?? "").trim().toUpperCase() || "SIN-RFC";

export function estadoConfiguracion(env: Record<string, string | undefined> = process.env) {
  let llave = false, llaveError: string | null = null;
  try { llave = !!llaveRespaldo(env); } catch (e) { llaveError = (e as Error).message; }
  const s3 = configS3(env);
  return { llave, llave_error: llaveError, almacen: !!s3, endpoint: s3?.endpoint ?? null, bucket: s3?.bucket ?? null };
}

/** Exporta, cifra y sube. `c` debe ser una conexión propia (el registro se actualiza en otra). */
export async function respaldarA(c: Cliente, cfg: ConfigS3, llave: Buffer, tipo: string, hacerFetch: typeof fetch = fetch) {
  const ex = await exportarBase(c);
  const archivo = cifrarRespaldo(ex.plano, llave);
  const ahora = new Date();
  const retener = new Date(ahora);
  retener.setUTCFullYear(retener.getUTCFullYear() + await anios(c));
  const destino = `respaldos/${ahora.toISOString().slice(0, 7).replace("-", "/")}/erp-${tipo.toLowerCase()}-${ahora.toISOString().replace(/[:.]/g, "-")}.erpresp`;
  await subir(cfg, destino, archivo, { tipo: "application/octet-stream", retenerHasta: retener }, hacerFetch);
  return { destino, bytes: archivo.length, sha256: createHash("sha256").update(archivo).digest("hex"), tablas: ex.tablas, filas: ex.filas, retener_hasta: retener.toISOString().slice(0, 10) };
}

/** Sube los XML de facturas emitidas y recibidas que aún no están archivados: cfdi/{RFC}/{emitidos|recibidos}/{AAAA}/{MM}/{UUID}.xml */
export async function archivarCfdi(c: Cliente, cfg: ConfigS3, hacerFetch: typeof fetch = fetch, maximo = 200) {
  const rfc = await rfcEmpresa(c);
  const retener = new Date();
  retener.setUTCFullYear(retener.getUTCFullYear() + await anios(c));
  const pendientes = (await c.query(
    `SELECT * FROM (
       SELECT e.uuid_cfdi, 'EMITIDO' AS origen, to_char(e.fecha_emision AT TIME ZONE 'America/Mexico_City', 'YYYY/MM') AS mes, e.xml FROM cfdi_emitido e
       UNION ALL
       SELECT f.uuid_cfdi, 'RECIBIDO', to_char(f.fecha AT TIME ZONE 'America/Mexico_City', 'YYYY/MM'), f.xml FROM factura_proveedor f WHERE f.xml IS NOT NULL
     ) x WHERE NOT EXISTS (SELECT 1 FROM respaldo_cfdi r WHERE r.uuid_cfdi = x.uuid_cfdi) ORDER BY mes LIMIT $1`,
    [maximo],
  )).rows;
  for (const p of pendientes) {
    const destino = `cfdi/${rfc}/${p.origen === "EMITIDO" ? "emitidos" : "recibidos"}/${p.mes}/${p.uuid_cfdi}.xml`;
    await subir(cfg, destino, Buffer.from(p.xml, "utf8"), { tipo: "application/xml", retenerHasta: retener }, hacerFetch);
    await c.query("INSERT INTO respaldo_cfdi (uuid_cfdi, origen, destino) VALUES ($1, $2, $3)", [p.uuid_cfdi, p.origen, destino]);
  }
  return { archivados: pendientes.length };
}

// ---------------------------------------------------------------------------
// Ejecución con registro (respaldo manual, mensual o del cierre)
// ---------------------------------------------------------------------------
/** Exporta con su propia conexión en una transacción de solo lectura con instantánea fija. */
async function conInstantanea<T>(fn: (c: Cliente) => Promise<T>): Promise<T> {
  const c = await obtenerPool().connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Respalda un registro pendiente (o uno nuevo) y deja el resultado en la tabla respaldo. */
export async function ejecutarRespaldo(id: string, hacerFetch: typeof fetch = fetch) {
  const cfg = configS3();
  const llave = llaveRespaldo();
  const marcar = (campos: string, valores: unknown[]) => enTransaccion(null, (c) => c.query(`UPDATE respaldo SET ${campos} WHERE id = $1`, [id, ...valores]));
  if (!cfg || !llave) {
    await marcar("estatus = 'ERROR', error = $2, terminado_en = now()", [!llave ? "Falta la variable RESPALDO_LLAVE." : "Falta configurar el almacenamiento externo (RESPALDO_S3_*)."]);
    return { id, estatus: "ERROR" };
  }
  await marcar("estatus = 'EN_PROCESO', iniciado_en = now(), error = NULL", []);
  try {
    const tipo = (await enTransaccion(null, (c) => c.query("SELECT tipo FROM respaldo WHERE id = $1", [id]))).rows[0].tipo;
    const r = await conInstantanea(async (c) => {
      const x = await respaldarA(c, cfg, llave, tipo, hacerFetch);
      return x;
    });
    const cf = await enTransaccion(null, (c) => archivarCfdi(c, cfg, hacerFetch));
    await marcar("estatus = 'COMPLETO', destino = $2, bytes = $3, sha256 = $4, tablas = $5, filas = $6, retener_hasta = $7, terminado_en = now(), motivo = coalesce(motivo, '') || $8",
      [r.destino, r.bytes, r.sha256, r.tablas, r.filas, r.retener_hasta, cf.archivados ? ` · ${cf.archivados} XML archivados` : ""]);
    return { id, estatus: "COMPLETO", ...r, xml_archivados: cf.archivados };
  } catch (e) {
    await marcar("estatus = 'ERROR', error = $2, terminado_en = now()", [(e as Error).message.slice(0, 500)]);
    return { id, estatus: "ERROR", error: (e as Error).message };
  }
}

/**
 * Proceso diario (una vez al día, dentro del horario en que la base ya está
 * despierta): el día 1 crea el respaldo mensual; además procesa los pendientes
 * (por ejemplo, los de cada cierre contable) y reintenta los que fallaron.
 */
export async function procesoDiario(hoy: string, hacerFetch: typeof fetch = fetch) {
  await enTransaccion(null, async (c) => {
    if (hoy.endsWith("-01")) {
      const ya = (await c.query("SELECT 1 FROM respaldo WHERE tipo = 'MENSUAL' AND creado_en > now() - interval '20 days'")).rows[0];
      if (!ya) await c.query("INSERT INTO respaldo (tipo, motivo) VALUES ('MENSUAL', $1)", [`Respaldo mensual ${hoy.slice(5, 7)}/${hoy.slice(0, 4)}`]);
    }
  });
  const pendientes = (await enTransaccion(null, (c) => c.query(
    "SELECT id FROM respaldo WHERE estatus = 'PENDIENTE' OR (estatus = 'ERROR' AND tipo IN ('MENSUAL', 'CIERRE') AND creado_en > now() - interval '7 days') ORDER BY creado_en LIMIT 3",
  ))).rows;
  const resultados = [];
  for (const p of pendientes) resultados.push(await ejecutarRespaldo(p.id, hacerFetch));
  return resultados;
}
