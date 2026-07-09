# Flujo para continuar DealRift

Este documento propone un ciclo corto y repetible para ampliar el radar sin perder calidad de datos ni volver a saturar la interfaz.

## Flujo del sistema

```text
Fuente externa
  -> adaptador de la fuente
  -> modelo comun Deal
  -> politica de enlaces (directo o busqueda declarada)
  -> deduplicacion, riesgo e inteligencia explicable
  -> cache con respaldo
  -> API local
  -> filtros, comparacion, alertas y exportacion
  -> aplicacion portable de Windows
```

## Ciclo recomendado para cada mejora

1. Escribe el caso de uso en una frase y define que dato necesita el usuario para actuar.
2. Decide si el cambio pertenece a `server/`, `src/`, `electron/` o a mas de una capa.
3. Si agregas una fuente, crea un adaptador que produzca objetos `Deal`; no mezcles el formato externo con la interfaz.
4. Marca cada destino como enlace directo o busqueda de tienda. Nunca presentes una busqueda como URL exacta de producto.
5. Deduplica por tienda y juego, normaliza moneda a USD y calcula veredicto, confianza, historial y posicion de mercado antes de responder desde la API.
6. Muestra lo esencial en la lista; coloca notas, fechas y metadatos dentro de detalles desplegables o vistas secundarias.
7. Agrega textos en espanol e ingles al mismo tiempo.
8. Ejecuta `npm run check`.
9. Prueba busqueda, filtros, paginacion, enlace, vigilancia, alerta y comparacion regional en escritorio y movil.
10. Sube la version, documenta el cambio y genera el ejecutable portable.

## Como agregar una fuente

Una fuente nueva debe entregar como minimo: titulo, tienda, precio actual, moneda, ahorro, URL, paises, riesgo, confianza y fecha de deteccion. Si no existe una API publica estable, agregala como ruta de exploracion y usa `confidence: "search-link"`; no inventes precios ni disponibilidad.

Antes de habilitarla:

- Comprueba limites de uso, atribucion y condiciones de la API.
- Usa tiempo limite, reintento y cache.
- Conserva los datos cacheados si la fuente cae temporalmente.
- Rechaza URLs que no sean `https` o que apunten a intermediarios conocidos.
- Anade una fila a `sourceStatus` con cantidad cargada y motivo de fallo.

## Prioridades siguientes

1. Ampliar las pruebas automatizadas a normalizacion completa de adaptadores, deduplicacion y estados de red degradada.
2. Migrar el historial JSON por juego a SQLite cuando se necesiten tendencias extensas de 7/30/90 dias.
3. Comparador de un mismo juego entre tiendas, ediciones y regiones.
4. Servicio de alertas en segundo plano aun con la ventana cerrada, con horario silencioso.
5. Validacion periodica de enlaces y retirada automatica de promociones vencidas.
6. Fuentes oficiales adicionales con API o feed permitido.
7. Firma del ejecutable, instalador opcional y actualizaciones automaticas.

## Definicion de terminado

Una mejora esta lista cuando compila, no rompe ES/EN, funciona con datos vacios y errores de red, conserva preferencias, no agrega informacion innecesaria a la vista principal y deja claro el origen, pais, riesgo, moneda y tipo de enlace de cada oferta.

## Comandos diarios

```powershell
npm install
npm run dev
npm run check
npm run dist:win
```

Durante desarrollo, abre `http://localhost:5173`. La API local usa `http://localhost:5174` y su diagnostico esta en `/api/health`.
