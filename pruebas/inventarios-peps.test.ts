// Inventarios con método PEPS (primeras entradas, primeras salidas): capas de
// costo, salidas que cruzan capas, cancelación exacta de entradas y vales.
import { beforeAll, describe, expect, it } from "vitest";
import { prepararInventarios, type Entorno } from "./inventarios-apoyo";

let e: Entorno;

beforeAll(async () => {
  e = await prepararInventarios("erp_prueba_inventarios_peps");
  // Sin movimientos todavía, el método sí se puede cambiar (queda en la bitácora).
  await e.pool.query("UPDATE configuracion SET valor = 'PEPS' WHERE clave = 'inventarios.metodo_valuacion'");
  const c = await e.cargar("jpr", "inventario_inicial", "fase-3/31-inventario-inicial.txt");
  expect((await e.nav.con!.post(`/api/cargas/${c.id}/autorizar`)).estado).toBe(200);
}, 180_000);

const capas = async () => (await e.pool.query(
  `SELECT k.costo_unitario::text AS costo, k.cantidad_restante::text AS cantidad, k.valor_restante::text AS valor
     FROM capa_costo k JOIN almacen a ON a.id = k.almacen_id JOIN articulo x ON x.id = k.articulo_id
    WHERE a.clave = 'MP-MAT' AND x.clave = 'PRUEBA-HAR-01' AND k.cantidad_restante > 0 ORDER BY k.consecutivo`,
)).rows.map((r) => [Number(r.costo), Number(r.cantidad), Number(r.valor)]);

describe("PEPS", () => {
  let compra: string;
  it("la compra abre una capa nueva: 200 kg a $18.50 y 50 kg a $18.00", async () => {
    const r = await e.nav.alm!.post("/api/inventarios/compras", {
      almacen: "MP-MAT", renglones: [{ articulo: "PRUEBA-HAR-01", cantidad: "2", unidad: "BULTO", costo_unitario: "450", lote: "PRUEBA-HAR-B", caducidad: "2027-04-30" }],
    });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    compra = r.datos.id;
    expect(await capas()).toEqual([[18.5, 200, 3700], [18, 50, 900]]);
  });

  it("salen 220 kg: 200 de la capa antigua ($3,700) + 20 de la nueva ($360) = $4,060", async () => {
    const r = await e.nav.alm!.post("/api/inventarios/surtidos", { origen: "MP-MAT", destino: "PEP-MAT", renglones: [{ articulo: "PRUEBA-HAR-01", cantidad: "220" }] });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(await e.existencia("PEP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "220", valor: "4060" });
    expect(await e.existencia("MP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "30", valor: "540" });
    expect(await capas()).toEqual([[18, 30, 540]]);
  });

  it("una compra ya usada en parte no se cancela; una sin usar se cancela exacta", async () => {
    await e.otorgar("ALM", "compras.recepcion:cancelar");
    const r = await e.nav.alm!.post(`/api/inventarios/movimientos/${compra}/cancelar`, { motivo: "Prueba" });
    expect(r.estado).toBe(409);
    expect(r.datos.mensaje).toMatch(/ya se usó/);
    const nueva = await e.nav.alm!.post("/api/inventarios/compras", {
      almacen: "MP-MAT", renglones: [{ articulo: "PRUEBA-HAR-01", cantidad: "10", costo_unitario: "20", lote: "PRUEBA-HAR-C", caducidad: "2027-05-31" }],
    });
    expect(await e.existencia("MP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "40", valor: "740" });
    const c = await e.nav.alm!.post(`/api/inventarios/movimientos/${nueva.datos.id}/cancelar`, { motivo: "Prueba" });
    expect(c.estado, JSON.stringify(c.datos)).toBe(200);
    expect(await e.existencia("MP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "30", valor: "540" });
  });

  it("cancelar el vale regresa cada capa con su costo original", async () => {
    await e.otorgar("ALM", "inventarios.surtido:cancelar");
    const s = (await e.pool.query("SELECT salida_id FROM surtido")).rows[0].salida_id;
    const r = await e.nav.alm!.post(`/api/inventarios/movimientos/${s}/cancelar`, { motivo: "Prueba" });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(await e.existencia("PEP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "0", valor: "0" });
    expect(await e.existencia("MP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "250", valor: "4600" });
    expect((await capas()).map((k) => k[0]).sort()).toEqual([18, 18, 18.5]);
  });

  it("el valor de la existencia es la suma de sus capas y todo cuadra con el kárdex", async () => {
    const { rows } = await e.pool.query(
      `SELECT e.almacen_id, e.articulo_id FROM existencia e
         LEFT JOIN (SELECT almacen_id, articulo_id, sum(valor_restante) AS v, sum(cantidad_restante) AS q FROM capa_costo GROUP BY 1, 2) k USING (almacen_id, articulo_id)
        WHERE coalesce(k.v, 0) <> e.valor OR coalesce(k.q, 0) <> e.cantidad`,
    );
    expect(rows).toEqual([]);
    expect((await e.pool.query("SELECT * FROM inventario_diferencias()")).rows).toEqual([]);
  });
});
