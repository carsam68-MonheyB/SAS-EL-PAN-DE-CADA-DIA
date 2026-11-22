-- Ofertas de fin del día (P37, 22/11/2026): el pan se vende con descuento antes
-- de terminar el día. El % de descuento y la hora desde la que aplica los
-- captura en el sistema el contador o el contralor; la caja aplica la oferta sola
-- (sin pedir PIN en cada venta). Puede ser para todos los productos, para una
-- familia o para un producto, en todas las sucursales o en una. Gana la más
-- específica (producto > familia > todos; sucursal > todas).

CREATE TABLE oferta (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id     uuid REFERENCES articulo (id),
  familia_id      uuid REFERENCES familia (id),
  sucursal_id     uuid REFERENCES sucursal (id),
  descuento_pct   numeric(5, 2) NOT NULL CHECK (descuento_pct > 0 AND descuento_pct < 100),
  hora_desde      time NOT NULL,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  CHECK (articulo_id IS NULL OR familia_id IS NULL)
);
-- Una sola oferta activa por alcance.
CREATE UNIQUE INDEX oferta_unica ON oferta (
  coalesce(articulo_id, '00000000-0000-0000-0000-000000000000'), coalesce(familia_id, '00000000-0000-0000-0000-000000000000'),
  coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000')) WHERE activo;

-- Qué parte del descuento del renglón es de la oferta (el resto lo autorizó un supervisor).
ALTER TABLE venta_renglon ADD COLUMN oferta_id uuid REFERENCES oferta (id);
ALTER TABLE venta_renglon ADD COLUMN descuento_oferta numeric(14, 2) NOT NULL DEFAULT 0 CHECK (descuento_oferta >= 0);
ALTER TABLE venta_renglon ADD CONSTRAINT venta_renglon_oferta CHECK (descuento_oferta <= descuento AND (descuento_oferta = 0 OR oferta_id IS NOT NULL));

-- El contador y el contralor capturan las ofertas (ya autorizan los descuentos, P50).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r CROSS JOIN permiso p
 WHERE r.clave IN ('CON', 'CNT') AND p.clave = 'pos.descuentos:editar'
ON CONFLICT DO NOTHING;

SELECT auditar_tabla('oferta'::regclass);
CREATE TRIGGER oferta_sin_borrado BEFORE DELETE ON oferta FOR EACH ROW EXECUTE FUNCTION rechazar_borrado();
CREATE TRIGGER oferta_sin_truncate BEFORE TRUNCATE ON oferta FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado();
