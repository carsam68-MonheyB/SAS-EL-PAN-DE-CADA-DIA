-- Decisiones del negocio sobre la Fase 6 (22/11/2026):
--  * P47: se aceptan efectivo, tarjeta de crédito, tarjeta de débito y transferencia.
--  * P50: los descuentos en caja los autoriza el contador (CNT) o el contralor (CON).
--  * P48: el fondo de caja se define cada día al abrir el turno.
--  * P59: los pedidos también se toman por WhatsApp o teléfono (desde oficina).
--  * P60: no hay anticipo mínimo; un pedido sin anticipo lo autoriza el contador o el contralor.
--  * P43: ante una urgencia la caja debe poder vender sin internet (ventas en cola).
--  * P46: no se vende pan por peso.
-- La matriz (datos-iniciales/matriz-puestos.json) se actualizó igual.

INSERT INTO permiso (clave, grupo, modulo, modulo_nombre, accion, orden)
SELECT m.modulo || ':' || a.accion, 'Punto de venta', m.modulo, m.nombre, a.accion, 400 + m.n * 10 + a.n
  FROM (VALUES ('pos.descuentos', 'Descuentos en caja', 1), ('pos.pedidos_sin_anticipo', 'Pedidos sin anticipo', 2)) AS m(modulo, nombre, n)
 CROSS JOIN (VALUES ('ver', 0), ('crear', 1), ('editar', 2), ('cancelar', 3), ('autorizar', 4), ('cerrar', 5), ('exportar', 6), ('imprimir', 7), ('importar', 8)) AS a(accion, n);

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r CROSS JOIN permiso p
 WHERE r.clave IN ('CON', 'CNT')
   AND p.clave IN ('pos.descuentos:ver', 'pos.descuentos:autorizar', 'pos.pedidos_sin_anticipo:ver', 'pos.pedidos_sin_anticipo:autorizar')
ON CONFLICT DO NOTHING;

-- Pedidos: canal por el que se tomó y quién autorizó que no lleve anticipo.
ALTER TABLE pedido ADD COLUMN origen text NOT NULL DEFAULT 'MOSTRADOR' CHECK (origen IN ('MOSTRADOR', 'TELEFONO', 'WHATSAPP'));
ALTER TABLE pedido ADD COLUMN autorizo_sin_anticipo_id uuid REFERENCES usuario (id);

-- Ventas hechas sin conexión: se registran al volver el internet con su hora real y su folio provisional.
ALTER TABLE venta ADD COLUMN sin_conexion boolean NOT NULL DEFAULT false;
ALTER TABLE venta ADD COLUMN fecha_caja timestamptz;
ALTER TABLE venta ADD COLUMN folio_local text;

UPDATE configuracion
   SET valor = '0', provisional = false,
       descripcion = 'Anticipo mínimo de un pedido, en % del total (P60, decidido: sin mínimo). Un pedido sin anticipo lo autoriza el contador o el contralor.'
 WHERE clave = 'pos.anticipo_minimo_pct';
