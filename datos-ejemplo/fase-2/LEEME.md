# Archivos de ejemplo de la Fase 2 (DATOS FICTICIOS)

Todo es **inventado** para probar recetas, plan y costos:
- las claves empiezan con `PRUEBA-`;
- las tarifas de mano de obra, la tasa de gastos indirectos, las mermas y las fórmulas no son del negocio.

Antes de usarlos deben estar cargados los ejemplos de la Fase 1B.

## Orden de carga (Cargas masivas, modo Alta)

| Archivo | Catálogo | Quién lo sube |
|---|---|---|
| `18-insumos-adicionales.txt` | Materias primas, insumos y empaques | `prueba.com` |
| `19-etapas.txt` | Etapas de producción | `juanpanadero` (jefe de producción) |
| `20-turnos.txt` | Turnos de producción | jefe de producción |
| `21-tarifas-mano-de-obra.txt` | Costo de mano de obra por minuto | `jefeadmin` (contralor) |
| `22-tasas-gif.txt` | Tasas de gastos indirectos | contralor |
| `23-recetas-masas.txt` | Recetas de masas e intermedios (N1) | jefe de producción |
| `24-formulas-masas.txt` | Fórmulas de masas e intermedios | jefe de producción |
| `25-recetas-productos.txt` | Recetas de productos terminados (N2) | jefe de producción |
| `26-componentes-productos.txt` | Componentes de recetas de SKU | jefe de producción |
| `27-etapas-por-receta.txt` | Etapas y mano de obra por receta | jefe de producción |

Después:
1. En la pantalla **Recetas**, con el jefe de producción, abre cada masa y cada producto y haz clic en **Activar versión 1**.
2. Activa primero las masas y la cubierta, y después los panes.
3. Carga `28-plan-produccion.txt` (catálogo "Plan de producción").

Las recetas y tarifas empiezan el **01/01/2027** y el plan es del **02/01/2027**. En la pantalla **Costo estándar**, cambia la fecha a 01/01/2027 para ver los costos.

## Resultado esperado (para cuadrar con tu Excel)

Plan: concha de vainilla 240, concha de chocolate 96, bolillo 490 y telera 120 piezas buenas.

| Masa / intermedio | Se requiere | Lotes | Se produce | Sobrante |
|---|---|---|---|---|
| Masa dulce (lote de 20 kg en % panadero, rinde 19.6, lote completo) | 250 + 100 conchas a formar (4 % de horneado) × 60 g = **21 kg** | **2** | 39.2 kg | 18.2 kg |
| Cubierta (lote de 3 kg, exacto) | 350 × 15 g = **5.25 kg** | **1.75** | 5.25 kg | 0 |
| Masa de bolillo (rinde 24, lote completo) | 490 × 80 g ÷ 0.98 (2 % formado) = 40 + telera 120 × 100 g = 12 → **52 kg** | **3** | 72 kg | 20 kg |

Materia prima (bruto):
- harina 66.75 kg;
- azúcar 6.75;
- mantequilla 5.4;
- huevo 3;
- levadura 0.85;
- sal 1.2;
- agua 34.3;
- cacao 0.35;
- bolsas 336.

En % panadero la masa dulce suma 200 %. Por eso la harina es 20 × 100 ÷ 200 = 10 kg por lote, y cada ingrediente es harina × % (por ejemplo, agua 10 × 36.5 % = 3.65 kg).

Costo por pieza de la concha de vainilla al 01/01/2027: **$4.8715**. Se compone de:
- masa 0.0625 kg × $35.8364;
- cubierta 0.015625 kg × $66.0333;
- bolsa $0.35;
- mano de obra $1.25.

## Archivo con errores a propósito

`99-formulas-CON-ERRORES.txt` (catálogo "Fórmulas de masas e intermedios"):
- Trae 1 renglón bueno y 8 con errores:
  - una masa que se lleva a sí misma;
  - dos renglones que forman una receta circular;
  - una unidad sin conversión (huevo en litros);
  - un componente que no existe;
  - una cantidad negativa;
  - % panadero en una receta capturada por cantidad;
  - un componente repetido.
- Para que muestre esos errores, súbelo **antes de activar** las recetas.
- No se guarda nada, ni el renglón bueno.
