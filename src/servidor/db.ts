import { getDatabase } from "@netlify/database";
import type pg from "pg";

let pool: pg.Pool | undefined;

/** Pool de conexiones a Netlify Database (una por instancia de función). */
export function obtenerPool(): pg.Pool {
  if (!pool) {
    pool = getDatabase().pool as unknown as pg.Pool;
    // Netlify cierra conexiones inactivas a los 60 s: el pool las suelta antes.
    const opciones = (pool as unknown as { options?: { idleTimeoutMillis?: number } }).options;
    if (opciones) opciones.idleTimeoutMillis = 30_000;
  }
  return pool;
}

/** Solo para pruebas: usa un pool propio. */
export function fijarPool(nuevo: pg.Pool | undefined) {
  pool = nuevo;
}
