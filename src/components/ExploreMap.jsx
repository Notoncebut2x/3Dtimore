import { useState, useEffect, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer, ScatterplotLayer, IconLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/maplibre';

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

const BW_SATELLITE_STYLE = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution: '© Esri'
    }
  },
  layers: [{
    id: 'satellite-layer',
    type: 'raster',
    source: 'satellite',
    paint: {
      'raster-saturation': -1,
      'raster-brightness-max': 0.75,
      'raster-contrast': 0.15
    }
  }]
};

const INITIAL_VIEW = {
  longitude: -76.6122,
  latitude: 39.2904,
  zoom: 11.5,
  pitch: 0,
  bearing: 0,
  minZoom: 9,
  maxZoom: 18
};

// Sonar dot — Inner Harbor landmark
const SONAR_ORIGIN = [-76.6122, 39.2848];

const NEON_YELLOW = [220, 255, 0];
const NEON_YELLOW_HOVER = [255, 220, 0];

function formatCurrency(n) {
  if (!n || n <= 0) return 'N/A';
  return '$' + n.toLocaleString();
}

function WalkScoreBadge({ score }) {
  const color =
    score >= 90 ? 'text-green-400' :
    score >= 70 ? 'text-lime-400' :
    score >= 50 ? 'text-yellow-400' :
    score >= 25 ? 'text-orange-400' : 'text-red-400';
  const label =
    score >= 90 ? "Walker's Paradise" :
    score >= 70 ? 'Very Walkable' :
    score >= 50 ? 'Somewhat Walkable' :
    score >= 25 ? 'Car-Dependent' : 'Minimal Walkability';
  return (
    <div className="flex items-center gap-2">
      <span className={`text-3xl font-black tabular-nums ${color}`}>{score}</span>
      <div>
        <div className={`text-xs font-semibold ${color}`}>{label}</div>
        <div className="text-xs text-white/40">Walk Score</div>
      </div>
    </div>
  );
}

function SplitBar({ leftLabel, leftPct, rightLabel, rightPct, leftColor, rightColor }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span style={{ color: leftColor }}>{leftLabel} <span className="font-bold">{leftPct}%</span></span>
        <span style={{ color: rightColor }}>{rightLabel} <span className="font-bold">{rightPct}%</span></span>
      </div>
      <div className="h-2 rounded-full overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-l-full" style={{ width: `${Math.min(100, leftPct)}%`, background: leftColor, opacity: 0.85 }} />
        <div className="h-full rounded-r-full" style={{ width: `${Math.min(100, rightPct)}%`, background: rightColor, opacity: 0.6 }} />
      </div>
    </div>
  );
}

