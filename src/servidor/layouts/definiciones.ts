// Catálogos de la Fase 1B y su layout. El orden (secuencia) es el sugerido para
// la carga inicial: primero lo que otros catálogos usan como referencia.
import Decimal from "decimal.js";
import { factorConversion, type ConversionGeneral } from "../../dominio/unidades";
import type { Campo, FilaValidada, Layout } from "./tipos";
import { CATALOGOS_SAT } from "./tipos";

const CLAVE_PATRON = /^[A-Z0-9-]+$/;
const CLAVE_TEXTO = "solo letras sin acento, números y guion (-)";

const clave = (ejemplo: string, max = 30, descripcion = "Clave única del registro."): Campo => ({
  nombre: "CLAVE", columna: "clave", tipo: "texto", obligatorio: true, mayusculas: true, max,
  patron: CLAVE_PATRON, patronTexto: CLAVE_TEXTO, ejemplo, descripcion,
});
const nombre = (ejemplo: string, max = 120): Campo => ({ nombre: "NOMBRE", columna: "nombre", tipo: "texto", obligatorio: true, max, ejemplo, descripcion: "Nombre o descripción." });
const ACTIVO: Campo = { nombre: "ACTIVO", columna: "activo", tipo: "sino", porOmision: "SI", ejemplo: "SI", descripcion: "NO = dado de baja. Nunca se borra." };
const RFC: Campo = {
  nombre: "RFC", columna: "rfc", tipo: "texto", obligatorio: true, mayusculas: true, max: 13,
  patron: /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/, patronTexto: "RFC de 12 (moral) o 13 (física) caracteres, sin guiones ni espacios",
  ejemplo: "XAXX010101000", descripcion: "RFC sin guiones.",
};
const CP: Campo = { nombre: "CODIGO_POSTAL", columna: "codigo_postal", tipo: "texto", max: 5, patron: /^[0-9]{5}$/, patronTexto: "5 dígitos", ejemplo: "06000", descripcion: "Código postal del domicilio fiscal." };
const CORREO: Campo = { nombre: "CORREO", columna: "correo", tipo: "texto", max: 120, patron: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, patronTexto: "correo electrónico", ejemplo: "contacto@ejemplo.com", descripcion: "Correo de contacto." };
const TELEFONO: Campo = { nombre: "TELEFONO", columna: "telefono", tipo: "texto", max: 30, ejemplo: "5512345678", descripcion: "Teléfono de contacto." };
const DIAS_CREDITO: Campo = { nombre: "DIAS_CREDITO", columna: "dias_credito", tipo: "entero", minimo: 0, maximo: 365, porOmision: "0", ejemplo: "15", descripcion: "Días de crédito." };

const UNIDAD = { tabla: "unidad", etiqueta: "La unidad" } as const;
const FAMILIA = (tipos: string[]) => ({ tabla: "familia", etiqueta: "La familia", filtro: `r.aplica_a IN (${[...tipos, "TODOS"].map((t) => `'${t}'`).join(", ")})` });

const VER_ARTICULOS = ["catalogos.insumos:ver", "catalogos.sku:ver", "produccion.recetas:ver"];

/** Valor final de un campo: el nuevo si viene en el archivo; si no, el actual de la base. */
function actual(f: FilaValidada, campo: Campo | undefined): string | null {
  if (!campo) return null;
  if (f.presentes.has(campo.nombre) || !f.existente) {
    const v = f.valores[campo.nombre];
    return v === undefined || v === null ? null : String(v);
  }
  const v = f.existente[campo.columna];
  return v === undefined ? null : v;
}

function campo(layout: Layout, nombreCampo: string): Campo {
  return layout.campos.find((x) => x.nombre === nombreCampo)!;
}

/** Datos para validar unidades y conversiones de artículos. */
async function prepararUnidades(c: import("../transaccion").Cliente) {
  const unidades = (await c.query("SELECT id::text, clave, magnitud FROM unidad")).rows;
  const porId = new Map(unidades.map((u) => [u.id as string, u]));
  const generales: ConversionGeneral[] = (await c.query(
    "SELECT d.clave AS de, a.clave AS a, cu.factor::text AS factor FROM conversion_unidad cu JOIN unidad d ON d.id = cu.de_unidad_id JOIN unidad a ON a.id = cu.a_unidad_id WHERE cu.activo",
  )).rows;
  const propias = new Map<string, { unidad: string; factorABase: string }[]>();
  for (const r of (await c.query("SELECT au.articulo_id::text, u.clave AS unidad, au.factor_a_base::text AS factor FROM articulo_unidad au JOIN unidad u ON u.id = au.unidad_id WHERE au.activo")).rows) {
    propias.set(r.articulo_id, [...(propias.get(r.articulo_id) ?? []), { unidad: r.unidad, factorABase: r.factor }]);
  }
  return { porId, generales, propias };
}

function validarUnidadesArticulo(layout: Layout, f: FilaValidada, ayuda: import("./tipos").Ayuda, extras: string[]) {
  const { porId, generales, propias } = ayuda.datos as Awaited<ReturnType<typeof prepararUnidades>>;
  const baseId = actual(f, campo(layout, "UNIDAD_BASE") ?? campo(layout, "UNIDAD_VENTA"));
  const base = baseId ? porId.get(baseId) : null;
  if (!base) return;
  for (const nombreCampo of extras) {
    const id = actual(f, campo(layout, nombreCampo));
    const u = id ? porId.get(id) : null;
    if (!u || u.id === base.id) continue;
    const factor = factorConversion(u.clave, base.clave, { base: base.clave, propias: f.id ? propias.get(f.id) ?? [] : [] }, generales);
    if (!factor) {
      ayuda.advertencia(nombreCampo, `Falta la conversión de ${u.clave} a ${base.clave}. Cárgala en "Conversiones de unidades" o en "Unidades por artículo" antes de usarlo en compras o recetas.`);
    }
  }
}

