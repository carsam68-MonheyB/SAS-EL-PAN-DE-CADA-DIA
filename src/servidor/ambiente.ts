// Lectura tolerante de la variable PERMITIR_DATOS_PRUEBA: acepta "si", "Si", "SÍ",
// "sí" o con espacios. Cualquier otro valor (o sin definir) = deshabilitado.
export function datosPruebaPermitidos(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.PERMITIR_DATOS_PRUEBA ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return v === "si";
}
