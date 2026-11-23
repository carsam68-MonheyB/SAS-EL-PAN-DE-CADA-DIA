// Restaura un respaldo cifrado (.erpresp) en una base de datos NUEVA.
// Uso (ver docs/arranque/restauracion.md):
//   RESPALDO_LLAVE=... node scripts/restaurar-respaldo.mjs <archivo.erpresp> <url-postgres-destino>
// Si la base destino está vacía, primero le aplica las migraciones de este
// repositorio (usa la misma versión del sistema que generó el respaldo).
// Nunca restaures sobre la base de producción en uso.
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import pg from "pg";

const [archivo, destino] = process.argv.slice(2);
if (!archivo || !destino) {
  console.error("Uso: node scripts/restaurar-respaldo.mjs <archivo.erpresp> <url-postgres-destino>");
  process.exit(1);
}
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const r = await vite.ssrLoadModule("/src/servidor/respaldo.ts");
  const mig = await vite.ssrLoadModule("/src/servidor/migraciones.ts");
  const llave = r.llaveRespaldo();
  if (!llave) throw new Error("Define la variable RESPALDO_LLAVE (la misma con que se hizo el respaldo).");
  const plano = r.descifrarRespaldo(readFileSync(archivo), llave);
  const c = new pg.Client({ connectionString: destino });
  await c.connect();
  try {
    const nuevas = await mig.aplicarMigraciones(c, "netlify/database/migrations");
    if (nuevas.length) console.log(`Se aplicaron ${nuevas.length} migraciones a la base destino.`);
    await c.query("BEGIN");
    const res = await r.restaurarBase(c, plano);
    await c.query("COMMIT");
    console.log(`Restaurado el respaldo del ${res.creado} (versión ${res.migracion}): ${res.tablas} tablas, ${res.filas} registros.`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
} catch (e) {
  console.error(`No se restauró: ${e.message}`);
  process.exitCode = 1;
} finally {
  await vite.close();
}
