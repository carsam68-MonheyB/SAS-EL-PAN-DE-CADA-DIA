// Fase 2 de punta a punta contra Postgres real, con los archivos de ejemplo
// (FICTICIOS) de datos-ejemplo: recetas N1/N2, % panadero, versiones, ciclos,
// explosión del plan, lotes, requerimiento neto, requisición y costo estándar.
// Las fechas de los ejemplos (2027) se mueven a 2099 para que la prueba no caduque.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { D } from "../src/dominio/recetas";
import { baseLimpia, entrar, instalarAdministrador, Navegador } from "./apoyo";

let pool: pg.Pool;
const nav: Record<string, Navegador> = {};
const FECHAS: [string, string][] = [["01/01/2027", "01/01/2099"], ["02/01/2027", "02/01/2099"]];

function archivo(ruta: string) {
  let t = readFileSync(`datos-ejemplo/${ruta}`).toString("utf8");
  for (const [a, b] of FECHAS) t = t.replaceAll(a, b);
  return Buffer.from(t, "utf8").toString("base64");
}

async function subir(rol: string, layout: string, ruta: string, modo = "alta") {
  return nav[rol]!.post("/api/cargas", { layout, modo, nombre_archivo: ruta.split("/").pop(), contenido: archivo(ruta) });
}

async function cargar(rol: string, layout: string, ruta: string, modo = "alta") {
  const s = await subir(rol, layout, ruta, modo);
  expect(s.estado, JSON.stringify(s.datos)).toBe(200);
  expect(s.datos.errores, `${ruta}: ${JSON.stringify(s.datos.detalle)}`).toBe(0);
  const a = await nav[rol]!.post(`/api/cargas/${s.datos.id}/aplicar`);
  expect(a.datos.estatus, JSON.stringify(a.datos)).toMatch(/aplicada|pendiente_autorizacion/);
  return a.datos;
}

const n = (x: string | null | undefined) => (x === null || x === undefined ? null : new D(x).toDecimalPlaces(6).toFixed());

beforeAll(async () => {
  pool = await baseLimpia("erp_prueba_recetas");
  const admin = (await instalarAdministrador()).nav;
  const r = await admin.post("/api/datos-prueba");
  for (const rol of ["com", "jpr", "cnt", "con", "dir", "pan"]) {
    nav[rol] = new Navegador();
    await entrar(nav[rol]!, `prueba.${rol}`, r.datos.password);
  }
  // Catálogos de la Fase 1B
  await cargar("cnt", "sat", "fase-1b/01-sat.txt");
  await cargar("com", "unidades", "fase-1b/02-unidades.txt");
  await cargar("com", "conversiones", "fase-1b/03-conversiones.txt");
  await cargar("com", "familias", "fase-1b/04-familias.txt");
  await cargar("cnt", "tasas", "fase-1b/09-tasas.txt");
  await cargar("com", "proveedores", "fase-1b/10-proveedores.txt");
  await cargar("com", "insumos", "fase-1b/12-insumos.txt");
  await cargar("jpr", "intermedios", "fase-1b/13-intermedios.txt");
  await cargar("jpr", "productos", "fase-1b/14-productos.txt");
  await cargar("com", "unidades_articulo", "fase-1b/15-unidades-por-articulo.txt");
  const p = await subir("con", "precios", "fase-1b/17-precios.txt");
  await nav.con!.post(`/api/cargas/${p.datos.id}/aplicar`);
  await nav.dir!.post(`/api/cargas/${p.datos.id}/autorizar`);
}, 180_000);

