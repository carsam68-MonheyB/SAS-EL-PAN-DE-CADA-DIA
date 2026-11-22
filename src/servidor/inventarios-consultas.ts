// Consultas de inventarios: existencias valuadas, kárdex con saldos, alertas de
// mínimo, reorden y caducidad, y listados de documentos. Todo se filtra por el
// alcance del usuario (sucursales o almacenes asignados).
import type { Alcance } from "../dominio/permisos";
import { invalido, noEncontrado } from "./errores";
import { hoyNegocio } from "./fechas";
import type { Cliente } from "./transaccion";

/** Condición SQL de alcance sobre un alias de almacén. Usa los parámetros $1..$3. */
export const ALCANCE = (alias: string) => `($1::boolean OR ${alias}.id = ANY($2::uuid[]) OR ${alias}.sucursal_id = ANY($3::uuid[]))`;
export const paramsAlcance = (a: Alcance) => [a.todas, a.almacenes, a.sucursales];

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export function fechaParam(v: string | null, nombre: string): string | null {
  if (!v) return null;
  if (!FECHA.test(v)) throw invalido(`${nombre}: fecha no válida (AAAA-MM-DD).`);
  return v;
}

export async function almacenesVisibles(c: Cliente, a: Alcance) {
  const { rows } = await c.query(
    `SELECT a.id, a.clave, a.nombre, a.tipo, s.clave AS sucursal, ${ALCANCE("a")} AS mio
       FROM almacen a JOIN sucursal s ON s.id = a.sucursal_id WHERE a.activo ORDER BY s.clave, a.tipo, a.clave`,
    paramsAlcance(a),
  );
  return rows;
}

export async function opciones(c: Cliente, a: Alcance) {
  const articulos = (await c.query(
    `SELECT a.clave, a.nombre, a.tipo, u.clave AS unidad, a.maneja_lote, a.maneja_caducidad,
            coalesce((SELECT array_agg(uu.clave ORDER BY uu.clave) FROM articulo_unidad au JOIN unidad uu ON uu.id = au.unidad_id WHERE au.articulo_id = a.id AND au.activo), '{}') AS unidades
       FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id WHERE a.activo ORDER BY a.tipo, a.clave`,
  )).rows;
  const causas = (await c.query("SELECT clave, nombre, aplica FROM causa_merma WHERE activo ORDER BY clave")).rows;
  const proveedores = (await c.query("SELECT clave, coalesce(nombre_comercial, razon_social) AS nombre FROM proveedor WHERE activo ORDER BY clave")).rows;
  const planes = (await c.query("SELECT id, folio, fecha::text FROM plan_produccion WHERE estatus = 'APROBADO' ORDER BY fecha DESC LIMIT 50")).rows;
  const sinOc = (await c.query("SELECT valor FROM configuracion WHERE clave = 'compras.permitir_entrada_sin_oc'")).rows[0]?.valor === "SI";
  const directa = (await c.query("SELECT valor FROM configuracion WHERE clave = 'produccion.permitir_entrada_directa'")).rows[0]?.valor === "SI";
  return { almacenes: await almacenesVisibles(c, a), articulos, causas, proveedores, planes, entrada_sin_oc: sinOc, entrada_produccion_directa: directa };
}

