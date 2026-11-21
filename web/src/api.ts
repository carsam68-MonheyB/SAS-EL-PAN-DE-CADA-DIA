// Cliente de la API: misma sesión (cookie), cabecera anti-CSRF y errores en español.
export class ErrorApi extends Error {
  constructor(public estado: number, mensaje: string, public datos: any) {
    super(mensaje);
  }
}

export async function api<T = any>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(ruta, {
    method: metodo,
    credentials: "same-origin",
    headers: { "x-erp": "1", ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const tipo = r.headers.get("content-type") ?? "";
  const datos = tipo.includes("json") ? await r.json() : null;
  if (!r.ok) {
    if (r.status === 401 && !ruta.startsWith("/api/auth/")) window.dispatchEvent(new Event("sesion-terminada"));
    throw new ErrorApi(r.status, datos?.mensaje ?? `Error ${r.status}`, datos);
  }
  return datos as T;
}

export const GET = <T = any>(ruta: string) => api<T>("GET", ruta);
export const POST = <T = any>(ruta: string, cuerpo: unknown = {}) => api<T>("POST", ruta, cuerpo);
export const PUT = <T = any>(ruta: string, cuerpo: unknown) => api<T>("PUT", ruta, cuerpo);

/** Descarga un archivo (Excel) respetando la sesión. */
export async function descargar(ruta: string, archivo: string) {
  const r = await fetch(ruta, { credentials: "same-origin", headers: { "x-erp": "1" } });
  if (!r.ok) {
    const d = await r.json().catch(() => null);
    throw new ErrorApi(r.status, d?.mensaje ?? "No se pudo descargar.", d);
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = archivo;
  a.click();
  URL.revokeObjectURL(url);
}

/** Texto para mostrar un error, incluidos los detalles de validación o conflictos. */
export function textoError(e: unknown): string {
  if (!(e instanceof ErrorApi)) return "Ocurrió un error inesperado.";
  const det = e.datos?.detalles;
  if (Array.isArray(det) && det.length) {
    const lineas = det.map((d: any) => (typeof d === "string" ? d : d.mensaje ?? d.descripcion ?? JSON.stringify(d)));
    return `${e.message} ${lineas.join(" · ")}`;
  }
  return e.message;
}
