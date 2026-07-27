/**
 * route.js
 * ---------------------------------------------------------------------------
 * CGPH Commute Route Module
 *
 * Rebuilt from scratch to work with the EXISTING home.html only.
 * No planner architecture. No journey cards. No route selection screen.
 *
 * Responsibilities:
 *   1. Listen for 'cgph:destinationSelected' (dispatched by map.js).
 *   2. Generate ONE commute route using a local, swappable algorithm.
 *   3. Populate the existing summary / step / progress DOM elements.
 *   4. Drive the step-by-step guide (Start Guide / Next Step) and dispatch
 *      'cgph:guideStarted', 'cgph:stepChanged', 'cgph:guideFinished' so
 *      voice.js keeps working unmodified.
 *   5. Expose window.CGPH_ROUTE = { startGuide, nextStep, getCurrentTrip }.
 *
 * Design notes:
 *   - The route-generation logic lives entirely inside the RouteGenerator
 *     object. To later plug in Firestore-sourced routes, replace
 *     RouteGenerator.generate() with a version that fetches real data but
 *     returns the same { steps, fare, timeMinutes, distanceKm } shape.
 *   - No innerHTML string building anywhere; all DOM nodes are created with
 *     document.createElement / textContent.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  const CONFIG = {
    // Fallback origin if geolocation is unavailable or not yet resolved
    // (Manila, Philippines, used only as a safe default reference point).
    DEFAULT_ORIGIN: { lat: 14.5995, lng: 120.9842 },

    // Average speeds (km/h) used to estimate travel time.
    WALK_SPEED_KMH: 4.5,
    JEEP_SPEED_KMH: 18,
    BUS_SPEED_KMH: 22,

    // Fixed short walking legs (terminal access / final approach).
    WALK_TO_TERMINAL_KM: 0.3,
    WALK_TO_DESTINATION_KM: 0.3,

    // Distance below which we just walk the whole way (no PUV needed).
    DIRECT_WALK_THRESHOLD_KM: 1.5,

    // Max distance a single jeepney leg reasonably covers before a
    // transfer to a bus is more realistic.
    JEEP_MAX_LEG_KM: 6,

    // Jeepney fare (approx. PH minimum fare matrix).
    JEEP_BASE_FARE: 13,
    JEEP_BASE_KM: 4,
    JEEP_PER_KM_RATE: 1.5,

    // Bus fare (approx. PH ordinary bus fare matrix).
    BUS_BASE_FARE: 15,
    BUS_BASE_KM: 5,
    BUS_PER_KM_RATE: 2.2,

    // Minutes added for a transfer wait between legs.
    TRANSFER_WAIT_MINUTES: 5,

    GEOLOCATION_TIMEOUT_MS: 5000
  };

  // ===========================================================================
  // STATE
  // ===========================================================================

  // Cached last-known device position (best-effort, non-blocking).
  let lastKnownPosition = null;

  // The active trip. Null until a destination has been received.
  // Shape:
  // {
  //   destinationName, origin, destination,
  //   steps: [{ label, detail, durationMin, distanceKm, fare }],
  //   totalFare, totalTimeMin, totalDistanceKm,
  //   currentStepIndex, guideActive
  // }
  let currentTrip = null;

  // ===========================================================================
  // DOM CACHE
  // ===========================================================================

  const dom = {};

  function cacheDom() {
    dom.guidePanel = document.getElementById('guidePanel');
    dom.guideContent = document.getElementById('guideContent');
    dom.guideEmptyState = document.getElementById('guideEmptyState');
    dom.guideDestinationName = document.getElementById('guideDestinationName');
    dom.summaryFare = document.getElementById('summaryFare');
    dom.summaryTime = document.getElementById('summaryTime');
    dom.summaryDistance = document.getElementById('summaryDistance');
    dom.currentStepCard = document.getElementById('currentStepCard');
    dom.currentStepText = document.getElementById('currentStepText');
    dom.nextStepCard = document.getElementById('nextStepCard');
    dom.nextStepText = document.getElementById('nextStepText');
    dom.stepsList = document.getElementById('stepsList');
    dom.guideProgressFill = document.getElementById('guideProgressFill');
    dom.startGuideBtn = document.getElementById('startGuideBtn');
    // voiceToggleBtn intentionally not touched here; voice.js owns it.
  }

  // ===========================================================================
  // GEOLOCATION (best effort, non-blocking)
  // ===========================================================================

  function primeGeolocation() {
    if (!('geolocation' in navigator)) return;

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        lastKnownPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };
      },
      function () {
        // Silently ignore; we fall back to CONFIG.DEFAULT_ORIGIN.
      },
      { timeout: CONFIG.GEOLOCATION_TIMEOUT_MS }
    );
  }

  function getOrigin() {
    return lastKnownPosition || CONFIG.DEFAULT_ORIGIN;
  }

  // ===========================================================================
  // GEO MATH
  // ===========================================================================

  function toRadians(deg) {
    return (deg * Math.PI) / 180;
  }

  // Haversine great-circle distance in kilometers.
  function calculateDistanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth radius in km
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ===========================================================================
  // FARE HELPERS
  // ===========================================================================

  function jeepneyFare(km) {
    if (km <= CONFIG.JEEP_BASE_KM) return CONFIG.JEEP_BASE_FARE;
    const extraKm = Math.ceil(km - CONFIG.JEEP_BASE_KM);
    return Math.round(CONFIG.JEEP_BASE_FARE + extraKm * CONFIG.JEEP_PER_KM_RATE);
  }

  function busFare(km) {
    if (km <= CONFIG.BUS_BASE_KM) return CONFIG.BUS_BASE_FARE;
    const extraKm = Math.ceil(km - CONFIG.BUS_BASE_KM);
    return Math.round(CONFIG.BUS_BASE_FARE + extraKm * CONFIG.BUS_PER_KM_RATE);
  }

  function minutesForDistance(km, speedKmh) {
    return Math.max(1, Math.round((km / speedKmh) * 60));
  }

  // ===========================================================================
  // ROUTE GENERATOR (swap this module out later for Firestore-backed data)
// ===========================================================================

const RouteGenerator = {

  generate: function (origin, destination) {

    if (!window.ROUTE_ENGINE) {
      console.error("ROUTE_ENGINE not loaded.");
      return null;
    }


    const routes = window.ROUTE_ENGINE.searchRoutes(
      origin,
      destination
    );


    if (!routes || routes.length === 0) {
      console.warn("No real transport routes found.");
      return null;
    }


    const bestRoute = routes[0];


    const steps = window.ROUTE_ENGINE.buildJourney(
      bestRoute
    );


    return {
      steps: steps,
      totalFare: bestRoute.totalFare,
      totalTimeMin: bestRoute.totalTimeMin,
      totalDistanceKm: bestRoute.totalDistanceKm
    };

  }

};
  // ===========================================================================
  // RENDERING
  // ===========================================================================

  function showGuideContent() {
    if (dom.guideEmptyState) dom.guideEmptyState.style.display = 'none';
    if (dom.guideContent) dom.guideContent.style.display = '';
    if (dom.guidePanel) dom.guidePanel.classList.add('has-route');
  }

  // Rebuilds the visible step list from the current trip's steps.
  // Uses DOM APIs only (no innerHTML strings).
  function renderStepsList() {
    if (!dom.stepsList || !currentTrip) return;

    // Clear existing children.
    while (dom.stepsList.firstChild) {
      dom.stepsList.removeChild(dom.stepsList.firstChild);
    }

    currentTrip.steps.forEach(function (step, index) {
      const li = document.createElement('li');
      li.className = 'route-step-item';
      li.setAttribute('data-step-index', String(index));

      const label = document.createElement('span');
      label.className = 'route-step-label';
      label.textContent = step.label;

      const detail = document.createElement('span');
      detail.className = 'route-step-detail';
      detail.textContent = step.detail;

      li.appendChild(label);
      li.appendChild(detail);
      dom.stepsList.appendChild(li);
    });

    updateStepListHighlighting();
  }

  // Applies is-completed / is-current / is-upcoming classes to step list items
  // based on currentTrip.currentStepIndex. Purely additive classes; no HTML
  // structure changes required.
  function updateStepListHighlighting() {
    if (!dom.stepsList || !currentTrip) return;

    const items = dom.stepsList.querySelectorAll('.route-step-item');
    items.forEach(function (item) {
      const idx = parseInt(item.getAttribute('data-step-index'), 10);
      item.classList.remove('is-completed', 'is-current', 'is-upcoming');

      if (!currentTrip.guideActive) {
        item.classList.add('is-upcoming');
        return;
      }

      if (idx < currentTrip.currentStepIndex) {
        item.classList.add('is-completed');
      } else if (idx === currentTrip.currentStepIndex) {
        item.classList.add('is-current');
      } else {
        item.classList.add('is-upcoming');
      }
    });
  }

  // Updates current/next step cards and text.
  function updateStepCards() {
    if (!currentTrip) return;

    const steps = currentTrip.steps;
    const idx = currentTrip.currentStepIndex;
    const current = steps[idx] || null;
    const next = steps[idx + 1] || null;

    if (dom.currentStepText) {
      dom.currentStepText.textContent = current
        ? current.label + ' — ' + current.detail
        : 'Guide not started yet.';
    }

    if (dom.nextStepText) {
      dom.nextStepText.textContent = next
        ? next.label
        : (currentTrip.guideActive ? 'This is the last step.' : '—');
    }

    if (dom.currentStepCard) {
      dom.currentStepCard.classList.toggle('active', Boolean(current) && currentTrip.guideActive);
    }
    if (dom.nextStepCard) {
      dom.nextStepCard.classList.toggle('active', Boolean(next) && currentTrip.guideActive);
    }
  }

  function updateProgressBar() {
    if (!dom.guideProgressFill || !currentTrip) return;

    const totalSteps = currentTrip.steps.length;
    let percent = 0;

    if (currentTrip.guideActive && totalSteps > 0) {
      // +1 so the first step already shows some progress once started.
      percent = Math.min(
        100,
        Math.round(((currentTrip.currentStepIndex + 1) / totalSteps) * 100)
      );
    }

    dom.guideProgressFill.style.width = percent + '%';
  }

  // Renders the trip summary fields (destination, fare, time, distance).
  function renderTripSummary() {
    if (!currentTrip) return;

    if (dom.guideDestinationName) {
      dom.guideDestinationName.textContent = currentTrip.destinationName;
    }
    if (dom.summaryFare) {
      dom.summaryFare.textContent = '₱' + currentTrip.totalFare.toFixed(2);
    }
    if (dom.summaryTime) {
      dom.summaryTime.textContent = currentTrip.totalTimeMin + ' min';
    }
    if (dom.summaryDistance) {
      dom.summaryDistance.textContent = currentTrip.totalDistanceKm.toFixed(1) + ' km';
    }
  }

  function renderAll() {
    renderTripSummary();
    renderStepsList();
    updateStepCards();
    updateProgressBar();
  }

  // ===========================================================================
  // EVENT DISPATCH HELPERS
  // ===========================================================================

  function dispatchGuideEvent(eventName, extraDetail) {
    const detail = Object.assign(
      {
        destinationName: currentTrip ? currentTrip.destinationName : null,
        stepIndex: currentTrip ? currentTrip.currentStepIndex : -1,
        totalSteps: currentTrip ? currentTrip.steps.length : 0,
        step:
          currentTrip && currentTrip.steps[currentTrip.currentStepIndex]
            ? currentTrip.steps[currentTrip.currentStepIndex]
            : null
      },
      extraDetail || {}
    );

    document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
  }

  // ===========================================================================
  // CORE FLOW: destination received -> route generated & prepared
  // ===========================================================================

  function handleDestinationSelected(evt) {
    const detail = evt && evt.detail ? evt.detail : {};

    // Accept a couple of reasonable shapes for the destination payload.
    const lat = detail.lat != null ? detail.lat : (detail.coordinates && detail.coordinates.lat);
    const lng = detail.lng != null ? detail.lng : (detail.coordinates && detail.coordinates.lng);

    if (lat == null || lng == null) {
      console.warn('[route.js] cgph:destinationSelected received without valid coordinates.');
      return;
    }

    const destination = { lat: lat, lng: lng };
    const destinationName = detail.name || detail.destinationName || 'Selected Destination';
    const origin = getOrigin();

const generated = RouteGenerator.generate(origin, destination);

if (!generated) {
  console.warn('[route.js] No route generated.');
  return;
}

currentTrip = {
  destinationName: destinationName,
  origin: origin,
  destination: destination,
  steps: generated.steps,
  totalFare: generated.totalFare,
  totalTimeMin: generated.totalTimeMin,
  totalDistanceKm: generated.totalDistanceKm,
  currentStepIndex: 0,
  guideActive: false
};

    showGuideContent();
    renderAll();

    // Start Guide button is now actionable; no extra wiring needed here
    // since the click listener is already bound once at init time.
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

function startGuide() {

    console.log("START GUIDE CLICKED");
    console.log("CURRENT TRIP:", currentTrip);

    if (!currentTrip) {
      console.warn('[route.js] startGuide() called before a route was generated.');
      return;
    }
    if (currentTrip.steps.length === 0) {
      console.warn('[route.js] startGuide() called with an empty step list.');
      return;
    }

    currentTrip.guideActive = true;
    currentTrip.currentStepIndex = 0;

    renderStepsList();
    updateStepCards();
    updateProgressBar();

    dispatchGuideEvent('cgph:guideStarted');
  }
    startAutoGuide();
  let autoGuideTimer = null;



function startGuide() {

    console.log("START GUIDE CLICKED");
    console.log("CURRENT TRIP:", currentTrip);

    if (!currentTrip) {
      console.warn('[route.js] startGuide() called before a route was generated.');
      return;
    }

    if (currentTrip.steps.length === 0) {
      console.warn('[route.js] startGuide() called with an empty step list.');
      return;
    }

    currentTrip.guideActive = true;
    currentTrip.currentStepIndex = 0;

    renderStepsList();
    updateStepCards();
    updateProgressBar();

    dispatchGuideEvent('cgph:guideStarted');

    startAutoGuide();
}


function startAutoGuide() {

  if (autoGuideTimer) {
    clearInterval(autoGuideTimer);
  }

  autoGuideTimer = setInterval(() => {

    if (!currentTrip || !currentTrip.guideActive) {
      clearInterval(autoGuideTimer);
      return;
    }


    if (currentTrip.currentStepIndex < currentTrip.steps.length - 1) {

      nextStep();

    } else {

      clearInterval(autoGuideTimer);

    }

  }, 5000);

}
  function nextStep() {
    if (!currentTrip || !currentTrip.guideActive) {
      console.warn('[route.js] nextStep() called before the guide was started.');
      return;
    }

    const isLastStep = currentTrip.currentStepIndex >= currentTrip.steps.length - 1;

    if (isLastStep) {
      dispatchGuideEvent('cgph:guideFinished');
      currentTrip.guideActive = false;
      updateStepListHighlighting();
      updateProgressBar();
      return;
    }

    currentTrip.currentStepIndex += 1;

    updateStepListHighlighting();
    updateStepCards();
    updateProgressBar();

    dispatchGuideEvent('cgph:stepChanged');
  }

  function getCurrentTrip() {
    if (!currentTrip) return null;

    // Return a shallow copy so external code cannot mutate internal state.
    return {
      destinationName: currentTrip.destinationName,
      origin: currentTrip.origin,
      destination: currentTrip.destination,
      steps: currentTrip.steps.slice(),
      totalFare: currentTrip.totalFare,
      totalTimeMin: currentTrip.totalTimeMin,
      totalDistanceKm: currentTrip.totalDistanceKm,
      currentStepIndex: currentTrip.currentStepIndex,
      guideActive: currentTrip.guideActive
    };
  }

  // ===========================================================================
  // INIT
  // ===========================================================================

  function init() {
    cacheDom();
    primeGeolocation();

    document.addEventListener('cgph:destinationSelected', handleDestinationSelected);

    if (dom.startGuideBtn) {
      dom.startGuideBtn.addEventListener('click', startGuide);
    } else {
      console.warn('[route.js] #startGuideBtn not found in DOM.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose the public API expected by voice.js / other scripts.
  window.CGPH_ROUTE = {
    startGuide: startGuide,
    nextStep: nextStep,
    getCurrentTrip: getCurrentTrip
  };
})();
