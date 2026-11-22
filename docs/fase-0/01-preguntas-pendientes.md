# Fase 0 · Preguntas pendientes

> Responde con el número de la pregunta (ej. "P07: 2 sucursales y una planta central"). Si aún no sabes alguna, escribe "pendiente": no bloquea la Fase 1 salvo las marcadas con **[Bloquea F1]**.
> Ningún valor de esta lista se va a poner "en duro": todo queda en catálogos o configuración editable. Las preguntas sirven para diseñar la estructura y cargar los valores iniciales.

## A. Empresa, repositorio y cuentas

| # | Pregunta | Bloquea |
|---|---|---|
| P01 | Nombre comercial, razón social, RFC y régimen fiscal (clave SAT, ej. 601, 612, 626). | F1 (datos de configuración) |
| P02 | ✅ **Respondida:** repositorio privado temporal `carsam68-MonheyB/SAS-EL-PAN-DE-CADA-DIA`, ya conectado a la sesión de Claude. | — |
| P03 | 🟡 **Parcial:** proyecto temporal `sas-el-pan-de-cada-dia` en tu cuenta, con **plan Personal por créditos** (USD 9/mes, 1,000 créditos compartidos con tus otros proyectos). No se paga Pro durante el desarrollo. Falta confirmar en el panel: repositorio conectado con `main` como producción, y que Billing muestre **créditos**. | **[Bloquea F1]** |
| P04 | ✅ **Respondida:** todavía no hay dominio. → Pruebas y Fase 1 con el subdominio gratuito de Netlify (`*.netlify.app`). Antes de producción: registrar dominio (`.mx` o `.com.mx`) y administrar su DNS en Netlify. Pendiente: nombre de dominio elegido. | No |
| P05 | ✅ **Respondida:** todavía no hay correo. → Propuesta: buzones solo para el personal de oficina (Microsoft 365 o Google Workspace; Zoho Mail si se busca el menor costo) y **Resend** para los correos que envía el sistema. Cajeros y panaderos **no necesitan correo**: entran con usuario y contraseña. Pendiente: elegir proveedor de buzones. | No (en Fase 1 la invitación se puede mostrar como enlace para entregarlo en persona) |
| P06 | Almacenamiento **fuera de Netlify** para respaldos y XML: Amazon S3, Backblaze B2, Google Cloud Storage, Azure, Google Drive… Recomiendo uno con **bloqueo de objetos (Object Lock / WORM)** para que ninguna credencial pueda borrar respaldos (S3 y B2 lo tienen). ¿Cuál prefieres o ya tienes cuenta? | F1 (diseño), F9 (operación) |
| P68 | **Estructura definitiva de producción** (cuenta o team de Netlify del negocio, correo, plan). Se define antes de cargar datos reales. | F9 / antes de datos reales |
| P07 | 🟡 **Parcial:** el sistema actual es **Soft Restaurant 7.0**, y el nuevo sistema lo reemplaza por completo. Falta: fecha de arranque deseada; desde cuándo lo usan; si factura (CFDI) desde ahí y con qué PAC; qué datos se migran (productos, precios, clientes, historial de ventas para sugerir el plan de producción); si se adelanta el POS (ver diseño, sección 5). | No |

## B. Estructura operativa

| # | Pregunta | Bloquea |
|---|---|---|
| P08 | ✅ **Respondida:** **Matriz** (planta + punto de venta) y **1 sucursal**; claves provisionales `MAT` y `SUC1` (nombres pendientes, no bloquean). El catálogo permite agregar sucursales después. | — |
| P09 | ✅ **Respondida:** **una sola planta de producción, en la Matriz**, que surte a la sucursal. Toda la PEP (masas e intermedios) vive en la Matriz. | — |
| P10 | ✅ **Respondida:** **1 caja en la Matriz** (`CAJA-MAT-1`) y **1 caja en la Sucursal 1** (`CAJA-SUC1-1`). | — |
| P11 | ✅ **Respondida:** `MP-MAT` materia prima · `PEP-MAT` producción en proceso · `PT-MAT` producto terminado de planta **y venta de la Matriz** (el mostrador de la Matriz vende directo de aquí) · `PT-SUC1` producto terminado de la sucursal. Pendiente opcional: `INS-SUC1` (empaques en sucursal). | — |
| P12 | ✅ **Respondida:** producción desde las **3:00** y venta de **7:00 a 21:00**, todos los días. El sistema se usa ~18 h al día (3:00–21:00). Los procesos programados (respaldos, descarga SAT, recálculos) se agrupan dentro de esa ventana, para no despertar la base de madrugada. | — |
| P13 | Turnos de producción (nombre, horario). 🟡 **Fase 2:** se cargan en el catálogo "Turnos de producción"; el plan puede ir por día completo mientras no se definan. | No |
| P14 | Número aproximado de usuarios del sistema y cuántos usarían el sistema al mismo tiempo en la hora pico. | No |
| P15 | Centros de costo que quieres manejar (ej. por sucursal, planta, administración). | F1 |

