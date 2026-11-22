-- =============================================================================
-- 0007 · Recetas multinivel, costo estándar y planeación (Fase 2)
-- -----------------------------------------------------------------------------
--  * Receta N1 (masa o intermedio) = fórmula por lote. Receta N2 (SKU) =
--    componentes por pieza (o por unidad de venta).
--  * Cada receta tiene versiones. Una versión nace en BORRADOR (se puede
--    corregir) y se ACTIVA; una vez activa ya no cambia: se crea otra versión.
--    La versión que aplica en una fecha es la activa con el mayor
--    vigente_desde <= esa fecha.
--  * Etapas, turnos, tarifas de mano de obra y tasas de gastos indirectos los
--    captura el negocio; no se precarga ningún valor.
--  * Nada se borra; todo pasa por la bitácora de auditoría.
-- =============================================================================

-- Valores de configuración con lista cerrada de opciones.
ALTER TABLE configuracion ADD COLUMN opciones text[];

-- ---------------------------------------------------------------------------
-- Catálogos de producción
-- ---------------------------------------------------------------------------
CREATE TABLE etapa_produccion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,20}$'),
  nombre          text NOT NULL,
  orden           integer NOT NULL CHECK (orden > 0),
  registra_merma  boolean NOT NULL DEFAULT false,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);

