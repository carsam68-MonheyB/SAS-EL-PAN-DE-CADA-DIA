// Punto de venta: turnos de caja, ventas, cobro, devoluciones, retiros,
// cortes X/Z con arqueo y pedidos con anticipo. Quien opera es el cajero
// actual de la sesión de caja; lo que requiere supervisor se autoriza en la
// misma caja con usuario y PIN de alguien con permiso, distinto del cajero.
import { dentroDeAlcanceSucursal, tieneAlguno } from "../dominio/permisos";
import { arqueo, cobrar, desglosar, descuentoOferta, efectivoEsperado, importeDevolucion, importeRenglon, ofertaAplicable, type Oferta, type Tasa } from "../dominio/pos";
import { D, type Dec } from "../dominio/recetas";
import { configEntero } from "./configuracion";
import { verificar } from "./contrasena";
import { ErrorApp, invalido, noEncontrado, prohibido } from "./errores";
import { hoyNegocio } from "./fechas";
import { entradaPorDevolucion, salidaPorVenta } from "./inventarios";
import type { Sesion } from "./sesiones";
import type { Cliente } from "./transaccion";
import { cargarUsuario, registrarAcceso, type UsuarioActual } from "./usuarios";

const m2 = (x: Dec | string | number) => new D(x).toFixed(2);
const dec = (v: string, nombre: string) => {
  let d: Dec;
  try { d = new D(v.replaceAll(",", "")); } catch { throw invalido(`${nombre}: número no válido.`); }
  if (!d.isFinite()) throw invalido(`${nombre}: número no válido.`);
  return d;
};

// ---------------------------------------------------------------------------
// Caja, cajero y turno
// ---------------------------------------------------------------------------
export interface Caja { id: string; clave: string; nombre: string; sucursal_id: string; sucursal: string; sucursal_nombre: string; almacen_id: string; almacen: string; fondo_sugerido: string | null }

export interface ContextoCaja { caja: Caja; cajero: UsuarioActual; turno: { id: string; folio: string; fondo: string; abierto_en: string; fecha_negocio: string } | null }

export async function contextoCaja(c: Cliente, sesion: Sesion, bloquearTurno = false): Promise<ContextoCaja> {
  if (sesion.tipo !== "pos" || !sesion.caja_id) throw new ErrorApp(409, "sin_caja", "Esta sesión no es de una caja. Elige la caja primero.");
  const caja = (await c.query(
    `SELECT c.id, c.clave, c.nombre, c.sucursal_id, s.clave AS sucursal, s.nombre AS sucursal_nombre, c.fondo_sugerido::text,
            coalesce(c.almacen_id, (SELECT a.id FROM almacen a WHERE a.sucursal_id = c.sucursal_id AND a.tipo = 'PT' AND a.activo
                                     AND (SELECT count(*) FROM almacen b WHERE b.sucursal_id = c.sucursal_id AND b.tipo = 'PT' AND b.activo) = 1)) AS almacen_id
       FROM caja c JOIN sucursal s ON s.id = c.sucursal_id WHERE c.id = $1 AND c.activo`,
    [sesion.caja_id],
  )).rows[0];
  if (!caja) throw invalido("La caja no existe o está inactiva.");
  if (!caja.almacen_id) throw invalido("La caja no tiene almacén de producto terminado: asígnalo en el catálogo de cajas (la sucursal tiene varios o ninguno).");
  caja.almacen = (await c.query("SELECT clave FROM almacen WHERE id = $1", [caja.almacen_id])).rows[0].clave;
  const cajero = await cargarUsuario(c, sesion.cajero_actual_id ?? sesion.usuario_id);
  if (!cajero || cajero.estatus !== "activo") throw prohibido("El cajero actual no está activo.");
  const turno = (await c.query(
    `SELECT id, folio, fondo::text, abierto_en, fecha_negocio::text FROM turno_caja WHERE caja_id = $1 AND estatus = 'ABIERTO' ${bloquearTurno ? "FOR UPDATE" : ""}`,
    [caja.id],
  )).rows[0] ?? null;
  return { caja, cajero, turno };
}

/** Pedidos tomados en oficina (teléfono o WhatsApp): sin caja ni turno, para la sucursal que entrega. */
export async function contextoOficina(c: Cliente, usuario: UsuarioActual, sucursal: string): Promise<ContextoCaja> {
  const s = (await c.query("SELECT id, clave, nombre FROM sucursal WHERE clave = upper($1) AND activo", [sucursal])).rows[0];
  if (!s) throw invalido(`No existe la sucursal ${sucursal}.`);
  if (!dentroDeAlcanceSucursal(usuario.alcance, s.id)) throw prohibido("Esa sucursal no está dentro de tus sucursales asignadas.");
  // Sin caja: no hay almacén (la existencia se ve en la sucursal al entregar).
  const caja = { id: "", clave: "OFICINA", nombre: "Oficina", sucursal_id: s.id, sucursal: s.clave, sucursal_nombre: s.nombre, almacen_id: null as unknown as string, almacen: "", fondo_sugerido: null };
  return { caja, cajero: usuario, turno: null };
}

function exigirCajero(k: ContextoCaja, permiso: string | string[]) {
  if (!tieneAlguno(k.cajero.permisos, permiso)) throw prohibido(`${k.cajero.nombre} no tiene permiso para esta operación en caja.`);
  if (!dentroDeAlcanceSucursal(k.cajero.alcance, k.caja.sucursal_id)) throw prohibido(`${k.cajero.nombre} no está asignado a esta sucursal.`);
}

function exigirTurno(k: ContextoCaja) {
  if (!k.turno) throw new ErrorApp(409, "sin_turno", "La caja no tiene turno abierto: ábrelo con el fondo inicial.");
  return k.turno;
}

/**
 * Autorización en caja con usuario y PIN de un supervisor. Se verifica en su
 * propia transacción para que los intentos fallidos queden registrados aunque
 * la operación no siga.
 */
