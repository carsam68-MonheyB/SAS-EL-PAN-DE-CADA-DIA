# Manual de usuario · SAS El Pan de Cada Día

Este manual explica, por puesto, lo que cada persona hace en el sistema. Cada quien ve en el menú solo lo que le toca. Si falta un botón, es porque tu puesto no tiene ese permiso: pídelo al administrador.

**Formato:** las fechas se escriben **DD/MM/AAAA** (22/11/2026) y las cantidades con punto decimal (1,250.75).

---

## 1. Entrar al sistema (todos)

1. Abre la dirección del sistema en el navegador (Chrome o Edge).
2. Escribe tu **usuario** y **contraseña**. La primera vez entras con el enlace de invitación que te manda el administrador y creas tu contraseña (mínimo 10 caracteres).
3. **Doble factor:** algunos puestos (administrador, contador, contralor, dirección, autorizadores) además escriben el código de 6 dígitos de la aplicación **Google Authenticator** o **Microsoft Authenticator**. La primera vez el sistema muestra un código QR para darlo de alta en tu teléfono. Guarda los códigos de recuperación en un lugar seguro.
4. **PIN de caja:** cajeros, encargados, contador y contralor crean un PIN de 4 dígitos en **Mi cuenta**. Sirve para cambiar de cajero y para autorizar en la caja. No uses 1234 ni 1111.
5. Si te equivocas varias veces, tu usuario se bloquea unos minutos. Si olvidaste la contraseña, pide al administrador un enlace para restablecerla.
6. Al terminar, usa **Cerrar sesión**. Por seguridad la sesión se cierra sola si no hay actividad.

---

## 2. Cajero (Punto de venta)

Menú **Punto de venta (caja)**.

| Qué hacer | Cómo |
|---|---|
| Abrir la caja | La primera vez en esa computadora, elige la caja (ej. *Caja 1 · Sucursal 1*). Escribe el **fondo** y abre turno. |
| Vender | Toca los productos (o búscalos por nombre o código de barras), ajusta cantidades y **Cobrar**. Elige la forma de pago; con tarjeta escribe **solo la referencia o autorización del voucher, nunca el número de la tarjeta**. Se imprime el ticket. |
| Oferta de fin del día | Desde la hora que fijó el contador, el producto dice **OFERTA −X%** y el precio baja solo. No pidas autorización. |
| Descuento especial | **Descuento** en el renglón: lo autoriza el contador o el contralor con su usuario y PIN. |
| Factura | Si el cliente quiere factura, pide **ese mismo día** sus datos y su correo y pásalos al encargado (menú Facturación). La factura le llega por correo al día siguiente. |
| Pedido con anticipo | **Pedidos → Nuevo pedido**. Se imprime el comprobante del pedido y el **recibo de anticipo** (no es factura). Para abonar: **Abonar**. Al entregar: **Entregar**, se cobra el saldo. |
| Devolución | **Devolución** → folio del ticket → piezas → la autoriza el encargado con su PIN. |
| Retiro de efectivo | **Retiro / ingreso**, autoriza el encargado. |
| Corte X | **Corte → Corte X**: cuánto debe haber en caja, sin cerrar el turno. |
| Corte Z | **Corte → Corte Z**: cuenta billetes y monedas; el encargado autoriza y el turno se cierra. |
| Sin internet | Aparece la barra roja **SIN CONEXIÓN**. Puedes seguir vendiendo; el ticket sale como provisional y la venta se envía sola cuando regrese el internet. No se pueden hacer devoluciones, retiros, pedidos ni cortes hasta que vuelva. |
| Cambiar de cajero | **Cambiar cajero**: el siguiente cajero escribe su usuario y PIN. |

---

## 3. Encargado de sucursal

- **Autoriza en la caja** con su usuario y PIN: devoluciones, retiros, cancelación de pedidos y corte Z (hasta su límite; arriba autoriza el contralor).
- **Inventarios → Mermas:** registra el pan dañado o no vendido; lo autoriza el contralor.
- **Inventarios → Traspasos y Conteos físicos** de su sucursal.
- **Facturación → Solicitar factura:** folio del ticket, RFC, nombre o razón social, régimen, código postal, uso del CFDI y **correo** del cliente. Debe ser el mismo día de la compra.
- **Tablero:** ventas y mermas de su sucursal.

---

## 4. Producción (jefe de producción, maestro de masas, panaderos)

- **Plan de producción:** el jefe de producción carga o captura el plan del día (piezas por producto), lo revisa (masas, lotes, materia prima) y lo **aprueba**. De ahí sale la **requisición** de materia prima.
- **Producción → Órdenes:** el jefe genera las órdenes desde el plan aprobado.
- **Surtido:** el almacenista surte la materia prima a producción contra cada orden.
- **Avance:** el maestro de masas y los panaderos registran en cada **etapa** lo que terminó, los minutos y la merma con su causa.
- **Cierre de la orden:** se capturan las piezas buenas; el sistema calcula el costo real y avisa si la diferencia contra el estándar pasa la tolerancia (hay que escribir la justificación). Las órdenes de producto terminado las cierra el jefe de producción.
- **Recetas y Costo estándar:** solo el jefe de producción (y dirección/contralor) ven la fórmula completa y los costos.

