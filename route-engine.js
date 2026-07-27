/**
 * route-engine.js
 * ---------------------------------------------------------------------------
 * CGPH Route Engine
 *
 * Vanilla JavaScript. Consumes window.TRANSPORT_NETWORK (from
 * transport-network.js) as its ONLY data source and exposes:
 *
 *   window.ROUTE_ENGINE = {
 *     findNearestPlace(origin),
 *     findNearestTransport(origin, destination),
 *     searchRoutes(origin, destination),
 *     buildJourney(route)
 *   }
 *
 * This file does NOT touch route.js or any DOM elements. It is a pure data
 * / logic layer that route.js can be wired up to later.
 *
 * ---------------------------------------------------------------------------
 * ASSUMED window.TRANSPORT_NETWORK SHAPE
 * ---------------------------------------------------------------------------
 * This engine expects (but normalizes defensively around) a structure like:
 *
 *   window.TRANSPORT_NETWORK = {
 *     places: [
 *       { id: "balibago-terminal", name: "Balibago Jeep Terminal",
 *         lat: 14.xxx, lng: 121.xxx, type: "terminal" },
 *       ...
 *     ],
 *     routes: [
 *       { id: "balibago-crossing", name: "Balibago - Crossing Jeep",
 *         mode: "jeep", fare: 15,
 *         stops: ["balibago-terminal", "crossing-calamba", ...] },
 *       ...
 *     ]
 *   }
 *
 * If your actual transport-network.js uses different key names
 * (e.g. "stations" instead of "places", "lines" instead of "routes",
 * "latitude"/"longitude" instead of "lat"/"lng"), adjust the FIELD_ALIASES
 * table below — no other code needs to change.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  // ===========================================================================
  // CONFIG
  // ===========================================================================

  // Alternate property names this engine will check, in order, when reading
  // data out of window.TRANSPORT_NETWORK. Edit this table if your network's
  // field names differ from the assumed shape above.
  const FIELD_ALIASES = {
    places: ['places', 'stops', 'stations', 'locations', 'terminals'],
    routes: ['routes', 'lines', 'transportRoutes', 'transitRoutes'],

    placeId: ['id', 'placeId', 'stopId'],
    placeName: ['name', 'label', 'title'],
    placeLat: ['lat', 'latitude'],
    placeLng: ['lng', 'lon', 'longitude'],
    placeType: ['type', 'category'],

    routeId: ['id', 'routeId', 'lineId'],
    routeName: ['name', 'label', 'title'],
    routeMode: ['mode', 'type', 'vehicle'],
    routeFare: ['fare', 'baseFare', 'price'],
    routeStops: ['stops', 'stopIds', 'path', 'waypoints']
  };

  const SEARCH_CONFIG = {
    // How far (km) a place may be from origin/destination and still count
    // as "reachable on foot" when matching a boarding/alighting stop.
    MAX_WALK_TO_STOP_KM: 2,

    WALK_SPEED_KMH: 4.5,

    // Fallback speed/fare used only if a matched route is missing data.
    DEFAULT_RIDE_SPEED_KMH: 18,
    DEFAULT_RIDE_FARE: 13,

    // Max number of route options returned by searchRoutes().
    MAX_ROUTE_OPTIONS: 3
  };

  // ===========================================================================
  // LOW-LEVEL HELPERS
  // ===========================================================================

  function pickField(obj, aliasList) {
    if (!obj) return undefined;
    for (let i = 0; i < aliasList.length; i++) {
      const key = aliasList[i];
      if (obj[key] !== undefined && obj[key] !== null) return obj[key];
    }
    return undefined;
  }

  function toRadians(deg) {
    return (deg * Math.PI) / 180;
  }

  // Haversine great-circle distance in kilometers.
  function distanceKm(a, b) {
    if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) {
      return Infinity;
    }
    const R = 6371;
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const h =
      sinDLat * sinDLat +
      Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinDLng * sinDLng;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function formatDistance(km) {
    if (km < 1) return Math.round(km * 1000) + ' m';
    return km.toFixed(1) + ' km';
  }

  function formatDuration(minutes) {
    return Math.max(1, Math.round(minutes)) + ' min';
  }

  function walkMinutes(km) {
    return (km / SEARCH_CONFIG.WALK_SPEED_KMH) * 60;
  }

  // Normalizes an arbitrary point-like input into { lat, lng } or null.
  // Accepts { lat, lng }, { latitude, longitude }, or a place object.
  function normalizePoint(input) {
    if (!input) return null;
    const lat = pickField(input, FIELD_ALIASES.placeLat);
    const lng = pickField(input, FIELD_ALIASES.placeLng);
    if (lat == null || lng == null) return null;
    return { lat: Number(lat), lng: Number(lng) };
  }

  // ===========================================================================
  // NETWORK ACCESS / NORMALIZATION
  // ===========================================================================

  function getNetwork() {
    const net = window.TRANSPORT_NETWORK;
    if (!net) {
      console.warn('[route-engine.js] window.TRANSPORT_NETWORK is not defined.');
      return null;
    }
    return net;
  }

  function getRawPlaces() {
    const net = getNetwork();
    if (!net) return [];
    const raw = pickField(net, FIELD_ALIASES.places);
    return Array.isArray(raw) ? raw : [];
  }

  function getRawRoutes() {
    const net = getNetwork();
    if (!net) return [];
    const raw = pickField(net, FIELD_ALIASES.routes);
    return Array.isArray(raw) ? raw : [];
  }

  // Normalized place: { id, name, lat, lng, type, raw }
  function normalizePlace(raw) {
    if (!raw) return null;
    const lat = pickField(raw, FIELD_ALIASES.placeLat);
    const lng = pickField(raw, FIELD_ALIASES.placeLng);
    return {
      id: pickField(raw, FIELD_ALIASES.placeId),
      name: pickField(raw, FIELD_ALIASES.placeName) || 'Unnamed place',
      lat: lat != null ? Number(lat) : null,
      lng: lng != null ? Number(lng) : null,
      type: pickField(raw, FIELD_ALIASES.placeType) || 'place',
      raw: raw
    };
  }

  // Normalized route: { id, name, mode, fare, stopIds: [...], raw }
  function normalizeRoute(raw) {
    if (!raw) return null;
    const stopsField = pickField(raw, FIELD_ALIASES.routeStops) || [];

    // Stops may be an array of ids (strings) or embedded place objects.
    const stopIds = stopsField.map(function (s) {
      if (typeof s === 'string' || typeof s === 'number') return s;
      return pickField(s, FIELD_ALIASES.placeId);
    });

    return {
      id: pickField(raw, FIELD_ALIASES.routeId),
      name: pickField(raw, FIELD_ALIASES.routeName) || 'Unnamed route',
      mode: (pickField(raw, FIELD_ALIASES.routeMode) || 'jeep').toString().toLowerCase(),
      fare: pickField(raw, FIELD_ALIASES.routeFare),
      stopIds: stopIds,
      raw: raw
    };
  }

  function getAllPlaces() {
    return getRawPlaces().map(normalizePlace).filter(function (p) {
      return p && p.lat != null && p.lng != null;
    });
  }

  function getAllRoutes() {
    return getRawRoutes().map(normalizeRoute).filter(function (r) {
      return r && r.stopIds.length > 0;
    });
  }

  function findPlaceById(placeId, placesCache) {
    const places = placesCache || getAllPlaces();
    for (let i = 0; i < places.length; i++) {
      if (places[i].id === placeId) return places[i];
    }
    return null;
  }

  // ===========================================================================
  // PUBLIC: findNearestPlace(origin)
  // ===========================================================================

  /**
   * Finds the network place nearest to the given origin.
   * @param {{lat:number,lng:number}} origin
   * @param {{type?: string}} [opts] optional filter (e.g. { type: 'terminal' })
   * @returns {{place: object, distanceKm: number}|null}
   */
  function findNearestPlace(origin, opts) {
    const point = normalizePoint(origin);
    if (!point) {
      console.warn('[route-engine.js] findNearestPlace: invalid origin coordinates.');
      return null;
    }

    let places = getAllPlaces();
    if (opts && opts.type) {
      places = places.filter(function (p) {
        return p.type === opts.type;
      });
    }

    if (places.length === 0) return null;

    let nearest = null;
    let nearestDist = Infinity;

    places.forEach(function (place) {
      const d = distanceKm(point, place);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = place;
      }
    });

    if (!nearest) return null;
    return { place: nearest, distanceKm: nearestDist };
  }

  // ===========================================================================
  // PUBLIC: findNearestTransport(origin, destination)
  // ===========================================================================

  /**
   * Finds transport routes that have a stop reachable on foot from origin
   * AND a stop reachable on foot from destination, ranked by combined
   * walking distance (shortest first).
   *
   * @param {{lat:number,lng:number}} origin
   * @param {{lat:number,lng:number}} destination
   * @returns {Array<{
   *   route: object,
   *   boardingStop: object, boardingDistanceKm: number,
   *   alightingStop: object, alightingDistanceKm: number
   * }>}
   */
  function findNearestTransport(origin, destination) {
    const originPoint = normalizePoint(origin);
    const destPoint = normalizePoint(destination);

    if (!originPoint || !destPoint) {
      console.warn('[route-engine.js] findNearestTransport: invalid origin/destination.');
      return [];
    }

    const places = getAllPlaces();
    const routes = getAllRoutes();
    const matches = [];

    routes.forEach(function (route) {
      let bestBoarding = null;
      let bestBoardingDist = Infinity;
      let bestAlighting = null;
      let bestAlightingDist = Infinity;

      route.stopIds.forEach(function (stopId) {
        const stopPlace = findPlaceById(stopId, places);
        if (!stopPlace) return;

        const dOrigin = distanceKm(originPoint, stopPlace);
        if (dOrigin < bestBoardingDist) {
          bestBoardingDist = dOrigin;
          bestBoarding = stopPlace;
        }

        const dDest = distanceKm(destPoint, stopPlace);
        if (dDest < bestAlightingDist) {
          bestAlightingDist = dDest;
          bestAlighting = stopPlace;
        }
      });

      const withinWalkRange =
        bestBoarding &&
        bestAlighting &&
        bestBoarding.id !== bestAlighting.id &&
        bestBoardingDist <= SEARCH_CONFIG.MAX_WALK_TO_STOP_KM &&
        bestAlightingDist <= SEARCH_CONFIG.MAX_WALK_TO_STOP_KM;

      if (withinWalkRange) {
        matches.push({
          route: route,
          boardingStop: bestBoarding,
          boardingDistanceKm: bestBoardingDist,
          alightingStop: bestAlighting,
          alightingDistanceKm: bestAlightingDist
        });
      }
    });

    matches.sort(function (a, b) {
      return (a.boardingDistanceKm + a.alightingDistanceKm) -
             (b.boardingDistanceKm + b.alightingDistanceKm);
    });

    return matches;
  }

  // ===========================================================================
  // PUBLIC: searchRoutes(origin, destination)
  // ===========================================================================

  /**
   * Searches for viable route options between origin and destination.
   * Tries direct rides first (single transport leg), then falls back to a
   * one-transfer search (two transport legs sharing a common stop).
   *
   * Each returned option has the shape:
   * {
   *   origin, destination,
   *   totalFare, totalTimeMin, totalDistanceKm,
   *   legs: [
   *     { type: 'walk', from, to, distanceKm },
   *     { type: 'ride', route, from, to },
   *     { type: 'walk', from, to, distanceKm }   // ...and so on
   *   ]
   * }
   *
   * @param {{lat:number,lng:number}} origin
   * @param {{lat:number,lng:number,name?:string}} destination
   * @returns {Array<object>} route options, best (shortest) first
   */
  function searchRoutes(origin, destination) {
    const originPoint = normalizePoint(origin);
    const destPoint = normalizePoint(destination);

    if (!originPoint || !destPoint) {
      console.warn('[route-engine.js] searchRoutes: invalid origin/destination.');
      return [];
    }

    const options = [];

    // --- 1. Direct routes (single ride covers boarding stop -> alighting stop) ---
    const direct = findNearestTransport(originPoint, destPoint);

    direct.forEach(function (match) {
      options.push(buildOptionFromLegs(originPoint, destPoint, [match]));
    });

    // --- 2. One-transfer routes, only attempted if we have few/no direct hits ---
    if (options.length < SEARCH_CONFIG.MAX_ROUTE_OPTIONS) {
      const transferOptions = findOneTransferOptions(originPoint, destPoint);
      transferOptions.forEach(function (legPair) {
        options.push(buildOptionFromLegs(originPoint, destPoint, legPair));
      });
    }

    // Rank by total time, then fare.
    options.sort(function (a, b) {
      if (a.totalTimeMin !== b.totalTimeMin) return a.totalTimeMin - b.totalTimeMin;
      return a.totalFare - b.totalFare;
    });

    // Attach destination display name for later use by buildJourney().
    options.forEach(function (opt) {
      opt.destinationName = destination && destination.name ? destination.name : 'your destination';
    });

    return options.slice(0, SEARCH_CONFIG.MAX_ROUTE_OPTIONS);
  }

  // Finds pairs of routes [legA, legB] that connect via a shared stop,
  // where legA is boardable near origin and legB is alightable near destination.
  function findOneTransferOptions(originPoint, destPoint) {
    const places = getAllPlaces();
    const routes = getAllRoutes();
    const results = [];

    // Routes with a stop near the origin.
    const originCandidates = routes
      .map(function (route) {
        let best = null;
        let bestDist = Infinity;
        route.stopIds.forEach(function (stopId) {
          const p = findPlaceById(stopId, places);
          if (!p) return;
          const d = distanceKm(originPoint, p);
          if (d < bestDist) {
            bestDist = d;
            best = p;
          }
        });
        return best && bestDist <= SEARCH_CONFIG.MAX_WALK_TO_STOP_KM
          ? { route: route, boardingStop: best, boardingDistanceKm: bestDist }
          : null;
      })
      .filter(Boolean);

    // Routes with a stop near the destination.
    const destCandidates = routes
      .map(function (route) {
        let best = null;
        let bestDist = Infinity;
        route.stopIds.forEach(function (stopId) {
          const p = findPlaceById(stopId, places);
          if (!p) return;
          const d = distanceKm(destPoint, p);
          if (d < bestDist) {
            bestDist = d;
            best = p;
          }
        });
        return best && bestDist <= SEARCH_CONFIG.MAX_WALK_TO_STOP_KM
          ? { route: route, alightingStop: best, alightingDistanceKm: bestDist }
          : null;
      })
      .filter(Boolean);

    originCandidates.forEach(function (a) {
      destCandidates.forEach(function (b) {
        if (a.route.id === b.route.id) return; // that's a direct route, not a transfer

        // Find a shared stop between route A and route B (the transfer point).
        const sharedStopId = a.route.stopIds.find(function (stopId) {
          return b.route.stopIds.indexOf(stopId) !== -1;
        });
        if (!sharedStopId) return;

        const transferStop = findPlaceById(sharedStopId, places);
        if (!transferStop) return;

        results.push([
          {
            route: a.route,
            boardingStop: a.boardingStop,
            boardingDistanceKm: a.boardingDistanceKm,
            alightingStop: transferStop,
            alightingDistanceKm: 0
          },
          {
            route: b.route,
            boardingStop: transferStop,
            boardingDistanceKm: 0,
            alightingStop: b.alightingStop,
            alightingDistanceKm: b.alightingDistanceKm
          }
        ]);
      });
    });

    return results;
  }

  // Assembles a full route option (with walk legs at each end) from one or
  // more ride "matches" as returned by findNearestTransport / the transfer
  // search above.
  function buildOptionFromLegs(originPoint, destPoint, rideMatches) {
    const legs = [];
    let totalFare = 0;
    let totalTimeMin = 0;
    let totalDistanceKm = 0;

    // Walk from origin to the first boarding stop.
    const firstBoarding = rideMatches[0].boardingStop;
    const walkToFirstKm = distanceKm(originPoint, firstBoarding);
    legs.push({ type: 'walk', from: originPoint, to: firstBoarding, distanceKm: walkToFirstKm });
    totalTimeMin += walkMinutes(walkToFirstKm);
    totalDistanceKm += walkToFirstKm;

    rideMatches.forEach(function (match, index) {
      const route = match.route;
      const rideDistanceKm = distanceKm(match.boardingStop, match.alightingStop);
      const rideSpeed = SEARCH_CONFIG.DEFAULT_RIDE_SPEED_KMH;
      const rideMinutes = rideDistanceKm > 0 ? (rideDistanceKm / rideSpeed) * 60 : 8; // small min if stops lack coords

      const fare = typeof route.fare === 'number' ? route.fare : SEARCH_CONFIG.DEFAULT_RIDE_FARE;

      legs.push({
        type: route.mode || 'jeep',
        route: route,
        from: match.boardingStop,
        to: match.alightingStop,
        fare: fare,
        durationMin: rideMinutes
      });

      totalFare += fare;
      totalTimeMin += rideMinutes;
      totalDistanceKm += rideDistanceKm;

      // If there's a next leg, this is a transfer point.
      if (index < rideMatches.length - 1) {
        legs.push({ type: 'stop', at: match.alightingStop });
      }
    });

    // Walk from the last alighting stop to the destination.
    const lastAlighting = rideMatches[rideMatches.length - 1].alightingStop;
    const walkFromLastKm = distanceKm(lastAlighting, destPoint);
    legs.push({ type: 'walk', from: lastAlighting, to: destPoint, distanceKm: walkFromLastKm });
    totalTimeMin += walkMinutes(walkFromLastKm);
    totalDistanceKm += walkFromLastKm;

    return {
      origin: originPoint,
      destination: destPoint,
      legs: legs,
      totalFare: totalFare,
      totalTimeMin: totalTimeMin,
      totalDistanceKm: totalDistanceKm
    };
  }

  // ===========================================================================
  // PUBLIC: buildJourney(route)
  // ===========================================================================

  /**
   * Converts a route option (as returned by searchRoutes) into a flat array
   * of human-readable journey steps, e.g.:
   *
   * [
   *   { type: "walk", instruction: "Walk 100 m to Balibago Jeep Terminal",
   *     distance: "100 m", duration: "2 min" },
   *   { type: "jeep", instruction: "Ride Balibago - Crossing Jeep",
   *     fare: 15, duration: "20 min" },
   *   { type: "stop", instruction: "Get off at Crossing Calamba" },
   *   { type: "walk", instruction: "Walk to Liliw Municipal Hall" }
   * ]
   *
   * @param {object} route a route option produced by searchRoutes()
   * @returns {Array<object>} ordered journey steps
   */
  function buildJourney(route) {
    if (!route || !Array.isArray(route.legs)) {
      console.warn('[route-engine.js] buildJourney: invalid route object.');
      return [];
    }

    const steps = [];
    const destinationName = route.destinationName || 'your destination';

    route.legs.forEach(function (leg, index) {
      if (leg.type === 'walk') {
        const isFinalLeg = index === route.legs.length - 1;
        const toName = leg.to && leg.to.name ? leg.to.name : (isFinalLeg ? destinationName : 'the next stop');

        const step = {
          type: 'walk',
          instruction: 'Walk ' + (isFinalLeg ? 'to ' + toName : formatDistance(leg.distanceKm) + ' to ' + toName)
        };

        // Only attach distance/duration when we actually have real
        // coordinates to compute them from (keeps the final "walk to
        // destination" step clean when the destination has no matched stop).
        if (isFinite(leg.distanceKm) && leg.distanceKm >= 0 && leg.to && leg.to.lat != null) {
          step.distance = formatDistance(leg.distanceKm);
          step.duration = formatDuration(walkMinutes(leg.distanceKm));
        }

        steps.push(step);
      } else if (leg.type === 'stop') {
        steps.push({
          type: 'stop',
          instruction: 'Get off at ' + (leg.at && leg.at.name ? leg.at.name : 'the transfer point')
        });
      } else {
        // Any ride leg: jeep, bus, tricycle, etc. — 'type' mirrors the
        // route's mode so downstream UI can pick an appropriate icon.
        steps.push({
          type: leg.type,
          instruction: 'Ride ' + (leg.route && leg.route.name ? leg.route.name : 'transport'),
          fare: leg.fare,
          duration: formatDuration(leg.durationMin)
        });

        // Insert a "get off" step after every ride leg except the very
        // last leg (the final walk step already conveys arrival).
        const isLastLeg = index === route.legs.length - 1;
        if (!isLastLeg && leg.to && leg.to.name) {
          steps.push({
            type: 'stop',
            instruction: 'Get off at ' + leg.to.name
          });
        }
      }
    });

    return steps;
  }

  // ===========================================================================
  // PUBLIC API EXPORT
  // ===========================================================================

  window.ROUTE_ENGINE = {
    findNearestPlace: findNearestPlace,
    findNearestTransport: findNearestTransport,
    searchRoutes: searchRoutes,
    buildJourney: buildJourney
  };
})();
