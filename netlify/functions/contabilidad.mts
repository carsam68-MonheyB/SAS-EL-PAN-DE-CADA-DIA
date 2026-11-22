// Contabilidad (Fase 7): reglas de contabilización, generación de pólizas
// automáticas, pólizas manuales con autorización, balanza, libro diario,
// auxiliares, estados financieros, conciliación del inventario y cierre de
// periodo. Cada acción valida su permiso en el servidor.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import * as k from "../../src/servidor/contabilidad";
import { invalido, noEncontrado } from "../../src/servidor/errores";
import { libroExcel, respuestaExcel } from "../../src/servidor/excel";
import { hoyNegocio } from "../../src/servidor/fechas";
import { leerCuerpo } from "../../src/servidor/http";
import { fechaParam } from "../../src/servidor/inventarios-consultas";
import { ruta } from "../../src/servidor/ruta";

const VER = ["contabilidad.polizas:ver", "contabilidad.reportes:ver", "contabilidad.catalogo:ver", "contabilidad.cierre:ver"];
const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD.");
const IMPORTE = z.string().trim().regex(/^(\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?$/, "Importe con hasta 2 decimales.").optional().nullable().or(z.literal(""));
const MOTIVO = z.object({ motivo: z.string().trim().min(3, "Escribe el motivo.").max(300) });

const manejador = ruta({ permiso: VER }, async (ctx) => {
  const { recurso, id, accion } = ctx.params;
  const m = ctx.req.method;
  const u = ctx.usuario;
  const sp = ctx.url.searchParams;
  const xlsx = sp.get("formato") === "xlsx";
  const periodo = async () => {
    const hoy = await ctx.tx((c) => hoyNegocio(c));
    const desde = fechaParam(sp.get("desde"), "Desde") ?? `${hoy.slice(0, 8)}01`;
    const hasta = fechaParam(sp.get("hasta"), "Hasta") ?? hoy;
    if (desde > hasta) throw invalido("La fecha inicial es posterior a la final.");
    return { desde, hasta };
  };

  // ---- Reglas de contabilización ----
  if (recurso === "reglas") {
    ctx.exigir("contabilidad.catalogo:ver");
    if (m === "GET") return ctx.tx(async (c) => ({
      conceptos: await k.listarReglas(c),
      cuentas: (await c.query("SELECT clave, nombre FROM cuenta_contable WHERE afectable AND activo ORDER BY clave")).rows,
      sucursales: (await c.query("SELECT clave, nombre FROM sucursal WHERE activo ORDER BY clave")).rows,
      puede_editar: ctx.puede("contabilidad.catalogo:editar"),
    }));
    if (m === "PUT") {
      ctx.exigir("contabilidad.catalogo:editar");
      const d = await leerCuerpo(ctx.req, z.object({ concepto: z.string().max(40), sucursal: z.string().max(20).optional().nullable(), cuenta: z.string().max(30).optional().nullable() }));
      return ctx.tx((c) => k.guardarRegla(c, d));
    }
  }

  // ---- Generar pólizas automáticas ----
  if (recurso === "contabilizar") {
    if (m === "GET") { ctx.exigir("contabilidad.polizas:ver"); return ctx.tx(async (c) => k.contabilizar(c, u.id, false)); }
    if (m === "POST") { ctx.exigir("contabilidad.polizas:crear"); return ctx.tx((c) => k.contabilizar(c, u.id, true)); }
  }

  // ---- Pólizas ----
  if (recurso === "polizas") {
    if (!id && m === "GET") {
      ctx.exigir("contabilidad.polizas:ver");
      const { desde, hasta } = await periodo();
      const polizas = await ctx.tx((c) => k.listarPolizas(c, { desde, hasta, tipo: sp.get("tipo"), estatus: sp.get("estatus"), origen: sp.get("origen") }));
      if (!xlsx) return { desde, hasta, polizas };
      ctx.exigir("contabilidad.polizas:exportar");
      return respuestaExcel(await libroExcel([{ nombre: "Pólizas", columnas: [{ titulo: "Folio", clave: "folio" }, { titulo: "Fecha", clave: "fecha" }, { titulo: "Tipo", clave: "tipo" }, { titulo: "Concepto", clave: "concepto", ancho: 50 }, { titulo: "Origen", clave: "origen" }, { titulo: "Documento", clave: "origen_folio" }, { titulo: "Estatus", clave: "estatus" }, { titulo: "Total", clave: "total" }], filas: polizas }], "Pólizas"), `polizas-${desde}-${hasta}.xlsx`);
    }
    if (!id && m === "POST") {
      ctx.exigir("contabilidad.polizas:crear");
      const d = await leerCuerpo(ctx.req, z.object({
        tipo: z.enum(["I", "E", "D"]), fecha: FECHA, concepto: z.string().trim().min(3, "Escribe el concepto.").max(300),
        partidas: z.array(z.object({ cuenta: z.string().trim().min(1).max(30), cargo: IMPORTE, abono: IMPORTE, concepto: z.string().max(300).optional().nullable(), centro_costo: z.string().max(20).optional().nullable(), sucursal: z.string().max(20).optional().nullable() })).min(2).max(500),
      }));
      return ctx.tx((c) => k.crearPolizaManual(c, u, { ...d, partidas: d.partidas.map((p) => ({ ...p, cargo: p.cargo || null, abono: p.abono || null })) }));
    }
    if (id && !accion && m === "GET") { ctx.exigir("contabilidad.polizas:ver"); return ctx.tx((c) => k.detallePoliza(c, id)); }
    if (id && (accion === "autorizar" || accion === "rechazar") && m === "POST") {
      ctx.exigir("contabilidad.polizas:autorizar");
      const d = await leerCuerpo(ctx.req, z.object({ motivo: z.string().trim().max(300).optional().nullable() }));
      return ctx.tx((c) => k.resolverPoliza(c, u, id, accion, d.motivo ?? null));
    }
    if (id && accion === "cancelar" && m === "POST") {
      ctx.exigir("contabilidad.polizas:cancelar");
      const d = await leerCuerpo(ctx.req, MOTIVO);
      return ctx.tx((c) => k.cancelarPoliza(c, u, id, d.motivo));
    }
  }

  // ---- Reportes ----
  if (["balanza", "auxiliar", "diario", "estados", "conciliacion"].includes(recurso ?? "") && m === "GET") {
    ctx.exigir("contabilidad.reportes:ver");
    if (xlsx) ctx.exigir("contabilidad.reportes:exportar");
    const { desde, hasta } = await periodo();
    if (recurso === "balanza") {
      const b = await ctx.tx((c) => k.balanzaComprobacion(c, desde, hasta));
      if (!xlsx) return b;
      return respuestaExcel(await libroExcel([{ nombre: "Balanza", columnas: [{ titulo: "Cuenta", clave: "clave" }, { titulo: "Nombre", clave: "nombre", ancho: 40 }, { titulo: "Nivel", clave: "nivel" }, { titulo: "Código agrupador", clave: "agrupador" }, { titulo: "Saldo inicial", clave: "inicial" }, { titulo: "Cargos", clave: "cargos" }, { titulo: "Abonos", clave: "abonos" }, { titulo: "Saldo final", clave: "final" }], filas: b.renglones }], "Balanza de comprobación"), `balanza-${desde}-${hasta}.xlsx`);
    }
    if (recurso === "auxiliar") {
      const cuenta = sp.get("cuenta");
      if (!cuenta) throw invalido("Indica la cuenta.");
      const a = await ctx.tx((c) => k.auxiliar(c, cuenta, desde, hasta));
      if (!xlsx) return a;
      return respuestaExcel(await libroExcel([{ nombre: `Auxiliar ${a.cuenta}`, columnas: [{ titulo: "Fecha", clave: "fecha" }, { titulo: "Póliza", clave: "folio" }, { titulo: "Documento", clave: "origen_folio" }, { titulo: "Cuenta", clave: "cuenta" }, { titulo: "Concepto", clave: "concepto", ancho: 50 }, { titulo: "Cargo", clave: "cargo" }, { titulo: "Abono", clave: "abono" }, { titulo: "Saldo", clave: "saldo" }], filas: a.movimientos }], "Auxiliar"), `auxiliar-${a.cuenta}-${desde}-${hasta}.xlsx`);
    }
    if (recurso === "diario") {
      const dd = await ctx.tx((c) => k.diario(c, desde, hasta));
      if (!xlsx) return dd;
      const filas = dd.polizas.flatMap((p) => p.partidas.map((x: any) => ({ folio: p.folio, fecha: p.fecha, concepto_poliza: p.concepto, ...x })));
      return respuestaExcel(await libroExcel([{ nombre: "Diario", columnas: [{ titulo: "Póliza", clave: "folio" }, { titulo: "Fecha", clave: "fecha" }, { titulo: "Concepto", clave: "concepto_poliza", ancho: 40 }, { titulo: "Cuenta", clave: "cuenta" }, { titulo: "Nombre", clave: "cuenta_nombre", ancho: 30 }, { titulo: "Cargo", clave: "cargo" }, { titulo: "Abono", clave: "abono" }], filas }], "Libro diario"), `diario-${desde}-${hasta}.xlsx`);
    }
    if (recurso === "estados") return ctx.tx((c) => k.estadosFinancieros(c, desde, hasta));
    return ctx.tx((c) => k.conciliacionInventario(c, hasta));
  }

  // ---- Periodos ----
  if (recurso === "periodos") {
    if (!id && m === "GET") { ctx.exigir("contabilidad.cierre:ver"); return ctx.tx(async (c) => ({ periodos: await k.periodos(c), puede_cerrar: ctx.puede("contabilidad.cierre:cerrar") })); }
    const mt = /^(\d{4})-(\d{2})$/.exec(id ?? "");
    if (!mt) throw noEncontrado("Periodo AAAA-MM.");
    const [ej, mes] = [Number(mt[1]), Number(mt[2])];
    if (mes < 1 || mes > 12) throw invalido("Mes no válido.");
    if (accion === "cerrar" && m === "POST") { ctx.exigir("contabilidad.cierre:cerrar"); return ctx.tx((c) => k.cerrarPeriodo(c, u, ej, mes)); }
    if (accion === "reabrir" && m === "POST") {
      ctx.exigir("contabilidad.cierre:cerrar");
      const d = await leerCuerpo(ctx.req, MOTIVO);
      return ctx.tx((c) => k.reabrirPeriodo(c, u, ej, mes, d.motivo));
    }
  }

  throw invalido("Operación no reconocida.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/contabilidad/:recurso", "/api/contabilidad/:recurso/:id", "/api/contabilidad/:recurso/:id/:accion"] };
export { manejador };
