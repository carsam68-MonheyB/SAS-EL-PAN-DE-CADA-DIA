-- Fase 3 · Inventarios: kárdex valuado (costo promedio o PEPS), lotes y
-- caducidades, entradas, surtido a producción, entrada de producción terminada,
-- traspasos con tránsito, mermas y conteos físicos con ajuste autorizado,
-- mínimos y punto de reorden por almacén.
--
-- Reglas:
--  * movimiento_renglon es el kárdex: solo inserción, la única fuente de verdad.
--  * existencia, existencia_lote y capa_costo son saldos que el servidor
--    actualiza en la misma transacción; inventario_diferencias() comprueba que
--    cuadran con el kárdex.
--  * Nada se borra: un movimiento se cancela con otro movimiento inverso.

-- ---------------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------------
-- Causas de merma (P38). Las captura el negocio.
CREATE TABLE causa_merma (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,20}$'),
  nombre          text NOT NULL,
  aplica          text NOT NULL DEFAULT 'TODOS' CHECK (aplica IN ('MP', 'PT', 'TODOS')),
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);

-- Mínimo, punto de reorden y máximo por almacén (si no hay, se usan los del artículo).
CREATE TABLE articulo_almacen (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  almacen_id      uuid NOT NULL REFERENCES almacen (id),
  articulo_id     uuid NOT NULL REFERENCES articulo (id),
  stock_minimo    numeric(18, 4) CHECK (stock_minimo >= 0),
  punto_reorden   numeric(18, 4) CHECK (punto_reorden >= 0),
  stock_maximo    numeric(18, 4) CHECK (stock_maximo >= 0),
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  UNIQUE (almacen_id, articulo_id),
  CHECK (stock_minimo IS NULL OR stock_maximo IS NULL OR stock_minimo <= stock_maximo)
);

CREATE TABLE lote (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id     uuid NOT NULL REFERENCES articulo (id),
  codigo          text NOT NULL CHECK (codigo ~ '^[A-Za-z0-9./_-]{1,40}$'),
  caducidad       date,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  UNIQUE (articulo_id, codigo)
);
-- La caducidad de un lote no cambia una vez registrada.
CREATE FUNCTION lote_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.articulo_id <> OLD.articulo_id OR NEW.codigo <> OLD.codigo OR NEW.caducidad IS DISTINCT FROM OLD.caducidad THEN
    RAISE EXCEPTION 'Un lote registrado no cambia (artículo, código ni caducidad).' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lote_validar BEFORE UPDATE ON lote FOR EACH ROW EXECUTE FUNCTION lote_validar();

