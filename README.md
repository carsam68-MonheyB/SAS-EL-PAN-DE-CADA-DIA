# SAS · El Pan de Cada Día — ERP de panadería

Sistema web interno para controlar la panadería: punto de venta, recetas, producción y costos, inventarios, compras con autorizaciones, contabilidad y SAT. Se construye por fases (ver `docs/fase-0/04-etapas-de-implementacion.md`).

> **Estado:** Fase 1A (base, usuarios, roles, permisos, bitácora). Repositorio y proyecto de Netlify **temporales de desarrollo**: solo datos ficticios.

## Tecnología

| Pieza | Uso |
|---|---|
| Frontend | React + TypeScript + Vite + Mantine (`web/`) |
| Backend | Netlify Functions en TypeScript (`netlify/functions/`) |
| Base de datos | Netlify Database (PostgreSQL) con `@netlify/database`; migraciones en `netlify/database/migrations/` |
| Lógica pura | `src/dominio/` (sin base de datos, probada aparte) |
| Servidor común | `src/servidor/` (sesión, permisos, transacciones, bitácora) |
| Pruebas | Vitest contra PostgreSQL real (`pruebas/`) |

Documentación de diseño: `docs/fase-0/` (aprobada el 21/11/2026).

## Variables de entorno (Netlify → Project configuration → Environment variables)

Defínelas **a nivel del proyecto**, nunca del team. Los valores secretos nunca van en el repositorio ni en el chat.

| Variable | Obligatoria | Qué es |
|---|---|---|
| `LLAVE_MAESTRA` | Sí | Llave de cifrado (32 bytes en base64) para los secretos del doble factor y, más adelante, la e.firma. **Distinta en cada ambiente.** Si se pierde, los usuarios deben reactivar su doble factor. |
| `CLAVE_INSTALACION` | Sí, para instalar | Clave de al menos 20 caracteres para crear el primer administrador en `/instalacion`. Solo funciona mientras no haya usuarios. |
| `PERMITIR_DATOS_PRUEBA` | No | `si` habilita el botón de usuarios FICTICIOS de prueba. **Nunca en producción real.** |
| `AMBIENTE_ETIQUETA` | No | Texto visible en la barra superior, por ejemplo `Desarrollo · datos ficticios`. |
| `NETLIFY_DB_URL` | Automática | La pone Netlify al crear la base. No se captura. |

Para generar `LLAVE_MAESTRA` en Windows (PowerShell):

```powershell
$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

## Despliegue

- Netlify está conectado al repositorio. La rama `main` se publica sola; `desarrollo` es la rama de trabajo.
- Al desplegar, Netlify crea la base (si no existe) y **aplica las migraciones** pendientes justo antes de publicar. Si una migración falla, no se publica.
- Configurar en el panel (Data & Storage → Database): cómputo mínimo 1 y máximo 2; dormir a los 5 minutos.

### Primer arranque

1. Captura las variables de entorno y vuelve a desplegar.
2. Abre `https://<sitio>/instalacion`, escribe la `CLAVE_INSTALACION`, el usuario y nombre del administrador.
3. Abre el enlace que aparece, define la contraseña, inicia sesión y activa la verificación en dos pasos (Google o Microsoft Authenticator). Guarda los códigos de recuperación.
4. Opcional (solo desarrollo): en **Usuarios → Usuarios de prueba** se crea un usuario FICTICIO por puesto (`prueba.adm`, `prueba.caj`, …) con una contraseña que se muestra una vez.

## Pruebas

Requieren un PostgreSQL 16. Por omisión usan `postgres://postgres:postgres@localhost:5432/postgres` (cámbialo con `TEST_DATABASE_URL_ADMIN`). Cada archivo de pruebas crea su propia base limpia y aplica las migraciones.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

GitHub Actions corre lo mismo en cada push (`.github/workflows/pruebas.yml`).

## Reglas del sistema (resumen)

