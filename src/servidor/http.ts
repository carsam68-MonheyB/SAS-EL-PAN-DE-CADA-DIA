import { z, ZodError } from "zod";

// Mensajes de validación en español.
z.config(z.locales.es());
import { ErrorApp, invalido } from "./errores";

export const NOMBRE_COOKIE = "__Host-erp_sesion";

export function json(datos: unknown, estado = 200, encabezados: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...encabezados },
  });
}

export function leerCookie(req: Request, nombre: string): string | undefined {
  const cabecera = req.headers.get("cookie");
  if (!cabecera) return undefined;
  for (const parte of cabecera.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nombre) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function cookieSesion(token: string, maxAgeSegundos: number): string {
  return `${NOMBRE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSegundos}`;
}

export function cookieBorrada(): string {
  return `${NOMBRE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function leerCuerpo<T extends z.ZodType>(req: Request, esquema: T): Promise<z.infer<T>> {
  let datos: unknown;
  try {
    const texto = await req.text();
    datos = texto ? JSON.parse(texto) : {};
  } catch {
    throw invalido("El cuerpo de la solicitud no es JSON válido.");
  }
  const r = esquema.safeParse(datos);
  if (!r.success) throw invalido("Revisa los datos capturados.", r.error.issues.map((i) => ({ campo: i.path.join("."), mensaje: i.message })));
  return r.data;
}

export function respuestaDeError(e: unknown, requestId?: string): Response {
  if (e instanceof ErrorApp) return json({ error: e.codigo, mensaje: e.message, detalles: e.detalles }, e.estado);
  if (e instanceof ZodError) return json({ error: "invalido", mensaje: "Revisa los datos capturados.", detalles: e.issues }, 400);
  console.error("Error no controlado", requestId, e);
  return json({ error: "interno", mensaje: "Ocurrió un error inesperado. Intenta de nuevo; si persiste, reporta el folio.", folio: requestId }, 500);
}

const TIPOS_ARCHIVO: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/** Respuesta de descarga (layouts, reportes de errores, archivos originales). */
export function respuestaArchivo(datos: Uint8Array, nombre: string, formato: string): Response {
  return new Response(datos as BodyInit, {
    headers: {
      "content-type": TIPOS_ARCHIVO[formato] ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${nombre.replace(/[^\w.-]/g, "_")}"`,
      "cache-control": "no-store",
    },
  });
}
