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
4. Marca cada destino como producto, búsqueda o redirect obligatorio del proveedor. CheapShark exige su redirect documentado; se valida estrictamente su host y dealID. Nunca presentes una búsqueda como URL exacta de producto.
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
- Rechaza URLs que no sean `https` o destinos fuera de la lista permitida. Conserva únicamente el redirect obligatorio de CheapShark validado por `storeLinks.ts`.
- Anade una fila a `sourceStatus` con cantidad cargada y motivo de fallo.

## Prioridades siguientes

1. Obtener un certificado de firma y diseñar actualizaciones verificadas antes de distribuir un actualizador automático. La beta portable sigue sin firma.
2. Ampliar adaptadores oficiales donde sus condiciones permitan este uso. Steam sigue siendo una muestra y una búsqueda acotada; no prometer cobertura completa.
3. Añadir metadatos verificables de DLC y contenido para mejorar el comparador manual de ediciones. No deducir equivalencia a partir del nombre.
4. Sincronización opcional de bibliotecas con consentimiento y credenciales seguras. La importación actual es manual mediante CSV/JSON, sin pedir contraseñas.
5. Evaluar SQLite cuando el historial observado requiera más volumen. Hoy las escrituras JSON se serializan y se sustituyen de forma atómica.
6. Ampliar el plan de compra más allá de prioridad/precio cuando haya evidencia de utilidad; el algoritmo actual no garantiza la combinación óptima.

## Funciones personales disponibles

`server/library.ts` conserva biblioteca, objetivos, preferencias y registro de avisos. `personalLibrary.ts` serializa acciones de la interfaz y adopta únicamente revisiones nuevas. La app Electron consulta favoritos cada cinco minutos y mantiene la bandeja sólo si el usuario activa segundo plano. Se consultan como máximo veinte juegos por pasada, con rotación y concurrencia de tres.

Las alertas, el plan y los mínimos históricos excluyen precios caducados, futuros, de otro país o sin verificar. Las búsquedas individuales guardan observaciones por juego sin sustituir el resumen general del radar. Véase [la guía de biblioteca](LIBRARY_GUIDE.md).

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
