// Land use category classification
export const LAND_USE_TYPES = {
  COMMERCIAL_RETAIL: 'retail',
  COMMERCIAL_OFFICE: 'office',
  COMMERCIAL_ENTERTAINMENT: 'entertainment',
  COMMERCIAL_HOTEL: 'hotel',
  INDUSTRIAL_LIGHT: 'industrial-light',
  INDUSTRIAL_HEAVY: 'industrial-heavy',
  INDUSTRIAL_WAREHOUSE: 'warehouse',
  MIXED_USE: 'mixed',
  INSTITUTIONAL: 'institutional',
  RESIDENTIAL: 'residential',
  VACANT: 'vacant',
  OTHER: 'other',
};

// [r, g, b] — alpha applied separately per context
export const CATEGORY_COLORS = {
  retail: [245, 158, 11],       // amber
  office: [6, 182, 212],        // cyan
  entertainment: [168, 85, 247], // purple
  hotel: [236, 72, 153],        // pink
  'industrial-light': [249, 115, 22], // orange
  'industrial-heavy': [239, 68, 68],  // red
  warehouse: [251, 146, 60],    // orange-light
  mixed: [52, 211, 153],        // emerald
  institutional: [99, 102, 241], // indigo
  residential: [74, 222, 128],  // green
  vacant: [107, 114, 128],      // gray
  other: [100, 116, 139],       // slate
};

export const CATEGORY_LABELS = {
  retail: 'Commercial Retail',
  office: 'Office / Corporate',
  entertainment: 'Entertainment',
  hotel: 'Hotel / Hospitality',
  'industrial-light': 'Light Industrial',
  'industrial-heavy': 'Heavy Industrial',
  warehouse: 'Warehouse / Logistics',
  mixed: 'Mixed Use',
  institutional: 'Institutional',
  residential: 'Residential',
  vacant: 'Vacant',
  other: 'Other Commercial',
};

export function getLandUseType(desc) {
  if (!desc) return 'other';
  const d = desc.toUpperCase().trim();

  // USEGROUP single-letter codes from Baltimore real property data
  if (d === 'I')  return 'industrial-light';
  if (d === 'C')  return 'retail';
  if (d === 'R')  return 'residential';
  if (d === 'M')  return 'mixed';
  if (d === 'CC') return 'mixed';
  if (d === 'EC') return 'vacant';
  if (d === 'OR') return 'mixed';

  // LANDUSEDESC text matching
  if (d.includes('HOTEL') || d.includes('MOTEL')) return 'hotel';
  if (d.includes('ENTERTAIN') || d.includes('THEATER') || d.includes('ARENA')) return 'entertainment';
  if (d.includes('OFFICE') || d.includes('PROFESSIONAL')) return 'office';
  if (d.includes('RETAIL') || d.includes('SHOPPING') || d.includes('STORE')) return 'retail';
  if (d.includes('MIXED') || d.includes('MIXED-USE')) return 'mixed';
  if (d.includes('WAREHOUSE') || d.includes('STORAGE')) return 'warehouse';
  if (d.includes('INDUSTRIAL') && d.includes('HEAVY')) return 'industrial-heavy';
  if (d.includes('INDUSTRIAL')) return 'industrial-light';
  if (d.includes('COMMERCIAL')) return 'retail';
  if (d.includes('INSTITUTIONAL') || d.includes('GOVERNMENT') || d.includes('SCHOOL')) return 'institutional';
  if (d.includes('RESIDENTIAL') || d.includes('APARTMENT') || d.includes('CONDO')) return 'residential';
  if (d.includes('VACANT') || d.includes('UNIMPROVED')) return 'vacant';
  return 'other';
}

// Returns [r, g, b, a] for a feature based on selection state and prominence
export function getFeatureColor(feature, selectedId, hoveredId) {
  const blocklot = feature.properties?.BLOCKLOT;
  const isSelected = blocklot === selectedId;
  const isHovered = blocklot === hoveredId;
  const type = feature.properties?._landUseType || 'other';
  const score = feature.properties?._prominenceScore ?? 0.5;

  if (isSelected) return [255, 210, 30, 255];
  if (isHovered) return [220, 220, 255, 230];

  const base = CATEGORY_COLORS[type] || CATEGORY_COLORS.other;
  // Scale brightness 60%–100% by prominence score
  const brightness = 0.55 + score * 0.45;
  return [
    Math.min(255, Math.round(base[0] * brightness)),
    Math.min(255, Math.round(base[1] * brightness)),
    Math.min(255, Math.round(base[2] * brightness)),
    200,
  ];
}

// Value-mode color: cool blue → warm gold gradient
export function getValueColor(feature, selectedId, hoveredId) {
  const blocklot = feature.properties?.BLOCKLOT;
  if (blocklot === selectedId) return [255, 210, 30, 255];
  if (blocklot === hoveredId) return [220, 220, 255, 230];

  const score = feature.properties?._prominenceScore ?? 0;
  // Blue (low) → Cyan → Green → Gold → White (high)
  const stops = [
    [0.0, [30, 80, 180]],
    [0.3, [6, 182, 212]],
    [0.6, [52, 211, 153]],
    [0.8, [245, 158, 11]],
    [1.0, [255, 240, 100]],
  ];

  for (let i = 1; i < stops.length; i++) {
    const [t0, c0] = stops[i - 1];
    const [t1, c1] = stops[i];
    if (score <= t1) {
      const t = (score - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + t * (c1[0] - c0[0])),
        Math.round(c0[1] + t * (c1[1] - c0[1])),
        Math.round(c0[2] + t * (c1[2] - c0[2])),
        200,
      ];
    }
  }
  return [255, 240, 100, 200];
}

export function getLineColor(feature, selectedId) {
  if (feature.properties?.BLOCKLOT === selectedId) return [255, 230, 80, 255];
  return [255, 255, 255, 20];
}

// Hex string to [r,g,b]
export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [100, 100, 100];
}

// For UI display: [r,g,b] → CSS hex
export function rgbToHex([r, g, b]) {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
