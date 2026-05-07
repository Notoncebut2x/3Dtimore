import { memo, useMemo } from 'react';
import { CATEGORY_LABELS, CATEGORY_COLORS, rgbToHex } from '../utils/colors';
import { formatCurrency, formatArea, percentileLabel } from '../utils/dataProcessing';

const Sidebar = memo(function Sidebar({ feature, onClose, stats, onStartTour }) {
  if (!feature) return null;

  const p = feature.properties;
  const score = p._prominenceScore ?? 0;
  const type = p._landUseType || 'other';
  const typeColor = rgbToHex(CATEGORY_COLORS[type] || [100, 116, 139]);
  const typeLabel = CATEGORY_LABELS[type] || 'Commercial';
  const height = p._height || 0;
  const estFloors = Math.round(height / 4);
  const value = parseFloat(p.FULLCASH || p.ARTAXBAS || p.TAXBASE || 0);

  // Binary search on pre-sorted array — O(log n) vs O(n) findIndex
  const valueRank = useMemo(() => {
    const sv = stats?.sortedValues;
    if (!sv?.length) return null;
    let lo = 0, hi = sv.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sv[mid] < value) lo = mid + 1; else hi = mid - 1;
    }
    return percentileLabel(lo / sv.length);
  }, [stats?.sortedValues, value]);

  const formattedSaleDate = useMemo(() => {
    if (!p.SALEDATE) return null;
    return new Date(p.SALEDATE).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }, [p.SALEDATE]);

  const openDataUrl = `https://data.baltimorecity.gov/datasets/64110b108565433d8da40dd0e422064e_0/explore?where=BLOCKLOT%3D'${encodeURIComponent(p.BLOCKLOT)}'`;

  return (
    <div
      className="absolute right-4 top-4 bottom-4 z-20 w-80 flex flex-col animate-slide-in"
      style={{ maxHeight: 'calc(100vh - 2rem)' }}
    >
      <div className="glass-panel flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-panel-border/50 shrink-0">
          <div className="flex-1 min-w-0 mr-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs font-bold text-accent-gold tracking-wider bg-accent-gold/10 px-2 py-0.5 rounded">
                {p.BLOCKLOT || '—'}
              </span>
              <span
                className="badge"
                style={{ backgroundColor: `${typeColor}20`, color: typeColor }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: typeColor }} />
                {typeLabel}
              </span>
            </div>
            <div className="text-white font-semibold text-base leading-snug truncate">
              {p.ADDRESS || 'Address unavailable'}
            </div>
            <div className="text-panel-muted text-xs mt-0.5">Baltimore, MD</div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-panel-muted hover:text-white"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Assessed Value Hero */}
          <div className="p-4 border-b border-panel-border/40">
            <div className="section-title">Assessed Value</div>
            <div className="text-3xl font-bold text-white tabular-nums tracking-tight mb-2">
              {formatCurrency(value)}
            </div>
            {valueRank && (
              <div className="flex items-center gap-2">
                <div className="score-bar flex-1">
                  <div
                    className="score-fill"
                    style={{
                      width: `${Math.round(score * 100)}%`,
                      background: 'linear-gradient(to right, #06b6d4, #f59e0b)',
                    }}
                  />
                </div>
                <span className="text-xs text-panel-muted shrink-0">{valueRank}</span>
              </div>
            )}
          </div>

          {/* Ownership */}
          <div className="p-4 border-b border-panel-border/40">
            <div className="section-title">Ownership</div>
            <div className="space-y-0">
              {(p.OWNER1 || p.OWNER_1) && (
                <div className="detail-row">
                  <span className="detail-label">Owner</span>
                  <span className="detail-value text-white font-medium">{(p.OWNER1 || p.OWNER_1 || '').trim()}</span>
                </div>
              )}
              {(p.OWNER2 || p.OWNER_2) && (p.OWNER2 || p.OWNER_2).trim() && (
                <div className="detail-row">
                  <span className="detail-label">Owner 2</span>
                  <span className="detail-value">{(p.OWNER2 || p.OWNER_2 || '').trim()}</span>
                </div>
              )}
              {p.NEIGHBOR && (
                <div className="detail-row">
                  <span className="detail-label">Neighborhood</span>
                  <span className="detail-value capitalize">{p.NEIGHBOR.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}</span>
                </div>
              )}
            </div>
          </div>

          {/* Property Details */}
          <div className="p-4 border-b border-panel-border/40">
            <div className="section-title">Property Details</div>
            <div className="space-y-0">
              <DetailRow label="Use Type" value={p.LANDUSEDESC || '—'} highlight />
              <DetailRow label="Zoning" value={(p.ZONING || p.ZONECODE || '—').trim()} mono />
              <DetailRow label="Year Built" value={(p.YR_BUILT || p.YEAR_BUILD) || '—'} />
              {p.BLDG_NO > 0 && <DetailRow label="Bldg. No." value={p.BLDG_NO} />}
              {p.NO_IMPRV > 0 && <DetailRow label="Improvements" value={p.NO_IMPRV} />}
            </div>
          </div>

          {/* Dimensions */}
          <div className="p-4 border-b border-panel-border/40">
            <div className="section-title">Dimensions</div>
            <div className="grid grid-cols-2 gap-3">
              <DimCard label="Lot Size" value={p.LOT_SIZE ? p.LOT_SIZE.trim() : formatArea(p.LOTSIZE)} />
              <DimCard label="Structure" value={formatArea(p.STRUCAREA || p.LTOAREA)} />
              <DimCard label="Est. Height" value={height > 0 ? `${Math.round(height)}m` : 'N/A'} />
              <DimCard label="Est. Floors" value={estFloors > 0 ? `${estFloors} fl.` : 'N/A'} />
            </div>
          </div>

          {/* Transaction */}
          {(p.SALEDATE || p.SALEPRICE) && (
            <div className="p-4 border-b border-panel-border/40">
              <div className="section-title">Last Transaction</div>
              <div className="space-y-0">
                {p.SALEPRICE && <DetailRow label="Sale Price" value={formatCurrency(p.SALEPRICE)} />}
                {formattedSaleDate && <DetailRow label="Sale Date" value={formattedSaleDate} />}
              </div>
            </div>
          )}

          {/* Prominence Score */}
          <div className="p-4 border-b border-panel-border/40">
            <div className="section-title">Prominence Score</div>
            <div className="flex items-center gap-3">
              <div className="text-3xl font-bold tabular-nums" style={{ color: getScoreColor(score) }}>
                {Math.round(score * 100)}
              </div>
              <div className="flex-1">
                <div className="score-bar mb-1">
                  <div
                    className="score-fill"
                    style={{
                      width: `${Math.round(score * 100)}%`,
                      backgroundColor: getScoreColor(score),
                    }}
                  />
                </div>
                <div className="text-[11px] text-panel-muted">
                  Value · Area · CBD proximity · Use type
                </div>
              </div>
            </div>
          </div>

          {/* Mini sparkline chart for visual interest */}
          <div className="p-4 border-b border-panel-border/40">
            <div className="section-title">Profile</div>
            <ScoreChart score={score} value={parseFloat(p.FULLCASH || 0)} type={type} />
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-panel-border/50 shrink-0 space-y-2">
          {/* Guided tour button — only for BLOCKLOT 1976 001 */}
          {p.BLOCKLOT === '1976 001' && onStartTour && (
            <button
              onClick={onStartTour}
              className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg bg-accent-gold/15 border border-accent-gold/30 hover:bg-accent-gold/25 transition-colors text-sm text-accent-gold font-medium"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21"/>
              </svg>
              Take Guided 3D Tour
            </button>
          )}
          <a
            href={openDataUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2 px-4 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-xs text-panel-muted hover:text-white"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
            </svg>
            View on Baltimore Open Data
          </a>
        </div>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.feature?.properties?.BLOCKLOT === next.feature?.properties?.BLOCKLOT &&
  prev.stats === next.stats
);

