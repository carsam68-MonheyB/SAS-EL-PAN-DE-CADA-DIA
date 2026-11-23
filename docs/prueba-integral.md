# Prueba integral: un día completo de la panadería (DATOS FICTICIOS)

Esta guía recorre todo el sistema en el orden en que se trabaja: catálogos → producción → compras → inventarios → caja → facturación → contabilidad → tablero → respaldos. Todo es **inventado** (claves `PRUEBA-`). Se hace en el sitio de desarrollo de Netlify, nunca con datos reales.

Marca cada paso en la columna **¿Bien?** y anota lo que no salió como dice "Resultado esperado". Con esas notas corrijo lo necesario.

---

## 0. Preparación (una vez, 15 minutos)

| Paso | Qué hacer | Resultado esperado | ¿Bien? |
|---|---|---|---|
| 0.1 | En Netlify, el sitio de desarrollo debe tener la variable `PERMITIR_DATOS_PRUEBA` = `si`. Para empezar limpio, usa un **deploy preview nuevo** (cada uno tiene su propia base). | — | |
| 0.2 | Entra como **administrador** → **Usuarios → Usuarios de prueba**. | Aparece la contraseña de todos los usuarios `prueba.*`. **Anótala** (se muestra una sola vez). | |
| 0.3 | **Usuarios → Escenario de demostración** y espera la barra (lo que ya estuviera cargado se omite; puedes pulsarlo otra vez sin duplicar nada). | "Listo". Quedan cargados los catálogos de todas las fases, 7 recetas activas, el inventario inicial (autorizado), los precios de hoy, el catálogo contable, las reglas y el plan de producción. PIN de caja: `prueba.caj` 4821, `prueba.enc` 4826, `prueba.con` 4830, `prueba.cnt` 4831. | |
| 0.4 | Instala **Google Authenticator** o **Microsoft Authenticator** en tu teléfono. Contralor, contador, dirección y autorizador piden doble factor la primera vez: da de alta las cuatro cuentas en la misma aplicación. | Cada uno entra con su código de 6 dígitos. | |

> **Consejo:** para trabajar con varios usuarios a la vez, abre cada uno en una ventana distinta: Chrome normal, Chrome incógnito, Edge, Edge InPrivate. O cierra sesión y entra con otro.

---

## 1. Catálogos, recetas y costo estándar

| Paso | Quién | Qué hacer | Resultado esperado | ¿Bien? |
|---|---|---|---|---|
| 1.1 | `prueba.jpr` | **Catálogos**: revisa insumos, intermedios y productos | 4 productos PRUEBA (conchas, bolillo, telera), masas e insumos. | |
| 1.2 | `prueba.jpr` | **Recetas** → abre la concha de vainilla | Fórmula por pieza, etapas y mermas; versión 1 activa. | |
| 1.3 | `prueba.con` | **Costo estándar** → fecha 01/01/2027 (las recetas de ejemplo rigen desde ahí) → **Guardar como costo estándar** | Costo por pieza de cada producto (materiales, mano de obra e indirectos) y margen contra el precio. | |
| 1.4 | `prueba.pan` | Intenta abrir **Recetas** | No aparece en el menú: el panadero no ve fórmulas ni costos. | |

## 2. Plan y producción

Detalle y cifras exactas: `datos-ejemplo/fase-5/LEEME.md`.

| Paso | Quién | Qué hacer | Resultado esperado | ¿Bien? |
|---|---|---|---|---|
| 2.1 | `prueba.jpr` | **Plan de producción** → PLAN-000001 (02/01/2027) → revisa **Productos, Masas, Materia prima** → **Aprobar plan** | Masas: dulce 39.2 kg (2 lotes), blanca 72 kg (3 lotes)… El plan queda APROBADO. | |
| 2.2 | `prueba.jpr` | Pestaña **Requisición** → **Generar requisición** | Se genera la requisición de materia prima faltante. | |
| 2.3 | `prueba.jpr` | **Producción → Órdenes → Generar órdenes** | 7 órdenes. | |
| 2.4 | `prueba.alm` | Surte la **masa blanca** con harina **50** | Pide el motivo (pasa el estándar + 5 %). | |
| 2.5 | `prueba.mae` | Masa blanca: **Registrar avance** (AMASADO, 72 kg, 75 min) y **Cerrar** con 72 | Costo real **$1,122.99**. | |
| 2.6 | `prueba.pan`, `prueba.jpr` | Sigue los pasos 6 a 12 de la guía de la Fase 5 (bolillo con merma, cierre, justificación) | Balance de piezas, variaciones y lotes. | |
| 2.7 | `prueba.con` | **Producción → Estado de costos** y **Variaciones** | Cuadra con el kárdex; variaciones de cantidad y de precio. | |

