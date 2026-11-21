// Autenticación: contraseña, doble factor (TOTP), invitaciones, PIN y caja.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { dentroDeAlcanceSucursal, tieneAlguno } from "../../src/dominio/permisos";
import { configEntero } from "../../src/servidor/configuracion";
import { hashear, problemasDeContrasena, verificar } from "../../src/servidor/contrasena";
import { cifrar, codigoRecuperacion, descifrar, sha256 } from "../../src/servidor/cripto";
import { ErrorApp, invalido, noAutenticado, prohibido } from "../../src/servidor/errores";
import { cookieBorrada, cookieSesion, json, leerCuerpo, respuestaDeError } from "../../src/servidor/http";
import { ruta, type ContextoAutenticado, type ContextoPublico } from "../../src/servidor/ruta";
import { crearSesion, revocarSesion, type Etapa } from "../../src/servidor/sesiones";
import { datosEnrolamiento, nuevoSecretoTotp, validarCodigoTotp } from "../../src/servidor/totp";
import type { Cliente } from "../../src/servidor/transaccion";
import { cargarUsuario, registrarAcceso } from "../../src/servidor/usuarios";

const MENSAJE_CREDENCIALES = "Usuario o contraseña incorrectos.";
const ETAPAS_INCOMPLETAS: Etapa[] = ["segundo_factor", "enrolar_totp", "cambiar_password"];

/** Qué le falta al usuario para completar el acceso. */
async function etapaSiguiente(c: Cliente, usuarioId: string, segundoFactorHecho: boolean): Promise<Etapa> {
  const u = await cargarUsuario(c, usuarioId);
  if (!u) throw noAutenticado();
  const { rows } = await c.query("SELECT debe_cambiar_password FROM usuario WHERE id = $1", [usuarioId]);
  if (rows[0]?.debe_cambiar_password) return "cambiar_password";
  if (u.totp_activo && !segundoFactorHecho) return "segundo_factor";
  if (u.requiere2fa && !u.totp_activo) return "enrolar_totp";
  return "completa";
}

/** Reemplaza la sesión actual por una nueva (evita fijación de sesión). */
async function rotarSesion(ctx: ContextoPublico, c: Cliente, sesionAnterior: string | null, usuarioId: string, etapa: Etapa) {
  if (sesionAnterior) await revocarSesion(c, sesionAnterior, "rotada");
  return crearSesion(c, { usuarioId, etapa, ip: ctx.ip, agente: ctx.agente });
}

function respuestaConSesion(datos: Record<string, unknown>, sesion: { token: string; maxAge: number }) {
  return json(datos, 200, { "set-cookie": cookieSesion(sesion.token, sesion.maxAge) });
}

