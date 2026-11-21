// Lectura y escritura de archivos de layout: TXT (pipe | o tabulador), CSV y Excel.
// Acepta UTF-8 o Windows-1252 (Excel en Windows) y entrega todo como texto,
// para que la validación sea la misma sin importar el formato.
import ExcelJS from "exceljs";
import Decimal from "decimal.js";

export type Formato = "txt" | "csv" | "xlsx";

export interface TablaLeida {
  formato: Formato;
  codificacion: string | null;
  delimitador: string | null;
  encabezados: string[];
  /** renglon = número de renglón en el archivo (el encabezado es el 1). */
  filas: { renglon: number; celdas: string[] }[];
}

export class ErrorArchivo extends Error {}

export function formatoPorNombre(nombre: string): Formato {
  const ext = nombre.toLowerCase().split(".").pop();
  if (ext === "xlsx") return "xlsx";
  if (ext === "csv") return "csv";
  if (ext === "txt" || ext === "tsv") return "txt";
  if (ext === "xls") throw new ErrorArchivo("El formato .xls (Excel 97-2003) no se acepta: guárdalo como .xlsx.");
  throw new ErrorArchivo("Formato no reconocido: usa .txt, .csv o .xlsx.");
}

export function decodificar(bytes: Uint8Array): { texto: string; codificacion: string } {
  let datos = bytes;
  if (datos[0] === 0xef && datos[1] === 0xbb && datos[2] === 0xbf) datos = datos.subarray(3);
  if (datos[0] === 0xff && datos[1] === 0xfe) return { texto: new TextDecoder("utf-16le").decode(datos.subarray(2)), codificacion: "UTF-16" };
  try {
    return { texto: new TextDecoder("utf-8", { fatal: true }).decode(datos), codificacion: "UTF-8" };
  } catch {
    return { texto: new TextDecoder("windows-1252").decode(datos), codificacion: "Windows-1252" };
  }
}

function detectarDelimitador(primeraLinea: string, formato: Formato): string {
  const candidatos = formato === "csv" ? [",", ";", "|", "\t"] : ["|", "\t", ",", ";"];
  let mejor = candidatos[0]!;
  let max = 0;
  for (const c of candidatos) {
    let n = 0;
    let comillas = false;
    for (const ch of primeraLinea) {
      if (ch === '"') comillas = !comillas;
      else if (ch === c && !comillas) n++;
    }
    if (n > max) {
      max = n;
      mejor = c;
    }
  }
  return mejor;
}