## 3. Compras

Detalle: `datos-ejemplo/fase-4/LEEME.md` (usa las facturas XML de ejemplo de esa carpeta).

| Paso | Quién | Qué hacer | Resultado esperado | ¿Bien? |
|---|---|---|---|---|
| 3.1 | `prueba.alm` | **Compras → Requisiciones → Nueva**: harina 4 BULTO, azúcar 2 BULTO → enviar a autorización | Estimado $4,250.00. | |
| 3.2 | `prueba.aut1` | **Autorizaciones** → autoriza | Autorizada (dentro de su límite de $10,000). | |
| 3.3 | `prueba.com` | **Órdenes de compra** → crea la orden → **Imprimir / guardar PDF** | Orden emitida, lista para mandar al proveedor. | |
| 3.4 | `prueba.alm` | **Recibir mercancía** | Entra al inventario de materia prima. | |
| 3.5 | `prueba.com` | **Facturas** → sube `41-factura-PRUEBA-harina.xml` | Cotejo a 3 vías; sin diferencias pasa a cuentas por pagar. Con `42-…con-diferencia.xml` la diferencia la autoriza el contralor. | |
| 3.6 | `prueba.cnt` / `prueba.con` | **Pagos** → programar, autorizar y marcar pagado (BBVA) | Quien registra no autoriza. | |

## 4. Inventarios

| Paso | Quién | Qué hacer | Resultado esperado | ¿Bien? |
|---|---|---|---|---|
| 4.1 | `prueba.alm` | **Inventarios → Existencias y Alertas** | Existencias por almacén, mínimos y caducidades próximas. | |
| 4.2 | `prueba.jpr` | **Traspasos**: 20 bolillos de PT-MAT a PT-SUC1 | Sale de la planta; entra a PT-SUC1 cuando el encargado (`prueba.enc`) lo **recibe**. | |
| 4.3 | `prueba.enc` | **Mermas**: 2 conchas en PT-SUC1, causa "no vendido" | Queda por autorizar; el contralor la autoriza y sale al costo. | |
| 4.4 | `prueba.alm` | **Conteos físicos** → cuenta harina con una diferencia | El ajuste lo autoriza el contralor (no quien contó). | |

## 5. Caja (punto de venta)

Detalle y cifras: `datos-ejemplo/fase-6/LEEME.md` (sección 2; la preparación ya la hizo el escenario).

| Paso | Quién | Qué hacer | Resultado esperado | ¿Bien? |
|---|---|---|---|---|
| 5.1 | `prueba.caj` | **Punto de venta** → Caja 1 · Sucursal 1 → fondo 500 | Productos con precio y existencia. | |
| 5.2 | `prueba.caj` | 3 conchas de vainilla + 10 bolillos, cobra $100 | Total $72.00, cambio $28.00, ticket impreso. | |
| 5.3 | `prueba.caj` | Tarjeta con referencia `AUT-482913`; intenta escribir 16 dígitos | Con referencia sí; el número de tarjeta se rechaza. | |
| 5.4 | `prueba.cnt` | **Ventas y cortes → Ofertas de fin del día**: Pan dulce, 30 %, desde una hora que ya pasó | En la caja (recarga) la concha dice OFERTA −30 % y baja sola, sin PIN. | |
| 5.5 | `prueba.caj` | Descuento especial en un renglón | Lo autoriza el contralor con usuario y PIN (4830). | |
| 5.6 | `prueba.caj` | Pedido con anticipo, abono y entrega | Se imprime el **recibo de anticipo** (no es factura). | |
| 5.7 | `prueba.caj` | Devolución (autoriza el encargado, PIN 4826), retiro y **Corte Z** | Diferencia $0.00 si cuentas bien el efectivo. | |
| 5.8 | `prueba.caj` | Apaga el WiFi, vende, vuelve a prenderlo | Ticket provisional; se envía solo al volver el internet. | |

