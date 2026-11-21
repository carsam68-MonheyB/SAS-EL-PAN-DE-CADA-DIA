// Prepara una base Postgres limpia para las pruebas y aplica las migraciones.
// Usa TEST_DATABASE_URL_ADMIN (base administrativa) o, por omisión, el
// Postgres local en postgres://postgres:postgres@localhost:5432/postgres.
import pg from "pg";
import { aplicarMigraciones } from "../src/servidor/migraciones";

const ADMIN = process.env.TEST_DATABASE_URL_ADMIN ?? "postgres://postgres:postgres@localhost:5432/postgres";
const BASE = "erp_pruebas";

export default async function () {
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${BASE} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${BASE}`);
  await admin.end();
  const url = new URL(ADMIN);
  url.pathname = `/${BASE}`;
  process.env.NETLIFY_DB_URL = url.toString();
  const cliente = new pg.Client({ connectionString: url.toString() });
  await cliente.connect();
  await aplicarMigraciones(cliente, "netlify/database/migrations");
  await cliente.end();
}
