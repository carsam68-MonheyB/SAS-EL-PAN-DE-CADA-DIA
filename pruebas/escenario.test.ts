// Escenario de demostración: con un botón se cargan los ejemplos de todas las
// fases, con los mismos permisos y autorizaciones que una persona, y el sistema
// queda listo para probar la operación de punta a punta. DATOS FICTICIOS.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { contenido } from "../scripts/generar-escenario.mjs";
import { readFileSync } from "node:fs";
import { baseLimpia, entrar, instalarAdministrador, Navegador } from "./apoyo";

let pool: pg.Pool;
let admin: Navegador;
let password: string;

beforeAll(async () => {
  pool = await baseLimpia("erp_prueba_escenario");
  admin = (await instalarAdministrador()).nav;
}, 120_000);

describe("escenario de demostración", () => {
  it("la copia de los archivos de ejemplo dentro del sistema está al día", () => {
    expect(readFileSync("src/servidor/escenario-archivos.ts", "utf8")).toBe(contenido());
  });

  it("pide primero los usuarios de prueba", async () => {
    expect((await admin.post("/api/datos-prueba/escenario", { paso: 0 })).datos.mensaje).toMatch(/usuarios de prueba/);
  });

  it("carga todos los pasos: catálogos, recetas activas, inventario autorizado, precios de hoy, contabilidad y plan", async () => {
    password = (await admin.post("/api/datos-prueba")).datos.password;
    let paso = 0, total = 1, ultimo: any = null;
    while (paso < total) {
      const r = await admin.post("/api/datos-prueba/escenario", { paso });
      expect(r.estado, `paso ${paso}: ${JSON.stringify(r.datos)}`).toBe(200);
      total = r.datos.total; ultimo = r.datos; paso++;
    }
    expect(ultimo).toMatchObject({ terminado: true, pines: { "prueba.caj": "4821", "prueba.con": "4830" } });
    const q = async (sql: string) => (await pool.query(sql)).rows[0];
    expect(await q("SELECT count(*)::int AS n FROM receta WHERE estatus = 'ACTIVA'")).toEqual({ n: 7 });
    expect(await q("SELECT count(*)::int AS n FROM carga_layout WHERE estatus = 'aplicada'")).toEqual({ n: total - 1 });
    expect(await q("SELECT count(*)::int AS n FROM precio_venta WHERE vigente_desde = (now() AT TIME ZONE 'America/Mexico_City')::date")).toEqual({ n: 4 });
    expect(await q("SELECT count(*)::int AS n FROM plan_produccion")).toEqual({ n: 1 });
    // Una segunda vez no se carga encima.
    expect((await admin.post("/api/datos-prueba/escenario", { paso: 0 })).estado).toBe(409);
  }, 240_000);

  it("con el escenario, el cajero vende y el contralor autoriza un descuento con su PIN, sin más preparación", async () => {
    const caj = new Navegador();
    await entrar(caj, "prueba.caj", password);
    const est = await caj.get("/api/pos/estado");
    await caj.post("/api/auth/caja", { caja_id: est.datos.cajas[0].id });
    expect((await caj.post("/api/pos/turno", { fondo: "500" })).estado).toBe(200);
    const v = await caj.post("/api/pos/ventas", { id: randomUUID(), renglones: [{ articulo: "PRUEBA-BOLILLO", cantidad: "5", descuento: "1" }], pagos: [{ forma: "01", importe: "20" }], autorizacion: { usuario: "prueba.con", pin: "4830" } });
    expect(v.estado, JSON.stringify(v.datos)).toBe(200);
    expect(v.datos.total).toBe("14.00");
  });
});
