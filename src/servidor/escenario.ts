// Escenario de demostración (solo ambiente de pruebas): carga de un jalón los
// archivos de ejemplo de todas las fases con los mismos pasos y permisos que una
// persona (cada archivo lo sube el puesto que le toca y lo autoriza quien debe),
// activa las recetas y deja el PIN de los usuarios de caja. DATOS FICTICIOS.
import { activarVersion } from "./recetas";
import { hashear } from "./contrasena";
import { invalido } from "./errores";
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

/** Usuario prueba.<rol>: el creado por "Usuarios de prueba" o, si ya existía uno a mano con ese nombre, ese. */
async function usuarioPrueba(c: Cliente, r: string): Promise<UsuarioActual> {
  const id = (await c.query("SELECT id FROM usuario WHERE usuario = $1 AND estatus = 'activo' ORDER BY es_prueba DESC LIMIT 1", [`prueba.${r}`])).rows[0]?.id;
  if (!id) throw invalido(`Falta el usuario prueba.${r}: pulsa primero "Usuarios de prueba".`);
  return (await cargarUsuario(c, id))!;
}

/** ¿El archivo ya está cargado? (para completar lo que falte sin duplicar) */
async function yaCargado(c: Cliente, archivo: string, layout: string, texto: string): Promise<string | null> {
  const nombre = archivo.split("/")[1]!;
  if ((await c.query("SELECT 1 FROM carga_layout WHERE layout = $1 AND nombre_archivo = $2 AND estatus = 'aplicada' LIMIT 1", [layout, nombre])).rows[0]) return "ya se había cargado este archivo";
  if (layout === "inventario_inicial") {
    const almacenes = [...new Set(texto.split(/\r?\n/).slice(1).map((l) => l.split("|")[0]!.trim()).filter(Boolean))];
    const hay = (await c.query("SELECT 1 FROM movimiento m JOIN almacen a ON a.id = m.almacen_id WHERE a.clave = ANY($1) LIMIT 1", [almacenes])).rows[0];
    if (hay) return `ya hay movimientos en ${almacenes.join(", ")}`;
  }
  if (layout === "plan_produccion" && (await c.query("SELECT 1 FROM plan_produccion LIMIT 1")).rows[0]) return "ya hay un plan de producción";
  return null;
}

/**
 * Un paso del escenario (cada uno en su propia transacción, para no rebasar el
 * tiempo de una función): 0..n-1 cargan un archivo; el último activa recetas y PINs.
 * Completa lo que falte: si un archivo ya estaba cargado (o sus datos ya existen), se omite.
 */
export async function pasoEscenario(c: Cliente, paso: number, hoy: string) {
  if (!Number.isInteger(paso) || paso < 0 || paso >= TOTAL_PASOS) throw invalido("Paso no válido.");
  if (paso === PASOS.length) {
    const jpr = await usuarioPrueba(c, "jpr");
    const borradores = (await c.query("SELECT a.clave FROM receta r JOIN articulo a ON a.id = r.articulo_id WHERE a.clave = ANY($1) AND r.version = 1 AND r.estatus = 'BORRADOR'", [RECETAS])).rows.map((x) => x.clave as string);
    for (const k of RECETAS.filter((x) => borradores.includes(x))) await activarVersion(c, jpr.id, k, 1);
    const pines: Record<string, string> = {};
    for (const [r, pin] of Object.entries(PINES)) {
      const id = (await c.query("SELECT id FROM usuario WHERE usuario = $1 AND estatus = 'activo' ORDER BY es_prueba DESC LIMIT 1", [`prueba.${r}`])).rows[0]?.id;
      if (!id) continue;
      await c.query("UPDATE usuario SET pin_hash = $2, intentos_pin = 0, pin_bloqueado_hasta = NULL WHERE id = $1", [id, await hashear(pin)]);
      pines[`prueba.${r}`] = pin;
    }
    const activas = (await c.query("SELECT count(*)::int AS n FROM receta r JOIN articulo a ON a.id = r.articulo_id WHERE a.clave = ANY($1) AND r.estatus = 'ACTIVA'", [RECETAS])).rows[0].n;
    return { paso, total: TOTAL_PASOS, descripcion: `${activas} de ${RECETAS.length} recetas activas y PIN de caja`, terminado: true, pines };
  }
  const [archivo, layout, sube, autoriza] = PASOS[paso]!;
  const [a, m, d] = hoy.split("-");
  let texto = ARCHIVOS_ESCENARIO[archivo]!;
  if (archivo.includes("precios-HOY")) texto = texto.replaceAll("DD/MM/AAAA", `${d}/${m}/${a}`);
  const omitido = await yaCargado(c, archivo, layout, texto);
  if (omitido) return { paso, total: TOTAL_PASOS, descripcion: `${archivo}: se omite (${omitido})`, terminado: false, omitido: true };
  const quien = await usuarioPrueba(c, sube);
  const bytes = new TextEncoder().encode(texto);
  // Si el archivo se omite, no queda rastro de los intentos en el historial de cargas.
  await c.query("SAVEPOINT escenario");
  const omitir = async (motivo: string) => {
    await c.query("ROLLBACK TO SAVEPOINT escenario");
    return { paso, total: TOTAL_PASOS, descripcion: `${archivo}: se omite (${motivo})`, terminado: false, omitido: true };
  };
  let s = await simular(c, quien.id, quien.permisos, { layout, modo: "alta", nombre: archivo.split("/")[1]!, bytes });
  if (s.errores) {
    // Si los datos ya existían (por ejemplo, cargados a mano antes), se intenta como alta o actualización.
    try { s = await simular(c, quien.id, quien.permisos, { layout, modo: "ambos", nombre: archivo.split("/")[1]!, bytes }); } catch { /* sin permiso de actualizar */ }
    if (s.errores) {
      const primero = (s.detalle as { severidad: string; mensaje: string }[] | undefined)?.find((x) => x.severidad === "error")?.mensaje ?? "tiene diferencias con lo ya cargado";
      return omitir(primero);
    }
  }
  let r: { estatus: string } = await aplicar(c, quien.id, quien.permisos, s.id);
  if (r.estatus === "pendiente_autorizacion" && autoriza) {
    const aut = await usuarioPrueba(c, autoriza);
    r = await resolverAutorizacion(c, aut.id, aut.permisos, s.id, "autorizar");
  }
  if (r.estatus !== "aplicada") return omitir(`quedó "${r.estatus}"`);
  return { paso, total: TOTAL_PASOS, descripcion: `${archivo} (${s.renglones} renglones, subió ${quien.usuario}${autoriza ? `, autorizó prueba.${autoriza}` : ""})`, terminado: false };
}
