// Inventarios (Fase 3): existencias, kárdex, alertas, entradas por compra,
// surtido a producción, entrada de producción terminada, traspasos, mermas,
// conteos físicos con ajuste autorizado y cancelaciones. Cada acción valida su
// permiso y el alcance del usuario sobre el almacén en el servidor.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { invalido, noEncontrado, prohibido } from "../../src/servidor/errores";
import { libroExcel, respuestaExcel } from "../../src/servidor/excel";
import { leerCuerpo } from "../../src/servidor/http";
import {
  autorizarConteo, autorizarMerma, cancelarMovimiento, cancelarTraspaso, capturarConteo, crearConteo, entradaCompra, entradaProduccion,
  enviarConteo, enviarTraspaso, recibirTraspaso, rechazarConteo, rechazarMerma, registrarMerma, surtir,
} from "../../src/servidor/inventarios";
import * as q from "../../src/servidor/inventarios-consultas";
import { ruta } from "../../src/servidor/ruta";

const VER = [
  "inventarios.existencias:ver", "inventarios.traspasos:ver", "inventarios.conteos:ver", "inventarios.surtido:ver",
  "inventarios.ajustes:ver", "inventarios.merma_sucursal:ver", "produccion.mermas:ver", "compras.recepcion:crear", "produccion.ordenes:crear",
];
const TEXTO = (max: number) => z.string().trim().max(max).optional().nullable();
const NUM = z.string().trim().regex(/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/, "Número no válido (punto decimal).");
const RENGLON = z.object({
  articulo: z.string().trim().min(1).max(30),
  cantidad: NUM,
  unidad: TEXTO(10),
  lote: TEXTO(40),
  caducidad: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Caducidad AAAA-MM-DD.").optional().nullable(),
  costo_unitario: NUM.optional().nullable(),
});
const RENGLONES = z.array(RENGLON).min(1, "Captura al menos un renglón.").max(500);
const MOTIVO = z.object({ motivo: z.string().trim().min(3, "Escribe el motivo.").max(300) });

// Sin permiso de ver costos se ocultan importes y valores.
const CAMPOS_COSTO = ["valor", "costo_promedio", "ultimo_costo", "costo_unitario", "importe", "saldo_valor", "importe_enviado", "importe_faltante", "faltante", "importe_diferencia"];
function sinCostos<T>(x: T): T {
  if (Array.isArray(x)) return x.map(sinCostos) as T;
  if (x && typeof x === "object" && !(x instanceof Date)) {
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, CAMPOS_COSTO.includes(k) ? null : sinCostos(v)])) as T;
  }
  return x;
}

