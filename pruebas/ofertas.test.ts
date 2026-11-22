// Ofertas de fin del día (P37) contra Postgres real: el contador o el contralor
// capturan el % y la hora; la caja aplica la oferta sola, sin PIN; un descuento
// adicional sigue pidiendo autorización; el reporte separa lo de oferta y todo se
// contabiliza. Datos FICTICIOS.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { revisarContabilidad } from "./apoyo-contable";
import { prepararInventarios, type Entorno } from "./inventarios-apoyo";

let e: Entorno;
const CON = { usuario: "prueba.con", pin: "4830" };
const caj = () => e.nav.caj!;
const vender = (renglones: Record<string, unknown>[], pagos: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
  caj().post("/api/pos/ventas", { id: randomUUID(), renglones, pagos, ...extra });
const efectivo = (importe: string) => ({ forma: "01", importe });
/** Hora local del negocio más N minutos (HH:MM) y si cruza la medianoche. */
const horaMas = async (min: number) => (await e.pool.query(
  "SELECT to_char((now() + make_interval(mins => $1)) AT TIME ZONE 'America/Mexico_City', 'HH24:MI') AS h, ((now() + make_interval(mins => $1)) AT TIME ZONE 'America/Mexico_City')::date <> (now() AT TIME ZONE 'America/Mexico_City')::date AS cruza",
  [min],
)).rows[0] as { h: string; cruza: boolean };

beforeAll(async () => {
  e = await prepararInventarios("erp_prueba_ofertas");
  await e.cargar("con", "causas_merma", "fase-3/29-causas-merma.txt");
  const c = await e.cargar("jpr", "inventario_inicial", "fase-6/32-inventario-inicial-sucursal.txt");
  expect((await e.nav.con!.post(`/api/cargas/${c.id}/autorizar`)).estado).toBe(200);
  await e.pool.query(
    `INSERT INTO precio_venta (articulo_id, sucursal_id, precio, vigente_desde)
     SELECT a.id, NULL, x.precio, (now() AT TIME ZONE 'America/Mexico_City')::date
       FROM (VALUES ('PRUEBA-CONCHA-V', 14.00), ('PRUEBA-CONCHA-C', 15.00), ('PRUEBA-BOLILLO', 3.00)) AS x(art, precio) JOIN articulo a ON a.clave = x.art`,
  );
  for (const [rol, pin] of [["caj", "4821"], ["con", CON.pin]] as const) {
    expect((await e.nav[rol]!.post("/api/auth/mi-pin", { password: e.password, pin })).estado).toBe(200);
  }
  const est = await caj().get("/api/pos/estado");
  expect((await caj().post("/api/auth/caja", { caja_id: est.datos.cajas[0].id })).estado).toBe(200);
  expect((await caj().post("/api/pos/turno", { fondo: "500" })).estado).toBe(200);
}, 180_000);

describe("captura de ofertas", () => {
  it("solo el contador y el contralor; validan % y hora", async () => {
    expect((await e.nav.enc!.put("/api/ofertas", { descuento_pct: "10", hora_desde: "00:00" })).estado).toBe(403);
    expect((await caj().get("/api/ofertas")).estado).toBe(403);
    expect((await e.nav.cnt!.put("/api/ofertas", { descuento_pct: "100", hora_desde: "00:00" })).estado).toBe(400);
    expect((await e.nav.cnt!.put("/api/ofertas", { descuento_pct: "10", hora_desde: "25:00" })).estado).toBe(400);
    const r = await e.nav.cnt!.put("/api/ofertas", { descuento_pct: "10", hora_desde: "00:00" });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    // Capturar otra vez el mismo alcance actualiza la que ya está.
    const r2 = await e.nav.con!.put("/api/ofertas", { descuento_pct: "20", hora_desde: "00:00" });
    expect(r2.datos.id).toBe(r.datos.id);
    const l = await e.nav.con!.get("/api/ofertas");
    expect(l.datos.ofertas.map((o: any) => [o.articulo, o.familia, o.sucursal, o.descuento_pct, o.hora_desde, o.activo])).toEqual([[null, null, null, "20.00", "00:00", true]]);
    expect(l.datos.puede_editar).toBe(true);
  });
});

describe("la caja aplica la oferta sola", () => {
  it("10 bolillos de $3 con 20 % = $24.00, sin pedir PIN; la caja recibe la oferta de cada producto", async () => {
    const p = await caj().get("/api/pos/productos");
    expect(p.datos.productos.find((x: any) => x.clave === "PRUEBA-BOLILLO").oferta).toEqual({ pct: "20.00", desde: "00:00" });
    const r = await vender([{ articulo: "PRUEBA-BOLILLO", cantidad: "10", oferta: true }], [efectivo("30")]);
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos).toMatchObject({ total: "24.00", cambio: "6.00" });
    const v = (await e.pool.query("SELECT r.descuento::text, r.descuento_oferta::text, v.autorizo_descuento_id FROM venta_renglon r JOIN venta v ON v.id = r.venta_id WHERE v.id = $1", [r.datos.id])).rows[0];
    expect(v).toEqual({ descuento: "6.00", descuento_oferta: "6.00", autorizo_descuento_id: null });
  });

  it("un descuento adicional a la oferta sigue pidiendo la autorización del contador o el contralor", async () => {
    const cuerpo = [{ articulo: "PRUEBA-CONCHA-V", cantidad: "2", descuento: "1" }];
    expect((await vender(cuerpo, [efectivo("30")])).datos.error).toBe("requiere_autorizacion");
    const r = await vender(cuerpo, [efectivo("30")], { autorizacion: CON });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.total).toBe("21.40"); // 28.00 − 5.60 de oferta − 1.00
  });

  it("la oferta del producto manda: si todavía no empieza, no aplica la general", async () => {
    const h = await horaMas(120);
    if (h.cruza) return; // cerca de la medianoche no se puede probar "más tarde hoy"
    expect((await e.nav.cnt!.put("/api/ofertas", { articulo: "PRUEBA-CONCHA-C", descuento_pct: "50", hora_desde: h.h })).estado).toBe(200);
    const p = await caj().get("/api/pos/productos");
    expect(p.datos.productos.find((x: any) => x.clave === "PRUEBA-CONCHA-C").oferta).toEqual({ pct: "50.00", desde: h.h });
    const r = await vender([{ articulo: "PRUEBA-CONCHA-C", cantidad: "2" }], [efectivo("30")]);
    expect(r.datos.total).toBe("30.00");
  });

  it("con 5 minutos de diferencia entre el reloj de la caja y el del servidor, se respeta lo que cobró la caja", async () => {
    const h = await horaMas(3);
    if (h.cruza) return;
    expect((await e.nav.con!.put("/api/ofertas", { articulo: "PRUEBA-CONCHA-V", descuento_pct: "50", hora_desde: h.h })).estado).toBe(200);
    // Sin la marca de la caja, a la hora del servidor todavía no aplica.
    expect((await vender([{ articulo: "PRUEBA-CONCHA-V", cantidad: "1" }], [efectivo("14")])).datos.total).toBe("14.00");
    // La caja ya la aplicó (su reloj va adelantado unos minutos): se acepta.
    expect((await vender([{ articulo: "PRUEBA-CONCHA-V", cantidad: "1", oferta: true }], [efectivo("7")])).datos.total).toBe("7.00");
  });

  it("al desactivarla deja de aplicar", async () => {
    const l = await e.nav.con!.get("/api/ofertas");
    const general = l.datos.ofertas.find((o: any) => !o.articulo && !o.familia);
    expect((await e.nav.con!.put("/api/ofertas", { id: general.id, descuento_pct: "20", hora_desde: "00:00", activo: false })).estado).toBe(200);
    expect((await vender([{ articulo: "PRUEBA-BOLILLO", cantidad: "10" }], [efectivo("30")])).datos.total).toBe("30.00");
    await expect(e.pool.query("DELETE FROM oferta")).rejects.toThrow();
  });
});

describe("reportes y contabilidad", () => {
  it("el reporte de ventas separa el descuento de oferta; todo se contabiliza", async () => {
    const r = await e.nav.con!.get("/api/pos/ventas");
    const conOferta = r.datos.ventas.filter((v: any) => Number(v.descuento_oferta) > 0);
    expect(conOferta.length).toBeGreaterThanOrEqual(2);
    expect(r.datos.ventas.reduce((s: number, v: any) => s + Number(v.descuento), 0)).toBeGreaterThan(r.datos.ventas.reduce((s: number, v: any) => s + Number(v.descuento_oferta), 0));
    await revisarContabilidad(e);
  });
});
