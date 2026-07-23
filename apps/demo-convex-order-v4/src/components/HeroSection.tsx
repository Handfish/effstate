import { cn } from "@/lib/utils";

interface HeroSectionProps {
  className?: string;
}

export function HeroSection({ className }: HeroSectionProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900",
        "border border-gray-700",
        className
      )}
    >
      {/* Animated background grid */}
      <div className="absolute inset-0 opacity-20">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(rgba(16, 185, 129, 0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(16, 185, 129, 0.1) 1px, transparent 1px)
            `,
            backgroundSize: "40px 40px",
            animation: "grid-move 20s linear infinite",
          }}
        />
      </div>

      {/* Glowing orbs */}
      <div className="absolute top-10 left-10 w-32 h-32 bg-yellow-500/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-10 right-10 w-40 h-40 bg-blue-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-60 h-60 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "0.5s" }} />

      <div className="relative px-8 py-12">
        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-black mb-4">
            <span className="bg-gradient-to-r from-yellow-400 via-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              Hybrid State
            </span>
            <br />
            <span className="text-white">Management</span>
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            EffState provides <span className="text-yellow-400 font-semibold">instant optimistic updates</span> on the client,
            while <span className="text-blue-400 font-semibold">Convex ensures persistence</span> and real-time sync.
          </p>
        </div>

        {/* Architecture visualization */}
        <div className="max-w-4xl mx-auto">
          <svg viewBox="0 0 800 200" className="w-full h-auto">
            <defs>
              <linearGradient id="hero-yellow" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#f59e0b" />
              </linearGradient>
              <linearGradient id="hero-blue" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#1d4ed8" />
              </linearGradient>
              <linearGradient id="hero-green" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>
              <linearGradient id="hero-purple" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>

              <filter id="hero-glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* User */}
            <g transform="translate(100, 100)">
              <circle r="35" fill="#1f2937" stroke="url(#hero-green)" strokeWidth="3" filter="url(#hero-glow)" />
              <text y="5" textAnchor="middle" className="fill-white text-sm font-bold">👤</text>
              <text y="55" textAnchor="middle" className="fill-gray-400 text-[11px]">User</text>
            </g>

            {/* Arrow: User -> EffState */}
            <g>
              <path d="M 145 100 L 225 100" stroke="#10b981" strokeWidth="2" strokeDasharray="6 3" className="animate-pulse" />
              <polygon points="225,95 235,100 225,105" fill="#10b981" />
              <text x="185" y="90" textAnchor="middle" className="fill-emerald-400 text-[9px]">click</text>
            </g>

            {/* EffState */}
            <g transform="translate(300, 100)">
              <rect x="-55" y="-35" width="110" height="70" rx="10" fill="#1f2937" stroke="url(#hero-yellow)" strokeWidth="3" filter="url(#hero-glow)" />
              <text y="-8" textAnchor="middle" className="fill-yellow-400 text-xs font-bold">EffState</text>
              <text y="8" textAnchor="middle" className="fill-gray-400 text-[9px]">State Machine</text>
              <text y="22" textAnchor="middle" className="fill-yellow-500/60 text-[8px]">instant update</text>

              {/* Pulse indicator */}
              <circle cx="45" cy="-25" r="6" className="fill-yellow-500/30 animate-ping" />
              <circle cx="45" cy="-25" r="4" className="fill-yellow-400" />
            </g>

            {/* Arrow: EffState -> React */}
            <g>
              <path d="M 245 80 C 200 50, 200 150, 245 120" stroke="#10b981" strokeWidth="2" fill="none" strokeDasharray="4 2" />
              <text x="200" y="100" textAnchor="middle" className="fill-emerald-400/60 text-[8px]">re-render</text>
            </g>

            {/* Arrow: EffState -> Convex */}
            <g>
              <path d="M 365 100 L 495 100" stroke="#f59e0b" strokeWidth="2" />
              <polygon points="495,95 505,100 495,105" fill="#f59e0b" />
              <text x="430" y="90" textAnchor="middle" className="fill-amber-400 text-[9px]">mutation</text>

              {/* Animated packet */}
              <circle r="6" fill="#fbbf24" className="animate-bounce">
                <animateMotion dur="2s" repeatCount="indefinite" path="M 365 0 L 495 0" />
              </circle>
            </g>

            {/* Convex */}
            <g transform="translate(560, 100)">
              <rect x="-45" y="-35" width="90" height="70" rx="10" fill="#1f2937" stroke="url(#hero-blue)" strokeWidth="3" filter="url(#hero-glow)" />
              <text y="-8" textAnchor="middle" className="fill-blue-400 text-xs font-bold">Convex</text>
              <text y="8" textAnchor="middle" className="fill-gray-400 text-[9px]">Database</text>
              <text y="22" textAnchor="middle" className="fill-blue-500/60 text-[8px]">persisted</text>
            </g>

            {/* Arrow: Convex -> EffState (sync) */}
            <g>
              <path d="M 505 130 L 365 130" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="4 2" />
              <polygon points="365,125 355,130 365,135" fill="#8b5cf6" />
              <text x="435" y="145" textAnchor="middle" className="fill-purple-400 text-[9px]">real-time sync</text>
            </g>

            {/* Other clients */}
            <g transform="translate(700, 100)">
              <circle r="30" fill="#1f2937" stroke="url(#hero-purple)" strokeWidth="2" opacity="0.6" />
              <text y="5" textAnchor="middle" className="fill-white text-sm">👥</text>
              <text y="50" textAnchor="middle" className="fill-gray-500 text-[10px]">Other clients</text>
            </g>

            {/* Arrow: Convex -> Other clients */}
            <g>
              <path d="M 615 100 L 660 100" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" />
              <polygon points="660,97 667,100 660,103" fill="#8b5cf6" opacity="0.6" />
            </g>
          </svg>
        </div>

        {/* Key points */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          <div className="bg-black/30 rounded-lg p-4 border border-yellow-600/30">
            <div className="text-2xl mb-2">⚡</div>
            <h3 className="text-yellow-400 font-bold mb-1">0ms Perceived Latency</h3>
            <p className="text-gray-400 text-sm">UI updates instantly on user action. No spinners, no waiting.</p>
          </div>
          <div className="bg-black/30 rounded-lg p-4 border border-blue-600/30">
            <div className="text-2xl mb-2">🔒</div>
            <h3 className="text-blue-400 font-bold mb-1">Server Validation</h3>
            <p className="text-gray-400 text-sm">Convex validates and persists. Invalid transitions are rejected.</p>
          </div>
          <div className="bg-black/30 rounded-lg p-4 border border-purple-600/30">
            <div className="text-2xl mb-2">🔄</div>
            <h3 className="text-purple-400 font-bold mb-1">Auto-Correction</h3>
            <p className="text-gray-400 text-sm">
              <code className="bg-purple-900/50 px-1 rounded">_syncSnapshot()</code> corrects any drift automatically.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes grid-move {
          0% { transform: translate(0, 0); }
          100% { transform: translate(40px, 40px); }
        }
      `}</style>
    </div>
  );
}
