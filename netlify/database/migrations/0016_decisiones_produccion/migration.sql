-- Decisiones del negocio sobre la Fase 5 (22/11/2026):
--  * P33: se aceptan las tolerancias de producción propuestas (masa 3 %, piezas 5 %,
--    consumo 5 %, surtido 5 %). Siguen editables en Configuración → Producción.
--  * P37: el pan no vendido se vende en oferta (la forma de registrarla se define aparte).
--  * P63: el pedido especial no se liga a la orden de producción.
--  * P28: las etapas las revisa el negocio con el jefe de panadería (siguen provisionales).

UPDATE configuracion SET provisional = false
 WHERE clave IN ('produccion.tolerancia_masa_pct', 'produccion.tolerancia_piezas_pct', 'produccion.tolerancia_consumo_pct', 'produccion.tolerancia_surtido_pct');