- **Nada es público:** toda función exige sesión; los permisos se validan en el servidor en cada función (`src/servidor/ruta.ts`).
- **Transacciones:** toda operación corre en una sola transacción (`enTransaccion`); si falla, no queda nada a medias.
- **Bitácora:** cada cambio queda en `bitacora_auditoria` (usuario, fecha, valor anterior y nuevo) con cadena de hashes; la tabla rechaza modificaciones y borrados. Los accesos quedan en `bitacora_acceso`.
- **Nada en duro:** valores de negocio y de seguridad viven en `configuracion`, `limite_autorizacion` e `incompatibilidad`. Los marcados como *provisional* deben confirmarse.
- **Matriz de puestos:** fuente en `datos-iniciales/matriz-puestos.json`; la migración `0003` se generó con `npm run generar:matriz`. Una migración ya aplicada no se edita: los cambios se hacen desde la pantalla de roles.
- **Formato de México:** fechas DD/MM/AAAA y números `1,250.75`.

## Catálogos y cargas por layout (Fase 1B)

- **Catálogos:** SAT, unidades, conversiones, familias, centros de costo, sucursales, almacenes, cajas, tasas de impuesto, proveedores, clientes, insumos (N0), masas e intermedios (N1), productos (N2), unidades por artículo, artículos por proveedor, precios con vigencia y catálogo de cuentas.
- **Una sola definición por catálogo** (`src/servidor/layouts/definiciones.ts`): de ahí salen la plantilla (Excel con instrucciones y listas desplegables, TXT o CSV), la validación, la carga, la exportación y el formulario de captura en pantalla.
- **Motor** (`src/servidor/layouts/motor.ts`):
  - primero valida sin guardar nada;
  - si hay un solo error, no guarda nada y genera el reporte en el mismo layout con la columna `ERROR`;
  - si no hay errores, aplica todo en una transacción;
  - guarda el archivo original en `carga_archivo`.
- **Precios:** quedan pendientes hasta que los autoriza otra persona (`catalogos.precios:autorizar`).
- **Datos de ejemplo ficticios:** están en `datos-ejemplo/fase-1b` (ver su `LEEME.md`). La prueba `pruebas/ejemplos.test.ts` los carga en orden.

## Recetas, explosión y costo estándar (Fase 2)

- **Recetas por versión** (`receta`, `receta_componente`, `receta_etapa`):
  - N1 = masa o intermedio, con fórmula por lote. Se captura en cantidades o en **% panadero**: harina = tamaño del lote × 100 ÷ suma de %.
  - N2 = SKU, con componentes por pieza buena.
  - Una versión nace en **borrador** y se **activa** en la pantalla Recetas. Ya activa no se modifica (lo impiden disparadores de la base). Aplica la versión activa con el mayor `vigente_desde` ≤ fecha.
- **Ciclos:** una receta no puede contenerse a sí misma, ni directa ni indirectamente. Se revisa al cargar, al activar y al calcular.
- **Cálculos críticos** en `src/dominio/recetas.ts`, con aritmética decimal exacta y pruebas en `pruebas/recetas-dominio.test.ts`:
  1. **Explosión N2 → N1:** las masas compartidas se agrupan.
  2. **Lotes** según la regla de cada masa: completo (con sobrante esperado) o exacto. También calcula las amasadas.
  3. **Explosión N1 → N0.**
  4. **Requerimiento neto** = bruto − existencia − en tránsito.
  5. **Piezas que alcanzan** (estimación proporcional).
  6. **Costo estándar en cadena:** materia prima, mano de obra por minuto por etapa y GIF por base. Calcula el margen sobre el precio sin impuestos.
- **Mermas:** la fórmula está en Configuración (`recetas.formula_merma`: DIVIDIR o MULTIPLICAR, provisional).
  - La merma de **horneado** se aplica sobre todo lo que se consume al formar.
  - La de **formado**, solo a la masa.
  - El **empaque** se calcula sobre piezas buenas.
