import { useMemo, useCallback, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import Map from 'react-map-gl/maplibre';
import { getLandUseType } from '../utils/colors';

const DARK_MATTER_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const INITIAL_VIEW_STATE = {
  longitude: -76.5921,
  latitude: 39.2751,
  zoom: 14.5,
  pitch: 0,
  bearing: 0,
  minZoom: 10,
  maxZoom: 20,
};

// Commercial land-use types (green border) and mixed-use (light green border)
const COMMERCIAL_TYPES = new Set(['retail', 'office', 'hotel', 'entertainment', 'warehouse', 'industrial-light', 'industrial-heavy']);
const MIXED_TYPES      = new Set(['mixed']);

export default function Map3D({
  data,
  selectedFeature,
  hoveredId,
  onPropertySelect,
  onPropertyHover,
}) {
  const deckRef = useRef(null);
  const selectedId = selectedFeature?.properties?.BLOCKLOT || null;

  const layers = useMemo(() => {
    if (!data) return [];

    const allParcels = new GeoJsonLayer({
      id: 'parcels',
      data,
      pickable: true,
      extruded: false,
      filled: true,
      stroked: true,
      getFillColor: (f) => {
        const bl = f.properties?.BLOCKLOT;
        if (bl === selectedId) return [255, 215, 30, 60];
        if (bl === hoveredId)  return [255, 255, 255, 20];
        return [0, 0, 0, 0];
      },
      getLineColor: (f) => {
        const bl = f.properties?.BLOCKLOT;
        if (bl === selectedId) return [255, 215, 30, 255];
        const type = getLandUseType(f.properties?.USEGROUP || f.properties?.LANDUSEDESC || '');
        if (COMMERCIAL_TYPES.has(type)) return [34, 197, 94, 200];   // green
        if (MIXED_TYPES.has(type))      return [134, 239, 172, 160]; // light green
        return [0, 0, 0, 0];
      },
      getLineWidth: (f) => {
        const bl = f.properties?.BLOCKLOT;
        if (bl === selectedId) return 2;
        const type = getLandUseType(f.properties?.USEGROUP || f.properties?.LANDUSEDESC || '');
        if (COMMERCIAL_TYPES.has(type) || MIXED_TYPES.has(type)) return 1;
        return 0;
      },
      lineWidthUnits: 'pixels',
      updateTriggers: {
        getFillColor: [selectedId, hoveredId],
        getLineColor: [selectedId],
        getLineWidth: [selectedId],
      },
      onHover: ({ object }) => onPropertyHover(object?.properties?.BLOCKLOT || null),
      onClick: ({ object }) => { if (object) onPropertySelect(object); },
    });

    return [allParcels];
  }, [data, selectedId, hoveredId]);

  const getTooltip = useCallback(({ object }) => {
    if (!object) return null;
    const p = object.properties;
    if (!p?.BLOCKLOT) return null;
    return {
      html: `
        <div style="font-family: Inter, sans-serif; padding: 0;">
          <div style="font-size: 11px; color: #f59e0b; font-weight: 700; letter-spacing: 0.08em; margin-bottom: 4px;">
            ${p.BLOCKLOT}
          </div>
          <div style="font-size: 13px; color: #fff; font-weight: 600; margin-bottom: 2px;">
            ${p.ADDRESS || 'No address'}
          </div>
          <div style="font-size: 11px; color: #8b949e; margin-bottom: 6px;">
            ${p.LANDUSEDESC || 'Unknown use'}
          </div>
          <div style="font-size: 12px; color: #10b981; font-weight: 600;">
            ${p.FULLCASH ? '$' + Number(p.FULLCASH).toLocaleString() : '—'}
          </div>
          <div style="font-size: 10px; color: #6b7280; margin-top: 4px;">Click for details</div>
        </div>
      `,
      style: {
        background: 'rgba(13,17,23,0.92)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(48,54,61,0.8)',
        borderRadius: '10px',
        padding: '10px 12px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        maxWidth: '220px',
      },
    };
  }, []);

  return (
    <DeckGL
      ref={deckRef}
      initialViewState={INITIAL_VIEW_STATE}
      controller={{ dragRotate: true, touchRotate: true, keyboard: true }}
      layers={layers}
      getTooltip={getTooltip}
      getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Map
        mapStyle={DARK_MATTER_STYLE}
        reuseMaps
        attributionControl={false}
      />

      {/* Compass / Controls hint */}
      <div className="absolute bottom-6 right-4 z-10 flex flex-col gap-2">
        <ControlsHint />
      </div>
    </DeckGL>
  );
}

function ControlsHint() {
  return (
    <div className="glass-panel-light px-3 py-2 text-[10px] text-panel-muted space-y-1">
      <div className="flex items-center gap-2">
        <MouseIcon type="scroll" />
        <span>Zoom</span>
      </div>
      <div className="flex items-center gap-2">
        <MouseIcon type="drag" />
        <span>Pan</span>
      </div>
    </div>
  );
}

function MouseIcon({ type }) {
  const icons = {
    scroll: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="6" y="2" width="12" height="20" rx="6"/>
        <line x1="12" y1="7" x2="12" y2="10"/>
      </svg>
    ),
    drag: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M5 9l7 7 7-7"/>
      </svg>
    ),
    right: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 18l6-6-6-6"/>
      </svg>
    ),
  };
  return <span className="text-panel-muted">{icons[type]}</span>;
}