export interface Autorizacion { usuario: string; pin: string }
export async function verificarSupervisor(c: Cliente, a: Autorizacion, d: { permiso: string; cajeroId: string; sucursalId: string; ip: string | null; agente: string | null; operacion: string }): Promise<{ id: string; nombre: string } | { error: string }> {
  const u = (await c.query("SELECT id, estatus, pin_hash, pin_bloqueado_hasta FROM usuario WHERE usuario = lower($1)", [a.usuario])).rows[0];
  const base = { usuarioIntentado: a.usuario, ip: d.ip, agente: d.agente, evento: "autorizacion_caja" };
  if (!u || u.estatus !== "activo" || !u.pin_hash || (u.pin_bloqueado_hasta && new Date(u.pin_bloqueado_hasta) > new Date())) {
    await registrarAcceso(c, { ...base, usuarioId: u?.id, exito: false, detalle: `${d.operacion}: usuario no disponible, sin PIN o bloqueado` });
    return { error: "No se pudo autorizar: usuario no disponible o PIN bloqueado." };
  }
  if (!(await verificar(a.pin, u.pin_hash))) {
    const maximos = await configEntero(c, "seguridad.pin_intentos_maximos");
    const minutos = await configEntero(c, "seguridad.minutos_bloqueo");
    const r = await c.query("UPDATE usuario SET intentos_pin = intentos_pin + 1 WHERE id = $1 RETURNING intentos_pin", [u.id]);
    if (r.rows[0].intentos_pin >= maximos) await c.query("UPDATE usuario SET intentos_pin = 0, pin_bloqueado_hasta = now() + make_interval(mins => $2) WHERE id = $1", [u.id, minutos]);
    await registrarAcceso(c, { ...base, usuarioId: u.id, exito: false, detalle: `${d.operacion}: PIN incorrecto` });
    return { error: "PIN incorrecto." };
  }
  await c.query("UPDATE usuario SET intentos_pin = 0 WHERE id = $1", [u.id]);
  const sup = (await cargarUsuario(c, u.id))!;
  const rechazo = sup.id === d.cajeroId ? "El cajero no puede autorizar sus propias operaciones (segregación de funciones): debe autorizar otra persona."
    : !sup.permisos.has(d.permiso) ? `${sup.nombre} no tiene permiso para autorizar esto.`
    : !dentroDeAlcanceSucursal(sup.alcance, d.sucursalId) ? `${sup.nombre} no está asignado a esta sucursal.` : null;
  if (rechazo) {
    await registrarAcceso(c, { ...base, usuarioId: u.id, exito: false, detalle: `${d.operacion}: ${rechazo}` });
    return { error: rechazo };
  }
  await registrarAcceso(c, { ...base, usuarioId: u.id, exito: true, detalle: d.operacion });
  return { id: sup.id, nombre: sup.nombre };
}

/** Límite por monto del autorizador (limite_autorizacion). */
async function dentroDeLimite(c: Cliente, usuarioId: string, operacion: string, monto: Dec) {
  const todas = (await c.query("SELECT count(*)::int AS n FROM limite_autorizacion WHERE operacion = $1", [operacion])).rows[0].n;
  if (!todas) return;
  const { rows } = await c.query(
    "SELECT l.monto_hasta::text FROM limite_autorizacion l JOIN usuario_rol ur ON ur.rol_id = l.rol_id JOIN rol r ON r.id = l.rol_id AND r.activo WHERE ur.usuario_id = $1 AND l.operacion = $2",
    [usuarioId, operacion],
  );
  if (rows.some((r) => r.monto_hasta === null)) return;
  const max = rows.reduce((m, r) => D.max(m, new D(r.monto_hasta)), new D(0));
  if (!rows.length || monto.gt(max)) throw prohibido(`Son $${m2(monto)} y el límite de quien autoriza es $${m2(max)}. Debe autorizar alguien con un límite mayor.`);
}

export async function abrirTurno(c: Cliente, k: ContextoCaja, fondo: string) {
  exigirCajero(k, ["pos.caja:crear", "pos.caja:autorizar"]);
  if (k.turno) throw new ErrorApp(409, "turno", `La caja ya tiene el turno ${k.turno.folio} abierto.`);
  const f = dec(fondo, "Fondo");
  if (f.lt(0) || f.decimalPlaces() > 2) throw invalido("Fondo no válido.");
  return (await c.query(
    "INSERT INTO turno_caja (caja_id, fecha_negocio, fondo, abierto_por) VALUES ($1, $2, $3, $4) RETURNING id, folio",
    [k.caja.id, await hoyNegocio(c), m2(f), k.cajero.id],
  )).rows[0];
}

// ---------------------------------------------------------------------------
// Productos y precios
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Ofertas de fin del día (P37)
// ---------------------------------------------------------------------------
export async function leerOfertas(c: Cliente): Promise<Oferta[]> {
  return (await c.query("SELECT id, articulo_id, familia_id, sucursal_id, descuento_pct::text, to_char(hora_desde, 'HH24:MI') AS hora FROM oferta WHERE activo")).rows
    .map((o) => ({ id: o.id, articuloId: o.articulo_id, familiaId: o.familia_id, sucursalId: o.sucursal_id, pct: new D(o.descuento_pct), horaDesde: o.hora }));
}

export async function listarOfertas(c: Cliente) {
  return (await c.query(
    `SELECT o.id, a.clave AS articulo, a.nombre AS articulo_nombre, f.clave AS familia, f.nombre AS familia_nombre, s.clave AS sucursal,
            o.descuento_pct::text, to_char(o.hora_desde, 'HH24:MI') AS hora_desde, o.activo, o.actualizado_en, o.creado_en,
            (SELECT u.usuario FROM usuario u WHERE u.id = coalesce(o.actualizado_por, o.creado_por)) AS capturo
       FROM oferta o LEFT JOIN articulo a ON a.id = o.articulo_id LEFT JOIN familia f ON f.id = o.familia_id LEFT JOIN sucursal s ON s.id = o.sucursal_id
      ORDER BY o.activo DESC, s.clave NULLS FIRST, (a.id IS NOT NULL), (f.id IS NOT NULL), coalesce(a.clave, f.clave)`,
  )).rows;
}

/**
 * Alta o cambio de una oferta (contador o contralor). Sin id: nueva para ese alcance
 * (si ya hay una activa para el mismo alcance, se actualiza). Con id: cambia % u hora, o la desactiva.
 */
