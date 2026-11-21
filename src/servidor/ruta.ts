// Envoltorio de TODA función del servidor. Antes de ejecutar el manejador:
//  1. protege contra CSRF (cabecera X-ERP en métodos que modifican),
//  2. valida la sesión (expiración e inactividad),
//  3. exige la etapa de acceso (contraseña cambiada, doble factor),
//  4. exige que el usuario esté activo y tenga el permiso pedido.
// Así los permisos se validan en el servidor, no solo ocultando botones.
import type { Context } from "@netlify/functions";
import { tieneAlguno } from "../dominio/permisos";
import { ErrorApp, noAutenticado, prohibido } from "./errores";
import { cookieBorrada, json, leerCookie, NOMBRE_COOKIE, respuestaDeError } from "./http";
import { obtenerPool } from "./db";
import type { Etapa, Sesion } from "./sesiones";
import { validarSesion } from "./sesiones";
import { enTransaccion, type Cliente } from "./transaccion";
import { cargarUsuario, type UsuarioActual } from "./usuarios";

export type Metodo = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ContextoPublico {
  req: Request;
  params: Record<string, string>;
  url: URL;
  ip: string | null;
  agente: string | null;
  requestId: string;
  /** Ejecuta en una transacción a nombre del usuario indicado (o anónimo). */
  tx<T>(fn: (c: Cliente) => Promise<T>, usuarioId?: string | null): Promise<T>;
}

export interface ContextoAutenticado extends ContextoPublico {
  sesion: Sesion;
  usuario: UsuarioActual;
  /** Transacción a nombre del usuario de la sesión (queda en la bitácora). */
  tx<T>(fn: (c: Cliente) => Promise<T>): Promise<T>;
  /** Lanza 403 si el usuario no tiene ninguno de los permisos. */
  exigir(permiso: string | string[]): void;
  puede(permiso: string | string[]): boolean;
}

type Resultado = Response | Record<string, unknown> | unknown[];

interface OpcionesBase {
  metodos?: Metodo[];
}
interface OpcionesPublicas extends OpcionesBase {
  publica: true;
}
interface OpcionesPrivadas extends OpcionesBase {
  publica?: false;
  /** Permiso requerido (basta con uno si es lista). Sin permiso = cualquier usuario con sesión completa. */
  permiso?: string | string[];
  /** Etapas de sesión aceptadas (por omisión solo "completa"). */
  etapas?: Etapa[];
}

const METODOS_QUE_MODIFICAN = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function base(req: Request, context: Partial<Context> | undefined) {
  const url = new URL(req.url);
  return {
    req,
    url,
    params: context?.params ?? {},
    ip: context?.ip ?? req.headers.get("x-nf-client-connection-ip") ?? null,
    agente: req.headers.get("user-agent"),
    requestId: context?.requestId ?? crypto.randomUUID(),
  };
}

async function registrarActividad() {
  // Un renglón por minuto con actividad: sirve para estimar el consumo de la base.
  await obtenerPool()
    .query("INSERT INTO actividad_bd (minuto) VALUES (date_trunc('minute', now())) ON CONFLICT DO NOTHING")
    .catch(() => undefined);
}

function comoRespuesta(r: Resultado): Response {
  return r instanceof Response ? r : json(r);
}

export function ruta(opciones: OpcionesPublicas, manejador: (ctx: ContextoPublico) => Promise<Resultado>): (req: Request, context?: Partial<Context>) => Promise<Response>;
export function ruta(opciones: OpcionesPrivadas, manejador: (ctx: ContextoAutenticado) => Promise<Resultado>): (req: Request, context?: Partial<Context>) => Promise<Response>;
export function ruta(
  opciones: OpcionesPublicas | OpcionesPrivadas,
  manejador: ((ctx: ContextoPublico) => Promise<Resultado>) | ((ctx: ContextoAutenticado) => Promise<Resultado>),
) {
  return async (req: Request, context?: Partial<Context>): Promise<Response> => {
    const b = base(req, context);
    try {
      if (opciones.metodos && !opciones.metodos.includes(req.method as Metodo)) {
        return json({ error: "metodo", mensaje: "Método no permitido." }, 405);
      }
      if (METODOS_QUE_MODIFICAN.has(req.method) && req.headers.get("x-erp") !== "1") {
        throw new ErrorApp(403, "csrf", "Solicitud rechazada por seguridad (falta la cabecera de la aplicación).");
      }
      await registrarActividad();

      if (opciones.publica) {
        const ctx: ContextoPublico = { ...b, tx: (fn, usuarioId = null) => enTransaccion(usuarioId, fn) };
        return comoRespuesta(await (manejador as (c: ContextoPublico) => Promise<Resultado>)(ctx));
      }

      const token = leerCookie(req, NOMBRE_COOKIE);
      if (!token) throw noAutenticado();
      const cargado = await enTransaccion(null, async (c) => {
        const sesion = await validarSesion(c, token);
        if (!sesion) return null;
        const usuario = await cargarUsuario(c, sesion.usuario_id);
        return usuario ? { sesion, usuario } : null;
      });
      if (!cargado) {
        return json({ error: "no_autenticado", mensaje: "Tu sesión terminó. Inicia sesión de nuevo." }, 401, { "set-cookie": cookieBorrada() });
      }
      const { sesion, usuario } = cargado;
      if (usuario.estatus !== "activo") {
        return json({ error: "no_autenticado", mensaje: "Tu usuario no está activo." }, 401, { "set-cookie": cookieBorrada() });
      }
      const etapas = opciones.etapas ?? ["completa"];
      if (!etapas.includes(sesion.etapa)) {
        throw new ErrorApp(403, "etapa", "Completa primero tu acceso.", { etapa: sesion.etapa });
      }
      if (opciones.permiso && !tieneAlguno(usuario.permisos, opciones.permiso)) throw prohibido();

      const ctx: ContextoAutenticado = {
        ...b,
        sesion,
        usuario,
        tx: (fn) => enTransaccion(usuario.id, fn),
        puede: (p) => tieneAlguno(usuario.permisos, p),
        exigir: (p) => {
          if (!tieneAlguno(usuario.permisos, p)) throw prohibido();
        },
      };
      return comoRespuesta(await (manejador as (c: ContextoAutenticado) => Promise<Resultado>)(ctx));
    } catch (e) {
      return respuestaDeError(e, b.requestId);
    }
  };
}
