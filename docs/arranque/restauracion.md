# Restaurar un respaldo

Se restaura siempre en una base **nueva**: nunca encima de la base en uso. Así se puede revisar antes de decidir.

## Qué necesitas

- El archivo `.erpresp` (de la cubeta de respaldos o de una descarga cifrada).
- La llave `RESPALDO_LLAVE` con que se hizo.
- Una computadora con Node.js 22 y una copia del repositorio **en la misma versión** que generó el respaldo (la pantalla de respaldos y el archivo indican la última migración).
- Una base de datos Postgres vacía: una base local, una rama nueva de Netlify Database o un proyecto nuevo.

## Pasos

1. En la carpeta del repositorio: `npm install`.
2. Ejecuta (en PowerShell, cambia los valores):

   ```
   $env:RESPALDO_LLAVE = "la-llave-en-base64"
   node scripts/restaurar-respaldo.mjs C:\respaldos\erp-mensual-2026-12-01.erpresp "postgres://usuario:clave@servidor:5432/base_nueva"
   ```

3. El guion:
   - aplica las migraciones a la base vacía;
   - descifra el archivo (si la llave no es la correcta, se detiene);
   - copia todas las tablas, regresa los consecutivos (folios) y vuelve a crear los candados (no se puede modificar el kárdex, las pólizas, la bitácora…) y las relaciones entre tablas, que validan que los datos estén completos;
   - todo en una sola transacción: si algo falla, la base queda como estaba.
4. Al final dice cuántas tablas y registros restauró.

## Para usar la base restaurada

- En Netlify, apunta el proyecto a la base restaurada (o crea un proyecto nuevo con ella) y verifica: inicia sesión, revisa el **Tablero**, la **Balanza** y la **Revisión de arranque**.
- Las sesiones no se respaldan: todos vuelven a iniciar sesión.

## Prueba de restauración (requisito antes de producción)

La prueba automática `pruebas/respaldo.test.ts` restaura un respaldo completo en otra base y comprueba que **todas las tablas quedan idénticas** y que los candados regresan. Antes de salir a producción haz además una prueba real con un respaldo descargado del almacenamiento externo, en una base de prueba, y anota la fecha y el resultado en la tabla de abajo.

| Fecha | Archivo | Quién | Resultado |
|---|---|---|---|
|  |  |  |  |
