// Alta del PRIMER administrador. Solo funciona si no existe ningún usuario y
// con la clave de la variable de entorno CLAVE_INSTALACION (no hay registro abierto).
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { igualesSeguro } from "../../src/servidor/cripto";
import { ErrorApp } from "../../src/servidor/errores";
import { leerCuerpo } from "../../src/servidor/http";
import { ruta } from "../../src/servidor/ruta";
import { generarToken, sincronizarAsignaciones, validarDatosUsuario } from "../../src/servidor/seguridad";
import { registrarAcceso } from "../../src/servidor/usuarios";

const manejador = ruta({ publica: true, metodos: ["GET", "POST"] }, async (ctx) => {
  if (ctx.req.method === "GET") {
    return ctx.tx(async (c) => ({ instalado: (await c.query("SELECT 1 FROM usuario LIMIT 1")).rowCount! > 0 }));
  }
  const d = await leerCuerpo(ctx.req, z.object({
    clave: z.string().min(1).max(300),
    usuario: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, "Usuario: 3 a 40 caracteres (letras, números, punto, guion)."),
    nombre: z.string().trim().min(3).max(120),
  }));
  const esperada = process.env.CLAVE_INSTALACION;
  if (!esperada || esperada.length < 20) throw new ErrorApp(503, "sin_clave", "Falta configurar CLAVE_INSTALACION (mínimo 20 caracteres) en Netlify.");
  return ctx.tx(async (c) => {
    await c.query("LOCK TABLE usuario IN EXCLUSIVE MODE");
    if ((await c.query("SELECT 1 FROM usuario LIMIT 1")).rowCount) throw new ErrorApp(409, "instalado", "El sistema ya tiene usuarios: la instalación ya no está disponible.");
    if (!igualesSeguro(d.clave, esperada)) {
      await registrarAcceso(c, { usuarioIntentado: d.usuario, evento: "instalacion", exito: false, ip: ctx.ip, agente: ctx.agente });
      return { error: true };
    }
    const rolIds = await validarDatosUsuario(c, { nombre: d.nombre, puesto: "Administrador del sistema", roles: ["ADM"], sucursales: [], almacenes: [] });
    const { rows } = await c.query("INSERT INTO usuario (usuario, nombre, puesto) VALUES ($1, $2, 'Administrador del sistema') RETURNING id", [d.usuario, d.nombre]);
    await sincronizarAsignaciones(c, rows[0].id, rolIds, [], []);
    const t = await generarToken(c, rows[0].id, "invitacion");
    await registrarAcceso(c, { usuarioId: rows[0].id, evento: "instalacion", exito: true, ip: ctx.ip, agente: ctx.agente });
    return { enlace: `${ctx.url.origin}/activar?token=${encodeURIComponent(t.token)}`, expira_en: t.expira_en };
  }).then((r) => {
    if ("error" in r) throw new ErrorApp(403, "clave", "La clave de instalación no es correcta.");
    return r;
  });
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: "/api/instalacion" };
export { manejador };