-- ---------------------------------------------------------------------------
-- Kárdex
-- ---------------------------------------------------------------------------
CREATE SEQUENCE movimiento_folio;
CREATE TABLE movimiento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio           text NOT NULL UNIQUE DEFAULT 'MOV-' || lpad(nextval('movimiento_folio')::text, 6, '0'),
  tipo            text NOT NULL CHECK (tipo IN (
                    'INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_PRODUCCION', 'SURTIDO_SALIDA', 'SURTIDO_ENTRADA',
                    'TRASPASO_ENVIO', 'TRASPASO_RECEPCION', 'MERMA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'CANCELACION')),
  almacen_id      uuid NOT NULL REFERENCES almacen (id),
  fecha           timestamptz NOT NULL DEFAULT now(),
  fecha_negocio   date NOT NULL,
  documento_tipo  text CHECK (documento_tipo IN ('CARGA', 'SURTIDO', 'TRASPASO', 'MERMA', 'CONTEO')),
  documento_id    uuid,
  proveedor_id    uuid REFERENCES proveedor (id),
  referencia      text,
  plan_id         uuid REFERENCES plan_produccion (id),
  comentario      text,
  cancela_id      uuid REFERENCES movimiento (id),
  cancelado_por_id uuid REFERENCES movimiento (id),
  metodo          text NOT NULL CHECK (metodo IN ('PROMEDIO', 'PEPS')),
  usuario_id      uuid NOT NULL REFERENCES usuario (id),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  CHECK ((tipo = 'CANCELACION') = (cancela_id IS NOT NULL))
);
CREATE UNIQUE INDEX movimiento_cancelado_una_vez ON movimiento (cancela_id) WHERE cancela_id IS NOT NULL;
CREATE INDEX movimiento_documento ON movimiento (documento_tipo, documento_id);
CREATE INDEX movimiento_fecha ON movimiento (fecha_negocio, almacen_id);

-- Un movimiento no cambia; solo se marca una vez con el movimiento que lo cancela.
CREATE FUNCTION movimiento_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancelado_por_id IS NOT NULL OR NEW.cancelado_por_id IS NULL
     OR (to_jsonb(NEW) - 'cancelado_por_id' - 'actualizado_en' - 'actualizado_por') <> (to_jsonb(OLD) - 'cancelado_por_id' - 'actualizado_en' - 'actualizado_por') THEN
    RAISE EXCEPTION 'Un movimiento de inventario no se modifica: se cancela con un movimiento inverso.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER movimiento_validar BEFORE UPDATE ON movimiento FOR EACH ROW EXECUTE FUNCTION movimiento_validar();

CREATE TABLE movimiento_renglon (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consecutivo     bigserial NOT NULL UNIQUE,
  movimiento_id   uuid NOT NULL REFERENCES movimiento (id),
  almacen_id      uuid NOT NULL REFERENCES almacen (id),
  articulo_id     uuid NOT NULL REFERENCES articulo (id),
  lote_id         uuid REFERENCES lote (id),
  cantidad        numeric(18, 6) NOT NULL CHECK (cantidad <> 0),   -- + entrada, − salida (unidad base)
  costo_unitario  numeric(18, 6) NOT NULL CHECK (costo_unitario >= 0),
  importe         numeric(20, 6) NOT NULL,                         -- mismo signo que la cantidad
  saldo_cantidad  numeric(18, 6) NOT NULL CHECK (saldo_cantidad >= 0),
  saldo_valor     numeric(20, 6) NOT NULL CHECK (saldo_valor >= 0),
  causa_id        uuid REFERENCES causa_merma (id),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  CHECK (sign(importe) = sign(cantidad) OR importe = 0)
);
CREATE INDEX movimiento_renglon_kardex ON movimiento_renglon (almacen_id, articulo_id, consecutivo);
CREATE INDEX movimiento_renglon_mov ON movimiento_renglon (movimiento_id);
CREATE TRIGGER movimiento_renglon_inmutable BEFORE UPDATE OR DELETE ON movimiento_renglon FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- Saldos (se reconstruyen desde el kárdex)
CREATE TABLE existencia (
  almacen_id      uuid NOT NULL REFERENCES almacen (id),
  articulo_id     uuid NOT NULL REFERENCES articulo (id),
  cantidad        numeric(18, 6) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  valor           numeric(20, 6) NOT NULL DEFAULT 0 CHECK (valor >= 0),
  ultimo_costo    numeric(18, 6),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (almacen_id, articulo_id),
  CHECK (cantidad > 0 OR valor = 0)
);

CREATE TABLE existencia_lote (
  almacen_id      uuid NOT NULL REFERENCES almacen (id),
  articulo_id     uuid NOT NULL REFERENCES articulo (id),
  lote_id         uuid NOT NULL REFERENCES lote (id),
  cantidad        numeric(18, 6) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  PRIMARY KEY (almacen_id, lote_id)
);

-- Capas de costo (PEPS): cada entrada abre una capa; las salidas consumen la más antigua.
CREATE TABLE capa_costo (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  almacen_id         uuid NOT NULL REFERENCES almacen (id),
  articulo_id        uuid NOT NULL REFERENCES articulo (id),
  renglon_id         uuid NOT NULL UNIQUE REFERENCES movimiento_renglon (id),
  consecutivo        bigint NOT NULL,
  costo_unitario     numeric(18, 6) NOT NULL,
  cantidad_restante  numeric(18, 6) NOT NULL CHECK (cantidad_restante >= 0),
  valor_restante     numeric(20, 6) NOT NULL CHECK (valor_restante >= 0)
);
CREATE INDEX capa_costo_abiertas ON capa_costo (almacen_id, articulo_id, consecutivo) WHERE cantidad_restante > 0;

-- ---------------------------------------------------------------------------
-- Documentos
-- ---------------------------------------------------------------------------
-- Surtido a producción (vale): de un almacén de MP a uno de producción en proceso.
CREATE SEQUENCE surtido_folio;
CREATE TABLE surtido (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio           text NOT NULL UNIQUE DEFAULT 'VAL-' || lpad(nextval('surtido_folio')::text, 6, '0'),
  almacen_origen_id  uuid NOT NULL REFERENCES almacen (id),
  almacen_destino_id uuid NOT NULL REFERENCES almacen (id),
  plan_id         uuid REFERENCES plan_produccion (id),
  salida_id       uuid NOT NULL REFERENCES movimiento (id),
  entrada_id      uuid NOT NULL REFERENCES movimiento (id),
  comentario      text,
  usuario_id      uuid NOT NULL REFERENCES usuario (id),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  CHECK (almacen_origen_id <> almacen_destino_id)
);
CREATE TRIGGER surtido_inmutable BEFORE UPDATE OR DELETE ON surtido FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- Traspaso en dos pasos: envío (sale del origen y queda en tránsito) y recepción.
CREATE SEQUENCE traspaso_folio;
CREATE TABLE traspaso (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio              text NOT NULL UNIQUE DEFAULT 'TRA-' || lpad(nextval('traspaso_folio')::text, 6, '0'),
  almacen_origen_id  uuid NOT NULL REFERENCES almacen (id),
  almacen_destino_id uuid NOT NULL REFERENCES almacen (id),
  estatus            text NOT NULL DEFAULT 'ENVIADO' CHECK (estatus IN ('ENVIADO', 'RECIBIDO', 'CANCELADO')),
  envio_id           uuid NOT NULL REFERENCES movimiento (id),
  recepcion_id       uuid REFERENCES movimiento (id),
  cancelacion_id     uuid REFERENCES movimiento (id),
  comentario         text,
  comentario_recepcion text,
  enviado_por        uuid NOT NULL REFERENCES usuario (id),
  enviado_en         timestamptz NOT NULL DEFAULT now(),
  recibido_por       uuid REFERENCES usuario (id),
  recibido_en        timestamptz,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  creado_por         uuid DEFAULT usuario_actual(),
  actualizado_en     timestamptz,
  actualizado_por    uuid,
  CHECK (almacen_origen_id <> almacen_destino_id)
);
CREATE INDEX traspaso_transito ON traspaso (almacen_destino_id) WHERE estatus = 'ENVIADO';

CREATE TABLE traspaso_renglon (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  traspaso_id        uuid NOT NULL REFERENCES traspaso (id),
  articulo_id        uuid NOT NULL REFERENCES articulo (id),
  lote_id            uuid REFERENCES lote (id),
  cantidad_enviada   numeric(18, 6) NOT NULL CHECK (cantidad_enviada > 0),
  importe_enviado    numeric(20, 6) NOT NULL CHECK (importe_enviado >= 0),
  cantidad_recibida  numeric(18, 6) CHECK (cantidad_recibida >= 0 AND cantidad_recibida <= cantidad_enviada),
  importe_faltante   numeric(20, 6),
  creado_en          timestamptz NOT NULL DEFAULT now(),
  creado_por         uuid DEFAULT usuario_actual(),
  actualizado_en     timestamptz,
  actualizado_por    uuid
);

-- Merma registrada (pendiente de autorización) y aplicada.
CREATE SEQUENCE merma_folio;
CREATE TABLE merma (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio           text NOT NULL UNIQUE DEFAULT 'MER-' || lpad(nextval('merma_folio')::text, 6, '0'),
  almacen_id      uuid NOT NULL REFERENCES almacen (id),
  causa_id        uuid NOT NULL REFERENCES causa_merma (id),
  estatus         text NOT NULL DEFAULT 'POR_AUTORIZAR' CHECK (estatus IN ('POR_AUTORIZAR', 'APLICADA', 'RECHAZADA', 'CANCELADA')),
  comentario      text,
  movimiento_id   uuid REFERENCES movimiento (id),
  importe         numeric(20, 6),
  registrado_por  uuid NOT NULL REFERENCES usuario (id),
  resuelto_por    uuid REFERENCES usuario (id),
  resuelto_en     timestamptz,
  motivo_rechazo  text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);
CREATE TABLE merma_renglon (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merma_id        uuid NOT NULL REFERENCES merma (id),
  articulo_id     uuid NOT NULL REFERENCES articulo (id),
  lote_id         uuid REFERENCES lote (id),
  cantidad        numeric(18, 6) NOT NULL CHECK (cantidad > 0),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual()
);
CREATE TRIGGER merma_renglon_inmutable BEFORE UPDATE OR DELETE ON merma_renglon FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- Conteo físico (cíclico o general). Captura → por autorizar → aplicado (ajuste).
CREATE SEQUENCE conteo_folio;
CREATE TABLE conteo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio           text NOT NULL UNIQUE DEFAULT 'CNT-' || lpad(nextval('conteo_folio')::text, 6, '0'),
  almacen_id      uuid NOT NULL REFERENCES almacen (id),
  estatus         text NOT NULL DEFAULT 'CAPTURA' CHECK (estatus IN ('CAPTURA', 'POR_AUTORIZAR', 'APLICADO', 'RECHAZADO', 'CANCELADO')),
  comentario      text,
  importe_diferencia numeric(20, 6),
  entrada_id      uuid REFERENCES movimiento (id),
  salida_id       uuid REFERENCES movimiento (id),
  creado_por_id   uuid NOT NULL REFERENCES usuario (id),
  enviado_por     uuid REFERENCES usuario (id),
  enviado_en      timestamptz,
  resuelto_por    uuid REFERENCES usuario (id),
  resuelto_en     timestamptz,
  motivo_rechazo  text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);
