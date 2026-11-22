# Archivos de ejemplo de la Fase 3 · Inventarios (DATOS FICTICIOS)

Todo es **inventado** para probar el inventario:
- las claves empiezan con `PRUEBA-`;
- las cantidades, los costos, los lotes y las causas de merma no son del negocio.

**Antes:** deben estar cargados los ejemplos de la Fase 1B y el archivo `18-insumos-adicionales.txt` de la Fase 2.

Usuarios: los de **Datos de prueba** (`prueba.alm` almacenista, `prueba.jpr` jefe de producción, `prueba.con` contralor, `prueba.enc` encargado de sucursal, `prueba.mae` maestro de masas, `prueba.dir` dirección, `prueba.com` compras).

## 1. Cargas (Cargas masivas, modo Alta)

| Archivo | Catálogo | Quién lo sube |
|---|---|---|
| `29-causas-merma.txt` | Causas de merma (de prueba; las 5 reales ya vienen cargadas) | contralor o jefe de producción |
| `30-minimos-por-almacen.txt` | Mínimos y reorden por almacén | compras |
| `31-inventario-inicial.txt` | Inventario inicial | jefe de producción |

El inventario inicial queda **pendiente de autorización**. Entra con el **contralor**, ve a **Cargas masivas** y haz clic en **Autorizar**. En ese momento se registra en el kárdex.

`99-inventario-CON-ERRORES.txt` sirve para ver la detección de errores. Súbelo antes del inventario inicial y **no lo apliques**. Debe marcar estos errores:
- lote faltante;
- lote en un artículo sin lote;
- caducidad faltante;
- insumo en almacén de producto terminado y pan en almacén de materia prima;
- artículo inexistente;
- cantidad negativa;
- piezas con decimales;
- costo vacío.

## 2. Recorrido sugerido y resultado esperado

Método de valuación: **costo promedio** (el que viene por omisión).

| Paso | Quién | Qué hacer (pantalla **Inventarios**) | Resultado esperado |
|---|---|---|---|
| 1 | contralor | Existencias | Harina en MP-MAT: **200 kg, $3,700.00** (lote PRUEBA-HAR-A). Azúcar 80 kg y levadura 3 kg con alerta **reordenar**. |
| 2 | almacenista | Entradas y surtidos → Entrada por compra: MP-MAT, harina, **2 BULTO**, costo **450** (por bulto), lote `PRUEBA-HAR-B`, caducidad 30/04/2027 | Entran **50 kg a $18.00**. Harina: 250 kg, $4,600.00, **promedio $18.40**. |
| 3 | almacenista | Surtido a producción: de MP-MAT a PEP-MAT, harina **60 kg**, sin lote | Sale del lote **A** (caduca antes). PEP-MAT: 60 kg, **$1,104.00**. MP-MAT: 190 kg, $3,496.00. |
| 4 | almacenista | Conteos físicos → nuevo conteo de MP-MAT con el artículo azúcar. Captura **78** y envía. | Queda **Por autorizar** con diferencia de **$48.00** (−2 kg × $24). |
| 5 | contralor | Abre el conteo → **Autorizar ajuste** | Azúcar: 78 kg, $1,872.00. El almacenista no puede autorizar su propio conteo. |
| 6 | jefe de producción | Traspasos → enviar de PT-MAT a PT-SUC1: 20 conchas de vainilla | Quedan en tránsito. PT-MAT baja a 40. |
| 7 | encargado de sucursal | Abre el traspaso, escribe recibido **19**, comentario y **Recibir** | PT-SUC1: 19 conchas, $91.20. Faltante de **$4.80** registrado. |
| 8 | encargado de sucursal | Mermas → PT-SUC1, causa "Pan no vendido", 5 conchas | Queda por autorizar (el encargado no se la autoriza a sí mismo). |
| 9 | contralor | Autoriza la merma | Sale a su costo: **$24.00**. PT-SUC1: 14 conchas. |
| 10 | maestro de masas | Merma en MP-MAT de **10 kg de mantequilla** (causa caducado) | Valor $1,450. El **jefe de producción no puede autorizarla** (su límite es $1,000); el **contralor sí**. |
| 11 | contralor | Existencias → clic en un renglón | El **kárdex** muestra cada entrada y salida con su saldo; se exporta a Excel. |

Para **cancelar** un movimiento: contralor o contador → Movimientos → abre el movimiento → **Cancelar movimiento** (o, en un traspaso en tránsito, **Cancelar traspaso**). Se registra el movimiento inverso; nada se borra.

Al final, en el **Plan de producción** (en borrador), el botón **Tomar existencias del inventario** llena la existencia y lo que viene en tránsito.

## 3. Lo que todavía no hace (fases siguientes)

- Las compras con orden de compra y factura llegan en la **Fase 4**.
- Las órdenes de producción, con consumo real y mermas por etapa, llegan en la **Fase 5**. Mientras tanto, el pan terminado entra con **Entrada de producción**, al costo estándar del día, y necesita una receta activa a la fecha de hoy.
- Las pólizas contables de cada movimiento llegan en la **Fase 7**.
