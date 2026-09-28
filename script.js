/* ========================================================
   Baku Bus Tracker — prototype (MOCK DATA, no real GPS)
   Data lives at the top so a real API can replace it later.
   ======================================================== */

// ---------- CONFIG ----------
// Click on the map to see lat/lng (helps to fine-tune coordinates). Set to false before publishing.
const DEBUG_COORDS = true;
const MAP_CENTER = [40.3800, 49.8590];
const MAP_ZOOM = 13;
const TICK_MS = 2500;

// ---------- DATA (mock, approximate coordinates) ----------
const stops = [
  { id: "28may",       name: "28 May",     coords: [40.3797, 49.8487] },
  { id: "sahil",       name: "Sahil",      coords: [40.3722, 49.8443] },
  { id: "nizami",      name: "Nizami",     coords: [40.3796, 49.8299] },
  { id: "icerisheher", name: "İçərişəhər", coords: [40.3663, 49.8352] },
  { id: "8noyabr",     name: "8 Noyabr",   coords: [40.3805, 49.8870] },
];

const routes = [
  {
    id: "33", from: "28may", to: "nizami", minutes: 12, traffic: "Orta", busCount: 2,
    path: [[40.3797, 49.8487], [40.3792, 49.8440], [40.3794, 49.8390], [40.3796, 49.8345], [40.3796, 49.8299]],
  },
  {
    id: "61", from: "sahil", to: "icerisheher", minutes: 18, traffic: "Az", busCount: 3,
    path: [[40.3722, 49.8443], [40.3708, 49.8418], [40.3693, 49.8392], [40.3678, 49.8368], [40.3663, 49.8352]],
  },
  {
    id: "88", from: "28may", to: "8noyabr", minutes: 25, traffic: "Çox", busCount: 2,
    path: [[40.3797, 49.8487], [40.3786, 49.8560], [40.3782, 49.8640], [40.3788, 49.8730], [40.3797, 49.8810], [40.3805, 49.8870]],
  },
];

// Progress is a value along the route; it bounces back and forth (ping-pong).
const buses = [
  { id: "33-a", routeId: "33", progress: 0.10, speed: 0.06 },
  { id: "33-b", routeId: "33", progress: 0.65, speed: 0.06 },
  { id: "61-a", routeId: "61", progress: 0.05, speed: 0.05 },
  { id: "61-b", routeId: "61", progress: 0.40, speed: 0.05 },
  { id: "61-c", routeId: "61", progress: 0.80, speed: 0.05 },
  { id: "88-a", routeId: "88", progress: 0.20, speed: 0.04 },
  { id: "88-b", routeId: "88", progress: 0.70, speed: 0.04 },
];

const MESSAGES = {
  empty: "Başlanğıc və təyinat nöqtəsini seç.",
  same: "Başlanğıc və təyinat nöqtəsi fərqli olmalıdır.",
  none: "Bu istiqamətdə marşrut tapılmadı (mock data).",
};
const TRAFFIC_CLASS = { "Az": "low", "Orta": "mid", "Çox": "high" };

// ---------- STATE & DOM ----------
const state = { activeRouteId: null, busMarkers: {}, routeLine: null };
const $ = (id) => document.getElementById(id);
const fromSelect = $("fromSelect");
const toSelect = $("toSelect");
const messageEl = $("message");
const resultsEl = $("results");
const mapEl = $("map");

// ---------- MAP ----------
const map = L.map("map").setView(MAP_CENTER, MAP_ZOOM);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

window.addEventListener("load", () => map.invalidateSize());

// Disable marker transitions while zooming to avoid visual glitches
map.on("zoomstart", () => mapEl.classList.add("no-anim"));
map.on("zoomend", () => mapEl.classList.remove("no-anim"));

if (DEBUG_COORDS) {
  map.on("click", (e) => {
    const text = `[${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}]`;
    console.log(text);
    L.popup().setLatLng(e.latlng).setContent(text).openOn(map);
  });
}

// ---------- HELPERS ----------
const getStop = (id) => stops.find((s) => s.id === id);
const getRoute = (id) => routes.find((r) => r.id === id);