CREATE TABLE turno_produccion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,20}$'),
  nombre          text NOT NULL,
  hora_inicio     text CHECK (hora_inicio ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  hora_fin        text CHECK (hora_fin ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);

-- Costo de mano de obra directa por minuto, por etapa y con vigencia (P35).
CREATE TABLE tarifa_mod (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  etapa_id        uuid NOT NULL REFERENCES etapa_produccion (id),
  vigente_desde   date NOT NULL,
  costo_minuto    numeric(18, 6) NOT NULL CHECK (costo_minuto >= 0),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  UNIQUE (etapa_id, vigente_desde)
);

-- Tasa predeterminada de gastos indirectos de fabricación por base de prorrateo (P36).
CREATE TABLE tasa_gif (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base            text NOT NULL CHECK (base IN ('KG_MASA', 'MINUTO_MOD', 'PIEZA')),
  vigente_desde   date NOT NULL,
  tasa            numeric(18, 6) NOT NULL CHECK (tasa >= 0),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  UNIQUE (base, vigente_desde)
);

-- ---------------------------------------------------------------------------
-- Recetas y sus versiones
-- ---------------------------------------------------------------------------
CREATE TABLE receta (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id          uuid NOT NULL REFERENCES articulo (id),
  version              integer NOT NULL CHECK (version > 0),
  nivel                text NOT NULL CHECK (nivel IN ('N1', 'N2')),
  estatus              text NOT NULL DEFAULT 'BORRADOR' CHECK (estatus IN ('BORRADOR', 'ACTIVA')),
  vigente_desde        date NOT NULL,
  -- N1: fórmula por lote, en la unidad base del intermedio
  captura              text CHECK (captura IN ('CANTIDAD', 'PCT_PANADERO')),
  tamano_lote          numeric(18, 6) CHECK (tamano_lote > 0),
  rendimiento_lote     numeric(18, 6) CHECK (rendimiento_lote > 0),
  merma_proceso_pct    numeric(9, 4) CHECK (merma_proceso_pct >= 0 AND merma_proceso_pct < 100),
  regla_lote           text CHECK (regla_lote IN ('COMPLETO', 'EXACTO')),
  capacidad_amasadora  numeric(18, 6) CHECK (capacidad_amasadora > 0),
  -- N2: por pieza (o unidad de venta)
  merma_formado_pct    numeric(9, 4) CHECK (merma_formado_pct >= 0 AND merma_formado_pct < 100),
  merma_horneado_pct   numeric(9, 4) CHECK (merma_horneado_pct >= 0 AND merma_horneado_pct < 100),
  piezas_por_lote      numeric(18, 4) CHECK (piezas_por_lote > 0),
  comentario           text,
  activada_por         uuid REFERENCES usuario (id),
  activada_en          timestamptz,
  activo               boolean NOT NULL DEFAULT true,   -- requerido por el motor de layouts (no se usa para dar de baja versiones)
  creado_en            timestamptz NOT NULL DEFAULT now(),
  creado_por           uuid DEFAULT usuario_actual(),
  actualizado_en       timestamptz,
  actualizado_por      uuid,
  UNIQUE (articulo_id, version),
  CHECK (nivel = 'N1' OR (captura IS NULL AND regla_lote IS NULL AND tamano_lote IS NULL AND rendimiento_lote IS NULL)),
  CHECK (nivel = 'N2' OR (merma_formado_pct IS NULL AND merma_horneado_pct IS NULL AND piezas_por_lote IS NULL)),
  CHECK (nivel = 'N2' OR (captura IS NOT NULL AND regla_lote IS NOT NULL)),
  CHECK (captura IS DISTINCT FROM 'PCT_PANADERO' OR tamano_lote IS NOT NULL)
);
-- Dos versiones activas no pueden empezar el mismo día.
CREATE UNIQUE INDEX receta_activa_fecha ON receta (articulo_id, vigente_desde) WHERE estatus = 'ACTIVA';

CREATE TABLE receta_componente (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receta_articulo_id uuid NOT NULL,
  receta_version     integer NOT NULL,
  tipo               text NOT NULL CHECK (tipo IN ('MASA', 'INTERMEDIO', 'INSUMO', 'EMPAQUE')),
  componente_id      uuid NOT NULL REFERENCES articulo (id),
  cantidad           numeric(18, 6) CHECK (cantidad > 0),
  unidad_id          uuid REFERENCES unidad (id),
  pct_panadero       numeric(12, 6) CHECK (pct_panadero > 0),
  merma_pct          numeric(9, 4) NOT NULL DEFAULT 0 CHECK (merma_pct >= 0 AND merma_pct < 100),
  activo             boolean NOT NULL DEFAULT true,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  creado_por         uuid DEFAULT usuario_actual(),
  actualizado_en     timestamptz,
  actualizado_por    uuid,
  FOREIGN KEY (receta_articulo_id, receta_version) REFERENCES receta (articulo_id, version),
  UNIQUE (receta_articulo_id, receta_version, componente_id),
  CHECK (receta_articulo_id <> componente_id),
  CHECK ((cantidad IS NULL) = (unidad_id IS NULL)),
  CHECK ((cantidad IS NULL) <> (pct_panadero IS NULL))
);

CREATE TABLE receta_etapa (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receta_articulo_id uuid NOT NULL,
  receta_version     integer NOT NULL,
  etapa_id           uuid NOT NULL REFERENCES etapa_produccion (id),
  minutos            numeric(12, 4) NOT NULL CHECK (minutos > 0),
  base               text NOT NULL CHECK (base IN ('LOTE', 'PIEZA')),
  activo             boolean NOT NULL DEFAULT true,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  creado_por         uuid DEFAULT usuario_actual(),
  actualizado_en     timestamptz,
  actualizado_por    uuid,
  FOREIGN KEY (receta_articulo_id, receta_version) REFERENCES receta (articulo_id, version),
  UNIQUE (receta_articulo_id, receta_version, etapa_id)
);

-- El nivel de la receta corresponde al tipo de artículo; una versión activa no cambia.
CREATE FUNCTION receta_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_tipo text;
BEGIN
  SELECT tipo INTO v_tipo FROM articulo WHERE id = NEW.articulo_id;
  IF NOT ((v_tipo = 'INTERMEDIO' AND NEW.nivel = 'N1') OR (v_tipo = 'SKU' AND NEW.nivel = 'N2')) THEN
    RAISE EXCEPTION 'Una receta % no corresponde a un artículo de tipo %.', NEW.nivel, v_tipo USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.estatus = 'ACTIVA' THEN
      RAISE EXCEPTION 'La versión % ya está activa: no se modifica, se crea una versión nueva.', OLD.version USING ERRCODE = 'P0001';
    END IF;
    IF NEW.articulo_id <> OLD.articulo_id OR NEW.version <> OLD.version OR NEW.nivel <> OLD.nivel THEN
      RAISE EXCEPTION 'No se cambia el artículo, la versión ni el nivel de una receta.' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.estatus <> 'BORRADOR' THEN
    RAISE EXCEPTION 'Una receta nueva empieza en BORRADOR.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER receta_validar BEFORE INSERT OR UPDATE ON receta FOR EACH ROW EXECUTE FUNCTION receta_validar();

-- Renglones de fórmula y etapas: solo mientras la versión está en borrador.
CREATE FUNCTION receta_detalle_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_estatus text; v_tipo text;
BEGIN
  SELECT estatus INTO v_estatus FROM receta WHERE articulo_id = NEW.receta_articulo_id AND version = NEW.receta_version;
  IF v_estatus IS DISTINCT FROM 'BORRADOR' THEN
    RAISE EXCEPTION 'La versión % de la receta ya está activa: no se modifica, se crea una versión nueva.', NEW.receta_version USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.receta_articulo_id <> OLD.receta_articulo_id OR NEW.receta_version <> OLD.receta_version) THEN
    RAISE EXCEPTION 'No se cambia la receta de un renglón.' USING ERRCODE = 'P0001';
  END IF;
  IF TG_TABLE_NAME = 'receta_componente' THEN
    SELECT tipo INTO v_tipo FROM articulo WHERE id = NEW.componente_id;
    IF NEW.tipo IS NULL THEN NEW.tipo := v_tipo; END IF;
    IF v_tipo = 'SKU' THEN
      RAISE EXCEPTION 'Un producto terminado no puede ser componente de una receta.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT ((NEW.tipo IN ('MASA', 'INTERMEDIO') AND v_tipo = 'INTERMEDIO') OR NEW.tipo = v_tipo) THEN
      RAISE EXCEPTION 'El componente es de tipo %, no %.', v_tipo, NEW.tipo USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER receta_componente_validar BEFORE INSERT OR UPDATE ON receta_componente FOR EACH ROW EXECUTE FUNCTION receta_detalle_validar();
