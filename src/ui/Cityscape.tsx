// One-point perspective alley scene — mid-90s pre-rendered-background vibe.
// Vanishing point at center horizon; stepped buildings on both sides with
// atmospheric haze (lighter & cooler with distance); pair of receding
// streetlamps and neon signs with wet-pavement reflections on the asphalt;
// hooded trench-coat figure walking away from the camera toward the
// vanishing point; distant taxi taillight as a focal punctuation.

export function Cityscape() {
  return (
    <svg
      viewBox="0 0 128 80"
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="crispEdges"
      style={{ width: '100%', height: 'auto', imageRendering: 'pixelated', display: 'block' }}
    >
      {/* ===== SKY — banded gradient (urban light pollution toward horizon) ===== */}
      <rect x={0} y={0}  width={128} height={8}  fill="#0a0816" />
      <rect x={0} y={8}  width={128} height={8}  fill="#161034" />
      <rect x={0} y={16} width={128} height={10} fill="#2a1850" />
      <rect x={0} y={26} width={128} height={10} fill="#4a266e" />
      <rect x={0} y={36} width={128} height={6}  fill="#6a3a7a" />

      {/* Stars — only in higher sky */}
      {STARS.map(([x, y, c], i) => (
        <rect key={`s${i}`} x={x} y={y} width={1} height={1} fill={c} />
      ))}

      {/* Moon — low on horizon, warm amber (mid-90s noir palette) */}
      <rect x={14} y={14} width={4} height={1} fill="#ffd87a" />
      <rect x={13} y={15} width={6} height={1} fill="#ffd87a" />
      <rect x={13} y={16} width={6} height={3} fill="#ffd87a" />
      <rect x={13} y={19} width={6} height={1} fill="#ffd87a" />
      <rect x={14} y={20} width={4} height={1} fill="#ffd87a" />
      <rect x={15} y={17} width={1} height={1} fill="#c89030" />
      <rect x={16} y={18} width={2} height={1} fill="#c89030" />

      {/* ===== BUILDINGS — receding stepped silhouettes, atmospheric perspective ===== */}
      {/* Far-back layer (lightest, hazy) */}
      <rect x={46} y={26} width={12} height={16} fill="#3a3a6e" />
      <rect x={70} y={26} width={12} height={16} fill="#3a3a6e" />

      {/* Mid-far layer */}
      <rect x={40} y={22} width={8}  height={20} fill="#2a2b55" />
      <rect x={80} y={22} width={8}  height={20} fill="#2a2b55" />
      <rect x={30} y={24} width={12} height={18} fill="#2a2b55" />
      <rect x={86} y={24} width={12} height={18} fill="#2a2b55" />

      {/* Mid layer */}
      <rect x={14} y={18} width={20} height={24} fill="#1f2040" />
      <rect x={94} y={18} width={20} height={24} fill="#1f2040" />

      {/* Near layer (darkest, foreground buildings) */}
      <rect x={0}   y={8}  width={18} height={34} fill="#0a0a18" />
      <rect x={110} y={8}  width={18} height={34} fill="#0a0a18" />

      {/* Building edge highlights (top of facade catches lamp/sky glow) */}
      <rect x={0}   y={8}  width={18} height={1} fill="#2a2b55" />
      <rect x={110} y={8}  width={18} height={1} fill="#2a2b55" />
      <rect x={14}  y={18} width={20} height={1} fill="#3a3a6e" />
      <rect x={94}  y={18} width={20} height={1} fill="#3a3a6e" />

      {/* ===== WINDOWS — bigger & brighter on near layers, tiny & dim far back ===== */}
      {NEAR_WINDOWS.map((w, i) => (
        <rect key={`nw${i}`} x={w[0]} y={w[1]} width={w[2]} height={w[3]} fill={w[4]} />
      ))}
      {MID_WINDOWS.map(([x, y, c], i) => (
        <rect key={`mw${i}`} x={x} y={y} width={1} height={1} fill={c} />
      ))}
      {FAR_WINDOWS.map(([x, y, c], i) => (
        <rect key={`fw${i}`} x={x} y={y} width={1} height={1} fill={c} opacity={0.7} />
      ))}

      {/* ===== NEON SIGNS on building facades ===== */}
      {/* Left near — magenta vertical sign */}
      <rect x={2}  y={18} width={2} height={14} fill="#ff00ff" />
      <rect x={1}  y={17} width={4} height={1}  fill="#ff00ff" opacity={0.4} />
      <rect x={1}  y={32} width={4} height={1}  fill="#ff00ff" opacity={0.4} />
      <rect x={0}  y={16} width={6} height={18} fill="#ff00ff" opacity={0.10} />

      {/* Right near — cyan horizontal */}
      <rect x={117} y={22} width={9} height={2} fill="#00ffff" />
      <rect x={116} y={21} width={11} height={1} fill="#00ffff" opacity={0.4} />
      <rect x={116} y={24} width={11} height={1} fill="#00ffff" opacity={0.4} />
      <rect x={114} y={18} width={14} height={10} fill="#00ffff" opacity={0.08} />

      {/* Left mid — hot pink small sign */}
      <rect x={16} y={26} width={1} height={6} fill="#ff3864" />
      <rect x={15} y={27} width={3} height={4} fill="#ff3864" opacity={0.2} />

      {/* Right mid — green sign */}
      <rect x={95} y={24} width={3} height={2} fill="#34e07a" />
      <rect x={94} y={23} width={5} height={4} fill="#34e07a" opacity={0.2} />

      {/* ===== ROAD — perspective trapezoid ===== */}
      <polygon points="0,78 128,78 76,42 52,42" fill="#08080f" />

      {/* Wet-pavement reflections of neon signs (vertical streaks tapering) */}
      {/* Magenta from left near sign */}
      <rect x={4}  y={44} width={3} height={20} fill="#ff00ff" opacity={0.10} />
      <rect x={5}  y={64} width={4} height={14} fill="#ff00ff" opacity={0.08} />
      {/* Cyan from right near sign */}
      <rect x={120} y={44} width={3} height={20} fill="#00ffff" opacity={0.10} />
      <rect x={118} y={64} width={5} height={14} fill="#00ffff" opacity={0.08} />

      {/* Lane center stripes — perspective, getting smaller toward vanishing */}
      <rect x={62} y={45} width={4} height={1} fill="#a08020" opacity={0.4} />
      <rect x={61} y={52} width={6} height={1} fill="#a08020" opacity={0.5} />
      <rect x={60} y={62} width={8} height={2} fill="#c89030" opacity={0.6} />
      <rect x={58} y={73} width={12} height={2} fill="#e0a040" opacity={0.7} />

      {/* Distant TAXI taillights at vanishing point — focal punctuation */}
      <rect x={62} y={42} width={1} height={1} fill="#ff3864" />
      <rect x={65} y={42} width={1} height={1} fill="#ff3864" />
      <rect x={61} y={43} width={1} height={1} fill="#ff3864" opacity={0.4} />
      <rect x={66} y={43} width={1} height={1} fill="#ff3864" opacity={0.4} />

      {/* ===== STREETLAMPS — paired, receding ===== */}
      {/* Far pair (tiny) */}
      <Lamp x={51} y={44} h={5}  size="far" />
      <Lamp x={77} y={44} h={5}  size="far" />
      {/* Mid pair */}
      <Lamp x={37} y={50} h={12} size="mid" />
      <Lamp x={91} y={50} h={12} size="mid" />
      {/* Near pair (big, dominant) */}
      <Lamp x={20} y={56} h={20} size="near" />
      <Lamp x={108} y={56} h={20} size="near" />

      {/* ===== FIGURE — walking AWAY toward vanishing point ===== */}
      {/* Smaller, mid-distance on the road centerline */}
      {FIGURE_PIXELS.map(([x, y, c, op], i) => (
        <rect
          key={`fg${i}`}
          x={FIGURE_OFFSET_X + x}
          y={FIGURE_OFFSET_Y + y}
          width={1}
          height={1}
          fill={c}
          opacity={op ?? 1}
        />
      ))}
      {/* Long shadow stretching back from figure (lamp behind viewer) */}
      <rect x={FIGURE_OFFSET_X + 1} y={FIGURE_OFFSET_Y + 14} width={6} height={1} fill="#000" opacity={0.6} />
      <rect x={FIGURE_OFFSET_X + 2} y={FIGURE_OFFSET_Y + 15} width={4} height={1} fill="#000" opacity={0.4} />

      {/* ===== STEAM from a manhole grate in foreground ===== */}
      <rect x={86} y={72} width={6} height={2} fill="#000" />
      <rect x={87} y={71} width={4} height={1} fill="#000" />
      <rect x={87} y={70} width={1} height={1} fill="#c0c8e0" opacity={0.5} />
      <rect x={89} y={68} width={2} height={1} fill="#c0c8e0" opacity={0.5} />
      <rect x={88} y={66} width={3} height={1} fill="#c0c8e0" opacity={0.35} />
      <rect x={87} y={64} width={4} height={1} fill="#c0c8e0" opacity={0.22} />
      <rect x={88} y={62} width={3} height={1} fill="#c0c8e0" opacity={0.12} />

      {/* Foreground haze overlay (subtle warm wash near bottom) */}
      <rect x={0} y={76} width={128} height={4} fill="#6a3a7a" opacity={0.05} />
    </svg>
  );
}

