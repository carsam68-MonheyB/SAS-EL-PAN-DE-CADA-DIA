import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function tokenAleatorio(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(texto: string): Buffer {
  return createHash("sha256").update(texto, "utf8").digest();
}

export function igualesSeguro(a: string, b: string): boolean {
  const x = sha256(a);
  const y = sha256(b);
  return timingSafeEqual(x, y);
}

function llaveMaestra(): Buffer {
  const valor = process.env.LLAVE_MAESTRA;
  if (!valor) throw new Error("Falta la variable de entorno LLAVE_MAESTRA.");
  const llave = Buffer.from(valor, "base64");
  if (llave.length !== 32) throw new Error("LLAVE_MAESTRA debe ser de 32 bytes en base64.");
  return llave;
}

/** Cifra con AES-256-GCM. Formato: v1.<iv>.<etiqueta>.<cifrado> (base64url). */
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", llaveMaestra(), iv);
  const cifrado = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), cifrado.toString("base64url")].join(".");
}

export function descifrar(paquete: string): string {
  const [version, iv, etiqueta, cifrado] = paquete.split(".");
  if (version !== "v1" || !iv || !etiqueta || cifrado === undefined) throw new Error("Dato cifrado inválido.");
  const d = createDecipheriv("aes-256-gcm", llaveMaestra(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(etiqueta, "base64url"));
  return Buffer.concat([d.update(Buffer.from(cifrado, "base64url")), d.final()]).toString("utf8");
}

/** Código de 10 caracteres [a-z0-9] sin sesgo (para códigos de recuperación). */
export function codigoRecuperacion(longitud = 10): string {
  const alfabeto = "abcdefghjkmnpqrstuvwxyz23456789"; // sin caracteres ambiguos
  let codigo = "";
  while (codigo.length < longitud) {
    const b = randomBytes(1)[0]!;
    if (b < 248) codigo += alfabeto[b % alfabeto.length];
  }
  return codigo;
}
