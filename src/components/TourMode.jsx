import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import Map from 'react-map-gl/maplibre';
import { useLidarBuildings, buildLidarLayers } from './LidarBuildingLayer';

function pointInPolygon(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function buildingsNearPoint(data, lon, lat) {
  if (!data?.features) return null;

  // First: find buildings whose footprint contains the property point
  const containing = data.features.filter(f => {
    const rings = f.geometry?.coordinates;
    if (!rings?.length) return false;
    return pointInPolygon(lon, lat, rings[0]);
  });
  if (containing.length) return { type: 'FeatureCollection', features: containing };

  // Fallback: single closest building by centroid
  let best = null, bestDist = Infinity;
  for (const f of data.features) {
    const coords = f.geometry?.coordinates?.[0];
    if (!coords?.length) continue;
    const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const d = (cx - lon) ** 2 + (cy - lat) ** 2;
    if (d < bestDist) { bestDist = d; best = f; }
  }
  return best ? { type: 'FeatureCollection', features: [best] } : null;
}

const DARK_MATTER_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const MARKET_DESCRIPTIONS = {
  'Baltimore Peninsula': 'A reimagined 235-acre waterfront district along the Middle Branch, transforming former industrial land into a mixed-use innovation corridor.',
  'Canton':              'A vibrant waterfront neighborhood blending historic industrial character with modern office, retail, and residential development along the Patapsco.',
  'Downtown Baltimore':  'The commercial core of Baltimore City, anchored by the Inner Harbor and home to Class A office towers, historic adaptive reuse, and major institutions.',
  'Federal Hill':        'A walkable mixed-use neighborhood south of the Inner Harbor, known for its historic rowhouse fabric, independent retail, and proximity to the waterfront.',
  'Harbor East':         'Baltimore\'s premier Class A office and mixed-use submarket, featuring luxury towers, hotel and retail at the foot of the Inner Harbor.',
  'Southwest Partnership': 'An emerging innovation district anchored by the University of Maryland BioPark, with significant lab, flex, and retail development underway.',
};

function buildTourSteps(property) {
  const { lon, lat, name, address, type, market, notes } = property;
  const marketDesc = MARKET_DESCRIPTIONS[market] || `One of Baltimore's key commercial corridors.`;
  const noteText = notes ? ` ${notes}.` : '';

  return [
    {
      title: name,
      body: `${type} — ${address}.${noteText}`,
      viewState: { longitude: lon, latitude: lat, zoom: 16.25, pitch: 55, bearing: 0 },
      duration: 4500,
    },
    {
      title: 'The Site',
      body: `Located at ${address}, this ${type.toLowerCase()} property sits within the ${market} submarket. ${noteText || 'A compelling opportunity in one of Baltimore\'s most active corridors.'}`,
      viewState: { longitude: lon, latitude: lat, zoom: 16.45, pitch: 62, bearing: 30 },
      duration: 4500,
    },
    {
      title: 'Street Perspective',
      body: `Ground-level view of ${name}. The immediate block context reflects ${market}'s evolving character — a blend of historic fabric and modern commercial investment.`,
      viewState: { longitude: lon, latitude: lat, zoom: 17.25, pitch: 72, bearing: 120 },
      duration: 4000,
    },
    {
      title: `${market} Submarket`,
      body: marketDesc,
      viewState: { longitude: lon, latitude: lat, zoom: 13.45, pitch: 48, bearing: -25 },
      duration: 5000,
    },
    {
      title: 'Market Positioning',
      body: `${name} offers ${type.toLowerCase()} space in a submarket with strong fundamentals. ${market} continues to attract institutional tenants, owner-users, and value-add investors.`,
      viewState: { longitude: lon, latitude: lat, zoom: 15.25, pitch: 55, bearing: -10 },
      duration: 4500,
    },
    {
      title: 'Baltimore City Context',
      body: `Positioned within Baltimore's competitive commercial real estate landscape, ${name} benefits from proximity to major employment anchors, transit infrastructure, and the Inner Harbor amenity base.`,
      viewState: { longitude: lon, latitude: lat, zoom: 12.45, pitch: 38, bearing: 10 },
      duration: 5000,
    },
  ];
}

export default function TourMode({ property, onExit }) {
  const steps = useMemo(() => buildTourSteps(property), [property]);

  const [stepIdx, setStepIdx] = useState(0);
  const [viewState, setViewState] = useState({ ...steps[0].viewState, minZoom: 10, maxZoom: 20 });
  const [playing, setPlaying] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const timerRef = useRef(null);

  const { data: lidarData, loading: lidarLoading, error: lidarError } = useLidarBuildings();

  const goToStep = useCallback((idx) => {
    if (idx < 0 || idx >= steps.length) return;
    setStepIdx(idx);
    setTransitioning(true);
    setViewState(prev => ({ ...prev, ...steps[idx].viewState }));
    setTimeout(() => setTransitioning(false), 1000);
  }, [steps]);

  useEffect(() => {
    if (!playing) return;
    timerRef.current = setTimeout(() => {
      goToStep((stepIdx + 1) % steps.length);
    }, steps[stepIdx].duration);
    return () => clearTimeout(timerRef.current);
  }, [stepIdx, playing, goToStep, steps]);


  const nearbyBuildings = (!lidarLoading && !lidarError && lidarData)
    ? buildingsNearPoint(lidarData, property.lon, property.lat)
    : null;

  const nearbySet = useMemo(
    () => nearbyBuildings ? new Set(nearbyBuildings.features) : null,
    [nearbyBuildings]
  );

  const buildingLayers = (!lidarLoading && !lidarError && lidarData)
    ? buildLidarLayers({ data: lidarData, showFeatured: false, excludeFeatures: nearbySet })
    : [];

  const highlightLayer = nearbyBuildings
    ? new GeoJsonLayer({
        id: `property-highlight-${property.lon}-${property.lat}`,
        data: nearbyBuildings,
        extruded: true,
        getElevation: f => (f.properties?.height ?? 6) + 0.5,
        getFillColor: [220, 255, 0, 230],
        getLineColor: [220, 255, 0, 255],
        lineWidthMinPixels: 1,
        material: { ambient: 0.4, diffuse: 0.8, shininess: 32, specularColor: [255, 255, 200] },
      })
    : null;

  const step = steps[stepIdx];

  return (
    <div className="relative w-full h-full">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState({ ...vs, minZoom: 10, maxZoom: 20 })}
        controller={{ dragRotate: true, touchRotate: true }}
        layers={[...buildingLayers, ...(highlightLayer ? [highlightLayer] : [])]}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Map mapStyle={DARK_MATTER_STYLE} reuseMaps attributionControl={false} />
      </DeckGL>

      {/* Exit */}
      <button
        onClick={onExit}
        className="absolute top-4 left-4 z-30 glass-panel flex items-center gap-2 px-3 py-2 text-sm text-panel-muted hover:text-white transition-colors"
        style={{ borderRadius: 10 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back to Map
      </button>

      {/* Property header badge */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
        <div className="glass-panel flex items-center gap-3 px-4 py-2">
          <span
            className="text-xs font-bold tracking-wider px-2 py-1 rounded"
            style={{ background: 'rgba(160,32,240,0.15)', color: '#c084fc', border: '1px solid rgba(160,32,240,0.3)' }}
          >
            {property.market}
          </span>
          <span className="text-white font-semibold text-sm">{property.name}</span>
          <span className="text-panel-muted text-xs hidden sm:block">{property.address}</span>
        </div>
      </div>

      {/* Tour annotation card */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 w-[560px] max-w-[calc(100vw-2rem)]">
        <div className={`glass-panel p-5 transition-opacity duration-500 ${transitioning ? 'opacity-40' : 'opacity-100'}`}>
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(160,32,240,0.15)', border: '1px solid rgba(160,32,240,0.35)' }}>
              <span className="font-bold text-sm tabular-nums" style={{ color: '#c084fc' }}>{stepIdx + 1}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white font-semibold text-base mb-1">{step.title}</div>
              <div className="text-panel-muted text-sm leading-relaxed">{step.body}</div>
            </div>
          </div>

          {/* Progress + controls */}
          <div className="flex items-center gap-2 mt-4">
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => { clearTimeout(timerRef.current); goToStep(i); }}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === stepIdx
                    ? 'w-6'
                    : 'bg-panel-border hover:bg-panel-muted w-1.5'
                }`}
                style={i === stepIdx ? { background: '#a855f7', width: 24 } : {}}
              />
            ))}
            <div className="flex-1" />
            <button
              onClick={() => setPlaying(p => !p)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 transition-colors text-xs text-panel-muted hover:text-white"
            >
              {playing ? <><PauseIcon /> Pause</> : <><PlayIcon /> Play</>}
            </button>
            <button
              onClick={() => { clearTimeout(timerRef.current); goToStep((stepIdx - 1 + steps.length) % steps.length); }}
              className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors text-panel-muted hover:text-white"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <button
              onClick={() => { clearTimeout(timerRef.current); goToStep((stepIdx + 1) % steps.length); }}
              className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors text-panel-muted hover:text-white"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Property pills */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 flex-wrap justify-center">
        <Pill label="Market" value={property.market} color="purple" />
        <Pill label="Type" value={property.type.length > 30 ? property.type.slice(0, 28) + '…' : property.type} color="cyan" />
        {property.notes && <Pill label="Note" value={property.notes.length > 35 ? property.notes.slice(0, 33) + '…' : property.notes} color="muted" />}
      </div>
    </div>
  );
}

function Pill({ label, value, color }) {
  const colors = {
    purple: 'text-purple-300 bg-purple-500/10 border-purple-500/30',
    cyan:   'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30',
    gold:   'text-accent-gold bg-accent-gold/10 border-accent-gold/30',
    muted:  'text-panel-muted bg-white/5 border-panel-border/50',
  };
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${colors[color] || colors.muted}`}>
      <span className="text-[10px] uppercase tracking-wider opacity-70">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function PlayIcon() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>;
}
function PauseIcon() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>;
}
