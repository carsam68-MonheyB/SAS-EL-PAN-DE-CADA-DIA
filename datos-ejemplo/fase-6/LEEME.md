# Archivos de ejemplo de la Fase 6 · Punto de venta (DATOS FICTICIOS)

Todo es **inventado**: claves `PRUEBA-`, precios y existencias de prueba.

**Antes:** deben estar cargados los ejemplos de la Fase 1B. La tasa `PRUEBA-IVA` es ficticia (0 %); la real la define tu contador.

Usuarios de **Datos de prueba**:
- `prueba.caj`: cajero de la Sucursal 1.
- `prueba.enc`: encargado de la Sucursal 1. Autoriza devoluciones, retiros, cancelaciones de pedidos y el corte Z.
- `prueba.jpr`: jefe de producción.
- `prueba.con`: contralor. Autoriza descuentos y pedidos sin anticipo (igual que `prueba.cnt`, el contador).

## 1. Preparación (una sola vez)

1. **Existencias en la sucursal.**
   - Con `prueba.jpr`, en **Cargas masivas**, sube `32-inventario-inicial-sucursal.txt` (catálogo "Inventario inicial").
   - Con `prueba.con`, autorízalo.
2. **Precios de hoy.**
   - Abre `33-precios-HOY.txt` con el Bloc de notas y cambia `DD/MM/AAAA` por la fecha de hoy (ej. `22/11/2026`).
   - Con `prueba.con`, súbelo en el catálogo "Precios de venta".
   - Con `prueba.dir` (dirección), autorízalo.
3. **PIN.** Entra con `prueba.caj`, `prueba.enc` y `prueba.con`, ve a **Mi cuenta** y crea un PIN de 4 dígitos para cada uno (no se permiten 1234 ni 1111).

## 2. Recorrido en la caja (`prueba.caj` → menú **Punto de venta (caja)**)

| Paso | Qué hacer | Resultado esperado |
|---|---|---|
| 1 | Elige **Caja 1 · Sucursal 1** y abre turno con fondo **500** | Aparecen los productos con su precio y existencia. |
| 2 | 3 conchas de vainilla + 10 bolillos → **Cobrar** → $100 en efectivo | Total **$72.00**, cambio **$28.00**. Se imprime el ticket `CAJA-SUC1-1-000001`. Las conchas en existencia bajan de 50 a 47. |
| 3 | Intenta vender 31 conchas de chocolate (solo hay 30) | **No deja vender**: "Sin existencia suficiente". |
| 4 | Vende 1 telera | No deja: la telera de ejemplo **no tiene tasa de IVA**. Sirve para ver que faltan sus datos fiscales. |
| 5 | 2 conchas con **Tarjeta de crédito**, referencia `AUT-482913` | Se cobra. Si escribes un número de 16 dígitos, el sistema lo rechaza: nunca se guardan tarjetas. |
| 6 | 5 bolillos con **Descuento** de $3 → el contralor escribe su usuario y PIN → paga con $20 | Total **$12.00**, cambio **$8.00**. Ni el cajero ni el encargado pueden autorizar descuentos. |
| 7 | **Retiro / ingreso** → retiro de $50, autoriza el encargado | Se imprime el comprobante. |
| 8 | **Devolución** → folio `CAJA-SUC1-1-000001`, devolver 1 concha, autoriza el encargado | Regresan **$14.00** y la concha vuelve a la vitrina. |
| 9 | **Pedidos → Nuevo pedido:** 10 conchas de chocolate para el 01/01/2099, anticipo $50; después **Abonar** $20 | Total $150, saldo $80. |
| 10 | **Entregar** el pedido y cobrar $80 | Se vende a los precios del pedido: el ticket muestra anticipo $70 y efectivo $80. |
| 11 | Otro pedido de 2 conchas con anticipo $10 → **Cancelar** (devolver anticipo), autoriza el encargado | Salen $10 de la caja. |
| 12 | **Corte → Corte X** | Efectivo esperado **$670.00**: fondo 500 + ventas en efectivo 164 + anticipos 80 − retiro 50 − devolución 14 − anticipo devuelto 10. |
| 13 | **Corte → Corte Z:** cuenta 1 de $500, 1 de $100, 1 de $50 y 1 de $20; autoriza el encargado | Diferencia **$0.00** y el turno se cierra. Ya no se puede vender hasta abrir otro. |

## 3. Venta sin internet (prueba opcional)

1. Con la caja abierta, desconecta el internet de la computadora (o apaga el WiFi).
2. Aparece una barra roja **SIN CONEXIÓN**. Vende 2 bolillos: el ticket sale con folio `SC-…` y la leyenda "provisional".
3. Mientras no hay conexión, los botones de devolución, retiro, pedidos y corte están apagados.
4. Vuelve a conectar el internet. En unos segundos la venta se envía sola y recibe su folio definitivo.

## 4. Oficina (`prueba.con` → **Ventas y cortes**)

- **Ventas:** tickets del día con totales, devoluciones y costo de lo vendido. Se exportan a Excel y se reimprimen.
- **Cortes de caja:** el detalle de cada corte y su arqueo.
- **Pedidos:** por entregar, entregados y cancelados.
- **Nuevo pedido por WhatsApp o teléfono:** entra con `prueba.enc` → **Ventas y cortes** → **Pedidos**. Elige la sucursal que entrega, captura cliente y productos, y pide al contralor su usuario y PIN, porque el pedido va sin anticipo. El anticipo y la entrega se cobran en la caja.

## 5. Lo que todavía no hace

- **Factura y factura global:** Fase 8.
- **Pólizas contables:** Fase 7.
- **Abrir el cajón:** se configura en el controlador de Windows de la impresora Ghia al instalar la caja (P45).
- **Pedidos en el plan de producción:** todavía no entran solos al plan (P63).
