// ============================================================================
// popup/popup.js
// ----------------------------------------------------------------------------
// Responsabilidades del popup (y SOLO estas):
//   1. Mostrar el formulario y recordar lo que el usuario escribió.
//   2. Validar los datos y enviarlos al background ("START_SEARCH").
//   3. Dibujar el progreso y los resultados leyendo chrome.storage.local,
//      donde el background va guardando el estado.
//   4. Exportar los resultados a CSV.
// El popup no hace scraping ni abre pestañas: eso es del background/content.
// ============================================================================

// ---------- Datos fijos -----------------------------------------------------
// Ciudades principales. `defaultChecked` indica si viene marcada la primera vez.
const CITIES = [
  { name: "Bogotá", defaultChecked: true },
  { name: "Medellín", defaultChecked: true },
  { name: "Cali", defaultChecked: true },
  { name: "Barranquilla", defaultChecked: true },
  { name: "Cartagena", defaultChecked: true },
  { name: "Bucaramanga", defaultChecked: false },
  { name: "Santa Marta", defaultChecked: false },
  { name: "Pereira", defaultChecked: false },
  { name: "Manizales", defaultChecked: false },
  { name: "Cúcuta", defaultChecked: false },
  { name: "Armenia", defaultChecked: false },
  { name: "Ibagué", defaultChecked: false },
  { name: "Villavicencio", defaultChecked: false },
  { name: "Pasto", defaultChecked: false },
  { name: "San Andrés", defaultChecked: false },
];

// Atajo para document.getElementById
const $ = (id) => document.getElementById(id);

// ---------- Arranque --------------------------------------------------------
document.addEventListener("DOMContentLoaded", init);

async function init() {
  renderSourceCheckboxes();
  renderCityCheckboxes();
  await restoreForm();
  updateCityZoneLock();

  // Si el popup se abre mientras hay una búsqueda en curso (o ya terminó),
  // pintamos el estado guardado. Ignoramos estados con un formato antiguo.
  const { searchState } = await chrome.storage.local.get("searchState");
  if (searchState?.results) renderState(searchState);

  // El background actualiza "searchState" en cada avance; nos suscribimos
  // para que la interfaz se refresque sola.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.searchState) {
      renderState(changes.searchState.newValue);
    }
  });

  // Eventos de la interfaz
  $("searchForm").addEventListener("submit", onSearch);
  $("searchForm").addEventListener("change", () => {
    updateCityZoneLock();
    saveForm(); // recordar cambios
  });
  // "input" (y no solo "change") para reaccionar mientras se escribe la zona.
  $("zone").addEventListener("input", () => {
    updateCityZoneLock();
    saveForm();
  });
  $("cancelBtn").addEventListener("click", () =>
    chrome.runtime.sendMessage({ type: "CANCEL_SEARCH" }),
  );
  $("selectAllBtn").addEventListener("click", () => setAllCities(true));
  $("selectNoneBtn").addEventListener("click", () => setAllCities(false));
  $("csvBtn").addEventListener("click", exportCsv);
}

// ---------- Formulario: pintar, guardar y restaurar -------------------------
// Una casilla por cada fuente registrada en SOURCES (sources/*.js).
function renderSourceCheckboxes() {
  const container = $("sourceList");
  for (const source of Object.values(SOURCES)) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = source.id;
    checkbox.checked = source.defaultChecked;
    label.append(checkbox, document.createTextNode(source.name));
    container.append(label);
  }
}

function getSelectedSources() {
  return [...document.querySelectorAll("#sourceList input:checked")].map(
    (checkbox) => checkbox.value,
  );
}

function renderCityCheckboxes() {
  const container = $("cityList");
  for (const city of CITIES) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = city.name;
    checkbox.checked = city.defaultChecked;
    label.append(checkbox, document.createTextNode(city.name));
    container.append(label);
  }
}

function setAllCities(checked) {
  document
    .querySelectorAll("#cityList input:not(:disabled)")
    .forEach((checkbox) => (checkbox.checked = checked));
  updateCityZoneLock();
  saveForm();
}

