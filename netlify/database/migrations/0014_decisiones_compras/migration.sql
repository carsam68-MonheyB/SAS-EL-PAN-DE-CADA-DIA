-- Decisiones del negocio sobre la Fase 4 (22/11/2026):
--  * P33: se aceptan las tolerancias propuestas (OC 5 %, cantidad 0 %, precio 1 %, $1.00 por redondeo).
--    Siguen editables en Configuración → Compras para ajustarlas cuando haga falta.
--  * P41: la orden de compra se imprime o se guarda en PDF; no se envía por correo desde el sistema.
--  * P42: se confirma el flujo de pago: el contador programa, autoriza el contralor o dirección según
--    el monto y el contador lo marca pagado con la referencia. Solo se usa un banco: BBVA.
--    La cuenta real (alias y últimos 4 dígitos) la captura el contador en Cuentas bancarias.

UPDATE configuracion SET provisional = false
 WHERE clave IN ('compras.tolerancia_oc_pct', 'compras.tolerancia_cantidad_pct', 'compras.tolerancia_precio_pct', 'compras.tolerancia_importe');