function validarExistencias(f: FilaValidada, ayuda: import("./tipos").Ayuda, layout: Layout) {
  const v = (n: string) => {
    const x = actual(f, campo(layout, n));
    return x === null ? null : new Decimal(x);
  };
  const min = v("STOCK_MINIMO");
  const max = v("STOCK_MAXIMO");
  const reorden = v("PUNTO_REORDEN");
  if (min && max && min.gt(max)) ayuda.error("STOCK_MINIMO", "El stock mínimo no puede ser mayor que el máximo.");
  if (reorden && min && reorden.lt(min)) ayuda.advertencia("PUNTO_REORDEN", "El punto de reorden es menor que el stock mínimo.");
  if (reorden && max && reorden.gt(max)) ayuda.error("PUNTO_REORDEN", "El punto de reorden no puede ser mayor que el stock máximo.");
}

async function prepararFamilias(c: import("../transaccion").Cliente) {
  return new Map((await c.query("SELECT id::text, clave, aplica_a FROM familia")).rows.map((x) => [x.id as string, x]));
}

function validarFamilia(layout: Layout, f: FilaValidada, ayuda: import("./tipos").Ayuda, familias: Map<string, any>, tipo: string | null) {
  const id = actual(f, campo(layout, "FAMILIA"));
  const fam = id ? familias.get(id) : null;
  if (fam && tipo && fam.aplica_a !== "TODOS" && fam.aplica_a !== tipo) {
    ayuda.error("FAMILIA", `La familia ${fam.clave} es para ${fam.aplica_a}, no para ${tipo}.`);
  }
}

// ---------------------------------------------------------------------------

const satCatalogo: Layout = {
  clave: "sat", secuencia: 1, grupo: "Fiscal", nombre: "Catálogos del SAT",
  descripcion: "Claves oficiales del SAT (producto/servicio, unidad, objeto de impuesto, régimen fiscal, uso de CFDI, forma de pago y código agrupador). Se copian del archivo oficial del SAT (catCFDI); basta con cargar las claves que use el negocio.",
  tabla: "sat_catalogo", llave: ["CATALOGO", "CLAVE"], orden: "t.catalogo, t.clave",
  permisos: { ver: ["contabilidad.catalogo:ver", "catalogos.sku:ver", "catalogos.clientes:ver", "catalogos.proveedores:ver"], crear: ["contabilidad.catalogo:crear"], editar: ["contabilidad.catalogo:editar"], exportar: ["contabilidad.catalogo:exportar"] },
  campos: [
    { nombre: "CATALOGO", columna: "catalogo", tipo: "opcion", obligatorio: true, opciones: CATALOGOS_SAT, soloAlta: true, ejemplo: "c_ClaveUnidad", descripcion: "Nombre del catálogo del SAT." },
    { nombre: "CLAVE", columna: "clave", tipo: "texto", obligatorio: true, mayusculas: true, max: 20, patron: /^[A-Z0-9.-]+$/, patronTexto: "clave tal como aparece en el catálogo del SAT", ejemplo: "H87", descripcion: "Clave oficial." },
    { nombre: "DESCRIPCION", columna: "descripcion", tipo: "texto", obligatorio: true, max: 500, ejemplo: "Pieza", descripcion: "Descripción oficial." },
    ACTIVO,
  ],
};

const unidades: Layout = {
  clave: "unidades", secuencia: 2, grupo: "Artículos", nombre: "Unidades de medida",
  descripcion: "Unidades de compra, almacén, receta y venta (ej. KG, G, L, ML, PZA, BULTO).",
  tabla: "unidad", llave: ["CLAVE"],
  permisos: { ver: VER_ARTICULOS, crear: ["catalogos.insumos:crear", "produccion.recetas:crear"], editar: ["catalogos.insumos:editar", "produccion.recetas:editar"], exportar: ["catalogos.insumos:exportar", "produccion.recetas:exportar"] },
  campos: [
    clave("KG", 15, "Clave corta de la unidad."),
    nombre("Kilogramo", 60),
    { nombre: "MAGNITUD", columna: "magnitud", tipo: "opcion", obligatorio: true, soloAlta: true, opciones: ["MASA", "VOLUMEN", "PIEZA", "LONGITUD", "OTRA"], ejemplo: "MASA", descripcion: "Qué mide. Las conversiones generales solo se permiten entre unidades de la misma magnitud." },
    { nombre: "CLAVE_SAT", columna: "clave_sat", tipo: "sat", sat: "c_ClaveUnidad", max: 20, ejemplo: "KGM", descripcion: "Clave de unidad del SAT (para facturar)." },
    ACTIVO,
  ],
};

const conversiones: Layout = {
  clave: "conversiones", secuencia: 3, grupo: "Artículos", nombre: "Conversiones de unidades",
  descripcion: "Conversiones que valen para todos los artículos: 1 DE_UNIDAD = FACTOR A_UNIDAD (ej. 1 KG = 1000 G). La inversa se calcula sola. Las que dependen del artículo (1 BULTO de harina = 25 KG) van en \"Unidades por artículo\".",
  tabla: "conversion_unidad", llave: ["DE_UNIDAD", "A_UNIDAD"],
  orden: "(SELECT clave FROM unidad u WHERE u.id = t.de_unidad_id), (SELECT clave FROM unidad u WHERE u.id = t.a_unidad_id)",
  permisos: unidades.permisos,
  campos: [
    { nombre: "DE_UNIDAD", columna: "de_unidad_id", tipo: "ref", ref: UNIDAD, obligatorio: true, ejemplo: "KG", descripcion: "Unidad de origen." },
    { nombre: "A_UNIDAD", columna: "a_unidad_id", tipo: "ref", ref: UNIDAD, obligatorio: true, ejemplo: "G", descripcion: "Unidad destino." },
    { nombre: "FACTOR", columna: "factor", tipo: "decimal", obligatorio: true, mayorQueCero: true, decimales: 10, ejemplo: "1000", descripcion: "Cuántas A_UNIDAD hay en 1 DE_UNIDAD." },
    ACTIVO,
  ],
  async preparar(c) {
    const u = new Map((await c.query("SELECT id::text, clave, magnitud FROM unidad")).rows.map((x) => [x.id as string, x]));
    const pares = new Set((await c.query("SELECT de_unidad_id::text || '>' || a_unidad_id::text AS par FROM conversion_unidad")).rows.map((x) => x.par as string));
    return { u, pares };
  },
  validar(f, ayuda) {
    const { u, pares } = ayuda.datos;
    const de = f.valores.DE_UNIDAD as string;
    const a = f.valores.A_UNIDAD as string;
    if (de === a) return ayuda.error("A_UNIDAD", "La unidad destino debe ser distinta de la de origen.");
    if (u.get(de).magnitud !== u.get(a).magnitud) {
      ayuda.error("A_UNIDAD", `${u.get(de).clave} (${u.get(de).magnitud}) y ${u.get(a).clave} (${u.get(a).magnitud}) miden cosas distintas. Esa conversión depende del artículo: cárgala en "Unidades por artículo".`);
    }
    if (pares.has(`${a}>${de}`)) ayuda.error("DE_UNIDAD", `Ya existe la conversión inversa (${u.get(a).clave} → ${u.get(de).clave}); no se captura dos veces.`);
  },
};

