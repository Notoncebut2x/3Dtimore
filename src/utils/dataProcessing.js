import { getLandUseType } from './colors';

// Baltimore CBD centroid for proximity scoring
const CBD = [39.2904, -76.6122];

// ─── Field normalizer ──────────────────────────────────────────────────────
// Handles both the live API field names and the real GeoJSON field names.
export function normalizeProperties(p) {
  const lotsize = parseLotSize(p.LOT_SIZE) || parseFloat(p.LOTSIZE) || 0;
  const value = parseFloat(p.ARTAXBAS || p.FULLCASH || p.TAXBASE || 0);
  const usegroup = (p.USEGROUP || '').trim().toUpperCase();

  return {
    ...p,
    // Canonical field names used by the rest of the app
    BLOCKLOT:   (p.BLOCKLOT || '').trim(),
    ADDRESS:    (p.FULLADDR  || p.ADDRESS  || '').trim(),
    OWNER1:     (p.OWNER_1   || p.OWNER1   || '').trim(),
    OWNER2:     (p.OWNER_2   || p.OWNER2   || '').trim(),
    ZONING:     (p.ZONECODE  || p.ZONING   || '').trim(),
    LANDUSEDESC: p.LANDUSEDESC || usegroupToDesc(usegroup, p.DHCDUSE1),
    FULLCASH:   value,
    LOTSIZE:    lotsize,
    YR_BUILT:   p.YEAR_BUILD || p.YR_BUILT || 0,
    STRUCTAREA: parseFloat(p.STRUCTAREA || p.STRUCAREA || p.LTOAREA || 0),
    SALEPRICE:  parseFloat(p.SALEPRIC   || p.SALEPRICE || 0),
    SALEDATE:   p.SALEDATE || null,
    NEIGHBOR:   (p.NEIGHBOR || '').trim(),
    USEGROUP:   usegroup,
  };
}

function usegroupToDesc(usegroup, dhcduse1) {
  const map = {
    'I':  'INDUSTRIAL',
    'C':  'COMMERCIAL',
    'R':  'RESIDENTIAL',
    'EC': 'ENVIRONMENTAL CONSERVATION',
    'M':  'MIXED USE',
    'CC': 'COMMERCIAL/COMMUNITY',
    'OR': 'OFFICE/RESIDENTIAL',
  };
  return map[usegroup] || 'OTHER';
}

function parseLotSize(str) {
  if (!str) return 0;
  const s = str.trim();
  // "9.746 ACRES" → sq ft
  const acre = s.match(/([0-9.]+)\s*ACRES?/i);
  if (acre) return Math.round(parseFloat(acre[1]) * 43560);
  // "15-2X83-10" or "60X120" → sq ft
  const dim = s.match(/([0-9]+[-.]?[0-9]*)\s*[xX]\s*([0-9]+[-.]?[0-9]*)/);
  if (dim) return Math.round(parseFloat(dim[1]) * parseFloat(dim[2]));
  return 0;
}

// ─── Height estimation ─────────────────────────────────────────────────────
export function estimateHeight(rawProps) {
  const p = rawProps._normalized ? rawProps : normalizeProperties(rawProps);
  const stories = p.NO_STRIES || p.STORIES || 0;
  if (stories > 0) {
    const type = getLandUseType(p.LANDUSEDESC || '');
    const mPerFloor = ['office', 'hotel'].includes(type) ? 4.5 : 3.5;
    return Math.max(4, stories * mPerFloor);
  }

  // Estimate floors from structure area / lot area ratio
  const struc = p.STRUCTAREA;
  const lot = p.LOTSIZE || 1;
  if (struc > 0 && lot > 0) {
    const implied = Math.min(40, Math.max(1, Math.round(struc / lot)));
    if (implied > 1) return implied * 4;
  }

  // Fallback by land use type
  const type = getLandUseType(p.LANDUSEDESC || '');
  const defaults = {
    office: 32,
    hotel: 24,
    entertainment: 16,
    retail: 8,
    'industrial-light': 10,
    'industrial-heavy': 14,
    warehouse: 10,
    mixed: 14,
    institutional: 12,
    residential: 12,
    vacant: 3,
    other: 8,
  };
  return defaults[type] || 8;
}

