# Etapas de implementación

Guía práctica: qué haces tú, qué hago yo y cómo se aprueba cada etapa.

## Cómo trabajamos en cada fase

1. Programo en una sesión de Claude Code en la nube, en la rama `desarrollo` del repositorio `carsam68-MonheyB/SAS-EL-PAN-DE-CADA-DIA`. No se instala nada en tu computadora.
2. En cada cambio corren las pruebas automáticas y Netlify genera una **deploy preview** con datos ficticios.
3. Te paso la liga, qué hice y cómo probarlo.
4. Tú pruebas y me das observaciones o tu visto bueno.
5. Con tu visto bueno paso los cambios a `main` y se publican en el proyecto temporal de tu cuenta.
6. Te mando el paquete `.zip` de la versión para tu copia en OneDrive.
7. No empiezo la siguiente fase sin tu aprobación.

---

## Etapa A · Preparativos (los haces tú, una sola vez)

### A1. Acceso de Claude al repositorio
1. Entra a **claude.ai/connect-github** y conecta tu cuenta de GitHub.
2. Instala la **aplicación de Claude para GitHub** con acceso a `SAS-EL-PAN-DE-CADA-DIA`.
3. Avísame y lo conecto a la sesión.

### A2. Proyecto en tu cuenta de Netlify (temporal)
1. En *Billing*, confirma que tu plan **Personal** muestre **créditos** (1,000 al mes). No hace falta Pro durante el desarrollo. Revisa *Usage* cada semana.
2. Después de que yo suba el esqueleto: **Add new project → Import from Git → GitHub → SAS-EL-PAN-DE-CADA-DIA**, rama de producción `main`.
3. Las llaves secretas las capturas tú en el panel, **a nivel del proyecto**. Nunca van en el chat ni en el repositorio.

### A3. Respuestas pendientes que bloquean la Fase 1
- **P08:** sucursales (cuántas, nombre y clave de cada una)
- **P09:** ¿planta central que surte a las sucursales, cada sucursal produce, o mixto?
- **P11:** lista de almacenes
- **P16:** matriz de puestos y permisos (o pídeme un borrador)
- **P20:** autenticación propia con TOTP (recomendada) o Auth0
- **P03:** plan Pro por créditos en tu cuenta de Netlify
- **Aprobación por escrito** del diseño de la Fase 0

### A4. Puede ir en paralelo (no bloquea)
- Registrar el dominio `.mx` a nombre del negocio.
- Contratar correo para la oficina.
- Pedir a tu contador: catálogo de cuentas y datos fiscales de los 70 SKU.
- Exportar de Soft Restaurant productos, precios y ventas históricas a Excel.
- Elegir PAC (lo necesitamos hasta la Fase 8).

---

## Etapa B · Construcción por fases

| Fase | Qué construyo | Qué preparas tú | Cómo lo apruebas |
|---|---|---|---|
| **1A. Base y seguridad** | Proyecto, ambientes, inicio de sesión con doble factor, PIN de cajero, usuarios, roles, permisos, bitácora, reporte "quién puede hacer qué" | Matriz de puestos; valores de seguridad (P18) | Entras con un usuario de prueba por puesto: cada uno ve y hace solo lo suyo. Intento de combinaciones prohibidas: se bloquean |
| **1B. Catálogos y layouts** | Sucursales, almacenes, artículos, proveedores, clientes, cuentas contables; carga masiva por TXT, CSV y Excel con validación previa | Llenar los layouts con tus 70 SKU, materias primas, masas y recetas | Subes tus archivos, incluso con errores a propósito: el sistema los detecta y no guarda nada a medias |
| **2. Recetas y explosión** | Recetas de masas y de SKU, % panadero, versiones, plan de producción, kg de masa, lotes, requerimiento de materia prima, costo estándar | Tu cálculo en Excel de un día de producción, para comparar | Los números del sistema cuadran con tu Excel |
| **3. Inventarios** | Entradas, salidas, traspasos, kárdex valuado, lotes y caducidades, conteos físicos | Un ejercicio de kárdex resuelto a mano | El kárdex del sistema cuadra con el tuyo |
| **4. Compras** | Requisición → autorización → orden de compra → recepción → XML del proveedor → cuentas por pagar | Montos y niveles de autorización | Una OC no sale sin autorización; el cotejo detecta diferencias |
| **5. Producción y costos** | Vales de surtido, órdenes de masa y de pan, mermas, sobrantes, balance de masa, estado de costos | Un día real de producción para simularlo | El balance de masa y de piezas cuadra; el estado de costos cuadra con inventarios y contabilidad |
| **6. Punto de venta** | POS táctil, cortes X y Z, arqueo, devoluciones, pedidos con anticipo, impresión de ticket y apertura de cajón | La caja instalada con la impresora y el cajón | Un día de ventas simulado cuadra caja, inventario y ventas |
| **7. Contabilidad** | Reglas de contabilización, pólizas automáticas, balanza, estados financieros, cierre de mes | Reglas de contabilización con tu contador | La balanza cuadra y cada póliza tiene su documento origen |
| **8. SAT y PAC** | Facturas, factura global, cancelaciones, complementos de pago, descarga masiva de XML, conciliaciones, contabilidad electrónica | e.firma y CSD vigentes; contrato con el PAC | Timbrado exitoso en el ambiente de pruebas del PAC; descarga y conciliación de un mes real |
| **9. Arranque** | Tableros, manual de usuario, respaldo externo y prueba de restauración, revisión final de permisos | Capacitar al personal; definir la fecha de corte | Operación en paralelo con Soft Restaurant el tiempo que decidas; después se apaga |

✅ **Decisión (21/11/2026): el POS se adelanta.** Orden real: **1A → 1B → 2 → 3 → 6 (POS) → 4 → 5 → 7 → 8 → 9**. Así Soft Restaurant se puede retirar al terminar la Fase 6. La facturación de tickets llega en la Fase 8; mientras tanto, o se sigue facturando en Soft Restaurant, o se adelanta también esa parte (se decide al llegar).

---

## Etapa C · Arranque en producción

0. **Traslado a la estructura definitiva de Netlify** (diseño, sección 1.2), con llaves nuevas.

1. Carga de datos reales en producción: catálogos, recetas, existencias iniciales, saldos contables.
2. Alta de los usuarios reales; cada uno activa su acceso y, si su puesto lo requiere, su doble factor.
3. Operación en paralelo con Soft Restaurant y comparación diaria de ventas, caja e inventario.
4. Fecha de corte: se apaga Soft Restaurant.
5. Bajar el plan de Netlify a 5,000 créditos cuando el consumo real lo confirme.

## Etapa D · Operación y mantenimiento

- Revisión mensual: que exista el respaldo externo y el consumo de créditos.
- Avisos automáticos de vencimiento de e.firma y CSD.
- Cambios y mejoras: se trabajan igual que las fases (primero en pruebas, después en producción).