const familias: Layout = {
  clave: "familias", secuencia: 4, grupo: "Artículos", nombre: "Familias",
  descripcion: "Agrupaciones de artículos (ej. pan blanco, pan dulce, pastelería, harinas, empaques). Las define el negocio.",
  tabla: "familia", llave: ["CLAVE"],
  permisos: { ver: VER_ARTICULOS, crear: ["catalogos.insumos:crear", "catalogos.sku:crear", "produccion.recetas:crear"], editar: ["catalogos.insumos:editar", "catalogos.sku:editar", "produccion.recetas:editar"], exportar: ["catalogos.insumos:exportar", "produccion.recetas:exportar"] },
  campos: [
    clave("PAN-DULCE"),
    nombre("Pan dulce"),
    { nombre: "APLICA_A", columna: "aplica_a", tipo: "opcion", obligatorio: true, opciones: ["INSUMO", "EMPAQUE", "INTERMEDIO", "SKU", "TODOS"], ejemplo: "SKU", descripcion: "A qué tipo de artículo aplica." },
    ACTIVO,
  ],
};

const ESTRUCTURA = { ver: ["catalogos.estructura:ver"], crear: ["catalogos.estructura:crear"], editar: ["catalogos.estructura:editar"], exportar: ["catalogos.estructura:editar"] };

const centrosCosto: Layout = {
  clave: "centros_costo", secuencia: 5, grupo: "Estructura", nombre: "Centros de costo",
  descripcion: "Centros de costo a los que se asignan los almacenes (ej. producción, sucursal).",
  tabla: "centro_costo", llave: ["CLAVE"], permisos: ESTRUCTURA,
  campos: [clave("CC-PROD", 20), nombre("Producción"), ACTIVO],
};

const sucursales: Layout = {
  clave: "sucursales", secuencia: 6, grupo: "Estructura", nombre: "Sucursales",
  descripcion: "Matriz y sucursales.", tabla: "sucursal", llave: ["CLAVE"], permisos: ESTRUCTURA,
  campos: [
    clave("SUC2", 20),
    nombre("Sucursal 2"),
    { nombre: "ES_PLANTA", columna: "es_planta", tipo: "sino", porOmision: "NO", ejemplo: "NO", descripcion: "SI si ahí se produce." },
    { nombre: "VENDE_AL_PUBLICO", columna: "vende_al_publico", tipo: "sino", porOmision: "SI", ejemplo: "SI", descripcion: "SI si tiene mostrador." },
    ACTIVO,
  ],
};

const almacenes: Layout = {
  clave: "almacenes", secuencia: 7, grupo: "Estructura", nombre: "Almacenes",
  descripcion: "Almacenes por sucursal: MP materia prima, PEP producción en proceso, PT producto terminado, INS insumos de sucursal.",
  tabla: "almacen", llave: ["CLAVE"], permisos: ESTRUCTURA,
  campos: [
    clave("INS-SUC1", 20),
    nombre("Insumos · Sucursal 1"),
    { nombre: "TIPO", columna: "tipo", tipo: "opcion", obligatorio: true, soloAlta: true, opciones: ["MP", "PEP", "PT", "INS"], ejemplo: "INS", descripcion: "Tipo de almacén." },
    { nombre: "SUCURSAL", columna: "sucursal_id", tipo: "ref", ref: { tabla: "sucursal", etiqueta: "La sucursal" }, obligatorio: true, soloAlta: true, ejemplo: "SUC1", descripcion: "Sucursal a la que pertenece." },
    { nombre: "CENTRO_COSTO", columna: "centro_costo_id", tipo: "ref", ref: { tabla: "centro_costo", etiqueta: "El centro de costo" }, ejemplo: "CC-PROD", descripcion: "Centro de costo." },
    ACTIVO,
  ],
};

const cajas: Layout = {
  clave: "cajas", secuencia: 8, grupo: "Estructura", nombre: "Cajas",
  descripcion: "Cajas (puntos de cobro) por sucursal.", tabla: "caja", llave: ["CLAVE"], permisos: ESTRUCTURA,
  campos: [
    clave("CAJA-SUC1-2", 20),
    nombre("Caja 2 · Sucursal 1"),
    { nombre: "SUCURSAL", columna: "sucursal_id", tipo: "ref", ref: { tabla: "sucursal", etiqueta: "La sucursal" }, obligatorio: true, soloAlta: true, ejemplo: "SUC1", descripcion: "Sucursal de la caja." },
    ACTIVO,
  ],
};

