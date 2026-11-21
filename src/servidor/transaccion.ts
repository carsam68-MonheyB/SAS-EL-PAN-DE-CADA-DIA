import type pg from "pg";
import { obtenerPool } from "./db";

export type Cliente = pg.PoolClient;

/**
 * Ejecuta `fn` en UNA transacción con un cliente del pool (BEGIN/COMMIT).
 * Si algo falla se hace ROLLBACK: nunca queda un movimiento a medias.
 * Fija app.usuario_id para que la bitácora registre quién hizo el cambio.
 */
export async function enTransaccion<T>(usuarioId: string | null, fn: (c: Cliente) => Promise<T>): Promise<T> {
  const cliente = await obtenerPool().connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query("SELECT set_config('app.usuario_id', $1, true)", [usuarioId ?? ""]);
    const resultado = await fn(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    cliente.release();
  }
}
