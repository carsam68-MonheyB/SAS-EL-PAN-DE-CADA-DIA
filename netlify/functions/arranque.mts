// Revisión de arranque (Fase 9): lista de verificación de llaves, respaldos,
// usuarios y permisos, datos de PRUEBA y valores provisionales. Solo lectura.
import type { Config, Context } from "@netlify/functions";
import { revisarArranque } from "../../src/servidor/arranque";
import { libroExcel, respuestaExcel } from "../../src/servidor/excel";
import { ruta } from "../../src/servidor/ruta";

const manejador = ruta({ permiso: "seguridad.configuracion:ver", metodos: ["GET"] }, async (ctx) => {
  const r = await ctx.tx((c) => revisarArranque(c));
  if (ctx.url.searchParams.get("formato") !== "xlsx") return { ...r, ambiente: process.env.AMBIENTE_ETIQUETA ?? null };
  ctx.exigir(["seguridad.configuracion:editar", "seguridad.usuarios:exportar"]);
  return respuestaExcel(await libroExcel([{ nombre: "Revisión", columnas: [
    { titulo: "Grupo", clave: "grupo", ancho: 28 }, { titulo: "Revisión", clave: "titulo", ancho: 40 }, { titulo: "Estado", clave: "estado" },
    { titulo: "Detalle", clave: "detalle", ancho: 80 }, { titulo: "Cómo resolverlo", clave: "como", ancho: 60 },
  ], filas: r.revisiones as unknown as Record<string, unknown>[] }], "Revisión de arranque"), `revision-arranque-${new Date().toISOString().slice(0, 10)}.xlsx`);
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: "/api/arranque" };
export { manejador };
