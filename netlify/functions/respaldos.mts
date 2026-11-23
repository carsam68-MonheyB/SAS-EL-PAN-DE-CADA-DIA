// Respaldos externos (diseño 1.4): estado de la configuración, historial,
// respaldo manual y descarga del archivo CIFRADO (para guardarlo uno mismo
// mientras no haya almacenamiento externo). Solo el administrador.
import type { Config, Context } from "@netlify/functions";
import { ErrorApp, invalido } from "../../src/servidor/errores";
import { cifrarRespaldo, ejecutarRespaldo, estadoConfiguracion, exportarBase, llaveRespaldo } from "../../src/servidor/respaldo";
import { obtenerPool } from "../../src/servidor/db";
import { ruta } from "../../src/servidor/ruta";

const manejador = ruta({ permiso: "seguridad.configuracion:ver" }, async (ctx) => {
  const { accion } = ctx.params;
  const m = ctx.req.method;
  if (!accion && m === "GET") {
    return ctx.tx(async (c) => ({
      configuracion: estadoConfiguracion(),
      respaldos: (await c.query(
        `SELECT r.id, r.tipo, r.motivo, r.estatus, r.destino, r.bytes, r.sha256, r.tablas, r.filas, r.retener_hasta::text, r.error, r.creado_en, r.terminado_en, u.usuario AS solicito
           FROM respaldo r LEFT JOIN usuario u ON u.id = r.solicitado_por ORDER BY r.creado_en DESC LIMIT 100`,
      )).rows,
      xml_archivados: (await c.query("SELECT count(*)::int AS n FROM respaldo_cfdi")).rows[0].n,
      xml_por_archivar: (await c.query("SELECT (SELECT count(*) FROM cfdi_emitido) + (SELECT count(*) FROM factura_proveedor WHERE xml IS NOT NULL) - (SELECT count(*) FROM respaldo_cfdi) AS n")).rows[0].n,
      puede_respaldar: ctx.puede("seguridad.configuracion:editar"),
    }));
  }
  if (accion === "ahora" && m === "POST") {
    ctx.exigir("seguridad.configuracion:editar");
    const r = await ctx.tx((c) => c.query("INSERT INTO respaldo (tipo, motivo, solicitado_por) VALUES ('MANUAL', 'Respaldo manual', $1) RETURNING id", [ctx.usuario.id]));
    return ejecutarRespaldo(r.rows[0].id);
  }
  if (accion === "descargar" && m === "GET") {
    ctx.exigir("seguridad.configuracion:editar");
    const llave = llaveRespaldo();
    if (!llave) throw new ErrorApp(409, "sin_llave", "Falta la variable RESPALDO_LLAVE: sin ella el respaldo no se puede cifrar.");
    const cl = await obtenerPool().connect();
    let archivo: Buffer;
    let resumen: { tablas: number; filas: number };
    try {
      await cl.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const ex = await exportarBase(cl);
      await cl.query("COMMIT");
      archivo = cifrarRespaldo(ex.plano, llave);
      resumen = ex;
    } catch (e) {
      await cl.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      cl.release();
    }
    // Queda registrado quién descargó y cuándo.
    await ctx.tx((c) => c.query(
      "INSERT INTO respaldo (tipo, motivo, estatus, bytes, tablas, filas, solicitado_por, iniciado_en, terminado_en) VALUES ('DESCARGA', 'Descarga del archivo cifrado', 'COMPLETO', $1, $2, $3, $4, now(), now())",
      [archivo.length, resumen.tablas, resumen.filas, ctx.usuario.id],
    ));
    const nombre = `erp-respaldo-${new Date().toISOString().slice(0, 10)}.erpresp`;
    return new Response(new Uint8Array(archivo), { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${nombre}"`, "cache-control": "no-store" } });
  }
  throw invalido("Operación no reconocida.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/respaldos", "/api/respaldos/:accion"] };
export { manejador };
