// Utilerías de prueba: base limpia por archivo, "navegador" con cookie y un
// enrutador que imita a Netlify (rutas de config.path → context.params).
import pg from "pg";
import { Secret, TOTP } from "otpauth";
import { fijarPool } from "../src/servidor/db";
import { aplicarMigraciones } from "../src/servidor/migraciones";
import * as auth from "../netlify/functions/auth.mts";
import * as usuarios from "../netlify/functions/usuarios.mts";
import * as roles from "../netlify/functions/roles.mts";
import * as bitacora from "../netlify/functions/bitacora.mts";
import * as reportes from "../netlify/functions/reportes.mts";
import * as configuracion from "../netlify/functions/configuracion.mts";
import * as instalacion from "../netlify/functions/instalacion.mts";
import * as datosPrueba from "../netlify/functions/datos-prueba.mts";
import * as catalogos from "../netlify/functions/catalogos.mts";
import * as cargas from "../netlify/functions/cargas.mts";
import * as recetas from "../netlify/functions/recetas.mts";
import * as costos from "../netlify/functions/costos.mts";
import * as planes from "../netlify/functions/planes.mts";
import * as inventarios from "../netlify/functions/inventarios.mts";

process.env.LLAVE_MAESTRA ??= Buffer.alloc(32, 7).toString("base64");
process.env.CLAVE_INSTALACION ??= "clave-de-instalacion-de-pruebas-123";
process.env.PERMITIR_DATOS_PRUEBA ??= "si";

const ADMIN = process.env.TEST_DATABASE_URL_ADMIN ?? "postgres://postgres:postgres@localhost:5432/postgres";
export const urlBase = (nombre: string) => {
  const u = new URL(ADMIN);
  u.pathname = `/${nombre}`;
  return u.toString();
};

let poolActual: pg.Pool | undefined;

/** Crea una base nueva con todas las migraciones y apunta el servidor a ella. */
export async function baseLimpia(nombre: string): Promise<pg.Pool> {
  await poolActual?.end().catch(() => undefined);
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${nombre}`);
  await admin.end();
  const cliente = new pg.Client({ connectionString: urlBase(nombre) });
  await cliente.connect();
  await aplicarMigraciones(cliente, "netlify/database/migrations");
  await cliente.end();
  poolActual = new pg.Pool({ connectionString: urlBase(nombre), max: 5 });
  fijarPool(poolActual);
  return poolActual;
}

type Modulo = { default: (req: Request, ctx: any) => Promise<Response>; config: { path?: string | string[] } };
const MODULOS: Modulo[] = [auth, usuarios, roles, bitacora, reportes, configuracion, instalacion, datosPrueba, catalogos, cargas, recetas, costos, planes, inventarios] as unknown as Modulo[];
const RUTAS = MODULOS.flatMap((m) =>
  ([] as string[]).concat(m.config.path ?? []).map((p) => {
    const nombres: string[] = [];
    const regex = new RegExp("^" + p.replace(/:([a-z_]+)/gi, (_, n) => (nombres.push(n), "([^/]+)")) + "$");
    return { regex, nombres, modulo: m, largo: p.length };
  }),
).sort((a, b) => a.nombres.length - b.nombres.length);

export interface Respuesta {
  estado: number;
  datos: any;
  encabezados: Headers;
}

/** Simula un navegador: guarda la cookie de sesión entre llamadas. */
export class Navegador {
  cookie: string | null = null;

  async llamar(metodo: string, ruta: string, cuerpo?: unknown, opciones: { sinCabeceraErp?: boolean } = {}): Promise<Respuesta> {
    const url = new URL(ruta, "https://erp.prueba");
    const r = RUTAS.find((x) => x.regex.test(url.pathname));
    if (!r) throw new Error(`Sin ruta para ${url.pathname}`);
    const m = url.pathname.match(r.regex)!;
    const params = Object.fromEntries(r.nombres.map((n, i) => [n, decodeURIComponent(m[i + 1]!)]));
    const headers: Record<string, string> = { "user-agent": "vitest" };
    if (!opciones.sinCabeceraErp) headers["x-erp"] = "1";
    if (this.cookie) headers.cookie = this.cookie;
    if (cuerpo !== undefined) headers["content-type"] = "application/json";
    const req = new Request(url, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    const res = await r.modulo.default(req, { params, ip: "127.0.0.1", requestId: "prueba" });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const valor = setCookie.split(";")[0]!;
      this.cookie = /Max-Age=0/.test(setCookie) ? null : valor;
    }
    const tipo = res.headers.get("content-type") ?? "";
    const datos = tipo.includes("json") ? await res.json() : new Uint8Array(await res.arrayBuffer());
    return { estado: res.status, datos, encabezados: res.headers };
  }
  get = (ruta: string) => this.llamar("GET", ruta);
  post = (ruta: string, cuerpo: unknown = {}) => this.llamar("POST", ruta, cuerpo);
  put = (ruta: string, cuerpo: unknown) => this.llamar("PUT", ruta, cuerpo);
}

export function codigoTotp(secreto: string, desfase = 0): string {
  return new TOTP({ secret: Secret.fromBase32(secreto), digits: 6, period: 30 }).generate({ timestamp: Date.now() + desfase * 30_000 });
}

export const tokenDeEnlace = (enlace: string) => new URL(enlace).searchParams.get("token")!;

/** Instala el sistema y deja al administrador con sesión completa (con TOTP). */
export async function instalarAdministrador(password = "Clave-Maestra-2026") {
  const nav = new Navegador();
  const inst = await nav.post("/api/instalacion", { clave: process.env.CLAVE_INSTALACION, usuario: "admin", nombre: "Administrador Inicial" });
  if (inst.estado !== 200) throw new Error(JSON.stringify(inst.datos));
  const act = await nav.post("/api/auth/activar", { token: tokenDeEnlace(inst.datos.enlace), password });
  if (act.estado !== 200) throw new Error(JSON.stringify(act.datos));
  const secreto = await entrar(nav, "admin", password);
  return { nav, password, secreto };
}

/**
 * Inicia sesión y completa las etapas pendientes (activa TOTP si hace falta).
 * Devuelve el secreto TOTP si se activó en este paso.
 */
export async function entrar(nav: Navegador, usuario: string, password: string, secretoTotp?: string): Promise<string | undefined> {
  const r = await nav.post("/api/auth/login", { usuario, password });
  if (r.estado !== 200) throw new Error(`login ${usuario}: ${JSON.stringify(r.datos)}`);
  let etapa = r.datos.etapa;
  let secreto = secretoTotp;
  if (etapa === "enrolar_totp") {
    const ini = await nav.post("/api/auth/totp-iniciar");
    secreto = ini.datos.secreto;
    const conf = await nav.post("/api/auth/totp-confirmar", { codigo: codigoTotp(secreto!) });
    if (conf.estado !== 200) throw new Error(JSON.stringify(conf.datos));
    etapa = conf.datos.etapa;
  } else if (etapa === "segundo_factor") {
    if (!secreto) throw new Error("Falta el secreto TOTP");
    const sf = await nav.post("/api/auth/segundo-factor", { codigo: codigoTotp(secreto, 1) });
    if (sf.estado !== 200) throw new Error(JSON.stringify(sf.datos));
    etapa = sf.datos.etapa;
  }
  if (etapa !== "completa") throw new Error(`Etapa inesperada ${etapa}`);
  return secreto;
}
