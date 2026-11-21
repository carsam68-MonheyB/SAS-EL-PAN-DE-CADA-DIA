import { beforeAll, describe, it, expect } from "vitest";
import type pg from "pg";
import { baseLimpia, codigoTotp, entrar, instalarAdministrador, Navegador, tokenDeEnlace } from "./apoyo";

let pool: pg.Pool;
let admin: Navegador;
let adminSecreto: string;

beforeAll(async () => {
  pool = await baseLimpia("erp_prueba_autenticacion");
  const r = await instalarAdministrador();
  admin = r.nav;
  adminSecreto = r.secreto!;
});

describe("instalación", () => {
  it("ya no permite instalar una segunda vez", async () => {
    const r = await new Navegador().post("/api/instalacion", { clave: process.env.CLAVE_INSTALACION, usuario: "otro", nombre: "Otro admin" });
    expect(r.estado).toBe(409);
  });
});

describe("todo exige sesión", () => {
  it("sin sesión responde 401", async () => {
    const nav = new Navegador();
    for (const ruta of ["/api/usuarios", "/api/roles", "/api/bitacora/accesos", "/api/configuracion", "/api/estructura", "/api/auth/yo"]) {
      expect((await nav.get(ruta)).estado, ruta).toBe(401);
    }
  });
  it("rechaza cambios sin la cabecera de la aplicación (CSRF)", async () => {
    const r = await admin.llamar("POST", "/api/usuarios", { usuario: "x" }, { sinCabeceraErp: true });
    expect(r.estado).toBe(403);
  });
});

describe("alta por invitación y política de contraseñas", () => {
  let enlace: string;
  it("el administrador da de alta y obtiene el enlace de invitación", async () => {
    const r = await admin.post("/api/usuarios", {
      usuario: "cajero.uno", nombre: "Cajero Uno", puesto: "Cajero", roles: ["CAJ"],
      sucursales: [(await pool.query("SELECT id FROM sucursal WHERE clave = 'SUC1'")).rows[0].id],
    });
    expect(r.estado).toBe(200);
    expect(r.datos.usuario.activado).toBe(false);
    enlace = r.datos.invitacion.enlace;
  });
  it("no puede entrar antes de activar", async () => {
    const r = await new Navegador().post("/api/auth/login", { usuario: "cajero.uno", password: "cualquiera1" });
    expect(r.estado).toBe(401);
  });
  it("rechaza contraseñas que no cumplen la política", async () => {
    const r = await new Navegador().post("/api/auth/activar", { token: tokenDeEnlace(enlace), password: "corta1" });
    expect(r.estado).toBe(400);
  });
  it("activa con una contraseña válida y el enlace queda usado", async () => {
    const nav = new Navegador();
    expect((await nav.post("/api/auth/activar", { token: tokenDeEnlace(enlace), password: "Cajero-Seguro-1" })).estado).toBe(200);
    expect((await nav.post("/api/auth/activar", { token: tokenDeEnlace(enlace), password: "Cajero-Seguro-2" })).estado).toBe(400);
    // El cajero no requiere doble factor: entra directo.
    const login = await nav.post("/api/auth/login", { usuario: "cajero.uno", password: "Cajero-Seguro-1" });
    expect(login.datos.etapa).toBe("completa");
    const yo = await nav.get("/api/auth/yo");
    expect(yo.datos.permisos).toContain("pos.ventas:crear");
    expect(yo.datos.permisos).not.toContain("datos.costos:ver");
  });
});

describe("bloqueo por intentos fallidos", () => {
  it("bloquea tras 5 intentos y lo registra en la bitácora de accesos", async () => {
    const nav = new Navegador();
    for (let i = 0; i < 5; i++) await nav.post("/api/auth/login", { usuario: "cajero.uno", password: "incorrecta-1" });
    const r = await nav.post("/api/auth/login", { usuario: "cajero.uno", password: "Cajero-Seguro-1" });
    expect(r.estado).toBe(401);
    expect(r.datos.mensaje).toMatch(/bloqueado/);
    const fallidos = await pool.query("SELECT count(*)::int n FROM bitacora_acceso a JOIN usuario u ON u.id = a.usuario_id WHERE u.usuario = 'cajero.uno' AND NOT a.exito");
    expect(fallidos.rows[0].n).toBeGreaterThanOrEqual(6);
  });
  it("el administrador lo desbloquea", async () => {
    const id = (await pool.query("SELECT id FROM usuario WHERE usuario = 'cajero.uno'")).rows[0].id;
    expect((await admin.post(`/api/usuarios/${id}/desbloquear`)).estado).toBe(200);
    expect((await new Navegador().post("/api/auth/login", { usuario: "cajero.uno", password: "Cajero-Seguro-1" })).datos.etapa).toBe("completa");
  });
});

