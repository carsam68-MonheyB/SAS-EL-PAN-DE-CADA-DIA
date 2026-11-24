// XML descargados del SAT (opción 1): el contador baja del portal del SAT el ZIP
// de la descarga masiva (facturas emitidas y recibidas) y lo sube aquí. El sistema
// guarda cada XML una vez (por UUID), lo clasifica como emitido o recibido según
// el RFC de la empresa y lo compara con lo registrado en Facturación y Compras.
// La e.firma nunca entra al sistema. Nada se borra.
import JSZip from "jszip";
import { leerCfdi, type Cfdi } from "./cfdi";
import { invalido, noEncontrado } from "./errores";
import type { Cliente } from "./transaccion";
import type { UsuarioActual } from "./usuarios";

/** El ZIP llega en base64 dentro de una función (límite de Netlify ≈ 6 MB por solicitud). */
export const BYTES_ZIP = 4_000_000;
export const MAX_ARCHIVOS = 5_000;
const MAX_XML = 1_000_000;
const MAX_DESCOMPRIMIDO = 60_000_000;

interface Leido { archivo: string; xml: string }
interface Rechazo { archivo: string; motivo: string }

const esXml = (n: string) => /\.xml$/i.test(n);
const esZip = (n: string) => /\.zip$/i.test(n);
const visible = (n: string) => !n.split("/").some((p) => p.startsWith(".") || p === "__MACOSX");

/** Abre el ZIP (y los ZIP que traiga dentro, un nivel) y devuelve los XML. */
async function abrirZip(bytes: Uint8Array): Promise<{ xmls: Leido[]; rechazos: Rechazo[] }> {
  const xmls: Leido[] = [];
  const rechazos: Rechazo[] = [];
  let total = 0;
  const leer = async (datos: Uint8Array, prefijo: string, nivel: number) => {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(datos);
    } catch {
      throw invalido(prefijo ? `${prefijo} no es un ZIP válido.` : "El archivo no es un ZIP válido. Sube el ZIP tal como lo bajaste del portal del SAT.");
    }
    for (const e of Object.values(zip.files)) {
      if (e.dir || !visible(e.name)) continue;
      const nombre = prefijo + e.name;
      if (xmls.length + rechazos.length >= MAX_ARCHIVOS) throw invalido(`El ZIP trae más de ${MAX_ARCHIVOS.toLocaleString("es-MX")} archivos: divídelo por semanas o por mes.`);
      if (esZip(e.name) && nivel === 0) {
        const interno = await e.async("uint8array");
        total += interno.length;
        if (total > MAX_DESCOMPRIMIDO) throw invalido("El ZIP es demasiado grande al descomprimirlo: divídelo por semanas.");
        await leer(interno, `${nombre}/`, 1);
        continue;
      }
      if (!esXml(e.name)) {
        rechazos.push({ archivo: nombre, motivo: "No es un XML (se omite)." });
        continue;
      }
      const texto = await e.async("string");
      total += texto.length;
      if (total > MAX_DESCOMPRIMIDO) throw invalido("El ZIP es demasiado grande al descomprimirlo: divídelo por semanas.");
      xmls.push({ archivo: nombre, xml: texto.replace(/^﻿/, "") });
    }
  };
  await leer(bytes, "", 0);
  return { xmls, rechazos };
}

const rfcConfigurado = async (c: Cliente) =>
  ((await c.query("SELECT valor FROM configuracion WHERE clave = 'empresa.rfc'")).rows[0]?.valor ?? "").trim().toUpperCase() as string;

/**
 * Carga el ZIP: cada XML válido se guarda una vez; los repetidos y los que no son
 * de la empresa se reportan. Si el RFC de la empresa no está configurado (solo en
 * desarrollo) se toma el RFC que aparece en todas las facturas del ZIP.
 */
