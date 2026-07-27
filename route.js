/* ============================================================
   route.js
   ------------------------------------------------------------
   Commute Journey Planner for the Commute Guide (CGPH).

   NEW ARCHITECTURE (Sakay-style multi-route planner):
     - Instead of building a single forced route, the planner now
       generates several suggested journeys (e.g. "3 Suggested
       Journeys") for the user to compare and pick from.
     - Each journey shows: transport modes, total fare, walking
       distance/time, estimated duration, departure/arrival time,
       and a "Start This Route" button.
     - Once a route is selected, it becomes the active trip and
       drives the existing step-by-step guide + voice navigation,
       exactly like before.

   EVENTS (unchanged names/shapes, so voice.js / favorites.js /
   fare-calculator.js keep working with zero edits):
     - Listens for: cgph:destinationSelected
     - Dispatches:  cgph:guideStarted   { fare, route, ... }
                    cgph:stepChanged    { instruction, index,
                                           total, isLast, step }
                    cgph:guideFinished  {}

   Public API (attached to window.CGPH_ROUTE):
     getRoutes()        -> array of the last generated journey options
     selectRoute(id)     -> choose a journey and begin the guide
     startGuide()        -> (re)start the guide for the selected route
     nextStep()          -> advance to the next step, or finish
     getCurrentTrip()     -> current active trip state (or null)

   Vanilla JavaScript only. No external libraries. No frameworks.
   ============================================================ */