// ---------- Regla: localidades solo dentro de UNA ciudad --------------------
// - Si hay texto en "Zona": se bloquean las ciudades que no estén marcadas
//   (no se puede añadir otra ciudad mientras haya una localidad escrita).
// - Si hay 2 o más ciudades marcadas: se bloquea el campo de zona.
function updateCityZoneLock() {
  const checkboxes = [...document.querySelectorAll("#cityList input")];
  const selectedCount = checkboxes.filter((c) => c.checked).length;
  const hasZone = $("zone").value.trim() !== "";
  const zoneLocked = selectedCount > 1;

  // Localidad escrita -> solo la(s) ciudad(es) ya marcada(s) siguen activas.
  // (Marcadas se dejan activas para poder desmarcarlas.)
  for (const checkbox of checkboxes) {
    checkbox.disabled = hasZone && !checkbox.checked;
  }
  $("selectAllBtn").disabled = hasZone;
  $("selectNoneBtn").disabled = false;

  // Varias ciudades -> zona bloqueada.
  $("zone").disabled = zoneLocked;
  $("strictZone").disabled = zoneLocked;

  const note = $("zoneNote");
  if (zoneLocked) {
    note.textContent =
      "Zona desactivada: tienes varias ciudades marcadas. Deja una sola para buscar por localidad.";
  } else if (hasZone) {
    note.textContent =
      "Ciudades desactivadas: las localidades solo se buscan dentro de una ciudad. Borra la zona para volver a elegir más ciudades.";
  } else {
    note.textContent = "";
  }
  note.hidden = !note.textContent;
}

// Guarda el formulario tal cual está (no los "params" validados) para poder
// restaurarlo la próxima vez que se abra el popup.
async function saveForm() {
  const form = {
    sources: getSelectedSources(),
    cities: getSelectedCities(),
    zone: $("zone").value,
    strictZone: $("strictZone").checked,
    minPrice: $("minPrice").value,
    maxPrice: $("maxPrice").value,
    checkin: $("checkin").value,
    checkout: $("checkout").value,
    adults: $("adults").value,
    maxResults: $("maxResults").value,
    reducedMobility: $("reducedMobility").checked,
  };
  await chrome.storage.local.set({ formState: form });
}

async function restoreForm() {
  const { formState: saved } = await chrome.storage.local.get("formState");

  // Fechas por defecto: mañana -> pasado mañana (Booking exige fechas para
  // mostrar precios).
  $("checkin").value = saved?.checkin || toISODate(addDays(new Date(), 1));
  $("checkout").value = saved?.checkout || toISODate(addDays(new Date(), 2));

  // Primera vez (o formato antiguo): dejamos los valores por defecto del HTML.
  if (!saved || !Array.isArray(saved.cities)) return;

  if (Array.isArray(saved.sources)) {
    document.querySelectorAll("#sourceList input").forEach((checkbox) => {
      checkbox.checked = saved.sources.includes(checkbox.value);
    });
  }
  $("zone").value = saved.zone || "";
  $("strictZone").checked = saved.strictZone !== false; // activado por defecto
  $("minPrice").value = saved.minPrice || "";
  $("maxPrice").value = saved.maxPrice || "";
  $("adults").value = saved.adults || 2;
  $("maxResults").value = saved.maxResults || 25;
  $("reducedMobility").checked = !!saved.reducedMobility;
  document.querySelectorAll("#cityList input").forEach((checkbox) => {
    checkbox.checked = saved.cities.includes(checkbox.value);
  });
  // Estado guardado incoherente (zona + varias ciudades): damos prioridad a
  // las ciudades y vaciamos la zona.
  if (saved.cities.length > 1) $("zone").value = "";
}

// ---------- Leer y validar --------------------------------------------------
function getSelectedCities() {
  return [...document.querySelectorAll("#cityList input:checked")].map(
    (checkbox) => checkbox.value,
  );
}

