-- Fase 5 · Producción y costos
--  * Órdenes de producción N1 (masas e intermedios, en kg) y N2 (productos, en piezas),
--    generadas desde un plan aprobado o capturadas a mano, con la versión de receta congelada.
--  * Las órdenes N2 dependen de las N1 que les dan la masa (trazabilidad).
--  * Vale de surtido por orden (materia prima → PEP) contra lo estándar.
--  * Avance por etapa con piezas y merma por causa.
--  * Cierre: consumo real desde PEP (CONSUMO_PRODUCCION) y entrada del producto
--    (ENTRADA_PRODUCCION) al costo real = materiales consumidos + mano de obra + indirectos aplicados.
--  * Balance de masa y de piezas, variaciones contra el estándar y genealogía de lotes.

-- ---------------------------------------------------------------------------
-- Órdenes
-- ---------------------------------------------------------------------------
CREATE SEQUENCE orden_produccion_folio;
CREATE TABLE orden_produccion (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio               text NOT NULL UNIQUE DEFAULT 'OP-' || lpad(nextval('orden_produccion_folio')::text, 6, '0'),
  plan_id             uuid REFERENCES plan_produccion (id),
  nivel               text NOT NULL CHECK (nivel IN ('N1', 'N2')),
  articulo_id         uuid NOT NULL REFERENCES articulo (id),
  receta_id           uuid NOT NULL REFERENCES receta (id),
  receta_version      integer NOT NULL,
  fecha               date NOT NULL,                                  -- día de producción (recetas, tarifas y costo estándar)
  almacen_pep_id      uuid NOT NULL REFERENCES almacen (id),          -- de donde se consume
  almacen_destino_id  uuid NOT NULL REFERENCES almacen (id),          -- PEP (N1) o PT (N2)
  cantidad_plan       numeric(18, 6) NOT NULL CHECK (cantidad_plan > 0),   -- kg (N1) o piezas buenas (N2)
  lotes_plan          numeric(18, 6),                                 -- solo N1
  formadas_plan       numeric(18, 6),                                 -- solo N2: piezas a formar
  estatus             text NOT NULL DEFAULT 'LIBERADA' CHECK (estatus IN ('LIBERADA', 'EN_PROCESO', 'CERRADA', 'CANCELADA')),
  -- Al cierre
  cantidad_real       numeric(18, 6) CHECK (cantidad_real >= 0),
  piezas_formadas     numeric(18, 6) CHECK (piezas_formadas >= 0),
  costo_mp            numeric(20, 6),
  costo_mod           numeric(20, 6),
  costo_gif           numeric(20, 6),
  costo_total         numeric(20, 6),
  costo_unitario      numeric(18, 6),
  costo_estandar      numeric(18, 6),                                 -- costo estándar unitario a la fecha de la orden
  minutos_reales      numeric(18, 4),
  balance             jsonb,                                          -- foto del balance de masa y piezas, y variaciones
  fuera_tolerancia    boolean NOT NULL DEFAULT false,
  justificacion       text,
  consumo_id          uuid REFERENCES movimiento (id),
  entrada_id          uuid REFERENCES movimiento (id),
  lote_id             uuid REFERENCES lote (id),
  comentario          text,
  liberada_por        uuid NOT NULL REFERENCES usuario (id),
  iniciada_por        uuid REFERENCES usuario (id),
  iniciada_en         timestamptz,
  cerrada_por         uuid REFERENCES usuario (id),
  cerrada_en          timestamptz,
  cancelada_por       uuid REFERENCES usuario (id),
  cancelada_en        timestamptz,
  motivo_cancelacion  text,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  creado_por          uuid DEFAULT usuario_actual(),
  actualizado_en      timestamptz,
  actualizado_por     uuid,
  CHECK (nivel = 'N1' OR lotes_plan IS NULL),
  CHECK (nivel = 'N2' OR formadas_plan IS NULL),
  CHECK (estatus <> 'CERRADA' OR (cantidad_real IS NOT NULL AND costo_total IS NOT NULL AND cerrada_por IS NOT NULL)),
  CHECK (estatus <> 'CANCELADA' OR motivo_cancelacion IS NOT NULL),
  CHECK (NOT fuera_tolerancia OR justificacion IS NOT NULL)
);
CREATE INDEX orden_produccion_plan ON orden_produccion (plan_id);
CREATE INDEX orden_produccion_fecha ON orden_produccion (fecha, estatus);
-- Del plan sale una sola orden activa por artículo.
CREATE UNIQUE INDEX orden_produccion_plan_articulo ON orden_produccion (plan_id, articulo_id) WHERE plan_id IS NOT NULL AND estatus <> 'CANCELADA';

