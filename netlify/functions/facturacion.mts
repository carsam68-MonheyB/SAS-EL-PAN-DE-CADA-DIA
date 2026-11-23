// Facturación con el portal del SAT (Fase 8): solicitudes de factura de tickets,
// datos para capturar en el portal (individual y global diaria), registro del XML
// descargado, cancelaciones con autorización y conciliación vendido vs. facturado.
// Cada acción valida su permiso en el servidor.
import { datosPruebaPermitidos } from "../../src/servidor/ambiente";
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { ErrorApp, invalido } from "../../src/servidor/errores";
import { libroExcel, respuestaExcel } from "../../src/servidor/excel";
import * as f from "../../src/servidor/facturacion";
import { hoyNegocio } from "../../src/servidor/fechas";
import { leerCuerpo } from "../../src/servidor/http";
import { fechaParam } from "../../src/servidor/inventarios-consultas";
import { ruta } from "../../src/servidor/ruta";

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD.");
const CLASE = z.enum(["NOMINATIVA", "GLOBAL", "EGRESO"]);
const REGISTRO = z.object({
  clase: CLASE, xml: z.string().min(20, "Falta el XML.").max(f.MAX_XML, "El XML es demasiado grande."),
  solicitudes: z.array(z.string().max(40)).max(50).optional(), fecha: FECHA.optional().nullable(), sucursal: z.string().max(20).optional().nullable(),
});

