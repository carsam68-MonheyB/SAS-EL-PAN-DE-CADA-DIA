// Criterio de aceptación de la Fase 1B: los catálogos se cargan por layout en
// TXT y Excel, se detectan los errores puestos a propósito y nada se guarda a
// medias. Todos los datos son FICTICIOS (prefijo PRUEBA-).
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type pg from "pg";
import { baseLimpia, entrar, instalarAdministrador, Navegador } from "./apoyo";
import { leerArchivo } from "../src/servidor/layouts/archivos";

let pool: pg.Pool;
let admin: Navegador;
const nav: Record<string, Navegador> = {};

const b64 = (x: string | Uint8Array) => Buffer.from(typeof x === "string" ? new TextEncoder().encode(x) : x).toString("base64");

async function subir(n: Navegador, layout: string, modo: string, nombre: string, contenido: string | Uint8Array) {
  return n.post("/api/cargas", { layout, modo, nombre_archivo: nombre, contenido: b64(contenido) });
}

/** Sube, revisa que no haya errores y aplica. */
async function cargar(n: Navegador, layout: string, contenido: string | Uint8Array, nombre = "datos.txt", modo = "alta") {
  const s = await subir(n, layout, modo, nombre, contenido);
  expect(s.estado, JSON.stringify(s.datos)).toBe(200);
  expect(s.datos.errores, JSON.stringify(s.datos.detalle)).toBe(0);
  const a = await n.post(`/api/cargas/${s.datos.id}/aplicar`);
  expect(a.estado, JSON.stringify(a.datos)).toBe(200);
  return { simulacion: s.datos, resultado: a.datos };
}

const contar = async (tabla: string, donde = "true") => Number((await pool.query(`SELECT count(*) n FROM ${tabla} WHERE ${donde}`)).rows[0].n);

beforeAll(async () => {
  pool = await baseLimpia("erp_prueba_cargas");
  admin = (await instalarAdministrador()).nav;
  const r = await admin.post("/api/datos-prueba");
  for (const rol of ["com", "jpr", "cnt", "con", "dir", "caj", "enc", "alm"]) {
    nav[rol] = new Navegador();
    await entrar(nav[rol]!, `prueba.${rol}`, r.datos.password);
  }
}, 120_000);

describe("catálogos visibles según el puesto", () => {
  it("cada puesto ve solo sus catálogos", async () => {
    const claves = async (n: Navegador) => (await n.get("/api/layouts")).datos.layouts.map((l: any) => l.clave);
    expect(await claves(nav.com!)).toEqual(expect.arrayContaining(["insumos", "proveedores", "unidades"]));
    expect(await claves(nav.com!)).not.toContain("cuentas");
    expect(await claves(nav.cnt!)).toEqual(expect.arrayContaining(["cuentas", "tasas", "sat", "productos"]));
    expect(await claves(nav.caj!)).not.toContain("insumos");
    expect(await claves(admin)).toEqual(expect.arrayContaining(["sucursales", "almacenes", "cajas", "centros_costo"]));
  });

  it("el costo solo aparece a quien puede ver costos", async () => {
    const campos = async (n: Navegador) => (await n.get("/api/layouts")).datos.layouts.find((l: any) => l.clave === "insumos")?.campos.map((c: any) => c.nombre);
    expect(await campos(nav.com!)).toContain("COSTO_REFERENCIA");
    expect(await campos(nav.alm!)).not.toContain("COSTO_REFERENCIA");
  });

  it("sin permiso de importar no se puede subir un layout", async () => {
    const r = await subir(nav.alm!, "insumos", "alta", "x.txt", "CLAVE|NOMBRE\nA|B\n");
    expect(r.estado).toBe(403);
    expect((await subir(nav.caj!, "clientes", "alta", "x.txt", "CLAVE\nA\n")).estado).toBe(403);
  });

  it("no se puede llamar a un layout que no existe", async () => {
    expect((await nav.com!.get("/api/layouts/inventado/registros")).estado).toBe(404);
  });
});

