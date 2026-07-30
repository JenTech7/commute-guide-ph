/**
 * data/metro-manila.js
 * ---------------------------------------------------------------------------
 * CGPH Transport Data — Metro Manila region.
 *
 * Registers itself under window.CGPH_TRANSPORT_REGIONS.metroManila as
 * { places, routes }. This file does NOT touch window.TRANSPORT_NETWORK
 * directly — transport-network.js merges every region together after all
 * region files have loaded.
 *
 * Field names match what route-engine.js's FIELD_ALIASES resolve first:
 *   place:  { id, name, lat, lng, type }
 *   route:  { id, name, mode, fare, stopIds: [...] }
 *
 * mode values are lowercase, no spaces — they must match the keys in
 * route-engine.js's SPEED_BY_MODE_KMH exactly:
 *   jeep | citybus | provincialbus | uvexpress | tricycle | mrt3 | lrt1 | lrt2 | pnr
 *
 * Some routes reference stopIds that live in OTHER regions' files
 * (e.g. "LAG-HUB-STAROSA", "BAT-HUB-GRANDTERM", "QUE-HUB-LUCENA"). That is
 * intentional and safe: route-engine.js resolves stopIds against the fully
 * merged place list at query time, not at file-load time, and routes are
 * matched without regard to direction — so a single cross-region route
 * entry works for trips in either direction.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  const places = [
    // --- Interchange hubs (multi-modal transfer points) ---
    { id: 'MM-HUB-EDSATAFT', name: 'Taft Avenue / EDSA Interchange (MRT-3 \u21c4 LRT-1)', lat: 14.5378, lng: 121.0000, type: 'interchange' },
    { id: 'MM-HUB-CUBAO', name: 'Cubao (Araneta City) Interchange (MRT-3 \u21c4 LRT-2 \u21c4 Jeepney/Bus Terminal)', lat: 14.6198, lng: 121.0535, type: 'interchange' },
    { id: 'MM-HUB-ALABANG', name: 'Alabang / Zapote Road Terminal (PNR \u21c4 Provincial Bus \u21c4 Jeepney/UV Express)', lat: 14.4189, lng: 121.0369, type: 'interchange' },
    { id: 'MM-HUB-PITX', name: 'Para\u00f1aque Integrated Terminal Exchange (PITX)', lat: 14.4906, lng: 120.9977, type: 'terminal' },
    { id: 'MM-HUB-TUTUBAN', name: 'Tutuban Center (PNR Terminus)', lat: 14.6106, lng: 120.9670, type: 'interchange' },
    { id: 'MM-HUB-MONUMENTO', name: 'Monumento Circle (LRT-1 \u21c4 Jeepney/Bus Terminal)', lat: 14.6553, lng: 120.9832, type: 'interchange' },

    // --- MRT-3 stations ---
    { id: 'MM-MRT-NAVE', name: 'North Avenue MRT-3 Station', lat: 14.6553, lng: 121.0323, type: 'station' },
    { id: 'MM-MRT-QAVE', name: 'Quezon Avenue MRT-3 Station', lat: 14.6423, lng: 121.0335, type: 'station' },
    { id: 'MM-MRT-ORTIGAS', name: 'Ortigas MRT-3 Station', lat: 14.5866, lng: 121.0566, type: 'station' },
    { id: 'MM-MRT-SHAW', name: 'Shaw Boulevard MRT-3 Station', lat: 14.5836, lng: 121.0577, type: 'station' },
    { id: 'MM-MRT-GUAD', name: 'Guadalupe MRT-3 Station', lat: 14.5652, lng: 121.0505, type: 'station' },
    { id: 'MM-MRT-BUENDIA', name: 'Buendia (Gil Puyat) MRT-3 Station', lat: 14.5559, lng: 121.0296, type: 'station' },
    { id: 'MM-MRT-AYALA', name: 'Ayala MRT-3 Station', lat: 14.5511, lng: 121.0272, type: 'station' },

    // --- LRT-1 stations ---
    { id: 'MM-LRT1-ROOSEVELT', name: 'Roosevelt LRT-1 Station', lat: 14.6570, lng: 120.9822, type: 'station' },
    { id: 'MM-LRT1-DOROTEO', name: 'Doroteo Jose LRT-1 Station', lat: 14.6106, lng: 120.9822, type: 'station' },
    { id: 'MM-LRT1-CENTRAL', name: 'Central Terminal LRT-1 Station', lat: 14.5958, lng: 120.9818, type: 'station' },
    { id: 'MM-LRT1-UN', name: 'United Nations Avenue LRT-1 Station', lat: 14.5748, lng: 120.9856, type: 'station' },
    { id: 'MM-LRT1-BACLARAN', name: 'Baclaran LRT-1 Station', lat: 14.5352, lng: 120.9964, type: 'station' },

    // --- LRT-2 stations ---
    { id: 'MM-LRT2-RECTO', name: 'Recto LRT-2 Station', lat: 14.6023, lng: 120.9822, type: 'station' },
    { id: 'MM-LRT2-GILMORE', name: 'Gilmore LRT-2 Station', lat: 14.6152, lng: 121.0335, type: 'station' },
    { id: 'MM-LRT2-ANONAS', name: 'Anonas LRT-2 Station', lat: 14.6280, lng: 121.0673, type: 'station' },
    { id: 'MM-LRT2-KATIPUNAN', name: 'Katipunan LRT-2 Station', lat: 14.6314, lng: 121.0736, type: 'station' },
    { id: 'MM-LRT2-ANTIPOLO', name: 'Antipolo (Masinag) LRT-2 Station', lat: 14.6198, lng: 121.1233, type: 'station' },

    // --- PNR stations ---
    { id: 'MM-PNR-ESPANA', name: 'Espa\u00f1a PNR Station', lat: 14.6083, lng: 120.9911, type: 'station' },
    { id: 'MM-PNR-BUENDIA', name: 'Buendia PNR Station', lat: 14.5563, lng: 121.0181, type: 'station' },
    { id: 'MM-PNR-SUCAT', name: 'Sucat PNR Station', lat: 14.4756, lng: 121.0234, type: 'station' },

    // --- Landmarks (used for walking legs / jeepney & tricycle termini) ---
    { id: 'MM-LM-JOLLIBEE-BALIBAGO', name: 'Jollibee Balibago', lat: 14.4150, lng: 121.0410, type: 'landmark' },
    { id: 'MM-LM-ATC', name: 'Alabang Town Center Entrance', lat: 14.4183, lng: 121.0340, type: 'landmark' },
    { id: 'MM-LM-QUIAPO-CHURCH', name: 'Quiapo Church', lat: 14.5996, lng: 120.9827, type: 'landmark' },
    { id: 'MM-LM-DIVISORIA', name: 'Divisoria Market', lat: 14.6019, lng: 120.9714, type: 'landmark' },
    { id: 'MM-LM-SMFAIRVIEW', name: 'SM City Fairview', lat: 14.7274, lng: 121.0625, type: 'landmark' },
    { id: 'MM-LM-GREENHILLS', name: 'Greenhills Shopping Center', lat: 14.6019, lng: 121.0475, type: 'landmark' }
  ];

  const routes = [
    // --- Rail lines ---
    {
      id: 'MM-MRT3-MAIN',
      name: 'MRT-3 (North Avenue \u2013 Taft Avenue)',
      mode: 'mrt3',
      fare: { base: 13, baseKm: 5, perKm: 1.0 },
      stopIds: ['MM-MRT-NAVE', 'MM-MRT-QAVE', 'MM-HUB-CUBAO', 'MM-MRT-ORTIGAS', 'MM-MRT-SHAW', 'MM-MRT-GUAD', 'MM-MRT-BUENDIA', 'MM-MRT-AYALA', 'MM-HUB-EDSATAFT']
    },
    {
      id: 'MM-LRT1-MAIN',
      name: 'LRT-1 (Roosevelt \u2013 Baclaran)',
      mode: 'lrt1',
      fare: { base: 13, baseKm: 5, perKm: 1.0 },
      stopIds: ['MM-LRT1-ROOSEVELT', 'MM-HUB-MONUMENTO', 'MM-LRT1-DOROTEO', 'MM-LRT1-CENTRAL', 'MM-LRT1-UN', 'MM-HUB-EDSATAFT', 'MM-LRT1-BACLARAN']
    },
    {
      id: 'MM-LRT2-MAIN',
      name: 'LRT-2 (Recto \u2013 Antipolo)',
      mode: 'lrt2',
      fare: { base: 13, baseKm: 5, perKm: 1.0 },
      stopIds: ['MM-LRT2-RECTO', 'MM-LRT2-GILMORE', 'MM-HUB-CUBAO', 'MM-LRT2-ANONAS', 'MM-LRT2-KATIPUNAN', 'MM-LRT2-ANTIPOLO']
    },
    {
      id: 'MM-PNR-MAIN',
      name: 'PNR Metro Commuter Line (Tutuban \u2013 Alabang)',
      mode: 'pnr',
      fare: { base: 15, baseKm: 5, perKm: 1.2 },
      stopIds: ['MM-HUB-TUTUBAN', 'MM-PNR-ESPANA', 'MM-PNR-BUENDIA', 'MM-PNR-SUCAT', 'MM-HUB-ALABANG']
    },

    // --- City buses ---
    {
      id: 'MM-CBUS-EDSA-CAROUSEL',
      name: 'EDSA Busway (Monumento \u2013 PITX)',
      mode: 'citybus',
      fare: { base: 15, baseKm: 5, perKm: 2.2 },
      stopIds: ['MM-HUB-MONUMENTO', 'MM-HUB-CUBAO', 'MM-MRT-ORTIGAS', 'MM-MRT-GUAD', 'MM-MRT-BUENDIA', 'MM-HUB-EDSATAFT', 'MM-HUB-PITX']
    },
    {
      id: 'MM-CBUS-ALABANG-PITX',
      name: 'Alabang \u2013 PITX (Coastal Road city bus)',
      mode: 'citybus',
      fare: { base: 15, baseKm: 5, perKm: 2.2 },
      stopIds: ['MM-HUB-ALABANG', 'MM-LM-ATC', 'MM-HUB-PITX']
    },

    // --- Jeepneys ---
    {
      id: 'MM-JEEP-BALIBAGO-ALABANG',
      name: 'Balibago \u2013 Alabang Jeep',
      mode: 'jeep',
      fare: { base: 13, baseKm: 4, perKm: 1.5 },
      stopIds: ['MM-LM-JOLLIBEE-BALIBAGO', 'MM-LM-ATC', 'MM-HUB-ALABANG']
    },
    {
      id: 'MM-JEEP-QUIAPO-DIVISORIA',
      name: 'Quiapo \u2013 Divisoria Jeep',
      mode: 'jeep',
      fare: { base: 13, baseKm: 4, perKm: 1.5 },
      stopIds: ['MM-LM-QUIAPO-CHURCH', 'MM-LRT2-RECTO', 'MM-LM-DIVISORIA', 'MM-HUB-TUTUBAN']
    },
    {
      id: 'MM-JEEP-CUBAO-GREENHILLS',
      name: 'Cubao \u2013 Greenhills Jeep',
      mode: 'jeep',
      fare: { base: 13, baseKm: 4, perKm: 1.5 },
      stopIds: ['MM-HUB-CUBAO', 'MM-LM-GREENHILLS', 'MM-MRT-ORTIGAS']
    },
    {
      id: 'MM-JEEP-FAIRVIEW-NAVE',
      name: 'SM Fairview \u2013 North Avenue Jeep',
      mode: 'jeep',
      fare: { base: 13, baseKm: 4, perKm: 1.5 },
      stopIds: ['MM-LM-SMFAIRVIEW', 'MM-MRT-NAVE']
    },

    // --- Tricycles ---
    {
      id: 'MM-TRIKE-ATC-JOLLIBEE',
      name: 'Alabang Town Center \u2013 Jollibee Balibago Tricycle',
      mode: 'tricycle',
      fare: 15,
      stopIds: ['MM-LM-ATC', 'MM-LM-JOLLIBEE-BALIBAGO']
    },

    // --- UV Express (regional connector) ---
    {
      id: 'MM-UV-ALABANG-STAROSA',
      name: 'Alabang \u2013 Sta. Rosa Laguna UV Express',
      mode: 'uvexpress',
      fare: { base: 40, baseKm: 10, perKm: 2.0 },
      stopIds: ['MM-HUB-ALABANG', 'LAG-HUB-STAROSA']
    },

    // --- Provincial buses (regional connectors) ---
    {
      id: 'MM-PBUS-PITX-BATANGAS',
      name: 'PITX \u2013 Batangas Grand Terminal (Provincial Bus)',
      mode: 'provincialbus',
      fare: { base: 70, baseKm: 20, perKm: 1.75 },
      stopIds: ['MM-HUB-PITX', 'BAT-HUB-GRANDTERM']
    },
    {
      id: 'MM-PBUS-CUBAO-LUCENA',
      name: 'Cubao \u2013 Lucena Grand Terminal (Provincial Bus)',
      mode: 'provincialbus',
      fare: { base: 70, baseKm: 20, perKm: 1.75 },
      stopIds: ['MM-HUB-CUBAO', 'QUE-HUB-LUCENA']
    },
    {
      id: 'MM-PBUS-ALABANG-STACRUZ',
      name: 'Alabang \u2013 Santa Cruz Laguna (Provincial Bus)',
      mode: 'provincialbus',
      fare: { base: 60, baseKm: 15, perKm: 1.75 },
      stopIds: ['MM-HUB-ALABANG', 'LAG-HUB-STACRUZ']
    }
  ];

  window.CGPH_TRANSPORT_REGIONS = window.CGPH_TRANSPORT_REGIONS || {};
  window.CGPH_TRANSPORT_REGIONS.metroManila = { places: places, routes: routes };
})();
