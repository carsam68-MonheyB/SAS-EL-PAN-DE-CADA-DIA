// Consulta de la bitácora de auditoría y de accesos (solo lectura: nadie la edita).
import type { Config, Context } from "@netlify/functions";
import { noEncontrado } from "../../src/servidor/errores";
import { libroExcel, respuestaExcel, fechaHoraMx } from "../../src/servidor/excel";
import { ruta } from "../../src/servidor/ruta";

const LIMITE = 100;

const manejador = ruta({ permiso: "seguridad.bitacora:ver", metodos: ["GET"] }, async (ctx) => {
  const tipo = ctx.params.tipo;
  const q = ctx.url.searchParams;
  const desde = q.get("desde") || null; // AAAA-MM-DD
  const hasta = q.get("hasta") || null;
  const usuario = q.get("usuario") || null;
  const excel = q.get("formato") === "xlsx";
  if (excel) ctx.exigir("seguridad.bitacora:exportar");
  const antesDe = q.get("antes_de") ? Number(q.get("antes_de")) : null;
  const limite = excel ? 50_000 : LIMITE;

  if (tipo === "verificar") {
    return ctx.tx(async (c) => {
      const r = await c.query("SELECT bitacora_auditoria_verificar() AS roto, (SELECT count(*)::int FROM bitacora_auditoria) AS total");
      return { integra: r.rows[0].roto === null, primer_registro_alterado: r.rows[0].roto, registros: r.rows[0].total };
    });
  }

  if (tipo === "auditoria") {
    const tabla = q.get("tabla") || null;
    const { rows } = await ctx.tx((c) =>
      c.query(
        `SELECT b.id, b.fecha, b.tabla, b.registro_id, b.operacion, b.antes, b.despues, u.usuario
           FROM bitacora_auditoria b LEFT JOIN usuario u ON u.id = b.usuario_id
          WHERE ($1::date IS NULL OR b.fecha >= $1::date)
            AND ($2::date IS NULL OR b.fecha < $2::date + 1)
            AND ($3::text IS NULL OR u.usuario = $3)
            AND ($4::text IS NULL OR b.tabla = $4)
            AND ($5::bigint IS NULL OR b.id < $5)
          ORDER BY b.id DESC LIMIT $6`,
        [desde, hasta, usuario, tabla, antesDe, limite],
      ),
    );
    if (excel) {
      const libro = await libroExcel([{
        nombre: "Auditoría",
        columnas: [
          { titulo: "Folio", clave: "id", ancho: 10 }, { titulo: "Fecha y hora", clave: "fecha", ancho: 20 },
          { titulo: "Usuario", clave: "usuario" }, { titulo: "Tabla", clave: "tabla" }, { titulo: "Registro", clave: "registro_id", ancho: 38 },
          { titulo: "Operación", clave: "operacion", ancho: 10 }, { titulo: "Valor anterior", clave: "antes", ancho: 60 }, { titulo: "Valor nuevo", clave: "despues", ancho: 60 },
        ],
        filas: rows.map((r) => ({ ...r, fecha: fechaHoraMx(r.fecha), antes: r.antes ? JSON.stringify(r.antes) : "", despues: r.despues ? JSON.stringify(r.despues) : "" })),
      }], "Bitácora de auditoría");
      return respuestaExcel(libro, "bitacora-auditoria.xlsx");
    }
    return { registros: rows, siguiente: rows.length === LIMITE ? rows.at(-1)?.id : null };
  }

  if (tipo === "accesos") {
    const { rows } = await ctx.tx((c) =>
      c.query(
        `SELECT a.id, a.fecha, coalesce(u.usuario, a.usuario_intentado) AS usuario, a.evento, a.exito, a.ip, a.agente, a.detalle
           FROM bitacora_acceso a LEFT JOIN usuario u ON u.id = a.usuario_id
          WHERE ($1::date IS NULL OR a.fecha >= $1::date)
            AND ($2::date IS NULL OR a.fecha < $2::date + 1)
            AND ($3::text IS NULL OR coalesce(u.usuario, a.usuario_intentado) = $3)
            AND ($4::bigint IS NULL OR a.id < $4)
          ORDER BY a.id DESC LIMIT $5`,
        [desde, hasta, usuario, antesDe, limite],
      ),
    );
    if (excel) {
      const libro = await libroExcel([{
        nombre: "Accesos",
        columnas: [
          { titulo: "Folio", clave: "id", ancho: 10 }, { titulo: "Fecha y hora", clave: "fecha", ancho: 20 }, { titulo: "Usuario", clave: "usuario" },
          { titulo: "Evento", clave: "evento" }, { titulo: "Éxito", clave: "exito", ancho: 8 }, { titulo: "IP", clave: "ip", ancho: 16 },
          { titulo: "Dispositivo", clave: "agente", ancho: 50 }, { titulo: "Detalle", clave: "detalle", ancho: 40 },
        ],
        filas: rows.map((r) => ({ ...r, fecha: fechaHoraMx(r.fecha), exito: r.exito ? "Sí" : "No" })),
      }], "Bitácora de accesos");
      return respuestaExcel(libro, "bitacora-accesos.xlsx");
    }
    return { registros: rows, siguiente: rows.length === LIMITE ? rows.at(-1)?.id : null };
  }
  throw noEncontrado("Ruta no encontrada.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: "/api/bitacora/:tipo" };
export { manejador };
