# Tu biblioteca en DealRift

Abre **Mi biblioteca** para guardar juegos, marcar los que posees y asignar prioridad, notas y un precio objetivo. Los favoritos se conservan aunque cambies la búsqueda o cierres la aplicación. Un título sin precio verificado puede guardarse y comprobarse después.

## Encontrar el menor precio entre países

En el selector de país, elige **Cualquier país · menor precio en USD**. Funciona en PC, PlayStation y Xbox: muestra el menor precio encontrado entre los países consultados, con USD como importe principal y el país y precio original debajo. Puedes seguir buscando por título y usar los filtros del radar. Al elegir un país concreto vuelves a la vista local.

La cobertura indica cuántos países respondieron y si faltan resultados. Las consultas de catálogo tienen límites; «menor precio encontrado» no garantiza que se haya consultado todo el mercado. La conversión a USD es aproximada y la tienda determina los requisitos de cuenta y compra de cada región.

Este modo conserva el último país concreto como **país base** para tus alertas y presupuesto. Guardar una oferta extranjera no la convierte en una oferta válida para ese país; **Comprobar favoritos** vuelve a consultar el precio del país base.

## Avisos de precio

Activa seguimiento en cada juego y configura un objetivo en su moneda o en USD. Sin objetivo, DealRift registra la primera oferta verificada y nuevas bajadas. Con objetivo, registra la primera coincidencia, una bajada adicional o un nuevo cruce por debajo del objetivo. Los juegos poseídos no generan avisos.

**Comprobar favoritos** actualiza hasta veinte juegos por pasada; las pasadas siguientes rotan por el resto de la lista. El seguimiento automático se realiza cada cinco minutos mientras la app está ejecutándose. En Windows, activa **Continuar en segundo plano** para ocultar la ventana en la bandeja al cerrarla; usa **Salir** en la bandeja para terminar la aplicación. El equipo debe permanecer encendido y conectado. En navegador, la pestaña debe permanecer abierta.

Activa los avisos del sistema y concede el permiso del navegador cuando corresponda. El registro de alertas funciona también sin permiso. El horario de silencio usa la zona horaria del equipo y admite atravesar medianoche; sus hallazgos quedan en el registro y no se entregan todos de golpe al terminar el silencio.

Sólo se usan ofertas recientes, vigentes, de bajo riesgo y del país seleccionado. Un cambio de país obliga a comprobar de nuevo los precios; no se presentan precios estadounidenses como precios locales. La pestaña general de señales explora la búsqueda actual; las notificaciones persistentes se configuran en la biblioteca.

## Importar y exportar

Se admiten hasta 500 juegos y archivos de hasta 2 MiB. Un CSV puede tener estas columnas:

```csv
title,steamAppId,owned,watched,priority,targetAmount,targetCurrency,notes
The Witcher 3: Wild Hunt,292030,false,true,1,10,USD,Esperar una oferta
Portal 2,620,true,false,2,,,Ya lo tengo
```

Sólo `title` es obligatorio. `owned` y `watched` aceptan `true`/`false`; prioridad 1 es la más alta. El importe usa punto decimal sin separadores de miles. JSON admite un array de títulos, un array de juegos o un objeto con `games`. La vista previa muestra los juegos antes de aplicar la importación; las ediciones con títulos diferentes permanecen separadas.

**Exportar copia** descarga el estado local en JSON. **Importar** permite combinar juegos o restaurar una copia completa tras marcar la confirmación. Restaurar sustituye biblioteca, ajustes y registro; vuelve a comprobar precios antes de tomar decisiones. Los precios de una copia se conservan como referencia sin verificar, nunca como ofertas nuevas.

La app portable guarda los archivos en `%APPDATA%\DealRift\data` mediante el directorio `userData` de Electron; no junto al `.exe`. En desarrollo se usa `data/`, o `DEALRIFT_DATA_DIR` si está definido. Si `library.json` se daña, DealRift informa del error y conserva el archivo: cierra la app, guarda una copia del archivo dañado y restaura tu última copia válida. No borres datos sin guardarlos primero.

La migración de preferencias antiguas sólo puede recuperar el `localStorage` accesible en el origen actual. Las versiones anteriores usaban puertos variables; sus preferencias de otros orígenes no se recuperan automáticamente.

## Historial, ediciones y presupuesto

La ficha muestra el mínimo que DealRift ha observado para ese juego y país. No equivale al mínimo histórico de todo el mercado. Al empezar puede haber uno o ningún punto; hace falta seguir recopilando observaciones.

El comparador permite seleccionar ediciones y consultar ofertas, fechas, país y enlaces. Si el proveedor no entrega información verificable de DLC o contenido incluido, se indica como desconocida. Revisa el contenido y la activación regional en la tienda antes de comprar.

El plan de compra toma favoritos no poseídos con ofertas verificadas, ordena por prioridad y después por precio, y respeta el presupuesto en la moneda elegida. Explica las exclusiones y no garantiza la combinación matemática óptima. No compra ni modifica cuentas de tiendas.

En **Preferencias**, el modo de bajo consumo desactiva el fondo animado y puedes ocultar juegos poseídos. El menú de actualizaciones abre las releases oficiales; todavía no hay actualización automática ni firma digital del ejecutable.


## Consoles

Select PC, PlayStation or Xbox in the radar, then watch an offer to save its exact platform and store product ID. The library shows the platform and console compatibility; the same title on another platform remains a separate license. All watched platforms are checked even when the radar displays only one.

Manual entries and CSV/JSON imports accept `ecosystem` (`pc`, `playstation`, `xbox`) and optional `storeProductId`. Old files without an ecosystem stay PC entries. For consoles, copy the product ID from an official store product URL to monitor an exact edition; `product:ID` also works in radar search. A manual title without an ID must match the full title within that ecosystem.

Use native price targets (for example COP for a Colombian Xbox price) or USD where a current conversion is available. PlayStation Colombia often quotes USD. The price and alert history remains separate by platform, official product and country. Console ownership does not imply ownership on PC or another console store.

Edition comparisons stay within the selected ecosystem. The purchase planner may include multiple platforms, but never substitutes a cheaper PC license for a watched Xbox or PlayStation product. Review the displayed console compatibility before purchasing.
