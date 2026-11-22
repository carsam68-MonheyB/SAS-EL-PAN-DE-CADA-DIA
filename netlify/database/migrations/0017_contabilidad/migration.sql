-- Fase 7 · Contabilidad
--  * Periodos mensuales (abierto/cerrado). En un periodo cerrado no entra ninguna póliza.
--  * Pólizas de ingreso (I), egreso (E) y diario (D), automáticas (desde inventarios,
--    producción, punto de venta y compras) o manuales (con autorización del contralor).
--  * Partidas inmutables: una póliza no se borra; una manual se cancela y una automática
--    se revierte con la póliza del documento que la cancela.
--  * Conceptos contables (lista fija del sistema) y reglas: a qué cuenta va cada concepto,
--    en general o por sucursal. Las cuentas las define el negocio con su contador.

CREATE TABLE periodo_contable (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ejercicio       integer NOT NULL CHECK (ejercicio BETWEEN 2000 AND 2100),
  mes             integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  estatus         text NOT NULL DEFAULT 'ABIERTO' CHECK (estatus IN ('ABIERTO', 'CERRADO')),
  folios          jsonb NOT NULL DEFAULT '{}',   -- último folio por tipo de póliza
  cerrado_por     uuid REFERENCES usuario (id),
  cerrado_en      timestamptz,
  reabierto_por   uuid REFERENCES usuario (id),
  reabierto_en    timestamptz,
  motivo_reapertura text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  UNIQUE (ejercicio, mes)
);

CREATE TABLE concepto_contable (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE,
  nombre          text NOT NULL,
  grupo           text NOT NULL,
  descripcion     text NOT NULL,
  orden           integer NOT NULL,
  activo          boolean NOT NULL DEFAULT true
);
CREATE TRIGGER concepto_contable_inmutable BEFORE UPDATE OR DELETE ON concepto_contable FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

CREATE TABLE regla_contable (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concepto_id     uuid NOT NULL REFERENCES concepto_contable (id),
  sucursal_id     uuid REFERENCES sucursal (id),            -- vacío = todas las sucursales
  cuenta_id       uuid NOT NULL REFERENCES cuenta_contable (id),
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);
CREATE UNIQUE INDEX regla_contable_unica ON regla_contable (concepto_id, coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Una regla solo apunta a cuentas afectables y activas.
CREATE FUNCTION regla_contable_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cuenta_contable WHERE id = NEW.cuenta_id AND afectable AND activo) THEN
    RAISE EXCEPTION 'La cuenta de una regla debe ser afectable y estar activa.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER regla_contable_validar BEFORE INSERT OR UPDATE ON regla_contable FOR EACH ROW EXECUTE FUNCTION regla_contable_validar();

CREATE TABLE poliza (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio           text NOT NULL UNIQUE,                    -- D-202611-0001
  tipo            text NOT NULL CHECK (tipo IN ('I', 'E', 'D')),
  periodo_id      uuid NOT NULL REFERENCES periodo_contable (id),
  fecha           date NOT NULL,
  concepto        text NOT NULL,
  origen          text NOT NULL,                           -- MANUAL o tipo de documento
  origen_id       uuid,
  origen_folio    text,
  estatus         text NOT NULL CHECK (estatus IN ('POR_AUTORIZAR', 'APLICADA', 'RECHAZADA', 'CANCELADA')),
  total           numeric(16, 2) NOT NULL CHECK (total > 0),
  registrado_por  uuid NOT NULL REFERENCES usuario (id),
  autorizado_por  uuid REFERENCES usuario (id),
  autorizado_en   timestamptz,
  cancelado_por   uuid REFERENCES usuario (id),
  cancelado_en    timestamptz,
  motivo          text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  CHECK ((origen = 'MANUAL') = (origen_id IS NULL)),
  CHECK (origen = 'MANUAL' OR estatus = 'APLICADA')
);
-- Un documento se contabiliza una sola vez.
CREATE UNIQUE INDEX poliza_origen_unico ON poliza (origen, origen_id) WHERE origen_id IS NOT NULL;
CREATE INDEX poliza_periodo ON poliza (periodo_id, estatus);
CREATE INDEX poliza_fecha ON poliza (fecha);

