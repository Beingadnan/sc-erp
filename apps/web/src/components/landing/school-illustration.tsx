/** Original flat illustration of a school building, used on the landing page. */
export function SchoolIllustration({ className }: { className?: string }) {
  // Window rows for a block: x positions, y positions.
  const windows = (xs: number[], ys: number[], w: number, h: number, key: string) =>
    ys.flatMap((y) =>
      xs.map((x) => (
        <g key={`${key}-${x}-${y}`}>
          <rect x={x} y={y} width={w} height={h} rx={2} fill="url(#glass)" />
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={2}
            fill="none"
            stroke="#c9d6e6"
            strokeWidth={1.5}
          />
          <line
            x1={x + w / 2}
            y1={y}
            x2={x + w / 2}
            y2={y + h}
            stroke="#c9d6e6"
            strokeWidth={1.2}
          />
          <path
            d={`M${x + 3} ${y + h - 4} L${x + w / 2 - 3} ${y + 4}`}
            stroke="#ffffff"
            strokeOpacity={0.55}
            strokeWidth={2}
          />
        </g>
      )),
    );
  const tree = (cx: number, base: number, s: number, key: string) => (
    <g key={key}>
      <rect x={cx - 3 * s} y={base - 34 * s} width={6 * s} height={34 * s} rx={2} fill="#8a6a4f" />
      <circle cx={cx} cy={base - 52 * s} r={26 * s} fill="#4f9d69" />
      <circle cx={cx - 18 * s} cy={base - 40 * s} r={18 * s} fill="#5fb07a" />
      <circle cx={cx + 18 * s} cy={base - 42 * s} r={19 * s} fill="#468f5e" />
      <circle cx={cx + 4 * s} cy={base - 70 * s} r={17 * s} fill="#6cbd86" />
    </g>
  );

  return (
    <svg
      viewBox="0 0 640 420"
      className={className}
      role="img"
      aria-label="Illustration of a school building"
    >
      <defs>
        <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7fa6d6" />
          <stop offset="1" stopColor="#3f6fa8" />
        </linearGradient>
        <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#eef2f7" />
        </linearGradient>
        <linearGradient id="wallSide" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3f6fa" />
          <stop offset="1" stopColor="#e2e8f0" />
        </linearGradient>
        <linearGradient id="lawn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fd19e" />
          <stop offset="1" stopColor="#5fb07a" />
        </linearGradient>
      </defs>

      {/* Lawn and path */}
      <ellipse cx={320} cy={372} rx={310} ry={46} fill="url(#lawn)" />
      <path d="M292 330 L348 330 L398 416 L242 416 Z" fill="#e7e2d8" />
      <path
        d="M292 330 L348 330 L398 416 L242 416 Z"
        fill="none"
        stroke="#d6cfc2"
        strokeWidth={1.5}
      />

      {/* Side wings */}
      <rect x={70} y={168} width={150} height={166} fill="url(#wallSide)" />
      <rect x={64} y={158} width={162} height={12} rx={2} fill="#cbd5e1" />
      {windows([86, 128, 170], [186, 236, 286], 30, 36, 'l')}
      <rect x={420} y={168} width={150} height={166} fill="url(#wallSide)" />
      <rect x={414} y={158} width={162} height={12} rx={2} fill="#cbd5e1" />
      {windows([440, 482, 524], [186, 236, 286], 30, 36, 'r')}

      {/* Main block */}
      <rect x={200} y={102} width={240} height={232} fill="url(#wall)" />
      <rect x={192} y={90} width={256} height={14} rx={3} fill="#94a3b8" />
      <rect x={200} y={104} width={240} height={4} fill="#e2e8f0" />
      {windows([218, 262, 346, 390], [124, 178, 232], 32, 38, 'm')}
      {/* Crest above the entrance */}
      <circle cx={320} cy={146} r={22} fill="#1d4ed8" />
      <path d="M306 146 L320 138 L334 146 L320 154 Z" fill="#ffffff" />
      <path
        d="M312 150 L312 157 Q320 162 328 157 L328 150"
        fill="none"
        stroke="#ffffff"
        strokeWidth={2.5}
      />
      <rect x={296} y={176} width={48} height={40} rx={3} fill="url(#glass)" />

      {/* Entrance canopy, pillars, doors, steps */}
      <rect x={262} y={250} width={116} height={10} rx={2} fill="#64748b" />
      <rect x={270} y={260} width={8} height={74} fill="#e2e8f0" />
      <rect x={362} y={260} width={8} height={74} fill="#e2e8f0" />
      <rect x={290} y={268} width={60} height={66} rx={2} fill="url(#glass)" />
      <line x1={320} y1={268} x2={320} y2={334} stroke="#c9d6e6" strokeWidth={2} />
      <rect x={280} y={334} width={80} height={6} fill="#cbd5e1" />
      <rect x={272} y={340} width={96} height={6} fill="#b8c3d1" />

      {/* Flag */}
      <rect x={470} y={40} width={3} height={118} fill="#94a3b8" />
      <rect x={473} y={44} width={42} height={9} fill="#ff9933" />
      <rect
        x={473}
        y={53}
        width={42}
        height={9}
        fill="#ffffff"
        stroke="#e2e8f0"
        strokeWidth={0.5}
      />
      <rect x={473} y={62} width={42} height={9} fill="#138808" />
      <circle cx={494} cy={57.5} r={3} fill="none" stroke="#000080" strokeWidth={1} />

      {/* Hedges and trees */}
      <rect x={70} y={326} width={190} height={14} rx={7} fill="#4f9d69" />
      <rect x={380} y={326} width={190} height={14} rx={7} fill="#4f9d69" />
      {tree(46, 352, 1, 't1')}
      {tree(596, 352, 1.05, 't2')}
      {tree(150, 372, 0.7, 't3')}
      {tree(500, 374, 0.72, 't4')}
    </svg>
  );
}