describe("doble factor", () => {
  it("el administrador necesita el código de la app en cada acceso", async () => {
    const nav = new Navegador();
    const r = await nav.post("/api/auth/login", { usuario: "admin", password: "Clave-Maestra-2026" });
    expect(r.datos.etapa).toBe("segundo_factor");
    // Con la etapa incompleta no puede usar nada más.
    expect((await nav.get("/api/usuarios")).estado).toBe(403);
    expect((await nav.post("/api/auth/segundo-factor", { codigo: "000000" })).estado).toBe(401);
    const ok = await nav.post("/api/auth/segundo-factor", { codigo: codigoTotp(adminSecreto, 1) });
    expect(ok.datos.etapa).toBe("completa");
    expect((await nav.get("/api/usuarios")).estado).toBe(200);
  });
  it("no acepta reutilizar el mismo código", async () => {
    const nav = new Navegador();
    await nav.post("/api/auth/login", { usuario: "admin", password: "Clave-Maestra-2026" });
    const r = await nav.post("/api/auth/segundo-factor", { codigo: codigoTotp(adminSecreto, 1) });
    expect(r.estado).toBe(401);
  });
  it("acepta un código de recuperación una sola vez", async () => {
    // Un usuario nuevo con rol que exige doble factor obtiene sus códigos al activarlo.
    const alta = await admin.post("/api/usuarios", { usuario: "contador", nombre: "Contador General", puesto: "Contador", roles: ["CNT"] });
    const nav = new Navegador();
    await nav.post("/api/auth/activar", { token: tokenDeEnlace(alta.datos.invitacion.enlace), password: "Cuentas-2026-x" });
    const l = await nav.post("/api/auth/login", { usuario: "contador", password: "Cuentas-2026-x" });
    expect(l.datos.etapa).toBe("enrolar_totp");
    expect((await nav.get("/api/roles")).estado).toBe(403);
    const ini = await nav.post("/api/auth/totp-iniciar");
    expect(ini.datos.qr).toMatch(/^data:image\/png;base64,/);
    const conf = await nav.post("/api/auth/totp-confirmar", { codigo: codigoTotp(ini.datos.secreto) });
    expect(conf.datos.codigos_recuperacion).toHaveLength(10);
    const codigo = conf.datos.codigos_recuperacion[0];
    const nav2 = new Navegador();
    await nav2.post("/api/auth/login", { usuario: "contador", password: "Cuentas-2026-x" });
    expect((await nav2.post("/api/auth/segundo-factor", { codigo })).datos.etapa).toBe("completa");
    const nav3 = new Navegador();
    await nav3.post("/api/auth/login", { usuario: "contador", password: "Cuentas-2026-x" });
    expect((await nav3.post("/api/auth/segundo-factor", { codigo })).estado).toBe(401);
  });
});

describe("cierre de sesión por inactividad", () => {
  it("una sesión inactiva más del tiempo configurado se cierra", async () => {
    const nav = new Navegador();
    await nav.post("/api/auth/login", { usuario: "cajero.uno", password: "Cajero-Seguro-1" });
    await pool.query("UPDATE sesion SET ultima_actividad = now() - interval '31 minutes' WHERE usuario_id = (SELECT id FROM usuario WHERE usuario = 'cajero.uno') AND revocada_en IS NULL");
    const r = await nav.get("/api/auth/yo");
    expect(r.estado).toBe(401);
    expect(nav.cookie).toBeNull();
  });
});

