import type { Cliente } from "./transaccion";

export async function leerConfiguracion(c: Cliente): Promise<Map<string, string>> {
  const { rows } = await c.query<{ clave: string; valor: string }>("SELECT clave, valor FROM configuracion");
  return new Map(rows.map((r) => [r.clave, r.valor]));
}

export async function configEntero(c: Cliente, clave: string): Promise<number> {
  const { rows } = await c.query<{ valor: string }>("SELECT valor FROM configuracion WHERE clave = $1", [clave]);
  const valor = rows[0]?.valor;
  if (valor === undefined) throw new Error(`Falta la configuración ${clave}.`);
  const n = Number.parseInt(valor, 10);
  if (!Number.isFinite(n)) throw new Error(`La configuración ${clave} no es un entero.`);
  return n;
}
