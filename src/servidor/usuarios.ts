import type { Alcance } from "../dominio/permisos";
import type { Cliente } from "./transaccion";

export interface UsuarioActual {
  id: string;
  usuario: string;
  nombre: string;
  puesto: string;
  estatus: string;
  es_prueba: boolean;
  totp_activo: boolean;
  tiene_pin: boolean;
  roles: { clave: string; nombre: string; requiere_2fa: boolean; alcance: string }[];
  permisos: Set<string>;
  requiere2fa: boolean;
  alcance: Alcance;
}

export async function cargarUsuario(c: Cliente, id: string): Promise<UsuarioActual | null> {
  const { rows } = await c.query(
    `SELECT id, usuario, nombre, puesto, estatus, es_prueba, totp_activo, pin_hash IS NOT NULL AS tiene_pin
       FROM usuario WHERE id = $1`,
    [id],
  );
  const u = rows[0];
  if (!u) return null;
  const roles = await c.query(
    `SELECT r.id, r.clave, r.nombre, r.requiere_2fa, r.alcance
       FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id
      WHERE ur.usuario_id = $1 AND r.activo
      ORDER BY r.clave`,
    [id],
  );
  const permisos = await c.query<{ clave: string }>(
    `SELECT DISTINCT p.clave
       FROM usuario_rol ur
       JOIN rol r ON r.id = ur.rol_id AND r.activo
       JOIN rol_permiso rp ON rp.rol_id = r.id
       JOIN permiso p ON p.id = rp.permiso_id
      WHERE ur.usuario_id = $1`,
    [id],
  );
  const sucursales = await c.query<{ sucursal_id: string }>("SELECT sucursal_id FROM usuario_sucursal WHERE usuario_id = $1", [id]);
  const almacenes = await c.query<{ almacen_id: string }>("SELECT almacen_id FROM usuario_almacen WHERE usuario_id = $1", [id]);
  return {
    id: u.id,
    usuario: u.usuario,
    nombre: u.nombre,
    puesto: u.puesto,
    estatus: u.estatus,
    es_prueba: u.es_prueba,
    totp_activo: u.totp_activo,
    tiene_pin: u.tiene_pin,
    roles: roles.rows.map((r) => ({ clave: r.clave, nombre: r.nombre, requiere_2fa: r.requiere_2fa, alcance: r.alcance })),
    permisos: new Set(permisos.rows.map((p) => p.clave)),
    requiere2fa: roles.rows.some((r) => r.requiere_2fa),
    alcance: {
      todas: roles.rows.some((r) => r.alcance === "todas"),
      sucursales: sucursales.rows.map((s) => s.sucursal_id),
      almacenes: almacenes.rows.map((a) => a.almacen_id),
    },
  };
}

export async function registrarAcceso(
  c: Cliente,
  datos: { usuarioId?: string | null; usuarioIntentado?: string | null; evento: string; exito: boolean; ip?: string | null; agente?: string | null; detalle?: string | null },
) {
  await c.query(
    `INSERT INTO bitacora_acceso (usuario_id, usuario_intentado, evento, exito, ip, agente, detalle)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [datos.usuarioId ?? null, datos.usuarioIntentado ?? null, datos.evento, datos.exito, datos.ip ?? null, datos.agente?.slice(0, 300) ?? null, datos.detalle ?? null],
  );
}
