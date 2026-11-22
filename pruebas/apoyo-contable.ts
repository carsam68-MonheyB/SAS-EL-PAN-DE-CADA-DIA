// Revisión contable al final de las pruebas de cada fase: con el catálogo y las
// reglas de ejemplo, todas las operaciones se contabilizan, la balanza cuadra y
// el inventario contable es igual al kárdex.
import { expect } from "vitest";
import type { Entorno } from "./inventarios-apoyo";

export async function revisarContabilidad(e: Entorno) {
  await e.cargar("cnt", "cuentas", "fase-7/70-catalogo-cuentas.txt");
  await e.cargar("cnt", "reglas_contables", "fase-7/71-reglas-contables.txt");
  const g = await e.nav.cnt!.post("/api/contabilidad/contabilizar");
  expect(g.estado, JSON.stringify(g.datos)).toBe(200);
  expect(g.datos.pendientes, JSON.stringify(g.datos.pendientes)).toEqual([]);
  expect(g.datos.generadas).toBeGreaterThan(0);
  const b = await e.nav.con!.get("/api/contabilidad/balanza?desde=2000-01-01&hasta=2099-12-31");
  expect(b.datos.cuadra).toBe(true);
  const k = await e.nav.con!.get("/api/contabilidad/conciliacion?hasta=2099-12-31");
  expect(k.datos.grupos.map((x: any) => [x.grupo, x.cuadra]), JSON.stringify(k.datos)).toEqual([["MP", true], ["PEP", true], ["PT", true]]);
  const est = await e.nav.con!.get("/api/contabilidad/estados?desde=2000-01-01&hasta=2099-12-31");
  expect(est.datos.balance.cuadra, JSON.stringify(est.datos.balance)).toBe(true);
  return g.datos;
}
