// Configuración editable, estructura (sucursales/almacenes/cajas) e indicador
// de consumo estimado de la base de datos en el mes.
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { invalido, noEncontrado, prohibido } from "../../src/servidor/errores";
import { leerCuerpo } from "../../src/servidor/http";
import { ruta } from "../../src/servidor/ruta";

const PERMISOS_VER = ["seguridad.configuracion:ver", "configuracion.parametros:ver"];

const manejador = ruta({}, async (ctx) => {
  const recurso = ctx.url.pathname.split("/")[2];
  const m = ctx.req.method;

  // Estructura: cualquier usuario con sesión la necesita para su alcance.
  if (recurso === "estructura" && m === "GET") {
    return ctx.tx(async (c) => ({
      sucursales: (await c.query("SELECT id, clave, nombre, es_planta, vende_al_publico, activo FROM sucursal ORDER BY clave")).rows,
      almacenes: (await c.query("SELECT id, clave, nombre, tipo, sucursal_id, activo FROM almacen ORDER BY clave")).rows,
      cajas: (await c.query("SELECT id, clave, nombre, sucursal_id, activo FROM caja ORDER BY clave")).rows,
    }));
  }

  if (recurso === "configuracion") {
    ctx.exigir(PERMISOS_VER);
    if (m === "GET") {
      return ctx.tx(async (c) => ({
        configuracion: (await c.query("SELECT clave, grupo, descripcion, tipo, valor, minimo, maximo, opciones, provisional, permiso_editar, actualizado_en FROM configuracion ORDER BY grupo, clave")).rows
          .map((r) => ({ ...r, editable: ctx.puede(r.permiso_editar) })),
      }));
    }
    const clave = ctx.params.clave;
    if (m === "PUT" && clave) {
      const d = await leerCuerpo(ctx.req, z.object({ valor: z.string().trim().min(1).max(200) }));
      return ctx.tx(async (c) => {
        const { rows } = await c.query("SELECT * FROM configuracion WHERE clave = $1 FOR UPDATE", [clave]);
        const cfg = rows[0];
        if (!cfg) throw noEncontrado("No existe esa configuración.");
        if (!ctx.puede(cfg.permiso_editar)) throw prohibido();
        let valor = d.valor;
        if (cfg.tipo === "entero" && !/^-?\d+$/.test(valor)) throw invalido("Debe ser un número entero.");
        if (cfg.tipo === "decimal" && !/^-?\d+(\.\d+)?$/.test(valor.replaceAll(",", ""))) throw invalido("Debe ser un número (el punto es el decimal).");
        if (cfg.tipo === "decimal") valor = valor.replaceAll(",", "");
        if (cfg.tipo === "booleano" && !["si", "no"].includes(valor)) throw invalido("Debe ser si o no.");
        if (cfg.opciones?.length) {
          const opcion = (cfg.opciones as string[]).find((o) => o.toUpperCase() === valor.toUpperCase());
          if (!opcion) throw invalido(`Valores permitidos: ${cfg.opciones.join(", ")}.`);
          valor = opcion;
        }
        if (["entero", "decimal"].includes(cfg.tipo)) {
          const n = Number(valor);
          if (cfg.minimo !== null && n < Number(cfg.minimo)) throw invalido(`El mínimo es ${cfg.minimo}.`);
          if (cfg.maximo !== null && n > Number(cfg.maximo)) throw invalido(`El máximo es ${cfg.maximo}.`);
        }
        await c.query("UPDATE configuracion SET valor = $2, provisional = false WHERE clave = $1", [clave, valor]);
        return (await c.query("SELECT * FROM configuracion WHERE clave = $1", [clave])).rows[0];
      });
    }
  }

  // Consumo estimado del mes: cada minuto con actividad mantiene la base
  // despierta ese minuto más el tiempo de "sueño" configurado. Se suman los
  // intervalos (sin duplicar traslapes) y se multiplican por la tarifa.
  if (recurso === "consumo" && m === "GET") {
    ctx.exigir(PERMISOS_VER);
    return ctx.tx(async (c) => {
      const cfg = new Map((await c.query("SELECT clave, valor FROM configuracion WHERE grupo IN ('Consumo Netlify', 'General')")).rows.map((r) => [r.clave, r.valor]));
      const zona = cfg.get("general.zona_horaria") ?? "America/Mexico_City";
      const sueno = Number(cfg.get("consumo.minutos_sueno_bd") ?? 5);
      const { rows } = await c.query(
        `WITH m AS (
           SELECT minuto, minuto + make_interval(mins => 1 + $1::int) AS fin
             FROM actividad_bd
            WHERE minuto >= (date_trunc('month', now() AT TIME ZONE $2) AT TIME ZONE $2)
         ), g AS (
           SELECT minuto, fin,
                  CASE WHEN minuto <= max(fin) OVER (ORDER BY minuto ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) THEN 0 ELSE 1 END AS nuevo
             FROM m
         ), b AS (
           SELECT minuto, fin, sum(nuevo) OVER (ORDER BY minuto) AS bloque FROM g
         ), t AS (
           SELECT min(minuto) AS ini, max(fin) AS fin FROM b GROUP BY bloque
         )
         SELECT ((ini AT TIME ZONE $2)::date)::text AS dia, sum(extract(epoch FROM (fin - ini))) / 3600.0 AS horas
           FROM t GROUP BY 1 ORDER BY 1`,
        [sueno, zona],
      );
      const unidades = Number(cfg.get("consumo.unidades_computo_minimas") ?? 1);
      const tarifa = Number(cfg.get("consumo.creditos_por_hora_bd") ?? 10);
      const plan = Number(cfg.get("consumo.creditos_plan_mes") ?? 0);
      const dias = rows.map((r) => ({ dia: r.dia, horas: Math.round(Number(r.horas) * 100) / 100 }));
      const horas = dias.reduce((s, d) => s + d.horas, 0);
      const creditos = Math.round(horas * unidades * tarifa);
      return {
        estimado: true,
        nota: "Estimación con la actividad registrada por el sistema (solo cómputo de la base). El dato oficial está en Netlify → Usage.",
        horas_activas: Math.round(horas * 100) / 100,
        creditos_base_estimados: creditos,
        creditos_plan_mes: plan,
        porcentaje_del_plan: plan ? Math.round((creditos / plan) * 1000) / 10 : null,
        por_dia: dias,
      };
    });
  }
  throw noEncontrado("Ruta no encontrada.");
});

export default (req: Request, context: Context) => manejador(req, context);
export const config: Config = { path: ["/api/estructura", "/api/configuracion", "/api/configuracion/:clave", "/api/consumo"] };
export { manejador };
