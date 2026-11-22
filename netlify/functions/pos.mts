// Punto de venta (Fase 6): estado de la caja, turno, ventas, efectivo,
// devoluciones, cortes X/Z, pedidos con anticipo, tickets y reportes de oficina.
// Las operaciones de caja exigen una sesión de caja; quien opera es el cajero
// actual (cambio con PIN) y lo que requiere supervisor se autoriza con PIN.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { ErrorApp, invalido, noEncontrado } from "../../src/servidor/errores";
import { libroExcel, respuestaExcel } from "../../src/servidor/excel";
import { hoyNegocio } from "../../src/servidor/fechas";
import { leerCuerpo } from "../../src/servidor/http";
import {
  abonarPedido, abrirTurno, cancelarPedido, contextoCaja, contextoOficina, corteX, corteZ, crearPedido, devolver, entregarPedido, movimientoEfectivo,
  productosCaja, reciboAnticipo, resumenTurno, ticket, vender, verificarSupervisor, type Autorizacion, type ContextoCaja,
} from "../../src/servidor/pos";
import { ruta, type ContextoAutenticado } from "../../src/servidor/ruta";

const VER = ["pos.ventas:ver", "pos.ventas:crear", "pos.caja:ver", "pos.pedidos:ver", "pos.devoluciones:ver"];
const NUM = z.string().trim().regex(/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/, "Número no válido (punto decimal).");
const AUT = z.object({ usuario: z.string().trim().min(1).max(40), pin: z.string().regex(/^\d{4,8}$/, "PIN no válido.") });
const PAGO = z.object({ forma: z.string().regex(/^\d{2}$/), importe: NUM, referencia: z.string().trim().max(40).optional().nullable() });
const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD.");
const ALCANCE = (alias: string) => `($1::boolean OR ${alias}.id = ANY($2::uuid[]))`;

/** Verifica el PIN del supervisor en su propia transacción; lanza 403 si no procede. */
async function supervisor(ctx: ContextoAutenticado, k: ContextoCaja, a: Autorizacion | undefined | null, permiso: string, operacion: string) {
  if (!a) throw new ErrorApp(403, "requiere_autorizacion", "Esta operación requiere la autorización (usuario y PIN) de un encargado.");
  const r = await ctx.tx((c) => verificarSupervisor(c, a, { permiso, cajeroId: k.cajero.id, sucursalId: k.caja.sucursal_id, ip: ctx.ip, agente: ctx.agente, operacion }));
  if ("error" in r) throw new ErrorApp(403, "autorizacion", r.error);
  return r.id;
}

