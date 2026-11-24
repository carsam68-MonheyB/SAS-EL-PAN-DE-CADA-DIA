# Reglas de trabajo · SAS El Pan de Cada Día

## Ramas y publicación (OBLIGATORIO)

1. Cada push a la rama `main` publica a producción en Netlify y cuesta créditos. **NUNCA** hagas push ni merge a `main` a menos que la usuaria diga exactamente **"publica a producción"**.
2. Todos los cambios y commits se hacen en la rama `pruebas` (créala desde la rama de trabajo si no existe).
3. Antes de subir cualquier cambio, pruébalo primero en local y da la dirección `localhost` para revisarlo.
4. Agrupa varios cambios antes de hacer push a `pruebas`; no hagas un push por cada ajuste pequeño.
5. Al subir a `pruebas`, da la liga de la versión de prueba: https://pruebas--sas-el-pan-de-cada-dia.netlify.app
6. Cuando la usuaria diga "publica a producción", haz merge de `pruebas` a `main` y push. Solo en ese momento.
