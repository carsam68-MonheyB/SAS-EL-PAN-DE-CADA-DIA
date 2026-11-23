-- Anular un avance capturado por error (prueba integral, 23/11/2026): un avance
-- registrado dos veces duplicaba minutos y merma. El avance no se borra ni se
-- modifica: se anula con motivo en una tabla aparte, y los cálculos usan solo
-- los avances vigentes. Solo mientras la orden siga abierta.

CREATE TABLE orden_avance_anulacion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  avance_id   uuid NOT NULL UNIQUE REFERENCES orden_avance (id),
  motivo      text NOT NULL CHECK (length(trim(motivo)) > 0),
  usuario_id  uuid NOT NULL REFERENCES usuario (id),
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER orden_avance_anulacion_inmutable BEFORE UPDATE OR DELETE ON orden_avance_anulacion FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();
CREATE TRIGGER orden_avance_anulacion_sin_truncate BEFORE TRUNCATE ON orden_avance_anulacion FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado();
SELECT auditar_tabla('orden_avance_anulacion'::regclass);

-- Avances que cuentan (los no anulados).
CREATE VIEW orden_avance_vigente AS
SELECT av.* FROM orden_avance av
 WHERE NOT EXISTS (SELECT 1 FROM orden_avance_anulacion x WHERE x.avance_id = av.id);
