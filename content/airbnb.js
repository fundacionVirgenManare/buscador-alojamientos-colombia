// ============================================================================
// content/airbnb.js
// ----------------------------------------------------------------------------
// Scraper de Airbnb. Se inyecta en https://www.airbnb.com.co/s/* (y .com/s/*),
// DESPUÉS de content/common.js.
//
// ATENCIÓN: los selectores y heurísticas de este archivo están escritos con lo
// que se conoce del HTML de Airbnb, pero NO se han probado contra la página
// real. Es lo primero que hay que revisar si un campo sale vacío: abre una
// búsqueda de Airbnb, inspecciona una tarjeta con F12 y ajusta el bloque SEL.
//
// Diferencias con Booking:
//   - Airbnb PAGINA (18 resultados por página), no tiene "Cargar más". Por eso
//     este script solo lee la página actual; el background pide cada página
//     con `items_offset` (ver sources/airbnb.js).
//   - Puntúa de 0 a 5 (Booking de 0 a 10).
//   - No hay una dirección en texto: la tarjeta dice algo como
//     "Apartamento en Chapinero". Ese texto se usa como "dirección".
// ============================================================================

const SEL = {
  card: '[data-testid="card-container"]',
  link: 'a[href*="/rooms/"]',
  title: '[data-testid="listing-card-title"]', // "Apartamento en Chapinero"
  subtitle: '[data-testid="listing-card-subtitle"]', // nombre / descripción corta
};

registerScraper(({ nights = 1, zone = null }) => scrape(nights, zone));

async function scrape(nights, zone) {
  const hasCards = await waitForSelector(SEL.card, 20000);
  if (!hasCards) {
    throw new Error(
      "No aparecieron alojamientos (sin resultados, captcha o cambió el HTML de Airbnb).",
    );
  }

  // Airbnb pinta parte de las tarjetas al hacer scroll: bajamos por tramos.
  for (let i = 0; i < 6; i++) {
    window.scrollBy(0, document.documentElement.scrollHeight / 6);
    await pause(400);
  }

  // Sin duplicados (Airbnb a veces repite una tarjeta en carruseles).
  const seen = new Set();
  const all = [];
  for (const card of document.querySelectorAll(SEL.card)) {
    const item = extractCard(card, nights);
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    all.push(item);
  }

  return { items: all.filter((item) => matchesZone(item, zone)), scanned: all.length };
}

function extractCard(card, nights) {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim() || null;
  const text = (selector) => clean(card.querySelector(selector)?.textContent);

  const title = text(SEL.title);
  const subtitle = text(SEL.subtitle);
  const cardText = clean(card.innerText || card.textContent) || "";

  const { totalPrice, pricePerNight } = parseCardPrice(cardText, nights);
  const { score, reviewCount } = parseAirbnbRating(cardText);

  const coords = findCoordinates(card);
  const name = subtitle || title;

  // Los enlaces de Airbnb son relativos ("/rooms/123?..."): `href` ya los
  // devuelve absolutos. Quitamos la query para dejar un enlace limpio.
  const href = card.querySelector(SEL.link)?.href || null;
  const url = href ? href.split("?")[0] : null;

  return {
    name,
    address: title, // "Apartamento en Chapinero": es lo más parecido a una dirección
    coordinates: coords ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : null,
    mapsUrl: buildMapsUrl(coords, name, title),
    totalPrice,
    pricePerNight,
    score,
    scoreMax: 5, // Airbnb puntúa de 0 a 5
    reviewCount,
    url,
  };
}

// ---------- Parsers propios de Airbnb ---------------------------------------
// (el precio se lee con parseCardPrice, de common.js)

// "4,85 (120)"  |  "4,85 · 120 reseñas"  ->  { score: 4.85, reviewCount: 120 }
function parseAirbnbRating(cardText) {
  const match =
    cardText.match(/(\d[.,]\d{1,2})\s*\((\d[\d.,]*)\)/) ||
    cardText.match(/(\d[.,]\d{1,2})\s*[·•]?\s*(\d[\d.,]*)\s*(?:reseñas?|evaluaciones|comentarios)/i);
  if (!match) return { score: null, reviewCount: null };
  return {
    score: parseFloat(match[1].replace(",", ".")),
    reviewCount: parseInt(match[2].replace(/[.,]/g, ""), 10) || null,
  };
}
