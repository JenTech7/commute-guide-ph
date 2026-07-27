/* ============================================================
   map.js
   ------------------------------------------------------------
   Map module for Commute Guide PH.

   Scope (map functionality ONLY):
     - Initializes a Leaflet map inside #map, centered on the
       Philippines.
     - Requests the user's current location and shows a marker.
     - Lets the user search destinations via the Nominatim
       OpenStreetMap API.
     - Adds a destination marker and draws a simple straight
       route line from the user's location to the destination.
     - Dispatches "cgph:destinationSelected" so route.js can take
       over trip planning — this file never touches guide panel
       UI, Start Guide, Voice, Saved Places, or close buttons.

   Expected (optional) existing elements in home.html — looked
   up defensively, so nothing breaks if they're missing:
     #map                     - the Leaflet map container (required)
     #destinationSearchInput  - text input for destination search
     #destinationSearchResults- container to list search suggestions

   Dependencies: Leaflet.js only (must already be loaded on the
   page via <script src="leaflet.js">/CDN before this file runs).
   ============================================================ */

(function () {
  "use strict";

  try {
    /* --------------------------------------------------------
       1. CONFIGURATION
       -------------------------------------------------------- */

    const CONFIG = {
      mapElementId: "map",
      searchInputId: "destinationSearchInput",
      searchResultsId: "destinationSearchResults",

      // Philippines-wide default view.
      defaultCenter: [12.8797, 121.7740],
      defaultZoom: 6,
      userFoundZoom: 15,

      // Nominatim search settings.
      nominatimUrl: "https://nominatim.openstreetmap.org/search",
      searchCountryCodes: "ph",
      searchResultLimit: 5,
      searchDebounceMs: 400,

      geolocationOptions: {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      },

      routeLineStyle: { color: "#2e7d32", weight: 4, opacity: 0.8, dashArray: "6, 8" }
    };

    /* --------------------------------------------------------
       2. GUARD: Leaflet + map container must exist
       -------------------------------------------------------- */

    if (typeof L === "undefined") {
      console.warn("[CGPH_MAP] Leaflet (L) is not loaded. map.js will not run.");
      return;
    }

    const mapEl = document.getElementById(CONFIG.mapElementId);
    if (!mapEl) {
      console.warn(`[CGPH_MAP] #${CONFIG.mapElementId} not found. map.js will not run.`);
      return;
    }

    /* --------------------------------------------------------
       3. STATE
       -------------------------------------------------------- */

    const state = {
      map: null,
      userMarker: null,
      userLocation: null, // { lat, lng }
      destinationMarker: null,
      routeLine: null,
      searchDebounceTimer: null
    };

    /* --------------------------------------------------------
       4. MAP INITIALIZATION
       -------------------------------------------------------- */

    function initMap() {
      state.map = L.map(CONFIG.mapElementId).setView(CONFIG.defaultCenter, CONFIG.defaultZoom);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(state.map);
    }

    /* --------------------------------------------------------
       5. USER LOCATION
       -------------------------------------------------------- */

    function requestUserLocation() {
      if (!("geolocation" in navigator)) {
        console.warn("[CGPH_MAP] Geolocation is not supported by this browser.");
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          try {
            state.userLocation = {
              lat: position.coords.latitude,
              lng: position.coords.longitude
            };

            placeUserMarker(state.userLocation);
            state.map.setView([state.userLocation.lat, state.userLocation.lng], CONFIG.userFoundZoom);
          } catch (err) {
            console.warn("[CGPH_MAP] Failed to place user marker.", err);
          }
        },
        (error) => {
          console.warn("[CGPH_MAP] Could not determine user location.", error);
        },
        CONFIG.geolocationOptions
      );
    }

    function placeUserMarker(location) {
      if (state.userMarker) {
        state.userMarker.setLatLng([location.lat, location.lng]);
        return;
      }

      state.userMarker = L.circleMarker([location.lat, location.lng], {
        radius: 8,
        color: "#1976d2",
        fillColor: "#1976d2",
        fillOpacity: 0.9,
        weight: 2
      })
        .addTo(state.map)
        .bindPopup("You are here");
    }

    /* --------------------------------------------------------
       6. DESTINATION SEARCH (Nominatim)
       -------------------------------------------------------- */

    async function searchDestinations(query) {
      if (!query || query.trim().length < 3) return [];

      const url = new URL(CONFIG.nominatimUrl);
      url.searchParams.set("format", "json");
      url.searchParams.set("q", query);
      url.searchParams.set("countrycodes", CONFIG.searchCountryCodes);
      url.searchParams.set("limit", String(CONFIG.searchResultLimit));

      try {
        const response = await fetch(url.toString(), {
          headers: { Accept: "application/json" }
        });

        if (!response.ok) {
          console.warn("[CGPH_MAP] Nominatim search failed with status", response.status);
          return [];
        }

        const results = await response.json();
        return Array.isArray(results) ? results : [];
      } catch (err) {
        console.warn("[CGPH_MAP] Nominatim search request failed.", err);
        return [];
      }
    }

    function renderSearchResults(results) {
      const container = document.getElementById(CONFIG.searchResultsId);
      if (!container) return; // No results UI present — fail silently.

      container.innerHTML = "";

      if (results.length === 0) return;

      results.forEach((result) => {
        const item = document.createElement("div");
        item.className = "cgph-map-search-result";
        item.textContent = result.display_name;
        item.style.cursor = "pointer";

        item.addEventListener("click", () => {
          selectDestination({
            lat: parseFloat(result.lat),
            lng: parseFloat(result.lon),
            name: result.display_name
          });
          clearSearchResults();
        });

        container.appendChild(item);
      });
    }

    function clearSearchResults() {
      const container = document.getElementById(CONFIG.searchResultsId);
      if (container) container.innerHTML = "";
    }

    function wireSearchInput() {
      const input = document.getElementById(CONFIG.searchInputId);
      if (!input) {
        console.warn(
          `[CGPH_MAP] #${CONFIG.searchInputId} not found. Destination search UI is unavailable.`
        );
        return;
      }

      input.addEventListener("input", () => {
        clearTimeout(state.searchDebounceTimer);
        const query = input.value;

        state.searchDebounceTimer = setTimeout(async () => {
          const results = await searchDestinations(query);
          renderSearchResults(results);
        }, CONFIG.searchDebounceMs);
      });

      // Enter key: jump straight to the top result.
      input.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();

        const results = await searchDestinations(input.value);
        if (results.length > 0) {
          selectDestination({
            lat: parseFloat(results[0].lat),
            lng: parseFloat(results[0].lon),
            name: results[0].display_name
          });
          clearSearchResults();
        }
      });
    }

    /* --------------------------------------------------------
       7. DESTINATION SELECTION
       -------------------------------------------------------- */

    function selectDestination(destination) {
      if (
        !destination ||
        Number.isNaN(destination.lat) ||
        Number.isNaN(destination.lng)
      ) {
        console.warn("[CGPH_MAP] Invalid destination, ignoring.", destination);
        return;
      }

      placeDestinationMarker(destination);
      drawRouteLine(state.userLocation, destination);
      dispatchDestinationSelected(destination);
    }

    function placeDestinationMarker(destination) {
      if (state.destinationMarker) {
        state.map.removeLayer(state.destinationMarker);
      }

      state.destinationMarker = L.marker([destination.lat, destination.lng])
        .addTo(state.map)
        .bindPopup(destination.name || "Destination")
        .openPopup();

      state.map.setView([destination.lat, destination.lng], CONFIG.userFoundZoom);
    }

    function drawRouteLine(origin, destination) {
      if (state.routeLine) {
        state.map.removeLayer(state.routeLine);
        state.routeLine = null;
      }

      if (!origin) return; // No known user location yet — skip the line.

      state.routeLine = L.polyline(
        [
          [origin.lat, origin.lng],
          [destination.lat, destination.lng]
        ],
        CONFIG.routeLineStyle
      ).addTo(state.map);

      state.map.fitBounds(state.routeLine.getBounds(), { padding: [40, 40] });
    }

    function dispatchDestinationSelected(destination) {
      document.dispatchEvent(
        new CustomEvent("cgph:destinationSelected", {
          detail: {
            lat: destination.lat,
            lng: destination.lng,
            name: destination.name,
            origin: state.userLocation
              ? { lat: state.userLocation.lat, lng: state.userLocation.lng }
              : null
          }
        })
      );
    }

    /* --------------------------------------------------------
       8. INITIALIZATION
       -------------------------------------------------------- */

    function init() {
      initMap();
      requestUserLocation();
      wireSearchInput();
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  } catch (err) {
    // Never let a map.js failure break voice.js, route.js, favorites.js,
    // or fare-calculator.js.
    console.error("[CGPH_MAP] Unexpected error — map functionality disabled.", err);
  }
})();
