import { argon2id, argon2Verify } from "hash-wasm";
import { randomBytes } from "node:crypto";

// Parámetros recomendados por OWASP para argon2id (19 MiB, 2 iteraciones).
const PARAMETROS = { parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32 } as const;

export async function hashear(secreto: string): Promise<string> {
  return argon2id({ ...PARAMETROS, password: secreto, salt: randomBytes(16), outputType: "encoded" });
}

export async function verificar(secreto: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    // Gasta el mismo tiempo para no revelar si el usuario existe.
    await hashear(secreto);
    return false;
  }
  try {
    return await argon2Verify({ password: secreto, hash });
  } catch {
    return false;
  }
}

/** Devuelve la lista de reglas que la contraseña no cumple (vacía = válida). */
export function problemasDeContrasena(password: string, longitudMinima: number, usuario: string): string[] {
  const problemas: string[] = [];
  if (password.length < longitudMinima) problemas.push(`Debe tener al menos ${longitudMinima} caracteres.`);
  if (password.length > 128) problemas.push("No puede tener más de 128 caracteres.");
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(password)) problemas.push("Debe incluir al menos una letra.");
  if (!/\d/.test(password)) problemas.push("Debe incluir al menos un número.");
  if (usuario && password.toLowerCase().includes(usuario.toLowerCase())) problemas.push("No puede contener tu nombre de usuario.");
  return problemas;
}