const tasas: Layout = {
  clave: "tasas", secuencia: 9, grupo: "Fiscal", nombre: "Tasas de impuesto",
  descripcion: "Tasas de IVA e IEPS que el negocio define con su contador. El sistema no trae tasas precargadas.",
  tabla: "tasa_impuesto", llave: ["CLAVE"],
  permisos: { ver: ["contabilidad.catalogo:ver", "catalogos.sku:ver"], crear: ["contabilidad.catalogo:crear"], editar: ["contabilidad.catalogo:editar"], exportar: ["contabilidad.catalogo:exportar"] },
  notas: ["La tasa se escribe como fracción, igual que en el CFDI: 16% se escribe 0.160000. Para tipo de factor Exento la columna TASA va vacía."],
  campos: [
    clave("IVA-GENERAL", 20),
    { nombre: "IMPUESTO", columna: "impuesto", tipo: "opcion", obligatorio: true, soloAlta: true, opciones: ["IVA", "IEPS"], ejemplo: "IVA", descripcion: "Impuesto." },
    { nombre: "TIPO_FACTOR", columna: "tipo_factor", tipo: "opcion", obligatorio: true, opciones: ["Tasa", "Cuota", "Exento"], ejemplo: "Tasa", descripcion: "Tipo de factor como en el CFDI." },
    { nombre: "TASA", columna: "tasa", tipo: "decimal", minimo: 0, decimales: 6, ejemplo: "0.160000", descripcion: "Tasa o cuota (fracción: 16% = 0.160000). Vacía si es Exento." },
    { nombre: "DESCRIPCION", columna: "descripcion", tipo: "texto", obligatorio: true, max: 120, ejemplo: "IVA tasa general", descripcion: "Para qué se usa." },
    ACTIVO,
  ],
  validar(f, ayuda) {
    const tipo = actual(f, campo(tasas, "TIPO_FACTOR"));
    const tasa = actual(f, campo(tasas, "TASA"));
    if (tipo === "Exento" && tasa !== null) ayuda.error("TASA", "Para Exento la tasa va vacía.");
    if (tipo !== "Exento" && tasa === null) ayuda.error("TASA", "Falta la tasa o cuota.");
    if (tipo === "Tasa" && tasa !== null && new Decimal(tasa).gt(1)) ayuda.error("TASA", "Una tasa se escribe como fracción (16% = 0.160000).");
  },
};

const proveedores: Layout = {
  clave: "proveedores", secuencia: 10, grupo: "Terceros", nombre: "Proveedores",
  descripcion: "Proveedores con sus datos fiscales y condiciones de pago.",
  tabla: "proveedor", llave: ["CLAVE"],
  permisos: { ver: ["catalogos.proveedores:ver"], crear: ["catalogos.proveedores:crear"], editar: ["catalogos.proveedores:editar"], exportar: ["catalogos.proveedores:exportar"] },
  campos: [
    clave("PRUEBA-PROV-01"),
    RFC,
    { nombre: "RAZON_SOCIAL", columna: "razon_social", tipo: "texto", obligatorio: true, max: 250, ejemplo: "PRUEBA Harinas Ficticias SA de CV", descripcion: "Razón social como aparece en su constancia fiscal." },
    { nombre: "NOMBRE_COMERCIAL", columna: "nombre_comercial", tipo: "texto", max: 120, ejemplo: "Harinas Ficticias", descripcion: "Nombre comercial." },
    { nombre: "REGIMEN_FISCAL", columna: "regimen_fiscal", tipo: "sat", sat: "c_RegimenFiscal", max: 5, ejemplo: "601", descripcion: "Régimen fiscal (catálogo del SAT)." },
    CP,
    DIAS_CREDITO,
    { nombre: "CONDICIONES_PAGO", columna: "condiciones_pago", tipo: "texto", max: 200, ejemplo: "Transferencia a 15 días", descripcion: "Condiciones acordadas." },
    CORREO,
    TELEFONO,
    ACTIVO,
  ],
};

const clientes: Layout = {
  clave: "clientes", secuencia: 11, grupo: "Terceros", nombre: "Clientes",
  descripcion: "Clientes con sus datos para factura. No se guardan datos de tarjetas.",
  tabla: "cliente", llave: ["CLAVE"],
  permisos: { ver: ["catalogos.clientes:ver"], crear: ["catalogos.clientes:crear"], editar: ["catalogos.clientes:editar"], exportar: ["catalogos.clientes:editar"] },
  campos: [
    clave("PRUEBA-CLI-01"),
    RFC,
    { nombre: "RAZON_SOCIAL", columna: "razon_social", tipo: "texto", obligatorio: true, max: 250, ejemplo: "PRUEBA Cliente Ficticio", descripcion: "Nombre o razón social como en su constancia fiscal." },
    { nombre: "REGIMEN_FISCAL", columna: "regimen_fiscal", tipo: "sat", sat: "c_RegimenFiscal", max: 5, ejemplo: "612", descripcion: "Régimen fiscal del cliente." },
    CP,
    { nombre: "USO_CFDI", columna: "uso_cfdi", tipo: "sat", sat: "c_UsoCFDI", max: 5, ejemplo: "G03", descripcion: "Uso de CFDI habitual." },
    CORREO,
    TELEFONO,
    { nombre: "LIMITE_CREDITO", columna: "limite_credito", tipo: "decimal", minimo: 0, decimales: 2, porOmision: "0", ejemplo: "0", descripcion: "Límite de crédito (0 = sin crédito)." },
    DIAS_CREDITO,
    ACTIVO,
  ],
};

const camposArticulo = {
  vidaUtil: { nombre: "VIDA_UTIL_HORAS", columna: "vida_util_horas", tipo: "entero", minimo: 1, ejemplo: "24", descripcion: "Horas que dura en buen estado." } as Campo,
  condicion: { nombre: "CONDICION", columna: "condicion", tipo: "opcion", opciones: ["AMBIENTE", "REFRIGERADO", "CONGELADO"], ejemplo: "AMBIENTE", descripcion: "Condición de conservación." } as Campo,
  lote: { nombre: "MANEJA_LOTE", columna: "maneja_lote", tipo: "sino", porOmision: "NO", ejemplo: "SI", descripcion: "Se controla por lote." } as Campo,
};

