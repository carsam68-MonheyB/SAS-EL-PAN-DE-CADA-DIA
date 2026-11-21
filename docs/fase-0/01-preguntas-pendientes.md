# Fase 0 · Preguntas pendientes

> Responde con el número de la pregunta (ej. "P07: 2 sucursales y una planta central"). Si aún no sabes alguna, escribe "pendiente": no bloquea la Fase 1 salvo las marcadas con **[Bloquea F1]**.
> Ningún valor de esta lista se va a poner "en duro": todo queda en catálogos o configuración editable. Las preguntas sirven para diseñar la estructura y cargar los valores iniciales.

## A. Empresa, repositorio y cuentas

| # | Pregunta | Bloquea |
|---|---|---|
| P01 | Nombre comercial, razón social, RFC y régimen fiscal (clave SAT, ej. 601, 612, 626). | F1 (datos de configuración) |
| P02 | Organización de GitHub y nombre del repositorio privado. **Aún no está creado**: cuando lo tengas, dime `organización/repositorio` y lo conecto a esta sesión. | **[Bloquea F1]** |
| P03 | ¿Ya existe el equipo (team) nuevo de Netlify con plan Pro? ¿Es plan **por créditos** (credit‑based)? Netlify Database solo existe en planes por créditos. ¿Cuántos créditos al mes incluye tu plan? | **[Bloquea F1]** |
| P04 | ✅ **Respondida:** todavía no hay dominio. → Pruebas y Fase 1 con el subdominio gratuito de Netlify (`*.netlify.app`). Antes de producción: registrar dominio (`.mx` o `.com.mx`) y administrar su DNS en Netlify. Pendiente: nombre de dominio elegido. | No |
| P05 | ✅ **Respondida:** todavía no hay correo. → Propuesta: buzones solo para el personal de oficina (Microsoft 365 o Google Workspace; Zoho Mail si se busca el menor costo) y **Resend** para los correos que envía el sistema. Cajeros y panaderos **no necesitan correo**: entran con usuario y contraseña. Pendiente: elegir proveedor de buzones. | No (en Fase 1 la invitación se puede mostrar como enlace para entregarlo en persona) |
| P06 | Almacenamiento **fuera de Netlify** para respaldos y XML: Amazon S3, Backblaze B2, Google Cloud Storage, Azure, Google Drive… Recomiendo uno con **bloqueo de objetos (Object Lock / WORM)** para que ninguna credencial pueda borrar respaldos (S3 y B2 lo tienen). ¿Cuál prefieres o ya tienes cuenta? | F1 (diseño), F9 (operación) |
| P07 | 🟡 **Parcial:** el sistema actual es **Soft Restaurant 7.0**, y el nuevo sistema lo reemplaza por completo. Falta: fecha de arranque deseada; desde cuándo lo usan; si factura (CFDI) desde ahí y con qué PAC; qué datos se migran (productos, precios, clientes, historial de ventas para sugerir el plan de producción); si se adelanta el POS (ver diseño, sección 5). | No |

## B. Estructura operativa

| # | Pregunta | Bloquea |
|---|---|---|
| P08 | Número de sucursales y nombre/clave de cada una. | **[Bloquea F1]** |
| P09 | ¿Hay **planta central** que produce y surte a sucursales, o cada sucursal produce lo suyo, o mixto? (Define almacenes, traspasos y en qué ubicación vive la PEP). | **[Bloquea F1]** |
| P10 | Cajas por sucursal. | F1 |
| P11 | Lista de almacenes (ej. MP planta, PEP planta, PT planta, PT sucursal 1…). | **[Bloquea F1]** |
| P12 | Horario de operación por sucursal y de la planta (días y horas). Sirve para estimar el consumo de la base (ver documento de diseño, sección 1.3). | No |
| P13 | Turnos de producción (nombre, horario). | F2 |
| P14 | Número aproximado de usuarios del sistema y cuántos usarían el sistema al mismo tiempo en la hora pico. | No |
| P15 | Centros de costo que quieres manejar (ej. por sucursal, planta, administración). | F1 |

## C. Usuarios, roles y seguridad

