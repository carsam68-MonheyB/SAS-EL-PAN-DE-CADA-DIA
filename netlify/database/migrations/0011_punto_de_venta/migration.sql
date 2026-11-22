-- Fase 6 · Punto de venta: turnos de caja, ventas con salida de inventario,
-- pagos (sin datos de tarjeta), retiros e ingresos de efectivo, devoluciones
-- autorizadas, cortes X y Z con arqueo por denominación, y pedidos con
-- anticipo (pasivo del cliente hasta la entrega).
--
-- Reglas:
--  * Una venta, sus renglones y pagos no se modifican; se corrigen con una devolución.
--  * No se vende sin existencia de producto terminado (P71): la salida de
--    inventario se hace en la misma transacción que la venta.
--  * De la tarjeta solo se guarda la referencia o autorización del voucher.

-- ---------------------------------------------------------------------------
-- Catálogos y ajustes a cajas
-- ---------------------------------------------------------------------------
ALTER TABLE caja ADD COLUMN almacen_id uuid REFERENCES almacen (id);
ALTER TABLE caja ADD COLUMN ultimo_folio integer NOT NULL DEFAULT 0 CHECK (ultimo_folio >= 0);
ALTER TABLE caja ADD COLUMN fondo_sugerido numeric(14, 2) CHECK (fondo_sugerido >= 0);

-- Formas de pago que acepta la caja (clave del catálogo c_FormaPago del SAT, P47).
CREATE TABLE forma_pago (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave               text NOT NULL UNIQUE CHECK (clave ~ '^[0-9]{2}$'),
  nombre              text NOT NULL,
  es_efectivo         boolean NOT NULL DEFAULT false,
  requiere_referencia boolean NOT NULL DEFAULT false,
  orden               integer NOT NULL DEFAULT 1,
  activo              boolean NOT NULL DEFAULT true,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  creado_por          uuid DEFAULT usuario_actual(),
  actualizado_en      timestamptz,
  actualizado_por     uuid
);
-- Provisionales (P47): se activan o desactivan en el catálogo.
INSERT INTO forma_pago (clave, nombre, es_efectivo, requiere_referencia, orden) VALUES
  ('01', 'Efectivo', true, false, 1),
  ('04', 'Tarjeta de crédito', false, true, 2),
  ('28', 'Tarjeta de débito', false, true, 3),
  ('03', 'Transferencia', false, true, 4);

-- Denominaciones para el arqueo (P48). Billetes y monedas vigentes de Banco de México.
CREATE TABLE denominacion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valor           numeric(10, 2) NOT NULL UNIQUE CHECK (valor > 0),
  tipo            text NOT NULL CHECK (tipo IN ('BILLETE', 'MONEDA')),
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);
INSERT INTO denominacion (valor, tipo) VALUES
  (1000, 'BILLETE'), (500, 'BILLETE'), (200, 'BILLETE'), (100, 'BILLETE'), (50, 'BILLETE'), (20, 'BILLETE'),
  (10, 'MONEDA'), (5, 'MONEDA'), (2, 'MONEDA'), (1, 'MONEDA'), (0.50, 'MONEDA');

-- ---------------------------------------------------------------------------
-- Turnos de caja y cortes
-- ---------------------------------------------------------------------------
CREATE SEQUENCE turno_caja_folio;
CREATE TABLE turno_caja (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio           text NOT NULL UNIQUE DEFAULT 'TUR-' || lpad(nextval('turno_caja_folio')::text, 6, '0'),
  caja_id         uuid NOT NULL REFERENCES caja (id),
  fecha_negocio   date NOT NULL,
  fondo           numeric(14, 2) NOT NULL CHECK (fondo >= 0),
  estatus         text NOT NULL DEFAULT 'ABIERTO' CHECK (estatus IN ('ABIERTO', 'CERRADO')),
  abierto_por     uuid NOT NULL REFERENCES usuario (id),
  abierto_en      timestamptz NOT NULL DEFAULT now(),
  cerrado_por     uuid REFERENCES usuario (id),
  cerrado_en      timestamptz,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);
CREATE UNIQUE INDEX turno_caja_abierto ON turno_caja (caja_id) WHERE estatus = 'ABIERTO';

