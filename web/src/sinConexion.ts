// Modo sin conexión de la caja (P43: "ante una urgencia se debe poder operar
// sin internet"). Las ventas se guardan en esta computadora con un id y un
// folio provisional y se envían solas al volver el internet; el servidor no
// las duplica. Mientras tanto se cuida la existencia con la última copia de
// productos para no vender lo que no hay (P71).
import { ErrorApi } from "./api";

const leer = <T,>(k: string, def: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
};
const escribir = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* almacenamiento lleno o bloqueado: se ignora */
  }
};

/** Un error de red (sin respuesta del servidor), no un rechazo del servidor. */
export const esErrorDeRed = (e: unknown) => !(e instanceof ErrorApi);

export const copia = {
  guardar: (clave: string, datos: unknown) => escribir(`pos-copia-${clave}`, { datos, en: new Date().toISOString() }),
  leer: <T,>(clave: string): { datos: T; en: string } | null => leer(`pos-copia-${clave}`, null),
};

export interface VentaPendiente {
  id: string;
  cuerpo: Record<string, unknown>;
  folio_local: string;
  total: number;
  fecha: string;
  error?: string | null;
}

export const cola = {
  leer: (): VentaPendiente[] => leer("pos-cola", []),
  agregar: (v: VentaPendiente) => escribir("pos-cola", [...cola.leer(), v]),
  quitar: (id: string) => escribir("pos-cola", cola.leer().filter((v) => v.id !== id)),
  marcar: (id: string, error: string | null) => escribir("pos-cola", cola.leer().map((v) => (v.id === id ? { ...v, error } : v))),
};

export function folioLocal(caja: string): string {
  const n = leer<number>(`pos-folio-local-${caja}`, 0) + 1;
  escribir(`pos-folio-local-${caja}`, n);
  return `SC-${caja}-${String(n).padStart(4, "0")}`;
}
