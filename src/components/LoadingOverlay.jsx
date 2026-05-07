export default function LoadingOverlay({ message = 'Loading Baltimore data...' }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-panel-bg/90 backdrop-blur-sm animate-fade-in">
      <div className="glass-panel px-10 py-8 flex flex-col items-center gap-5 max-w-sm text-center">
        {/* Animated rings */}
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-2 border-accent-cyan/20 animate-ping" />
          <div className="absolute inset-1 rounded-full border-2 border-accent-cyan/40 animate-pulse-slow" />
          <div className="absolute inset-3 rounded-full border-2 border-accent-cyan animate-spin [animation-duration:2s]" style={{ borderTopColor: 'transparent' }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent-cyan">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
        </div>

        <div>
          <div className="text-white font-semibold text-lg mb-1">3Dtimore</div>
          <div className="text-panel-muted text-sm">{message}</div>
        </div>

        <div className="w-full bg-panel-border rounded-full h-0.5 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-accent-cyan to-accent-gold rounded-full animate-[shimmer_1.5s_ease-in-out_infinite]"
               style={{ animation: 'loadingBar 2s ease-in-out infinite' }} />
        </div>

        <style>{`
          @keyframes loadingBar {
            0% { width: 0%; margin-left: 0%; }
            50% { width: 60%; margin-left: 20%; }
            100% { width: 0%; margin-left: 100%; }
          }
        `}</style>
      </div>
    </div>
  );
}
