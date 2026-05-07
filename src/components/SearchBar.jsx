import { useState, useRef, useEffect } from 'react';

export default function SearchBar({ onSearch, loading: searching }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);

  // Keyboard shortcut: / to focus
  useEffect(() => {
    function handleKey(e) {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        inputRef.current?.blur();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    if (query.trim()) onSearch(query.trim());
  }

  return (
    <div className="absolute top-4 right-4 z-20 animate-fade-in">
      <form onSubmit={handleSubmit} className="relative">
        <div className={`glass-panel flex items-center gap-2 px-3 py-2 transition-all duration-200 ${
          focused ? 'ring-1 ring-accent-cyan/50' : ''
        }`} style={{ borderRadius: 10 }}>
          {searching ? (
            <div className="w-4 h-4 rounded-full border-2 border-accent-cyan/30 border-t-accent-cyan animate-spin shrink-0" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" className="text-panel-muted shrink-0">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          )}

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search BLOCKLOT or address…"
            className="bg-transparent text-white text-sm placeholder:text-panel-muted outline-none w-56"
          />

          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              className="text-panel-muted hover:text-white transition-colors ml-1 shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          )}

          {!focused && !query && (
            <kbd className="hidden sm:flex items-center gap-0.5 ml-1 px-1.5 py-0.5 bg-panel-border/60 rounded text-[10px] text-panel-muted font-mono shrink-0">
              /
            </kbd>
          )}
        </div>
      </form>

      {/* Quick examples */}
      {focused && (
        <div className="glass-panel mt-1.5 p-2" style={{ borderRadius: 10 }}>
          <div className="text-[10px] text-panel-muted uppercase tracking-wider px-1 mb-1.5">Quick jump</div>
          {['1976 001', '1930 001', '2001 005'].map((ex) => (
            <button
              key={ex}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(ex);
                onSearch(ex);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors text-left"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" className="text-accent-gold shrink-0">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              </svg>
              <span className="font-mono text-xs text-white">{ex}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
