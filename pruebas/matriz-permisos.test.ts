// Criterio de aceptación de la Fase 1A: cada puesto de prueba solo hace lo que
// dice la matriz APROBADA, probado directamente contra la API (no la pantalla).
import { readFileSync } from "node:fs";
import { beforeAll, describe, it, expect } from "vitest";
import type pg from "pg";
import { baseLimpia, entrar, instalarAdministrador, Navegador } from "./apoyo";

const matriz = JSON.parse(readFileSync("datos-iniciales/matriz-puestos.json", "utf8"));

/** Permisos que la matriz aprobada da a cada puesto (derivados del JSON, no de la base). */
function permisosAprobados(rol: string): Set<string> {
  const s = new Set<string>();
  for (const m of matriz.modulos) for (const a of m.roles[rol] ?? []) s.add(`${m.clave}:${a}`);
  for (const x of matriz.sensibles) if (x.roles.includes(rol)) s.add(x.clave);
  return s;
}

interface Caso {
  nombre: string;
  metodo: "GET" | "POST" | "PUT";
  ruta: string;
  cuerpo?: unknown;
  /** Lista de alternativas; cada alternativa es una lista de permisos que se requieren juntos. */
  requiere: string[][] | "sesion";
}

const CASOS: Caso[] = [
  { nombre: "ver usuarios", metodo: "GET", ruta: "/api/usuarios", requiere: [["seguridad.usuarios:ver"]] },
  { nombre: "ver roles", metodo: "GET", ruta: "/api/roles", requiere: [["seguridad.usuarios:ver"]] },
  { nombre: "ver catálogo de permisos", metodo: "GET", ruta: "/api/permisos", requiere: [["seguridad.usuarios:ver"]] },
  { nombre: "dar de alta usuario", metodo: "POST", ruta: "/api/usuarios", cuerpo: {}, requiere: [["seguridad.usuarios:ver", "seguridad.usuarios:crear"]] },
  { nombre: "ver bitácora de accesos", metodo: "GET", ruta: "/api/bitacora/accesos", requiere: [["seguridad.bitacora:ver"]] },
  { nombre: "exportar bitácora de auditoría", metodo: "GET", ruta: "/api/bitacora/auditoria?formato=xlsx", requiere: [["seguridad.bitacora:ver", "seguridad.bitacora:exportar"]] },
  { nombre: "exportar quién puede hacer qué", metodo: "GET", ruta: "/api/reportes/quien-puede?formato=xlsx", requiere: [["seguridad.usuarios:ver", "seguridad.usuarios:exportar"]] },
  { nombre: "ver configuración", metodo: "GET", ruta: "/api/configuracion", requiere: [["seguridad.configuracion:ver"], ["configuracion.parametros:ver"]] },
  { nombre: "ver consumo de la base", metodo: "GET", ruta: "/api/consumo", requiere: [["seguridad.configuracion:ver"], ["configuracion.parametros:ver"]] },
  {
    nombre: "editar configuración de seguridad", metodo: "PUT", ruta: "/api/configuracion/seguridad.pin_digitos", cuerpo: { valor: "4" },
    requiere: [["seguridad.configuracion:ver", "seguridad.configuracion:editar"], ["configuracion.parametros:ver", "seguridad.configuracion:editar"]],
  },
  {
    nombre: "editar parámetros de negocio", metodo: "PUT", ruta: "/api/configuracion/general.redondeo_importes", cuerpo: { valor: "mitad_arriba" },
    requiere: [["seguridad.configuracion:ver", "configuracion.parametros:editar"], ["configuracion.parametros:ver", "configuracion.parametros:editar"]],
  },
  { nombre: "ver estructura", metodo: "GET", ruta: "/api/estructura", requiere: "sesion" },
];

let pool: pg.Pool;
let admin: Navegador;
const sesiones = new Map<string, Navegador>();

beforeAll(async () => {
  pool = await baseLimpia("erp_prueba_matriz");
  admin = (await instalarAdministrador()).nav;
  const r = await admin.post("/api/datos-prueba");
  expect(r.estado).toBe(200);
  expect(r.datos.usuarios).toHaveLength(12);
  for (const rol of matriz.roles) {
    const nav = new Navegador();
    await entrar(nav, `prueba.${rol.clave.toLowerCase()}`, r.datos.password);
    sesiones.set(rol.clave, nav);
  }
}, 120_000);

describe("la base tiene exactamente la matriz aprobada", () => {
  it.each(matriz.roles.map((r: { clave: string }) => r.clave) as string[])("%s", async (rol: string) => {
    const yo = await sesiones.get(rol)!.get("/api/auth/yo");
    expect(new Set(yo.datos.permisos)).toEqual(permisosAprobados(rol));
  });
});

