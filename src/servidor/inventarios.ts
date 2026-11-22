// Motor de inventarios: cada entrada o salida escribe un renglón inmutable en el
// kárdex y actualiza en la misma transacción los saldos (existencia, lotes y
// capas PEPS), con el saldo bloqueado (FOR UPDATE) para que dos operaciones
// simultáneas no se pisen. Sobre el motor están las operaciones: entrada por
// compra, surtido a producción, entrada de producción terminada, traspasos,
// mermas, conteos con ajuste autorizado, inventario inicial y cancelaciones.
import { dentroDeAlcanceAlmacen } from "../dominio/permisos";
import { asignarLotes, costoUnitario, diferenciaConteo, FaltaExistencia, importeEntrada, salidaPeps, salidaPromedio, type Metodo } from "../dominio/inventarios";
import { D, type Dec } from "../dominio/recetas";
import { factorConversion } from "../dominio/unidades";
import { ErrorApp, invalido, noEncontrado, prohibido } from "./errores";
import { hoyNegocio } from "./fechas";
import { calcularCostos, leerUnidades, num, type Unidades } from "./recetas";
import type { Cliente } from "./transaccion";
import type { UsuarioActual } from "./usuarios";

// ---------------------------------------------------------------------------
// Datos de apoyo
// ---------------------------------------------------------------------------
export interface Almacen { id: string; clave: string; nombre: string; tipo: "MP" | "PEP" | "PT" | "INS"; sucursal_id: string; sucursal: string }
export interface Articulo {
  id: string; clave: string; nombre: string; tipo: "INSUMO" | "EMPAQUE" | "INTERMEDIO" | "SKU"; unidad: string;
  maneja_lote: boolean; maneja_caducidad: boolean; vida_util_horas: number | null; costo_referencia: string | null;
}

export async function metodoValuacion(c: Cliente): Promise<Metodo> {
  const v = (await c.query("SELECT valor FROM configuracion WHERE clave = 'inventarios.metodo_valuacion'")).rows[0]?.valor;
  return v === "PEPS" ? "PEPS" : "PROMEDIO";
}

export async function almacenPorClave(c: Cliente, clave: string): Promise<Almacen> {
  const a = (await c.query(
    "SELECT a.id, a.clave, a.nombre, a.tipo, a.sucursal_id, s.clave AS sucursal FROM almacen a JOIN sucursal s ON s.id = a.sucursal_id WHERE a.clave = upper($1) AND a.activo",
    [clave],
  )).rows[0];
  if (!a) throw invalido(`No existe el almacén ${clave} o está inactivo.`);
  return a;
}

export function exigirAlmacen(u: UsuarioActual, a: Almacen) {
  if (!dentroDeAlcanceAlmacen(u.alcance, a.id, a.sucursal_id)) throw prohibido(`El almacén ${a.clave} no está dentro de tus sucursales o almacenes asignados.`);
}

const SELECT_ARTICULO = `SELECT a.id, a.clave, a.nombre, a.tipo, u.clave AS unidad, a.maneja_lote, a.maneja_caducidad, a.vida_util_horas, a.costo_referencia::text
  FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id`;

async function articulosPorClave(c: Cliente, claves: string[]): Promise<Map<string, Articulo>> {
  const m = new Map<string, Articulo>((await c.query(`${SELECT_ARTICULO} WHERE a.clave = ANY($1) AND a.activo`, [claves.map((x) => x.toUpperCase())])).rows.map((r) => [r.clave, r]));
  const faltan = [...new Set(claves.map((x) => x.toUpperCase()))].filter((x) => !m.has(x));
  if (faltan.length) throw invalido(`No existe o está inactivo: ${faltan.join(", ")}.`);
  return m;
}

async function articuloPorId(c: Cliente, id: string): Promise<Articulo> {
  return (await c.query(`${SELECT_ARTICULO} WHERE a.id = $1`, [id])).rows[0];
}

