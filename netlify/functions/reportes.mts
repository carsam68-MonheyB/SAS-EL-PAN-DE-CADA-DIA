// Reporte "quién puede hacer qué" (por usuario y por permiso), exportable a Excel.
import type { Config, Context } from "@netlify/functions";
import { noEncontrado } from "../../src/servidor/errores";
import { fechaHoraMx, libroExcel, respuestaExcel } from "../../src/servidor/excel";
import { ruta } from "../../src/servidor/ruta";

const ACCIONES: Record<string, string> = {
  ver: "Ver", crear: "Crear", editar: "Editar", cancelar: "Cancelar", autorizar: "Autorizar", cerrar: "Cerrar",
  exportar: "Exportar", imprimir: "Imprimir", importar: "Importar", timbrar: "Timbrar", modificar: "Modificar", cargar: "Cargar",
};

const manejador = ruta({ permiso: "seguridad.usuarios:ver", metodos: ["GET"] }, async (ctx) => {
  if (ctx.params.reporte !== "quien-puede") throw noEncontrado("Reporte no encontrado.");
  const excel = ctx.url.searchParams.get("formato") === "xlsx";
  if (excel) ctx.exigir("seguridad.usuarios:exportar");
  const incluirBajas = ctx.url.searchParams.get("bajas") === "si";
  const { rows } = await ctx.tx((c) =>
    c.query(
      `SELECT u.usuario, u.nombre, u.puesto, u.estatus, u.es_prueba, r.clave AS rol, r.alcance,
              p.clave AS permiso, p.grupo, p.modulo_nombre, p.accion, p.sensible,
              (SELECT string_agg(s.clave, ', ' ORDER BY s.clave) FROM usuario_sucursal us JOIN sucursal s ON s.id = us.sucursal_id WHERE us.usuario_id = u.id) AS sucursales,
              (SELECT string_agg(a.clave, ', ' ORDER BY a.clave) FROM usuario_almacen ua JOIN almacen a ON a.id = ua.almacen_id WHERE ua.usuario_id = u.id) AS almacenes
         FROM usuario u
         JOIN usuario_rol ur ON ur.usuario_id = u.id
         JOIN rol r ON r.id = ur.rol_id AND r.activo
         JOIN rol_permiso rp ON rp.rol_id = r.id
         JOIN permiso p ON p.id = rp.permiso_id
        WHERE ($1 OR u.estatus <> 'baja')
        ORDER BY u.usuario, p.orden`,
      [incluirBajas],
    ),
  );
  const alcance = (r: (typeof rows)[number]) =>
    r.alcance === "todas" ? "Todas" : [r.sucursales && `Sucursales: ${r.sucursales}`, r.almacenes && `Almacenes: ${r.almacenes}`].filter(Boolean).join(" · ") || "Sin asignar";
  if (!excel) return { filas: rows.map((r) => ({ ...r, alcance_texto: alcance(r) })) };

  const porUsuario = rows.map((r) => ({
    usuario: r.usuario, nombre: r.nombre, puesto: r.puesto, estatus: r.estatus, prueba: r.es_prueba ? "Sí" : "",
    rol: r.rol, alcance: alcance(r), grupo: r.grupo, modulo: r.modulo_nombre, accion: ACCIONES[r.accion] ?? r.accion,
    sensible: r.sensible ? "Sí" : "", permiso: r.permiso,
  }));
  const mapa = new Map<string, { permiso: string; modulo: string; accion: string; sensible: string; usuarios: Set<string> }>();
  for (const r of rows) {
    const e = mapa.get(r.permiso) ?? { permiso: r.permiso, modulo: r.modulo_nombre, accion: ACCIONES[r.accion] ?? r.accion, sensible: r.sensible ? "Sí" : "", usuarios: new Set<string>() };
    e.usuarios.add(r.usuario);
    mapa.set(r.permiso, e);
  }
  const porPermiso = [...mapa.values()].map((e) => ({ ...e, cuantos: e.usuarios.size, usuarios: [...e.usuarios].join(", ") }));
  const libro = await libroExcel([
    {
      nombre: "Por usuario",
      columnas: [
        { titulo: "Usuario", clave: "usuario" }, { titulo: "Nombre", clave: "nombre", ancho: 28 }, { titulo: "Puesto", clave: "puesto" },
        { titulo: "Estatus", clave: "estatus", ancho: 11 }, { titulo: "Prueba", clave: "prueba", ancho: 8 }, { titulo: "Rol", clave: "rol", ancho: 8 },
        { titulo: "Alcance", clave: "alcance", ancho: 28 }, { titulo: "Grupo", clave: "grupo", ancho: 14 }, { titulo: "Módulo", clave: "modulo", ancho: 40 },
        { titulo: "Acción", clave: "accion", ancho: 11 }, { titulo: "Dato sensible", clave: "sensible", ancho: 12 }, { titulo: "Clave del permiso", clave: "permiso", ancho: 36 },
      ],
      filas: porUsuario,
    },
    {
      nombre: "Por permiso",
      columnas: [
        { titulo: "Clave del permiso", clave: "permiso", ancho: 36 }, { titulo: "Módulo", clave: "modulo", ancho: 40 }, { titulo: "Acción", clave: "accion", ancho: 11 },
        { titulo: "Dato sensible", clave: "sensible", ancho: 12 }, { titulo: "Usuarios", clave: "cuantos", ancho: 9 }, { titulo: "Quiénes", clave: "usuarios", ancho: 60 },
      ],
      filas: porPermiso,
    },
    {
      nombre: "Generado",
      columnas: [{ titulo: "Dato", clave: "k", ancho: 20 }, { titulo: "Valor", clave: "v", ancho: 40 }],
      filas: [{ k: "Generado el", v: fechaHoraMx(new Date()) }, { k: "Por", v: ctx.usuario.usuario }, { k: "Incluye bajas", v: incluirBajas ? "Sí" : "No" }],
    },
  ], "Quién puede hacer qué");
  return respuestaExcel(libro, "quien-puede-hacer-que.xlsx");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: "/api/reportes/:reporte" };
export { manejador };
