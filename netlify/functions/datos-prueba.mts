// Crea un usuario FICTICIO por cada puesto (prefijo "prueba.", marcados es_prueba).
// Solo funciona si la variable PERMITIR_DATOS_PRUEBA = "si" (nunca en producción real).
import type { Config, Context } from "@netlify/functions";
import { hashear } from "../../src/servidor/contrasena";
import { codigoRecuperacion } from "../../src/servidor/cripto";
import { ErrorApp } from "../../src/servidor/errores";
import { ruta } from "../../src/servidor/ruta";
import { sincronizarAsignaciones, validarDatosUsuario } from "../../src/servidor/seguridad";

// Dónde opera cada puesto de prueba (claves de la estructura aprobada).
const UBICACION: Record<string, { sucursales?: string[]; almacenes?: string[] }> = {
  ALM: { almacenes: ["MP-MAT"] },
  JPR: { sucursales: ["MAT"] },
  MAE: { sucursales: ["MAT"] },
  PAN: { sucursales: ["MAT"] },
  ENC: { sucursales: ["SUC1"] },
  CAJ: { sucursales: ["SUC1"] },
};

const manejador = ruta({ permiso: "seguridad.usuarios:crear", metodos: ["POST"] }, async (ctx) => {
  if (process.env.PERMITIR_DATOS_PRUEBA !== "si") {
    throw new ErrorApp(403, "deshabilitado", "Los datos de prueba están deshabilitados en este ambiente.");
  }
  const password = `Prueba-${codigoRecuperacion(8)}-7`;
  return ctx.tx(async (c) => {
    const hash = await hashear(password);
    const roles = (await c.query("SELECT clave, nombre FROM rol WHERE activo ORDER BY clave")).rows;
    const creados: string[] = [];
    for (const r of roles) {
      const usuario = `prueba.${r.clave.toLowerCase()}`;
      const u = UBICACION[r.clave] ?? {};
      const sucursales = u.sucursales ? (await c.query("SELECT id FROM sucursal WHERE clave = ANY($1)", [u.sucursales])).rows.map((x) => x.id) : [];
      const almacenes = u.almacenes ? (await c.query("SELECT id FROM almacen WHERE clave = ANY($1)", [u.almacenes])).rows.map((x) => x.id) : [];
      const rolIds = await validarDatosUsuario(c, { nombre: `PRUEBA ${r.nombre}`, puesto: r.nombre, roles: [r.clave], sucursales, almacenes });
      const { rows } = await c.query(
        `INSERT INTO usuario (usuario, nombre, puesto, es_prueba, hash_password, debe_cambiar_password, password_cambiado_en)
         VALUES ($1, $2, $3, true, $4, false, now())
         ON CONFLICT (usuario) DO UPDATE SET hash_password = EXCLUDED.hash_password, estatus = 'activo',
           intentos_fallidos = 0, bloqueado_hasta = NULL
         WHERE usuario.es_prueba
         RETURNING id`,
        [usuario, `PRUEBA ${r.nombre}`, r.nombre, hash],
      );
      if (!rows[0]) continue; // existe un usuario real con ese nombre: no se toca
      await sincronizarAsignaciones(c, rows[0].id, rolIds, sucursales, almacenes);
      creados.push(usuario);
    }
    return {
      usuarios: creados,
      password,
      aviso: "Usuarios FICTICIOS. Esta contraseña se muestra una sola vez; al repetir la carga se genera otra. Los puestos con doble factor te pedirán activarlo al entrar.",
    };
  });
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: "/api/datos-prueba" };
export { manejador };