export async function existencias(c: Cliente, a: Alcance, f: { almacen?: string | null; tipo?: string | null; buscar?: string | null }) {
  const { rows } = await c.query(
    `SELECT al.clave AS almacen, al.nombre AS almacen_nombre, al.tipo AS almacen_tipo, ar.clave AS articulo, ar.nombre, ar.tipo, u.clave AS unidad,
            e.cantidad::text, e.valor::text, CASE WHEN e.cantidad > 0 THEN round(e.valor / e.cantidad, 6)::text END AS costo_promedio, e.ultimo_costo::text,
            coalesce(aa.stock_minimo, CASE WHEN al.tipo IN ('MP', 'INS') THEN ar.stock_minimo END)::text AS minimo, coalesce(aa.punto_reorden, CASE WHEN al.tipo IN ('MP', 'INS') THEN ar.punto_reorden END)::text AS reorden,
            coalesce(aa.stock_maximo, CASE WHEN al.tipo IN ('MP', 'INS') THEN ar.stock_maximo END)::text AS maximo,
            (SELECT coalesce(sum(tr.cantidad_enviada), 0) FROM traspaso_renglon tr JOIN traspaso t ON t.id = tr.traspaso_id
              WHERE t.estatus = 'ENVIADO' AND t.almacen_destino_id = al.id AND tr.articulo_id = ar.id)::text AS en_transito,
            (SELECT json_agg(json_build_object('lote', l.codigo, 'caducidad', l.caducidad, 'cantidad', el.cantidad::text) ORDER BY l.caducidad NULLS LAST, l.codigo)
               FROM existencia_lote el JOIN lote l ON l.id = el.lote_id WHERE el.almacen_id = al.id AND el.articulo_id = ar.id AND el.cantidad > 0) AS lotes
       FROM existencia e JOIN almacen al ON al.id = e.almacen_id JOIN articulo ar ON ar.id = e.articulo_id JOIN unidad u ON u.id = ar.unidad_base_id
       LEFT JOIN articulo_almacen aa ON aa.almacen_id = al.id AND aa.articulo_id = ar.id AND aa.activo
      WHERE ${ALCANCE("al")}
        AND ($4::text IS NULL OR al.clave = upper($4)) AND ($5::text IS NULL OR ar.tipo = upper($5))
        AND ($6::text IS NULL OR ar.clave ILIKE '%' || $6 || '%' OR ar.nombre ILIKE '%' || $6 || '%')
      ORDER BY al.clave, ar.tipo, ar.clave`,
    [...paramsAlcance(a), f.almacen || null, f.tipo || null, f.buscar || null],
  );
  const hoy = await hoyNegocio(c);
  const dias = Number((await c.query("SELECT valor FROM configuracion WHERE clave = 'inventarios.dias_alerta_caducidad'")).rows[0]?.valor ?? 3);
  const limite = (await c.query("SELECT ($1::date + $2::int)::text AS f", [hoy, dias])).rows[0].f;
  return rows.map((r) => {
    const q = Number(r.cantidad);
    const alerta = r.minimo !== null && q < Number(r.minimo) ? "MINIMO" : r.reorden !== null && q <= Number(r.reorden) ? "REORDEN" : null;
    const lotes = (r.lotes ?? []).map((l: any) => ({ ...l, estado: l.caducidad && l.caducidad < hoy ? "CADUCADO" : l.caducidad && l.caducidad <= limite ? "POR_CADUCAR" : null }));
    const sugerido = alerta && r.maximo !== null ? Math.max(0, Number(r.maximo) - q - Number(r.en_transito)).toString() : null;
    return { ...r, lotes, alerta, sugerido };
  });
}

