// ============================================================================
// sources/airbnb.js — cómo se arma la URL de búsqueda de Airbnb.
//
// ATENCIÓN: formato de URL basado en lo que se conoce de Airbnb, SIN probar
// contra el sitio real. Si la búsqueda no respeta fechas, precios o paginación,
// compara con la URL que genera Airbnb al buscar a mano y ajusta aquí.
// ============================================================================
(() => {
  const PAGE_SIZE = 18; // Airbnb muestra 18 alojamientos por página

  function buildSearchUrl(city, p, page = 0) {
    // El lugar va en la ruta: /s/Chapinero--Bogotá--Colombia/homes
    const place = [p.zone, city, "Colombia"].filter(Boolean);
    const slug = place
      .map((part) => encodeURIComponent(part.trim().replace(/\s+/g, "-")))
      .join("--");

    const qs = new URLSearchParams({
      query: place.join(", "), // también como texto (lo usa el enlace de Maps)
      checkin: p.checkin, // AAAA-MM-DD
      checkout: p.checkout,
      adults: String(p.adults),
      children: "0",
      currency: "COP",
      locale: "es",
    });
    // Precio por noche. Si falta un extremo simplemente no se manda.
    if (p.minPrice != null) qs.set("price_min", String(p.minPrice));
    if (p.maxPrice != null) qs.set("price_max", String(p.maxPrice));
    // Paginación: la página 2 empieza en el resultado 18, etc.
    if (page > 0) qs.set("items_offset", String(page * PAGE_SIZE));

    return `https://www.airbnb.com.co/s/${slug}/homes?${qs.toString()}`;
  }

  SOURCES.airbnb = {
    id: "airbnb",
    name: "Airbnb",
    defaultChecked: false,
    supportsReducedMobility: false, // aún no se aplica filtro de accesibilidad
    pageSize: PAGE_SIZE,
    buildSearchUrl,
  };
})();
