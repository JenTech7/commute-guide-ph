/* ============================================================
   fare-calculator.js
   ------------------------------------------------------------
   Smart Fare Calculator for the Commute Guide (CGPH).

   Purpose:
     - Let commuters pick a passenger type (Regular, Student,
       Senior Citizen, PWD) with large, simple, touch-friendly
       controls.
     - Show Regular Fare, Discounted Fare, and Savings clearly.
     - Automatically recalculate whenever route.js generates a
       new route / destination is selected (if route.js provides
       a base fare). Manual entry is also supported as a fallback,
       since posted jeepney/bus fares often need to be typed in.

   Design rules followed:
     - Very simple UI: large buttons, large text, high contrast.
     - Mobile-first, minimal taps, minimal scrolling.
     - Matches the app's existing glassmorphism look using CSS
       custom properties already defined in variables.css when
       available, with safe fallbacks otherwise.
     - Does NOT redesign the page — only builds a small, self
       contained widget inside an existing placeholder.
     - Does NOT duplicate route.js's routing/fare logic — it only
       reads a fare value if route.js provides one, and otherwise
       lets the user enter it manually.

   Public API (attached to window.CGPH_FARE):
     setPassengerType(type)
     calculateFare(baseFare)
     getCurrentFare()
     reset()

   Vanilla JavaScript only. No external libraries. No inline HTML.
   ============================================================ */

