// Facturación con el portal del SAT (Fase 8). El sistema no timbra: prepara los
// datos para capturarlos en el portal (factura individual de un ticket y factura
// global diaria), guarda el XML que se descarga del portal ligándolo a sus
// tickets, registra cancelaciones (las autoriza el contralor) y concilia lo
// vendido contra lo facturado.
import { createHash, randomUUID } from "node:crypto";
import {
  conceptosGlobal, conceptosNominativa, cotejar, diasEntre, formaPagoPredominante, netoTicket, resumenImpuestos, RFC_EXTRANJERO, RFC_PUBLICO_GENERAL, sumar,
  type ConceptoPortal, type Neto, type RenglonTicket,
} from "../dominio/facturacion";
import type { Alcance } from "../dominio/permisos";
import { D, type Dec } from "../dominio/recetas";
import { leerCfdi, type Cfdi } from "./cfdi";
import { ErrorApp, invalido, noEncontrado, prohibido } from "./errores";
import { hoyNegocio } from "./fechas";
import type { Cliente } from "./transaccion";
import type { UsuarioActual } from "./usuarios";

const m2 = (x: Dec | string | number) => new D(x).toFixed(2);
const config = async (c: Cliente, clave: string) => (await c.query("SELECT valor FROM configuracion WHERE clave = $1", [clave])).rows[0]?.valor as string | undefined;
const enAlcance = (a: Alcance, sucursalId: string | null) => a.todas || (sucursalId !== null && a.sucursales.includes(sucursalId));
const exigirAlcance = (a: Alcance, sucursalId: string | null) => {
  if (!enAlcance(a, sucursalId)) throw prohibido("Ese documento es de una sucursal que no tienes asignada.");
};
export const MAX_XML = 4_000_000;
export const MOTIVOS_CANCELACION: Record<string, string> = {
  "01": "Comprobante emitido con errores con relación",
  "02": "Comprobante emitido con errores sin relación",
  "03": "No se llevó a cabo la operación",
  "04": "Operación nominativa relacionada en una factura global",
};

// ---------------------------------------------------------------------------
// Tickets con su neto de devoluciones y su situación fiscal
// ---------------------------------------------------------------------------
interface Ticket {
  id: string; folio: string; fecha_negocio: string; sucursal_id: string; sucursal: string; total: string; devuelto: string; estatus: string;
  renglones: RenglonTicket[]; neto: Neto; pagos: { clave: string; importe: Dec }[];
  cfdi: { id: string; uuid: string; clase: string } | null; solicitud: { id: string; folio: string; estatus: string } | null;
}

async function cargarTickets(c: Cliente, where: string, params: unknown[]): Promise<Ticket[]> {
  const vs = (await c.query(
    `SELECT v.id, v.folio, v.fecha_negocio::text, v.sucursal_id, s.clave AS sucursal, v.total::text, v.devuelto::text, v.estatus, v.pedido_id,
            (SELECT json_build_object('id', e.id, 'uuid', e.uuid_cfdi, 'clase', e.clase) FROM cfdi_venta cv JOIN cfdi_emitido e ON e.id = cv.cfdi_id WHERE cv.venta_id = v.id AND cv.vigente) AS cfdi,
            (SELECT json_build_object('id', sf.id, 'folio', sf.folio, 'estatus', sf.estatus) FROM solicitud_factura sf WHERE sf.venta_id = v.id AND sf.estatus <> 'CANCELADA') AS solicitud
       FROM venta v JOIN sucursal s ON s.id = v.sucursal_id WHERE ${where} ORDER BY v.fecha_negocio, v.folio`,
    params,
  )).rows;
  if (!vs.length) return [];
  const ids = vs.map((v) => v.id);
  const rs = (await c.query(
    `SELECT r.venta_id, r.orden, a.clave, a.nombre, r.cantidad::text, r.importe::text, r.base::text, r.ieps::text, r.iva::text, r.tasa_iva::text, r.tasa_ieps::text,
            r.cantidad_devuelta::text, a.clave_prod_serv, a.clave_unidad_sat, a.objeto_impuesto, u.nombre AS unidad,
            coalesce((SELECT sum(dr.importe) FROM devolucion_renglon dr WHERE dr.venta_renglon_id = r.id), 0)::text AS devuelto
       FROM venta_renglon r JOIN articulo a ON a.id = r.articulo_id JOIN unidad u ON u.id = a.unidad_base_id
      WHERE r.venta_id = ANY($1::uuid[]) ORDER BY r.venta_id, r.orden`,
    [ids],
  )).rows;
  // Lo pagado con anticipo se declara con la forma en que se cobró el anticipo.
  const ps = (await c.query(
    `SELECT p.venta_id, f.clave, p.importe::text FROM venta_pago p JOIN forma_pago f ON f.id = p.forma_pago_id WHERE p.venta_id = ANY($1::uuid[])
     UNION ALL
     SELECT v.id, f.clave, an.importe::text FROM venta v JOIN anticipo an ON an.pedido_id = v.pedido_id JOIN movimiento_caja mc ON mc.id = an.movimiento_caja_id
       JOIN forma_pago f ON f.id = mc.forma_pago_id WHERE v.id = ANY($1::uuid[])`,
    [ids],
  )).rows;
  const dn = (x: string | null) => (x === null ? null : new D(x));
  return vs.map((v) => {
    const renglones: RenglonTicket[] = rs.filter((r) => r.venta_id === v.id).map((r) => ({
      articulo: r.clave, descripcion: r.nombre, cantidad: new D(r.cantidad), importe: new D(r.importe), base: new D(r.base), ieps: new D(r.ieps), iva: new D(r.iva),
      tasaIva: dn(r.tasa_iva), tasaIeps: dn(r.tasa_ieps), devuelto: new D(r.devuelto), cantidadDevuelta: new D(r.cantidad_devuelta),
      claveProdServ: r.clave_prod_serv, claveUnidad: r.clave_unidad_sat, unidad: r.unidad, objetoImp: r.objeto_impuesto,
    }));
    return { ...v, renglones, neto: netoTicket(renglones), pagos: ps.filter((p) => p.venta_id === v.id).map((p) => ({ clave: p.clave, importe: new D(p.importe) })) };
  });
}

const vistaNeto = (n: Neto) => ({ base: m2(n.base), ieps: m2(n.ieps), iva: m2(n.iva), total: m2(n.total) });
const vistaConceptos = (cs: ConceptoPortal[]) => cs.map((x) => ({
  clave_prod_serv: x.claveProdServ, no_identificacion: x.noIdentificacion, cantidad: x.cantidad.toFixed(), clave_unidad: x.claveUnidad, unidad: x.unidad,
  descripcion: x.descripcion, valor_unitario: x.valorUnitario.toFixed(), importe: m2(x.importe), objeto_imp: x.objetoImp,
  traslados: x.traslados.map((t) => ({ impuesto: t.impuesto, tasa: t.tasa.toFixed(6), base: m2(t.base), importe: m2(t.importe) })),
}));
const vistaImpuestos = (cs: ConceptoPortal[]) => resumenImpuestos(cs).map((t) => ({ impuesto: t.impuesto, tasa: t.tasa.toFixed(6), base: m2(t.base), importe: m2(t.importe) }));