| # | Pregunta | Bloquea |
|---|---|---|
| P16 | La **matriz de puestos y permisos** que mencionas en la sección 2. Si prefieres, te armo un borrador sobre los 11 puestos de referencia para que lo corrijas. | **[Bloquea F1]** |
| P17 | Roles con doble factor obligatorio, además de administrador, autorizadores y quien maneje e.firma/PAC. | F1 |
| P18 | Valores iniciales de seguridad: longitud mínima de contraseña, intentos fallidos antes de bloqueo, minutos de bloqueo, minutos de inactividad para cerrar sesión (oficina y POS por separado), dígitos del PIN de cajero. | F1 |
| P19 | Lista inicial de **incompatibilidades** de segregación de funciones (además de las 4 del documento). | F1 |
| P20 | Elección de autenticación (ver diseño, sección 2): **A) propia en la base de datos con TOTP** (recomendada) o **B) Auth0**. | **[Bloquea F1]** |

## D. Catálogos, productos y recetas

| # | Pregunta | Bloquea |
|---|---|---|
| P21 | Familias de producto terminado. | F1 |
| P22 | ¿Se vende por pieza, por peso o ambos? Si hay venta por peso, ¿qué SKU? | F1 |
| P23 | ¿Hay **precios distintos por sucursal**? ¿Listas de precios de mayoreo? | F1 |
| P24 | ✅ **Respondida:** hoy no hay crédito, pero puede haberlo más adelante. → Se deja lista la estructura de cuentas por cobrar (cliente con límite y días de crédito, saldo por documento) y el módulo de crédito se activa cuando lo pidas. | — |
| P25 | ✅ **Respondida:** sí hay pedidos con anticipo. → Se agrega el módulo de pedidos y anticipos (diseño 4.7‑B). Preguntas de detalle en la sección I. | — |
| P26 | Masas base que se preparan (lista). | F2 |
| P27 | Otros intermedios (cubiertas, rellenos, betunes, almíbares). ¿Hay masa madre / prefermentos? | F2 |
| P28 | Etapas del proceso de producción y en cuáles se registra avance y merma. | F2 |
| P29 | ¿Las masas se preparan en **lote completo** (capacidad de amasadora) o en **cantidad exacta**? ¿Depende de la masa? Capacidad de cada amasadora. | F2 |
| P30 | Vida útil de cada masa/intermedio, condición (ambiente, refrigerada, congelada) y si el sobrante es reutilizable. | F2 |
| P31 | ¿Qué insumos manejan **lote y caducidad**? | F1 |
| P32 | Criterio para **sugerir el plan de producción** (ej. promedio de ventas del mismo día de las últimas N semanas − existencia PT). | F2 |
| P33 | Tolerancias: diferencia aceptable en balance de masa (% o kg), en surtido vs. estándar, en cotejo a tres vías (cantidad, precio, impuestos), y % de cambio de costo que genera advertencia en layouts. | F2–F5 |

## E. Costos e inventarios

| # | Pregunta | Bloquea |
|---|---|---|
| P34 | Método de valuación: **costo promedio** o **PEPS**. ¿Uno solo para todo o por tipo de inventario? | F3 (el modelo de datos soporta ambos desde F1) |
| P35 | **Mano de obra directa**: ¿cómo se costea? (ej. costo por minuto por etapa, o por puesto). ¿De dónde sale el costo por minuto (nómina mensual ÷ minutos disponibles)? ¿Se necesita módulo de nómina? (no está en el documento; propongo capturar el costo por minuto como dato configurable por periodo). | F2 |
| P36 | **Gastos indirectos de fabricación**: base de prorrateo (kg de masa, horas de horno, minutos de mano de obra, piezas…) y si es tasa predeterminada (estándar) con ajuste al cierre por la variación real. | F2 |
| P37 | Destinos del producto no vendido (merma, donación, reproceso, venta de segunda) y su tratamiento contable. | F5 |
| P38 | Causas de merma (catálogo inicial). | F3 |
| P39 | Límites por monto para autorizar ajustes de inventario, descuentos y devoluciones. | F3/F6 |

## F. Compras

| # | Pregunta | Bloquea |
|---|---|---|
| P40 | Niveles y montos de autorización de compras (¿por monto, por categoría de insumo, por proveedor?). ¿Se autoriza el total de la requisición o por renglón? | F4 |
| P41 | ¿Las OC se envían por correo al proveedor desde el sistema? ¿Formato de OC (logo, leyendas)? | F4 |
| P42 | ¿Quién autoriza y programa pagos? ¿Se registran pagos por transferencia desde el sistema o solo se registran los que ya se hicieron en el banco? Bancos y cuentas bancarias. | F4 |

## G. Punto de venta

