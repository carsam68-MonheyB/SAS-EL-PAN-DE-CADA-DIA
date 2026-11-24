-- XML descargados del SAT (opción 1, 24/11/2026): el contador baja el ZIP de la
-- descarga masiva del portal del SAT (emitidas y recibidas) y lo sube. El sistema
-- guarda cada XML una sola vez (por UUID), lo clasifica como emitido o recibido
-- según el RFC de la empresa y lo compara con lo registrado en facturación y
-- compras. La e.firma no se guarda en el sistema. Nada se borra ni se modifica.

CREATE TABLE carga_sat (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio         text NOT NULL UNIQUE,
  nombre_archivo text NOT NULL,
  rfc_empresa   text NOT NULL,
  archivos      integer NOT NULL CHECK (archivos >= 0),
  nuevos        integer NOT NULL CHECK (nuevos >= 0),
  repetidos     integer NOT NULL CHECK (repetidos >= 0),
  rechazados    integer NOT NULL CHECK (rechazados >= 0),
  rechazos      jsonb NOT NULL DEFAULT '[]',
  usuario_id    uuid NOT NULL REFERENCES usuario (id),
  creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE carga_sat_folio;

CREATE TABLE cfdi_sat (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cfdi        text NOT NULL UNIQUE CHECK (uuid_cfdi ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'),
  direccion        text NOT NULL CHECK (direccion IN ('EMITIDO', 'RECIBIDO')),
  tipo_comprobante text NOT NULL,
  version          text NOT NULL,
  serie            text,
  folio            text,
  fecha_emision    timestamptz NOT NULL,
  emisor_rfc       text NOT NULL,
  emisor_nombre    text,
  receptor_rfc     text NOT NULL,
  receptor_nombre  text,
  moneda           text NOT NULL,
  subtotal         numeric(18, 2) NOT NULL,
  descuento        numeric(18, 2) NOT NULL DEFAULT 0,
  iva              numeric(18, 2) NOT NULL DEFAULT 0,
  ieps             numeric(18, 2) NOT NULL DEFAULT 0,
  retenciones      numeric(18, 2) NOT NULL DEFAULT 0,
  total            numeric(18, 2) NOT NULL,
  xml              text NOT NULL,
  carga_id         uuid NOT NULL REFERENCES carga_sat (id),
  creado_en        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cfdi_sat_fecha ON cfdi_sat (direccion, fecha_emision);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['carga_sat', 'cfdi_sat'] LOOP
    PERFORM auditar_tabla(t::regclass);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion()', t || '_inmutable', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado()', t || '_sin_truncate', t);
  END LOOP;
END $$;
