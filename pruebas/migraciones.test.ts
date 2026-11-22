import { describe, it, expect } from "vitest";
import pg from "pg";

const url = () => {
  const u = new URL(process.env.TEST_DATABASE_URL_ADMIN ?? "postgres://postgres:postgres@localhost:5432/postgres");
  u.pathname = "/erp_pruebas";
  return u.toString();
};

describe("migraciones", () => {
  it("crean la matriz aprobada", async () => {
    const c = new pg.Client({ connectionString: url() });
    await c.connect();
    const roles = await c.query("SELECT count(*)::int n FROM rol");
    const asign = await c.query("SELECT count(*)::int n FROM rol_permiso");
    const est = await c.query("SELECT string_agg(clave, ',' ORDER BY clave) c FROM almacen");
    await c.end();
    expect(roles.rows[0].n).toBe(12);
    expect(asign.rows[0].n).toBe(365); // 350 aprobadas + 15 de la migración 0010 (cancelaciones de inventario, P70)
    expect(est.rows[0].c).toBe("MP-MAT,PEP-MAT,PT-MAT,PT-SUC1");
  });
});
