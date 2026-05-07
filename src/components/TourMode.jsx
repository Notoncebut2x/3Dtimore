import { useEffect, useRef, useState, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import Map from 'react-map-gl/maplibre';
import { getCentroid } from '../utils/dataProcessing';
import { useLidarBuildings, buildLidarLayers, LidarDataBadge } from './LidarBuildingLayer';

const DARK_MATTER_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// ─── Real polygon geometry sourced from Baltimore Real Property GeoJSON ───
const REAL_POLYGON = {
  type: 'Polygon',
  coordinates: [[
    [-76.58997216598192, 39.27565266636016],
    [-76.58989146828505, 39.27579023748242],
    [-76.58984326974462, 39.27587235271474],
    [-76.58990885402302, 39.275892953346364],
    [-76.58996911022273, 39.275790234443555],
    [-76.59013735831965, 39.27550341899014],
    [-76.59074940261156, 39.27568439670953],
    [-76.59068725508484, 39.275790379113865],
    [-76.59058950627421, 39.27595691086473],
    [-76.5920352524114,  39.27619918255073],
    [-76.59235095850241, 39.27566305943807],
    [-76.59261658923475, 39.275202785623755],
    [-76.59288078270855, 39.27528837493914],
    [-76.59310570110304, 39.27489871132104],
    [-76.59314427347357, 39.27483111195632],
    [-76.59315335679733, 39.27481807589115],
    [-76.59327956217571, 39.27465899663143],
    [-76.59331089159974, 39.27461714591865],
    [-76.59334555915686, 39.27458271417235],
    [-76.59338187015202, 39.2745493213061],
    [-76.59341977366945, 39.274517015287834],
    [-76.59345921519262, 39.27448584126175],
    [-76.59347994355979, 39.27447033065269],
    [-76.59348092969769, 39.27446961855675],
    [-76.59350325430435, 39.27445360319371],
    [-76.59351562405398, 39.274444924945996],
    [-76.59347578565122, 39.27438857109469],
    [-76.59334111925874, 39.27440273629483],
    [-76.59320611010187, 39.27441476944029],
    [-76.5930708138375,  39.27442466509978],
    [-76.5929352865648,  39.27443241960102],
    [-76.5927995843828,  39.274438029271906],
    [-76.5926637633807,  39.2744414921978],
    [-76.5925278796458,  39.27444280681574],
    [-76.59244953138888, 39.274442686792824],
    [-76.59237122722202, 39.27444063752599],
    [-76.59229304626712, 39.27443666069581],
    [-76.59221506672979, 39.27443076008828],
    [-76.59213736634719, 39.27442294229938],
    [-76.59206002420882, 39.27441321463298],
    [-76.59198311757936, 39.27440158719815],
    [-76.59190672326501, 39.27438807115679],
    [-76.59183091850575, 39.27437268083561],
    [-76.59175577918106, 39.27435543125934],
    [-76.59168138070571, 39.27433633956002],
    [-76.59154111982711, 39.274285914862084],
    [-76.59152896807096, 39.27430671901301],
    [-76.59152543561599, 39.27430551608656],
    [-76.59139601450363, 39.27426146623065],
    [-76.59141360186419, 39.274231491487605],
    [-76.59090696075944, 39.27405901073751],
    [-76.59007116605576, 39.275483859401476],
    [-76.58997216598192, 39.27565266636016],
  ]],
};

// ─── Context buildings — neighboring Locust Point / South Baltimore parcels
function makeRect(lng, lat, wM, hM) {
  const dlat = (hM / 2) / 111000;
  const dlng = (wM / 2) / (111000 * Math.cos((lat * Math.PI) / 180));
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - dlng, lat - dlat], [lng + dlng, lat - dlat],
      [lng + dlng, lat + dlat], [lng - dlng, lat + dlat],
      [lng - dlng, lat - dlat],
    ]],
  };
}

