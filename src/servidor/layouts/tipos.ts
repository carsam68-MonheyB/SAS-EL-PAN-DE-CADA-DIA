// Definición declarativa de un layout. Cada catálogo describe sus campos una
// sola vez y de ahí salen: la plantilla, las instrucciones, la validación, la
// carga, la exportación y el formulario de captura en pantalla.
import type { Cliente } from "../transaccion";

export type TipoCampo = "texto" | "entero" | "decimal" | "fecha" | "sino" | "opcion" | "ref" | "sat";

export type CatalogoSat = "c_ClaveProdServ" | "c_ClaveUnidad" | "c_ObjetoImp" | "c_RegimenFiscal" | "c_UsoCFDI" | "c_FormaPago" | "c_CodigoAgrupador";
export const CATALOGOS_SAT: CatalogoSat[] = ["c_ClaveProdServ", "c_ClaveUnidad", "c_ObjetoImp", "c_RegimenFiscal", "c_UsoCFDI", "c_FormaPago", "c_CodigoAgrupador"];

export interface Referencia {
  tabla: string;
  /** Qué catálogo es, para los mensajes ("la unidad", "el proveedor"). */
  etiqueta: string;
  /** Condición extra sobre el alias r (ej. "r.tipo IN ('INSUMO','EMPAQUE')"). */
  filtro?: string;
  /** Qué se guarda en la columna: el id (por omisión) o la clave misma. */
  guarda?: "id" | "clave";
}

export interface Campo {
  /** Encabezado en el archivo (MAYÚSCULAS_CON_GUION_BAJO). */
  nombre: string;
  /** Columna de la tabla donde se guarda. */
  columna: string;
  tipo: TipoCampo;
  descripcion: string;
  ejemplo: string;
  obligatorio?: boolean;
  max?: number;
  patron?: RegExp;
  patronTexto?: string;
  mayusculas?: boolean;
  decimales?: number;
  minimo?: number;
  maximo?: number;
  mayorQueCero?: boolean;
  opciones?: string[];
  ref?: Referencia;
  sat?: CatalogoSat;
  /** Valor (como se escribiría en el archivo) que toma en un alta si viene vacío. */
  porOmision?: string;
  /** Permiso necesario para ver o capturar el campo (ej. costos). */
  sensible?: string;
  /** No se puede cambiar una vez dado de alta. */
  soloAlta?: boolean;
  /** Avisar si el valor cambia más del % configurado (costos). */
  alertaCambio?: boolean;
}

export interface Mensaje {
  renglon: number;
  campo: string;
  severidad: "error" | "advertencia";
  mensaje: string;
}

export interface FilaValidada {
  renglon: number;
  celdas: Record<string, string>;
  /** Valores listos para la base, por nombre de campo (null = vacío). */
  valores: Record<string, unknown>;
  /** Campos que traían algo escrito. */
  presentes: Set<string>;
  accion: "alta" | "actualizacion" | "sin_cambios" | "error";
  /** Renglón actual en la base (todos los valores como texto). */
  existente: Record<string, string | null> | null;
  id: string | null;
}

export interface Ayuda {
  error(campo: string, mensaje: string): void;
  advertencia(campo: string, mensaje: string): void;
  /** Datos que el layout preparó para toda la carga (ver Layout.preparar). */
  datos: any;
  cliente: Cliente;
}

export interface Layout {
  clave: string;
  nombre: string;
  grupo: string;
  descripcion: string;
  tabla: string;
  /** Campos que identifican el registro (para actualizar). */
  llave: string[];
  campos: Campo[];
  permisos: { ver: string[]; crear: string[]; editar: string[]; exportar?: string[] };
  /** Si existe, la carga queda pendiente hasta que alguien con este permiso la autorice. */
  autorizacion?: { permiso: string };
  /** Restringe la tabla a los registros de este layout (alias t). */
  filtro?: string;
  /** Al buscar la llave, ignora los registros fuera del filtro (ej. planes cancelados). */
  llaveEnFiltro?: boolean;
  /** Columnas fijas en un alta (ej. { tipo: "SKU" }). */
  fijos?: Record<string, unknown>;
  orden?: string;
  notas?: string[];
  /** Orden sugerido de carga (para la pantalla). */
  secuencia: number;
  /** Prepara datos para validar toda la carga (consultas en lote). */
  preparar?(c: Cliente, filas: FilaValidada[]): Promise<unknown>;
  /** Reglas entre campos del mismo renglón o contra la base. */
  validar?(f: FilaValidada, ayuda: Ayuda): void | Promise<void>;
  /** Solo actualización permitida si la regla lo dice (ej. precios ya vigentes). */
  despues?(c: Cliente, filas: FilaValidada[], cargaId: string | null): Promise<void>;
  /** Modos permitidos (por omisión todos). */
  modos?: ("alta" | "actualizacion" | "ambos")[];
}
