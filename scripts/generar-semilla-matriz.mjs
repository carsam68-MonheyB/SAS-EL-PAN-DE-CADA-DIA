// Genera la migración con el catálogo de permisos, los roles aprobados y su
// matriz a partir de datos-iniciales/matriz-puestos.json (fuente única).
// Uso: npm run generar:matriz  →  netlify/database/migrations/0003_matriz_puestos/migration.sql
// Una vez aplicada en producción, una migración no se edita: los cambios
// posteriores se hacen desde la pantalla de roles (quedan en la bitácora).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const datos = JSON.parse(readFileSync("datos-iniciales/matriz-puestos.json", "utf8"));
const ACCIONES = ["ver", "crear", "editar", "cancelar", "autorizar", "cerrar", "exportar", "imprimir", "importar"];
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replaceAll("'", "''")}'`);

const permisos = new Map(); // clave -> {grupo, modulo, modulo_nombre, accion, sensible, orden}
let orden = 0;
for (const m of datos.modulos) {
  for (const accion of ACCIONES) {
    permisos.set(`${m.clave}:${accion}`, {
      grupo: m.grupo, modulo: m.clave, modulo_nombre: m.nombre, accion, sensible: false, orden: orden++,
    });
  }
}
for (const s of datos.sensibles) {
  const [modulo, accion] = s.clave.split(":");
  const existente = permisos.get(s.clave);
  if (existente) existente.sensible = true;
  else permisos.set(s.clave, { grupo: "Datos sensibles", modulo, modulo_nombre: s.nombre, accion, sensible: true, orden: orden++ });
}

const otorgados = new Map(datos.roles.map((r) => [r.clave, new Set()]));
for (const m of datos.modulos)
  for (const [rol, acciones] of Object.entries(m.roles)) for (const a of acciones) otorgados.get(rol).add(`${m.clave}:${a}`);
for (const s of datos.sensibles) for (const rol of s.roles) otorgados.get(rol).add(s.clave);

const sql = [];
sql.push(`-- =============================================================================
-- 0003 · Matriz de puestos y permisos APROBADA (versión ${datos.version}, ${datos.aprobada})
-- Generado por scripts/generar-semilla-matriz.mjs desde datos-iniciales/matriz-puestos.json.
-- NO EDITAR A MANO. Cambios posteriores: pantalla de roles (quedan en bitácora).
-- =============================================================================
`);
sql.push("INSERT INTO permiso (clave, grupo, modulo, modulo_nombre, accion, sensible, orden) VALUES");
sql.push([...permisos].map(([k, p]) => `  (${q(k)}, ${q(p.grupo)}, ${q(p.modulo)}, ${q(p.modulo_nombre)}, ${q(p.accion)}, ${p.sensible}, ${p.orden})`).join(",\n") + ";\n");
sql.push("INSERT INTO rol (clave, nombre, descripcion, requiere_2fa, alcance) VALUES");
sql.push(datos.roles.map((r) => `  (${q(r.clave)}, ${q(r.nombre)}, ${q("Alcance: " + r.alcance_texto)}, ${r.requiere_2fa}, ${q(r.alcance)})`).join(",\n") + ";\n");
sql.push("INSERT INTO rol_permiso (rol_id, permiso_id)\nSELECT r.id, p.id FROM (VALUES");
const pares = [];
for (const [rol, set] of otorgados) for (const k of [...set].sort()) pares.push(`  (${q(rol)}, ${q(k)})`);
sql.push(pares.join(",\n") + "\n) AS v(rol, permiso)\nJOIN rol r ON r.clave = v.rol\nJOIN permiso p ON p.clave = v.permiso;\n");
sql.push("INSERT INTO incompatibilidad (clave, nivel, patron_a, patron_b, descripcion) VALUES");
sql.push(datos.incompatibilidades.map((i) => `  (${q(i.clave)}, ${q(i.nivel)}, ${q(i.patron_a)}, ${q(i.patron_b)}, ${q(i.descripcion)})`).join(",\n") + ";\n");
sql.push("-- Montos PROVISIONALES (pedidos por el dueño el 21/11/2026); se cambian en configuración.");
sql.push("INSERT INTO limite_autorizacion (operacion, operacion_nombre, rol_id, monto_hasta, provisional)\nSELECT v.operacion, v.nombre, r.id, v.monto::numeric, true FROM (VALUES");
sql.push(datos.limites.map((l) => `  (${q(l.operacion)}, ${q(l.operacion_nombre)}, ${q(l.rol)}, ${q(l.monto_hasta)})`).join(",\n") + "\n) AS v(operacion, nombre, rol, monto)\nJOIN rol r ON r.clave = v.rol;\n");

// Verificación de integridad: todos los permisos otorgados existen.
for (const [rol, set] of otorgados) for (const k of set) if (!permisos.has(k)) throw new Error(`Permiso inexistente ${k} en ${rol}`);

mkdirSync("netlify/database/migrations/0003_matriz_puestos", { recursive: true });
writeFileSync("netlify/database/migrations/0003_matriz_puestos/migration.sql", sql.join("\n"));
console.log(`Permisos: ${permisos.size} · Roles: ${datos.roles.length} · Asignaciones: ${pares.length}`);
