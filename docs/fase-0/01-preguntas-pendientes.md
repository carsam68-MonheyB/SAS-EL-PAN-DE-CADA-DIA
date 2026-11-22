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
| P28 | Etapas del proceso de producción y en cuáles se registra avance y merma. 🟡 **Fase 2:** catálogo "Etapas de producción" (con REGISTRA_MERMA). | F5 |
| P29 | ¿Las masas se preparan en **lote completo** (capacidad de amasadora) o en **cantidad exacta**? ✅ **Recomendación adoptada:** se define **por receta**. **EXACTO** para masas fermentadas (lo que sobra no se guarda y se vuelve merma; con CAPACIDAD_AMASADORA el sistema divide en amasadas) y **COMPLETO** para cubiertas, rellenos y betunes que se conservan (el sobrante irá al inventario en la Fase 3). Al capturar tus recetas reales usa este criterio; los ejemplos PRUEBA- traen ambas reglas a propósito para probar los dos cálculos. | No |
| P30 | Vida útil de cada masa/intermedio, condición (ambiente, refrigerada, congelada) y si el sobrante es reutilizable. | F2 |
| P31 | ¿Qué insumos manejan **lote y caducidad**? | F1 |
| P32 | Criterio para **sugerir el plan de producción** (ej. promedio de ventas del mismo día de las últimas N semanas − existencia PT). Se pospone a cuando haya ventas (Fase 6): en la Fase 2 el plan se captura o se carga por layout. | F6 |
| P33a | ✅ **Respondida (21/11/2026):** el aviso por cambio de costo o precio en los layouts se queda en **10 %**. 🟡 El máximo de **5,000 renglones** por archivo sigue provisional (no afecta: el negocio tiene ~70 SKU). Ambos se cambian en Configuración → Cargas por layout. | — |
| P33b | ✅ **Respondida (21/11/2026):** el precio de venta al público **ya incluye impuestos**. → Configuración `precios.incluyen_impuestos = si`; el POS y el CFDI desglosan los impuestos a partir del precio. | — |
| P33c | Catálogos del SAT: el sistema **no trae claves del SAT precargadas**. El contador carga las que use el negocio (producto/servicio, unidad, objeto de impuesto, régimen, uso de CFDI, forma de pago, código agrupador), copiándolas del archivo oficial del SAT, con el layout "Catálogos del SAT". | F1B / F8 |
| P33 | Tolerancias: diferencia aceptable en balance de masa (% o kg), en surtido vs. estándar, en cotejo a tres vías (cantidad, precio, impuestos), y % de cambio de costo que genera advertencia en layouts. | F2–F5 |

## E. Costos e inventarios

