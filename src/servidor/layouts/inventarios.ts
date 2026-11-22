// Layouts de la Fase 3: causas de merma, mínimos y reorden por almacén e
// inventario inicial (este último queda pendiente hasta que lo autorice quien
// tiene inventarios.ajustes:autorizar y se aplica como movimiento INICIAL).
import Decimal from "decimal.js";
import { aplicarInventarioInicial } from "../inventarios";
import type { Cliente } from "../transaccion";
import type { FilaValidada, Layout } from "./tipos";

const CLAVE: { nombre: string; columna: string; tipo: "texto"; obligatorio: true; mayusculas: true; max: number; patron: RegExp; patronTexto: string; ejemplo: string; descripcion: string } = {
  nombre: "CLAVE", columna: "clave", tipo: "texto", obligatorio: true, mayusculas: true, max: 20,
  patron: /^[A-Z0-9-]+$/, patronTexto: "solo letras sin acento, números y guion (-)", ejemplo: "CADUCADO", descripcion: "Clave única de la causa.",
};
const ACTIVO = { nombre: "ACTIVO", columna: "activo", tipo: "sino" as const, porOmision: "SI", ejemplo: "SI", descripcion: "NO = dado de baja. Nunca se borra." };
const ALMACEN = { nombre: "ALMACEN", columna: "almacen_id", tipo: "ref" as const, ref: { tabla: "almacen", etiqueta: "El almacén" }, obligatorio: true, soloAlta: true, ejemplo: "MP-MAT", descripcion: "Clave del almacén." };
const ARTICULO = { nombre: "ARTICULO", columna: "articulo_id", tipo: "ref" as const, ref: { tabla: "articulo", etiqueta: "El artículo" }, obligatorio: true, soloAlta: true, ejemplo: "PRUEBA-HAR-01", descripcion: "Clave del artículo." };
const CANTIDAD = (nombre: string, columna: string, descripcion: string, ejemplo: string) => ({ nombre, columna, tipo: "decimal" as const, minimo: 0, decimales: 4, ejemplo, descripcion });

const causasMerma: Layout = {
  clave: "causas_merma", secuencia: 29, grupo: "Inventarios", nombre: "Causas de merma",
  descripcion: "Catálogo de causas para registrar mermas (pregunta P38). APLICA indica si es para materia prima y producción (MP), producto terminado en sucursal (PT) o ambos.",
  tabla: "causa_merma", llave: ["CLAVE"],
  permisos: {
    ver: ["inventarios.existencias:ver", "produccion.mermas:ver", "inventarios.merma_sucursal:ver"],
    crear: ["produccion.mermas:autorizar", "inventarios.merma_sucursal:autorizar"],
    editar: ["produccion.mermas:autorizar", "inventarios.merma_sucursal:autorizar"],
  },
  campos: [
    CLAVE,
    { nombre: "NOMBRE", columna: "nombre", tipo: "texto", obligatorio: true, max: 120, ejemplo: "Producto caducado", descripcion: "Descripción de la causa." },
    { nombre: "APLICA", columna: "aplica", tipo: "opcion", opciones: ["MP", "PT", "TODOS"], porOmision: "TODOS", ejemplo: "TODOS", descripcion: "Dónde se puede usar." },
    ACTIVO,
  ],
};