/** Alertas: bajo mínimo / en reorden (incluye mínimos por almacén sin existencia) y lotes caducados o por caducar. */
export async function alertas(c: Cliente, a: Alcance) {
  const hoy = await hoyNegocio(c);
  const dias = Number((await c.query("SELECT valor FROM configuracion WHERE clave = 'inventarios.dias_alerta_caducidad'")).rows[0]?.valor ?? 3);
  const existenciasBajas = (await c.query(
    `WITH base AS (
       SELECT al.id AS almacen_id, ar.id AS articulo_id FROM existencia e JOIN almacen al ON al.id = e.almacen_id JOIN articulo ar ON ar.id = e.articulo_id WHERE ${ALCANCE("al")}
       UNION SELECT aa.almacen_id, aa.articulo_id FROM articulo_almacen aa JOIN almacen al ON al.id = aa.almacen_id WHERE aa.activo AND ${ALCANCE("al")}
     )
     SELECT al.clave AS almacen, ar.clave AS articulo, ar.nombre, u.clave AS unidad, coalesce(e.cantidad, 0)::text AS cantidad,
            coalesce(aa.stock_minimo, CASE WHEN al.tipo IN ('MP', 'INS') THEN ar.stock_minimo END)::text AS minimo, coalesce(aa.punto_reorden, CASE WHEN al.tipo IN ('MP', 'INS') THEN ar.punto_reorden END)::text AS reorden,
            coalesce(aa.stock_maximo, CASE WHEN al.tipo IN ('MP', 'INS') THEN ar.stock_maximo END)::text AS maximo,
            (SELECT coalesce(sum(tr.cantidad_enviada), 0) FROM traspaso_renglon tr JOIN traspaso t ON t.id = tr.traspaso_id
              WHERE t.estatus = 'ENVIADO' AND t.almacen_destino_id = al.id AND tr.articulo_id = ar.id)::text AS en_transito
       FROM base b JOIN almacen al ON al.id = b.almacen_id JOIN articulo ar ON ar.id = b.articulo_id AND ar.activo JOIN unidad u ON u.id = ar.unidad_base_id
       LEFT JOIN existencia e ON e.almacen_id = b.almacen_id AND e.articulo_id = b.articulo_id
       LEFT JOIN articulo_almacen aa ON aa.almacen_id = b.almacen_id AND aa.articulo_id = b.articulo_id AND aa.activo
      WHERE coalesce(e.cantidad, 0) <= coalesce(aa.punto_reorden, CASE WHEN al.tipo IN ('MP', 'INS') THEN ar.punto_reorden END, -1)
         OR coalesce(e.cantidad, 0) < coalesce(aa.stock_minimo, CASE WHEN al.tipo IN ('MP', 'INS') THEN ar.stock_minimo END, -1)
      ORDER BY al.clave, ar.clave`,
    paramsAlcance(a),
  )).rows.map((r) => ({
    ...r,
    nivel: r.minimo !== null && Number(r.cantidad) < Number(r.minimo) ? "MINIMO" : "REORDEN",
    sugerido: r.maximo !== null ? Math.max(0, Number(r.maximo) - Number(r.cantidad) - Number(r.en_transito)).toString() : null,
  }));
  const caducidades = (await c.query(
    `SELECT al.clave AS almacen, ar.clave AS articulo, ar.nombre, u.clave AS unidad, l.codigo AS lote, l.caducidad::text, el.cantidad::text,
            CASE WHEN l.caducidad < $4::date THEN 'CADUCADO' ELSE 'POR_CADUCAR' END AS estado
       FROM existencia_lote el JOIN lote l ON l.id = el.lote_id JOIN almacen al ON al.id = el.almacen_id
       JOIN articulo ar ON ar.id = el.articulo_id JOIN unidad u ON u.id = ar.unidad_base_id
      WHERE el.cantidad > 0 AND l.caducidad <= $4::date + $5::int AND ${ALCANCE("al")}
      ORDER BY l.caducidad, al.clave, ar.clave`,
    [...paramsAlcance(a), hoy, dias],
  )).rows;
  return { hoy, dias, existencias: existenciasBajas, caducidades };
}

export async function kardex(c: Cliente, a: Alcance, f: { almacen: string; articulo: string; desde: string | null; hasta: string | null }) {
  const al = (await c.query(`SELECT a.id, a.clave, a.nombre FROM almacen a WHERE a.clave = upper($4) AND ${ALCANCE("a")}`, [...paramsAlcance(a), f.almacen])).rows[0];
  if (!al) throw noEncontrado("No existe ese almacén o no está dentro de tu alcance.");
  const ar = (await c.query("SELECT a.id, a.clave, a.nombre, u.clave AS unidad FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id WHERE a.clave = upper($1)", [f.articulo])).rows[0];
  if (!ar) throw noEncontrado("No existe ese artículo.");
  // Saldo inicial: último renglón antes del periodo.
  const inicial = f.desde ? (await c.query(
    `SELECT r.saldo_cantidad::text, r.saldo_valor::text FROM movimiento_renglon r JOIN movimiento m ON m.id = r.movimiento_id
      WHERE r.almacen_id = $1 AND r.articulo_id = $2 AND m.fecha_negocio < $3 ORDER BY r.consecutivo DESC LIMIT 1`,
    [al.id, ar.id, f.desde],
  )).rows[0] : null;
  const { rows } = await c.query(
    `SELECT r.consecutivo::text, m.id AS movimiento_id, m.folio, m.tipo, m.fecha, m.fecha_negocio::text, l.codigo AS lote, r.cantidad::text,
            r.costo_unitario::text, r.importe::text, r.saldo_cantidad::text, r.saldo_valor::text, cm.clave AS causa, u.usuario,
            m.referencia, m.comentario, m.cancelado_por_id IS NOT NULL AS cancelado, mc.folio AS cancela
       FROM movimiento_renglon r JOIN movimiento m ON m.id = r.movimiento_id JOIN usuario u ON u.id = m.usuario_id
       LEFT JOIN lote l ON l.id = r.lote_id LEFT JOIN causa_merma cm ON cm.id = r.causa_id LEFT JOIN movimiento mc ON mc.id = m.cancela_id
      WHERE r.almacen_id = $1 AND r.articulo_id = $2 AND ($3::date IS NULL OR m.fecha_negocio >= $3) AND ($4::date IS NULL OR m.fecha_negocio <= $4)
      ORDER BY r.consecutivo LIMIT 5000`,
    [al.id, ar.id, f.desde, f.hasta],
  );
  return { almacen: al, articulo: ar, desde: f.desde, hasta: f.hasta, saldo_inicial: inicial ?? { saldo_cantidad: "0", saldo_valor: "0" }, renglones: rows };
}

