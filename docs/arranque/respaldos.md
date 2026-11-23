# Respaldos externos: cómo configurarlos (P06)

El sistema guarda cada mes (día 1) y al cerrar cada mes contable una copia **cifrada** de toda la base de datos fuera de Netlify. También copia los XML de las facturas emitidas y recibidas, ordenados por RFC, año y mes. Las copias quedan con **bloqueo de objetos (Object Lock, modo COMPLIANCE)**: nadie, ni el sistema ni el dueño de la cuenta, puede borrarlas antes del plazo (5 años por omisión: `respaldo.anios_conservacion`, confírmalo con tu contador).

## 1. Elige el almacenamiento (pendiente P06)

Sirve cualquiera compatible con S3 que tenga **Object Lock**:

| Opción | Comentario |
|---|---|
| **Backblaze B2** (recomendado) | Barato, compatible con S3 y con Object Lock. Los primeros 10 GB son gratis. |
| Amazon S3 | El estándar; un poco más caro y más complejo de configurar. |
| Wasabi | Sin cobro por descarga; cobra un mínimo mensual. |

## 2. Crea la cubeta (ejemplo con Backblaze B2)

1. Crea la cuenta del negocio en backblaze.com (no una personal).
2. **Buckets → Create a Bucket:** nombre (ej. `pan-de-cada-dia-respaldos`), **Private**, y activa **Object Lock**. El Object Lock solo se puede activar al crear la cubeta.
3. **Application Keys → Add a New Application Key:** solo para esa cubeta, con permiso **Read and Write**. Sin permiso de borrar (*deleteFiles*). Anota el *keyID* y la *applicationKey* (se muestra una sola vez).
4. Anota el **endpoint** de la cubeta (ej. `https://s3.us-west-004.backblazeb2.com`) y la región (la parte `us-west-004`).

## 3. Variables en Netlify (Project configuration → Environment variables, a nivel del proyecto)

| Variable | Valor |
|---|---|
| `RESPALDO_LLAVE` | Llave de cifrado de 32 bytes en base64, **distinta de `LLAVE_MAESTRA`**. Genérala igual que la llave maestra (README). |
| `RESPALDO_S3_ENDPOINT` | Ej. `https://s3.us-west-004.backblazeb2.com` |
| `RESPALDO_S3_REGION` | Ej. `us-west-004` |
| `RESPALDO_S3_BUCKET` | Nombre de la cubeta |
| `RESPALDO_S3_LLAVE_ID` | keyID |
| `RESPALDO_S3_LLAVE_SECRETA` | applicationKey |

> ⚠️ **Guarda `RESPALDO_LLAVE` también FUERA de Netlify** (por ejemplo, en el administrador de contraseñas del negocio y en un sobre cerrado). Sin ella los respaldos no se pueden abrir. Si se pierde, los respaldos anteriores quedan inservibles.

## 4. Prueba

1. Entra como administrador → **Arranque y respaldos → Respaldos → Respaldar ahora**.
2. Debe decir "Respaldo completo" con su tamaño y fecha de conservación. En la cubeta aparecen `respaldos/AAAA/MM/...erpresp` y `cfdi/{RFC}/...`.
3. Si sale error, la pantalla muestra la razón que dio el almacenamiento (llave mal copiada, cubeta sin Object Lock, etc.).

## 5. Mientras no haya almacenamiento externo

El administrador puede usar **Descargar respaldo cifrado** y guardar el archivo en un lugar seguro (por ejemplo, el OneDrive del negocio). Queda registrado quién lo descargó. El archivo solo se abre con `RESPALDO_LLAVE`.

## Cómo funciona

- Un proceso programado corre **una vez al día a las 6:15** (hora del centro de México), cuando la base ya está despierta por la producción. El día 1 hace el respaldo mensual; además procesa los respaldos de los cierres contables y reintenta los que fallaron en la última semana.
- Netlify, además, guarda sus propios respaldos diarios por un plazo corto (según el plan).
- El sistema no tiene ninguna función que borre respaldos.
