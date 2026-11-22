// Fase 3 de punta a punta contra Postgres real con costo PROMEDIO: inventario
// inicial por layout con autorización, compra, surtido por lotes (FEFO), conteo
// con ajuste autorizado y límites, traspaso con faltante, mermas con
// segregación y límites, cancelaciones, alcance por almacén y kárdex cuadrado.
// Datos FICTICIOS de datos-ejemplo/fase-3.
import { beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { Navegador } from "./apoyo";
import { n, prepararInventarios, type Entorno } from "./inventarios-apoyo";

let pool: pg.Pool;
let nav: Record<string, Navegador>;
let subir: Entorno["subir"];
let cargar: Entorno["cargar"];
let existencia: Entorno["existencia"];
let otorgar: Entorno["otorgar"];

beforeAll(async () => {
  ({ pool, nav, subir, cargar, existencia, otorgar } = await prepararInventarios("erp_prueba_inventarios"));
}, 180_000);

describe("catálogos e inventario inicial por layout", () => {
  it("carga causas de merma (contralor) y mínimos por almacén (compras)", async () => {
    await cargar("con", "causas_merma", "fase-3/29-causas-merma.txt");
    await cargar("com", "minimos_almacen", "fase-3/30-minimos-por-almacen.txt");
    expect((await pool.query("SELECT count(*)::int AS n FROM causa_merma")).rows[0].n).toBe(4);
  });

  it("el archivo con errores detecta lote faltante o sobrante, tipo de almacén, clave, negativo, piezas fraccionadas y costo vacío", async () => {
    const s = await subir("jpr", "inventario_inicial", "fase-3/99-inventario-CON-ERRORES.txt");
    expect(s.estado).toBe(200);
    const errores = s.datos.detalle.filter((x: any) => x.severidad === "error");
    const de = (renglon: number) => errores.filter((x: any) => x.renglon === renglon).map((x: any) => x.mensaje).join(" | ");
    expect(de(2)).toMatch(/maneja lote/);
    expect(de(3)).toMatch(/no maneja lote/);
    expect(de(4)).toMatch(/caducidad/);
    expect(de(5)).toMatch(/no va en un almacén MP/);
    expect(de(6)).toMatch(/no va en un almacén PT/);
    expect(de(7)).toMatch(/no existe/i);
    expect(de(8)).not.toBe("");
    expect(de(9)).toMatch(/enteros/);
    expect(de(10)).not.toBe("");
    expect((await pool.query("SELECT count(*)::int AS n FROM movimiento")).rows[0].n).toBe(0);
  });

  it("el inventario inicial queda pendiente hasta que lo autoriza el contralor y entra como movimiento INICIAL", async () => {
    const c = await cargar("jpr", "inventario_inicial", "fase-3/31-inventario-inicial.txt");
    expect(c.estatus).toBe("pendiente_autorizacion");
    expect(await existencia("MP-MAT", "PRUEBA-HAR-01")).toBeNull();
    expect((await nav.jpr!.post(`/api/cargas/${c.id}/autorizar`)).estado).toBe(403);
    const a = await nav.con!.post(`/api/cargas/${c.id}/autorizar`);
    expect(a.estado, JSON.stringify(a.datos)).toBe(200);
    expect(await existencia("MP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "200", valor: "3700" });
    expect(await existencia("MP-MAT", "PRUEBA-BOL-01")).toEqual({ cantidad: "3000", valor: "1050" });
    expect(await existencia("PT-MAT", "PRUEBA-CONCHA-V")).toEqual({ cantidad: "60", valor: "288" });
    const m = await pool.query("SELECT tipo, count(*)::int AS n FROM movimiento GROUP BY tipo");
    expect(m.rows).toEqual([{ tipo: "INICIAL", n: 2 }]);
  });

  it("no se vuelve a cargar inventario inicial de un artículo con movimientos", async () => {
    const s = await subir("jpr", "inventario_inicial", "fase-3/31-inventario-inicial.txt");
    expect(s.datos.errores).toBeGreaterThan(0);
    expect(JSON.stringify(s.datos.detalle)).toMatch(/Ya existe|ya tiene movimientos/);
  });
});

describe("existencias, alcance y costos ocultos", () => {
  it("el almacenista solo ve su almacén y sin importes; el contralor ve todo valuado", async () => {
    const alm = await nav.alm!.get("/api/inventarios/existencias");
    expect(alm.estado).toBe(200);
    expect(new Set(alm.datos.existencias.map((x: any) => x.almacen))).toEqual(new Set(["MP-MAT"]));
    expect(alm.datos.existencias[0].valor).toBeNull();
    const con = await nav.con!.get("/api/inventarios/existencias");
    expect(new Set(con.datos.existencias.map((x: any) => x.almacen))).toEqual(new Set(["MP-MAT", "PT-MAT"]));
    const har = con.datos.existencias.find((x: any) => x.articulo === "PRUEBA-HAR-01");
    expect(n(har.valor)).toBe("3700");
    expect(har.lotes).toHaveLength(1);
  });

  it("alertas: azúcar (80) y levadura (3) en punto de reorden con cantidad sugerida hasta el máximo", async () => {
    const r = await nav.con!.get("/api/inventarios/alertas");
    const azu = r.datos.existencias.find((x: any) => x.articulo === "PRUEBA-AZU-01");
    expect(azu).toMatchObject({ almacen: "MP-MAT", nivel: "REORDEN", sugerido: "420" });
    expect(r.datos.existencias.find((x: any) => x.articulo === "PRUEBA-LEV-01")).toMatchObject({ nivel: "REORDEN", sugerido: "17" });
    // Mínimo por almacén sin existencia todavía (concha en Sucursal 1)
    expect(r.datos.existencias.find((x: any) => x.almacen === "PT-SUC1" && x.articulo === "PRUEBA-CONCHA-V")).toMatchObject({ nivel: "MINIMO" });
  });
});

describe("compra, surtido y costo promedio", () => {
  it("entrada por compra en bultos: 2 BULTO a $450 = 50 kg a $18.00; el promedio pasa a $18.40", async () => {
    const r = await nav.alm!.post("/api/inventarios/compras", {
      almacen: "MP-MAT", proveedor: "PRUEBA-PROV-01", referencia: "PRUEBA-FACT-001",
      renglones: [{ articulo: "PRUEBA-HAR-01", cantidad: "2", unidad: "BULTO", costo_unitario: "450", lote: "PRUEBA-HAR-B", caducidad: "2027-04-30" }],
    });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(await existencia("MP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "250", valor: "4600" });
  });

  it("la compra sin costo, a un almacén fuera de alcance o de un SKU se rechaza", async () => {
    expect((await nav.alm!.post("/api/inventarios/compras", { almacen: "MP-MAT", renglones: [{ articulo: "PRUEBA-AZU-01", cantidad: "1" }] })).estado).toBe(400);
    expect((await nav.alm!.post("/api/inventarios/compras", { almacen: "PT-SUC1", renglones: [{ articulo: "PRUEBA-AZU-01", cantidad: "1", costo_unitario: "1" }] })).estado).toBe(403);
    expect((await nav.alm!.post("/api/inventarios/compras", { almacen: "MP-MAT", renglones: [{ articulo: "PRUEBA-BOLILLO", cantidad: "1", costo_unitario: "1" }] })).estado).toBe(400);
    expect((await nav.alm!.post("/api/inventarios/compras", { almacen: "MP-MAT", renglones: [{ articulo: "PRUEBA-HAR-01", cantidad: "1", costo_unitario: "1" }] })).estado).toBe(400);
  });

  it("surtido de 60 kg a producción: sale primero el lote que caduca antes y entra a PEP al mismo costo (60 × 18.40 = 1,104)", async () => {
    const r = await nav.alm!.post("/api/inventarios/surtidos", { origen: "MP-MAT", destino: "PEP-MAT", renglones: [{ articulo: "PRUEBA-HAR-01", cantidad: "60" }] });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(await existencia("PEP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "60", valor: "1104" });
    expect(await existencia("MP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "190", valor: "3496" });
    const lotes = (await pool.query("SELECT l.codigo, el.cantidad::text FROM existencia_lote el JOIN lote l ON l.id = el.lote_id JOIN almacen a ON a.id = el.almacen_id WHERE a.clave = 'MP-MAT' ORDER BY l.codigo")).rows;
    expect(lotes.filter((l) => l.codigo.startsWith("PRUEBA-HAR"))).toEqual([{ codigo: "PRUEBA-HAR-A", cantidad: "140.000000" }, { codigo: "PRUEBA-HAR-B", cantidad: "50.000000" }]);
  });

  it("no deja sacar más de lo que hay", async () => {
    const r = await nav.alm!.post("/api/inventarios/surtidos", { origen: "MP-MAT", destino: "PEP-MAT", renglones: [{ articulo: "PRUEBA-AZU-01", cantidad: "81" }] });
    expect(r.estado).toBe(409);
    expect(r.datos.mensaje).toMatch(/No alcanza/);
  });

  it("el kárdex muestra entradas, salidas y saldos que cuadran con la existencia", async () => {
    const k = await nav.con!.get("/api/inventarios/kardex?almacen=MP-MAT&articulo=PRUEBA-HAR-01");
    expect(k.estado).toBe(200);
    expect(k.datos.renglones.map((r: any) => [r.tipo, n(r.cantidad), n(r.saldo_cantidad), n(r.saldo_valor)])).toEqual([
      ["INICIAL", "200", "200", "3700"], ["ENTRADA_COMPRA", "50", "250", "4600"], ["SURTIDO_SALIDA", "-60", "190", "3496"],
    ]);
    const x = await nav.con!.get("/api/inventarios/kardex?almacen=MP-MAT&articulo=PRUEBA-HAR-01&formato=xlsx");
    expect(x.estado).toBe(200);
    expect(x.datos).toBeInstanceOf(Uint8Array);
  });
});

describe("conteos físicos con ajuste autorizado", () => {
  let id: string;
  it("conteo a ciegas: el almacenista captura sin ver el teórico", async () => {
    const c = await nav.alm!.post("/api/inventarios/conteos", { almacen: "MP-MAT", articulos: ["PRUEBA-AZU-01"] });
    expect(c.estado, JSON.stringify(c.datos)).toBe(200);
    id = c.datos.id;
    const v = await nav.alm!.get(`/api/inventarios/conteos/${id}`);
    expect(v.datos.renglones).toHaveLength(1);
    expect(v.datos.renglones[0].teorico).toBeNull();
    expect((await nav.alm!.put(`/api/inventarios/conteos/${id}`, { renglones: [{ articulo: "PRUEBA-AZU-01", fisico: "78" }] })).estado).toBe(200);
    const e = await nav.alm!.post(`/api/inventarios/conteos/${id}/enviar`);
    expect(e.datos).toMatchObject({ estatus: "POR_AUTORIZAR" });
    expect((await pool.query("SELECT importe_diferencia::text FROM conteo WHERE id = $1", [id])).rows[0].importe_diferencia).toBe("48.000000");
  });

  it("el almacenista no autoriza; el contralor sí y se registra un ajuste de salida por la diferencia", async () => {
    expect((await nav.alm!.post(`/api/inventarios/conteos/${id}/autorizar`)).estado).toBe(403);
    const a = await nav.con!.post(`/api/inventarios/conteos/${id}/autorizar`);
    expect(a.estado, JSON.stringify(a.datos)).toBe(200);
    expect(a.datos.salida).toMatch(/^MOV-/);
    expect(await existencia("MP-MAT", "PRUEBA-AZU-01")).toEqual({ cantidad: "78", valor: "1872" });
  });

  it("un ajuste mayor a $2,000 rebasa el límite del contralor y lo autoriza dirección", async () => {
    const c = await nav.alm!.post("/api/inventarios/conteos", { almacen: "MP-MAT", articulos: ["PRUEBA-HAR-01"] });
    expect(c.estado, JSON.stringify(c.datos)).toBe(200);
    const v = await nav.alm!.get(`/api/inventarios/conteos/${c.datos.id}`);
    expect(v.datos.renglones.map((r: any) => r.lote).sort()).toEqual(["PRUEBA-HAR-A", "PRUEBA-HAR-B"]);
    // El lote A (140 kg) no aparece: diferencia de 140 kg × 18.40 = 2,576
    await nav.alm!.put(`/api/inventarios/conteos/${c.datos.id}`, { renglones: [{ articulo: "PRUEBA-HAR-01", lote: "PRUEBA-HAR-A", fisico: "0" }, { articulo: "PRUEBA-HAR-01", lote: "PRUEBA-HAR-B", fisico: "50" }] });
    await nav.alm!.post(`/api/inventarios/conteos/${c.datos.id}/enviar`);
    const r = await nav.con!.post(`/api/inventarios/conteos/${c.datos.id}/autorizar`);
    expect(r.estado).toBe(403);
    expect(r.datos.mensaje).toMatch(/límite/);
    const d = await nav.dir!.post(`/api/inventarios/conteos/${c.datos.id}/autorizar`);
    expect(d.estado, JSON.stringify(d.datos)).toBe(200);
    expect(await existencia("MP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "50", valor: "920" });
  });

  it("solo hay un conteo abierto por almacén y un conteo enviado ya no se modifica", async () => {
    const c = await nav.alm!.post("/api/inventarios/conteos", { almacen: "MP-MAT", articulos: ["PRUEBA-SAL-01"] });
    expect((await nav.alm!.post("/api/inventarios/conteos", { almacen: "MP-MAT" })).estado).toBe(409);
    await nav.alm!.put(`/api/inventarios/conteos/${c.datos.id}`, { renglones: [{ articulo: "PRUEBA-SAL-01", fisico: "10" }] });
    const e = await nav.alm!.post(`/api/inventarios/conteos/${c.datos.id}/enviar`);
    expect(e.datos.estatus).toBe("APLICADO"); // sin diferencias no requiere autorización
    expect((await nav.alm!.put(`/api/inventarios/conteos/${c.datos.id}`, { renglones: [{ articulo: "PRUEBA-SAL-01", fisico: "9" }] })).estado).toBe(409);
  });
});

describe("traspasos entre sucursales", () => {
  let id: string;
  it("el jefe de producción envía 20 conchas de Matriz a Sucursal 1: salen y quedan en tránsito", async () => {
    const r = await nav.jpr!.post("/api/inventarios/traspasos", { origen: "PT-MAT", destino: "PT-SUC1", renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "20" }] });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    id = r.datos.id;
    expect(await existencia("PT-MAT", "PRUEBA-CONCHA-V")).toEqual({ cantidad: "40", valor: "192" });
    const e = await nav.con!.get("/api/inventarios/existencias?almacen=PT-MAT");
    expect(e.estado).toBe(200);
  });

  it("solo recibe quien tiene el almacén destino; con diferencia exige comentario y registra el faltante", async () => {
    expect((await nav.jpr!.post(`/api/inventarios/traspasos/${id}/recibir`, {})).estado).toBe(403);
    const t = await nav.enc!.get(`/api/inventarios/traspasos/${id}`);
    const renglon = t.datos.renglones[0].id;
    expect((await nav.enc!.post(`/api/inventarios/traspasos/${id}/recibir`, { recibidos: [{ renglon_id: renglon, cantidad: "19" }] })).estado).toBe(400);
    const r = await nav.enc!.post(`/api/inventarios/traspasos/${id}/recibir`, { recibidos: [{ renglon_id: renglon, cantidad: "19" }], comentario: "Llegó una aplastada" });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.faltante).toBe(true);
    expect(await existencia("PT-SUC1", "PRUEBA-CONCHA-V")).toEqual({ cantidad: "19", valor: "91.2" });
    const f = await nav.con!.get(`/api/inventarios/traspasos/${id}`);
    expect(n(f.datos.renglones[0].importe_faltante)).toBe("4.8");
    expect((await nav.enc!.post(`/api/inventarios/traspasos/${id}/recibir`, {})).estado).toBe(409);
  });

  it("un traspaso en tránsito se cancela y la mercancía regresa al origen con el mismo costo", async () => {
    await otorgar("JPR", "inventarios.traspasos:cancelar");
    const r = await nav.jpr!.post("/api/inventarios/traspasos", { origen: "PT-MAT", destino: "PT-SUC1", renglones: [{ articulo: "PRUEBA-BOLILLO", cantidad: "30" }] });
    expect(await existencia("PT-MAT", "PRUEBA-BOLILLO")).toEqual({ cantidad: "70", valor: "105" });
    const c = await nav.jpr!.post(`/api/inventarios/traspasos/${r.datos.id}/cancelar`, { motivo: "Se envió por error" });
    expect(c.estado, JSON.stringify(c.datos)).toBe(200);
    expect(await existencia("PT-MAT", "PRUEBA-BOLILLO")).toEqual({ cantidad: "100", valor: "150" });
    expect((await nav.enc!.post(`/api/inventarios/traspasos/${r.datos.id}/recibir`, {})).estado).toBe(409);
  });
});

describe("mermas con autorización, segregación y límites", () => {
  it("merma de sucursal: el encargado registra pan no vendido y la autoriza el contralor", async () => {
    expect((await nav.enc!.post("/api/inventarios/mermas", { almacen: "PT-SUC1", causa: "PRUEBA-DANADO", renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "5" }] })).estado).toBe(400);
    const r = await nav.enc!.post("/api/inventarios/mermas", { almacen: "PT-SUC1", causa: "PRUEBA-NO-VENDIDO", renglones: [{ articulo: "PRUEBA-CONCHA-V", cantidad: "5" }] });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(await existencia("PT-SUC1", "PRUEBA-CONCHA-V")).toEqual({ cantidad: "19", valor: "91.2" });
    expect((await nav.enc!.post(`/api/inventarios/mermas/${r.datos.id}/autorizar`)).estado).toBe(403);
    const a = await nav.con!.post(`/api/inventarios/mermas/${r.datos.id}/autorizar`);
    expect(a.estado, JSON.stringify(a.datos)).toBe(200);
    expect(a.datos.importe).toBe("24");
    expect(await existencia("PT-SUC1", "PRUEBA-CONCHA-V")).toEqual({ cantidad: "14", valor: "67.2" });
  });

  it("merma de materia prima: quien la registra no la autoriza y el jefe de producción solo hasta $1,000", async () => {
    const propia = await nav.jpr!.post("/api/inventarios/mermas", { almacen: "MP-MAT", causa: "PRUEBA-CADUCADO", renglones: [{ articulo: "PRUEBA-MAN-01", cantidad: "1" }] });
    expect(propia.estado, JSON.stringify(propia.datos)).toBe(200);
    expect((await nav.jpr!.post(`/api/inventarios/mermas/${propia.datos.id}/autorizar`)).datos.mensaje).toMatch(/segregación/);
    const grande = await nav.mae!.post("/api/inventarios/mermas", { almacen: "MP-MAT", causa: "PRUEBA-CADUCADO", renglones: [{ articulo: "PRUEBA-MAN-01", cantidad: "10" }] });
    const r = await nav.jpr!.post(`/api/inventarios/mermas/${grande.datos.id}/autorizar`);
    expect(r.estado).toBe(403);
    expect(r.datos.mensaje).toMatch(/1000/);
    expect(await existencia("MP-MAT", "PRUEBA-MAN-01")).toEqual({ cantidad: "25", valor: "3625" });
    expect((await nav.con!.post(`/api/inventarios/mermas/${grande.datos.id}/autorizar`)).estado).toBe(200);
    expect((await nav.con!.post(`/api/inventarios/mermas/${propia.datos.id}/rechazar`, { motivo: "No procede" })).estado).toBe(200);
    expect(await existencia("MP-MAT", "PRUEBA-MAN-01")).toEqual({ cantidad: "15", valor: "2175" });
    const k = await nav.con!.get("/api/inventarios/kardex?almacen=MP-MAT&articulo=PRUEBA-MAN-01");
    expect(k.datos.renglones.at(-1)).toMatchObject({ tipo: "MERMA", causa: "PRUEBA-CADUCADO" });
  });
});

describe("cancelaciones, plan y controles", () => {
  it("cancelar una compra requiere permiso y saca lo que entró; no se cancela dos veces", async () => {
    const compra = (await pool.query("SELECT id FROM movimiento WHERE tipo = 'ENTRADA_COMPRA'")).rows[0].id;
    expect((await nav.alm!.post(`/api/inventarios/movimientos/${compra}/cancelar`, { motivo: "Factura equivocada" })).estado).toBe(403);
    await otorgar("ALM", "compras.recepcion:cancelar");
    const r = await nav.alm!.post(`/api/inventarios/movimientos/${compra}/cancelar`, { motivo: "Factura equivocada" });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(await existencia("MP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "0", valor: "0" });
    expect((await nav.alm!.post(`/api/inventarios/movimientos/${compra}/cancelar`, { motivo: "Otra vez" })).estado).toBe(409);
  });

  it("cancelar un vale de surtido regresa la harina de producción a materia prima", async () => {
    await otorgar("ALM", "inventarios.surtido:cancelar");
    const s = (await pool.query("SELECT salida_id FROM surtido")).rows[0].salida_id;
    const r = await nav.alm!.post(`/api/inventarios/movimientos/${s}/cancelar`, { motivo: "Prueba" });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.cancelaciones).toHaveLength(2);
    expect(await existencia("PEP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "0", valor: "0" });
    expect(await existencia("MP-MAT", "PRUEBA-HAR-01")).toEqual({ cantidad: "60", valor: "1104" });
  });

  it("el plan de producción toma existencias y tránsito del inventario", async () => {
    const plan = (await pool.query(
      "INSERT INTO plan_produccion (fecha, sucursal_id) SELECT '2099-01-02', id FROM sucursal WHERE clave = 'MAT' RETURNING id",
    )).rows[0].id;
    const r = await nav.jpr!.post(`/api/planes/${plan}/existencias-inventario`);
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    const e = (await pool.query("SELECT a.clave, pe.existencia::text FROM plan_existencia pe JOIN articulo a ON a.id = pe.articulo_id WHERE pe.plan_id = $1 ORDER BY a.clave", [plan])).rows;
    expect(e.find((x) => x.clave === "PRUEBA-AZU-01")?.existencia).toBe("78.000000");
    expect(e.find((x) => x.clave === "PRUEBA-HAR-01")?.existencia).toBe("60.000000");
  });

  it("el método de valuación ya no se puede cambiar con movimientos", async () => {
    await expect(pool.query("UPDATE configuracion SET valor = 'PEPS' WHERE clave = 'inventarios.metodo_valuacion'")).rejects.toThrow(/método de valuación/);
  });

  it("el kárdex es inmutable, los saldos cuadran con el kárdex y la bitácora está íntegra", async () => {
    await expect(pool.query("DELETE FROM movimiento_renglon")).rejects.toThrow();
    await expect(pool.query("UPDATE movimiento SET comentario = 'x'")).rejects.toThrow();
    expect((await pool.query("SELECT * FROM inventario_diferencias()")).rows).toEqual([]);
    expect((await pool.query("SELECT bitacora_auditoria_verificar() AS roto")).rows[0].roto).toBeNull();
  });
});
