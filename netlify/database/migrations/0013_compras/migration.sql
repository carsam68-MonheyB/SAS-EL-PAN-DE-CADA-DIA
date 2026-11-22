-- Fase 4 · Compras: motor de autorizaciones por nivel y monto, requisición →
-- orden de compra → recepción (entrada al inventario) → factura XML del
-- proveedor → cotejo a 3 vías → cuenta por pagar → pago autorizado.
--
-- Reglas:
--  * Ninguna orden de compra sin autorización: sale de una requisición
--    autorizada y, si su monto rebasa lo autorizado más la tolerancia, se vuelve
--    a autorizar.
--  * Quien solicita no autoriza; las firmas no se modifican.
--  * Nada se borra: los documentos se cancelan.

-- ---------------------------------------------------------------------------
-- Motor genérico de autorizaciones
-- ---------------------------------------------------------------------------
CREATE TABLE solicitud_autorizacion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_documento   text NOT NULL CHECK (tipo_documento IN ('REQUISICION', 'ORDEN_COMPRA', 'FACTURA', 'PAGO')),
  documento_id     uuid NOT NULL,
  folio            text NOT NULL,
  monto            numeric(14, 2) NOT NULL CHECK (monto >= 0),
  permiso          text NOT NULL,              -- permiso que necesita quien autoriza
  operacion        text,                       -- límite por monto (limite_autorizacion.operacion), si aplica
  solicitante_id   uuid NOT NULL REFERENCES usuario (id),
  estatus          text NOT NULL DEFAULT 'PENDIENTE' CHECK (estatus IN ('PENDIENTE', 'AUTORIZADA', 'RECHAZADA', 'CANCELADA')),
  motivo           text,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid
);
CREATE UNIQUE INDEX solicitud_pendiente_unica ON solicitud_autorizacion (tipo_documento, documento_id) WHERE estatus = 'PENDIENTE';

CREATE TABLE firma_autorizacion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id     uuid NOT NULL REFERENCES solicitud_autorizacion (id),
  usuario_id       uuid NOT NULL REFERENCES usuario (id),
  decision         text NOT NULL CHECK (decision IN ('AUTORIZA', 'RECHAZA')),
  comentario       text,
  limite           numeric(14, 2),             -- límite de quien firmó al momento de firmar (NULL = sin límite)
  creado_en        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER firma_autorizacion_inmutable BEFORE UPDATE OR DELETE ON firma_autorizacion FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- ---------------------------------------------------------------------------
-- Requisiciones (existen desde la Fase 2)
-- ---------------------------------------------------------------------------
ALTER TABLE requisicion DROP CONSTRAINT requisicion_estatus_check;
ALTER TABLE requisicion ADD CONSTRAINT requisicion_estatus_check CHECK (estatus IN ('BORRADOR', 'ENVIADA', 'AUTORIZADA', 'RECHAZADA', 'CANCELADA', 'ORDENADA'));
ALTER TABLE requisicion ADD COLUMN monto_estimado numeric(14, 2);
ALTER TABLE requisicion ADD COLUMN sucursal_id uuid REFERENCES sucursal (id);
ALTER TABLE requisicion_renglon ADD COLUMN costo_estimado numeric(18, 6);         -- por unidad base
ALTER TABLE requisicion_renglon ADD COLUMN cantidad_ordenada numeric(18, 6) NOT NULL DEFAULT 0 CHECK (cantidad_ordenada >= 0);
ALTER TABLE requisicion_renglon ADD COLUMN comentario text;

-- ---------------------------------------------------------------------------
-- Órdenes de compra
-- ---------------------------------------------------------------------------
CREATE SEQUENCE orden_compra_folio;
CREATE TABLE orden_compra (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio            text NOT NULL UNIQUE DEFAULT 'OC-' || lpad(nextval('orden_compra_folio')::text, 6, '0'),
  proveedor_id     uuid NOT NULL REFERENCES proveedor (id),
  requisicion_id   uuid NOT NULL REFERENCES requisicion (id),
  almacen_id       uuid NOT NULL REFERENCES almacen (id),
  fecha_entrega    date NOT NULL,
  estatus          text NOT NULL CHECK (estatus IN ('POR_AUTORIZAR', 'EMITIDA', 'PARCIAL', 'RECIBIDA', 'CANCELADA', 'RECHAZADA')),
  subtotal         numeric(14, 2) NOT NULL,
  iva              numeric(14, 2) NOT NULL,
  total            numeric(14, 2) NOT NULL,
  autorizado_requisicion numeric(14, 2) NOT NULL,   -- lo autorizado en la requisición para estos renglones (estimado con IVA)
  condiciones      text,
  comentario       text,
  creado_por_id    uuid NOT NULL REFERENCES usuario (id),
  motivo_cancelacion text,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid,
  CHECK (subtotal + iva = total)
);