/** Límite de autorización por monto (tabla limite_autorizacion). Sin renglones para la operación = sin límite. */
async function dentroDeLimite(c: Cliente, usuarioId: string, operacion: string, monto: Dec): Promise<{ ok: boolean; limite: string | null }> {
  const todas = (await c.query("SELECT count(*)::int AS n FROM limite_autorizacion WHERE operacion = $1", [operacion])).rows[0].n;
  if (!todas) return { ok: true, limite: null };
  const { rows } = await c.query(
    `SELECT l.monto_hasta::text FROM limite_autorizacion l JOIN usuario_rol ur ON ur.rol_id = l.rol_id JOIN rol r ON r.id = l.rol_id AND r.activo
      WHERE ur.usuario_id = $1 AND l.operacion = $2`,
    [usuarioId, operacion],
  );
  if (!rows.length) return { ok: false, limite: "0" };
  if (rows.some((r) => r.monto_hasta === null)) return { ok: true, limite: null };
  const max = rows.reduce((m, r) => D.max(m, new D(r.monto_hasta)), new D(0));
  return { ok: monto.lte(max), limite: max.toFixed(2) };
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------
interface Ctx { c: Cliente; usuarioId: string; metodo: Metodo; hoy: string }

async function contexto(c: Cliente, usuarioId: string): Promise<Ctx> {
  return { c, usuarioId, metodo: await metodoValuacion(c), hoy: await hoyNegocio(c) };
}

interface DatosMovimiento {
  documento_tipo?: string; documento_id?: string; proveedor_id?: string | null; referencia?: string | null;
  plan_id?: string | null; comentario?: string | null; cancela_id?: string;
}

async function nuevoMovimiento(x: Ctx, tipo: string, almacenId: string, d: DatosMovimiento = {}): Promise<{ id: string; folio: string }> {
  return (await x.c.query(
    `INSERT INTO movimiento (tipo, almacen_id, fecha_negocio, documento_tipo, documento_id, proveedor_id, referencia, plan_id, comentario, cancela_id, metodo, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, folio`,
    [tipo, almacenId, x.hoy, d.documento_tipo ?? null, d.documento_id ?? null, d.proveedor_id ?? null, d.referencia ?? null, d.plan_id ?? null, d.comentario ?? null, d.cancela_id ?? null, x.metodo, x.usuarioId],
  )).rows[0];
}

async function saldoBloqueado(x: Ctx, almacenId: string, articuloId: string) {
  await x.c.query("INSERT INTO existencia (almacen_id, articulo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [almacenId, articuloId]);
  const r = (await x.c.query("SELECT cantidad::text, valor::text FROM existencia WHERE almacen_id = $1 AND articulo_id = $2 FOR UPDATE", [almacenId, articuloId])).rows[0];
  return { cantidad: new D(r.cantidad), valor: new D(r.valor) };
}

async function escribirRenglon(x: Ctx, movId: string, almacenId: string, art: Articulo, loteId: string | null, cantidad: Dec, importe: Dec, saldo: { cantidad: Dec; valor: Dec }, causaId: string | null) {
  return (await x.c.query(
    `INSERT INTO movimiento_renglon (movimiento_id, almacen_id, articulo_id, lote_id, cantidad, costo_unitario, importe, saldo_cantidad, saldo_valor, causa_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, consecutivo`,
    [movId, almacenId, art.id, loteId, cantidad.toFixed(), costoUnitario(importe, cantidad).toFixed(), importe.toFixed(), saldo.cantidad.toFixed(), saldo.valor.toFixed(), causaId],
  )).rows[0] as { id: string; consecutivo: string };
}

export interface Porcion { lote_id: string | null; cantidad: Dec; importe: Dec; renglon_id: string }

/** Entrada al almacén. Con `importe` se usa ese valor exacto (traspasos y cancelaciones); si no, cantidad × costo. */
async function entrar(x: Ctx, movId: string, almacenId: string, art: Articulo, cantidad: Dec, o: { costo?: Dec; importe?: Dec; loteId?: string | null; causaId?: string | null }): Promise<Porcion> {
  if (cantidad.lte(0)) throw invalido(`${art.clave}: la cantidad debe ser mayor que cero.`);
  if (art.maneja_lote && !o.loteId) throw invalido(`${art.clave} maneja lote: indica el lote.`);
  const importe = o.importe ?? importeEntrada(cantidad, o.costo ?? new D(0));
  const s = await saldoBloqueado(x, almacenId, art.id);
  const saldo = { cantidad: s.cantidad.plus(cantidad), valor: s.valor.plus(importe) };
  const costo = costoUnitario(importe, cantidad);
  await x.c.query("UPDATE existencia SET cantidad = $3, valor = $4, ultimo_costo = $5, actualizado_en = now() WHERE almacen_id = $1 AND articulo_id = $2",
    [almacenId, art.id, saldo.cantidad.toFixed(), saldo.valor.toFixed(), costo.toFixed()]);
  const loteId = art.maneja_lote ? o.loteId! : null;
  if (loteId) {
    await x.c.query(
      `INSERT INTO existencia_lote (almacen_id, articulo_id, lote_id, cantidad) VALUES ($1, $2, $3, $4)
       ON CONFLICT (almacen_id, lote_id) DO UPDATE SET cantidad = existencia_lote.cantidad + EXCLUDED.cantidad`,
      [almacenId, art.id, loteId, cantidad.toFixed()],
    );
  }
  const r = await escribirRenglon(x, movId, almacenId, art, loteId, cantidad, importe, saldo, o.causaId ?? null);
  if (x.metodo === "PEPS") {
    await x.c.query(
      "INSERT INTO capa_costo (almacen_id, articulo_id, renglon_id, consecutivo, costo_unitario, cantidad_restante, valor_restante) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [almacenId, art.id, r.id, r.consecutivo, costo.toFixed(), cantidad.toFixed(), importe.toFixed()],
    );
  }
  return { lote_id: loteId, cantidad, importe, renglon_id: r.id };
}

/**
 * Salida del almacén. Si el artículo maneja lote y no se indica, se reparte por
 * caducidad (FEFO) y se escribe un renglón por lote. `capaDe` (solo PEPS) obliga a
 * salir de la capa que abrió ese renglón (cancelación exacta de una entrada).
 */
async function sacar(x: Ctx, movId: string, almacenId: string, art: Articulo, cantidad: Dec, o: { loteId?: string | null; causaId?: string | null; capaDe?: string } = {}): Promise<Porcion[]> {
  if (cantidad.lte(0)) throw invalido(`${art.clave}: la cantidad debe ser mayor que cero.`);
  let partes: { lote_id: string | null; cantidad: Dec }[] = [{ lote_id: null, cantidad }];
  try {
    if (art.maneja_lote) {
      const lotes = (await x.c.query(
        `SELECT el.lote_id AS id, el.cantidad::text, l.caducidad::text, extract(epoch FROM l.creado_en)::float AS orden
           FROM existencia_lote el JOIN lote l ON l.id = el.lote_id
          WHERE el.almacen_id = $1 AND el.articulo_id = $2 AND el.cantidad > 0 ${o.loteId ? "AND el.lote_id = $3" : ""}
          ORDER BY el.lote_id FOR UPDATE OF el`,
        o.loteId ? [almacenId, art.id, o.loteId] : [almacenId, art.id],
      )).rows.map((l) => ({ id: l.id, cantidad: new D(l.cantidad), caducidad: l.caducidad, orden: l.orden }));
      partes = asignarLotes(lotes, cantidad);
    }
    const salidas: Porcion[] = [];
    for (const p of partes) {
      const s = await saldoBloqueado(x, almacenId, art.id);
      let importe: Dec;
      if (x.metodo === "PEPS") {
        const capas = (await x.c.query(
          `SELECT id, cantidad_restante::text AS cantidad, valor_restante::text AS valor FROM capa_costo
            WHERE almacen_id = $1 AND articulo_id = $2 AND cantidad_restante > 0 ${o.capaDe ? "AND renglon_id = $3" : ""}
            ORDER BY consecutivo FOR UPDATE`,
          o.capaDe ? [almacenId, art.id, o.capaDe] : [almacenId, art.id],
        )).rows.map((k) => ({ id: k.id, cantidad: new D(k.cantidad), valor: new D(k.valor) }));
        if (o.capaDe && (!capas[0] || !capas[0].cantidad.eq(p.cantidad))) {
          throw new ErrorApp(409, "regla", `${art.clave}: esa entrada ya se usó (total o parcialmente); no se puede cancelar. Registra un ajuste.`);
        }
        const r = salidaPeps(capas, p.cantidad);
        for (const k of r.consumos) {
          await x.c.query("UPDATE capa_costo SET cantidad_restante = cantidad_restante - $2, valor_restante = valor_restante - $3 WHERE id = $1", [k.id, k.cantidad.toFixed(), k.importe.toFixed()]);
        }
        importe = r.importe;
      } else {
        importe = salidaPromedio(s, p.cantidad);
      }
      const saldo = { cantidad: s.cantidad.minus(p.cantidad), valor: s.valor.minus(importe) };
      if (saldo.cantidad.isZero() && !saldo.valor.isZero()) {
        // Solo pasaría con capas PEPS desalineadas; se detiene antes de dejar el saldo mal.
        throw new ErrorApp(500, "inventario", `${art.clave}: el valor del inventario no cuadra con sus capas de costo.`);
      }
      await x.c.query("UPDATE existencia SET cantidad = $3, valor = $4, actualizado_en = now() WHERE almacen_id = $1 AND articulo_id = $2",
        [almacenId, art.id, saldo.cantidad.toFixed(), saldo.valor.toFixed()]);
      if (p.lote_id) await x.c.query("UPDATE existencia_lote SET cantidad = cantidad - $2 WHERE almacen_id = $1 AND lote_id = $3", [almacenId, p.cantidad.toFixed(), p.lote_id]);
      const r = await escribirRenglon(x, movId, almacenId, art, p.lote_id, p.cantidad.neg(), importe.neg(), saldo, o.causaId ?? null);
      salidas.push({ lote_id: p.lote_id, cantidad: p.cantidad, importe, renglon_id: r.id });
    }
    return salidas;
  } catch (e) {
    if (e instanceof FaltaExistencia) throw new ErrorApp(409, "existencia", `${art.clave}: ${e.message}`);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Renglones capturados
// ---------------------------------------------------------------------------
export interface RenglonCaptura { articulo: string; cantidad: string; unidad?: string | null; lote?: string | null; caducidad?: string | null; costo_unitario?: string | null }
interface Renglon { art: Articulo; cantidad: Dec; loteCodigo: string | null; caducidad: string | null; costo: Dec | null }

/** Valida, convierte a unidad base y agrupa los renglones capturados. */
async function prepararRenglones(c: Cliente, lista: RenglonCaptura[], tipos: Articulo["tipo"][], unidades?: Unidades): Promise<Renglon[]> {
  if (!lista.length) throw invalido("Captura al menos un renglón.");
  const arts = await articulosPorClave(c, lista.map((r) => r.articulo));
  const u = unidades ?? await leerUnidades(c);
  const errores: string[] = [];
  const res: Renglon[] = [];
  lista.forEach((r, i) => {
    const art = arts.get(r.articulo.toUpperCase())!;
    const n = `Renglón ${i + 1} (${art.clave})`;
    if (!tipos.includes(art.tipo)) { errores.push(`${n}: no se permite un artículo de tipo ${art.tipo} aquí.`); return; }
    let cantidad: Dec;
    try { cantidad = new D(r.cantidad.replaceAll(",", "")); } catch { errores.push(`${n}: cantidad no válida.`); return; }
    if (!cantidad.isFinite() || cantidad.lte(0)) { errores.push(`${n}: la cantidad debe ser mayor que cero.`); return; }
    if (r.unidad && r.unidad.toUpperCase() !== art.unidad) {
      const f = factorConversion(r.unidad.toUpperCase(), art.unidad, { base: art.unidad, propias: u.propias.get(art.clave) ?? [] }, u.generales);
      if (!f) { errores.push(`${n}: no hay conversión de ${r.unidad.toUpperCase()} a ${art.unidad}.`); return; }
      cantidad = cantidad.mul(f);
    }
    cantidad = cantidad.toDecimalPlaces(6, D.ROUND_HALF_UP);
    if (cantidad.lte(0)) { errores.push(`${n}: la cantidad convertida es cero.`); return; }
    if (art.unidad === "PZA" && !cantidad.isInteger()) { errores.push(`${n}: las piezas van en números enteros.`); return; }
    const lote = r.lote?.trim() || null;
    if (lote && !art.maneja_lote) { errores.push(`${n}: el artículo no maneja lote.`); return; }
    let costo: Dec | null = null;
    if (r.costo_unitario !== undefined && r.costo_unitario !== null && r.costo_unitario !== "") {
      try { costo = new D(r.costo_unitario.replaceAll(",", "")); } catch { errores.push(`${n}: costo no válido.`); return; }
      if (costo.lt(0)) { errores.push(`${n}: el costo no puede ser negativo.`); return; }
      // El costo se capturó por la unidad del renglón: se pasa a costo por unidad base.
      if (r.unidad && r.unidad.toUpperCase() !== art.unidad) costo = costo.mul(new D(r.cantidad.replaceAll(",", ""))).div(cantidad).toDecimalPlaces(6, D.ROUND_HALF_UP);
    }
    res.push({ art, cantidad, loteCodigo: lote, caducidad: r.caducidad || null, costo });
  });
  if (errores.length) throw invalido("Revisa los renglones.", errores.map((mensaje) => ({ campo: "renglones", mensaje })));
  return res;
}

/** Lote para una entrada: lo crea si no existe; si existe, la caducidad debe coincidir. */
async function loteEntrada(c: Cliente, r: Renglon): Promise<string | null> {
  if (!r.art.maneja_lote) return null;
  if (!r.loteCodigo) throw invalido(`${r.art.clave} maneja lote: indica el lote.`);
  const l = (await c.query("SELECT id, caducidad::text FROM lote WHERE articulo_id = $1 AND codigo = $2", [r.art.id, r.loteCodigo])).rows[0];
  if (l) {
    if (r.caducidad && l.caducidad !== r.caducidad) throw invalido(`${r.art.clave}: el lote ${r.loteCodigo} ya existe con otra caducidad.`);
    return l.id;
  }
  if (r.art.maneja_caducidad && !r.caducidad) throw invalido(`${r.art.clave} maneja caducidad: indica la caducidad del lote ${r.loteCodigo}.`);
  return (await c.query("INSERT INTO lote (articulo_id, codigo, caducidad) VALUES ($1, $2, $3) RETURNING id", [r.art.id, r.loteCodigo, r.caducidad])).rows[0].id;
}

/** Lote para una salida: si se indica, debe existir. */
async function loteSalida(c: Cliente, r: Renglon): Promise<string | null> {
  if (!r.loteCodigo) return null;
  const l = (await c.query("SELECT id FROM lote WHERE articulo_id = $1 AND codigo = $2", [r.art.id, r.loteCodigo])).rows[0];
  if (!l) throw invalido(`${r.art.clave}: no existe el lote ${r.loteCodigo}.`);
  return l.id;
}

const TIPOS_MP: Almacen["tipo"][] = ["MP", "INS"];

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------
export async function entradaCompra(c: Cliente, u: UsuarioActual, d: { almacen: string; proveedor?: string | null; referencia?: string | null; comentario?: string | null; renglones: RenglonCaptura[] }) {
  const alm = await almacenPorClave(c, d.almacen);
  exigirAlmacen(u, alm);
  if (!TIPOS_MP.includes(alm.tipo)) throw invalido("Las compras entran a un almacén de materia prima o de insumos.");
  let proveedorId: string | null = null;
  if (d.proveedor) {
    proveedorId = (await c.query("SELECT id FROM proveedor WHERE clave = upper($1) AND activo", [d.proveedor])).rows[0]?.id ?? null;
    if (!proveedorId) throw invalido(`No existe el proveedor ${d.proveedor}.`);
  }
  const rs = await prepararRenglones(c, d.renglones, ["INSUMO", "EMPAQUE"]);
  const sinCosto = rs.filter((r) => r.costo === null);
  if (sinCosto.length) throw invalido(`Falta el costo unitario de: ${sinCosto.map((r) => r.art.clave).join(", ")}.`);
  const x = await contexto(c, u.id);
  const m = await nuevoMovimiento(x, "ENTRADA_COMPRA", alm.id, { proveedor_id: proveedorId, referencia: d.referencia, comentario: d.comentario });
  for (const r of rs) await entrar(x, m.id, alm.id, r.art, r.cantidad, { costo: r.costo!, loteId: await loteEntrada(c, r) });
  return m;
}

export async function surtir(c: Cliente, u: UsuarioActual, d: { origen: string; destino: string; plan_id?: string | null; comentario?: string | null; renglones: RenglonCaptura[] }) {
  const o = await almacenPorClave(c, d.origen);
  const t = await almacenPorClave(c, d.destino);
  exigirAlmacen(u, o);
  if (!TIPOS_MP.includes(o.tipo)) throw invalido("El surtido sale de un almacén de materia prima o de insumos.");
  if (t.tipo !== "PEP") throw invalido("El surtido entra a un almacén de producción en proceso (PEP).");
  if (o.sucursal_id !== t.sucursal_id) throw invalido("El surtido es dentro de la misma sucursal; entre sucursales usa un traspaso.");
  if (d.plan_id && !(await c.query("SELECT 1 FROM plan_produccion WHERE id = $1 AND estatus = 'APROBADO'", [d.plan_id])).rowCount) throw invalido("El plan debe existir y estar aprobado.");
  const rs = await prepararRenglones(c, d.renglones, ["INSUMO", "EMPAQUE", "INTERMEDIO"]);
  const x = await contexto(c, u.id);
  const docId = (await c.query("SELECT gen_random_uuid() AS id")).rows[0].id as string;
  const sal = await nuevoMovimiento(x, "SURTIDO_SALIDA", o.id, { documento_tipo: "SURTIDO", documento_id: docId, plan_id: d.plan_id, comentario: d.comentario });
  const ent = await nuevoMovimiento(x, "SURTIDO_ENTRADA", t.id, { documento_tipo: "SURTIDO", documento_id: docId, plan_id: d.plan_id, comentario: d.comentario });
  for (const r of rs) {
    for (const p of await sacar(x, sal.id, o.id, r.art, r.cantidad, { loteId: await loteSalida(c, r) })) {
      await entrar(x, ent.id, t.id, r.art, p.cantidad, { importe: p.importe, loteId: p.lote_id });
    }
  }
  const s = (await c.query(
    `INSERT INTO surtido (id, almacen_origen_id, almacen_destino_id, plan_id, salida_id, entrada_id, comentario, usuario_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, folio`,
    [docId, o.id, t.id, d.plan_id ?? null, sal.id, ent.id, d.comentario ?? null, u.id],
  )).rows[0];
  return { ...s, salida: sal.folio, entrada: ent.folio };
}

/** Entrada de producción terminada (provisional hasta las órdenes de la Fase 5): se valúa al costo estándar del día. */
export async function entradaProduccion(c: Cliente, u: UsuarioActual, d: { almacen: string; comentario?: string | null; renglones: RenglonCaptura[] }) {
  const alm = await almacenPorClave(c, d.almacen);
  exigirAlmacen(u, alm);
  if (alm.tipo !== "PT" && alm.tipo !== "PEP") throw invalido("La producción entra a un almacén de producto terminado (PT) o de producción en proceso (PEP).");
  const rs = await prepararRenglones(c, d.renglones, alm.tipo === "PT" ? ["SKU"] : ["INTERMEDIO"]);
  const x = await contexto(c, u.id);
  const costos = new Map((await calcularCostos(c, x.hoy)).articulos.map((a) => [a.clave, a.costo?.completo ? a.costo.total : null]));
  const sinCosto = rs.filter((r) => !costos.get(r.art.clave));
  if (sinCosto.length) throw invalido(`No hay costo estándar completo al día de hoy para: ${sinCosto.map((r) => r.art.clave).join(", ")} (revisa su receta activa y los costos).`);
  const m = await nuevoMovimiento(x, "ENTRADA_PRODUCCION", alm.id, { comentario: d.comentario });
  for (const r of rs) {
    let loteId: string | null = null;
    if (r.art.maneja_lote) {
      const codigo = r.loteCodigo ?? `P${x.hoy.replaceAll("-", "")}-${m.folio.slice(4)}`;
      const caducidad = r.caducidad ?? (r.art.vida_util_horas
        ? (await c.query("SELECT ($1::date + ceil($2::numeric / 24)::int)::text AS f", [x.hoy, r.art.vida_util_horas])).rows[0].f
        : null);
      loteId = await loteEntrada(c, { ...r, loteCodigo: codigo, caducidad });
    }
    await entrar(x, m.id, alm.id, r.art, r.cantidad, { costo: new D(costos.get(r.art.clave)!), loteId });
  }
  return m;
}

// ---- Traspasos --------------------------------------------------------------
export async function enviarTraspaso(c: Cliente, u: UsuarioActual, d: { origen: string; destino: string; comentario?: string | null; renglones: RenglonCaptura[] }) {
  const o = await almacenPorClave(c, d.origen);
  const t = await almacenPorClave(c, d.destino);
  exigirAlmacen(u, o);
  if (o.id === t.id) throw invalido("El almacén de origen y el de destino deben ser distintos.");
  const rs = await prepararRenglones(c, d.renglones, ["INSUMO", "EMPAQUE", "INTERMEDIO", "SKU"]);
  const x = await contexto(c, u.id);
  const docId = (await c.query("SELECT gen_random_uuid() AS id")).rows[0].id as string;
  const m = await nuevoMovimiento(x, "TRASPASO_ENVIO", o.id, { documento_tipo: "TRASPASO", documento_id: docId, comentario: d.comentario });
  const partes: (Porcion & { art: Articulo })[] = [];
  for (const r of rs) for (const p of await sacar(x, m.id, o.id, r.art, r.cantidad, { loteId: await loteSalida(c, r) })) partes.push({ ...p, art: r.art });
  const tr = (await c.query(
    "INSERT INTO traspaso (id, almacen_origen_id, almacen_destino_id, envio_id, comentario, enviado_por) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, folio",
    [docId, o.id, t.id, m.id, d.comentario ?? null, u.id],
  )).rows[0];
  for (const p of partes) {
    await c.query("INSERT INTO traspaso_renglon (traspaso_id, articulo_id, lote_id, cantidad_enviada, importe_enviado) VALUES ($1, $2, $3, $4, $5)",
      [tr.id, p.art.id, p.lote_id, p.cantidad.toFixed(), p.importe.toFixed()]);
  }
  return { ...tr, envio: m.folio };
}

async function traspasoBloqueado(c: Cliente, id: string) {
  const t = (await c.query("SELECT * FROM traspaso WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!t) throw noEncontrado("No existe ese traspaso.");
  return t;
}

/** Recepción: lo recibido entra al destino al mismo costo del envío; lo que falta queda como faltante del traspaso. */
export async function recibirTraspaso(c: Cliente, u: UsuarioActual, id: string, d: { comentario?: string | null; recibidos?: { renglon_id: string; cantidad: string }[] }) {
  const t = await traspasoBloqueado(c, id);
  if (t.estatus !== "ENVIADO") throw new ErrorApp(409, "estatus", "El traspaso ya no está en tránsito.");
  const dest = (await c.query("SELECT a.id, a.clave, a.nombre, a.tipo, a.sucursal_id FROM almacen a WHERE a.id = $1", [t.almacen_destino_id])).rows[0];
  exigirAlmacen(u, dest);
  const renglones = (await c.query("SELECT id, articulo_id, lote_id, cantidad_enviada::text, importe_enviado::text FROM traspaso_renglon WHERE traspaso_id = $1 ORDER BY creado_en, id", [id])).rows;
  const pedidos = new Map((d.recibidos ?? []).map((r) => [r.renglon_id, r.cantidad.replaceAll(",", "")]));
  const ajenos = [...pedidos.keys()].filter((k) => !renglones.some((r) => r.id === k));
  if (ajenos.length) throw invalido("Hay renglones que no son de este traspaso.");
  const x = await contexto(c, u.id);
  const m = await nuevoMovimiento(x, "TRASPASO_RECEPCION", dest.id, { documento_tipo: "TRASPASO", documento_id: id, comentario: d.comentario });
  let faltante = false;
  for (const r of renglones) {
    const enviada = new D(r.cantidad_enviada);
    let recibida: Dec;
    try { recibida = pedidos.has(r.id) ? new D(pedidos.get(r.id)!) : enviada; } catch { throw invalido("Cantidad recibida no válida."); }
    if (recibida.lt(0) || recibida.gt(enviada)) throw invalido("Lo recibido no puede ser negativo ni mayor que lo enviado.");
    const art = await articuloPorId(c, r.articulo_id);
    if (art.unidad === "PZA" && !recibida.isInteger()) throw invalido(`${art.clave}: las piezas van en números enteros.`);
    const importeEnviado = new D(r.importe_enviado);
    const importe = recibida.eq(enviada) ? importeEnviado : recibida.mul(importeEnviado).div(enviada).toDecimalPlaces(6, D.ROUND_HALF_UP);
    if (recibida.gt(0)) await entrar(x, m.id, dest.id, art, recibida, { importe, loteId: r.lote_id });
    if (!recibida.eq(enviada)) faltante = true;
    await c.query("UPDATE traspaso_renglon SET cantidad_recibida = $2, importe_faltante = $3 WHERE id = $1", [r.id, recibida.toFixed(), importeEnviado.minus(importe).toFixed()]);
  }
  if (faltante && !d.comentario?.trim()) throw invalido("Hay diferencias entre lo enviado y lo recibido: escribe un comentario que lo explique.");
  await c.query("UPDATE traspaso SET estatus = 'RECIBIDO', recepcion_id = $2, recibido_por = $3, recibido_en = now(), comentario_recepcion = $4 WHERE id = $1", [id, m.id, u.id, d.comentario ?? null]);
  return { folio: t.folio, recepcion: m.folio, faltante };
}

/** Cancelar un traspaso en tránsito: la mercancía regresa al origen con el mismo costo. */
export async function cancelarTraspaso(c: Cliente, u: UsuarioActual, id: string, motivo: string) {
  const t = await traspasoBloqueado(c, id);
  if (t.estatus !== "ENVIADO") throw new ErrorApp(409, "estatus", "Solo se cancela un traspaso en tránsito (aún no recibido).");
  const o = (await c.query("SELECT a.id, a.clave, a.sucursal_id FROM almacen a WHERE a.id = $1", [t.almacen_origen_id])).rows[0];
  exigirAlmacen(u, o);
  const mov = await cancelarMovimientoInterno(c, u, t.envio_id, motivo, true);
  await c.query("UPDATE traspaso SET estatus = 'CANCELADO', cancelacion_id = $2 WHERE id = $1", [id, mov.id]);
  return { folio: t.folio, cancelacion: mov.folio };
}

// ---- Mermas -----------------------------------------------------------------
/** Permiso y límite según el almacén: producto terminado → merma de sucursal; lo demás → merma de producción. */
function reglaMerma(alm: { tipo: string }) {
  return alm.tipo === "PT"
    ? { crear: "inventarios.merma_sucursal:crear", autorizar: "inventarios.merma_sucursal:autorizar", operacion: "inventarios.merma_sucursal", aplica: "PT" }
    : { crear: "produccion.mermas:crear", autorizar: "produccion.mermas:autorizar", operacion: "produccion.merma", aplica: "MP" };
}

export async function registrarMerma(c: Cliente, u: UsuarioActual, d: { almacen: string; causa: string; comentario?: string | null; renglones: RenglonCaptura[] }) {
  const alm = await almacenPorClave(c, d.almacen);
  exigirAlmacen(u, alm);
  const regla = reglaMerma(alm);
  if (!u.permisos.has(regla.crear)) throw prohibido(alm.tipo === "PT" ? "No tienes permiso para registrar mermas de sucursal." : "No tienes permiso para registrar mermas de producción o materia prima.");
  const causa = (await c.query("SELECT id, aplica FROM causa_merma WHERE clave = upper($1) AND activo", [d.causa])).rows[0];
  if (!causa) throw invalido(`No existe la causa de merma ${d.causa}.`);
  if (causa.aplica !== "TODOS" && causa.aplica !== regla.aplica) throw invalido(`La causa ${d.causa.toUpperCase()} no aplica a este almacén.`);
  const rs = await prepararRenglones(c, d.renglones, ["INSUMO", "EMPAQUE", "INTERMEDIO", "SKU"]);
  // Se revisa que haya existencia ahora; al autorizar se vuelve a revisar.
  for (const r of rs) {
    const ex = (await c.query("SELECT cantidad::text FROM existencia WHERE almacen_id = $1 AND articulo_id = $2", [alm.id, r.art.id])).rows[0];
    if (!ex || new D(ex.cantidad).lt(r.cantidad)) throw new ErrorApp(409, "existencia", `${r.art.clave}: no hay suficiente existencia (${ex?.cantidad ?? 0}).`);
  }
  const m = (await c.query("INSERT INTO merma (almacen_id, causa_id, comentario, registrado_por) VALUES ($1, $2, $3, $4) RETURNING id, folio", [alm.id, causa.id, d.comentario ?? null, u.id])).rows[0];
  for (const r of rs) {
    await c.query("INSERT INTO merma_renglon (merma_id, articulo_id, lote_id, cantidad) VALUES ($1, $2, $3, $4)", [m.id, r.art.id, await loteSalida(c, r), r.cantidad.toFixed()]);
  }
  return m;
}

async function mermaBloqueada(c: Cliente, id: string) {
  const m = (await c.query("SELECT m.*, a.tipo AS almacen_tipo, a.sucursal_id, a.clave AS almacen FROM merma m JOIN almacen a ON a.id = m.almacen_id WHERE m.id = $1 FOR UPDATE OF m", [id])).rows[0];
  if (!m) throw noEncontrado("No existe esa merma.");
  return m;
}

export async function autorizarMerma(c: Cliente, u: UsuarioActual, id: string) {
  const m = await mermaBloqueada(c, id);
  if (m.estatus !== "POR_AUTORIZAR") throw new ErrorApp(409, "estatus", "La merma ya no está pendiente.");
  const regla = reglaMerma({ tipo: m.almacen_tipo });
  if (!u.permisos.has(regla.autorizar)) throw prohibido("No tienes permiso para autorizar esta merma.");
  exigirAlmacen(u, { id: m.almacen_id, sucursal_id: m.sucursal_id, clave: m.almacen } as Almacen);
  if (m.registrado_por === u.id) throw prohibido("Quien registra una merma no puede autorizarla (segregación de funciones).");
  const x = await contexto(c, u.id);
  const mov = await nuevoMovimiento(x, "MERMA", m.almacen_id, { documento_tipo: "MERMA", documento_id: id, comentario: m.comentario });
  let total = new D(0);
  for (const r of (await c.query("SELECT articulo_id, lote_id, cantidad::text FROM merma_renglon WHERE merma_id = $1 ORDER BY creado_en, id", [id])).rows) {
    for (const p of await sacar(x, mov.id, m.almacen_id, await articuloPorId(c, r.articulo_id), new D(r.cantidad), { loteId: r.lote_id, causaId: m.causa_id })) total = total.plus(p.importe);
  }
  const lim = await dentroDeLimite(c, u.id, regla.operacion, total);
  if (!lim.ok) throw prohibido(`La merma vale $${total.toFixed(2)} y tu límite de autorización es $${lim.limite}. Debe autorizarla alguien con un límite mayor.`);
  await c.query("UPDATE merma SET estatus = 'APLICADA', movimiento_id = $2, importe = $3, resuelto_por = $4, resuelto_en = now() WHERE id = $1", [id, mov.id, total.toFixed(), u.id]);
  return { folio: m.folio, movimiento: mov.folio, importe: num(total, 2) };
}

export async function rechazarMerma(c: Cliente, u: UsuarioActual, id: string, motivo: string) {
  const m = await mermaBloqueada(c, id);
  if (m.estatus !== "POR_AUTORIZAR") throw new ErrorApp(409, "estatus", "La merma ya no está pendiente.");
  const regla = reglaMerma({ tipo: m.almacen_tipo });
  const propia = m.registrado_por === u.id;
  // Quien la registró puede retirarla (CANCELADA); quien autoriza la rechaza (RECHAZADA).
  if (!propia && !u.permisos.has(regla.autorizar)) throw prohibido("No tienes permiso para rechazar esta merma.");
  await c.query("UPDATE merma SET estatus = $2, motivo_rechazo = $3, resuelto_por = $4, resuelto_en = now() WHERE id = $1", [id, propia ? "CANCELADA" : "RECHAZADA", motivo, u.id]);
  return { folio: m.folio, estatus: propia ? "CANCELADA" : "RECHAZADA" };
}

// ---- Conteos físicos ----------------------------------------------------------
export async function crearConteo(c: Cliente, u: UsuarioActual, d: { almacen: string; articulos?: string[]; comentario?: string | null }) {
  const alm = await almacenPorClave(c, d.almacen);
  exigirAlmacen(u, alm);
  const abierto = (await c.query("SELECT folio FROM conteo WHERE almacen_id = $1 AND estatus IN ('CAPTURA', 'POR_AUTORIZAR')", [alm.id])).rows[0];
  if (abierto) throw new ErrorApp(409, "regla", `Ya hay un conteo abierto en ${alm.clave} (${abierto.folio}). Termínalo o cancélalo antes de empezar otro.`);
  const filtro = d.articulos?.length ? [...(await articulosPorClave(c, d.articulos)).values()].map((a) => a.id) : null;
  const k = (await c.query("INSERT INTO conteo (almacen_id, comentario, creado_por_id) VALUES ($1, $2, $3) RETURNING id, folio", [alm.id, d.comentario ?? null, u.id])).rows[0];
  // Renglones sugeridos: lo que tiene existencia (por lote si aplica) y lo pedido aunque esté en cero.
  await c.query(
    `INSERT INTO conteo_renglon (conteo_id, articulo_id, lote_id)
     SELECT $1, a.id, el.lote_id
       FROM articulo a
       LEFT JOIN existencia e ON e.articulo_id = a.id AND e.almacen_id = $2
       LEFT JOIN existencia_lote el ON el.articulo_id = a.id AND el.almacen_id = $2 AND el.cantidad > 0 AND a.maneja_lote
      WHERE (($3::uuid[] IS NULL AND e.cantidad > 0) OR a.id = ANY($3::uuid[]))
        AND (NOT a.maneja_lote OR el.lote_id IS NOT NULL OR $3::uuid[] IS NOT NULL)
     ON CONFLICT DO NOTHING`,
    [k.id, alm.id, filtro],
  );
  return k;
}

async function conteoBloqueado(c: Cliente, id: string) {
  const k = (await c.query("SELECT k.*, a.clave AS almacen, a.sucursal_id FROM conteo k JOIN almacen a ON a.id = k.almacen_id WHERE k.id = $1 FOR UPDATE OF k", [id])).rows[0];
  if (!k) throw noEncontrado("No existe ese conteo.");
  return k;
}

/** Captura del físico (sin ver el teórico). Se pueden agregar artículos o lotes encontrados. */
export async function capturarConteo(c: Cliente, u: UsuarioActual, id: string, renglones: { articulo: string; lote?: string | null; fisico: string | null }[]) {
  const k = await conteoBloqueado(c, id);
  exigirAlmacen(u, { id: k.almacen_id, sucursal_id: k.sucursal_id, clave: k.almacen } as Almacen);
  if (k.estatus !== "CAPTURA") throw new ErrorApp(409, "estatus", "El conteo ya se envió.");
  const arts = await articulosPorClave(c, renglones.map((r) => r.articulo));
  for (const r of renglones) {
    const art = arts.get(r.articulo.toUpperCase())!;
    let fisico: string | null = null;
    if (r.fisico !== null && r.fisico !== "") {
      let f: Dec;
      try { f = new D(r.fisico.replaceAll(",", "")); } catch { throw invalido(`${art.clave}: cantidad no válida.`); }
      if (f.lt(0)) throw invalido(`${art.clave}: la cantidad no puede ser negativa.`);
      if (art.unidad === "PZA" && !f.isInteger()) throw invalido(`${art.clave}: las piezas van en números enteros.`);
      fisico = f.toFixed();
    }
    let loteId: string | null = null;
    if (art.maneja_lote) {
      if (!r.lote) throw invalido(`${art.clave} maneja lote: indica el lote contado.`);
      loteId = (await c.query("SELECT id FROM lote WHERE articulo_id = $1 AND codigo = $2", [art.id, r.lote])).rows[0]?.id ?? null;
      if (!loteId) throw invalido(`${art.clave}: no existe el lote ${r.lote}. Un lote nuevo entra por compra o por inventario inicial.`);
    } else if (r.lote) throw invalido(`${art.clave}: el artículo no maneja lote.`);
    await c.query(
      `INSERT INTO conteo_renglon (conteo_id, articulo_id, lote_id, fisico, capturado_por) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (conteo_id, articulo_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET fisico = EXCLUDED.fisico, capturado_por = EXCLUDED.capturado_por`,
      [id, art.id, loteId, fisico, u.id],
    );
  }
}

/** Envía a autorización: congela el teórico de ese momento y calcula diferencias valuadas. */
export async function enviarConteo(c: Cliente, u: UsuarioActual, id: string) {
  const k = await conteoBloqueado(c, id);
  exigirAlmacen(u, { id: k.almacen_id, sucursal_id: k.sucursal_id, clave: k.almacen } as Almacen);
  if (k.estatus !== "CAPTURA") throw new ErrorApp(409, "estatus", "El conteo ya se envió.");
  const rs = (await c.query(
    `SELECT r.id, r.articulo_id, r.lote_id, r.fisico::text, a.clave, a.costo_referencia::text,
            CASE WHEN r.lote_id IS NULL THEN coalesce(e.cantidad, 0) ELSE coalesce(el.cantidad, 0) END::text AS teorico,
            e.cantidad::text AS ex_cantidad, e.valor::text AS ex_valor, e.ultimo_costo::text
       FROM conteo_renglon r JOIN articulo a ON a.id = r.articulo_id
       LEFT JOIN existencia e ON e.almacen_id = $2 AND e.articulo_id = r.articulo_id
       LEFT JOIN existencia_lote el ON el.almacen_id = $2 AND el.lote_id = r.lote_id
      WHERE r.conteo_id = $1`,
    [id, k.almacen_id],
  )).rows;
  if (!rs.length) throw invalido("El conteo no tiene renglones.");
  const vacios = rs.filter((r) => r.fisico === null);
  if (vacios.length) throw invalido(`Falta capturar: ${vacios.map((r) => r.clave).join(", ")}. Si no hay nada, escribe 0.`);
  let total = new D(0);
  for (const r of rs) {
    const dif = diferenciaConteo(new D(r.fisico), new D(r.teorico));
    // Costo estimado: promedio actual; si no hay existencia, último costo o costo de referencia.
    const costo = r.ex_cantidad && new D(r.ex_cantidad).gt(0) ? new D(r.ex_valor).div(r.ex_cantidad).toDecimalPlaces(6) : new D(r.ultimo_costo ?? r.costo_referencia ?? 0);
    const importe = dif.mul(costo).toDecimalPlaces(6, D.ROUND_HALF_UP);
    total = total.plus(importe.abs());
    await c.query("UPDATE conteo_renglon SET teorico = $2, diferencia = $3, costo_unitario = $4, importe = $5 WHERE id = $1", [r.id, r.teorico, dif.toFixed(), costo.toFixed(), importe.toFixed()]);
  }
  const sinDiferencias = rs.every((r) => new D(r.fisico).eq(r.teorico));
  await c.query("UPDATE conteo SET estatus = $2, enviado_por = $3, enviado_en = now(), importe_diferencia = $4, resuelto_en = CASE WHEN $2 = 'APLICADO' THEN now() END WHERE id = $1",
    [id, sinDiferencias ? "APLICADO" : "POR_AUTORIZAR", u.id, total.toFixed()]);
  return { folio: k.folio, estatus: sinDiferencias ? "APLICADO" : "POR_AUTORIZAR", importe_diferencia: num(total, 2) };
}

export async function autorizarConteo(c: Cliente, u: UsuarioActual, id: string) {
  const k = await conteoBloqueado(c, id);
  if (k.estatus !== "POR_AUTORIZAR") throw new ErrorApp(409, "estatus", "El conteo no está pendiente de autorización.");
  exigirAlmacen(u, { id: k.almacen_id, sucursal_id: k.sucursal_id, clave: k.almacen } as Almacen);
  const participantes = (await c.query("SELECT DISTINCT capturado_por FROM conteo_renglon WHERE conteo_id = $1 AND capturado_por IS NOT NULL", [id])).rows.map((r) => r.capturado_por);
  if ([k.creado_por_id, k.enviado_por, ...participantes].includes(u.id)) throw prohibido("Quien hizo o capturó el conteo no puede autorizar su ajuste (segregación de funciones).");
  const lim = await dentroDeLimite(c, u.id, "inventarios.ajuste", new D(k.importe_diferencia ?? 0));
  if (!lim.ok) throw prohibido(`El ajuste vale $${new D(k.importe_diferencia).toFixed(2)} (suma de diferencias) y tu límite es $${lim.limite}. Debe autorizarlo alguien con un límite mayor.`);
  const x = await contexto(c, u.id);
  const rs = (await c.query("SELECT articulo_id, lote_id, diferencia::text, costo_unitario::text FROM conteo_renglon WHERE conteo_id = $1 AND diferencia <> 0 ORDER BY id", [id])).rows;
  let ent: { id: string; folio: string } | null = null;
  let sal: { id: string; folio: string } | null = null;
  for (const r of rs) {
    const art = await articuloPorId(c, r.articulo_id);
    const dif = new D(r.diferencia);
    if (dif.gt(0)) {
      ent ??= await nuevoMovimiento(x, "AJUSTE_ENTRADA", k.almacen_id, { documento_tipo: "CONTEO", documento_id: id });
      await entrar(x, ent.id, k.almacen_id, art, dif, { costo: new D(r.costo_unitario), loteId: r.lote_id });
    } else {
      sal ??= await nuevoMovimiento(x, "AJUSTE_SALIDA", k.almacen_id, { documento_tipo: "CONTEO", documento_id: id });
      await sacar(x, sal.id, k.almacen_id, art, dif.neg(), { loteId: r.lote_id });
    }
  }
  await c.query("UPDATE conteo SET estatus = 'APLICADO', entrada_id = $2, salida_id = $3, resuelto_por = $4, resuelto_en = now() WHERE id = $1", [id, ent?.id ?? null, sal?.id ?? null, u.id]);
  return { folio: k.folio, entrada: ent?.folio ?? null, salida: sal?.folio ?? null };
}

export async function rechazarConteo(c: Cliente, u: UsuarioActual, id: string, motivo: string, cancelar: boolean) {
  const k = await conteoBloqueado(c, id);
  exigirAlmacen(u, { id: k.almacen_id, sucursal_id: k.sucursal_id, clave: k.almacen } as Almacen);
  if (cancelar ? !["CAPTURA", "POR_AUTORIZAR"].includes(k.estatus) : k.estatus !== "POR_AUTORIZAR") throw new ErrorApp(409, "estatus", "El conteo no se puede cerrar en su estado actual.");
  await c.query("UPDATE conteo SET estatus = $2, motivo_rechazo = $3, resuelto_por = $4, resuelto_en = now() WHERE id = $1", [id, cancelar ? "CANCELADO" : "RECHAZADO", motivo, u.id]);
}

// ---- Cancelación de movimientos -------------------------------------------------
/** Permiso para cancelar cada tipo de movimiento. */
export const PERMISO_CANCELAR: Record<string, string> = {
  INICIAL: "inventarios.ajustes:cancelar",
  ENTRADA_COMPRA: "compras.recepcion:cancelar",
  ENTRADA_PRODUCCION: "produccion.ordenes:cancelar",
  SURTIDO_SALIDA: "inventarios.surtido:cancelar",
  SURTIDO_ENTRADA: "inventarios.surtido:cancelar",
  MERMA: "inventarios.ajustes:cancelar",
  AJUSTE_ENTRADA: "inventarios.ajustes:cancelar",
  AJUSTE_SALIDA: "inventarios.ajustes:cancelar",
};

/**
 * Movimiento inverso: lo que entró sale (en PEPS, de su propia capa, solo si no se ha usado;
 * en promedio, al costo promedio actual) y lo que salió regresa con su mismo importe.
 */
async function cancelarMovimientoInterno(c: Cliente, u: UsuarioActual, movId: string, motivo: string, desdeTraspaso = false) {
  const m = (await c.query("SELECT * FROM movimiento WHERE id = $1 FOR UPDATE", [movId])).rows[0];
  if (!m) throw noEncontrado("No existe ese movimiento.");
  if (m.cancelado_por_id) throw new ErrorApp(409, "estatus", `El movimiento ${m.folio} ya está cancelado.`);
  if (m.tipo === "CANCELACION") throw new ErrorApp(409, "regla", "Una cancelación no se cancela.");
  if (!desdeTraspaso && (m.tipo === "TRASPASO_ENVIO" || m.tipo === "TRASPASO_RECEPCION")) throw new ErrorApp(409, "regla", "Los traspasos se cancelan desde el traspaso (solo mientras están en tránsito).");
  const x = await contexto(c, u.id);
  const inv = await nuevoMovimiento(x, "CANCELACION", m.almacen_id, { cancela_id: m.id, comentario: motivo, documento_tipo: m.documento_tipo, documento_id: m.documento_id });
  const rs = (await c.query("SELECT id, articulo_id, lote_id, cantidad::text, importe::text, causa_id FROM movimiento_renglon WHERE movimiento_id = $1 ORDER BY consecutivo DESC", [m.id])).rows;
  for (const r of rs) {
    const art = await articuloPorId(c, r.articulo_id);
    const q = new D(r.cantidad);
    if (q.gt(0)) {
      try {
        await sacar(x, inv.id, m.almacen_id, art, q, { loteId: r.lote_id, capaDe: m.metodo === "PEPS" && x.metodo === "PEPS" ? r.id : undefined });
      } catch (e) {
        if (e instanceof ErrorApp && e.codigo === "existencia") throw new ErrorApp(409, "regla", `${e.message} Lo que entró en ${m.folio} ya se usó (total o parcialmente): no se puede cancelar. Registra un ajuste por conteo.`);
        throw e;
      }
    }
    else await entrar(x, inv.id, m.almacen_id, art, q.neg(), { importe: new D(r.importe).neg(), loteId: r.lote_id, causaId: r.causa_id });
  }
  await c.query("UPDATE movimiento SET cancelado_por_id = $2 WHERE id = $1", [m.id, inv.id]);
  return inv as { id: string; folio: string };
}

export async function cancelarMovimiento(c: Cliente, u: UsuarioActual, movId: string, motivo: string) {
  const m = (await c.query("SELECT m.id, m.tipo, m.documento_tipo, m.documento_id, a.id AS almacen_id, a.clave AS almacen, a.sucursal_id FROM movimiento m JOIN almacen a ON a.id = m.almacen_id WHERE m.id = $1", [movId])).rows[0];
  if (!m) throw noEncontrado("No existe ese movimiento.");
  const permiso = PERMISO_CANCELAR[m.tipo];
  if (!permiso) throw new ErrorApp(409, "regla", m.tipo === "CANCELACION" ? "Una cancelación no se cancela." : "Los traspasos se cancelan desde el traspaso (solo mientras están en tránsito).");
  if (!u.permisos.has(permiso)) throw prohibido("No tienes permiso para cancelar este movimiento.");
  exigirAlmacen(u, { id: m.almacen_id, sucursal_id: m.sucursal_id, clave: m.almacen } as Almacen);
  const hechos: string[] = [];
  if (m.tipo === "SURTIDO_SALIDA" || m.tipo === "SURTIDO_ENTRADA") {
    // Un vale se cancela completo: primero regresa lo que entró a producción y luego lo que salió de MP.
    const s = (await c.query("SELECT salida_id, entrada_id FROM surtido WHERE salida_id = $1 OR entrada_id = $1", [movId])).rows[0];
    hechos.push((await cancelarMovimientoInterno(c, u, s.entrada_id, motivo)).folio, (await cancelarMovimientoInterno(c, u, s.salida_id, motivo)).folio);
  } else if (m.documento_tipo === "CONTEO") {
    const k = (await c.query("SELECT entrada_id, salida_id FROM conteo WHERE id = $1", [m.documento_id])).rows[0];
    for (const id of [k.entrada_id, k.salida_id].filter(Boolean)) {
      const ya = (await c.query("SELECT cancelado_por_id FROM movimiento WHERE id = $1", [id])).rows[0];
      if (!ya.cancelado_por_id) hechos.push((await cancelarMovimientoInterno(c, u, id, motivo)).folio);
    }
  } else {
    hechos.push((await cancelarMovimientoInterno(c, u, movId, motivo)).folio);
  }
  if (m.tipo === "MERMA") await c.query("UPDATE merma SET estatus = 'CANCELADA', motivo_rechazo = $2 WHERE id = $1", [m.documento_id, motivo]);
  return { cancelaciones: hechos };
}

// ---- Inventario inicial (layout) ------------------------------------------------
/** Aplica las filas cargadas por layout como un movimiento INICIAL por almacén. */
export async function aplicarInventarioInicial(c: Cliente, ids: string[]) {
  if (!ids.length) return;
  const usuarioId = (await c.query("SELECT usuario_actual() AS u")).rows[0].u;
  const x = await contexto(c, usuarioId);
  const filas = (await c.query(
    "SELECT id, almacen_id, articulo_id, lote, caducidad::text, cantidad::text, costo_unitario::text FROM inventario_inicial WHERE id = ANY($1) AND movimiento_id IS NULL ORDER BY almacen_id, creado_en, id",
    [ids],
  )).rows;
  const movs = new Map<string, string>();
  for (const f of filas) {
    if (!movs.has(f.almacen_id)) movs.set(f.almacen_id, (await nuevoMovimiento(x, "INICIAL", f.almacen_id, { documento_tipo: "CARGA", comentario: "Inventario inicial por carga de layout" })).id);
    const art = await articuloPorId(c, f.articulo_id);
    const loteId = await loteEntrada(c, { art, cantidad: new D(f.cantidad), loteCodigo: f.lote, caducidad: f.caducidad, costo: null });
    await entrar(x, movs.get(f.almacen_id)!, f.almacen_id, art, new D(f.cantidad), { costo: new D(f.costo_unitario), loteId });
    await c.query("UPDATE inventario_inicial SET movimiento_id = $2 WHERE id = $1", [f.id, movs.get(f.almacen_id)]);
  }
}

// ---- Existencias para el plan de producción ---------------------------------------
/** Existencia (MP, insumos y PEP) y en tránsito por artículo para un plan. */
export async function existenciasParaPlan(c: Cliente, planId: string) {
  const p = (await c.query("SELECT sucursal_id FROM plan_produccion WHERE id = $1", [planId])).rows[0];
  if (!p) throw noEncontrado("No existe ese plan.");
  const { rows } = await c.query(
    `WITH alm AS (SELECT id FROM almacen WHERE tipo IN ('MP', 'INS', 'PEP') AND activo AND ($1::uuid IS NULL OR sucursal_id = $1))
     SELECT a.clave AS articulo,
            coalesce((SELECT sum(e.cantidad) FROM existencia e WHERE e.articulo_id = a.id AND e.almacen_id IN (SELECT id FROM alm)), 0)::text AS existencia,
            coalesce((SELECT sum(tr.cantidad_enviada) FROM traspaso_renglon tr JOIN traspaso t ON t.id = tr.traspaso_id
                       WHERE t.estatus = 'ENVIADO' AND tr.articulo_id = a.id AND t.almacen_destino_id IN (SELECT id FROM alm)), 0)::text AS en_transito
       FROM articulo a WHERE a.tipo <> 'SKU' AND a.activo`,
    [p.sucursal_id],
  );
  return rows.filter((r) => Number(r.existencia) !== 0 || Number(r.en_transito) !== 0);
}