export async function guardarOferta(c: Cliente, d: { id?: string | null; articulo?: string | null; familia?: string | null; sucursal?: string | null; descuento_pct: string; hora_desde: string; activo?: boolean }) {
  const pct = dec(d.descuento_pct, "Descuento");
  if (pct.lte(0) || pct.gte(100) || pct.decimalPlaces() > 2) throw invalido("El descuento es un porcentaje mayor que 0 y menor que 100, con hasta 2 decimales.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.hora_desde)) throw invalido("Hora no válida (HH:MM, de 00:00 a 23:59).");
  if (d.id) {
    const o = (await c.query("UPDATE oferta SET descuento_pct = $2, hora_desde = $3, activo = $4 WHERE id = $1 RETURNING id", [d.id, pct.toFixed(2), d.hora_desde, d.activo ?? true])).rows[0];
    if (!o) throw noEncontrado("No existe esa oferta.");
    return { id: o.id };
  }
  if (d.articulo && d.familia) throw invalido("La oferta es para un producto o para una familia, no ambos.");
  const art = d.articulo ? (await c.query("SELECT id FROM articulo WHERE clave = upper($1) AND tipo = 'SKU'", [d.articulo])).rows[0] : null;
  if (d.articulo && !art) throw invalido(`No es un producto a la venta: ${d.articulo}.`);
  const fam = d.familia ? (await c.query("SELECT id FROM familia WHERE clave = upper($1)", [d.familia])).rows[0] : null;
  if (d.familia && !fam) throw invalido(`No existe la familia ${d.familia}.`);
  const suc = d.sucursal ? (await c.query("SELECT id FROM sucursal WHERE clave = upper($1)", [d.sucursal])).rows[0] : null;
  if (d.sucursal && !suc) throw invalido(`No existe la sucursal ${d.sucursal}.`);
  const ya = (await c.query(
    "SELECT id FROM oferta WHERE activo AND articulo_id IS NOT DISTINCT FROM $1 AND familia_id IS NOT DISTINCT FROM $2 AND sucursal_id IS NOT DISTINCT FROM $3",
    [art?.id ?? null, fam?.id ?? null, suc?.id ?? null],
  )).rows[0];
  if (ya) {
    await c.query("UPDATE oferta SET descuento_pct = $2, hora_desde = $3 WHERE id = $1", [ya.id, pct.toFixed(2), d.hora_desde]);
    return { id: ya.id };
  }
  const o = (await c.query("INSERT INTO oferta (articulo_id, familia_id, sucursal_id, descuento_pct, hora_desde) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [art?.id ?? null, fam?.id ?? null, suc?.id ?? null, pct.toFixed(2), d.hora_desde])).rows[0];
  return { id: o.id };
}

/** Hora local del negocio (HH:MM) del momento de la venta; con minutos de holgura opcionales. */
async function horaLocal(c: Cliente, fecha: string | null, holguraMin = 0): Promise<string> {
  return (await c.query("SELECT to_char((coalesce($1::timestamptz, now()) + make_interval(mins => $2)) AT TIME ZONE 'America/Mexico_City', 'HH24:MI') AS h", [fecha, holguraMin])).rows[0].h;
}

export async function productosCaja(c: Cliente, k: ContextoCaja) {
  const hoy = await hoyNegocio(c);
  const ofertas = await leerOfertas(c);
  const { rows } = await c.query(
    `SELECT a.id, a.familia_id, a.clave, a.nombre, u.clave AS unidad, coalesce(f.clave, 'SIN-FAMILIA') AS familia, coalesce(f.nombre, 'Otros') AS familia_nombre, a.codigo_barras,
            (SELECT p.precio::text FROM precio_venta p WHERE p.articulo_id = a.id AND (p.sucursal_id = $1 OR p.sucursal_id IS NULL)
                AND p.vigente_desde <= $2 AND (p.vigente_hasta IS NULL OR p.vigente_hasta >= $2)
              ORDER BY (p.sucursal_id IS NULL), p.vigente_desde DESC LIMIT 1) AS precio,
            coalesce((SELECT e.cantidad FROM existencia e WHERE e.almacen_id = $3 AND e.articulo_id = a.id), 0)::text AS existencia,
            a.tasa_iva_id IS NOT NULL AS tiene_iva
       FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id LEFT JOIN familia f ON f.id = a.familia_id
      WHERE a.tipo = 'SKU' AND a.activo ORDER BY f.nombre NULLS LAST, a.nombre`,
    [k.caja.sucursal_id, hoy, k.caja.almacen_id ?? null],
  );
  // La caja recibe la oferta de cada producto (% y hora) para calcular el total también sin internet.
  return rows.map(({ familia_id, ...r }) => {
    const o = ofertaAplicable(ofertas, { id: r.id, familiaId: familia_id }, k.caja.sucursal_id, "23:59");
    return { ...r, oferta: o ? { pct: o.pct.toFixed(2), desde: o.horaDesde } : null };
  });
}

interface ArticuloVenta { id: string; familiaId: string | null; clave: string; nombre: string; unidad: string; precio: string | null; iva: Tasa | null; ieps: Tasa | null }
async function articulosVenta(c: Cliente, k: ContextoCaja, claves: string[]): Promise<Map<string, ArticuloVenta>> {
  const hoy = await hoyNegocio(c);
  const { rows } = await c.query(
    `SELECT a.id, a.familia_id, a.clave, a.nombre, u.clave AS unidad,
            (SELECT p.precio::text FROM precio_venta p WHERE p.articulo_id = a.id AND (p.sucursal_id = $2 OR p.sucursal_id IS NULL)
                AND p.vigente_desde <= $3 AND (p.vigente_hasta IS NULL OR p.vigente_hasta >= $3)
              ORDER BY (p.sucursal_id IS NULL), p.vigente_desde DESC LIMIT 1) AS precio,
            iva.tipo_factor AS iva_tipo, iva.tasa::text AS iva_tasa, ieps.tipo_factor AS ieps_tipo, ieps.tasa::text AS ieps_tasa
       FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id
       LEFT JOIN tasa_impuesto iva ON iva.id = a.tasa_iva_id LEFT JOIN tasa_impuesto ieps ON ieps.id = a.tasa_ieps_id
      WHERE a.clave = ANY($1) AND a.tipo = 'SKU' AND a.activo`,
    [claves.map((x) => x.toUpperCase()), k.caja.sucursal_id, hoy],
  );
  const m = new Map<string, ArticuloVenta>(rows.map((r) => [r.clave, {
    id: r.id, familiaId: r.familia_id, clave: r.clave, nombre: r.nombre, unidad: r.unidad, precio: r.precio,
    iva: r.iva_tipo ? { tipoFactor: r.iva_tipo, tasa: r.iva_tasa } : null, ieps: r.ieps_tipo ? { tipoFactor: r.ieps_tipo, tasa: r.ieps_tasa } : null,
  }]));
  const faltan = [...new Set(claves.map((x) => x.toUpperCase()))].filter((x) => !m.has(x));
  if (faltan.length) throw invalido(`No es un producto a la venta: ${faltan.join(", ")}.`);
  return m;
}

async function formasPago(c: Cliente) {
  return new Map<string, { id: string; clave: string; nombre: string; es_efectivo: boolean; requiere_referencia: boolean }>(
    (await c.query("SELECT id, clave, nombre, es_efectivo, requiere_referencia FROM forma_pago WHERE activo")).rows.map((r) => [r.clave, r]),
  );
}

export interface PagoCaptura { forma: string; importe: string; referencia?: string | null }

/** Valida pagos y referencias (nunca un número de tarjeta). */
async function prepararPagos(c: Cliente, porCobrar: Dec, pagos: PagoCaptura[]) {
  const formas = await formasPago(c);
  const lista = pagos.map((p, i) => {
    const f = formas.get(p.forma);
    if (!f) throw invalido(`Forma de pago no válida o inactiva: ${p.forma}.`);
    const ref = p.referencia?.trim() || null;
    if (f.requiere_referencia && !ref) throw invalido(`${f.nombre}: escribe la referencia o número de autorización del voucher.`);
    if (ref && /\d{13,19}/.test(ref.replace(/[\s-]/g, ""))) throw invalido("No captures el número de la tarjeta: solo la referencia o autorización del voucher.");
    const importe = dec(p.importe, `Pago ${i + 1}`);
    if (importe.decimalPlaces() > 2) throw invalido("Los pagos van en pesos y centavos.");
    return { forma: f, importe, referencia: ref };
  });
  if (!lista.length && porCobrar.gt(0)) throw invalido("Captura el pago.");
  let r: ReturnType<typeof cobrar>;
  try { r = cobrar(porCobrar, lista.map((p) => ({ efectivo: p.forma.es_efectivo, importe: p.importe }))); } catch (e) { throw invalido((e as Error).message); }
  return { ...r, lista };
}

// ---------------------------------------------------------------------------
// Venta
// ---------------------------------------------------------------------------
/** `oferta`: la caja aplicó la oferta de fin del día (se acepta con 5 minutos de diferencia de reloj). */
export interface RenglonVenta { articulo: string; cantidad: string; descuento?: string | null; oferta?: boolean | null }
export interface PedidoVenta { id: string; anticipado: Dec; renglones: { articulo: string; cantidad: string; precio: string }[] }

export interface SinConexion { fecha_caja: string; folio_local: string }
export async function vender(c: Cliente, k: ContextoCaja, d: { id: string; renglones: RenglonVenta[]; pagos: PagoCaptura[]; autorizoDescuento?: string | null; sinConexion?: SinConexion | null }, pedido?: PedidoVenta) {
  exigirCajero(k, "pos.ventas:crear");
  const turno = exigirTurno(k);
  const ya = (await c.query("SELECT id, folio, total::text, cambio::text FROM venta WHERE id = $1", [d.id])).rows[0];
  if (ya) return { ...ya, repetida: true }; // reenvío de la misma venta: no se duplica
  if (!d.renglones.length) throw invalido("La venta no tiene productos.");
  const arts = await articulosVenta(c, k, d.renglones.map((r) => r.articulo));
  const precioPedido = new Map((pedido?.renglones ?? []).map((r) => [r.articulo, r.precio]));
  // Ofertas de fin del día: a la hora de la venta (la de la caja si fue sin conexión). Un pedido conserva su precio pactado.
  const ofertas = pedido ? [] : await leerOfertas(c);
  const hora = ofertas.length ? await horaLocal(c, d.sinConexion?.fecha_caja ?? null) : "00:00";
  const horaHolgura = ofertas.length ? await horaLocal(c, d.sinConexion?.fecha_caja ?? null, 5) : "00:00";
  let total = new D(0), base = new D(0), ieps = new D(0), iva = new D(0), descuento = new D(0), manual = new D(0);
  const renglones = d.renglones.map((r, i) => {
    const a = arts.get(r.articulo.toUpperCase())!;
    const cantidad = dec(r.cantidad, a.clave);
    if (cantidad.lte(0)) throw invalido(`${a.nombre}: la cantidad debe ser mayor que cero.`);
    if (a.unidad === "PZA" && !cantidad.isInteger()) throw invalido(`${a.nombre}: las piezas van en números enteros.`);
    if (cantidad.decimalPlaces() > 3) throw invalido(`${a.nombre}: máximo 3 decimales.`);
    const precioTxt = pedido ? precioPedido.get(a.clave) : a.precio;
    if (precioTxt === null || precioTxt === undefined) throw invalido(`${a.nombre} no tiene precio vigente en esta sucursal.`);
    const precio = new D(precioTxt);
    const descManual = r.descuento ? dec(r.descuento, "Descuento") : new D(0);
    if (descManual.decimalPlaces() > 2) throw invalido("El descuento va en pesos y centavos.");
    const oferta = ofertaAplicable(ofertas, a, k.caja.sucursal_id, hora) ?? (r.oferta ? ofertaAplicable(ofertas, a, k.caja.sucursal_id, horaHolgura) : null);
    const descOferta = oferta ? descuentoOferta(precio, cantidad, oferta.pct) : new D(0);
    const desc = descOferta.plus(descManual);
    let importe: Dec, imp: ReturnType<typeof desglosar>;
    try {
      importe = importeRenglon(precio, cantidad, desc);
      imp = desglosar(importe, a.iva, a.ieps);
    } catch (e) { throw invalido(`${a.nombre}: ${(e as Error).message}`); }
    total = total.plus(importe); base = base.plus(imp.base); ieps = ieps.plus(imp.ieps); iva = iva.plus(imp.iva); descuento = descuento.plus(desc); manual = manual.plus(descManual);
    return { orden: i + 1, a, cantidad, precio, desc, importe, imp, oferta, descOferta };
  });
  // La oferta no pide autorización; un descuento adicional, sí (P50).
  if (manual.gt(0) && !d.autorizoDescuento) throw new ErrorApp(403, "requiere_autorizacion", "El descuento requiere la autorización de un encargado.");
  const anticipo = pedido?.anticipado ?? new D(0);
  const cobro = await prepararPagos(c, total.minus(anticipo), d.pagos);
  // Folio consecutivo por caja (provisional, P54).
  const n = (await c.query("UPDATE caja SET ultimo_folio = ultimo_folio + 1 WHERE id = $1 RETURNING ultimo_folio", [k.caja.id])).rows[0].ultimo_folio;
  const folio = `${k.caja.clave}-${String(n).padStart(6, "0")}`;
  const salida = await salidaPorVenta(c, k.cajero.id, k.caja.almacen_id, d.id, folio, renglones.map((r) => ({ articulo_id: r.a.id, cantidad: r.cantidad })));
  await c.query(
    `INSERT INTO venta (id, folio, caja_id, turno_id, sucursal_id, almacen_id, cajero_id, fecha_negocio, subtotal, ieps, iva, descuento, total, recibido, cambio,
                        pedido_id, anticipo_aplicado, movimiento_id, autorizo_descuento_id, sin_conexion, fecha_caja, folio_local)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
    [d.id, folio, k.caja.id, turno.id, k.caja.sucursal_id, k.caja.almacen_id, k.cajero.id, await hoyNegocio(c), m2(base), m2(ieps), m2(iva), m2(descuento), m2(total),
      m2(cobro.recibido.plus(anticipo)), m2(cobro.cambio), pedido?.id ?? null, m2(anticipo), salida.movimientoId, manual.gt(0) ? d.autorizoDescuento : null,
      !!d.sinConexion, d.sinConexion?.fecha_caja ?? null, d.sinConexion?.folio_local ?? null],
  );
  for (const [i, r] of renglones.entries()) {
    const costo = salida.costos[i]!;
    await c.query(
      `INSERT INTO venta_renglon (venta_id, orden, articulo_id, cantidad, precio, descuento, importe, base, ieps, iva, tasa_iva, tasa_ieps, costo_unitario, costo_importe, oferta_id, descuento_oferta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [d.id, r.orden, r.a.id, r.cantidad.toFixed(), m2(r.precio), m2(r.desc), m2(r.importe), m2(r.imp.base), m2(r.imp.ieps), m2(r.imp.iva),
        r.a.iva?.tasa ?? null, r.a.ieps?.tasa ?? null, costo.div(r.cantidad).toDecimalPlaces(6).toFixed(), costo.toFixed(), r.oferta?.id ?? null, m2(r.descOferta)],
    );
  }
  for (const [i, p] of cobro.lista.entries()) {
    const aplicado = cobro.aplicados[i]!;
    if (aplicado.gt(0)) await c.query("INSERT INTO venta_pago (venta_id, forma_pago_id, importe, referencia) VALUES ($1, $2, $3, $4)", [d.id, p.forma.id, m2(aplicado), p.referencia]);
  }
  if (anticipo.gt(0)) await c.query("INSERT INTO venta_pago (venta_id, forma_pago_id, importe, referencia) VALUES ($1, NULL, $2, $3)", [d.id, m2(anticipo), "Anticipo del pedido"]);
  return { id: d.id, folio, total: m2(total), cambio: m2(cobro.cambio), folio_local: d.sinConexion?.folio_local ?? null };
}

// ---------------------------------------------------------------------------
// Efectivo: retiros e ingresos
// ---------------------------------------------------------------------------
export async function movimientoEfectivo(c: Cliente, k: ContextoCaja, d: { tipo: "RETIRO" | "INGRESO"; importe: string; motivo: string; autorizoId: string }) {
  exigirCajero(k, "pos.ventas:crear");
  const turno = exigirTurno(k);
  const imp = dec(d.importe, "Importe");
  if (imp.lte(0) || imp.decimalPlaces() > 2) throw invalido("Importe no válido.");
  if (d.tipo === "RETIRO") {
    const disponible = new D((await resumenTurno(c, turno.id)).efectivo_esperado);
    if (imp.gt(disponible)) throw invalido(`No hay tanto efectivo en la caja (hay $${m2(disponible)}).`);
  }
  const efectivo = (await c.query("SELECT id FROM forma_pago WHERE es_efectivo AND activo ORDER BY orden LIMIT 1")).rows[0];
  return (await c.query(
    "INSERT INTO movimiento_caja (turno_id, tipo, forma_pago_id, importe, motivo, cajero_id, autorizo_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, creado_en",
    [turno.id, d.tipo, efectivo.id, m2(imp), d.motivo, k.cajero.id, d.autorizoId],
  )).rows[0];
}

// ---------------------------------------------------------------------------
// Devoluciones
// ---------------------------------------------------------------------------
export async function devolver(c: Cliente, k: ContextoCaja, d: { venta: string; renglones: { orden: number; cantidad: string }[]; motivo: string; regresa_inventario: boolean; forma: string; autorizoId: string }) {
  exigirCajero(k, "pos.devoluciones:crear");
  const turno = exigirTurno(k);
  const v = (await c.query("SELECT * FROM venta WHERE (folio = upper($1) OR id::text = $1) FOR UPDATE", [d.venta])).rows[0];
  if (!v) throw noEncontrado("No existe esa venta.");
  if (v.sucursal_id !== k.caja.sucursal_id) throw prohibido("La venta es de otra sucursal: la devolución se hace donde se vendió.");
  if (v.pedido_id) throw invalido("Esa venta es la entrega de un pedido; su devolución la autoriza la oficina.");
  if (d.autorizoId === v.cajero_id) throw prohibido("Quien hizo la venta no puede autorizar su devolución (segregación de funciones).");
  const forma = (await formasPago(c)).get(d.forma);
  if (!forma) throw invalido("Forma de devolución no válida.");
  const rs = new Map((await c.query("SELECT id, orden, articulo_id, cantidad::text, importe::text, costo_importe::text, cantidad_devuelta::text FROM venta_renglon WHERE venta_id = $1 FOR UPDATE", [v.id])).rows.map((r) => [r.orden, r]));
  const partidas: { r: any; cantidad: Dec; importe: Dec; costo: Dec }[] = [];
  for (const x of d.renglones) {
    const r = rs.get(x.orden);
    if (!r) throw invalido(`La venta no tiene el renglón ${x.orden}.`);
    const cantidad = dec(x.cantidad, "Cantidad");
    if (cantidad.lte(0)) continue;
    const ya = (await c.query("SELECT coalesce(sum(importe), 0)::text AS i FROM devolucion_renglon WHERE venta_renglon_id = $1", [r.id])).rows[0].i;
    let importe: Dec;
    try { importe = importeDevolucion(new D(r.importe), new D(r.cantidad), cantidad, new D(r.cantidad_devuelta), new D(ya)); } catch (e) { throw invalido((e as Error).message); }
    const costo = new D(r.costo_importe).mul(cantidad).div(r.cantidad).toDecimalPlaces(6, D.ROUND_HALF_UP);
    partidas.push({ r, cantidad, importe, costo });
  }
  if (!partidas.length) throw invalido("Indica qué productos se devuelven.");
  const total = partidas.reduce((s, p) => s.plus(p.importe), new D(0));
  if (total.lte(0)) throw invalido("La devolución no tiene importe.");
  await dentroDeLimite(c, d.autorizoId, "pos.devolucion_descuento", total);
  if (forma.es_efectivo) {
    const disponible = new D((await resumenTurno(c, turno.id)).efectivo_esperado);
    if (total.gt(disponible)) throw invalido(`No hay suficiente efectivo en la caja para devolver $${m2(total)}.`);
  }
  const mc = (await c.query(
    "INSERT INTO movimiento_caja (turno_id, tipo, forma_pago_id, importe, motivo, documento_id, cajero_id, autorizo_id) VALUES ($1, 'DEVOLUCION_VENTA', $2, $3, $4, $5, $6, $7) RETURNING id",
    [turno.id, forma.id, m2(total), d.motivo, v.id, k.cajero.id, d.autorizoId],
  )).rows[0];
  const dev = (await c.query("SELECT gen_random_uuid() AS id, 'DEV-' || lpad(nextval('devolucion_folio')::text, 6, '0') AS folio")).rows[0];
  // El pan devuelto en buen estado regresa al inventario con el costo con que salió; si no, ya salió y no se mueve.
  const movId = d.regresa_inventario
    ? await entradaPorDevolucion(c, k.cajero.id, v.almacen_id, dev.id, dev.folio, partidas.map((p) => ({ articulo_id: p.r.articulo_id, cantidad: p.cantidad, importe: p.costo })))
    : null;
  await c.query(
    "INSERT INTO devolucion (id, folio, venta_id, turno_id, importe, motivo, regresa_inventario, movimiento_id, movimiento_caja_id, cajero_id, autorizo_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [dev.id, dev.folio, v.id, turno.id, m2(total), d.motivo, d.regresa_inventario, movId, mc.id, k.cajero.id, d.autorizoId],
  );
  for (const p of partidas) {
    await c.query("INSERT INTO devolucion_renglon (devolucion_id, venta_renglon_id, cantidad, importe) VALUES ($1, $2, $3, $4)", [dev.id, p.r.id, p.cantidad.toFixed(), m2(p.importe)]);
    await c.query("UPDATE venta_renglon SET cantidad_devuelta = cantidad_devuelta + $2 WHERE id = $1", [p.r.id, p.cantidad.toFixed()]);
  }
  const devuelto = new D(v.devuelto).plus(total);
  await c.query("UPDATE venta SET devuelto = $2, estatus = $3 WHERE id = $1", [v.id, m2(devuelto), devuelto.eq(v.total) ? "DEVUELTA" : "DEVUELTA_PARCIAL"]);
  return { folio: dev.folio, venta: v.folio, importe: m2(total) };
}

// ---------------------------------------------------------------------------
// Cortes
// ---------------------------------------------------------------------------
export async function resumenTurno(c: Cliente, turnoId: string) {
  const t = (await c.query("SELECT fondo::text FROM turno_caja WHERE id = $1", [turnoId])).rows[0];
  const v = (await c.query(
    `SELECT count(*)::int AS ventas, coalesce(sum(total), 0)::text AS total, coalesce(sum(subtotal), 0)::text AS subtotal, coalesce(sum(ieps), 0)::text AS ieps,
            coalesce(sum(iva), 0)::text AS iva, coalesce(sum(descuento), 0)::text AS descuentos, coalesce(sum(anticipo_aplicado), 0)::text AS anticipos_aplicados
       FROM venta WHERE turno_id = $1`,
    [turnoId],
  )).rows[0];
  const porForma = (await c.query(
    `SELECT f.clave, f.nombre, f.es_efectivo, coalesce(sum(p.importe), 0)::text AS importe
       FROM venta_pago p JOIN venta v ON v.id = p.venta_id JOIN forma_pago f ON f.id = p.forma_pago_id
      WHERE v.turno_id = $1 GROUP BY f.clave, f.nombre, f.es_efectivo, f.orden ORDER BY f.orden`,
    [turnoId],
  )).rows;
  const caja = (await c.query(
    `SELECT mc.tipo, f.es_efectivo, coalesce(sum(mc.importe), 0)::text AS importe, count(*)::int AS n
       FROM movimiento_caja mc JOIN forma_pago f ON f.id = mc.forma_pago_id WHERE mc.turno_id = $1 GROUP BY mc.tipo, f.es_efectivo`,
    [turnoId],
  )).rows;
  const suma = (tipo: string, efectivo?: boolean) => caja.filter((x) => x.tipo === tipo && (efectivo === undefined || x.es_efectivo === efectivo)).reduce((s, x) => s.plus(x.importe), new D(0));
  const ventasEfectivo = porForma.filter((x) => x.es_efectivo).reduce((s, x) => s.plus(x.importe), new D(0));
  const esperado = efectivoEsperado({
    fondo: new D(t.fondo), ventasEfectivo, ingresos: suma("INGRESO", true), anticiposEfectivo: suma("ANTICIPO", true), retiros: suma("RETIRO", true),
    devolucionesEfectivo: suma("DEVOLUCION_VENTA", true).plus(suma("DEVOLUCION_ANTICIPO", true)),
  });
  return {
    fondo: t.fondo, ...v, por_forma: porForma,
    retiros: m2(suma("RETIRO")), ingresos: m2(suma("INGRESO")), anticipos: m2(suma("ANTICIPO")), anticipos_efectivo: m2(suma("ANTICIPO", true)),
    devoluciones: m2(suma("DEVOLUCION_VENTA")), devoluciones_anticipo: m2(suma("DEVOLUCION_ANTICIPO")),
    ventas_efectivo: m2(ventasEfectivo), efectivo_esperado: m2(esperado),
  };
}

export async function corteX(c: Cliente, k: ContextoCaja) {
  exigirCajero(k, ["pos.ventas:crear", "pos.caja:ver"]);
  const turno = exigirTurno(k);
  const r = await resumenTurno(c, turno.id);
  const corte = (await c.query("INSERT INTO corte (turno_id, tipo, esperado_efectivo, resumen, usuario_id) VALUES ($1, 'X', $2, $3, $4) RETURNING id, creado_en", [turno.id, r.efectivo_esperado, JSON.stringify(r), k.cajero.id])).rows[0];
  return { ...corte, turno: turno.folio, resumen: r };
}

export async function corteZ(c: Cliente, k: ContextoCaja, d: { denominaciones: { valor: string; cantidad: number }[]; comentario?: string | null; autorizoId?: string | null }) {
  const turno = exigirTurno(k);
  // Cierra quien tiene permiso de cerrar caja; si el cajero no lo tiene, autoriza un encargado con PIN.
  if (!k.cajero.permisos.has("pos.caja:cerrar") && !d.autorizoId) throw new ErrorApp(403, "requiere_autorizacion", "El corte Z lo autoriza un encargado.");
  const validas = new Set((await c.query("SELECT valor::text FROM denominacion WHERE activo")).rows.map((r) => new D(r.valor).toFixed(2)));
  for (const x of d.denominaciones) if (!validas.has(new D(x.valor).toFixed(2))) throw invalido(`Denominación no válida: ${x.valor}.`);
  let contado: Dec;
  try { contado = arqueo(d.denominaciones.map((x) => ({ valor: new D(x.valor), cantidad: x.cantidad }))); } catch (e) { throw invalido((e as Error).message); }
  const r = await resumenTurno(c, turno.id);
  const diferencia = contado.minus(r.efectivo_esperado);
  const maxima = await configEntero(c, "pos.diferencia_corte_maxima");
  if (diferencia.abs().gt(maxima)) {
    if (!d.comentario?.trim()) throw invalido(`Hay una diferencia de $${m2(diferencia)} (contado − esperado): escribe un comentario que la explique.`);
    if (!d.autorizoId) throw new ErrorApp(403, "requiere_autorizacion", `Hay una diferencia de $${m2(diferencia)}: el corte lo autoriza un encargado.`);
  }
  const corte = (await c.query(
    `INSERT INTO corte (turno_id, tipo, esperado_efectivo, contado_efectivo, diferencia, resumen, comentario, usuario_id, autorizo_id)
     VALUES ($1, 'Z', $2, $3, $4, $5, $6, $7, $8) RETURNING id, creado_en`,
    [turno.id, r.efectivo_esperado, m2(contado), m2(diferencia), JSON.stringify(r), d.comentario ?? null, k.cajero.id, d.autorizoId ?? null],
  )).rows[0];
  for (const x of d.denominaciones.filter((y) => y.cantidad > 0)) {
    await c.query("INSERT INTO corte_denominacion (corte_id, valor, cantidad) VALUES ($1, $2, $3)", [corte.id, new D(x.valor).toFixed(2), x.cantidad]);
  }
  await c.query("UPDATE turno_caja SET estatus = 'CERRADO', cerrado_por = $2, cerrado_en = now() WHERE id = $1", [turno.id, d.autorizoId ?? k.cajero.id]);
  return { ...corte, turno: turno.folio, contado: m2(contado), esperado: r.efectivo_esperado, diferencia: m2(diferencia), resumen: r };
}

// ---------------------------------------------------------------------------
// Pedidos con anticipo
// ---------------------------------------------------------------------------
async function registrarAnticipo(c: Cliente, k: ContextoCaja, pedidoId: string, p: PagoCaptura) {
  const turno = exigirTurno(k);
  const pagos = await prepararPagos(c, dec(p.importe, "Anticipo"), [p]);
  const mc = (await c.query(
    "INSERT INTO movimiento_caja (turno_id, tipo, forma_pago_id, importe, referencia, documento_id, cajero_id) VALUES ($1, 'ANTICIPO', $2, $3, $4, $5, $6) RETURNING id",
    [turno.id, pagos.lista[0]!.forma.id, m2(pagos.aplicados[0]!), pagos.lista[0]!.referencia, pedidoId, k.cajero.id],
  )).rows[0];
  const an = (await c.query("INSERT INTO anticipo (pedido_id, movimiento_caja_id, importe) VALUES ($1, $2, $3) RETURNING folio", [pedidoId, mc.id, m2(pagos.aplicados[0]!)])).rows[0];
  await c.query("UPDATE pedido SET anticipado = anticipado + $2 WHERE id = $1", [pedidoId, m2(pagos.aplicados[0]!)]);
  return { importe: m2(pagos.aplicados[0]!), cambio: m2(pagos.cambio), recibo: await reciboAnticipo(c, an.folio) };
}

export const LEYENDA_RECIBO = "Este recibo no es un comprobante fiscal. La factura se emite a la entrega del pedido, por el total.";

/** Recibo de anticipo (P64): comprobante del pago a cuenta de un pedido; no se factura. */
export async function reciboAnticipo(c: Cliente, folio: string) {
  const r = (await c.query(
    `SELECT an.folio, an.importe::text, an.creado_en, p.folio AS pedido, p.cliente_nombre, p.fecha_entrega::text, p.total::text, p.sucursal_id, s.nombre AS sucursal,
            f.nombre AS forma, mc.referencia, u.nombre AS cajero,
            (SELECT coalesce(sum(a2.importe), 0) FROM anticipo a2 WHERE a2.pedido_id = an.pedido_id AND (a2.creado_en, a2.id) <= (an.creado_en, an.id))::text AS anticipado
       FROM anticipo an JOIN pedido p ON p.id = an.pedido_id JOIN sucursal s ON s.id = p.sucursal_id JOIN movimiento_caja mc ON mc.id = an.movimiento_caja_id
       JOIN forma_pago f ON f.id = mc.forma_pago_id JOIN usuario u ON u.id = mc.cajero_id WHERE an.folio = upper($1)`,
    [folio],
  )).rows[0];
  if (!r) throw noEncontrado("No existe ese recibo.");
  return { ...r, saldo: m2(new D(r.total).minus(r.anticipado)), leyenda: LEYENDA_RECIBO };
}

export async function crearPedido(c: Cliente, k: ContextoCaja, d: { cliente_nombre: string; telefono?: string | null; cliente?: string | null; fecha_entrega: string; notas?: string | null; origen?: "MOSTRADOR" | "TELEFONO" | "WHATSAPP"; renglones: { articulo: string; cantidad: string; especificaciones?: string | null }[]; anticipo?: PagoCaptura | null; autorizoSinAnticipo?: string | null }) {
  exigirCajero(k, "pos.pedidos:crear");
  const hoy = await hoyNegocio(c);
  if (d.fecha_entrega < hoy) throw invalido("La fecha de entrega no puede ser anterior a hoy.");
  if (!d.renglones.length) throw invalido("El pedido no tiene productos.");
  let clienteId: string | null = null;
  if (d.cliente) {
    clienteId = (await c.query("SELECT id FROM cliente WHERE clave = upper($1) AND activo", [d.cliente])).rows[0]?.id ?? null;
    if (!clienteId) throw invalido(`No existe el cliente ${d.cliente}.`);
  }
  const arts = await articulosVenta(c, k, d.renglones.map((r) => r.articulo));
  let total = new D(0);
  const rs = d.renglones.map((r) => {
    const a = arts.get(r.articulo.toUpperCase())!;
    if (!a.precio) throw invalido(`${a.nombre} no tiene precio vigente en esta sucursal.`);
    const cantidad = dec(r.cantidad, a.clave);
    if (cantidad.lte(0) || (a.unidad === "PZA" && !cantidad.isInteger())) throw invalido(`${a.nombre}: cantidad no válida.`);
    const importe = importeRenglon(new D(a.precio), cantidad, new D(0));
    total = total.plus(importe);
    return { a, cantidad, importe, especificaciones: r.especificaciones ?? null };
  });
  const minimo = total.mul(await configEntero(c, "pos.anticipo_minimo_pct")).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const anticipo = d.anticipo ? dec(d.anticipo.importe, "Anticipo") : new D(0);
  if (anticipo.lt(minimo)) throw invalido(`El anticipo mínimo es $${m2(minimo)}.`);
  // P60: sin anticipo, el pedido lo autoriza el contador o el contralor.
  if (anticipo.lte(0) && !d.autorizoSinAnticipo) throw new ErrorApp(403, "requiere_autorizacion", "Un pedido sin anticipo lo autoriza el contador o el contralor con su PIN.");
  if (anticipo.gt(0) && !k.turno) throw invalido("El anticipo se cobra en la caja: registra el pedido sin anticipo (con autorización) o cóbralo en la sucursal.");
  const p = (await c.query(
    "INSERT INTO pedido (sucursal_id, cliente_id, cliente_nombre, telefono, fecha_entrega, notas, total, registrado_por, origen, autorizo_sin_anticipo_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, folio",
    [k.caja.sucursal_id, clienteId, d.cliente_nombre, d.telefono ?? null, d.fecha_entrega, d.notas ?? null, m2(total), k.cajero.id, d.origen ?? "MOSTRADOR", anticipo.lte(0) ? d.autorizoSinAnticipo : null],
  )).rows[0];
  for (const r of rs) {
    await c.query("INSERT INTO pedido_renglon (pedido_id, articulo_id, cantidad, precio, importe, especificaciones) VALUES ($1, $2, $3, $4, $5, $6)",
      [p.id, r.a.id, r.cantidad.toFixed(), r.a.precio, m2(r.importe), r.especificaciones]);
  }
  let cobro = null;
  if (anticipo.gt(0)) {
    if (anticipo.gt(total)) throw invalido("El anticipo no puede ser mayor que el total del pedido.");
    cobro = await registrarAnticipo(c, k, p.id, d.anticipo!);
  }
  return { ...p, total: m2(total), anticipo: cobro };
}

async function pedidoBloqueado(c: Cliente, k: ContextoCaja, id: string) {
  const p = (await c.query("SELECT * FROM pedido WHERE (id::text = $1 OR folio = upper($1)) FOR UPDATE", [id])).rows[0];
  if (!p) throw noEncontrado("No existe ese pedido.");
  if (p.sucursal_id !== k.caja.sucursal_id) throw prohibido("El pedido es de otra sucursal.");
  if (p.estatus !== "REGISTRADO") throw new ErrorApp(409, "estatus", `El pedido ${p.folio} ya está ${p.estatus.toLowerCase()}.`);
  return p;
}

export async function abonarPedido(c: Cliente, k: ContextoCaja, id: string, pago: PagoCaptura) {
  exigirCajero(k, "pos.pedidos:crear");
  const p = await pedidoBloqueado(c, k, id);
  if (dec(pago.importe, "Abono").gt(new D(p.total).minus(p.anticipado))) throw invalido(`El saldo del pedido es $${m2(new D(p.total).minus(p.anticipado))}.`);
  return { folio: p.folio, ...(await registrarAnticipo(c, k, p.id, pago)) };
}

/** Entrega: se vende el pedido a los precios pactados, aplicando lo anticipado; se cobra el saldo. */
export async function entregarPedido(c: Cliente, k: ContextoCaja, id: string, d: { venta_id: string; pagos: PagoCaptura[] }) {
  exigirCajero(k, ["pos.pedidos:crear", "pos.ventas:crear"]);
  const p = await pedidoBloqueado(c, k, id);
  const rs = (await c.query("SELECT a.clave, r.cantidad::text, r.precio::text FROM pedido_renglon r JOIN articulo a ON a.id = r.articulo_id WHERE r.pedido_id = $1 ORDER BY r.creado_en, r.id", [p.id])).rows;
  const v = await vender(c, k, { id: d.venta_id, renglones: rs.map((r) => ({ articulo: r.clave, cantidad: r.cantidad })), pagos: d.pagos },
    { id: p.id, anticipado: new D(p.anticipado), renglones: rs.map((r) => ({ articulo: r.clave, cantidad: r.cantidad, precio: r.precio })) });
  await c.query("UPDATE pedido SET estatus = 'ENTREGADO', venta_id = $2 WHERE id = $1", [p.id, v.id]);
  return { pedido: p.folio, ...v };
}

export async function cancelarPedido(c: Cliente, k: ContextoCaja, id: string, d: { destino: "DEVUELTO" | "RETENIDO"; motivo: string; autorizoId: string }) {
  const p = await pedidoBloqueado(c, k, id);
  const anticipado = new D(p.anticipado);
  if (d.destino === "DEVUELTO" && anticipado.gt(0)) {
    const turno = exigirTurno(k);
    const disponible = new D((await resumenTurno(c, turno.id)).efectivo_esperado);
    if (anticipado.gt(disponible)) throw invalido(`No hay suficiente efectivo en la caja para devolver $${m2(anticipado)}.`);
    const efectivo = (await c.query("SELECT id FROM forma_pago WHERE es_efectivo AND activo ORDER BY orden LIMIT 1")).rows[0];
    await c.query(
      "INSERT INTO movimiento_caja (turno_id, tipo, forma_pago_id, importe, motivo, documento_id, cajero_id, autorizo_id) VALUES ($1, 'DEVOLUCION_ANTICIPO', $2, $3, $4, $5, $6, $7)",
      [turno.id, efectivo.id, m2(anticipado), d.motivo, p.id, k.cajero.id, d.autorizoId],
    );
  }
  await c.query("UPDATE pedido SET estatus = 'CANCELADO', destino_anticipo = $2, motivo_cancelacion = $3, cancelo_id = $4 WHERE id = $1",
    [p.id, anticipado.gt(0) ? d.destino : null, d.motivo, d.autorizoId]);
  return { folio: p.folio, anticipo: m2(anticipado), destino: anticipado.gt(0) ? d.destino : null };
}

// ---------------------------------------------------------------------------
// Ticket (documento neutro: lo convierte a HTML o ESC/POS el adaptador de impresión)
// ---------------------------------------------------------------------------
export async function ticket(c: Cliente, ventaId: string) {
  const v = (await c.query(
    `SELECT v.id, v.folio, v.fecha, v.subtotal::text, v.ieps::text, v.iva::text, v.descuento::text, v.total::text, v.recibido::text, v.cambio::text,
            v.devuelto::text, v.estatus, v.anticipo_aplicado::text, v.sin_conexion, v.folio_local, v.fecha_caja, s.nombre AS sucursal, cj.nombre AS caja, u.nombre AS cajero, pe.folio AS pedido, v.sucursal_id
       FROM venta v JOIN sucursal s ON s.id = v.sucursal_id JOIN caja cj ON cj.id = v.caja_id JOIN usuario u ON u.id = v.cajero_id
       LEFT JOIN pedido pe ON pe.id = v.pedido_id WHERE v.id::text = $1 OR v.folio = upper($1)`,
    [ventaId],
  )).rows[0];
  if (!v) throw noEncontrado("No existe esa venta.");
  const renglones = (await c.query(
    `SELECT r.orden, a.clave, a.nombre, u.clave AS unidad, r.cantidad::text, r.precio::text, r.descuento::text, r.importe::text, r.cantidad_devuelta::text
       FROM venta_renglon r JOIN articulo a ON a.id = r.articulo_id JOIN unidad u ON u.id = a.unidad_base_id WHERE r.venta_id = $1 ORDER BY r.orden`,
    [v.id],
  )).rows;
  const pagos = (await c.query(
    "SELECT coalesce(f.nombre, 'Anticipo') AS forma, p.importe::text, p.referencia FROM venta_pago p LEFT JOIN forma_pago f ON f.id = p.forma_pago_id WHERE p.venta_id = $1",
    [v.id],
  )).rows;
  return { ...v, renglones, pagos };
}