// Devuelve el objeto `params` que se envía al background.
// Lanza un Error con un mensaje legible si algo no es válido.
function readParams() {
  const sources = getSelectedSources();
  if (sources.length === 0) throw new Error("Selecciona al menos un sitio donde buscar.");

  // Solo ciudades de la lista (ya no hay campo libre).
  const cities = getSelectedCities();
  if (cities.length === 0) throw new Error("Selecciona al menos una ciudad.");

  // Zonas opcionales (barrios/localidades), separadas por coma: "Chapinero, Engativá".
  // Pertenecen a UNA ciudad, así que si se escribe alguna exigimos una sola
  // ciudad (Chapinero no existe en Cali).
  const zones = [];
  const seenZones = new Set();
  for (const raw of $("zone").value.split(",")) {
    const zone = raw.replace(/\s+/g, " ").trim();
    // Duplicadas = iguales sin importar mayúsculas ni tildes ("Engativá" = "engativa").
    const key = zone.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (zone && !seenZones.has(key)) {
      seenZones.add(key);
      zones.push(zone);
    }
  }
  if (zones.length > 0 && cities.length > 1) {
    throw new Error(
      "Las localidades solo se pueden buscar dentro de una ciudad: deja una sola ciudad marcada (o vacía la zona).",
    );
  }

  // Precios: campo vacío = sin límite (null).
  const toNumber = (value) => (value === "" ? null : Number(value));
  const minPrice = toNumber($("minPrice").value);
  const maxPrice = toNumber($("maxPrice").value);
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    throw new Error("El precio mínimo no puede ser mayor que el máximo.");
  }

  // Fechas (las cadenas AAAA-MM-DD se pueden comparar directamente).
  const checkin = $("checkin").value;
  const checkout = $("checkout").value;
  if (!checkin || !checkout)
    throw new Error("Indica las fechas de entrada y salida.");
  if (checkin < toISODate(new Date()))
    throw new Error("La entrada no puede ser en el pasado.");
  if (checkout <= checkin)
    throw new Error("La salida debe ser posterior a la entrada.");

  // Cantidad de resultados: número entero escrito a mano, entre 1 y 75.
  const maxResults = Number($("maxResults").value);
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 75) {
    throw new Error("Resultados por ciudad: escribe un número entero entre 1 y 75.");
  }

  // Nº de noches: lo necesita el content script para calcular precio por noche.
  const nights = Math.round(
    (new Date(checkout + "T00:00:00") - new Date(checkin + "T00:00:00")) /
      86400000,
  );

  return {
    sources,
    cities,
    zones, // [] = toda la ciudad
    strictZone: zones.length > 0 ? $("strictZone").checked : false,
    minPrice,
    maxPrice,
    checkin,
    checkout,
    nights,
    adults: Number($("adults").value) || 2,
    maxResults,
    reducedMobility: $("reducedMobility").checked, // <- el booleano
  };
}

// ---------- Acción: Buscar --------------------------------------------------
async function onSearch(event) {
  event.preventDefault(); // evita que el <form> recargue el popup
  showNotice("");

  let params;
  try {
    params = readParams();
  } catch (err) {
    showNotice(err.message);
    return;
  }

  await saveForm();
  const response = await chrome.runtime.sendMessage({
    type: "START_SEARCH",
    params,
  });
  if (!response?.ok)
    showNotice(response?.error || "No se pudo iniciar la búsqueda.");
}

// ---------- Pintar estado (progreso + resultados) ---------------------------
function renderState(state) {
  if (!state) return;
  const running = state.status === "running";

  // Botones
  $("searchBtn").disabled = running;
  $("searchBtn").textContent = running ? "Buscando…" : "Buscar alojamientos";
  $("cancelBtn").hidden = !running;

  // Progreso
  $("progress").hidden = !running;
  if (running) {
    $("progressText").textContent =
      `Buscando en ${state.current || "…"} (${state.done} de ${state.total} búsquedas)`;
    $("progressBar").max = state.total;
    $("progressBar").value = state.done;
  }

  // Resultados
  const hasContent = state.results.length > 0 || state.errors.length > 0;
  $("results").hidden = !hasContent;
  if (!hasContent) return;

  $("resultsTitle").textContent =
    `${state.results.length} alojamientos` +
    (state.status === "cancelled" ? " (búsqueda cancelada)" : "");

  // Errores por ciudad
  const errorList = $("errorList");
  errorList.replaceChildren();
  for (const message of state.errors) {
    const li = document.createElement("li");
    li.textContent = message;
    errorList.append(li);
  }

  // Tabla ordenada por precio por noche (los que no tienen precio, al final)
  const rows = [...state.results].sort(
    (a, b) => (a.pricePerNight ?? Infinity) - (b.pricePerNight ?? Infinity),
  );
  const tbody = $("tbody");
  tbody.replaceChildren();
  for (const item of rows) tbody.append(createRow(item));
}