/** Separa texto delimitado respetando comillas ("a|b" y "" como comilla). */
export function separarDelimitado(texto: string, delimitador: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!;
    if (comillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += ch;
      continue;
    }
    if (ch === '"' && campo.trim() === "") {
      comillas = true;
      campo = "";
    } else if (ch === delimitador) {
      fila.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += ch;
  }
  if (campo !== "" || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

function textoDeCelda(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? new Decimal(v.toPrecision(15)).toFixed() : "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "SI" : "NO";
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(v.getUTCDate())}/${p(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  }
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("formula" in v || "sharedFormula" in v) return textoDeCelda((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ("text" in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ("error" in v) return "#ERROR";
  }
  return String(v);
}

export async function leerArchivo(bytes: Uint8Array, nombre: string): Promise<TablaLeida> {
  const formato = formatoPorNombre(nombre);
  let matriz: string[][];
  let codificacion: string | null = null;
  let delimitador: string | null = null;
  const inicio = 1;
  if (formato === "xlsx") {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    } catch {
      throw new ErrorArchivo("No se pudo abrir el archivo de Excel. Revisa que sea un .xlsx válido.");
    }
    const hoja = wb.getWorksheet("Datos") ?? wb.worksheets.find((w) => w.state === "visible") ?? wb.worksheets[0];
    if (!hoja) throw new ErrorArchivo("El archivo de Excel no tiene hojas.");
    matriz = [];
    const ultima = hoja.actualRowCount ? hoja.rowCount : 0;
    for (let r = 1; r <= ultima; r++) {
      const fila = hoja.getRow(r);
      const celdas: string[] = [];
      for (let c = 1; c <= Math.max(fila.cellCount, 1); c++) celdas.push(textoDeCelda(fila.getCell(c).value));
      matriz.push(celdas);
    }
  } else {
    const d = decodificar(bytes);
    codificacion = d.codificacion;
    const primera = d.texto.split(/\r?\n/, 1)[0] ?? "";
    delimitador = detectarDelimitador(primera, formato);
    matriz = separarDelimitado(d.texto, delimitador);
  }
  const encabezados = (matriz[0] ?? []).map((e) => e.trim());
  while (encabezados.length && encabezados[encabezados.length - 1] === "") encabezados.pop();
  if (!encabezados.length) throw new ErrorArchivo("El archivo está vacío o no tiene renglón de encabezados.");
  const filas = matriz
    .slice(1)
    .map((celdas, i) => ({ renglon: i + 1 + inicio, celdas: celdas.map((c) => c.trim()) }))
    .filter((f) => f.celdas.some((c) => c !== ""));
  return { formato, codificacion, delimitador, encabezados, filas };
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

function escaparDelimitado(valor: string, delimitador: string): string {
  if (valor.includes(delimitador) || valor.includes('"') || /[\r\n]/.test(valor)) return `"${valor.replaceAll('"', '""')}"`;
  return valor;
}

/** TXT por pipe o CSV por coma. Los números con coma de miles quedan entre comillas en CSV. */
export function escribirDelimitado(encabezados: string[], filas: string[][], formato: "txt" | "csv"): Uint8Array {
  const d = formato === "txt" ? "|" : ",";
  const lineas = [encabezados, ...filas].map((f) => f.map((v) => escaparDelimitado(v ?? "", d)).join(d));
  // BOM para que Excel abra el CSV con acentos correctos.
  return new TextEncoder().encode((formato === "csv" ? "﻿" : "") + lineas.join("\r\n") + "\r\n");
}

export interface ColumnaExcel {
  encabezado: string;
  tipo: "texto" | "numero" | "fecha";
  ancho?: number;
  /** Rango de una lista desplegable, ej. Listas!$A$2:$A$40 */
  lista?: string;
  obligatoria?: boolean;
}

export interface LibroLayout {
  columnas: ColumnaExcel[];
  filas: string[][];
  instrucciones?: { columnas: string[]; filas: string[][]; notas: string[] };
  listas?: { titulo: string; valores: string[] }[];
}

const CAFE = "FF7A4A1E";

/** Libro de Excel con hoja Datos (+ Instrucciones y Listas ocultas para desplegables). */
export async function escribirExcelLayout(libro: LibroLayout, titulo: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP Pan de Cada Día";
  wb.title = titulo;
  const ws = wb.addWorksheet("Datos");
  ws.columns = libro.columnas.map((c) => ({
    header: c.encabezado,
    key: c.encabezado,
    width: c.ancho ?? Math.max(14, c.encabezado.length + 4),
    style: c.tipo === "texto" || c.tipo === "fecha" ? { numFmt: "@" } : { numFmt: "#,##0.00####" },
  }));
  const enc = ws.getRow(1);
  enc.font = { bold: true, color: { argb: "FFFFFFFF" } };
  libro.columnas.forEach((c, i) => {
    enc.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.obligatoria ? CAFE : "FFB08850" } };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const f of libro.filas) {
    ws.addRow(
      f.map((v, i) => {
        const col = libro.columnas[i];
        if (col?.tipo === "numero" && v !== "" && v !== undefined) {
          const n = Number(v.replaceAll(",", ""));
          return Number.isFinite(n) ? n : v;
        }
        return v;
      }),
    );
  }
  const ultimaFila = Math.max(libro.filas.length + 200, 1000);
  libro.columnas.forEach((c, i) => {
    if (!c.lista) return;
    const letra = ws.getColumn(i + 1).letter;
    for (let r = 2; r <= ultimaFila; r++) {
      ws.getCell(`${letra}${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [c.lista],
        showErrorMessage: true,
        errorTitle: "Valor no válido",
        error: "Elige un valor de la lista.",
      };
    }
  });

  if (libro.instrucciones) {
    const wi = wb.addWorksheet("Instrucciones");
    let fila = 1;
    for (const n of libro.instrucciones.notas) {
      wi.getCell(fila, 1).value = n;
      if (fila === 1) wi.getCell(fila, 1).font = { bold: true, size: 13 };
      fila++;
    }
    fila++;
    const filaEnc = wi.getRow(fila);
    libro.instrucciones.columnas.forEach((t, i) => {
      filaEnc.getCell(i + 1).value = t;
      filaEnc.getCell(i + 1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      filaEnc.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CAFE } };
    });
    for (const f of libro.instrucciones.filas) {
      fila++;
      f.forEach((v, i) => {
        wi.getCell(fila, i + 1).value = v;
        wi.getCell(fila, i + 1).alignment = { wrapText: true, vertical: "top" };
      });
    }
    [24, 13, 14, 10, 40, 18, 50].forEach((w, i) => (wi.getColumn(i + 1).width = w));
  }

  if (libro.listas?.length) {
    const wl = wb.addWorksheet("Listas");
    libro.listas.forEach((l, i) => {
      wl.getCell(1, i + 1).value = l.titulo;
      wl.getCell(1, i + 1).font = { bold: true };
      l.valores.forEach((v, j) => (wl.getCell(j + 2, i + 1).value = v));
      wl.getColumn(i + 1).width = 24;
    });
    wl.state = "hidden";
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Letra de columna de Excel (1 → A, 27 → AA). */
export function letraColumna(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