describe("cambio de contraseña", () => {
  it("exige la actual, aplica la política y cierra las demás sesiones", async () => {
    const otra = new Navegador();
    await otra.post("/api/auth/login", { usuario: "cajero.uno", password: "Cajero-Seguro-1" });
    const nav = new Navegador();
    await nav.post("/api/auth/login", { usuario: "cajero.uno", password: "Cajero-Seguro-1" });
    expect((await nav.post("/api/auth/cambiar-password", { actual: "mala-123", nueva: "Nueva-Clave-2026" })).estado).toBe(400);
    expect((await nav.post("/api/auth/cambiar-password", { actual: "Cajero-Seguro-1", nueva: "cajero.uno-2026" })).estado).toBe(400);
    expect((await nav.post("/api/auth/cambiar-password", { actual: "Cajero-Seguro-1", nueva: "Nueva-Clave-2026" })).estado).toBe(200);
    expect((await nav.get("/api/auth/yo")).estado).toBe(200);
    expect((await otra.get("/api/auth/yo")).estado).toBe(401);
  });
});

describe("PIN de cajero y cambio de cajero sin cerrar la caja", () => {
  it("el encargado abre la caja y el cajero entra con su PIN", async () => {
    const suc1 = (await pool.query("SELECT id FROM sucursal WHERE clave = 'SUC1'")).rows[0].id;
    const caja = (await pool.query("SELECT id FROM caja WHERE clave = 'CAJA-SUC1-1'")).rows[0].id;
    const cajaMat = (await pool.query("SELECT id FROM caja WHERE clave = 'CAJA-MAT-1'")).rows[0].id;
    // Cajero define su PIN.
    const cajero = new Navegador();
    await cajero.post("/api/auth/login", { usuario: "cajero.uno", password: "Nueva-Clave-2026" });
    expect((await cajero.post("/api/auth/mi-pin", { password: "Nueva-Clave-2026", pin: "1234" })).estado).toBe(400); // consecutivo
    expect((await cajero.post("/api/auth/mi-pin", { password: "Nueva-Clave-2026", pin: "4821" })).estado).toBe(200);
    // Encargado de la sucursal.
    const alta = await admin.post("/api/usuarios", { usuario: "encargado", nombre: "Encargado Suc 1", puesto: "Encargado", roles: ["ENC"], sucursales: [suc1] });
    const enc = new Navegador();
    await enc.post("/api/auth/activar", { token: tokenDeEnlace(alta.datos.invitacion.enlace), password: "Sucursal-2026-x" });
    await entrar(enc, "encargado", "Sucursal-2026-x");
    expect((await enc.post("/api/auth/caja", { caja_id: cajaMat })).estado).toBe(403); // no es su sucursal
    expect((await enc.post("/api/auth/caja", { caja_id: caja })).estado).toBe(200);
    expect((await enc.post("/api/auth/cajero", { usuario: "cajero.uno", pin: "0000" })).estado).toBe(401);
    const r = await enc.post("/api/auth/cajero", { usuario: "cajero.uno", pin: "4821" });
    expect(r.estado).toBe(200);
    const yo = await enc.get("/api/auth/yo");
    expect(yo.datos.sesion.tipo).toBe("pos");
    expect(yo.datos.sesion.cajero_actual_id).toBe(r.datos.cajero.id);
  });
});

describe("suspensión y baja", () => {
  it("suspender cierra sus sesiones; la baja no borra al usuario", async () => {
    const nav = new Navegador();
    await nav.post("/api/auth/login", { usuario: "cajero.uno", password: "Nueva-Clave-2026" });
    const id = (await pool.query("SELECT id FROM usuario WHERE usuario = 'cajero.uno'")).rows[0].id;
    expect((await admin.post(`/api/usuarios/${id}/suspender`)).estado).toBe(200);
    expect((await nav.get("/api/auth/yo")).estado).toBe(401);
    expect((await admin.post(`/api/usuarios/${id}/baja`)).datos.estatus).toBe("baja");
    expect((await pool.query("SELECT count(*)::int n FROM usuario WHERE id = $1", [id])).rows[0].n).toBe(1);
    expect((await new Navegador().post("/api/auth/login", { usuario: "cajero.uno", password: "Nueva-Clave-2026" })).estado).toBe(401);
  });
  it("el administrador no puede modificarse a sí mismo", async () => {
    const yo = (await admin.get("/api/auth/yo")).datos.usuario.id;
    expect((await admin.put(`/api/usuarios/${yo}`, { nombre: "Admin", puesto: "x", roles: ["ADM", "DIR"] })).estado).toBe(403);
    expect((await admin.post(`/api/usuarios/${yo}/baja`)).estado).toBe(403);
  });
});