## C. Usuarios, roles y seguridad

| # | Pregunta | Bloquea |
|---|---|---|
| P16 | ✅ **Aprobada (21/11/2026):** matriz de puestos v3 (`05-matriz-puestos-borrador.md` / `.xlsx`), con montos límite provisionales. Los roles son plantillas editables: puestos nuevos (ej. auxiliar de producción, repartidor) se agregan desde la configuración sin programar. | — |
| P17 | Roles con doble factor obligatorio, además de administrador, autorizadores y quien maneje e.firma/PAC. | F1 |
| P18 | Valores iniciales de seguridad: longitud mínima de contraseña, intentos fallidos antes de bloqueo, minutos de bloqueo, minutos de inactividad para cerrar sesión (oficina y POS por separado), dígitos del PIN de cajero. | F1 |
| P19 | Lista inicial de **incompatibilidades** de segregación de funciones (además de las 4 del documento). | F1 |
| P20 | ✅ **Respondida:** **autenticación propia** con contraseña (argon2id) y **TOTP** (Google/Microsoft Authenticator), más PIN de cajero; sin proveedor externo (diseño, sección 2, opción A). | — |

## D. Catálogos, productos y recetas

| # | Pregunta | Bloquea |
|---|---|---|
| P21 | Familias de producto terminado. | F1 |
| P22 | ¿Se vende por pieza, por peso o ambos? Si hay venta por peso, ¿qué SKU? | F1 |
| P23 | ¿Hay **precios distintos por sucursal**? ¿Listas de precios de mayoreo? | F1 |
| P24 | ✅ **Respondida:** hoy no hay crédito, pero puede haberlo más adelante. → Se deja lista la estructura de cuentas por cobrar (cliente con límite y días de crédito, saldo por documento) y el módulo de crédito se activa cuando lo pidas. | — |
| P25 | ✅ **Respondida:** sí hay pedidos con anticipo. → Se agrega el módulo de pedidos y anticipos (diseño 4.7‑B). Preguntas de detalle en la sección I. | — |
| P26 | Masas base que se preparan (lista). 🟡 **Fase 2:** se cargan con los layouts de masas e intermedios y sus fórmulas. | No |
| P27 | Otros intermedios (cubiertas, rellenos, betunes, almíbares). ¿Hay masa madre / prefermentos? | F2 |
| P28 | Etapas del proceso de producción y en cuáles se registra avance y merma. 🟡 **Fase 2:** catálogo "Etapas de producción" (con REGISTRA_MERMA). **Fase 5:** el avance de cada orden se registra por etapa (piezas o kg, minutos y merma con causa solo en las etapas con REGISTRA_MERMA = SI). **Pendiente:** el negocio las revisa con el jefe de panadería. | No |
| P29 | ¿Las masas se preparan en **lote completo** (capacidad de amasadora) o en **cantidad exacta**? ✅ **Recomendación adoptada:** se define **por receta**. **EXACTO** para masas fermentadas (lo que sobra no se guarda y se vuelve merma; con CAPACIDAD_AMASADORA el sistema divide en amasadas) y **COMPLETO** para cubiertas, rellenos y betunes que se conservan (el sobrante irá al inventario en la Fase 3). Al capturar tus recetas reales usa este criterio; los ejemplos PRUEBA- traen ambas reglas a propósito para probar los dos cálculos. | No |
| P30 | Vida útil de cada masa/intermedio, condición (ambiente, refrigerada, congelada) y si el sobrante es reutilizable. | F2 |
| P31 | ¿Qué insumos manejan **lote y caducidad**? | F1 |
| P32 | Criterio para **sugerir el plan de producción** (ej. promedio de ventas del mismo día de las últimas N semanas − existencia PT). Se pospone a cuando haya ventas (Fase 6): en la Fase 2 el plan se captura o se carga por layout. | F6 |
| P33a | ✅ **Respondida (21/11/2026):** el aviso por cambio de costo o precio en los layouts se queda en **10 %**. 🟡 El máximo de **5,000 renglones** por archivo sigue provisional (no afecta: el negocio tiene ~70 SKU). Ambos se cambian en Configuración → Cargas por layout. | — |
| P33b | ✅ **Respondida (21/11/2026):** el precio de venta al público **ya incluye impuestos**. → Configuración `precios.incluyen_impuestos = si`; el POS y el CFDI desglosan los impuestos a partir del precio. | — |
| P33c | Catálogos del SAT: el sistema **no trae claves del SAT precargadas**. El contador carga las que use el negocio (producto/servicio, unidad, objeto de impuesto, régimen, uso de CFDI, forma de pago, código agrupador), copiándolas del archivo oficial del SAT, con el layout "Catálogos del SAT". | F1B / F8 |
| P33 | Tolerancias. ✅ **Respondida (Fase 4):** se aceptan las del cotejo a 3 vías (**0 %** en cantidad, **1 %** en precio, **$1.00** en IVA y total) y **5 %** para que una OC pase de lo autorizado sin reautorizarse; se pueden ajustar en Configuración → Compras. Cambio de costo en layouts: 10 % (P33a). ✅ **Fase 5 (aceptadas, editables en Configuración → Producción):** balance de masa **3 %**, balance de piezas **5 %**, consumo de cada material contra su estándar **5 %** y vale de surtido sobre el estándar **5 %**. Fuera de tolerancia, el cierre de la orden exige justificación y queda marcado para revisión del contralor. | — |