const insumos: Layout = {
  clave: "insumos", secuencia: 12, grupo: "Artículos", nombre: "Materias primas, insumos y empaques (N0)",
  descripcion: "Lo que se compra: harinas, azúcar, mantequilla, huevo, rellenos, empaques.",
  tabla: "articulo", llave: ["CLAVE"], filtro: "t.tipo IN ('INSUMO', 'EMPAQUE')",
  permisos: { ver: ["catalogos.insumos:ver", "produccion.recetas:ver"], crear: ["catalogos.insumos:crear"], editar: ["catalogos.insumos:editar"], exportar: ["catalogos.insumos:exportar"] },
  notas: ["COSTO_REFERENCIA es por unidad base y solo lo ven los puestos con permiso de ver costos.", "Si UNIDAD_COMPRA o UNIDAD_RECETA se dejan vacías en un alta, se usa la UNIDAD_BASE."],
  campos: [
    clave("PRUEBA-HAR-01"),
    nombre("PRUEBA Harina de trigo"),
    { nombre: "TIPO", columna: "tipo", tipo: "opcion", obligatorio: true, soloAlta: true, opciones: ["INSUMO", "EMPAQUE"], ejemplo: "INSUMO", descripcion: "INSUMO o EMPAQUE." },
    { nombre: "FAMILIA", columna: "familia_id", tipo: "ref", ref: FAMILIA(["INSUMO", "EMPAQUE"]), ejemplo: "HARINAS", descripcion: "Familia." },
    { nombre: "UNIDAD_BASE", columna: "unidad_base_id", tipo: "ref", ref: UNIDAD, obligatorio: true, soloAlta: true, ejemplo: "KG", descripcion: "Unidad de almacén (en la que se lleva el inventario)." },
    { nombre: "UNIDAD_COMPRA", columna: "unidad_compra_id", tipo: "ref", ref: UNIDAD, ejemplo: "BULTO", descripcion: "Unidad en que se compra." },
    { nombre: "UNIDAD_RECETA", columna: "unidad_receta_id", tipo: "ref", ref: UNIDAD, ejemplo: "G", descripcion: "Unidad en que se escribe en las recetas." },
    { nombre: "COSTO_REFERENCIA", columna: "costo_referencia", tipo: "decimal", minimo: 0, decimales: 6, sensible: "datos.costos:ver", alertaCambio: true, ejemplo: "18.50", descripcion: "Costo por unidad base, de referencia hasta que existan compras." },
    { nombre: "PROVEEDOR_PREFERENTE", columna: "proveedor_preferente_id", tipo: "ref", ref: { tabla: "proveedor", etiqueta: "El proveedor" }, ejemplo: "PRUEBA-PROV-01", descripcion: "Proveedor habitual." },
    { nombre: "STOCK_MINIMO", columna: "stock_minimo", tipo: "decimal", minimo: 0, decimales: 4, ejemplo: "50", descripcion: "En unidad base." },
    { nombre: "STOCK_MAXIMO", columna: "stock_maximo", tipo: "decimal", minimo: 0, decimales: 4, ejemplo: "500", descripcion: "En unidad base." },
    { nombre: "PUNTO_REORDEN", columna: "punto_reorden", tipo: "decimal", minimo: 0, decimales: 4, ejemplo: "100", descripcion: "En unidad base: al bajar de aquí se sugiere comprar." },
    camposArticulo.lote,
    { nombre: "MANEJA_CADUCIDAD", columna: "maneja_caducidad", tipo: "sino", porOmision: "NO", ejemplo: "SI", descripcion: "Se controla la fecha de caducidad." },
    camposArticulo.vidaUtil,
    camposArticulo.condicion,
    ACTIVO,
  ],
  async preparar(c) {
    return { ...(await prepararUnidades(c)), familias: await prepararFamilias(c) };
  },
  validar(f, ayuda) {
    if (!f.existente) {
      for (const n of ["UNIDAD_COMPRA", "UNIDAD_RECETA"]) if (f.valores[n] === undefined && f.valores.UNIDAD_BASE) f.valores[n] = f.valores.UNIDAD_BASE;
    }
    validarExistencias(f, ayuda, insumos);
    validarUnidadesArticulo(insumos, f, ayuda, ["UNIDAD_COMPRA", "UNIDAD_RECETA"]);
    validarFamilia(insumos, f, ayuda, ayuda.datos.familias, actual(f, campo(insumos, "TIPO")));
  },
};

const intermedios: Layout = {
  clave: "intermedios", secuencia: 13, grupo: "Artículos", nombre: "Masas e intermedios (N1)",
  descripcion: "Lo que se prepara en producción y se usa en varios panes: masas, cubiertas, rellenos, betunes. Su fórmula, rendimiento y tamaño de lote se capturan en Recetas (Fase 2).",
  tabla: "articulo", llave: ["CLAVE"], filtro: "t.tipo = 'INTERMEDIO'", fijos: { tipo: "INTERMEDIO" },
  permisos: { ver: VER_ARTICULOS, crear: ["produccion.recetas:crear"], editar: ["produccion.recetas:editar"], exportar: ["produccion.recetas:exportar"] },
  campos: [
    clave("PRUEBA-MASA-01"),
    nombre("PRUEBA Masa de concha"),
    { nombre: "FAMILIA", columna: "familia_id", tipo: "ref", ref: FAMILIA(["INTERMEDIO"]), ejemplo: "MASAS", descripcion: "Familia." },
    { nombre: "UNIDAD_BASE", columna: "unidad_base_id", tipo: "ref", ref: UNIDAD, obligatorio: true, soloAlta: true, ejemplo: "KG", descripcion: "Unidad en que se lleva el inventario de la masa (normalmente KG)." },
    { nombre: "UNIDAD_RECETA", columna: "unidad_receta_id", tipo: "ref", ref: UNIDAD, ejemplo: "G", descripcion: "Unidad en que se usa dentro de las recetas de pan." },
    camposArticulo.vidaUtil,
    camposArticulo.condicion,
    { nombre: "SOBRANTE_REUTILIZABLE", columna: "sobrante_reutilizable", tipo: "sino", porOmision: "NO", ejemplo: "SI", descripcion: "SI si el sobrante se puede usar al día siguiente." },
    camposArticulo.lote,
    ACTIVO,
  ],
  async preparar(c) {
    return { ...(await prepararUnidades(c)), familias: await prepararFamilias(c) };
  },
  validar(f, ayuda) {
    if (!f.existente && f.valores.UNIDAD_RECETA === undefined) f.valores.UNIDAD_RECETA = f.valores.UNIDAD_BASE;
    validarUnidadesArticulo(intermedios, f, ayuda, ["UNIDAD_RECETA"]);
    validarFamilia(intermedios, f, ayuda, ayuda.datos.familias, "INTERMEDIO");
  },
};

