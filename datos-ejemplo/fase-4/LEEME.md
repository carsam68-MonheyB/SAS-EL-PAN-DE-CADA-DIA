# Archivos de ejemplo de la Fase 4 · Compras (DATOS FICTICIOS)

Todo es **inventado**: proveedores `PRUEBA-`, precios y facturas XML de prueba. Las facturas no están timbradas por el SAT.

**Antes:** deben estar cargados los ejemplos de la Fase 1B y el archivo `18-insumos-adicionales.txt` de la Fase 2.

Usuarios de **Datos de prueba**:

| Usuario | Puesto | Qué hace en compras |
|---|---|---|
| `prueba.alm` | Almacenista | Pide la requisición y recibe la mercancía |
| `prueba.aut1` | Autorizador nivel 1 | Autoriza hasta $10,000 |
| `prueba.dir` | Dirección | Autoriza montos mayores |
| `prueba.com` | Compras | Hace las órdenes de compra y registra facturas |
| `prueba.cnt` | Contador | Registra cuentas bancarias, programa pagos y los marca pagados |
| `prueba.con` | Contralor | Autoriza facturas con diferencias y pagos hasta $20,000 |

## 1. Cargas

| Archivo | Catálogo | Quién lo sube |
|---|---|---|
| `40-cuentas-bancarias.txt` | Cuentas bancarias | contador |

Las XML `41-…` y `42-…` se suben dentro de la orden de compra, no en Cargas masivas.

## 2. Recorrido (menú **Compras**)

| Paso | Quién | Qué hacer | Resultado esperado |
|---|---|---|---|
| 1 | almacenista | **Requisiciones → Nueva:** harina 4 BULTO y azúcar 2 BULTO, con "Enviar a autorización" | Estimado **$4,250.00** (100 kg × $18.50 + 100 kg × $24.00). |
| 2 | autorizador nivel 1 | **Autorizaciones** → Autorizar | La requisición queda **autorizada**. El almacenista no puede autorizarla. |
| 3 | compras | Abre la requisición → **Crear orden de compra** → proveedor PRUEBA-PROV-01, solo la harina, 4 BULTO a **$450**, IVA PRUEBA-IVA | **OC-000001 emitida** por $1,800.00, porque no rebasa lo autorizado ($1,850). |
| 4 | compras | Otra orden con el azúcar: PRUEBA-PROV-02, 2 BULTO a **$1,300** | $2,600 rebasa lo autorizado más 5 % ($2,520): **queda por autorizar**. |
| 5 | autorizador nivel 1 | **Autorizaciones** → Autorizar la OC-000002 | Queda emitida. |
| 6 | almacenista | **Órdenes de compra** → OC-000001 → recibe 4, lote `PRUEBA-HAR-C`, caducidad 31/05/2027 | Entran **100 kg a $18.00** al almacén MP-MAT. El almacenista no ve precios. |
| 7 | compras | OC-000001 → **Elegir archivo XML** → `41-factura-PRUEBA-harina.xml` → Registrar | El cotejo cuadra y pasa a **cuentas por pagar**, con vencimiento el 07/12/2026 (15 días de crédito). |
| 8 | compras | En la misma orden sube `42-factura-PRUEBA-con-diferencia.xml` (precio $470) | Queda **con diferencias** (precio, cantidad y total) y pide autorización del contralor. |
| 9 | contralor | **Autorizaciones** → Rechazar la factura con un comentario | No genera cuenta por pagar. |
| 10 | contador | **Cuentas por pagar** → marca la factura → **Programar** pago por transferencia | Queda por autorizar. No deja pagar más del saldo. |
| 11 | contralor | **Autorizaciones** → Autorizar el pago | Quien recibió la mercancía no podría autorizarlo. |
| 12 | contador | **Pagos** → **Marcar pagado** con fecha y referencia SPEI | La factura queda pagada y sale de la antigüedad de saldos. |
| 13 | compras | **Comparativo de precios** | Harina con PRUEBA-PROV-01 a $18.0000 por kg. |

Para ver el nivel 2: haz una requisición de 30 BULTO de harina ($13,875). El autorizador de nivel 1 no puede autorizarla; dirección sí.

## 3. Lo que todavía no hace

- **Enviar la orden de compra por correo** (P41): decidido que no; se imprime o se guarda en PDF desde el navegador.
- **Pagar directo desde el banco** (P42): el pago se hace en BBVA y después se registra en el sistema con su referencia.
- **Verificar la factura ante el SAT y el complemento de pago:** Fase 8.
- **Pólizas contables:** Fase 7.
- **Devoluciones al proveedor y notas de crédito:** se agregan cuando las necesites.