export async function movimientos(c: Cliente, a: Alcance, f: { almacen?: string | null; tipo?: string | null; desde?: string | null; hasta?: string | null }) {
  const { rows } = await c.query(
    `SELECT m.id, m.folio, m.tipo, m.fecha, m.fecha_negocio::text, al.clave AS almacen, u.usuario, m.referencia, m.comentario,
            m.cancelado_por_id IS NOT NULL AS cancelado, mc.folio AS cancela,
            count(r.id)::int AS renglones, coalesce(sum(r.importe), 0)::text AS importe
       FROM movimiento m JOIN almacen al ON al.id = m.almacen_id JOIN usuario u ON u.id = m.usuario_id
       LEFT JOIN movimiento mc ON mc.id = m.cancela_id LEFT JOIN movimiento_renglon r ON r.movimiento_id = m.id
      WHERE ${ALCANCE("al")} AND ($4::text IS NULL OR al.clave = upper($4)) AND ($5::text IS NULL OR m.tipo = upper($5))
        AND ($6::date IS NULL OR m.fecha_negocio >= $6) AND ($7::date IS NULL OR m.fecha_negocio <= $7)
      GROUP BY m.id, al.clave, u.usuario, mc.folio ORDER BY m.creado_en DESC LIMIT 500`,
    [...paramsAlcance(a), f.almacen || null, f.tipo || null, f.desde || null, f.hasta || null],
  );
  return rows;
}

export async function movimiento(c: Cliente, a: Alcance, id: string) {
  const m = (await c.query(
    `SELECT m.id, m.folio, m.tipo, m.fecha, m.fecha_negocio::text, al.clave AS almacen, al.nombre AS almacen_nombre, u.usuario, m.referencia, m.comentario,
            m.metodo, m.documento_tipo, m.documento_id, p.clave AS proveedor, mc.folio AS cancela, mx.folio AS cancelado_por, pl.folio AS plan
       FROM movimiento m JOIN almacen al ON al.id = m.almacen_id JOIN usuario u ON u.id = m.usuario_id
       LEFT JOIN proveedor p ON p.id = m.proveedor_id LEFT JOIN movimiento mc ON mc.id = m.cancela_id
       LEFT JOIN movimiento mx ON mx.id = m.cancelado_por_id LEFT JOIN plan_produccion pl ON pl.id = m.plan_id
      WHERE m.id = $4 AND ${ALCANCE("al")}`,
    [...paramsAlcance(a), id],
  )).rows[0];
  if (!m) throw noEncontrado("No existe ese movimiento o no está dentro de tu alcance.");
  const renglones = (await c.query(
    `SELECT ar.clave AS articulo, ar.nombre, un.clave AS unidad, l.codigo AS lote, l.caducidad::text, r.cantidad::text, r.costo_unitario::text, r.importe::text, cm.clave AS causa
       FROM movimiento_renglon r JOIN articulo ar ON ar.id = r.articulo_id JOIN unidad un ON un.id = ar.unidad_base_id
       LEFT JOIN lote l ON l.id = r.lote_id LEFT JOIN causa_merma cm ON cm.id = r.causa_id
      WHERE r.movimiento_id = $1 ORDER BY r.consecutivo`,
    [id],
  )).rows;
  return { ...m, renglones };
}

