# Borrador · Matriz de puestos y permisos

> **Borrador para que lo corrijas** (respuesta a P16). Nada de esto se programa hasta que lo apruebes. Se basa en los 11 puestos de referencia del prompt. Los montos van como `[definir]`: no supuse ninguno.

Archivo editable en Excel: `05-matriz-puestos-borrador.xlsx` (mismo contenido; puedes cambiar celdas y regresármelo).

## 1. Puestos

| Clave | Puesto | Alcance | Doble factor |
|---|---|---|---|
| **ADM** | Administrador del sistema | Todas | Sí |
| **DIR** | Dirección | Todas | Sí |
| **CON** | Contralor | Todas | Sí |
| **CNT** | Contador / auxiliar contable | Todas | Sí |
| **COM** | Compras | Todas | Opcional |
| **AUT1** | Autorizador de compras nivel 1 | Todas (hasta su límite) | Sí |
| **AUT2** | Autorizador de compras nivel 2 | Todas (arriba del límite del nivel 1) | Sí |
| **ALM** | Almacenista de MP | Su(s) almacén(es) | No |
| **JPR** | Jefe de producción | Planta | Opcional |
| **MAE** | Maestro de masas | Planta | No |
| **PAN** | Panadero | Planta | No |
| **ENC** | Encargado de sucursal | Su sucursal | Opcional |
| **CAJ** | Cajero | Su sucursal y caja | No (usa PIN) |

Criterios del borrador:
- **El administrador del sistema solo administra usuarios y seguridad.** No opera compras, inventarios, caja ni contabilidad, para que nadie pueda darse permisos y usarlos.
- **Dirección autoriza lo de mayor monto y ve todo**, pero no captura operaciones.
- **El contralor revisa y autoriza** (ajustes, pólizas manuales, cancelaciones, cierres), pero no compra ni vende.
- Quien **solicita, recibe o cuenta** nunca es quien **autoriza**.

## 2. Matriz módulo × acción

**Acciones:** V = ver · C = crear · E = editar · X = cancelar · A = autorizar · Ce = cerrar · Ex = exportar · I = imprimir · Im = importar por layout. Vacío = sin acceso.