(function () {
  "use strict";

  /* ----------------------------------------------------------
     1. CONFIGURATION
     ---------------------------------------------------------- */

  const CONFIG = {
    // How many suggested journeys to generate per search.
    optionCount: 3,

    // Minutes added per vehicle boarding to account for waiting
    // (loading/unloading passengers, waiting for the next unit, etc.)
    boardingBufferMin: 5,

    // Straight-line (haversine) distances underestimate real roads,
    // so we apply a routing factor to approximate actual travel distance.
    routingFactor: 1.35,

    // Transport mode definitions used to estimate fare & duration.
    // Fares are simplified approximations of typical PH public
    // transport pricing, NOT official/live fare matrix data.
    modes: {
      walk: { label: "Walk", icon: "🚶", speedKmh: 4.8 },
      jeep: { label: "JEEP", icon: "🚌", speedKmh: 20, baseFare: 13, baseKm: 4, perKmFare: 1.5 },
      mjeep: { label: "MJEEP", icon: "🚐", speedKmh: 22, baseFare: 15, baseKm: 4, perKmFare: 1.8 },
      bus: { label: "BUS", icon: "🚍", speedKmh: 35, baseFare: 15, baseKm: 5, perKmFare: 2.5 },
      uv: { label: "UV", icon: "🚐", speedKmh: 40, baseFare: 40, baseKm: 8, perKmFare: 2.0 },
      tricycle: { label: "TRICYCLE", icon: "🛺", speedKmh: 15, baseFare: 15, baseKm: 1, perKmFare: 5.0 },
      mrt: { label: "MRT", icon: "🚈", speedKmh: 40, baseFare: 13, baseKm: 3, perKmFare: 1.5 },
      lrt: { label: "LRT", icon: "🚈", speedKmh: 35, baseFare: 12, baseKm: 3, perKmFare: 1.3 }
    },

    // Journey templates: each is a sequence of modes with distance
    // weights (must sum to 1) describing how the total trip distance
    // is split across legs. Multiple templates = multiple options
    // with different trade-offs (fare vs. walking vs. transfers).
    journeyTemplates: [
      { modes: ["walk", "jeep", "walk"], weights: [0.07, 0.86, 0.07] },
      { modes: ["walk", "jeep", "walk"], weights: [0.11, 0.78, 0.11] },
      { modes: ["walk", "mjeep", "bus", "walk"], weights: [0.03, 0.22, 0.68, 0.07] }
    ],

    // Element IDs expected in home.html (see integration notes).
    ui: {
      plannerContainer: "routePlanner",
      optionsHeading: "routeOptionsHeading",
      optionsList: "routeOptionsList",
      stepGuideContainer: "routeStepGuide",
      stepInstruction: "routeStepInstruction",
      stepProgress: "routeStepProgress",
      nextStepBtn: "routeNextStepBtn",
      backToOptionsBtn: "routeBackToOptionsBtn"
    },

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
    origin: null, // { lat, lng, label }
    destination: null, // { lat, lng, label, address }
    routes: [], // last generated journey options
    currentTrip: null // { route, steps, currentStepIndex }
  };

  /* ----------------------------------------------------------
     3. GEO / MATH UTILITIES
     ---------------------------------------------------------- */

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  // Straight-line distance between two coordinates, in kilometers.
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function round2(num) {
    return Math.round(num * 100) / 100;
  }

  function roundUpMinutes(num) {
    return Math.max(1, Math.ceil(num));
  }

  /* ----------------------------------------------------------
     4. FARE & DURATION ESTIMATION
     ---------------------------------------------------------- */

  function estimateLegFare(modeKey, distanceKm) {
    if (modeKey === "walk") return 0;

    const mode = CONFIG.modes[modeKey];
    if (!mode) return 0;

    const extraKm = Math.max(0, distanceKm - mode.baseKm);
    return round2(mode.baseFare + extraKm * mode.perKmFare);
  }

  function estimateLegDurationMin(modeKey, distanceKm) {
    const mode = CONFIG.modes[modeKey];
    if (!mode) return 0;

    const travelMin = (distanceKm / mode.speedKmh) * 60;
    const buffer = modeKey === "walk" ? 0 : CONFIG.boardingBufferMin;
    return roundUpMinutes(travelMin + buffer);
  }

  /* ----------------------------------------------------------
     5. ROUTE GENERATION (generateRoutes — replaces generateRoute)
     ---------------------------------------------------------- */

  // Builds one journey option from a template, given the total
  // trip distance and a departure time.
  function buildRouteOption(template, totalDistanceKm, departureTime, optionIndex) {
    const legs = template.modes.map((modeKey, i) => {
      const distanceKm = round2(totalDistanceKm * template.weights[i]);
      return {
        mode: modeKey,
        distanceKm: distanceKm,
        durationMin: estimateLegDurationMin(modeKey, distanceKm),
        fare: estimateLegFare(modeKey, distanceKm)
      };
    });

    const totalFare = round2(legs.reduce((sum, leg) => sum + leg.fare, 0));
    const totalDurationMin = legs.reduce((sum, leg) => sum + leg.durationMin, 0);

    const walkLegs = legs.filter((leg) => leg.mode === "walk");
    const walkDistanceKm = round2(walkLegs.reduce((sum, leg) => sum + leg.distanceKm, 0));
    const walkDurationMin = walkLegs.reduce((sum, leg) => sum + leg.durationMin, 0);

    const vehicleLegs = legs.filter((leg) => leg.mode !== "walk");
    const transfers = Math.max(0, vehicleLegs.length - 1);

    const arrivalTime = new Date(departureTime.getTime() + totalDurationMin * 60000);

    return {
      id: `route_${Date.now()}_${optionIndex}`,
      label: `Option ${optionIndex + 1}`,
      legs: legs,
      modesSummary: buildModesSummary(legs),
      totalFare: totalFare,
      totalDurationMin: totalDurationMin,
      walkDistanceKm: walkDistanceKm,
      walkDurationMin: walkDurationMin,
      transfers: transfers,
      departureTime: departureTime,
      arrivalTime: arrivalTime
    };
  }

  // Produces a de-duplicated, ordered list of icons/labels for the
  // card header, e.g. Walk + JEEP, or Walk + MJEEP + BUS.
  function buildModesSummary(legs) {
    const summary = [];
    let lastMode = null;

    legs.forEach((leg) => {
      if (leg.mode === lastMode) return; // collapse consecutive same-mode legs
      const modeDef = CONFIG.modes[leg.mode];
      summary.push({ key: leg.mode, icon: modeDef.icon, label: modeDef.label });
      lastMode = leg.mode;
    });

    return summary;
  }

  // Generates multiple suggested journeys between origin and
  // destination. This REPLACES the old single-route generateRoute().
  function generateRoutes(origin, destination, departureTime) {
    if (!origin || !destination) {
      console.warn("[CGPH_ROUTE] Cannot generate routes without both origin and destination.");
      return [];
    }

    const straightLineKm = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng);
    const totalDistanceKm = straightLineKm * CONFIG.routingFactor;
    const startTime = departureTime || new Date();

    const routes = CONFIG.journeyTemplates
      .slice(0, CONFIG.optionCount)
      .map((template, i) => buildRouteOption(template, totalDistanceKm, startTime, i));

    // Fastest option first, like a typical commute planner.
    routes.sort((a, b) => a.totalDurationMin - b.totalDurationMin);

    // Re-label after sorting so "Option 1" is always the fastest.
    routes.forEach((route, i) => {
      route.label = `Option ${i + 1}`;
    });

    state.routes = routes;
    return routes;
  }

  function getRoutes() {
    return state.routes.slice();
  }

  /* ----------------------------------------------------------
     6. STEP-BY-STEP GUIDE GENERATION
     ---------------------------------------------------------- */

  // Converts a selected route's legs into spoken/displayed steps,
  // matching the phrasing voice.js already expects
  // (e.g. "Walk 120 meters to the jeepney terminal.").
  function buildStepsFromRoute(route) {
    const steps = [];

    route.legs.forEach((leg, index) => {
      const isFirst = index === 0;
      const isLast = index === route.legs.length - 1;
      const modeDef = CONFIG.modes[leg.mode];

      if (leg.mode === "walk") {
        if (isLast) {
          steps.push({ instruction: "Walk to your destination." });
        } else if (isFirst) {
          steps.push({ instruction: `Walk ${formatDistance(leg.distanceKm)} to the terminal.` });
        } else {
          steps.push({ instruction: `Walk ${formatDistance(leg.distanceKm)} to the next stop.` });
        }
      } else {
        steps.push({ instruction: `Ride a ${modeDef.label.toLowerCase()}.` });
        if (!isLast) {
          steps.push({ instruction: "Prepare to get off at your stop." });
        }
      }
    });

    // Tag each step with its position so voice.js's isFinalStep()
    // helper (index/total based) works without any changes.
    const total = steps.length;
    return steps.map((step, index) => ({
      ...step,
      index: index,
      total: total,
      isLast: index === total - 1
    }));
  }

  function formatDistance(km) {
    if (km < 1) {
      return `${Math.round(km * 1000)} meters`;
    }
    return `${round2(km)} km`;
  }

  /* ----------------------------------------------------------
     7. TRIP CONTROL (select / start / next)
     ---------------------------------------------------------- */

  function selectRoute(routeId) {
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) {
      console.warn(`[CGPH_ROUTE] No route found with id "${routeId}".`);
      return null;
    }

    state.currentTrip = {
      route: route,
      steps: buildStepsFromRoute(route),
      currentStepIndex: -1 // startGuide() will advance to 0
    };

    showStepGuidePanel();
    startGuide();
    return getCurrentTrip();
  }