- **Plan de producción:**
  - Se captura en pantalla o por layout, por fecha, turno y sucursal.
  - Mientras no exista el módulo de inventarios (Fase 3), las existencias para el requerimiento neto se capturan en el plan.
  - Al **aprobar**, la explosión queda fija y se puede generar la **requisición de compra en borrador** (se completa en la Fase 4).
  - Se exporta a Excel para cuadrar con el cálculo manual.
- **Costo estándar:** muestra el costo y el margen a una fecha. Permite simular el impacto de un cambio de costo de insumos y guardar fotos inmutables (`costeo`, `costo_estandar`).
- **Layouts nuevos:** etapas, turnos, costo de mano de obra por minuto, tasas de GIF, recetas y fórmulas de masas, recetas y componentes de SKU, etapas por receta y plan de producción.
- **Ejemplos ficticios:** están en `datos-ejemplo/fase-2` (ver su `LEEME.md`). La prueba `pruebas/recetas.test.ts` los carga y compara los kg, lotes, requerimientos y costos contra el cálculo hecho a mano.

## Inventarios (Fase 3)

- **Kárdex:** `movimiento` + `movimiento_renglon`.
  - Cada renglón guarda la cantidad (+ entrada / − salida), el costo, el importe y el saldo después del movimiento.
  - Es de solo inserción. Un movimiento se cancela con otro inverso (`CANCELACION`).
- **Saldos:** `existencia`, `existencia_lote` y `capa_costo` (PEPS).
  - Se actualizan en la misma transacción, con el saldo bloqueado (`FOR UPDATE`).
  - `SELECT * FROM inventario_diferencias()` debe regresar cero renglones.
- **Valuación** (`inventarios.metodo_valuacion`, P34): **COSTO PROMEDIO** (decidido). El sistema también soporta PEPS.
  - No se puede cambiar una vez que hay movimientos.
  - Cuando sale todo lo que queda, se toma el valor restante exacto: no quedan centavos huérfanos.
- **Lotes:** si el artículo maneja lote, las salidas sin lote se reparten por caducidad (FEFO).
- **Operaciones** (pantalla **Inventarios**):

  | Operación | Cómo funciona | Permiso |
  |---|---|---|
  | Entrada por compra | Provisional hasta la Fase 4. Admite unidad de compra con conversión. | `compras.recepcion:crear` |
  | Surtido a producción | De MP a PEP en la misma sucursal. | `inventarios.surtido:crear` |
  | Entrada de producción | Provisional hasta la Fase 5. Valuada al costo estándar del día. | `produccion.ordenes:crear` |
  | Traspasos | Envío → tránsito → recepción. El faltante queda registrado y exige comentario. Se puede cancelar mientras está en tránsito. | — |
  | Mermas | Con causa y autorización: PT → `inventarios.merma_sucursal`; lo demás → `produccion.mermas`. | Límites de `limite_autorizacion`; quien registra no autoriza. |
  | Conteos físicos | A ciegas. El teórico se congela al enviar. El ajuste lo autoriza alguien distinto de quien contó, con límite `inventarios.ajuste`. | — |

- **Layouts nuevos:**
  - Causas de merma (29).
  - Mínimos y reorden por almacén (30).
  - Inventario inicial (31). Queda pendiente hasta que lo autorice quien tiene `inventarios.ajustes:autorizar`, y entra como movimiento `INICIAL`.
- **Alertas:**
  - Bajo mínimo o punto de reorden, con cantidad sugerida hasta el máximo. Los mínimos del artículo aplican en almacenes MP/INS; en PEP/PT solo los capturados por almacén.
  - Lotes caducados o por caducar (`inventarios.dias_alerta_caducidad`).
- **Cancelaciones** (P70): las hacen el contralor y el contador.
- **Seguridad:**
  - Cada acción valida en el servidor el permiso y el **alcance** del usuario sobre el almacén.
  - Sin `datos.costos:ver` se ocultan importes y valores.
