// Ofertas de fin del día (P37): el contador o el contralor capturan el % de
// descuento y la hora desde la que aplica; la caja la aplica sola. Cada acción
// valida su permiso en el servidor.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { invalido } from "../../src/servidor/errores";
import { leerCuerpo } from "../../src/servidor/http";
import { guardarOferta, listarOfertas } from "../../src/servidor/pos";
import { ruta } from "../../src/servidor/ruta";

const manejador = ruta({ permiso: "pos.descuentos:ver" }, async (ctx) => {
  const m = ctx.req.method;
  if (m === "GET") {
    return ctx.tx(async (c) => ({
      ofertas: await listarOfertas(c),
      productos: (await c.query("SELECT clave, nombre FROM articulo WHERE tipo = 'SKU' AND activo ORDER BY nombre")).rows,
      familias: (await c.query("SELECT f.clave, f.nombre FROM familia f WHERE f.activo AND EXISTS (SELECT 1 FROM articulo a WHERE a.familia_id = f.id AND a.tipo = 'SKU') ORDER BY f.nombre")).rows,
      sucursales: (await c.query("SELECT clave, nombre FROM sucursal WHERE activo AND vende_al_publico ORDER BY clave")).rows,
      puede_editar: ctx.puede("pos.descuentos:editar"),
    }));
  }
  if (m === "PUT") {
    ctx.exigir("pos.descuentos:editar");
    const d = await leerCuerpo(ctx.req, z.object({
      id: z.string().uuid().optional().nullable(), articulo: z.string().max(30).optional().nullable(), familia: z.string().max(30).optional().nullable(),
      sucursal: z.string().max(20).optional().nullable(), descuento_pct: z.string().trim().regex(/^\d{1,2}(\.\d{1,2})?$/, "Descuento: porcentaje de 1 a 99.99."),
      hora_desde: z.string().regex(/^\d{2}:\d{2}$/, "Hora HH:MM."), activo: z.boolean().optional(),
    }));
    return ctx.tx((c) => guardarOferta(c, d));
  }
  throw invalido("Operación no reconocida.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: "/api/ofertas" };
export { manejador };
