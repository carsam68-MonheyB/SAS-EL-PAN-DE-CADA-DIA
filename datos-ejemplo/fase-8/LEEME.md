# Fase 8 · Facturación con el portal del SAT: cómo probarla (DATOS FICTICIOS)

Todo es **inventado**: RFC, clientes, tickets y XML. En este ambiente **no se usa el portal del SAT**. El botón **Generar XML de PRUEBA** crea un XML parecido al que se descarga del portal, para ensayar. No es una factura real ni está timbrada.

**Antes:**
- Haz la preparación de la Fase 6 (existencias, precios de hoy y PIN).
- Vende en la caja con `prueba.caj` al menos 3 tickets. Por ejemplo, los pasos 2, 5 y 6 del recorrido de la Fase 6.
- Con `prueba.cnt`, en **Cargas masivas**, sube `80-sat-receptor.txt` (catálogo "Catálogos del SAT"). Son claves de régimen fiscal y uso del CFDI marcadas PRUEBA; las oficiales se cargan del archivo del SAT.

Usuarios de **Datos de prueba**:

| Usuario | Qué hace en facturación |
|---|---|
| `prueba.enc` | Encargado de la Sucursal 1: captura solicitudes de factura de sus tickets; puede subir el XML de su sucursal |
| `prueba.cnt` | Contador: hace las facturas en el portal, sube los XML y registra cancelaciones |
| `prueba.con` | Contralor: autoriza cancelaciones y revisa la conciliación |

## Recorrido (menú **Facturación**)

| Paso | Quién | Qué hacer | Resultado esperado |
|---|---|---|---|
| 1 | encargado | **Solicitar factura** → folio `CAJA-SUC1-1-000001` → **Buscar** | Muestra el ticket y el total a facturar. |
| 2 | encargado | RFC `PEGJ800101AB1`, nombre `PRUEBA Juan Pérez`, régimen 612, C.P. 06000, uso G03, correo `prueba@example.com` → **Registrar solicitud** | Queda la solicitud `SOL-000001`. Sin correo no deja (la factura le llega por correo al día siguiente). Si buscas el ticket otra vez, dice que ya tiene solicitud. |
| 3 | encargado | Intenta con RFC `XAXX010101000` o régimen `999` | No deja: el RFC genérico va en la global; el régimen no está en el catálogo. |
| 4 | contador | **Solicitudes** → **Facturar** en `SOL-000001` | Aparecen los datos para capturar en el portal: receptor, un concepto por producto, forma de pago y totales. |
| 5 | contador | **Generar XML de PRUEBA** (en la vida real: **Elegir archivo XML** con el que bajaste del portal) | La revisión muestra el UUID y los importes en verde. Si el XML no cuadra con el ticket o es de otro RFC, sale en rojo con la razón. |
| 6 | contador | **Registrar factura** | La solicitud queda **Facturada · Por enviar** con su UUID. El ticket ya no se puede facturar otra vez. |
| 6b | contador | En **Solicitudes**: **Correo** (abre tu correo con el cliente y el asunto; adjunta el PDF y el XML del portal) → **Marcar enviada** | Queda **Enviada** con fecha y quién la envió. Si al día siguiente no se ha enviado, sale **Atrasada**. |
| 7 | contador | **Factura global diaria** → día de hoy, Sucursal 1 | Lista los tickets del día que no se facturaron aparte: uno por concepto, con su folio, clave 01010101, unidad ACT y periodicidad 01. Se exporta a Excel. |
| 8 | contador | **Generar XML de PRUEBA** → **Registrar factura** | Se registra la global. Si ahora el encargado busca uno de esos tickets, dice que va en la factura global. |
| 9 | caja + encargado | Devuelve 1 concha del ticket `CAJA-SUC1-1-000001` (ya facturado) | En **Vendido vs. facturado** aparece el aviso: hace falta una nota de crédito. |
| 10 | contador | **Facturas registradas** → abre la factura individual → en "Nota de crédito" escribe el importe devuelto → **Generar XML de PRUEBA** → **Registrar** | El aviso desaparece. |
| 11 | contador | En una factura: **Registrar cancelación**, motivo 02 y una nota | Queda "Cancelación por autorizar". El contador no la puede autorizar. |
| 12 | contralor | Abre la factura → **Autorizar cancelación** | Queda cancelada. Sus solicitudes vuelven a pendientes y sus tickets se pueden facturar otra vez. |
| 13 | contralor | **Vendido vs. facturado** | Por día y sucursal: vendido, facturado individual y global, y lo que falta. Los días anteriores sin global salen en rojo. |
| 14 | caja | **Pedidos → Nuevo pedido** con anticipo | Además del comprobante del pedido se imprime el **recibo de anticipo** `REC-…` con la leyenda "no es comprobante fiscal". Al entregar, el ticket incluye todo y se factura completo. |
| 15 | contador | **Contabilidad → Pólizas** → **Generar pólizas** → abre la póliza de la venta facturada | Muestra el UUID de su factura. |

## XML del SAT (ZIP de la descarga masiva)

El contador baja del portal del SAT el ZIP con las facturas **emitidas y recibidas** de un periodo y lo sube aquí. El sistema **no se conecta al SAT** ni guarda la e.firma: solo lee el ZIP.

| Paso | Quién | Qué hacer | Resultado esperado |
|---|---|---|---|
| 16 | encargado | Intenta abrir **Facturación → XML del SAT** | No aparece: trae todas las facturas de la empresa (también compras con sus costos). Solo contador y contralor. |
| 17 | contador | **XML del SAT → Elegir ZIP o XML** → `81-descarga-SAT-PRUEBA.zip` | Folio `SAT-…`: **4 facturas nuevas** (2 emitidas, 2 recibidas) y 3 rechazos explicados: una factura de otra empresa, un XML dañado y un archivo que no es XML. Si `empresa.rfc` está vacío, avisa que tomó el RFC `EKU9003173C9` de las facturas. |
| 18 | contador | Sube el mismo ZIP otra vez | 0 nuevas, 4 ya cargadas: no se duplica nada. |
| 19 | contador | Periodo **01/11/2026 – 30/11/2026** | Cada factura con su situación: **Registrada** (en el SAT y en el sistema), **Falta registrar** (en el SAT, no en el sistema) o **No viene en el SAT** (registrada aquí, revisar si se canceló o si falta bajar ese periodo). Las de ejemplo salen como "Falta registrar". |
| 20 | contador | Botón **XML** de una factura | Baja el XML para subirlo donde corresponde (Solicitudes, Factura global o Compras → Facturas). |
| 21 | contralor | **Exportar a Excel** | La comparación completa del periodo. |

El ZIP de ejemplo se regenera con `node scripts/generar-zip-sat.mjs`.

## Lo que no hace (por la decisión de facturar en el portal del SAT)

- No timbra ni cancela ante el SAT: eso se hace en el portal y aquí solo se registra.
- No descarga XML del SAT automáticamente (no hay e.firma en el sistema): el contador baja el ZIP del portal y lo sube en **XML del SAT**.
- No verifica el estatus de una factura ante el SAT.
- No hace complementos de pago (las ventas de mostrador son de contado, PUE).