const ALMACENES_DOC = `JOIN almacen ao ON ao.id = t.almacen_origen_id JOIN almacen ad ON ad.id = t.almacen_destino_id`;

export async function traspasos(c: Cliente, a: Alcance, estatus: string | null) {
  const { rows } = await c.query(
    `SELECT t.id, t.folio, t.estatus, ao.clave AS origen, ad.clave AS destino, t.enviado_en, ue.usuario AS enviado_por, t.recibido_en, ur.usuario AS recibido_por,
            t.comentario, (SELECT count(*)::int FROM traspaso_renglon r WHERE r.traspaso_id = t.id) AS renglones,
            (SELECT sum(r.importe_enviado)::text FROM traspaso_renglon r WHERE r.traspaso_id = t.id) AS importe,
            (SELECT sum(r.importe_faltante)::text FROM traspaso_renglon r WHERE r.traspaso_id = t.id AND r.importe_faltante <> 0) AS faltante,
            ${ALCANCE("ad")} AS puedo_recibir, ${ALCANCE("ao")} AS puedo_cancelar
       FROM traspaso t ${ALMACENES_DOC} JOIN usuario ue ON ue.id = t.enviado_por LEFT JOIN usuario ur ON ur.id = t.recibido_por
      WHERE (${ALCANCE("ao")} OR ${ALCANCE("ad")}) AND ($4::text IS NULL OR t.estatus = $4)
      ORDER BY t.enviado_en DESC LIMIT 300`,
    [...paramsAlcance(a), estatus || null],
  );
  return rows;
}

export async function traspaso(c: Cliente, a: Alcance, id: string) {
  const t = (await c.query(
    `SELECT t.id, t.folio, t.estatus, ao.clave AS origen, ao.nombre AS origen_nombre, ad.clave AS destino, ad.nombre AS destino_nombre,
            t.enviado_en, ue.usuario AS enviado_por, t.recibido_en, ur.usuario AS recibido_por, t.comentario, t.comentario_recepcion,
            me.folio AS envio, mr.folio AS recepcion, mc.folio AS cancelacion, ${ALCANCE("ad")} AS puedo_recibir, ${ALCANCE("ao")} AS puedo_cancelar
       FROM traspaso t ${ALMACENES_DOC} JOIN usuario ue ON ue.id = t.enviado_por LEFT JOIN usuario ur ON ur.id = t.recibido_por
       JOIN movimiento me ON me.id = t.envio_id LEFT JOIN movimiento mr ON mr.id = t.recepcion_id LEFT JOIN movimiento mc ON mc.id = t.cancelacion_id
      WHERE t.id = $4 AND (${ALCANCE("ao")} OR ${ALCANCE("ad")})`,
    [...paramsAlcance(a), id],
  )).rows[0];
  if (!t) throw noEncontrado("No existe ese traspaso o no está dentro de tu alcance.");
  const renglones = (await c.query(
    `SELECT r.id, ar.clave AS articulo, ar.nombre, u.clave AS unidad, l.codigo AS lote, l.caducidad::text, r.cantidad_enviada::text, r.importe_enviado::text,
            r.cantidad_recibida::text, r.importe_faltante::text
       FROM traspaso_renglon r JOIN articulo ar ON ar.id = r.articulo_id JOIN unidad u ON u.id = ar.unidad_base_id LEFT JOIN lote l ON l.id = r.lote_id
      WHERE r.traspaso_id = $1 ORDER BY r.creado_en, r.id`,
    [id],
  )).rows;
  return { ...t, renglones };
}