function NeighborhoodPanel({ feature, onClose, onStartTour, activePins, onTogglePins }) {
  const p = feature.properties;
  const hh = p.household || {};
  const occ = p.occupancy || {};
  const transit = p.transit || {};
  const grocery = p.grocery || {};

  return (
    <div
      className="absolute left-4 top-1/2 -translate-y-1/2 w-80 rounded-2xl overflow-hidden shadow-2xl"
      style={{
        background: 'rgba(8,8,16,0.92)',
        border: '1px solid rgba(220,255,0,0.25)',
        backdropFilter: 'blur(20px)',
        maxHeight: '90vh',
        overflowY: 'auto'
      }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(220,255,0,0.12)' }}>
        <div className="flex items-start justify-between">
          <div>
            <div
              className="text-xs font-semibold tracking-widest uppercase mb-1"
              style={{ color: 'rgba(220,255,0,0.7)' }}
            >
              Baltimore NSA
            </div>
            <h2 className="text-xl font-bold text-white leading-tight">{p.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="ml-2 mt-0.5 text-white/40 hover:text-white transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Walk Score */}
        <WalkScoreBadge score={p.walk_score || 0} />

        {/* Population & Income */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl p-3" style={{ background: 'rgba(220,255,0,0.07)' }}>
            <div className="text-xs text-white/40 mb-0.5">Population</div>
            <div className="text-lg font-bold text-white">{(p.population || 0).toLocaleString()}</div>
          </div>
          <div className="rounded-xl p-3" style={{ background: 'rgba(220,255,0,0.07)' }}>
            <div className="text-xs text-white/40 mb-0.5">Median Income</div>
            <div className="text-lg font-bold text-white">{formatCurrency(p.median_income)}</div>
          </div>
        </div>

        {/* Household Size */}
        <div>
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Household Size</div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl p-2.5 text-center col-span-1" style={{ background: 'rgba(220,255,0,0.07)' }}>
              <div className="text-2xl font-black text-white">{hh.avg_size || '—'}</div>
              <div className="text-xs text-white/40 mt-0.5">Avg persons</div>
            </div>
            <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="text-lg font-black text-white">{hh.family_pct || 0}%</div>
              <div className="text-xs text-white/40 mt-0.5">Family HH</div>
            </div>
            <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="text-lg font-black text-white">{hh.nonfamily_pct || 0}%</div>
              <div className="text-xs text-white/40 mt-0.5">Non-family</div>
            </div>
          </div>
        </div>

        {/* Housing Occupancy */}
        <div>
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Housing Occupancy</div>
          <div className="space-y-2.5 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <SplitBar
              leftLabel="Owner" leftPct={occ.owner_pct || 0} leftColor="#dcff00"
              rightLabel="Renter" rightPct={occ.renter_pct || 0} rightColor="#a78bfa"
            />
            <SplitBar
              leftLabel="Occupied" leftPct={occ.occupied_pct || 0} leftColor="#34d399"
              rightLabel="Vacant" rightPct={occ.vacant_pct || 0} rightColor="#f87171"
            />
            <div className="text-xs text-white/30 pt-0.5">{(occ.total_units || 0).toLocaleString()} total units</div>
          </div>
        </div>

        {/* Housing Type */}
        <div>
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Household Composition</div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
            {[
              { label: 'Married-couple families', pct: hh.married_pct || 0, color: '#dcff00' },
              { label: 'Other family households', pct: parseFloat(Math.max(0, (hh.family_pct || 0) - (hh.married_pct || 0)).toFixed(1)), color: '#60a5fa' },
              { label: 'Non-family / single', pct: hh.nonfamily_pct || 0, color: '#a78bfa' }
            ].map(({ label, pct, color }, i) => (
              <div
                key={label}
                className="flex items-center justify-between px-3 py-2"
                style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-xs text-white/70">{label}</span>
                </div>
                <span className="text-xs font-bold text-white">{pct}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Transit */}
        <div>
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
            Transit <span className="normal-case font-normal text-white/30">within 15 min walk</span>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
            {[
              { label: 'Bus', key: 'bus', icon: '🚌' },
              { label: 'Light Rail', key: 'light_rail', icon: '🚊' },
              { label: 'Subway', key: 'subway', icon: '🚇' }
            ].map(({ label, key, icon }, i) => {
              const available = transit.within_15min?.[key] ?? false;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between px-3 py-2.5"
                  style={{
                    background: available ? 'rgba(220,255,0,0.06)' : 'rgba(255,255,255,0.02)',
                    borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none'
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">{icon}</span>
                    <span className="text-sm text-white/80">{label}</span>
                  </div>
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{
                      background: available ? 'rgba(220,255,0,0.2)' : 'rgba(255,255,255,0.06)',
                      color: available ? '#dcff00' : 'rgba(255,255,255,0.2)'
                    }}
                  >
                    {available ? '✓' : '✕'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Grocery */}
        <div>
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Supermarket Access</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: '15min', label: 'Within 15 min', count: grocery.within_15min_drive || 0 },
              { key: '30min', label: 'Within 30 min', count: grocery.within_30min_drive || 0 },
            ].map(({ key, label, count }) => {
              const active = activePins === key;
              return (
                <button
                  key={key}
                  onClick={() => onTogglePins(key)}
                  className="rounded-xl p-2.5 text-left transition-all hover:scale-[1.03] active:scale-[0.97]"
                  style={{
                    background: active ? 'rgba(220,255,0,0.15)' : 'rgba(255,255,255,0.05)',
                    border: active ? '1px solid rgba(220,255,0,0.5)' : '1px solid transparent',
                    cursor: 'pointer'
                  }}
                >
                  <div className="text-lg font-black" style={{ color: active ? '#dcff00' : 'white' }}>{count}</div>
                  <div className="text-xs mt-0.5" style={{ color: active ? 'rgba(220,255,0,0.7)' : 'rgba(255,255,255,0.4)' }}>
                    {label} {active ? '📍' : ''}
                  </div>
                </button>
              );
            })}
          </div>
          {activePins && (
            <div className="mt-1.5 text-xs text-center" style={{ color: 'rgba(220,255,0,0.5)' }}>
              Showing supermarket locations on map
            </div>
          )}
        </div>

        {/* Cultural */}
        <div>
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Cultural Amenities</div>
          <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <div className="text-2xl font-black text-white">{p.cultural_amenities || 0}</div>
            <div className="text-xs text-white/40">Museums · Venues · Arts · Parks</div>
          </div>
        </div>

        {/* Tour CTA */}
        <button
          onClick={onStartTour}
          className="w-full py-3 rounded-xl text-sm font-bold tracking-wide transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, #dcff00 0%, #a8e600 100%)',
            color: '#050510'
          }}
        >
          Enter Tour Mode →
        </button>
      </div>
    </div>
  );
}

export default function ExploreMap({ onStartTour }) {
  const [neighborhoods, setNeighborhoods] = useState(null);
  const [supermarkets, setSupermarkets] = useState([]);
  const [activePins, setActivePins] = useState(null); // null | '15min' | '30min'
  const [hoveredId, setHoveredId] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [sonarTick, setSonarTick] = useState(0);
  const [sonarRings, setSonarRings] = useState([]);
  const [selectionRings, setSelectionRings] = useState([]);
  const animFrameRef = useRef(null);
  const ringTimerRef = useRef(null);
  const selectionRingId = useRef(0);

  useEffect(() => {
    fetch('/data/neighborhoods.geojson')
      .then(r => r.json())
      .then(setNeighborhoods)
      .catch(console.error);
    fetch('/data/supermarkets.json')
      .then(r => r.json())
      .then(setSupermarkets)
      .catch(console.error);
  }, []);

  // Clear pins when neighborhood changes
  useEffect(() => { setActivePins(null); }, [selectedFeature?.properties?.name]);

  // Sonar animation — periodic ring bursts
  useEffect(() => {
    let nextId = 0;

    function spawnRings() {
      const id = nextId++;
      setSonarRings(prev => [...prev, { id, born: Date.now() }]);
      // Schedule next burst randomly 3–8 sec
      const delay = 3000 + Math.random() * 5000;
      ringTimerRef.current = setTimeout(spawnRings, delay);
    }

    spawnRings();
    return () => {
      clearTimeout(ringTimerRef.current);
    };
  }, []);

  // Animate all rings and pulse tick
  useEffect(() => {
    let raf;
    function tick() {
      const now = Date.now();
      setSonarRings(prev => prev.filter(r => now - r.born < 3000));
      setSelectionRings(prev => prev.filter(r => now - r.born < 2000));
      setSonarTick(t => t + 1);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Pulse value: 0→1→0 on a ~2s sine cycle, used for selected border glow
  const pulse = (Math.sin(Date.now() / 600) + 1) / 2;

  // Build sonar ring layers
  const now = Date.now();
  const sonarLayers = sonarRings.map(ring => {
    const elapsed = (now - ring.born) / 3000; // 0→1
    const radius = elapsed * 4000; // meters
    const opacity = Math.max(0, 1 - elapsed);
    return new ScatterplotLayer({
      id: `sonar-ring-${ring.id}`,
      data: [{ position: SONAR_ORIGIN }],
      getPosition: d => d.position,
      getRadius: radius,
      getFillColor: [0, 0, 0, 0],
      getLineColor: [160, 32, 240, Math.floor(opacity * 200)],
      lineWidthMinPixels: 1.5,
      stroked: true,
      filled: false,
      radiusUnits: 'meters',
      updateTriggers: { getRadius: ring.id + elapsed, getLineColor: ring.id + elapsed }
    });
  });

  const sonarDotLayer = new ScatterplotLayer({
    id: 'sonar-dot',
    data: [{ position: SONAR_ORIGIN }],
    getPosition: d => d.position,
    getRadius: 10,
    getFillColor: [160, 32, 240, 255],
    getLineColor: [200, 120, 255, 200],
    lineWidthMinPixels: 2,
    stroked: true,
    radiusUnits: 'pixels',
    pickable: true,
    onClick: () => onStartTour()
  });

  const selectedName = selectedFeature?.properties?.name;

  const neighborhoodLayer = neighborhoods ? new GeoJsonLayer({
    id: 'neighborhoods',
    data: neighborhoods,
    pickable: true,
    stroked: true,
    filled: true,
    lineWidthMinPixels: 1.5,
    getLineColor: f =>
      f.properties.name === hoveredId ? [...NEON_YELLOW_HOVER, 255] : [...NEON_YELLOW, 180],
    getFillColor: f =>
      f.properties.name === hoveredId ? [220, 255, 0, 25] : [0, 0, 0, 0],
    lineWidthScale: 1,
    updateTriggers: { getLineColor: hoveredId, getFillColor: hoveredId },
    onHover: ({ object }) => setHoveredId(object?.properties?.name || null),
    onClick: ({ object, coordinate }) => {
      if (!object) return;
      setSelectedFeature(object);
      if (coordinate) {
        const id = selectionRingId.current++;
        setSelectionRings(prev => [
          ...prev,
          { id, born: Date.now(), position: [coordinate[0], coordinate[1]] }
        ]);
      }
    }
  }) : null;

  // Pulsing border layer for selected neighborhood only
  const selectedLayer = selectedFeature ? new GeoJsonLayer({
    id: 'neighborhood-selected',
    data: { type: 'FeatureCollection', features: [selectedFeature] },
    stroked: true,
    filled: true,
    lineWidthMinPixels: 2 + pulse * 2,
    getLineColor: [220, 255, 0, Math.floor(180 + pulse * 75)],
    getFillColor: [220, 255, 0, Math.floor(8 + pulse * 22)],
    updateTriggers: { getLineColor: pulse, getFillColor: pulse, lineWidthMinPixels: pulse }
  }) : null;

  // Selection ripple layers (yellow, fast burst on click)
  const selectionRingLayers = selectionRings.map(ring => {
    const elapsed = (now - ring.born) / 2000;
    const radius = elapsed * 2500;
    const opacity = Math.max(0, 1 - elapsed);
    return new ScatterplotLayer({
      id: `sel-ring-${ring.id}`,
      data: [{ position: ring.position }],
      getPosition: d => d.position,
      getRadius: radius,
      getFillColor: [0, 0, 0, 0],
      getLineColor: [220, 255, 0, Math.floor(opacity * 220)],
      lineWidthMinPixels: 1.5,
      stroked: true,
      filled: false,
      radiusUnits: 'meters',
      updateTriggers: { getRadius: elapsed, getLineColor: elapsed }
    });
  });

  // Supermarket pin layer
  const centroid = selectedFeature?.properties?.centroid;
  const kmLimit = activePins === '15min' ? 9 : activePins === '30min' ? 20 : null;
  const visibleSupermarkets = (kmLimit && centroid)
    ? supermarkets.filter(s => haversineKm(centroid[1], centroid[0], s.lat, s.lon) <= kmLimit)
    : [];

  const supermarketPinLayer = visibleSupermarkets.length > 0 ? new ScatterplotLayer({
    id: 'supermarket-pins',
    data: visibleSupermarkets,
    getPosition: d => [d.lon, d.lat],
    getRadius: 7,
    getFillColor: [220, 255, 0, 230],
    getLineColor: [0, 0, 0, 200],
    lineWidthMinPixels: 1.5,
    stroked: true,
    radiusUnits: 'pixels',
    pickable: true,
    getTooltip: d => d.name
  }) : null;

  const layers = [
    neighborhoodLayer,
    selectedLayer,
    ...selectionRingLayers,
    supermarketPinLayer,
    ...sonarLayers,
    sonarDotLayer
  ].filter(Boolean);

  return (
    <div className="relative w-full h-full" style={{ background: '#050510' }}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs)}
        controller={true}
        layers={layers}
        getCursor={({ isHovering }) => isHovering ? 'pointer' : 'grab'}
        getTooltip={({ object, layer }) =>
          layer?.id === 'supermarket-pins' && object
            ? { html: `<div style="background:#0a0a1a;border:1px solid rgba(220,255,0,0.4);padding:6px 10px;border-radius:8px;font-size:12px;color:#fff">${object.name}</div>`, style: { background: 'none', border: 'none' } }
            : null
        }
      >
        <Map mapStyle={BW_SATELLITE_STYLE} />
      </DeckGL>

      {/* Title */}
      <div
        className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-5 py-2 rounded-xl text-sm font-semibold tracking-widest uppercase"
        style={{
          background: 'rgba(8,8,16,0.85)',
          border: '1px solid rgba(220,255,0,0.15)',
          color: 'rgba(220,255,0,0.8)',
          backdropFilter: 'blur(12px)'
        }}
      >
        Baltimore Neighborhood Map
      </div>

      {/* Legend hint */}
      {!selectedFeature && (
        <div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-xl text-xs text-white/50"
          style={{
            background: 'rgba(8,8,16,0.75)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(8px)'
          }}
        >
          Click any neighborhood to explore · Click the purple dot to enter tour mode
        </div>
      )}

      {/* Neighborhood info panel */}
      {selectedFeature && (
        <NeighborhoodPanel
          feature={selectedFeature}
          onClose={() => setSelectedFeature(null)}
          onStartTour={onStartTour}
          activePins={activePins}
          onTogglePins={key => setActivePins(prev => prev === key ? null : key)}
        />
      )}
    </div>
  );
}
