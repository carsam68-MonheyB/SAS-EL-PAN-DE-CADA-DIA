// Fase 5 de punta a punta contra Postgres real: plan aprobado → órdenes N1/N2
// enlazadas → vales de surtido con tolerancia → avance por etapa con merma →
// cierre con costo real, balance de masa y piezas → trazabilidad por lote →
// variaciones, rendimiento, sobrantes y estado de costos que cuadra con el kárdex.
// Datos FICTICIOS de datos-ejemplo (fases 1B, 2, 3 y 5). Cálculos a mano en los comentarios.
import { beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { Navegador } from "./apoyo";
import { n, prepararInventarios, type Entorno } from "./inventarios-apoyo";

let pool: pg.Pool;
let nav: Record<string, Navegador>;
let cargar: Entorno["cargar"];
let existencia: Entorno["existencia"];
let planId: string;
const orden: Record<string, string> = {};
let hoy: string;

beforeAll(async () => {
  ({ pool, nav, cargar, existencia } = await prepararInventarios("erp_prueba_produccion"));
  await cargar("jpr", "etapas", "fase-2/19-etapas.txt");
  await cargar("jpr", "turnos", "fase-2/20-turnos.txt");
  await cargar("con", "tarifas_mod", "fase-2/21-tarifas-mano-de-obra.txt");
  await cargar("con", "tasas_gif", "fase-2/22-tasas-gif.txt");
  await cargar("jpr", "recetas_intermedios", "fase-2/23-recetas-masas.txt");
  await cargar("jpr", "formulas_intermedios", "fase-2/24-formulas-masas.txt");
  await cargar("jpr", "recetas_sku", "fase-2/25-recetas-productos.txt");
  await cargar("jpr", "componentes_sku", "fase-2/26-componentes-productos.txt");
  await cargar("jpr", "etapas_receta", "fase-2/27-etapas-por-receta.txt");
  for (const k of ["PRUEBA-MASA-DULCE", "PRUEBA-COBERTURA", "PRUEBA-MASA-BLANCA", "PRUEBA-CONCHA-V", "PRUEBA-CONCHA-C", "PRUEBA-BOLILLO", "PRUEBA-TELERA"]) {
    const a = await nav.jpr!.post(`/api/recetas/${k}/1/activar`);
    expect(a.estado, `${k}: ${JSON.stringify(a.datos)}`).toBe(200);
  }
  const c = await cargar("jpr", "inventario_inicial", "fase-3/31-inventario-inicial.txt");
  expect((await nav.con!.post(`/api/cargas/${c.id}/autorizar`)).estado).toBe(200);
  await cargar("jpr", "plan_produccion", "fase-2/28-plan-produccion.txt");
  planId = (await nav.jpr!.get("/api/planes")).datos.planes[0].id;
  expect((await nav.jpr!.post(`/api/planes/${planId}/aprobar`)).datos.estatus).toBe("APROBADO");
  hoy = (await pool.query("SELECT (now() AT TIME ZONE 'America/Mexico_City')::date::text AS h")).rows[0].h;
}, 240_000);

const detalle = async (clave: string, rol = "jpr") => (await nav[rol]!.get(`/api/produccion/ordenes/${orden[clave]}`)).datos;

describe("órdenes desde el plan", () => {
  it("el almacenista no genera órdenes; el jefe de producción sí, una sola vez", async () => {
    expect((await nav.alm!.post(`/api/produccion/planes/${planId}/generar`, {})).estado).toBe(403);
    const g = await nav.jpr!.post(`/api/produccion/planes/${planId}/generar`, {});
    expect(g.estado, JSON.stringify(g.datos)).toBe(200);
    expect(g.datos.ordenes).toHaveLength(7);
    expect((await nav.jpr!.post(`/api/produccion/planes/${planId}/generar`, {})).estado).toBe(409);
    const l = (await nav.jpr!.get(`/api/produccion/ordenes?plan=${planId}`)).datos.ordenes;
    for (const o of l) orden[o.articulo] = o.id;
    const resumen = Object.fromEntries(l.map((o: any) => [o.articulo, [o.nivel, n(o.cantidad_plan), o.estatus, o.almacen]]));
    expect(resumen).toEqual({
      // Explosión de la Fase 2: masa dulce 2 lotes = 39.2 kg; cubierta 1.75 lotes = 5.25 kg; masa blanca 3 lotes = 72 kg.
      "PRUEBA-MASA-DULCE": ["N1", "39.2", "LIBERADA", "PEP-MAT"],
      "PRUEBA-COBERTURA": ["N1", "5.25", "LIBERADA", "PEP-MAT"],
      "PRUEBA-MASA-BLANCA": ["N1", "72", "LIBERADA", "PEP-MAT"],
      "PRUEBA-CONCHA-V": ["N2", "240", "LIBERADA", "PEP-MAT"],
      "PRUEBA-CONCHA-C": ["N2", "96", "LIBERADA", "PEP-MAT"],
      "PRUEBA-BOLILLO": ["N2", "490", "LIBERADA", "PEP-MAT"],
      "PRUEBA-TELERA": ["N2", "120", "LIBERADA", "PEP-MAT"],
    });
  });

  it("cada orden congela su estándar: masa blanca 3 lotes → 45 kg de harina, 75 min de amasado; el bolillo depende de la masa blanca", async () => {
    const d = await detalle("PRUEBA-MASA-BLANCA");
    expect(Object.fromEntries(d.componentes.map((x: any) => [x.clave, n(x.cantidad_estandar)]))).toEqual({ "PRUEBA-HAR-01": "45", "PRUEBA-AGU-01": "27", "PRUEBA-SAL-01": "0.9", "PRUEBA-LEV-01": "0.45" });
    expect(d.etapas.map((e: any) => [e.clave, n(e.minutos_estandar)])).toEqual([["PRUEBA-AMASADO", "75"]]);
    expect(n(d.orden.costo_estandar)).toBe("15.597083"); // (277.5 + 0.18 + 3.6 + 14.25) ÷ 24 + 50 ÷ 24 + 1.20
    expect(d.abastece.map((x: any) => x.articulo).sort()).toEqual(["PRUEBA-BOLILLO", "PRUEBA-TELERA"]);
    const b = await detalle("PRUEBA-BOLILLO");
    expect(b.depende).toMatchObject([{ articulo: "PRUEBA-MASA-BLANCA", cantidad: "40.000000" }]); // 490 × 80 g ÷ 0.98
    expect(b.componentes.map((x: any) => [x.clave, x.tipo, n(x.cantidad_estandar)])).toEqual([["PRUEBA-MASA-BLANCA", "MASA", "40"]]);
    const cv = await detalle("PRUEBA-CONCHA-V");
    expect(cv.depende.map((x: any) => x.articulo).sort()).toEqual(["PRUEBA-COBERTURA", "PRUEBA-MASA-DULCE"]);
  });

  it("una orden manual de bolillo para un pedido especial", async () => {
    const r = await nav.jpr!.post("/api/produccion/ordenes", { articulo: "PRUEBA-BOLILLO", cantidad: "60", fecha: "2027-01-02", almacen: "PEP-MAT", comentario: "PRUEBA pedido especial" });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.folio).toMatch(/^OP-\d{6}$/);
    orden.MANUAL = r.datos.id;
    expect((await nav.jpr!.post("/api/produccion/ordenes", { articulo: "PRUEBA-HAR-01", cantidad: "1", almacen: "PEP-MAT" })).estado).toBe(400);
  });
});