(function () {
  "use strict";

  /* ----------------------------------------------------------
     1. CONFIGURATION
     ---------------------------------------------------------- */

  const CONFIG = {
    // Government-mandated discount rate (RA 9994 - Senior Citizens,
    // RA 10754 - PWD, and standard student fare discount) = 20%.
    discountRates: {
      regular: 0,
      student: 0.20,
      senior: 0.20,
      pwd: 0.20
    },

    passengerLabels: {
      regular: "Regular",
      student: "🎓 Student",
      senior: "👴 Senior Citizen",
      pwd: "♿ PWD"
    },

    defaultPassengerType: "regular",

    currencySymbol: "₱",

    // Element IDs expected inside the existing #fareCalculator
    // placeholder in home.html (see integration snippet).
    ui: {
      container: "fareCalculator",
      passengerButtons: "farePassengerButtons", // wraps the 4 buttons
      baseFareInput: "fareBaseFareInput",
      calculateBtn: "fareCalculateBtn",
      regularFareValue: "fareRegularValue",
      discountedFareValue: "fareDiscountedValue",
      savingsValue: "fareSavingsValue",
      discountRow: "fareDiscountRow", // hidden when passenger = regular
      resultsPanel: "fareResultsPanel"
    }
  };

  /* ----------------------------------------------------------
     2. INTERNAL STATE
     ---------------------------------------------------------- */

  const state = {
    passengerType: CONFIG.defaultPassengerType,
    baseFare: null, // null until route.js provides one or user enters one
    currentFare: null // last calculated result object
  };

  /* ----------------------------------------------------------
     3. UTILITIES
     ---------------------------------------------------------- */

  function formatCurrency(amount) {
    return CONFIG.currencySymbol + amount.toFixed(2);
  }

  function isValidPassengerType(type) {
    return Object.prototype.hasOwnProperty.call(CONFIG.discountRates, type);
  }

  // Rounds to the nearest centavo to avoid floating point artifacts
  // like ₱14.399999999999999.
  function round2(num) {
    return Math.round(num * 100) / 100;
  }

  /* ----------------------------------------------------------
     4. CORE FARE LOGIC
     ---------------------------------------------------------- */

  function setPassengerType(type) {
    if (!isValidPassengerType(type)) {
      console.warn(`[CGPH_FARE] Unknown passenger type "${type}". Ignoring.`);
      return;
    }

    state.passengerType = type;
    highlightActiveButton(type);

    // Recalculate immediately if we already have a base fare.
    if (state.baseFare !== null) {
      calculateFare(state.baseFare);
    }
  }

  // Calculates Regular Fare / Discounted Fare / Savings for the
  // currently selected passenger type, given a base (regular) fare.
  // This is the ONLY place fare math happens — route.js should never
  // need to duplicate this, and this file never duplicates route.js's
  // distance/routing logic.
  function calculateFare(baseFare) {
    const parsed = Number(baseFare);

    if (Number.isNaN(parsed) || parsed < 0) {
      console.warn("[CGPH_FARE] Invalid base fare provided:", baseFare);
      return null;
    }

    state.baseFare = parsed;

    const discountRate = CONFIG.discountRates[state.passengerType] || 0;
    const discountedFare = round2(parsed * (1 - discountRate));
    const savings = round2(parsed - discountedFare);

    state.currentFare = {
      passengerType: state.passengerType,
      regularFare: round2(parsed),
      discountedFare: discountedFare,
      savings: savings,
      hasDiscount: discountRate > 0
    };

    renderFare();
    return Object.assign({}, state.currentFare); // return a safe copy
  }

  function getCurrentFare() {
    return state.currentFare ? Object.assign({}, state.currentFare) : null;
  }

  function reset() {
    state.passengerType = CONFIG.defaultPassengerType;
    state.baseFare = null;
    state.currentFare = null;

    highlightActiveButton(state.passengerType);
    clearResultsDisplay();

    const input = document.getElementById(CONFIG.ui.baseFareInput);
    if (input) input.value = "";
  }

  /* ----------------------------------------------------------
     5. ROUTE.JS INTEGRATION (read-only — no duplicated logic)
     ---------------------------------------------------------- */

  // route.js may include a fare value using different field names
  // depending on how it's implemented. This helper checks the most
  // likely spots without assuming a rigid shape, so fare-calculator.js
  // keeps working even if route.js evolves.
  function extractBaseFare(detail) {
    if (!detail || typeof detail !== "object") return null;

    const candidates = [
      detail.fare,
      detail.baseFare,
      detail.estimatedFare,
      detail.route && detail.route.fare,
      detail.route && detail.route.baseFare
    ];

    const found = candidates.find(
      (val) => typeof val === "number" && !Number.isNaN(val)
    );

    return found !== undefined ? found : null;
  }

  // When a new guide starts, try to auto-pick up a fare from route.js.
  // If none is present, the calculator simply waits for manual entry.
  function handleGuideStarted(event) {
    const detail = event && event.detail;
    const fare = extractBaseFare(detail);

    if (fare !== null) {
      calculateFare(fare);
    }
  }

  // A fresh destination means the previous fare no longer applies.
  function handleDestinationSelected() {
    state.baseFare = null;
    state.currentFare = null;
    clearResultsDisplay();
  }

  function wireRouteEvents() {
    document.addEventListener("cgph:guideStarted", handleGuideStarted);
    document.addEventListener("cgph:destinationSelected", handleDestinationSelected);
  }

  /* ----------------------------------------------------------
     6. UI RENDERING (graceful no-op if markup isn't present)
     ---------------------------------------------------------- */

  function renderFare() {
    const fare = state.currentFare;
    if (!fare) return;

    const regularEl = document.getElementById(CONFIG.ui.regularFareValue);
    const discountedEl = document.getElementById(CONFIG.ui.discountedFareValue);
    const savingsEl = document.getElementById(CONFIG.ui.savingsValue);
    const discountRow = document.getElementById(CONFIG.ui.discountRow);
    const resultsPanel = document.getElementById(CONFIG.ui.resultsPanel);

    if (regularEl) regularEl.textContent = formatCurrency(fare.regularFare);

    if (fare.hasDiscount) {
      if (discountedEl) discountedEl.textContent = formatCurrency(fare.discountedFare);
      if (savingsEl) savingsEl.textContent = formatCurrency(fare.savings);
      if (discountRow) discountRow.hidden = false;
    } else {
      // Regular passengers: no discount row clutter — keep it simple.
      if (discountRow) discountRow.hidden = true;
    }

    if (resultsPanel) resultsPanel.hidden = false;
  }

  function clearResultsDisplay() {
    const resultsPanel = document.getElementById(CONFIG.ui.resultsPanel);
    if (resultsPanel) resultsPanel.hidden = true;
  }

  function highlightActiveButton(type) {
    const wrap = document.getElementById(CONFIG.ui.passengerButtons);
    if (!wrap) return;

    const buttons = wrap.querySelectorAll("[data-passenger-type]");
    buttons.forEach((btn) => {
      const isActive = btn.dataset.passengerType === type;
      btn.classList.toggle("cgph-fare-btn-active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });
  }

  /* ----------------------------------------------------------
     7. BUILDING THE WIDGET (only if the placeholder exists)
     ---------------------------------------------------------- */

  // Builds the passenger-type buttons and results panel INSIDE the
  // existing #fareCalculator placeholder. If home.html already
  // contains fully custom markup with the same IDs, this function
  // still works — it only fills in missing pieces, it never
  // overwrites a container that already has content.
  function buildWidgetIfNeeded() {
    const container = document.getElementById(CONFIG.ui.container);
    if (!container) {
      console.warn(
        `[CGPH_FARE] #${CONFIG.ui.container} not found in the page. ` +
        "Add the placeholder from the integration snippet to show the Fare Calculator."
      );
      return;
    }

    // If the container is already populated (e.g. hand-built markup
    // matching our IDs), don't touch it — just wire up behavior.
    if (container.children.length > 0) return;

    container.classList.add("cgph-fare-widget");

    const heading = document.createElement("h3");
    heading.className = "cgph-fare-heading";
    heading.textContent = "Fare Information";
    container.appendChild(heading);

    // --- Passenger type buttons ---
    const buttonWrap = document.createElement("div");
    buttonWrap.id = CONFIG.ui.passengerButtons;
    buttonWrap.className = "cgph-fare-passenger-grid";
    buttonWrap.setAttribute("role", "group");
    buttonWrap.setAttribute("aria-label", "Select passenger type");

    Object.keys(CONFIG.passengerLabels).forEach((type) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cgph-fare-btn";
      btn.dataset.passengerType = type;
      btn.textContent = CONFIG.passengerLabels[type];
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => setPassengerType(type));
      buttonWrap.appendChild(btn);
    });

    container.appendChild(buttonWrap);

    // --- Manual base fare entry (fallback if route.js has no fare) ---
    const inputRow = document.createElement("div");
    inputRow.className = "cgph-fare-input-row";

    const input = document.createElement("input");
    input.id = CONFIG.ui.baseFareInput;
    input.type = "number";
    input.inputMode = "decimal";
    input.min = "0";
    input.step = "0.01";
    input.placeholder = "Enter fare (e.g. 18.00)";
    input.className = "cgph-fare-input";
    input.setAttribute("aria-label", "Regular fare amount in pesos");

    const calcBtn = document.createElement("button");
    calcBtn.id = CONFIG.ui.calculateBtn;
    calcBtn.type = "button";
    calcBtn.className = "cgph-fare-btn cgph-fare-calculate-btn";
    calcBtn.textContent = "Calculate";
    calcBtn.addEventListener("click", () => {
      calculateFare(input.value);
    });

    inputRow.appendChild(input);
    inputRow.appendChild(calcBtn);
    container.appendChild(inputRow);

    // --- Results panel ---
    const results = document.createElement("div");
    results.id = CONFIG.ui.resultsPanel;
    results.className = "cgph-fare-results";
    results.hidden = true;

    results.appendChild(buildFareRow("Regular Fare:", CONFIG.ui.regularFareValue));

    const discountRow = document.createElement("div");
    discountRow.id = CONFIG.ui.discountRow;
    discountRow.className = "cgph-fare-discount-rows";
    discountRow.hidden = true;
    discountRow.appendChild(buildFareRow("Discounted Fare:", CONFIG.ui.discountedFareValue));
    discountRow.appendChild(buildFareRow("Savings:", CONFIG.ui.savingsValue));
    results.appendChild(discountRow);

    container.appendChild(results);
  }

  function buildFareRow(labelText, valueId) {
    const row = document.createElement("div");
    row.className = "cgph-fare-row";

    const label = document.createElement("span");
    label.className = "cgph-fare-label";
    label.textContent = labelText;

    const value = document.createElement("span");
    value.id = valueId;
    value.className = "cgph-fare-value";
    value.textContent = "—";

    row.appendChild(label);
    row.appendChild(value);
    return row;
  }

  /* ----------------------------------------------------------
     8. INITIALIZATION
     ---------------------------------------------------------- */

  function init() {
    buildWidgetIfNeeded();
    wireRouteEvents();
    highlightActiveButton(state.passengerType);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* ----------------------------------------------------------
     9. PUBLIC API
     ---------------------------------------------------------- */

  window.CGPH_FARE = {
    setPassengerType: setPassengerType,
    calculateFare: calculateFare,
    getCurrentFare: getCurrentFare,
    reset: reset
  };
})();
