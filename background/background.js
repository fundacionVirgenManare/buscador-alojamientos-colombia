// ============================================================================
// background/background.js  (Service Worker de Manifest V3)
// ----------------------------------------------------------------------------
// ¿Por qué existe este archivo?
//   El popup se DESTRUYE en cuanto el usuario hace clic fuera de él, así que no
//   puede quedarse esperando a que termine una búsqueda de varias ciudades.
//   El service worker sí sigue vivo, así que él se encarga de:
//     1. Recibir los parámetros desde el popup.
//     2. Recorrer cada combinación ciudad × fuente (Booking, Airbnb...).
//     3. Construir la URL de cada fuente (sources/*.js), abrir una pestaña en
//        segundo plano, pedirle al content script que haga el scraping y
//        cerrarla.
//     4. Guardar el progreso y los resultados en chrome.storage.local
//        (el popup los lee de ahí y se actualiza solo).
//
// Cómo se añade un sitio nuevo: ver el comentario de sources/registry.js.
// ============================================================================

// Registro de fuentes: define el objeto global SOURCES (Booking, Airbnb...).
importScripts(
  "../sources/registry.js",
  "../sources/booking.js",
  "../sources/airbnb.js",
  "../sources/pricetravel.js",
);

// ---------- Configuración ---------------------------------------------------
const PAUSE_BETWEEN_SEARCHES_MS = 4000; // pausa "humana" entre búsquedas (evita bloqueos)
const PAUSE_BETWEEN_PAGES_MS = 2500; // pausa entre páginas de una misma búsqueda
const PAGE_LOAD_TIMEOUT_MS = 45000; // máximo esperando a que cargue la pestaña
const CONTENT_RETRIES = 6; // veces que reintentamos hablar con el content script

// ---------- Estado en memoria -----------------------------------------------
let isRunning = false; // evita lanzar dos búsquedas a la vez
let isCancelled = false; // el popup puede pedir cancelar

// ---------- Mensajes que llegan del popup -----------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "START_SEARCH") {
    if (isRunning) {
      sendResponse({ ok: false, error: "Ya hay una búsqueda en curso." });
    } else {
      runSearch(msg.params); // sin await: corre en segundo plano
      sendResponse({ ok: true });
    }
  }

  if (msg.type === "CANCEL_SEARCH") {
    isCancelled = true;
    sendResponse({ ok: true });
  }
  // No devolvemos true: respondemos de forma síncrona.
});

