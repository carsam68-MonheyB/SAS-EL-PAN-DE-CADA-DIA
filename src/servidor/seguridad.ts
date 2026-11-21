// Servicios de administración de usuarios y roles (reglas de negocio de 4.0).
import { conflictosDeAsignacion, type Conflicto, type Incompatibilidad } from "../dominio/permisos";
import { configEntero } from "./configuracion";
import { sha256, tokenAleatorio } from "./cripto";
import { conflicto, invalido } from "./errores";
import type { Cliente } from "./transaccion";

export async function leerIncompatibilidades(c: Cliente): Promise<Incompatibilidad[]> {
  const { rows } = await c.query("SELECT clave, nivel, patron_a, patron_b, descripcion, activa FROM incompatibilidad ORDER BY clave");
  return rows;
}

export async function permisosDeRoles(c: Cliente, rolIds: string[]): Promise<string[]> {
  if (!rolIds.length) return [];
  const { rows } = await c.query<{ clave: string }>(
    `SELECT DISTINCT p.clave FROM rol_permiso rp JOIN permiso p ON p.id = rp.permiso_id
      JOIN rol r ON r.id = rp.rol_id AND r.activo WHERE rp.rol_id = ANY($1)`,
    [rolIds],
  );
  return rows.map((r) => r.clave);
}

/** Lanza 409 con la lista de conflictos si los roles juntos violan la segregación. */
export async function validarSegregacion(c: Cliente, rolIds: string[], contexto: string): Promise<void> {
  const conflictos: Conflicto[] = conflictosDeAsignacion(await permisosDeRoles(c, rolIds), await leerIncompatibilidades(c));
  if (conflictos.length) {
    throw conflicto(`${contexto}: la combinación viola la segregación de funciones.`, conflictos);
  }
}

/** Genera un enlace de un solo uso para activar o restablecer la contraseña. */
export async function generarToken(c: Cliente, usuarioId: string, tipo: "invitacion" | "restablecer") {
  const horas = await configEntero(c, "seguridad.horas_vigencia_invitacion");
  await c.query("UPDATE token_acceso SET usado_en = now() WHERE usuario_id = $1 AND usado_en IS NULL", [usuarioId]);
  const token = tokenAleatorio();
  const { rows } = await c.query(
    `INSERT INTO token_acceso (usuario_id, tipo, token_hash, expira_en)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4)) RETURNING expira_en`,
    [usuarioId, tipo, sha256(token), horas],
  );
  return { token, expira_en: rows[0].expira_en as Date };
}

export interface DatosUsuario {
  nombre: string;
  puesto: string;
  correo?: string | null;
  roles: string[];        // claves de rol
  sucursales: string[];   // ids
  almacenes: string[];    // ids
}

/** Valida roles, alcance y segregación; devuelve los ids de los roles. */
export async function validarDatosUsuario(c: Cliente, d: DatosUsuario): Promise<string[]> {
  if (!d.roles.length) throw invalido("Asigna al menos un rol (puesto).");
  const { rows: roles } = await c.query("SELECT id, clave, alcance, activo FROM rol WHERE clave = ANY($1)", [d.roles]);
  const faltan = d.roles.filter((r) => !roles.some((x) => x.clave === r));
  if (faltan.length) throw invalido(`No existen los roles: ${faltan.join(", ")}.`);
  const inactivos = roles.filter((r) => !r.activo).map((r) => r.clave);
  if (inactivos.length) throw invalido(`Estos roles están inactivos: ${inactivos.join(", ")}.`);
  const alcances = new Set(roles.map((r) => r.alcance));
  if (!alcances.has("todas")) {
    if (alcances.has("sucursal") && !d.sucursales.length) throw invalido("El puesto opera por sucursal: asigna al menos una sucursal.");
    if (alcances.has("almacen") && !d.almacenes.length && !d.sucursales.length) throw invalido("El puesto opera por almacén: asigna al menos un almacén.");
  }
  if (d.sucursales.length) {
    const r = await c.query("SELECT count(*)::int n FROM sucursal WHERE id = ANY($1)", [d.sucursales]);
    if (r.rows[0].n !== new Set(d.sucursales).size) throw invalido("Alguna sucursal no existe.");
  }
  if (d.almacenes.length) {
    const r = await c.query("SELECT count(*)::int n FROM almacen WHERE id = ANY($1)", [d.almacenes]);
    if (r.rows[0].n !== new Set(d.almacenes).size) throw invalido("Algún almacén no existe.");
  }
  const ids = roles.map((r) => r.id as string);
  await validarSegregacion(c, ids, "Roles del usuario");
  return ids;
}

/** Reemplaza roles, sucursales y almacenes del usuario (solo cambia lo distinto, para una bitácora limpia). */
export async function sincronizarAsignaciones(c: Cliente, usuarioId: string, rolIds: string[], sucursales: string[], almacenes: string[]) {
  const pares: [string, string, string[]][] = [
    ["usuario_rol", "rol_id", rolIds],
    ["usuario_sucursal", "sucursal_id", [...new Set(sucursales)]],
    ["usuario_almacen", "almacen_id", [...new Set(almacenes)]],
  ];
  for (const [tabla, columna, ids] of pares) {
    await c.query(`DELETE FROM ${tabla} WHERE usuario_id = $1 AND NOT (${columna} = ANY($2))`, [usuarioId, ids]);
    await c.query(
      `INSERT INTO ${tabla} (usuario_id, ${columna}) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [usuarioId, ids],
    );
  }
}
