/* ==========================================================================
   COMMUTE GUIDE PH — HOME / MAP SCREEN SCRIPT
   Responsible for: Leaflet map, geolocation, destination search +
   autocomplete, destination pin + preview route line, saved places,
   recent searches, mobile bottom-sheet interaction, dark mode.

   Does NOT generate commute steps — that's route.js, which listens
   for the 'cgph:destinationSelected' custom event dispatched below.
   ========================================================================== */

(function () {
  'use strict';

  /* ==================================================================
     0. CONSTANTS & ELEMENT REFERENCES
     ================================================================== */
  const PH_CENTER = [14.5995, 120.9842]; // Metro Manila — sensible default view
  const DEFAULT_ZOOM = 12;
  const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
  const SEARCH_DEBOUNCE_MS = 400;
  const MIN_SEARCH_LENGTH = 3;
  const RECENT_SEARCHES_KEY = 'cgph-recent-searches';
  const MAX_RECENT_SEARCHES = 6;

  const els = {
    map: document.getElementById('map'),
    searchForm: document.getElementById('searchForm'),
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    searchSuggestions: document.getElementById('searchSuggestions'),
    recentSearchesRow: document.getElementById('recentSearchesRow'),
    recentSearchesList: document.getElementById('recentSearchesList'),
    locateBtn: document.getElementById('locateBtn'),
    guideEmptyState: document.getElementById('guideEmptyState'),
    guideContent: document.getElementById('guideContent'),
    guideDestinationName: document.getElementById('guideDestinationName'),
    closeGuideBtn: document.getElementById('closeGuideBtn'),
    guidePanel: document.getElementById('guidePanel'),
    sheetDragHandle: document.getElementById('sheetDragHandle'),
    savedPlacesBtn: document.getElementById('savedPlacesBtn'),
    savedPlacesDrawer: document.getElementById('savedPlacesDrawer'),
    closeSavedPlacesBtn: document.getElementById('closeSavedPlacesBtn'),
    savedPlacesList: document.getElementById('savedPlacesList'),
    darkModeToggle: document.getElementById('darkModeToggle'),
    startGuideBtn: document.getElementById('startGuideBtn'),
  };

  /* ==================================================================
     1. DARK MODE (same pattern as landing.js, kept independent since
     home.html doesn't load landing.js)
     ================================================================== */
  const THEME_KEY = 'cgph-theme';

  function applyTheme(theme) {
    const icon = els.darkModeToggle && els.darkModeToggle.querySelector('.material-icons-round');
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (icon) icon.textContent = 'light_mode';
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (icon) icon.textContent = 'dark_mode';
    }
  }

  let currentTheme =
    localStorage.getItem(THEME_KEY) ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(currentTheme);

  if (els.darkModeToggle) {
    els.darkModeToggle.addEventListener('click', () => {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(currentTheme);
      localStorage.setItem(THEME_KEY, currentTheme);
    });
  }

  /* ==================================================================
     2. MAP INITIALIZATION
     ================================================================== */
  const map = L.map(els.map, {
    center: PH_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: false, // re-added bottom-left below so it doesn't clash with FABs on the right
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  L.control.zoom({ position: 'bottomleft' }).addTo(map);

  // Custom marker icons — Leaflet's default marker images don't ship
  // via the CDN CSS alone, so we build simple divIcons instead.
  const userLocationIcon = L.divIcon({
    className: 'user-location-marker',
    html: '<span class="user-location-dot"></span><span class="user-location-pulse"></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  const destinationIcon = L.divIcon({
    className: 'destination-marker',
    html: '<span class="material-icons-round">location_on</span>',
    iconSize: [36, 36],
    iconAnchor: [18, 36],
  });

  let userMarker = null;
  let userLatLng = null;
  let destinationMarker = null;
  let previewRouteLine = null;

  /* ==================================================================
     3. GEOLOCATION
     ================================================================== */
  function locateUser({ recenter = true } = {}) {
    if (!('geolocation' in navigator)) {
      alert('Geolocation is not supported by this browser.');
      return;
    }

    els.locateBtn.classList.add('is-active');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        userLatLng = [latitude, longitude];

        if (userMarker) {
          userMarker.setLatLng(userLatLng);
        } else {
          userMarker = L.marker(userLatLng, {
            icon: userLocationIcon,
            zIndexOffset: 1000,
            keyboard: false,
          }).addTo(map);
        }

        if (recenter) {
          map.setView(userLatLng, 15);
        }

        els.locateBtn.classList.remove('is-active');
      },
      (error) => {
        els.locateBtn.classList.remove('is-active');
        // Permission denied or unavailable — fail quietly with a message,
        // don't block the rest of the app from working.
        console.warn('Geolocation error:', error.message);
        if (error.code === error.PERMISSION_DENIED) {
          alert('Location access was denied. You can still search for a destination manually.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  if (els.locateBtn) {
    els.locateBtn.addEventListener('click', () => locateUser());
  }

  // Ask for location automatically on load (per the brief's user flow:
  // Open app -> Allow location). If denied, the app remains fully usable.
  locateUser({ recenter: true });

  /* ==================================================================
     4. DESTINATION SEARCH — Nominatim autocomplete
     ================================================================== */
  let debounceTimer = null;
  let activeSuggestionIndex = -1;
  let currentSuggestions = [];

  function debounceSearch(query) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchSuggestions(query), SEARCH_DEBOUNCE_MS);
  }

  async function fetchSuggestions(query) {
    if (query.trim().length < MIN_SEARCH_LENGTH) {
      hideSuggestions();
      return;
    }

    const params = new URLSearchParams({
      q: query,
      format: 'json',
      countrycodes: 'ph', // bias results to the Philippines
      addressdetails: '1',
      limit: '6',
    });

    try {
      const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Nominatim request failed: ${response.status}`);
      const results = await response.json();
      renderSuggestions(results);
    } catch (err) {
      console.error('Search error:', err);
      hideSuggestions();
    }
  }

  function renderSuggestions(results) {
    currentSuggestions = results;
    activeSuggestionIndex = -1;
    els.searchSuggestions.innerHTML = '';

    if (!results.length) {
      hideSuggestions();
      return;
    }

    results.forEach((place, index) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('id', `suggestion-${index}`);
      li.innerHTML = `
        <span class="material-icons-round" aria-hidden="true">place</span>
        <span>
          ${escapeHtml(place.display_name.split(',')[0])}
          <span class="suggestion-secondary">${escapeHtml(place.display_name)}</span>
        </span>
      `;
      li.addEventListener('click', () => selectSuggestion(place));
      els.searchSuggestions.appendChild(li);
    });

    els.searchSuggestions.hidden = false;
    els.searchInput.setAttribute('aria-expanded', 'true');
  }

  function hideSuggestions() {
    els.searchSuggestions.hidden = true;
    els.searchSuggestions.innerHTML = '';
    els.searchInput.setAttribute('aria-expanded', 'false');
  }

  // Basic HTML-escaping since place names come from an external API
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function selectSuggestion(place) {
    const lat = parseFloat(place.lat);
    const lng = parseFloat(place.lon);
    const name = place.display_name.split(',')[0];

    els.searchInput.value = name;
    hideSuggestions();
    els.clearSearchBtn.hidden = false;

    setDestination({ lat, lng, name, address: place.display_name });
    saveRecentSearch({ lat, lng, name, address: place.display_name });
  }

  els.searchInput.addEventListener('input', (event) => {
    const query = event.target.value;
    els.clearSearchBtn.hidden = query.length === 0;
    if (query.length === 0) {
      hideSuggestions();
      showRecentSearches();
    } else {
      hideRecentSearches();
      debounceSearch(query);
    }
  });

  els.searchInput.addEventListener('focus', () => {
    if (els.searchInput.value.length === 0) showRecentSearches();
  });

  // Keyboard navigation through suggestions (accessibility)
  els.searchInput.addEventListener('keydown', (event) => {
    const items = els.searchSuggestions.querySelectorAll('li');
    if (!items.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, items.length - 1);
      highlightSuggestion(items);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
      highlightSuggestion(items);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeSuggestionIndex >= 0 && currentSuggestions[activeSuggestionIndex]) {
        selectSuggestion(currentSuggestions[activeSuggestionIndex]);
      } else if (currentSuggestions[0]) {
        selectSuggestion(currentSuggestions[0]);
      }
    } else if (event.key === 'Escape') {
      hideSuggestions();
    }
  });

  function highlightSuggestion(items) {
    items.forEach((item, index) => {
      item.classList.toggle('is-highlighted', index === activeSuggestionIndex);
    });
    items[activeSuggestionIndex]?.scrollIntoView({ block: 'nearest' });
  }

  els.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (currentSuggestions[0]) selectSuggestion(currentSuggestions[0]);
  });

  els.clearSearchBtn.addEventListener('click', () => {
    els.searchInput.value = '';
    els.clearSearchBtn.hidden = true;
    hideSuggestions();
    els.searchInput.focus();
    showRecentSearches();
  });

  // Click outside search overlay closes the suggestions dropdown
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search-overlay')) {
      hideSuggestions();
      hideRecentSearches();
    }
  });

  /* ==================================================================
     5. DESTINATION PIN + PREVIEW ROUTE LINE
     ================================================================== */
  function setDestination({ lat, lng, name, address }) {
    const destLatLng = [lat, lng];

    if (destinationMarker) {
      destinationMarker.setLatLng(destLatLng);
    } else {
      destinationMarker = L.marker(destLatLng, {
        icon: destinationIcon,
        zIndexOffset: 900,
      }).addTo(map);
    }

    // Draw (or redraw) a straight preview line from the user's location
    // (or current map center, if location wasn't granted) to the
    // destination. route.js will later replace/overlay this with the
    // actual multi-leg commute path once steps are generated.
    const origin = userLatLng || [map.getCenter().lat, map.getCenter().lng];

    if (previewRouteLine) {
      previewRouteLine.setLatLngs([origin, destLatLng]);
    } else {
      previewRouteLine = L.polyline([origin, destLatLng], {
        color: getComputedStyle(document.documentElement).getPropertyValue('--color-accent-500').trim() || '#F59E0B',
        weight: 4,
        opacity: 0.85,
        dashArray: '1, 10',
        lineCap: 'round',
      }).addTo(map);
    }

    map.fitBounds(L.latLngBounds([origin, destLatLng]), { padding: [80, 80] });

    showGuidePanel(name);

    // Hand off to route.js (and voice.js) — they listen for this event
    // rather than being called directly, so map.js has no hard
    // dependency on files that may not be loaded yet.
    document.dispatchEvent(
      new CustomEvent('cgph:destinationSelected', {
        detail: { lat, lng, name, address, origin: { lat: origin[0], lng: origin[1] } },
      })
    );
  }

  function showGuidePanel(destinationName) {
    els.guideEmptyState.hidden = true;
    els.guideContent.hidden = false;
    els.guideDestinationName.textContent = destinationName;
  }

  if (els.closeGuideBtn) {
    els.closeGuideBtn.addEventListener('click', () => {
      els.guideContent.hidden = true;
      els.guideEmptyState.hidden = false;
      els.guidePanel.classList.remove('is-expanded');
    });
  }

  /* ==================================================================
     6. RECENT SEARCHES (persisted in localStorage)
     ================================================================== */
  function getRecentSearches() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveRecentSearch(place) {
    let recents = getRecentSearches().filter((p) => p.name !== place.name);
    recents.unshift(place);
    recents = recents.slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recents));
    renderRecentSearches();
  }

  function renderRecentSearches() {
    const recents = getRecentSearches();
    els.recentSearchesList.innerHTML = '';
    recents.forEach((place) => {
      const li = document.createElement('li');
      li.textContent = place.name;
      li.addEventListener('click', () => {
        els.searchInput.value = place.name;
        hideRecentSearches();
        setDestination(place);
      });
      els.recentSearchesList.appendChild(li);
    });
  }

  function showRecentSearches() {
    if (getRecentSearches().length > 0) {
      renderRecentSearches();
      els.recentSearchesRow.hidden = false;
    }
  }

  function hideRecentSearches() {
    els.recentSearchesRow.hidden = true;
  }

  renderRecentSearches();

  /* ==================================================================
     7. SAVED PLACES DRAWER
     ================================================================== */
  if (els.savedPlacesBtn) {
    els.savedPlacesBtn.addEventListener('click', () => {
      const isOpen = !els.savedPlacesDrawer.hidden;
      els.savedPlacesDrawer.hidden = isOpen;
      els.savedPlacesBtn.setAttribute('aria-expanded', String(!isOpen));
    });
  }

  if (els.closeSavedPlacesBtn) {
    els.closeSavedPlacesBtn.addEventListener('click', () => {
      els.savedPlacesDrawer.hidden = true;
      els.savedPlacesBtn.setAttribute('aria-expanded', 'false');
    });
  }

  // Static placeholder saved places (Home/Work/School from the HTML)
  // are clickable stand-ins until saved-routes.js adds real Firestore-backed data.
  els.savedPlacesList?.addEventListener('click', (event) => {
    const item = event.target.closest('.saved-place-item');
    if (!item) return;
    // Placeholder coordinates (Metro Manila area) since these aren't real
    // saved locations yet — saved-routes.js will replace this with actual
    // stored coordinates per user.
    setDestination({
      lat: PH_CENTER[0] + (Math.random() - 0.5) * 0.05,
      lng: PH_CENTER[1] + (Math.random() - 0.5) * 0.05,
      name: item.dataset.place,
      address: item.dataset.place,
    });
    els.savedPlacesDrawer.hidden = true;
  });

  /* ==================================================================
     8. MOBILE BOTTOM SHEET — tap-to-expand drag handle
     ================================================================== */
  if (els.sheetDragHandle) {
    els.sheetDragHandle.addEventListener('click', () => {
      els.guidePanel.classList.toggle('is-expanded');
    });

    // Lightweight touch-drag support: expand/collapse based on swipe
    // direction rather than full free-dragging, which keeps this robust
    // without a gesture library.
    let touchStartY = 0;
    els.sheetDragHandle.addEventListener('touchstart', (event) => {
      touchStartY = event.touches[0].clientY;
    }, { passive: true });

    els.sheetDragHandle.addEventListener('touchend', (event) => {
      const touchEndY = event.changedTouches[0].clientY;
      const deltaY = touchStartY - touchEndY;
      if (deltaY > 30) els.guidePanel.classList.add('is-expanded');
      else if (deltaY < -30) els.guidePanel.classList.remove('is-expanded');
    }, { passive: true });
  }

  /* ==================================================================
     9. START GUIDE BUTTON — handed off to route.js / voice.js
     ================================================================== */
  if (els.startGuideBtn) {
    els.startGuideBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('cgph:startGuide'));
    });
  }

  /* ==================================================================
     10. HANDLE ?dest= QUERY PARAM (from the landing page hero search)
     ================================================================== */
  const urlParams = new URLSearchParams(window.location.search);
const destParam = urlParams.get('dest');
const viewParam = urlParams.get('view');

if (destParam) {
  els.searchInput.value = destParam;

fetchSuggestions(destParam).then(() => {
  if (currentSuggestions[0]) {
    selectSuggestion(currentSuggestions[0]);

    // Open guide automatically when coming from landing page
    if (viewParam === 'guide') {
      setTimeout(() => {
        if (els.guidePanel) {
          els.guidePanel.classList.add('is-expanded');
        }

        document.body.classList.add('guide-first');

      }, 500);
    }
  }
});
})();