| # | Pregunta | Bloquea |
|---|---|---|
| P34 | Método de valuación. ✅ **Decidido (22/11/2026): COSTO PROMEDIO** ponderado por almacén, para todo el inventario (migración 0010). Queda bloqueado en cuanto se registra el primer movimiento. | — |
| P35 | **Mano de obra directa**: ✅ costo por minuto **por etapa** con vigencia. Se calcula en **Costo estándar → Calculadora de mano de obra y gastos**: (nómina mensual de la etapa × (1 + carga social %)) ÷ (personas × días × minutos por jornada × aprovechamiento %). La foto de los datos queda guardada. **Falta:** que captures tu nómina real por etapa y el % de carga social que te dé tu contador. No se necesita módulo de nómina. | No |
| P36 | **Gastos indirectos de fabricación**: ✅ **Recomendación adoptada:** tasa predeterminada **por kilo de masa (KG_MASA)** = gastos indirectos de producción del mes ÷ kilos de masa e intermedios producidos al mes, calculada en la misma Calculadora. Las bases MINUTO_MOD y PIEZA siguen disponibles. **Falta:** tus gastos reales (renta del obrador, luz, gas, agua, mantenimiento, depreciación, supervisión) y tus kilos por mes. El ajuste al cierre por la variación real va en la Fase 5. | F5 |
| P66 | **Fórmula de la merma** ✅ **Decidido: DIVIDIR** (cantidad ÷ (1 − merma)): con 10 % de merma se preparan 111.11 g para que queden exactamente 100 g; MULTIPLICAR dejaría 99 g. Ya no es provisional (migración 0008); se puede cambiar en Configuración → Recetas y costos y queda en la bitácora. | No |
| P67 | **Mermas de un SKU:** el sistema aplica la merma de **horneado** a todo lo que se consume al formar (masa, cubiertas, insumos) y no al empaque; la de **formado** (recortes) solo a la masa. ¿Así lo calculas tú? | No (confirmar) |
| P68 | **Rendimiento de la masa:** si no capturas RENDIMIENTO_LOTE, se calcula tamaño del lote × (1 − merma de proceso). ¿Prefieres capturar siempre el rendimiento real de tu Excel? | No (confirmar) |
| P69 | **Costo de los insumos en la Fase 2:** se usa el COSTO_REFERENCIA del catálogo de insumos hasta que existan compras (Fase 3–4 usarán costo promedio o PEPS, P34). | No |
| P37 | Destinos del producto no vendido (merma, donación, reproceso, venta de segunda) y su tratamiento contable. | F5 |
| P38 | Causas de merma. ✅ **Decidido:** catálogo inicial CADUCADO, QUEMADO, DEFORME, NO-VENDIDO (solo producto terminado) y DANADO (migración 0010). Se agregan o dan de baja en Catálogos → Causas de merma. | — |
| P70 | Quién cancela movimientos de inventario. ✅ **Decidido:** el **contralor** y el **contador** (compras recibidas, vales de surtido, traspasos en tránsito, mermas, ajustes, inventario inicial y entradas de producción). Matriz y migración 0010 actualizadas. | — |
| P71 | Venta sin existencia. ✅ **Decidido:** **no se vende sin existencia** de producto terminado en el almacén de la sucursal. El POS (Fase 6) bloqueará la venta; el pan que sale del horno debe registrarse como entrada antes de venderse. | — |
| P72 | **Entrada de producción provisional:** mientras no estén las órdenes de producción (Fase 5), el pan terminado entra a producto terminado al **costo estándar del día** (pantalla Inventarios → Entradas y surtidos). ¿Quién la registra (hoy: jefe de producción)? | No |
| P73 | **Días de alerta de caducidad:** quedó en **3 días** (provisional, Configuración → Inventarios). | No |
| P39 | ✅ **Provisional:** montos límite en la matriz de puestos (sección 4), editables en configuración. | — |

## F. Compras

| # | Pregunta | Bloquea |
|---|---|---|
| P40 | ✅ **Respondida:** dos niveles por monto: nivel 1 hasta $10,000.00 (provisional) y nivel 2 = dirección arriba de ese monto. Se autoriza el total de la requisición. | — |
| P41 | ¿Las OC se envían por correo al proveedor desde el sistema? ¿Formato de OC (logo, leyendas)? | F4 |
| P42 | ¿Quién autoriza y programa pagos? ¿Se registran pagos por transferencia desde el sistema o solo se registran los que ya se hicieron en el banco? Bancos y cuentas bancarias. | F4 |

## G. Punto de venta

| # | Pregunta | Bloquea |
|---|---|---|
| P43 | ¿El POS debe funcionar **sin internet**? (cambia el diseño del POS de forma importante: cola local, folios reservados, conflicto de existencias). | F1 (diseño) |
| P44 | ✅ **Respondida (cotización Ordenadores BXC, 18/08/2026):** HP usada Core i3, 8 GB RAM, SSD 128 GB, WiFi; monitor táctil Hostech 18.5" Full HD (1920×1080); regulador Ghia de 8 contactos. Falta: generación del i3 y versión de Windows (Windows 10 ya no recibe parches de seguridad desde oct‑2025). | — |
| P45 | 🟡 **Por aclarar:** la cotización trae una **Ghia de 80 mm con autocorte, USB**, no la OFICHIDO. Los modelos Ghia de 80 mm (GTP801/GTP802) aceptan ESC/POS y tienen puerto de cajón. ¿Cuál queda en la caja y qué modelo exacto es? | F6 |
| P46 | 🟡 **Parcial:** cajón **Ghia RJ11** conectado a la impresora; la computadora solo imprime tickets; **no hay lector de código de barras** (el POS se opera con botones táctiles por familia y con búsqueda; el código de barras queda como campo opcional del SKU, y un lector USB que se compre después funciona sin cambios). Falta: ¿hay **báscula** / venta por peso? | F6 |
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