/** Por qué un ticket no se puede facturar (o null si sí se puede). */
function bloqueo(t: Ticket): string | null {
  if (t.cfdi) return `El ticket ${t.folio} ya está en la factura ${t.cfdi.clase === "GLOBAL" ? "global" : "individual"} ${t.cfdi.uuid}.`;
  if (t.neto.total.lte(0)) return `El ticket ${t.folio} se devolvió completo: no hay nada que facturar.`;
  return null;
}

// ---------------------------------------------------------------------------
// Consulta de un ticket (para la solicitud de factura)
// ---------------------------------------------------------------------------
export async function consultarTicket(c: Cliente, u: UsuarioActual, folio: string) {
  const [t] = await cargarTickets(c, "v.folio = upper($1) OR v.id::text = $1", [folio.trim()]);
  if (!t) throw noEncontrado("No existe ese ticket.");
  exigirAlcance(u.alcance, t.sucursal_id);
  const hoy = await hoyNegocio(c);
  const dias = Number((await config(c, "fiscal.dias_solicitud")) ?? "0");
  const global = await globalDelDia(c, t.fecha_negocio, t.sucursal_id);
  let motivo = bloqueo(t);
  if (!motivo && t.solicitud) motivo = `El ticket ya tiene la solicitud ${t.solicitud.folio}.`;
  if (!motivo && diasEntre(t.fecha_negocio, hoy) > dias) motivo = dias === 0 ? "La factura se pide el mismo día de la compra." : `La factura se pide a más tardar ${dias} día(s) después de la compra.`;
  if (!motivo && global) motivo = "La factura global de ese día ya se registró: el ticket va incluido en ella.";
  return {
    id: t.id, folio: t.folio, fecha: t.fecha_negocio, sucursal: t.sucursal, total: t.total, devuelto: t.devuelto, neto: vistaNeto(t.neto),
    cfdi: t.cfdi, solicitud: t.solicitud, se_puede_solicitar: !motivo, motivo,
    renglones: t.renglones.map((r) => ({ articulo: r.articulo, descripcion: r.descripcion, cantidad: r.cantidad.toFixed(), importe: m2(r.importe), devuelto: m2(r.devuelto) })),
  };
}