CREATE TRIGGER receta_etapa_validar BEFORE INSERT OR UPDATE ON receta_etapa FOR EACH ROW EXECUTE FUNCTION receta_detalle_validar();

-- ---------------------------------------------------------------------------
-- Costo estándar: cada cálculo guardado es una foto que no se modifica.
-- ---------------------------------------------------------------------------
CREATE TABLE costeo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha           date NOT NULL,            -- fecha de vigencia usada (recetas, costos y tarifas)
  comentario      text,
  usuario_id      uuid NOT NULL REFERENCES usuario (id),
  creado_en       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE costo_estandar (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  costeo_id             uuid NOT NULL REFERENCES costeo (id),
  receta_id             uuid NOT NULL REFERENCES receta (id),
  articulo_id           uuid NOT NULL REFERENCES articulo (id),
  costo_mp              numeric(24, 10) NOT NULL,
  costo_mod             numeric(24, 10) NOT NULL,
  costo_gif             numeric(24, 10) NOT NULL,
  costo_total           numeric(24, 10) NOT NULL,   -- por unidad base: kg (N1) o pieza (N2)
  completo              boolean NOT NULL,
  precio_sin_impuestos  numeric(24, 10),
  margen                numeric(24, 10),
  desglose              jsonb NOT NULL,
  UNIQUE (costeo_id, articulo_id)
);
CREATE TRIGGER costeo_inmutable BEFORE UPDATE OR DELETE ON costeo FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();
CREATE TRIGGER costo_estandar_inmutable BEFORE UPDATE OR DELETE ON costo_estandar FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- ---------------------------------------------------------------------------
-- Plan de producción
-- ---------------------------------------------------------------------------
CREATE SEQUENCE plan_produccion_folio;
CREATE TABLE plan_produccion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio            text NOT NULL UNIQUE DEFAULT 'PLAN-' || lpad(nextval('plan_produccion_folio')::text, 6, '0'),
  fecha            date NOT NULL,
  turno_id         uuid REFERENCES turno_produccion (id),
  sucursal_id      uuid REFERENCES sucursal (id),
  estatus          text NOT NULL DEFAULT 'BORRADOR' CHECK (estatus IN ('BORRADOR', 'APROBADO', 'CANCELADO')),
  explosion        jsonb,        -- foto del cálculo al aprobar
  aprobado_por     uuid REFERENCES usuario (id),
  aprobado_en      timestamptz,
  cancelado_por    uuid REFERENCES usuario (id),
  cancelado_en     timestamptz,
  motivo_cancelacion text,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid
);
CREATE UNIQUE INDEX plan_produccion_unico ON plan_produccion (
  fecha,
  coalesce(turno_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE estatus <> 'CANCELADO';

-- Renglones del plan. fecha, turno y sucursal se repiten para que el layout
-- los use como llave; el plan se crea solo con el primer renglón.
CREATE TABLE plan_renglon (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES plan_produccion (id),
  fecha            date NOT NULL,
  turno_id         uuid REFERENCES turno_produccion (id),
  sucursal_id      uuid REFERENCES sucursal (id),
  articulo_id      uuid NOT NULL REFERENCES articulo (id),
  piezas           numeric(18, 4) NOT NULL CHECK (piezas >= 0),
  activo           boolean NOT NULL DEFAULT true,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid,
  UNIQUE (plan_id, articulo_id)
);

CREATE FUNCTION plan_renglon_asignar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_plan uuid; v_estatus text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.plan_id <> OLD.plan_id OR NEW.articulo_id <> OLD.articulo_id OR NEW.fecha <> OLD.fecha
       OR NEW.turno_id IS DISTINCT FROM OLD.turno_id OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id THEN
      RAISE EXCEPTION 'No se cambia el plan ni el producto de un renglón.' USING ERRCODE = 'P0001';
    END IF;
    v_plan := NEW.plan_id;
  ELSE
    SELECT id INTO v_plan FROM plan_produccion
     WHERE fecha = NEW.fecha AND turno_id IS NOT DISTINCT FROM NEW.turno_id
       AND sucursal_id IS NOT DISTINCT FROM NEW.sucursal_id AND estatus <> 'CANCELADO';
    IF v_plan IS NULL THEN
      INSERT INTO plan_produccion (fecha, turno_id, sucursal_id) VALUES (NEW.fecha, NEW.turno_id, NEW.sucursal_id) RETURNING id INTO v_plan;
    END IF;
    NEW.plan_id := v_plan;
  END IF;
  SELECT estatus INTO v_estatus FROM plan_produccion WHERE id = v_plan;
  IF v_estatus <> 'BORRADOR' THEN
    RAISE EXCEPTION 'El plan está %: ya no se modifica.', v_estatus USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT tipo FROM articulo WHERE id = NEW.articulo_id) <> 'SKU' THEN
    RAISE EXCEPTION 'El plan de producción solo lleva productos terminados (SKU).' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_renglon_asignar BEFORE INSERT OR UPDATE ON plan_renglon FOR EACH ROW EXECUTE FUNCTION plan_renglon_asignar();

-- Existencias y pedidos en tránsito que se descuentan al calcular el
-- requerimiento neto. Se capturan a mano mientras no exista el módulo de
-- inventarios (Fase 3), que los dará automáticamente.
CREATE TABLE plan_existencia (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES plan_produccion (id),
  articulo_id      uuid NOT NULL REFERENCES articulo (id),
  existencia       numeric(18, 6) NOT NULL DEFAULT 0 CHECK (existencia >= 0),
  en_transito      numeric(18, 6) NOT NULL DEFAULT 0 CHECK (en_transito >= 0),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid,
  UNIQUE (plan_id, articulo_id)
);

CREATE FUNCTION plan_existencia_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT estatus FROM plan_produccion WHERE id = NEW.plan_id) <> 'BORRADOR' THEN
    RAISE EXCEPTION 'El plan ya no está en borrador: no se cambian sus existencias.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_existencia_validar BEFORE INSERT OR UPDATE ON plan_existencia FOR EACH ROW EXECUTE FUNCTION plan_existencia_validar();

