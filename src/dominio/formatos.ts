// Formato de México para captura y layouts (funciones puras, sin base de datos).
//  - Números: el punto es el decimal; la coma de miles es opcional (1,250.75 o 1250.75).
//  - Fechas: DD/MM/AAAA y deben existir (31/02/2026 es error).
//  - Sí/No: SI, SÍ, NO (sin importar mayúsculas).
import Decimal from "decimal.js";

const NUMERO_CON_MILES = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const NUMERO_SIMPLE = /^-?\d+(\.\d+)?$/;

export type Resultado<T> = { ok: true; valor: T } | { ok: false; mensaje: string };

/** Convierte un texto con formato de México a decimal exacto (como texto canónico). */
export function leerDecimal(texto: string, opciones: { decimales?: number; minimo?: number; mayorQueCero?: boolean } = {}): Resultado<string> {
  const t = texto.trim().replace(/^\$/, "").trim();
  if (!NUMERO_SIMPLE.test(t) && !NUMERO_CON_MILES.test(t)) {
    if (/^-?\d+,\d+$/.test(t)) return { ok: false, mensaje: `"${texto}" no es válido: el decimal se escribe con punto (ej. 1250.75).` };
    return { ok: false, mensaje: `"${texto}" no es un número válido (ej. 1,250.75 o 1250.75).` };
  }
  const d = new Decimal(t.replaceAll(",", ""));
  if (opciones.decimales !== undefined && d.decimalPlaces() > opciones.decimales) {
    return { ok: false, mensaje: `"${texto}" tiene más de ${opciones.decimales} decimales.` };
  }
  if (opciones.mayorQueCero && d.lte(0)) return { ok: false, mensaje: `Debe ser mayor que cero.` };
  if (opciones.minimo !== undefined && d.lt(opciones.minimo)) return { ok: false, mensaje: `No puede ser menor que ${opciones.minimo}.` };
  return { ok: true, valor: d.toFixed() };
}

export function leerEntero(texto: string, opciones: { minimo?: number; maximo?: number } = {}): Resultado<number> {
  const t = texto.trim();
  if (!/^-?\d+$/.test(t) && !/^-?\d{1,3}(,\d{3})+$/.test(t)) return { ok: false, mensaje: `"${texto}" no es un número entero.` };
  const n = Number(t.replaceAll(",", ""));
  if (!Number.isSafeInteger(n)) return { ok: false, mensaje: `"${texto}" es demasiado grande.` };
  if (opciones.minimo !== undefined && n < opciones.minimo) return { ok: false, mensaje: `No puede ser menor que ${opciones.minimo}.` };
  if (opciones.maximo !== undefined && n > opciones.maximo) return { ok: false, mensaje: `No puede ser mayor que ${opciones.maximo}.` };
  return { ok: true, valor: n };
}

/** DD/MM/AAAA → AAAA-MM-DD. */
export function leerFecha(texto: string): Resultado<string> {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return { ok: false, mensaje: `"${texto}" no tiene el formato DD/MM/AAAA (ej. 21/11/2026).` };
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) {
    return { ok: false, mensaje: `La fecha "${texto}" no existe.` };
  }
  return { ok: true, valor: `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

export function leerSiNo(texto: string): Resultado<boolean> {
  const t = texto.trim().toUpperCase();
  if (["SI", "SÍ", "S"].includes(t)) return { ok: true, valor: true };
  if (["NO", "N"].includes(t)) return { ok: true, valor: false };
  return { ok: false, mensaje: `"${texto}" no es válido: escribe SI o NO.` };
}

/** 1250.5 → "1,250.50" (con los decimales mínimos pedidos y sin perder precisión). */
export function formatearDecimal(valor: string | number | null | undefined, decimalesMinimos = 0): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const d = new Decimal(valor);
  const texto = d.decimalPlaces() < decimalesMinimos ? d.toFixed(decimalesMinimos) : d.toFixed();
  const [entero, fraccion] = texto.split(".");
  const negativo = entero!.startsWith("-");
  const digitos = negativo ? entero!.slice(1) : entero!;
  const conMiles = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negativo ? "-" : ""}${conMiles}${fraccion ? "." + fraccion : ""}`;
}

/** AAAA-MM-DD → DD/MM/AAAA. */
export function formatearFecha(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Normaliza un encabezado: sin acentos, mayúsculas y guiones bajos. */
export function normalizarEncabezado(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}