## E. Costos e inventarios

| # | Pregunta | Bloquea |
|---|---|---|
| P34 | Método de valuación. ✅ **Decidido (22/11/2026): COSTO PROMEDIO** ponderado por almacén, para todo el inventario (migración 0010). Queda bloqueado en cuanto se registra el primer movimiento. | — |
| P35 | **Mano de obra directa**: ✅ costo por minuto **por etapa** con vigencia. Se calcula en **Costo estándar → Calculadora de mano de obra y gastos**: (nómina mensual de la etapa × (1 + carga social %)) ÷ (personas × días × minutos por jornada × aprovechamiento %). La foto de los datos queda guardada. **Falta:** que captures tu nómina real por etapa y el % de carga social que te dé tu contador. No se necesita módulo de nómina. | No |
| P36 | **Gastos indirectos de fabricación**: ✅ **Recomendación adoptada:** tasa predeterminada **por kilo de masa (KG_MASA)** = gastos indirectos de producción del mes ÷ kilos de masa e intermedios producidos al mes, calculada en la misma Calculadora. Las bases MINUTO_MOD y PIEZA siguen disponibles. **Falta:** tus gastos reales (renta del obrador, luz, gas, agua, mantenimiento, depreciación, supervisión) y tus kilos por mes. Desde la Fase 5 los indirectos se **aplican** a cada orden con la tasa vigente y el estado de costos muestra el total aplicado; en contabilidad (Fase 7) la mano de obra y los indirectos aplicados se abonan a sus cuentas (MOD_APLICADA y GIF_APLICADOS); el gasto real (nómina, renta, luz, gas…) se carga con pólizas manuales y la diferencia entre ambos es la sub o sobreaplicación del mes. | F5 |
| P66 | **Fórmula de la merma** ✅ **Decidido: DIVIDIR** (cantidad ÷ (1 − merma)): con 10 % de merma se preparan 111.11 g para que queden exactamente 100 g; MULTIPLICAR dejaría 99 g. Ya no es provisional (migración 0008); se puede cambiar en Configuración → Recetas y costos y queda en la bitácora. | No |
| P67 | **Mermas de un SKU:** el sistema aplica la merma de **horneado** a todo lo que se consume al formar (masa, cubiertas, insumos) y no al empaque; la de **formado** (recortes) solo a la masa. ¿Así lo calculas tú? | No (confirmar) |
| P68 | **Rendimiento de la masa:** si no capturas RENDIMIENTO_LOTE, se calcula tamaño del lote × (1 − merma de proceso). ¿Prefieres capturar siempre el rendimiento real de tu Excel? | No (confirmar) |
| P69 | **Costo de los insumos en la Fase 2:** se usa el COSTO_REFERENCIA del catálogo de insumos hasta que existan compras (Fase 3–4 usarán costo promedio o PEPS, P34). | No |
| P37 | ✅ **Respondida:** el pan no vendido **se vende en oferta, con descuento, antes de terminar el día** (22/11/2026). 🟡 Falta definir: de cuánto es el descuento (igual para todo o por producto/familia), a partir de qué hora aplica y quién lo activa en la caja. Hoy un descuento en caja lo autoriza el contador o el contralor con su PIN en cada venta. | F6 |
| P38 | Causas de merma. ✅ **Decidido:** catálogo inicial CADUCADO, QUEMADO, DEFORME, NO-VENDIDO (solo producto terminado) y DANADO (migración 0010). Se agregan o dan de baja en Catálogos → Causas de merma. | — |
| P70 | Quién cancela movimientos de inventario. ✅ **Decidido:** el **contralor** y el **contador** (compras recibidas, vales de surtido, traspasos en tránsito, mermas, ajustes, inventario inicial y entradas de producción). Matriz y migración 0010 actualizadas. | — |
| P71 | Venta sin existencia. ✅ **Decidido:** **no se vende sin existencia** de producto terminado en el almacén de la sucursal. El POS (Fase 6) bloqueará la venta; el pan que sale del horno debe registrarse como entrada antes de venderse. | — |
| P72 | ✅ **Resuelta en la Fase 5:** la producción entra al **cerrar su orden de producción**, al **costo real**. La entrada directa al costo estándar quedó desactivada (se puede reactivar en Configuración → Producción solo si hiciera falta). | — |
| P73 | **Días de alerta de caducidad:** quedó en **3 días** (provisional, Configuración → Inventarios). | No |
| P39 | ✅ **Provisional:** montos límite en la matriz de puestos (sección 4), editables en configuración. | — |