async function globalDelDia(c: Cliente, fecha: string, sucursalId: string) {
  return (await c.query(
    "SELECT id, uuid_cfdi FROM cfdi_emitido WHERE clase = 'GLOBAL' AND estatus <> 'CANCELADA' AND fecha_negocio = $1 AND (sucursal_id = $2 OR sucursal_id IS NULL) LIMIT 1",
    [fecha, sucursalId],
  )).rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Solicitudes de factura
// ---------------------------------------------------------------------------
async function validarCatalogo(c: Cliente, catalogo: string, clave: string, nombre: string) {
  const n = (await c.query("SELECT count(*)::int AS n, bool_or(clave = $2 AND activo) AS hay FROM sat_catalogo WHERE catalogo = $1", [catalogo, clave])).rows[0];
  // Si el catálogo del SAT no está cargado, solo se revisa el formato.
  if (n.n > 0 && !n.hay) throw invalido(`${nombre} ${clave} no está en el catálogo ${catalogo} del SAT.`);
}

export interface DatosSolicitud { venta: string; rfc: string; razon_social: string; regimen_fiscal: string; codigo_postal: string; uso_cfdi: string; correo: string }

export async function crearSolicitud(c: Cliente, u: UsuarioActual, d: DatosSolicitud) {
  const rfc = d.rfc.trim().toUpperCase();
  if ([RFC_PUBLICO_GENERAL, RFC_EXTRANJERO].includes(rfc)) throw invalido("Con el RFC genérico no se pide factura: el ticket va en la factura global.");
  await c.query("SELECT id FROM venta WHERE folio = upper($1) OR id::text = $1 FOR UPDATE", [d.venta.trim()]);
  const t = await consultarTicket(c, u, d.venta);
  if (!t.se_puede_solicitar) throw new ErrorApp(409, "no_facturable", t.motivo!);
  // La factura le llega al cliente por correo al día siguiente: el correo es obligatorio.
  if (!d.correo?.trim()) throw invalido("Escribe el correo del cliente: ahí le llega su factura.");
  await validarCatalogo(c, "c_RegimenFiscal", d.regimen_fiscal, "El régimen fiscal");
  await validarCatalogo(c, "c_UsoCFDI", d.uso_cfdi, "El uso de CFDI");
  const cliente = (await c.query("SELECT id FROM cliente WHERE rfc = $1 AND activo ORDER BY clave LIMIT 1", [rfc])).rows[0];
  const s = (await c.query(
    `INSERT INTO solicitud_factura (venta_id, sucursal_id, cliente_id, rfc, razon_social, regimen_fiscal, codigo_postal, uso_cfdi, correo, registrado_por)
     SELECT v.id, v.sucursal_id, $2, $3, $4, $5, $6, $7, $8, $9 FROM venta v WHERE v.id = $1 RETURNING id, folio`,
    [t.id, cliente?.id ?? null, rfc, d.razon_social.trim().toUpperCase(), d.regimen_fiscal, d.codigo_postal, d.uso_cfdi.toUpperCase(), d.correo.trim().toLowerCase(), u.id],
  )).rows[0];
  return { ...s, ticket: t.folio, total: t.neto.total };
}

/** Datos fiscales de un cliente ya registrado (para no capturarlos otra vez). */
export async function datosCliente(c: Cliente, rfc: string) {
  const r = rfc.trim().toUpperCase();
  const cli = (await c.query("SELECT rfc, razon_social, regimen_fiscal, codigo_postal, uso_cfdi, correo FROM cliente WHERE rfc = $1 AND activo ORDER BY clave LIMIT 1", [r])).rows[0];
  if (cli) return { origen: "cliente", ...cli };
  const s = (await c.query("SELECT rfc, razon_social, regimen_fiscal, codigo_postal, uso_cfdi, correo FROM solicitud_factura WHERE rfc = $1 ORDER BY creado_en DESC LIMIT 1", [r])).rows[0];
  return s ? { origen: "solicitud", ...s } : null;
}

export async function cancelarSolicitud(c: Cliente, u: UsuarioActual, id: string, motivo: string) {
  const s = (await c.query("SELECT * FROM solicitud_factura WHERE (id::text = $1 OR folio = upper($1)) FOR UPDATE", [id])).rows[0];
  if (!s) throw noEncontrado("No existe esa solicitud.");
  exigirAlcance(u.alcance, s.sucursal_id);
  if (s.estatus !== "PENDIENTE") throw new ErrorApp(409, "estatus", `La solicitud ya está ${s.estatus.toLowerCase()}.`);
  await c.query("UPDATE solicitud_factura SET estatus = 'CANCELADA', motivo_cancelacion = $2, cancelo_id = $3 WHERE id = $1", [s.id, motivo, u.id]);
  return { folio: s.folio, estatus: "CANCELADA" };
}

export async function listarSolicitudes(c: Cliente, u: UsuarioActual, f: { estatus?: string | null; desde: string; hasta: string }) {
  const hoy = await hoyNegocio(c);
  const plazo = Number((await config(c, "fiscal.dias_entrega_factura")) ?? "1");
  return (await c.query(
    `SELECT sf.id, sf.folio, sf.estatus, sf.enviada_en, ue.usuario AS envio,
            (sf.estatus = 'PENDIENTE' OR sf.estatus = 'FACTURADA' AND sf.enviada_en IS NULL) AND $6::date - v.fecha_negocio > $7 AS atrasada, sf.rfc, sf.razon_social, sf.regimen_fiscal, sf.codigo_postal, sf.uso_cfdi, sf.correo, v.folio AS ticket, v.fecha_negocio::text AS fecha,
            (v.total - v.devuelto)::text AS total, s.clave AS sucursal, e.uuid_cfdi AS uuid, us.usuario AS registro, sf.creado_en
       FROM solicitud_factura sf JOIN venta v ON v.id = sf.venta_id JOIN sucursal s ON s.id = sf.sucursal_id LEFT JOIN cfdi_emitido e ON e.id = sf.cfdi_id
       JOIN usuario us ON us.id = sf.registrado_por LEFT JOIN usuario ue ON ue.id = sf.enviada_por
      WHERE ($1::boolean OR sf.sucursal_id = ANY($2::uuid[])) AND ($3::text IS NULL OR sf.estatus = $3 OR $3 = 'POR_ENVIAR' AND sf.estatus = 'FACTURADA' AND sf.enviada_en IS NULL)
        AND (sf.estatus = 'PENDIENTE' OR sf.estatus = 'FACTURADA' AND sf.enviada_en IS NULL OR v.fecha_negocio BETWEEN $4 AND $5)
      ORDER BY sf.estatus = 'PENDIENTE' DESC, sf.enviada_en IS NULL DESC, sf.creado_en DESC`,
    [u.alcance.todas, u.alcance.sucursales, f.estatus || null, f.desde, f.hasta, hoy, plazo],
  )).rows;
}

/** Registra que la factura ya se le envió al cliente por correo (con su PDF y XML). */
export async function marcarEnviada(c: Cliente, u: UsuarioActual, id: string) {
  const s = (await c.query("SELECT * FROM solicitud_factura WHERE (id::text = $1 OR folio = upper($1)) FOR UPDATE", [id])).rows[0];
  if (!s) throw noEncontrado("No existe esa solicitud.");
  exigirAlcance(u.alcance, s.sucursal_id);
  if (s.estatus !== "FACTURADA") throw new ErrorApp(409, "estatus", "Primero registra la factura de la solicitud.");
  if (s.enviada_en) throw new ErrorApp(409, "estatus", "La factura ya se marcó como enviada.");
  await c.query("UPDATE solicitud_factura SET enviada_en = now(), enviada_por = $2 WHERE id = $1", [s.id, u.id]);
  return { folio: s.folio, correo: s.correo, enviada: true };
}

async function solicitudesPendientes(c: Cliente, u: UsuarioActual, ids: string[]) {
  const ss = (await c.query("SELECT * FROM solicitud_factura WHERE id::text = ANY($1) OR folio = ANY($2) ORDER BY folio FOR UPDATE", [ids, ids.map((x) => x.toUpperCase())])).rows;
  if (ss.length !== new Set(ids.map((x) => x.toUpperCase())).size) throw noEncontrado("Alguna de las solicitudes no existe.");
  for (const s of ss) {
    exigirAlcance(u.alcance, s.sucursal_id);
    if (s.estatus !== "PENDIENTE") throw new ErrorApp(409, "estatus", `La solicitud ${s.folio} ya está ${s.estatus.toLowerCase()}.`);
  }
  if (new Set(ss.map((s) => s.rfc)).size > 1) throw invalido("Las solicitudes son de RFC distintos: cada factura es para un solo cliente.");
  return ss;
}

/** Lo que se captura en el portal del SAT para la factura individual. */
export async function datosParaPortalIndividual(c: Cliente, u: UsuarioActual, ids: string[]) {
  const ss = await solicitudesPendientes(c, u, ids);
  const ts = await cargarTickets(c, "v.id = ANY($1::uuid[])", [ss.map((s) => s.venta_id)]);
  const conceptos = ts.flatMap((t) => conceptosNominativa(t.renglones));
  const s = ss[0];
  return {
    solicitudes: ss.map((x) => x.folio), tickets: ts.map((t) => ({ folio: t.folio, fecha: t.fecha_negocio, neto: vistaNeto(t.neto), facturable: !bloqueo(t), motivo: bloqueo(t) })),
    receptor: { rfc: s.rfc, nombre: s.razon_social, regimen_fiscal: s.regimen_fiscal, codigo_postal: s.codigo_postal, uso_cfdi: s.uso_cfdi, correo: s.correo },
    tipo: "I", metodo_pago: "PUE", forma_pago: formaPagoPredominante(ts.flatMap((t) => t.pagos)), exportacion: "01",
    conceptos: vistaConceptos(conceptos), impuestos: vistaImpuestos(conceptos), totales: vistaNeto(sumar(ts.map((t) => t.neto))),
    faltan_datos: [...new Set(conceptos.filter((x) => !x.claveProdServ || !x.claveUnidad || !x.objetoImp).map((x) => x.noIdentificacion))],
  };
}

// ---------------------------------------------------------------------------
// Factura global diaria
// ---------------------------------------------------------------------------
async function sucursalPorClave(c: Cliente, u: UsuarioActual, clave: string | null | undefined) {
  if (!clave) {
    if (!u.alcance.todas) throw prohibido("Elige tu sucursal: solo quien ve todas las sucursales hace la global de toda la empresa.");
    return null;
  }
  const s = (await c.query("SELECT id, clave FROM sucursal WHERE clave = upper($1)", [clave])).rows[0];
  if (!s) throw noEncontrado(`No existe la sucursal ${clave}.`);
  exigirAlcance(u.alcance, s.id);
  return s as { id: string; clave: string };
}

async function ticketsGlobal(c: Cliente, fecha: string, sucursalId: string | null) {
  const ts = await cargarTickets(c, "v.fecha_negocio = $1 AND ($2::uuid IS NULL OR v.sucursal_id = $2)", [fecha, sucursalId]);
  return {
    incluir: ts.filter((t) => !bloqueo(t) && !t.solicitud),
    conSolicitud: ts.filter((t) => !bloqueo(t) && t.solicitud),
    facturados: ts.filter((t) => t.cfdi),
    devueltos: ts.filter((t) => !t.cfdi && t.neto.total.lte(0)),
  };
}

export async function datosParaPortalGlobal(c: Cliente, u: UsuarioActual, fecha: string, sucursal?: string | null) {
  const s = await sucursalPorClave(c, u, sucursal);
  const g = await ticketsGlobal(c, fecha, s?.id ?? null);
  const conceptos = conceptosGlobal(g.incluir.map((t) => ({ folio: t.folio, renglones: t.renglones })));
  const ya = (await c.query(
    "SELECT uuid_cfdi, total::text, estatus FROM cfdi_emitido WHERE clase = 'GLOBAL' AND estatus <> 'CANCELADA' AND fecha_negocio = $1 AND ($2::uuid IS NULL OR sucursal_id IS NULL OR sucursal_id = $2)",
    [fecha, s?.id ?? null],
  )).rows;
  return {
    fecha, sucursal: s?.clave ?? null,
    receptor: { rfc: RFC_PUBLICO_GENERAL, nombre: "PUBLICO EN GENERAL", regimen_fiscal: "616", uso_cfdi: "S01" },
    informacion_global: { periodicidad: "01", meses: fecha.slice(5, 7), anio: Number(fecha.slice(0, 4)) },
    tipo: "I", metodo_pago: "PUE", forma_pago: formaPagoPredominante(g.incluir.flatMap((t) => t.pagos)), exportacion: "01",
    conceptos: vistaConceptos(conceptos), impuestos: vistaImpuestos(conceptos), totales: vistaNeto(sumar(g.incluir.map((t) => t.neto))),
    tickets: g.incluir.length,
    con_solicitud: g.conSolicitud.map((t) => ({ folio: t.folio, solicitud: t.solicitud!.folio, total: m2(t.neto.total) })),
    ya_facturados: g.facturados.length, devueltos: g.devueltos.length, globales_registradas: ya,
  };
}

// ---------------------------------------------------------------------------
// Registro del XML descargado del portal
// ---------------------------------------------------------------------------
export type Clase = "NOMINATIVA" | "GLOBAL" | "EGRESO";
export interface Registro { clase: Clase; xml: string; solicitudes?: string[]; fecha?: string | null; sucursal?: string | null }

interface Preparado {
  cfdi: Cfdi; errores: string[]; avisos: string[]; tickets: Ticket[]; solicitudes: any[]; relacionado: any | null;
  fechaNegocio: string; sucursalId: string | null; esperado: Neto | null;
}

async function preparar(c: Cliente, u: UsuarioActual, d: Registro): Promise<Preparado> {
  const cfdi = leerCfdi(d.xml, MAX_XML);
  const errores: string[] = [];
  const avisos: string[] = [];
  const tol = new D((await config(c, "fiscal.tolerancia_importe")) ?? "0");
  if (cfdi.version !== "4.0") errores.push(`La factura es versión ${cfdi.version}; las que se emiten hoy son versión 4.0.`);
  if (cfdi.moneda !== "MXN") errores.push(`La factura está en ${cfdi.moneda}; solo se registran facturas en pesos (MXN).`);
  const rfcEmpresa = ((await config(c, "empresa.rfc")) ?? "").trim().toUpperCase();
  if (rfcEmpresa && cfdi.emisorRfc !== rfcEmpresa) errores.push(`La factura no la emitió la empresa (RFC emisor ${cfdi.emisorRfc}; el de la empresa es ${rfcEmpresa}).`);
  if (cfdi.retenciones.gt(0)) errores.push("La factura trae retenciones: la empresa es persona física y no retiene (P56).");
  const ya = (await c.query("SELECT clase, estatus FROM cfdi_emitido WHERE uuid_cfdi = $1", [cfdi.uuid])).rows[0];
  if (ya) errores.push(`Esa factura (UUID ${cfdi.uuid}) ya está registrada.`);
  const fechaEmision = cfdi.fecha.slice(0, 10);
  let tickets: Ticket[] = [];
  let solicitudes: any[] = [];
  let relacionado: any = null;
  let fechaNegocio = fechaEmision;
  let sucursalId: string | null = null;
  let esperado: Neto | null = null;

  if (d.clase === "NOMINATIVA" || d.clase === "GLOBAL") {
    if (cfdi.tipo !== "I") errores.push(`El comprobante es de tipo ${cfdi.tipo}; una factura de venta es de ingreso (I).`);
    if (cfdi.metodoPago && cfdi.metodoPago !== "PUE") avisos.push(`El método de pago es ${cfdi.metodoPago}; las ventas de mostrador se pagan en una sola exhibición (PUE).`);
  }

  if (d.clase === "NOMINATIVA") {
    if (!d.solicitudes?.length) throw invalido("Indica la solicitud (o solicitudes) que ampara la factura.");
    solicitudes = await solicitudesPendientes(c, u, d.solicitudes);
    const s = solicitudes[0];
    if (cfdi.receptorRfc !== s.rfc) errores.push(`La factura es para el RFC ${cfdi.receptorRfc}, pero la solicitud es del RFC ${s.rfc}.`);
    if (cfdi.regimenReceptor && cfdi.regimenReceptor !== s.regimen_fiscal) avisos.push(`El régimen del receptor en la factura (${cfdi.regimenReceptor}) no es el de la solicitud (${s.regimen_fiscal}).`);
    if (cfdi.usoCfdi && cfdi.usoCfdi !== s.uso_cfdi) avisos.push(`El uso de CFDI de la factura (${cfdi.usoCfdi}) no es el de la solicitud (${s.uso_cfdi}).`);
    if (cfdi.cpReceptor && cfdi.cpReceptor !== s.codigo_postal) avisos.push(`El código postal del receptor (${cfdi.cpReceptor}) no es el de la solicitud (${s.codigo_postal}).`);
    tickets = await cargarTickets(c, "v.id = ANY($1::uuid[])", [solicitudes.map((x) => x.venta_id)]);
    sucursalId = tickets[0]!.sucursal_id;
  }

  if (d.clase === "GLOBAL") {
    if (cfdi.receptorRfc !== RFC_PUBLICO_GENERAL) errores.push(`La factura global es para público en general (RFC ${RFC_PUBLICO_GENERAL}); esta es para ${cfdi.receptorRfc}.`);
    if (!cfdi.informacionGlobal) errores.push("Al XML le falta la Información global (periodicidad, meses y año).");
    else if (cfdi.informacionGlobal.periodicidad !== "01") errores.push(`La factura global es diaria (periodicidad 01); esta trae la periodicidad ${cfdi.informacionGlobal.periodicidad}.`);
    // Los tickets se identifican por el folio que trae cada concepto; si ninguno lo trae, son los del día indicado.
    const folios = [...new Set(cfdi.conceptos.map((x) => x.noIdentificacion?.trim().toUpperCase()).filter((x): x is string => !!x))];
    const porFolio = folios.length ? await cargarTickets(c, "v.folio = ANY($1)", [folios]) : [];
    if (porFolio.length) {
      const encontrados = new Set(porFolio.map((t) => t.folio));
      const otros = folios.filter((f) => !encontrados.has(f));
      if (otros.length) errores.push(`Conceptos con un número de identificación que no es un ticket: ${otros.slice(0, 10).join(", ")}${otros.length > 10 ? "…" : ""}.`);
      tickets = porFolio;
      const fechas = [...new Set(tickets.map((t) => t.fecha_negocio))];
      if (fechas.length > 1) errores.push(`La factura global es diaria y trae tickets de varios días: ${fechas.join(", ")}.`);
      fechaNegocio = fechas[0]!;
      for (const t of tickets) {
        if (t.solicitud?.estatus === "PENDIENTE") errores.push(`El ticket ${t.folio} tiene la solicitud de factura ${t.solicitud.folio}: se factura aparte, no en la global.`);
      }
      // Cada ticket con su importe.
      const porTicket = new Map<string, Dec>();
      for (const x of cfdi.conceptos) {
        const f = x.noIdentificacion?.trim().toUpperCase();
        if (f) porTicket.set(f, (porTicket.get(f) ?? new D(0)).plus(x.importe).minus(x.descuento).plus(x.iva).plus(x.ieps));
      }
      for (const t of tickets) {
        const f = porTicket.get(t.folio)!;
        if (f.minus(t.neto.total).abs().gt(tol)) errores.push(`El ticket ${t.folio} es de $${m2(t.neto.total)} y en la factura suma $${m2(f)}.`);
      }
      const sucs = [...new Set(tickets.map((t) => t.sucursal_id))];
      sucursalId = sucs.length === 1 ? sucs[0]! : null;
      if (d.sucursal) {
        const s = await sucursalPorClave(c, u, d.sucursal);
        if (tickets.some((t) => t.sucursal_id !== s!.id)) errores.push(`La factura trae tickets de otra sucursal, no solo de ${s!.clave}.`);
      }
    } else {
      if (!d.fecha) throw invalido("Los conceptos no traen el folio de cada ticket: indica el día de la factura global.");
      const s = await sucursalPorClave(c, u, d.sucursal);
      fechaNegocio = d.fecha;
      sucursalId = s?.id ?? null;
      tickets = (await ticketsGlobal(c, d.fecha, sucursalId)).incluir;
      if (!tickets.length) errores.push(`No hay tickets por facturar del ${d.fecha}.`);
    }
    if (cfdi.informacionGlobal && fechaNegocio) {
      if (Number(cfdi.informacionGlobal.meses) !== Number(fechaNegocio.slice(5, 7)) || cfdi.informacionGlobal.anio !== Number(fechaNegocio.slice(0, 4))) {
        errores.push(`La información global (mes ${cfdi.informacionGlobal.meses}, año ${cfdi.informacionGlobal.anio}) no corresponde al día de los tickets (${fechaNegocio}).`);
      }
    }
  }

  if (d.clase === "NOMINATIVA" || d.clase === "GLOBAL") {
    for (const t of tickets) {
      exigirAlcance(u.alcance, t.sucursal_id);
      const b = bloqueo(t);
      if (b) errores.push(b);
    }
    esperado = sumar(tickets.map((t) => t.neto));
    for (const x of cotejar(esperado, cfdi, tol)) errores.push(`${x.campo}: los tickets suman $${m2(x.esperado)} y la factura dice $${m2(x.factura)}.`);
  }

  if (d.clase === "EGRESO") {
    if (cfdi.tipo !== "E") errores.push(`El comprobante es de tipo ${cfdi.tipo}; una nota de crédito es de egreso (E).`);
    const uuids = cfdi.relacionados.flatMap((r) => r.uuids);
    if (!uuids.length) errores.push("La nota de crédito no trae la factura que corrige (CFDI relacionados).");
    relacionado = uuids.length ? (await c.query("SELECT * FROM cfdi_emitido WHERE uuid_cfdi = ANY($1) AND clase <> 'EGRESO' ORDER BY creado_en LIMIT 1", [uuids])).rows[0] ?? null : null;
    if (uuids.length && !relacionado) errores.push("La factura que corrige la nota de crédito no está registrada en el sistema: súbela primero.");
    if (relacionado) {
      exigirAlcance(u.alcance, relacionado.sucursal_id);
      if (relacionado.estatus === "CANCELADA") errores.push("La factura relacionada está cancelada.");
      if (relacionado.receptor_rfc !== cfdi.receptorRfc) errores.push(`La nota de crédito es para ${cfdi.receptorRfc} y la factura relacionada es de ${relacionado.receptor_rfc}.`);
      if (cfdi.total.gt(relacionado.total)) errores.push("La nota de crédito es mayor que la factura que corrige.");
      sucursalId = relacionado.sucursal_id;
    }
  }
  return { cfdi, errores, avisos, tickets, solicitudes, relacionado, fechaNegocio, sucursalId, esperado };
}

const vistaPreparado = (p: Preparado) => ({
  uuid: p.cfdi.uuid, serie: p.cfdi.serie, folio: p.cfdi.folio, fecha: p.cfdi.fecha, tipo: p.cfdi.tipo, receptor_rfc: p.cfdi.receptorRfc, receptor_nombre: p.cfdi.receptorNombre,
  subtotal: m2(p.cfdi.subtotal), descuento: m2(p.cfdi.descuento), iva: m2(p.cfdi.iva), ieps: m2(p.cfdi.ieps), total: m2(p.cfdi.total), forma_pago: p.cfdi.formaPago, metodo_pago: p.cfdi.metodoPago,
  fecha_negocio: p.fechaNegocio, tickets: p.tickets.map((t) => ({ folio: t.folio, fecha: t.fecha_negocio, total: m2(t.neto.total) })),
  esperado: p.esperado ? vistaNeto(p.esperado) : null, solicitudes: p.solicitudes.map((s) => s.folio), relacionado: p.relacionado?.uuid_cfdi ?? null,
  errores: p.errores, avisos: p.avisos, se_puede_registrar: !p.errores.length,
});

export async function revisarXml(c: Cliente, u: UsuarioActual, d: Registro) {
  return vistaPreparado(await preparar(c, u, d));
}

export async function registrarXml(c: Cliente, u: UsuarioActual, d: Registro) {
  // Una sola factura a la vez: evita que dos personas liguen los mismos tickets.
  await c.query("SELECT pg_advisory_xact_lock(hashtext('cfdi_emitido'))");
  const p = await preparar(c, u, d);
  if (p.errores.length) throw invalido("La factura no se puede registrar.", p.errores.map((mensaje) => ({ campo: "xml", mensaje })));
  const x = p.cfdi;
  const e = (await c.query(
    `INSERT INTO cfdi_emitido (uuid_cfdi, clase, tipo_comprobante, serie, folio, fecha_emision, fecha_negocio, sucursal_id, receptor_rfc, receptor_nombre, regimen_receptor, uso_cfdi,
       metodo_pago, forma_pago, subtotal, descuento, iva, ieps, total, global_periodicidad, global_meses, global_anio, relacionado_id, tipo_relacion, xml, xml_sha256, registrado_por)
     VALUES ($1, $2, $3, $4, $5, ($6::timestamp AT TIME ZONE 'America/Mexico_City'), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
     RETURNING id`,
    [x.uuid, d.clase, x.tipo, x.serie, x.folio, x.fecha.slice(0, 19), p.fechaNegocio, p.sucursalId, x.receptorRfc, x.receptorNombre, x.regimenReceptor, x.usoCfdi,
      x.metodoPago, x.formaPago, m2(x.subtotal), m2(x.descuento), m2(x.iva), m2(x.ieps), m2(x.total), x.informacionGlobal?.periodicidad ?? null, x.informacionGlobal?.meses ?? null,
      x.informacionGlobal?.anio ?? null, p.relacionado?.id ?? null, x.relacionados[0]?.tipoRelacion ?? null, d.xml, createHash("sha256").update(d.xml).digest("hex"), u.id],
  )).rows[0];
  for (const t of p.tickets) {
    await c.query("INSERT INTO cfdi_venta (cfdi_id, venta_id, base, ieps, iva, total) VALUES ($1, $2, $3, $4, $5, $6)",
      [e.id, t.id, m2(t.neto.base), m2(t.neto.ieps), m2(t.neto.iva), m2(t.neto.total)]);
  }
  for (const s of p.solicitudes) await c.query("UPDATE solicitud_factura SET estatus = 'FACTURADA', cfdi_id = $2 WHERE id = $1", [s.id, e.id]);
  return { id: e.id, ...vistaPreparado(p) };
}

// ---------------------------------------------------------------------------
// Consulta de facturas y cancelaciones
// ---------------------------------------------------------------------------
export async function listarCfdis(c: Cliente, u: UsuarioActual, f: { desde: string; hasta: string; clase?: string | null; estatus?: string | null }) {
  return (await c.query(
    `SELECT e.id, e.uuid_cfdi AS uuid, e.clase, e.serie, e.folio, e.fecha_emision, e.fecha_negocio::text, s.clave AS sucursal, e.receptor_rfc, e.receptor_nombre,
            e.subtotal::text, e.iva::text, e.ieps::text, e.total::text, e.estatus, r.uuid_cfdi AS relacionado,
            (SELECT count(*)::int FROM cfdi_venta cv WHERE cv.cfdi_id = e.id) AS tickets, u.usuario AS registro
       FROM cfdi_emitido e LEFT JOIN sucursal s ON s.id = e.sucursal_id LEFT JOIN cfdi_emitido r ON r.id = e.relacionado_id JOIN usuario u ON u.id = e.registrado_por
      WHERE ($1::boolean OR e.sucursal_id = ANY($2::uuid[])) AND e.fecha_negocio BETWEEN $3 AND $4 AND ($5::text IS NULL OR e.clase = $5) AND ($6::text IS NULL OR e.estatus = $6)
      ORDER BY e.fecha_negocio DESC, e.creado_en DESC`,
    [u.alcance.todas, u.alcance.sucursales, f.desde, f.hasta, f.clase || null, f.estatus || null],
  )).rows;
}

async function cfdiVisible(c: Cliente, u: UsuarioActual, id: string, bloquear = false) {
  const e = (await c.query(`SELECT * FROM cfdi_emitido WHERE id::text = $1 OR uuid_cfdi = upper($1)${bloquear ? " FOR UPDATE" : ""}`, [id])).rows[0];
  if (!e) throw noEncontrado("No existe esa factura.");
  exigirAlcance(u.alcance, e.sucursal_id);
  return e;
}

export async function detalleCfdi(c: Cliente, u: UsuarioActual, id: string) {
  const e = await cfdiVisible(c, u, id);
  const tickets = (await c.query(
    `SELECT v.folio, v.fecha_negocio::text AS fecha, cv.base::text, cv.ieps::text, cv.iva::text, cv.total::text, cv.vigente, (v.total - v.devuelto)::text AS neto_actual
       FROM cfdi_venta cv JOIN venta v ON v.id = cv.venta_id WHERE cv.cfdi_id = $1 ORDER BY v.folio`,
    [e.id],
  )).rows;
  const notas = (await c.query("SELECT uuid_cfdi AS uuid, total::text, estatus, fecha_negocio::text AS fecha FROM cfdi_emitido WHERE relacionado_id = $1 ORDER BY creado_en", [e.id])).rows;
  const usuarios = (await c.query("SELECT id, usuario FROM usuario WHERE id = ANY($1::uuid[])", [[e.registrado_por, e.cancelacion_solicito_id, e.cancelacion_autorizo_id].filter(Boolean)])).rows;
  const nombre = (x: string | null) => usuarios.find((y) => y.id === x)?.usuario ?? null;
  const { xml: _xml, ...resto } = e;
  return {
    cfdi: { ...resto, fecha_negocio: e.fecha_negocio instanceof Date ? e.fecha_negocio.toISOString().slice(0, 10) : e.fecha_negocio, registro: nombre(e.registrado_por),
      cancelacion_solicito: nombre(e.cancelacion_solicito_id), cancelacion_autorizo: nombre(e.cancelacion_autorizo_id),
      cancelacion_motivo_texto: e.cancelacion_motivo_sat ? MOTIVOS_CANCELACION[e.cancelacion_motivo_sat] : null },
    tickets, notas,
  };
}

export async function xmlCfdi(c: Cliente, u: UsuarioActual, id: string) {
  const e = await cfdiVisible(c, u, id);
  return { uuid: e.uuid_cfdi as string, xml: e.xml as string };
}

/** El contador registra que canceló la factura en el portal del SAT; queda por autorizar. */
export async function solicitarCancelacion(c: Cliente, u: UsuarioActual, id: string, d: { motivo_sat: string; uuid_sustitucion?: string | null; nota: string }) {
  const e = await cfdiVisible(c, u, id, true);
  if (e.estatus !== "VIGENTE") throw new ErrorApp(409, "estatus", e.estatus === "CANCELADA" ? "La factura ya está cancelada." : "La cancelación ya está registrada y espera autorización.");
  if (!MOTIVOS_CANCELACION[d.motivo_sat]) throw invalido("Motivo de cancelación del SAT no válido (01, 02, 03 o 04).");
  const sust = d.uuid_sustitucion?.trim().toUpperCase() || null;
  if (d.motivo_sat === "01" && !sust) throw invalido("Con el motivo 01 indica el UUID de la factura que la sustituye.");
  if (sust && !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(sust)) throw invalido("El UUID de sustitución no es válido.");
  if (sust === e.uuid_cfdi) throw invalido("La factura no se sustituye a sí misma.");
  await c.query(
    "UPDATE cfdi_emitido SET estatus = 'CANCELACION_POR_AUTORIZAR', cancelacion_motivo_sat = $2, cancelacion_uuid_sustitucion = $3, cancelacion_nota = $4, cancelacion_solicito_id = $5 WHERE id = $1",
    [e.id, d.motivo_sat, sust, d.nota, u.id],
  );
  return { uuid: e.uuid_cfdi, estatus: "CANCELACION_POR_AUTORIZAR" };
}

/** El contralor autoriza (o rechaza) la cancelación. Al autorizar, sus tickets se pueden volver a facturar. */
export async function resolverCancelacion(c: Cliente, u: UsuarioActual, id: string, autorizar: boolean, nota?: string | null) {
  const e = await cfdiVisible(c, u, id, true);
  if (e.estatus !== "CANCELACION_POR_AUTORIZAR") throw new ErrorApp(409, "estatus", "La factura no tiene una cancelación por autorizar.");
  if (e.cancelacion_solicito_id === u.id) throw prohibido("Quien registra la cancelación no puede autorizarla.");
  if (!autorizar) {
    await c.query(
      `UPDATE cfdi_emitido SET estatus = 'VIGENTE', cancelacion_motivo_sat = NULL, cancelacion_uuid_sustitucion = NULL,
         cancelacion_nota = coalesce(cancelacion_nota, '') || ' · Rechazada: ' || coalesce($2, 'sin motivo'), cancelacion_solicito_id = NULL WHERE id = $1`,
      [e.id, nota ?? null],
    );
    return { uuid: e.uuid_cfdi, estatus: "VIGENTE" };
  }
  await c.query("UPDATE cfdi_emitido SET estatus = 'CANCELADA', cancelacion_autorizo_id = $2, cancelado_en = now() WHERE id = $1", [e.id, u.id]);
  await c.query("UPDATE cfdi_venta SET vigente = false WHERE cfdi_id = $1 AND vigente", [e.id]);
  // Las solicitudes vuelven a pendientes: se factura otra vez (normalmente con la factura que sustituye).
  const ss = (await c.query("UPDATE solicitud_factura SET estatus = 'PENDIENTE', cfdi_id = NULL, enviada_en = NULL, enviada_por = NULL WHERE cfdi_id = $1 RETURNING folio", [e.id])).rows;
  return { uuid: e.uuid_cfdi, estatus: "CANCELADA", solicitudes_pendientes: ss.map((s) => s.folio) };
}

// ---------------------------------------------------------------------------
// Conciliación: lo vendido contra lo facturado
// ---------------------------------------------------------------------------
export async function conciliacion(c: Cliente, u: UsuarioActual, desde: string, hasta: string) {
  const hoy = await hoyNegocio(c);
  const dias = (await c.query(
    `SELECT v.fecha_negocio::text AS fecha, s.clave AS sucursal, count(*)::int AS tickets, sum(v.total - v.devuelto)::text AS vendido,
            coalesce(sum(cv.total) FILTER (WHERE e.clase = 'NOMINATIVA'), 0)::text AS individual,
            coalesce(sum(cv.total) FILTER (WHERE e.clase = 'GLOBAL'), 0)::text AS global,
            count(*) FILTER (WHERE cv.venta_id IS NULL AND v.total - v.devuelto > 0)::int AS sin_facturar,
            coalesce(sum(v.total - v.devuelto) FILTER (WHERE cv.venta_id IS NULL), 0)::text AS importe_sin_facturar,
            count(*) FILTER (WHERE sf.estatus = 'PENDIENTE')::int AS solicitudes_pendientes,
            count(*) FILTER (WHERE cv.venta_id IS NULL AND v.total - v.devuelto > 0 AND sf.id IS NULL)::int AS para_global,
            coalesce(sum(v.total - v.devuelto) FILTER (WHERE cv.venta_id IS NULL AND sf.id IS NULL), 0)::text AS importe_para_global
       FROM venta v JOIN sucursal s ON s.id = v.sucursal_id
       LEFT JOIN cfdi_venta cv ON cv.venta_id = v.id AND cv.vigente LEFT JOIN cfdi_emitido e ON e.id = cv.cfdi_id
       LEFT JOIN solicitud_factura sf ON sf.venta_id = v.id AND sf.estatus = 'PENDIENTE'
      WHERE v.fecha_negocio BETWEEN $3 AND $4 AND ($1::boolean OR v.sucursal_id = ANY($2::uuid[]))
      GROUP BY v.fecha_negocio, s.clave ORDER BY v.fecha_negocio, s.clave`,
    [u.alcance.todas, u.alcance.sucursales, desde, hasta],
  )).rows.map((r) => ({ ...r, pendiente_del_dia: r.fecha >= hoy }));
  // Tickets facturados que después tuvieron devolución: requieren nota de crédito (CFDI de egreso) en el portal.
  const devoluciones = (await c.query(
    `SELECT v.folio, v.fecha_negocio::text AS fecha, e.uuid_cfdi AS uuid, e.clase, cv.total::text AS facturado, (v.total - v.devuelto)::text AS neto_actual,
            (cv.total - (v.total - v.devuelto))::text AS por_acreditar,
            coalesce((SELECT sum(n.total) FROM cfdi_emitido n WHERE n.relacionado_id = e.id AND n.estatus <> 'CANCELADA'), 0)::text AS notas
       FROM cfdi_venta cv JOIN venta v ON v.id = cv.venta_id JOIN cfdi_emitido e ON e.id = cv.cfdi_id
      WHERE cv.vigente AND cv.total > v.total - v.devuelto AND v.fecha_negocio BETWEEN $3 AND $4 AND ($1::boolean OR v.sucursal_id = ANY($2::uuid[]))
      ORDER BY v.fecha_negocio, v.folio`,
    [u.alcance.todas, u.alcance.sucursales, desde, hasta],
  )).rows;
  const cancelaciones = (await c.query(
    `SELECT e.uuid_cfdi AS uuid, e.clase, e.total::text, e.cancelacion_motivo_sat AS motivo, us.usuario AS solicito FROM cfdi_emitido e JOIN usuario us ON us.id = e.cancelacion_solicito_id
      WHERE e.estatus = 'CANCELACION_POR_AUTORIZAR' AND ($1::boolean OR e.sucursal_id = ANY($2::uuid[]))`,
    [u.alcance.todas, u.alcance.sucursales],
  )).rows;
  const t = (k: string) => m2(dias.reduce((s, r) => s.plus(r[k]), new D(0)));
  return {
    desde, hasta, dias,
    totales: { vendido: t("vendido"), individual: t("individual"), global: t("global"), importe_sin_facturar: t("importe_sin_facturar") },
    alertas: {
      dias_sin_global: dias.filter((r) => r.para_global > 0 && !r.pendiente_del_dia).map((r) => ({ fecha: r.fecha, sucursal: r.sucursal, tickets: r.para_global, importe: r.importe_para_global })),
      solicitudes_atrasadas: (await listarSolicitudes(c, u, { desde, hasta })).filter((s) => s.atrasada).map((s) => ({ folio: s.folio, ticket: s.ticket, fecha: s.fecha, rfc: s.rfc, correo: s.correo, estatus: s.estatus })),
      devoluciones_sin_nota: devoluciones.filter((x) => new D(x.notas).lt(x.por_acreditar)),
      cancelaciones_por_autorizar: cancelaciones,
    },
  };
}

// ---------------------------------------------------------------------------
// XML de PRUEBA (solo en el ambiente de pruebas): imita lo que se descarga del
// portal para poder ensayar el registro. No está timbrado por el SAT.
// ---------------------------------------------------------------------------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function xmlDePrueba(d: {
  emisorRfc: string; tipo: "I" | "E"; receptor: { rfc: string; nombre: string; regimen: string; cp: string; uso: string };
  conceptos: ReturnType<typeof vistaConceptos>; formaPago: string | null; informacionGlobal?: { periodicidad: string; meses: string; anio: number } | null;
  relacionado?: { tipo: string; uuid: string } | null; fecha: string;
}) {
  const sub = d.conceptos.reduce((s, x) => s.plus(x.importe), new D(0));
  const imp = resumenImpuestos(d.conceptos.map((x) => ({ ...x, traslados: x.traslados.map((t) => ({ impuesto: t.impuesto as "IVA" | "IEPS", tasa: new D(t.tasa), base: new D(t.base), importe: new D(t.importe) })) } as any)));
  const tras = imp.reduce((s, t) => s.plus(t.importe), new D(0));
  const codigo = (i: string) => (i === "IVA" ? "002" : "003");
  const t = (x: { impuesto: string; tasa: string | Dec; base: string | Dec; importe: string | Dec }) =>
    `<cfdi:Traslado Base="${m2(x.base)}" Impuesto="${codigo(x.impuesto)}" TipoFactor="Tasa" TasaOCuota="${new D(x.tasa).toFixed(6)}" Importe="${m2(x.importe)}"/>`;
  const uuid = randomUUID().toUpperCase();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!-- DATOS FICTICIOS (PRUEBA): generado por el sistema para ensayar; no es una factura real ni está timbrada por el SAT. -->",
    `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="PRUEBA" Folio="${Date.now() % 100000}" Fecha="${d.fecha}" SubTotal="${m2(sub)}" Moneda="MXN" Total="${m2(sub.plus(tras))}" TipoDeComprobante="${d.tipo}" Exportacion="01" MetodoPago="PUE"${d.formaPago ? ` FormaPago="${d.formaPago}"` : ""} LugarExpedicion="00000">`,
    d.informacionGlobal ? `  <cfdi:InformacionGlobal Periodicidad="${d.informacionGlobal.periodicidad}" Meses="${d.informacionGlobal.meses}" Año="${d.informacionGlobal.anio}"/>` : "",
    d.relacionado ? `  <cfdi:CfdiRelacionados TipoRelacion="${d.relacionado.tipo}"><cfdi:CfdiRelacionado UUID="${d.relacionado.uuid}"/></cfdi:CfdiRelacionados>` : "",
    `  <cfdi:Emisor Rfc="${esc(d.emisorRfc)}" Nombre="PRUEBA EMISOR" RegimenFiscal="612"/>`,
    `  <cfdi:Receptor Rfc="${esc(d.receptor.rfc)}" Nombre="${esc(d.receptor.nombre)}" DomicilioFiscalReceptor="${d.receptor.cp}" RegimenFiscalReceptor="${d.receptor.regimen}" UsoCFDI="${d.receptor.uso}"/>`,
    "  <cfdi:Conceptos>",
    ...d.conceptos.map((x) => `    <cfdi:Concepto ClaveProdServ="${x.clave_prod_serv ?? "01010101"}" NoIdentificacion="${esc(x.no_identificacion)}" Cantidad="${x.cantidad}" ClaveUnidad="${x.clave_unidad ?? "H87"}" Descripcion="${esc(x.descripcion)}" ValorUnitario="${x.valor_unitario}" Importe="${x.importe}" ObjetoImp="${x.objeto_imp ?? "02"}"><cfdi:Impuestos><cfdi:Traslados>${x.traslados.map(t).join("")}</cfdi:Traslados></cfdi:Impuestos></cfdi:Concepto>`),
    "  </cfdi:Conceptos>",
    `  <cfdi:Impuestos TotalImpuestosTrasladados="${m2(tras)}"><cfdi:Traslados>${imp.map(t).join("")}</cfdi:Traslados></cfdi:Impuestos>`,
    `  <cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="${d.fecha}" RfcProvCertif="SAT970701NN3" NoCertificadoSAT="00000000000000000000" SelloCFD="PRUEBA" SelloSAT="PRUEBA"/></cfdi:Complemento>`,
    "</cfdi:Comprobante>",
  ].filter(Boolean).join("\n");
}

