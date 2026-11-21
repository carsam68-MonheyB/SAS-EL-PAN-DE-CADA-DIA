-- =============================================================================
-- 0002 · Estructura, usuarios, roles, permisos, sesiones y configuración
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Estructura mínima (sucursales, almacenes, cajas). La Fase 1B completa los
-- catálogos; aquí se necesitan para el alcance de los usuarios.
-- ---------------------------------------------------------------------------
CREATE TABLE sucursal (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,20}$'),
  nombre          text NOT NULL,
  es_planta       boolean NOT NULL DEFAULT false,
  vende_al_publico boolean NOT NULL DEFAULT true,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);

CREATE TABLE almacen (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,20}$'),
  nombre          text NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('MP', 'PEP', 'PT', 'INS')),
  sucursal_id     uuid NOT NULL REFERENCES sucursal (id),
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);

CREATE TABLE caja (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9-]{1,20}$'),
  nombre          text NOT NULL,
  sucursal_id     uuid NOT NULL REFERENCES sucursal (id),
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);

-- ---------------------------------------------------------------------------
-- Usuarios
-- ---------------------------------------------------------------------------
CREATE TABLE usuario (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario               text NOT NULL UNIQUE CHECK (usuario ~ '^[a-z0-9._-]{3,40}$'),
  nombre                text NOT NULL,
  puesto                text NOT NULL,
  correo                text,
  estatus               text NOT NULL DEFAULT 'activo' CHECK (estatus IN ('activo', 'suspendido', 'baja')),
  fecha_alta            date NOT NULL DEFAULT current_date,
  fecha_baja            date,
  hash_password         text,
  debe_cambiar_password boolean NOT NULL DEFAULT true,
  password_cambiado_en  timestamptz,
  intentos_fallidos     integer NOT NULL DEFAULT 0,
  bloqueado_hasta       timestamptz,
  totp_secreto          text,           -- cifrado con AES-256-GCM (LLAVE_MAESTRA)
  totp_activo           boolean NOT NULL DEFAULT false,
  totp_ultimo_paso      bigint,         -- evita reutilizar el mismo código TOTP
  pin_hash              text,
  intentos_pin          integer NOT NULL DEFAULT 0,
  pin_bloqueado_hasta   timestamptz,
  es_prueba             boolean NOT NULL DEFAULT false,  -- datos ficticios (PRUEBA-)
  creado_en             timestamptz NOT NULL DEFAULT now(),
  creado_por            uuid DEFAULT usuario_actual(),
  actualizado_en        timestamptz,
  actualizado_por       uuid,
  CHECK (estatus <> 'baja' OR fecha_baja IS NOT NULL)
);

-- Una baja no se borra: solo se desactiva. Se impide el DELETE físico.
CREATE TRIGGER usuario_sin_borrado
  BEFORE DELETE ON usuario
  FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();

-- ---------------------------------------------------------------------------
-- Roles (un rol = un puesto) y permisos (módulo × acción)
-- ---------------------------------------------------------------------------
CREATE TABLE rol (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE CHECK (clave ~ '^[A-Z0-9_]{2,20}$'),
  nombre          text NOT NULL,
  descripcion     text,
  requiere_2fa    boolean NOT NULL DEFAULT false,
  alcance         text NOT NULL DEFAULT 'todas' CHECK (alcance IN ('todas', 'sucursal', 'almacen')),
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);

CREATE TABLE permiso (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave       text NOT NULL UNIQUE,                 -- modulo:accion
  grupo       text NOT NULL,
  modulo      text NOT NULL,
  modulo_nombre text NOT NULL,
  accion      text NOT NULL CHECK (accion IN ('ver', 'crear', 'editar', 'cancelar', 'autorizar',
                                               'cerrar', 'exportar', 'imprimir', 'importar',
                                               'timbrar', 'modificar', 'cargar')),
  sensible    boolean NOT NULL DEFAULT false,      -- permisos sobre datos sensibles
  orden       integer NOT NULL DEFAULT 0,
  CHECK (clave = modulo || ':' || accion)
);

CREATE TABLE rol_permiso (
  rol_id      uuid NOT NULL REFERENCES rol (id),
  permiso_id  uuid NOT NULL REFERENCES permiso (id),
  creado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por  uuid DEFAULT usuario_actual(),
  PRIMARY KEY (rol_id, permiso_id)
);

CREATE TABLE usuario_rol (
  usuario_id  uuid NOT NULL REFERENCES usuario (id),
  rol_id      uuid NOT NULL REFERENCES rol (id),
  creado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por  uuid DEFAULT usuario_actual(),
  PRIMARY KEY (usuario_id, rol_id)
);

CREATE TABLE usuario_sucursal (
  usuario_id  uuid NOT NULL REFERENCES usuario (id),
  sucursal_id uuid NOT NULL REFERENCES sucursal (id),
  creado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por  uuid DEFAULT usuario_actual(),
  PRIMARY KEY (usuario_id, sucursal_id)
);

CREATE TABLE usuario_almacen (
  usuario_id  uuid NOT NULL REFERENCES usuario (id),
  almacen_id  uuid NOT NULL REFERENCES almacen (id),
  creado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por  uuid DEFAULT usuario_actual(),
  PRIMARY KEY (usuario_id, almacen_id)
);