## F. Compras

| # | Pregunta | Bloquea |
|---|---|---|
| P40 | ✅ **Respondida:** dos niveles por monto: nivel 1 hasta $10,000.00 (provisional) y nivel 2 = dirección arriba de ese monto. Se autoriza el total de la requisición. **Fase 4:** también se reautoriza una OC que rebase lo autorizado más la tolerancia; los pagos los autoriza el contralor hasta $20,000 y dirección arriba (límites provisionales de la matriz). | — |
| P41 | ✅ **Respondida:** la OC se imprime o se guarda en PDF desde el navegador; no se envía por correo desde el sistema. | — |
| P42 | ✅ **Respondida:** el contador **programa** el pago, lo **autoriza** el contralor o dirección según el monto (quien recibió la mercancía no puede) y el contador lo **marca pagado** con la referencia. Se usa **un solo banco: BBVA**; la cuenta se captura en Cuentas bancarias (solo alias y últimos 4 dígitos). | — |

## G. Punto de venta

| # | Pregunta | Bloquea |
|---|---|---|
| P43 | POS sin internet. ✅ **Decidido (22/11/2026):** en una urgencia la caja **sigue vendiendo sin internet**. Las ventas se guardan en la computadora con folio provisional (`SC-…`), sin desglose de impuestos en el ticket, y se envían solas al volver la conexión; no se duplican. Para no vender lo que no hay (P71) se usa la última existencia conocida. Sin conexión **no** se hacen devoluciones, retiros, pedidos, descuentos ni cortes, y el corte Z espera a que se envíen las ventas pendientes. | — |
| P44 | ✅ **Respondida (cotización Ordenadores BXC, 18/08/2026):** HP usada Core i3, 8 GB RAM, SSD 128 GB, WiFi; monitor táctil Hostech 18.5" Full HD (1920×1080); regulador Ghia de 8 contactos. Falta: generación del i3 y versión de Windows (Windows 10 ya no recibe parches de seguridad desde oct‑2025). | — |
| P45 | Impresora. ✅ **Ghia de 80 mm con autocorte, USB** (cotización Ordenadores BXC) y cajón Ghia RJ11 conectado a la impresora. Se imprime con Chrome en modo kiosco (`--kiosk-printing`) y el controlador de Windows de la Ghia. El cajón se abre desde la configuración del controlador ("abrir cajón al imprimir"). Si ese controlador no lo permite, se agrega el agente ESC/POS local (sección 3.5). Al instalar se anota el modelo de la etiqueta (GTP801 o GTP802). | — |
| P46 | ✅ Cajón Ghia RJ11 en la impresora; sin lector de código de barras (un lector USB posterior funciona sin cambios). **No se vende pan por peso** (sin báscula): las piezas van en números enteros. | — |
| P47 | ✅ **Decidido:** se aceptan efectivo, tarjeta de crédito, tarjeta de débito (terminal bancaria aparte) y transferencia. Solo se guarda la referencia del voucher. | — |
| P48 | ✅ Denominaciones de Banco de México para el arqueo. **El fondo de caja se define cada día** al abrir el turno (no es fijo). | — |
| P49 | ✅ **Respondida (22/11/2026):** la **factura global es diaria**. Al cliente que quiere factura **se le piden sus datos el día de la compra** (con su correo) y **la factura le llega por correo al día siguiente**. Su ticket no entra en la global. El sistema registra cuándo se envió y marca como atrasadas las que pasan del plazo (`fiscal.dias_entrega_factura` = 1). | — |
| P50 | ✅ **Decidido:** se permiten descuentos y los autoriza con su PIN el **contador o el contralor** (permiso `pos.descuentos:autorizar`), sin límite por monto. El encargado ya no autoriza descuentos. | — |