const productos: Layout = {
  clave: "productos", secuencia: 14, grupo: "Artículos", nombre: "Productos terminados (SKU, N2)",
  descripcion: "Lo que se vende. Los datos fiscales los captura el negocio con su contador; el sistema no asigna tasas por omisión. El precio se carga en \"Precios de venta\" (requiere autorización).",
  tabla: "articulo", llave: ["CLAVE"], filtro: "t.tipo = 'SKU'", fijos: { tipo: "SKU" },
  permisos: { ver: ["catalogos.sku:ver"], crear: ["catalogos.sku:crear"], editar: ["catalogos.sku:editar"], exportar: ["catalogos.sku:exportar", "catalogos.sku:editar"] },
  notas: ["Si falta algún dato fiscal, el producto se guarda pero queda marcado con datos fiscales incompletos: no se podrá facturar."],
  campos: [
    clave("PRUEBA-CONCHA"),
    nombre("PRUEBA Concha de vainilla"),
    { nombre: "CODIGO_BARRAS", columna: "codigo_barras", tipo: "texto", max: 30, patron: /^[0-9A-Z-]+$/, patronTexto: "números o letras sin espacios", ejemplo: "7500000000017", descripcion: "Código de barras (opcional)." },
    { nombre: "FAMILIA", columna: "familia_id", tipo: "ref", ref: FAMILIA(["SKU"]), ejemplo: "PAN-DULCE", descripcion: "Familia." },
    { nombre: "UNIDAD_VENTA", columna: "unidad_base_id", tipo: "ref", ref: UNIDAD, obligatorio: true, soloAlta: true, ejemplo: "PZA", descripcion: "Unidad de venta e inventario (PZA, o KG si se vende a granel)." },
    camposArticulo.vidaUtil,
    camposArticulo.condicion,
    { nombre: "SOBRANTE_REUTILIZABLE", columna: "sobrante_reutilizable", tipo: "sino", porOmision: "NO", ejemplo: "NO", descripcion: "SI si el pan no vendido se reaprovecha." },
    { nombre: "CLAVE_PROD_SERV", columna: "clave_prod_serv", tipo: "sat", sat: "c_ClaveProdServ", max: 10, ejemplo: "50181900", descripcion: "Clave de producto o servicio del SAT." },
    { nombre: "CLAVE_UNIDAD_SAT", columna: "clave_unidad_sat", tipo: "sat", sat: "c_ClaveUnidad", max: 10, ejemplo: "H87", descripcion: "Clave de unidad del SAT." },
    { nombre: "OBJETO_IMPUESTO", columna: "objeto_impuesto", tipo: "sat", sat: "c_ObjetoImp", max: 3, ejemplo: "02", descripcion: "Objeto de impuesto (catálogo del SAT)." },
    { nombre: "TASA_IVA", columna: "tasa_iva_id", tipo: "ref", ref: { tabla: "tasa_impuesto", etiqueta: "La tasa", filtro: "r.impuesto = 'IVA'" }, ejemplo: "IVA-GENERAL", descripcion: "Clave de la tasa de IVA (catálogo de tasas)." },
    { nombre: "TASA_IEPS", columna: "tasa_ieps_id", tipo: "ref", ref: { tabla: "tasa_impuesto", etiqueta: "La tasa", filtro: "r.impuesto = 'IEPS'" }, ejemplo: "", descripcion: "Clave de la tasa de IEPS, si aplica." },
    ACTIVO,
  ],
  async preparar(c, filas) {
    const codigos = filas.map((f) => f.valores.CODIGO_BARRAS).filter((v): v is string => typeof v === "string");
    const usados = new Map((await c.query("SELECT codigo_barras, clave FROM articulo WHERE codigo_barras = ANY($1)", [codigos])).rows.map((x) => [x.codigo_barras as string, x.clave as string]));
    return { familias: await prepararFamilias(c), usados, enArchivo: new Map<string, number>() };
  },
  validar(f, ayuda) {
    validarFamilia(productos, f, ayuda, ayuda.datos.familias, "SKU");
    const cb = f.valores.CODIGO_BARRAS as string | undefined;
    if (cb) {
      const dueño = ayuda.datos.usados.get(cb);
      if (dueño && dueño !== f.valores.CLAVE) ayuda.error("CODIGO_BARRAS", `El código de barras ya lo tiene ${dueño}.`);
      const previo = ayuda.datos.enArchivo.get(cb);
      if (previo) ayuda.error("CODIGO_BARRAS", `El código de barras se repite en el renglón ${previo}.`);
      ayuda.datos.enArchivo.set(cb, f.renglon);
    }
    const fiscales = ["CLAVE_PROD_SERV", "CLAVE_UNIDAD_SAT", "OBJETO_IMPUESTO"].filter((n) => actual(f, campo(productos, n)) === null);
    if (fiscales.length) ayuda.advertencia(fiscales[0]!, `Datos fiscales incompletos (${fiscales.join(", ")}): no se podrá facturar hasta completarlos.`);
  },
};

const unidadesArticulo: Layout = {
  clave: "unidades_articulo", secuencia: 15, grupo: "Artículos", nombre: "Unidades por artículo",
  descripcion: "Unidades que dependen del artículo: 1 UNIDAD = FACTOR_A_BASE unidades base del artículo (ej. 1 BULTO de harina = 25 KG; 1 PZA de huevo = 0.06 KG).",
  tabla: "articulo_unidad", llave: ["ARTICULO", "UNIDAD"],
  orden: "(SELECT clave FROM articulo a WHERE a.id = t.articulo_id), (SELECT clave FROM unidad u WHERE u.id = t.unidad_id)",
  permisos: { ver: VER_ARTICULOS, crear: ["catalogos.insumos:crear", "catalogos.sku:crear", "produccion.recetas:crear"], editar: ["catalogos.insumos:editar", "catalogos.sku:editar", "produccion.recetas:editar"], exportar: ["catalogos.insumos:exportar", "produccion.recetas:exportar"] },
  campos: [
    { nombre: "ARTICULO", columna: "articulo_id", tipo: "ref", ref: { tabla: "articulo", etiqueta: "El artículo" }, obligatorio: true, ejemplo: "PRUEBA-HAR-01", descripcion: "Clave del artículo." },
    { nombre: "UNIDAD", columna: "unidad_id", tipo: "ref", ref: UNIDAD, obligatorio: true, ejemplo: "BULTO", descripcion: "Unidad alterna." },
    { nombre: "FACTOR_A_BASE", columna: "factor_a_base", tipo: "decimal", obligatorio: true, mayorQueCero: true, decimales: 10, alertaCambio: true, ejemplo: "25", descripcion: "Cuántas unidades base hay en 1 UNIDAD." },
    ACTIVO,
  ],
  async preparar(c, filas) {
    const ids = filas.map((f) => f.valores.ARTICULO).filter(Boolean);
    return new Map((await c.query("SELECT a.id::text, a.clave, u.id::text AS base_id, u.clave AS base FROM articulo a JOIN unidad u ON u.id = a.unidad_base_id WHERE a.id = ANY($1::uuid[])", [ids])).rows.map((x) => [x.id as string, x]));
  },
  validar(f, ayuda) {
    const a = ayuda.datos.get(f.valores.ARTICULO);
    if (a && a.base_id === f.valores.UNIDAD) ayuda.error("UNIDAD", `${a.base} ya es la unidad base de ${a.clave}.`);
  },
};