- **Plan de producción:** el botón **Tomar existencias del inventario** llena existencia y tránsito (MP, INS y PEP de la sucursal del plan).
- **Pruebas:**
  - `pruebas/inventarios-dominio.test.ts`: promedio, PEPS y FEFO.
  - `pruebas/inventarios.test.ts`: flujo completo con costo promedio.
  - `pruebas/inventarios-peps.test.ts`: capas y cancelaciones exactas.

## Punto de venta (Fase 6)

- **Caja en pantalla completa** en `/pos`, pensada para monitor táctil.
  - Botones por familia y búsqueda; carrito y cobro con varias formas de pago y cálculo de cambio.
  - Ticket de 80 mm (`web/src/impresion.ts`). Usa el adaptador de navegador; el adaptador ESC/POS para abrir el cajón está pendiente de P45.
- **Sesión de caja:** se elige la caja (`/api/auth/caja`) y se cambia de cajero con PIN (`/api/auth/cajero`). Quien opera es el **cajero actual**.
- **Turno:** una caja tiene un solo turno abierto. Se abre con el fondo y se cierra con el corte Z.
- **Venta:**
  - El identificador lo genera la caja: reenviar una venta no la duplica.
  - Precio vigente de la sucursal o el general. Los impuestos se desglosan con `src/dominio/pos.ts`; el IVA se calcula sobre la base más el IEPS y cuadra al centavo.
  - En la misma transacción se registra la salida de producto terminado del almacén de la caja. **Sin existencia no se vende (P71).**
- **Tarjeta:** solo se guarda la referencia del voucher. Un número de tarjeta se rechaza en el servidor y con un CHECK en la base.
- **Requieren autorización de supervisor** (usuario y PIN, distinto del cajero; queda en la bitácora de accesos):

  | Operación | Permiso | Límite |
  |---|---|---|
  | Descuentos (contador o contralor, P50) | `pos.descuentos:autorizar` | — |
  | Pedido sin anticipo (contador o contralor, P60) | `pos.pedidos_sin_anticipo:autorizar` | — |
  | Devoluciones (no las autoriza quien vendió) | `pos.devoluciones:autorizar` | `pos.devolucion_descuento` |
  | Retiros e ingresos de efectivo | `pos.caja:autorizar` | — |
  | Cancelación de pedidos | `pos.pedidos:autorizar` | — |
  | Corte Z (si el cajero no tiene `pos.caja:cerrar`) | `pos.caja:cerrar` | — |

- **Cortes:**
  - X: parcial, no cierra el turno.
  - Z: arqueo por denominación, efectivo esperado contra contado y diferencia. Si la diferencia pasa de `pos.diferencia_corte_maxima`, exige comentario y autorización.
- **Pedidos:**
  - Se toman en la caja (mostrador) o desde oficina por WhatsApp o teléfono, para la sucursal que entrega. Los de oficina van sin anticipo y con autorización.
  - Se registran con anticipo y abonos, que son un pasivo del cliente (`movimiento_caja` ANTICIPO).
  - La entrega es una venta a los precios pactados que aplica lo anticipado.
  - Al cancelar, el anticipo se devuelve o se retiene.
- **Oficina:** la pantalla **Ventas y cortes** muestra ventas por fecha y sucursal (exportación a Excel y costo de lo vendido si tienes `datos.costos:ver`), cortes con su arqueo y pedidos.
- **Pruebas:**
  - `pruebas/pos-dominio.test.ts`: impuestos, cobro y cambio, corte, arqueo y devoluciones parciales.
  - `pruebas/pos.test.ts`: flujo completo.
- **Pendiente:**
  - Pólizas (Fase 7) y factura y factura global (Fase 8).
  - Abrir el cajón por ESC/POS, solo si el controlador de la Ghia no lo hace (P45).
- **Sin internet (P43):**
  - La caja sigue vendiendo. `web/src/sinConexion.ts` guarda una copia de productos y existencias, la cola de ventas y el folio provisional.
  - `web/public/sw.js` guarda la aplicación para que abra sin red.
  - Al reconectar se envía cada venta con `sin_conexion` (hora real y folio provisional). El servidor no la duplica y la valida igual que cualquier venta.
  - Si una venta ya no tiene existencia, queda marcada para que el encargado corrija el inventario y la reenvíe. No se borra.

