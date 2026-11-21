# Etapas de implementación

Guía práctica: qué haces tú, qué hago yo y cómo se aprueba cada etapa.

## Cómo trabajamos en cada fase

1. Programo en la **carpeta del proyecto en tu computadora**, con Claude Code abierto ahí mismo.
2. Todo se prueba primero en **local** (`netlify dev`), con datos ficticios.
3. Te aviso qué hice, cómo probarlo y con qué usuarios de prueba. Hago commit en Git local.
4. Tú pruebas y me das observaciones, o tu visto bueno.
5. Con tu visto bueno corremos el script **`publicar`**:
   - verifica la cuenta de Netlify;
   - corre las pruebas;
   - hace commit con la versión;
   - genera el borrador;
   - y, solo si escribes **SI**, publica a producción.
6. Al publicar se genera la **copia del código** (`respaldar-codigo`).
7. No empiezo la siguiente fase sin tu aprobación.

---

## Etapa A · Preparativos (los haces tú, una sola vez)

### A1. Computadora de desarrollo
1. Elige la computadora donde vivirá el código (de preferencia no la de la caja).
2. Instala:
   - **Git para Windows** (git-scm.com)
   - **Node.js LTS** (nodejs.org), versión 20.12.2 o más nueva
   - **Netlify CLI**, con el comando `npm install -g netlify-cli` (versión 26 o más nueva)
   - **Claude Code** (app de escritorio o terminal)
3. Crea la carpeta del proyecto (ej. `C:\Proyectos\erp-panaderia`).
4. Descomprime ahí el paquete de la Fase 0 que te envío (`erp-panaderia-fase0.zip`). Trae los documentos y el historial de Git.
5. Elige dónde se guardará la copia del código fuera de esa computadora (OneDrive, Google Drive o disco externo).

### A2. Proyecto en tu cuenta de Netlify (solo desarrollo)
> Es temporal: antes de cargar datos reales se traslada a la estructura definitiva (diseño, sección 1.2).

1. Usa **tu cuenta actual**. Verifica en *Billing* que el plan sea **Pro por créditos** y activa la **recarga automática**: los créditos se comparten con tus otros proyectos.
2. En desarrollo el consumo del ERP es bajo. Revisa el consumo del mes en *Usage* durante las primeras semanas.
3. En la carpeta del proyecto: `netlify login` y `netlify status`.
4. El proyecto nuevo y su base los creamos juntos en la Fase 1A (`netlify init` o `netlify link`), con un despliegue de prueba vacío. Su ID queda guardado para que `publicar` nunca publique en otro de tus proyectos.
5. Las llaves secretas se capturan en el panel, **a nivel del proyecto del ERP** (no del team). **Nunca** van en el chat ni en la carpeta.

### A3. Respuestas pendientes que bloquean la Fase 1
- **P08:** sucursales (cuántas, nombre y clave de cada una)
- **P09:** ¿planta central que surte a las sucursales, cada sucursal produce, o mixto?
- **P11:** lista de almacenes
- **P16:** matriz de puestos y permisos (o pídeme un borrador)
- **P20:** autenticación propia con TOTP (recomendada) o Auth0
- **P02, P03 y P66:** ruta de la carpeta, cuenta de Netlify del negocio y computadora de desarrollo
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

**Decisión pendiente:** si quieres dejar Soft Restaurant antes, el POS (Fase 6) se adelanta y va justo después de la Fase 3.

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