const articulosProveedor: Layout = {
  clave: "articulos_proveedor", secuencia: 16, grupo: "Terceros", nombre: "Artículos por proveedor",
  descripcion: "Qué proveedor surte qué insumo, con la clave que usa el proveedor.",
  tabla: "articulo_proveedor", llave: ["ARTICULO", "PROVEEDOR"],
  orden: "(SELECT clave FROM articulo a WHERE a.id = t.articulo_id), (SELECT clave FROM proveedor p WHERE p.id = t.proveedor_id)",
  permisos: { ver: ["catalogos.proveedores:ver"], crear: ["catalogos.proveedores:crear"], editar: ["catalogos.proveedores:editar"], exportar: ["catalogos.proveedores:exportar"] },
  campos: [
    { nombre: "ARTICULO", columna: "articulo_id", tipo: "ref", ref: { tabla: "articulo", etiqueta: "El insumo", filtro: "r.tipo IN ('INSUMO', 'EMPAQUE')" }, obligatorio: true, ejemplo: "PRUEBA-HAR-01", descripcion: "Clave del insumo o empaque." },
    { nombre: "PROVEEDOR", columna: "proveedor_id", tipo: "ref", ref: { tabla: "proveedor", etiqueta: "El proveedor" }, obligatorio: true, ejemplo: "PRUEBA-PROV-01", descripcion: "Clave del proveedor." },
    { nombre: "CLAVE_PROVEEDOR", columna: "clave_proveedor", tipo: "texto", max: 60, ejemplo: "HT-25", descripcion: "Clave del artículo en el catálogo del proveedor." },
    { nombre: "UNIDAD_COMPRA", columna: "unidad_compra_id", tipo: "ref", ref: UNIDAD, ejemplo: "BULTO", descripcion: "Unidad en que lo vende ese proveedor." },
    { nombre: "ULTIMO_PRECIO", columna: "ultimo_precio", tipo: "decimal", minimo: 0, decimales: 6, sensible: "datos.costos:ver", alertaCambio: true, ejemplo: "462.50", descripcion: "Último precio por unidad de compra (se actualizará solo con las compras)." },
    ACTIVO,
  ],
};

const precios: Layout = {
  clave: "precios", secuencia: 17, grupo: "Ventas", nombre: "Precios de venta",
  descripcion: "Precio de cada SKU con fecha de inicio de vigencia, para todas las sucursales (SUCURSAL vacía) o para una en particular. Un precio nuevo cierra la vigencia del anterior; el historial no se borra.",
  tabla: "precio_venta", llave: ["ARTICULO", "SUCURSAL", "VIGENTE_DESDE"], autorizacion: { permiso: "catalogos.precios:autorizar" },
  orden: "(SELECT clave FROM articulo a WHERE a.id = t.articulo_id), (SELECT clave FROM sucursal s WHERE s.id = t.sucursal_id) NULLS FIRST, t.vigente_desde",
  permisos: { ver: ["catalogos.precios:ver"], crear: ["catalogos.precios:crear"], editar: ["catalogos.precios:editar"], exportar: ["catalogos.precios:exportar"] },
  notas: ["Un precio ya vigente no se corrige: se captura uno nuevo con otra fecha de inicio.", "El precio es el precio al público CON impuestos incluidos (decisión del negocio); al vender y facturar los impuestos se desglosan del precio."],
  campos: [
    { nombre: "ARTICULO", columna: "articulo_id", tipo: "ref", ref: { tabla: "articulo", etiqueta: "El producto", filtro: "r.tipo = 'SKU'" }, obligatorio: true, ejemplo: "PRUEBA-CONCHA", descripcion: "Clave del SKU." },
    { nombre: "SUCURSAL", columna: "sucursal_id", tipo: "ref", ref: { tabla: "sucursal", etiqueta: "La sucursal" }, ejemplo: "", descripcion: "Vacía = todas las sucursales." },
    { nombre: "PRECIO", columna: "precio", tipo: "decimal", obligatorio: true, minimo: 0, decimales: 2, ejemplo: "14.50", descripcion: "Precio al público con impuestos incluidos." },
    { nombre: "VIGENTE_DESDE", columna: "vigente_desde", tipo: "fecha", obligatorio: true, ejemplo: "01/12/2026", descripcion: "Primer día en que aplica." },
  ],
  async preparar(c, filas) {
    const zona = (await c.query("SELECT valor FROM configuracion WHERE clave = 'general.zona_horaria'")).rows[0]?.valor ?? "America/Mexico_City";
    const hoy = (await c.query("SELECT (now() AT TIME ZONE $1)::date::text AS hoy", [zona])).rows[0].hoy as string;
    const ids = filas.map((f) => f.valores.ARTICULO).filter(Boolean);
    const vigentes = (await c.query(
      `SELECT articulo_id::text, coalesce(sucursal_id::text, '') AS suc, precio::text, vigente_desde::text
         FROM precio_venta WHERE articulo_id = ANY($1::uuid[]) ORDER BY vigente_desde`,
      [ids],
    )).rows;
    const pct = Number((await c.query("SELECT valor FROM configuracion WHERE clave = 'cargas.alerta_cambio_costo_pct'")).rows[0]?.valor ?? 10);
    return { hoy, vigentes, pct };
  },
  validar(f, ayuda) {
    const { hoy, vigentes, pct } = ayuda.datos;
    const desde = f.valores.VIGENTE_DESDE as string;
    if (f.existente && desde <= hoy) return ayuda.error("VIGENTE_DESDE", "Ese precio ya está vigente o es histórico: no se corrige, captura uno nuevo con otra fecha.");
    if (!f.existente && desde < hoy) return ayuda.error("VIGENTE_DESDE", "La vigencia no puede empezar antes de hoy.");
    const previos = vigentes.filter((v: any) => v.articulo_id === f.valores.ARTICULO && v.suc === (f.valores.SUCURSAL ?? "") && v.vigente_desde < desde);
    const anterior = previos[previos.length - 1];
    if (anterior && f.valores.PRECIO !== undefined && !new Decimal(anterior.precio).isZero()) {
      const cambio = new Decimal(String(f.valores.PRECIO)).minus(anterior.precio).abs().div(anterior.precio).mul(100);
      if (cambio.gt(pct)) ayuda.advertencia("PRECIO", `Cambia ${cambio.toDecimalPlaces(1).toFixed()}% contra el precio anterior (${anterior.precio}).`);
    }
  },
  async despues(c, filas) {
    // Recalcula el fin de vigencia de cada historial tocado: termina un día antes del siguiente precio.
    const pares = filas.map((f) => ({ a: f.valores.ARTICULO, s: f.valores.SUCURSAL ?? null }));
    await c.query(
      `WITH tocados AS (SELECT DISTINCT (x->>'a')::uuid AS a, (x->>'s')::uuid AS s FROM jsonb_array_elements($1::jsonb) x),
            sig AS (
              SELECT p.id, lead(p.vigente_desde) OVER (PARTITION BY p.articulo_id, p.sucursal_id ORDER BY p.vigente_desde) - 1 AS hasta
                FROM precio_venta p JOIN tocados t ON t.a = p.articulo_id AND t.s IS NOT DISTINCT FROM p.sucursal_id)
       UPDATE precio_venta p SET vigente_hasta = sig.hasta FROM sig
        WHERE p.id = sig.id AND p.vigente_hasta IS DISTINCT FROM sig.hasta`,
      [JSON.stringify(pares)],
    );
  },
};

