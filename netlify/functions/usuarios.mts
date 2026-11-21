// Administración de usuarios: alta, edición, suspensión, baja (sin borrar),
// invitaciones, desbloqueo y restablecimiento del doble factor.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { invalido, noEncontrado, prohibido } from "../../src/servidor/errores";
import { leerCuerpo } from "../../src/servidor/http";
import { ruta } from "../../src/servidor/ruta";
import { generarToken, sincronizarAsignaciones, validarDatosUsuario } from "../../src/servidor/seguridad";
import { revocarSesionesDeUsuario } from "../../src/servidor/sesiones";
import type { Cliente } from "../../src/servidor/transaccion";
import { registrarAcceso } from "../../src/servidor/usuarios";

const esquemaDatos = z.object({
  nombre: z.string().trim().min(3, "Escribe el nombre completo.").max(120),
  puesto: z.string().trim().min(2).max(80),
  correo: z.union([z.email("Correo no válido."), z.literal(""), z.null()]).optional(),
  roles: z.array(z.string().trim().toUpperCase()).min(1, "Asigna al menos un rol."),
  sucursales: z.array(z.uuid()).default([]),
  almacenes: z.array(z.uuid()).default([]),
});

const esquemaAlta = esquemaDatos.extend({
  usuario: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, "Usuario: 3 a 40 caracteres (letras, números, punto, guion)."),
});

async function detalleUsuario(c: Cliente, id: string) {
  const { rows } = await c.query(
    `SELECT u.id, u.usuario, u.nombre, u.puesto, u.correo, u.estatus, u.fecha_alta::text AS fecha_alta, u.fecha_baja::text AS fecha_baja,
            u.totp_activo, u.pin_hash IS NOT NULL AS tiene_pin, u.hash_password IS NOT NULL AS activado,
            (u.bloqueado_hasta > now()) AS bloqueado, u.es_prueba, u.creado_en,
            coalesce((SELECT json_agg(r.clave ORDER BY r.clave) FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id WHERE ur.usuario_id = u.id), '[]') AS roles,
            coalesce((SELECT json_agg(sucursal_id) FROM usuario_sucursal WHERE usuario_id = u.id), '[]') AS sucursales,
            coalesce((SELECT json_agg(almacen_id) FROM usuario_almacen WHERE usuario_id = u.id), '[]') AS almacenes,
            (SELECT max(fecha) FROM bitacora_acceso a WHERE a.usuario_id = u.id AND a.evento = 'login' AND a.exito) AS ultimo_acceso
       FROM usuario u WHERE u.id = $1`,
    [id],
  );
  if (!rows[0]) throw noEncontrado("No existe el usuario.");
  return rows[0];
}

function enlace(url: URL, token: string) {
  return `${url.origin}/activar?token=${encodeURIComponent(token)}`;
}