## Compras (Fase 4)

- **Motor de autorizaciones** (`solicitud_autorizacion` y `firma_autorizacion`, de solo inserción):
  - Firma quien tiene el permiso y un límite que cubre el monto (`limite_autorizacion`).
  - Quien solicita no firma. Quien recibió la mercancía no autoriza su pago.
  - Lo usan requisiciones, órdenes de compra que rebasan lo autorizado, facturas con diferencias y pagos.
- **Flujo:**
  1. **Requisición:** manual o del plan. Se estima con el costo de referencia y se autoriza por nivel: hasta $10,000 el autorizador de nivel 1 (AUT1), arriba dirección.
  2. **Orden de compra:** solo sale de una requisición autorizada, en unidad de compra con conversión. Si pasa de lo autorizado más `compras.tolerancia_oc_pct`, vuelve a autorización.
  3. **Recepción:** entra al inventario (`ENTRADA_COMPRA`, documento `RECEPCION`) al precio de la OC por unidad base, con lote y caducidad. Desde el inventario no se cancela.
  4. **Factura XML (CFDI 4.0/3.3):** `src/servidor/cfdi.ts` usa `fast-xml-parser` y rechaza DOCTYPE/ENTITY y archivos de más de 1 MB.
  5. **Cotejo a 3 vías** (`src/dominio/compras.ts`): cantidad contra lo recibido, precio contra la OC, IVA y total, con tolerancias de Configuración → Compras. Si todo está dentro, se genera la cuenta por pagar; si no, autoriza el contralor.
  6. **Pago:** el contador lo programa, se autoriza y se marca pagado con la referencia bancaria.
- **Reportes:** antigüedad de saldos (exportable a Excel) y comparativo de precios por proveedor.
- **Decisiones (migración 0014):** tolerancias confirmadas (editables), OC sin envío por correo y un solo banco (BBVA).
- **Desde esta fase** la "entrada por compra" directa de la Fase 3 queda desactivada (`compras.permitir_entrada_sin_oc` = NO).
- **Pruebas:**
  - `pruebas/compras-dominio.test.ts`: cotejo, antigüedad y CFDI.
  - `pruebas/compras.test.ts`: flujo completo.

## Producción y costos (Fase 5)

- **Órdenes de producción** (`orden_produccion`, `src/servidor/produccion.ts`):
  - Se generan de un plan aprobado: una orden **N1** por cada masa o intermedio a preparar (kg, con los lotes de la explosión) y una **N2** por cada producto (piezas). También hay órdenes manuales (pedido especial o reproceso).
  - Cada orden congela la versión de receta, el consumo y los minutos estándar (`orden_componente`, `orden_etapa`) y el costo estándar del día.
  - La orden N2 depende de las N1 que le dan la masa (`orden_dependencia`).
  - Estatus: LIBERADA → EN_PROCESO (con el primer avance) → CERRADA, o CANCELADA con motivo. Cerrada o cancelada ya no se modifica (trigger).
- **Vale de surtido por orden:** materia prima y empaque del almacén MP al PEP (movimientos `SURTIDO_*` ligados a la orden). Pasar del estándar más `produccion.tolerancia_surtido_pct` exige motivo. Las masas no se surten: salen de su orden.
- **Avance por etapa** (`orden_avance`, solo inserción): cantidad, minutos y merma con causa (solo en etapas con REGISTRA_MERMA).
- **Cierre** (`src/dominio/produccion.ts`, con pruebas):
  1. Consume lo real del PEP (`CONSUMO_PRODUCCION`, FEFO por lote). Lo no capturado se toma del estándar para la cantidad real.
  2. Mano de obra = minutos reales (capturados, del avance o estándar) × tarifa; indirectos = KG_MASA × kg (N1), MINUTO_MOD × minutos y PIEZA × piezas formadas (N2).
  3. Da entrada al producto (`ENTRADA_PRODUCCION`) al **costo real** = materiales consumidos + mano de obra + indirectos.
  4. Guarda el balance de masa y de piezas, la variación de cada material (por cantidad y por precio) y la total contra el estándar. Fuera de tolerancia (`produccion.tolerancia_*`) exige justificación.
  - Las órdenes de masa las cierra el maestro de masas o el jefe de producción; las de producto, el jefe de producción (nota de la matriz).
  - El consumo y la entrada de una orden no se cancelan desde inventario.
