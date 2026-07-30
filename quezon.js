/**
 * data/quezon.js
 * ---------------------------------------------------------------------------
 * CGPH Transport Data — Quezon Province region.
 * Same shape and conventions as data/metro-manila.js — see that file's
 * header comment for details. Registers under
 * window.CGPH_TRANSPORT_REGIONS.quezon.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  const places = [
    { id: 'QUE-HUB-LUCENA', name: 'Lucena Grand Central Terminal', lat: 13.9373, lng: 121.6170, type: 'interchange' },
    { id: 'QUE-LM-LUCENACATHEDRAL', name: 'Lucena Cathedral / City Plaza', lat: 13.9357, lng: 121.6167, type: 'landmark' },
    { id: 'QUE-LM-TAYABAS', name: 'Tayabas Basilica / Town Plaza', lat: 14.0167, lng: 121.5833, type: 'landmark' },
    { id: 'QUE-LM-SARIAYA', name: 'Sariaya Town Plaza', lat: 13.9600, lng: 121.5300, type: 'landmark' },
    { id: 'QUE-LM-CANDELARIA', name: 'Candelaria Town Plaza', lat: 13.9333, lng: 121.4167, type: 'landmark' }
  ];

  const routes = [
    {
      id: 'QUE-JEEP-LUCENA-TAYABAS',
      name: 'Lucena \u2013 Tayabas Jeep',
      mode: 'jeep',
      fare: { base: 13, baseKm: 4, perKm: 1.5 },
      stopIds: ['QUE-HUB-LUCENA', 'QUE-LM-LUCENACATHEDRAL', 'QUE-LM-TAYABAS']
    },
    {
      id: 'QUE-JEEP-SARIAYA-CANDELARIA',
      name: 'Sariaya \u2013 Candelaria Jeep',
      mode: 'jeep',
      fare: { base: 13, baseKm: 4, perKm: 1.5 },
      stopIds: ['QUE-LM-SARIAYA', 'QUE-LM-CANDELARIA']
    },
    {
      id: 'QUE-UV-LUCENA-CANDELARIA',
      name: 'Lucena \u2013 Candelaria UV Express (via Sariaya)',
      mode: 'uvexpress',
      fare: { base: 40, baseKm: 10, perKm: 2.0 },
      stopIds: ['QUE-HUB-LUCENA', 'QUE-LM-SARIAYA', 'QUE-LM-CANDELARIA']
    },
    {
      id: 'QUE-TRIKE-LUCENA-LOCAL',
      name: 'Lucena Cathedral \u2013 Grand Terminal Tricycle',
      mode: 'tricycle',
      fare: 12,
      stopIds: ['QUE-LM-LUCENACATHEDRAL', 'QUE-HUB-LUCENA']
    },

    // --- Provincial bus (regional connector to Laguna) ---
    {
      id: 'QUE-PBUS-CANDELARIA-STACRUZ',
      name: 'Candelaria \u2013 Santa Cruz Laguna (Provincial Bus)',
      mode: 'provincialbus',
      fare: { base: 55, baseKm: 15, perKm: 1.75 },
      stopIds: ['QUE-LM-CANDELARIA', 'LAG-HUB-STACRUZ']
    }
  ];

  window.CGPH_TRANSPORT_REGIONS = window.CGPH_TRANSPORT_REGIONS || {};
  window.CGPH_TRANSPORT_REGIONS.quezon = { places: places, routes: routes };
})();
