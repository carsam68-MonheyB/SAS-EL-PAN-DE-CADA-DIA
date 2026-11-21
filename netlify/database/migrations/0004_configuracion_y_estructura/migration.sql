-- =============================================================================
-- 0004 · Configuración inicial y estructura aprobada del negocio
-- -----------------------------------------------------------------------------
-- Los valores marcados provisional = true NO vienen de datos del negocio: son
-- un punto de partida para poder operar y se cambian desde la pantalla de
-- configuración (quedan en la bitácora). Ver docs/fase-0/01-preguntas (P18).
-- =============================================================================

INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, minimo, maximo, provisional, permiso_editar) VALUES
  ('seguridad.password_longitud_minima', 'Seguridad', 'Longitud mínima de la contraseña', 'entero', '10', 8, 64, true, 'seguridad.configuracion:editar'),
  ('seguridad.intentos_maximos', 'Seguridad', 'Intentos fallidos de contraseña antes de bloquear al usuario', 'entero', '5', 3, 10, true, 'seguridad.configuracion:editar'),
  ('seguridad.minutos_bloqueo', 'Seguridad', 'Minutos que dura el bloqueo por intentos fallidos', 'entero', '15', 1, 1440, true, 'seguridad.configuracion:editar'),
  ('seguridad.minutos_inactividad_oficina', 'Seguridad', 'Minutos sin actividad para cerrar la sesión (oficina)', 'entero', '30', 5, 480, true, 'seguridad.configuracion:editar'),
  ('seguridad.minutos_inactividad_pos', 'Seguridad', 'Minutos sin actividad para cerrar la sesión de una caja', 'entero', '720', 30, 1440, true, 'seguridad.configuracion:editar'),
  ('seguridad.horas_sesion_maxima', 'Seguridad', 'Duración máxima de una sesión, aunque haya actividad (horas)', 'entero', '12', 1, 24, true, 'seguridad.configuracion:editar'),
  ('seguridad.pin_digitos', 'Seguridad', 'Dígitos del PIN de cajero', 'entero', '4', 4, 8, true, 'seguridad.configuracion:editar'),
  ('seguridad.pin_intentos_maximos', 'Seguridad', 'Intentos fallidos de PIN antes de bloquear el PIN', 'entero', '5', 3, 10, true, 'seguridad.configuracion:editar'),
  ('seguridad.horas_vigencia_invitacion', 'Seguridad', 'Horas de vigencia de una invitación o restablecimiento', 'entero', '72', 1, 720, true, 'seguridad.configuracion:editar'),
  ('general.zona_horaria', 'General', 'Zona horaria del negocio', 'texto', 'America/Mexico_City', NULL, NULL, false, 'configuracion.parametros:editar'),
  ('general.redondeo_importes', 'General', 'Regla de redondeo de importes a 2 decimales (mitad_arriba = 0.005 sube)', 'texto', 'mitad_arriba', NULL, NULL, true, 'configuracion.parametros:editar'),
  ('consumo.creditos_por_hora_bd', 'Consumo Netlify', 'Créditos por hora de base activa por unidad de cómputo (tarifa Netlify)', 'decimal', '10', 0, NULL, false, 'configuracion.parametros:editar'),
  ('consumo.unidades_computo_minimas', 'Consumo Netlify', 'Unidades de cómputo mínimas configuradas en el panel de Netlify', 'decimal', '1', 0.25, 64, false, 'configuracion.parametros:editar'),
  ('consumo.minutos_sueno_bd', 'Consumo Netlify', 'Minutos sin consultas para que la base se duerma (panel de Netlify)', 'entero', '5', 5, 180, false, 'configuracion.parametros:editar'),
  ('consumo.creditos_plan_mes', 'Consumo Netlify', 'Créditos incluidos en el plan al mes (Personal: 1,000)', 'entero', '1000', 0, NULL, false, 'configuracion.parametros:editar');

-- Estructura aprobada en la Fase 0 (P08–P11). Claves provisionales; los
-- nombres se cambian en el catálogo.
INSERT INTO sucursal (clave, nombre, es_planta, vende_al_publico) VALUES
  ('MAT', 'Matriz', true, true),
  ('SUC1', 'Sucursal 1', false, true);

INSERT INTO almacen (clave, nombre, tipo, sucursal_id)
SELECT v.clave, v.nombre, v.tipo, s.id FROM (VALUES
  ('MP-MAT', 'Materia prima · Matriz', 'MP', 'MAT'),
  ('PEP-MAT', 'Producción en proceso · Matriz', 'PEP', 'MAT'),
  ('PT-MAT', 'Producto terminado · Matriz (planta y mostrador)', 'PT', 'MAT'),
  ('PT-SUC1', 'Producto terminado · Sucursal 1', 'PT', 'SUC1')
) AS v(clave, nombre, tipo, sucursal) JOIN sucursal s ON s.clave = v.sucursal;

INSERT INTO caja (clave, nombre, sucursal_id)
SELECT v.clave, v.nombre, s.id FROM (VALUES
  ('CAJA-MAT-1', 'Caja 1 · Matriz', 'MAT'),
  ('CAJA-SUC1-1', 'Caja 1 · Sucursal 1', 'SUC1')
) AS v(clave, nombre, sucursal) JOIN sucursal s ON s.clave = v.sucursal;
