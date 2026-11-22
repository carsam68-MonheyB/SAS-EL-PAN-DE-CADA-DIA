-- Fase 8 · Facturación con el portal del SAT (P49, P53, P54, P56, P58, P64)
--  * No hay PAC ni e.firma en el sistema: las facturas se elaboran y timbran en el
--    portal del SAT. El sistema prepara los datos para capturarlos y guarda el XML
--    que se descarga del portal, ligado a sus tickets.
--  * Solicitudes de factura: los datos fiscales del cliente para facturar un ticket.
--    Se piden el mismo día, antes de la factura global diaria.
--  * Un ticket queda en a lo más una factura vigente (individual o global). Si la
--    factura se cancela, el ticket se puede volver a facturar.
--  * Las cancelaciones se hacen en el portal del SAT; aquí las registra el contador y
--    las autoriza el contralor.
--  * Anticipos de pedidos: se entrega un recibo (no es factura); todo se factura a la
--    entrega del pedido.

-- ---------------------------------------------------------------------------
-- Facturas emitidas (XML descargado del portal del SAT)
-- ---------------------------------------------------------------------------
CREATE TABLE cfdi_emitido (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cfdi        text NOT NULL UNIQUE CHECK (uuid_cfdi ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'),
  clase            text NOT NULL CHECK (clase IN ('NOMINATIVA', 'GLOBAL', 'EGRESO')),
  tipo_comprobante text NOT NULL CHECK (tipo_comprobante IN ('I', 'E')),
  serie            text,
  folio            text,
  fecha_emision    timestamptz NOT NULL,
  fecha_negocio    date NOT NULL,            -- día de los tickets (global) o de la emisión
  sucursal_id      uuid REFERENCES sucursal (id),
  receptor_rfc     text NOT NULL,
  receptor_nombre  text,
  regimen_receptor text,
  uso_cfdi         text,
  metodo_pago      text,
  forma_pago       text,
  subtotal         numeric(14, 2) NOT NULL,
  descuento        numeric(14, 2) NOT NULL DEFAULT 0,
  iva              numeric(14, 2) NOT NULL,
  ieps             numeric(14, 2) NOT NULL,
  total            numeric(14, 2) NOT NULL CHECK (total >= 0),
  global_periodicidad text,
  global_meses     text,
  global_anio      integer,
  relacionado_id   uuid REFERENCES cfdi_emitido (id),   -- egreso → factura que corrige
  tipo_relacion    text,
  xml              text NOT NULL,
  xml_sha256       text NOT NULL,
  estatus          text NOT NULL DEFAULT 'VIGENTE' CHECK (estatus IN ('VIGENTE', 'CANCELACION_POR_AUTORIZAR', 'CANCELADA')),
  cancelacion_motivo_sat text CHECK (cancelacion_motivo_sat IN ('01', '02', '03', '04')),
  cancelacion_uuid_sustitucion text,
  cancelacion_nota text,
  cancelacion_solicito_id uuid REFERENCES usuario (id),
  cancelacion_autorizo_id uuid REFERENCES usuario (id),
  cancelado_en     timestamptz,
  registrado_por   uuid NOT NULL REFERENCES usuario (id),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid,
  CHECK ((clase = 'EGRESO') = (tipo_comprobante = 'E')),
  CHECK (clase <> 'EGRESO' OR relacionado_id IS NOT NULL),
  CHECK (cancelacion_autorizo_id IS NULL OR cancelacion_autorizo_id <> cancelacion_solicito_id)
);
CREATE INDEX cfdi_emitido_fecha ON cfdi_emitido (fecha_negocio, clase);

-- Del XML y sus importes no cambia nada; solo la cancelación (y una cancelada ya no cambia).
CREATE FUNCTION cfdi_emitido_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE libres text[] := ARRAY['estatus', 'cancelacion_motivo_sat', 'cancelacion_uuid_sustitucion', 'cancelacion_nota',
  'cancelacion_solicito_id', 'cancelacion_autorizo_id', 'cancelado_en', 'actualizado_en', 'actualizado_por'];
BEGIN
  IF (to_jsonb(NEW) - libres) <> (to_jsonb(OLD) - libres) THEN
    RAISE EXCEPTION 'Una factura registrada no se modifica: se cancela en el portal del SAT y se registra la cancelación.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.estatus = 'CANCELADA' THEN
    RAISE EXCEPTION 'La factura ya está cancelada.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cfdi_emitido_validar BEFORE UPDATE ON cfdi_emitido FOR EACH ROW EXECUTE FUNCTION cfdi_emitido_validar();

-- Tickets que ampara cada factura (con el importe neto de devoluciones al facturar).
CREATE TABLE cfdi_venta (
  cfdi_id          uuid NOT NULL REFERENCES cfdi_emitido (id),
  venta_id         uuid NOT NULL REFERENCES venta (id),
  base             numeric(14, 2) NOT NULL,
  ieps             numeric(14, 2) NOT NULL,
  iva              numeric(14, 2) NOT NULL,
  total            numeric(14, 2) NOT NULL CHECK (total >= 0),
  vigente          boolean NOT NULL DEFAULT true,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cfdi_id, venta_id),
  CHECK (base + ieps + iva = total)
);
-- Un ticket está en a lo más una factura vigente.
CREATE UNIQUE INDEX cfdi_venta_unica ON cfdi_venta (venta_id) WHERE vigente;

