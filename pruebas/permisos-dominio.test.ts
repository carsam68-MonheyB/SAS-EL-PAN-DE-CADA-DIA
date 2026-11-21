import { describe, it, expect } from "vitest";
import { coincidePatron, conflictosDeAsignacion, type Incompatibilidad } from "../src/dominio/permisos";

const regla = (patron_a: string, patron_b: string, nivel: "asignacion" | "documento" = "asignacion"): Incompatibilidad =>
  ({ clave: "r", nivel, patron_a, patron_b, descripcion: "d", activa: true });

describe("patrones de permisos", () => {
  it("coinciden con comodín y alternativas", () => {
    expect(coincidePatron("compras.%", "compras.requisiciones:crear")).toBe(true);
    expect(coincidePatron("compras.%", "comprasx")).toBe(false);
    expect(coincidePatron("a:crear|b:editar", "b:editar")).toBe(true);
    expect(coincidePatron("a.b:ver", "a.b:verx")).toBe(false);
    expect(coincidePatron("a.b:ver", "aXb:ver")).toBe(false); // el punto es literal
  });
});

describe("segregación por asignación", () => {
  it("detecta conflicto solo si están ambos lados", () => {
    const r = [regla("x:crear", "x:autorizar")];
    expect(conflictosDeAsignacion(["x:crear"], r)).toHaveLength(0);
    expect(conflictosDeAsignacion(["x:crear", "x:autorizar"], r)).toHaveLength(1);
  });
  it("ignora reglas de documento e inactivas", () => {
    expect(conflictosDeAsignacion(["x:crear", "x:autorizar"], [regla("x:crear", "x:autorizar", "documento")])).toHaveLength(0);
    expect(conflictosDeAsignacion(["x:crear", "x:autorizar"], [{ ...regla("x:crear", "x:autorizar"), activa: false }])).toHaveLength(0);
  });
});
