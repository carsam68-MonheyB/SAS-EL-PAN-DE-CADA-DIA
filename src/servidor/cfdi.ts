// Lectura del XML de una factura de proveedor (CFDI 4.0 o 3.3). Solo extrae
// los datos para el cotejo; la verificación del estatus ante el SAT se agrega
// en la Fase 8. Se rechaza cualquier DOCTYPE o ENTITY (protección contra XXE y
// expansión de entidades) y archivos de más de 1 MB.
import { XMLParser } from "fast-xml-parser";
import { D, type Dec } from "../dominio/recetas";
import { invalido } from "./errores";

export interface ConceptoCfdi { orden: number; descripcion: string; noIdentificacion: string | null; claveProdServ: string | null; cantidad: Dec; valorUnitario: Dec; importe: Dec; descuento: Dec; iva: Dec; ieps: Dec }
export interface Cfdi {
  version: string; uuid: string; serie: string | null; folio: string | null; fecha: string; tipo: string; moneda: string;
  metodoPago: string | null; formaPago: string | null; emisorRfc: string; emisorNombre: string | null; receptorRfc: string;
  subtotal: Dec; descuento: Dec; total: Dec; iva: Dec; ieps: Dec; retenciones: Dec; conceptos: ConceptoCfdi[];
}

const lista = <T,>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const num = (v: unknown, campo: string): Dec => {
  if (v === undefined || v === null || v === "") return new D(0);
  try {
    const d = new D(String(v));
    if (!d.isFinite()) throw new Error();
    return d;
  } catch {
    throw invalido(`El XML tiene un número no válido en ${campo}.`);
  }
};

export function leerCfdi(xml: string): Cfdi {
  if (xml.length > 1_000_000) throw invalido("El XML pasa de 1 MB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw invalido("El XML trae declaraciones no permitidas (DOCTYPE/ENTITY).");
  let doc: any;
  try {
    doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", removeNSPrefix: true, processEntities: false, parseAttributeValue: false, parseTagValue: false }).parse(xml);
  } catch {
    throw invalido("El archivo no es un XML válido.");
  }
  const c = doc?.Comprobante;
  if (!c) throw invalido("El XML no es un CFDI (no tiene cfdi:Comprobante).");
  if (!["4.0", "3.3"].includes(c.Version)) throw invalido(`Versión de CFDI no soportada: ${c.Version ?? "sin versión"}.`);
  const timbre = lista(c.Complemento).flatMap((x: any) => lista(x?.TimbreFiscalDigital))[0];
  const uuid = String(timbre?.UUID ?? "").toUpperCase();
  if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(uuid)) throw invalido("El XML no está timbrado (no trae el UUID del Timbre Fiscal Digital).");
  const traslados = (imp: any) => lista(imp?.Traslados?.Traslado);
  const suma = (ts: any[], impuesto: string, campo: string) => ts.filter((t) => t.Impuesto === impuesto).reduce((s, t) => s.plus(num(t.Importe, campo)), new D(0));
  const conceptos = lista(c.Conceptos?.Concepto).map((x: any, i: number) => {
    const ts = traslados(x.Impuestos);
    return {
      orden: i + 1, descripcion: String(x.Descripcion ?? ""), noIdentificacion: x.NoIdentificacion ? String(x.NoIdentificacion) : null,
      claveProdServ: x.ClaveProdServ ? String(x.ClaveProdServ) : null,
      cantidad: num(x.Cantidad, `Concepto ${i + 1} Cantidad`), valorUnitario: num(x.ValorUnitario, `Concepto ${i + 1} ValorUnitario`),
      importe: num(x.Importe, `Concepto ${i + 1} Importe`), descuento: num(x.Descuento, `Concepto ${i + 1} Descuento`),
      iva: suma(ts, "002", "IVA del concepto"), ieps: suma(ts, "003", "IEPS del concepto"),
    };
  });
  if (!conceptos.length) throw invalido("El CFDI no trae conceptos.");
  const tg = traslados(c.Impuestos);
  return {
    version: c.Version, uuid, serie: c.Serie ? String(c.Serie) : null, folio: c.Folio ? String(c.Folio) : null, fecha: String(c.Fecha ?? ""),
    tipo: String(c.TipoDeComprobante ?? ""), moneda: String(c.Moneda ?? "MXN"), metodoPago: c.MetodoPago ?? null, formaPago: c.FormaPago ?? null,
    emisorRfc: String(c.Emisor?.Rfc ?? "").toUpperCase(), emisorNombre: c.Emisor?.Nombre ?? null, receptorRfc: String(c.Receptor?.Rfc ?? "").toUpperCase(),
    subtotal: num(c.SubTotal, "SubTotal"), descuento: num(c.Descuento, "Descuento"), total: num(c.Total, "Total"),
    iva: suma(tg, "002", "IVA"), ieps: suma(tg, "003", "IEPS"), retenciones: num(c.Impuestos?.TotalImpuestosRetenidos, "TotalImpuestosRetenidos"),
    conceptos,
  };
}
