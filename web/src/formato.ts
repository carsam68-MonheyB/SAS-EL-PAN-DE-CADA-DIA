// Formato de México: DD/MM/AAAA y 1,250.75 en toda la interfaz.
const ZONA = "America/Mexico_City";

export function fecha(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v);
  return new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function fechaHora(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  const f = new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return f.format(d).replace(",", "");
}

export function numero(v: number | string | null | undefined, decimales = 2): string {
  if (v === null || v === undefined || v === "") return "";
  return new Intl.NumberFormat("es-MX", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(Number(v));
}

/** Convierte DD/MM/AAAA a AAAA-MM-DD; null si la fecha no es válida (ej. 31/02/2026). */
export function fechaIso(texto: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const [, d, mes, a] = m;
  const f = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  if (f.getUTCFullYear() !== Number(a) || f.getUTCMonth() !== Number(mes) - 1 || f.getUTCDate() !== Number(d)) return null;
  return `${a}-${mes}-${d}`;
}
