import { useState } from 'react';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../utils/colors';
import { rgbToHex } from '../utils/colors';

const PRIMARY_TYPES = ['office', 'retail', 'hotel', 'entertainment', 'mixed', 'warehouse', 'institutional'];

export default function Legend({ colorMode, onColorModeChange }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="absolute bottom-6 left-4 z-20 w-56 animate-fade-in">
      <div className="glass-panel overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-white/5 transition-colors"
        >
          <span className="text-xs font-semibold text-panel-muted uppercase tracking-widest">
            Legend
          </span>
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            className={`text-panel-muted transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}
          >
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        {!collapsed && (
          <div className="px-3.5 pb-3">
            {/* Color mode toggle */}
            <div className="flex gap-1 mb-3 p-0.5 bg-panel-bg rounded-lg">
              {['type', 'value'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => onColorModeChange(mode)}
                  className={`flex-1 py-1 px-2 rounded-md text-xs font-medium transition-all duration-150 ${
                    colorMode === mode
                      ? 'bg-panel-surface text-white shadow'
                      : 'text-panel-muted hover:text-white'
                  }`}
                >
                  {mode === 'type' ? 'By Type' : 'By Value'}
                </button>
              ))}
            </div>

            {colorMode === 'type' ? (
              <div className="space-y-1.5">
                {PRIMARY_TYPES.map((type) => (
                  <div key={type} className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: rgbToHex(CATEGORY_COLORS[type]) }}
                    />
                    <span className="text-xs text-panel-muted">{CATEGORY_LABELS[type]}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="h-2 rounded-full" style={{
                  background: 'linear-gradient(to right, #1e50b4, #06b6d4, #10b981, #f59e0b, #fff)',
                }} />
                <div className="flex justify-between text-xs text-panel-muted">
                  <span>Low value</span>
                  <span>High value</span>
                </div>
              </div>
            )}

            {/* Selected indicator */}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-panel-border/50">
              <div className="w-2.5 h-2.5 rounded-sm bg-accent-gold shrink-0" />
              <span className="text-xs text-panel-muted">Selected property</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
