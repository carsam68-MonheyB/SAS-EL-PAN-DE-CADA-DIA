# Fase 5 · Producción y costos: cómo probarla (DATOS FICTICIOS)

Todo es **inventado**: recetas, plan, costos y lotes `PRUEBA-`. Esta fase no trae archivos nuevos; usa los ejemplos de las fases anteriores.

**Antes** (en este orden):
1. Los ejemplos de la Fase 1B.
2. Toda la Fase 2: insumos adicionales, etapas, turnos, tarifas, GIF, recetas, fórmulas, componentes y etapas por receta. Activa las 7 recetas.
3. De la Fase 3: `29-causas-merma.txt` y `31-inventario-inicial.txt`. El inventario inicial lo autoriza el contralor.
4. El plan `28-plan-produccion.txt` (02/01/2027) **aprobado** en Plan de producción, sin capturar existencias.

Usuarios de **Datos de prueba**:

| Usuario | Puesto | Qué hace en producción |
|---|---|---|
| `prueba.jpr` | Jefe de producción | Genera las órdenes, cierra las de producto y cancela |
| `prueba.alm` | Almacenista | Surte los vales desde MP-MAT (no ve costos) |
| `prueba.mae` | Maestro de masas | Registra avance y cierra las órdenes de masa (no ve costos) |
| `prueba.pan` | Panadero | Registra avance y merma por etapa |
| `prueba.con` | Contralor | Revisa costos, variaciones y el estado de costos |

## Recorrido (menú **Producción**)

| Paso | Quién | Qué hacer | Resultado esperado |
|---|---|---|---|
| 1 | jefe de producción | **Órdenes → Generar órdenes** del PLAN-000001 | 7 órdenes. Masas: dulce 39.2 kg (2 lotes), cubierta 5.25 kg, blanca 72 kg (3 lotes). Productos: concha vainilla 240, concha chocolate 96, bolillo 490, telera 120. |
| 2 | jefe de producción | Abre la orden de **masa blanca** | Estándar: harina 45 kg, agua 27, sal 0.9, levadura 0.45; amasado 75 minutos. Costo estándar $15.5971 por kg. "Abastece" al bolillo y a la telera. |
| 3 | almacenista | En la masa blanca, **Vale de surtido**: cambia la harina a **50** y surte | Pide el **motivo** (pasa el estándar + 5 %). Con motivo, el vale queda registrado y la harina pasa a PEP-MAT. |
| 4 | almacenista | Surte con lo propuesto la masa dulce, la cubierta y la concha de vainilla (bolsas) | El huevo sale del lote PRUEBA-HUE-A. |
| 5 | maestro de masas | Masa blanca: **Registrar avance** en PRUEBA-AMASADO, 72 kg y 75 minutos; luego **Cerrar orden** con 72 | Costo real **$1,122.99**: materiales $886.59 + mano de obra 75 min × $2 = $150 + indirectos 72 kg × $1.20 = $86.40. Los 5 kg de harina de más quedan en producción en proceso. |
| 6 | maestro de masas | Cierra la masa dulce (39.2) y la cubierta (5.25) | En la orden de masa dulce aparecen los lotes consumidos (harina PRUEBA-HAR-A, huevo PRUEBA-HUE-A…). |
| 7 | panadero | Bolillo: avance en PRUEBA-HORNEADO, 480 piezas y **10 de merma, causa QUEMADO** | Queda en proceso. En PRUEBA-AMASADO no deja registrar merma. |
| 8 | maestro de masas | Intenta cerrar el bolillo | No puede: las órdenes de producto las cierra el jefe de producción. |
| 9 | jefe de producción | Cierra el bolillo con **480** buenas y masa blanca **40** kg | Balance de masa 40 contra 39.184 kg (+2.08 %) ✔ y de piezas 480 de 490 formadas ✔. Costo real $796.68: masa $623.88 + formado 96 min × $1.80. |
| 10 | jefe de producción | Cierra la concha de vainilla con 240 y masa dulce **20** kg | **Fuera de tolerancia**: masa 20 contra 15 kg. Pide justificación; con ella cierra y queda marcada para revisión. |
| 11 | jefe de producción | Cancela la telera con motivo | Queda cancelada; la masa blanca que sobra sigue en producción en proceso. |
| 12 | contralor | **Trazabilidad por lote** → `PRUEBA-HAR-A` | Hacia adelante: las tres masas, el bolillo y la concha de vainilla. |
| 13 | contralor | **Variaciones** del 01/01/2027 al 31/01/2027 | Cinco órdenes cerradas. La concha de vainilla aparece "fuera" con su justificación; por material, masa dulce 15 kg estándar contra 20 real. |
| 14 | contralor | **Rendimiento y merma** (mismo periodo) | 10 bolillos quemados en horneado, registrados por prueba.pan (2.04 %). |
| 15 | jefe de producción | **Sobrantes** | Masa blanca 32 kg (no se reutiliza: registrar merma), masa dulce 19.2 kg (se reutiliza) y la harina de más. |
| 16 | contralor | **Estado de costos** del mes en curso | Las tres comprobaciones en verde (✔): materia prima, producción terminada y costo de lo vendido cuadran con el kárdex. |

El jefe de producción solo consulta el estado de costos de su sucursal (escribe `MAT` en Sucursal).

## Lo que todavía no hace

- **Reabrir una orden cerrada:** se corrige con un ajuste por conteo en Inventarios.
- **Indirectos reales contra aplicados y pólizas:** Fase 7 (contabilidad).
- **Venta en oferta del pan no vendido** (P37): falta definir cómo se registra en caja.