const manejador = ruta({ permiso: VER }, async (ctx) => {
  const { recurso, id, accion } = ctx.params;
  const m = ctx.req.method;
  const sp = ctx.url.searchParams;
  const caja = (bloquear = false) => (c: Parameters<typeof contextoCaja>[0]) => contextoCaja(c, ctx.sesion, bloquear);

  // ---- Estado de la caja ----
  if (recurso === "estado" && m === "GET") {
    return ctx.tx(async (c) => {
      if (ctx.sesion.tipo !== "pos") {
        const cajas = (await c.query(
          `SELECT c.id, c.clave, c.nombre, s.nombre AS sucursal FROM caja c JOIN sucursal s ON s.id = c.sucursal_id
            WHERE c.activo AND ($1::boolean OR c.sucursal_id = ANY($2::uuid[])) ORDER BY s.clave, c.clave`,
          [ctx.usuario.alcance.todas, ctx.usuario.alcance.sucursales],
        )).rows;
        const sucursales = (await c.query(
          "SELECT s.clave, s.nombre FROM sucursal s WHERE s.activo AND ($1::boolean OR s.id = ANY($2::uuid[])) ORDER BY s.clave",
          [ctx.usuario.alcance.todas, ctx.usuario.alcance.sucursales],
        )).rows;
        return { sin_caja: true, cajas, sucursales, puede_abrir: ctx.puede(["pos.caja:crear", "pos.caja:autorizar"]) };
      }
      const k = await caja()(c);
      return {
        caja: k.caja,
        cajero: { id: k.cajero.id, nombre: k.cajero.nombre, usuario: k.cajero.usuario, permisos: [...k.cajero.permisos].filter((p) => p.startsWith("pos.")) },
        turno: k.turno ? { ...k.turno, resumen: await resumenTurno(c, k.turno.id) } : null,
        formas: (await c.query("SELECT clave, nombre, es_efectivo, requiere_referencia FROM forma_pago WHERE activo ORDER BY orden")).rows,
        denominaciones: (await c.query("SELECT d.valor::text AS valor, d.tipo FROM denominacion d WHERE d.activo ORDER BY d.valor DESC")).rows,
        hoy: await hoyNegocio(c),
      };
    });
  }
  if (recurso === "productos" && m === "GET") {
    // En oficina (pedidos por teléfono o WhatsApp) se consultan los precios de la sucursal que entrega.
    if (ctx.sesion.tipo !== "pos" && sp.get("sucursal")) return ctx.tx(async (c) => ({ productos: await productosCaja(c, await contextoOficina(c, ctx.usuario, sp.get("sucursal")!)) }));
    return ctx.tx(async (c) => ({ productos: await productosCaja(c, await caja()(c)) }));
  }

  if (recurso === "turno" && m === "POST") {
    const d = await leerCuerpo(ctx.req, z.object({ fondo: NUM }));
    return ctx.tx(async (c) => abrirTurno(c, await caja(true)(c), d.fondo.replaceAll(",", "")));
  }

  // ---- Ventas ----
  if (recurso === "ventas" && !id && m === "POST") {
    const d = await leerCuerpo(ctx.req, z.object({
      id: z.string().uuid(),
      renglones: z.array(z.object({ articulo: z.string().max(30), cantidad: NUM, descuento: NUM.optional().nullable(), oferta: z.boolean().optional().nullable() })).min(1).max(200),
      pagos: z.array(PAGO).max(10),
      autorizacion: AUT.optional().nullable(),
      sin_conexion: z.object({ fecha_caja: z.string().datetime({ offset: true }), folio_local: z.string().regex(/^[A-Z0-9-]{1,40}$/) }).optional().nullable(),
    }));
    const k0 = await ctx.tx(caja());
    const hayDescuento = d.renglones.some((r) => r.descuento && Number(r.descuento.replaceAll(",", "")) > 0);
    const autorizo = hayDescuento ? await supervisor(ctx, k0, d.autorizacion, "pos.descuentos:autorizar", "descuento en venta") : null;
    return ctx.tx(async (c) => vender(c, await caja(true)(c), { ...d, autorizoDescuento: autorizo, sinConexion: d.sin_conexion ?? null }));
  }
  if (recurso === "ventas" && !id && m === "GET") {
    return ctx.tx(async (c) => {
      if (sp.get("turno") === "actual") {
        const k = await caja()(c);
        if (!k.turno) return { ventas: [] };
        return { ventas: (await c.query(
          `SELECT v.id, v.folio, v.fecha, v.total::text, v.devuelto::text, v.estatus, u.usuario AS cajero, pe.folio AS pedido,
                  (SELECT count(*)::int FROM venta_renglon r WHERE r.venta_id = v.id) AS renglones
             FROM venta v JOIN usuario u ON u.id = v.cajero_id LEFT JOIN pedido pe ON pe.id = v.pedido_id WHERE v.turno_id = $1 ORDER BY v.fecha DESC`,
          [k.turno.id],
        )).rows };
      }
      ctx.exigir("pos.ventas:ver");
      const desde = FECHA.parse(sp.get("desde") ?? await hoyNegocio(c));
      const hasta = FECHA.parse(sp.get("hasta") ?? desde);
      const ventas = (await c.query(
        `SELECT v.id, v.folio, v.fecha, v.fecha_negocio::text, s.clave AS sucursal, cj.clave AS caja, u.usuario AS cajero, v.subtotal::text, v.ieps::text, v.iva::text,
                v.descuento::text, (SELECT coalesce(sum(r.descuento_oferta), 0) FROM venta_renglon r WHERE r.venta_id = v.id)::text AS descuento_oferta,
                v.total::text, v.devuelto::text, v.estatus, pe.folio AS pedido,
                ${ctx.puede("datos.costos:ver") ? "(SELECT sum(r.costo_importe)::text FROM venta_renglon r WHERE r.venta_id = v.id)" : "NULL::text"} AS costo
           FROM venta v JOIN sucursal s ON s.id = v.sucursal_id JOIN caja cj ON cj.id = v.caja_id JOIN usuario u ON u.id = v.cajero_id
           LEFT JOIN pedido pe ON pe.id = v.pedido_id
          WHERE ${ALCANCE("s")} AND v.fecha_negocio BETWEEN $3 AND $4 AND ($5::text IS NULL OR s.clave = upper($5))
          ORDER BY v.fecha DESC LIMIT 5000`,
        [ctx.usuario.alcance.todas, ctx.usuario.alcance.sucursales, desde, hasta, sp.get("sucursal") || null],
      )).rows;
      if (sp.get("formato") !== "xlsx") return { desde, hasta, ventas };
      ctx.exigir("pos.ventas:exportar");
      const n = (x: string | null) => (x === null ? null : Number(x));
      const datos = await libroExcel([{
        nombre: "Ventas",
        columnas: [
          { titulo: "Fecha", clave: "fecha" }, { titulo: "Folio", clave: "folio" }, { titulo: "Sucursal", clave: "sucursal" }, { titulo: "Caja", clave: "caja" },
          { titulo: "Cajero", clave: "cajero" }, { titulo: "Subtotal", clave: "subtotal" }, { titulo: "IEPS", clave: "ieps" }, { titulo: "IVA", clave: "iva" },
          { titulo: "Descuento", clave: "descuento" }, { titulo: "De él, oferta", clave: "descuento_oferta" }, { titulo: "Total", clave: "total" }, { titulo: "Devuelto", clave: "devuelto" },
          ...(ctx.puede("datos.costos:ver") ? [{ titulo: "Costo", clave: "costo" }] : []), { titulo: "Estatus", clave: "estatus" }, { titulo: "Pedido", clave: "pedido" },
        ],
        filas: ventas.map((v) => ({ ...v, fecha: v.fecha_negocio.split("-").reverse().join("/"), subtotal: n(v.subtotal), ieps: n(v.ieps), iva: n(v.iva), descuento: n(v.descuento), descuento_oferta: n(v.descuento_oferta), total: n(v.total), devuelto: n(v.devuelto), costo: n(v.costo) })),
      }], "Ventas");
      return respuestaExcel(datos, `ventas-${desde}-${hasta}.xlsx`);
    });
  }
  if (recurso === "ventas" && id && m === "GET") {
    return ctx.tx(async (c) => {
      const t = await ticket(c, id);
      if (!(ctx.usuario.alcance.todas || ctx.usuario.alcance.sucursales.includes(t.sucursal_id))) throw noEncontrado("No existe esa venta.");
      return t;
    });
  }

  // ---- Efectivo, devoluciones y cortes ----
  if (recurso === "efectivo" && m === "POST") {
    const d = await leerCuerpo(ctx.req, z.object({ tipo: z.enum(["RETIRO", "INGRESO"]), importe: NUM, motivo: z.string().trim().min(3, "Escribe el motivo.").max(200), autorizacion: AUT.optional().nullable() }));
    const k0 = await ctx.tx(caja());
    const autorizo = await supervisor(ctx, k0, d.autorizacion, "pos.caja:autorizar", d.tipo === "RETIRO" ? "retiro de efectivo" : "ingreso de efectivo");
    return ctx.tx(async (c) => movimientoEfectivo(c, await caja(true)(c), { ...d, importe: d.importe.replaceAll(",", ""), autorizoId: autorizo }));
  }
  if (recurso === "devoluciones" && m === "POST") {
    const d = await leerCuerpo(ctx.req, z.object({
      venta: z.string().trim().min(1).max(40), motivo: z.string().trim().min(3, "Escribe el motivo.").max(200), regresa_inventario: z.boolean(),
      forma: z.string().regex(/^\d{2}$/).default("01"), renglones: z.array(z.object({ orden: z.number().int().positive(), cantidad: NUM })).min(1).max(200),
      autorizacion: AUT.optional().nullable(),
    }));
    const k0 = await ctx.tx(caja());
    const autorizo = await supervisor(ctx, k0, d.autorizacion, "pos.devoluciones:autorizar", `devolución de ${d.venta}`);
    return ctx.tx(async (c) => devolver(c, await caja(true)(c), { ...d, autorizoId: autorizo }));
  }
  if (recurso === "cortes" && !id && m === "POST") {
    const d = await leerCuerpo(ctx.req, z.object({
      tipo: z.enum(["X", "Z"]), comentario: z.string().trim().max(300).optional().nullable(),
      denominaciones: z.array(z.object({ valor: NUM, cantidad: z.number().int().min(0).max(100000) })).max(30).default([]),
      autorizacion: AUT.optional().nullable(),
    }));
    if (d.tipo === "X") return ctx.tx(async (c) => corteX(c, await caja(true)(c)));
    const k0 = await ctx.tx(caja());
    const autorizo = d.autorizacion ? await supervisor(ctx, k0, d.autorizacion, "pos.caja:cerrar", "corte Z") : null;
    return ctx.tx(async (c) => corteZ(c, await caja(true)(c), { ...d, autorizoId: autorizo }));
  }
  if (recurso === "cortes" && m === "GET") {
    ctx.exigir("pos.caja:ver");
    return ctx.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT k.id, k.tipo, k.creado_en, t.folio AS turno, cj.clave AS caja, s.clave AS sucursal, k.esperado_efectivo::text, k.contado_efectivo::text,
                k.diferencia::text, k.comentario, u.usuario, ua.usuario AS autorizo, ${id ? "k.resumen," : ""} t.fondo::text
           FROM corte k JOIN turno_caja t ON t.id = k.turno_id JOIN caja cj ON cj.id = t.caja_id JOIN sucursal s ON s.id = cj.sucursal_id
           JOIN usuario u ON u.id = k.usuario_id LEFT JOIN usuario ua ON ua.id = k.autorizo_id
          WHERE ${ALCANCE("s")} AND ($3::uuid IS NULL OR k.id = $3) ORDER BY k.creado_en DESC LIMIT 300`,
        [ctx.usuario.alcance.todas, ctx.usuario.alcance.sucursales, id && /^[0-9a-f-]{36}$/i.test(id) ? id : null],
      );
      if (!id) return { cortes: rows };
      if (!rows[0]) throw noEncontrado("No existe ese corte.");
      const den = (await c.query("SELECT d.valor::text AS valor, d.cantidad FROM corte_denominacion d WHERE d.corte_id = $1 ORDER BY d.valor DESC", [id])).rows;
      return { ...rows[0], denominaciones: den };
    });
  }

  // ---- Recibo de anticipo (reimpresión) ----
  if (recurso === "anticipos" && id && m === "GET") {
    ctx.exigir("pos.pedidos:ver");
    return ctx.tx(async (c) => {
      const r = await reciboAnticipo(c, id);
      if (!ctx.usuario.alcance.todas && !ctx.usuario.alcance.sucursales.includes(r.sucursal_id)) throw new ErrorApp(403, "prohibido", "El recibo es de otra sucursal.");
      return r;
    });
  }

  // ---- Pedidos ----
  if (recurso === "pedidos") {
    if (!id && m === "GET") {
      ctx.exigir("pos.pedidos:ver");
      return ctx.tx(async (c) => ({ pedidos: (await c.query(
        `SELECT p.id, p.folio, p.estatus, p.cliente_nombre, p.telefono, p.fecha_entrega::text, p.total::text, p.anticipado::text, (p.total - p.anticipado)::text AS saldo,
                p.notas, p.origen, s.clave AS sucursal, u.usuario AS registro, p.creado_en, p.destino_anticipo, v.folio AS venta,
                (SELECT json_agg(json_build_object('articulo', a.clave, 'nombre', a.nombre, 'cantidad', r.cantidad::text, 'precio', r.precio::text, 'importe', r.importe::text, 'especificaciones', r.especificaciones) ORDER BY r.creado_en)
                   FROM pedido_renglon r JOIN articulo a ON a.id = r.articulo_id WHERE r.pedido_id = p.id) AS renglones
           FROM pedido p JOIN sucursal s ON s.id = p.sucursal_id JOIN usuario u ON u.id = p.registrado_por LEFT JOIN venta v ON v.id = p.venta_id
          WHERE ${ALCANCE("s")} AND ($3::text IS NULL OR p.estatus = $3) ORDER BY p.fecha_entrega, p.folio LIMIT 500`,
        [ctx.usuario.alcance.todas, ctx.usuario.alcance.sucursales, sp.get("estatus") || null],
      )).rows }));
    }
    if (!id && m === "POST") {
      const d = await leerCuerpo(ctx.req, z.object({
        cliente_nombre: z.string().trim().min(2, "Escribe el nombre del cliente.").max(120), telefono: z.string().trim().max(20).optional().nullable(),
        cliente: z.string().max(30).optional().nullable(), fecha_entrega: FECHA, notas: z.string().trim().max(500).optional().nullable(),
        renglones: z.array(z.object({ articulo: z.string().max(30), cantidad: NUM, especificaciones: z.string().trim().max(300).optional().nullable() })).min(1).max(100),
        anticipo: PAGO.optional().nullable(), origen: z.enum(["MOSTRADOR", "TELEFONO", "WHATSAPP"]).optional(),
        sucursal: z.string().max(20).optional().nullable(), autorizacion: AUT.optional().nullable(),
      }));
      // En la caja: sucursal de la caja. En oficina (teléfono o WhatsApp): la sucursal que entrega.
      const contexto = (bloquear: boolean) => (c: Parameters<typeof contextoCaja>[0]) =>
        ctx.sesion.tipo === "pos" ? contextoCaja(c, ctx.sesion, bloquear) : contextoOficina(c, ctx.usuario, d.sucursal ?? "");
      if (ctx.sesion.tipo !== "pos" && !d.sucursal) throw invalido("Indica la sucursal que entrega el pedido.");
      const k0 = await ctx.tx(contexto(false));
      const sinAnticipo = !d.anticipo || Number(d.anticipo.importe.replaceAll(",", "")) <= 0;
      const autorizo = sinAnticipo ? await supervisor(ctx, k0, d.autorizacion, "pos.pedidos_sin_anticipo:autorizar", "pedido sin anticipo") : null;
      return ctx.tx(async (c) => crearPedido(c, await contexto(true)(c), { ...d, origen: d.origen ?? (ctx.sesion.tipo === "pos" ? "MOSTRADOR" : "TELEFONO"), autorizoSinAnticipo: autorizo }));
    }
    if (id && accion === "abonar" && m === "POST") {
      const d = await leerCuerpo(ctx.req, PAGO);
      return ctx.tx(async (c) => abonarPedido(c, await caja(true)(c), id, d));
    }
    if (id && accion === "entregar" && m === "POST") {
      const d = await leerCuerpo(ctx.req, z.object({ venta_id: z.string().uuid(), pagos: z.array(PAGO).max(10) }));
      return ctx.tx(async (c) => entregarPedido(c, await caja(true)(c), id, d));
    }
    if (id && accion === "cancelar" && m === "POST") {
      const d = await leerCuerpo(ctx.req, z.object({ destino: z.enum(["DEVUELTO", "RETENIDO"]), motivo: z.string().trim().min(3, "Escribe el motivo.").max(300), autorizacion: AUT.optional().nullable() }));
      const k0 = await ctx.tx(caja());
      const autorizo = await supervisor(ctx, k0, d.autorizacion, "pos.pedidos:autorizar", "cancelación de pedido");
      return ctx.tx(async (c) => cancelarPedido(c, await caja(true)(c), id, { ...d, autorizoId: autorizo }));
    }
  }

  throw invalido("Operación no reconocida.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/pos/:recurso", "/api/pos/:recurso/:id", "/api/pos/:recurso/:id/:accion"] };
export { manejador };