- **Trazabilidad:** `lote_genealogia` guarda los lotes consumidos en cada orden; se rastrea un lote hacia adelante (órdenes, productos, ventas) y una orden hacia atrás.
- **Reportes:** variaciones (por orden y por material), rendimiento y merma (por producto, etapa y causa, persona y turno), sobrantes en PEP y **estado de costo de producción y ventas** desde el kárdex, con comprobaciones que deben dar cero.
- **Desde esta fase** la "entrada de producción" directa de la Fase 3 queda desactivada (`produccion.permitir_entrada_directa` = NO).
- **Pruebas:**
  - `pruebas/produccion-dominio.test.ts`: estándar, costo real, balance, variaciones y estado de costos.
  - `pruebas/produccion.test.ts`: un día simulado de punta a punta.

## Contabilidad (Fase 7)

- **Periodos mensuales** (`periodo_contable`): abierto o cerrado. En un periodo cerrado no entra ni cambia ninguna póliza (trigger).
- **Pólizas** (`poliza`, `poliza_partida`): de ingreso (I), egreso (E) o diario (D), con folio `D-202611-0001`.
  - Las partidas son inmutables y solo van a cuentas afectables y activas.
  - Una póliza siempre cuadra (trigger diferido al terminar la transacción).
- **Reglas de contabilización** (`concepto_contable` y `regla_contable`):
  - Los conceptos son la lista fija del sistema (caja, ventas, IVA, inventarios, mano de obra aplicada, proveedores…).
  - La cuenta de cada concepto la define el negocio, en general o por sucursal (gana la de la sucursal).
  - Se capturan en pantalla o por layout (`reglas_contables`).
- **Pólizas automáticas** (`src/servidor/contabilidad.ts` → `contabilizar`):
  - Busca los documentos sin póliza: movimientos de inventario, órdenes de producción cerradas, ventas, devoluciones, movimientos de caja y anticipos, pedidos cancelados con anticipo retenido, diferencias del corte Z, facturas de proveedor, pagos y faltantes de traspasos.
  - Cada documento se contabiliza una sola vez (índice único por origen).
  - Las cancelaciones del kárdex se revierten por su propio signo.
  - Si falta una regla, el documento queda **pendiente** con el concepto que falta; no se inventa cuenta.
  - El redondeo a centavos siempre cuadra (`src/dominio/contabilidad.ts`, con pruebas).
- **Pólizas manuales:** las captura el contador y las autoriza el contralor (quien captura no autoriza). Se cancelan con motivo mientras el periodo está abierto.
- **Reportes:** balanza de comprobación (con acumulación a cuentas de mayor), auxiliares con saldo corrido, libro diario, estado de resultados y balance general (por el primer dígito del código agrupador o de la cuenta) y conciliación del inventario contable contra el kárdex. Todo se exporta a Excel.
- **Cierre de mes** (contralor):
  1. Genera lo pendiente.
  2. Exige que no quede nada sin contabilizar ni pólizas sin autorizar, y que la balanza cuadre.
  3. Se cierra en orden; se reabre con motivo solo el último cerrado.
- **Mano de obra e indirectos:** lo aplicado a producción se abona a sus cuentas. El gasto real se carga con pólizas manuales; la diferencia es la sub o sobreaplicación.
- **Pruebas:**
  - `pruebas/contabilidad-dominio.test.ts` y `pruebas/contabilidad.test.ts`.
  - Al final de las pruebas de compras, punto de venta y producción se revisa que todo se contabilice, que la balanza cuadre y que el inventario contable sea igual al kárdex (`pruebas/apoyo-contable.ts`).