describe("cada puesto solo hace lo que dice la matriz (contra la API)", () => {
  for (const rol of matriz.roles.map((r: { clave: string }) => r.clave as string)) {
    it.each(CASOS)(`${rol}: $nombre`, async (caso) => {
      const permitidos = permisosAprobados(rol);
      const debe = caso.requiere === "sesion" || caso.requiere.some((alt) => alt.every((p) => permitidos.has(p)));
      const r = await sesiones.get(rol)!.llamar(caso.metodo, caso.ruta, caso.cuerpo);
      if (debe) expect(r.estado, JSON.stringify(r.datos)).not.toBe(403);
      else expect(r.estado).toBe(403);
    });
  }
});

describe("alcance y datos sensibles", () => {
  it("cajero y panadero no tienen permiso de ver costos ni recetas", () => {
    for (const rol of ["CAJ", "PAN", "MAE"]) {
      expect(permisosAprobados(rol).has("datos.costos:ver")).toBe(false);
      expect(permisosAprobados(rol).has("datos.receta_completa:ver")).toBe(false);
    }
    expect(permisosAprobados("JPR").has("datos.costos:ver")).toBe(true);
  });
  it("el encargado y el cajero quedan limitados a su sucursal", async () => {
    for (const rol of ["ENC", "CAJ"]) {
      const yo = await sesiones.get(rol)!.get("/api/auth/yo");
      expect(yo.datos.alcance.todas).toBe(false);
      expect(yo.datos.alcance.sucursales).toHaveLength(1);
    }
    const alm = await sesiones.get("ALM")!.get("/api/auth/yo");
    expect(alm.datos.alcance).toMatchObject({ todas: false, sucursales: [] });
    expect(alm.datos.alcance.almacenes).toHaveLength(1);
  });
});

describe("segregación de funciones", () => {
  const alta = (usuario: string, roles: string[]) =>
    admin.post("/api/usuarios", { usuario, nombre: `Usuario ${usuario}`, puesto: "Prueba", roles });

  it("impide que el administrador del sistema también opere", async () => {
    const r = await alta("mixto.uno", ["ADM", "COM"]);
    expect(r.estado).toBe(409);
    expect(JSON.stringify(r.datos.detalles)).toContain("usuarios_vs_operacion");
  });
  it("impide que quien recibe mercancía autorice pagos", async () => {
    const mp = (await pool.query("SELECT id FROM almacen WHERE clave = 'MP-MAT'")).rows[0].id;
    const r = await admin.post("/api/usuarios", { usuario: "mixto.dos", nombre: "Mixto Dos", puesto: "Almacén y contraloría", roles: ["ALM", "CON"], almacenes: [mp] });
    expect(r.estado, JSON.stringify(r.datos)).toBe(409);
    expect(JSON.stringify(r.datos.detalles)).toContain("recibe_autoriza_pago");
  });
  it("las reglas por documento no bloquean la asignación (se validan al operar)", async () => {
    expect((await alta("mixto.tres", ["COM", "AUT1"])).estado).toBe(200);
  });
  it("tampoco se puede crear el conflicto editando un rol", async () => {
    const roles = (await admin.get("/api/roles")).datos.roles;
    const alm = roles.find((r: { clave: string }) => r.clave === "ALM");
    const actual = (await admin.get(`/api/roles/${alm.id}`)).datos.permisos;
    const r = await admin.put(`/api/roles/${alm.id}/permisos`, { permisos: [...actual, "compras.cxp:autorizar"] });
    expect(r.estado).toBe(409);
  });
  it("nadie cambia los permisos de un rol que tiene", async () => {
    const adm = (await admin.get("/api/roles")).datos.roles.find((r: { clave: string }) => r.clave === "ADM");
    expect((await admin.put(`/api/roles/${adm.id}/permisos`, { permisos: [] })).estado).toBe(400);
  });
});

describe("reporte quién puede hacer qué", () => {
  it("genera un Excel válido y el JSON incluye a los usuarios de prueba", async () => {
    const x = await admin.get("/api/reportes/quien-puede?formato=xlsx");
    expect(x.estado).toBe(200);
    expect(x.encabezados.get("content-type")).toContain("spreadsheetml");
    expect(Buffer.from(x.datos).subarray(0, 2).toString()).toBe("PK");
    const j = await admin.get("/api/reportes/quien-puede");
    const usuarios = new Set(j.datos.filas.map((f: { usuario: string }) => f.usuario));
    expect(usuarios.has("prueba.caj")).toBe(true);
  });
});
