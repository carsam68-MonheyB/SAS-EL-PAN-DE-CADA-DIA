// Genera la versión Excel de los archivos de ejemplo (FICTICIOS) de la Fase 1B,
// para probar la carga en .xlsx además de .txt.
//   node scripts/generar-ejemplos-xlsx.mjs
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";

const carpeta = "datos-ejemplo/fase-1b";
for (const nombre of ["14-productos", "12-insumos"]) {
  const lineas = readFileSync(`${carpeta}/${nombre}.txt`, "utf8").trim().split(/\r?\n/).map((l) => l.split("|"));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Datos");
  lineas.forEach((celdas) => {
    const fila = ws.addRow(celdas);
    fila.eachCell((c) => (c.numFmt = "@"));
  });
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => (c.width = 22));
  await wb.xlsx.writeFile(`${carpeta}/${nombre}.xlsx`);
  console.log(`${carpeta}/${nombre}.xlsx`);
}
