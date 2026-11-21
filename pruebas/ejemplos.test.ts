// Los archivos de ejemplo (FICTICIOS) de datos-ejemplo/fase-1b se cargan en el
// orden del LEEME sin errores, y el archivo con errores a propósito no guarda nada.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { baseLimpia, entrar, instalarAdministrador, Navegador } from "./apoyo";

const CARPETA = "datos-ejemplo/fase-1b";
let pool: pg.Pool;
const nav: Record<string, Navegador> = {};

async function subirArchivo(n: Navegador, layout: string, archivo: string, reemplazos: [string, string][] = []) {
  let bytes: Buffer = readFileSync(`${CARPETA}/${archivo}`);
  if (reemplazos.length) {
    let t = bytes.toString("utf8");
    for (const [a, b] of reemplazos) t = t.replaceAll(a, b);
    bytes = Buffer.from(t, "utf8");
  }
  return n.post("/api/cargas", { layout, modo: "alta", nombre_archivo: archivo, contenido: bytes.toString("base64") });
}

beforeAll(async () => {
  pool = await baseLimpia("erp_prueba_ejemplos");
  const admin = (await instalarAdministrador()).nav;
  const r = await admin.post("/api/datos-prueba");
  for (const rol of ["com", "jpr", "cnt", "con", "dir"]) {
    nav[rol] = new Navegador();
    await entrar(nav[rol]!, `prueba.${rol}`, r.datos.password);
  }
}, 120_000);

describe("datos de ejemplo de la Fase 1B", () => {
  const pasos: [string, string, string][] = [
    ["cnt", "sat", "01-sat.txt"],
    ["com", "unidades", "02-unidades.txt"],
    ["com", "conversiones", "03-conversiones.txt"],
    ["com", "familias", "04-familias.txt"],
    ["cnt", "tasas", "09-tasas.txt"],
    ["com", "proveedores", "10-proveedores.txt"],
    ["com", "insumos", "12-insumos.xlsx"],
    ["jpr", "intermedios", "13-intermedios.txt"],
    ["jpr", "productos", "14-productos.xlsx"],
    ["com", "unidades_articulo", "15-unidades-por-articulo.txt"],
  ];

  it.each(pasos)("%s carga %s (%s) sin errores", async (rol, layout, archivo) => {
    const s = await subirArchivo(nav[rol]!, layout, archivo);
    expect(s.estado, JSON.stringify(s.datos)).toBe(200);
    expect(s.datos.errores, JSON.stringify(s.datos.detalle)).toBe(0);
    const a = await nav[rol]!.post(`/api/cargas/${s.datos.id}/aplicar`);
    expect(a.datos.estatus).toBe("aplicada");
  });

  it("precios: los sube el contralor y los autoriza dirección", async () => {
    // La fecha del ejemplo se mueve al futuro para que la prueba no caduque.
    const s = await subirArchivo(nav.con!, "precios", "17-precios.txt", [["01/01/2027", "01/01/2099"]]);
    expect(s.datos.errores, JSON.stringify(s.datos.detalle)).toBe(0);
    expect((await nav.con!.post(`/api/cargas/${s.datos.id}/aplicar`)).datos.estatus).toBe("pendiente_autorizacion");
    expect((await nav.dir!.post(`/api/cargas/${s.datos.id}/autorizar`)).datos.estatus).toBe("aplicada");
    expect(Number((await pool.query("SELECT count(*) FROM precio_venta")).rows[0].count)).toBe(4);
  });

  it("ya no hay avisos de conversión faltante después de cargar unidades por artículo", async () => {
    const e = await nav.com!.get("/api/layouts/insumos/exportar?formato=txt");
    const s = await nav.com!.post("/api/cargas", { layout: "insumos", modo: "actualizacion", nombre_archivo: "export.txt", contenido: Buffer.from(e.datos as Uint8Array).toString("base64") });
    expect(s.datos.advertencias, JSON.stringify(s.datos.detalle)).toBe(0);
    expect(s.datos.sin_cambios).toBe(6);
  });

  it("el archivo con errores a propósito detecta los 7 y no guarda nada", async () => {
    const antes = Number((await pool.query("SELECT count(*) FROM articulo")).rows[0].count);
    const s = await subirArchivo(nav.com!, "insumos", "99-insumos-CON-ERRORES.txt");
    const conError = new Set(s.datos.detalle.filter((m: any) => m.severidad === "error").map((m: any) => m.renglon));
    expect([...conError].sort()).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect((await nav.com!.post(`/api/cargas/${s.datos.id}/aplicar`)).estado).toBe(409);
    expect(Number((await pool.query("SELECT count(*) FROM articulo")).rows[0].count)).toBe(antes);
  });
});