const minimos: Layout = {
  clave: "minimos_almacen", secuencia: 30, grupo: "Inventarios", nombre: "Mínimos y reorden por almacén",
  descripcion: "Mínimo, punto de reorden y máximo de un artículo en un almacén, en su unidad base. Si no se captura, en almacenes de materia prima o insumos (MP, INS) se usan los del catálogo del artículo; en producción en proceso y producto terminado solo aplican los que se capturen aquí.",
  tabla: "articulo_almacen", llave: ["ALMACEN", "ARTICULO"],
  permisos: { ver: ["inventarios.existencias:ver"], crear: ["catalogos.insumos:editar", "catalogos.sku:editar"], editar: ["catalogos.insumos:editar", "catalogos.sku:editar"] },
  orden: "(SELECT clave FROM almacen a WHERE a.id = t.almacen_id), (SELECT clave FROM articulo a WHERE a.id = t.articulo_id)",
  campos: [
    ALMACEN, ARTICULO,
    CANTIDAD("MINIMO", "stock_minimo", "Existencia mínima: debajo de esto aparece la alerta roja.", "50"),
    CANTIDAD("REORDEN", "punto_reorden", "Punto de reorden: debajo de esto aparece la alerta de pedir.", "100"),
    CANTIDAD("MAXIMO", "stock_maximo", "Existencia máxima (para calcular cuánto pedir).", "300"),
    ACTIVO,
  ],
  validar(f, ayuda) {
    const v = (k: string) => (f.valores[k] === null || f.valores[k] === undefined ? null : new Decimal(String(f.valores[k])));
    const [min, re, max] = [v("MINIMO"), v("REORDEN"), v("MAXIMO")];
    if (min && re && min.gt(re)) ayuda.error("REORDEN", "El punto de reorden debe ser mayor o igual que el mínimo.");
    if (re && max && re.gt(max)) ayuda.error("MAXIMO", "El máximo debe ser mayor o igual que el punto de reorden.");
    if (min && max && min.gt(max)) ayuda.error("MAXIMO", "El máximo debe ser mayor o igual que el mínimo.");
  },
};

const TIPOS_POR_ALMACEN: Record<string, string[]> = { MP: ["INSUMO", "EMPAQUE"], INS: ["INSUMO", "EMPAQUE"], PEP: ["INTERMEDIO", "INSUMO", "EMPAQUE"], PT: ["SKU"] };