async function contarFallo(c: Cliente, usuarioId: string): Promise<string | null> {
  const maximos = await configEntero(c, "seguridad.intentos_maximos");
  const minutos = await configEntero(c, "seguridad.minutos_bloqueo");
  const { rows } = await c.query(
    `UPDATE usuario SET intentos_fallidos = intentos_fallidos + 1 WHERE id = $1 RETURNING intentos_fallidos`,
    [usuarioId],
  );
  if ((rows[0]?.intentos_fallidos ?? 0) >= maximos) {
    await c.query(
      `UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = now() + make_interval(mins => $2) WHERE id = $1`,
      [usuarioId, minutos],
    );
    return `Por seguridad tu usuario quedó bloqueado ${minutos} minutos.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
const login = ruta({ publica: true, metodos: ["POST"] }, async (ctx) => {
  const datos = await leerCuerpo(ctx.req, z.object({ usuario: z.string().trim().toLowerCase().min(1).max(40), password: z.string().min(1).max(200) }));
  // El conteo de intentos y la bitácora se guardan aunque el acceso falle.
  const resultado = await ctx.tx(async (c) => {
    const { rows } = await c.query(
      "SELECT id, estatus, hash_password, bloqueado_hasta FROM usuario WHERE usuario = $1",
      [datos.usuario],
    );
    const u = rows[0];
    const ok = await verificar(datos.password, u?.hash_password);
    const base = { usuarioIntentado: datos.usuario, ip: ctx.ip, agente: ctx.agente };
    if (!u) {
      await registrarAcceso(c, { ...base, evento: "login", exito: false, detalle: "usuario inexistente" });
      return { error: MENSAJE_CREDENCIALES };
    }
    if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
      await registrarAcceso(c, { ...base, usuarioId: u.id, evento: "login", exito: false, detalle: "usuario bloqueado" });
      return { error: "Tu usuario está bloqueado temporalmente por intentos fallidos. Intenta más tarde." };
    }
    if (u.estatus !== "activo") {
      await registrarAcceso(c, { ...base, usuarioId: u.id, evento: "login", exito: false, detalle: `estatus ${u.estatus}` });
      return { error: "Tu usuario no está activo. Consulta al administrador." };
    }
    if (!u.hash_password) {
      await registrarAcceso(c, { ...base, usuarioId: u.id, evento: "login", exito: false, detalle: "invitación pendiente" });
      return { error: "Aún no activas tu usuario. Usa el enlace de invitación que te dio el administrador." };
    }
    if (!ok) {
      const bloqueo = await contarFallo(c, u.id);
      await registrarAcceso(c, { ...base, usuarioId: u.id, evento: "login", exito: false, detalle: bloqueo ? "contraseña incorrecta; bloqueado" : "contraseña incorrecta" });
      return { error: bloqueo ? `${MENSAJE_CREDENCIALES} ${bloqueo}` : MENSAJE_CREDENCIALES };
    }
    await c.query("UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1", [u.id]);
    const etapa = await etapaSiguiente(c, u.id, false);
    await registrarAcceso(c, { ...base, usuarioId: u.id, evento: "login", exito: true, detalle: `etapa ${etapa}` });
    const sesion = await crearSesion(c, { usuarioId: u.id, etapa, ip: ctx.ip, agente: ctx.agente });
    return { etapa, sesion };
  });
  if ("error" in resultado) throw new ErrorApp(401, "credenciales", resultado.error as string);
  return respuestaConSesion({ etapa: resultado.etapa }, resultado.sesion);
});

// ---------------------------------------------------------------------------
const segundoFactor = ruta({ metodos: ["POST"], etapas: ["segundo_factor"] }, async (ctx) => {
  const datos = await leerCuerpo(ctx.req, z.object({ codigo: z.string().trim().max(20) }));
  const resultado = await ctx.tx(async (c) => {
    const { rows } = await c.query("SELECT usuario, totp_secreto, totp_ultimo_paso FROM usuario WHERE id = $1", [ctx.usuario.id]);
    const u = rows[0];
    let ok = false;
    let detalle = "código de app";
    const codigo = datos.codigo.replace(/\s|-/g, "");
    if (/^\d{6}$/.test(codigo) && u?.totp_secreto) {
      const paso = validarCodigoTotp(descifrar(u.totp_secreto), u.usuario, codigo, u.totp_ultimo_paso === null ? null : Number(u.totp_ultimo_paso));
      if (paso !== null) {
        ok = true;
        await c.query("UPDATE usuario SET totp_ultimo_paso = $2 WHERE id = $1", [ctx.usuario.id, paso]);
      }
    } else if (/^[a-z0-9]{10}$/i.test(codigo)) {
      detalle = "código de recuperación";
      const codigos = await c.query("SELECT id, codigo_hash FROM codigo_recuperacion WHERE usuario_id = $1 AND usado_en IS NULL", [ctx.usuario.id]);
      for (const r of codigos.rows) {
        if (await verificar(codigo.toLowerCase(), r.codigo_hash)) {
          await c.query("UPDATE codigo_recuperacion SET usado_en = now() WHERE id = $1", [r.id]);
          ok = true;
          break;
        }
      }
    }
    const base = { usuarioId: ctx.usuario.id, ip: ctx.ip, agente: ctx.agente, evento: "segundo_factor" };
    if (!ok) {
      const bloqueo = await contarFallo(c, ctx.usuario.id);
      if (bloqueo) await revocarSesion(c, ctx.sesion.id, "bloqueo");
      await registrarAcceso(c, { ...base, exito: false, detalle: `${detalle} incorrecto${bloqueo ? "; bloqueado" : ""}` });
      return { error: bloqueo ? `Código incorrecto. ${bloqueo}` : "Código incorrecto." };
    }
    await c.query("UPDATE usuario SET intentos_fallidos = 0 WHERE id = $1", [ctx.usuario.id]);
    await registrarAcceso(c, { ...base, exito: true, detalle });
    const etapa = await etapaSiguiente(c, ctx.usuario.id, true);
    return { etapa, sesion: await rotarSesion(ctx, c, ctx.sesion.id, ctx.usuario.id, etapa) };
  });
  if ("error" in resultado) throw new ErrorApp(401, "codigo", resultado.error as string);
  return respuestaConSesion({ etapa: resultado.etapa }, resultado.sesion);
});

// ---------------------------------------------------------------------------
const salir = ruta({ metodos: ["POST"], etapas: ["completa", ...ETAPAS_INCOMPLETAS] }, async (ctx) => {
  await ctx.tx(async (c) => {
    await revocarSesion(c, ctx.sesion.id, "salida");
    await registrarAcceso(c, { usuarioId: ctx.usuario.id, evento: "salida", exito: true, ip: ctx.ip, agente: ctx.agente });
  });
  return json({ ok: true }, 200, { "set-cookie": cookieBorrada() });
});

// ---------------------------------------------------------------------------
const yo = ruta({ metodos: ["GET"], etapas: ["completa", ...ETAPAS_INCOMPLETAS] }, async (ctx) => {
  const u = ctx.usuario;
  return {
    etapa: ctx.sesion.etapa,
    // Etiqueta visible del ambiente (ej. "Desarrollo · datos ficticios"); sin valor no se muestra.
    ambiente: process.env.AMBIENTE_ETIQUETA ?? null,
    sesion: { tipo: ctx.sesion.tipo, caja_id: ctx.sesion.caja_id, cajero_actual_id: ctx.sesion.cajero_actual_id, expira_en: ctx.sesion.expira_en },
    usuario: { id: u.id, usuario: u.usuario, nombre: u.nombre, puesto: u.puesto, es_prueba: u.es_prueba, totp_activo: u.totp_activo, tiene_pin: u.tiene_pin, requiere2fa: u.requiere2fa },
    roles: u.roles,
    permisos: [...u.permisos].sort(),
    alcance: u.alcance,
  };
});

// ---------------------------------------------------------------------------
const cambiarPassword = ruta({ metodos: ["POST"], etapas: ["completa", "cambiar_password"] }, async (ctx) => {
  const datos = await leerCuerpo(ctx.req, z.object({ actual: z.string().min(1).max(200), nueva: z.string().min(1).max(200) }));
  const resultado = await ctx.tx(async (c) => {
    const { rows } = await c.query("SELECT hash_password FROM usuario WHERE id = $1", [ctx.usuario.id]);
    if (!(await verificar(datos.actual, rows[0]?.hash_password))) {
      const bloqueo = await contarFallo(c, ctx.usuario.id);
      await registrarAcceso(c, { usuarioId: ctx.usuario.id, evento: "cambio_password", exito: false, detalle: "contraseña actual incorrecta", ip: ctx.ip, agente: ctx.agente });
      return { error: bloqueo ? `La contraseña actual no es correcta. ${bloqueo}` : "La contraseña actual no es correcta." };
    }
    const problemas = problemasDeContrasena(datos.nueva, await configEntero(c, "seguridad.password_longitud_minima"), ctx.usuario.usuario);
    if (datos.nueva === datos.actual) problemas.push("La nueva contraseña debe ser distinta de la actual.");
    if (problemas.length) throw invalido("La nueva contraseña no cumple la política.", problemas);
    await c.query(
      "UPDATE usuario SET hash_password = $2, debe_cambiar_password = false, password_cambiado_en = now() WHERE id = $1",
      [ctx.usuario.id, await hashear(datos.nueva)],
    );
    await registrarAcceso(c, { usuarioId: ctx.usuario.id, evento: "cambio_password", exito: true, ip: ctx.ip, agente: ctx.agente });
    // Cierra las demás sesiones del usuario.
    await c.query("UPDATE sesion SET revocada_en = now(), motivo_cierre = 'cambio de contraseña' WHERE usuario_id = $1 AND id <> $2 AND revocada_en IS NULL", [ctx.usuario.id, ctx.sesion.id]);
    const etapa = await etapaSiguiente(c, ctx.usuario.id, ctx.sesion.etapa === "completa");
    return { etapa, sesion: await rotarSesion(ctx, c, ctx.sesion.id, ctx.usuario.id, etapa) };
  });
  if ("error" in resultado) throw new ErrorApp(400, "password", resultado.error as string);
  return respuestaConSesion({ etapa: resultado.etapa }, resultado.sesion);
});

// ---------------------------------------------------------------------------
const totpIniciar = ruta({ metodos: ["POST"], etapas: ["completa", "enrolar_totp"] }, async (ctx) => {
  if (ctx.usuario.totp_activo) throw invalido("Ya tienes activado el doble factor.");
  const secreto = nuevoSecretoTotp();
  await ctx.tx(async (c) => {
    await c.query("UPDATE usuario SET totp_secreto = $2, totp_activo = false, totp_ultimo_paso = NULL WHERE id = $1", [ctx.usuario.id, cifrar(secreto)]);
  });
  return datosEnrolamiento(secreto, ctx.usuario.usuario);
});

const totpConfirmar = ruta({ metodos: ["POST"], etapas: ["completa", "enrolar_totp"] }, async (ctx) => {
  const datos = await leerCuerpo(ctx.req, z.object({ codigo: z.string().trim().regex(/^\d{6}$/, "Escribe los 6 dígitos de la app.") }));
  const resultado = await ctx.tx(async (c) => {
    const { rows } = await c.query("SELECT usuario, totp_secreto, totp_activo FROM usuario WHERE id = $1", [ctx.usuario.id]);
    const u = rows[0];
    if (!u?.totp_secreto || u.totp_activo) throw invalido("Primero inicia la activación del doble factor.");
    const paso = validarCodigoTotp(descifrar(u.totp_secreto), u.usuario, datos.codigo, null);
    if (paso === null) {
      await registrarAcceso(c, { usuarioId: ctx.usuario.id, evento: "activar_2fa", exito: false, ip: ctx.ip, agente: ctx.agente });
      throw invalido("El código no coincide. Revisa la hora del celular y vuelve a intentar.");
    }
    await c.query("UPDATE usuario SET totp_activo = true, totp_ultimo_paso = $2 WHERE id = $1", [ctx.usuario.id, paso]);
    await c.query("UPDATE codigo_recuperacion SET usado_en = now() WHERE usuario_id = $1 AND usado_en IS NULL", [ctx.usuario.id]);
    const codigos: string[] = [];
    for (let i = 0; i < 10; i++) {
      const codigo = codigoRecuperacion();
      codigos.push(codigo);
      await c.query("INSERT INTO codigo_recuperacion (usuario_id, codigo_hash) VALUES ($1, $2)", [ctx.usuario.id, await hashear(codigo)]);
    }
    await registrarAcceso(c, { usuarioId: ctx.usuario.id, evento: "activar_2fa", exito: true, ip: ctx.ip, agente: ctx.agente });
    const etapa = await etapaSiguiente(c, ctx.usuario.id, true);
    return { etapa, codigos, sesion: await rotarSesion(ctx, c, ctx.sesion.id, ctx.usuario.id, etapa) };
  });
  return respuestaConSesion({ etapa: resultado.etapa, codigos_recuperacion: resultado.codigos }, resultado.sesion);
});

// ---------------------------------------------------------------------------
// Activación con el enlace de invitación (o restablecimiento) que entrega el administrador.
const activar = ruta({ publica: true, metodos: ["POST"] }, async (ctx) => {
  const datos = await leerCuerpo(ctx.req, z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200) }));
  const resultado = await ctx.tx(async (c) => {
    const { rows } = await c.query(
      `SELECT t.id, t.usuario_id, t.tipo, u.usuario, u.estatus
         FROM token_acceso t JOIN usuario u ON u.id = t.usuario_id
        WHERE t.token_hash = $1 AND t.usado_en IS NULL AND t.expira_en > now()`,
      [sha256(datos.token)],
    );
    const t = rows[0];
    if (!t || t.estatus !== "activo") throw invalido("El enlace no es válido o ya venció. Pide uno nuevo al administrador.");
    const problemas = problemasDeContrasena(datos.password, await configEntero(c, "seguridad.password_longitud_minima"), t.usuario);
    if (problemas.length) throw invalido("La contraseña no cumple la política.", problemas);
    await c.query("UPDATE token_acceso SET usado_en = now() WHERE id = $1", [t.id]);
    await c.query(
      `UPDATE usuario SET hash_password = $2, debe_cambiar_password = false, password_cambiado_en = now(),
              intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1`,
      [t.usuario_id, await hashear(datos.password)],
    );
    await c.query("UPDATE sesion SET revocada_en = now(), motivo_cierre = 'activación' WHERE usuario_id = $1 AND revocada_en IS NULL", [t.usuario_id]);
    await registrarAcceso(c, { usuarioId: t.usuario_id, evento: t.tipo === "invitacion" ? "activacion" : "restablecimiento", exito: true, ip: ctx.ip, agente: ctx.agente });
    return { usuario: t.usuario };
  }, null);
  return { ok: true, usuario: resultado.usuario, mensaje: "Listo. Ya puedes iniciar sesión con tu nueva contraseña." };
});

// ---------------------------------------------------------------------------
// PIN de cajero: lo define el propio usuario confirmando su contraseña.
const miPin = ruta({ metodos: ["POST"], permiso: "pos.ventas:crear" }, async (ctx) => {
  const datos = await leerCuerpo(ctx.req, z.object({ password: z.string().min(1).max(200), pin: z.string().regex(/^\d+$/, "El PIN solo lleva números.") }));
  await ctx.tx(async (c) => {
    const digitos = await configEntero(c, "seguridad.pin_digitos");
    if (datos.pin.length !== digitos) throw invalido(`El PIN debe tener ${digitos} dígitos.`);
    if (/^(\d)\1+$/.test(datos.pin) || "0123456789".includes(datos.pin) || "9876543210".includes(datos.pin)) {
      throw invalido("Elige un PIN menos predecible (no repetidos ni consecutivos).");
    }
    const { rows } = await c.query("SELECT hash_password FROM usuario WHERE id = $1", [ctx.usuario.id]);
    if (!(await verificar(datos.password, rows[0]?.hash_password))) throw invalido("La contraseña no es correcta.");
    await c.query("UPDATE usuario SET pin_hash = $2, intentos_pin = 0, pin_bloqueado_hasta = NULL WHERE id = $1", [ctx.usuario.id, await hashear(datos.pin)]);
    await registrarAcceso(c, { usuarioId: ctx.usuario.id, evento: "cambio_pin", exito: true, ip: ctx.ip, agente: ctx.agente });
  });
  return { ok: true };
});

// Convierte la sesión en sesión de caja (la abre quien tiene permiso de caja).
const abrirSesionCaja = ruta({ metodos: ["POST"], permiso: ["pos.caja:crear", "pos.caja:autorizar"] }, async (ctx) => {
  const datos = await leerCuerpo(ctx.req, z.object({ caja_id: z.uuid() }));
  await ctx.tx(async (c) => {
    const { rows } = await c.query("SELECT id, sucursal_id, activo FROM caja WHERE id = $1", [datos.caja_id]);
    const caja = rows[0];
    if (!caja?.activo) throw invalido("La caja no existe o está inactiva.");
    if (!dentroDeAlcanceSucursal(ctx.usuario.alcance, caja.sucursal_id)) throw prohibido("Esa caja no es de tu sucursal.");
    await c.query("UPDATE sesion SET tipo = 'pos', caja_id = $2, cajero_actual_id = $3 WHERE id = $1", [ctx.sesion.id, caja.id, ctx.usuario.id]);
    await registrarAcceso(c, { usuarioId: ctx.usuario.id, evento: "sesion_caja", exito: true, ip: ctx.ip, agente: ctx.agente, detalle: `caja ${caja.id}` });
  });
  return { ok: true };
});

// Cambio de cajero con PIN sin cerrar la caja.
const cambiarCajero = ruta({ metodos: ["POST"] }, async (ctx) => {
  if (ctx.sesion.tipo !== "pos" || !ctx.sesion.caja_id) throw invalido("Esta sesión no es de una caja.");
  const datos = await leerCuerpo(ctx.req, z.object({ usuario: z.string().trim().toLowerCase().min(1).max(40), pin: z.string().regex(/^\d{4,8}$/) }));
  const resultado = await ctx.tx(async (c) => {
    const caja = (await c.query("SELECT sucursal_id FROM caja WHERE id = $1", [ctx.sesion.caja_id])).rows[0];
    const { rows } = await c.query("SELECT id, estatus, pin_hash, pin_bloqueado_hasta FROM usuario WHERE usuario = $1", [datos.usuario]);
    const u = rows[0];
    const base = { usuarioIntentado: datos.usuario, ip: ctx.ip, agente: ctx.agente, evento: "cambio_cajero" };
    const ok = await verificar(datos.pin, u?.pin_hash);
    if (!u || u.estatus !== "activo" || (u.pin_bloqueado_hasta && new Date(u.pin_bloqueado_hasta) > new Date())) {
      await registrarAcceso(c, { ...base, usuarioId: u?.id, exito: false, detalle: "usuario no disponible o PIN bloqueado" });
      return { error: "No se pudo cambiar de cajero." };
    }
    if (!ok) {
      const maximos = await configEntero(c, "seguridad.pin_intentos_maximos");
      const minutos = await configEntero(c, "seguridad.minutos_bloqueo");
      const r = await c.query("UPDATE usuario SET intentos_pin = intentos_pin + 1 WHERE id = $1 RETURNING intentos_pin", [u.id]);
      if (r.rows[0].intentos_pin >= maximos) {
        await c.query("UPDATE usuario SET intentos_pin = 0, pin_bloqueado_hasta = now() + make_interval(mins => $2) WHERE id = $1", [u.id, minutos]);
      }
      await registrarAcceso(c, { ...base, usuarioId: u.id, exito: false, detalle: "PIN incorrecto" });
      return { error: "PIN incorrecto." };
    }
    const cajero = await cargarUsuario(c, u.id);
    if (!cajero || !tieneAlguno(cajero.permisos, "pos.ventas:crear") || !dentroDeAlcanceSucursal(cajero.alcance, caja.sucursal_id)) {
      await registrarAcceso(c, { ...base, usuarioId: u.id, exito: false, detalle: "sin permiso de venta en esta sucursal" });
      return { error: "Ese usuario no puede vender en esta caja." };
    }
    await c.query("UPDATE usuario SET intentos_pin = 0 WHERE id = $1", [u.id]);
    await c.query("UPDATE sesion SET cajero_actual_id = $2 WHERE id = $1", [ctx.sesion.id, u.id]);
    await registrarAcceso(c, { ...base, usuarioId: u.id, exito: true, detalle: `caja ${ctx.sesion.caja_id}` });
    return { cajero: { id: cajero.id, nombre: cajero.nombre } };
  });
  if ("error" in resultado) throw new ErrorApp(401, "pin", resultado.error as string);
  return resultado;
});

// ---------------------------------------------------------------------------
const acciones: Record<string, (req: Request, context?: Partial<Context>) => Promise<Response>> = {
  login,
  "segundo-factor": segundoFactor,
  salir,
  yo,
  "cambiar-password": cambiarPassword,
  "totp-iniciar": totpIniciar,
  "totp-confirmar": totpConfirmar,
  activar,
  "mi-pin": miPin,
  caja: abrirSesionCaja,
  cajero: cambiarCajero,
};

export default async (req: Request, context: Context) => {
  const accion = acciones[context.params?.accion ?? ""];
  if (!accion) return respuestaDeError(new ErrorApp(404, "no_encontrado", "Ruta no encontrada."));
  return accion(req, context);
};

export const config: Config = { path: "/api/auth/:accion" };

// Para pruebas.
export const _acciones = acciones;
export type { ContextoAutenticado };
