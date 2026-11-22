// Calculadora de costo de mano de obra por minuto y de tasa de gastos
// indirectos. Calcula con los datos que escribe el negocio y, si se pide,
// guarda el resultado como tarifa/tasa vigente usando el mismo layout que la
// carga por archivo (mismas validaciones y permisos) y deja la foto del cálculo.
import { costoMinutoMod, tasaGif, type DatosGif, type DatosMod } from "../dominio/calculadora";
import { invalido } from "./errores";
import { guardarRegistros } from "./layouts/servicio";
import type { Cliente } from "./transaccion";

export type PedidoCalculo =
  | { tipo: "MOD"; etapa: string; vigente_desde?: string; comentario?: string; datos: DatosMod }
  | { tipo: "GIF"; base: "KG_MASA" | "MINUTO_MOD" | "PIEZA"; vigente_desde?: string; comentario?: string; datos: DatosGif };

const fechaMx = (f: string) => f.split("-").reverse().join("/");

export function calcular(p: PedidoCalculo) {
  try {
    if (p.tipo === "MOD") {
      const r = costoMinutoMod(p.datos);
      return { costo_mensual: r.costo_mensual.toFixed(2), minutos_productivos: r.minutos_productivos.toDecimalPlaces(4).toFixed(), resultado: r.costo_minuto.toDecimalPlaces(6).toFixed() };
    }
    const r = tasaGif(p.datos);
    return { total_gastos: r.total_gastos.toFixed(2), resultado: r.tasa.toDecimalPlaces(6).toFixed() };
  } catch (e) {
    throw invalido((e as Error).message);
  }
}

export async function guardarCalculo(c: Cliente, usuarioId: string, permisos: ReadonlySet<string>, p: PedidoCalculo) {
  if (!p.vigente_desde) throw invalido("Indica desde qué fecha aplica.");
  const r = calcular(p);
  let etapaId: string | null = null;
  if (p.tipo === "MOD") {
    etapaId = (await c.query("SELECT id FROM etapa_produccion WHERE clave = $1 AND activo", [p.etapa])).rows[0]?.id ?? null;
    if (!etapaId) throw invalido(`No existe la etapa ${p.etapa} o está inactiva.`);
  }
  const fila: Record<string, string> = p.tipo === "MOD"
    ? { ETAPA: p.etapa, VIGENTE_DESDE: fechaMx(p.vigente_desde), COSTO_MINUTO: r.resultado }
    : { BASE: p.base, VIGENTE_DESDE: fechaMx(p.vigente_desde), TASA: r.resultado };
  const g = await guardarRegistros(c, usuarioId, permisos, p.tipo === "MOD" ? "tarifas_mod" : "tasas_gif", "ambos", [fila]);
  if (!g.ok) {
    const detalle = ((g as any).detalle ?? []).filter((x: any) => x.severidad === "error");
    throw invalido("No se pudo guardar.", detalle.map((x: any) => ({ campo: x.campo, mensaje: `${x.campo ? x.campo + ": " : ""}${x.mensaje}` })));
  }
  const { rows } = await c.query(
    `INSERT INTO calculo_costo (tipo, etapa_id, base, vigente_desde, datos, resultado, comentario, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [p.tipo, etapaId, p.tipo === "GIF" ? p.base : null, p.vigente_desde, JSON.stringify({ ...p.datos, ...r }), r.resultado, p.comentario || null, usuarioId],
  );
  return { id: rows[0].id as string, estatus: (g as any).estatus as string, ...r };
}

export async function historialCalculos(c: Cliente) {
  const { rows } = await c.query(
    `SELECT k.id, k.tipo, e.clave AS etapa, k.base, k.vigente_desde::text, k.datos, k.resultado::text, k.comentario, k.creado_en, u.usuario
       FROM calculo_costo k JOIN usuario u ON u.id = k.usuario_id LEFT JOIN etapa_produccion e ON e.id = k.etapa_id
      ORDER BY k.creado_en DESC LIMIT 200`,
  );
  return rows;
}