describe("vales de surtido por orden", () => {
  it("el almacenista ve la orden y surte desde su almacén; pasar del estándar más 5 % exige motivo", async () => {
    expect((await nav.alm!.get(`/api/produccion/ordenes/${orden["PRUEBA-MASA-BLANCA"]}`)).estado).toBe(200);
    const renglones = [{ articulo: "PRUEBA-HAR-01", cantidad: "50" }, { articulo: "PRUEBA-AGU-01", cantidad: "27" }, { articulo: "PRUEBA-SAL-01", cantidad: "0.9" }, { articulo: "PRUEBA-LEV-01", cantidad: "0.45" }];
    const s = await nav.alm!.post(`/api/produccion/ordenes/${orden["PRUEBA-MASA-BLANCA"]}/surtir`, { origen: "MP-MAT", renglones });
    expect(s.estado).toBe(409);
    expect(JSON.stringify(s.datos)).toMatch(/PRUEBA-HAR-01: se surtirían 50 contra 45/);
    const ok = await nav.alm!.post(`/api/produccion/ordenes/${orden["PRUEBA-MASA-BLANCA"]}/surtir`, { origen: "MP-MAT", renglones, motivo: "PRUEBA harina extra para espolvorear" });
    expect(ok.estado, JSON.stringify(ok.datos)).toBe(200);
    expect(ok.datos.folio).toMatch(/^VAL-/);
    expect(await existencia("PEP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "50", valor: "925" });
    const d = await detalle("PRUEBA-MASA-BLANCA");
    expect(d.componentes.find((x: any) => x.clave === "PRUEBA-HAR-01").surtido).toBe("50");
    expect(d.vales[0].comentario).toMatch(/Sobre estándar: PRUEBA harina extra/);
  });

  it("no se surte masa (sale de su orden) ni un material ajeno a la receta", async () => {
    expect((await nav.alm!.post(`/api/produccion/ordenes/${orden["PRUEBA-BOLILLO"]}/surtir`, { origen: "MP-MAT", renglones: [{ articulo: "PRUEBA-MASA-BLANCA", cantidad: "1" }] })).estado).toBe(400);
    expect((await nav.alm!.post(`/api/produccion/ordenes/${orden["PRUEBA-BOLILLO"]}/surtir`, { origen: "MP-MAT", renglones: [{ articulo: "PRUEBA-AZU-01", cantidad: "1" }] })).estado).toBe(400);
  });

  it("surte la masa dulce, la cubierta y las bolsas de las conchas (huevo por lote FEFO)", async () => {
    const surtir = async (clave: string, renglones: [string, string][]) => {
      const r = await nav.alm!.post(`/api/produccion/ordenes/${orden[clave]}/surtir`, { origen: "MP-MAT", renglones: renglones.map(([articulo, cantidad]) => ({ articulo, cantidad })) });
      expect(r.estado, `${clave}: ${JSON.stringify(r.datos)}`).toBe(200);
    };
    // Masa dulce por lote (20 kg, % panadero): harina 10, azúcar 2.5, mantequilla 2, huevo 1.5, levadura 0.2, sal 0.15, agua 3.65 → × 2 lotes
    await surtir("PRUEBA-MASA-DULCE", [["PRUEBA-HAR-01", "20"], ["PRUEBA-AZU-01", "5"], ["PRUEBA-MAN-01", "4"], ["PRUEBA-HUE-01", "3"], ["PRUEBA-LEV-01", "0.4"], ["PRUEBA-SAL-01", "0.3"], ["PRUEBA-AGU-01", "7.3"]]);
    // Cubierta 1.75 lotes de 3 kg: harina, azúcar 1.75; mantequilla 1.4; cacao 0.35
    await surtir("PRUEBA-COBERTURA", [["PRUEBA-HAR-01", "1.75"], ["PRUEBA-AZU-01", "1.75"], ["PRUEBA-MAN-01", "1.4"], ["PRUEBA-CAC-01", "0.35"]]);
    await surtir("PRUEBA-CONCHA-V", [["PRUEBA-BOL-01", "240"]]);
    expect(await existencia("PEP-MAT", "PRUEBA-HUE-01")).toEqual({ cantidad: "3", valor: "126" });
  });
});

describe("avance y cierre de órdenes de masa", () => {
  it("el panadero no cierra; cerrar sin material en producción en proceso avisa que falta surtir", async () => {
    expect((await nav.pan!.post(`/api/produccion/ordenes/${orden["PRUEBA-MASA-BLANCA"]}/cerrar`, { cantidad: "72" })).estado).toBe(403);
    const t = await nav.jpr!.post(`/api/produccion/ordenes/${orden["PRUEBA-TELERA"]}/cerrar`, { cantidad: "120" });
    expect(t.estado).toBe(409);
    expect(t.datos.mensaje).toMatch(/PRUEBA-MASA-BLANCA.*Surte primero/);
  });

  it("masa blanca: 72 kg al costo real = materiales 886.59 + amasado 75 min × $2 + GIF 72 kg × $1.20 = $1,122.99", async () => {
    const av = await nav.mae!.post(`/api/produccion/ordenes/${orden["PRUEBA-MASA-BLANCA"]}/avance`, { etapa: "PRUEBA-AMASADO", cantidad: "72", minutos: "75" });
    expect(av.estado, JSON.stringify(av.datos)).toBe(200);
    expect(av.datos.estatus).toBe("EN_PROCESO");
    const c = await nav.mae!.post(`/api/produccion/ordenes/${orden["PRUEBA-MASA-BLANCA"]}/cerrar`, { cantidad: "72" });
    expect(c.estado, JSON.stringify(c.datos)).toBe(200);
    // El maestro de masas no ve costos.
    expect(c.datos.costo_total).toBeNull();
    const d = (await nav.con!.get(`/api/produccion/ordenes/${orden["PRUEBA-MASA-BLANCA"]}`)).datos;
    // 45 × 18.50 + 27 × 0.02 + 0.9 × 12 + 0.45 × 95 = 832.5 + 0.54 + 10.8 + 42.75
    expect([n(d.orden.costo_mp), n(d.orden.costo_mod), n(d.orden.costo_gif), n(d.orden.costo_total), n(d.orden.costo_unitario)]).toEqual(["886.59", "150", "86.4", "1122.99", "15.597083"]);
    expect(d.orden.fuera_tolerancia).toBe(false);
    expect(n(d.orden.balance.total.variacion)).toBe("0.000024"); // 1,122.99 − 15.597083 × 72 (redondeo del estándar a 6 decimales)
    expect(await existencia("PEP-MAT", "PRUEBA-MASA-BLANCA")).toEqual({ cantidad: "72", valor: "1122.99" });
    // Quedan en producción en proceso los 5 kg de harina de más y los 21.75 surtidos a la masa dulce y la cubierta.
    expect(await existencia("PEP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "26.75", valor: "494.875" });
  });

  it("masa dulce y cubierta se cierran con su estándar; la genealogía guarda el lote de huevo", async () => {
    for (const [k, q] of [["PRUEBA-MASA-DULCE", "39.2"], ["PRUEBA-COBERTURA", "5.25"]]) {
      const c = await nav.jpr!.post(`/api/produccion/ordenes/${orden[k!]}/cerrar`, { cantidad: q });
      expect(c.estado, `${k}: ${JSON.stringify(c.datos)}`).toBe(200);
    }
    const d = await detalle("PRUEBA-MASA-DULCE");
    expect(d.lotes.find((l: any) => l.articulo === "PRUEBA-HUE-01")).toMatchObject({ lote: "PRUEBA-HUE-A", cantidad: "3.000000" });
    expect(d.lotes.find((l: any) => l.articulo === "PRUEBA-HAR-01")).toMatchObject({ lote: "PRUEBA-HAR-A" });
    expect((await nav.mae!.post(`/api/produccion/ordenes/${orden["PRUEBA-MASA-DULCE"]}/avance`, { etapa: "PRUEBA-AMASADO", cantidad: "1" })).estado).toBe(409);
  });
});

describe("cierre de productos con balance de masa y piezas", () => {
  it("bolillo: el panadero registra 10 piezas quemadas en horneado; solo se registra merma en etapas que la llevan", async () => {
    expect((await nav.pan!.post(`/api/produccion/ordenes/${orden["PRUEBA-BOLILLO"]}/avance`, { etapa: "PRUEBA-AMASADO", merma: "2", causa: "QUEMADO" })).estado).toBe(400);
    expect((await nav.pan!.post(`/api/produccion/ordenes/${orden["PRUEBA-BOLILLO"]}/avance`, { etapa: "PRUEBA-HORNEADO", merma: "2" })).estado).toBe(400);
    const r = await nav.pan!.post(`/api/produccion/ordenes/${orden["PRUEBA-BOLILLO"]}/avance`, { etapa: "PRUEBA-HORNEADO", cantidad: "480", merma: "10", causa: "QUEMADO" });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
  });

  it("bolillo: 480 buenas de 490 formadas con 40 kg de masa: balance dentro y costo real", async () => {
    const datos = { cantidad: "480", consumos: [{ articulo: "PRUEBA-MASA-BLANCA", cantidad: "40" }] };
    // Las órdenes de producto las cierra el jefe de producción (el maestro de masas cierra las de masa).
    expect((await nav.mae!.post(`/api/produccion/ordenes/${orden["PRUEBA-BOLILLO"]}/cerrar`, datos)).estado).toBe(403);
    const c = await nav.jpr!.post(`/api/produccion/ordenes/${orden["PRUEBA-BOLILLO"]}/cerrar`, datos);
    expect(c.estado, JSON.stringify(c.datos)).toBe(200);
    expect(c.datos.fuera_tolerancia).toBe(false);
    const d = (await nav.con!.get(`/api/produccion/ordenes/${orden["PRUEBA-BOLILLO"]}`)).datos;
    const b = d.orden.balance;
    // Estándar para 480 buenas: 480 × 0.08 ÷ 0.98 = 39.183673 kg; real 40 (+2.08 %); 40 kg debían rendir 490 piezas (−2.04 %).
    expect([n(b.masa.estandar), n(b.masa.real), b.masa.dentro]).toEqual(["39.183673", "40", true]);
    expect([n(b.piezas.esperadas), n(b.piezas.buenas), n(b.piezas.formadas), n(b.piezas.merma), n(b.piezas.sin_explicar), b.piezas.dentro]).toEqual(["490", "480", "490", "10", "0", true]);
    // Masa: 40 kg × 1,122.99 ÷ 72 = 623.883333; formado 12 min por 60 piezas × 490 formadas ÷ 490 × 480 = 96 min × $1.80 = 172.80; sin GIF por pieza.
    expect([n(d.orden.costo_mp), n(d.orden.costo_mod), n(d.orden.costo_gif), n(d.orden.costo_total)]).toEqual(["623.883333", "172.8", "0", "796.683333"]);
    expect(await existencia("PT-MAT", "PRUEBA-BOLILLO")).toEqual({ cantidad: "580", valor: n(String(150 + 796.683333)) }); // 100 iniciales a $1.50 + 480
    expect(await existencia("PEP-MAT", "PRUEBA-MASA-BLANCA")).toEqual({ cantidad: "32", valor: "499.106667" });
  });

  it("concha de vainilla fuera de tolerancia: 20 kg de masa contra 15 estándar exige justificación", async () => {
    const datos = { cantidad: "240", consumos: [{ articulo: "PRUEBA-MASA-DULCE", cantidad: "20" }] };
    const r = await nav.jpr!.post(`/api/produccion/ordenes/${orden["PRUEBA-CONCHA-V"]}/cerrar`, datos);
    expect(r.estado).toBe(409);
    expect(r.datos.error).toBe("tolerancia");
    expect(JSON.stringify(r.datos.detalles)).toMatch(/Balance de masa: se usaron 20 kg contra 15 kg/);
    expect(JSON.stringify(r.datos.detalles)).toMatch(/Balance de piezas/);
    // Nada se movió: la masa sigue en producción en proceso.
    expect((await existencia("PEP-MAT", "PRUEBA-MASA-DULCE"))!.cantidad).toBe("39.2");
    const ok = await nav.jpr!.post(`/api/produccion/ordenes/${orden["PRUEBA-CONCHA-V"]}/cerrar`, { ...datos, justificacion: "PRUEBA conchas más grandes por pedido" });
    expect(ok.estado, JSON.stringify(ok.datos)).toBe(200);
    expect(ok.datos.fuera_tolerancia).toBe(true);
  });

  it("se cancela la orden de telera con motivo; la orden manual sigue abierta", async () => {
    expect((await nav.mae!.post(`/api/produccion/ordenes/${orden["PRUEBA-TELERA"]}/cancelar`, { motivo: "PRUEBA" })).estado).toBe(403);
    const r = await nav.jpr!.post(`/api/produccion/ordenes/${orden["PRUEBA-TELERA"]}/cancelar`, { motivo: "PRUEBA no hubo horno" });
    expect(r.estado).toBe(200);
    expect((await nav.jpr!.post(`/api/produccion/ordenes/${orden["PRUEBA-TELERA"]}/cancelar`, { motivo: "otra vez" })).estado).toBe(409);
  });
});

describe("controles del inventario", () => {
  it("la entrada de producción directa (Fase 3) queda desactivada y el kárdex de una orden no se cancela desde inventario", async () => {
    const e = await nav.jpr!.post("/api/inventarios/produccion", { almacen: "PT-MAT", renglones: [{ articulo: "PRUEBA-BOLILLO", cantidad: "10" }] });
    expect(e.estado).toBe(409);
    expect(e.datos.mensaje).toMatch(/al cerrar su orden/);
    const d = await detalle("PRUEBA-BOLILLO", "con");
    const movId = (await pool.query("SELECT entrada_id FROM orden_produccion WHERE id = $1", [orden["PRUEBA-BOLILLO"]])).rows[0].entrada_id;
    const c = await nav.con!.post(`/api/inventarios/movimientos/${movId}/cancelar`, { motivo: "PRUEBA" });
    expect(c.estado).toBe(409);
    expect(d.orden.entrada).toMatch(/^MOV-/);
  });

  it("una orden cerrada no se modifica ni en la base; el kárdex cuadra", async () => {
    await expect(pool.query("UPDATE orden_produccion SET cantidad_real = 1 WHERE id = $1", [orden["PRUEBA-BOLILLO"]])).rejects.toThrow(/ya no se modifica/);
    await expect(pool.query("DELETE FROM orden_avance")).rejects.toThrow();
    expect((await pool.query("SELECT * FROM inventario_diferencias()")).rows).toEqual([]);
  });
});

describe("trazabilidad y reportes", () => {
  it("el lote de harina PRUEBA-HAR-A llega a las masas y de ahí al bolillo y a la concha", async () => {
    const t = await nav.con!.get("/api/produccion/trazabilidad?lote=PRUEBA-HAR-A");
    expect(t.estado, JSON.stringify(t.datos)).toBe(200);
    const productos = new Set(t.datos.adelante.map((x: any) => x.producto));
    expect(productos).toEqual(new Set(["PRUEBA-MASA-BLANCA", "PRUEBA-MASA-DULCE", "PRUEBA-COBERTURA", "PRUEBA-BOLILLO", "PRUEBA-CONCHA-V"]));
    const atras = await nav.con!.get(`/api/produccion/trazabilidad?orden=${(await detalle("PRUEBA-CONCHA-V")).orden.folio}`);
    const lotes = new Set(atras.datos.atras.filter((x: any) => x.lote).map((x: any) => x.lote));
    expect(lotes).toEqual(new Set(["PRUEBA-HAR-A", "PRUEBA-MAN-A", "PRUEBA-HUE-A", "PRUEBA-LEV-A", "PRUEBA-CAC-A"]));
  });

  it("variaciones: la concha absorbe 5 kg de masa de más; el maestro no ve el reporte de costos", async () => {
    expect((await nav.mae!.get(`/api/produccion/variaciones?desde=2027-01-01&hasta=2027-01-31`)).estado).toBe(403);
    const v = await nav.con!.get(`/api/produccion/variaciones?desde=2027-01-01&hasta=2027-01-31`);
    expect(v.estado, JSON.stringify(v.datos)).toBe(200);
    expect(v.datos.ordenes).toHaveLength(5);
    const cv = v.datos.ordenes.find((o: any) => o.articulo === "PRUEBA-CONCHA-V");
    expect([cv.fuera_tolerancia, cv.justificacion]).toEqual([true, "PRUEBA conchas más grandes por pedido"]);
    expect(Number(cv.variacion)).toBeGreaterThan(0);
    const masa = v.datos.materiales.find((m: any) => m.clave === "PRUEBA-MASA-DULCE");
    expect([n(masa.estandar), n(masa.real)]).toEqual(["15", "20"]);
    const x = await nav.con!.get(`/api/produccion/variaciones?desde=2027-01-01&hasta=2027-01-31&formato=xlsx`);
    expect(x.encabezados.get("content-type")).toMatch(/spreadsheet/);
  });

  it("rendimiento: 10 bolillos quemados en horneado, registrados por el panadero", async () => {
    const r = (await nav.jpr!.get(`/api/produccion/rendimiento?desde=2027-01-01&hasta=2027-01-31`)).datos;
    expect(r.por_causa).toEqual([{ etapa: "PRUEBA-HORNEADO", causa: "QUEMADO", producto: "PRUEBA-BOLILLO", merma: "10.000000" }]);
    expect(r.por_persona.find((p: any) => p.usuario === "prueba.pan")).toMatchObject({ merma: "10.000000", merma_pct: "2.04" });
    const b = r.productos.find((p: any) => p.clave === "PRUEBA-BOLILLO");
    expect([n(b.planeado), n(b.real), b.cumplimiento_pct]).toEqual(["490", "480", "97.96"]);
  });

  it("sobrantes en producción en proceso: masa blanca (no reutilizable) y masa dulce (reutilizable)", async () => {
    const s = (await nav.jpr!.get("/api/produccion/sobrantes")).datos.sobrantes;
    const blanca = s.find((x: any) => x.clave === "PRUEBA-MASA-BLANCA");
    expect([n(blanca.cantidad), blanca.sobrante_reutilizable, blanca.accion]).toEqual(["32", false, "No se reutiliza: registrar merma"]);
    expect(s.find((x: any) => x.clave === "PRUEBA-MASA-DULCE").accion).toMatch(/Se reutiliza/);
    expect(s.find((x: any) => x.clave === "PRUEBA-HAR-01").accion).toMatch(/regresar al almacén/);
  });

  it("estado de costo de producción y ventas del día: cuadra con el kárdex", async () => {
    const e = await nav.con!.get(`/api/produccion/estado-costos?desde=${hoy}&hasta=${hoy}`);
    expect(e.estado, JSON.stringify(e.datos)).toBe(200);
    expect(e.datos.comprobaciones.every((x: any) => x.cuadra), JSON.stringify(e.datos.comprobaciones)).toBe(true);
    const l = Object.fromEntries(e.datos.lineas.map((x: any) => [x.concepto, x.importe]));
    const ord = (await pool.query("SELECT sum(costo_mod)::numeric(14,2)::text AS mod, sum(costo_gif)::numeric(14,2)::text AS gif FROM orden_produccion WHERE estatus = 'CERRADA'")).rows[0];
    expect([l["+ Mano de obra aplicada"], l["+ Gastos indirectos aplicados"]]).toEqual([ord.mod, ord.gif]);
    expect(l["= Costo de lo vendido"]).toBe("0.00");
    // Sin alcance a todas las sucursales hay que elegir una de las propias.
    expect((await nav.jpr!.get(`/api/produccion/estado-costos?desde=${hoy}&hasta=${hoy}`)).estado).toBe(403);
    expect((await nav.jpr!.get(`/api/produccion/estado-costos?desde=${hoy}&hasta=${hoy}&sucursal=MAT`)).estado).toBe(200);
  });
});