const CONTEXT_BUILDINGS = [
  { name: '1100 Key Hwy E — ASR Refinery (1922)', h: 14,  color: [80, 100, 130],  fp: makeRect(-76.5947, 39.2741, 200, 170) },
  { name: 'Bond Street Wharf (2002)',              h: 22,  color: [52, 211, 153],  fp: makeRect(-76.5942, 39.2807, 150, 120) },
  { name: 'Union Wharf — VA8 (2014)',              h: 28,  color: [52, 211, 153],  fp: makeRect(-76.5887, 39.2815, 160, 140) },
  { name: 'Harbor Point Parcel 2 (2016)',          h: 48,  color: [6, 182, 212],   fp: makeRect(-76.5982, 39.2811, 180, 160) },
  { name: '900 E Fort Ave (2017)',                 h: 22,  color: [168, 85, 247],  fp: makeRect(-76.6000, 39.2718, 170, 140) },
  { name: '', h: 8,  color: [45, 55, 72], fp: makeRect(-76.5915, 39.2733, 90, 70) },
  { name: '', h: 6,  color: [45, 55, 72], fp: makeRect(-76.5930, 39.2758, 70, 55) },
  { name: '', h: 5,  color: [45, 55, 72], fp: makeRect(-76.5902, 39.2742, 60, 50) },
  { name: '', h: 10, color: [45, 55, 72], fp: makeRect(-76.5960, 39.2762, 80, 65) },
  { name: '', h: 7,  color: [45, 55, 72], fp: makeRect(-76.5935, 39.2770, 65, 55) },
  { name: '', h: 9,  color: [45, 55, 72], fp: makeRect(-76.5908, 39.2768, 75, 60) },
];

// ─── Tour camera steps ─────────────────────────────────────────────────────
const TOUR_STEPS = [
  {
    title: '1000 Hull Street — Locust Point',
    body: 'BLOCKLOT 1976 001: a 9.746-acre industrial parcel in Baltimore\'s Locust Point neighborhood, built in 1929. Owned by UA Locust Point Holdings, LLC.',
    viewState: { longitude: -76.5921, latitude: 39.2740, zoom: 14.5, pitch: 55, bearing: -10 },
    duration: 4500,
  },
  {
    title: 'The Parcel: 9.746 Acres',
    body: 'The irregular footprint spans the southern edge of the Locust Point industrial corridor, bounded by Hull Street to the north. Assessed at $37.17M (land: $9.75M, improvements: $27.43M).',
    viewState: { longitude: -76.5910, latitude: 39.2758, zoom: 15.5, pitch: 65, bearing: 25 },
    duration: 4500,
  },
  {
    title: 'Street-Level: Hull Street View',
    body: 'The 1929 structure occupies a commanding industrial footprint. Zoned C-2* (General Commercial), it supports a broad range of commercial and industrial uses.',
    viewState: { longitude: -76.5900, latitude: 39.2752, zoom: 16.2, pitch: 72, bearing: 110 },
    duration: 4000,
  },
  {
    title: 'Ownership & Transaction History',
    body: 'Acquired for $58M in July 2011. Current owner: UA Locust Point Holdings, LLC. The parcel is part of a cluster of UA-affiliated holdings along the Key Highway / Hull Street corridor.',
    viewState: { longitude: -76.5921, latitude: 39.2748, zoom: 15.0, pitch: 60, bearing: 200 },
    duration: 4500,
  },
  {
    title: 'Surrounding Development',
    body: 'Locust Point has seen a wave of high-value mixed-use development: Harbor Point Parcel 2 ($184M, 2016), Union Wharf ($70M, 2014), Bond Street Wharf ($38M, 2002), and 900 E Fort Ave ($76M, 2017).',
    viewState: { longitude: -76.5945, latitude: 39.2765, zoom: 13.8, pitch: 55, bearing: -30 },
    duration: 5000,
  },
  {
    title: 'Redevelopment Potential',
    body: 'C-2* zoning allows a wide range of commercial uses. The 9.7-acre site — with harbor views, transit access, and proximity to the Inner Harbor — represents significant development optionality.',
    viewState: { longitude: -76.5921, latitude: 39.2748, zoom: 15.2, pitch: 52, bearing: -5 },
    duration: 4500,
  },
  {
    title: 'Transit & Daily Amenities',
    body: 'Locust Point sits at the nexus of Baltimore\'s transit network. Light Rail, Metro, MARC commuter rail, and 15+ CityLink bus lines converge within walking distance.',
    metricsSlot: 'transit',
    viewState: { longitude: -76.5921, latitude: 39.2800, zoom: 13.2, pitch: 42, bearing: -5 },
    duration: 6000,
  },
  {
    title: 'Neighborhood & Demographics',
    body: 'The immediate 1-mile catchment holds 20,700 residents with a median household income of $125,898 — among the highest in Baltimore City — and 17 schools.',
    metricsSlot: 'demographics',
    viewState: { longitude: -76.5921, latitude: 39.2820, zoom: 12.6, pitch: 35, bearing: 12 },
    duration: 6000,
  },
];