function startGuide() {

    if (!state.currentTrip) {
        console.warn("[CGPH_ROUTE] No route selected.");
        return;
    }

    state.currentTrip.currentStepIndex = -1;

    document.dispatchEvent(
        new CustomEvent("cgph:guideStarted", {
            detail: {
                fare: state.currentTrip.route.totalFare,
                route: state.currentTrip.route
            }
        })
    );

    nextStep();
}

  function nextStep() {
    const trip = state.currentTrip;
    if (!trip) {
      console.warn("[CGPH_ROUTE] No active trip. Call selectRoute(routeId) first.");
      return;
    }

    trip.currentStepIndex += 1;

    if (trip.currentStepIndex >= trip.steps.length) {
      // Already finished — avoid re-firing guideFinished repeatedly.
      return;
    }

    const step = trip.steps[trip.currentStepIndex];
    renderStep(step);

    document.dispatchEvent(
      new CustomEvent("cgph:stepChanged", {
        detail: {
          instruction: step.instruction,
          index: step.index,
          total: step.total,
          isLast: step.isLast,
          step: step
        }
      })
    );

    if (step.isLast) {
      document.dispatchEvent(new CustomEvent("cgph:guideFinished", { detail: {} }));
    }
  }

  function getCurrentTrip() {
    if (!state.currentTrip) return null;

    return {
      route: state.currentTrip.route,
      currentStepIndex: state.currentTrip.currentStepIndex,
      totalSteps: state.currentTrip.steps.length,
      currentStep: state.currentTrip.steps[state.currentTrip.currentStepIndex] || null
    };
  }

  /* ----------------------------------------------------------
     8. ORIGIN / DESTINATION RESOLUTION
     ---------------------------------------------------------- */

  // Accepts flexible field names so this stays compatible with
  // map.js and favorites.js without requiring changes to them.
  function extractPlace(detail, prefix) {
    if (!detail) return null;

    const lat = detail.lat ?? detail.latitude ?? null;
    const lng = detail.lng ?? detail.lon ?? detail.longitude ?? null;

    if (lat === null || lng === null) return null;

    return {
      lat: lat,
      lng: lng,
      label: detail.name || detail.address || (prefix === "origin" ? "Current Location" : "Destination"),
      address: detail.address || ""
    };
  }

  function resolveOriginThenPlan(detail, destination) {
    // 1) favorites.js (goHome) already supplies an origin.
    const providedOrigin = extractPlace(detail.origin, "origin");
    if (providedOrigin) {
      state.origin = providedOrigin;
      planJourneys();
      return;
    }

    // 2) Otherwise, fall back to the device's current location.
    if (!("geolocation" in navigator)) {
      console.warn("[CGPH_ROUTE] Geolocation unavailable and no origin provided.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.origin = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: "Current Location",
          address: ""
        };
        planJourneys();
      },
      (error) => {
        console.warn("[CGPH_ROUTE] Could not determine current location.", error);
      },
      CONFIG.geolocationOptions
    );
  }