const cuentas: Layout = {
  clave: "cuentas", secuencia: 18, grupo: "Contabilidad", nombre: "Catálogo de cuentas",
  descripcion: "Cuentas contables con su código agrupador del SAT. Una subcuenta indica su CUENTA_PADRE y tiene un nivel más que ella. Las reglas de contabilización se capturan cuando existan las primeras operaciones (Fase 3).",
  tabla: "cuenta_contable", llave: ["CUENTA"],
  permisos: { ver: ["contabilidad.catalogo:ver"], crear: ["contabilidad.catalogo:crear"], editar: ["contabilidad.catalogo:editar"], exportar: ["contabilidad.catalogo:exportar"] },
  campos: [
    { nombre: "CUENTA", columna: "clave", tipo: "texto", obligatorio: true, max: 30, patron: /^[0-9][0-9.-]*$/, patronTexto: "números separados por punto o guion", ejemplo: "1101-001", descripcion: "Número de cuenta." },
    nombre("Caja general"),
    { nombre: "NATURALEZA", columna: "naturaleza", tipo: "opcion", obligatorio: true, opciones: ["DEUDORA", "ACREEDORA"], ejemplo: "DEUDORA", descripcion: "Naturaleza." },
    { nombre: "NIVEL", columna: "nivel", tipo: "entero", obligatorio: true, minimo: 1, maximo: 9, ejemplo: "2", descripcion: "1 = cuenta de mayor." },
    { nombre: "CUENTA_PADRE", columna: "cuenta_padre", tipo: "texto", max: 30, patron: /^[0-9][0-9.-]*$/, patronTexto: "número de una cuenta existente o del mismo archivo", ejemplo: "1101", descripcion: "Cuenta de la que depende (vacía en nivel 1)." },
    { nombre: "CODIGO_AGRUPADOR", columna: "codigo_agrupador", tipo: "sat", sat: "c_CodigoAgrupador", max: 10, ejemplo: "101.01", descripcion: "Código agrupador del SAT (contabilidad electrónica)." },
    { nombre: "AFECTABLE", columna: "afectable", tipo: "sino", porOmision: "SI", ejemplo: "SI", descripcion: "SI si recibe movimientos (las cuentas de mayor con subcuentas van en NO)." },
    ACTIVO,
  ],
  async preparar(c, filas) {
    const base = new Map((await c.query("SELECT clave, nivel FROM cuenta_contable")).rows.map((x) => [x.clave as string, Number(x.nivel)]));
    for (const f of filas) if (f.valores.NIVEL !== undefined) base.set(f.valores.CUENTA as string, Number(f.valores.NIVEL));
    return base;
  },
  validar(f, ayuda) {
    const nivel = Number(actual(f, campo(cuentas, "NIVEL")));
    const padre = actual(f, campo(cuentas, "CUENTA_PADRE"));
    if (padre === f.valores.CUENTA) return ayuda.error("CUENTA_PADRE", "Una cuenta no puede depender de sí misma.");
    if (nivel === 1 && padre) return ayuda.error("CUENTA_PADRE", "Una cuenta de nivel 1 no tiene cuenta padre.");
    if (nivel > 1 && !padre) return ayuda.error("CUENTA_PADRE", "Falta la cuenta padre (el nivel es mayor que 1).");
    if (padre) {
      const nivelPadre = ayuda.datos.get(padre);
      if (nivelPadre === undefined) ayuda.error("CUENTA_PADRE", `La cuenta padre ${padre} no existe ni viene en el archivo.`);
      else if (nivelPadre !== nivel - 1) ayuda.error("NIVEL", `El nivel debe ser ${nivelPadre + 1} (un nivel más que su cuenta padre ${padre}).`);
    }
  },
};

export const LAYOUTS: Layout[] = [
  satCatalogo, unidades, conversiones, familias, centrosCosto, sucursales, almacenes, cajas, tasas,
  proveedores, clientes, insumos, intermedios, productos, unidadesArticulo, articulosProveedor, precios, cuentas,
].sort((a, b) => a.secuencia - b.secuencia);

export function buscarLayout(clave: string): Layout | undefined {
  return LAYOUTS.find((l) => l.clave === clave);
}
