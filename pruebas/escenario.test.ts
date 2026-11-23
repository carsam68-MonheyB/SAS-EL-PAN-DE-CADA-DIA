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
    expect((await admin.post("/api/datos-prueba/escenario", { paso: 0 })).datos.mensaje).toMatch(/Usuarios de prueba/);
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
    // Una segunda vez no duplica nada: todo se omite y el inventario no cambia.
    const inv = await q("SELECT count(*)::int AS n, sum(cantidad)::text AS c FROM existencia");
    for (let i = 0; i < total; i++) {
      const r = await admin.post("/api/datos-prueba/escenario", { paso: i });
      expect(r.estado, JSON.stringify(r.datos)).toBe(200);
      if (i < total - 1) expect(r.datos.omitido, r.datos.descripcion).toBe(true);
    }
    expect(await q("SELECT count(*)::int AS n, sum(cantidad)::text AS c FROM existencia")).toEqual(inv);
    expect(await q("SELECT count(*)::int AS n FROM carga_layout WHERE estatus <> 'aplicada'")).toEqual({ n: 0 });
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

describe("escenario sobre una base con catálogos ya cargados a mano", () => {
  it("completa lo que falta (recetas, inventario, precios…) sin duplicar lo que ya había", async () => {
    const p2 = await baseLimpia("erp_prueba_escenario2");
    const adm = (await instalarAdministrador()).nav;
    const pw = (await adm.post("/api/datos-prueba")).datos.password;
    const com = new Navegador();
    await entrar(com, "prueba.com", pw);
    for (const [layout, archivo] of [["unidades", "02-unidades.txt"], ["familias", "04-familias.txt"]]) {
      const s = await com.post("/api/cargas", { layout, modo: "alta", nombre_archivo: archivo, contenido: readFileSync(`datos-ejemplo/fase-1b/${archivo}`).toString("base64") });
      expect((await com.post(`/api/cargas/${s.datos.id}/aplicar`)).datos.estatus).toBe("aplicada");
    }
    const ya = (await p2.query("SELECT count(*)::int AS n FROM unidad")).rows[0].n;
    let total = 1, omitidos: string[] = [];
    for (let paso = 0; paso < total; paso++) {
      const r = await adm.post("/api/datos-prueba/escenario", { paso });
      expect(r.estado, JSON.stringify(r.datos)).toBe(200);
      total = r.datos.total;
      if (r.datos.omitido) omitidos.push(r.datos.descripcion);
    }
    expect(omitidos.map((x) => x.split(":")[0])).toEqual(["fase-1b/02-unidades.txt", "fase-1b/04-familias.txt"]);
    expect((await p2.query("SELECT count(*)::int AS n FROM unidad")).rows[0].n).toBe(ya);
    expect((await p2.query("SELECT count(*)::int AS n FROM receta WHERE estatus = 'ACTIVA'")).rows[0].n).toBe(7);
    expect((await p2.query("SELECT count(*)::int AS n FROM existencia e JOIN almacen a ON a.id = e.almacen_id WHERE a.clave = 'PT-SUC1'")).rows[0].n).toBe(4);
  }, 240_000);
});