-- Una orden cerrada o cancelada ya no cambia.
CREATE FUNCTION orden_produccion_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estatus IN ('CERRADA', 'CANCELADA') THEN
    RAISE EXCEPTION 'La orden % está %: ya no se modifica.', OLD.folio, lower(OLD.estatus) USING ERRCODE = 'P0001';
  END IF;
  IF NEW.folio <> OLD.folio OR NEW.nivel <> OLD.nivel OR NEW.articulo_id <> OLD.articulo_id OR NEW.receta_id <> OLD.receta_id
     OR NEW.fecha <> OLD.fecha OR NEW.almacen_pep_id <> OLD.almacen_pep_id OR NEW.almacen_destino_id <> OLD.almacen_destino_id
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    RAISE EXCEPTION 'No se cambia el producto, la receta, la fecha ni los almacenes de una orden.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orden_produccion_validar BEFORE UPDATE ON orden_produccion FOR EACH ROW EXECUTE FUNCTION orden_produccion_validar();

-- Componentes de la orden: estándar congelado al liberar y consumo real al cerrar
-- (lo surtido se calcula de los vales de la orden que no están cancelados).
CREATE TABLE orden_componente (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id            uuid NOT NULL REFERENCES orden_produccion (id),
  articulo_id         uuid NOT NULL REFERENCES articulo (id),
  tipo                text NOT NULL CHECK (tipo IN ('MASA', 'INTERMEDIO', 'INSUMO', 'EMPAQUE')),
  cantidad_estandar   numeric(18, 6) NOT NULL CHECK (cantidad_estandar >= 0),   -- para la cantidad planeada, en unidad base
  cantidad_real       numeric(18, 6) CHECK (cantidad_real >= 0),
  estandar_real       numeric(18, 6),                                            -- estándar recalculado para lo realmente producido
  importe_real        numeric(20, 6),
  costo_estandar      numeric(18, 6),                                            -- costo unitario estándar del componente
  creado_en           timestamptz NOT NULL DEFAULT now(),
  creado_por          uuid DEFAULT usuario_actual(),
  actualizado_en      timestamptz,
  actualizado_por     uuid,
  UNIQUE (orden_id, articulo_id)
);

-- Etapas de la orden con sus minutos estándar (para la cantidad planeada) y reales.
CREATE TABLE orden_etapa (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id            uuid NOT NULL REFERENCES orden_produccion (id),
  etapa_id            uuid NOT NULL REFERENCES etapa_produccion (id),
  minutos_estandar    numeric(18, 4) NOT NULL CHECK (minutos_estandar >= 0),
  minutos_reales      numeric(18, 4) CHECK (minutos_reales >= 0),
  costo_minuto        numeric(18, 6),
  importe             numeric(20, 6),
  creado_en           timestamptz NOT NULL DEFAULT now(),
  creado_por          uuid DEFAULT usuario_actual(),
  actualizado_en      timestamptz,
  actualizado_por     uuid,
  UNIQUE (orden_id, etapa_id)
);

