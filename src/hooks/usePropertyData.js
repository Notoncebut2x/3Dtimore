import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchCommercialProperties, fetchByBlocklot, getSampleData } from '../utils/api';
import { computeStats, enrichFeatures } from '../utils/dataProcessing';

export function usePropertyData() {
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [usingSampleData, setUsingSampleData] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      let geojson;
      let isSample = false;

      // Priority: 1) pre-processed local file, 2) live API, 3) built-in sample
      try {
        const res = await fetch('/data/commercial-properties.geojson', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          geojson = await res.json();
          if (!geojson.features?.length) throw new Error('Empty local file');
          console.info(`Loaded ${geojson.features.length} features from local file.`);
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (localErr) {
        console.info('Local file not found — trying live API…');
        try {
          geojson = await fetchCommercialProperties();
          if (!geojson.features?.length) throw new Error('Empty API response');
        } catch (apiErr) {
          console.info('Live API unavailable — using built-in sample dataset.');
          geojson = getSampleData();
          isSample = true;
          setError('Showing sample dataset. Run `node scripts/preprocessLocal.js` to load real data.');
        }
      }

      if (cancelled) return;

      const s = computeStats(geojson.features);
      const enriched = {
        ...geojson,
        features: enrichFeatures(geojson.features, s),
      };

      setStats(s);
      setData(enriched);
      setUsingSampleData(isSample);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // O(1) index: built once when data loads, not on every lookup
  const blocklotIndex = useMemo(() => {
    if (!data?.features) return new Map();
    const idx = new Map();
    for (const f of data.features) {
      const bl = f.properties?.BLOCKLOT;
      if (bl) idx.set(bl, f);
    }
    return idx;
  }, [data]);

  // On-demand lookup by BLOCKLOT — O(1) in-memory, falls back to API
  const lookupBlocklot = useCallback(async (blocklot) => {
    if (!blocklot) return null;
    const normalized = blocklot.trim().toUpperCase();

    const found = blocklotIndex.get(normalized);
    if (found) return found;

    // Try live API
    try {
      const feature = await fetchByBlocklot(normalized);
      if (feature && stats) {
        // Enrich the single feature with computed stats
        const [enriched] = enrichFeatures([feature], stats);
        return enriched;
      }
    } catch (e) {
      console.warn('Blocklot lookup failed:', e);
    }
    return null;
  }, [blocklotIndex, stats]);

  return { data, stats, loading, usingSampleData, error, lookupBlocklot };
}
