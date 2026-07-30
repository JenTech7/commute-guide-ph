/**
 * data/transport-network.js
 * ---------------------------------------------------------------------------
 * CGPH Transport Network — combiner.
 *
 * Merges every region registered under window.CGPH_TRANSPORT_REGIONS
 * (populated by data/metro-manila.js, data/laguna.js, data/batangas.js,
 * data/quezon.js) into a single window.TRANSPORT_NETWORK object:
 *
 *   window.TRANSPORT_NETWORK = { places: [...], routes: [...] }
 *
 * This is the exact shape route-engine.js's FIELD_ALIASES resolve first
 * (net.places, net.routes), so route-engine.js and route.js need ZERO
 * changes to consume it.
 *
 * LOAD ORDER REQUIRED in your HTML, in this exact sequence:
 *   1. data/metro-manila.js
 *   2. data/laguna.js
 *   3. data/batangas.js
 *   4. data/quezon.js
 *   5. data/transport-network.js   <-- this file (must load AFTER all regions)
 *   6. route-engine.js
 *   7. route.js
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  const regions = window.CGPH_TRANSPORT_REGIONS || {};
  const places = [];
  const routes = [];

  Object.keys(regions).forEach(function (key) {
    const region = regions[key];
    if (!region) return;
    if (Array.isArray(region.places)) places.push.apply(places, region.places);
    if (Array.isArray(region.routes)) routes.push.apply(routes, region.routes);
  });

  window.TRANSPORT_NETWORK = { places: places, routes: routes };

  // Lightweight console diagnostics — safe to leave in for now, and useful
  // while wiring the new regions into the existing app for the first time.
  console.log(
    '[transport-network.js] Loaded ' + places.length + ' places and ' +
    routes.length + ' routes across ' + Object.keys(regions).length + ' region(s).'
  );
})();
