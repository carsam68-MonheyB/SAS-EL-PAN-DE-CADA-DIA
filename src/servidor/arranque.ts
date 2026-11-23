// Revisión de arranque (Fase 9): lista de verificación antes de operar con datos
// reales y durante la operación en paralelo. Revisa llaves y variables, respaldos,
// usuarios y permisos, datos de PRUEBA y valores provisionales. Solo lee; nunca
// muestra el valor de un secreto.
import { conflictosDeAsignacion } from "../dominio/permisos";
import { estadoConfiguracion } from "./respaldo";
import { leerIncompatibilidades, permisosDeRoles } from "./seguridad";
import type { Cliente } from "./transaccion";

export type Estado = "OK" | "AVISO" | "FALLA";
export interface Revision { grupo: string; clave: string; titulo: string; estado: Estado; detalle: string; como?: string }

const llave32 = (v: string | undefined) => !!v && Buffer.from(v, "base64").length === 32;

export async function revisarArranque(c: Cliente, env: Record<string, string | undefined> = process.env): Promise<{ revisiones: Revision[]; resumen: Record<Estado, number> }> {
  const R: Revision[] = [];
  const add = (grupo: string, clave: string, titulo: string, estado: Estado, detalle: string, como?: string) => R.push({ grupo, clave, titulo, estado, detalle, ...(como ? { como } : {}) });

  // ---- Llaves y variables de entorno (nunca se muestran) ----
  const G1 = "Llaves y variables de entorno";
  add(G1, "llave_maestra", "LLAVE_MAESTRA", llave32(env.LLAVE_MAESTRA) ? "OK" : "FALLA",
    llave32(env.LLAVE_MAESTRA) ? "Definida (32 bytes)." : "Falta o no es de 32 bytes en base64.", "Genérala nueva para producción (README, Variables de entorno).");
  add(G1, "datos_prueba", "Datos de prueba deshabilitados", env.PERMITIR_DATOS_PRUEBA === "si" ? "FALLA" : "OK",
    env.PERMITIR_DATOS_PRUEBA === "si" ? "PERMITIR_DATOS_PRUEBA = si: se pueden crear usuarios ficticios y XML de PRUEBA." : "No se pueden crear usuarios ni XML de prueba.",
    "En producción, borra la variable PERMITIR_DATOS_PRUEBA en Netlify.");
  const hayUsuarios = (await c.query("SELECT count(*)::int AS n FROM usuario")).rows[0].n > 0;
  add(G1, "clave_instalacion", "CLAVE_INSTALACION retirada", env.CLAVE_INSTALACION && hayUsuarios ? "AVISO" : "OK",
    env.CLAVE_INSTALACION && hayUsuarios ? "Ya hay usuarios y la clave de instalación sigue definida (no sirve de nada, pero es mejor quitarla)." : "Correcto.",
    "Borra CLAVE_INSTALACION en Netlify después de instalar.");
  const rc = estadoConfiguracion(env);
  add(G1, "respaldo_llave", "RESPALDO_LLAVE", !rc.llave ? "FALLA" : env.RESPALDO_LLAVE === env.LLAVE_MAESTRA ? "FALLA" : "OK",
    rc.llave_error ?? (!rc.llave ? "Falta: sin ella no hay respaldos cifrados." : env.RESPALDO_LLAVE === env.LLAVE_MAESTRA ? "Es igual a LLAVE_MAESTRA: deben ser distintas." : "Definida y distinta de la llave maestra."),
    "Genera una llave nueva y guárdala también FUERA de Netlify (sin ella no se pueden abrir los respaldos).");
  add(G1, "respaldo_almacen", "Almacenamiento externo (S3 con Object Lock)", rc.almacen ? "OK" : "FALLA",
    rc.almacen ? `Configurado: ${rc.endpoint} · cubeta ${rc.bucket}.` : "Faltan las variables RESPALDO_S3_* (P06).", "Ver docs/arranque/respaldos.md.");

  // ---- Respaldos ----
  const G2 = "Respaldos";
  const ult = (await c.query("SELECT creado_en, terminado_en, tipo FROM respaldo WHERE estatus = 'COMPLETO' AND tipo <> 'DESCARGA' ORDER BY terminado_en DESC LIMIT 1")).rows[0];
  const dias = ult ? Math.floor((Date.now() - new Date(ult.terminado_en).getTime()) / 86_400_000) : null;
  add(G2, "ultimo_respaldo", "Último respaldo externo", dias === null ? "FALLA" : dias > 35 ? "FALLA" : "OK",
    dias === null ? "Nunca se ha hecho un respaldo externo completo." : `Hace ${dias} día(s) (${ult.tipo.toLowerCase()}).`, "Arranque y respaldos → Respaldos → Respaldar ahora.");
  const errores = (await c.query("SELECT count(*)::int AS n FROM respaldo WHERE estatus = 'ERROR' AND creado_en > now() - interval '30 days'")).rows[0].n;
  if (errores) add(G2, "respaldos_error", "Respaldos con error (30 días)", "AVISO", `${errores} respaldo(s) fallaron. Revisa la razón en la pantalla de respaldos.`);
  const xml = (await c.query("SELECT (SELECT count(*) FROM cfdi_emitido) + (SELECT count(*) FROM factura_proveedor WHERE xml IS NOT NULL) - (SELECT count(*) FROM respaldo_cfdi) AS n")).rows[0].n;
  add(G2, "xml_archivados", "XML de facturas archivados", Number(xml) > 0 ? "AVISO" : "OK", Number(xml) > 0 ? `${xml} XML todavía no se copian al almacenamiento externo (se copian con cada respaldo).` : "Todos los XML están archivados.");

  // ---- Usuarios y permisos ----
  const G3 = "Usuarios y permisos";
  const prueba = (await c.query("SELECT count(*)::int AS n FROM usuario WHERE es_prueba AND estatus = 'activo'")).rows[0].n;
  add(G3, "usuarios_prueba", "Usuarios de prueba", prueba ? "FALLA" : "OK", prueba ? `${prueba} usuario(s) FICTICIOS activos (prueba.*).` : "No hay usuarios de prueba activos.", "Dalos de baja en Usuarios antes de operar con datos reales.");
  const sin2fa = (await c.query(
    `SELECT string_agg(DISTINCT u.usuario, ', ') AS l, count(DISTINCT u.id)::int AS n FROM usuario u JOIN usuario_rol ur ON ur.usuario_id = u.id JOIN rol r ON r.id = ur.rol_id
      WHERE r.requiere_2fa AND u.estatus = 'activo' AND NOT u.totp_activo`,
  )).rows[0];
  add(G3, "doble_factor", "Doble factor en puestos que lo requieren", sin2fa.n ? "AVISO" : "OK",
    sin2fa.n ? `${sin2fa.n} usuario(s) aún no lo activan: ${sin2fa.l}. Se les pedirá al entrar.` : "Todos lo tienen activo.");
  const incomp = await leerIncompatibilidades(c);
  const usuarios = (await c.query("SELECT u.id, u.usuario, array_agg(ur.rol_id) AS roles FROM usuario u JOIN usuario_rol ur ON ur.usuario_id = u.id WHERE u.estatus = 'activo' GROUP BY u.id, u.usuario")).rows;
  const conflictos: string[] = [];
  for (const u of usuarios) {
    const cs = conflictosDeAsignacion(await permisosDeRoles(c, u.roles), incomp);
    if (cs.length) conflictos.push(`${u.usuario}: ${cs.map((x) => x.descripcion).join("; ")}`);
  }
  add(G3, "segregacion", "Segregación de funciones", conflictos.length ? "FALLA" : "OK", conflictos.length ? conflictos.join(" · ") : "Ningún usuario junta funciones incompatibles.");
  const admins = (await c.query("SELECT count(DISTINCT u.id)::int AS n FROM usuario u JOIN usuario_rol ur ON ur.usuario_id = u.id JOIN rol r ON r.id = ur.rol_id WHERE r.clave = 'ADM' AND u.estatus = 'activo'")).rows[0].n;
  add(G3, "administradores", "Administradores", admins === 0 ? "FALLA" : admins > 2 ? "AVISO" : "OK", `${admins} administrador(es) activo(s).`, admins > 2 ? "Conviene que sean pocos (uno principal y uno de respaldo)." : undefined);
  const inactivos = (await c.query(
    `SELECT string_agg(u.usuario, ', ') AS l, count(*)::int AS n FROM usuario u WHERE u.estatus = 'activo' AND NOT u.es_prueba AND u.creado_en < now() - interval '60 days'
        AND NOT EXISTS (SELECT 1 FROM bitacora_acceso b WHERE b.usuario_id = u.id AND b.evento = 'login' AND b.exito AND b.fecha > now() - interval '60 days')`,
  )).rows[0];
  add(G3, "inactivos", "Usuarios sin entrar en 60 días", inactivos.n ? "AVISO" : "OK", inactivos.n ? `${inactivos.l}: ¿siguen en la empresa?` : "Correcto.");

  // ---- Datos del negocio ----
  const G4 = "Datos del negocio";
  const pruebaDatos = (await c.query(
    `SELECT 'artículos' AS que, count(*)::int AS n FROM articulo WHERE clave LIKE 'PRUEBA%'
     UNION ALL SELECT 'proveedores', count(*)::int FROM proveedor WHERE clave LIKE 'PRUEBA%'
     UNION ALL SELECT 'clientes', count(*)::int FROM cliente WHERE clave LIKE 'PRUEBA%'
     UNION ALL SELECT 'tasas de impuesto', count(*)::int FROM tasa_impuesto WHERE clave LIKE 'PRUEBA%'
     UNION ALL SELECT 'cuentas contables', count(*)::int FROM cuenta_contable WHERE nombre ILIKE '%PRUEBA%'
     UNION ALL SELECT 'claves del SAT', count(*)::int FROM sat_catalogo WHERE descripcion LIKE 'PRUEBA%'`,
  )).rows.filter((x) => x.n > 0);
  add(G4, "datos_prueba", "Datos ficticios (PRUEBA)", pruebaDatos.length ? "FALLA" : "OK", pruebaDatos.length ? `Hay ${pruebaDatos.map((x) => `${x.n} ${x.que}`).join(", ")}.` : "No hay datos PRUEBA en los catálogos.",
    "La base de producción se construye nueva y se carga solo con datos reales (README, Traslado).");
  const rfc = (await c.query("SELECT valor FROM configuracion WHERE clave = 'empresa.rfc'")).rows[0]?.valor ?? "";
  add(G4, "rfc", "RFC de la empresa", rfc.trim() ? "OK" : "FALLA", rfc.trim() ? `Capturado (${rfc}).` : "Vacío: no se revisa que las facturas sean de la empresa.", "Configuración → empresa.rfc.");
  const inicio = (await c.query("SELECT valor FROM configuracion WHERE clave = 'contabilidad.fecha_inicio'")).rows[0]?.valor ?? "";
  add(G4, "fecha_inicio", "Fecha de arranque contable (P52)", inicio.trim() ? "OK" : "AVISO", inicio.trim() ? inicio : "Vacía: se contabiliza desde la primera operación.");
  const prov = (await c.query("SELECT grupo, string_agg(clave, ', ' ORDER BY clave) AS l, count(*)::int AS n FROM configuracion WHERE provisional GROUP BY grupo ORDER BY grupo")).rows;
  add(G4, "provisionales", "Valores provisionales por confirmar", prov.length ? "AVISO" : "OK", prov.length ? prov.map((x) => `${x.grupo}: ${x.l}`).join(" · ") : "Todos confirmados.", "Revísalos con dirección y el contador (Configuración).");
  const reglas = (await c.query("SELECT count(*)::int AS n FROM concepto_contable cc WHERE cc.activo AND NOT EXISTS (SELECT 1 FROM regla_contable r WHERE r.concepto_id = cc.id AND r.activo)")).rows[0].n;
  add(G4, "reglas_contables", "Reglas de contabilización", reglas ? "AVISO" : "OK", reglas ? `${reglas} concepto(s) sin cuenta: sus documentos quedan pendientes de contabilizar.` : "Todos los conceptos tienen cuenta.");
  const satVacio = (await c.query("SELECT array_agg(x) AS l FROM unnest(ARRAY['c_RegimenFiscal', 'c_UsoCFDI', 'c_ClaveProdServ', 'c_ClaveUnidad']) x WHERE NOT EXISTS (SELECT 1 FROM sat_catalogo s WHERE s.catalogo = x AND s.activo AND s.descripcion NOT LIKE 'PRUEBA%')")).rows[0].l;
  add(G4, "catalogos_sat", "Catálogos oficiales del SAT", satVacio?.length ? "AVISO" : "OK", satVacio?.length ? `Faltan claves oficiales de: ${satVacio.join(", ")}.` : "Cargados.", "Se cargan por layout desde el archivo del SAT.");
  const skus = (await c.query(
    `SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM precio_venta p WHERE p.articulo_id = a.id AND p.vigente_desde <= current_date AND (p.vigente_hasta IS NULL OR p.vigente_hasta >= current_date)))::int AS sin_precio,
            count(*) FILTER (WHERE a.tasa_iva_id IS NULL OR a.clave_prod_serv IS NULL)::int AS sin_fiscal,
            count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM receta r WHERE r.articulo_id = a.id AND r.estatus = 'ACTIVA'))::int AS sin_receta, count(*)::int AS total
       FROM articulo a WHERE a.tipo = 'SKU' AND a.activo`,
  )).rows[0];
  add(G4, "skus", "Productos a la venta", skus.total === 0 ? "AVISO" : skus.sin_precio || skus.sin_fiscal ? "AVISO" : "OK",
    skus.total === 0 ? "No hay productos cargados." : `${skus.total} productos · sin precio vigente: ${skus.sin_precio} · sin datos fiscales: ${skus.sin_fiscal} · sin receta activa: ${skus.sin_receta}.`);

  const resumen = { OK: 0, AVISO: 0, FALLA: 0 } as Record<Estado, number>;
  for (const r of R) resumen[r.estado]++;
  return { revisiones: R, resumen };
}
