// ============================================================================
// content/booking.js
// ----------------------------------------------------------------------------
// Scraper de Booking. Se inyecta en https://www.booking.com/searchresults*
// (ver "content_scripts" en manifest.json), DESPUÉS de content/common.js.
// Espera la orden "SCRAPE" del background, extrae las tarjetas y devuelve un
// array. Las utilidades compartidas (coordenadas, zona, parsers) están en
// common.js.
// ============================================================================

// ---------- Selectores CSS --------------------------------------------------
// Booking cambia su HTML de vez en cuando. Si un día el scraper devuelve campos
// vacíos, este es el ÚNICO bloque que hay que revisar (inspecciona la página
// con F12 y actualiza los data-testid).
const SEL = {
  card: '[data-testid="property-card"]',
  title: '[data-testid="title"]',
  link: 'a[data-testid="title-link"]',
  address: '[data-testid="address"]',
  addressLink: '[data-testid="address-link"]',
  mapCoords: "[data-atlas-latlng]",
  price: '[data-testid="price-and-discounted-price"]',
  review: '[data-testid="review-score"]',
};

// Tope de tarjetas que revisamos buscando coincidencias de zona (evita pulsar
// "Cargar más" sin fin cuando casi ningún resultado pertenece a la zona).
const MAX_CARDS_SCANNED = 150;

registerScraper(({ maxResults = 25, nights = 1, zone = null }) =>
  scrape(maxResults, nights, zone),
);

// ---------- Lógica principal ------------------------------------------------
async function scrape(maxResults, nights, zone) {
  // 1) Esperar a que Booking pinte las tarjetas (se renderizan con JavaScript).
  const hasCards = await waitForSelector(SEL.card, 15000);
  if (!hasCards) {
    throw new Error(
      "No aparecieron alojamientos (sin resultados, captcha o cambió el HTML de Booking).",
    );
  }

  // 2) Booking muestra ~25 resultados y luego un botón "Cargar más resultados".
  //    Lo pulsamos hasta reunir el máximo pedido (contando solo los que cumplen
  //    el filtro de zona, si lo hay) o hasta que no haya más.
  const collect = () =>
    [...document.querySelectorAll(SEL.card)]
      .map((card) => extractCard(card, nights))
      .filter((item) => matchesZone(item, zone));

  while (
    collect().length < maxResults &&
    document.querySelectorAll(SEL.card).length < MAX_CARDS_SCANNED
  ) {
    const before = document.querySelectorAll(SEL.card).length;
    const button = findLoadMoreButton();
    if (!button) break;

    button.scrollIntoView({ block: "center" });
    button.click();

    // Esperamos a que aumente el número de tarjetas (máx. 8 s).
    const loaded = await waitForCondition(
      () => document.querySelectorAll(SEL.card).length > before,
      8000,
    );
    if (!loaded) break;
  }

  // 3) Resultado final: solo tarjetas de la zona, hasta el máximo pedido.
  return collect().slice(0, maxResults);
}

// Convierte UNA tarjeta del DOM en un objeto plano.
function extractCard(card, nights) {
  const text = (selector) => card.querySelector(selector)?.textContent.trim() || null;

  const totalPrice = parsePrice(text(SEL.price));
  const reviewText = text(SEL.review) || "";

  const name = text(SEL.title);

  // Dirección en texto (normalmente "Barrio, Ciudad"; la calle exacta solo
  // aparece en la página del alojamiento, no en la tarjeta de resultados).
  const addressText =
    (text(SEL.address) || text(SEL.addressLink) || "").replace(/\s+/g, " ").trim() || null;

  // Coordenadas + enlace a Google Maps.
  const coords = findCoordinates(card, SEL.mapCoords, "data-atlas-latlng");

  return {
    name,
    address: addressText, // texto tal cual lo muestra Booking
    coordinates: coords ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : null,
    mapsUrl: buildMapsUrl(coords, name, addressText),
    totalPrice,
    pricePerNight: totalPrice && nights ? Math.round(totalPrice / nights) : null,
    score: parseScore(reviewText),
    scoreMax: 10, // Booking puntúa de 0 a 10
    reviewCount: parseReviewCount(reviewText),
    url: card.querySelector(SEL.link)?.href || null,
  };
}

// ---------- Parsers propios de Booking --------------------------------------
// "Puntuación: 8,5 8,5 Fabuloso 1.234 comentarios"  ->  8.5
function parseScore(text) {
  const match = text.match(/(\d{1,2}[.,]\d)/);
  return match ? parseFloat(match[1].replace(",", ".")) : null;
}

// "... 1.234 comentarios"  ->  1234
// (la palabra "comentarios" está en español porque pedimos la página con lang=es)
function parseReviewCount(text) {
  const match = text.match(/([\d.]+)\s*comentarios?/i);
  return match ? parseInt(match[1].replace(/\./g, ""), 10) : null;
}

function findLoadMoreButton() {
  return [...document.querySelectorAll("button")].find((b) =>
    /cargar más resultados|load more results/i.test(b.textContent),
  );
}