const manejador = ruta({ permiso: "fiscal.cfdi:ver" }, async (ctx) => {
  const { recurso, id, accion } = ctx.params;
  const m = ctx.req.method;
  const u = ctx.usuario;
  const sp = ctx.url.searchParams;
  const periodo = async () => {
    const hoy = await ctx.tx((c) => hoyNegocio(c));
    const desde = fechaParam(sp.get("desde"), "Desde") ?? `${hoy.slice(0, 8)}01`;
    const hasta = fechaParam(sp.get("hasta"), "Hasta") ?? hoy;
    if (desde > hasta) throw invalido("La fecha inicial es posterior a la final.");
    return { desde, hasta, hoy };
  };

  if (recurso === "opciones" && m === "GET") {
    return ctx.tx(async (c) => ({
      hoy: await hoyNegocio(c),
      sucursales: (await c.query("SELECT clave, nombre FROM sucursal WHERE activo AND ($1::boolean OR id = ANY($2::uuid[])) ORDER BY clave", [u.alcance.todas, u.alcance.sucursales])).rows,
      todas: u.alcance.todas,
      regimenes: (await c.query("SELECT clave, descripcion FROM sat_catalogo WHERE catalogo = 'c_RegimenFiscal' AND activo ORDER BY clave")).rows,
      usos: (await c.query("SELECT clave, descripcion FROM sat_catalogo WHERE catalogo = 'c_UsoCFDI' AND activo ORDER BY clave")).rows,
      motivos_cancelacion: Object.entries(f.MOTIVOS_CANCELACION).map(([clave, descripcion]) => ({ clave, descripcion })),
      puede: {
        solicitar: ctx.puede("fiscal.cfdi:crear"), registrar: ctx.puede("fiscal.cfdi:timbrar"), cancelar: ctx.puede("fiscal.cfdi:cancelar"),
        autorizar: ctx.puede("fiscal.cfdi:autorizar"), exportar: ctx.puede("fiscal.cfdi:exportar"),
      },
      xml_prueba: datosPruebaPermitidos(),
    }));
  }

  // ---- Tickets y solicitudes ----
  if (recurso === "tickets" && id && m === "GET") return ctx.tx((c) => f.consultarTicket(c, u, id));
  if (recurso === "clientes" && id && m === "GET") return ctx.tx(async (c) => ({ cliente: await f.datosCliente(c, id) }));

  if (recurso === "solicitudes") {
    if (!id && m === "GET") {
      const { desde, hasta } = await periodo();
      return ctx.tx(async (c) => ({ desde, hasta, solicitudes: await f.listarSolicitudes(c, u, { estatus: sp.get("estatus"), desde, hasta }) }));
    }
    if (!id && m === "POST") {
      ctx.exigir("fiscal.cfdi:crear");
      const d = await leerCuerpo(ctx.req, z.object({
        venta: z.string().trim().min(1).max(60),
        rfc: z.string().trim().toUpperCase().regex(/^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/, "RFC no válido (12 caracteres persona moral, 13 persona física)."),
        razon_social: z.string().trim().min(1, "Escribe el nombre o razón social (como en la constancia de situación fiscal).").max(300),
        regimen_fiscal: z.string().regex(/^\d{3}$/, "Régimen fiscal: clave de 3 dígitos."),
        codigo_postal: z.string().regex(/^\d{5}$/, "Código postal de 5 dígitos."),
        uso_cfdi: z.string().trim().toUpperCase().regex(/^[A-Z]\d{2}$/, "Uso de CFDI no válido (ej. G03)."),
        correo: z.string().trim().min(1, "Escribe el correo del cliente: ahí le llega su factura.").email("Correo no válido.").max(200),
      }));
      return ctx.tx((c) => f.crearSolicitud(c, u, d));
    }
    if (id && accion === "enviada" && m === "POST") {
      ctx.exigir(["fiscal.cfdi:timbrar", "fiscal.cfdi:crear"]);
      return ctx.tx((c) => f.marcarEnviada(c, u, id));
    }
    if (id && accion === "cancelar" && m === "POST") {
      ctx.exigir("fiscal.cfdi:crear");
      const d = await leerCuerpo(ctx.req, z.object({ motivo: z.string().trim().min(3, "Escribe el motivo.").max(300) }));
      return ctx.tx((c) => f.cancelarSolicitud(c, u, id, d.motivo));
    }
  }

  // ---- Datos para capturar en el portal del SAT ----
  if (recurso === "portal" && m === "GET") {
    if (id === "individual") {
      const ids = (sp.get("solicitudes") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      if (!ids.length) throw invalido("Indica la solicitud.");
      return ctx.tx((c) => f.datosParaPortalIndividual(c, u, ids));
    }
    if (id === "global") {
      const fecha = fechaParam(sp.get("fecha"), "Fecha") ?? (await periodo()).hoy;
      const g = await ctx.tx((c) => f.datosParaPortalGlobal(c, u, fecha, sp.get("sucursal")));
      if (sp.get("formato") !== "xlsx") return g;
      ctx.exigir("fiscal.cfdi:exportar");
      const filas = g.conceptos.map((x) => ({ ...x, iva: x.traslados.find((t) => t.impuesto === "IVA")?.importe ?? "0.00", tasa_iva: x.traslados.find((t) => t.impuesto === "IVA")?.tasa ?? "", ieps: x.traslados.find((t) => t.impuesto === "IEPS")?.importe ?? "0.00" }));
      return respuestaExcel(await libroExcel([{ nombre: "Global", columnas: [
        { titulo: "No. identificación (ticket)", clave: "no_identificacion" }, { titulo: "Clave prod/serv", clave: "clave_prod_serv" }, { titulo: "Cantidad", clave: "cantidad" },
        { titulo: "Clave unidad", clave: "clave_unidad" }, { titulo: "Descripción", clave: "descripcion" }, { titulo: "Valor unitario", clave: "valor_unitario" },
        { titulo: "Importe", clave: "importe" }, { titulo: "Objeto imp.", clave: "objeto_imp" }, { titulo: "Tasa IVA", clave: "tasa_iva" }, { titulo: "IVA", clave: "iva" }, { titulo: "IEPS", clave: "ieps" },
      ], filas }], `Factura global ${g.fecha}`), `global-${g.fecha}${g.sucursal ? `-${g.sucursal}` : ""}.xlsx`);
    }
  }

  // ---- XML descargado del portal ----
  if (recurso === "xml" && m === "POST") {
    ctx.exigir("fiscal.cfdi:timbrar");
    if (id === "revisar") {
      const d = await leerCuerpo(ctx.req, REGISTRO);
      return ctx.tx((c) => f.revisarXml(c, u, d));
    }
    if (id === "prueba") {
      if (!datosPruebaPermitidos()) throw new ErrorApp(403, "deshabilitado", "El XML de prueba solo existe en el ambiente de pruebas.");
      const d = await leerCuerpo(ctx.req, z.object({
        clase: CLASE, solicitudes: z.array(z.string().max(40)).max(50).optional(), fecha: FECHA.optional().nullable(), sucursal: z.string().max(20).optional().nullable(),
        relacionado: z.string().max(60).optional().nullable(), importe: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
      }));
      return ctx.tx(async (c) => ({ xml: await f.generarXmlPrueba(c, u, d) }));
    }
    if (!id) {
      const d = await leerCuerpo(ctx.req, REGISTRO);
      return ctx.tx((c) => f.registrarXml(c, u, d));
    }
  }

  // ---- Facturas registradas ----
  if (recurso === "facturas") {
    if (!id && m === "GET") {
      const { desde, hasta } = await periodo();
      const lista = await ctx.tx((c) => f.listarCfdis(c, u, { desde, hasta, clase: sp.get("clase"), estatus: sp.get("estatus") }));
      if (sp.get("formato") !== "xlsx") return { desde, hasta, facturas: lista };
      ctx.exigir("fiscal.cfdi:exportar");
      return respuestaExcel(await libroExcel([{ nombre: "Facturas", columnas: [
        { titulo: "UUID", clave: "uuid", ancho: 40 }, { titulo: "Clase", clave: "clase" }, { titulo: "Serie", clave: "serie" }, { titulo: "Folio", clave: "folio" },
        { titulo: "Día", clave: "fecha_negocio" }, { titulo: "Sucursal", clave: "sucursal" }, { titulo: "RFC receptor", clave: "receptor_rfc" }, { titulo: "Receptor", clave: "receptor_nombre", ancho: 30 },
        { titulo: "Subtotal", clave: "subtotal" }, { titulo: "IVA", clave: "iva" }, { titulo: "IEPS", clave: "ieps" }, { titulo: "Total", clave: "total" }, { titulo: "Tickets", clave: "tickets" }, { titulo: "Estatus", clave: "estatus" },
      ], filas: lista }], "Facturas emitidas"), `facturas-${desde}-${hasta}.xlsx`);
    }
    if (id && !accion && m === "GET") return ctx.tx((c) => f.detalleCfdi(c, u, id));
    if (id && accion === "xml" && m === "GET") {
      const x = await ctx.tx((c) => f.xmlCfdi(c, u, id));
      return new Response(x.xml, { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${x.uuid}.xml"`, "cache-control": "no-store" } });
    }
    if (id && accion === "cancelar" && m === "POST") {
      ctx.exigir("fiscal.cfdi:cancelar");
      const d = await leerCuerpo(ctx.req, z.object({ motivo_sat: z.enum(["01", "02", "03", "04"]), uuid_sustitucion: z.string().max(40).optional().nullable(), nota: z.string().trim().min(3, "Escribe una nota.").max(300) }));
      return ctx.tx((c) => f.solicitarCancelacion(c, u, id, d));
    }
    if (id && (accion === "autorizar-cancelacion" || accion === "rechazar-cancelacion") && m === "POST") {
      ctx.exigir("fiscal.cfdi:autorizar");
      const d = await leerCuerpo(ctx.req, z.object({ nota: z.string().trim().max(300).optional().nullable() }));
      return ctx.tx((c) => f.resolverCancelacion(c, u, id, accion === "autorizar-cancelacion", d.nota ?? null));
    }
  }

  // ---- Conciliación ----
  if (recurso === "conciliacion" && m === "GET") {
    const { desde, hasta } = await periodo();
    const r = await ctx.tx((c) => f.conciliacion(c, u, desde, hasta));
    if (sp.get("formato") !== "xlsx") return r;
    ctx.exigir("fiscal.cfdi:exportar");
    return respuestaExcel(await libroExcel([{ nombre: "Conciliación", columnas: [
      { titulo: "Día", clave: "fecha" }, { titulo: "Sucursal", clave: "sucursal" }, { titulo: "Tickets", clave: "tickets" }, { titulo: "Vendido (neto)", clave: "vendido" },
      { titulo: "Factura individual", clave: "individual" }, { titulo: "Factura global", clave: "global" }, { titulo: "Tickets sin facturar", clave: "sin_facturar" },
      { titulo: "Importe sin facturar", clave: "importe_sin_facturar" }, { titulo: "Solicitudes pendientes", clave: "solicitudes_pendientes" },
    ], filas: r.dias }], "Vendido contra facturado"), `conciliacion-fiscal-${desde}-${hasta}.xlsx`);
  }

  throw invalido("Operación no reconocida.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/facturacion/:recurso", "/api/facturacion/:recurso/:id", "/api/facturacion/:recurso/:id/:accion"] };
export { manejador };
