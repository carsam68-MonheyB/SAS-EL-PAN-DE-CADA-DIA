// Layouts de la Fase 7: reglas de contabilización (a qué cuenta va cada concepto
// que generan las operaciones, en general o por sucursal). Las cuentas las define
// el negocio con su contador; el sistema no supone ninguna.
import type { Layout } from "./tipos";

const reglasContables: Layout = {
  clave: "reglas_contables", secuencia: 70, grupo: "Contabilidad", nombre: "Reglas de contabilización",
  descripcion: "Cuenta contable de cada concepto que generan las operaciones (ventas, inventarios, producción, compras). SUCURSAL vacía = todas; una regla de sucursal tiene preferencia.",
  tabla: "regla_contable", llave: ["CONCEPTO", "SUCURSAL"],
  permisos: { ver: ["contabilidad.catalogo:ver"], crear: ["contabilidad.catalogo:crear"], editar: ["contabilidad.catalogo:editar"], exportar: ["contabilidad.catalogo:exportar"] },
  campos: [
    { nombre: "CONCEPTO", columna: "concepto_id", tipo: "ref", ref: { tabla: "concepto_contable", etiqueta: "El concepto" }, obligatorio: true, soloAlta: true, ejemplo: "CAJA_EFECTIVO", descripcion: "Concepto contable (lista en la hoja Listas o en Contabilidad → Reglas)." },
    { nombre: "SUCURSAL", columna: "sucursal_id", tipo: "ref", ref: { tabla: "sucursal", etiqueta: "La sucursal" }, soloAlta: true, ejemplo: "", descripcion: "Vacía = todas las sucursales." },
    { nombre: "CUENTA", columna: "cuenta_id", tipo: "ref", ref: { tabla: "cuenta_contable", etiqueta: "La cuenta", filtro: "r.afectable" }, obligatorio: true, ejemplo: "1101-001", descripcion: "Cuenta afectable del catálogo de cuentas." },
    { nombre: "ACTIVO", columna: "activo", tipo: "sino", porOmision: "SI", ejemplo: "SI", descripcion: "NO = deja de usarse." },
  ],
};

export const LAYOUTS_CONTABILIDAD: Layout[] = [reglasContables];
