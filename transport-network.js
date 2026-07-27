/**
 * transport-network.js
 * Commute Guide PH — Philippine Public Transportation Network Database
 *
 * Vanilla JavaScript. No frameworks, no build step, no dependencies.
 * Exposes a single global: window.TRANSPORT_NETWORK
 *
 * This file is designed to scale to thousands of routes across the
 * Philippines. Routes are stored in a flat array (source of truth) plus
 * several Map-based indexes (by id, by mode, by operator, by stop name,
 * by region) so lookups stay fast even at large scale.
 *
 * IMPORTANT: This file does NOT modify map.js or route.js. It only
 * defines data + a small read-only query API on window.TRANSPORT_NETWORK.
 * route.js can later be updated to pull from this instead of
 * journeyTemplates.
 */

(function (global) {
  "use strict";

  // ---------------------------------------------------------------------
  // 1. CONSTANTS / ENUMS
  // ---------------------------------------------------------------------

  /**
   * Canonical transport mode identifiers.
   * Keep these stable — other modules (route.js, map.js) will key off them.
   */
  const MODES = Object.freeze({
    JEEPNEY: "jeepney",
    BUS: "bus",
    UV_EXPRESS: "uv_express",
    RAIL: "rail", // MRT / LRT / PNR
    TRICYCLE: "tricycle",
  });

  /**
   * Rail lines are their own "operator family" under MODES.RAIL.
   * Not exhaustive — extend as needed.
   */
  const RAIL_LINES = Object.freeze({
    MRT3: "MRT-3",
    LRT1: "LRT-1",
    LRT2: "LRT-2",
    PNR: "PNR",
  });

  const CURRENCY = "PHP";

  // ---------------------------------------------------------------------
  // 2. INTERNAL STORAGE
  // ---------------------------------------------------------------------

  /** @type {Array<Object>} Flat array of all route records (source of truth) */
  const _routes = [];

  /** @type {Map<string, Object>} routeId -> route record */
  const _byId = new Map();

  /** @type {Map<string, Set<string>>} mode -> Set of routeIds */
  const _byMode = new Map();

  /** @type {Map<string, Set<string>>} operator (lowercased) -> Set of routeIds */
  const _byOperator = new Map();

  /** @type {Map<string, Set<string>>} region/province (lowercased) -> Set of routeIds */
  const _byRegion = new Map();

  /**
   * stopName (lowercased, trimmed) -> Set of routeIds that touch that stop
   * (origin, destination, or any intermediate stop).
   * This is the key index for "find me a route from A to B" queries.
   */
  const _byStopName = new Map();

  // ---------------------------------------------------------------------
  // 3. VALIDATION HELPERS
  // ---------------------------------------------------------------------

  function isFiniteNumber(n) {
    return typeof n === "number" && Number.isFinite(n);
  }

  /**
   * Validates a [lat, lng] pair. Philippines bounding box used as a
   * sanity check (roughly 4°N–21°N, 116°E–127°E) to catch swapped
   * coordinates or typos early — not a hard geographic restriction.
   */
  function isValidCoordinate(coords) {
    if (!Array.isArray(coords) || coords.length !== 2) return false;
    const [lat, lng] = coords;
    if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return false;
    return lat >= 4 && lat <= 21 && lng >= 116 && lng <= 127;
  }

  function isValidTerminal(terminal) {
    return (
      terminal &&
      typeof terminal.name === "string" &&
      terminal.name.trim().length > 0 &&
      isValidCoordinate(terminal.coordinates)
    );
  }

  function isValidStop(stop) {
    // Same shape as a terminal; kept as a separate check in case stop
    // records grow extra fields (e.g. sequence, landmark) later.
    return isValidTerminal(stop);
  }

  function isValidFareRange(fare) {
    return (
      fare &&
      isFiniteNumber(fare.min) &&
      isFiniteNumber(fare.max) &&
      fare.min >= 0 &&
      fare.max >= fare.min &&
      typeof fare.currency === "string"
    );
  }

  function isValidTravelTime(time) {
    return (
      time &&
      isFiniteNumber(time.minMinutes) &&
      isFiniteNumber(time.maxMinutes) &&
      time.minMinutes >= 0 &&
      time.maxMinutes >= time.minMinutes
    );
  }

  function normalizeKey(str) {
    return String(str || "").trim().toLowerCase();
  }

  function addToIndex(indexMap, key, routeId) {
    const k = normalizeKey(key);
    if (!k) return;
    if (!indexMap.has(k)) indexMap.set(k, new Set());
    indexMap.get(k).add(routeId);
  }

  // ---------------------------------------------------------------------
  // 4. ROUTE FACTORY / REGISTRATION
  // ---------------------------------------------------------------------

  /**
   * Shape of a route record:
   * {
   *   id: string,                     // unique, e.g. "jeep-calabarzon-0001"
   *   operator: string,               // e.g. "Balibago Transit Corp."
   *   mode: MODES.*,
   *   railLine: string|null,          // only for MODES.RAIL
   *   region: string,                 // province/region for indexing, e.g. "Laguna"
   *   origin: { name, coordinates: [lat, lng] },
   *   destination: { name, coordinates: [lat, lng] },
   *   stops: [ { name, coordinates: [lat, lng] }, ... ], // intermediate only
   *   fare: { min, max, currency },
   *   estimatedTime: { minMinutes, maxMinutes },
   *   distanceKm: number|null,
   *   frequency: string|null,         // e.g. "every 10-15 min"
   *   operatingHours: { start: "05:00", end: "21:00" } | null,
   *   tags: string[],                 // free-form, e.g. ["airconditioned", "PUV"]
   * }
   *
   * Throws on invalid data so bad entries fail fast during registration
   * rather than silently corrupting the network.
   */
  function createRoute(def) {
    if (!def || typeof def !== "object") {
      throw new Error("TRANSPORT_NETWORK: route definition must be an object");
    }
    if (!def.id || typeof def.id !== "string") {
      throw new Error("TRANSPORT_NETWORK: route.id is required and must be a string");
    }
    if (_byId.has(def.id)) {
      throw new Error(`TRANSPORT_NETWORK: duplicate route id "${def.id}"`);
    }
    if (!Object.values(MODES).includes(def.mode)) {
      throw new Error(
        `TRANSPORT_NETWORK: invalid mode "${def.mode}" for route "${def.id}". ` +
          `Expected one of: ${Object.values(MODES).join(", ")}`
      );
    }
    if (!isValidTerminal(def.origin)) {
      throw new Error(`TRANSPORT_NETWORK: invalid origin for route "${def.id}"`);
    }
    if (!isValidTerminal(def.destination)) {
      throw new Error(`TRANSPORT_NETWORK: invalid destination for route "${def.id}"`);
    }
    const stops = Array.isArray(def.stops) ? def.stops : [];
    for (const stop of stops) {
      if (!isValidStop(stop)) {
        throw new Error(
          `TRANSPORT_NETWORK: invalid intermediate stop in route "${def.id}"`
        );
      }
    }
    if (!isValidFareRange(def.fare)) {
      throw new Error(`TRANSPORT_NETWORK: invalid fare range for route "${def.id}"`);
    }
    if (!isValidTravelTime(def.estimatedTime)) {
      throw new Error(
        `TRANSPORT_NETWORK: invalid estimatedTime for route "${def.id}"`
      );
    }

    const route = {
      id: def.id,
      operator: def.operator || "Unknown Operator",
      mode: def.mode,
      railLine: def.mode === MODES.RAIL ? def.railLine || null : null,
      region: def.region || "Unspecified",
      origin: {
        name: def.origin.name.trim(),
        coordinates: [def.origin.coordinates[0], def.origin.coordinates[1]],
      },
      destination: {
        name: def.destination.name.trim(),
        coordinates: [
          def.destination.coordinates[0],
          def.destination.coordinates[1],
        ],
      },
      stops: stops.map((s) => ({
        name: s.name.trim(),
        coordinates: [s.coordinates[0], s.coordinates[1]],
      })),
      fare: {
        min: def.fare.min,
        max: def.fare.max,
        currency: def.fare.currency || CURRENCY,
      },
      estimatedTime: {
        minMinutes: def.estimatedTime.minMinutes,
        maxMinutes: def.estimatedTime.maxMinutes,
      },
      distanceKm: isFiniteNumber(def.distanceKm) ? def.distanceKm : null,
      frequency: def.frequency || null,
      operatingHours: def.operatingHours || null,
      tags: Array.isArray(def.tags) ? def.tags.slice() : [],
    };

    return Object.freeze(route);
  }

  /**
   * Registers a single route definition into storage + all indexes.
   * Returns the frozen, normalized route record.
   */
  function addRoute(def) {
    const route = createRoute(def);

    _routes.push(route);
    _byId.set(route.id, route);

    addToIndex(_byMode, route.mode, route.id);
    addToIndex(_byOperator, route.operator, route.id);
    addToIndex(_byRegion, route.region, route.id);

    addToIndex(_byStopName, route.origin.name, route.id);
    addToIndex(_byStopName, route.destination.name, route.id);
    for (const stop of route.stops) {
      addToIndex(_byStopName, stop.name, route.id);
    }

    return route;
  }

  /**
   * Bulk-register an array of route definitions.
   * Collects errors instead of throwing on first failure, so one bad
   * record (out of thousands) doesn't block the rest from loading.
   * Returns { added: Route[], errors: {index, id, message}[] }
   */
  function addRoutes(defs) {
    const added = [];
    const errors = [];
    defs.forEach((def, index) => {
      try {
        added.push(addRoute(def));
      } catch (err) {
        errors.push({ index, id: def && def.id, message: err.message });
      }
    });
    if (errors.length && global.console && typeof global.console.warn === "function") {
      global.console.warn(
        `TRANSPORT_NETWORK: ${errors.length} route(s) failed to load.`,
        errors
      );
    }
    return { added, errors };
  }

  // ---------------------------------------------------------------------
  // 5. QUERY API
  // ---------------------------------------------------------------------

  function getRouteById(id) {
    return _byId.get(id) || null;
  }

  function getAllRoutes() {
    return _routes.slice();
  }

  function getRoutesByMode(mode) {
    const ids = _byMode.get(normalizeKey(mode));
    if (!ids) return [];
    return Array.from(ids).map((id) => _byId.get(id));
  }

  function getRoutesByOperator(operator) {
    const ids = _byOperator.get(normalizeKey(operator));
    if (!ids) return [];
    return Array.from(ids).map((id) => _byId.get(id));
  }

  function getRoutesByRegion(region) {
    const ids = _byRegion.get(normalizeKey(region));
    if (!ids) return [];
    return Array.from(ids).map((id) => _byId.get(id));
  }

  /**
   * Returns all routes that touch a given stop name (origin, destination,
   * or intermediate). Exact-match on normalized name.
   */
  function getRoutesByStopName(stopName) {
    const ids = _byStopName.get(normalizeKey(stopName));
    if (!ids) return [];
    return Array.from(ids).map((id) => _byId.get(id));
  }

  /**
   * Fuzzy stop search: returns matching stop names (across the whole
   * network) that contain the given substring — useful for autocomplete
   * in map.js's destination search box.
   */
  function searchStopNames(query, limit) {
    const q = normalizeKey(query);
    if (!q) return [];
    const results = [];
    for (const name of _byStopName.keys()) {
      if (name.includes(q)) {
        results.push(name);
        if (limit && results.length >= limit) break;
      }
    }
    return results;
  }

  /**
   * Finds routes that plausibly connect an origin stop name to a
   * destination stop name on the SAME route (single-leg journeys only).
   * Multi-leg pathfinding across routes belongs in route.js, which can
   * be built on top of this data — this stays a simple, fast primitive.
   */
  function findDirectRoutes(originName, destinationName) {
    const originIds = _byStopName.get(normalizeKey(originName));
    const destIds = _byStopName.get(normalizeKey(destinationName));
    if (!originIds || !destIds) return [];

    const results = [];
    for (const id of originIds) {
      if (destIds.has(id)) {
        results.push(_byId.get(id));
      }
    }
    return results;
  }

  /**
   * Haversine distance in km between two [lat, lng] points.
   * Handy for "nearest terminal" queries from map.js's geolocation.
   */
  function distanceKm(coordsA, coordsB) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const [lat1, lon1] = coordsA;
    const [lat2, lon2] = coordsB;
    const R = 6371; // Earth radius km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Returns { stopName, coordinates, routeIds, distanceKm } for the N
   * nearest known stops (origin/destination/intermediate, deduped by
   * name) to a given [lat, lng]. Useful for "routes near me".
   */
  function findNearestStops(coords, limit) {
    if (!isValidCoordinate(coords)) return [];
    const n = limit || 5;

    // Build a de-duplicated stop-name -> representative coordinates map.
    // (Different routes may name the same physical stop slightly
    // differently; this stays simple and exact-name-based for now.)
    const seen = new Map(); // name -> coords
    for (const route of _routes) {
      seen.set(route.origin.name, route.origin.coordinates);
      seen.set(route.destination.name, route.destination.coordinates);
      for (const stop of route.stops) {
        seen.set(stop.name, stop.coordinates);
      }
    }

    const scored = Array.from(seen.entries()).map(([name, stopCoords]) => ({
      stopName: name,
      coordinates: stopCoords,
      distanceKm: distanceKm(coords, stopCoords),
      routeIds: Array.from(_byStopName.get(normalizeKey(name)) || []),
    }));

    scored.sort((a, b) => a.distanceKm - b.distanceKm);
    return scored.slice(0, n);
  }

  function getStats() {
    const byModeCounts = {};
    for (const [mode, ids] of _byMode.entries()) {
      byModeCounts[mode] = ids.size;
    }
    return {
      totalRoutes: _routes.length,
      totalStops: _byStopName.size,
      totalOperators: _byOperator.size,
      totalRegions: _byRegion.size,
      byMode: byModeCounts,
    };
  }

  // ---------------------------------------------------------------------
  // 6. SEED DATA
  // ---------------------------------------------------------------------
  // A small starter set covering every supported mode, including the
  // example route requested: Balibago Complex -> Crossing Calamba -> Liliw.
  // Coordinates are approximate town/terminal-level locations meant as
  // realistic placeholders — replace/expand with surveyed data over time.
  // This seed set is intentionally small; production data (thousands of
  // routes) should be loaded via addRoutes() from an external JSON/API
  // source at app startup, using this same schema.

  const SEED_ROUTES = [
    {
      id: "uvx-calabarzon-0001",
      operator: "Balibago Liliw Transport Coop",
      mode: MODES.UV_EXPRESS,
      region: "Laguna",
      origin: {
        name: "Balibago Complex",
        coordinates: [14.1697, 121.1364],
      },
      destination: {
        name: "Liliw",
        coordinates: [14.1372, 121.4372],
      },
      stops: [
        {
          name: "Crossing Calamba",
          coordinates: [14.2117, 121.1653],
        },
        {
          name: "Sta. Cruz Public Market",
          coordinates: [14.2789, 121.4159],
        },
      ],
      fare: { min: 60, max: 90, currency: CURRENCY },
      estimatedTime: { minMinutes: 70, maxMinutes: 110 },
      distanceKm: 48,
      frequency: "every 20-30 min",
      operatingHours: { start: "04:30", end: "20:00" },
      tags: ["airconditioned", "UV Express"],
    },
    {
      id: "jeep-manila-0001",
      operator: "Manila Jeepney Operators Assoc.",
      mode: MODES.JEEPNEY,
      region: "Metro Manila",
      origin: { name: "Baclaran", coordinates: [14.5352, 120.9962] },
      destination: { name: "Divisoria", coordinates: [14.6013, 120.9682] },
      stops: [
        { name: "Quirino Ave.", coordinates: [14.5675, 120.9877] },
        { name: "United Nations Ave.", coordinates: [14.5811, 120.9847] },
      ],
      fare: { min: 13, max: 25, currency: CURRENCY },
      estimatedTime: { minMinutes: 40, maxMinutes: 75 },
      distanceKm: 9.5,
      frequency: "every 3-5 min",
      operatingHours: { start: "04:00", end: "22:00" },
      tags: ["traditional jeepney"],
    },
    {
      id: "bus-ncr-calabarzon-0001",
      operator: "JAM Transit",
      mode: MODES.BUS,
      region: "Laguna",
      origin: { name: "Buendia (Taft Ave.)", coordinates: [14.5544, 121.0166] },
      destination: { name: "Sta. Cruz, Laguna", coordinates: [14.2789, 121.4159] },
      stops: [
        { name: "Alabang Town Center", coordinates: [14.4198, 121.0389] },
        { name: "Calamba Crossing", coordinates: [14.2117, 121.1653] },
      ],
      fare: { min: 80, max: 150, currency: CURRENCY },
      estimatedTime: { minMinutes: 90, maxMinutes: 150 },
      distanceKm: 75,
      frequency: "every 15-20 min",
      operatingHours: { start: "03:30", end: "21:30" },
      tags: ["provincial bus", "airconditioned"],
    },
    {
      id: "rail-mrt3-0001",
      operator: "Metro Rail Transit Corp.",
      mode: MODES.RAIL,
      railLine: RAIL_LINES.MRT3,
      region: "Metro Manila",
      origin: { name: "North Avenue Station", coordinates: [14.6567, 121.0316] },
      destination: { name: "Taft Avenue Station", coordinates: [14.5406, 120.9942] },
      stops: [
        { name: "Quezon Avenue Station", coordinates: [14.6417, 121.0335] },
        { name: "Ortigas Station", coordinates: [14.5866, 121.0566] },
        { name: "Guadalupe Station", coordinates: [14.5646, 121.0498] },
      ],
      fare: { min: 13, max: 28, currency: CURRENCY },
      estimatedTime: { minMinutes: 25, maxMinutes: 35 },
      distanceKm: 16.9,
      frequency: "every 4-6 min",
      operatingHours: { start: "05:00", end: "22:00" },
      tags: ["rail", "MRT-3"],
    },
    {
      id: "tricycle-liliw-0001",
      operator: "Liliw Tricycle Operators & Drivers Assoc.",
      mode: MODES.TRICYCLE,
      region: "Laguna",
      origin: { name: "Liliw Public Market", coordinates: [14.1372, 121.4372] },
      destination: { name: "Liliw Church", coordinates: [14.139, 121.4361] },
      stops: [],
      fare: { min: 15, max: 30, currency: CURRENCY },
      estimatedTime: { minMinutes: 5, maxMinutes: 10 },
      distanceKm: 1.2,
      frequency: "on demand",
      operatingHours: { start: "05:00", end: "21:00" },
      tags: ["tricycle", "short-haul"],
    },
  ];

  // ---------------------------------------------------------------------
  // 7. PUBLIC API ASSEMBLY
  // ---------------------------------------------------------------------

  const TRANSPORT_NETWORK = Object.freeze({
    MODES,
    RAIL_LINES,

    // Mutation / loading
    addRoute,
    addRoutes,

    // Queries
    getRouteById,
    getAllRoutes,
    getRoutesByMode,
    getRoutesByOperator,
    getRoutesByRegion,
    getRoutesByStopName,
    searchStopNames,
    findDirectRoutes,
    findNearestStops,
    distanceKm,
    getStats,
  });

  // Load seed data at startup. Errors (if any) are logged, not thrown,
  // so a malformed seed entry never breaks the whole app.
  TRANSPORT_NETWORK.addRoutes(SEED_ROUTES);

  // Expose globally, as required.
  global.TRANSPORT_NETWORK = TRANSPORT_NETWORK;
})(window);