CREATE TABLE conteo_renglon (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conteo_id       uuid NOT NULL REFERENCES conteo (id),
  articulo_id     uuid NOT NULL REFERENCES articulo (id),
  lote_id         uuid REFERENCES lote (id),
  fisico          numeric(18, 6) CHECK (fisico >= 0),
  teorico         numeric(18, 6),
  diferencia      numeric(18, 6),
  costo_unitario  numeric(18, 6),
  importe         numeric(20, 6),
  capturado_por   uuid REFERENCES usuario (id),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);
CREATE UNIQUE INDEX conteo_renglon_unico ON conteo_renglon (conteo_id, articulo_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Un conteo solo se captura mientras está en CAPTURA.
CREATE FUNCTION conteo_renglon_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE e text;
BEGIN
  SELECT estatus INTO e FROM conteo WHERE id = NEW.conteo_id;
  IF e <> 'CAPTURA' AND (TG_OP = 'INSERT' OR NEW.fisico IS DISTINCT FROM OLD.fisico OR NEW.articulo_id <> OLD.articulo_id OR NEW.lote_id IS DISTINCT FROM OLD.lote_id) THEN
    RAISE EXCEPTION 'El conteo ya se envió: no se cambian sus cantidades.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conteo_renglon_validar BEFORE INSERT OR UPDATE ON conteo_renglon FOR EACH ROW EXECUTE FUNCTION conteo_renglon_validar();

-- Carga de inventario inicial por layout (se aplica como movimiento INICIAL).
CREATE TABLE inventario_inicial (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  almacen_id      uuid NOT NULL REFERENCES almacen (id),
  articulo_id     uuid NOT NULL REFERENCES articulo (id),
  lote            text,
  caducidad       date,
  cantidad        numeric(18, 6) NOT NULL CHECK (cantidad > 0),
  costo_unitario  numeric(18, 6) NOT NULL CHECK (costo_unitario >= 0),
  movimiento_id   uuid REFERENCES movimiento (id),
  carga_id        uuid REFERENCES carga_layout (id),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);
CREATE UNIQUE INDEX inventario_inicial_unico ON inventario_inicial (almacen_id, articulo_id, coalesce(lote, ''));

-- ---------------------------------------------------------------------------
-- Comprobación: los saldos cuadran con el kárdex (debe regresar cero renglones).
-- ---------------------------------------------------------------------------
CREATE FUNCTION inventario_diferencias()
RETURNS TABLE (almacen_id uuid, articulo_id uuid, lote_id uuid, saldo numeric, kardex numeric, valor numeric, kardex_valor numeric)
LANGUAGE sql STABLE AS $$
  WITH k AS (
    SELECT r.almacen_id, r.articulo_id, sum(r.cantidad) AS cantidad, sum(r.importe) AS valor
      FROM movimiento_renglon r GROUP BY 1, 2
  ), kl AS (
    SELECT r.almacen_id, r.articulo_id, r.lote_id, sum(r.cantidad) AS cantidad
      FROM movimiento_renglon r WHERE r.lote_id IS NOT NULL GROUP BY 1, 2, 3
  )
  SELECT coalesce(e.almacen_id, k.almacen_id), coalesce(e.articulo_id, k.articulo_id), NULL::uuid,
         coalesce(e.cantidad, 0), coalesce(k.cantidad, 0), coalesce(e.valor, 0), coalesce(k.valor, 0)
    FROM existencia e FULL JOIN k ON k.almacen_id = e.almacen_id AND k.articulo_id = e.articulo_id
   WHERE coalesce(e.cantidad, 0) <> coalesce(k.cantidad, 0) OR coalesce(e.valor, 0) <> coalesce(k.valor, 0)
  UNION ALL
  SELECT coalesce(l.almacen_id, kl.almacen_id), coalesce(l.articulo_id, kl.articulo_id), coalesce(l.lote_id, kl.lote_id),
         coalesce(l.cantidad, 0), coalesce(kl.cantidad, 0), NULL, NULL
    FROM existencia_lote l FULL JOIN kl ON kl.almacen_id = l.almacen_id AND kl.lote_id = l.lote_id
   WHERE coalesce(l.cantidad, 0) <> coalesce(kl.cantidad, 0)
$$;

-- ---------------------------------------------------------------------------
-- Configuración (provisional: la confirma el negocio)
-- ---------------------------------------------------------------------------
INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, provisional, permiso_editar, opciones) VALUES
  ('inventarios.metodo_valuacion', 'Inventarios',
   'Método de valuación del inventario (P34). PROMEDIO = costo promedio ponderado por almacén; PEPS = primeras entradas, primeras salidas. Solo se puede cambiar mientras no haya movimientos de inventario.',
   'texto', 'PROMEDIO', true, 'configuracion.parametros:editar', ARRAY['PROMEDIO', 'PEPS']);
INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, minimo, maximo, provisional, permiso_editar) VALUES
  ('inventarios.dias_alerta_caducidad', 'Inventarios',
   'Días antes de la caducidad de un lote en que aparece la alerta "por caducar".',
   'entero', '3', 0, 365, true, 'configuracion.parametros:editar');

-- El método de valuación no cambia con movimientos registrados (mezclaría costos).
CREATE FUNCTION configuracion_metodo_valuacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.clave = 'inventarios.metodo_valuacion' AND NEW.valor <> OLD.valor AND EXISTS (SELECT 1 FROM movimiento) THEN
    RAISE EXCEPTION 'Ya hay movimientos de inventario: el método de valuación ya no se puede cambiar.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER configuracion_metodo_valuacion BEFORE UPDATE ON configuracion FOR EACH ROW EXECUTE FUNCTION configuracion_metodo_valuacion();

-- Segregación a nivel documento (la valida el servidor): quien registra no autoriza.
INSERT INTO incompatibilidad (clave, nivel, patron_a, patron_b, descripcion) VALUES
  ('registra_autoriza_merma', 'documento', 'produccion.mermas:crear', 'produccion.mermas:autorizar',
   'Quien registra una merma no puede autorizar esa misma merma.'),
  ('registra_autoriza_merma_sucursal', 'documento', 'inventarios.merma_sucursal:crear', 'inventarios.merma_sucursal:autorizar',
   'Quien registra una merma de sucursal no puede autorizar esa misma merma.');

-- ---------------------------------------------------------------------------
-- Auditoría y prohibición de borrado
-- ---------------------------------------------------------------------------
SELECT auditar_tabla(t) FROM unnest(ARRAY[
  'causa_merma', 'articulo_almacen', 'lote', 'movimiento', 'movimiento_renglon', 'surtido',
  'traspaso', 'traspaso_renglon', 'merma', 'merma_renglon', 'conteo', 'conteo_renglon', 'inventario_inicial'
]::regclass[]) AS t;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'causa_merma', 'articulo_almacen', 'lote', 'movimiento', 'traspaso', 'traspaso_renglon', 'merma',
    'conteo', 'conteo_renglon', 'inventario_inicial', 'existencia', 'existencia_lote', 'capa_costo'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION rechazar_borrado()', t || '_sin_borrado', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'causa_merma', 'articulo_almacen', 'lote', 'movimiento', 'movimiento_renglon', 'surtido', 'traspaso', 'traspaso_renglon',
    'merma', 'merma_renglon', 'conteo', 'conteo_renglon', 'inventario_inicial', 'existencia', 'existencia_lote', 'capa_costo'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado()', t || '_sin_truncate', t);
  END LOOP;
END $$;