// ---------- Flujo principal -------------------------------------------------
async function runSearch(params) {
  isRunning = true;
  isCancelled = false;

  // Una "tarea" = una ciudad + una zona + una fuente. Ej.: Chapinero (Bogotá)
  // en Booking. Sin zonas, la zona es null y se busca en toda la ciudad.
  const sources = params.sources.map((id) => SOURCES[id]).filter(Boolean);
  const zones = params.zones?.length ? params.zones : [null];
  const tasks = [];
  for (const city of params.cities) {
    for (const zone of zones) {
      for (const source of sources) tasks.push({ city, zone, source });
    }
  }

  // Un alojamiento puede salir en dos zonas vecinas: lo guardamos una sola vez.
  const seenListings = new Set();

  // Este objeto es lo que el popup dibuja. Se guarda completo en cada avance.
  const state = {
    status: "running", // running | done | cancelled
    total: tasks.length,
    done: 0,
    current: "",
    results: [],
    errors: [],
  };
  await saveState(state);

  // Un service worker MV3 se apaga tras ~30 s sin actividad. Llamar a una API
  // de Chrome cada 20 s lo mantiene despierto mientras dura la búsqueda.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);

  try {
    for (let i = 0; i < tasks.length; i++) {
      if (isCancelled) break;

      const { city, zone, source } = tasks[i];
      // Etiqueta para mensajes: "Chapinero, Bogotá · Booking".
      const place = zone ? `${zone}, ${city}` : city;
      const label = `${place} · ${source.name}`;
      state.current = label;
      await saveState(state);

      try {
        const reducedMobilityApplied =
          params.reducedMobility && source.supportsReducedMobility;
        if (params.reducedMobility && !source.supportsReducedMobility) {
          state.errors.push(
            `${label}: este sitio aún no tiene filtro de movilidad reducida; se ignoró.`,
          );
        }

        // Los parámetros de esta tarea: los generales + la zona que toca ahora.
        const strictZone = Boolean(zone) && params.strictZone;
        const taskParams = { ...params, zone, strictZone };
        let found = await scrapeSource(source, city, taskParams);

        // Fuentes que no reciben el precio en la URL: lo aplicamos aquí. Los que
        // no tienen precio se conservan (no se pueden comparar).
        if (source.priceInUrl === false && (params.minPrice != null || params.maxPrice != null)) {
          found = found.filter(
            (item) =>
              item.pricePerNight == null ||
              ((params.minPrice == null || item.pricePerNight >= params.minPrice) &&
                (params.maxPrice == null || item.pricePerNight <= params.maxPrice)),
          );
        }

        // Quitamos los que ya salieron en otra zona de la misma búsqueda.
        const items = found.filter((item) => {
          const key = `${source.id}|${item.url || item.name + "|" + item.address}`;
          if (seenListings.has(key)) return false;
          seenListings.add(key);
          return true;
        });

        // Añadimos a cada fila la ciudad, la zona, la fuente y si se filtró por accesibilidad.
        for (const item of items) {
          state.results.push({
            city,
            zone,
            source: source.id,
            sourceName: source.name,
            reducedMobility: reducedMobilityApplied,
            ...item,
          });
        }
        if (items.length === 0) {
          state.errors.push(`${label}: sin resultados con esos filtros.`);
        }

        // Aviso (no es un error): si la página no dejó coordenadas en la tarjeta,
        // el enlace de Maps se arma con nombre + zona y es solo aproximado.
        const withoutCoords = items.filter((item) => !item.coordinates).length;
        if (withoutCoords > 0) {
          state.errors.push(
            `${label}: ${withoutCoords} de ${items.length} alojamientos sin coordenadas (enlace de Maps aproximado).`,
          );
        }

        // Si el sitio mostró precios en otra moneda, el precio no es COP: avisamos.
        const otherCurrency = [...new Set(items.map((i) => i.currency).filter((c) => c && c !== "COP"))];
        if (otherCurrency.length > 0) {
          state.errors.push(
            `${label}: los precios vienen en ${otherCurrency.join("/")}, no en COP; el rango de precio y la columna COP no son fiables.`,
          );
        }

        // Con filtro estricto de zona, las tarjetas sin dirección en texto no
        // se pueden verificar: se conservan, pero avisamos.
        if (zone && strictZone) {
          const unverified = items.filter((item) => !item.address).length;
          if (unverified > 0) {
            state.errors.push(
              `${label}: ${unverified} de ${items.length} alojamientos sin dirección en texto; no se pudo comprobar que estén en la zona.`,
            );
          }
        }
      } catch (err) {
        // Un fallo en una búsqueda no debe tumbar todas las demás.
        state.errors.push(`${label}: ${err.message}`);
      }

      state.done++;
      await saveState(state);

      if (i < tasks.length - 1 && !isCancelled) {
        await sleep(PAUSE_BETWEEN_SEARCHES_MS);
      }
    }
    state.status = isCancelled ? "cancelled" : "done";
  } finally {
    clearInterval(keepAlive);
    isRunning = false;
    state.current = "";
    await saveState(state);
  }
}

