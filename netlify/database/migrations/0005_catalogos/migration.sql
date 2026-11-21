-- =============================================================================
-- 0005 · Catálogos maestros y bitácora de cargas por layout (Fase 1B)
-- -----------------------------------------------------------------------------
-- Reglas:
--  * Nada se borra: los catálogos se dan de baja con activo = false.
--  * Todo cambio queda en bitacora_auditoria (antes / después, quién y cuándo).
--  * Ningún valor de negocio viene precargado: tasas, familias, unidades,
--    cuentas y catálogos del SAT se cargan por layout o por pantalla.
-- =============================================================================

-- Columnas comunes de control (se repiten para que cada tabla sea explícita).
-- creado_en / creado_por / actualizado_en / actualizado_por

-- ---------------------------------------------------------------------------
-- Catálogos del SAT (se cargan desde el archivo oficial del SAT por layout)
-- ---------------------------------------------------------------------------
CREATE TABLE sat_catalogo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogo        text NOT NULL CHECK (catalogo IN ('c_ClaveProdServ', 'c_ClaveUnidad', 'c_ObjetoImp', 'c_RegimenFiscal', 'c_UsoCFDI', 'c_FormaPago', 'c_CodigoAgrupador')),
  clave           text NOT NULL CHECK (clave ~ '^[A-Za-z0-9.\-]{1,20}$'),
  descripcion     text NOT NULL,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  UNIQUE (catalogo, clave)
);

-- ---------------------------------------------------------------------------
-- Unidades y conversiones generales (ej. 1 KG = 1000 G)
-- ---------------------------------------------------------------------------
CREATE TABLE unidad (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,15}$'),
  nombre          text NOT NULL,
  magnitud        text NOT NULL CHECK (magnitud IN ('MASA', 'VOLUMEN', 'PIEZA', 'LONGITUD', 'OTRA')),
  clave_sat       text,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);

CREATE TABLE conversion_unidad (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  de_unidad_id    uuid NOT NULL REFERENCES unidad (id),
  a_unidad_id     uuid NOT NULL REFERENCES unidad (id),
  factor          numeric(24, 10) NOT NULL CHECK (factor > 0),   -- 1 de_unidad = factor a_unidad
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  CHECK (de_unidad_id <> a_unidad_id),
  UNIQUE (de_unidad_id, a_unidad_id)
);

-- ---------------------------------------------------------------------------
-- Familias, centros de costo
-- ---------------------------------------------------------------------------
CREATE TABLE familia (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,30}$'),
  nombre          text NOT NULL,
  aplica_a        text NOT NULL CHECK (aplica_a IN ('INSUMO', 'EMPAQUE', 'INTERMEDIO', 'SKU', 'TODOS')),
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);

CREATE TABLE centro_costo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,20}$'),
  nombre          text NOT NULL,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);

ALTER TABLE almacen ADD COLUMN centro_costo_id uuid REFERENCES centro_costo (id);

-- ---------------------------------------------------------------------------
-- Tasas de impuesto (las captura el negocio con su contador; sin valores por omisión)
-- ---------------------------------------------------------------------------
CREATE TABLE tasa_impuesto (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,20}$'),
  impuesto        text NOT NULL CHECK (impuesto IN ('IVA', 'IEPS')),
  tipo_factor     text NOT NULL CHECK (tipo_factor IN ('Tasa', 'Cuota', 'Exento')),
  tasa            numeric(12, 6) CHECK (tasa >= 0),
  descripcion     text NOT NULL,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  CHECK ((tipo_factor = 'Exento') = (tasa IS NULL))
);

-- ---------------------------------------------------------------------------
-- Proveedores y clientes
-- ---------------------------------------------------------------------------
CREATE TABLE proveedor (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave            text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,30}$'),
  rfc              text NOT NULL CHECK (rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  razon_social     text NOT NULL,
  nombre_comercial text,
  regimen_fiscal   text,
  codigo_postal    text CHECK (codigo_postal ~ '^[0-9]{5}$'),
  dias_credito     integer NOT NULL DEFAULT 0 CHECK (dias_credito >= 0),
  condiciones_pago text,
  correo           text,
  telefono         text,
  activo           boolean NOT NULL DEFAULT true,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid
);

CREATE TABLE cliente (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave            text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,30}$'),
  rfc              text NOT NULL CHECK (rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  razon_social     text NOT NULL,
  regimen_fiscal   text,
  codigo_postal    text CHECK (codigo_postal ~ '^[0-9]{5}$'),
  uso_cfdi         text,
  correo           text,
  telefono         text,
  limite_credito   numeric(14, 2) NOT NULL DEFAULT 0 CHECK (limite_credito >= 0),
  dias_credito     integer NOT NULL DEFAULT 0 CHECK (dias_credito >= 0),
  activo           boolean NOT NULL DEFAULT true,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid
);