CREATE TABLE poliza_partida (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poliza_id       uuid NOT NULL REFERENCES poliza (id),
  orden           integer NOT NULL,
  cuenta_id       uuid NOT NULL REFERENCES cuenta_contable (id),
  centro_costo_id uuid REFERENCES centro_costo (id),
  sucursal_id     uuid REFERENCES sucursal (id),
  concepto        text NOT NULL,
  cargo           numeric(16, 2) NOT NULL DEFAULT 0 CHECK (cargo >= 0),
  abono           numeric(16, 2) NOT NULL DEFAULT 0 CHECK (abono >= 0),
  referencia      text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  CHECK ((cargo > 0) <> (abono > 0)),
  UNIQUE (poliza_id, orden)
);
CREATE INDEX poliza_partida_cuenta ON poliza_partida (cuenta_id);
CREATE TRIGGER poliza_partida_inmutable BEFORE UPDATE OR DELETE ON poliza_partida FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- Partidas: solo cuentas afectables y activas, y solo mientras la póliza se captura.
CREATE FUNCTION poliza_partida_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cuenta_contable WHERE id = NEW.cuenta_id AND afectable AND activo) THEN
    RAISE EXCEPTION 'Solo se registran movimientos en cuentas afectables y activas.' USING ERRCODE = 'P0001';
  END IF;
  -- now() es la hora de inicio de la transacción: solo se agregan partidas a una póliza creada en la misma transacción.
  IF (SELECT creado_en <> now() OR estatus NOT IN ('POR_AUTORIZAR', 'APLICADA') FROM poliza WHERE id = NEW.poliza_id) THEN
    RAISE EXCEPTION 'Una póliza registrada no se modifica.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER poliza_partida_validar BEFORE INSERT ON poliza_partida FOR EACH ROW EXECUTE FUNCTION poliza_partida_validar();

-- La póliza: solo cambian estatus y quién autoriza o cancela; nunca en un periodo cerrado.
CREATE FUNCTION poliza_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT estatus FROM periodo_contable WHERE id = NEW.periodo_id) = 'CERRADO' THEN
    RAISE EXCEPTION 'El periodo contable está cerrado: no se registran ni cambian pólizas.' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.estatus IN ('RECHAZADA', 'CANCELADA')
       OR (to_jsonb(NEW) - ARRAY['estatus', 'autorizado_por', 'autorizado_en', 'cancelado_por', 'cancelado_en', 'motivo', 'actualizado_en', 'actualizado_por'])
          <> (to_jsonb(OLD) - ARRAY['estatus', 'autorizado_por', 'autorizado_en', 'cancelado_por', 'cancelado_en', 'motivo', 'actualizado_en', 'actualizado_por']) THEN
      RAISE EXCEPTION 'Una póliza registrada no se modifica.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER poliza_validar BEFORE INSERT OR UPDATE ON poliza FOR EACH ROW EXECUTE FUNCTION poliza_validar();

-- Una póliza aplicada siempre cuadra (se revisa al terminar la transacción).
CREATE FUNCTION poliza_cuadra() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE c numeric; a numeric; t numeric;
BEGIN
  SELECT coalesce(sum(cargo), 0), coalesce(sum(abono), 0) INTO c, a FROM poliza_partida WHERE poliza_id = NEW.id;
  SELECT total INTO t FROM poliza WHERE id = NEW.id;
  IF c <> a OR c <> t THEN
    RAISE EXCEPTION 'La póliza % no cuadra: cargos % y abonos %.', NEW.folio, c, a USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER poliza_cuadra AFTER INSERT ON poliza DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION poliza_cuadra();

CREATE FUNCTION periodo_contable_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ejercicio <> OLD.ejercicio OR NEW.mes <> OLD.mes THEN
    RAISE EXCEPTION 'No se cambia el ejercicio ni el mes de un periodo.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER periodo_contable_validar BEFORE UPDATE ON periodo_contable FOR EACH ROW EXECUTE FUNCTION periodo_contable_validar();

