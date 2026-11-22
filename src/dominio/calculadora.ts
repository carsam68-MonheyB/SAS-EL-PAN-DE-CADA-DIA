// Calculadora de costos de conversión (preguntas P35 y P36): de dónde sale el
// costo por minuto de mano de obra directa y la tasa de gastos indirectos.
// Los importes los escribe el negocio; aquí solo está la fórmula (decimal exacto).
//
//  Costo por minuto de MOD de una etapa =
//      nómina mensual de la etapa × (1 + carga social %)
//    ÷ (personas × días trabajados al mes × minutos por jornada × aprovechamiento %)
//
//  Tasa de GIF =
//      suma de gastos indirectos del mes
//    ÷ cantidad de la base en el mes (kg de masa, minutos de MOD o piezas)
import { D, type Dec } from "./recetas";

export interface DatosMod {
  nomina_mensual: string;     // pesos: sueldos de las personas de la etapa en un mes
  carga_social_pct: string;   // % sobre la nómina: IMSS, INFONAVIT, SAR, impuesto sobre nómina, aguinaldo, vacaciones y prima…
  personas: string;
  dias_mes: string;
  minutos_jornada: string;
  aprovechamiento_pct: string; // % de la jornada que se trabaja en producción (sin comida, limpieza, esperas)
}

export interface ResultadoMod {
  costo_mensual: Dec;
  minutos_productivos: Dec;
  costo_minuto: Dec;
}

const positivo = (v: string, nombre: string) => {
  const d = new D(v);
  if (!d.isFinite() || d.lte(0)) throw new Error(`${nombre} debe ser mayor que cero.`);
  return d;
};
const noNegativo = (v: string, nombre: string) => {
  const d = new D(v);
  if (!d.isFinite() || d.lt(0)) throw new Error(`${nombre} no puede ser negativo.`);
  return d;
};

export function costoMinutoMod(x: DatosMod): ResultadoMod {
  const nomina = noNegativo(x.nomina_mensual, "La nómina mensual");
  const carga = noNegativo(x.carga_social_pct, "La carga social");
  const aprov = positivo(x.aprovechamiento_pct, "El aprovechamiento");
  if (aprov.gt(100)) throw new Error("El aprovechamiento no puede ser mayor que 100 %.");
  const costo_mensual = nomina.mul(carga.div(100).plus(1));
  const minutos_productivos = positivo(x.personas, "Las personas")
    .mul(positivo(x.dias_mes, "Los días trabajados"))
    .mul(positivo(x.minutos_jornada, "Los minutos por jornada"))
    .mul(aprov.div(100));
  return { costo_mensual, minutos_productivos, costo_minuto: costo_mensual.div(minutos_productivos) };
}

export interface DatosGif {
  gastos: { concepto: string; importe_mensual: string }[];
  cantidad_base_mensual: string;
}

export function tasaGif(x: DatosGif): { total_gastos: Dec; tasa: Dec } {
  if (!x.gastos.length) throw new Error("Escribe al menos un gasto.");
  const total_gastos = x.gastos.reduce((s, g) => s.plus(noNegativo(g.importe_mensual, `El importe de ${g.concepto || "un gasto"}`)), new D(0));
  const base = positivo(x.cantidad_base_mensual, "La cantidad de la base");
  return { total_gastos, tasa: total_gastos.div(base) };
}
