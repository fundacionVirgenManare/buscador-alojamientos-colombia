// ============================================================================
// content/common.js
// ----------------------------------------------------------------------------
// Utilidades que comparten TODOS los scrapers (Booking, Airbnb...). Se carga
// siempre ANTES del script específico de cada sitio (ver manifest.json) y, al
// estar en el mismo "mundo aislado", sus funciones quedan disponibles para él.
//
// Lo específico de cada sitio (selectores, paginación, cómo leer una tarjeta)
// vive en content/booking.js, content/airbnb.js, etc.
// ============================================================================

// ---------- Registro del scraper --------------------------------------------
// Cada script de sitio llama a registerScraper(fn). `fn` recibe el mensaje
// { maxResults, nights, zone } y devuelve:
//   - un array de items, o
//   - { items, scanned }  (scanned = tarjetas revisadas ANTES del filtro de zona;
//     el background lo usa para saber si hay más páginas que pedir).
function registerScraper(scrapeFn) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "SCRAPE") return; // ignoramos mensajes que no son para nosotros

    // Función async + sendResponse: hay que devolver `true` para que Chrome
    // mantenga abierto el canal hasta que llamemos a sendResponse.
    Promise.resolve(scrapeFn(msg))
      .then((result) => {
        const items = Array.isArray(result) ? result : result.items;
        const scanned = Array.isArray(result) ? items.length : result.scanned;
        sendResponse({ ok: true, items, scanned });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));

    return true;
  });
}

// ---------- Ubicación: coordenadas y enlace a Google Maps -------------------
// En las tarjetas las coordenadas pueden estar en distintos sitios según la
// versión de la página (un atributo, la URL de la imagen de un mapa, un estilo
// inline...). En vez de depender de UN selector, revisamos TODOS los atributos
// de la tarjeta buscando un par de números que parezca una coordenada.
//
// Para no confundir una coordenada con cualquier otro par de decimales, solo
// aceptamos pares que caigan dentro de Colombia (incluye San Andrés y Leticia).
// Esto también permite detectar si vienen invertidos (lng, lat) y corregirlos.
const COLOMBIA = { latMin: -5, latMax: 14, lngMin: -82, lngMax: -66 };

const isLat = (n) => n >= COLOMBIA.latMin && n <= COLOMBIA.latMax;
const isLng = (n) => n >= COLOMBIA.lngMin && n <= COLOMBIA.lngMax;

// Busca un par "lat, lng" dentro de un texto cualquiera:
//   "4.653400,-74.072100"  |  "center=4.6534%2C-74.0721"  |  "lat=4.65&lng=-74.07"
function findCoordsInString(raw) {
  if (!raw || raw.length > 2000) return null;

  let s = raw;
  try {
    s = decodeURIComponent(raw); // %2C -> ","
  } catch {
    /* si no se puede decodificar, usamos el texto tal cual */
  }

  const re = /(-?\d{1,3}\.\d{2,})\D{1,15}?(-?\d{1,3}\.\d{2,})/g;
  let m;
  while ((m = re.exec(s))) {
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    if (isLat(a) && isLng(b)) return { lat: a, lng: b };
    if (isLng(a) && isLat(b)) return { lat: b, lng: a }; // venían invertidos
    re.lastIndex = m.index + 1; // par inválido: seguimos buscando más adelante
  }
  return null;
}

// Devuelve { lat, lng } o null. Primero el atributo conocido (si el sitio
// tiene uno: `knownSelector` + `knownAttr`), luego un barrido de la tarjeta.
function findCoordinates(card, knownSelector = null, knownAttr = null) {
  if (knownSelector && knownAttr) {
    const known = card.querySelector(knownSelector)?.getAttribute(knownAttr);
    const fromKnown = findCoordsInString(known);
    if (fromKnown) return fromKnown;
  }

  for (const el of [card, ...card.querySelectorAll("*")]) {
    for (const attr of el.attributes) {
      if (attr.name === "class") continue;
      const found = findCoordsInString(attr.value);
      if (found) return found;
    }
  }
  return null;
}

