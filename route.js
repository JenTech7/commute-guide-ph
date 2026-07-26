/* ==========================================================================
   COMMUTE GUIDE PH — ROUTE / COMMUTE GUIDE LOGIC
   Listens for 'cgph:destinationSelected' (dispatched by map.js) and turns
   a destination into a step-by-step commute: walk -> ride -> transfer ->
   ride -> walk, each step with transport type, fare, time, and distance.

   MODULARITY NOTE FOR FIRESTORE INTEGRATION:
   All step generation goes through generateCommuteSteps(origin, destination).
   Right now it produces steps using a local placeholder generator
   (generateStepsLocally). Once Firestore is connected, swap only the
   inside of generateCommuteSteps to first query the 'routes' collection
   for a matching origin/destination pair, falling back to the local
   generator if no saved route exists. Nothing else in this file
   (rendering, progress tracking, event handling) needs to change.
   ========================================================================== */

(function () {
  'use strict';

  /* ==================================================================
     0. ELEMENT REFERENCES
     ================================================================== */
  const els = {
    guideDestinationName: document.getElementById('guideDestinationName'),
    summaryFare: document.getElementById('summaryFare'),
    summaryTime: document.getElementById('summaryTime'),
    summaryDistance: document.getElementById('summaryDistance'),
    progressFill: document.getElementById('guideProgressFill'),
    progressTrack: document.querySelector('.guide-progress-track'),
    currentStepCard: document.getElementById('currentStepCard'),
    currentStepText: document.getElementById('currentStepText'),
    nextStepCard: document.getElementById('nextStepCard'),
    nextStepText: document.getElementById('nextStepText'),
    stepsList: document.getElementById('stepsList'),
    startGuideBtn: document.getElementById('startGuideBtn'),
  };

  /* ==================================================================
     1. TRANSPORT TYPE METADATA (icon + label per mode)
     Central lookup so every part of the UI stays consistent — add a
     new transport type here and it's usable everywhere immediately.
     ================================================================== */
  const TRANSPORT_TYPES = {
    walk: { label: 'Walk', icon: 'directions_walk' },
    jeepney: { label: 'Jeepney', icon: 'airport_shuttle' },
    bus: { label: 'Bus', icon: 'directions_bus' },
    van: { label: 'Van (UV Express)', icon: 'airport_shuttle' },
    tricycle: { label: 'Tricycle', icon: 'two_wheeler' },
    pedicab: { label: 'Pedicab', icon: 'pedal_bike' },
    mrt: { label: 'MRT', icon: 'tram' },
    lrt: { label: 'LRT', icon: 'tram' },
    pnr: { label: 'PNR', icon: 'train' },
    taxi: { label: 'Taxi', icon: 'local_taxi' },
    grab: { label: 'Grab', icon: 'directions_car' },
  };

  /* ==================================================================
     2. STATE
     Holds the currently active trip so the console/devtools and any
     future feature (voice.js, saved-routes.js) can read it via
     window.CGPH_ROUTE.getCurrentTrip().
     ================================================================== */
  let currentTrip = null; // { destination, steps: [...], totals: {...} }
  let activeStepIndex = 0;
  let guideStarted = false;

  /* ==================================================================
     3. STEP GENERATION
     ================================================================== */

  /**
   * Public entry point. Returns a Promise<Array<Step>> so a future
   * Firestore lookup (which is async) can replace the body without
   * changing any caller.
   * @param {{lat:number,lng:number,name:string}} origin
   * @param {{lat:number,lng:number,name:string}} destination
   */
  async function generateCommuteSteps(origin, destination) {
    // ---- FUTURE FIRESTORE HOOK ----
    // const savedRoute = await fetchSavedRoute(origin, destination);
    // if (savedRoute) return savedRoute.steps;
    // --------------------------------
    return generateStepsLocally(origin, destination);
  }

  /**
   * Placeholder generator: builds a plausible walk -> jeep -> walk ->
   * jeep -> walk commute using straight-line distance between origin
   * and destination to scale time/fare estimates. This is a stand-in
   * for real commute data and is intentionally simple — it exists so
   * the UI has real step objects to render and the Firestore-backed
   * version can be dropped in later with the exact same step shape.
   */
  function generateStepsLocally(origin, destination) {
    const distanceKm = haversineDistanceKm(origin, destination);

    // Rough jeepney fare model based on current PH minimum fare rules
    // (~₱13 for the first 4km, +₱1.80/km after) — illustrative, not
    // official fare-matrix data. Real fares should come from Firestore.
    const fareForLeg = (legKm) => {
      const base = 13;
      const extra = Math.max(0, legKm - 4) * 1.8;
      return Math.round(base + extra);
    };

    // Split the trip into two jeep legs with a transfer, unless it's
    // a very short hop (then it's a single walk + single ride).
    const steps = [];
    const originName = origin.name || 'your location';

    steps.push({
      transport: 'walk',
      instruction: `Walk to the nearest terminal near ${originName}`,
      fare: 0,
      timeMin: 3,
      distanceM: 150,
    });

    if (distanceKm <= 3) {
      steps.push({
        transport: 'tricycle',
        instruction: `Ride a tricycle toward ${destination.name}`,
        fare: fareForLeg(distanceKm),
        timeMin: Math.max(5, Math.round(distanceKm * 6)),
        distanceM: Math.round(distanceKm * 1000),
      });
    } else {
      const leg1Km = distanceKm * 0.55;
      const leg2Km = distanceKm * 0.45;

      steps.push({
        transport: 'jeepney',
        instruction: `Ride a jeepney heading toward ${destination.name}`,
        fare: fareForLeg(leg1Km),
        timeMin: Math.max(8, Math.round(leg1Km * 4)),
        distanceM: Math.round(leg1Km * 1000),
      });

      steps.push({
        transport: 'walk',
        instruction: 'Walk to the transfer point',
        fare: 0,
        timeMin: 2,
        distanceM: 120,
      });

      steps.push({
        transport: 'jeepney',
        instruction: `Transfer to a jeepney continuing to ${destination.name}`,
        fare: fareForLeg(leg2Km),
        timeMin: Math.max(6, Math.round(leg2Km * 4)),
        distanceM: Math.round(leg2Km * 1000),
      });
    }

    steps.push({
      transport: 'walk',
      instruction: `Walk to ${destination.name}`,
      fare: 0,
      timeMin: 2,
      distanceM: 80,
    });

    return steps;
  }

  // Straight-line distance in km between two {lat, lng} points
  function haversineDistanceKm(a, b) {
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);

    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  /* ==================================================================
     4. TOTALS
     ================================================================== */
  function computeTotals(steps) {
    return steps.reduce(
      (acc, step) => ({
        fare: acc.fare + step.fare,
        timeMin: acc.timeMin + step.timeMin,
        distanceM: acc.distanceM + step.distanceM,
      }),
      { fare: 0, timeMin: 0, distanceM: 0 }
    );
  }

  /* ==================================================================
     5. RENDERING
     ================================================================== */
function renderTrip(trip) {

  // Show guide panel after destination is selected
  if (els.guideEmptyState) {
    els.guideEmptyState.hidden = true;
  }

  if (els.guideContent) {
    els.guideContent.hidden = false;
  }
   
if (els.guidePanel) {
  els.guidePanel.classList.add('is-expanded');
}
   
  els.guideDestinationName.textContent = trip.destination.name;

    els.summaryFare.textContent = `\u20B1${trip.totals.fare}`;
    els.summaryTime.textContent = `${trip.totals.timeMin} min`;
    els.summaryDistance.textContent =
      trip.totals.distanceM >= 1000
        ? `${(trip.totals.distanceM / 1000).toFixed(1)} km`
        : `${trip.totals.distanceM} m`;

    renderStepsList(trip.steps);
    renderActiveSteps(trip.steps, activeStepIndex);
    renderProgress(trip.steps, activeStepIndex);
  }

  function renderStepsList(steps) {
    els.stepsList.innerHTML = '';

    steps.forEach((step, index) => {
      const meta = TRANSPORT_TYPES[step.transport];
      const li = document.createElement('li');
      li.className = 'step-list-item';
      li.dataset.stepIndex = String(index);

      const distanceLabel =
        step.distanceM >= 1000 ? `${(step.distanceM / 1000).toFixed(1)} km` : `${step.distanceM} m`;
      const fareLabel = step.fare > 0 ? ` \u00B7 \u20B1${step.fare}` : '';

      li.innerHTML = `
        <span class="step-list-icon material-icons-round" aria-hidden="true">${meta.icon}</span>
        <div class="step-list-body">
          <p>${escapeHtml(step.instruction)}</p>
          <span class="step-list-meta">${distanceLabel} \u00B7 ${step.timeMin} min${fareLabel}</span>
        </div>
      `;

      li.addEventListener('click', () => {
        activeStepIndex = index;
        renderActiveSteps(currentTrip.steps, activeStepIndex);
        renderProgress(currentTrip.steps, activeStepIndex);
      });

      els.stepsList.appendChild(li);
    });

    updateStepListHighlight(activeStepIndex);
  }

  function updateStepListHighlight(index) {
    const items = els.stepsList.querySelectorAll('.step-list-item');
    items.forEach((item, i) => {
      item.classList.toggle('is-active', i === index);
      item.classList.toggle('is-complete', i < index);
    });
    items[index]?.scrollIntoView({ block: 'nearest' });
  }

  function renderActiveSteps(steps, index) {
    const current = steps[index];
    const next = steps[index + 1];

    if (current) {
      const meta = TRANSPORT_TYPES[current.transport];
      els.currentStepText.textContent = current.instruction;
      els.currentStepCard.querySelector('.guide-step-icon').textContent = meta.icon;
      updateStepMeta(els.currentStepCard, current);
    }

    if (next) {
      const meta = TRANSPORT_TYPES[next.transport];
      els.nextStepCard.hidden = false;
      els.nextStepText.textContent = next.instruction;
      els.nextStepCard.querySelector('.guide-step-icon').textContent = meta.icon;
      updateStepMeta(els.nextStepCard, next);
    } else {
      els.nextStepText.textContent = 'Destination reached';
      els.nextStepCard.querySelector('.guide-step-icon').textContent = 'flag';
    }

    updateStepListHighlight(index);
  }

  function updateStepMeta(card, step) {
    const metaEl = card.querySelector('.guide-step-meta');
    if (!metaEl) return;
    const distanceLabel =
      step.distanceM >= 1000 ? `${(step.distanceM / 1000).toFixed(1)} km` : `${step.distanceM} m`;
    const pieces = [`<span><span class="material-icons-round" aria-hidden="true">straighten</span> ${distanceLabel}</span>`];
    pieces.push(`<span><span class="material-icons-round" aria-hidden="true">schedule</span> ${step.timeMin} min</span>`);
    if (step.fare > 0) {
      pieces.push(`<span><span class="material-icons-round" aria-hidden="true">payments</span> \u20B1${step.fare}</span>`);
    }
    metaEl.innerHTML = pieces.join('');
  }

  function renderProgress(steps, index) {
    const percent = steps.length <= 1 ? 100 : Math.round((index / (steps.length - 1)) * 100);
    els.progressFill.style.width = `${percent}%`;
    els.progressTrack.setAttribute('aria-valuenow', String(percent));
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ==================================================================
     6. GUIDE CONTROLS — Start Guide advances through steps
     ================================================================== */
  function advanceStep() {
    if (!currentTrip) return;
    if (activeStepIndex < currentTrip.steps.length - 1) {
      activeStepIndex += 1;
      renderActiveSteps(currentTrip.steps, activeStepIndex);
      renderProgress(currentTrip.steps, activeStepIndex);

      // voice.js (future file) listens for this to speak the new current step
      document.dispatchEvent(
        new CustomEvent('cgph:stepChanged', {
          detail: { step: currentTrip.steps[activeStepIndex], index: activeStepIndex, trip: currentTrip },
        })
      );
    } else {
      document.dispatchEvent(new CustomEvent('cgph:destinationReached', { detail: { trip: currentTrip } }));
    }
  }

  if (els.startGuideBtn) {
    els.startGuideBtn.addEventListener('click', () => {
      if (!guideStarted) {
        guideStarted = true;
        activeStepIndex = 0;
        renderActiveSteps(currentTrip.steps, activeStepIndex);
        renderProgress(currentTrip.steps, activeStepIndex);
        els.startGuideBtn.innerHTML =
          '<span class="material-icons-round" aria-hidden="true">skip_next</span> Next Step';

        document.dispatchEvent(
          new CustomEvent('cgph:guideStarted', { detail: { trip: currentTrip } })
        );
      } else {
        advanceStep();
      }
    });
  }

  /* ==================================================================
     7. EVENT WIRING — main entry point
     ================================================================== */
  document.addEventListener('cgph:destinationSelected', async (event) => {
    const { lat, lng, name, origin } = event.detail;
    const destination = { lat, lng, name };
    const originPoint = { lat: origin.lat, lng: origin.lng, name: 'your location' };

    // Reset guide state for the new destination
    activeStepIndex = 0;
    guideStarted = false;
    if (els.startGuideBtn) {
      els.startGuideBtn.innerHTML =
        '<span class="material-icons-round" aria-hidden="true">navigation</span> Start Guide';
    }

    const steps = await generateCommuteSteps(originPoint, destination);
    const totals = computeTotals(steps);

    currentTrip = { destination, origin: originPoint, steps, totals };
    renderTrip(currentTrip);
  });

  /* ==================================================================
     8. PUBLIC API (for devtools testing and future files like voice.js)
     ================================================================== */
  window.CGPH_ROUTE = {
    getCurrentTrip: () => currentTrip,
    getActiveStepIndex: () => activeStepIndex,
    advanceStep,
  };
})();