CREATE TABLE oc_renglon (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oc_id              uuid NOT NULL REFERENCES orden_compra (id),
  orden              integer NOT NULL,
  requisicion_renglon_id uuid NOT NULL REFERENCES requisicion_renglon (id),
  articulo_id        uuid NOT NULL REFERENCES articulo (id),
  cantidad           numeric(18, 6) NOT NULL CHECK (cantidad > 0),     -- en la unidad de la OC
  unidad_id          uuid NOT NULL REFERENCES unidad (id),
  factor_base        numeric(24, 10) NOT NULL CHECK (factor_base > 0), -- 1 unidad de la OC = factor unidades base
  precio             numeric(18, 6) NOT NULL CHECK (precio >= 0),      -- por unidad de la OC, sin IVA
  tasa_iva           numeric(12, 6) NOT NULL CHECK (tasa_iva >= 0),
  importe            numeric(14, 2) NOT NULL,
  iva                numeric(14, 2) NOT NULL,
  cantidad_recibida  numeric(18, 6) NOT NULL DEFAULT 0 CHECK (cantidad_recibida >= 0 AND cantidad_recibida <= cantidad),
  UNIQUE (oc_id, orden)
);
-- Solo cambia lo recibido.
CREATE FUNCTION oc_renglon_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'cantidad_recibida') <> (to_jsonb(OLD) - 'cantidad_recibida') OR NEW.cantidad_recibida < OLD.cantidad_recibida THEN
    RAISE EXCEPTION 'Un renglón de orden de compra no se modifica: cancela la orden y emite otra.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER oc_renglon_validar BEFORE UPDATE ON oc_renglon FOR EACH ROW EXECUTE FUNCTION oc_renglon_validar();

-- ---------------------------------------------------------------------------
-- Recepciones (entrada al inventario al precio de la OC)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE recepcion_folio;
CREATE TABLE recepcion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio            text NOT NULL UNIQUE DEFAULT 'REC-' || lpad(nextval('recepcion_folio')::text, 6, '0'),
  oc_id            uuid NOT NULL REFERENCES orden_compra (id),
  almacen_id       uuid NOT NULL REFERENCES almacen (id),
  movimiento_id    uuid NOT NULL REFERENCES movimiento (id),
  remision         text,
  comentario       text,
  recibio_id       uuid NOT NULL REFERENCES usuario (id),
  creado_en        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER recepcion_inmutable BEFORE UPDATE OR DELETE ON recepcion FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

CREATE TABLE recepcion_renglon (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recepcion_id     uuid NOT NULL REFERENCES recepcion (id),
  oc_renglon_id    uuid NOT NULL REFERENCES oc_renglon (id),
  cantidad         numeric(18, 6) NOT NULL CHECK (cantidad > 0),      -- en la unidad de la OC
  lote             text,
  caducidad        date
);
CREATE TRIGGER recepcion_renglon_inmutable BEFORE UPDATE OR DELETE ON recepcion_renglon FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

ALTER TABLE movimiento DROP CONSTRAINT movimiento_documento_tipo_check;
ALTER TABLE movimiento ADD CONSTRAINT movimiento_documento_tipo_check CHECK (documento_tipo IN ('CARGA', 'SURTIDO', 'TRASPASO', 'MERMA', 'CONTEO', 'VENTA', 'DEVOLUCION', 'RECEPCION'));

