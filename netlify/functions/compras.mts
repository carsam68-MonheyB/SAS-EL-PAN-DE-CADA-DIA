// Compras (Fase 4): autorizaciones, requisiciones, órdenes de compra,
// recepciones, facturas XML con cotejo a 3 vías, cuentas por pagar, pagos,
// antigüedad de saldos y comparativo de precios. Cada acción valida su permiso.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { antiguedad } from "../../src/dominio/compras";
import { D } from "../../src/dominio/recetas";
import {
  cancelarOC, cancelarPago, cancelarRequisicion, crearOC, crearRequisicion, enviarRequisicion, marcarPagado, pendientes, programarPago,
  recibir, registrarFactura, resolver, revisarFactura,
} from "../../src/servidor/compras";
import { invalido, noEncontrado } from "../../src/servidor/errores";
import { libroExcel, respuestaExcel } from "../../src/servidor/excel";
import { hoyNegocio } from "../../src/servidor/fechas";
import { leerCuerpo } from "../../src/servidor/http";
import { ruta } from "../../src/servidor/ruta";
import type { Cliente } from "../../src/servidor/transaccion";

const VER = ["compras.requisiciones:ver", "compras.ordenes:ver", "compras.recepcion:ver", "compras.facturas:ver", "compras.cxp:ver"];
const NUM = z.string().trim().regex(/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/, "Número no válido (punto decimal).");
const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD.");
const TEXTO = (n: number) => z.string().trim().max(n).optional().nullable();
const MOTIVO = z.object({ motivo: z.string().trim().min(3, "Escribe el motivo.").max(300) });
const RELACIONES = z.array(z.object({ orden: z.number().int().positive(), oc_renglon_id: z.string().uuid().nullable() })).max(500).optional();

async function detalleRequisicion(c: Cliente, id: string) {
  const r = (await c.query(
    `SELECT r.id, r.folio, r.origen, r.estatus, r.requerido_para::text, r.comentario, r.monto_estimado::text, r.creado_en, u.usuario AS solicitante,
            p.folio AS plan, s.clave AS sucursal
       FROM requisicion r JOIN usuario u ON u.id = r.solicitante_id LEFT JOIN plan_produccion p ON p.id = r.plan_id LEFT JOIN sucursal s ON s.id = r.sucursal_id
      WHERE r.id::text = $1 OR r.folio = upper($1)`,
    [id],
  )).rows[0];
  if (!r) throw noEncontrado("No existe esa requisición.");
  const renglones = (await c.query(
    `SELECT rr.id, a.clave AS articulo, a.nombre, u.clave AS unidad, rr.cantidad::text, rr.cantidad_ordenada::text, rr.costo_estimado::text, rr.comentario,
            uc.clave AS unidad_compra, (SELECT au.factor_a_base::text FROM articulo_unidad au WHERE au.articulo_id = a.id AND au.unidad_id = a.unidad_compra_id AND au.activo) AS factor_compra,
            pp.clave AS proveedor_preferente, t.clave AS tasa_iva,
            (SELECT json_agg(json_build_object('proveedor', pv.clave, 'precio', ap.ultimo_precio::text, 'unidad', ua.clave) ORDER BY pv.clave)
               FROM articulo_proveedor ap JOIN proveedor pv ON pv.id = ap.proveedor_id LEFT JOIN unidad ua ON ua.id = ap.unidad_compra_id
              WHERE ap.articulo_id = a.id AND ap.activo) AS precios
       FROM requisicion_renglon rr JOIN articulo a ON a.id = rr.articulo_id JOIN unidad u ON u.id = a.unidad_base_id
       LEFT JOIN unidad uc ON uc.id = a.unidad_compra_id LEFT JOIN proveedor pp ON pp.id = a.proveedor_preferente_id LEFT JOIN tasa_impuesto t ON t.id = a.tasa_iva_id
      WHERE rr.requisicion_id = $1 ORDER BY a.clave`,
    [r.id],
  )).rows;
  const ordenes = (await c.query("SELECT o.id, o.folio, o.estatus, p.clave AS proveedor, o.total::text FROM orden_compra o JOIN proveedor p ON p.id = o.proveedor_id WHERE o.requisicion_id = $1 ORDER BY o.creado_en", [r.id])).rows;
  const firmas = await firmasDe(c, r.id);
  return { ...r, renglones, ordenes, firmas };
}