---

## 5. Almacén

- **Inventarios → Existencias y Alertas** (mínimos, caducidades).
- **Inventarios → Entradas y surtidos:** recepción de compras contra la orden de compra (Compras → Órdenes de compra → Recibir), surtidos a producción.
- **Traspasos** entre almacenes y **Conteos físicos** (los ajustes los autoriza el contralor; quien contó no autoriza su ajuste).

---

## 6. Compras y autorizadores

- **Compras → Requisiciones:** se crean desde el plan o a mano; las autoriza el autorizador (o dirección si pasan de su límite). Nadie autoriza las suyas.
- **Órdenes de compra:** solo con requisición autorizada; se imprimen o se guardan en PDF para mandarlas al proveedor.
- **Facturas:** se sube el XML del proveedor y el sistema hace el **cotejo a 3 vías** (orden, recepción y factura). Las diferencias fuera de tolerancia las autoriza el contralor.
- **Cuentas por pagar y Pagos:** pagos por BBVA; quien registra un pago no lo autoriza.
- **Tablero → Compras y precios:** compras por proveedor y variación de precios de los insumos.

---

## 7. Contador

- **Cargas masivas:** catálogo de cuentas, reglas de contabilización, catálogos del SAT.
- **Contabilidad → Pólizas → Generar pólizas:** contabiliza ventas, compras, inventarios y producción. Si un documento queda pendiente, el sistema dice qué cuenta falta.
- **Póliza manual:** la captura el contador y la autoriza el contralor.
- **Facturación (portal del SAT):**
  1. **Solicitudes → Facturar:** el sistema muestra los datos para capturar en el portal del SAT. Al terminar, descarga el XML del portal y súbelo con **Elegir archivo XML → Registrar factura**.
  2. Envía al cliente el PDF y el XML por correo (botón **Correo**) y marca **Marcar enviada**. Debe llegarle al día siguiente; si no, sale como atrasada.
  3. **Factura global diaria:** con los tickets del día que no se facturaron aparte. Se capturan en el portal y se sube el XML.
  4. **Cancelaciones:** se cancelan en el portal y aquí se registran; las autoriza el contralor.
  5. **Notas de crédito:** si se devuelve producto de un ticket ya facturado, el sistema avisa; se hace en el portal y se sube el XML en la factura.
- **Ofertas de fin del día:** **Ventas y cortes → Ofertas de fin del día**: % de descuento y hora desde la que aplica.

---

## 8. Contralor

- Autoriza: pólizas manuales, cancelaciones de facturas, ajustes de inventario, mermas, diferencias de facturas de proveedor, pagos (hasta su límite), cargas de existencias y precios.
- Autoriza descuentos en caja con su PIN y captura ofertas de fin del día.
- **Contabilidad → Cierre de periodo:** cierra el mes (deben estar autorizadas todas las pólizas y la balanza cuadrar). Al cerrar, se hace solo un respaldo externo.
- **Contabilidad → Conciliación de inventario** y **Facturación → Vendido vs. facturado**.
- **Tablero** completo.

---

## 9. Dirección

- **Tablero:** ventas, márgenes, mermas, rotación de inventario y compras; todo se exporta a Excel.
- Autoriza precios de venta, requisiciones y pagos que pasan los límites de los demás.
- Consulta contabilidad, facturación y bitácora.

---

## 10. Administrador del sistema

- **Usuarios:** alta con su puesto, sucursal y almacén; el sistema manda la invitación. **Baja** cuando alguien deja la empresa (nunca se borra).
- **Roles y permisos, Segregación y límites:** los puestos y montos se cambian sin programar. El sistema no deja juntar funciones incompatibles.
- **Bitácora:** quién hizo qué y cuándo; nadie la puede modificar.
- **Arranque y respaldos:** revisión de arranque, respaldos externos (respaldo manual y descarga cifrada).
- **Configuración y consumo:** parámetros y consumo estimado de la base de datos.
- El administrador **no opera** (no vende, no compra, no contabiliza).

---

## Preguntas frecuentes

- **¿Puedo borrar algo que capturé mal?** No. Nada se borra: se cancela o se corrige con otro movimiento (devolución, cancelación, ajuste), y queda registrado quién y por qué.
- **¿Por qué no me deja vender un producto?** Porque no hay existencia, no tiene precio vigente o le faltan datos fiscales.
- **El ticket salió como "provisional".** Se hizo sin internet; se registra solo al volver la conexión.
- **¿Dónde veo cuánto vendí hoy?** En la caja: **Ventas del turno**. En oficina: **Tablero** o **Ventas y cortes**.
