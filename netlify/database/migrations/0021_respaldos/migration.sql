-- Fase 9 · Respaldo externo (diseño 1.4)
--  * Cada mes (día 1) y al cierre de cada mes contable se exporta la base completa,
--    se comprime, se cifra (AES-256-GCM con RESPALDO_LLAVE) y se sube a un
--    almacenamiento fuera de Netlify, compatible con S3 y con bloqueo de objetos
--    (Object Lock): nadie puede borrarlo antes del plazo de conservación.
--  * Los XML de facturas emitidas y recibidas se archivan aparte por RFC, año y mes.
--  * Aquí solo queda el registro de cada respaldo (no el archivo). No se borra nada.

CREATE TABLE respaldo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            text NOT NULL CHECK (tipo IN ('MENSUAL', 'CIERRE', 'MANUAL', 'DESCARGA')),
  motivo          text,
  estatus         text NOT NULL DEFAULT 'PENDIENTE' CHECK (estatus IN ('PENDIENTE', 'EN_PROCESO', 'COMPLETO', 'ERROR')),
  destino         text,                       -- llave del objeto en el almacenamiento externo
  bytes           bigint,
  sha256          text,                       -- del archivo cifrado
  tablas          integer,
  filas           bigint,
  retener_hasta   date,
  error           text,
  solicitado_por  uuid REFERENCES usuario (id),
  iniciado_en     timestamptz,
  terminado_en    timestamptz,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);
CREATE INDEX respaldo_pendiente ON respaldo (creado_en) WHERE estatus IN ('PENDIENTE', 'ERROR');

-- XML archivados (uno por UUID).
CREATE TABLE respaldo_cfdi (
  uuid_cfdi       text PRIMARY KEY,
  origen          text NOT NULL CHECK (origen IN ('EMITIDO', 'RECIBIDO')),
  destino         text NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER respaldo_cfdi_inmutable BEFORE UPDATE OR DELETE ON respaldo_cfdi FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, minimo, maximo, provisional, permiso_editar) VALUES
  ('respaldo.anios_conservacion', 'Respaldos', 'Años que el almacenamiento externo conserva cada respaldo sin que nadie pueda borrarlo (Object Lock). El CFF (art. 30) habla en general de 5 años: confírmalo con tu contador.', 'entero', '5', 1, 15, true, 'seguridad.configuracion:editar');

SELECT auditar_tabla(t) FROM unnest(ARRAY['respaldo', 'respaldo_cfdi']::regclass[]) AS t;
CREATE TRIGGER respaldo_sin_borrado BEFORE DELETE ON respaldo FOR EACH ROW EXECUTE FUNCTION rechazar_borrado();
CREATE TRIGGER respaldo_sin_truncate BEFORE TRUNCATE ON respaldo FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado();
CREATE TRIGGER respaldo_cfdi_sin_truncate BEFORE TRUNCATE ON respaldo_cfdi FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado();