const inventarioInicial: Layout = {
  clave: "inventario_inicial", secuencia: 31, grupo: "Inventarios", nombre: "Inventario inicial",
  descripcion: "Existencias con las que arranca cada almacén, con su costo unitario. Queda pendiente hasta que el contralor (o quien tenga permiso de autorizar ajustes) la autoriza; entonces se registra como movimiento INICIAL en el kárdex.",
  tabla: "inventario_inicial", llave: ["ALMACEN", "ARTICULO", "LOTE"], modos: ["alta"],
  autorizacion: { permiso: "inventarios.ajustes:autorizar" },
  permisos: { ver: ["inventarios.existencias:ver"], crear: ["inventarios.ajustes:crear"], editar: ["inventarios.ajustes:crear"] },
  orden: "(SELECT clave FROM almacen a WHERE a.id = t.almacen_id), (SELECT clave FROM articulo a WHERE a.id = t.articulo_id), t.lote",
  notas: [
    "Solo para almacenes y artículos que todavía no tienen movimientos. Después, las diferencias se corrigen con un conteo físico.",
    "CANTIDAD va en la unidad base del artículo (KG, PZA…). COSTO_UNITARIO es por esa misma unidad.",
    "Si el artículo maneja lote, LOTE es obligatorio (un renglón por lote); si maneja caducidad, también CADUCIDAD.",
    "Insumos y empaques van a almacenes MP o INS; masas e intermedios a PEP; productos (SKU) a PT.",
  ],
  campos: [
    ALMACEN, ARTICULO,
    { nombre: "LOTE", columna: "lote", tipo: "texto", max: 40, patron: /^[A-Za-z0-9./_-]+$/, patronTexto: "letras sin acento, números, punto, diagonal, guion bajo y guion", ejemplo: "", descripcion: "Código del lote (solo si el artículo maneja lote)." },
    { nombre: "CADUCIDAD", columna: "caducidad", tipo: "fecha", ejemplo: "", descripcion: "Caducidad del lote (DD/MM/AAAA)." },
    { nombre: "CANTIDAD", columna: "cantidad", tipo: "decimal", obligatorio: true, mayorQueCero: true, decimales: 6, ejemplo: "250", descripcion: "Existencia en la unidad base." },
    { nombre: "COSTO_UNITARIO", columna: "costo_unitario", tipo: "decimal", obligatorio: true, minimo: 0, decimales: 6, sensible: "datos.costos:ver", ejemplo: "18.50", descripcion: "Costo por unidad base." },
  ],
  async preparar(c: Cliente, filas: FilaValidada[]) {
    const ids = (k: string) => [...new Set(filas.map((f) => f.valores[k]).filter(Boolean))] as string[];
    const almacenes = new Map((await c.query("SELECT id::text, clave, tipo FROM almacen WHERE id = ANY($1)", [ids("ALMACEN")])).rows.map((r) => [r.id, r]));
    const articulos = new Map((await c.query(
      "SELECT a.id::text, a.clave, a.tipo, a.maneja_lote, a.maneja_caducidad, u.clave AS unidad FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id WHERE a.id = ANY($1)",
      [ids("ARTICULO")],
    )).rows.map((r) => [r.id, r]));
    const usados = new Set((await c.query(
      "SELECT almacen_id::text || '#' || articulo_id::text AS k FROM movimiento_renglon WHERE almacen_id = ANY($1) AND articulo_id = ANY($2) GROUP BY 1",
      [ids("ALMACEN"), ids("ARTICULO")],
    )).rows.map((r) => r.k));
    const lotes = new Map((await c.query("SELECT articulo_id::text || '#' || codigo AS k, caducidad::text FROM lote WHERE articulo_id = ANY($1)", [ids("ARTICULO")])).rows.map((r) => [r.k, r.caducidad]));
    return { almacenes, articulos, usados, lotes };
  },
  validar(f, ayuda) {
    const { almacenes, articulos, usados, lotes } = ayuda.datos;
    const alm = almacenes.get(f.valores.ALMACEN as string);
    const art = articulos.get(f.valores.ARTICULO as string);
    if (!alm || !art) return;
    if (!TIPOS_POR_ALMACEN[alm.tipo]!.includes(art.tipo)) ayuda.error("ARTICULO", `Un artículo de tipo ${art.tipo} no va en un almacén ${alm.tipo}.`);
    if (usados.has(`${alm.id}#${art.id}`)) ayuda.error("ARTICULO", `${art.clave} ya tiene movimientos en ${alm.clave}: corrige con un conteo físico.`);
    const lote = f.valores.LOTE as string | null;
    const cad = f.valores.CADUCIDAD as string | null;
    if (art.maneja_lote && !lote) ayuda.error("LOTE", `${art.clave} maneja lote: escribe el lote.`);
    if (!art.maneja_lote && lote) ayuda.error("LOTE", `${art.clave} no maneja lote: deja vacío.`);
    if (art.maneja_lote && art.maneja_caducidad && !cad) ayuda.error("CADUCIDAD", `${art.clave} maneja caducidad: escribe la caducidad del lote.`);
    if (!art.maneja_lote && cad) ayuda.error("CADUCIDAD", "La caducidad se registra por lote; este artículo no maneja lote.");
    if (lote && lotes.has(`${art.id}#${lote}`) && cad && lotes.get(`${art.id}#${lote}`) !== cad) ayuda.error("CADUCIDAD", `El lote ${lote} ya existe con otra caducidad.`);
    if (art.unidad === "PZA" && f.valores.CANTIDAD !== null && !new Decimal(String(f.valores.CANTIDAD)).isInteger()) ayuda.error("CANTIDAD", "Las piezas van en números enteros.");
  },
  async despues(c: Cliente) {
    const { rows } = await c.query("SELECT id FROM inventario_inicial WHERE movimiento_id IS NULL");
    await aplicarInventarioInicial(c, rows.map((r) => r.id));
  },
};

export const LAYOUTS_INVENTARIOS: Layout[] = [causasMerma, minimos, inventarioInicial];
