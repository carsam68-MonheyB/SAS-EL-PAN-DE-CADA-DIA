import type { Cliente } from "./transaccion";

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria configurada del negocio. */
export async function hoyNegocio(c: Cliente): Promise<string> {
  const zona = (await c.query("SELECT valor FROM configuracion WHERE clave = 'general.zona_horaria'")).rows[0]?.valor ?? "America/Mexico_City";
  return (await c.query("SELECT (now() AT TIME ZONE $1)::date::text AS hoy", [zona])).rows[0].hoy as string;
}