const manejador = ruta({ permiso: VER }, async (ctx) => {
  const { recurso, id, accion } = ctx.params;
  const m = ctx.req.method;
  const u = ctx.usuario;
  const a = u.alcance;
  const sp = ctx.url.searchParams;
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw noEncontrado();
  const verCostos = ctx.puede("datos.costos:ver");
  const salida = <T,>(x: T) => (verCostos ? x : sinCostos(x));

  // ---- Consultas ----
  if (recurso === "opciones" && m === "GET") return ctx.tx((c) => q.opciones(c, a));

  if (recurso === "existencias" && !id && m === "GET") {
    ctx.exigir("inventarios.existencias:ver");
    const filas = await ctx.tx((c) => q.existencias(c, a, { almacen: sp.get("almacen"), tipo: sp.get("tipo"), buscar: sp.get("buscar") }));
    if (sp.get("formato") !== "xlsx") return salida({ existencias: filas, ver_costos: verCostos });
    ctx.exigir("inventarios.existencias:exportar");
    const datos = await libroExcel([{
      nombre: "Existencias",
      columnas: [
        { titulo: "Almacén", clave: "almacen" }, { titulo: "Artículo", clave: "articulo" }, { titulo: "Nombre", clave: "nombre", ancho: 32 }, { titulo: "Tipo", clave: "tipo" },
        { titulo: "Unidad", clave: "unidad", ancho: 8 }, { titulo: "Existencia", clave: "cantidad" }, { titulo: "En tránsito", clave: "en_transito" },
        ...(verCostos ? [{ titulo: "Costo promedio", clave: "costo_promedio" }, { titulo: "Valor", clave: "valor" }] : []),
        { titulo: "Mínimo", clave: "minimo" }, { titulo: "Reorden", clave: "reorden" }, { titulo: "Máximo", clave: "maximo" }, { titulo: "Alerta", clave: "alerta" },
        { titulo: "Lotes", clave: "lotes_txt", ancho: 50 },
      ],
      filas: filas.map((f) => ({
        ...f, cantidad: Number(f.cantidad), en_transito: Number(f.en_transito), costo_promedio: f.costo_promedio === null ? null : Number(f.costo_promedio), valor: Number(f.valor),
        minimo: f.minimo === null ? null : Number(f.minimo), reorden: f.reorden === null ? null : Number(f.reorden), maximo: f.maximo === null ? null : Number(f.maximo),
        lotes_txt: f.lotes.map((l: any) => `${l.lote}${l.caducidad ? ` (cad. ${l.caducidad.split("-").reverse().join("/")})` : ""}: ${l.cantidad}`).join("; "),
      })),
    }], "Existencias");
    return respuestaExcel(datos, "existencias.xlsx");
  }

  if (recurso === "alertas" && m === "GET") {
    ctx.exigir("inventarios.existencias:ver");
    return ctx.tx((c) => q.alertas(c, a));
  }

  if (recurso === "kardex" && m === "GET") {
    ctx.exigir("inventarios.existencias:ver");
    const almacen = sp.get("almacen");
    const articulo = sp.get("articulo");
    if (!almacen || !articulo) throw invalido("Indica el almacén y el artículo.");
    const k = await ctx.tx((c) => q.kardex(c, a, { almacen, articulo, desde: q.fechaParam(sp.get("desde"), "Desde"), hasta: q.fechaParam(sp.get("hasta"), "Hasta") }));
    if (sp.get("formato") !== "xlsx") return salida(k);
    ctx.exigir("inventarios.existencias:exportar");
    const n = (x: string | null) => (x === null ? null : Number(x));
    const datos = await libroExcel([{
      nombre: "Kárdex",
      columnas: [
        { titulo: "Fecha", clave: "fecha" }, { titulo: "Folio", clave: "folio" }, { titulo: "Tipo", clave: "tipo", ancho: 20 }, { titulo: "Lote", clave: "lote" },
        { titulo: "Entrada", clave: "entrada" }, { titulo: "Salida", clave: "salida" }, { titulo: "Saldo", clave: "saldo_cantidad" },
        ...(verCostos ? [{ titulo: "Costo unitario", clave: "costo_unitario" }, { titulo: "Importe", clave: "importe" }, { titulo: "Saldo valor", clave: "saldo_valor" }] : []),
        { titulo: "Causa", clave: "causa" }, { titulo: "Usuario", clave: "usuario" }, { titulo: "Referencia / comentario", clave: "nota", ancho: 40 },
      ],
      filas: [
        { fecha: k.desde ? k.desde.split("-").reverse().join("/") : "", tipo: "SALDO INICIAL", saldo_cantidad: n(k.saldo_inicial.saldo_cantidad), saldo_valor: n(k.saldo_inicial.saldo_valor) },
        ...k.renglones.map((r) => ({
          fecha: r.fecha_negocio.split("-").reverse().join("/"), folio: r.folio, tipo: r.tipo, lote: r.lote,
          entrada: Number(r.cantidad) > 0 ? Number(r.cantidad) : null, salida: Number(r.cantidad) < 0 ? -Number(r.cantidad) : null,
          saldo_cantidad: n(r.saldo_cantidad), costo_unitario: n(r.costo_unitario), importe: n(r.importe), saldo_valor: n(r.saldo_valor),
          causa: r.causa, usuario: r.usuario, nota: [r.referencia, r.comentario, r.cancela ? `Cancela ${r.cancela}` : null, r.cancelado ? "CANCELADO" : null].filter(Boolean).join(" · "),
        })),
      ],
    }], `Kárdex ${k.articulo.clave}`);
    return respuestaExcel(datos, `kardex-${k.almacen.clave}-${k.articulo.clave}.xlsx`);
  }

  if (recurso === "movimientos" && !id && m === "GET") {
    ctx.exigir("inventarios.existencias:ver");
    return ctx.tx(async (c) => salida({ movimientos: await q.movimientos(c, a, { almacen: sp.get("almacen"), tipo: sp.get("tipo"), desde: q.fechaParam(sp.get("desde"), "Desde"), hasta: q.fechaParam(sp.get("hasta"), "Hasta") }) }));
  }
  if (recurso === "movimientos" && id && !accion && m === "GET") {
    ctx.exigir("inventarios.existencias:ver");
    return ctx.tx(async (c) => salida(await q.movimiento(c, a, id)));
  }
  if (recurso === "movimientos" && id && accion === "cancelar" && m === "POST") {
    const d = await leerCuerpo(ctx.req, MOTIVO);
    return ctx.tx((c) => cancelarMovimiento(c, u, id, d.motivo));
  }

  // ---- Entradas, surtido y producción ----
  if (recurso === "compras" && m === "POST") {
    ctx.exigir("compras.recepcion:crear");
    const d = await leerCuerpo(ctx.req, z.object({ almacen: z.string().max(20), proveedor: TEXTO(30), referencia: TEXTO(60), comentario: TEXTO(300), renglones: RENGLONES }));
    return ctx.tx((c) => entradaCompra(c, u, d));
  }
  if (recurso === "surtidos" && m === "POST") {
    ctx.exigir("inventarios.surtido:crear");
    const d = await leerCuerpo(ctx.req, z.object({ origen: z.string().max(20), destino: z.string().max(20), plan_id: z.string().uuid().optional().nullable(), comentario: TEXTO(300), renglones: RENGLONES }));
    return ctx.tx((c) => surtir(c, u, d));
  }
  if (recurso === "produccion" && m === "POST") {
    ctx.exigir("produccion.ordenes:crear");
    const d = await leerCuerpo(ctx.req, z.object({ almacen: z.string().max(20), comentario: TEXTO(300), renglones: RENGLONES }));
    return ctx.tx((c) => entradaProduccion(c, u, d));
  }

  // ---- Traspasos ----
  if (recurso === "traspasos") {
    if (!id && m === "GET") { ctx.exigir("inventarios.traspasos:ver"); return ctx.tx(async (c) => salida({ traspasos: await q.traspasos(c, a, sp.get("estatus")) })); }
    if (id && !accion && m === "GET") { ctx.exigir("inventarios.traspasos:ver"); return ctx.tx(async (c) => salida(await q.traspaso(c, a, id))); }
    if (!id && m === "POST") {
      ctx.exigir("inventarios.traspasos:crear");
      const d = await leerCuerpo(ctx.req, z.object({ origen: z.string().max(20), destino: z.string().max(20), comentario: TEXTO(300), renglones: RENGLONES }));
      return ctx.tx((c) => enviarTraspaso(c, u, d));
    }
    if (id && accion === "recibir" && m === "POST") {
      ctx.exigir(["inventarios.traspasos:crear", "inventarios.traspasos:editar"]);
      const d = await leerCuerpo(ctx.req, z.object({ comentario: TEXTO(300), recibidos: z.array(z.object({ renglon_id: z.string().uuid(), cantidad: NUM })).max(500).optional() }));
      return ctx.tx((c) => recibirTraspaso(c, u, id, d));
    }
    if (id && accion === "cancelar" && m === "POST") {
      ctx.exigir("inventarios.traspasos:cancelar");
      const d = await leerCuerpo(ctx.req, MOTIVO);
      return ctx.tx((c) => cancelarTraspaso(c, u, id, d.motivo));
    }
  }

  // ---- Mermas ----
  if (recurso === "mermas") {
    const VER_MERMAS = ["produccion.mermas:ver", "inventarios.merma_sucursal:ver"];
    if (!id && m === "GET") { ctx.exigir(VER_MERMAS); return ctx.tx(async (c) => salida({ mermas: await q.mermas(c, a, sp.get("estatus")) })); }
    if (id && !accion && m === "GET") { ctx.exigir(VER_MERMAS); return ctx.tx(async (c) => salida(await q.merma(c, a, id))); }
    if (!id && m === "POST") {
      ctx.exigir(["produccion.mermas:crear", "inventarios.merma_sucursal:crear"]);
      const d = await leerCuerpo(ctx.req, z.object({ almacen: z.string().max(20), causa: z.string().max(20), comentario: TEXTO(300), renglones: RENGLONES }));
      return ctx.tx((c) => registrarMerma(c, u, d));
    }
    if (id && accion === "autorizar" && m === "POST") return ctx.tx(async (c) => salida(await autorizarMerma(c, u, id)));
    if (id && accion === "rechazar" && m === "POST") {
      const d = await leerCuerpo(ctx.req, MOTIVO);
      return ctx.tx((c) => rechazarMerma(c, u, id, d.motivo));
    }
  }

  // ---- Conteos ----
  if (recurso === "conteos") {
    if (!id && m === "GET") { ctx.exigir("inventarios.conteos:ver"); return ctx.tx(async (c) => salida({ conteos: await q.conteos(c, a, sp.get("estatus")) })); }
    if (id && !accion && m === "GET") {
      ctx.exigir("inventarios.conteos:ver");
      return ctx.tx(async (c) => {
        const k = await q.conteo(c, a, id);
        // Conteo a ciegas: mientras se captura no se muestra lo que dice el sistema.
        return salida(k.estatus === "CAPTURA" ? { ...k, renglones: k.renglones.map((r: any) => ({ ...r, teorico: null, diferencia: null, costo_unitario: null, importe: null })) } : k);
      });
    }
    if (!id && m === "POST") {
      ctx.exigir("inventarios.conteos:crear");
      const d = await leerCuerpo(ctx.req, z.object({ almacen: z.string().max(20), articulos: z.array(z.string().max(30)).max(2000).optional(), comentario: TEXTO(300) }));
      return ctx.tx((c) => crearConteo(c, u, d));
    }
    if (id && !accion && m === "PUT") {
      ctx.exigir(["inventarios.conteos:crear", "inventarios.conteos:editar"]);
      const d = await leerCuerpo(ctx.req, z.object({ renglones: z.array(z.object({ articulo: z.string().max(30), lote: TEXTO(40), fisico: NUM.nullable().or(z.literal("")) })).min(1).max(2000) }));
      await ctx.tx((c) => capturarConteo(c, u, id, d.renglones.map((r) => ({ ...r, fisico: r.fisico || null }))));
      return { ok: true };
    }
    if (id && accion === "enviar" && m === "POST") {
      ctx.exigir(["inventarios.conteos:crear", "inventarios.conteos:editar"]);
      return ctx.tx(async (c) => salida(await enviarConteo(c, u, id)));
    }
    if (id && accion === "autorizar" && m === "POST") {
      ctx.exigir("inventarios.ajustes:autorizar");
      return ctx.tx((c) => autorizarConteo(c, u, id));
    }
    if (id && (accion === "rechazar" || accion === "cancelar") && m === "POST") {
      const d = await leerCuerpo(ctx.req, MOTIVO);
      if (accion === "rechazar") ctx.exigir("inventarios.ajustes:autorizar");
      return ctx.tx(async (c) => {
        if (accion === "cancelar") {
          const k = (await c.query("SELECT creado_por_id FROM conteo WHERE id = $1", [id])).rows[0];
          if (!k) throw noEncontrado("No existe ese conteo.");
          if (!(ctx.puede("inventarios.conteos:cancelar") || (k.creado_por_id === u.id && ctx.puede("inventarios.conteos:crear")))) throw prohibido("Solo quien creó el conteo (o quien tiene permiso de cancelar conteos) puede cancelarlo.");
        }
        await rechazarConteo(c, u, id, d.motivo, accion === "cancelar");
        return { ok: true };
      });
    }
  }

  throw invalido("Operación no reconocida.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/inventarios/:recurso", "/api/inventarios/:recurso/:id", "/api/inventarios/:recurso/:id/:accion"] };
export { manejador };
