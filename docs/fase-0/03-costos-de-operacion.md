# Fase 0 · Costos de operación y mantenimiento (estimación)

Fecha: 21/11/2026. Precios consultados en fuentes públicas. **Confírmalos al contratar.** Las cifras de Netlify están en USD y cambian (en abril 2026 subieron las tarifas de cómputo y transferencia).

## 1. Netlify (hosting + base de datos)

**Planes Pro por créditos (julio 2026):**

| Créditos al mes | Precio | ¿Se acumulan los no usados? |
|---|---|---|
| 3,000 | USD 20 | No |
| 5,000 | USD 33 | Sí, un ciclo |
| 10,000 | USD 63 | Sí, un ciclo |
| 15,000 | USD 95 | Sí, un ciclo |
| 20,000 | USD 126 | Sí, un ciclo |

- Créditos extra (recarga): 1,500 créditos por USD 10. No vencen.
- ⚠️ **Si se acaban los créditos, Netlify pausa el sitio** ("Site not available"). Hay que activar la **recarga automática**.
- Usuarios del team: ilimitados sin costo adicional.

**Consumo estimado del ERP** (horario confirmado: producción desde las 3:00 y venta de 7:00 a 21:00, todos los días = 18 h de uso):

| Concepto | Tarifa | Estimación mensual |
|---|---|---|
| Base de producción despierta en horario (1 unidad de cómputo) | 10 créditos por hora | 18 h × 30 días ≈ **5,400** |
| Base de pruebas (solo cuando se usa) | 10 créditos por hora | ~30 h ≈ 300 |
| Funciones (cómputo) | 10 créditos por GB‑hora | < 100 |
| Peticiones web | 2 créditos por 10,000 | < 50 |
| Transferencia (app + base) | 20 créditos por GB | ~100 |
| Despliegues a producción | 15 créditos c/u | 60 (mantenimiento) a 300 (desarrollo) |
| **Total** | | **≈ 6,000 – 6,200** |

**Recomendación:** plan de **10,000 créditos (USD 63/mes)** mientras se desarrolla. En operación normal: plan de **5,000 créditos (USD 33) + una recarga de 1,500 (USD 10) ≈ USD 43 al mes**, con recarga automática activada. La base es una sola, así que el costo **no se multiplica por sucursal**: depende de cuántas horas al día hay al menos una sucursal operando.

## 2. Otros servicios

| Servicio | Costo | Periodicidad |
|---|---|---|
| GitHub (organización con repositorio privado y automatizaciones) | USD 0 (plan gratuito) | — |
| Dominio `.mx` / `.com.mx` | Varía por registrador; cotizar | Anual |
| Correo del personal (Microsoft 365 / Google Workspace / Zoho) | Por usuario al mes; solo oficina | Mensual o anual |
| Envío de correos del sistema (Resend) | USD 0 dentro del plan gratuito (≈3,000 correos/mes; verificar) | Mensual |
| Almacenamiento externo de respaldos (ej. Backblaze B2 / Amazon S3) | Menos de USD 1 al mes por el volumen esperado | Mensual |
| PAC (timbrado de CFDI) | ≈ MXN 0.45 – 3.00 por timbre. Algunos PAC cobran además una cuota anual de API | Por paquete |
| **SAT: descarga masiva y verificación de CFDI** | **Gratis** (requiere e.firma vigente) | — |
| QZ Tray | No se necesita | — |

## 3. Mantenimiento (tiempo, no servicios)

- Revisar cada mes que el respaldo externo se haya generado (el sistema lo avisa).
- Renovar a tiempo la **e.firma** (vigencia de 4 años) y el **CSD**; el sistema avisa antes de que venzan.
- Ajustes por cambios del SAT (Anexo 20, catálogos) y mejoras al sistema: los haría yo en sesiones de Claude Code o un desarrollador. El costo depende de tu suscripción o del desarrollador.
- Actualizaciones de Windows y Chrome en las cajas.

## 4. Costos únicos (no son de mantenimiento)

- Equipo de caja según la cotización de Ordenadores BXC (MXN 10,200 por caja).
- Sugeridos: **no‑break** en lugar del regulador, y licencia de Windows 11 si el equipo trae Windows 10.