-- Retiros (sangrías) e ingresos de efectivo, anticipos y devoluciones de dinero.
CREATE TABLE movimiento_caja (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turno_id        uuid NOT NULL REFERENCES turno_caja (id),
  tipo            text NOT NULL CHECK (tipo IN ('RETIRO', 'INGRESO', 'ANTICIPO', 'DEVOLUCION_ANTICIPO', 'DEVOLUCION_VENTA')),
  forma_pago_id   uuid NOT NULL REFERENCES forma_pago (id),
  importe         numeric(14, 2) NOT NULL CHECK (importe > 0),   -- siempre positivo; el tipo dice si entra o sale
  referencia      text,
  motivo          text,
  documento_id    uuid,
  cajero_id       uuid NOT NULL REFERENCES usuario (id),
  autorizo_id     uuid REFERENCES usuario (id),
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX movimiento_caja_turno ON movimiento_caja (turno_id);
CREATE TRIGGER movimiento_caja_inmutable BEFORE UPDATE OR DELETE ON movimiento_caja FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

CREATE TABLE corte (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turno_id           uuid NOT NULL REFERENCES turno_caja (id),
  tipo               text NOT NULL CHECK (tipo IN ('X', 'Z')),
  esperado_efectivo  numeric(14, 2) NOT NULL,
  contado_efectivo   numeric(14, 2),
  diferencia         numeric(14, 2),
  resumen            jsonb NOT NULL,     -- ventas, devoluciones, retiros, anticipos y totales por forma de pago
  comentario         text,
  usuario_id         uuid NOT NULL REFERENCES usuario (id),
  autorizo_id        uuid REFERENCES usuario (id),
  creado_en          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX corte_z_unico ON corte (turno_id) WHERE tipo = 'Z';
CREATE TRIGGER corte_inmutable BEFORE UPDATE OR DELETE ON corte FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

CREATE TABLE corte_denominacion (
  corte_id        uuid NOT NULL REFERENCES corte (id),
  valor           numeric(10, 2) NOT NULL,
  cantidad        integer NOT NULL CHECK (cantidad >= 0),
  PRIMARY KEY (corte_id, valor)
);
CREATE TRIGGER corte_denominacion_inmutable BEFORE UPDATE OR DELETE ON corte_denominacion FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- ---------------------------------------------------------------------------
-- Pedidos con anticipo
-- ---------------------------------------------------------------------------
CREATE SEQUENCE pedido_folio;
CREATE TABLE pedido (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio            text NOT NULL UNIQUE DEFAULT 'PED-' || lpad(nextval('pedido_folio')::text, 6, '0'),
  sucursal_id      uuid NOT NULL REFERENCES sucursal (id),
  cliente_id       uuid REFERENCES cliente (id),
  cliente_nombre   text NOT NULL,
  telefono         text,
  fecha_entrega    date NOT NULL,
  notas            text,
  total            numeric(14, 2) NOT NULL CHECK (total >= 0),
  anticipado       numeric(14, 2) NOT NULL DEFAULT 0 CHECK (anticipado >= 0),
  estatus          text NOT NULL DEFAULT 'REGISTRADO' CHECK (estatus IN ('REGISTRADO', 'ENTREGADO', 'CANCELADO')),
  venta_id         uuid,
  destino_anticipo text CHECK (destino_anticipo IN ('DEVUELTO', 'RETENIDO')),
  motivo_cancelacion text,
  registrado_por   uuid NOT NULL REFERENCES usuario (id),
  cancelo_id       uuid REFERENCES usuario (id),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid,
  CHECK (anticipado <= total)
);
CREATE INDEX pedido_entrega ON pedido (sucursal_id, fecha_entrega) WHERE estatus = 'REGISTRADO';

CREATE TABLE pedido_renglon (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id        uuid NOT NULL REFERENCES pedido (id),
  articulo_id      uuid NOT NULL REFERENCES articulo (id),
  cantidad         numeric(14, 3) NOT NULL CHECK (cantidad > 0),
  precio           numeric(14, 2) NOT NULL CHECK (precio >= 0),
  importe          numeric(14, 2) NOT NULL CHECK (importe >= 0),
  especificaciones text,
  creado_en        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER pedido_renglon_inmutable BEFORE UPDATE OR DELETE ON pedido_renglon FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- ---------------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------------
CREATE TABLE venta (
  id               uuid PRIMARY KEY,                 -- lo genera la caja: reenviar no duplica
  folio            text NOT NULL UNIQUE,
  caja_id          uuid NOT NULL REFERENCES caja (id),
  turno_id         uuid NOT NULL REFERENCES turno_caja (id),
  sucursal_id      uuid NOT NULL REFERENCES sucursal (id),
  almacen_id       uuid NOT NULL REFERENCES almacen (id),
  cajero_id        uuid NOT NULL REFERENCES usuario (id),
  fecha            timestamptz NOT NULL DEFAULT now(),
  fecha_negocio    date NOT NULL,
  subtotal         numeric(14, 2) NOT NULL,          -- base sin impuestos
  ieps             numeric(14, 2) NOT NULL,
  iva              numeric(14, 2) NOT NULL,
  descuento        numeric(14, 2) NOT NULL DEFAULT 0, -- con impuestos, ya restado del total
  total            numeric(14, 2) NOT NULL CHECK (total >= 0),
  recibido         numeric(14, 2) NOT NULL,
  cambio           numeric(14, 2) NOT NULL DEFAULT 0 CHECK (cambio >= 0),
  devuelto         numeric(14, 2) NOT NULL DEFAULT 0 CHECK (devuelto >= 0 AND devuelto <= total),
  estatus          text NOT NULL DEFAULT 'PAGADA' CHECK (estatus IN ('PAGADA', 'DEVUELTA_PARCIAL', 'DEVUELTA')),
  pedido_id        uuid REFERENCES pedido (id),
  anticipo_aplicado numeric(14, 2) NOT NULL DEFAULT 0 CHECK (anticipo_aplicado >= 0),
  movimiento_id    uuid NOT NULL REFERENCES movimiento (id),
  autorizo_descuento_id uuid REFERENCES usuario (id),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid,
  CHECK (subtotal + ieps + iva = total)
);
CREATE INDEX venta_turno ON venta (turno_id);
CREATE INDEX venta_fecha ON venta (fecha_negocio, sucursal_id);
ALTER TABLE pedido ADD CONSTRAINT pedido_venta FOREIGN KEY (venta_id) REFERENCES venta (id);

-- De una venta solo cambian el importe devuelto y su estatus.
CREATE FUNCTION venta_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'devuelto' - 'estatus' - 'actualizado_en' - 'actualizado_por') <> (to_jsonb(OLD) - 'devuelto' - 'estatus' - 'actualizado_en' - 'actualizado_por')
     OR NEW.devuelto < OLD.devuelto THEN
    RAISE EXCEPTION 'Una venta no se modifica: se corrige con una devolución.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER venta_validar BEFORE UPDATE ON venta FOR EACH ROW EXECUTE FUNCTION venta_validar();

CREATE TABLE venta_renglon (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id         uuid NOT NULL REFERENCES venta (id),
  orden            integer NOT NULL,
  articulo_id      uuid NOT NULL REFERENCES articulo (id),
  cantidad         numeric(14, 3) NOT NULL CHECK (cantidad > 0),
  precio           numeric(14, 2) NOT NULL CHECK (precio >= 0),   -- precio al público (con impuestos)
  descuento        numeric(14, 2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  importe          numeric(14, 2) NOT NULL CHECK (importe >= 0),  -- precio × cantidad − descuento
  base             numeric(14, 2) NOT NULL,
  ieps             numeric(14, 2) NOT NULL,
  iva              numeric(14, 2) NOT NULL,
  tasa_iva         numeric(12, 6),
  tasa_ieps        numeric(12, 6),
  costo_unitario   numeric(18, 6) NOT NULL,
  costo_importe    numeric(20, 6) NOT NULL,
  cantidad_devuelta numeric(14, 3) NOT NULL DEFAULT 0 CHECK (cantidad_devuelta >= 0 AND cantidad_devuelta <= cantidad),
  CHECK (base + ieps + iva = importe),
  UNIQUE (venta_id, orden)
);
CREATE FUNCTION venta_renglon_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'cantidad_devuelta') <> (to_jsonb(OLD) - 'cantidad_devuelta') OR NEW.cantidad_devuelta < OLD.cantidad_devuelta THEN
    RAISE EXCEPTION 'Un renglón de venta no se modifica: se corrige con una devolución.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER venta_renglon_validar BEFORE UPDATE ON venta_renglon FOR EACH ROW EXECUTE FUNCTION venta_renglon_validar();

CREATE TABLE venta_pago (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id         uuid NOT NULL REFERENCES venta (id),
  forma_pago_id    uuid REFERENCES forma_pago (id),   -- NULL = anticipo del pedido aplicado
  importe          numeric(14, 2) NOT NULL CHECK (importe > 0),  -- lo que se aplica a la venta (sin cambio)
  referencia       text,                               -- voucher o autorización; nunca datos de tarjeta
  CHECK (referencia IS NULL OR referencia !~ '[0-9]{13,19}')
);
CREATE TRIGGER venta_pago_inmutable BEFORE UPDATE OR DELETE ON venta_pago FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- Anticipos de pedidos (pasivo del cliente hasta la entrega).
CREATE TABLE anticipo (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id        uuid NOT NULL REFERENCES pedido (id),
  movimiento_caja_id uuid NOT NULL REFERENCES movimiento_caja (id),
  importe          numeric(14, 2) NOT NULL CHECK (importe > 0),
  creado_en        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER anticipo_inmutable BEFORE UPDATE OR DELETE ON anticipo FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- Devoluciones de venta (autorizadas con PIN de un supervisor).
CREATE SEQUENCE devolucion_folio;
CREATE TABLE devolucion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio            text NOT NULL UNIQUE DEFAULT 'DEV-' || lpad(nextval('devolucion_folio')::text, 6, '0'),
  venta_id         uuid NOT NULL REFERENCES venta (id),
  turno_id         uuid NOT NULL REFERENCES turno_caja (id),
  importe          numeric(14, 2) NOT NULL CHECK (importe > 0),
  motivo           text NOT NULL,
  regresa_inventario boolean NOT NULL,
  movimiento_id    uuid REFERENCES movimiento (id),
  movimiento_caja_id uuid NOT NULL REFERENCES movimiento_caja (id),
  cajero_id        uuid NOT NULL REFERENCES usuario (id),
  autorizo_id      uuid NOT NULL REFERENCES usuario (id),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  CHECK (autorizo_id <> cajero_id)
);
CREATE TRIGGER devolucion_inmutable BEFORE UPDATE OR DELETE ON devolucion FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

CREATE TABLE devolucion_renglon (
  devolucion_id    uuid NOT NULL REFERENCES devolucion (id),
  venta_renglon_id uuid NOT NULL REFERENCES venta_renglon (id),
  cantidad         numeric(14, 3) NOT NULL CHECK (cantidad > 0),
  importe          numeric(14, 2) NOT NULL CHECK (importe >= 0),
  PRIMARY KEY (devolucion_id, venta_renglon_id)
);
CREATE TRIGGER devolucion_renglon_inmutable BEFORE UPDATE OR DELETE ON devolucion_renglon FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- El kárdex reconoce las ventas y sus devoluciones.
ALTER TABLE movimiento DROP CONSTRAINT movimiento_tipo_check;
ALTER TABLE movimiento ADD CONSTRAINT movimiento_tipo_check CHECK (tipo IN (
  'INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_PRODUCCION', 'SURTIDO_SALIDA', 'SURTIDO_ENTRADA', 'TRASPASO_ENVIO', 'TRASPASO_RECEPCION',
  'MERMA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'CANCELACION', 'VENTA', 'DEVOLUCION_VENTA'));
ALTER TABLE movimiento DROP CONSTRAINT movimiento_documento_tipo_check;
ALTER TABLE movimiento ADD CONSTRAINT movimiento_documento_tipo_check CHECK (documento_tipo IN ('CARGA', 'SURTIDO', 'TRASPASO', 'MERMA', 'CONTEO', 'VENTA', 'DEVOLUCION'));

-- ---------------------------------------------------------------------------
-- Configuración (provisional: la confirma el negocio)
-- ---------------------------------------------------------------------------
INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, minimo, maximo, provisional, permiso_editar) VALUES
  ('pos.anticipo_minimo_pct', 'Punto de venta', 'Anticipo mínimo de un pedido, en % del total (P60). 0 = sin mínimo.', 'entero', '0', 0, 100, true, 'configuracion.parametros:editar'),
  ('pos.diferencia_corte_maxima', 'Punto de venta', 'Diferencia de efectivo (en pesos, faltante o sobrante) a partir de la cual el corte Z exige comentario y la autorización de un encargado.', 'entero', '0', 0, 100000, true, 'configuracion.parametros:editar');

-- ---------------------------------------------------------------------------
-- Auditoría y prohibición de borrado
-- ---------------------------------------------------------------------------
SELECT auditar_tabla(t) FROM unnest(ARRAY[
  'forma_pago', 'denominacion', 'turno_caja', 'movimiento_caja', 'corte', 'corte_denominacion', 'pedido', 'pedido_renglon',
  'venta', 'venta_renglon', 'venta_pago', 'anticipo', 'devolucion', 'devolucion_renglon'
]::regclass[]) AS t;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['forma_pago', 'denominacion', 'turno_caja', 'pedido', 'venta', 'venta_renglon'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION rechazar_borrado()', t || '_sin_borrado', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'forma_pago', 'denominacion', 'turno_caja', 'movimiento_caja', 'corte', 'corte_denominacion', 'pedido', 'pedido_renglon',
    'venta', 'venta_renglon', 'venta_pago', 'anticipo', 'devolucion', 'devolucion_renglon'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado()', t || '_sin_truncate', t);
  END LOOP;
END $$;
