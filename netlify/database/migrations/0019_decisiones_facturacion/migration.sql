-- Decisiones del negocio sobre la facturación (22/11/2026):
--  * Al cliente se le piden sus datos el día de la compra y la factura le llega
--    por correo al día siguiente. El correo es obligatorio en la solicitud y se
--    registra cuándo se envió la factura.
--  * Un ticket con solicitud pendiente no entra en la factura global del día.

ALTER TABLE solicitud_factura ADD COLUMN enviada_en timestamptz;
ALTER TABLE solicitud_factura ADD COLUMN enviada_por uuid REFERENCES usuario (id);
ALTER TABLE solicitud_factura ADD CONSTRAINT solicitud_factura_enviada CHECK (enviada_en IS NULL OR estatus = 'FACTURADA');

CREATE OR REPLACE FUNCTION solicitud_factura_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE libres text[] := ARRAY['estatus', 'cfdi_id', 'motivo_cancelacion', 'cancelo_id', 'enviada_en', 'enviada_por', 'actualizado_en', 'actualizado_por'];
BEGIN
  IF (to_jsonb(NEW) - libres) <> (to_jsonb(OLD) - libres) THEN
    RAISE EXCEPTION 'Los datos de una solicitud de factura no se modifican: cancélala y captura otra.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.estatus = 'CANCELADA' THEN
    RAISE EXCEPTION 'La solicitud ya está cancelada.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, minimo, maximo, provisional, permiso_editar) VALUES
  ('fiscal.dias_entrega_factura', 'Facturación', 'Días después de la compra en que la factura debe llegar al cliente por correo (decisión del negocio: al día siguiente). Las solicitudes que pasen de este plazo sin factura enviada se marcan como atrasadas.', 'entero', '1', 0, 31, false, 'configuracion.parametros:editar');
