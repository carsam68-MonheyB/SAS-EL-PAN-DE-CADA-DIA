# Archivos de ejemplo de la Fase 1B (DATOS FICTICIOS)

Todo lo que hay aquí es **inventado** para probar las cargas: las claves empiezan con `PRUEBA-` y los nombres con "PRUEBA". **No son datos del negocio.** Las tasas, precios y costos no son reales. Las descripciones del SAT también hay que verificarlas contra el catálogo oficial.

## Orden de carga

Cárgalos en este orden desde **Cargas masivas**. El número del archivo es el orden; cada catálogo usa claves de los anteriores.

| Archivo | Catálogo | Modo | Puesto de prueba que lo sube |
|---|---|---|---|
| `01-sat.txt` | Catálogos del SAT | Alta | `prueba.cnt` (contador) |
| `02-unidades.txt` | Unidades de medida | Alta | `prueba.com` (compras) |
| `03-conversiones.txt` | Conversiones de unidades | Alta | `prueba.com` |
| `04-familias.txt` | Familias | Alta | `prueba.com` |
| `09-tasas.txt` | Tasas de impuesto | Alta | `prueba.cnt` |
| `10-proveedores.txt` | Proveedores | Alta | `prueba.com` |
| `12-insumos.txt` o `12-insumos.xlsx` | Materias primas, insumos y empaques | Alta | `prueba.com` |
| `13-intermedios.txt` | Masas e intermedios | Alta | `prueba.jpr` (jefe de producción) |
| `14-productos.txt` o `14-productos.xlsx` | Productos terminados (SKU) | Alta | `prueba.jpr` |
| `15-unidades-por-articulo.txt` | Unidades por artículo | Alta | `prueba.com` |
| `17-precios.txt` | Precios de venta | Alta | `prueba.con` sube; **`prueba.dir` autoriza** |

## Qué esperar

- Al cargar insumos aparecen **avisos** (no errores) de que falta la conversión de BULTO o CAJA a KG. Desaparecen después de cargar `15-unidades-por-articulo.txt`.
- La "PRUEBA Telera" queda con aviso de **datos fiscales incompletos**: así se ve un producto al que el contador todavía no le pone sus claves.
- Los precios quedan **pendientes de autorización** hasta que `prueba.dir` los autoriza.

## Archivo con errores a propósito

`99-insumos-CON-ERRORES.txt` trae 1 renglón bueno y 7 con errores:
- unidad inexistente;
- decimal con coma;
- mínimo mayor que el máximo;
- clave repetida;
- tipo inválido;
- nombre vacío con costo negativo;
- familia de pan usada en un insumo.

Al validarlo:
- **no se guarda nada**, ni siquiera el renglón bueno;
- el reporte de errores se descarga con la columna ERROR, para corregir y volver a subir.
