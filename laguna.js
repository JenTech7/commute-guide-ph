/**
 * data/laguna.js
 * ---------------------------------------------------------------------------
 * CGPH Transport Data — Laguna region.
 * Same shape and conventions as data/metro-manila.js — see that file's
 * header comment for details. Registers under
 * window.CGPH_TRANSPORT_REGIONS.laguna.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  const places = [
    { id: 'LAG-HUB-STAROSA', name: 'Sta. Rosa Laguna Terminal (Paseo de Sta. Rosa)', lat: 14.3122, lng: 121.1114, type: 'interchange' },
    { id: 'LAG-HUB-CALAMBA', name: 'Calamba Crossing Terminal', lat: 14.2117, lng: 121.1653, type: 'interchange' },
    { id: 'LAG-HUB-STACRUZ', name: 'Santa Cruz Laguna Town Terminal', lat: 14.2833, lng: 121.4167, type: 'interchange' },
    { id: 'LAG-LM-LOSBANOS', name: 'Los Ba\u00f1os Public Market', lat: 14.1651, lng: 121.2413, type: 'landmark' },
    { id: 'LAG-LM-UPLB', name: 'UP Los Ba\u00f1os Main Gate', lat: 14.1642, lng: 121.2413, type: 'landmark' },
    { id: 'LAG-LM-SANPABLO', name: 'San Pablo City Plaza', lat: 14.0683, lng: 121.3251, type: 'landmark' },
    { id: 'LAG-LM-BINAN', name: 'Bi\u00f1an City Hall', lat: 14.3333, lng: 121.0833, type: 'landmark' },
    { id: 'LAG-LM-SM-STAROSA', name: 'SM City Sta. Rosa', lat: 14.3089, lng: 121.1075, type: 'landmark' },
    { id: 'LAG-LM-CALAMBAMARKET', name: 'Calamba Public Market', lat: 14.2125, lng: 121.1650, type: 'landmark' }
  ];

  const routes = [
    {
      id: 'LAG-JEEP-STAROSA-BINAN',
      name: 'Sta. Rosa \u2013 Bi\u00f1an Jeep',
      mode: 'jeep',
      fare: { base: 13, baseKm: 4, perKm: 1.5 },
      stopIds: ['LAG-HUB-STAROSA', 'LAG-LM-SM-STAROSA', 'LAG-LM-BINAN']
    },
    {
      id: 'LAG-JEEP-CALAMBA-LOSBANOS',
      name: 'Calamba \u2013 Los Ba\u00f1os Jeep (via UPLB)',
      mode: 'jeep',
      fare: { base: 13, baseKm: 4, perKm: 1.5 },
      stopIds: ['LAG-HUB-CALAMBA', 'LAG-LM-CALAMBAMARKET', 'LAG-LM-UPLB', 'LAG-LM-LOSBANOS']
    },
    {
      id: 'LAG-CBUS-STAROSA-CALAMBA',
      name: 'Sta. Rosa \u2013 Calamba City Bus',
      mode: 'citybus',
      fare: { base: 15, baseKm: 5, perKm: 2.2 },
      stopIds: ['LAG-HUB-STAROSA', 'LAG-HUB-CALAMBA']
    },
    {
      id: 'LAG-UV-CALAMBA-SANPABLO',
      name: 'Calamba \u2013 San Pablo City UV Express',
      mode: 'uvexpress',
      fare: { base: 40, baseKm: 10, perKm: 2.0 },
      stopIds: ['LAG-HUB-CALAMBA', 'LAG-LM-LOSBANOS', 'LAG-LM-SANPABLO']
    },
    {
      id: 'LAG-TRIKE-STAROSA-SM',
      name: 'Sta. Rosa Terminal \u2013 SM Sta. Rosa Tricycle',
      mode: 'tricycle',
      fare: 15,
      stopIds: ['LAG-HUB-STAROSA', 'LAG-LM-SM-STAROSA']
    },
    {
      id: 'LAG-TRIKE-LOSBANOS-UPLB',
      name: 'Los Ba\u00f1os \u2013 UPLB Tricycle',
      mode: 'tricycle',
      fare: 12,
      stopIds: ['LAG-LM-LOSBANOS', 'LAG-LM-UPLB']
    },

    // --- Provincial bus (regional connector to Quezon) ---
    {
      id: 'LAG-PBUS-STACRUZ-LUCENA',
      name: 'Santa Cruz Laguna \u2013 Lucena Grand Terminal (Provincial Bus)',
      mode: 'provincialbus',
      fare: { base: 60, baseKm: 15, perKm: 1.75 },
      stopIds: ['LAG-HUB-STACRUZ', 'QUE-HUB-LUCENA']
    }
  ];

  window.CGPH_TRANSPORT_REGIONS = window.CGPH_TRANSPORT_REGIONS || {};
  window.CGPH_TRANSPORT_REGIONS.laguna = { places: places, routes: routes };
})();