| Grupo | Módulo | ADM | DIR | CON | CNT | COM | AUT1 | AUT2 | ALM | JPR | MAE | PAN | ENC | CAJ | Notas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Seguridad | Usuarios, roles y permisos | V C E X Ex | V Ex | V Ex |  |  |  |  |  |  |  |  |  |  | El administrador no puede asignarse roles a sí mismo; el contralor revisa el reporte "quién puede hacer qué". |
| Seguridad | Bitácora de auditoría y de accesos | V Ex | V Ex | V Ex |  |  |  |  |  |  |  |  |  |  | Nadie edita ni borra la bitácora. |
| Seguridad | Configuración de seguridad (contraseñas, bloqueo, inactividad, PIN) | V E | V | V |  |  |  |  |  |  |  |  |  |  |  |
| Configuración | Parámetros de negocio (tolerancias, redondeo, montos límite, incompatibilidades) | V | V A | V E |  |  |  |  |  |  |  |  |  |  | Los propone el contralor y los autoriza dirección; el administrador del sistema no los cambia. |
| Catálogos | Sucursales, almacenes, cajas y centros de costo | V C E | V | V |  |  |  |  |  |  |  |  | V |  |  |
| Catálogos | Materias primas, insumos y empaques |  | V | V Ex | V | V C E Ex | V | V | V | V |  |  |  |  |  |
| Catálogos | Productos terminados (SKU) |  | V | V Ex | V E |  |  |  |  | V C E | V | V | V | V | El contador solo edita los datos fiscales SAT. |
| Catálogos | Proveedores |  | V | V | V E | V C E Ex | V | V |  |  |  |  |  |  | El contador edita datos fiscales y cuentas bancarias. |
| Catálogos | Clientes |  | V | V | V C E |  |  |  |  |  |  |  | V C E | V C |  |
| Catálogos | Precios de venta |  | V A | V C E Ex |  |  |  |  |  |  |  |  | V | V | Todo cambio de precio requiere autorización de dirección. |
| Producción | Recetas de masas, intermedios y SKU |  | V | V Ex |  |  |  |  |  | V C E Ex I |  |  |  |  | El maestro de masas y los panaderos no ven recetas completas: solo su orden de producción. |
| Producción | Plan de producción |  | V | V |  |  |  |  | V | V C E X A | V | V | V C |  | El encargado captura lo que necesita su sucursal; el jefe de producción aprueba el plan. |
| Producción | Órdenes de producción (masa y SKU) |  | V | V |  |  |  |  |  | V C E X Ce I | V E Ce I | V E I |  |  | El maestro de masas registra los kg reales y cierra las órdenes de masa. El panadero registra piezas formadas, avance por etapa y piezas buenas; el jefe de producción cierra las órdenes de SKU. |
| Producción | Mermas de producción |  | V | V A |  |  |  |  |  | V C A | V C | V C |  |  | Arriba del límite del jefe de producción autoriza el contralor. |
| Inventarios | Vales de surtido a producción |  |  | V |  |  |  |  | V C I | V C | V |  |  |  |  |
| Inventarios | Traspasos entre almacenes y sucursales |  | V | V |  |  |  |  | V C I | V C I |  |  | V E |  | El encargado confirma la recepción en su sucursal. |
| Inventarios | Existencias y kárdex |  | V Ex | V Ex | V Ex | V |  |  | V Ex | V Ex |  |  | V |  | Valores en pesos solo para quien tiene "ver costos". |
| Inventarios | Conteos físicos |  |  | V Ex |  |  |  |  | V C I | V C I |  |  | V C I |  |  |
| Inventarios | Ajustes de inventario |  | V A | V A |  |  |  |  | V C | V C |  |  | V C |  | Quien contó no autoriza su ajuste. Arriba del límite del contralor autoriza dirección. |
| Inventarios | Merma de producto no vendido (sucursal) |  | V | V A |  |  |  |  |  |  |  |  | V C |  |  |
| Compras | Requisiciones |  | V | V |  | V C E X | V A | V A | V C | V C |  |  | V C |  | Nadie autoriza sus propias requisiciones. Nivel 1 hasta su límite; arriba autoriza nivel 2 (ver límites por monto). |
| Compras | Órdenes de compra |  | V | V Ex |  | V C E X I Ex | V | V |  |  |  |  |  |  | Solo se emiten con requisición autorizada vigente. |
| Compras | Recepción de mercancía |  |  | V |  | V |  |  | V C I |  |  |  |  |  |  |
| Compras | Facturas de proveedor (XML) y cotejo a 3 vías |  | V | V A | V C | V C |  |  |  |  |  |  |  |  | Diferencias fuera de tolerancia las autoriza el contralor. |
| Compras | Cuentas por pagar y pagos |  | V A | V A Ex | V C E X Ex |  |  |  |  |  |  |  |  |  | Quien recibió la mercancía no autoriza el pago. |
| Punto de venta | Ventas |  | V Ex | V Ex |  |  |  |  |  |  |  |  | V C X I | V C I | Reimpresión de ticket solo con permiso del encargado. |
| Punto de venta | Caja: apertura, retiros, corte X y corte Z, arqueo |  | V | V Ex |  |  |  |  |  |  |  |  | V A Ce I | V C | El cajero abre caja y hace corte X; el encargado autoriza retiros y cierra el corte Z. |
| Punto de venta | Devoluciones, cancelaciones y descuentos |  | V | V A |  |  |  |  |  |  |  |  | V A | V C | El cajero solicita; autoriza el encargado hasta su límite y arriba el contralor. |
| Punto de venta | Pedidos y anticipos |  | V | V |  |  |  |  |  | V |  |  | V C E X A I | V C I | Cancelar un pedido o devolver un anticipo lo autoriza el encargado. |
| Fiscal | Facturación CFDI (nominativa, global, notas de crédito, pagos) |  | V | V A Ex | V C X Ex I |  |  |  |  |  |  |  | V C I |  | El encargado solo factura tickets de su sucursal. Cancelaciones: las autoriza el contralor. |
| Fiscal | e.firma y CSD (cargar y reemplazar) |  |  | V | V C E |  |  |  |  |  |  |  |  |  | Las custodia y carga el contador. Nadie puede ver ni descargar las llaves; el sistema solo las usa cifradas. El contralor solo ve la vigencia. |
| Fiscal | Descarga masiva SAT y conciliaciones |  | V | V Ex | V C Ex |  |  |  |  |  |  |  |  |  |  |
| Contabilidad | Catálogo de cuentas y reglas de contabilización |  | V | V A Ex | V C E Ex |  |  |  |  |  |  |  |  |  |  |
| Contabilidad | Pólizas (automáticas y manuales) |  | V Ex | V A Ex I | V C E X Ex I |  |  |  |  |  |  |  |  |  | Las pólizas manuales requieren autorización del contralor. |
| Contabilidad | Cierre de periodo |  | V | V Ce | V |  |  |  |  |  |  |  |  |  |  |
| Contabilidad | Reportes financieros y contabilidad electrónica |  | V Ex I | V Ex I | V Ex I |  |  |  |  |  |  |  |  |  |  |
| Reportes | Tablero y reportes de gestión |  | V Ex | V Ex | V Ex | V Ex |  |  |  | V Ex |  |  | V |  | Cada quien ve solo los reportes de sus módulos y su alcance. |
| Cargas | Carga masiva por layout (importar) | Im |  | Im | Im | Im |  |  |  | Im |  |  |  |  | Cada rol importa solo los layouts de sus catálogos. Existencias, precios y saldos iniciales requieren autorización. |

