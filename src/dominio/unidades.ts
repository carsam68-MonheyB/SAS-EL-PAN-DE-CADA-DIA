// Conversión de unidades (cálculo crítico: de aquí dependen recetas, compras e
// inventarios). Aritmética decimal exacta.
//
// Fuentes, en orden de prioridad:
//  1. Unidades propias del artículo: 1 BULTO = 25 KG (unidad base del artículo).
//  2. Conversiones generales: 1 KG = 1000 G (y su inversa).
// Se permite un paso por la unidad base del artículo: BULTO → KG (propia) → G (general).
import Decimal from "decimal.js";

export interface ConversionGeneral {
  de: string;       // clave de unidad
  a: string;
  factor: string;   // 1 de = factor a
}

export interface UnidadPropia {
  unidad: string;   // clave de unidad
  factorABase: string; // 1 unidad = factor unidades base
}

function general(de: string, a: string, generales: ConversionGeneral[]): Decimal | null {
  if (de === a) return new Decimal(1);
  const directa = generales.find((g) => g.de === de && g.a === a);
  if (directa) return new Decimal(directa.factor);
  const inversa = generales.find((g) => g.de === a && g.a === de);
  if (inversa) return new Decimal(1).div(inversa.factor);
  return null;
}

/** Factor para convertir 1 unidad `de` a la unidad base del artículo; null si no hay forma. */
function aBase(de: string, base: string, propias: UnidadPropia[], generales: ConversionGeneral[]): Decimal | null {
  if (de === base) return new Decimal(1);
  const propia = propias.find((p) => p.unidad === de);
  if (propia) return new Decimal(propia.factorABase);
  const g = general(de, base, generales);
  if (g) return g;
  // de → (general) → unidad propia → base. Ej. G → KG no existe como propia, pero
  // si la base es BULTO y hay 1 KG = 1000 G y la propia KG = 0.04 BULTO.
  for (const p of propias) {
    const paso = general(de, p.unidad, generales);
    if (paso) return paso.mul(p.factorABase);
  }
  return null;
}

/**
 * Factor tal que: cantidad_en_a = cantidad_en_de × factor.
 * Devuelve null si no se puede convertir (falta una conversión).
 */
export function factorConversion(
  de: string,
  a: string,
  articulo: { base: string; propias: UnidadPropia[] } | null,
  generales: ConversionGeneral[],
): Decimal | null {
  if (de === a) return new Decimal(1);
  const g = general(de, a, generales);
  if (g) return g;
  if (!articulo) return null;
  const deBase = aBase(de, articulo.base, articulo.propias, generales);
  const aBaseF = aBase(a, articulo.base, articulo.propias, generales);
  if (!deBase || !aBaseF) return null;
  return deBase.div(aBaseF);
}

/** Convierte una cantidad (texto decimal) y devuelve texto exacto, o null si no se puede. */
export function convertir(
  cantidad: string,
  de: string,
  a: string,
  articulo: { base: string; propias: UnidadPropia[] } | null,
  generales: ConversionGeneral[],
): string | null {
  const f = factorConversion(de, a, articulo, generales);
  return f ? new Decimal(cantidad).mul(f).toFixed() : null;
}
