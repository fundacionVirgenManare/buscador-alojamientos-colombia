// ============================================================================
// content/pricetravel.js
// ----------------------------------------------------------------------------
// Scraper de PriceTravel. Se inyecta en https://www.pricetravel.com/es/* ,
// DESPUÉS de content/common.js.
//
// Basado en el HTML REAL de la lista (AngularJS): cada resultado es un
//   <li class="new-card"> con  a.new-card__link (href del hotel),
//   h2.new-card__title, .new-card__location, .new-card__rating y
//   .new-card__sidebar (precio).
// Lo que NO se pudo ver (el interior de ubicación, puntuación y precio estaba
// colapsado) se lee del TEXTO de cada bloque con heurísticas. Si un campo sale
// vacío, inspecciona esa parte de la tarjeta con F12 y ajusta extractCard().
//
// LA ZONA: PriceTravel la elige con el filtro "Zonas" (botones de radio a la
// izquierda: Zona T, Chapinero, Usaquén...). Este script hace clic en la zona
// pedida y espera a que la lista se actualice. Por eso IGNORA el filtro por
// texto del popup (`msg.zone`) y usa `msg.zoneName`, que llega siempre.
// ============================================================================

const SEL = {
  card: "li.new-card",
  link: "a.new-card__link",
  title: ".new-card__title",
  location: ".new-card__location",
  rating: ".new-card__rating",
  price: ".new-card__sidebar",
};

const MAX_CARDS_SCANNED = 150;

registerScraper(({ maxResults = 25, nights = 1, zoneName = null }) =>
  scrape(maxResults, nights, zoneName),
);

const findCards = () => [...document.querySelectorAll(SEL.card)];
const clean = (s) => (s || "").replace(/\s+/g, " ").trim() || null;

// "Firma" de la lista: cambia cuando la lista se refresca (filtro, página...).
const listSignature = () => {
  const cards = findCards();
  return `${cards.length}|${cards[0]?.querySelector(SEL.link)?.href || ""}|${
    cards[cards.length - 1]?.querySelector(SEL.link)?.href || ""
  }`;
};

async function scrape(maxResults, nights, zoneName) {
  const hasCards = await waitForCondition(() => findCards().length > 0, 25000);
  if (!hasCards) {
    throw new Error(
      "No aparecieron alojamientos (sin resultados, captcha o cambió el HTML de PriceTravel).",
    );
  }

  // Los precios se cargan DESPUÉS de las tarjetas ("loadingRates"): esperamos a
  // que la mayoría tenga precio (máx. 15 s).
  await waitForCondition(() => {
    const cards = findCards();
    const withPrice = cards.filter((c) => /\d/.test(c.querySelector(SEL.price)?.textContent || ""));
    return withPrice.length >= Math.ceil(cards.length * 0.6);
  }, 15000);

  if (zoneName) await applyZone(zoneName);

  // Acumulamos por enlace: si el sitio pagina (la lista se REEMPLAZA al pasar de
  // página) no perdemos los de páginas anteriores.
  const collected = new Map();
  const harvest = () => {
    for (const card of findCards()) {
      const item = extractCard(card, nights);
      const key = item.url || item.name;
      if (key && !collected.has(key)) collected.set(key, item);
    }
  };
  harvest();

  let stagnant = 0;
  while (collected.size < maxResults && collected.size < MAX_CARDS_SCANNED && stagnant < 3) {
    const beforeSize = collected.size;
    const beforeSignature = listSignature();

    // 1) botón "ver más"; 2) paginador "siguiente"; 3) simplemente bajar.
    const more = [...document.querySelectorAll("button, a")].find((el) =>
      /^\s*(ver|mostrar|cargar)\s+más/i.test(el.textContent),
    );
    const next = more
      ? null
      : document.querySelector(
          '[rel="next"], [aria-label*="iguiente" i], .pagination .next:not(.disabled) a, li.next:not(.disabled) a',
        );
    (more || next)?.click();
    window.scrollTo(0, document.documentElement.scrollHeight);

    await waitForCondition(() => listSignature() !== beforeSignature, 6000);
    await pause(800); // dejamos que lleguen los precios de lo nuevo
    harvest();
    stagnant = collected.size > beforeSize ? 0 : stagnant + 1;
  }

  return { items: [...collected.values()].slice(0, maxResults), scanned: collected.size };
}