function planJourneys() {
    if (!state.origin || !state.destination) return;

    const routes = generateRoutes(
        state.origin,
        state.destination,
        new Date()
    );

    state.routes = routes;

    // Automatically prepare first route for Start Guide button
    if (routes.length > 0) {
        state.currentTrip = {
            route: routes[0],
            steps: buildStepsFromRoute(routes[0]),
            currentStepIndex: -1
        };
    }

    renderRouteOptions(
        routes,
        state.origin.label,
        state.destination.label
    );

    showOptionsPanel();
}

  /* ----------------------------------------------------------
     9. EVENT: cgph:destinationSelected
     ---------------------------------------------------------- */

  function handleDestinationSelected(event) {
    const detail = event && event.detail;
    const destination = extractPlace(detail, "destination");

    if (!destination) {
      console.warn("[CGPH_ROUTE] cgph:destinationSelected fired without valid coordinates.");
      return;
    }

    state.destination = destination;
    state.currentTrip = null; // any previous trip is no longer relevant

    resolveOriginThenPlan(detail || {}, destination);
  }

  /* ----------------------------------------------------------
     10. UI RENDERING — JOURNEY OPTIONS (graceful no-op if absent)
     ---------------------------------------------------------- */

  function formatTime(date) {
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    const mm = minutes < 10 ? `0${minutes}` : `${minutes}`;
    return `${hours}:${mm} ${ampm}`;
  }

  function formatDuration(totalMin) {
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hrs === 0) return `${mins} mins`;
    return `${hrs} hr${hrs > 1 ? "s" : ""} ${mins} min${mins !== 1 ? "s" : ""}`;
  }

  function renderRouteOptions(routes, originLabel, destinationLabel) {
    const heading = document.getElementById(CONFIG.ui.optionsHeading);
    if (heading) {
      heading.textContent = `${routes.length} Suggested Journeys`;
    }

    const list = document.getElementById(CONFIG.ui.optionsList);
    if (!list) {
      console.warn(
        `[CGPH_ROUTE] #${CONFIG.ui.optionsList} not found — journey cards cannot be displayed. ` +
        "See integration notes to add the planner markup."
      );
      return;
    }

    list.innerHTML = "";
    routes.forEach((route) => list.appendChild(buildRouteCard(route)));
  }

  function buildRouteCard(route) {
    const card = document.createElement("article");
    card.className = "cgph-route-card";
    card.dataset.routeId = route.id;

    const label = document.createElement("div");
    label.className = "cgph-route-label";
    label.textContent = route.label;
    card.appendChild(label);

    // Transport mode icon row (Walk + each vehicle mode in order).
    const modesRow = document.createElement("div");
    modesRow.className = "cgph-route-modes";
    route.modesSummary.forEach((m) => {
      const badge = document.createElement("span");
      badge.className = "cgph-route-mode-badge";
      badge.textContent = `${m.icon} ${m.label}`;
      modesRow.appendChild(badge);
    });
    card.appendChild(modesRow);

    // Fare
    const fare = document.createElement("div");
    fare.className = "cgph-route-fare";
    fare.textContent = `₱${route.totalFare.toFixed(2)}`;
    card.appendChild(fare);

    // Walk + duration + times
    const details = document.createElement("div");
    details.className = "cgph-route-details";
    details.innerHTML = ""; // built with elements below (no inline HTML strings with data)

    details.appendChild(buildDetailLine(`🚶 ${formatWalkTime(route.walkDurationMin)} walk`));
    details.appendChild(buildDetailLine(`${formatTime(route.departureTime)} → ${formatTime(route.arrivalTime)}`));
    details.appendChild(buildDetailLine(`⏱ ${formatDuration(route.totalDurationMin)}`));
    if (route.transfers > 0) {
      details.appendChild(buildDetailLine(`🔁 ${route.transfers} transfer${route.transfers > 1 ? "s" : ""}`));
    }
    card.appendChild(details);

    // Start button
    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "cgph-route-start-btn";
    startBtn.textContent = "Start This Route";
    startBtn.addEventListener("click", () => selectRoute(route.id));
    card.appendChild(startBtn);

    return card;
  }

  function buildDetailLine(text) {
    const line = document.createElement("div");
    line.className = "cgph-route-detail-line";
    line.textContent = text;
    return line;
  }

  function formatWalkTime(min) {
    return `${min} min`;
  }

  function showOptionsPanel() {
    toggle(CONFIG.ui.optionsList, true); // ensure the journey list is visible
    const optionsHeading = document.getElementById(CONFIG.ui.optionsHeading);
    if (optionsHeading) optionsHeading.hidden = false;

    const stepPanel = document.getElementById(CONFIG.ui.stepGuideContainer);
    if (stepPanel) stepPanel.hidden = true;

    const plannerPanel = document.getElementById(CONFIG.ui.plannerContainer);
    if (plannerPanel) plannerPanel.hidden = false;
  }

  function toggle(elementId, visible) {
    const el = document.getElementById(elementId);
    if (el) el.hidden = !visible;
  }

  /* ----------------------------------------------------------
     11. UI RENDERING — STEP-BY-STEP GUIDE
     ---------------------------------------------------------- */

  function showStepGuidePanel() {
    const stepPanel = document.getElementById(CONFIG.ui.stepGuideContainer);
    if (stepPanel) stepPanel.hidden = false;

    toggle(CONFIG.ui.optionsList, false);
    const optionsHeading = document.getElementById(CONFIG.ui.optionsHeading);
    if (optionsHeading) optionsHeading.hidden = true;
  }

  function renderStep(step) {
    const instructionEl = document.getElementById(CONFIG.ui.stepInstruction);
    if (instructionEl) instructionEl.textContent = step.instruction;

    const progressEl = document.getElementById(CONFIG.ui.stepProgress);
    if (progressEl) progressEl.textContent = `Step ${step.index + 1} of ${step.total}`;

    const nextBtn = document.getElementById(CONFIG.ui.nextStepBtn);
    if (nextBtn) nextBtn.hidden = step.isLast;
  }

  function backToOptions() {
    state.currentTrip = null;
    showOptionsPanel();
  }

function wireStepGuideButtons() {

  const startBtn = document.getElementById("startGuideBtn");

  if (startBtn) {
    startBtn.addEventListener("click", () => {
      startGuide();
    });
  }


  const nextBtn = document.getElementById(CONFIG.ui.nextStepBtn);

  if (nextBtn) {
    nextBtn.addEventListener("click", nextStep);
  }


  const backBtn = document.getElementById(CONFIG.ui.backToOptionsBtn);

  if (backBtn) {
    backBtn.addEventListener("click", backToOptions);
  }

}

  /* ----------------------------------------------------------
     12. INITIALIZATION
     ---------------------------------------------------------- */

function init() {
    document.addEventListener(
        "cgph:destinationSelected",
        handleDestinationSelected
    );

    document.addEventListener(
        "cgph:startGuide",
        () => {
            startGuide();
        }
    );

    wireStepGuideButtons();
}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* ----------------------------------------------------------
     13. PUBLIC API
     ---------------------------------------------------------- */

  window.CGPH_ROUTE = {
    getRoutes: getRoutes,
    selectRoute: selectRoute,
    startGuide: startGuide,
    nextStep: nextStep,
    getCurrentTrip: getCurrentTrip
  };
})();