-- ---------------------------------------------------------------------------
-- Requisición de compra (en borrador hasta el módulo de compras, Fase 4)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE requisicion_folio;
CREATE TABLE requisicion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio            text NOT NULL UNIQUE DEFAULT 'REQ-' || lpad(nextval('requisicion_folio')::text, 6, '0'),
  origen           text NOT NULL CHECK (origen IN ('MANUAL', 'EXPLOSION')),
  plan_id          uuid REFERENCES plan_produccion (id),
  solicitante_id   uuid NOT NULL REFERENCES usuario (id),
  requerido_para   date,
  estatus          text NOT NULL DEFAULT 'BORRADOR' CHECK (estatus IN ('BORRADOR', 'ENVIADA', 'AUTORIZADA', 'RECHAZADA', 'CANCELADA')),
  comentario       text,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid
);
CREATE UNIQUE INDEX requisicion_por_plan ON requisicion (plan_id) WHERE plan_id IS NOT NULL AND estatus <> 'CANCELADA';

CREATE TABLE requisicion_renglon (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisicion_id   uuid NOT NULL REFERENCES requisicion (id),
  articulo_id      uuid NOT NULL REFERENCES articulo (id),
  cantidad         numeric(18, 6) NOT NULL CHECK (cantidad > 0),   -- en unidad base del artículo
  unidad_id        uuid NOT NULL REFERENCES unidad (id),
  cantidad_compra  numeric(18, 6),                                 -- equivalente en unidad de compra (informativo)
  unidad_compra_id uuid REFERENCES unidad (id),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT usuario_actual(),
  actualizado_en   timestamptz,
  actualizado_por  uuid,
  UNIQUE (requisicion_id, articulo_id)
);

