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

## Traslado a la estructura definitiva

Antes de cargar datos reales (ver `docs/fase-0/02-diseno-propuesto.md`, sección 1.2): repositorio y proyecto en las cuentas del negocio, **llaves nuevas**, base nueva construida con las migraciones, desactivar deploy previews en producción, `PERMITIR_DATOS_PRUEBA` sin definir, y carga de datos reales por layout.
