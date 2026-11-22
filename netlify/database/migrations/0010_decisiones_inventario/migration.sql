-- Decisiones del negocio sobre la Fase 3 (22/11/2026):
--  * P34: valuación por COSTO PROMEDIO (deja de ser provisional; sigue bloqueada
--    en cuanto exista el primer movimiento).
--  * P70: cancelan movimientos de inventario el contralor (CON) y el contador (CNT).
--    La matriz (datos-iniciales/matriz-puestos.json) se actualizó igual.
--  * P38: causas de merma iniciales aprobadas (editables en el catálogo).
--  * P71: no se vende sin existencia de producto terminado (lo aplicará el POS, Fase 6).

UPDATE configuracion
   SET valor = 'PROMEDIO', provisional = false,
       descripcion = 'Método de valuación del inventario (P34, decidido: COSTO PROMEDIO ponderado por almacén). Solo se puede cambiar mientras no haya movimientos de inventario.'
 WHERE clave = 'inventarios.metodo_valuacion';

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r CROSS JOIN permiso p
 WHERE r.clave IN ('CON', 'CNT')
   AND p.clave IN (
     'compras.recepcion:ver', 'compras.recepcion:cancelar',
     'inventarios.surtido:ver', 'inventarios.surtido:cancelar',
     'inventarios.traspasos:ver', 'inventarios.traspasos:cancelar',
     'inventarios.ajustes:ver', 'inventarios.ajustes:cancelar',
     'produccion.ordenes:ver', 'produccion.ordenes:cancelar')
ON CONFLICT DO NOTHING;

INSERT INTO causa_merma (clave, nombre, aplica) VALUES
  ('CADUCADO', 'Producto o insumo caducado', 'TODOS'),
  ('QUEMADO', 'Pieza quemada', 'TODOS'),
  ('DEFORME', 'Pieza deforme o mal formada', 'TODOS'),
  ('NO-VENDIDO', 'Pan no vendido al cierre', 'PT'),
  ('DANADO', 'Producto, insumo o empaque dañado', 'TODOS');
