// Almacenamiento externo compatible con S3 (Amazon S3, Backblaze B2, Wasabi,
// Cloudflare R2…) para los respaldos y los XML (diseño 1.4, P06). Solo sube
// archivos: el sistema no tiene ninguna función para borrar. Con Object Lock en
// modo COMPLIANCE, nadie (ni el dueño de la cuenta) puede borrar o reemplazar un
// archivo antes de su fecha de retención. Firma AWS Signature Version 4.
import { createHash, createHmac } from "node:crypto";

export interface ConfigS3 { endpoint: string; region: string; bucket: string; llaveId: string; llaveSecreta: string }

/** Lee la configuración de las variables de entorno; null si falta alguna. */
export function configS3(env: Record<string, string | undefined> = process.env): ConfigS3 | null {
  const c = { endpoint: env.RESPALDO_S3_ENDPOINT, region: env.RESPALDO_S3_REGION, bucket: env.RESPALDO_S3_BUCKET, llaveId: env.RESPALDO_S3_LLAVE_ID, llaveSecreta: env.RESPALDO_S3_LLAVE_SECRETA };
  if (!c.endpoint || !c.region || !c.bucket || !c.llaveId || !c.llaveSecreta) return null;
  return c as ConfigS3;
}

const sha256hex = (x: Buffer | string) => createHash("sha256").update(x).digest("hex");
const hmac = (llave: Buffer | string, x: string) => createHmac("sha256", llave).update(x).digest();
/** Codificación de rutas de S3: todo menos A-Z a-z 0-9 - _ . ~ y la diagonal. */
const codificar = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%2F/g, "/");

export interface Solicitud { metodo: string; url: URL; encabezados: Record<string, string>; hashCuerpo: string }

/** Firma una solicitud (SigV4, servicio s3). Devuelve los encabezados a enviar, con Authorization. */
export function firmar(s: Solicitud, cfg: Pick<ConfigS3, "region" | "llaveId" | "llaveSecreta">, fecha: Date): Record<string, string> {
  const amz = fecha.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dia = amz.slice(0, 8);
  const enc: Record<string, string> = { ...s.encabezados, host: s.url.host, "x-amz-date": amz, "x-amz-content-sha256": s.hashCuerpo };
  const nombres = Object.keys(enc).map((k) => k.toLowerCase()).sort();
  const valor = (k: string) => Object.entries(enc).find(([x]) => x.toLowerCase() === k)![1].trim().replace(/\s+/g, " ");
  const consulta = [...s.url.searchParams.entries()].map(([k, v]) => [codificar(k), codificar(v)]).sort(([a], [b]) => (a! < b! ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const canonica = [s.metodo, codificar(decodeURIComponent(s.url.pathname)), consulta, nombres.map((k) => `${k}:${valor(k)}\n`).join(""), nombres.join(";"), s.hashCuerpo].join("\n");
  const alcance = `${dia}/${cfg.region}/s3/aws4_request`;
  const aFirmar = ["AWS4-HMAC-SHA256", amz, alcance, sha256hex(canonica)].join("\n");
  const llave = hmac(hmac(hmac(hmac(`AWS4${cfg.llaveSecreta}`, dia), cfg.region), "s3"), "aws4_request");
  const firma = createHmac("sha256", llave).update(aFirmar).digest("hex");
  return { ...enc, authorization: `AWS4-HMAC-SHA256 Credential=${cfg.llaveId}/${alcance}, SignedHeaders=${nombres.join(";")}, Signature=${firma}` };
}

/**
 * Sube un archivo con retención (Object Lock COMPLIANCE hasta `retenerHasta`).
 * La cubeta debe tener Object Lock habilitado; si no, el proveedor rechaza la subida.
 */
export async function subir(cfg: ConfigS3, llave: string, cuerpo: Buffer, opciones: { tipo: string; retenerHasta: Date }, hacerFetch: typeof fetch = fetch) {
  const url = new URL(`${cfg.endpoint.replace(/\/$/, "")}/${cfg.bucket}/${llave.split("/").map(encodeURIComponent).join("/")}`);
  const encabezados = firmar({
    metodo: "PUT", url, hashCuerpo: sha256hex(cuerpo),
    encabezados: {
      "content-type": opciones.tipo, "content-length": String(cuerpo.length),
      "content-md5": createHash("md5").update(cuerpo).digest("base64"),
      "x-amz-object-lock-mode": "COMPLIANCE", "x-amz-object-lock-retain-until-date": opciones.retenerHasta.toISOString().replace(/\.\d{3}Z$/, "Z"),
    },
  }, cfg, new Date());
  const r = await hacerFetch(url, { method: "PUT", headers: encabezados, body: new Uint8Array(cuerpo) });
  if (!r.ok) {
    const texto = (await r.text().catch(() => "")).slice(0, 400);
    throw new Error(`El almacenamiento externo rechazó la subida (${r.status}): ${texto}`);
  }
  return { llave, etag: r.headers.get("etag") };
}