// Crea una <tr>. Usamos textContent / createElement (NUNCA innerHTML) porque
// los datos vienen de una web externa: así se evita inyectar HTML malicioso.
function createRow(item) {
  const tr = document.createElement("tr");

  const nameCell = document.createElement("td");
  if (isBookingUrl(item.url)) {
    const anchor = document.createElement("a");
    anchor.href = item.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = item.name || "(sin nombre)";
    nameCell.append(anchor);
  } else {
    nameCell.textContent = item.name || "(sin nombre)";
  }

  const cityCell = document.createElement("td");
  cityCell.textContent = item.zone ? `${item.city} · ${item.zone}` : item.city;

  const sourceCell = document.createElement("td");
  sourceCell.textContent = item.sourceName || "Booking"; // filas antiguas: sin fuente

  const priceCell = document.createElement("td");
  priceCell.className = "num";
  priceCell.textContent = item.pricePerNight
    ? "$ " + item.pricePerNight.toLocaleString("es-CO")
    : "—";

  const scoreCell = document.createElement("td");
  scoreCell.className = "num";
  // Booking puntúa sobre 10 y Airbnb sobre 5: mostramos la escala si no es 10.
  scoreCell.textContent =
    item.score == null ? "—" : item.scoreMax && item.scoreMax !== 10 ? `${item.score}/${item.scoreMax}` : item.score;

  tr.append(nameCell, cityCell, sourceCell, priceCell, scoreCell);
  return tr;
}

// Solo aceptamos enlaces https a los sitios de las fuentes (evita esquemas como
// javascript:). Si añades una fuente nueva, añade su dominio aquí.
const ALLOWED_LINK_DOMAINS = ["booking.com", "airbnb.com", "airbnb.com.co", "pricetravel.com"];

function isBookingUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      ALLOWED_LINK_DOMAINS.some(
        (d) => parsed.hostname === d || parsed.hostname.endsWith("." + d),
      )
    );
  } catch {
    return false;
  }
}

function showNotice(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}

// ---------- Exportar a CSV --------------------------------------------------
async function exportCsv() {
  const { searchState } = await chrome.storage.local.get("searchState");
  const rows = searchState?.results || [];
  if (rows.length === 0) return;

  // [clave del objeto, título de la columna que verá el usuario en Excel]
  const columns = [
    ["sourceName", "Fuente"],
    ["city", "Ciudad"],
    ["zone", "Zona"],
    ["name", "Alojamiento"],
    ["address", "Dirección"],
    ["coordinates", "Coordenadas"],
    ["mapsUrl", "Google Maps"],
    ["pricePerNight", "Precio por noche (COP)"],
    ["totalPrice", "Precio total (COP)"],
    ["score", "Puntuación"],
    ["scoreMax", "Escala puntuación"],
    ["reviewCount", "Comentarios"],
    ["reducedMobility", "Filtro movilidad reducida"],
    ["url", "Enlace"],
  ];

  // Cada valor va entre comillas; las comillas internas se duplican (estándar CSV).
  const cell = (value) => {
    if (value === true) value = "Sí";
    if (value === false) value = "No";
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  };

  // Separador ";" porque Excel en configuración regional de Colombia/España lo
  // espera así. El "\uFEFF" inicial (BOM) hace que Excel lea bien las tildes.
  const lines = [
    columns.map(([, title]) => cell(title)).join(";"),
    ...rows.map((row) => columns.map(([key]) => cell(row[key])).join(";")),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });

  // Truco clásico: enlace temporal con atributo "download".
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `alojamientos_${toISODate(new Date())}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

// ---------- Utilidades de fecha --------------------------------------------
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Devuelve AAAA-MM-DD en hora LOCAL (toISOString() usaría UTC y podría
// dar el día anterior/siguiente según la hora).
function toISODate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}