CREATE FUNCTION cfdi_venta_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'vigente') <> (to_jsonb(OLD) - 'vigente') OR (NEW.vigente AND NOT OLD.vigente) THEN
    RAISE EXCEPTION 'La relación de una factura con sus tickets no se modifica.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cfdi_venta_validar BEFORE UPDATE ON cfdi_venta FOR EACH ROW EXECUTE FUNCTION cfdi_venta_validar();

-- ---------------------------------------------------------------------------
-- Solicitudes de factura de un ticket
-- ---------------------------------------------------------------------------
CREATE SEQUENCE solicitud_factura_folio;
CREATE TABLE solicitud_factura (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio            text NOT NULL UNIQUE DEFAULT 'SOL-' || lpad(nextval('solicitud_factura_folio')::text, 6, '0'),
  venta_id         uuid NOT NULL REFERENCES venta (id),
  sucursal_id      uuid NOT NULL REFERENCES sucursal (id),
  cliente_id       uuid REFERENCES cliente (id),
  rfc              text NOT NULL CHECK (rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$' AND rfc NOT IN ('XAXX010101000', 'XEXX010101000')),
  razon_social     text NOT NULL CHECK (length(trim(razon_social)) > 0),
  regimen_fiscal   text NOT NULL CHECK (regimen_fiscal ~ '^[0-9]{3}$'),
  codigo_postal    text NOT NULL CHECK (codigo_postal ~ '^[0-9]{5}$'),
  uso_cfdi         text NOT NULL CHECK (uso_cfdi ~ '^[A-Z][0-9]{2}$'),
  correo           text,
  estatus          text NOT NULL DEFAULT 'PENDIENTE' CHECK (estatus IN ('PENDIENTE', 'FACTURADA', 'CANCELADA')),
  cfdi_id          uuid REFERENCES cfdi_emitido (id),
  motivo_cancelacion text,
  cancelo_id       uuid REFERENCES usuario (id),
  registrado_por   uuid NOT NULL REFERENCES usuario (id),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid,
  CHECK ((estatus = 'FACTURADA') = (cfdi_id IS NOT NULL))
);
-- Un ticket tiene a lo más una solicitud activa.
CREATE UNIQUE INDEX solicitud_factura_venta ON solicitud_factura (venta_id) WHERE estatus <> 'CANCELADA';

-- Los datos fiscales no cambian: si están mal, se cancela la solicitud y se captura otra.
CREATE FUNCTION solicitud_factura_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE libres text[] := ARRAY['estatus', 'cfdi_id', 'motivo_cancelacion', 'cancelo_id', 'actualizado_en', 'actualizado_por'];
BEGIN
  IF (to_jsonb(NEW) - libres) <> (to_jsonb(OLD) - libres) THEN
    RAISE EXCEPTION 'Los datos de una solicitud de factura no se modifican: cancélala y captura otra.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.estatus = 'CANCELADA' THEN
    RAISE EXCEPTION 'La solicitud ya está cancelada.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER solicitud_factura_validar BEFORE UPDATE ON solicitud_factura FOR EACH ROW EXECUTE FUNCTION solicitud_factura_validar();

-- ---------------------------------------------------------------------------
-- Recibo de anticipo (P64): folio propio para el comprobante que se entrega.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE anticipo_folio;
ALTER TABLE anticipo ADD COLUMN folio text UNIQUE DEFAULT 'REC-' || lpad(nextval('anticipo_folio')::text, 6, '0');
ALTER TABLE anticipo ALTER COLUMN folio SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Configuración
-- ---------------------------------------------------------------------------
INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, minimo, maximo, provisional, permiso_editar) VALUES
  ('fiscal.dias_solicitud', 'Facturación', 'Días después de la compra en que todavía se acepta una solicitud de factura de un ticket (P49: 0 = solo el mismo día). Además, un ticket ya incluido en la factura global no se factura aparte.', 'entero', '0', 0, 31, false, 'configuracion.parametros:editar'),
  ('fiscal.tolerancia_importe', 'Facturación', 'Diferencia aceptable, en pesos, entre los importes de la factura descargada del portal del SAT y los de sus tickets (redondeo).', 'decimal', '0.10', 0, 10, true, 'configuracion.parametros:editar');

-- ---------------------------------------------------------------------------
-- Auditoría y prohibición de borrado
-- ---------------------------------------------------------------------------
SELECT auditar_tabla(t) FROM unnest(ARRAY['cfdi_emitido', 'cfdi_venta', 'solicitud_factura']::regclass[]) AS t;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cfdi_emitido', 'cfdi_venta', 'solicitud_factura'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION rechazar_borrado()', t || '_sin_borrado', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado()', t || '_sin_truncate', t);
  END LOOP;
END $$;