-- ---------------------------------------------------------------------------
-- Conceptos que generan las operaciones (lista del sistema; la cuenta la pone el negocio)
-- ---------------------------------------------------------------------------
INSERT INTO concepto_contable (clave, nombre, grupo, descripcion, orden) VALUES
  ('INV_MP', 'Inventario de materia prima', 'Inventarios', 'Valor de los almacenes de materia prima e insumos.', 10),
  ('INV_PEP', 'Inventario de producción en proceso', 'Inventarios', 'Valor de los almacenes de producción en proceso (masas y material surtido).', 11),
  ('INV_PT', 'Inventario de producto terminado', 'Inventarios', 'Valor de los almacenes de producto terminado.', 12),
  ('SALDOS_INICIALES_INV', 'Contrapartida del inventario inicial', 'Inventarios', 'Abono del inventario inicial cargado por layout.', 13),
  ('PROV_POR_FACTURAR', 'Mercancía recibida por facturar', 'Inventarios', 'Abono al recibir una compra; se cancela al registrar la factura del proveedor.', 14),
  ('MERCANCIA_EN_TRANSITO', 'Mercancía en tránsito', 'Inventarios', 'Traspasos enviados y aún no recibidos.', 15),
  ('FALTANTE_TRASPASO', 'Faltantes de traspasos', 'Inventarios', 'Lo que se envió y no llegó.', 16),
  ('MERMA_MP', 'Merma de materia prima', 'Inventarios', 'Gasto por merma en almacenes de materia prima.', 17),
  ('MERMA_PEP', 'Merma en producción', 'Inventarios', 'Gasto por merma en producción en proceso.', 18),
  ('MERMA_PT', 'Merma de producto terminado', 'Inventarios', 'Gasto por merma de pan (sucursal o planta).', 19),
  ('AJUSTE_SOBRANTE', 'Sobrantes de inventario', 'Inventarios', 'Ajuste a favor por conteo físico.', 20),
  ('AJUSTE_FALTANTE', 'Faltantes de inventario', 'Inventarios', 'Ajuste en contra por conteo físico.', 21),
  ('COSTO_VENTAS', 'Costo de ventas', 'Inventarios', 'Costo del pan vendido (y su devolución).', 22),
  ('MOD_APLICADA', 'Mano de obra aplicada a producción', 'Producción', 'Abono de la mano de obra que se suma al costo de cada orden.', 30),
  ('GIF_APLICADOS', 'Gastos indirectos aplicados', 'Producción', 'Abono de los indirectos que se suman al costo de cada orden.', 31),
  ('PRODUCCION_SIN_ORDEN', 'Producción sin orden', 'Producción', 'Contrapartida de la entrada de producción directa (Fase 3).', 32),
  ('CAJA_EFECTIVO', 'Caja (efectivo)', 'Punto de venta', 'Efectivo cobrado en la caja de cada sucursal.', 40),
  ('TARJETAS_POR_COBRAR', 'Ventas con tarjeta por depositar', 'Punto de venta', 'Cobros con tarjeta de crédito o débito.', 41),
  ('BANCOS', 'Bancos', 'Punto de venta', 'Cobros por transferencia y pagos a proveedores.', 42),
  ('VENTAS', 'Ventas', 'Punto de venta', 'Ingreso por ventas sin impuestos.', 43),
  ('DEVOLUCIONES_VENTAS', 'Devoluciones sobre ventas', 'Punto de venta', 'Devoluciones de clientes sin impuestos.', 44),
  ('IVA_TRASLADADO', 'IVA trasladado cobrado', 'Punto de venta', 'IVA de las ventas (cobrado al contado).', 45),
  ('IEPS_TRASLADADO', 'IEPS trasladado cobrado', 'Punto de venta', 'IEPS de las ventas.', 46),
  ('ANTICIPOS_CLIENTES', 'Anticipos de clientes', 'Punto de venta', 'Anticipos de pedidos (P65).', 47),
  ('ANTICIPOS_RETENIDOS', 'Anticipos retenidos', 'Punto de venta', 'Anticipos de pedidos cancelados que no se devolvieron.', 48),
  ('EFECTIVO_EN_TRANSITO', 'Efectivo retirado de caja', 'Punto de venta', 'Retiros e ingresos de efectivo de la caja (por depositar).', 49),
  ('FALTANTES_CAJA', 'Faltantes de caja', 'Punto de venta', 'Diferencia en contra en el corte Z.', 50),
  ('SOBRANTES_CAJA', 'Sobrantes de caja', 'Punto de venta', 'Diferencia a favor en el corte Z.', 51),
  ('PROVEEDORES', 'Proveedores', 'Compras', 'Facturas de proveedor por pagar.', 60),
  ('IVA_POR_ACREDITAR', 'IVA pendiente de acreditar', 'Compras', 'IVA de facturas de proveedor aún no pagadas.', 61),
  ('IVA_ACREDITABLE', 'IVA acreditable pagado', 'Compras', 'IVA de facturas de proveedor ya pagadas.', 62),
  ('RETENCIONES_POR_PAGAR', 'Impuestos retenidos por pagar', 'Compras', 'Retenciones de facturas de proveedor.', 63);

-- ---------------------------------------------------------------------------
-- Configuración
-- ---------------------------------------------------------------------------
INSERT INTO configuracion (clave, grupo, descripcion, tipo, valor, provisional, permiso_editar) VALUES
  ('contabilidad.fecha_inicio', 'Contabilidad', 'Fecha de arranque contable (P52), AAAA-MM-DD. Las operaciones anteriores no se contabilizan (los saldos iniciales entran con una póliza manual de apertura). Vacía = desde la primera operación.', 'texto', '', true, 'configuracion.parametros:editar');

-- ---------------------------------------------------------------------------
-- Auditoría y prohibición de borrado
-- ---------------------------------------------------------------------------
SELECT auditar_tabla(t) FROM unnest(ARRAY['periodo_contable', 'regla_contable', 'poliza', 'poliza_partida']::regclass[]) AS t;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['periodo_contable', 'regla_contable', 'poliza'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION rechazar_borrado()', t || '_sin_borrado', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['periodo_contable', 'concepto_contable', 'regla_contable', 'poliza', 'poliza_partida'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado()', t || '_sin_truncate', t);
  END LOOP;
END $$;