// Lugar que se está buscando, leído de la URL ("Chapinero, Bogotá, Colombia").
// Booking lo manda en `ss`; Airbnb en `query`. Sirve para desambiguar el enlace
// de Maps cuando no hay coordenadas.
function searchedPlace() {
  const params = new URLSearchParams(location.search);
  return params.get("ss") || params.get("query") || "";
}

// Con coordenadas: enlace exacto. Sin coordenadas: búsqueda por nombre + zona
// (aproximado, pero mucho mejor que dejar la celda vacía).
function buildMapsUrl(coords, name, addressText) {
  const base = "https://www.google.com/maps/search/?api=1&query=";
  if (coords) return `${base}${coords.lat},${coords.lng}`;

  const query = [name, addressText, searchedPlace()].filter(Boolean).join(", ");
  return query ? base + encodeURIComponent(query) : null;
}

// ---------- Filtro por zona -------------------------------------------------
// Minúsculas y sin tildes: "Usaquén" == "usaquen".
const normalize = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// Sin zona -> todo pasa. Con zona -> la dirección de la tarjeta debe mencionarla.
// Si la tarjeta no trae dirección en texto no podemos descartarla: se conserva
// (el background avisa de cuántas quedaron sin verificar).
function matchesZone(item, zone) {
  if (!zone) return true;
  if (!item.address) return true;
  return normalize(item.address).includes(normalize(zone));
}

// ---------- Parsers ---------------------------------------------------------
// Convierte un texto numérico "320.000" / "320,000" en 320000. Al forzar moneda
// COP no hay decimales, así que podemos quitar puntos y comas sin problema.
function parseCop(numberText) {
  const clean = String(numberText).replace(/[.,]/g, "");
  return parseInt(clean, 10) || null;
}

// "COP 400.000 COP 320.000"  ->  320000
// Si hay precio tachado + precio con descuento, nos quedamos con el ÚLTIMO
// número (el que realmente se paga).
function parsePrice(text) {
  if (!text) return null;
  const numbers = text.match(/\d[\d.,]*/g);
  if (!numbers) return null;
  return parseCop(numbers[numbers.length - 1]);
}

// Precio a partir del TEXTO de una tarjeta ("$ 180.000 COP noche", "COP 360.000
// total"...). Sirve para sitios sin un elemento de precio fiable (Airbnb,
// PriceTravel). Heurística:
//   - si el texto dice "por noche", usamos el importe más cercano a esa frase;
//   - si no, el último importe (el vigente, si hay uno tachado antes);
//   - si dice "total" y no "por noche", lo tratamos como total de la estancia.
// Devuelve { totalPrice, pricePerNight }.
function parseCardPrice(cardText, nights) {
  const none = { totalPrice: null, pricePerNight: null };
  const amounts = [
    ...cardText.matchAll(/(?:\$|COP|MXN|USD)\s*(\d[\d.,]*)|(\d[\d.,]*)\s*(?:COP|MXN|USD)\b/g),
  ].map((m) => ({
    value: parseCop(m[1] || m[2]),
    index: m.index,
  }));
  const valid = amounts.filter((a) => a.value);
  if (valid.length === 0) return none;

  const perNightMarker = /(?:por|\/|x)\s*noche\b/i.exec(cardText);
  let chosen = valid[valid.length - 1];
  if (perNightMarker) {
    chosen = valid.reduce((best, a) =>
      Math.abs(a.index - perNightMarker.index) < Math.abs(best.index - perNightMarker.index) ? a : best,
    );
  }

  const isTotal = /\btotal\b/i.test(cardText) && !perNightMarker;
  return isTotal
    ? { totalPrice: chosen.value, pricePerNight: nights ? Math.round(chosen.value / nights) : null }
    : { totalPrice: nights ? chosen.value * nights : null, pricePerNight: chosen.value };
}

// ---------- Utilidades de espera / DOM -------------------------------------
function waitForSelector(selector, timeoutMs) {
  return waitForCondition(() => document.querySelector(selector), timeoutMs);
}

// Revisa una condición cada 400 ms hasta que se cumpla o se acabe el tiempo.
function waitForCondition(condition, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 400);
  });
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