// ─── Neighborhood metrics fetch ────────────────────────────────────────────
function useNeighborhoodMetrics() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch('/data/neighborhood-metrics.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setData(d))
      .catch(() => {});
  }, []);
  return data;
}

// ─── Component ────────────────────────────────────────────────────────────
export default function TourMode({ onExit }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [viewState, setViewState] = useState({ ...TOUR_STEPS[0].viewState, minZoom: 12, maxZoom: 20 });
  const [playing, setPlaying] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const timerRef = useRef(null);

  const { data: lidarData, loading: lidarLoading, error: lidarError, meta: lidarMeta } = useLidarBuildings();
  const neighborhoodData = useNeighborhoodMetrics();

  const goToStep = useCallback((idx) => {
    if (idx < 0 || idx >= TOUR_STEPS.length) return;
    setStepIdx(idx);
    setTransitioning(true);
    setViewState(TOUR_STEPS[idx].viewState);
    setTimeout(() => setTransitioning(false), 1000);
  }, []);

  useEffect(() => {
    if (!playing) return;
    timerRef.current = setTimeout(() => {
      goToStep((stepIdx + 1) % TOUR_STEPS.length);
    }, TOUR_STEPS[stepIdx].duration);
    return () => clearTimeout(timerRef.current);
  }, [stepIdx, playing, goToStep]);

  const useLidar = !lidarLoading && !lidarError && lidarData?.features?.length > 0;

  const contextFeatures = CONTEXT_BUILDINGS.map((b) => ({
    type: 'Feature',
    geometry: b.fp,
    properties: { h: b.h, color: b.color },
  }));

  const syntheticContextLayer = new GeoJsonLayer({
    id: 'tour-context-synthetic',
    data: { type: 'FeatureCollection', features: contextFeatures },
    extruded: true,
    getElevation: f => f.properties.h,
    getFillColor: f => [...f.properties.color, 175],
    getLineColor: [255, 255, 255, 10],
    lineWidthMinPixels: 0.5,
    material: { ambient: 0.15, diffuse: 0.85, shininess: 40, specularColor: [120, 140, 180] },
    visible: !useLidar,
  });

  const lidarLayers = useLidar
    ? buildLidarLayers({ data: lidarData, showFeatured: true })
    : [];

  const pulsePos = useLidar
    ? (() => {
        const feat = lidarData.features.find(f => f.properties.is_featured);
        return feat ? getCentroid(feat.geometry) : getCentroid(REAL_POLYGON);
      })()
    : getCentroid(REAL_POLYGON);

  const pulseLayer = new ScatterplotLayer({
    id: 'tour-pulse',
    data: [{ position: [...pulsePos, 0] }],
    getPosition: d => d.position,
    getRadius: 80,
    getFillColor: [255, 200, 30, 25],
    radiusUnits: 'meters',
    pickable: false,
  });

  const allLayers = useLidar
    ? [...lidarLayers, pulseLayer]
    : [syntheticContextLayer, pulseLayer];

  const step = TOUR_STEPS[stepIdx];

  return (
    <div className="relative w-full h-full">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState({ ...vs, zoom: Math.max(12, vs.zoom) })}
        controller={{ dragRotate: true, touchRotate: true, minZoom: 12, maxZoom: 20 }}
        layers={allLayers}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Map mapStyle={DARK_MATTER_STYLE} reuseMaps attributionControl={false} />
      </DeckGL>

      {/* LiDAR badge — bottom left */}
      <div className="absolute bottom-6 left-4 z-20">
        <LidarDataBadge meta={lidarMeta} loading={lidarLoading} error={lidarError} />
      </div>

      {/* Exit */}
      <button
        onClick={onExit}
        className="absolute top-4 left-4 z-30 glass-panel flex items-center gap-2 px-3 py-2 text-sm text-panel-muted hover:text-white transition-colors"
        style={{ borderRadius: 10 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back to Explorer
      </button>

      {/* BLOCKLOT badge */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
        <div className="glass-panel flex items-center gap-3 px-4 py-2">
          <span className="font-mono text-xs font-bold text-accent-gold tracking-wider bg-accent-gold/10 px-2 py-1 rounded">
            BLOCKLOT 1976 001
          </span>
          <span className="text-white font-semibold text-sm">1000 Hull Street</span>
          <span className="text-panel-muted text-xs">Locust Point, Baltimore MD 21230</span>
        </div>
      </div>

      {/* Tour annotation card */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 w-[560px] max-w-[calc(100vw-2rem)]">
        <div className={`glass-panel p-5 transition-opacity duration-500 ${transitioning ? 'opacity-40' : 'opacity-100'}`}>
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-9 h-9 rounded-full bg-accent-gold/20 border border-accent-gold/40 flex items-center justify-center">
              <span className="text-accent-gold font-bold text-sm tabular-nums">{stepIdx + 1}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white font-semibold text-base mb-1">{step.title}</div>
              <div className="text-panel-muted text-sm leading-relaxed">{step.body}</div>
            </div>
          </div>

          {/* Metrics panel — only on steps with metricsSlot */}
          {step.metricsSlot && (
            <MetricsPanel slot={step.metricsSlot} data={neighborhoodData} />
          )}

          {/* Progress + controls */}
          <div className="flex items-center gap-2 mt-4">
            {TOUR_STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => { clearTimeout(timerRef.current); goToStep(i); }}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === stepIdx ? 'bg-accent-gold w-6' : 'bg-panel-border hover:bg-panel-muted w-1.5'
                }`}
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
              onClick={() => { clearTimeout(timerRef.current); goToStep((stepIdx - 1 + TOUR_STEPS.length) % TOUR_STEPS.length); }}
              className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors text-panel-muted hover:text-white"
              aria-label="Previous step"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <button
              onClick={() => { clearTimeout(timerRef.current); goToStep((stepIdx + 1) % TOUR_STEPS.length); }}
              className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors text-panel-muted hover:text-white"
              aria-label="Next step"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Metrics strip */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 flex-wrap justify-center">
        <Pill label="Assessed" value="$37.2M" color="gold" />
        <Pill label="Land" value="$9.75M" color="cyan" />
        <Pill label="Impr." value="$27.4M" color="cyan" />
        <Pill label="Last Sale" value="$58M (2011)" color="purple" />
        <Pill label="Lot" value="9.746 ac" color="cyan" />
        <Pill label="Built" value="1929" color="muted" />
        <Pill label="Zoning" value="C-2*" color="gold" />
      </div>
    </div>
  );
}

// ─── MetricsPanel ─────────────────────────────────────────────────────────

function MetricsPanel({ slot, data }) {
  if (!data) {
    return (
      <div className="mt-4 text-xs text-panel-muted animate-pulse">
        Loading neighborhood metrics…
      </div>
    );
  }

  const m = data.metrics;

  if (slot === 'transit') {
    const busRouteCount = (m.transit?.bus_routes ?? []).length;
    const railRouteCount = (m.transit?.rail_routes ?? []).length;
    // Pull out a few notable route names for the sub-line
    const notable = (m.transit?.rail_routes ?? [])
      .filter(r => r.includes('Light Rail') || r.includes('Metro') || r.includes('MARC Penn'))
      .slice(0, 3)
      .map(r => r.replace(/:.+/, '').replace('Baltimore ', ''));

    return (
      <div className="mt-4">
        <div className="grid grid-cols-4 gap-2">
          <MetricTile
            icon={<BusIcon />}
            value={m.transit?.bus_stops?.['1mi'] ?? '—'}
            label="Bus Stops (1mi)"
            color="cyan"
          />
          <MetricTile
            icon={<RailIcon />}
            value={m.transit?.rail_stops?.['1mi'] ?? '—'}
            label="Rail Stops (1mi)"
            color="purple"
          />
          <MetricTile
            icon={<GroceryIcon />}
            value={m.grocery_stores?.['1mi']?.count ?? '—'}
            label="Grocery (1mi)"
            color="green"
          />
          <MetricTile
            icon={<MarketIcon />}
            value={m.food_halls?.['1mi']?.count ?? '—'}
            label="Markets (1mi)"
            color="gold"
          />
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-panel-muted uppercase tracking-wider">Routes:</span>
          {notable.map(r => (
            <span key={r} className="text-[10px] bg-white/5 border border-panel-border/40 text-panel-muted px-1.5 py-0.5 rounded">
              {r}
            </span>
          ))}
          {busRouteCount > 0 && (
            <span className="text-[10px] text-panel-muted">
              +{busRouteCount} bus routes
            </span>
          )}
        </div>
      </div>
    );
  }

  if (slot === 'demographics') {
    const d1 = m.demographics?.['1mi'] ?? {};
    const d5 = m.demographics?.['5mi'] ?? {};
    const povertyRate = d5.poverty_rate != null ? `${(d5.poverty_rate * 100).toFixed(1)}%` : '—';
    const transitShare = d5.transit_commute_share != null
      ? `${(d5.transit_commute_share * 100).toFixed(0)}%`
      : '—';

    return (
      <div className="mt-4">
        <div className="grid grid-cols-4 gap-2">
          <MetricTile
            icon={<PersonIcon />}
            value={d1.total_population ? d1.total_population.toLocaleString() : '—'}
            label="Population (1mi)"
            color="cyan"
          />
          <MetricTile
            icon={<IncomeIcon />}
            value={d1.median_household_income
              ? `$${Math.round(d1.median_household_income / 1000)}K`
              : '—'}
            label="Med. Income (1mi)"
            color="gold"
          />
          <MetricTile
            icon={<SchoolIcon />}
            value={m.schools?.['1mi']?.count ?? '—'}
            label="Schools (1mi)"
            color="green"
          />
          <MetricTile
            icon={<HospitalIcon />}
            value={m.hospitals?.['5mi']?.count ?? '—'}
            label="Hospitals (5mi)"
            color="purple"
          />
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          <SubStat label="Museums (5mi)" value={m.cultural?.museums?.['5mi']?.count ?? '—'} />
          <SubStat label="Transit commute" value={transitShare} />
          <SubStat label="Poverty rate (5mi)" value={povertyRate} />
        </div>
      </div>
    );
  }

  return null;
}

function MetricTile({ icon, value, label, color }) {
  const styles = {
    cyan:   'bg-accent-cyan/10 border-accent-cyan/20 text-accent-cyan',
    purple: 'bg-accent-purple/10 border-accent-purple/20 text-accent-purple',
    green:  'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    gold:   'bg-accent-gold/10 border-accent-gold/20 text-accent-gold',
  };
  const cls = styles[color] || styles.cyan;
  return (
    <div className={`rounded-lg border p-2.5 ${cls}`}>
      <div className="mb-1 opacity-60">{icon}</div>
      <div className="text-lg font-bold tabular-nums leading-none">{value}</div>
      <div className="text-[10px] text-panel-muted leading-tight mt-1">{label}</div>
    </div>
  );
}

function SubStat({ label, value }) {
  return (
    <div className="bg-white/3 rounded-md px-2.5 py-1.5 flex items-center justify-between gap-2">
      <span className="text-[10px] text-panel-muted">{label}</span>
      <span className="text-xs font-semibold text-white tabular-nums">{value}</span>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────

function BusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="13" rx="2"/>
      <path d="M3 10h18M8 19v2M16 19v2"/>
      <circle cx="7.5" cy="15.5" r="1" fill="currentColor"/>
      <circle cx="16.5" cy="15.5" r="1" fill="currentColor"/>
    </svg>
  );
}

function RailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 20l2-4h12l2 4M12 4v8M8 4h8"/>
      <rect x="6" y="8" width="12" height="8" rx="1"/>
      <circle cx="9" cy="16" r="1" fill="currentColor"/>
      <circle cx="15" cy="16" r="1" fill="currentColor"/>
    </svg>
  );
}

function GroceryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18"/>
      <path d="M16 10a4 4 0 01-8 0"/>
    </svg>
  );
}

function MarketIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4"/>
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    </svg>
  );
}

function IncomeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
    </svg>
  );
}

function SchoolIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 20h20M4 20V10M20 20V10M12 4L2 10h20L12 4zM9 20v-6h6v6"/>
    </svg>
  );
}

function HospitalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M12 8v8M8 12h8"/>
    </svg>
  );
}

// ─── Small components ─────────────────────────────────────────────────────

function Pill({ label, value, color }) {
  const colors = {
    gold:   'text-accent-gold bg-accent-gold/10 border-accent-gold/30',
    cyan:   'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30',
    purple: 'text-accent-purple bg-accent-purple/10 border-accent-purple/30',
    muted:  'text-panel-muted bg-white/5 border-panel-border/50',
  };
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${colors[color]}`}>
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