// ===== Subcomponents =====

function Lamp({ x, y, h, size }: { x: number; y: number; h: number; size: 'far' | 'mid' | 'near' }) {
  // Lamp head + warm glow halo + pole down to street.
  const halo =
    size === 'far'
      ? [{ w: 4, op: 0.18 }, { w: 2, op: 0.35 }]
      : size === 'mid'
        ? [{ w: 8, op: 0.10 }, { w: 5, op: 0.22 }, { w: 3, op: 0.40 }]
        : [{ w: 14, op: 0.06 }, { w: 10, op: 0.12 }, { w: 6, op: 0.20 }, { w: 3, op: 0.45 }];
  return (
    <g>
      {/* halo */}
      {halo.map((h, i) => (
        <rect
          key={i}
          x={x - h.w / 2}
          y={y - h.w / 2}
          width={h.w}
          height={h.w}
          fill="#ffcb05"
          opacity={h.op}
        />
      ))}
      {/* lamp head */}
      <rect x={x - (size === 'near' ? 1 : 0)} y={y - 1} width={size === 'near' ? 2 : 1} height={size === 'near' ? 2 : 1} fill="#ffd87a" />
      {/* pole */}
      <rect x={x} y={y + 1} width={1} height={h} fill={size === 'near' ? '#1a1a2e' : size === 'mid' ? '#2a2b55' : '#3a3a6e'} />
    </g>
  );
}

