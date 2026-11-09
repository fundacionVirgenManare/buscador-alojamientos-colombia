// ============================================================================
// sources/booking.js — cómo se arma la URL de búsqueda de Booking.
// ============================================================================
(() => {
  // Booking permite pasar los filtros por la URL, así no hay que "hacer clic"
  // en su interfaz. El parámetro `nflt` agrupa los filtros separados por ";".
  function buildSearchUrl(city, p) {
    const filters = [];

    // Rango de precio POR NOCHE. Formato de Booking: price=COP-min-max-1
    // Si falta un extremo, Booking usa las palabras literales "min" / "max".
    if (p.minPrice != null || p.maxPrice != null) {
      const min = p.minPrice != null ? p.minPrice : "min";
      const max = p.maxPrice != null ? p.maxPrice : "max";
      filters.push(`price=COP-${min}-${max}-1`);
    }

    // "Instalaciones para huéspedes con discapacidad" = hotelfacility=25.
    // OJO: Booking no ofrece un filtro "sin accesibilidad", por eso cuando el
    // booleano es false simplemente NO aplicamos el filtro (trae todo).
    if (p.reducedMobility) {
      filters.push("hotelfacility=25");
    }

    const qs = new URLSearchParams({
      // Con zona: "Chapinero, Bogotá, Colombia" (Booking lo geolocaliza al barrio).
      ss: p.zone ? `${p.zone}, ${city}, Colombia` : `${city}, Colombia`,
      checkin: p.checkin, // AAAA-MM-DD
      checkout: p.checkout, // AAAA-MM-DD
      group_adults: String(p.adults),
      group_children: "0",
      no_rooms: "1",
      selected_currency: "COP", // fija la moneda para poder parsear el precio
      lang: "es",
    });
    if (filters.length) qs.set("nflt", filters.join(";")); // se codifica solo

    return `https://www.booking.com/searchresults.es.html?${qs.toString()}`;
  }

  SOURCES.booking = {
    id: "booking",
    name: "Booking",
    defaultChecked: true,
    supportsReducedMobility: true,
    pageSize: null, // una sola URL: el content script pulsa "Cargar más resultados"
    buildSearchUrl,
  };
})();
