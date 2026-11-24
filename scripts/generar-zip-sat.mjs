// Genera datos-ejemplo/fase-8/81-descarga-SAT-PRUEBA.zip: un ZIP como el que se baja
// del portal del SAT, con XML FICTICIOS (no timbrados) para probar "XML del SAT".
// Uso: node scripts/generar-zip-sat.mjs
import { writeFileSync } from "node:fs";
import JSZip from "jszip";

const EMPRESA = "EKU9003173C9"; // RFC de pruebas del SAT; el mismo que usa "Generar XML de PRUEBA"
const xml = ({ uuid, serie, folio, fecha, tipo = "I", emisor, receptor, conceptos, global }) => {
  const sub = conceptos.reduce((s, c) => s + c.importe, 0).toFixed(2);
  const con = conceptos.map((c) => `
    <cfdi:Concepto ClaveProdServ="${c.clave}" Cantidad="${c.cantidad}" ClaveUnidad="${c.unidad}" Descripcion="${c.descripcion}" ValorUnitario="${(c.importe / c.cantidad).toFixed(2)}" Importe="${c.importe.toFixed(2)}" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="${c.importe.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.000000" Importe="0.00"/></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- DATOS FICTICIOS (PRUEBA): no es una factura real ni está timbrada por el SAT. -->
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="${serie}" Folio="${folio}" Fecha="${fecha}" SubTotal="${sub}" Moneda="MXN" Total="${sub}" TipoDeComprobante="${tipo}" Exportacion="01" MetodoPago="PUE" FormaPago="01" LugarExpedicion="06000">
  ${global ? `<cfdi:InformacionGlobal Periodicidad="01" Meses="11" Año="2026"/>` : ""}
  <cfdi:Emisor Rfc="${emisor.rfc}" Nombre="${emisor.nombre}" RegimenFiscal="612"/>
  <cfdi:Receptor Rfc="${receptor.rfc}" Nombre="${receptor.nombre}" DomicilioFiscalReceptor="06000" RegimenFiscalReceptor="${receptor.regimen ?? "612"}" UsoCFDI="${receptor.uso ?? "G03"}"/>
  <cfdi:Conceptos>${con}
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="0.00"><cfdi:Traslados><cfdi:Traslado Base="${sub}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.000000" Importe="0.00"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="${fecha}" RfcProvCertif="SAT970701NN3" NoCertificadoSAT="00000000000000000000" SelloCFD="PRUEBA" SelloSAT="PRUEBA"/></cfdi:Complemento>
</cfdi:Comprobante>
`;
};

const yo = { rfc: EMPRESA, nombre: "PRUEBA Panaderia" };
const zip = new JSZip();
const emitidas = zip.folder("Emitidas");
emitidas.file("00000000-0000-4000-8000-0000000000E1.xml", xml({
  uuid: "00000000-0000-4000-8000-0000000000E1", serie: "PRUEBA", folio: "E1", fecha: "2026-11-20T19:30:00", emisor: yo,
  receptor: { rfc: "XAXX010101000", nombre: "PUBLICO EN GENERAL", regimen: "616", uso: "S01" }, global: true,
  conceptos: [{ clave: "01010101", cantidad: 1, unidad: "ACT", descripcion: "Venta", importe: 1250.75 }],
}));
emitidas.file("00000000-0000-4000-8000-0000000000E2.xml", xml({
  uuid: "00000000-0000-4000-8000-0000000000E2", serie: "PRUEBA", folio: "E2", fecha: "2026-11-21T12:00:00", emisor: yo,
  receptor: { rfc: "PEGJ800101AB1", nombre: "PRUEBA Juan Perez" },
  conceptos: [{ clave: "50181900", cantidad: 10, unidad: "H87", descripcion: "PRUEBA Concha de vainilla", importe: 140 }],
}));
const recibidas = zip.folder("Recibidas");
recibidas.file("00000000-0000-4000-8000-0000000000F1.xml", xml({
  uuid: "00000000-0000-4000-8000-0000000000F1", serie: "PRUEBA", folio: "F1", fecha: "2026-11-19T09:00:00",
  emisor: { rfc: "XAXX010101000", nombre: "PRUEBA Harinas Ficticias" }, receptor: yo,
  conceptos: [{ clave: "50221300", cantidad: 4, unidad: "XBG", descripcion: "PRUEBA Harina de trigo bulto 25 kg", importe: 1800 }],
}));
recibidas.file("00000000-0000-4000-8000-0000000000F2.xml", xml({
  uuid: "00000000-0000-4000-8000-0000000000F2", serie: "PRUEBA", folio: "F2", fecha: "2026-11-22T16:40:00",
  emisor: { rfc: "XEXX010101000", nombre: "PRUEBA Lacteos Imaginarios" }, receptor: yo,
  conceptos: [{ clave: "50131700", cantidad: 10, unidad: "KGM", descripcion: "PRUEBA Mantequilla", importe: 1450 }],
}));
// Para ver que el sistema avisa: una factura de otra empresa, un XML dañado y un archivo que no es XML.
zip.file("otra-empresa.xml", xml({
  uuid: "00000000-0000-4000-8000-0000000000A1", serie: "PRUEBA", folio: "A1", fecha: "2026-11-20T10:00:00",
  emisor: { rfc: "AAA010101AAA", nombre: "PRUEBA Otra" }, receptor: { rfc: "BBB010101BBB", nombre: "PRUEBA Otra 2" },
  conceptos: [{ clave: "01010101", cantidad: 1, unidad: "ACT", descripcion: "Venta", importe: 10 }],
}));
zip.file("danado.xml", "<cfdi:Comprobante Version=\"4.0\"><roto");
zip.file("LEEME.txt", "DATOS FICTICIOS (PRUEBA). ZIP de ejemplo para la pestaña Facturación → XML del SAT.\n");

const destino = "datos-ejemplo/fase-8/81-descarga-SAT-PRUEBA.zip";
writeFileSync(destino, await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", date: new Date("2026-11-24T00:00:00Z") }));
console.log(`Listo: ${destino}`);