## 3. Permisos sobre datos sensibles

| Permiso | ADM | DIR | CON | CNT | COM | AUT1 | AUT2 | ALM | JPR | MAE | PAN | ENC | CAJ | Notas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ver costos y márgenes |  | ✔ | ✔ | ✔ | ✔ |  |  |  | ✔ |  |  |  |  | El jefe de producción sí ve y revisa costos. Compras ve costos de insumos, no márgenes de venta. |
| Ver la receta completa (fórmula y cantidades) |  | ✔ | ✔ |  |  |  |  |  | ✔ |  |  |  |  | Maestro de masas y panaderos solo ven su orden de producción con lo que deben preparar. |
| Modificar precios de venta |  | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  | El contralor propone y dirección autoriza. |
| Timbrar CFDI |  |  |  | ✔ |  |  |  |  |  |  |  | ✔ |  | El encargado solo timbra facturas de tickets de su sucursal. |
| Cancelar CFDI |  |  | ✔ | ✔ |  |  |  |  |  |  |  |  |  | Las captura el contador y las autoriza el contralor. |
| Cargar e.firma / CSD |  |  |  | ✔ |  |  |  |  |  |  |  |  |  | Custodia del contador. |

## 4. Límites por monto (los defines tú)

| Operación | Quién | Monto |
|---|---|---|
| Autorizar requisiciones de compra | AUT1 (nivel 1) | hasta [definir] |
| Autorizar requisiciones de compra | AUT2 (nivel 2) | más de [definir] |
| Autorizar ajustes de inventario | CON | hasta [definir] |
| Autorizar ajustes de inventario | DIR | más de [definir] |
| Autorizar mermas de producción | JPR | hasta [definir] |
| Autorizar mermas de producción | CON | más de [definir] |
| Autorizar devoluciones y descuentos en POS | ENC | hasta [definir] |
| Autorizar devoluciones y descuentos en POS | CON | más de [definir] |
| Autorizar pagos a proveedores | CON | hasta [definir] |
| Autorizar pagos a proveedores | DIR | más de [definir] |

## 5. Incompatibilidades (segregación de funciones)

El sistema impide asignar a un mismo usuario, o que un mismo usuario ejecute sobre el mismo documento:

| Si hace esto… | …no puede hacer esto |
|---|---|
| Solicitar requisición | Autorizar esa misma requisición |
| Recibir mercancía | Autorizar el pago de esa compra |
| Hacer el conteo físico | Autorizar el ajuste de ese conteo |
| Cajero de un turno | Autorizar sus propias devoluciones o su corte |
| Crear o editar usuarios y roles | Cualquier permiso operativo (compras, inventarios, caja, contabilidad) |
| Registrar pagos a proveedores | Autorizar esos pagos |
| Capturar pólizas manuales | Autorizar esas pólizas |
| Proponer precios de venta | Autorizar esos precios |
| Dar de alta proveedores | Autorizar pagos a esos proveedores |
| Capturar cancelación de CFDI | Autorizar esa cancelación |

## 6. Respuestas ya incorporadas (21/11/2026)

- Cada puesto es una persona distinta, con su rol y su alcance.
- Hay **2 niveles de autorizador de compras** (AUT1 y AUT2).
- Facturan tickets el **encargado de sucursal** y el **contador**.
- El **jefe de producción** sí ve y revisa costos.
- El **contador** custodia y carga la **e.firma**.
- Se separó **maestro de masas** de **panadero**.

## 7. Pendiente

1. ¿Qué **otros puestos** existen además de panaderos (ej. auxiliar de producción, repartidor, supervisor de sucursales, decorador)? ¿Qué hace cada uno en el sistema?
2. ¿Quién ocupa el **nivel 2** de compras: dirección u otra persona?
3. Los montos `[definir]` de la sección 4.
