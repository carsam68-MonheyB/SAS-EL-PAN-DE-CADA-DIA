// Cálculos críticos sin base de datos: formato de México, conversión de
// unidades y lectura de archivos (TXT, CSV, Excel, UTF-8 y Windows-1252).
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { formatearDecimal, formatearFecha, leerDecimal, leerEntero, leerFecha, leerSiNo, normalizarEncabezado } from "../src/dominio/formatos";
import { convertir, factorConversion, type ConversionGeneral } from "../src/dominio/unidades";
import { decodificar, escribirDelimitado, leerArchivo, separarDelimitado } from "../src/servidor/layouts/archivos";

describe("números con formato de México", () => {
  it.each([
    ["1,250.75", "1250.75"],
    ["1250.75", "1250.75"],
    ["1,234,567.5", "1234567.5"],
    ["0.1", "0.1"],
    ["-15", "-15"],
    ["$14.50", "14.5"],
  ])("%s → %s", (entrada, esperado) => {
    expect(leerDecimal(entrada)).toEqual({ ok: true, valor: esperado });
  });

  it.each(["1.250,75", "12,5", "1,25.0", "abc", "", "1 250", "1,2345"])("rechaza %j", (entrada) => {
    expect(leerDecimal(entrada).ok).toBe(false);
  });

  it("explica que el decimal va con punto", () => {
    const r = leerDecimal("12,5");
    expect(r.ok === false && r.mensaje).toMatch(/punto/);
  });

  it("valida decimales, mínimo y mayor que cero", () => {
    expect(leerDecimal("1.234", { decimales: 2 }).ok).toBe(false);
    expect(leerDecimal("1.23", { decimales: 2 }).ok).toBe(true);
    expect(leerDecimal("-1", { minimo: 0 }).ok).toBe(false);
    expect(leerDecimal("0", { mayorQueCero: true }).ok).toBe(false);
  });

  it("es exacto (sin errores de punto flotante)", () => {
    expect(leerDecimal("0.1000000000000000000001")).toEqual({ ok: true, valor: "0.1000000000000000000001" });
  });

  it("enteros", () => {
    expect(leerEntero("1,500")).toEqual({ ok: true, valor: 1500 });
    expect(leerEntero("2.5").ok).toBe(false);
    expect(leerEntero("0", { minimo: 1 }).ok).toBe(false);
  });

  it("formatea con coma de miles y punto decimal", () => {
    expect(formatearDecimal("1250.75")).toBe("1,250.75");
    expect(formatearDecimal("1250.5", 2)).toBe("1,250.50");
    expect(formatearDecimal("-1234567.125")).toBe("-1,234,567.125");
    expect(formatearDecimal("12")).toBe("12");
  });
});

describe("fechas DD/MM/AAAA", () => {
  it("acepta fechas válidas", () => {
    expect(leerFecha("21/11/2026")).toEqual({ ok: true, valor: "2026-11-21" });
    expect(leerFecha("29/02/2028")).toEqual({ ok: true, valor: "2028-02-29" });
    expect(leerFecha("1/3/2027")).toEqual({ ok: true, valor: "2027-03-01" });
  });
  it.each(["31/02/2026", "29/02/2026", "2026-11-21", "11/21/2026", "21-11-2026", "32/01/2026"])("rechaza %s", (f) => {
    expect(leerFecha(f).ok).toBe(false);
  });
  it("formatea", () => expect(formatearFecha("2026-11-21")).toBe("21/11/2026"));
});

describe("SI / NO y encabezados", () => {
  it("SI/NO", () => {
    expect(leerSiNo("sí")).toEqual({ ok: true, valor: true });
    expect(leerSiNo("No")).toEqual({ ok: true, valor: false });
    expect(leerSiNo("tal vez").ok).toBe(false);
  });
  it("normaliza encabezados", () => {
    expect(normalizarEncabezado(" Código postal ")).toBe("CODIGO_POSTAL");
    expect(normalizarEncabezado("unidad-base")).toBe("UNIDAD_BASE");
  });
});