describe("carga inicial en orden (TXT y Excel)", () => {
  it("catálogos del SAT y tasas (contador)", async () => {
    await cargar(nav.cnt!, "sat", [
      "CATALOGO|CLAVE|DESCRIPCION",
      "c_ClaveUnidad|H87|PRUEBA Pieza",
      "c_ClaveUnidad|KGM|PRUEBA Kilogramo",
      "c_ObjetoImp|02|PRUEBA Sí objeto de impuesto",
      "c_ClaveProdServ|50181900|PRUEBA Pan",
      "c_RegimenFiscal|601|PRUEBA Régimen",
      "c_UsoCFDI|G03|PRUEBA Uso",
      "c_CodigoAgrupador|101|PRUEBA Caja",
      "c_CodigoAgrupador|101.01|PRUEBA Caja y efectivo",
    ].join("\n"));
    await cargar(nav.cnt!, "tasas", "CLAVE|IMPUESTO|TIPO_FACTOR|TASA|DESCRIPCION\nPRUEBA-IVA|IVA|Tasa|0.000000|PRUEBA tasa ficticia\n");
    expect(await contar("sat_catalogo")).toBe(8);
  });

  it("unidades y conversiones (compras)", async () => {
    await cargar(nav.com!, "unidades", "CLAVE|NOMBRE|MAGNITUD|CLAVE_SAT\nKG|Kilogramo|MASA|KGM\nG|Gramo|MASA|\nPZA|Pieza|PIEZA|H87\nBULTO|Bulto|OTRA|\n");
    await cargar(nav.com!, "conversiones", "DE_UNIDAD|A_UNIDAD|FACTOR\nKG|G|1,000\n");
    expect(await contar("unidad")).toBe(4);
    const f = (await pool.query("SELECT factor::text FROM conversion_unidad")).rows[0].factor;
    expect(f).toBe("1000.0000000000");
  });

  it("un archivo con errores a propósito no guarda NADA y explica cada error", async () => {
    const antes = await contar("unidad");
    const s = await subir(nav.com!, "unidades", "alta", "malo.txt", [
      "CLAVE|NOMBRE|MAGNITUD|CLAVE_SAT",
      "LT|Litro|VOLUMEN|",          // bueno
      "ML|Mililitro|LIQUIDO|",      // magnitud inválida
      "kg|Repetido|MASA|",          // ya existe (se normaliza a KG)
      "LT|Litro otra vez|VOLUMEN|", // repetido en el archivo
      "CAJA CH|Caja|PIEZA|",        // espacio en la clave
      "PAQ||PIEZA|",                // falta nombre
      "ONZ|Onza|MASA|XXX",          // clave SAT inexistente
    ].join("\n"));
    expect(s.estado).toBe(200);
    const d = s.datos;
    expect(d.renglones).toBe(7);
    expect(d.altas).toBe(1);
    const porRenglon = (r: number) => d.detalle.filter((m: any) => m.renglon === r && m.severidad === "error").map((m: any) => m.mensaje).join(" ");
    expect(porRenglon(3)).toMatch(/LIQUIDO.*Valores permitidos/);
    expect(porRenglon(4)).toMatch(/Ya existe/);
    expect(porRenglon(5)).toMatch(/repetido en el archivo.*renglón 2/);
    expect(porRenglon(6)).toMatch(/no es válido/);
    expect(porRenglon(7)).toMatch(/obligatorio/);
    expect(porRenglon(8)).toMatch(/no existe en el catálogo c_ClaveUnidad/);
    // Confirmar una carga con errores está prohibido
    const a = await nav.com!.post(`/api/cargas/${d.id}/aplicar`);
    expect(a.estado).toBe(409);
    expect(await contar("unidad")).toBe(antes);

    // Reporte de errores en el mismo layout con la columna ERROR (TXT)
    const rep = await nav.com!.get(`/api/cargas/${d.id}/errores?formato=txt`);
    expect(rep.estado).toBe(200);
    const t = await leerArchivo(rep.datos as Uint8Array, "rep.txt");
    expect(t.encabezados).toEqual(["CLAVE", "NOMBRE", "MAGNITUD", "CLAVE_SAT", "ERROR"]);
    expect(t.filas).toHaveLength(7);
    expect(t.filas[0]!.celdas[4]).toBe("");
    expect(t.filas[1]!.celdas[4]).toMatch(/MAGNITUD/);

    // Al corregir y volver a subir el reporte, la columna ERROR se ignora
    const corregido = t.filas
      .filter((f) => f.renglon === 2)
      .map((f) => f.celdas.join("|"));
    const r2 = await subir(nav.com!, "unidades", "alta", "corregido.txt", ["CLAVE|NOMBRE|MAGNITUD|CLAVE_SAT|ERROR", ...corregido].join("\n"));
    expect(r2.datos.errores).toBe(0);
  });

  it("encabezados equivocados se rechazan antes de revisar renglones", async () => {
    const s = await subir(nav.com!, "unidades", "alta", "x.txt", "CLAVE|NOMBRE|COLOR\nX|Y|Z\n");
    expect(s.datos.errores).toBeGreaterThan(0);
    expect(s.datos.detalle.map((m: any) => m.mensaje).join(" ")).toMatch(/COLOR.*no pertenece/);
    expect(s.datos.detalle.map((m: any) => m.mensaje).join(" ")).toMatch(/Falta la columna obligatoria MAGNITUD/);
  });

  it("conversión entre magnitudes distintas se rechaza", async () => {
    const s = await subir(nav.com!, "conversiones", "alta", "x.txt", "DE_UNIDAD|A_UNIDAD|FACTOR\nPZA|KG|0.06\nG|KG|0.001\n");
    const msj = s.datos.detalle.map((m: any) => m.mensaje).join(" ");
    expect(msj).toMatch(/miden cosas distintas/);
    expect(msj).toMatch(/inversa/);
  });

  it("familias, proveedores e insumos en Windows-1252 (acentos de Excel en Windows)", async () => {
    await cargar(nav.com!, "familias", "CLAVE|NOMBRE|APLICA_A\nPRUEBA-HARINAS|Harinas|INSUMO\nPRUEBA-PAN-DULCE|Pan dulce|SKU\nPRUEBA-MASAS|Masas|INTERMEDIO\n");
    await cargar(nav.com!, "proveedores", "CLAVE|RFC|RAZON_SOCIAL|REGIMEN_FISCAL|CODIGO_POSTAL|DIAS_CREDITO\nPRUEBA-PROV-01|XAXX010101000|PRUEBA Harinas Ficticias|601|06000|15\n");
    const texto = [
      "CLAVE|NOMBRE|TIPO|FAMILIA|UNIDAD_BASE|UNIDAD_COMPRA|UNIDAD_RECETA|COSTO_REFERENCIA|PROVEEDOR_PREFERENTE|STOCK_MINIMO|STOCK_MAXIMO|PUNTO_REORDEN|MANEJA_LOTE",
      "PRUEBA-HAR-01|PRUEBA Harina de trigo española|INSUMO|PRUEBA-HARINAS|KG|BULTO|G|18.50|PRUEBA-PROV-01|50|500|100|SI",
      "PRUEBA-AZU-01|PRUEBA Azúcar|INSUMO||KG||G|22|||||",
      "PRUEBA-BOL-01|PRUEBA Bolsa de papel|EMPAQUE||PZA|||0.35|||||",
    ].join("\r\n");
    const win1252 = Uint8Array.from(Buffer.from(texto, "latin1"));
    const r = await cargar(nav.com!, "insumos", win1252, "insumos.txt");
    expect(r.simulacion.altas).toBe(3);
    // Falta BULTO → KG: es advertencia, no error
    expect(r.simulacion.detalle.some((m: any) => m.severidad === "advertencia" && /BULTO a KG/.test(m.mensaje))).toBe(true);
    const h = (await pool.query("SELECT nombre, unidad_compra_id IS NOT NULL AS uc, costo_referencia::text FROM articulo WHERE clave = 'PRUEBA-HAR-01'")).rows[0];
    expect(h.nombre).toBe("PRUEBA Harina de trigo española");
    expect(h.costo_referencia).toBe("18.500000");
    const carga = (await pool.query("SELECT codificacion FROM carga_layout WHERE id = $1", [r.simulacion.id])).rows[0];
    expect(carga.codificacion).toBe("Windows-1252");
    // Unidad de compra/receta vacías toman la unidad base
    const bolsa = (await pool.query("SELECT unidad_compra_id = unidad_base_id AS igual FROM articulo WHERE clave = 'PRUEBA-BOL-01'")).rows[0];
    expect(bolsa.igual).toBe(true);
  });

  it("stock mínimo mayor que el máximo es error; la clave de otro tipo de artículo no se reutiliza", async () => {
    const s = await subir(nav.com!, "insumos", "ambos", "x.txt", "CLAVE|NOMBRE|TIPO|UNIDAD_BASE|STOCK_MINIMO|STOCK_MAXIMO\nPRUEBA-X|X|INSUMO|KG|10|5\n");
    expect(s.datos.detalle.map((m: any) => m.mensaje).join(" ")).toMatch(/mínimo no puede ser mayor/);
  });

  it("unidades por artículo quitan la advertencia de conversión", async () => {
    await cargar(nav.com!, "unidades_articulo", "ARTICULO|UNIDAD|FACTOR_A_BASE\nPRUEBA-HAR-01|BULTO|25\n");
    const s = await subir(nav.com!, "insumos", "actualizacion", "x.txt", "CLAVE|UNIDAD_COMPRA\nPRUEBA-HAR-01|BULTO\n");
    expect(s.datos.advertencias).toBe(0);
    expect(s.datos.sin_cambios).toBe(1);
  });

  it("masas (jefe de producción) y productos en Excel con datos fiscales", async () => {
    await cargar(nav.jpr!, "intermedios", "CLAVE|NOMBRE|FAMILIA|UNIDAD_BASE|VIDA_UTIL_HORAS|SOBRANTE_REUTILIZABLE\nPRUEBA-MASA-01|PRUEBA Masa de concha|PRUEBA-MASAS|KG|24|SI\n");
    // Plantilla de Excel descargada del sistema, llenada y subida
    const p = await nav.jpr!.get("/api/layouts/productos/plantilla?formato=xlsx");
    expect(p.estado).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(p.datos as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Datos", "Instrucciones", "Listas"]);
    const ws = wb.getWorksheet("Datos")!;
    const enc = (ws.getRow(1).values as string[]).slice(1);
    expect(enc).toContain("CLAVE_PROD_SERV");
    expect(ws.getCell("E2").dataValidation?.type).toBe("list"); // UNIDAD_VENTA
    const fila = (o: Record<string, string>) => enc.map((h) => o[h] ?? "");
    ws.getRow(2).values = (fila({ CLAVE: "PRUEBA-CONCHA", NOMBRE: "PRUEBA Concha", FAMILIA: "PRUEBA-PAN-DULCE", UNIDAD_VENTA: "PZA", CODIGO_BARRAS: "7500000000017", CLAVE_PROD_SERV: "50181900", CLAVE_UNIDAD_SAT: "H87", OBJETO_IMPUESTO: "02", TASA_IVA: "PRUEBA-IVA" }));
    ws.getRow(3).values = fila({ CLAVE: "PRUEBA-BOLILLO", NOMBRE: "PRUEBA Bolillo", UNIDAD_VENTA: "PZA" });
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const r = await cargar(nav.jpr!, "productos", bytes, "productos.xlsx");
    expect(r.simulacion.altas).toBe(2);
    expect(r.simulacion.detalle.some((m: any) => m.renglon === 3 && /fiscales incompletos/.test(m.mensaje))).toBe(true);
    expect(await contar("articulo", "tipo = 'SKU'")).toBe(2);
  });

  it("errores en productos: familia de otro tipo, tasa inexistente, código de barras repetido", async () => {
    const s = await subir(nav.jpr!, "productos", "alta", "x.txt", [
      "CLAVE|NOMBRE|FAMILIA|UNIDAD_VENTA|CODIGO_BARRAS|TASA_IVA|CLAVE_PROD_SERV",
      "PRUEBA-DONA|Dona|PRUEBA-HARINAS|PZA|7500000000017|NO-EXISTE|99999999",
      "PRUEBA-HAR-01|Choca con insumo|PRUEBA-PAN-DULCE|PZA|||",
    ].join("\n"));
    const msj = s.datos.detalle.filter((m: any) => m.severidad === "error").map((m: any) => `${m.renglon}:${m.campo}`);
    expect(msj).toEqual(expect.arrayContaining(["2:FAMILIA", "2:TASA_IVA", "2:CODIGO_BARRAS", "2:CLAVE_PROD_SERV", "3:CLAVE"]));
  });
});

describe("exportar, editar y volver a subir", () => {
  it("exportación en el mismo layout → actualización sin cambios", async () => {
    const e = await nav.com!.get("/api/layouts/insumos/exportar?formato=txt");
    expect(e.estado).toBe(200);
    const texto = new TextDecoder().decode(e.datos as Uint8Array);
    expect(texto.split("\r\n")[0]).toContain("COSTO_REFERENCIA");
    expect(texto).toContain("18.5");
    const s = await subir(nav.com!, "insumos", "actualizacion", "export.txt", texto);
    expect(s.datos.errores).toBe(0);
    expect(s.datos.sin_cambios).toBe(3);
    expect(s.datos.actualizaciones).toBe(0);
  });

  it("quien no ve costos exporta sin la columna de costo", async () => {
    // El almacenista solo ve insumos: no tiene exportar ni importar.
    expect((await nav.alm!.get("/api/layouts/insumos/exportar?formato=txt")).estado).toBe(403);
    const r = await nav.alm!.get("/api/layouts/insumos/registros");
    expect(r.datos.encabezados).not.toContain("COSTO_REFERENCIA");
  });

  it("un cambio de costo grande genera advertencia y queda en la bitácora", async () => {
    const { simulacion } = await cargar(nav.com!, "insumos", "CLAVE|COSTO_REFERENCIA\nPRUEBA-HAR-01|25.00\n", "costo.txt", "actualizacion");
    expect(simulacion.actualizaciones).toBe(1);
    expect(simulacion.detalle.find((m: any) => m.campo === "COSTO_REFERENCIA").mensaje).toMatch(/Cambia 35.1%/);
    const b = (await pool.query(
      `SELECT b.antes->>'costo_referencia' AS antes, b.despues->>'costo_referencia' AS despues, u.usuario
         FROM bitacora_auditoria b JOIN usuario u ON u.id = b.usuario_id
        WHERE b.tabla = 'articulo' AND b.operacion = 'UPDATE' ORDER BY b.id DESC LIMIT 1`,
    )).rows[0];
    expect(b).toEqual({ antes: "18.500000", despues: "25.000000", usuario: "prueba.com" });
  });

  it("dar de baja es ACTIVO = NO; borrar está prohibido en la base", async () => {
    await cargar(nav.com!, "insumos", "CLAVE|ACTIVO\nPRUEBA-AZU-01|NO\n", "baja.txt", "actualizacion");
    expect((await pool.query("SELECT activo FROM articulo WHERE clave = 'PRUEBA-AZU-01'")).rows[0].activo).toBe(false);
    await expect(pool.query("DELETE FROM articulo WHERE clave = 'PRUEBA-AZU-01'")).rejects.toThrow(/no se borran/);
    await expect(pool.query("DELETE FROM carga_archivo")).rejects.toThrow();
    // Un artículo dado de baja ya no se puede referenciar
    const s = await subir(nav.com!, "articulos_proveedor", "alta", "x.txt", "ARTICULO|PROVEEDOR\nPRUEBA-AZU-01|PRUEBA-PROV-01\n");
    expect(s.datos.detalle[0].mensaje).toMatch(/dado de baja/);
  });

  it("el modo actualización no da de alta y el modo alta no actualiza", async () => {
    const s = await subir(nav.com!, "insumos", "actualizacion", "x.txt", "CLAVE|NOMBRE\nPRUEBA-NUEVO|Nuevo\n");
    expect(s.datos.detalle[0].mensaje).toMatch(/No existe/);
  });
});

describe("precios: requieren autorización de otra persona", () => {
  let id: string;

  it("el contralor sube precios y quedan pendientes; nada se aplica todavía", async () => {
    const s = await subir(nav.con!, "precios", "alta", "precios.txt", "ARTICULO|SUCURSAL|PRECIO|VIGENTE_DESDE\nPRUEBA-CONCHA||14.50|01/01/2030\nPRUEBA-BOLILLO|SUC1|3.00|01/01/2030\n");
    expect(s.datos.errores).toBe(0);
    expect(s.datos.requiere_autorizacion).toBe(true);
    id = s.datos.id;
    const a = await nav.con!.post(`/api/cargas/${id}/aplicar`);
    expect(a.datos.estatus).toBe("pendiente_autorizacion");
    expect(await contar("precio_venta")).toBe(0);
    // El contralor no tiene permiso de autorizar precios
    expect((await nav.con!.post(`/api/cargas/${id}/autorizar`)).estado).toBe(403);
  });

  it("dirección autoriza y se aplica", async () => {
    const lista = await nav.dir!.get("/api/cargas?estatus=pendiente_autorizacion");
    expect(lista.datos.cargas.find((x: any) => x.id === id).puede_autorizar).toBe(true);
    const a = await nav.dir!.post(`/api/cargas/${id}/autorizar`);
    expect(a.estado, JSON.stringify(a.datos)).toBe(200);
    expect(a.datos.estatus).toBe("aplicada");
    expect(await contar("precio_venta")).toBe(2);
    expect((await nav.dir!.post(`/api/cargas/${id}/autorizar`)).estado).toBe(409);
  });

  it("un precio nuevo cierra la vigencia del anterior", async () => {
    const s = await subir(nav.con!, "precios", "alta", "p2.txt", "ARTICULO|SUCURSAL|PRECIO|VIGENTE_DESDE\nPRUEBA-CONCHA||16.00|15/02/2030\n");
    expect(s.datos.detalle.some((m: any) => m.severidad === "advertencia" && /Cambia 10.3%/.test(m.mensaje))).toBe(true);
    await nav.con!.post(`/api/cargas/${s.datos.id}/aplicar`);
    await nav.dir!.post(`/api/cargas/${s.datos.id}/autorizar`);
    const h = (await pool.query("SELECT precio::text, vigente_desde::text, vigente_hasta::text FROM precio_venta p JOIN articulo a ON a.id = p.articulo_id WHERE a.clave = 'PRUEBA-CONCHA' ORDER BY vigente_desde")).rows;
    expect(h).toEqual([
      { precio: "14.50", vigente_desde: "2030-01-01", vigente_hasta: "2030-02-14" },
      { precio: "16.00", vigente_desde: "2030-02-15", vigente_hasta: null },
    ]);
  });

  it("rechazo con motivo; fechas pasadas o inexistentes se rechazan", async () => {
    const s = await subir(nav.con!, "precios", "alta", "p3.txt", "ARTICULO|PRECIO|VIGENTE_DESDE\nPRUEBA-BOLILLO|3.50|01/03/2030\n");
    await nav.con!.post(`/api/cargas/${s.datos.id}/aplicar`);
    expect((await nav.dir!.post(`/api/cargas/${s.datos.id}/rechazar`, {})).estado).toBe(400);
    const r = await nav.dir!.post(`/api/cargas/${s.datos.id}/rechazar`, { motivo: "Precio no acordado" });
    expect(r.datos.estatus).toBe("rechazada");
    const mal = await subir(nav.con!, "precios", "alta", "p4.txt", "ARTICULO|PRECIO|VIGENTE_DESDE\nPRUEBA-BOLILLO|3.50|01/01/2020\nPRUEBA-CONCHA|3.50|31/02/2031\nPRUEBA-HAR-01|1|01/01/2031\n");
    const msj = mal.datos.detalle.map((m: any) => `${m.renglon}:${m.mensaje}`).join(" ");
    expect(msj).toMatch(/2:La vigencia no puede empezar antes de hoy/);
    expect(msj).toMatch(/3:La fecha "31\/02\/2031" no existe/);
    expect(msj).toMatch(/4:.*no es válido para este campo/);
  });

  it("nadie autoriza su propia carga, aunque tenga ambos permisos", async () => {
    const roles = (await admin.get("/api/roles")).datos;
    void roles;
    const alta = await admin.post("/api/usuarios", { usuario: "prueba.doble", nombre: "PRUEBA Doble permiso", puesto: "Prueba", roles: ["CON", "DIR"], sucursales: [], almacenes: [] });
    expect(alta.estado, JSON.stringify(alta.datos)).toBe(200);
    const n = new Navegador();
    const token = new URL(alta.datos.invitacion.enlace).searchParams.get("token");
    expect((await n.post("/api/auth/activar", { token, password: "Doble-Permiso-2026" })).estado).toBe(200);
    await entrar(n, "prueba.doble", "Doble-Permiso-2026");
    const s = await subir(n, "precios", "alta", "p5.txt", "ARTICULO|PRECIO|VIGENTE_DESDE\nPRUEBA-BOLILLO|3.25|01/04/2030\n");
    await n.post(`/api/cargas/${s.datos.id}/aplicar`);
    const r = await n.post(`/api/cargas/${s.datos.id}/autorizar`);
    expect(r.estado).toBe(403);
    expect(r.datos.mensaje).toMatch(/segregación/);
  });
});

describe("captura en pantalla usa la misma validación", () => {
  it("alta y cambio de un registro", async () => {
    const a = await nav.com!.post("/api/layouts/proveedores/registro", { modo: "alta", valores: { CLAVE: "PRUEBA-PROV-02", RFC: "XEXX010101000", RAZON_SOCIAL: "PRUEBA Empaques Ficticios" } });
    expect(a.estado, JSON.stringify(a.datos)).toBe(200);
    const mal = await nav.com!.post("/api/layouts/proveedores/registro", { modo: "actualizacion", valores: { CLAVE: "PRUEBA-PROV-02", RFC: "MAL", CODIGO_POSTAL: "123" } });
    expect(mal.estado).toBe(400);
    expect(mal.datos.detalles.map((d: any) => d.campo)).toEqual(["RFC", "CODIGO_POSTAL"]);
    const ok = await nav.com!.post("/api/layouts/proveedores/registro", { modo: "actualizacion", valores: { CLAVE: "PRUEBA-PROV-02", DIAS_CREDITO: "30" } });
    expect(ok.estado).toBe(200);
    expect((await pool.query("SELECT dias_credito FROM proveedor WHERE clave = 'PRUEBA-PROV-02'")).rows[0].dias_credito).toBe(30);
  });

  it("un precio capturado en pantalla también espera autorización", async () => {
    const r = await nav.con!.post("/api/layouts/precios/registro", { modo: "alta", valores: { ARTICULO: "PRUEBA-BOLILLO", PRECIO: "4", VIGENTE_DESDE: "01/05/2030" } });
    expect(r.estado, JSON.stringify(r.datos)).toBe(200);
    expect(r.datos.estatus).toBe("pendiente_autorizacion");
  });

  it("sin permiso de alta no se captura", async () => {
    const r = await nav.cnt!.post("/api/layouts/productos/registro", { modo: "alta", valores: { CLAVE: "PRUEBA-X", NOMBRE: "X", UNIDAD_VENTA: "PZA" } });
    expect(r.estado).toBe(403);
  });
});

describe("contabilidad y estructura", () => {
  it("cuentas con su padre en el mismo archivo y validación de niveles", async () => {
    await cargar(nav.cnt!, "cuentas", "CUENTA|NOMBRE|NATURALEZA|NIVEL|CUENTA_PADRE|CODIGO_AGRUPADOR|AFECTABLE\n1101-001|PRUEBA Caja general|DEUDORA|2|1101|101.01|SI\n1101|PRUEBA Caja|DEUDORA|1||101|NO\n");
    const s = await subir(nav.cnt!, "cuentas", "alta", "x.txt", "CUENTA|NOMBRE|NATURALEZA|NIVEL|CUENTA_PADRE\n1101-002|Mal nivel|DEUDORA|3|1101\n2000|Sin padre|ACREEDORA|2|\n");
    const msj = s.datos.detalle.map((m: any) => m.mensaje).join(" ");
    expect(msj).toMatch(/El nivel debe ser 2/);
    expect(msj).toMatch(/Falta la cuenta padre/);
  });

  it("el administrador da de alta un almacén de insumos de sucursal", async () => {
    await cargar(admin, "almacenes", "CLAVE|NOMBRE|TIPO|SUCURSAL\nPRUEBA-INS-SUC1|PRUEBA Insumos sucursal 1|INS|SUC1\n");
    expect(await contar("almacen")).toBe(5);
  });

  it("historial de cargas con el archivo original guardado", async () => {
    const l = await nav.com!.get("/api/cargas?layout=insumos");
    expect(l.datos.cargas.length).toBeGreaterThan(2);
    const primera = l.datos.cargas.at(-1);
    const f = await nav.com!.get(`/api/cargas/${primera.id}/archivo`);
    expect(f.estado).toBe(200);
    expect((f.datos as Uint8Array).length).toBeGreaterThan(10);
    // Otro puesto sin relación con insumos no ve esas cargas
    const otra = await nav.caj!.get("/api/cargas?layout=insumos");
    expect(otra.datos.cargas).toHaveLength(0);
  });
});