/** Cumulative distances along a path (planar approximation, fine at city scale). */
function pathLengths(path) {
  const lens = [0];
  for (let i = 1; i < path.length; i++) {
    lens.push(lens[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  }
  return lens;
}

/** Interpolate a coordinate at fraction t (0..1) along a path. */
function pointAlong(path, t) {
  const lens = pathLengths(path);
  const target = lens[lens.length - 1] * t;
  for (let i = 1; i < lens.length; i++) {
    if (target <= lens[i]) {
      const k = (target - lens[i - 1]) / (lens[i] - lens[i - 1]);
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k,
      ];
    }
  }
  return path[path.length - 1];
}

/** Ping-pong: fold an ever-increasing value into 0..1..0 */
const pingPong = (v) => 1 - Math.abs((v % 2) - 1);

// ---------- RENDER: STOPS ----------
function renderStops() {
  stops.forEach((stop) => {
    L.circleMarker(stop.coords, {
      radius: 8, color: "#ffffff", weight: 3, fillColor: "#16181b", fillOpacity: 1,
    })
      .addTo(map)
      .bindPopup(`<strong>${stop.name}</strong>`)
      .bindTooltip(stop.name, { permanent: true, direction: "top", offset: [0, -8], className: "stop-label" });
  });
}

function fillSelects() {
  const options = stops.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  const placeholder = '<option value="" selected disabled>Seç...</option>';
  fromSelect.innerHTML = placeholder + options;
  toSelect.innerHTML = placeholder + options;
}

// ---------- SEARCH ----------
function showMessage(text, isInfo = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle("info", isInfo);
  messageEl.hidden = false;
}

const clearMessage = () => { messageEl.hidden = true; };

function swapStops() {
  [fromSelect.value, toSelect.value] = [toSelect.value, fromSelect.value];
}

/** Returns routes connecting two stops, in either direction. */
function findRoutes(fromId, toId) {
  return routes.filter(
    (r) => (r.from === fromId && r.to === toId) || (r.from === toId && r.to === fromId)
  );
}

function handleSearch() {
  const fromId = fromSelect.value;
  const toId = toSelect.value;
  clearMessage();
  resultsEl.innerHTML = "";
  clearActiveRoute();

  if (!fromId || !toId) return showMessage(MESSAGES.empty);
  if (fromId === toId) return showMessage(MESSAGES.same);

  const found = findRoutes(fromId, toId);
  if (!found.length) return showMessage(MESSAGES.none, true);

  renderRouteCards(found, fromId, toId);
  setActiveRoute(found[0].id);
}

// ---------- RENDER: ROUTE CARDS ----------
function renderRouteCards(found, fromId, toId) {
  const label = `${getStop(fromId).name} → ${getStop(toId).name}`;

  resultsEl.innerHTML = found.map((r) => `
    <article class="card route-card" tabindex="0" data-route="${r.id}">
      <div class="route-card__no">${r.id}</div>
      <div class="route-card__dir">${label}</div>
      <div class="route-card__time">${r.minutes} dəq</div>
      <div class="route-card__meta">
        <span class="pill pill--${TRAFFIC_CLASS[r.traffic]}">Tıxac: ${r.traffic}</span>
        <span>${r.busCount} avtobus</span>
      </div>
    </article>`).join("");

  resultsEl.querySelectorAll(".route-card").forEach((card) => {
    const select = () => setActiveRoute(card.dataset.route);
    card.addEventListener("click", select);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
    });
  });
}

// ---------- ACTIVE ROUTE ----------
function clearActiveRoute() {
  if (state.routeLine) map.removeLayer(state.routeLine);
  Object.values(state.busMarkers).forEach((m) => map.removeLayer(m));
  state.routeLine = null;
  state.busMarkers = {};
  state.activeRouteId = null;
}

function busIcon(routeId) {
  return L.divIcon({
    className: "bus-icon",
    html: `<div class="bus-marker">${routeId}</div>`,
    iconSize: [38, 26],
    iconAnchor: [19, 13],
  });
}

function setActiveRoute(routeId) {
  clearActiveRoute();
  const route = getRoute(routeId);
  state.activeRouteId = routeId;

  state.routeLine = L.polyline(route.path, { color: "#16a34a", weight: 5, opacity: 0.85 }).addTo(map);
  map.fitBounds(state.routeLine.getBounds(), { padding: [60, 60], maxZoom: 15 });

  buses.filter((b) => b.routeId === routeId).forEach((bus) => {
    state.busMarkers[bus.id] = L.marker(pointAlong(route.path, pingPong(bus.progress)), { icon: busIcon(routeId) })
      .addTo(map)
      .bindPopup(`Marşrut ${routeId} • mock avtobus`);
  });

  resultsEl.querySelectorAll(".route-card").forEach((c) =>
    c.classList.toggle("active", c.dataset.route === routeId)
  );
}

// ---------- BUS SIMULATION (mock) ----------
function tickBuses() {
  if (!state.activeRouteId) return;
  const route = getRoute(state.activeRouteId);

  buses.filter((b) => b.routeId === route.id).forEach((bus) => {
    bus.progress += bus.speed;
    const marker = state.busMarkers[bus.id];
    if (marker) marker.setLatLng(pointAlong(route.path, pingPong(bus.progress)));
  });
}

// ---------- INIT ----------
function init() {
  fillSelects();
  renderStops();
  $("swapBtn").addEventListener("click", swapStops);
  $("searchBtn").addEventListener("click", handleSearch);
  setInterval(tickBuses, TICK_MS);
}

init();