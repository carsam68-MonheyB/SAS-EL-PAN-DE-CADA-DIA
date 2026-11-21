// Reglas puras de permisos y segregación de funciones (sin base de datos).

export interface Incompatibilidad {
  clave: string;
  nivel: "asignacion" | "documento";
  patron_a: string;
  patron_b: string;
  descripcion: string;
  activa: boolean;
}

/**
 * Un patrón es una o varias alternativas separadas por "|". Cada alternativa
 * es un patrón tipo SQL LIKE sobre la clave del permiso ("%" = cualquier texto).
 */
export function coincidePatron(patron: string, clave: string): boolean {
  return patron.split("|").some((alt) => {
    const regex = new RegExp(
      "^" + alt.trim().split("%").map((p) => p.replace(/[.*+?^${}()[\]\\]/g, "\\$&")).join(".*") + "$",
    );
    return regex.test(clave);
  });
}

export interface Conflicto {
  incompatibilidad: string;
  descripcion: string;
  permiso_a: string;
  permiso_b: string;
}

/**
 * Devuelve las incompatibilidades de nivel "asignación" que viola un conjunto
 * de permisos (los de un rol, o la unión de los roles de un usuario).
 */
export function conflictosDeAsignacion(permisos: Iterable<string>, reglas: Incompatibilidad[]): Conflicto[] {
  const lista = [...new Set(permisos)];
  const conflictos: Conflicto[] = [];
  for (const regla of reglas) {
    if (!regla.activa || regla.nivel !== "asignacion") continue;
    const a = lista.find((p) => coincidePatron(regla.patron_a, p));
    const b = lista.find((p) => coincidePatron(regla.patron_b, p));
    if (a && b) conflictos.push({ incompatibilidad: regla.clave, descripcion: regla.descripcion, permiso_a: a, permiso_b: b });
  }
  return conflictos;
}

export interface Alcance {
  todas: boolean;
  sucursales: string[];
  almacenes: string[];
}

export function dentroDeAlcanceSucursal(alcance: Alcance, sucursalId: string): boolean {
  return alcance.todas || alcance.sucursales.includes(sucursalId);
}

export function dentroDeAlcanceAlmacen(alcance: Alcance, almacenId: string, sucursalDelAlmacen: string): boolean {
  return alcance.todas || alcance.almacenes.includes(almacenId) || alcance.sucursales.includes(sucursalDelAlmacen);
}

/** Verdadero si el conjunto tiene al menos uno de los permisos pedidos. */
export function tieneAlguno(permisos: ReadonlySet<string>, requeridos: string | string[]): boolean {
  const lista = Array.isArray(requeridos) ? requeridos : [requeridos];
  return lista.some((p) => permisos.has(p));
}
