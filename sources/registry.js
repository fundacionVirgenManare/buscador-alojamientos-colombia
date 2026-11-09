// ============================================================================
// sources/registry.js
// ----------------------------------------------------------------------------
// Registro de FUENTES (sitios donde se busca). Lo cargan el popup (para dibujar
// las casillas) y el background (para construir las URLs).
//
// Cada fuente vive en su propio archivo (sources/booking.js, sources/airbnb.js)
// y se registra así:
//
//   SOURCES.miSitio = {
//     id: "miSitio",                 // identificador interno (igual que la clave)
//     name: "Mi Sitio",              // nombre visible
//     defaultChecked: false,         // ¿viene marcada la primera vez?
//     supportsReducedMobility: true, // ¿sabe aplicar el filtro de accesibilidad?
//     pageSize: null,                // null = una sola URL; número = resultados por
//                                    // página (el background pide varias páginas)
//     buildSearchUrl(city, params, page) { return "https://..."; },
//   };
//
// Para AÑADIR un sitio nuevo: crea sources/<sitio>.js, content/<sitio>.js,
// y regístralos en manifest.json, background.js (importScripts) y popup.html.
// ============================================================================
globalThis.SOURCES = globalThis.SOURCES || {};