-- ---------------------------------------------------------------------------
-- Facturas de proveedor (XML CFDI) y cotejo a 3 vías
-- ---------------------------------------------------------------------------
CREATE TABLE factura_proveedor (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cfdi        text NOT NULL UNIQUE CHECK (uuid_cfdi ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'),
  proveedor_id     uuid NOT NULL REFERENCES proveedor (id),
  oc_id            uuid NOT NULL REFERENCES orden_compra (id),
  serie            text,
  folio            text,
  fecha            timestamptz NOT NULL,
  moneda           text NOT NULL,
  metodo_pago      text,
  forma_pago       text,
  subtotal         numeric(14, 2) NOT NULL,
  descuento        numeric(14, 2) NOT NULL DEFAULT 0,
  iva              numeric(14, 2) NOT NULL DEFAULT 0,
  ieps             numeric(14, 2) NOT NULL DEFAULT 0,
  retenciones      numeric(14, 2) NOT NULL DEFAULT 0,
  total            numeric(14, 2) NOT NULL,
  xml              text NOT NULL,
  estatus          text NOT NULL CHECK (estatus IN ('COTEJADA', 'CON_DIFERENCIAS', 'AUTORIZADA', 'RECHAZADA', 'CANCELADA')),
  registrado_por   uuid NOT NULL REFERENCES usuario (id),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid
);
-- El XML y los importes no cambian; solo el estatus.
CREATE FUNCTION factura_proveedor_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'estatus' - 'actualizado_en' - 'actualizado_por') <> (to_jsonb(OLD) - 'estatus' - 'actualizado_en' - 'actualizado_por') THEN
    RAISE EXCEPTION 'Una factura registrada no se modifica.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER factura_proveedor_validar BEFORE UPDATE ON factura_proveedor FOR EACH ROW EXECUTE FUNCTION factura_proveedor_validar();

CREATE TABLE factura_concepto (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id       uuid NOT NULL REFERENCES factura_proveedor (id),
  orden            integer NOT NULL,
  descripcion      text NOT NULL,
  no_identificacion text,
  clave_prod_serv  text,
  cantidad         numeric(18, 6) NOT NULL,
  valor_unitario   numeric(18, 6) NOT NULL,
  importe          numeric(14, 2) NOT NULL,
  descuento        numeric(14, 2) NOT NULL DEFAULT 0,
  iva              numeric(14, 2) NOT NULL DEFAULT 0,
  oc_renglon_id    uuid REFERENCES oc_renglon (id)
);
CREATE TRIGGER factura_concepto_inmutable BEFORE UPDATE OR DELETE ON factura_concepto FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

CREATE TABLE cotejo_diferencia (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id       uuid NOT NULL REFERENCES factura_proveedor (id),
  oc_renglon_id    uuid REFERENCES oc_renglon (id),
  tipo             text NOT NULL CHECK (tipo IN ('CANTIDAD', 'PRECIO', 'IMPUESTO', 'TOTAL', 'SIN_RELACION')),
  esperado         numeric(18, 6),
  facturado        numeric(18, 6),
  dentro_tolerancia boolean NOT NULL,
  descripcion      text NOT NULL
);
CREATE TRIGGER cotejo_diferencia_inmutable BEFORE UPDATE OR DELETE ON cotejo_diferencia FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- ---------------------------------------------------------------------------
-- Cuentas por pagar y pagos
-- ---------------------------------------------------------------------------
CREATE TABLE cuenta_bancaria (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave            text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,20}$'),
  banco            text NOT NULL,
  alias            text NOT NULL,
  terminacion      text NOT NULL CHECK (terminacion ~ '^[0-9]{4}$'),   -- solo los últimos 4 dígitos
  activo           boolean NOT NULL DEFAULT true,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid
);

CREATE TABLE cxp_documento (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id     uuid NOT NULL REFERENCES proveedor (id),
  factura_id       uuid NOT NULL UNIQUE REFERENCES factura_proveedor (id),
  fecha            date NOT NULL,
  vencimiento      date NOT NULL,
  importe          numeric(14, 2) NOT NULL CHECK (importe > 0),
  saldo            numeric(14, 2) NOT NULL CHECK (saldo >= 0 AND saldo <= importe),
  estatus          text NOT NULL DEFAULT 'ABIERTO' CHECK (estatus IN ('ABIERTO', 'PAGADO', 'CANCELADO')),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid
);
CREATE INDEX cxp_abiertas ON cxp_documento (proveedor_id, vencimiento) WHERE estatus = 'ABIERTO';