describe("conversión de unidades", () => {
  const generales: ConversionGeneral[] = [
    { de: "KG", a: "G", factor: "1000" },
    { de: "L", a: "ML", factor: "1000" },
  ];
  const harina = { base: "KG", propias: [{ unidad: "BULTO", factorABase: "25" }] };
  const huevo = { base: "KG", propias: [{ unidad: "PZA", factorABase: "0.06" }] };

  it("directa e inversa", () => {
    expect(factorConversion("KG", "G", null, generales)!.toFixed()).toBe("1000");
    expect(factorConversion("G", "KG", null, generales)!.toFixed()).toBe("0.001");
    expect(factorConversion("KG", "KG", null, generales)!.toFixed()).toBe("1");
  });
  it("unidad propia del artículo y paso por la base", () => {
    expect(convertir("2", "BULTO", "KG", harina, generales)).toBe("50");
    expect(convertir("1", "BULTO", "G", harina, generales)).toBe("25000");
    expect(convertir("12500", "G", "BULTO", harina, generales)).toBe("0.5");
    expect(convertir("30", "PZA", "G", huevo, generales)).toBe("1800");
  });
  it("sin conversión posible devuelve null", () => {
    expect(factorConversion("PZA", "KG", null, generales)).toBeNull();
    expect(factorConversion("L", "KG", harina, generales)).toBeNull();
  });
});

describe("lectura de archivos", () => {
  it("detecta Windows-1252 y conserva acentos y ñ", () => {
    // "Año|Piña" en Windows-1252
    const bytes = new Uint8Array([0x41, 0xf1, 0x6f, 0x7c, 0x50, 0x69, 0xf1, 0x61]);
    expect(decodificar(bytes)).toEqual({ texto: "Año|Piña", codificacion: "Windows-1252" });
  });

  it("UTF-8 con BOM", () => {
    const bytes = new TextEncoder().encode("﻿Año");
    expect(decodificar(bytes)).toEqual({ texto: "Año", codificacion: "UTF-8" });
  });

  it("respeta comillas, delimitadores dentro de comillas y comillas dobles", () => {
    expect(separarDelimitado('A,"1,250.75","dijo ""hola"""\r\nB,2,x\n', ",")).toEqual([
      ["A", "1,250.75", 'dijo "hola"'],
      ["B", "2", "x"],
    ]);
  });

  it("TXT por pipe y por tabulador; ignora renglones vacíos", async () => {
    const pipe = await leerArchivo(new TextEncoder().encode("CLAVE|NOMBRE\nKG|Kilogramo\n\n|\nG|Gramo\n"), "u.txt");
    expect(pipe.delimitador).toBe("|");
    expect(pipe.filas).toEqual([{ renglon: 2, celdas: ["KG", "Kilogramo"] }, { renglon: 5, celdas: ["G", "Gramo"] }]);
    const tab = await leerArchivo(new TextEncoder().encode("CLAVE\tNOMBRE\nKG\tKilo, gramo\n"), "u.txt");
    expect(tab.filas[0]!.celdas).toEqual(["KG", "Kilo, gramo"]);
  });

  it("lo que se escribe en CSV se vuelve a leer igual", async () => {
    const bytes = escribirDelimitado(["CLAVE", "PRECIO"], [["PAN", "1,250.75"], ["DONA", 'con "comillas"']], "csv");
    const t = await leerArchivo(bytes, "p.csv");
    expect(t.filas.map((f) => f.celdas)).toEqual([["PAN", "1,250.75"], ["DONA", 'con "comillas"']]);
  });

  it("Excel: números, fechas, texto con ceros a la izquierda y fórmulas", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Datos");
    ws.addRow(["CLAVE", "PRECIO", "FECHA", "CP", "TOTAL"]);
    ws.addRow(["PAN", 1250.75, new Date(Date.UTC(2026, 10, 21)), "06000", { formula: "B2*2", result: 2501.5 }]);
    ws.addRow(["X", 0.1 + 0.2, "01/12/2026", "", ""]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const t = await leerArchivo(bytes, "a.xlsx");
    expect(t.encabezados).toEqual(["CLAVE", "PRECIO", "FECHA", "CP", "TOTAL"]);
    expect(t.filas[0]!.celdas).toEqual(["PAN", "1250.75", "21/11/2026", "06000", "2501.5"]);
    expect(t.filas[1]!.celdas[1]).toBe("0.3");
  });

  it("rechaza .xls antiguo y extensiones desconocidas", async () => {
    await expect(leerArchivo(new Uint8Array([1]), "a.xls")).rejects.toThrow(/xlsx/);
    await expect(leerArchivo(new Uint8Array([1]), "a.pdf")).rejects.toThrow(/Formato/);
  });
});
