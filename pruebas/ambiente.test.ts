// La variable PERMITIR_DATOS_PRUEBA se lee de forma tolerante.
import { describe, expect, it } from "vitest";
import { datosPruebaPermitidos } from "../src/servidor/ambiente";

describe("PERMITIR_DATOS_PRUEBA", () => {
  it("acepta si, Si, SÍ, sí y con espacios; cualquier otra cosa la deja apagada", () => {
    for (const v of ["si", "Si", "SI", "sí", "SÍ", " si "]) expect(datosPruebaPermitidos({ PERMITIR_DATOS_PRUEBA: v })).toBe(true);
    for (const v of [undefined, "", "no", "true", "1", "yes"]) expect(datosPruebaPermitidos({ PERMITIR_DATOS_PRUEBA: v })).toBe(false);
  });
});
