// Apoyo para las pruebas de inventarios: base limpia con catálogos de ejemplo.
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import type pg from "pg";
import { D } from "../src/dominio/recetas";
import { baseLimpia, entrar, instalarAdministrador, Navegador } from "./apoyo";

export const b64 = (ruta: string) => readFileSync(`datos-ejemplo/${ruta}`).toString("base64");
export const n = (x: string | null | undefined) => (x === null || x === undefined ? null : new D(x).toDecimalPlaces(6).toFixed());

export async function prepararInventarios(base: string) {
  const pool = await baseLimpia(base);
  const nav: Record<string, Navegador> = {};
  const admin = (await instalarAdministrador()).nav;
  const r = await admin.post("/api/datos-prueba");
  for (const rol of ["com", "jpr", "cnt", "con", "dir", "alm", "enc", "mae", "caj"]) {
    nav[rol] = new Navegador();
    await entrar(nav[rol]!, `prueba.${rol}`, r.datos.password);
  }
  const subir = (rol: string, layout: string, ruta: string) =>
    nav[rol]!.post("/api/cargas", { layout, modo: "alta", nombre_archivo: ruta.split("/").pop(), contenido: b64(ruta) });
  const cargar = async (rol: string, layout: string, ruta: string) => {
    const s = await subir(rol, layout, ruta);
    expect(s.datos.errores, `${ruta}: ${JSON.stringify(s.datos.detalle ?? s.datos)}`).toBe(0);
    const a = await nav[rol]!.post(`/api/cargas/${s.datos.id}/aplicar`);
    expect(a.datos.estatus, JSON.stringify(a.datos)).toMatch(/aplicada|pendiente_autorizacion/);
    return { id: s.datos.id as string, ...a.datos };
  };
  const existencia = async (almacen: string, articulo: string) => {
    const x = (await pool.query(
      "SELECT e.cantidad::text, e.valor::text FROM existencia e JOIN almacen a ON a.id = e.almacen_id JOIN articulo x ON x.id = e.articulo_id WHERE a.clave = $1 AND x.clave = $2",
      [almacen, articulo],
    )).rows[0];
    return x ? { cantidad: n(x.cantidad), valor: n(x.valor) } : null;
  };
  const otorgar = async (rol: string, permiso: string) => {
    await pool.query("INSERT INTO rol_permiso (rol_id, permiso_id) SELECT r.id, p.id FROM rol r, permiso p WHERE r.clave = $1 AND p.clave = $2 ON CONFLICT DO NOTHING", [rol, permiso]);
  };
  await cargar("cnt", "sat", "fase-1b/01-sat.txt");
  await cargar("com", "unidades", "fase-1b/02-unidades.txt");
  await cargar("com", "conversiones", "fase-1b/03-conversiones.txt");
  await cargar("com", "familias", "fase-1b/04-familias.txt");
  await cargar("cnt", "tasas", "fase-1b/09-tasas.txt");
  await cargar("com", "proveedores", "fase-1b/10-proveedores.txt");
  await cargar("com", "insumos", "fase-1b/12-insumos.txt");
  await cargar("com", "insumos", "fase-2/18-insumos-adicionales.txt");
  await cargar("jpr", "intermedios", "fase-1b/13-intermedios.txt");
  await cargar("jpr", "productos", "fase-1b/14-productos.txt");
  await cargar("com", "unidades_articulo", "fase-1b/15-unidades-por-articulo.txt");
  return { pool, nav, subir, cargar, existencia, otorgar, password: r.datos.password as string };
}

export type Entorno = Awaited<ReturnType<typeof prepararInventarios>>;
