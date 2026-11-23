// Escenario de demostración (solo ambiente de pruebas): carga de un jalón los
// archivos de ejemplo de todas las fases con los mismos pasos y permisos que una
// persona (cada archivo lo sube el puesto que le toca y lo autoriza quien debe),
// activa las recetas y deja el PIN de los usuarios de caja. DATOS FICTICIOS.
import { activarVersion } from "./recetas";
import { hashear } from "./contrasena";
import { ErrorApp, invalido } from "./errores";
import { ARCHIVOS_ESCENARIO } from "./escenario-archivos";
import { aplicar, resolverAutorizacion, simular } from "./layouts/servicio";
import type { Cliente } from "./transaccion";
import { cargarUsuario, type UsuarioActual } from "./usuarios";

/** [archivo, layout, quién lo sube, quién lo autoriza (si requiere)] */
const PASOS: [string, string, string, string?][] = [
  ["fase-1b/01-sat.txt", "sat", "cnt"], ["fase-8/80-sat-receptor.txt", "sat", "cnt"],
  ["fase-1b/02-unidades.txt", "unidades", "com"], ["fase-1b/03-conversiones.txt", "conversiones", "com"], ["fase-1b/04-familias.txt", "familias", "com"],
  ["fase-1b/09-tasas.txt", "tasas", "cnt"], ["fase-1b/10-proveedores.txt", "proveedores", "com"], ["fase-1b/12-insumos.txt", "insumos", "com"],
  ["fase-2/18-insumos-adicionales.txt", "insumos", "com"], ["fase-1b/13-intermedios.txt", "intermedios", "jpr"], ["fase-1b/14-productos.txt", "productos", "jpr"],
  ["fase-1b/15-unidades-por-articulo.txt", "unidades_articulo", "com"],
  ["fase-2/19-etapas.txt", "etapas", "jpr"], ["fase-2/20-turnos.txt", "turnos", "jpr"], ["fase-2/21-tarifas-mano-de-obra.txt", "tarifas_mod", "con"],
  ["fase-2/22-tasas-gif.txt", "tasas_gif", "con"], ["fase-2/23-recetas-masas.txt", "recetas_intermedios", "jpr"], ["fase-2/24-formulas-masas.txt", "formulas_intermedios", "jpr"],
  ["fase-2/25-recetas-productos.txt", "recetas_sku", "jpr"], ["fase-2/26-componentes-productos.txt", "componentes_sku", "jpr"], ["fase-2/27-etapas-por-receta.txt", "etapas_receta", "jpr"],
  ["fase-3/29-causas-merma.txt", "causas_merma", "con"], ["fase-3/30-minimos-por-almacen.txt", "minimos_almacen", "com"],
  ["fase-3/31-inventario-inicial.txt", "inventario_inicial", "jpr", "con"], ["fase-6/32-inventario-inicial-sucursal.txt", "inventario_inicial", "jpr", "con"],
  ["fase-6/33-precios-HOY.txt", "precios", "con", "dir"], ["fase-4/40-cuentas-bancarias.txt", "cuentas_bancarias", "cnt"],
  ["fase-7/70-catalogo-cuentas.txt", "cuentas", "cnt"], ["fase-7/71-reglas-contables.txt", "reglas_contables", "cnt"],
  ["fase-2/28-plan-produccion.txt", "plan_produccion", "jpr"],
];
const RECETAS = ["PRUEBA-MASA-DULCE", "PRUEBA-COBERTURA", "PRUEBA-MASA-BLANCA", "PRUEBA-CONCHA-V", "PRUEBA-CONCHA-C", "PRUEBA-BOLILLO", "PRUEBA-TELERA"];
/** PIN de los usuarios que autorizan en la caja (los mismos de las guías de prueba). */
export const PINES: Record<string, string> = { caj: "4821", enc: "4826", con: "4830", cnt: "4831" };

export const TOTAL_PASOS = PASOS.length + 1;

/**
 * Un paso del escenario (cada uno en su propia transacción, para no rebasar el
 * tiempo de una función): 0..n-1 cargan un archivo; el último activa recetas y PINs.
 */
export async function pasoEscenario(c: Cliente, paso: number, hoy: string) {
  if (!Number.isInteger(paso) || paso < 0 || paso >= TOTAL_PASOS) throw invalido("Paso no válido.");
  if (paso === 0 && (await c.query("SELECT count(*)::int AS n FROM articulo")).rows[0].n > 0) {
    throw new ErrorApp(409, "con_datos", "Ya hay artículos cargados: el escenario de demostración se carga solo sobre una base sin catálogos (por ejemplo, la de un deploy preview nuevo).");
  }
  const u: Record<string, UsuarioActual> = {};
  for (const r of ["cnt", "com", "jpr", "con", "dir", "caj", "enc"]) {
    const id = (await c.query("SELECT id FROM usuario WHERE usuario = $1 AND es_prueba AND estatus = 'activo'", [`prueba.${r}`])).rows[0]?.id;
    if (!id) throw invalido("Primero crea los usuarios de prueba (botón \"Usuarios de prueba\").");
    u[r] = (await cargarUsuario(c, id))!;
  }
  if (paso === PASOS.length) {
    for (const k of RECETAS) await activarVersion(c, u.jpr!.id, k, 1);
    for (const [r, pin] of Object.entries(PINES)) await c.query("UPDATE usuario SET pin_hash = $2, intentos_pin = 0, pin_bloqueado_hasta = NULL WHERE id = $1", [u[r]!.id, await hashear(pin)]);
    return { paso, total: TOTAL_PASOS, descripcion: `${RECETAS.length} recetas activadas y PIN de caja`, terminado: true, pines: Object.fromEntries(Object.entries(PINES).map(([r, p]) => [`prueba.${r}`, p])) };
  }
  const [archivo, layout, sube, autoriza] = PASOS[paso]!;
  const [a, m, d] = hoy.split("-");
  let texto = ARCHIVOS_ESCENARIO[archivo]!;
  if (archivo.includes("precios-HOY")) texto = texto.replaceAll("DD/MM/AAAA", `${d}/${m}/${a}`);
  const s = await simular(c, u[sube]!.id, u[sube]!.permisos, { layout, modo: "alta", nombre: archivo.split("/")[1]!, bytes: new TextEncoder().encode(texto) });
  if (s.errores) throw invalido(`El archivo ${archivo} tiene errores: no se cargó.`, s.detalle);
  let r: { estatus: string } = await aplicar(c, u[sube]!.id, u[sube]!.permisos, s.id);
  if (r.estatus === "pendiente_autorizacion" && autoriza) r = await resolverAutorizacion(c, u[autoriza]!.id, u[autoriza]!.permisos, s.id, "autorizar");
  if (r.estatus !== "aplicada") throw invalido(`El archivo ${archivo} quedó "${r.estatus}".`);
  return { paso, total: TOTAL_PASOS, descripcion: `${archivo} (${s.renglones} renglones, subió prueba.${sube}${autoriza ? `, autorizó prueba.${autoriza}` : ""})`, terminado: false };
}