const manejador = ruta({ permiso: "seguridad.usuarios:ver" }, async (ctx) => {
  const { id, accion } = ctx.params;
  const metodo = ctx.req.method;

  // GET /api/usuarios
  if (!id && metodo === "GET") {
    const estatus = ctx.url.searchParams.get("estatus");
    return ctx.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT u.id, u.usuario, u.nombre, u.puesto, u.estatus, u.totp_activo, u.es_prueba,
                u.hash_password IS NOT NULL AS activado, (u.bloqueado_hasta > now()) AS bloqueado,
                coalesce((SELECT json_agg(r.clave ORDER BY r.clave) FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id WHERE ur.usuario_id = u.id), '[]') AS roles
           FROM usuario u
          WHERE ($1::text IS NULL OR u.estatus = $1)
          ORDER BY u.estatus, u.nombre`,
        [estatus],
      );
      return { usuarios: rows };
    });
  }

  // POST /api/usuarios  (alta)
  if (!id && metodo === "POST") {
    ctx.exigir("seguridad.usuarios:crear");
    const d = await leerCuerpo(ctx.req, esquemaAlta);
    return ctx.tx(async (c) => {
      const existe = await c.query("SELECT 1 FROM usuario WHERE usuario = $1", [d.usuario]);
      if (existe.rowCount) throw invalido("Ese nombre de usuario ya existe.");
      const rolIds = await validarDatosUsuario(c, { ...d, correo: d.correo || null });
      const { rows } = await c.query(
        "INSERT INTO usuario (usuario, nombre, puesto, correo) VALUES ($1, $2, $3, $4) RETURNING id",
        [d.usuario, d.nombre, d.puesto, d.correo || null],
      );
      const nuevoId = rows[0].id as string;
      await sincronizarAsignaciones(c, nuevoId, rolIds, d.sucursales, d.almacenes);
      const t = await generarToken(c, nuevoId, "invitacion");
      return { usuario: await detalleUsuario(c, nuevoId), invitacion: { enlace: enlace(ctx.url, t.token), expira_en: t.expira_en } };
    });
  }

  if (!id) throw noEncontrado("Ruta no encontrada.");

  // GET /api/usuarios/:id
  if (!accion && metodo === "GET") return ctx.tx((c) => detalleUsuario(c, id));

  // PUT /api/usuarios/:id  (edición de datos, roles y alcance)
  if (!accion && metodo === "PUT") {
    ctx.exigir("seguridad.usuarios:editar");
    if (id === ctx.usuario.id) throw prohibido("No puedes modificar tus propios roles ni alcance: pídeselo a otro administrador.");
    const d = await leerCuerpo(ctx.req, esquemaDatos);
    return ctx.tx(async (c) => {
      const actual = await detalleUsuario(c, id);
      if (actual.estatus === "baja") throw invalido("El usuario está dado de baja; no se puede editar.");
      const rolIds = await validarDatosUsuario(c, { ...d, correo: d.correo || null });
      await c.query("UPDATE usuario SET nombre = $2, puesto = $3, correo = $4 WHERE id = $1", [id, d.nombre, d.puesto, d.correo || null]);
      await sincronizarAsignaciones(c, id, rolIds, d.sucursales, d.almacenes);
      return detalleUsuario(c, id);
    });
  }

  // POST /api/usuarios/:id/:accion
  if (accion && metodo === "POST") {
    if (id === ctx.usuario.id && accion !== "invitar") throw prohibido("No puedes aplicar esta acción sobre tu propio usuario.");
    return ctx.tx(async (c) => {
      const u = await detalleUsuario(c, id);
      const registrar = (evento: string, detalle?: string) =>
        registrarAcceso(c, { usuarioId: id, evento, exito: true, ip: ctx.ip, agente: ctx.agente, detalle: `por ${ctx.usuario.usuario}${detalle ? `; ${detalle}` : ""}` });
      switch (accion) {
        case "suspender":
          ctx.exigir("seguridad.usuarios:editar");
          if (u.estatus !== "activo") throw invalido("Solo se suspende un usuario activo.");
          await c.query("UPDATE usuario SET estatus = 'suspendido' WHERE id = $1", [id]);
          await revocarSesionesDeUsuario(c, id, "suspensión");
          await registrar("suspension");
          break;
        case "reactivar":
          ctx.exigir("seguridad.usuarios:editar");
          if (u.estatus !== "suspendido") throw invalido("Solo se reactiva un usuario suspendido.");
          await c.query("UPDATE usuario SET estatus = 'activo' WHERE id = $1", [id]);
          await registrar("reactivacion");
          break;
        case "baja":
          ctx.exigir("seguridad.usuarios:cancelar");
          if (u.estatus === "baja") throw invalido("El usuario ya está dado de baja.");
          await c.query("UPDATE usuario SET estatus = 'baja', fecha_baja = current_date, pin_hash = NULL WHERE id = $1", [id]);
          await c.query("UPDATE token_acceso SET usado_en = now() WHERE usuario_id = $1 AND usado_en IS NULL", [id]);
          await revocarSesionesDeUsuario(c, id, "baja");
          await registrar("baja");
          break;
        case "invitar": {
          ctx.exigir(["seguridad.usuarios:crear", "seguridad.usuarios:editar"]);
          if (u.estatus !== "activo") throw invalido("El usuario no está activo.");
          const tipo = u.activado ? "restablecer" : "invitacion";
          const t = await generarToken(c, id, tipo);
          await registrar(tipo === "invitacion" ? "invitacion" : "restablecimiento_solicitado");
          return { enlace: enlace(ctx.url, t.token), expira_en: t.expira_en, tipo };
        }
        case "desbloquear":
          ctx.exigir("seguridad.usuarios:editar");
          await c.query("UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL, intentos_pin = 0, pin_bloqueado_hasta = NULL WHERE id = $1", [id]);
          await registrar("desbloqueo");
          break;
        case "restablecer-2fa":
          ctx.exigir("seguridad.usuarios:editar");
          await c.query("UPDATE usuario SET totp_activo = false, totp_secreto = NULL, totp_ultimo_paso = NULL WHERE id = $1", [id]);
          await c.query("UPDATE codigo_recuperacion SET usado_en = now() WHERE usuario_id = $1 AND usado_en IS NULL", [id]);
          await revocarSesionesDeUsuario(c, id, "restablecimiento de doble factor");
          await registrar("restablecer_2fa");
          break;
        default:
          throw noEncontrado("Acción no reconocida.");
      }
      return detalleUsuario(c, id);
    });
  }
  throw noEncontrado("Ruta no encontrada.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/usuarios", "/api/usuarios/:id", "/api/usuarios/:id/:accion"] };
export { manejador };
