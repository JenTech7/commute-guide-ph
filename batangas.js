/**
 * data/batangas.js
 * ---------------------------------------------------------------------------
 * CGPH Transport Data — Batangas region.
 * Same shape and conventions as data/metro-manila.js — see that file's
 * header comment for details. Registers under
 * window.CGPH_TRANSPORT_REGIONS.batangas.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  const places = [
    { id: 'BAT-HUB-GRANDTERM', name: 'Batangas Grand Terminal', lat: 13.7860, lng: 121.0620, type: 'interchange' },
    { id: 'BAT-LM-BATCITYPLAZA', name: 'Batangas City Plaza', lat: 13.7565, lng: 121.0583, type: 'landmark' },
    { id: 'BAT-LM-BATPORT', name: 'Batangas Port', lat: 13.7458, lng: 121.0631, type: 'terminal' },
    { id: 'BAT-HUB-LIPA', name: 'Lipa City Grand Terminal', lat: 13.9411, lng: 121.1624, type: 'interchange' },
    { id: 'BAT-LM-LIPAPLAZA', name: 'Lipa City Plaza (San Sebastian Cathedral)', lat: 13.9420, lng: 121.1600, type: 'landmark' },
    { id: 'BAT-LM-TANAUAN', name: 'Tanauan City Plaza', lat: 14.0863, lng: 121.1497, type: 'landmark' },
    { id: 'BAT-LM-NASUGBU', name: 'Nasugbu Town Plaza', lat: 14.0700, lng: 120.6317, type: 'landmark' },
    { id: 'BAT-LM-NASUGBU-MARKET', name: 'Nasugbu Public Market', lat: 14.0714, lng: 120.6321, type: 'landmark' }
  ];

  const routes = [
    {
      id: 'BAT-JEEP-GRANDTERM-CITYPLAZA',
      name: 'Batangas Grand Terminal \u2013 City Plaza Jeep',
      mode: 'jeep',
      fare: { base: 13, baseKm: 4, perKm: 1.5 },
      stopIds: ['BAT-HUB-GRANDTERM', 'BAT-LM-BATCITYPLAZA', 'BAT-LM-BATPORT']
    },
    {
      id: 'BAT-JEEP-LIPA-TANAUAN',
      name: 'Lipa \u2013 Tanauan Jeep',
      mode: 'jeep',
      fare: { base: 13, baseKm: 4, perKm: 1.5 },
      stopIds: ['BAT-HUB-LIPA', 'BAT-LM-LIPAPLAZA', 'BAT-LM-TANAUAN']
    },
    {
      id: 'BAT-UV-BATANGAS-LIPA',
      name: 'Batangas Grand Terminal \u2013 Lipa UV Express',
      mode: 'uvexpress',
      fare: { base: 40, baseKm: 10, perKm: 2.0 },
      stopIds: ['BAT-HUB-GRANDTERM', 'BAT-HUB-LIPA']
    },
    {
      id: 'BAT-TRIKE-CITYPLAZA-PORT',
      name: 'Batangas City Plaza \u2013 Port Tricycle',
      mode: 'tricycle',
      fare: 15,
      stopIds: ['BAT-LM-BATCITYPLAZA', 'BAT-LM-BATPORT']
    },
    {
      id: 'BAT-TRIKE-NASUGBU-LOCAL',
      name: 'Nasugbu Plaza \u2013 Public Market Tricycle',
      mode: 'tricycle',
      fare: 12,
      stopIds: ['BAT-LM-NASUGBU', 'BAT-LM-NASUGBU-MARKET']
    },
    {
      id: 'BAT-PBUS-NASUGBU-GRANDTERM',
      name: 'Nasugbu \u2013 Batangas Grand Terminal (Provincial Bus)',
      mode: 'provincialbus',
      fare: { base: 40, baseKm: 15, perKm: 1.5 },
      stopIds: ['BAT-LM-NASUGBU', 'BAT-HUB-GRANDTERM']
    },

    // --- Provincial bus (regional connector to Laguna / Metro Manila) ---
    {
      id: 'BAT-PBUS-LIPA-TANAUAN-STAROSA',
      name: 'Lipa \u2013 Tanauan \u2013 Sta. Rosa Laguna (Provincial Bus, STAR Tollway/SLEX)',
      mode: 'provincialbus',
      fare: { base: 50, baseKm: 15, perKm: 1.75 },
      stopIds: ['BAT-HUB-LIPA', 'BAT-LM-TANAUAN', 'LAG-HUB-STAROSA']
    }
  ];

  window.CGPH_TRANSPORT_REGIONS = window.CGPH_TRANSPORT_REGIONS || {};
  window.CGPH_TRANSPORT_REGIONS.batangas = { places: places, routes: routes };
})();
