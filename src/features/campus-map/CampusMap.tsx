import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker, LatLngBoundsExpression } from 'leaflet';
import { CAMPUS_LOCATIONS, LOCATION_DATA_VERIFIED_ON } from '../campus-locations/index.ts';
import type { CampusLocationCategory } from '../campus-locations/index.ts';
import {
  MAP_CATEGORIES,
  MAP_CATEGORY_LABELS,
  buildBrowsingBounds,
  buildInitialBounds,
  filterMapLocations,
  toMapLocations,
} from './mapLocations.ts';
import type { MapLocation } from './mapLocations.ts';
import {
  MAP_DISCLAIMER,
  MAP_FIT_PADDING_PX,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  OSM_ATTRIBUTION_HTML,
  OSM_COPYRIGHT_URL,
  OSM_TILE_URL,
} from './config.ts';
import 'leaflet/dist/leaflet.css';
import './campusMap.css';

type MapStatus = 'loading' | 'ready' | 'error';

/**
 * Gives a Leaflet marker icon explicit keyboard semantics.
 *
 * Leaflet's own `keyboard` option only wires Enter (and varies across versions),
 * so the element is handled here instead: focusable, labelled, Enter activates
 * once on keydown, Space suppresses page scrolling on keydown and activates once
 * on keyup. `event.repeat` guards against auto-repeat firing selection twice.
 *
 * The icon element is recreated whenever a marker is removed and re-added by the
 * category filter, so this is idempotent per element via a data flag.
 */
function decorateMarker(marker: Marker, location: MapLocation, onActivate: (id: string) => void): void {
  const element = marker.getElement();
  if (!element) return;

  element.setAttribute('tabindex', '0');
  element.setAttribute('role', 'button');
  element.setAttribute(
    'aria-label',
    `${location.name}, ${MAP_CATEGORY_LABELS[location.category]}. Select to show details.`,
  );

  if (element.dataset.cpKeyboardBound === 'true') return;
  element.dataset.cpKeyboardBound = 'true';

  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      if (event.repeat) return;
      event.preventDefault();
      onActivate(location.id);
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      // Stop the page from scrolling; the selection happens on keyup only.
      event.preventDefault();
    }
  });

  element.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      onActivate(location.id);
    }
  });
}

/**
 * Read-only campus map of the verified locations.
 *
 * It shows approximate building points on OpenStreetMap tiles and nothing else:
 * no live opening hours, occupancy, access decisions, routing or booking state.
 * Leaflet is imported lazily inside an effect so the panel still renders (and
 * the list still works) when the map library or the tile service is unavailable.
 */
