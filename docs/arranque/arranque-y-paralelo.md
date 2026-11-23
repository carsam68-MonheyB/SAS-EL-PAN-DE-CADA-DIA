# Arranque: salida a producción y operación en paralelo

## 1. Antes de cargar datos reales (traslado a la estructura definitiva)

1. **Cuentas del negocio:** repositorio de GitHub y proyecto de Netlify a nombre del negocio (no personales).
2. **Base nueva** construida con las migraciones (se crea sola al desplegar).
3. **Variables nuevas** a nivel del proyecto: `LLAVE_MAESTRA` nueva, `RESPALDO_LLAVE` nueva (y guardada fuera de Netlify), `RESPALDO_S3_*` del almacenamiento del negocio, `CLAVE_INSTALACION` solo para instalar. **Sin** `PERMITIR_DATOS_PRUEBA`.
4. **Desactivar deploy previews** en el proyecto de producción.
5. Instalar: `/instalacion` con la clave; crear al administrador y quitar `CLAVE_INSTALACION`.
6. **Configuración:** RFC de la empresa, fecha de arranque contable, y revisar con dirección y el contador todos los **valores provisionales**.
7. **Cargas por layout** (datos reales): catálogos del SAT oficiales, unidades, familias, tasas de impuesto reales, proveedores, clientes, insumos, intermedios, productos con datos fiscales, recetas y etapas (revisadas con el jefe de panadería, P28), tarifas, catálogo de cuentas y reglas del contador (P51/P65), saldos iniciales (P52), existencias iniciales del día de corte, precios.
8. **Usuarios reales** con su puesto, sucursal y almacén; cada quien activa su doble factor y su PIN.
9. **Arranque y respaldos → Revisión de arranque:** todo en "Bien". Hacer un **respaldo manual** y una **prueba de restauración** (restauracion.md).

## 2. Fecha de corte

- Se elige un día de poco movimiento. Esa mañana, antes de abrir: conteo físico de materia prima y producto terminado, carga de existencias iniciales y autorización del contralor.
- El fondo de cada caja se captura al abrir turno.

## 3. Operación en paralelo con Soft Restaurant

Durante el periodo que decida dirección (sugerido: 2 a 4 semanas):

| Qué | Cómo |
|---|---|
| Ventas | Se cobran en el **nuevo sistema**. Si se decide capturar también en Soft Restaurant, al cierre del día se comparan los totales por sucursal y forma de pago. |
| Corte | Corte Z en el nuevo sistema; diferencias contra el efectivo contado se explican el mismo día. |
| Facturación | Solo desde el portal del SAT con los datos del nuevo sistema (una sola fuente para no duplicar). |
| Inventarios | Conteo semanal de los productos de mayor venta; los ajustes los autoriza el contralor. |
| Contabilidad | El contador genera pólizas diario o semanal y compara contra su contabilidad actual. |
| Revisión diaria | **Tablero** (ventas, mermas), **Vendido vs. facturado** y **Revisión de arranque**. |

**Criterio para apagar Soft Restaurant:** dos semanas seguidas sin diferencias importantes en ventas, cortes y existencias, y el primer cierre de mes contable hecho en el nuevo sistema (con su respaldo externo).

## 4. Capacitación

- Cada puesto con su sección del **manual de usuario** (`docs/manual/manual-de-usuario.md`), practicando antes en el ambiente de pruebas con los usuarios `prueba.*`.
- Cajeros: venta, cobro con tarjeta (solo referencia), ofertas, pedidos, devolución, cortes y venta sin internet.

## 5. Después del arranque

- Respaldos: revisar cada mes en **Arranque y respaldos** que el respaldo mensual y el del cierre estén completos.
- Bajas de personal el mismo día (Usuarios → Baja).
- Revisión de permisos cada trimestre con el reporte **quién puede hacer qué** (Usuarios).