## Facturación con el portal del SAT (Fase 8)

Decisiones del negocio (P49, P53, P54, P56, P58, P64): las facturas se hacen y se timbran en el **portal del SAT**. No hay PAC, ni e.firma ni CSD en el sistema (la e.firma la tiene el contador).

- **Solicitud de factura** (`solicitud_factura`):
  - Lleva los datos fiscales del cliente (RFC, nombre, régimen, C.P., uso del CFDI) ligados a un ticket.
  - Se pide **el mismo día** (`fiscal.dias_solicitud` = 0), con el **correo** del cliente (obligatorio). Su ticket no entra en la global.
  - La factura **le llega por correo al día siguiente** (`fiscal.dias_entrega_factura` = 1): se registra quién la envió y cuándo; las que pasan del plazo salen atrasadas en la conciliación.
  - Régimen y uso se validan contra el catálogo del SAT cargado (`c_RegimenFiscal`, `c_UsoCFDI`).
  - Los datos no se modifican: se cancela la solicitud y se captura otra.
- **Datos para el portal** (`src/dominio/facturacion.ts`, con pruebas):
  - **Factura individual:** un concepto por renglón, con el neto de devoluciones.
  - **Factura global diaria:** un concepto por ticket con su folio como número de identificación, clave `01010101`, unidad `ACT`, RFC `XAXX010101000` y periodicidad 01.
  - Impuestos agrupados por tasa.
  - Forma de pago: la de mayor importe. Lo pagado con anticipo se declara con la forma en que se cobró el anticipo.
- **Registro del XML** descargado del portal (`cfdi_emitido`, `cfdi_venta`):
  - Revisa versión 4.0, MXN, RFC emisor (`empresa.rfc`), sin retenciones, UUID no repetido y receptor de la solicitud.
  - En la global, revisa la periodicidad diaria y el mes y año.
  - Coteja los importes contra los tickets con tolerancia `fiscal.tolerancia_importe`.
  - Un ticket queda en **a lo más una factura vigente** (índice único).
  - El XML y sus importes no se modifican.
- **Notas de crédito** (CFDI de egreso relacionado): se suben en la factura que corrigen. La conciliación avisa de devoluciones de tickets facturados sin nota.
- **Cancelación:** se hace en el portal del SAT. Aquí la registra el contador (motivo 01–04) y la autoriza el contralor; quien registra no autoriza. Al cancelarse, sus tickets y solicitudes se pueden volver a facturar.
- **Conciliación vendido contra facturado:** por día y sucursal, con alertas de días sin global, devoluciones sin nota de crédito y cancelaciones por autorizar.
- **Recibo de anticipo** (`anticipo.folio`, `REC-000001`): se imprime al cobrar el anticipo o un abono de un pedido. No es comprobante fiscal; todo se factura a la entrega.
- **Contabilidad:** la póliza de una venta muestra el UUID de su factura, y la de una factura de proveedor el suyo.
- **XML de PRUEBA:** solo con `PERMITIR_DATOS_PRUEBA=si`. Imita el XML del portal para ensayar; no está timbrado.
- **Permisos:**
  - Solicitudes: `fiscal.cfdi:crear` (encargado de su sucursal, contador).
  - Registrar XML: `fiscal.cfdi:timbrar` (encargado y contador).
  - Cancelar: `fiscal.cfdi:cancelar` (contador). Autorizar cancelación: `fiscal.cfdi:autorizar` (contralor).
- **Pruebas:** `pruebas/facturacion-dominio.test.ts` y `pruebas/facturacion.test.ts`.

## Traslado a la estructura definitiva

Antes de cargar datos reales (ver `docs/fase-0/02-diseno-propuesto.md`, sección 1.2): repositorio y proyecto en las cuentas del negocio, **llaves nuevas**, base nueva construida con las migraciones, desactivar deploy previews en producción, `PERMITIR_DATOS_PRUEBA` sin definir, y carga de datos reales por layout.
