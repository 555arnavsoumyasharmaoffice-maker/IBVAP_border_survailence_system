export function ArcReactor({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <div
      className={`relative flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
      title="J.A.R.V.I.S Arc Reactor Core · Nominal 100%"
    >
      {/* Outer spinning ring with segmented ticks */}
      <div
        className="absolute inset-0 rounded-full border border-cyan-400/60 border-dashed animate-[spin_8s_linear_infinite]"
        style={{ filter: 'drop-shadow(0 0 4px #00f0ff)' }}
      />
      {/* Middle counter-rotating segmented arc */}
      <div
        className="absolute inset-[3px] rounded-full border border-cyan-300/80 border-t-transparent border-b-transparent animate-[spin_5s_linear_infinite_reverse]"
      />
      {/* Glowing inner core */}
      <div
        className="absolute inset-[5px] rounded-full bg-cyan-400/25 border border-cyan-200 flex items-center justify-center"
        style={{ boxShadow: '0 0 10px #00f0ff, inset 0 0 8px #00f0ff' }}
      >
        <div className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_8px_#ffffff]" />
      </div>
    </div>
  )
}