async function firmasDe(c: Cliente, documentoId: string) {
  return (await c.query(
    `SELECT s.estatus, s.monto::text, s.creado_en, f.decision, f.comentario, f.creado_en AS firmado_en, u.usuario
       FROM solicitud_autorizacion s LEFT JOIN firma_autorizacion f ON f.solicitud_id = s.id LEFT JOIN usuario u ON u.id = f.usuario_id
      WHERE s.documento_id = $1 ORDER BY s.creado_en`,
    [documentoId],
  )).rows;
}

async function detalleOC(c: Cliente, id: string, verCostos: boolean) {
  const o = (await c.query(
    `SELECT o.id, o.folio, o.estatus, o.fecha_entrega::text, o.subtotal::text, o.iva::text, o.total::text, o.autorizado_requisicion::text, o.condiciones, o.comentario,
            o.creado_en, o.motivo_cancelacion, u.usuario AS creado_por, r.folio AS requisicion, a.clave AS almacen, a.nombre AS almacen_nombre,
            p.clave AS proveedor, p.razon_social, p.rfc, p.correo, p.telefono, p.dias_credito, p.condiciones_pago
       FROM orden_compra o JOIN usuario u ON u.id = o.creado_por_id JOIN requisicion r ON r.id = o.requisicion_id
       JOIN almacen a ON a.id = o.almacen_id JOIN proveedor p ON p.id = o.proveedor_id WHERE o.id::text = $1 OR o.folio = upper($1)`,
    [id],
  )).rows[0];
  if (!o) throw noEncontrado("No existe esa orden de compra.");
  const renglones = (await c.query(
    `SELECT r.id, r.orden, ar.clave AS articulo, ar.nombre, ar.maneja_lote, ar.maneja_caducidad, un.clave AS unidad, r.cantidad::text, r.cantidad_recibida::text, r.precio::text,
            r.tasa_iva::text, r.importe::text, r.iva::text, r.factor_base::text, ub.clave AS unidad_base
       FROM oc_renglon r JOIN articulo ar ON ar.id = r.articulo_id JOIN unidad un ON un.id = r.unidad_id JOIN unidad ub ON ub.id = ar.unidad_base_id
      WHERE r.oc_id = $1 ORDER BY r.orden`,
    [o.id],
  )).rows;
  const recepciones = (await c.query(
    `SELECT r.id, r.folio, r.creado_en, r.remision, u.usuario AS recibio, m.folio AS movimiento,
            (SELECT json_agg(json_build_object('articulo', a.clave, 'cantidad', rr.cantidad::text, 'lote', rr.lote, 'caducidad', rr.caducidad))
               FROM recepcion_renglon rr JOIN oc_renglon o ON o.id = rr.oc_renglon_id JOIN articulo a ON a.id = o.articulo_id WHERE rr.recepcion_id = r.id) AS renglones
       FROM recepcion r JOIN usuario u ON u.id = r.recibio_id JOIN movimiento m ON m.id = r.movimiento_id WHERE r.oc_id = $1 ORDER BY r.creado_en`,
    [o.id],
  )).rows;
  const facturas = (await c.query("SELECT id, uuid_cfdi, serie, folio, fecha, total::text, estatus FROM factura_proveedor WHERE oc_id = $1 ORDER BY creado_en", [o.id])).rows;
  const firmas = await firmasDe(c, o.id);
  const base = { ...o, renglones, recepciones, facturas, firmas };
  if (verCostos) return base;
  // El almacenista ve cantidades, no precios.
  return { ...base, subtotal: null, iva: null, total: null, autorizado_requisicion: null, renglones: renglones.map((r) => ({ ...r, precio: null, importe: null, iva: null })), facturas: [] };
}