-- ---------------------------------------------------------------------------
-- Configuración (provisional: la confirma el negocio, ver preguntas P29 y P40)
-- ---------------------------------------------------------------------------
INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, provisional, permiso_editar, opciones) VALUES
  ('recetas.formula_merma', 'Recetas y costos',
   'Cómo se aplica un % de merma: DIVIDIR = cantidad ÷ (1 − merma) (con 10 % de merma, 100 g se vuelven 111.11 g); MULTIPLICAR = cantidad × (1 + merma) (100 g se vuelven 110 g)',
   'texto', 'DIVIDIR', true, 'configuracion.parametros:editar', ARRAY['DIVIDIR', 'MULTIPLICAR']);

-- ---------------------------------------------------------------------------
-- Auditoría y prohibición de borrado
-- ---------------------------------------------------------------------------
SELECT auditar_tabla(t) FROM unnest(ARRAY[
  'etapa_produccion', 'turno_produccion', 'tarifa_mod', 'tasa_gif', 'receta', 'receta_componente',
  'receta_etapa', 'plan_produccion', 'plan_renglon', 'plan_existencia', 'requisicion', 'requisicion_renglon'
]::regclass[]) AS t;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'etapa_produccion', 'turno_produccion', 'tarifa_mod', 'tasa_gif', 'receta', 'receta_componente',
    'receta_etapa', 'plan_produccion', 'plan_renglon', 'plan_existencia', 'requisicion', 'requisicion_renglon'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION rechazar_borrado()', t || '_sin_borrado', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado()', t || '_sin_truncate', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['costeo', 'costo_estandar'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado()', t || '_sin_truncate', t);
  END LOOP;
END $$;
