/* ============================================================
   favorites.js
   ------------------------------------------------------------
   Favorites & Home Management system for the Commute Guide (CGPH).

   Responsibilities:
     - Save/manage Home, Work, School, and custom Favorite places
     - Track the last 10 searched destinations ("Recent Trips")
     - "Uwi Na Ako" (Go Home) quick action
     - Optional Favorites Drawer UI wiring (uses existing
       placeholders in home.html — see integration notes)

   Integrates with map.js / route.js WITHOUT duplicating logic:
   it reuses the same "cgph:destinationSelected" event that
   map.js already dispatches when a destination is chosen.

   Public API (attached to window.CGPH_FAVORITES):
     saveHome(place)
     saveWork(place)
     saveSchool(place)
     saveFavorite(place)
     getFavorites()
     getRecentTrips()
     goHome()
     removeFavorite(id)
     clearRecentTrips()

   Vanilla JavaScript only. No external libraries.
   ============================================================ */

(function () {
  "use strict";

  /* ----------------------------------------------------------
     1. CONFIGURATION
     ---------------------------------------------------------- */

  const CONFIG = {
    // localStorage keys
    favoritesKey: "cgph_favorites",
    recentTripsKey: "cgph_recent_trips",

    // Max number of recent trips to keep (newest first)
    maxRecentTrips: 10,

    // Fixed favorite types that can only have ONE saved entry each.
    // Saving a new one replaces the previous entry of the same type.
    singleInstanceTypes: ["home", "work", "school"],

    // Custom favorites use this type and allow multiple entries.
    customType: "favorite",

    // Default icons per type (used only if the UI wants a label/icon;
    // no CSS is defined or altered here).
    icons: {
      home: "🏠",
      work: "💼",
      school: "🎓",
      favorite: "⭐"
    },

    // Element IDs expected in home.html for the optional Favorites
    // Drawer UI. All lookups fail silently if an element is missing,
    // so this file works even before the drawer markup is added.
    ui: {
      drawer: "favoritesDrawer",
      drawerToggleBtn: "favoritesToggleBtn",
      favoritesList: "favoritesList",
      recentTripsList: "recentTripsList",
      saveHomeBtn: "saveHomeBtn",
      saveWorkBtn: "saveWorkBtn",
      saveSchoolBtn: "saveSchoolBtn",
      uwiNaAkoBtn: "uwiNaAkoBtn",
      clearRecentBtn: "clearRecentTripsBtn"
    },

    // Geolocation options used by goHome() to find the user's
    // current position (used as the trip's starting point).
    geolocationOptions: {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    }
  };

  /* ----------------------------------------------------------
     2. INTERNAL STATE
     ---------------------------------------------------------- */

  const state = {
    favorites: loadFromStorage(CONFIG.favoritesKey, []),
    recentTrips: loadFromStorage(CONFIG.recentTripsKey, [])
  };

  /* ----------------------------------------------------------
     3. STORAGE HELPERS
     ---------------------------------------------------------- */

  function loadFromStorage(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.warn(`[CGPH_FAVORITES] Failed to load "${key}" from storage.`, err);
      return fallback;
    }
  }

  function saveToStorage(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn(`[CGPH_FAVORITES] Failed to save "${key}" to storage.`, err);
    }
  }

  function persistFavorites() {
    saveToStorage(CONFIG.favoritesKey, state.favorites);
  }

  function persistRecentTrips() {
    saveToStorage(CONFIG.recentTripsKey, state.recentTrips);
  }

  /* ----------------------------------------------------------
     4. UTILITIES
     ---------------------------------------------------------- */

  function generateId() {
    return "fav_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  // Normalizes a raw place object into a consistent shape.
  // Accepts flexible field names so this file stays compatible
  // with whatever shape map.js / route.js already use
  // (lat/lng vs latitude/longitude, etc.).
  function normalizePlace(place, type) {
    if (!place || typeof place !== "object") {
      throw new Error("[CGPH_FAVORITES] A place object is required.");
    }

    const lat = place.lat ?? place.latitude ?? null;
    const lng = place.lng ?? place.lon ?? place.longitude ?? null;

    if (lat === null || lng === null) {
      throw new Error("[CGPH_FAVORITES] Place must include latitude and longitude.");
    }

    return {
      id: place.id || generateId(),
      name: place.name || CONFIG.icons[type] + " " + capitalize(type),
      type: type,
      lat: lat,
      lng: lng,
      address: place.address || "",
      savedAt: place.savedAt || new Date().toISOString()
    };
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Optional: speak a short confirmation if voice.js is loaded
  // and voice is currently enabled. Fails silently otherwise.
  function announce(text) {
    if (window.CGPH_VOICE && typeof window.CGPH_VOICE.speak === "function") {
      window.CGPH_VOICE.speak(text);
    }
  }

  /* ----------------------------------------------------------
     5. FAVORITES: CORE LOGIC
     ---------------------------------------------------------- */

  // Saves a place under a "single instance" type (home/work/school),
  // replacing any previous entry of that same type.
  function saveSingleInstance(type, place) {
    const normalized = normalizePlace(place, type);

    state.favorites = state.favorites.filter((f) => f.type !== type);
    state.favorites.unshift(normalized);
    persistFavorites();
    renderFavoritesList();

    return normalized;
  }

  function saveHome(place) {
    const saved = saveSingleInstance("home", place);
    announce("Home location saved.");
    return saved;
  }

  function saveWork(place) {
    const saved = saveSingleInstance("work", place);
    announce("Work location saved.");
    return saved;
  }

  function saveSchool(place) {
    const saved = saveSingleInstance("school", place);
    announce("School location saved.");
    return saved;
  }

  // Custom favorite: multiple entries allowed. Prevents exact
  // duplicate coordinates from being saved twice.
  function saveFavorite(place) {
    const normalized = normalizePlace(place, CONFIG.customType);

    const isDuplicate = state.favorites.some(
      (f) =>
        f.type === CONFIG.customType &&
        f.lat === normalized.lat &&
        f.lng === normalized.lng
    );

    if (isDuplicate) {
      console.info("[CGPH_FAVORITES] Favorite already saved, skipping duplicate.");
      return null;
    }

    state.favorites.unshift(normalized);
    persistFavorites();
    renderFavoritesList();
    announce(`${normalized.name} added to favorites.`);

    return normalized;
  }

  function getFavorites() {
    // Return a shallow copy to prevent external mutation of internal state.
    return state.favorites.slice();
  }

  function removeFavorite(id) {
    const before = state.favorites.length;
    state.favorites = state.favorites.filter((f) => f.id !== id);

    if (state.favorites.length !== before) {
      persistFavorites();
      renderFavoritesList();
      return true;
    }
    return false;
  }

  function getFavoriteByType(type) {
    return state.favorites.find((f) => f.type === type) || null;
  }

  /* ----------------------------------------------------------
     6. RECENT TRIPS
     ---------------------------------------------------------- */

  // Adds a destination to Recent Trips (newest first, no duplicates,
  // capped at CONFIG.maxRecentTrips). Called automatically whenever
  // map.js dispatches "cgph:destinationSelected".
  function addRecentTrip(place) {
    let normalized;
    try {
      normalized = normalizePlace(place, "recent");
    } catch (err) {
      console.warn("[CGPH_FAVORITES] Skipped invalid recent trip.", err);
      return;
    }

    // Remove any existing entry with the same coordinates so the
    // trip moves to the top instead of creating a duplicate.
    state.recentTrips = state.recentTrips.filter(
      (t) => !(t.lat === normalized.lat && t.lng === normalized.lng)
    );

    state.recentTrips.unshift(normalized);

    // Keep only the most recent N trips.
    if (state.recentTrips.length > CONFIG.maxRecentTrips) {
      state.recentTrips = state.recentTrips.slice(0, CONFIG.maxRecentTrips);
    }

    persistRecentTrips();
    renderRecentTripsList();
  }

  function getRecentTrips() {
    return state.recentTrips.slice();
  }

  function clearRecentTrips() {
    state.recentTrips = [];
    persistRecentTrips();
    renderRecentTripsList();
  }

  /* ----------------------------------------------------------
     7. "UWI NA AKO" (GO HOME)
     ---------------------------------------------------------- */

  // Detects the user's current location, then dispatches the same
  // "cgph:destinationSelected" event map.js already uses, with the
  // saved Home place as the destination. route.js picks this up and
  // generates the guide automatically — no duplicated routing logic.
  function goHome() {
    const home = getFavoriteByType("home");

    if (!home) {
      console.warn("[CGPH_FAVORITES] No Home location saved yet.");
      announce("You haven't saved a home location yet.");
      return Promise.reject(new Error("No home location saved."));
    }

    if (!("geolocation" in navigator)) {
      console.warn("[CGPH_FAVORITES] Geolocation is not supported. Using Home as destination only.");
      dispatchDestinationSelected(home);
      return Promise.resolve({ destination: home, origin: null });
    }

    announce("Finding your current location.");

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const origin = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };

          dispatchDestinationSelected(home, origin);
          resolve({ destination: home, origin: origin });
        },
        (error) => {
          console.warn("[CGPH_FAVORITES] Geolocation failed, using Home as destination only.", error);
          // Still proceed so the user isn't blocked — route.js / map.js
          // may already have a known current location of their own.
          dispatchDestinationSelected(home);
          resolve({ destination: home, origin: null });
        },
        CONFIG.geolocationOptions
      );
    });
  }

  // Dispatches "cgph:destinationSelected" with the same detail shape
  // map.js already produces (lat/lng/name/address), plus an optional
  // origin so route.js can use it if it supports a custom starting
  // point. Extra fields are ignored harmlessly by listeners that
  // don't need them.
  function dispatchDestinationSelected(destination, origin) {
    const detail = {
      name: destination.name,
      lat: destination.lat,
      lng: destination.lng,
      address: destination.address,
      source: "favorites:goHome"
    };

    if (origin) {
      detail.origin = origin;
    }

    document.dispatchEvent(
      new CustomEvent("cgph:destinationSelected", { detail })
    );
  }

  /* ----------------------------------------------------------
     8. AUTO-TRACK SEARCHES AS RECENT TRIPS
     ---------------------------------------------------------- */

  // Whenever map.js selects a destination (manual search, tap on
  // map, etc.), automatically log it as a recent trip. This does
  // NOT duplicate map.js's logic — it only listens.
  function handleDestinationSelected(event) {
    const detail = event && event.detail;
    if (!detail) return;

    // Avoid re-logging trips that originated from goHome() or from
    // clicking a recent/favorite entry, to prevent list churn.
    if (detail.source === "favorites:goHome" || detail.source === "favorites:recent") {
      return;
    }

    addRecentTrip(detail);
  }

  /* ----------------------------------------------------------
     9. FAVORITES DRAWER UI (optional, graceful if absent)
     ---------------------------------------------------------- */

  function renderFavoritesList() {
    const list = document.getElementById(CONFIG.ui.favoritesList);
    if (!list) return; // Drawer markup not present yet — skip silently.

    list.innerHTML = ""; // Clear existing entries before re-render.

    if (state.favorites.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No favorites saved yet.";
      empty.className = "cgph-favorites-empty";
      list.appendChild(empty);
      return;
    }

    state.favorites.forEach((fav) => {
      list.appendChild(buildFavoriteListItem(fav));
    });
  }

  function buildFavoriteListItem(fav) {
    const item = document.createElement("li");
    item.className = "cgph-favorite-item";
    item.dataset.id = fav.id;

    const icon = CONFIG.icons[fav.type] || CONFIG.icons.favorite;

    const label = document.createElement("span");
    label.className = "cgph-favorite-label";
    label.textContent = `${icon} ${fav.name}`;
    label.style.cursor = "pointer";
    label.title = fav.address || "";

    // Clicking a favorite navigates to it, reusing the same event
    // map.js uses — no duplicated routing logic here either.
    label.addEventListener("click", () => {
      dispatchDestinationSelected(fav);
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "cgph-favorite-remove";
    removeBtn.type = "button";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", `Remove ${fav.name} from favorites`);
    removeBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      removeFavorite(fav.id);
    });

    item.appendChild(label);
    item.appendChild(removeBtn);
    return item;
  }

  function renderRecentTripsList() {
    const list = document.getElementById(CONFIG.ui.recentTripsList);
    if (!list) return;

    list.innerHTML = "";

    if (state.recentTrips.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No recent trips yet.";
      empty.className = "cgph-recent-empty";
      list.appendChild(empty);
      return;
    }

    state.recentTrips.forEach((trip) => {
      list.appendChild(buildRecentTripListItem(trip));
    });
  }

  function buildRecentTripListItem(trip) {
    const item = document.createElement("li");
    item.className = "cgph-recent-item";

    const label = document.createElement("span");
    label.textContent = trip.name || trip.address || "Unnamed destination";
    label.style.cursor = "pointer";
    label.title = trip.address || "";

    label.addEventListener("click", () => {
      const detail = Object.assign({}, trip, { source: "favorites:recent" });
      dispatchDestinationSelected(detail);
    });

    item.appendChild(label);
    return item;
  }

  /* ----------------------------------------------------------
     10. BUTTON WIRING (optional, graceful if absent)
     ---------------------------------------------------------- */

  // These buttons are expected to already carry the relevant
  // place data (e.g. via data-* attributes set by home.html or by
  // whatever "current search result" the user is looking at).
  // If your markup provides the place differently, adjust the
  // getPlaceFromButton() helper below — nothing else needs to change.
  function getPlaceFromButton(btn) {
    if (!btn) return null;

    const lat = parseFloat(btn.dataset.lat);
    const lng = parseFloat(btn.dataset.lng);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      console.warn(
        "[CGPH_FAVORITES] Save button is missing data-lat/data-lng attributes."
      );
      return null;
    }

    return {
      name: btn.dataset.name || "",
      address: btn.dataset.address || "",
      lat: lat,
      lng: lng
    };
  }

  function wireUiButtons() {
    const { saveHomeBtn, saveWorkBtn, saveSchoolBtn, uwiNaAkoBtn, clearRecentBtn, drawerToggleBtn, drawer } =
      CONFIG.ui;

    bindClick(saveHomeBtn, () => {
      const place = getPlaceFromButton(document.getElementById(saveHomeBtn));
      if (place) saveHome(place);
    });

    bindClick(saveWorkBtn, () => {
      const place = getPlaceFromButton(document.getElementById(saveWorkBtn));
      if (place) saveWork(place);
    });

    bindClick(saveSchoolBtn, () => {
      const place = getPlaceFromButton(document.getElementById(saveSchoolBtn));
      if (place) saveSchool(place);
    });

    bindClick(uwiNaAkoBtn, () => {
      goHome().catch((err) => console.warn("[CGPH_FAVORITES] goHome() failed.", err));
    });

    bindClick(clearRecentBtn, () => {
      clearRecentTrips();
    });

    bindClick(drawerToggleBtn, () => {
      const drawerEl = document.getElementById(drawer);
      if (!drawerEl) return;
      drawerEl.classList.toggle("cgph-drawer-open");
      const isOpen = drawerEl.classList.contains("cgph-drawer-open");
      drawerEl.setAttribute("aria-hidden", String(!isOpen));
    });
  }

  function bindClick(elementId, handler) {
    const el = document.getElementById(elementId);
    if (!el) return; // Missing element — skip silently, feature degrades gracefully.
    el.addEventListener("click", handler);
  }

  /* ----------------------------------------------------------
     11. EVENT WIRING
     ---------------------------------------------------------- */

  function wireEvents() {
    document.addEventListener("cgph:destinationSelected", handleDestinationSelected);
  }

  /* ----------------------------------------------------------
     12. INITIALIZATION
     ---------------------------------------------------------- */

  function init() {
    wireEvents();
    wireUiButtons();
    renderFavoritesList();
    renderRecentTripsList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* ----------------------------------------------------------
     13. PUBLIC API
     ---------------------------------------------------------- */

  window.CGPH_FAVORITES = {
    saveHome: saveHome,
    saveWork: saveWork,
    saveSchool: saveSchool,
    saveFavorite: saveFavorite,
    getFavorites: getFavorites,
    getRecentTrips: getRecentTrips,
    goHome: goHome,
    removeFavorite: removeFavorite,
    clearRecentTrips: clearRecentTrips
  };
})();
