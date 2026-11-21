-- =============================================================================
-- 0001 · Bitácora de auditoría inalterable
-- -----------------------------------------------------------------------------
-- * Toda tabla de negocio registra aquí sus cambios (valor anterior y nuevo).
-- * La tabla rechaza UPDATE, DELETE y TRUNCATE: nadie, ni el administrador,
--   puede editarla ni borrarla desde el sistema.
-- * Cada renglón guarda el hash del anterior (cadena de hashes SHA-256), así
--   que cualquier alteración hecha por fuera del sistema se puede detectar.
-- * El usuario que hace el cambio se toma de la variable de sesión
--   app.usuario_id, que fija el servidor dentro de cada transacción.
-- =============================================================================

CREATE TABLE bitacora_auditoria (
  id             bigserial PRIMARY KEY,
  fecha          timestamptz NOT NULL DEFAULT clock_timestamp(),
  usuario_id     uuid,
  tabla          text NOT NULL,
  registro_id    text,
  operacion      text NOT NULL CHECK (operacion IN ('INSERT', 'UPDATE', 'DELETE')),
  antes          jsonb,
  despues        jsonb,
  hash_anterior  bytea,
  hash           bytea NOT NULL
);

CREATE INDEX bitacora_auditoria_tabla_registro ON bitacora_auditoria (tabla, registro_id);
CREATE INDEX bitacora_auditoria_fecha ON bitacora_auditoria (fecha);
CREATE INDEX bitacora_auditoria_usuario ON bitacora_auditoria (usuario_id);

-- Calcula el hash encadenado. El candado asesor serializa las inserciones para
-- que la cadena no se bifurque con transacciones simultáneas.
CREATE FUNCTION bitacora_auditoria_encadenar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  previo bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(724100001);
  SELECT hash INTO previo FROM bitacora_auditoria ORDER BY id DESC LIMIT 1;
  NEW.hash_anterior := previo;
  NEW.hash := sha256(
    coalesce(previo, ''::bytea) ||
    convert_to(
      concat_ws('|',
        NEW.id::text, to_char(NEW.fecha AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(NEW.usuario_id::text, ''),
        NEW.tabla, coalesce(NEW.registro_id, ''), NEW.operacion,
        coalesce(NEW.antes::text, ''), coalesce(NEW.despues::text, '')
      ), 'UTF8')
  );
  RETURN NEW;
END $$;

CREATE TRIGGER bitacora_auditoria_encadenar
  BEFORE INSERT ON bitacora_auditoria
  FOR EACH ROW EXECUTE FUNCTION bitacora_auditoria_encadenar();

-- Impide modificar o borrar cualquier tabla de solo-inserción (bitácoras).
CREATE FUNCTION rechazar_modificacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción: no se puede modificar ni borrar.', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER bitacora_auditoria_inmutable
  BEFORE UPDATE OR DELETE ON bitacora_auditoria
  FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

CREATE TRIGGER bitacora_auditoria_sin_truncate
  BEFORE TRUNCATE ON bitacora_auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_modificacion();

-- Usuario de la transacción actual (lo fija el servidor con SET LOCAL).
CREATE FUNCTION usuario_actual() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.usuario_id', true), '')::uuid
$$;

-- Columnas que nunca se copian a la bitácora (secretos).
CREATE FUNCTION auditoria_limpiar(datos jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT datos - 'hash_password' - 'totp_secreto' - 'pin_hash' - 'token_hash' - 'codigo_hash'
$$;

-- Trigger genérico: se conecta a cada tabla de negocio con auditar_tabla().
CREATE FUNCTION auditar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_antes   jsonb;
  v_despues jsonb;
  v_id      text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_antes := auditoria_limpiar(to_jsonb(OLD));
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_despues := auditoria_limpiar(to_jsonb(NEW));
  END IF;
  -- Un UPDATE que solo toca columnas secretas o de control no deja renglón vacío.
  IF TG_OP = 'UPDATE' AND (v_antes - 'actualizado_en' - 'actualizado_por')
                        = (v_despues - 'actualizado_en' - 'actualizado_por') THEN
    v_antes := v_antes || jsonb_build_object('_cambio', 'dato protegido');
  END IF;
  v_id := coalesce(v_despues ->> 'id', v_antes ->> 'id',
                   v_despues ->> 'clave', v_antes ->> 'clave');
  INSERT INTO bitacora_auditoria (usuario_id, tabla, registro_id, operacion, antes, despues)
  VALUES (usuario_actual(), TG_TABLE_NAME, v_id, TG_OP, v_antes, v_despues);
  RETURN coalesce(NEW, OLD);
END $$;

-- Pone fecha y usuario de última modificación.
CREATE FUNCTION marcar_actualizacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  NEW.actualizado_por := usuario_actual();
  RETURN NEW;
END $$;

-- Conecta auditoría (y marca de actualización si la tabla la tiene) a una tabla.
CREATE FUNCTION auditar_tabla(p_tabla regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_nombre text := (SELECT relname FROM pg_class WHERE oid = p_tabla);
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION auditar()',
    v_nombre || '_auditar', p_tabla);
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = p_tabla AND attname = 'actualizado_en' AND NOT attisdropped) THEN
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION marcar_actualizacion()',
      v_nombre || '_actualizado', p_tabla);
  END IF;
END $$;

-- Verifica la cadena completa. Devuelve el primer id roto o NULL si está íntegra.
CREATE FUNCTION bitacora_auditoria_verificar() RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r      record;
  previo bytea := NULL;
  calc   bytea;
BEGIN
  FOR r IN SELECT * FROM bitacora_auditoria ORDER BY id LOOP
    calc := sha256(
      coalesce(previo, ''::bytea) ||
      convert_to(
        concat_ws('|',
          r.id::text, to_char(r.fecha AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(r.usuario_id::text, ''),
          r.tabla, coalesce(r.registro_id, ''), r.operacion,
          coalesce(r.antes::text, ''), coalesce(r.despues::text, '')
        ), 'UTF8'));
    IF r.hash_anterior IS DISTINCT FROM previo OR r.hash <> calc THEN
      RETURN r.id;
    END IF;
    previo := r.hash;
  END LOOP;
  RETURN NULL;
END $$;