// ---------- Filtro "Zonas" de la barra izquierda -----------------------------
// Busca el bloque "Zonas", localiza la opción cuyo nombre coincide con la zona
// pedida (ignora tildes y el número de hoteles que aparece al lado), la marca y
// espera a que la lista cambie.
async function applyZone(zoneName) {
  const wanted = normalize(zoneName);

  let options = findZoneOptions();
  if (options.length === 0) {
    // Quizá el bloque está plegado: pulsamos su título y reintentamos.
    findZonesHeading()?.click();
    await waitForCondition(() => findZoneOptions().length > 0, 3000);
    options = findZoneOptions();
  }
  if (options.length === 0) {
    throw new Error('No encontré el filtro "Zonas" en la barra izquierda de PriceTravel.');
  }

  const option =
    options.find((o) => o.name === wanted) || options.find((o) => o.name.includes(wanted));
  if (!option) {
    throw new Error(
      `PriceTravel no tiene la zona "${zoneName}". Zonas disponibles: ${options
        .map((o) => o.label)
        .join(", ")}.`,
    );
  }
  if (option.input.checked) return; // ya está seleccionada

  const before = listSignature();
  option.input.click();
  await waitForCondition(() => listSignature() !== before, 8000);
  await pause(1500); // precios de la lista nueva
}

// Título "Zonas" (cualquier elemento corto cuyo texto sea exactamente "Zonas").
function findZonesHeading() {
  return [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,legend,button,span,p,div,strong,a")].find(
    (el) => normalize(el.textContent) === "zonas" && el.children.length <= 1,
  );
}

// Opciones del bloque "Zonas": { input, label, name } con name sin tildes ni conteo.
function findZoneOptions() {
  const heading = findZonesHeading();
  if (!heading) return [];

  // Subimos hasta un contenedor que ya incluya los botones de radio.
  let box = heading;
  for (let i = 0; i < 6 && box && box.querySelectorAll('input[type="radio"]').length < 2; i++) {
    box = box.parentElement;
  }
  if (!box) return [];

  return [...box.querySelectorAll('input[type="radio"]')].map((input) => {
    const holder = input.closest("label") || input.closest("li") || input.parentElement;
    const label = clean((holder?.textContent || "").replace(/\s*\d+\s*$/, "")) || "";
    return { input, label, name: normalize(label) };
  });
}

// ---------- Tarjeta ---------------------------------------------------------
function extractCard(card, searchNights) {
  const text = (selector) => clean(card.querySelector(selector)?.textContent);
  const link = card.querySelector(SEL.link);

  const name = text(SEL.title) || clean(link?.getAttribute("title"));
  const address = text(SEL.location);

  const priceText = clean(card.querySelector(SEL.price)?.innerText || card.querySelector(SEL.price)?.textContent) || "";
  const { totalPrice, pricePerNight } = parseCardPrice(priceText, searchNights);
  const currency = priceText.match(/\b(COP|MXN|USD|EUR)\b/)?.[1] || null;

  // Puntuación (sobre 10): primer decimal suelto que no sea parte de un precio.
  const ratingText = clean(card.querySelector(SEL.rating)?.textContent) || "";
  const scoreMatch = ratingText.match(/(?<![\d.,])(\d{1,2}[.,]\d)(?![\d.,])/);
  const score = scoreMatch ? parseFloat(scoreMatch[1].replace(",", ".")) : null;
  const countMatch =
    ratingText.match(/(\d[\d.,]*)\s*(?:opiniones|comentarios|reseñas|valoraciones|evaluaciones)/i) ||
    ratingText.match(/\((\d[\d.,]*)\)/);

  const coords = findCoordinates(card);

  return {
    name,
    address,
    coordinates: coords ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : null,
    mapsUrl: buildMapsUrl(coords, name, address),
    totalPrice,
    pricePerNight,
    currency,
    score: score != null && score <= 10 ? score : null,
    scoreMax: 10,
    reviewCount: countMatch ? parseInt(countMatch[1].replace(/[.,]/g, ""), 10) : null,
    url: link?.href || null,
  };
}