// ─── Geometry ─────────────────────────────────────────────────────────────
// Haversine distance in meters
function haversine([lat1, lng1], [lat2, lng2]) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getCentroid(geometry) {
  try {
    const coords =
      geometry.type === 'Polygon'
        ? geometry.coordinates[0]
        : geometry.coordinates[0][0];
    const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    return [lng, lat];
  } catch {
    return [-76.5921, 39.2751];
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────
export function computeStats(features) {
  const values = features
    .map((f) => {
      const p = f.properties;
      return parseFloat(p.ARTAXBAS || p.FULLCASH || p.TAXBASE || 0);
    })
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  const areas = features
    .map((f) => {
      const p = f.properties;
      return parseLotSize(p.LOT_SIZE) || parseFloat(p.LOTSIZE || 0);
    })
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  return {
    sortedValues: values,
    sortedAreas: areas,
    maxValue: values[values.length - 1] || 1,
    minValue: values[0] || 0,
    totalCount: features.length,
    totalValue: values.reduce((s, v) => s + v, 0),
  };
}

function percentile(value, sortedArr) {
  if (!sortedArr.length || !value) return 0;
  let lo = 0, hi = sortedArr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedArr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedArr.length;
}

// ─── Scoring ──────────────────────────────────────────────────────────────
export function calculateProminenceScore(feature, stats) {
  const p = feature.properties;
  const value = parseFloat(p.ARTAXBAS || p.FULLCASH || p.TAXBASE || 0);
  const area = parseLotSize(p.LOT_SIZE) || parseFloat(p.LOTSIZE || 0);

  const valueScore = percentile(value, stats.sortedValues);
  const areaScore  = percentile(area,  stats.sortedAreas);

  const [lng, lat] = getCentroid(feature.geometry);
  const dist = haversine([lat, lng], CBD);
  const proxScore = 1 - Math.min(1, dist / 8000); // 8 km radius

  const type = getLandUseType(
    p.LANDUSEDESC || usegroupToDesc((p.USEGROUP || '').trim().toUpperCase(), p.DHCDUSE1)
  );
  const commercialBonus = ['office', 'hotel', 'retail', 'entertainment', 'mixed', 'industrial-light'].includes(type)
    ? 0.15 : 0;

  return Math.min(1, valueScore * 0.4 + areaScore * 0.2 + proxScore * 0.25 + commercialBonus);
}

// ─── Enrichment ───────────────────────────────────────────────────────────
export function enrichFeatures(features, stats) {
  return features.map((f) => {
    const norm = normalizeProperties(f.properties);
    return {
      ...f,
      properties: {
        ...norm,
        _normalized: true,
        _prominenceScore: calculateProminenceScore({ ...f, properties: norm }, stats),
        _height: estimateHeight(norm),
        _landUseType: getLandUseType(norm.LANDUSEDESC),
        _centroid: getCentroid(f.geometry),
      },
    };
  });
}

// ─── Display helpers ──────────────────────────────────────────────────────
export function formatCurrency(value) {
  if (!value || value === 0) return 'N/A';
  const n = parseFloat(value);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export function formatArea(sqft) {
  if (!sqft || sqft === 0) return 'N/A';
  const n = parseFloat(sqft);
  if (n >= 43560) return `${(n / 43560).toFixed(2)} ac`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K sf`;
  return `${Math.round(n).toLocaleString()} sf`;
}

export function formatNumber(n) {
  if (!n) return 'N/A';
  return parseFloat(n).toLocaleString();
}

export function percentileLabel(score) {
  if (score < 0 || isNaN(score)) return '—';
  const pct = Math.round(score * 100);
  if (pct >= 95) return 'Top 5%';
  if (pct >= 90) return 'Top 10%';
  if (pct >= 75) return 'Top 25%';
  if (pct >= 50) return 'Top 50%';
  return `Bottom ${100 - pct}%`;
}