const manejador = ruta({ permiso: VER }, async (ctx) => {
  const { recurso, id, accion } = ctx.params;
  const m = ctx.req.method;
  const u = ctx.usuario;
  const sp = ctx.url.searchParams;
  const verCostos = ctx.puede(["compras.ordenes:ver", "compras.facturas:ver", "compras.cxp:ver", "datos.costos:ver"]);

  // ---- Autorizaciones ----
  if (recurso === "autorizaciones" && !id && m === "GET") return ctx.tx(async (c) => ({ pendientes: await pendientes(c, u) }));
  if (recurso === "autorizaciones" && id && (accion === "autorizar" || accion === "rechazar") && m === "POST") {
    const d = await leerCuerpo(ctx.req, z.object({ comentario: TEXTO(300) }));
    return ctx.tx((c) => resolver(c, u, id, accion === "autorizar" ? "AUTORIZA" : "RECHAZA", d.comentario ?? null));
  }

  // ---- Opciones para formularios ----
  if (recurso === "opciones" && m === "GET") {
    return ctx.tx(async (c) => ({
      proveedores: (await c.query("SELECT clave, coalesce(nombre_comercial, razon_social) AS nombre, dias_credito FROM proveedor WHERE activo ORDER BY clave")).rows,
      almacenes: (await c.query("SELECT clave, nombre FROM almacen WHERE activo AND tipo IN ('MP', 'INS') ORDER BY clave")).rows,
      tasas_iva: (await c.query("SELECT clave, descripcion, coalesce(tasa, 0)::text AS tasa FROM tasa_impuesto WHERE impuesto = 'IVA' AND activo ORDER BY clave")).rows,
      insumos: (await c.query("SELECT a.clave, a.nombre, u.clave AS unidad, uc.clave AS unidad_compra FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id LEFT JOIN unidad uc ON uc.id = a.unidad_compra_id WHERE a.activo AND a.tipo IN ('INSUMO', 'EMPAQUE') ORDER BY a.clave")).rows,
      cuentas: (await c.query("SELECT clave, banco, alias, terminacion FROM cuenta_bancaria WHERE activo ORDER BY clave")).rows,
      sucursales: (await c.query("SELECT clave, nombre FROM sucursal WHERE activo ORDER BY clave")).rows,
      hoy: await hoyNegocio(c),
    }));
  }

  // ---- Requisiciones ----
  if (recurso === "requisiciones") {
    if (!id && m === "GET") {
      ctx.exigir("compras.requisiciones:ver");
      return ctx.tx(async (c) => ({ requisiciones: (await c.query(
        `SELECT r.id, r.folio, r.origen, r.estatus, r.requerido_para::text, r.monto_estimado::text, r.creado_en, u.usuario AS solicitante, p.folio AS plan,
                (SELECT count(*)::int FROM requisicion_renglon x WHERE x.requisicion_id = r.id) AS renglones
           FROM requisicion r JOIN usuario u ON u.id = r.solicitante_id LEFT JOIN plan_produccion p ON p.id = r.plan_id
          WHERE ($1::text IS NULL OR r.estatus = $1) ORDER BY r.creado_en DESC LIMIT 300`,
        [sp.get("estatus") || null],
      )).rows }));
    }
    if (id && !accion && m === "GET") { ctx.exigir("compras.requisiciones:ver"); return ctx.tx((c) => detalleRequisicion(c, id)); }
    if (!id && m === "POST") {
      ctx.exigir("compras.requisiciones:crear");
      const d = await leerCuerpo(ctx.req, z.object({
        requerido_para: FECHA.optional().nullable(), comentario: TEXTO(300), sucursal: TEXTO(20), enviar: z.boolean().optional(),
        renglones: z.array(z.object({ articulo: z.string().max(30), cantidad: NUM, unidad: TEXTO(10), comentario: TEXTO(200) })).min(1).max(300),
      }));
      return ctx.tx((c) => crearRequisicion(c, u, d));
    }
    if (id && accion === "enviar" && m === "POST") { ctx.exigir(["compras.requisiciones:crear", "compras.requisiciones:editar"]); return ctx.tx((c) => enviarRequisicion(c, u, id)); }
    if (id && accion === "cancelar" && m === "POST") {
      const d = await leerCuerpo(ctx.req, MOTIVO);
      return ctx.tx((c) => cancelarRequisicion(c, u, id, d.motivo));
    }
  }

  // ---- Órdenes de compra ----
  if (recurso === "ordenes") {
    if (!id && m === "GET") {
      ctx.exigir(["compras.ordenes:ver", "compras.recepcion:ver"]);
      return ctx.tx(async (c) => ({ ordenes: (await c.query(
        `SELECT o.id, o.folio, o.estatus, o.fecha_entrega::text, ${verCostos ? "o.total::text" : "NULL::text"} AS total, o.creado_en, p.clave AS proveedor,
                coalesce(p.nombre_comercial, p.razon_social) AS proveedor_nombre, a.clave AS almacen, r.folio AS requisicion,
                (SELECT count(*)::int FROM factura_proveedor f WHERE f.oc_id = o.id AND f.estatus NOT IN ('RECHAZADA', 'CANCELADA')) AS facturas
           FROM orden_compra o JOIN proveedor p ON p.id = o.proveedor_id JOIN almacen a ON a.id = o.almacen_id JOIN requisicion r ON r.id = o.requisicion_id
          WHERE ($1::text IS NULL OR o.estatus = ANY(string_to_array($1, ','))) ORDER BY o.creado_en DESC LIMIT 300`,
        [sp.get("estatus") || null],
      )).rows }));
    }
    if (id && !accion && m === "GET") { ctx.exigir(["compras.ordenes:ver", "compras.recepcion:ver"]); return ctx.tx((c) => detalleOC(c, id, verCostos)); }
    if (!id && m === "POST") {
      ctx.exigir("compras.ordenes:crear");
      const d = await leerCuerpo(ctx.req, z.object({
        requisicion: z.string().max(40), proveedor: z.string().max(30), almacen: z.string().max(20), fecha_entrega: FECHA, condiciones: TEXTO(300), comentario: TEXTO(300),
        renglones: z.array(z.object({ requisicion_renglon_id: z.string().uuid(), cantidad: NUM, unidad: TEXTO(10), precio: NUM, tasa_iva: z.string().max(20) })).min(1).max(300),
      }));
      return ctx.tx((c) => crearOC(c, u, d));
    }
    if (id && accion === "cancelar" && m === "POST") {
      ctx.exigir("compras.ordenes:cancelar");
      const d = await leerCuerpo(ctx.req, MOTIVO);
      return ctx.tx((c) => cancelarOC(c, u, id, d.motivo));
    }
    if (id && accion === "recibir" && m === "POST") {
      ctx.exigir("compras.recepcion:crear");
      const d = await leerCuerpo(ctx.req, z.object({
        remision: TEXTO(60), comentario: TEXTO(300),
        renglones: z.array(z.object({ oc_renglon_id: z.string().uuid(), cantidad: NUM, lote: TEXTO(40), caducidad: FECHA.optional().nullable() })).min(1).max(300),
      }));
      return ctx.tx((c) => recibir(c, u, id, d));
    }
    if (id && (accion === "factura-revisar" || accion === "factura") && m === "POST") {
      ctx.exigir("compras.facturas:crear");
      const d = await leerCuerpo(ctx.req, z.object({ xml: z.string().min(20).max(1_000_000), relaciones: RELACIONES }));
      return ctx.tx((c) => (accion === "factura" ? registrarFactura(c, u, id, d.xml, d.relaciones) : revisarFactura(c, id, d.xml, d.relaciones)));
    }
  }

  // ---- Facturas ----
  if (recurso === "facturas") {
    ctx.exigir(["compras.facturas:ver", "compras.cxp:ver"]);
    if (!id && m === "GET") {
      return ctx.tx(async (c) => ({ facturas: (await c.query(
        `SELECT f.id, f.uuid_cfdi, f.serie, f.folio, f.fecha, f.total::text, f.estatus, f.metodo_pago, p.clave AS proveedor, o.folio AS oc, u.usuario AS registro,
                (SELECT count(*)::int FROM cotejo_diferencia d WHERE d.factura_id = f.id AND NOT d.dentro_tolerancia) AS diferencias
           FROM factura_proveedor f JOIN proveedor p ON p.id = f.proveedor_id JOIN orden_compra o ON o.id = f.oc_id JOIN usuario u ON u.id = f.registrado_por
          WHERE ($1::text IS NULL OR f.estatus = $1) ORDER BY f.creado_en DESC LIMIT 300`,
        [sp.get("estatus") || null],
      )).rows }));
    }
    if (id && m === "GET") {
      return ctx.tx(async (c) => {
        const f = (await c.query(
          `SELECT f.id, f.uuid_cfdi, f.serie, f.folio, f.fecha, f.subtotal::text, f.iva::text, f.total::text, f.estatus, f.metodo_pago, f.forma_pago,
                  p.clave AS proveedor, p.razon_social, o.folio AS oc, o.id AS oc_id, u.usuario AS registro, f.creado_en
             FROM factura_proveedor f JOIN proveedor p ON p.id = f.proveedor_id JOIN orden_compra o ON o.id = f.oc_id JOIN usuario u ON u.id = f.registrado_por WHERE f.id = $1`,
          [id],
        )).rows[0];
        if (!f) throw noEncontrado("No existe esa factura.");
        const conceptos = (await c.query("SELECT orden, descripcion, no_identificacion, cantidad::text, valor_unitario::text, importe::text, iva::text, oc_renglon_id FROM factura_concepto WHERE factura_id = $1 ORDER BY orden", [id])).rows;
        const diferencias = (await c.query("SELECT tipo, esperado::text, facturado::text, dentro_tolerancia AS dentro, descripcion FROM cotejo_diferencia WHERE factura_id = $1 ORDER BY dentro_tolerancia, tipo", [id])).rows;
        return { ...f, conceptos, diferencias, firmas: await firmasDe(c, id) };
      });
    }
  }

  // ---- Cuentas por pagar ----
  if (recurso === "cxp" && m === "GET") {
    ctx.exigir("compras.cxp:ver");
    return ctx.tx(async (c) => {
      const hoy = await hoyNegocio(c);
      const docs = (await c.query(
        `SELECT x.id, x.fecha::text, x.vencimiento::text, x.importe::text, x.saldo::text, x.estatus, p.clave AS proveedor, coalesce(p.nombre_comercial, p.razon_social) AS proveedor_nombre,
                f.serie, f.folio, f.uuid_cfdi, f.metodo_pago, o.folio AS oc,
                (SELECT coalesce(sum(pa.importe), 0)::text FROM pago_aplicacion pa JOIN pago_proveedor pg ON pg.id = pa.pago_id WHERE pa.cxp_id = x.id AND pg.estatus IN ('POR_AUTORIZAR', 'AUTORIZADO')) AS comprometido
           FROM cxp_documento x JOIN proveedor p ON p.id = x.proveedor_id JOIN factura_proveedor f ON f.id = x.factura_id JOIN orden_compra o ON o.id = f.oc_id
          WHERE ($1::text IS NULL OR x.estatus = $1) ORDER BY x.vencimiento, p.clave LIMIT 2000`,
        [sp.get("estatus") ?? "ABIERTO"],
      )).rows;
      const proveedores = [...new Set(docs.map((x) => x.proveedor))];
      const antig = proveedores.map((p) => {
        const a = antiguedad(docs.filter((x) => x.proveedor === p && x.estatus === "ABIERTO").map((x) => ({ vencimiento: x.vencimiento, saldo: new D(x.saldo) })), hoy);
        return { proveedor: p, nombre: docs.find((x) => x.proveedor === p)!.proveedor_nombre, ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.toFixed(2)])) };
      });
      if (sp.get("formato") !== "xlsx") return { hoy, documentos: docs, antiguedad: antig };
      ctx.exigir("compras.cxp:exportar");
      const n = (x: string) => Number(x);
      const datos = await libroExcel([
        { nombre: "Antigüedad de saldos", columnas: [{ titulo: "Proveedor", clave: "proveedor" }, { titulo: "Nombre", clave: "nombre", ancho: 30 }, { titulo: "Por vencer", clave: "por_vencer" }, { titulo: "1-30 días", clave: "d1_30" }, { titulo: "31-60 días", clave: "d31_60" }, { titulo: "61-90 días", clave: "d61_90" }, { titulo: "Más de 90", clave: "mas_90" }, { titulo: "Total", clave: "total" }],
          filas: antig.map((a: any) => ({ ...a, por_vencer: n(a.por_vencer), d1_30: n(a.d1_30), d31_60: n(a.d31_60), d61_90: n(a.d61_90), mas_90: n(a.mas_90), total: n(a.total) })) },
        { nombre: "Facturas por pagar", columnas: [{ titulo: "Proveedor", clave: "proveedor" }, { titulo: "Factura", clave: "factura" }, { titulo: "UUID", clave: "uuid_cfdi", ancho: 38 }, { titulo: "Fecha", clave: "fecha" }, { titulo: "Vence", clave: "vencimiento" }, { titulo: "Importe", clave: "importe" }, { titulo: "Saldo", clave: "saldo" }, { titulo: "OC", clave: "oc" }],
          filas: docs.map((x) => ({ ...x, factura: `${x.serie ?? ""}${x.folio ?? ""}`, fecha: x.fecha.split("-").reverse().join("/"), vencimiento: x.vencimiento.split("-").reverse().join("/"), importe: n(x.importe), saldo: n(x.saldo) })) },
      ], "Cuentas por pagar");
      return respuestaExcel(datos, `cuentas-por-pagar-${hoy}.xlsx`);
    });
  }

  // ---- Pagos ----
  if (recurso === "pagos") {
    if (!id && m === "GET") {
      ctx.exigir("compras.cxp:ver");
      return ctx.tx(async (c) => ({ pagos: (await c.query(
        `SELECT p.id, p.folio, p.estatus, p.forma_pago, p.importe::text, p.fecha_programada::text, p.fecha_pago::text, p.referencia, p.comentario, p.creado_en,
                pr.clave AS proveedor, cb.clave AS cuenta, u.usuario AS registro,
                (SELECT json_agg(json_build_object('factura', coalesce(f.serie, '') || coalesce(f.folio, ''), 'importe', pa.importe::text)) FROM pago_aplicacion pa
                   JOIN cxp_documento x ON x.id = pa.cxp_id JOIN factura_proveedor f ON f.id = x.factura_id WHERE pa.pago_id = p.id) AS aplicaciones
           FROM pago_proveedor p JOIN proveedor pr ON pr.id = p.proveedor_id LEFT JOIN cuenta_bancaria cb ON cb.id = p.cuenta_bancaria_id JOIN usuario u ON u.id = p.registrado_por
          ORDER BY p.creado_en DESC LIMIT 300`,
      )).rows }));
    }
    if (!id && m === "POST") {
      ctx.exigir("compras.cxp:crear");
      const d = await leerCuerpo(ctx.req, z.object({
        proveedor: z.string().max(30), cuenta: TEXTO(20), forma: z.enum(["01", "02", "03"]), fecha_programada: FECHA, comentario: TEXTO(300),
        aplicaciones: z.array(z.object({ cxp_id: z.string().uuid(), importe: NUM })).min(1).max(200),
      }));
      return ctx.tx((c) => programarPago(c, u, d));
    }
    if (id && accion === "pagado" && m === "POST") {
      ctx.exigir(["compras.cxp:crear", "compras.cxp:editar"]);
      const d = await leerCuerpo(ctx.req, z.object({ fecha_pago: FECHA, referencia: z.string().trim().min(3, "Escribe la referencia bancaria.").max(60) }));
      return ctx.tx((c) => marcarPagado(c, u, id, d));
    }
    if (id && accion === "cancelar" && m === "POST") {
      ctx.exigir("compras.cxp:cancelar");
      const d = await leerCuerpo(ctx.req, MOTIVO);
      return ctx.tx((c) => cancelarPago(c, u, id, d.motivo));
    }
  }

  // ---- Comparativo de precios ----
  if (recurso === "comparativo" && m === "GET") {
    ctx.exigir(["compras.ordenes:ver", "compras.facturas:ver"]);
    return ctx.tx(async (c) => ({ articulos: (await c.query(
      `WITH hist AS (
         SELECT r.articulo_id, o.proveedor_id, o.creado_en, (r.precio / r.factor_base) AS precio_base
           FROM oc_renglon r JOIN orden_compra o ON o.id = r.oc_id
          WHERE o.estatus NOT IN ('CANCELADA', 'RECHAZADA') AND o.creado_en >= now() - make_interval(days => $1)
       ), por_proveedor AS (
         SELECT h.articulo_id, h.proveedor_id, min(h.precio_base) AS minimo, max(h.precio_base) AS maximo, avg(h.precio_base) AS promedio, count(*)::int AS compras,
                (array_agg(h.precio_base ORDER BY h.creado_en DESC))[1] AS ultimo
           FROM hist h GROUP BY h.articulo_id, h.proveedor_id
       )
       SELECT a.clave, a.nombre, u.clave AS unidad, a.costo_referencia::text,
              json_agg(json_build_object('proveedor', p.clave, 'ultimo', round(x.ultimo, 4)::text, 'minimo', round(x.minimo, 4)::text,
                       'maximo', round(x.maximo, 4)::text, 'promedio', round(x.promedio, 4)::text, 'compras', x.compras) ORDER BY x.ultimo) AS proveedores
         FROM por_proveedor x JOIN articulo a ON a.id = x.articulo_id JOIN unidad u ON u.id = a.unidad_base_id JOIN proveedor p ON p.id = x.proveedor_id
        GROUP BY a.id, a.clave, a.nombre, u.clave, a.costo_referencia ORDER BY a.clave`,
      [Number(sp.get("dias") ?? 180)],
    )).rows }));
  }

  throw invalido("Operación no reconocida.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/compras/:recurso", "/api/compras/:recurso/:id", "/api/compras/:recurso/:id/:accion"] };
export { manejador };
