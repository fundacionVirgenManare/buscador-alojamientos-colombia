// ============================================================================
// sources/pricetravel.js — cómo se arma la URL de búsqueda de PriceTravel.
//
// Formato real (copiado de una búsqueda hecha a mano):
//   https://www.pricetravel.com/es/alojamientos-en-bogota_d54198
//        ?adults=2&checkin=2026-11-02&checkout=2026-11-03&group_adults=2&no_rooms=1
//
// El tramo "alojamientos-en-bogota_d54198" identifica la ciudad (nombre + código
// de destino). No se puede deducir: hay que copiarlo de una búsqueda manual.
// Cómo añadir una ciudad:
//   1. En pricetravel.com busca alojamientos en esa ciudad.
//   2. Copia de la URL el tramo que va entre /es/ y el "?" (p. ej.
//      "alojamientos-en-medellin_d12345").
//   3. Añádelo abajo en CITY_PATHS (clave = ciudad sin tildes y en minúsculas).
//
// LA ZONA no va en la URL: PriceTravel la elige con el filtro "Zonas" de la
// barra izquierda. Por eso aquí solo se arma la URL de la ciudad y es el content
// script (content/pricetravel.js) quien hace clic en la zona pedida.
// ============================================================================
(() => {
  const CITY_PATHS = {
    bogota: "alojamientos-en-bogota_d54198",
    medellin: "alojamientos-en-medellin_d167960",
    cali: "alojamientos-en-santiago-de-cali_d230379",
    barranquilla: "alojamientos-en-barranquilla_d288613",
    cartagena: "alojamientos-en-cartagena_d167953",
    bucaramanga: "alojamientos-en-bucaramanga_d237133",
    "santa marta": "alojamientos-en-santa-marta_d221814",
    pereira: "alojamientos-en-pereira_d222945",
    manizales: "alojamientos-en-manizales_d55870",
    cucuta: "alojamientos-en-san-jose-de-cucuta_d54451",
    armenia: "alojamientos-en-armenia_d54040",
    ibague: "alojamientos-en-san-bonifacio-de-ibague_d76587",
    villavicencio: "alojamientos-en-villavicencio_d222910",
    pasto: "alojamientos-en-pasto_d56224",
    "san andres": "alojamientos-en-san-andres_d80744",
  };

  // Nombres alternativos de ciudades (por si llegan con otro nombre).
  CITY_PATHS["santiago de cali"] = CITY_PATHS.cali;
  CITY_PATHS["san jose de cucuta"] = CITY_PATHS.cucuta;
  CITY_PATHS["san bonifacio de ibague"] = CITY_PATHS.ibague;

  const norm = (s) =>
    (s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  function buildSearchUrl(city, p) {
    const path = CITY_PATHS[norm(city)];
    if (!path) {
      throw new Error(
        `PriceTravel: falta el código de "${city}". Búscala a mano en PriceTravel, copia de la URL el tramo "alojamientos-en-…_d…" y añádelo en CITY_PATHS de sources/pricetravel.js.`,
      );
    }

    const qs = new URLSearchParams({
      adults: String(p.adults),
      checkin: p.checkin, // AAAA-MM-DD
      checkout: p.checkout,
      group_adults: String(p.adults),
      no_rooms: "1",
    });
    return `https://www.pricetravel.com/es/${path}?${qs.toString()}`;
  }

  SOURCES.pricetravel = {
    id: "pricetravel",
    name: "PriceTravel",
    defaultChecked: false,
    supportsReducedMobility: false,
    priceInUrl: false, // el rango de precio se aplica DESPUÉS, sobre los resultados
    pageSize: null, // una sola URL: el content script baja / pulsa "ver más" / "siguiente"
    buildSearchUrl,
  };
})();