export async function generarXmlPrueba(c: Cliente, u: UsuarioActual, d: { clase: Clase; solicitudes?: string[]; fecha?: string | null; sucursal?: string | null; relacionado?: string | null; importe?: string | null }) {
  const emisorRfc = ((await config(c, "empresa.rfc")) ?? "").trim().toUpperCase() || "EKU9003173C9";
  const ahora = (await c.query("SELECT to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD\"T\"HH24:MI:SS') AS f")).rows[0].f as string;
  if (d.clase === "NOMINATIVA") {
    const p = await datosParaPortalIndividual(c, u, d.solicitudes ?? []);
    return xmlDePrueba({ emisorRfc, tipo: "I", fecha: ahora, formaPago: p.forma_pago, conceptos: p.conceptos,
      receptor: { rfc: p.receptor.rfc, nombre: p.receptor.nombre, regimen: p.receptor.regimen_fiscal, cp: p.receptor.codigo_postal, uso: p.receptor.uso_cfdi } });
  }
  if (d.clase === "GLOBAL") {
    if (!d.fecha) throw invalido("Indica el día.");
    const p = await datosParaPortalGlobal(c, u, d.fecha, d.sucursal);
    if (!p.conceptos.length) throw invalido(`No hay tickets por facturar del ${d.fecha}.`);
    return xmlDePrueba({ emisorRfc, tipo: "I", fecha: ahora, formaPago: p.forma_pago, conceptos: p.conceptos, informacionGlobal: p.informacion_global,
      receptor: { rfc: RFC_PUBLICO_GENERAL, nombre: "PUBLICO EN GENERAL", regimen: "616", cp: "00000", uso: "S01" } });
  }
  const r = await cfdiVisible(c, u, d.relacionado ?? "");
  const importe = new D(d.importe ?? "0");
  if (importe.lte(0)) throw invalido("Indica el importe de la nota de crédito.");
  return xmlDePrueba({ emisorRfc, tipo: "E", fecha: ahora, formaPago: r.forma_pago, relacionado: { tipo: "01", uuid: r.uuid_cfdi },
    receptor: { rfc: r.receptor_rfc, nombre: r.receptor_nombre ?? "", regimen: r.regimen_receptor ?? "616", cp: "00000", uso: r.receptor_rfc === RFC_PUBLICO_GENERAL ? "S01" : "G02" },
    conceptos: [{ clave_prod_serv: "84111506", no_identificacion: "DEVOLUCION", cantidad: "1", clave_unidad: "ACT", unidad: null, descripcion: "Devolución de mercancía",
      valor_unitario: m2(importe), importe: m2(importe), objeto_imp: "02", traslados: [{ impuesto: "IVA", tasa: "0.000000", base: m2(importe), importe: "0.00" }] }] });
}
