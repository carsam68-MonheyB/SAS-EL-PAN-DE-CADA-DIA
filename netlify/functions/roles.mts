// Roles (plantillas editables por puesto), catálogo de permisos,
// incompatibilidades y límites por monto.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { conflictosDeAsignacion } from "../../src/dominio/permisos";
import { conflicto, invalido, noEncontrado } from "../../src/servidor/errores";
import { leerCuerpo } from "../../src/servidor/http";
import { ruta } from "../../src/servidor/ruta";
import { leerIncompatibilidades, permisosDeRoles } from "../../src/servidor/seguridad";
import type { Cliente } from "../../src/servidor/transaccion";

const esquemaRol = z.object({
  nombre: z.string().trim().min(3).max(80),
  descripcion: z.string().trim().max(300).nullable().optional(),
  requiere_2fa: z.boolean(),
  alcance: z.enum(["todas", "sucursal", "almacen"]),
  activo: z.boolean().default(true),
});

async function detalleRol(c: Cliente, id: string) {
  const { rows } = await c.query(
    `SELECT r.*, coalesce((SELECT json_agg(p.clave ORDER BY p.orden) FROM rol_permiso rp JOIN permiso p ON p.id = rp.permiso_id WHERE rp.rol_id = r.id), '[]') AS permisos,
            (SELECT count(*)::int FROM usuario_rol ur JOIN usuario u ON u.id = ur.usuario_id WHERE ur.rol_id = r.id AND u.estatus <> 'baja') AS usuarios
       FROM rol r WHERE r.id = $1`,
    [id],
  );
  if (!rows[0]) throw noEncontrado("No existe el rol.");
  return rows[0];
}

/** Al cambiar un rol se revisa el rol solo y cada usuario que lo tiene (con sus demás roles). */
async function validarRolConUsuarios(c: Cliente, rolId: string, nuevosPermisos: string[]) {
  const reglas = await leerIncompatibilidades(c);
  const propios = conflictosDeAsignacion(nuevosPermisos, reglas);
  if (propios.length) throw conflicto("El rol viola la segregación de funciones.", propios);
  const { rows } = await c.query(
    `SELECT u.id, u.usuario, array_agg(ur2.rol_id) FILTER (WHERE ur2.rol_id <> $1) AS otros
       FROM usuario_rol ur JOIN usuario u ON u.id = ur.usuario_id AND u.estatus <> 'baja'
       LEFT JOIN usuario_rol ur2 ON ur2.usuario_id = u.id
      WHERE ur.rol_id = $1 GROUP BY u.id, u.usuario`,
    [rolId],
  );
  for (const u of rows) {
    const otros = await permisosDeRoles(c, u.otros ?? []);
    const conf = conflictosDeAsignacion([...nuevosPermisos, ...otros], reglas);
    if (conf.length) throw conflicto(`El cambio deja al usuario ${u.usuario} con funciones incompatibles.`, conf);
  }
}