## 6. Facturación (portal del SAT)

Detalle: `datos-ejemplo/fase-8/LEEME.md`.

| Paso | Quién | Qué hacer | Resultado esperado | ¿Bien? |
|---|---|---|---|---|
| 6.1 | `prueba.enc` | **Facturación → Solicitar factura** de un ticket de hoy, con RFC `PEGJ800101AB1`, régimen 612, C.P. 06000, uso G03 y correo | Solicitud SOL-000001. Sin correo no deja. | |
| 6.2 | `prueba.cnt` | **Solicitudes → Facturar** → **Generar XML de PRUEBA** → **Registrar factura** | Queda Facturada · Por enviar. | |
| 6.3 | `prueba.cnt` | **Correo** y **Marcar enviada** | Queda Enviada, con fecha y quién. | |
| 6.4 | `prueba.cnt` | **Factura global diaria** de hoy, Sucursal 1 → XML de PRUEBA → Registrar | Un concepto por ticket, 01010101 / ACT, periodicidad 01. | |
| 6.5 | `prueba.cnt` → `prueba.con` | Registrar una cancelación y autorizarla | El ticket vuelve a poderse facturar. | |
| 6.6 | `prueba.con` | **Vendido vs. facturado** | Lo vendido contra lo facturado por día; alertas. | |

## 7. Contabilidad

Detalle: `datos-ejemplo/fase-7/LEEME.md` (el catálogo y las reglas ya están cargados).

| Paso | Quién | Qué hacer | Resultado esperado | ¿Bien? |
|---|---|---|---|---|
| 7.1 | `prueba.cnt` | **Contabilidad → Pólizas → Generar pólizas** | Se generan las de ventas, compras, inventarios y producción, sin pendientes. | |
| 7.2 | `prueba.cnt` | Abre la póliza de una venta facturada | Cargo a caja, abono a ventas e IVA; muestra el UUID de su factura. | |
| 7.3 | `prueba.cnt` → `prueba.con` | Póliza manual de aportación de capital y su autorización | Quien captura no autoriza. | |
| 7.4 | `prueba.con` | **Balanza**, **Estados financieros**, **Conciliación de inventario** | La balanza cuadra; activo = pasivo + capital; inventario contable = kárdex. | |
| 7.5 | `prueba.con` | **Cierre de periodo** del mes | Se cierra (si no queda nada pendiente) y queda un respaldo programado. | |

## 8. Tablero

| Paso | Quién | Qué hacer | Resultado esperado | ¿Bien? |
|---|---|---|---|---|
| 8.1 | `prueba.con` | **Tablero** → Resumen, Ventas (por hora, cajero, producto), Margen, Mermas, Rotación, Compras | Cifras de lo que hiciste hoy; todo se exporta a Excel. | |
| 8.2 | `prueba.enc` | **Tablero** | Solo ventas y mermas de su sucursal, sin costos. | |
| 8.3 | `prueba.com` | **Tablero** | Solo compras y precios de insumos. | |

## 9. Arranque y respaldos

| Paso | Quién | Qué hacer | Resultado esperado | ¿Bien? |
|---|---|---|---|---|
| 9.1 | administrador | **Arranque y respaldos → Revisión de arranque** | En desarrollo salen rojos a propósito (usuarios y datos de prueba, sin almacenamiento externo). | |
| 9.2 | administrador | **Respaldos → Descargar respaldo cifrado** (requiere `RESPALDO_LLAVE` en Netlify) | Se descarga el archivo `.erpresp` y queda registrado. | |
| 9.3 | `prueba.dir` | **Bitácora** | Se ve quién hizo cada cosa; nadie la puede modificar. | |

---

**Al terminar:** mándame la lista de pasos que no salieron "Bien", con lo que viste (de preferencia con una captura de pantalla).