-- Segregación de funciones.
--  nivel 'asignacion': el sistema impide que un mismo usuario reúna permisos
--     que coincidan con ambos patrones (patrones SQL LIKE sobre la clave).
--  nivel 'documento': el mismo usuario no puede hacer ambas cosas sobre el
--     mismo documento (lo valida cada módulo al operar).
CREATE TABLE incompatibilidad (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE,
  nivel           text NOT NULL CHECK (nivel IN ('asignacion', 'documento')),
  patron_a        text NOT NULL,
  patron_b        text NOT NULL,
  descripcion     text NOT NULL,
  activa          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);

-- Límites por monto para autorizar. El primer rol cuyo límite alcanza, autoriza.
CREATE TABLE limite_autorizacion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion       text NOT NULL,
  operacion_nombre text NOT NULL,
  rol_id          uuid NOT NULL REFERENCES rol (id),
  monto_hasta     numeric(18, 2),                  -- NULL = sin límite
  provisional     boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid,
  UNIQUE (operacion, rol_id),
  CHECK (monto_hasta IS NULL OR monto_hasta >= 0)
);

-- ---------------------------------------------------------------------------
-- Sesiones, invitaciones y códigos de recuperación
-- ---------------------------------------------------------------------------
CREATE TABLE sesion (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash        bytea NOT NULL UNIQUE,
  usuario_id        uuid NOT NULL REFERENCES usuario (id),
  tipo              text NOT NULL DEFAULT 'oficina' CHECK (tipo IN ('oficina', 'pos')),
  etapa             text NOT NULL CHECK (etapa IN ('completa', 'segundo_factor', 'enrolar_totp', 'cambiar_password')),
  caja_id           uuid REFERENCES caja (id),
  cajero_actual_id  uuid REFERENCES usuario (id),
  creada_en         timestamptz NOT NULL DEFAULT now(),
  ultima_actividad  timestamptz NOT NULL DEFAULT now(),
  expira_en         timestamptz NOT NULL,
  ip                text,
  agente            text,
  revocada_en       timestamptz,
  motivo_cierre     text
);
CREATE INDEX sesion_usuario ON sesion (usuario_id) WHERE revocada_en IS NULL;

CREATE TABLE token_acceso (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid NOT NULL REFERENCES usuario (id),
  tipo        text NOT NULL CHECK (tipo IN ('invitacion', 'restablecer')),
  token_hash  bytea NOT NULL UNIQUE,
  expira_en   timestamptz NOT NULL,
  usado_en    timestamptz,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por  uuid DEFAULT usuario_actual()
);

CREATE TABLE codigo_recuperacion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid NOT NULL REFERENCES usuario (id),
  codigo_hash text NOT NULL,
  usado_en    timestamptz,
  creado_en   timestamptz NOT NULL DEFAULT now()
);

-- Bitácora de accesos (solo inserción).
CREATE TABLE bitacora_acceso (
  id                bigserial PRIMARY KEY,
  fecha             timestamptz NOT NULL DEFAULT clock_timestamp(),
  usuario_id        uuid REFERENCES usuario (id),
  usuario_intentado text,
  evento            text NOT NULL,
  exito             boolean NOT NULL,
  ip                text,
  agente            text,
  detalle           text
);
CREATE INDEX bitacora_acceso_fecha ON bitacora_acceso (fecha);
CREATE INDEX bitacora_acceso_usuario ON bitacora_acceso (usuario_id);
CREATE TRIGGER bitacora_acceso_inmutable
  BEFORE UPDATE OR DELETE ON bitacora_acceso
  FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();
CREATE TRIGGER bitacora_acceso_sin_truncate
  BEFORE TRUNCATE ON bitacora_acceso
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_modificacion();

-- ---------------------------------------------------------------------------
-- Configuración editable (ningún valor de negocio va en el código)
-- ---------------------------------------------------------------------------
CREATE TABLE configuracion (
  clave           text PRIMARY KEY,
  grupo           text NOT NULL,
  descripcion     text NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('entero', 'decimal', 'texto', 'booleano')),
  valor           text NOT NULL,
  minimo          numeric,
  maximo          numeric,
  provisional     boolean NOT NULL DEFAULT false,
  permiso_editar  text NOT NULL,       -- permiso necesario para cambiarla
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid DEFAULT usuario_actual(),
  actualizado_en  timestamptz,
  actualizado_por uuid
);

-- Minutos en que hubo actividad (para estimar el consumo de la base).
CREATE TABLE actividad_bd (
  minuto timestamptz PRIMARY KEY
);

-- ---------------------------------------------------------------------------
-- Auditoría de todas las tablas de negocio de esta migración
-- ---------------------------------------------------------------------------
SELECT auditar_tabla(t) FROM unnest(ARRAY[
  'sucursal', 'almacen', 'caja', 'usuario', 'rol', 'permiso', 'rol_permiso',
  'usuario_rol', 'usuario_sucursal', 'usuario_almacen', 'incompatibilidad',
  'limite_autorizacion', 'token_acceso', 'codigo_recuperacion', 'configuracion'
]::regclass[]) AS t;