export async function mermas(c: Cliente, a: Alcance, estatus: string | null, id: string | null = null) {
  const { rows } = await c.query(
    `SELECT m.id, m.folio, m.estatus, al.clave AS almacen, al.tipo AS almacen_tipo, cm.clave AS causa, cm.nombre AS causa_nombre, m.comentario, m.importe::text,
            m.creado_en, ur.usuario AS registrado_por, m.registrado_por AS registrado_por_id, ux.usuario AS resuelto_por, m.resuelto_en, m.motivo_rechazo,
            mv.folio AS movimiento, (SELECT count(*)::int FROM merma_renglon r WHERE r.merma_id = m.id) AS renglones
       FROM merma m JOIN almacen al ON al.id = m.almacen_id JOIN causa_merma cm ON cm.id = m.causa_id JOIN usuario ur ON ur.id = m.registrado_por
       LEFT JOIN usuario ux ON ux.id = m.resuelto_por LEFT JOIN movimiento mv ON mv.id = m.movimiento_id
      WHERE ${ALCANCE("al")} AND ($4::text IS NULL OR m.estatus = $4) AND ($5::uuid IS NULL OR m.id = $5)
      ORDER BY m.creado_en DESC LIMIT 300`,
    [...paramsAlcance(a), estatus || null, id],
  );
  return rows;
}

export async function merma(c: Cliente, a: Alcance, id: string) {
  const m = (await mermas(c, a, null, id))[0];
  if (!m) throw noEncontrado("No existe esa merma o no está dentro de tu alcance.");
  const renglones = (await c.query(
    `SELECT ar.clave AS articulo, ar.nombre, u.clave AS unidad, l.codigo AS lote, r.cantidad::text
       FROM merma_renglon r JOIN articulo ar ON ar.id = r.articulo_id JOIN unidad u ON u.id = ar.unidad_base_id LEFT JOIN lote l ON l.id = r.lote_id
      WHERE r.merma_id = $1 ORDER BY r.creado_en, r.id`,
    [id],
  )).rows;
  return { ...m, renglones };
}

export async function conteos(c: Cliente, a: Alcance, estatus: string | null, id: string | null = null) {
  const { rows } = await c.query(
    `SELECT k.id, k.folio, k.estatus, al.clave AS almacen, k.comentario, k.importe_diferencia::text, k.creado_en, uc.usuario AS creado_por,
            k.enviado_en, ux.usuario AS resuelto_por, k.resuelto_en, k.motivo_rechazo,
            (SELECT count(*)::int FROM conteo_renglon r WHERE r.conteo_id = k.id) AS renglones,
            (SELECT count(*)::int FROM conteo_renglon r WHERE r.conteo_id = k.id AND r.diferencia <> 0) AS con_diferencia
       FROM conteo k JOIN almacen al ON al.id = k.almacen_id JOIN usuario uc ON uc.id = k.creado_por_id LEFT JOIN usuario ux ON ux.id = k.resuelto_por
      WHERE ${ALCANCE("al")} AND ($4::text IS NULL OR k.estatus = $4) AND ($5::uuid IS NULL OR k.id = $5)
      ORDER BY k.creado_en DESC LIMIT 300`,
    [...paramsAlcance(a), estatus || null, id],
  );
  return rows;
}

export async function conteo(c: Cliente, a: Alcance, id: string) {
  const k = (await conteos(c, a, null, id))[0];
  if (!k) throw noEncontrado("No existe ese conteo o no está dentro de tu alcance.");
  const mov = (await c.query("SELECT me.folio AS entrada, ms.folio AS salida FROM conteo k LEFT JOIN movimiento me ON me.id = k.entrada_id LEFT JOIN movimiento ms ON ms.id = k.salida_id WHERE k.id = $1", [id])).rows[0];
  const renglones = (await c.query(
    `SELECT ar.clave AS articulo, ar.nombre, ar.maneja_lote, u.clave AS unidad, l.codigo AS lote, l.caducidad::text, r.fisico::text, r.teorico::text, r.diferencia::text,
            r.costo_unitario::text, r.importe::text, uc.usuario AS capturado_por
       FROM conteo_renglon r JOIN articulo ar ON ar.id = r.articulo_id JOIN unidad u ON u.id = ar.unidad_base_id
       LEFT JOIN lote l ON l.id = r.lote_id LEFT JOIN usuario uc ON uc.id = r.capturado_por
      WHERE r.conteo_id = $1 ORDER BY ar.clave, l.codigo`,
    [id],
  )).rows;
  return { ...k, ...mov, renglones };
}