-- ---------------------------------------------------------------------------
-- Artículos: insumos y empaques (N0), intermedios/masas (N1) y SKU (N2)
-- ---------------------------------------------------------------------------
CREATE TABLE articulo (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave                 text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,30}$'),
  nombre                text NOT NULL,
  tipo                  text NOT NULL CHECK (tipo IN ('INSUMO', 'EMPAQUE', 'INTERMEDIO', 'SKU')),
  familia_id            uuid REFERENCES familia (id),
  unidad_base_id        uuid NOT NULL REFERENCES unidad (id),   -- unidad de almacén (y de venta en SKU)
  unidad_compra_id      uuid REFERENCES unidad (id),
  unidad_receta_id      uuid REFERENCES unidad (id),
  codigo_barras         text UNIQUE,
  costo_referencia      numeric(18, 6) CHECK (costo_referencia >= 0),  -- por unidad base; dato sensible
  proveedor_preferente_id uuid REFERENCES proveedor (id),
  stock_minimo          numeric(18, 4) CHECK (stock_minimo >= 0),
  stock_maximo          numeric(18, 4) CHECK (stock_maximo >= 0),
  punto_reorden         numeric(18, 4) CHECK (punto_reorden >= 0),
  maneja_lote           boolean NOT NULL DEFAULT false,
  maneja_caducidad      boolean NOT NULL DEFAULT false,
  vida_util_horas       integer CHECK (vida_util_horas > 0),
  condicion             text CHECK (condicion IN ('AMBIENTE', 'REFRIGERADO', 'CONGELADO')),
  sobrante_reutilizable boolean NOT NULL DEFAULT false,
  -- Datos fiscales (SKU). Los captura el negocio con su contador.
  clave_prod_serv       text,
  clave_unidad_sat      text,
  objeto_impuesto       text,
  tasa_iva_id           uuid REFERENCES tasa_impuesto (id),
  tasa_ieps_id          uuid REFERENCES tasa_impuesto (id),
  activo                boolean NOT NULL DEFAULT true,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  creado_por            uuid DEFAULT usuario_actual(),
  actualizado_en        timestamptz,
  actualizado_por       uuid,
  CHECK (stock_minimo IS NULL OR stock_maximo IS NULL OR stock_minimo <= stock_maximo)
);
CREATE INDEX articulo_tipo ON articulo (tipo);

-- Unidades propias de un artículo (ej. 1 BULTO de harina = 25 KG; 1 PZA de huevo = 0.06 KG)
CREATE TABLE articulo_unidad (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id     uuid NOT NULL REFERENCES articulo (id),
  unidad_id       uuid NOT NULL REFERENCES unidad (id),
  factor_a_base   numeric(24, 10) NOT NULL CHECK (factor_a_base > 0),  -- 1 unidad = factor unidades base
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  UNIQUE (articulo_id, unidad_id)
);

-- Qué proveedor surte qué artículo
CREATE TABLE articulo_proveedor (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id      uuid NOT NULL REFERENCES articulo (id),
  proveedor_id     uuid NOT NULL REFERENCES proveedor (id),
  clave_proveedor  text,
  unidad_compra_id uuid REFERENCES unidad (id),
  ultimo_precio    numeric(18, 6) CHECK (ultimo_precio >= 0),   -- dato sensible (costos)
  activo           boolean NOT NULL DEFAULT true,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid,
  UNIQUE (articulo_id, proveedor_id)
);

-- ---------------------------------------------------------------------------
-- Precios de venta con vigencia. Un precio nuevo cierra el anterior; nunca se borra.
-- ---------------------------------------------------------------------------
CREATE TABLE precio_venta (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id     uuid NOT NULL REFERENCES articulo (id),
  sucursal_id     uuid REFERENCES sucursal (id),          -- NULL = todas las sucursales
  precio          numeric(14, 2) NOT NULL CHECK (precio >= 0),
  vigente_desde   date NOT NULL,
  vigente_hasta   date,
  carga_id        uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);
CREATE UNIQUE INDEX precio_venta_unico
  ON precio_venta (articulo_id, coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid), vigente_desde);

