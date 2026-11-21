// Aplica las migraciones de netlify/database/migrations con la MISMA convención
// que Netlify (carpetas NNNN_nombre/migration.sql, orden alfabético, tabla
// netlify.migrations, una transacción por migración). Se usa en pruebas; en
// Netlify las aplica la plataforma al desplegar.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";

const PATRON = /^\d+_.+$/;

export async function aplicarMigraciones(cliente: pg.ClientBase, directorio: string): Promise<string[]> {
  await cliente.query(`CREATE SCHEMA IF NOT EXISTS netlify;
    CREATE TABLE IF NOT EXISTS netlify.migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const entradas = await readdir(directorio, { withFileTypes: true });
  const migraciones = entradas
    .filter((e) => e.isDirectory() && PATRON.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const { rows } = await cliente.query<{ name: string }>("SELECT name FROM netlify.migrations");
  const aplicadas = new Set(rows.map((r) => r.name));
  const nuevas: string[] = [];
  for (const nombre of migraciones) {
    if (aplicadas.has(nombre)) continue;
    const sql = await readFile(join(directorio, nombre, "migration.sql"), "utf8");
    await cliente.query("BEGIN");
    try {
      await cliente.query(sql);
      await cliente.query("INSERT INTO netlify.migrations (name) VALUES ($1)", [nombre]);
      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw new Error(`Falló la migración ${nombre}: ${(e as Error).message}`);
    }
    nuevas.push(nombre);
  }
  return nuevas;
}
