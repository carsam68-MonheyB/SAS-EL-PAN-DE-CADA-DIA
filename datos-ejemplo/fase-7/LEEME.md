# Fase 7 · Contabilidad: cómo probarla (DATOS FICTICIOS)

Todo es **inventado**. El catálogo de cuentas `PRUEBA` no es el del negocio. Las cuentas reales las define tu contador (P51), y con ellas se capturan las reglas.

**Antes:** ten operaciones de las fases anteriores (por ejemplo, el recorrido de la Fase 5 o de la Fase 6) para que haya algo que contabilizar.

Usuarios de **Datos de prueba**:

| Usuario | Puesto | Qué hace en contabilidad |
|---|---|---|
| `prueba.cnt` | Contador | Carga el catálogo y las reglas, genera pólizas y captura pólizas manuales |
| `prueba.con` | Contralor | Autoriza pólizas manuales, revisa reportes y cierra el mes |
| `prueba.dir` | Dirección | Consulta reportes |

## 1. Cargas (Cargas masivas, modo Alta, como contador)

| Archivo | Catálogo |
|---|---|
| `70-catalogo-cuentas.txt` | Catálogo de cuentas (44 cuentas `PRUEBA`, de mayor y subcuentas) |
| `71-reglas-contables.txt` | Reglas de contabilización (a qué cuenta va cada concepto; la caja de SUC1 tiene su propia cuenta) |

## 2. Recorrido (menú **Contabilidad**)

| Paso | Quién | Qué hacer | Resultado esperado |
|---|---|---|---|
| 1 | contador | **Reglas de contabilización**: quita la cuenta de "Mano de obra aplicada" | Aparece el aviso de que 1 concepto no tiene cuenta. |
| 2 | contador | **Pólizas** | "Por contabilizar" muestra los documentos. Las órdenes de producción con mano de obra salen **pendientes**: "Falta la cuenta de: MOD_APLICADA". |
| 3 | contador | Vuelve a poner la cuenta 5101-04 y da **Generar pólizas** | Se generan todas. Si vuelves a darle, no genera nada (un documento se contabiliza una sola vez). |
| 4 | contador | Abre la póliza de una venta en SUC1 | Cargo a 1101-02 Caja Sucursal 1 (regla de sucursal); abono a ventas e IVA. Es de tipo Ingreso. |
| 5 | contador | Abre la póliza de una orden de producción | Cargo a producto terminado; abono a producción en proceso (materiales), mano de obra aplicada e indirectos. Sumas iguales. |
| 6 | contador | **Póliza manual**: aportación de capital, cargo 1102-01 $50,000 / abono 3101-01 $50,000 | Queda **por autorizar**. Si no cuadra o usas una cuenta de mayor (1102), no la registra. |
| 7 | contralor | Abre la póliza y **Autoriza** | Queda aplicada. Quien captura una póliza no puede autorizarla. |
| 8 | contralor | **Balanza** del mes | ✔ cuadra. Las cuentas de mayor suman sus subcuentas. Se exporta a Excel. |
| 9 | contralor | **Auxiliares** → 1101-02 | Movimientos de la caja de SUC1 con saldo corrido. |
| 10 | contralor | **Estados financieros** | Estado de resultados y balance general: activo = pasivo + capital ✔. |
| 11 | contralor | **Conciliación de inventario** | Materia prima, producción en proceso y producto terminado: kárdex = contabilidad (a lo más centavos por redondeo). |
| 12 | contador | Captura otra póliza manual y no la autorices | — |
| 13 | contralor | **Cierre de periodo** → Cerrar el mes | No deja: hay una póliza sin autorizar. Al rechazarla, cierra. |
| 14 | contador | Intenta una póliza manual con fecha del mes cerrado | No entra: el periodo está cerrado. Las ventas nuevas de ese mes quedan pendientes "periodo cerrado". |
| 15 | contralor | **Reabrir** con motivo | El periodo se abre y queda registrado quién y por qué. |

## Lo que todavía no hace

- **Contabilidad electrónica** (XML de catálogo y balanza para el SAT, P57): la balanza y el catálogo se exportan a Excel.
- **Cierre anual** (traspaso del resultado del ejercicio al capital): por ahora el balance muestra el resultado de ejercicios anteriores calculado.
- **Facturación (CFDI) y la relación de cada póliza con su UUID:** Fase 8.
