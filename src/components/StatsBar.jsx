import { formatCurrency } from '../utils/dataProcessing';

export default function StatsBar({ stats, featureCount, usingSampleData }) {
  const totalValue = stats?.totalValue ?? 0;
  const avgValue = featureCount > 0 ? totalValue / featureCount : 0;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 animate-fade-in pointer-events-none">
      <div className="glass-panel px-5 py-2.5 flex items-center gap-6">
        {/* Logo */}
        <div className="flex items-center gap-2 pr-6 border-r border-panel-border/50">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-cyan to-accent-gold flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
            </svg>
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-none tracking-tight">3Dtimore</div>
            <div className="text-panel-muted text-[10px] leading-none mt-0.5">Baltimore, MD</div>
          </div>
        </div>

        <Stat value={featureCount > 0 ? featureCount.toLocaleString() : '—'} label="Properties" />
        <Stat value={totalValue > 0 ? formatCurrency(totalValue) : '—'} label="Total Value" />
        <Stat value={avgValue > 0 ? formatCurrency(avgValue) : '—'} label="Avg. Value" />

        {usingSampleData && (
          <div className="flex items-center gap-1.5 pl-4 border-l border-panel-border/50">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-gold animate-pulse-slow" />
            <span className="text-accent-gold text-[11px] font-medium">Sample Data</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="text-white font-semibold text-sm tabular-nums leading-none">{value}</div>
      <div className="text-panel-muted text-[10px] uppercase tracking-wider leading-none">{label}</div>
    </div>
  );
}