-- La orden de un producto (N2) toma su masa de las órdenes N1 del mismo plan.
CREATE TABLE orden_dependencia (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id            uuid NOT NULL REFERENCES orden_produccion (id),
  orden_origen_id     uuid NOT NULL REFERENCES orden_produccion (id),
  cantidad            numeric(18, 6) NOT NULL CHECK (cantidad >= 0),
  creado_en           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (orden_id, orden_origen_id),
  CHECK (orden_id <> orden_origen_id)
);
CREATE TRIGGER orden_dependencia_inmutable BEFORE UPDATE OR DELETE ON orden_dependencia FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- Avance por etapa (solo inserción): piezas que pasan y merma con su causa.
CREATE TABLE orden_avance (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id            uuid NOT NULL REFERENCES orden_produccion (id),
  etapa_id            uuid NOT NULL REFERENCES etapa_produccion (id),
  cantidad            numeric(18, 6) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),   -- piezas (N2) o kg (N1) que terminaron la etapa
  merma               numeric(18, 6) NOT NULL DEFAULT 0 CHECK (merma >= 0),
  causa_id            uuid REFERENCES causa_merma (id),
  minutos             numeric(18, 4) CHECK (minutos >= 0),
  comentario          text,
  usuario_id          uuid NOT NULL REFERENCES usuario (id),
  creado_en           timestamptz NOT NULL DEFAULT now(),
  CHECK (merma = 0 OR causa_id IS NOT NULL),
  CHECK (cantidad > 0 OR merma > 0 OR minutos > 0)
);
CREATE INDEX orden_avance_orden ON orden_avance (orden_id, creado_en);
CREATE TRIGGER orden_avance_inmutable BEFORE UPDATE OR DELETE ON orden_avance FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- Genealogía: qué lotes (o qué órdenes, si el artículo no maneja lote) se consumieron en cada orden.
CREATE TABLE lote_genealogia (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id            uuid NOT NULL REFERENCES orden_produccion (id),
  lote_hijo_id        uuid REFERENCES lote (id),
  articulo_padre_id   uuid NOT NULL REFERENCES articulo (id),
  lote_padre_id       uuid REFERENCES lote (id),
  cantidad            numeric(18, 6) NOT NULL CHECK (cantidad > 0),
  importe             numeric(20, 6) NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lote_genealogia_padre ON lote_genealogia (lote_padre_id);
CREATE INDEX lote_genealogia_orden ON lote_genealogia (orden_id);
CREATE TRIGGER lote_genealogia_inmutable BEFORE UPDATE OR DELETE ON lote_genealogia FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- El vale de surtido puede pertenecer a una orden.
ALTER TABLE surtido ADD COLUMN orden_id uuid REFERENCES orden_produccion (id);
CREATE INDEX surtido_orden ON surtido (orden_id);

-- ---------------------------------------------------------------------------
-- Kárdex: consumo de producción y documento ORDEN_PRODUCCION
-- ---------------------------------------------------------------------------
ALTER TABLE movimiento DROP CONSTRAINT movimiento_tipo_check;
ALTER TABLE movimiento ADD CONSTRAINT movimiento_tipo_check CHECK (tipo IN (
  'INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_PRODUCCION', 'SURTIDO_SALIDA', 'SURTIDO_ENTRADA', 'TRASPASO_ENVIO', 'TRASPASO_RECEPCION',
  'MERMA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'CANCELACION', 'VENTA', 'DEVOLUCION_VENTA', 'CONSUMO_PRODUCCION'));
ALTER TABLE movimiento DROP CONSTRAINT movimiento_documento_tipo_check;
ALTER TABLE movimiento ADD CONSTRAINT movimiento_documento_tipo_check CHECK (documento_tipo IN (
  'CARGA', 'SURTIDO', 'TRASPASO', 'MERMA', 'CONTEO', 'VENTA', 'DEVOLUCION', 'RECEPCION', 'ORDEN_PRODUCCION'));

-- ---------------------------------------------------------------------------
-- Configuración (provisional: la confirma el negocio, P33)
-- ---------------------------------------------------------------------------
INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, minimo, maximo, provisional, permiso_editar) VALUES
  ('produccion.tolerancia_masa_pct', 'Producción', 'Balance de masa: diferencia aceptable entre la masa consumida y la que corresponde a las piezas formadas, en %. Fuera de ella, el cierre exige justificación.', 'decimal', '3', 0, 100, true, 'configuracion.parametros:editar'),
  ('produccion.tolerancia_piezas_pct', 'Producción', 'Balance de piezas: diferencia aceptable entre las piezas buenas y las esperadas por la receta, en %. Fuera de ella, el cierre exige justificación.', 'decimal', '5', 0, 100, true, 'configuracion.parametros:editar'),
  ('produccion.tolerancia_consumo_pct', 'Producción', 'Diferencia aceptable entre el consumo real de cada material y su estándar, en %. Fuera de ella, el cierre exige justificación.', 'decimal', '5', 0, 100, true, 'configuracion.parametros:editar'),
  ('produccion.tolerancia_surtido_pct', 'Producción', 'Un vale de surtido de una orden puede pasar del estándar hasta este % sin escribir el motivo.', 'decimal', '5', 0, 100, true, 'configuracion.parametros:editar');
INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, provisional, permiso_editar, opciones) VALUES
  ('produccion.permitir_entrada_directa', 'Producción', 'SI = permite la "entrada de producción terminada" directa de la Fase 3, sin orden de producción. Desde la Fase 5 la producción entra al cerrar su orden.', 'texto', 'NO', true, 'configuracion.parametros:editar', ARRAY['SI', 'NO']);

-- ---------------------------------------------------------------------------
-- Permisos: el contralor y el contador consultan costos de producción
-- ---------------------------------------------------------------------------
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM rol r CROSS JOIN permiso p
 WHERE (r.clave IN ('CON', 'CNT', 'DIR') AND p.clave IN ('produccion.ordenes:ver', 'produccion.ordenes:exportar'))
    OR (r.clave = 'ALM' AND p.clave = 'produccion.ordenes:ver')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Auditoría y prohibición de borrado
-- ---------------------------------------------------------------------------
SELECT auditar_tabla(t) FROM unnest(ARRAY[
  'orden_produccion', 'orden_componente', 'orden_etapa', 'orden_dependencia', 'orden_avance', 'lote_genealogia'
]::regclass[]) AS t;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orden_produccion', 'orden_componente', 'orden_etapa'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION rechazar_borrado()', t || '_sin_borrado', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['orden_produccion', 'orden_componente', 'orden_etapa', 'orden_dependencia', 'orden_avance', 'lote_genealogia'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado()', t || '_sin_truncate', t);
  END LOOP;
END $$;
