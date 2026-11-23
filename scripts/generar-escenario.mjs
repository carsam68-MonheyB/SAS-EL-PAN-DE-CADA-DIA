// Genera src/servidor/escenario-archivos.ts con los archivos de ejemplo que usa
// el escenario de demostración (así viajan dentro de la función de Netlify).
// Uso: node scripts/generar-escenario.mjs   (la prueba ejemplos.test.ts revisa que esté al día)
import { readFileSync, writeFileSync } from "node:fs";

export const ARCHIVOS = [
  "fase-1b/01-sat.txt", "fase-1b/02-unidades.txt", "fase-1b/03-conversiones.txt", "fase-1b/04-familias.txt", "fase-1b/09-tasas.txt",
  "fase-1b/10-proveedores.txt", "fase-1b/12-insumos.txt", "fase-1b/13-intermedios.txt", "fase-1b/14-productos.txt", "fase-1b/15-unidades-por-articulo.txt",
  "fase-2/18-insumos-adicionales.txt", "fase-2/19-etapas.txt", "fase-2/20-turnos.txt", "fase-2/21-tarifas-mano-de-obra.txt", "fase-2/22-tasas-gif.txt",
  "fase-2/23-recetas-masas.txt", "fase-2/24-formulas-masas.txt", "fase-2/25-recetas-productos.txt", "fase-2/26-componentes-productos.txt",
  "fase-2/27-etapas-por-receta.txt", "fase-2/28-plan-produccion.txt", "fase-3/29-causas-merma.txt", "fase-3/30-minimos-por-almacen.txt",
  "fase-3/31-inventario-inicial.txt", "fase-6/32-inventario-inicial-sucursal.txt", "fase-6/33-precios-HOY.txt", "fase-4/40-cuentas-bancarias.txt",
  "fase-7/70-catalogo-cuentas.txt", "fase-7/71-reglas-contables.txt", "fase-8/80-sat-receptor.txt",
];

export function contenido() {
  const datos = Object.fromEntries(ARCHIVOS.map((a) => [a, readFileSync(`datos-ejemplo/${a}`, "utf8")]));
  return `// GENERADO por scripts/generar-escenario.mjs: no editar a mano.\n// Copia de los archivos de datos-ejemplo que carga el escenario de demostración (DATOS FICTICIOS).\nexport const ARCHIVOS_ESCENARIO: Record<string, string> = ${JSON.stringify(datos, null, 2)};\n`;
}

if (process.argv[1]?.endsWith("generar-escenario.mjs")) {
  writeFileSync("src/servidor/escenario-archivos.ts", contenido());
  console.log("src/servidor/escenario-archivos.ts actualizado.");
}