// ===== Data =====

const STARS: [number, number, string][] = [
  [22, 4, '#8a86b8'], [38, 6, '#e8e6ff'], [54, 3, '#8a86b8'], [68, 7, '#e8e6ff'],
  [82, 4, '#8a86b8'], [96, 6, '#e8e6ff'], [108, 3, '#8a86b8'],
  [4, 10, '#8a86b8'], [44, 12, '#8a86b8'], [60, 11, '#e8e6ff'], [78, 14, '#8a86b8'],
  [102, 12, '#8a86b8'], [124, 11, '#e8e6ff'],
];

// [x, y, width, height, color]
// Near-layer windows: bigger, brighter, more detailed
const NEAR_WINDOWS: [number, number, number, number, string][] = [
  // Left near building (x=0..18)
  [6, 10, 2, 2, '#ffcb05'],  [11, 10, 2, 2, '#4ad6ff'],
  [6, 14, 2, 2, '#ffcb05'],  [11, 14, 2, 2, '#ffcb05'],
  [6, 18, 2, 2, '#4ad6ff'],  [11, 18, 2, 2, '#ffcb05'],
  [6, 22, 2, 2, '#ffcb05'],  [11, 22, 2, 2, '#ffcb05'],
  [6, 26, 2, 2, '#ffcb05'],  [11, 26, 2, 2, '#4ad6ff'],
  [6, 30, 2, 2, '#ffcb05'],  [11, 30, 2, 2, '#ffcb05'],
  [6, 34, 2, 2, '#4ad6ff'],  [11, 34, 2, 2, '#ffcb05'],
  [6, 38, 2, 2, '#ffcb05'],  [11, 38, 2, 2, '#ffcb05'],
  // Right near building (x=110..128)
  [114, 10, 2, 2, '#ffcb05'], [119, 10, 2, 2, '#4ad6ff'], [124, 10, 2, 2, '#ffcb05'],
  [114, 14, 2, 2, '#ffcb05'], [119, 14, 2, 2, '#ffcb05'], [124, 14, 2, 2, '#ffcb05'],
  [114, 18, 2, 2, '#4ad6ff'], [119, 18, 2, 2, '#ffcb05'], [124, 18, 2, 2, '#4ad6ff'],
  [114, 22, 2, 2, '#ffcb05'], [119, 22, 2, 2, '#ffcb05'], [124, 22, 2, 2, '#ffcb05'],
  [114, 26, 2, 2, '#ffcb05'], [119, 26, 2, 2, '#4ad6ff'], [124, 26, 2, 2, '#ffcb05'],
  [114, 30, 2, 2, '#ffcb05'], [119, 30, 2, 2, '#ffcb05'], [124, 30, 2, 2, '#ffcb05'],
  [114, 34, 2, 2, '#4ad6ff'], [119, 34, 2, 2, '#ffcb05'], [124, 34, 2, 2, '#ffcb05'],
  [114, 38, 2, 2, '#ffcb05'], [119, 38, 2, 2, '#4ad6ff'], [124, 38, 2, 2, '#ffcb05'],
];

