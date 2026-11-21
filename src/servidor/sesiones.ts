import { configEntero } from "./configuracion";
import { sha256, tokenAleatorio } from "./cripto";
import type { Cliente } from "./transaccion";

export type Etapa = "completa" | "segundo_factor" | "enrolar_totp" | "cambiar_password";

export interface Sesion {
  id: string;
  usuario_id: string;
  tipo: "oficina" | "pos";
  etapa: Etapa;
  caja_id: string | null;
  cajero_actual_id: string | null;
  expira_en: Date;
}

// Una sesión que todavía no completa el acceso dura poco.
const MINUTOS_ETAPA_INCOMPLETA = 15;

export async function crearSesion(
  c: Cliente,
  datos: { usuarioId: string; etapa: Etapa; ip?: string | null; agente?: string | null },
): Promise<{ token: string; maxAge: number }> {
  const token = tokenAleatorio();
  const minutos = datos.etapa === "completa" ? (await configEntero(c, "seguridad.horas_sesion_maxima")) * 60 : MINUTOS_ETAPA_INCOMPLETA;
  await c.query(
    `INSERT INTO sesion (token_hash, usuario_id, etapa, expira_en, ip, agente)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4), $5, $6)`,
    [sha256(token), datos.usuarioId, datos.etapa, minutos, datos.ip ?? null, datos.agente?.slice(0, 300) ?? null],
  );
  return { token, maxAge: minutos * 60 };
}

/**
 * Busca la sesión del token y valida expiración e inactividad. Si es válida
 * actualiza su última actividad. Si no, la revoca y devuelve null.
 */
export async function validarSesion(c: Cliente, token: string): Promise<Sesion | null> {
  const { rows } = await c.query(
    `SELECT id, usuario_id, tipo, etapa, caja_id, cajero_actual_id, expira_en, ultima_actividad, revocada_en
       FROM sesion WHERE token_hash = $1`,
    [sha256(token)],
  );
  const s = rows[0];
  if (!s || s.revocada_en) return null;
  const ahora = Date.now();
  const inactividad = await configEntero(c, s.tipo === "pos" ? "seguridad.minutos_inactividad_pos" : "seguridad.minutos_inactividad_oficina");
  let motivo: string | null = null;
  if (new Date(s.expira_en).getTime() <= ahora) motivo = "expirada";
  else if (s.etapa === "completa" && new Date(s.ultima_actividad).getTime() + inactividad * 60_000 <= ahora) motivo = "inactividad";
  if (motivo) {
    await c.query("UPDATE sesion SET revocada_en = now(), motivo_cierre = $2 WHERE id = $1 AND revocada_en IS NULL", [s.id, motivo]);
    return null;
  }
  await c.query("UPDATE sesion SET ultima_actividad = now() WHERE id = $1", [s.id]);
  return { id: s.id, usuario_id: s.usuario_id, tipo: s.tipo, etapa: s.etapa, caja_id: s.caja_id, cajero_actual_id: s.cajero_actual_id, expira_en: s.expira_en };
}

export async function revocarSesion(c: Cliente, id: string, motivo: string) {
  await c.query("UPDATE sesion SET revocada_en = now(), motivo_cierre = $2 WHERE id = $1 AND revocada_en IS NULL", [id, motivo]);
}

export async function revocarSesionesDeUsuario(c: Cliente, usuarioId: string, motivo: string) {
  await c.query("UPDATE sesion SET revocada_en = now(), motivo_cierre = $2 WHERE usuario_id = $1 AND revocada_en IS NULL", [usuarioId, motivo]);
}
