import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";

const EMISOR = "ERP Pan de Cada Día";

export function nuevoSecretoTotp(): string {
  return new Secret({ size: 20 }).base32;
}

function totp(secreto: string, usuario: string) {
  return new TOTP({ issuer: EMISOR, label: usuario, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secreto) });
}

export async function datosEnrolamiento(secreto: string, usuario: string) {
  const uri = totp(secreto, usuario).toString();
  return { uri, secreto, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

/**
 * Valida un código y devuelve el paso de tiempo usado (o null si no es válido).
 * Acepta ±1 paso (30 s) de desfase y rechaza reutilizar un paso ya usado.
 */
export function validarCodigoTotp(secreto: string, usuario: string, codigo: string, ultimoPaso: number | null): number | null {
  if (!/^\d{6}$/.test(codigo)) return null;
  const t = totp(secreto, usuario);
  const delta = t.validate({ token: codigo, window: 1 });
  if (delta === null) return null;
  const paso = Math.floor(Date.now() / 1000 / 30) + delta;
  if (ultimoPaso !== null && paso <= ultimoPaso) return null;
  return paso;
}