const manejador = ruta({ permiso: "seguridad.usuarios:ver" }, async (ctx) => {
  const { id, sub } = ctx.params;
  const recurso = ctx.url.pathname.split("/")[2];
  const m = ctx.req.method;

  // ---- Catálogo de permisos
  if (recurso === "permisos" && m === "GET") {
    return ctx.tx(async (c) => ({
      permisos: (await c.query("SELECT clave, grupo, modulo, modulo_nombre, accion, sensible FROM permiso ORDER BY orden")).rows,
    }));
  }

  // ---- Incompatibilidades
  if (recurso === "incompatibilidades") {
    if (m === "GET") return ctx.tx(async (c) => ({ incompatibilidades: (await c.query("SELECT * FROM incompatibilidad ORDER BY nivel, clave")).rows }));
    ctx.exigir("configuracion.parametros:editar");
    const d = await leerCuerpo(ctx.req, z.object({
      nivel: z.enum(["asignacion", "documento"]),
      patron_a: z.string().trim().min(3).max(300),
      patron_b: z.string().trim().min(3).max(300),
      descripcion: z.string().trim().min(5).max(300),
      activa: z.boolean(),
      clave: z.string().trim().regex(/^[a-z0-9_]{3,60}$/).optional(),
    }));
    return ctx.tx(async (c) => {
      if (m === "POST") {
        if (!d.clave) throw invalido("Falta la clave.");
        await c.query("INSERT INTO incompatibilidad (clave, nivel, patron_a, patron_b, descripcion, activa) VALUES ($1,$2,$3,$4,$5,$6)", [d.clave, d.nivel, d.patron_a, d.patron_b, d.descripcion, d.activa]);
      } else if (m === "PUT" && id) {
        const r = await c.query("UPDATE incompatibilidad SET nivel=$2, patron_a=$3, patron_b=$4, descripcion=$5, activa=$6 WHERE id=$1", [id, d.nivel, d.patron_a, d.patron_b, d.descripcion, d.activa]);
        if (!r.rowCount) throw noEncontrado();
      } else throw noEncontrado("Ruta no encontrada.");
      // Una regla nueva no puede dejar a usuarios actuales en conflicto sin que se sepa.
      const reglas = await leerIncompatibilidades(c);
      const { rows } = await c.query(`SELECT u.usuario, array_agg(ur.rol_id) roles FROM usuario u JOIN usuario_rol ur ON ur.usuario_id = u.id WHERE u.estatus <> 'baja' GROUP BY u.usuario`);
      const afectados: string[] = [];
      for (const u of rows) if (conflictosDeAsignacion(await permisosDeRoles(c, u.roles), reglas).length) afectados.push(u.usuario);
      if (afectados.length) throw conflicto(`La regla deja en conflicto a: ${afectados.join(", ")}. Ajusta sus roles primero.`);
      return { incompatibilidades: (await c.query("SELECT * FROM incompatibilidad ORDER BY nivel, clave")).rows };
    });
  }

  // ---- Límites por monto
  if (recurso === "limites") {
    if (m === "GET") {
      return ctx.tx(async (c) => ({
        limites: (await c.query(`SELECT l.id, l.operacion, l.operacion_nombre, r.clave AS rol, r.nombre AS rol_nombre, l.monto_hasta, l.provisional
                                   FROM limite_autorizacion l JOIN rol r ON r.id = l.rol_id
                                  ORDER BY l.operacion, l.monto_hasta NULLS LAST`)).rows,
      }));
    }
    if (m === "PUT" && id) {
      ctx.exigir("configuracion.parametros:editar");
      const d = await leerCuerpo(ctx.req, z.object({ monto_hasta: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Monto con hasta 2 decimales.").nullable() }));
      return ctx.tx(async (c) => {
        const r = await c.query("UPDATE limite_autorizacion SET monto_hasta = $2, provisional = false WHERE id = $1 RETURNING *", [id, d.monto_hasta]);
        if (!r.rowCount) throw noEncontrado();
        return r.rows[0];
      });
    }
    throw noEncontrado("Ruta no encontrada.");
  }

  // ---- Roles
  if (recurso !== "roles") throw noEncontrado("Ruta no encontrada.");
  if (!id && m === "GET") {
    return ctx.tx(async (c) => ({
      roles: (await c.query(`SELECT r.id, r.clave, r.nombre, r.descripcion, r.requiere_2fa, r.alcance, r.activo,
                                    (SELECT count(*)::int FROM rol_permiso WHERE rol_id = r.id) AS permisos,
                                    (SELECT count(*)::int FROM usuario_rol ur JOIN usuario u ON u.id = ur.usuario_id WHERE ur.rol_id = r.id AND u.estatus <> 'baja') AS usuarios
                               FROM rol r ORDER BY r.activo DESC, r.clave`)).rows,
    }));
  }
  if (!id && m === "POST") {
    ctx.exigir("seguridad.usuarios:crear");
    const d = await leerCuerpo(ctx.req, esquemaRol.extend({ clave: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, "Clave: 2 a 20 letras mayúsculas, números o _.") }));
    return ctx.tx(async (c) => {
      const { rows } = await c.query(
        "INSERT INTO rol (clave, nombre, descripcion, requiere_2fa, alcance, activo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [d.clave, d.nombre, d.descripcion ?? null, d.requiere_2fa, d.alcance, d.activo],
      ).catch((e) => {
        if ((e as { code?: string }).code === "23505") throw invalido("Ya existe un rol con esa clave.");
        throw e;
      });
      return detalleRol(c, rows[0].id);
    });
  }
  if (!id) throw noEncontrado("Ruta no encontrada.");
  if (!sub && m === "GET") return ctx.tx((c) => detalleRol(c, id));
  if (!sub && m === "PUT") {
    ctx.exigir("seguridad.usuarios:editar");
    const d = await leerCuerpo(ctx.req, esquemaRol);
    return ctx.tx(async (c) => {
      const r = await c.query("UPDATE rol SET nombre=$2, descripcion=$3, requiere_2fa=$4, alcance=$5, activo=$6 WHERE id=$1", [id, d.nombre, d.descripcion ?? null, d.requiere_2fa, d.alcance, d.activo]);
      if (!r.rowCount) throw noEncontrado();
      return detalleRol(c, id);
    });
  }
  // PUT /api/roles/:id/permisos  { permisos: ["modulo:accion", ...] }
  if (sub === "permisos" && m === "PUT") {
    ctx.exigir("seguridad.usuarios:editar");
    const d = await leerCuerpo(ctx.req, z.object({ permisos: z.array(z.string().max(80)).max(500) }));
    return ctx.tx(async (c) => {
      const pedidos = [...new Set(d.permisos)];
      const { rows } = await c.query<{ id: string; clave: string }>("SELECT id, clave FROM permiso WHERE clave = ANY($1)", [pedidos]);
      if (rows.length !== pedidos.length) {
        const existentes = new Set(rows.map((r) => r.clave));
        throw invalido(`Permisos inexistentes: ${pedidos.filter((p) => !existentes.has(p)).join(", ")}`);
      }
      if (!(await c.query("SELECT 1 FROM rol WHERE id = $1", [id])).rowCount) throw noEncontrado();
      const rolesDelUsuario = await c.query("SELECT 1 FROM usuario_rol WHERE usuario_id = $1 AND rol_id = $2", [ctx.usuario.id, id]);
      if (rolesDelUsuario.rowCount) throw invalido("No puedes cambiar los permisos de un rol que tú mismo tienes.");
      await validarRolConUsuarios(c, id, pedidos);
      const ids = rows.map((r) => r.id);
      await c.query("DELETE FROM rol_permiso WHERE rol_id = $1 AND NOT (permiso_id = ANY($2))", [id, ids]);
      await c.query("INSERT INTO rol_permiso (rol_id, permiso_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING", [id, ids]);
      return detalleRol(c, id);
    });
  }
  throw noEncontrado("Ruta no encontrada.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = {
  path: [
    "/api/roles", "/api/roles/:id", "/api/roles/:id/:sub",
    "/api/permisos",
    "/api/incompatibilidades", "/api/incompatibilidades/:id",
    "/api/limites", "/api/limites/:id",
  ],
};
export { manejador };
