import { useState, useEffect, useCallback } from 'react';
import Map3D from './components/Map3D';
import Sidebar from './components/Sidebar';
import SearchBar from './components/SearchBar';
import Legend from './components/Legend';
import StatsBar from './components/StatsBar';
import LoadingOverlay from './components/LoadingOverlay';
import TourMode from './components/TourMode';
import { usePropertyData } from './hooks/usePropertyData';

const FEATURED_BLOCKLOT = '1976 001';

export default function App() {
  const { data, stats, loading, usingSampleData, lookupBlocklot } = usePropertyData();

  const [selectedFeature, setSelectedFeature] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [colorMode, setColorMode] = useState('type');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [tourActive, setTourActive] = useState(false);

  // Auto-select the featured property on load
  useEffect(() => {
    if (!data || selectedFeature) return;
    const featured = data.features.find(
      (f) => f.properties.BLOCKLOT === FEATURED_BLOCKLOT
    );
    if (featured) setSelectedFeature(featured);
  }, [data, selectedFeature]);

  const handleSearch = useCallback(async (query) => {
    setSearchError(null);
    setSearching(true);
    try {
      const feature = await lookupBlocklot(query);
      if (feature) {
        setSelectedFeature(feature);
      } else {
        setSearchError(`No property found for "${query}"`);
        setTimeout(() => setSearchError(null), 3500);
      }
    } finally {
      setSearching(false);
    }
  }, [lookupBlocklot]);

  const handlePropertySelect = useCallback((feature) => {
    setSelectedFeature(feature);
  }, []);

  const handlePropertyHover = useCallback((blocklot) => {
    setHoveredId(blocklot);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedFeature(null);
  }, []);

  // Tour mode renders a completely separate scene
  if (tourActive) {
    return <TourMode onExit={() => setTourActive(false)} />;
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-panel-bg">
      {/* 3D Map — full bleed */}
      <Map3D
        data={data}
        selectedFeature={selectedFeature}
        hoveredId={hoveredId}

        onPropertySelect={handlePropertySelect}
        onPropertyHover={handlePropertyHover}
      />

      {/* Top center: stats bar */}
      {!loading && (
        <StatsBar
          stats={stats}
          featureCount={data?.features.length ?? 0}
          usingSampleData={usingSampleData}
        />
      )}

      {/* Top right: search */}
      <SearchBar onSearch={handleSearch} loading={searching} />

      {/* Right panel: property detail */}
      <Sidebar
        feature={selectedFeature}
        onClose={handleClose}
        stats={stats}
        onStartTour={() => setTourActive(true)}
      />

      {/* Bottom left: legend */}
      {!loading && (
        <Legend colorMode={colorMode} onColorModeChange={setColorMode} />
      )}

      {/* Tour launch button — bottom center, shown when featured property is selected */}
      {selectedFeature?.properties?.BLOCKLOT === FEATURED_BLOCKLOT && !loading && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 animate-fade-in">
          <button
            onClick={() => setTourActive(true)}
            className="glass-panel flex items-center gap-2.5 px-5 py-2.5 hover:bg-white/5 transition-all duration-200 group"
            style={{ borderRadius: 50 }}
          >
            <div className="w-6 h-6 rounded-full bg-accent-gold/20 border border-accent-gold/50 flex items-center justify-center group-hover:bg-accent-gold/30 transition-colors">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-accent-gold">
                <polygon points="5 3 19 12 5 21"/>
              </svg>
            </div>
            <span className="text-white text-sm font-medium">Take Guided Tour of BLOCKLOT 1976 001</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 className="text-panel-muted group-hover:text-white transition-colors">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      )}

      {/* Loading overlay */}
      {loading && <LoadingOverlay />}

      {/* Search error toast */}
      {searchError && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 glass-panel px-4 py-2.5 text-sm text-white flex items-center gap-2 animate-fade-in">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
          {searchError}
        </div>
      )}

      {/* Keyboard hint */}
      {!selectedFeature && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="text-[10px] text-panel-muted/50 text-center">
            Press <kbd className="font-mono bg-panel-border/40 px-1 rounded">/</kbd> to search · Click a building to explore
          </div>
        </div>
      )}
    </div>
  );
}
