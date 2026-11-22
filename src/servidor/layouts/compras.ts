// Layouts de la Fase 4: cuentas bancarias de la empresa para registrar pagos.
// Solo se guardan banco, alias y los últimos 4 dígitos (nunca la cuenta completa ni la CLABE).
import type { Layout } from "./tipos";

const cuentasBancarias: Layout = {
  clave: "cuentas_bancarias", secuencia: 32, grupo: "Compras", nombre: "Cuentas bancarias",
  descripcion: "Cuentas de la empresa desde las que se pagan proveedores (pregunta P42). Solo banco, alias y terminación (últimos 4 dígitos).",
  tabla: "cuenta_bancaria", llave: ["CLAVE"],
  permisos: { ver: ["compras.cxp:ver"], crear: ["compras.cxp:crear"], editar: ["compras.cxp:editar"] },
  campos: [
    { nombre: "CLAVE", columna: "clave", tipo: "texto", obligatorio: true, mayusculas: true, max: 20, patron: /^[A-Z0-9-]+$/, patronTexto: "solo letras sin acento, números y guion (-)", ejemplo: "PRUEBA-BANCO-1", descripcion: "Clave de la cuenta." },
    { nombre: "BANCO", columna: "banco", tipo: "texto", obligatorio: true, max: 60, ejemplo: "PRUEBA Banco", descripcion: "Nombre del banco." },
    { nombre: "ALIAS", columna: "alias", tipo: "texto", obligatorio: true, max: 60, ejemplo: "Cuenta de proveedores", descripcion: "Nombre corto para reconocerla." },
    { nombre: "TERMINACION", columna: "terminacion", tipo: "texto", obligatorio: true, patron: /^[0-9]{4}$/, patronTexto: "exactamente 4 dígitos", ejemplo: "1234", descripcion: "Últimos 4 dígitos de la cuenta." },
    { nombre: "ACTIVO", columna: "activo", tipo: "sino", porOmision: "SI", ejemplo: "SI", descripcion: "NO = dada de baja." },
  ],
};

export const LAYOUTS_COMPRAS: Layout[] = [cuentasBancarias];