export async function cargarZipSat(c: Cliente, u: UsuarioActual, d: { nombre: string; bytes: Uint8Array }) {
  if (d.bytes.length > BYTES_ZIP) throw invalido(`El archivo pasa de ${BYTES_ZIP / 1_000_000} MB: descárgalo del SAT por semanas.`);
  const nombre = d.nombre.trim().slice(0, 200) || "archivo";
  const contenido = esXml(nombre)
    ? { xmls: [{ archivo: nombre, xml: new TextDecoder().decode(d.bytes).replace(/^﻿/, "") }], rechazos: [] as Rechazo[] }
    : await abrirZip(d.bytes);
  const rechazos = [...contenido.rechazos];
  const leidos: { archivo: string; xml: string; cfdi: Cfdi }[] = [];
  for (const x of contenido.xmls) {
    try {
      leidos.push({ archivo: x.archivo, xml: x.xml, cfdi: leerCfdi(x.xml, MAX_XML) });
    } catch (e: any) {
      rechazos.push({ archivo: x.archivo, motivo: e?.message ?? "No se pudo leer el XML." });
    }
  }
  if (!leidos.length) throw invalido(rechazos.length ? `El ZIP no trae facturas válidas. ${rechazos[0]!.archivo}: ${rechazos[0]!.motivo}` : "El ZIP está vacío.");

  let rfc = await rfcConfigurado(c);
  let rfcDeducido = false;
  if (!rfc) {
    // Sin RFC configurado (solo en desarrollo): el ZIP del SAT es de un solo RFC, el que
    // aparece en más de la mitad de las facturas (como emisor o como receptor).
    const veces = new Map<string, number>();
    for (const l of leidos) for (const r of new Set([l.cfdi.emisorRfc, l.cfdi.receptorRfc])) veces.set(r, (veces.get(r) ?? 0) + 1);
    const orden = [...veces.entries()].sort((a, b) => b[1] - a[1]);
    if (!orden.length || orden[0]![1] * 2 <= leidos.length || (orden[1] && orden[1][1] === orden[0]![1])) {
      throw invalido("Configura el RFC de la empresa (Configuración → empresa.rfc): con él se sabe qué facturas son emitidas y cuáles recibidas.");
    }
    rfc = orden[0]![0];
    rfcDeducido = true;
  }

  // Se clasifica todo antes de guardar: la carga y los XML no se modifican después.
  const ya = new Set<string>((await c.query("SELECT uuid_cfdi FROM cfdi_sat WHERE uuid_cfdi = ANY($1)", [leidos.map((l) => l.cfdi.uuid)])).rows.map((r) => r.uuid_cfdi));
  const nuevos: { l: (typeof leidos)[number]; direccion: "EMITIDO" | "RECIBIDO" }[] = [];
  let repetidos = 0;
  for (const l of leidos) {
    const x = l.cfdi;
    const direccion = x.emisorRfc === rfc ? "EMITIDO" : x.receptorRfc === rfc ? "RECIBIDO" : null;
    if (!direccion) {
      rechazos.push({ archivo: l.archivo, motivo: `No es de la empresa: emisor ${x.emisorRfc}, receptor ${x.receptorRfc} (RFC de la empresa ${rfc}).` });
      continue;
    }
    if (ya.has(x.uuid)) {
      repetidos++;
      continue;
    }
    ya.add(x.uuid);
    nuevos.push({ l, direccion });
  }
  const archivos = contenido.xmls.length + contenido.rechazos.length;
  const folio = `SAT-${String((await c.query("SELECT nextval('carga_sat_folio') AS n")).rows[0].n).padStart(6, "0")}`;
  const carga = (await c.query(
    `INSERT INTO carga_sat (folio, nombre_archivo, rfc_empresa, archivos, nuevos, repetidos, rechazados, rechazos, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [folio, nombre, rfc, archivos, nuevos.length, repetidos, rechazos.length, JSON.stringify(rechazos.slice(0, 500)), u.id],
  )).rows[0].id as string;
  for (const { l, direccion } of nuevos) {
    const x = l.cfdi;
    await c.query(
      `INSERT INTO cfdi_sat (uuid_cfdi, direccion, tipo_comprobante, version, serie, folio, fecha_emision, emisor_rfc, emisor_nombre, receptor_rfc, receptor_nombre,
                             moneda, subtotal, descuento, iva, ieps, retenciones, total, xml, carga_id)
       VALUES ($1, $2, $3, $4, $5, $6, ($7::timestamp AT TIME ZONE 'America/Mexico_City'), $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [x.uuid, direccion, x.tipo, x.version, x.serie, x.folio, x.fecha.slice(0, 19), x.emisorRfc, x.emisorNombre, x.receptorRfc, x.receptorNombre,
        x.moneda, x.subtotal.toFixed(2), x.descuento.toFixed(2), x.iva.toFixed(2), x.ieps.toFixed(2), x.retenciones.toFixed(2), x.total.toFixed(2), l.xml, carga],
    );
  }
  return { carga, folio, nombre, rfc, rfc_deducido: rfcDeducido, archivos, nuevos: nuevos.length, repetidos, rechazos };
}

/** Cargas de ZIP del SAT (las más recientes). */
export async function listarCargasSat(c: Cliente) {
  return (await c.query(
    `SELECT cs.id, cs.folio, cs.nombre_archivo, cs.rfc_empresa, cs.archivos, cs.nuevos, cs.repetidos, cs.rechazados, cs.rechazos, cs.creado_en, u.usuario
       FROM carga_sat cs JOIN usuario u ON u.id = cs.usuario_id ORDER BY cs.creado_en DESC LIMIT 100`,
  )).rows;
}

/**
 * Compara los XML del SAT con lo registrado en el sistema, por periodo:
 * - REGISTRADO: el XML del SAT ya está en Facturación (emitidas) o en Compras (recibidas).
 * - FALTA_REGISTRAR: está en el SAT pero no en el sistema (factura hecha fuera del flujo, o compra sin capturar).
 * - NO_EN_SAT: está en el sistema pero no vino en los ZIP del SAT (revisar si se canceló o si falta bajar ese periodo).
 */
export async function conciliacionSat(c: Cliente, desde: string, hasta: string, direccion: "EMITIDO" | "RECIBIDO" | null) {
  const filas = (await c.query(
    `WITH sat AS (
       SELECT s.uuid_cfdi, s.direccion, s.tipo_comprobante, s.serie, s.folio, s.fecha_emision, s.emisor_rfc, s.emisor_nombre, s.receptor_rfc, s.receptor_nombre, s.total
         FROM cfdi_sat s
        WHERE (s.fecha_emision AT TIME ZONE 'America/Mexico_City')::date BETWEEN $1 AND $2 AND ($3::text IS NULL OR s.direccion = $3)
     ), sistema AS (
       SELECT e.uuid_cfdi, 'EMITIDO' AS direccion, e.tipo_comprobante, e.serie, e.folio, e.fecha_emision, NULL::text AS emisor_rfc, NULL::text AS emisor_nombre,
              e.receptor_rfc, e.receptor_nombre, e.total, e.estatus, 'Facturación · ' || e.clase AS donde
         FROM cfdi_emitido e
        WHERE (e.fecha_emision AT TIME ZONE 'America/Mexico_City')::date BETWEEN $1 AND $2 AND ($3::text IS NULL OR $3 = 'EMITIDO')
       UNION ALL
       SELECT f.uuid_cfdi, 'RECIBIDO', 'I', f.serie, f.folio, f.fecha, p.rfc, p.razon_social, NULL, NULL, f.total, f.estatus, 'Compras · ' || oc.folio
         FROM factura_proveedor f JOIN proveedor p ON p.id = f.proveedor_id JOIN orden_compra oc ON oc.id = f.oc_id
        WHERE (f.fecha AT TIME ZONE 'America/Mexico_City')::date BETWEEN $1 AND $2 AND ($3::text IS NULL OR $3 = 'RECIBIDO')
     )
     SELECT coalesce(s.uuid_cfdi, si.uuid_cfdi) AS uuid, coalesce(s.direccion, si.direccion) AS direccion, coalesce(s.tipo_comprobante, si.tipo_comprobante) AS tipo,
            coalesce(s.serie, si.serie) AS serie, coalesce(s.folio, si.folio) AS folio,
            to_char(coalesce(s.fecha_emision, si.fecha_emision) AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS fecha,
            coalesce(s.emisor_rfc, si.emisor_rfc) AS emisor_rfc, coalesce(s.emisor_nombre, si.emisor_nombre) AS emisor_nombre,
            coalesce(s.receptor_rfc, si.receptor_rfc) AS receptor_rfc, coalesce(s.receptor_nombre, si.receptor_nombre) AS receptor_nombre,
            s.total::text AS total_sat, si.total::text AS total_sistema, si.donde, si.estatus AS estatus_sistema,
            CASE WHEN s.uuid_cfdi IS NULL THEN 'NO_EN_SAT' WHEN si.uuid_cfdi IS NULL THEN 'FALTA_REGISTRAR' ELSE 'REGISTRADO' END AS situacion
       FROM sat s FULL JOIN sistema si ON si.uuid_cfdi = s.uuid_cfdi
      ORDER BY 6, 1`,
    [desde, hasta, direccion],
  )).rows;
  const cuenta = (sit: string) => filas.filter((f) => f.situacion === sit).length;
  return { desde, hasta, filas, resumen: { registrado: cuenta("REGISTRADO"), falta_registrar: cuenta("FALTA_REGISTRAR"), no_en_sat: cuenta("NO_EN_SAT") } };
}

/** XML de una factura bajada del SAT, para usarla en Facturación o Compras. */
export async function xmlSat(c: Cliente, uuid: string) {
  const r = (await c.query("SELECT uuid_cfdi, xml FROM cfdi_sat WHERE uuid_cfdi = upper($1)", [uuid])).rows[0];
  if (!r) throw noEncontrado("Ese UUID no viene en los XML del SAT cargados.");
  return { uuid: r.uuid_cfdi as string, xml: r.xml as string };
}
