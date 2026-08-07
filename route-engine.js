/**
 * route-engine.js
 * ---------------------------------------------------------------------------
 * CGPH Route Engine
 *
 * Vanilla JavaScript. Consumes window.TRANSPORT_NETWORK (assembled from
 * transport-network-part1..4.js) as its ONLY data source and exposes:
 *
 *   window.ROUTE_ENGINE = {
 *     findNearestPlace(origin),
 *     findNearestTransport(origin, destination),
 *     searchRoutes(origin, destination),
 *     buildJourney(route)
 *   }
 *
 * PUBLIC API IS UNCHANGED from the previous version — same four functions,
 * same names, same call signatures. Everything new in this revision is an
 * ADDITIVE field on the objects these functions already returned:
 *   - route options now also carry totalWalkingDistanceKm and transferCount
 *   - each 'walk' step from buildJourney() now always carries distance/
 *     duration/heading, plus a voiceInstruction string
 *   - each 'ride'/'stop' step also gets a voiceInstruction string
 * Existing code reading route.totalFare, route.totalTimeMin, step.instruction,
 * etc. keeps working exactly as before.
 *
 * This file does NOT touch route.js or any DOM elements.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  // ===========================================================================
  // CONFIG
  // ===========================================================================

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

  // Categories checked when window.TRANSPORT_NETWORK stores routes split by
  // transport mode instead of one unified array (the shape used by
  // transport-network-part1..4.js).
  const ROUTE_CATEGORY_KEYS = ['jeepneys', 'buses', 'provincialBuses', 'uvExpress', 'trains', 'tricycles'];

  const SEARCH_CONFIG = {
    // How far (km) a place may be from origin/destination and still count
    // as "reachable on foot" when matching a boarding/alighting stop.
    MAX_WALK_TO_STOP_KM: 2,

    WALK_SPEED_KMH: 4.5,

    // Fallback speed/fare used only if a matched route's mode isn't in
    // SPEED_BY_MODE_KMH below or fare data is missing.
    DEFAULT_RIDE_SPEED_KMH: 18,
    DEFAULT_RIDE_FARE: 13,

    // Max number of route options returned by searchRoutes().
    MAX_ROUTE_OPTIONS: 3
  };

  // Realistic average speeds (km/h) by transport mode, used to estimate ride
  // duration from distance. These are rough real-world averages (including
  // typical stops/traffic) — a jeepney and a provincial bus on the same
  // corridor do NOT travel at the same speed, so a single flat figure isn't
  // usable once the network spans city streets and expressways.
  const SPEED_BY_MODE_KMH = {
    jeep: 18,
    citybus: 22,
    provincialbus: 60,
    uvexpress: 70,
    tricycle: 15,
    mrt3: 35,
    lrt1: 32,
    lrt2: 32,
    pnr: 30
  };

  function rideSpeedForMode(mode) {
    return SPEED_BY_MODE_KMH[mode] || SEARCH_CONFIG.DEFAULT_RIDE_SPEED_KMH;
  }

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

  function toDegrees(rad) {
    return (rad * 180) / Math.PI;
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

  // Compass bearing in degrees (0 = north, 90 = east, ...) from point a to b.
  function bearingDegrees(a, b) {
    if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const dLng = toRadians(b.lng - a.lng);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const brng = toDegrees(Math.atan2(y, x));
    return (brng + 360) % 360;
  }

  // Converts a bearing in degrees to an 8-point compass direction phrase.
  function compassPhrase(brng) {
    if (brng == null || isNaN(brng)) return null;
    const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    const idx = Math.round(brng / 45) % 8;
    return dirs[idx];
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
  // Accepts { lat, lng }, { latitude, longitude }, a place object with
  // flat coordinates, OR a place object with coordinates nested under
  // "coordinates" / "coords" / "position".
  function normalizePoint(input) {
    if (!input) return null;
    const coordsSource = input.coordinates || input.coords || input.position || input;
    const lat = pickField(coordsSource, FIELD_ALIASES.placeLat);
    const lng = pickField(coordsSource, FIELD_ALIASES.placeLng);
    if (lat == null || lng == null) return null;
    return { lat: Number(lat), lng: Number(lng) };
  }

  // Computes a fare (PHP) for a ride leg given the route's fare data and the
  // actual distance ridden. Supports three fare shapes:
  //   - number:                          flat fare, e.g. tricycles
  //   - { base, baseKm, perKm }:         base fare + per-km beyond baseKm
  //   - { min, max } (legacy shape):     uses min as a flat base fare
  // Falls back to SEARCH_CONFIG.DEFAULT_RIDE_FARE if fare data is missing
  // or malformed.
  function computeFare(route, rideDistanceKm) {
    const f = route.fare;
    if (typeof f === 'number' && !isNaN(f)) return f;

    if (f && typeof f === 'object') {
      if (typeof f.base === 'number') {
        const baseKm = typeof f.baseKm === 'number' ? f.baseKm : 0;
        const perKm = typeof f.perKm === 'number' ? f.perKm : 0;
        const extraKm = Math.max(0, rideDistanceKm - baseKm);
        return Math.round(f.base + extraKm * perKm);
      }
      if (typeof f.min === 'number') {
        return f.min;
      }
    }

    return SEARCH_CONFIG.DEFAULT_RIDE_FARE;
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

  // Returns the raw list of route objects. Prefers a single unified array
  // (via FIELD_ALIASES.routes) if present; otherwise merges the mode-specific
  // arrays (jeepneys, buses, provincialBuses, uvExpress, trains, tricycles).
  function getRawRoutes() {
    const net = getNetwork();
    if (!net) return [];

    const unified = pickField(net, FIELD_ALIASES.routes);
    if (Array.isArray(unified)) return unified;

    const merged = [];
    ROUTE_CATEGORY_KEYS.forEach(function (key) {
      if (Array.isArray(net[key])) {
        merged.push.apply(merged, net[key]);
      }
    });
    return merged;
  }

  // Normalized place: { id, name, lat, lng, type, raw }
  function normalizePlace(raw) {
    if (!raw) return null;
    const point = normalizePoint(raw);
    return {
      id: pickField(raw, FIELD_ALIASES.placeId),
      name: pickField(raw, FIELD_ALIASES.placeName) || 'Unnamed place',
      lat: point ? point.lat : null,
      lng: point ? point.lng : null,
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

    // --- 3. Two-transfer routes, only attempted if we still have few/no hits ---
    // (needed now that the network spans four regions — a single transfer
    // is often not enough to connect, e.g., a Quezon town to Metro Manila).
    if (options.length < SEARCH_CONFIG.MAX_ROUTE_OPTIONS) {
      const twoTransferOptions = findTwoTransferOptions(originPoint, destPoint);
      twoTransferOptions.forEach(function (legTriple) {
        options.push(buildOptionFromLegs(originPoint, destPoint, legTriple));
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

  // Routes with a stop reachable on foot from a given point.
  // Returns [{ route, stop, distanceKm }]
  function candidatesNear(point, routes, places) {
    return routes
      .map(function (route) {
        let best = null;
        let bestDist = Infinity;
        route.stopIds.forEach(function (stopId) {
          const p = findPlaceById(stopId, places);
          if (!p) return;
          const d = distanceKm(point, p);
          if (d < bestDist) {
            bestDist = d;
            best = p;
          }
        });
        return best && bestDist <= SEARCH_CONFIG.MAX_WALK_TO_STOP_KM
          ? { route: route, stop: best, distanceKm: bestDist }
          : null;
      })
      .filter(Boolean);
  }

  function sharedStop(routeA, routeB, places) {
    const sharedStopId = routeA.stopIds.find(function (stopId) {
      return routeB.stopIds.indexOf(stopId) !== -1;
    });
    if (!sharedStopId) return null;
    return findPlaceById(sharedStopId, places);
  }

  // Finds pairs of routes [legA, legB] that connect via a shared stop,
  // where legA is boardable near origin and legB is alightable near destination.
  function findOneTransferOptions(originPoint, destPoint) {
    const places = getAllPlaces();
    const routes = getAllRoutes();
    const results = [];

    const originCandidates = candidatesNear(originPoint, routes, places);
    const destCandidates = candidatesNear(destPoint, routes, places);

    originCandidates.forEach(function (a) {
      destCandidates.forEach(function (b) {
        if (a.route.id === b.route.id) return; // that's a direct route, not a transfer

        const transferStop = sharedStop(a.route, b.route, places);
        if (!transferStop) return;

        results.push([
          {
            route: a.route,
            boardingStop: a.stop,
            boardingDistanceKm: a.distanceKm,
            alightingStop: transferStop,
            alightingDistanceKm: 0
          },
          {
            route: b.route,
            boardingStop: transferStop,
            boardingDistanceKm: 0,
            alightingStop: b.stop,
            alightingDistanceKm: b.distanceKm
          }
        ]);
      });
    });

    return results;
  }

  // Finds triples of routes [legA, legB, legC] connecting via two transfer
  // points. Used as a fallback when the network is too sparse for a direct
  // or single-transfer trip (common across multi-region trips).
  function findTwoTransferOptions(originPoint, destPoint) {
    const places = getAllPlaces();
    const routes = getAllRoutes();
    const results = [];

    const originCandidates = candidatesNear(originPoint, routes, places);
    const destCandidates = candidatesNear(destPoint, routes, places);

    let found = 0;
    const MAX_RESULTS = SEARCH_CONFIG.MAX_ROUTE_OPTIONS * 2; // cap search cost

    for (let i = 0; i < originCandidates.length && found < MAX_RESULTS; i++) {
      const a = originCandidates[i];

      for (let j = 0; j < routes.length && found < MAX_RESULTS; j++) {
        const midRoute = routes[j];
        if (midRoute.id === a.route.id) continue;

        const transferStop1 = sharedStop(a.route, midRoute, places);
        if (!transferStop1) continue;

        for (let k = 0; k < destCandidates.length && found < MAX_RESULTS; k++) {
          const b = destCandidates[k];
          if (b.route.id === midRoute.id || b.route.id === a.route.id) continue;

          const transferStop2 = sharedStop(midRoute, b.route, places);
          if (!transferStop2 || transferStop2.id === transferStop1.id) continue;

          results.push([
            {
              route: a.route,
              boardingStop: a.stop,
              boardingDistanceKm: a.distanceKm,
              alightingStop: transferStop1,
              alightingDistanceKm: 0
            },
            {
              route: midRoute,
              boardingStop: transferStop1,
              boardingDistanceKm: 0,
              alightingStop: transferStop2,
              alightingDistanceKm: 0
            },
            {
              route: b.route,
              boardingStop: transferStop2,
              boardingDistanceKm: 0,
              alightingStop: b.stop,
              alightingDistanceKm: b.distanceKm
            }
          ]);
          found++;
        }
      }
    }

    return results;
  }

  // Assembles a full route option (with walk legs at each end) from one or
  // more ride "matches".
  function buildOptionFromLegs(originPoint, destPoint, rideMatches) {
    const legs = [];
    let totalFare = 0;
    let totalTimeMin = 0;
    let totalDistanceKm = 0;
    let totalWalkingDistanceKm = 0;

    // Walk from origin to the first boarding stop.
    const firstBoarding = rideMatches[0].boardingStop;
    const walkToFirstKm = distanceKm(originPoint, firstBoarding);
    legs.push({ type: 'walk', from: originPoint, to: firstBoarding, distanceKm: walkToFirstKm });
    totalTimeMin += walkMinutes(walkToFirstKm);
    totalDistanceKm += walkToFirstKm;
    totalWalkingDistanceKm += walkToFirstKm;

    rideMatches.forEach(function (match, index) {
      const route = match.route;
      const rideDistanceKm = distanceKm(match.boardingStop, match.alightingStop);
      const rideSpeed = SEARCH_CONFIG.DEFAULT_RIDE_SPEED_KMH;
      const rideMinutes = rideDistanceKm > 0 ? (rideDistanceKm / rideSpeed) * 60 : 8; // small min if stops lack coords

      const fare = computeFare(route, rideDistanceKm);

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
    totalWalkingDistanceKm += walkFromLastKm;

    // Number of vehicle-to-vehicle transfers (ride legs minus one, floored at 0).
    const transferCount = Math.max(0, rideMatches.length - 1);

    return {
      origin: originPoint,
      destination: destPoint,
      legs: legs,
      totalFare: totalFare,
      totalTimeMin: totalTimeMin,
      totalDistanceKm: totalDistanceKm,
      totalWalkingDistanceKm: totalWalkingDistanceKm,
      transferCount: transferCount
    };
  }

  // ===========================================================================
  // PUBLIC: buildJourney(route)
  // ===========================================================================

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
        const hasRealDistance = isFinite(leg.distanceKm) && leg.distanceKm >= 0;
        const brng = hasRealDistance ? bearingDegrees(leg.from, leg.to) : null;
        const heading = compassPhrase(brng);

        const distText = hasRealDistance ? formatDistance(leg.distanceKm) : null;
        const durText = hasRealDistance ? formatDuration(walkMinutes(leg.distanceKm)) : null;

   const step = {
    type: 'walk',
    instruction: isFinalLeg
        ? ' Walk ' + distText + ' to your destination.'
        : ' Walk ' +
          (distText ? distText + ' ' : '') +
          'to ' + toName + '.'
};

        if (hasRealDistance) {
          step.distance = distText;
          step.duration = durText;
          step.headingDegrees = brng;
          step.headingDirection = heading;
        }

        step.voiceInstruction = 'Walk ' +
          (durText ? 'for about ' + durText + ' ' : 'ahead ') +
          (heading ? '(' + heading + ') ' : '') +
          'toward ' + toName + '.';

        steps.push(step);
        // If this was the final walk, show arrival.
if (isFinalLeg) {
    steps.push({
        type: 'arrival',
        instruction: ' You have arrived at your destination.',
        voiceInstruction: 'You have arrived at your destination.'
    });
}
      } else if (leg.type === 'stop') {
        const stopName = leg.at && leg.at.name ? leg.at.name : 'the transfer point';
        steps.push({
          type: 'stop',
          instruction: 'Get off at ' + stopName + '.',
          voiceInstruction: 'Prepare to get off at ' + stopName + '.'
        });
     } else {

    // Ride step
    const routeName = leg.route && leg.route.name
        ? leg.route.name
        : 'transport';

    const durText = formatDuration(leg.durationMin);

    steps.push({
        type: leg.type,
        instruction: 'Board the ' + routeName + '. Ride for approximately ' + durText + '.',
        fare: leg.fare,
        duration: durText,
        voiceInstruction: 'Board the ' + routeName + '. Remain on board for approximately ' + durText + '.'
    });

    // Get off
    if (leg.to && leg.to.name) {
        steps.push({
            type: 'stop',
            instruction: 'Get off at ' + leg.to.name + '.',
            voiceInstruction: 'Prepare to get off at ' + leg.to.name + '.'
        });
    }
}

}); // End route.legs.forEach()

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