// Mid-layer windows: 1×1, mixed colors
const MID_WINDOWS: [number, number, string][] = [
  // Left mid (x=14..34)
  [20, 22, '#ffcb05'], [24, 22, '#ffcb05'], [28, 22, '#4ad6ff'], [32, 22, '#ffcb05'],
  [20, 26, '#ffcb05'], [24, 26, '#4ad6ff'], [28, 26, '#ffcb05'], [32, 26, '#ffcb05'],
  [20, 30, '#ffcb05'], [24, 30, '#ffcb05'], [28, 30, '#ffcb05'], [32, 30, '#4ad6ff'],
  [20, 34, '#4ad6ff'], [24, 34, '#ffcb05'], [28, 34, '#ffcb05'], [32, 34, '#ffcb05'],
  [20, 38, '#ffcb05'], [24, 38, '#ffcb05'], [28, 38, '#4ad6ff'], [32, 38, '#ffcb05'],
  // Right mid (x=94..114)
  [96, 22, '#ffcb05'], [100, 22, '#4ad6ff'], [104, 22, '#ffcb05'], [108, 22, '#ffcb05'], [112, 22, '#ffcb05'],
  [96, 26, '#4ad6ff'], [100, 26, '#ffcb05'], [104, 26, '#ffcb05'], [108, 26, '#4ad6ff'], [112, 26, '#ffcb05'],
  [96, 30, '#ffcb05'], [100, 30, '#ffcb05'], [104, 30, '#4ad6ff'], [108, 30, '#ffcb05'], [112, 30, '#ffcb05'],
  [96, 34, '#ffcb05'], [100, 34, '#ffcb05'], [104, 34, '#ffcb05'], [108, 34, '#ffcb05'], [112, 34, '#4ad6ff'],
  [96, 38, '#4ad6ff'], [100, 38, '#ffcb05'], [104, 38, '#ffcb05'], [108, 38, '#ffcb05'], [112, 38, '#ffcb05'],
];

// Far-layer windows: dim, sparser
const FAR_WINDOWS: [number, number, string][] = [
  [32, 28, '#ffcb05'], [36, 30, '#ffcb05'], [42, 28, '#4ad6ff'],
  [44, 30, '#ffcb05'], [46, 32, '#ffcb05'], [50, 32, '#ffcb05'],
  [52, 34, '#ffcb05'], [54, 32, '#4ad6ff'],
  [74, 32, '#ffcb05'], [76, 34, '#4ad6ff'], [80, 28, '#ffcb05'],
  [82, 30, '#ffcb05'], [84, 32, '#ffcb05'], [86, 30, '#ffcb05'],
  [90, 28, '#4ad6ff'], [92, 30, '#ffcb05'],
];

// ===== FIGURE =====
// Walking AWAY from the viewer toward the vanishing point.
// 8 wide × 16 tall, centered in the road. Smaller than the previous scene
// because the figure is mid-distance, not foreground.
//   D = #0a0a18  (deepest shadow / inside hood)
//   M = #16172a  (silhouette body)
//   R = #2a2b55  (rim light from streetlamps - both shoulders)
//   H = #1f2040  (coat midtone)
const FIGURE_OFFSET_X = 60;
const FIGURE_OFFSET_Y = 50;

const FIG_GLYPHS = [
  '...MM...',  // 0  hood crown
  '..MMMM..',  // 1
  '.RMMMMMR',  // 2
  '.RMDDMMR',  // 3  hood w/ shadow
  '.RMDDMMR',  // 4
  '.RMMMMMR',  // 5  shoulders
  'RHHHHHHR',  // 6  collar
  'RHHHHHHR',  // 7  coat
  'RHHHHHHR',  // 8
  'RHHHHHHR',  // 9
  'RHHHHHHR',  //10
  'RMHHHHMR',  //11  hem cinch
  '.MMHHMM.',  //12  hem flare
  '..MMMM..',  //13  legs (close together — walking away pose)
  '..MMMM..',  //14
  '.MM..MM.',  //15  feet split (mid-stride)
];

const COLOR_MAP: Record<string, string> = {
  D: '#0a0a18',
  M: '#16172a',
  R: '#2a2b55',
  H: '#1f2040',
};

const FIGURE_PIXELS: [number, number, string, number?][] = FIG_GLYPHS.flatMap(
  (row, y) => row.split('').map((ch, x) =>
    COLOR_MAP[ch] ? [x, y, COLOR_MAP[ch]] as [number, number, string] : null
  ).filter((p): p is [number, number, string] => p !== null)
);