describe("catálogos de producción y recetas por layout", () => {
  it("carga insumos, etapas, turnos, tarifas, GIF, recetas, fórmulas, componentes y etapas", async () => {
    await cargar("com", "insumos", "fase-2/18-insumos-adicionales.txt");
    await cargar("jpr", "etapas", "fase-2/19-etapas.txt");
    await cargar("jpr", "turnos", "fase-2/20-turnos.txt");
    await cargar("con", "tarifas_mod", "fase-2/21-tarifas-mano-de-obra.txt");
    await cargar("con", "tasas_gif", "fase-2/22-tasas-gif.txt");
    await cargar("jpr", "recetas_intermedios", "fase-2/23-recetas-masas.txt");
    await cargar("jpr", "formulas_intermedios", "fase-2/24-formulas-masas.txt");
    await cargar("jpr", "recetas_sku", "fase-2/25-recetas-productos.txt");
    await cargar("jpr", "componentes_sku", "fase-2/26-componentes-productos.txt");
    await cargar("jpr", "etapas_receta", "fase-2/27-etapas-por-receta.txt");
    expect(Number((await pool.query("SELECT count(*) FROM receta WHERE estatus = 'BORRADOR'")).rows[0].count)).toBe(7);
  });

  it("el jefe de producción no carga tarifas de mano de obra (solo el contralor)", async () => {
    const s = await subir("jpr", "tarifas_mod", "fase-2/21-tarifas-mano-de-obra.txt");
    expect(s.estado).toBe(403);
  });

  it("el archivo con errores detecta autorreferencia, ciclo, unidad, clave, negativo, captura y duplicado; no guarda nada", async () => {
    const antes = Number((await pool.query("SELECT count(*) FROM receta_componente")).rows[0].count);
    const s = await subir("jpr", "formulas_intermedios", "fase-2/99-formulas-CON-ERRORES.txt");
    const errores = s.datos.detalle.filter((m: any) => m.severidad === "error");
    expect([...new Set(errores.map((m: any) => m.renglon))].sort((a: any, b: any) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    const texto = errores.map((m: any) => `${m.renglon}:${m.mensaje}`).join("\n");
    expect(texto).toMatch(/3:Una receta no puede llevarse a sí misma/);
    expect(texto).toMatch(/4:Receta circular: PRUEBA-[A-Z-]+ → PRUEBA-[A-Z-]+ → PRUEBA-/);
    expect(texto).toMatch(/5:Receta circular/);
    expect(texto).toMatch(/6:No hay conversión de L a KG/);
    expect(texto).toMatch(/7:El componente "PRUEBA-NO-EXISTE" no existe/);
    expect(texto).toMatch(/8:Debe ser mayor que cero/);
    expect(texto).toMatch(/9:La receta se captura por CANTIDAD: deja vacío el % panadero/);
    expect(texto).toMatch(/10:Registro repetido en el archivo/);
    expect((await nav.jpr!.post(`/api/cargas/${s.datos.id}/aplicar`)).estado).toBe(409);
    expect(Number((await pool.query("SELECT count(*) FROM receta_componente")).rows[0].count)).toBe(antes);
  });

  it("revisión: % panadero convertido a kg y rendimiento calculado con la merma de proceso", async () => {
    const r = await nav.jpr!.get("/api/recetas/PRUEBA-MASA-DULCE");
    expect(r.estado).toBe(200);
    const v = r.datos.versiones[0];
    expect([v.estado, v.problemas, n(v.tamano_calculado), n(v.rendimiento_calculado)]).toEqual(["Borrador", [], "20", "19.6"]); // 20 × (1 − 2 %)
    const blanca = (await nav.jpr!.get("/api/recetas/PRUEBA-MASA-BLANCA")).datos.versiones[0];
    expect([n(blanca.tamano_calculado), n(blanca.rendimiento_calculado)]).toEqual(["24.45", "24"]); // suma 15 + 9 + 0.3 + 0.15; rendimiento capturado
  });

  it("activa las versiones; ya activa no se modifica (ni por layout ni directo en la base)", async () => {
    for (const k of ["PRUEBA-MASA-DULCE", "PRUEBA-COBERTURA", "PRUEBA-MASA-BLANCA", "PRUEBA-CONCHA-V", "PRUEBA-CONCHA-C", "PRUEBA-BOLILLO", "PRUEBA-TELERA"]) {
      const a = await nav.jpr!.post(`/api/recetas/${k}/1/activar`);
      expect(a.estado, `${k}: ${JSON.stringify(a.datos)}`).toBe(200);
    }
    expect((await nav.jpr!.post("/api/recetas/PRUEBA-BOLILLO/1/activar")).estado).toBe(409);
    const s = await subir("jpr", "formulas_intermedios", "fase-2/24-formulas-masas.txt", "actualizacion");
    expect(s.datos.detalle.some((m: any) => /ya está activa/.test(m.mensaje))).toBe(true);
    await expect(pool.query("UPDATE receta SET comentario = 'x' WHERE version = 1")).rejects.toThrow(/ya está activa/);
    await expect(pool.query("UPDATE receta_componente SET merma_pct = 1")).rejects.toThrow(/ya está activa/);
    await expect(pool.query("DELETE FROM receta")).rejects.toThrow(/no se borran/);
  });

  it("una versión con problemas no se activa", async () => {
    await pool.query(
      `INSERT INTO receta (articulo_id, version, nivel, vigente_desde, captura, regla_lote)
       SELECT id, 2, 'N1', '2099-02-01', 'CANTIDAD', 'EXACTO' FROM articulo WHERE clave = 'PRUEBA-COBERTURA'`,
    );
    const a = await nav.jpr!.post("/api/recetas/PRUEBA-COBERTURA/2/activar");
    expect(a.estado).toBe(400);
    expect(JSON.stringify(a.datos.detalles)).toMatch(/No tiene componentes/);
  });

  it("el panadero no ve recetas ni costos", async () => {
    expect((await nav.pan!.get("/api/recetas")).estado).toBe(403);
    expect((await nav.pan!.get("/api/costos")).estado).toBe(403);
    expect((await nav.pan!.get("/api/layouts/formulas_intermedios/registros")).estado).toBe(403);
  });
});

describe("plan de producción y explosión (cálculo manual en los comentarios)", () => {
  let planId: string;

  it("carga el plan por layout; se crea solo en borrador", async () => {
    await cargar("jpr", "plan_produccion", "fase-2/28-plan-produccion.txt");
    const l = await nav.jpr!.get("/api/planes");
    expect(l.datos.planes).toHaveLength(1);
    expect(l.datos.planes[0]).toMatchObject({ estatus: "BORRADOR", turno: "PRUEBA-MAT", productos: 4 });
    planId = l.datos.planes[0].id;
  });

  it("explosión N2 → N1: kg de masa, lotes completos y exactos, sobrante y amasadas", async () => {
    const e = (await nav.jpr!.get(`/api/planes/${planId}`)).datos.explosion;
    expect(e.problemas).toEqual([]);
    const i = Object.fromEntries(e.intermedios.map((x: any) => [x.clave, [n(x.bruto), n(x.lotes), n(x.producido), n(x.sobrante), n(x.amasadas)]]));
    // Masa dulce: conchas 240 y 96 piezas buenas con 4 % de horneado → 250 y 100 a formar × 60 g = 15 + 6 = 21 kg.
    //   Rinde 19.6 por lote, lote completo → 2 lotes = 39.2 kg, sobra 18.2. Amasadora de 25 → 2 amasadas.
    expect(i["PRUEBA-MASA-DULCE"]).toEqual(["21", "2", "39.2", "18.2", "2"]);
    // Cubierta: 350 conchas a formar × 15 g = 5.25 kg; lote exacto de 3 kg → 1.75 lotes.
    expect(i["PRUEBA-COBERTURA"]).toEqual(["5.25", "1.75", "5.25", "0", null]);
    // Masa blanca: bolillo 490 × 80 g ÷ (1 − 2 % formado) = 40 kg + telera 120 × 100 g = 12 → 52 kg.
    //   Rinde 24 por lote → 3 lotes = 72, sobra 20. Amasadora de 30 → 3 amasadas.
    expect(i["PRUEBA-MASA-BLANCA"]).toEqual(["52", "3", "72", "20", "3"]);
  });

  it("explosión N1 → N0: requerimiento bruto de cada materia prima", async () => {
    const e = (await nav.jpr!.get(`/api/planes/${planId}`)).datos.explosion;
    const m = Object.fromEntries(e.materiales.map((x: any) => [x.clave, n(x.bruto)]));
    // Masa dulce por lote (20 kg en % panadero, Σ 200 %): harina 10, azúcar 2.5, mantequilla 2, huevo 1.5, levadura 0.2, sal 0.15, agua 3.65 (= harina × %).
    // Cubierta por lote: harina 1, azúcar 1, mantequilla 0.8, cacao 0.2.  Masa blanca por lote: harina 15, agua 9, sal 0.3, levadura 0.15.
    expect(m).toEqual({
      "PRUEBA-HAR-01": "66.75",  // 2 × 10 + 1.75 × 1 + 3 × 15
      "PRUEBA-AZU-01": "6.75",   // 2 × 2.5 + 1.75 × 1
      "PRUEBA-MAN-01": "5.4",    // 2 × 2 + 1.75 × 0.8
      "PRUEBA-HUE-01": "3",      // 2 × 1.5
      "PRUEBA-LEV-01": "0.85",   // 2 × 0.2 + 3 × 0.15
      "PRUEBA-SAL-01": "1.2",    // 2 × 0.15 + 3 × 0.3
      "PRUEBA-AGU-01": "34.3",   // 2 × 3.65 + 3 × 9
      "PRUEBA-CAC-01": "0.35",   // 1.75 × 0.2
      "PRUEBA-BOL-01": "336",    // 240 + 96 piezas buenas
    });
  });

  it("requerimiento neto con existencias y piezas que alcanzan", async () => {
    const todo = ["PRUEBA-AZU-01", "PRUEBA-MAN-01", "PRUEBA-HUE-01", "PRUEBA-LEV-01", "PRUEBA-SAL-01", "PRUEBA-AGU-01", "PRUEBA-CAC-01", "PRUEBA-BOL-01"].map((a) => ({ articulo: a, existencia: "1000", en_transito: "0" }));
    const g = await nav.jpr!.put(`/api/planes/${planId}/existencias`, { existencias: [...todo, { articulo: "PRUEBA-HAR-01", existencia: "40", en_transito: "10" }, { articulo: "PRUEBA-MASA-BLANCA", existencia: "4", en_transito: "0" }] });
    expect(g.estado, JSON.stringify(g.datos)).toBe(200);
    const e = (await nav.jpr!.get(`/api/planes/${planId}`)).datos.explosion;
    // Masa blanca: 52 − 4 en existencia = 48 → 2 lotes exactos de 24, sin sobrante → harina 2 × 10 + 1.75 + 2 × 15 = 51.75.
    const blanca = e.intermedios.find((x: any) => x.clave === "PRUEBA-MASA-BLANCA");
    expect([n(blanca.a_preparar), n(blanca.lotes), n(blanca.sobrante)]).toEqual(["48", "2", "0"]);
    const h = e.materiales.find((x: any) => x.clave === "PRUEBA-HAR-01");
    // Neto = 51.75 − 40 − 10 = 1.75 kg = 0.07 bultos de 25 kg.
    expect([n(h.bruto), n(h.disponible), n(h.neto), h.unidad_compra, n(h.neto_compra)]).toEqual(["51.75", "50", "1.75", "BULTO", "0.07"]);
    // Falta harina (50 de 51.75): los cuatro panes la usan y se reducen a 50 ÷ 51.75 = 96.6 %.
    const s = Object.fromEntries(e.skus.map((x: any) => [x.clave, [x.alcanzan, x.completo]]));
    expect(s).toEqual({ "PRUEBA-BOLILLO": ["473", false], "PRUEBA-CONCHA-C": ["92", false], "PRUEBA-CONCHA-V": ["231", false], "PRUEBA-TELERA": ["115", false] });
  });

  it("exporta la explosión a Excel para compararla", async () => {
    const r = await nav.jpr!.get(`/api/planes/${planId}/exportar`);
    expect(r.estado).toBe(200);
    expect(r.encabezados.get("content-type")).toMatch(/spreadsheet/);
  });

  it("aprueba el plan, ya no se modifica y genera la requisición en borrador una sola vez", async () => {
    expect((await nav.jpr!.post(`/api/planes/${planId}/aprobar`)).datos.estatus).toBe("APROBADO");
    const otra = await subir("jpr", "plan_produccion", "fase-2/28-plan-produccion.txt", "actualizacion");
    expect(otra.datos.detalle.some((m: any) => /ya está aprobado/.test(m.mensaje))).toBe(true);
    expect((await nav.jpr!.put(`/api/planes/${planId}/existencias`, { existencias: [] })).estado).toBe(409);
    const req = await nav.jpr!.post(`/api/planes/${planId}/requisicion`);
    expect(req.estado, JSON.stringify(req.datos)).toBe(200);
    expect(req.datos.renglones).toBe(1);
    const d = (await nav.jpr!.get(`/api/planes/${planId}`)).datos;
    expect(d.requisiciones[0]).toMatchObject({ estatus: "BORRADOR", renglones: [{ clave: "PRUEBA-HAR-01", cantidad: "1.750000", unidad: "KG", cantidad_compra: "0.070000", unidad_compra: "BULTO" }] });
    expect((await nav.jpr!.post(`/api/planes/${planId}/requisicion`)).estado).toBe(409);
  });

  it("un plan cancelado libera la fecha para un plan nuevo", async () => {
    expect((await nav.jpr!.post(`/api/planes/${planId}/cancelar`, { motivo: "PRUEBA" })).datos.estatus).toBe("CANCELADO");
    const nuevo = await nav.jpr!.post("/api/planes", { fecha: "02/01/2099", turno: "PRUEBA-MAT", renglones: [{ sku: "PRUEBA-TELERA", piezas: "10" }] });
    expect(nuevo.estado, JSON.stringify(nuevo.datos)).toBe(200);
    expect(nuevo.datos.id).not.toBe(planId);
    const malo = await nav.jpr!.post("/api/planes", { fecha: "02/01/2099", turno: "PRUEBA-MAT", renglones: [{ sku: "PRUEBA-TELERA", piezas: "10.5" }] });
    expect(malo.estado).toBe(400);
    expect(JSON.stringify(malo.datos.detalles)).toMatch(/piezas enteras/);
  });
});

describe("costo estándar en cadena", () => {
  // Masa dulce, por lote: MP 185 + 60 + 290 + 63 + 19 + 1.8 + 0.073 = 618.873; amasado 30 min × $2 = 60;
  // GIF $1.20 × 19.6 kg = 23.52 → 702.393 ÷ 19.6 kg.  Cubierta: MP 18.5 + 24 + 116 + 36 = 194.5; GIF 1.2 × 3 = 3.6 → 198.1 ÷ 3 kg.
  const masaDulce = new D("702.393").div("19.6");
  const cubierta = new D("198.1").div(3);
  // Concha de vainilla por pieza buena (4 % de horneado → 1 ÷ 0.96 piezas a formar):
  // masa 0.0625 kg + cubierta 0.015625 kg + bolsa 0.35 + formado 0.5 min y horneado 0.2 min por pieza formada ($1.80 y $1.50).
  const conchaV = masaDulce.mul("0.0625").plus(cubierta.mul("0.015625")).plus("0.35").plus(new D("0.5").mul("1.8").plus(new D("0.2").mul("1.5")).div("0.96"));

  it("costo por kg de cada masa y por pieza de cada SKU, con margen contra el precio", async () => {
    const r = await nav.con!.get("/api/costos?fecha=2099-01-01");
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    const a = Object.fromEntries(r.datos.articulos.map((x: any) => [x.clave, x]));
    expect(n(a["PRUEBA-MASA-DULCE"].costo.total)).toBe(n(masaDulce.toFixed()));
    expect(n(a["PRUEBA-COBERTURA"].costo.total)).toBe(n(cubierta.toFixed()));
    expect(n(a["PRUEBA-CONCHA-V"].costo.total)).toBe(n(conchaV.toFixed()));
    expect(a["PRUEBA-CONCHA-V"].costo.completo).toBe(true);
    // Precio $14.00 con IVA de prueba 0 % → margen = 14 − costo.
    expect(n(a["PRUEBA-CONCHA-V"].costo.margen)).toBe(new D(14).minus(conchaV).toDecimalPlaces(4).toFixed());
    // La telera no tiene datos fiscales ni precio general: no hay margen.
    expect(a["PRUEBA-TELERA"].costo.margen).toBeNull();
  });

  it("simula un cambio de costo de la harina y muestra el impacto en toda la cadena", async () => {
    const r = await nav.con!.post("/api/costos/simular", { fecha: "2099-01-01", cambios: [{ articulo: "PRUEBA-HAR-01", costo: "25" }] });
    const a = Object.fromEntries(r.datos.articulos.map((x: any) => [x.clave, x]));
    // Harina +6.50/kg: masa dulce +65 por lote (10 kg) → +65 ÷ 19.6 por kg; cubierta +6.5 ÷ 3 por kg.
    const nueva = new D("702.393").plus(65).div("19.6");
    expect(n(a["PRUEBA-MASA-DULCE"].nuevo.total)).toBe(n(nueva.toFixed()));
    const delta = new D(65).div("19.6").mul("0.0625").plus(new D("6.5").div(3).mul("0.015625"));
    expect(n(a["PRUEBA-CONCHA-V"].nuevo.diferencia)).toBe(n(delta.toFixed()));
    expect(a["PRUEBA-HAR-01"]).toBeUndefined();
  });

  it("guarda la foto del costo estándar (no se modifica) y la consulta en el historial", async () => {
    const g = await nav.con!.post("/api/costos/costeos", { fecha: "2099-01-01", comentario: "PRUEBA" });
    expect(g.estado, JSON.stringify(g.datos)).toBe(200);
    expect(g.datos.articulos).toBe(7);
    const h = await nav.con!.get(`/api/costos/costeos/${g.datos.id}`);
    expect(n(h.datos.articulos.find((x: any) => x.clave === "PRUEBA-CONCHA-V").total)).toBe(n(conchaV.toFixed()));
    await expect(pool.query("UPDATE costo_estandar SET costo_total = 0")).rejects.toThrow();
  });

  it("dirección (sin permiso de editar recetas ni parámetros) consulta costos pero no guarda costeos", async () => {
    expect((await nav.dir!.get("/api/costos?fecha=2099-01-01")).estado).toBe(200);
    expect((await nav.dir!.post("/api/costos/costeos", { fecha: "2099-01-01" })).estado).toBe(403);
  });

  it("todo quedó en la bitácora íntegra", async () => {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM bitacora_auditoria WHERE tabla IN ('receta', 'receta_componente', 'plan_renglon', 'tarifa_mod')");
    expect(rows[0].n).toBeGreaterThan(30);
    expect((await pool.query("SELECT bitacora_auditoria_verificar() AS roto")).rows[0].roto).toBeNull();
  });
});