-- ---------------------------------------------------------------------------
-- Catálogo de cuentas contables (con código agrupador del SAT)
-- ---------------------------------------------------------------------------
CREATE TABLE cuenta_contable (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave             text NOT NULL UNIQUE CHECK (clave ~ '^[0-9][0-9.-]{0,29}$'),
  nombre            text NOT NULL,
  naturaleza        text NOT NULL CHECK (naturaleza IN ('DEUDORA', 'ACREEDORA')),
  nivel             integer NOT NULL CHECK (nivel BETWEEN 1 AND 9),
  cuenta_padre      text REFERENCES cuenta_contable (clave),
  codigo_agrupador  text,
  afectable         boolean NOT NULL DEFAULT true,
  activo            boolean NOT NULL DEFAULT true,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  creado_por        uuid DEFAULT usuario_actual(),
  actualizado_en    timestamptz,
  actualizado_por   uuid
);

-- ---------------------------------------------------------------------------
-- Bitácora de cargas por layout
-- ---------------------------------------------------------------------------
CREATE TABLE carga_layout (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layout           text NOT NULL,
  modo             text NOT NULL CHECK (modo IN ('alta', 'actualizacion', 'ambos')),
  formato          text NOT NULL CHECK (formato IN ('txt', 'csv', 'xlsx', 'pantalla')),
  nombre_archivo   text NOT NULL,
  codificacion     text,
  renglones        integer NOT NULL DEFAULT 0,
  altas            integer NOT NULL DEFAULT 0,
  actualizaciones  integer NOT NULL DEFAULT 0,
  errores          integer NOT NULL DEFAULT 0,
  advertencias     integer NOT NULL DEFAULT 0,
  detalle          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- errores y advertencias por renglón
  estatus          text NOT NULL CHECK (estatus IN ('validada', 'con_errores', 'pendiente_autorizacion', 'aplicada', 'rechazada')),
  usuario_id       uuid NOT NULL REFERENCES usuario (id),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  autorizado_por   uuid REFERENCES usuario (id),
  autorizado_en    timestamptz,
  motivo_rechazo   text,
  aplicado_por     uuid REFERENCES usuario (id),
  aplicado_en      timestamptz,
  actualizado_en   timestamptz,
  actualizado_por  uuid
);
CREATE INDEX carga_layout_fecha ON carga_layout (creado_en DESC);

-- Archivo original de cada carga (solo inserción).
CREATE TABLE carga_archivo (
  carga_id  uuid PRIMARY KEY REFERENCES carga_layout (id),
  contenido bytea NOT NULL
);
CREATE TRIGGER carga_archivo_inmutable BEFORE UPDATE OR DELETE ON carga_archivo
  FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

ALTER TABLE precio_venta ADD CONSTRAINT precio_venta_carga FOREIGN KEY (carga_id) REFERENCES carga_layout (id);

-- ---------------------------------------------------------------------------
-- Configuración (provisional: la ajusta el contralor)
-- ---------------------------------------------------------------------------
INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, minimo, maximo, provisional, permiso_editar) VALUES
  ('cargas.alerta_cambio_costo_pct', 'Cargas por layout', 'Avisar en la validación cuando un costo cambie más de este porcentaje', 'decimal', '10', 0, 1000, true, 'configuracion.parametros:editar'),
  ('cargas.renglones_maximos', 'Cargas por layout', 'Renglones máximos por archivo de carga', 'entero', '5000', 1, 20000, true, 'configuracion.parametros:editar');

-- ---------------------------------------------------------------------------
-- Auditoría y prohibición de borrado
-- ---------------------------------------------------------------------------
SELECT auditar_tabla(t) FROM unnest(ARRAY[
  'sat_catalogo', 'unidad', 'conversion_unidad', 'familia', 'centro_costo',
  'tasa_impuesto', 'proveedor', 'cliente', 'articulo', 'articulo_unidad',
  'articulo_proveedor', 'precio_venta', 'cuenta_contable'
]::regclass[]) AS t;

-- carga_layout no pasa por la bitácora de auditoría (es en sí una bitácora y su
-- detalle puede ser grande); sus cambios de estatus guardan quién y cuándo.
CREATE TRIGGER carga_layout_actualizado BEFORE UPDATE ON carga_layout
  FOR EACH ROW EXECUTE FUNCTION marcar_actualizacion();

CREATE FUNCTION rechazar_borrado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'En % no se borran registros: se dan de baja (activo = NO) o se cancelan con un movimiento inverso.', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sucursal', 'almacen', 'caja', 'sat_catalogo', 'unidad', 'conversion_unidad',
    'familia', 'centro_costo', 'tasa_impuesto', 'proveedor', 'cliente', 'articulo',
    'articulo_unidad', 'articulo_proveedor', 'precio_venta', 'cuenta_contable', 'carga_layout'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION rechazar_borrado()', t || '_sin_borrado', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado()', t || '_sin_truncate', t);
  END LOOP;
END $$;
