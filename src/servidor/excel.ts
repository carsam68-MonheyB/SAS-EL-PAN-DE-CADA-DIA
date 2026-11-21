import ExcelJS from "exceljs";

export interface Hoja {
  nombre: string;
  columnas: { titulo: string; clave: string; ancho?: number }[];
  filas: Record<string, unknown>[];
}

/** Arma un .xlsx con encabezados en negritas, filtro y primera fila fija. */
export async function libroExcel(hojas: Hoja[], titulo: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP Pan de Cada Día";
  wb.title = titulo;
  for (const h of hojas) {
    const ws = wb.addWorksheet(h.nombre.slice(0, 31));
    ws.columns = h.columnas.map((c) => ({ header: c.titulo, key: c.clave, width: c.ancho ?? 18 }));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7A4A1E" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const f of h.filas) ws.addRow(f);
    if (h.filas.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: h.columnas.length } };
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export function respuestaExcel(datos: Uint8Array, archivo: string): Response {
  return new Response(datos as BodyInit, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${archivo}"`,
      "cache-control": "no-store",
    },
  });
}

/** Fecha y hora en formato de México (DD/MM/AAAA HH:MM:SS) en la zona del negocio. */
export function fechaHoraMx(valor: Date | string | null | undefined, zona = "America/Mexico_City"): string {
  if (!valor) return "";
  const d = new Date(valor);
  const p = new Intl.DateTimeFormat("es-MX", { timeZone: zona, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("day")}/${v("month")}/${v("year")} ${v("hour")}:${v("minute")}:${v("second")}`;
}