export function CampusMap() {
  const locations = useMemo(() => toMapLocations(CAMPUS_LOCATIONS, LOCATION_DATA_VERIFIED_ON), []);
  const initialBounds = useMemo(() => buildInitialBounds(locations), [locations]);
  const browsingBounds = useMemo(() => buildBrowsingBounds(initialBounds), [initialBounds]);

  const [active, setActive] = useState<ReadonlySet<CampusLocationCategory>>(() => new Set(MAP_CATEGORIES));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<MapStatus>('loading');
  const [tileIssue, setTileIssue] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef(new Map<string, Marker>());
  const initialBoundsRef = useRef<LatLngBoundsExpression | null>(null);

  const visible = filterMapLocations(locations, active);
  const selected = locations.find((location) => location.id === selectedId) ?? null;

  // Create the map once; clean up the instance, listeners and markers on unmount
  // (StrictMode mounts, unmounts and remounts in development).
  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;

    const createMap = async () => {
      try {
        const leaflet = await import('leaflet');
        if (cancelled || !containerRef.current) return;

        const bounds = leaflet.latLngBounds(
          [browsingBounds.south, browsingBounds.west],
          [browsingBounds.north, browsingBounds.east],
        );
        const fitBounds = leaflet.latLngBounds(
          [initialBounds.south, initialBounds.west],
          [initialBounds.north, initialBounds.east],
        );
        initialBoundsRef.current = fitBounds;

        map = leaflet.map(containerRef.current, {
          minZoom: MAP_MIN_ZOOM,
          maxZoom: MAP_MAX_ZOOM,
          maxBounds: bounds,
          maxBoundsViscosity: 0.6,
          scrollWheelZoom: false,
        });

        const tiles = leaflet.tileLayer(OSM_TILE_URL, {
          attribution: OSM_ATTRIBUTION_HTML,
          maxZoom: MAP_MAX_ZOOM,
        });
        tiles.on('tileerror', () => {
          if (!cancelled) setTileIssue(true);
        });
        tiles.addTo(map);

        // The first view must come before markers: Leaflet defers layer `onAdd`
        // until the map has loaded, so markers added earlier would have no DOM
        // element to receive tabindex, role or key handlers.
        map.fitBounds(fitBounds, { padding: MAP_FIT_PADDING_PX });
        const createdMap = map;

        createdMap.whenReady(() => {
          if (cancelled) return;
          for (const location of locations) {
            const marker = leaflet.marker([location.lat, location.lng], {
              icon: leaflet.divIcon({
                className: `cp-map__pin cp-map__pin--${location.category}`,
                html: '<span class="cp-map__pin-dot"></span>',
                iconSize: [16, 16],
                iconAnchor: [8, 8],
              }),
              title: location.name,
              alt: location.name,
              // Handled explicitly in decorateMarker so Enter/Space cannot double-fire.
              keyboard: false,
            });
            marker.on('click', () => selectLocation(location.id));
            marker.addTo(createdMap);
            decorateMarker(marker, location, selectLocation);
            markersRef.current.set(location.id, marker);
          }

          mapRef.current = createdMap;
          setStatus('ready');
        });
      } catch {
        if (!cancelled) setStatus('error');
      }
    };

    void createMap();

    return () => {
      cancelled = true;
      markersRef.current.clear();
      map?.remove();
      map = null;
      mapRef.current = null;
    };
  }, [locations, browsingBounds, initialBounds]);

  // Category filters only show or hide markers; the map view is untouched.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    for (const location of locations) {
      const marker = markersRef.current.get(location.id);
      if (!marker) continue;
      const shouldShow = active.has(location.category);
      const shown = map.hasLayer(marker);
      if (shouldShow && !shown) {
        marker.addTo(map);
        // Re-adding recreates the icon element, so re-apply keyboard semantics.
        decorateMarker(marker, location, selectLocation);
      }
      if (!shouldShow && shown) map.removeLayer(marker);
    }
  }, [active, locations, status]);

  // A hidden selection must not stay highlighted in the details panel.
  useEffect(() => {
    if (selectedId && !visible.some((location) => location.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, visible]);

  /** Single selection path shared by marker clicks, marker keys and the list. */
  function selectLocation(id: string) {
    setSelectedId(id);
  }

  function toggleCategory(category: CampusLocationCategory) {
    setActive((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function focusLocation(location: MapLocation) {
    setSelectedId(location.id);
    const map = mapRef.current;
    if (map) map.setView([location.lat, location.lng], Math.max(map.getZoom(), 17));
  }

  function returnToCampusView() {
    const map = mapRef.current;
    const bounds = initialBoundsRef.current;
    if (map && bounds) map.fitBounds(bounds, { padding: MAP_FIT_PADDING_PX });
  }

  return (
    <section className="cp-panel cp-map" aria-labelledby="cp-map-heading">
      <div className="cp-panel__head">
        <h2 id="cp-map-heading">Campus locations map</h2>
        <p className="cp-panel__meta">
          {locations.length} verified places · approximate building points · no live status
        </p>
      </div>

      <div className="cp-map__filters" role="group" aria-label="Filter locations by category">
        {MAP_CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            className={`cp-map__filter${active.has(category) ? ' is-active' : ''}`}
            aria-pressed={active.has(category)}
            onClick={() => toggleCategory(category)}
          >
            {MAP_CATEGORY_LABELS[category]}
          </button>
        ))}
        <button type="button" className="cp-map__filter" onClick={returnToCampusView} disabled={status !== 'ready'}>
          Return to campus view
        </button>
      </div>

      <div className="cp-map__layout">
        <div className="cp-map__canvas-wrap">
          {status === 'error' ? (
            <p className="cp-hint cp-map__fallback">
              The interactive map could not load. The location list and its official links below still work.
            </p>
          ) : (
            <div ref={containerRef} className="cp-map__canvas" role="application" aria-label="Campus map" />
          )}

          {status === 'loading' && <p className="cp-hint">Loading the map…</p>}

          {tileIssue && (
            <p className="cp-hint cp-map__fallback">
              Some map tiles failed to load. The location list and its official links still work.
            </p>
          )}
        </div>

        <div className="cp-map__side">
          <ul className="cp-map__list">
            {visible.map((location) => (
              <li key={location.id}>
                <button
                  type="button"
                  className={`cp-map__item${location.id === selectedId ? ' is-selected' : ''}`}
                  aria-pressed={location.id === selectedId}
                  onClick={() => focusLocation(location)}
                >
                  <span className="cp-map__item-name">{location.name}</span>
                  <span className="cp-map__item-meta">{MAP_CATEGORY_LABELS[location.category]}</span>
                </button>
              </li>
            ))}
          </ul>

          {visible.length === 0 && <p className="cp-hint">No locations match the current categories.</p>}

          {selected && (
            <div className="cp-map__details">
              <h3 className="cp-subhead">{selected.name}</h3>
              <p className="cp-map__details-line">{MAP_CATEGORY_LABELS[selected.category]}</p>
              <p className="cp-map__details-line">{selected.address}</p>
              <p className="cp-hint">
                Marker is an approximate building point, not an entrance or room. CampusPilot shows no opening
                hours, occupancy, access permission or booking status here.
              </p>
              <p className="cp-map__details-line">
                <a className="cp-locations__link" href={selected.infoUrl} target="_blank" rel="noreferrer noopener">
                  Official location page
                </a>
                {selected.reservationUrl && (
                  <>
                    {' · '}
                    <a
                      className="cp-locations__link"
                      href={selected.reservationUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Official reservation page
                    </a>
                  </>
                )}
              </p>
              {selected.verifiedOn && (
                <p className="cp-map__details-line">Location data verified {selected.verifiedOn}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="cp-panel__foot cp-map__attribution">
        {MAP_DISCLAIMER}{' '}
        <a className="cp-locations__link" href={OSM_COPYRIGHT_URL} target="_blank" rel="noreferrer noopener">
          OpenStreetMap copyright and licence
        </a>
      </p>
    </section>
  );
}