CREATE SEQUENCE pago_proveedor_folio;
CREATE TABLE pago_proveedor (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio            text NOT NULL UNIQUE DEFAULT 'PAG-' || lpad(nextval('pago_proveedor_folio')::text, 6, '0'),
  proveedor_id     uuid NOT NULL REFERENCES proveedor (id),
  cuenta_bancaria_id uuid REFERENCES cuenta_bancaria (id),
  forma_pago       text NOT NULL CHECK (forma_pago IN ('01', '02', '03')),   -- efectivo, cheque, transferencia (c_FormaPago)
  importe          numeric(14, 2) NOT NULL CHECK (importe > 0),
  fecha_programada date NOT NULL,
  fecha_pago       date,
  referencia       text,
  estatus          text NOT NULL DEFAULT 'POR_AUTORIZAR' CHECK (estatus IN ('POR_AUTORIZAR', 'AUTORIZADO', 'PAGADO', 'RECHAZADO', 'CANCELADO')),
  comentario       text,
  registrado_por   uuid NOT NULL REFERENCES usuario (id),
  pagado_por       uuid REFERENCES usuario (id),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid,
  CHECK (estatus <> 'PAGADO' OR (fecha_pago IS NOT NULL AND referencia IS NOT NULL))
);

CREATE TABLE pago_aplicacion (
  pago_id          uuid NOT NULL REFERENCES pago_proveedor (id),
  cxp_id           uuid NOT NULL REFERENCES cxp_documento (id),
  importe          numeric(14, 2) NOT NULL CHECK (importe > 0),
  PRIMARY KEY (pago_id, cxp_id)
);
CREATE TRIGGER pago_aplicacion_inmutable BEFORE UPDATE OR DELETE ON pago_aplicacion FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- ---------------------------------------------------------------------------
-- Configuración (provisional: la confirma el negocio, P33)
-- ---------------------------------------------------------------------------
INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, minimo, maximo, provisional, permiso_editar) VALUES
  ('compras.tolerancia_oc_pct', 'Compras', 'Una orden de compra puede pasar de lo autorizado en la requisición hasta este % sin volver a autorizarse.', 'decimal', '5', 0, 100, true, 'configuracion.parametros:editar'),
  ('compras.tolerancia_cantidad_pct', 'Compras', 'Cotejo a 3 vías: diferencia aceptable entre lo facturado y lo recibido, en % de la cantidad.', 'decimal', '0', 0, 100, true, 'configuracion.parametros:editar'),
  ('compras.tolerancia_precio_pct', 'Compras', 'Cotejo a 3 vías: diferencia aceptable entre el precio facturado y el de la orden de compra, en %.', 'decimal', '1', 0, 100, true, 'configuracion.parametros:editar'),
  ('compras.tolerancia_importe', 'Compras', 'Cotejo a 3 vías: diferencia aceptable en pesos en el total o en el IVA de la factura (redondeos).', 'decimal', '1', 0, 1000, true, 'configuracion.parametros:editar');
INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, provisional, permiso_editar, opciones) VALUES
  ('compras.permitir_entrada_sin_oc', 'Compras', 'Permite la "Entrada por compra" directa (sin orden de compra) de la Fase 3. Desde la Fase 4 las compras entran por recepción de una OC autorizada.', 'texto', 'NO', true, 'configuracion.parametros:editar', ARRAY['NO', 'SI']);
INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, provisional, permiso_editar) VALUES
  ('empresa.rfc', 'General', 'RFC de la empresa: las facturas de proveedor deben venir a este RFC. Vacío = no se revisa (solo en desarrollo).', 'texto', '', true, 'configuracion.parametros:editar');

-- ---------------------------------------------------------------------------
-- Auditoría y prohibición de borrado
-- ---------------------------------------------------------------------------
SELECT auditar_tabla(t) FROM unnest(ARRAY[
  'solicitud_autorizacion', 'firma_autorizacion', 'orden_compra', 'oc_renglon', 'recepcion', 'recepcion_renglon',
  'factura_proveedor', 'factura_concepto', 'cotejo_diferencia', 'cuenta_bancaria', 'cxp_documento', 'pago_proveedor', 'pago_aplicacion'
]::regclass[]) AS t;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['solicitud_autorizacion', 'orden_compra', 'oc_renglon', 'factura_proveedor', 'cuenta_bancaria', 'cxp_documento', 'pago_proveedor'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION rechazar_borrado()', t || '_sin_borrado', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'solicitud_autorizacion', 'firma_autorizacion', 'orden_compra', 'oc_renglon', 'recepcion', 'recepcion_renglon',
    'factura_proveedor', 'factura_concepto', 'cotejo_diferencia', 'cuenta_bancaria', 'cxp_documento', 'pago_proveedor', 'pago_aplicacion'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado()', t || '_sin_truncate', t);
  END LOOP;
END $$;
