-- Calculadora de costos de conversión (P35 y P36) y decisión de la fórmula de merma (P66).
--
-- Cada cálculo guardado deja constancia de los datos con que se obtuvo la tarifa de
-- mano de obra o la tasa de gastos indirectos (nómina, carga social, minutos, gastos
-- del mes…). La foto no se modifica: si cambian los datos, se calcula otra vez con
-- otra fecha de vigencia.

CREATE TABLE calculo_costo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            text NOT NULL CHECK (tipo IN ('MOD', 'GIF')),
  etapa_id        uuid REFERENCES etapa_produccion (id),
  base            text CHECK (base IN ('KG_MASA', 'MINUTO_MOD', 'PIEZA')),
  vigente_desde   date NOT NULL,
  datos           jsonb NOT NULL,
  resultado       numeric(18, 6) NOT NULL CHECK (resultado >= 0),
  comentario      text,
  usuario_id      uuid NOT NULL REFERENCES usuario (id),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  CHECK ((tipo = 'MOD' AND etapa_id IS NOT NULL AND base IS NULL) OR (tipo = 'GIF' AND base IS NOT NULL AND etapa_id IS NULL))
);
CREATE INDEX calculo_costo_fecha ON calculo_costo (creado_en DESC);
CREATE TRIGGER calculo_costo_inmutable BEFORE UPDATE OR DELETE ON calculo_costo FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion();
CREATE TRIGGER calculo_costo_sin_truncate BEFORE TRUNCATE ON calculo_costo FOR EACH STATEMENT EXECUTE FUNCTION rechazar_borrado();
SELECT auditar_tabla('calculo_costo'::regclass);

-- P66: se adopta DIVIDIR (cantidad ÷ (1 − merma)), la fórmula correcta para que,
-- después de perder el %, quede exactamente la cantidad que pide la receta.
-- Se puede cambiar en Configuración (queda en la bitácora).
UPDATE configuracion
   SET provisional = false,
       descripcion = 'Cómo se aplica un % de merma. DIVIDIR (recomendado) = cantidad ÷ (1 − merma): con 10 % de merma, para tener 100 g se preparan 111.11 g y al perder el 10 % quedan exactamente 100 g. MULTIPLICAR = cantidad × (1 + merma): 100 g se vuelven 110 g y al perder el 10 % quedan 99 g.'
 WHERE clave = 'recetas.formula_merma';