export default Sidebar;

function DetailRow({ label, value, highlight, mono }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className={`detail-value ${highlight ? 'text-white font-medium' : ''} ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function DimCard({ label, value }) {
  return (
    <div className="bg-panel-bg/60 rounded-lg p-2.5">
      <div className="text-panel-muted text-[10px] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-white text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function getScoreColor(score) {
  if (score >= 0.8) return '#f59e0b';
  if (score >= 0.6) return '#10b981';
  if (score >= 0.4) return '#06b6d4';
  return '#8b949e';
}

function ScoreChart({ score, value, type }) {
  // Radar-like bar chart for 4 dimensions
  const dims = [
    { label: 'Value', score: Math.min(1, value / 100000000) },
    { label: 'Location', score: score * 1.1 },
    { label: 'Footprint', score: score * 0.85 },
    { label: 'Use Class', score: ['office', 'hotel', 'mixed'].includes(type) ? 0.8 : 0.5 },
  ];

  return (
    <div className="space-y-2">
      {dims.map(({ label, score: s }) => (
        <div key={label} className="flex items-center gap-3">
          <span className="text-[11px] text-panel-muted w-16 shrink-0">{label}</span>
          <div className="flex-1 score-bar">
            <div
              className="score-fill transition-all duration-700"
              style={{
                width: `${Math.min(100, Math.round(s * 100))}%`,
                background: 'linear-gradient(to right, #06b6d4, #f59e0b)',
              }}
            />
          </div>
          <span className="text-[11px] text-panel-muted w-7 text-right tabular-nums">
            {Math.min(100, Math.round(s * 100))}
          </span>
        </div>
      ))}
    </div>
  );
}
