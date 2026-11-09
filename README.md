# Buscador de alojamientos en Colombia

Extensión de Chrome (Manifest V3) que busca y compara alojamientos en **Booking**, **Airbnb** y **PriceTravel** para las principales ciudades de Colombia, en una sola búsqueda y con los resultados ordenados por precio por noche.

> ⚠️ **Aviso:** este proyecto es para el uso de la fundación virgen de manare. Funciona leyendo las páginas de resultados de sitios de terceros, por lo que puede dejar de funcionar si esos sitios cambian su estructura. Revisa y respeta los términos de uso de cada sitio.

## Características

- Búsqueda simultánea en Booking, Airbnb y PriceTravel (puedes elegir en cuáles).
- Selección de una o varias ciudades de una lista predefinida.
- **Búsqueda por localidad o zona** dentro de una ciudad (por ejemplo, Chapinero o Engativá en Bogotá). Se pueden escribir varias zonas separadas por coma y cada una se busca por separado.
- Filtro de **precio por noche** (mínimo y máximo, en COP).
- Filtro de **accesibilidad para movilidad reducida** (por ahora solo lo aplica Booking).
- Opción para descartar alojamientos cuya dirección no mencione la zona buscada.
- Barra de progreso, botón de cancelar y recuperación del estado si cierras el popup durante la búsqueda.
- Los resultados muestran alojamiento, ciudad y zona, fuente, precio por noche y puntuación.
- **Exportación a CSV** (compatible con Excel en configuración regional de Colombia/España).
- El formulario recuerda tus últimos valores.

## Ciudades disponibles

Bogotá, Medellín, Cali, Barranquilla, Cartagena, Bucaramanga, Santa Marta, Pereira, Manizales, Cúcuta, Armenia, Ibagué, Villavicencio, Pasto y San Andrés.

La lista es cerrada a propósito: PriceTravel usa códigos específicos para cada ciudad, así que solo se ofrecen las que ya están configuradas.

## Regla de ciudades y localidades

Las localidades solo se pueden buscar dentro de **una** ciudad (Chapinero no existe en Cali). Por eso el formulario se adapta solo:

- Si escribes una localidad, se desactivan las ciudades que no estén marcadas.
- Si marcas dos o más ciudades, se desactiva el campo de zona.
- Si borras la zona o dejas una sola ciudad, todo vuelve a habilitarse.

## Instalación

La extensión no está en la Chrome Web Store. Se instala en modo desarrollador:

1. Clona o descarga este repositorio.
2. Abre `chrome://extensions` en Chrome.
3. Activa el **Modo de desarrollador** (arriba a la derecha).
4. Pulsa **Cargar descomprimida** y selecciona la carpeta del proyecto (la que contiene `manifest.json`).
5. Fija la extensión en la barra del navegador y ábrela con su ícono.

## Uso

1. Elige en qué sitios buscar.
2. Marca las ciudades (o una sola ciudad y, si quieres, una o varias zonas).
3. Define el rango de precio, las fechas de entrada y salida, el número de adultos y los resultados por ciudad (entre 1 y 75).
4. Activa el filtro de movilidad reducida si lo necesitas.
5. Pulsa **Buscar alojamientos** y espera: la extensión abre pestañas en segundo plano, lee los resultados y las cierra.
6. Cuando termine, revisa la tabla o pulsa **Descargar CSV**.

Entre una búsqueda y otra hay pausas de unos segundos, a propósito, para evitar bloqueos de los sitios. Una búsqueda con muchas ciudades y fuentes puede tardar varios minutos.

## Estructura del proyecto

```
├── manifest.json          # Configuración de la extensión (Manifest V3)
├── assets/                # Ícono
├── background/
│   └── background.js      # Service worker: recorre ciudad × fuente y guarda el progreso
├── popup/                 # Interfaz (HTML, CSS y JS del formulario y la tabla)
├── sources/               # Una fuente por archivo: construye la URL de búsqueda de cada sitio
│   ├── registry.js
│   ├── booking.js
│   ├── airbnb.js
│   └── pricetravel.js
└── content/               # Content scripts que leen los resultados de cada sitio
    ├── common.js
    ├── booking.js
    ├── airbnb.js
    └── pricetravel.js
```

## Cómo funciona

1. El **popup** valida el formulario y envía los parámetros al service worker.
2. El **background** arma una tarea por cada combinación de ciudad, zona y fuente. Para cada una construye la URL (con `sources/`), abre una pestaña en segundo plano y pide al content script que extraiga los datos.
3. Los **content scripts** leen la página de resultados y devuelven los alojamientos.
4. El background guarda el progreso y los resultados en `chrome.storage.local`, y el popup se actualiza solo al leerlos de ahí.

## Añadir un sitio nuevo

1. Crea `sources/<sitio>.js` y regístralo en `SOURCES` (ver el comentario de `sources/registry.js`).
2. Crea `content/<sitio>.js` con la lógica de lectura de resultados.
3. Regístralos en `manifest.json` (permisos y content scripts), en `background/background.js` (`importScripts`) y en `popup/popup.html`.
4. Si el sitio tiene enlaces de resultados, agrega su dominio a `ALLOWED_LINK_DOMAINS` en `popup/popup.js`.

## Permisos

- `storage`: guardar el formulario y el estado de la búsqueda.
- Acceso a `booking.com`, `airbnb.com`, `airbnb.com.co` y `pricetravel.com`: abrir las páginas de resultados y leerlas.

La extensión no envía datos a ningún servidor propio: todo se queda en tu navegador.

## Limitaciones conocidas

- El filtro de movilidad reducida solo lo aplica Booking.
- Booking y Airbnb puntúan en escalas distintas (10 y 5); la tabla muestra la escala cuando no es sobre 10.
- Si un sitio cambia su HTML, el content script correspondiente puede necesitar ajustes.

## Licencia

Pendiente de definir.