| # | Pregunta | Bloquea |
|---|---|---|
| P43 | ¿El POS debe funcionar **sin internet**? (cambia el diseño del POS de forma importante: cola local, folios reservados, conflicto de existencias). | F1 (diseño) |
| P44 | ✅ **Respondida (cotización Ordenadores BXC, 18/08/2026):** HP usada Core i3, 8 GB RAM, SSD 128 GB, WiFi; monitor táctil Hostech 18.5" Full HD (1920×1080); regulador Ghia de 8 contactos. Falta: generación del i3 y versión de Windows (Windows 10 ya no recibe parches de seguridad desde oct‑2025). | — |
| P45 | 🟡 **Por aclarar:** la cotización trae una **Ghia de 80 mm con autocorte, USB**, no la OFICHIDO. Los modelos Ghia de 80 mm (GTP801/GTP802) aceptan ESC/POS y tienen puerto de cajón. ¿Cuál queda en la caja y qué modelo exacto es? | F6 |
| P46 | 🟡 **Parcial:** cajón **Ghia RJ11**, que se conecta a la impresora (la impresora lo abre). La computadora solo imprime tickets. La cotización **no incluye** lector de código de barras ni báscula: ¿se necesitan? | F6 |
| P47 | Formas de pago aceptadas. Para tarjeta: ¿terminal bancaria independiente? (El sistema **no debe guardar datos de tarjetas**: Netlify Database no está certificada PCI‑DSS; solo registraríamos la referencia/autorización del voucher). | F6 |
| P48 | Denominaciones para el arqueo (billetes y monedas que se cuentan). ¿Fondo de caja fijo por caja? | F6 |
| P49 | Periodicidad de la **factura global** (diaria, semanal, mensual, bimestral según tu régimen). Plazo que tiene el cliente para pedir factura de su ticket. | F8 |
| P50 | ¿Se permite descuento en POS? ¿Quién lo autoriza y hasta cuánto? | F6 |

## H. Contabilidad y fiscal

| # | Pregunta | Bloquea |
|---|---|---|
| P51 | Catálogo de cuentas actual (archivo) o si partimos del código agrupador del SAT. | F7 (layout desde F1) |
| P52 | Fecha de arranque contable y si se cargan saldos iniciales. Ejercicio y periodos (mensual). | F7 |
| P53 | Proveedor de timbrado (**PAC**). Si no hay, te comparo 3 o 4 opciones con costo por timbre y API (ej. Finkok, SW Sapien, Facturama, Diverza). | F8 |
| P54 | Series y folios para tickets, facturas, notas de crédito y complementos de pago. | F6/F8 |
| P55 | Datos fiscales por SKU (clave prod/serv, clave unidad, objeto de impuesto, IVA, IEPS): los capturas tú con tu contador — confírmame si llegarán en el layout de SKU o después. | F1 (estructura) |
| P56 | ¿Hay retenciones (ej. compras a personas físicas con actividad empresarial o fletes)? | F8 |
| P57 | ¿La contabilidad electrónica (Anexo 24) se envía desde este sistema o el contador la sigue haciendo en su sistema con lo que este le exporte? | F7 |
| P58 | ¿Quién custodia la e.firma? Además de la e.firma, ¿se tiene **CSD** (certificado de sello digital) para timbrar? (El timbrado usa el CSD, la descarga masiva usa la e.firma). | F8 |

## I. Pedidos y anticipos (nuevo, por respuesta a P25)

| # | Pregunta | Bloquea |
|---|---|---|
| P59 | ¿Dónde se toman los pedidos (mostrador de sucursal, teléfono, WhatsApp, oficina)? ¿Quién puede tomarlos? | F6 |
| P60 | ¿Hay anticipo mínimo (porcentaje o monto)? ¿Puede haber varios abonos antes de la entrega? | F6 |
| P61 | Si el cliente cancela o no recoge: ¿se devuelve el anticipo, se pierde o depende del plazo? ¿Quién lo autoriza? | F6 |
| P62 | ¿Los pedidos llevan datos de personalización (texto, decoración, foto de referencia, número de personas)? ¿Son SKU del catálogo, variantes, o productos especiales con precio libre? | F2 / F6 |
| P63 | ¿El pedido se produce en planta con su propia orden de producción o sale del producto normal del día? | F2 / F5 |
| P64 | **Tratamiento fiscal del anticipo (con tu contador):** ¿se emite CFDI por el anticipo y después el CFDI del total relacionado con tipo de relación 07 (procedimiento de la Guía de llenado del Anexo 20), o se factura todo al entregar? Si el cliente no pide factura, ¿cómo entra a la factura global? | F8 (la estructura se crea antes) |
| P65 | Cuenta contable de anticipos de clientes (pasivo): la defines en las reglas de contabilización. | F7 |
