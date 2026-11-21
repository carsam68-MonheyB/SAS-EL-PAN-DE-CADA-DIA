-- =============================================================================
-- 0006 · Decisión del negocio (21/11/2026, P33b): el precio de venta al público
-- YA INCLUYE impuestos. El POS y el CFDI desglosan los impuestos a partir del
-- precio (no se suman al cobrar).
-- =============================================================================
INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, provisional, permiso_editar) VALUES
  ('precios.incluyen_impuestos', 'Ventas', 'El precio de venta al público ya incluye impuestos (IVA/IEPS se desglosan, no se suman)', 'booleano', 'si', false, 'configuracion.parametros:editar');