## H. Contabilidad y fiscal

| # | Pregunta | Bloquea |
|---|---|---|
| P51 | Catálogo de cuentas actual (archivo) o si partimos del código agrupador del SAT. 🟡 **Fase 7:** el sistema ya contabiliza con **reglas** (Contabilidad → Reglas): cada concepto (caja, ventas, IVA, inventarios, mano de obra aplicada, proveedores…) va a la cuenta que diga tu contador, en general o por sucursal. **Falta:** tu catálogo real y las reglas; mientras no estén, las operaciones quedan "pendientes de contabilizar" (no se inventan cuentas). | Datos reales |
| P52 | Fecha de arranque contable y si se cargan saldos iniciales. 🟡 **Fase 7:** periodos mensuales; la fecha de arranque se configura en Configuración → Contabilidad (lo anterior no se contabiliza) y los saldos iniciales entran con una **póliza manual de apertura** autorizada por el contralor. **Falta:** la fecha y los saldos. | Datos reales |
| P53 | ✅ **Respondida:** **no habrá PAC**. Las facturas se elaboran y timbran en el **portal del SAT** (Factura electrónica). El sistema prepara los datos para capturarlos y guarda el XML que se descarga del portal. | — |
| P54 | ✅ **Respondida:** las series y folios de las facturas son los que asigna el portal del SAT. Los tickets siguen numerados por caja (`CAJA-SUC1-1-000001`); devoluciones `DEV-`, pedidos `PED-` y turnos `TUR-`. | — |
| P55 | Datos fiscales por SKU (clave prod/serv, clave unidad, objeto de impuesto, IVA, IEPS): los capturas tú con tu contador — confírmame si llegarán en el layout de SKU o después. | F1 (estructura) |
| P56 | ✅ **Respondida:** **no hay retenciones**: la empresa es por ahora una **persona física**. | — |
| P57 | ¿La contabilidad electrónica (Anexo 24) se envía desde este sistema o el contador la sigue haciendo en su sistema con lo que este le exporte? 🟡 **Fase 7:** la balanza, el diario, los auxiliares y las pólizas se exportan a Excel. El XML del SAT se agrega si se decide enviarlo desde aquí. | No |
| P58 | ✅ **Respondida:** la **e.firma la tiene el contador** y no se guarda en este sistema; tampoco se necesita CSD, porque se timbra en el portal del SAT. Sin e.firma no hay descarga masiva automática: los XML se suben al sistema. | — |

## I. Pedidos y anticipos (nuevo, por respuesta a P25)

| # | Pregunta | Bloquea |
|---|---|---|
| P59 | ✅ **Decidido:** pedidos en el mostrador (caja) y por **WhatsApp o teléfono** desde oficina (pantalla Ventas y cortes → Pedidos), para la sucursal que entrega. Quién los captura: quien tenga `pos.pedidos:crear` (hoy cajero y encargado; se puede asignar a otro puesto). | — |
| P60 | ✅ **Decidido:** no hay anticipo mínimo; un pedido **sin anticipo** lo autoriza el **contador o el contralor** con su PIN (`pos.pedidos_sin_anticipo:autorizar`). Se permiten varios abonos. | — |
| P61 | Cancelación de pedidos. 🟡 **Fase 6:** la autoriza con PIN un encargado, que decide si el anticipo **se devuelve** (sale efectivo de la caja) o **se retiene**. ¿Hay plazo o regla fija? | No |
| P62 | Personalización de pedidos. 🟡 **Fase 6:** cada renglón lleva especificaciones (texto) y el pedido lleva notas. Solo productos del catálogo, al precio vigente (que queda fijo al registrar el pedido). Faltan la foto de referencia y los productos especiales con precio libre. | No |
| P63 | ✅ **Respondida:** el pedido especial **no se liga** a la orden de producción. Si hace falta producirlo aparte, se libera una orden manual con el pedido en el comentario. | — |
| P64 | ✅ **Respondida:** al recibir el anticipo se entrega un **recibo** (no se factura); **todo se factura a la entrega del pedido**. | — |
| P65 | Cuenta contable de anticipos de clientes (pasivo). 🟡 **Fase 7:** es la regla del concepto ANTICIPOS_CLIENTES; los anticipos retenidos de pedidos cancelados van a ANTICIPOS_RETENIDOS. Falta la cuenta real. | Datos reales |