// ---------- Una ciudad en una fuente (con paginación opcional) --------------
// Si la fuente no pagina (pageSize null, como Booking) es una sola URL. Si pagina
// (Airbnb), pedimos páginas sucesivas hasta reunir `maxResults` o hasta que una
// página venga incompleta (no hay más).
async function scrapeSource(source, city, params) {
  const maxPages = source.pageSize ? Math.ceil(params.maxResults / source.pageSize) : 1;
  const collected = [];
  const seen = new Set();

  for (let page = 0; page < maxPages; page++) {
    if (isCancelled) break;

    const url = source.buildSearchUrl(city, params, page);
    const { items, scanned } = await scrapeUrl(url, params);

    for (const item of items) {
      const key = item.url || `${item.name}|${item.address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(item);
    }

    const noMorePages = !source.pageSize || scanned < source.pageSize;
    if (noMorePages || collected.length >= params.maxResults) break;
    await sleep(PAUSE_BETWEEN_PAGES_MS);
  }

  return collected.slice(0, params.maxResults);
}

// ---------- Abrir pestaña -> scrapear -> cerrar -----------------------------
async function scrapeUrl(url, params) {
  // active:false => la pestaña se abre en segundo plano, sin robar el foco.
  const tab = await withTabRetry(() => chrome.tabs.create({ url, active: false }));
  try {
    await waitForTabLoad(tab.id);
    return await requestScrape(tab.id, {
      type: "SCRAPE",
      maxResults: params.maxResults,
      nights: params.nights,
      zone: params.strictZone ? params.zone : null, // filtro por TEXTO (solo si es estricto)
      zoneName: params.zone || null, // la zona pedida, siempre (PriceTravel la elige con su filtro)
    });
  } finally {
    // Cerramos siempre, incluso con error (con reintentos: ver withTabRetry).
    withTabRetry(() => chrome.tabs.remove(tab.id)).catch(() => {});
  }
}

// Espera a que la pestaña llegue a status === "complete".
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("La página tardó demasiado en cargar."));
    }, PAGE_LOAD_TIMEOUT_MS);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);

    // Por si la pestaña ya terminó de cargar antes de registrar el listener.
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete") listener(tabId, { status: "complete" });
    });
  });
}

// Le enviamos el mensaje al content script. Puede que aún no esté listo, así
// que reintentamos unas cuantas veces antes de rendirnos.
// Devuelve { items, scanned }.
async function requestScrape(tabId, message) {
  for (let i = 0; i < CONTENT_RETRIES; i++) {
    let response;
    try {
      response = await chrome.tabs.sendMessage(tabId, message);
    } catch {
      // "Receiving end does not exist": el content script aún no está listo.
      await sleep(1500);
      continue;
    }
    // Si el content script SÍ respondió, no reintentamos (ya hizo su trabajo).
    if (response?.ok) return { items: response.items, scanned: response.scanned };
    throw new Error(response?.error || "Respuesta vacía del content script.");
  }
  // Diagnóstico: ¿en qué página quedó la pestaña? (si Chrome no deja ver la URL,
  // casi seguro redirigió a un dominio sin permiso en manifest.json).
  let where = "no se pudo leer la URL: quizá redirigió a otro dominio";
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) where = `página: ${tab.url.split("?")[0]}`;
  } catch {
    /* la pestaña ya no existe */
  }
  throw new Error(
    `El content script no respondió (${where}). Posibles causas: captcha, redirección, o la extensión no se recargó tras cambiar manifest.json.`,
  );
}

// ---------- Utilidades ------------------------------------------------------
// Chrome rechaza crear/cerrar pestañas mientras el usuario hace clic o arrastra
// en la barra de pestañas ("Tabs cannot be edited right now (user may be
// dragging a tab)"). Es momentáneo, así que reintentamos unas veces.
async function withTabRetry(action, attempts = 6) {
  for (let i = 1; ; i++) {
    try {
      return await action();
    } catch (err) {
      const busy = /cannot be edited|dragging a tab/i.test(err?.message || "");
      if (!busy || i >= attempts) throw err;
      await sleep(500 * i); // 0,5 s, 1 s, 1,5 s...
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const saveState = (state) => chrome.storage.local.set({ searchState: state });
