// 16-bit pixel art NYC 1984 skyline at night with a hooded trench-coat figure
// walking the empty sidewalk. Rendered as inline SVG with crisp edges so it
// scales sharply on any device.

export function Cityscape() {
  return (
    <svg
      viewBox="0 0 128 80"
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="crispEdges"
      style={{ width: '100%', height: 'auto', imageRendering: 'pixelated', display: 'block' }}
    >
      {/* ===== SKY ===== */}
      <rect x={0} y={0} width={128} height={80} fill="#0a0a14" />

      {/* Stars (1×1 dim pixels) */}
      {STARS.map(([x, y, c], i) => (
        <rect key={`s${i}`} x={x} y={y} width={1} height={1} fill={c} />
      ))}

      {/* Moon */}
      <rect x={102} y={6}  width={5} height={1} fill="#e8e6ff" />
      <rect x={101} y={7}  width={7} height={1} fill="#e8e6ff" />
      <rect x={101} y={8}  width={7} height={3} fill="#e8e6ff" />
      <rect x={101} y={11} width={7} height={1} fill="#e8e6ff" />
      <rect x={102} y={12} width={5} height={1} fill="#e8e6ff" />
      {/* Moon craters */}
      <rect x={103} y={8} width={1} height={1} fill="#8a86b8" />
      <rect x={105} y={10} width={2} height={1} fill="#8a86b8" />

      {/* ===== FAR SKYLINE (back buildings) ===== */}
      {FAR_BUILDINGS.map((b, i) => (
        <rect key={`fb${i}`} x={b[0]} y={b[1]} width={b[2]} height={b[3]} fill="#16172a" />
      ))}

      {/* Chrysler-style stepped crown at x=14..20 */}
      <rect x={15} y={16} width={4} height={2} fill="#16172a" />
      <rect x={16} y={14} width={2} height={2} fill="#16172a" />
      <rect x={16} y={12} width={1} height={2} fill="#16172a" />

      {/* Empire State antenna at x=55..59 */}
      <rect x={56} y={18} width={2} height={4} fill="#16172a" />
      <rect x={56} y={14} width={1} height={4} fill="#16172a" />
      <rect x={56} y={10} width={1} height={4} fill="#1f2040" />

      {/* WTC roof antenna hint */}
      <rect x={41} y={12} width={1} height={2} fill="#1f2040" />

      {/* Lit windows on far skyline */}
      {WINDOWS.map(([x, y, c], i) => (
        <rect key={`w${i}`} x={x} y={y} width={1} height={1} fill={c} />
      ))}

      {/* ===== MID-GROUND BUILDINGS ===== */}
      {MID_BUILDINGS.map((b, i) => (
        <rect key={`mb${i}`} x={b[0]} y={b[1]} width={b[2]} height={b[3]} fill="#1f2040" />
      ))}

      {/* Water tower on mid-ground building (x=18..22) */}
      <rect x={18} y={37} width={5} height={1} fill="#3a3a6e" />
      <rect x={19} y={34} width={3} height={3} fill="#1f2040" />
      <rect x={19} y={34} width={3} height={1} fill="#3a3a6e" />
      <rect x={20} y={31} width={1} height={3} fill="#3a3a6e" />

      {/* Fire escape vertical lines (x=88..92) */}
      <rect x={88} y={42} width={1} height={16} fill="#0a0a14" />
      <rect x={94} y={42} width={1} height={16} fill="#0a0a14" />
      <rect x={89} y={45} width={5} height={1} fill="#0a0a14" />
      <rect x={89} y={49} width={5} height={1} fill="#0a0a14" />
      <rect x={89} y={53} width={5} height={1} fill="#0a0a14" />

      {/* Mid-ground windows (warmer, fewer) */}
      {MID_WINDOWS.map(([x, y, c], i) => (
        <rect key={`mw${i}`} x={x} y={y} width={1} height={1} fill={c} />
      ))}

      {/* Neon sign — flickery red mark on mid-ground bldg */}
      <rect x={32} y={49} width={6} height={2} fill="#ff3864" />
      <rect x={32} y={51} width={6} height={1} fill="#b00033" />
      {/* Faint glow halo around neon */}
      <rect x={30} y={47} width={10} height={6} fill="#ff3864" opacity={0.12} />

      {/* ===== ROAD ===== */}
      <rect x={0} y={58} width={128} height={6} fill="#0a0a14" />
      {/* curb line */}
      <rect x={0} y={64} width={128} height={1} fill="#2a2b55" />
      {/* faint road dashes (yellow, far perspective) */}
      <rect x={42} y={61} width={4} height={1} fill="#3a2a05" />
      <rect x={62} y={61} width={4} height={1} fill="#3a2a05" />
      <rect x={82} y={61} width={4} height={1} fill="#3a2a05" />

      {/* ===== SIDEWALK ===== */}
      <rect x={0} y={65} width={128} height={15} fill="#1a1a30" />
      {/* sidewalk cracks */}
      <rect x={12} y={70} width={4} height={1} fill="#0a0a14" />
      <rect x={42} y={74} width={3} height={1} fill="#0a0a14" />
      <rect x={92} y={72} width={5} height={1} fill="#0a0a14" />

      {/* Manhole circle approx */}
      <rect x={22} y={75} width={6} height={3} fill="#0a0a14" />
      <rect x={23} y={74} width={4} height={1} fill="#0a0a14" />
      <rect x={23} y={78} width={4} height={1} fill="#0a0a14" />
      {/* steam from manhole */}
      <rect x={24} y={72} width={2} height={1} fill="#3a3a6e" opacity={0.5} />
      <rect x={23} y={71} width={4} height={1} fill="#3a3a6e" opacity={0.3} />
      <rect x={25} y={70} width={2} height={1} fill="#3a3a6e" opacity={0.2} />

      {/* ===== STREETLAMP (right side) ===== */}
      {/* Glow halo (back-most so figure rim-light reads on top) */}
      <rect x={92} y={42} width={14} height={14} fill="#ffcb05" opacity={0.06} />
      <rect x={94} y={44} width={10} height={10} fill="#ffcb05" opacity={0.10} />
      <rect x={96} y={46} width={6} height={6} fill="#ffcb05" opacity={0.15} />
      {/* Pole */}
      <rect x={99} y={50} width={1} height={20} fill="#2a2b55" />
      {/* Lamp arm */}
      <rect x={97} y={49} width={3} height={1} fill="#2a2b55" />
      {/* Lamp head */}
      <rect x={96} y={49} width={1} height={2} fill="#3a3a6e" />
      <rect x={97} y={50} width={1} height={2} fill="#ffcb05" />
      {/* Base */}
      <rect x={98} y={70} width={3} height={1} fill="#2a2b55" />

      {/* ===== FIGURE (hooded trench coat, back to viewer) ===== */}
      {FIGURE_PIXELS.map(([x, y, c], i) => (
        <rect
          key={`fg${i}`}
          x={FIGURE_OFFSET_X + x}
          y={FIGURE_OFFSET_Y + y}
          width={1}
          height={1}
          fill={c}
        />
      ))}

      {/* Tiny puff of breath/steam in front of hood */}
      <rect x={FIGURE_OFFSET_X + 8} y={FIGURE_OFFSET_Y + 4} width={2} height={1} fill="#4a4b8a" opacity={0.5} />
      <rect x={FIGURE_OFFSET_X + 9} y={FIGURE_OFFSET_Y + 5} width={1} height={1} fill="#4a4b8a" opacity={0.3} />

      {/* Faint fog band low across the street */}
      <rect x={0} y={66} width={128} height={2} fill="#3a3a6e" opacity={0.08} />
    </svg>
  );
}

// ---- DATA ----

// [x, y, color]
const STARS: [number, number, string][] = [
  [6, 4, '#8a86b8'], [12, 8, '#e8e6ff'], [22, 3, '#8a86b8'], [29, 9, '#8a86b8'],
  [37, 5, '#e8e6ff'], [48, 4, '#8a86b8'], [56, 7, '#8a86b8'], [66, 3, '#e8e6ff'],
  [74, 9, '#8a86b8'], [82, 4, '#8a86b8'], [88, 7, '#e8e6ff'], [95, 3, '#8a86b8'],
  [115, 4, '#8a86b8'], [120, 9, '#8a86b8'], [125, 6, '#e8e6ff'], [3, 12, '#8a86b8'],
  [16, 14, '#8a86b8'], [25, 13, '#e8e6ff'], [44, 12, '#8a86b8'], [70, 14, '#8a86b8'],
  [90, 13, '#e8e6ff'], [110, 14, '#8a86b8'], [122, 15, '#8a86b8'],
];

// [x, y, width, height]
const FAR_BUILDINGS: [number, number, number, number][] = [
  [0,  35, 4,  23], // edge
  [4,  32, 5,  26],
  [10, 28, 4,  30],
  [14, 18, 6,  40], // Chrysler-style base
  [21, 30, 6,  28],
  [28, 24, 6,  34],
  [35, 31, 4,  27],
  [40, 14, 4,  44], // WTC north
  [45, 14, 4,  44], // WTC south
  [50, 28, 4,  30],
  [55, 22, 5,  36], // Empire State base
  [61, 30, 5,  28],
  [67, 26, 5,  32],
  [73, 24, 6,  34],
  [80, 28, 5,  30],
  [86, 23, 5,  35],
  [92, 30, 5,  28],
  [98, 22, 4,  36],
  [103,28, 5,  30],
  [109,25, 5,  33],
  [115,29, 5,  29],
  [121,24, 7,  34],
];

// Lit windows on far skyline (warm + cool mix)
const WINDOWS: [number, number, string][] = [
  // edge bldg [0..4]
  [1, 38, '#ffcb05'], [2, 42, '#4ad6ff'], [1, 50, '#ffcb05'],
  // [4..9]
  [5, 36, '#ffcb05'], [7, 40, '#ffcb05'], [5, 48, '#4ad6ff'], [7, 52, '#ffcb05'],
  // [10..14]
  [11, 32, '#ffcb05'], [12, 38, '#4ad6ff'], [11, 44, '#ffcb05'], [12, 50, '#ffcb05'], [11, 54, '#ffcb05'],
  // Chrysler [14..20]
  [15, 22, '#ffcb05'], [17, 26, '#ffcb05'], [15, 32, '#4ad6ff'], [18, 36, '#ffcb05'],
  [15, 42, '#ffcb05'], [18, 48, '#ffcb05'], [16, 52, '#4ad6ff'],
  // [21..27]
  [22, 34, '#ffcb05'], [24, 38, '#ffcb05'], [26, 42, '#4ad6ff'], [22, 48, '#ffcb05'],
  [25, 52, '#ffcb05'],
  // [28..34]
  [29, 28, '#ffcb05'], [31, 32, '#4ad6ff'], [33, 36, '#ffcb05'], [29, 42, '#ffcb05'],
  [32, 46, '#ffcb05'], [29, 52, '#ffcb05'], [33, 54, '#4ad6ff'],
  // [35..39]
  [36, 34, '#ffcb05'], [37, 40, '#4ad6ff'], [36, 48, '#ffcb05'],
  // WTC north [40..44]
  [41, 18, '#ffcb05'], [42, 24, '#4ad6ff'], [41, 30, '#ffcb05'], [42, 36, '#ffcb05'],
  [41, 42, '#ffcb05'], [42, 48, '#4ad6ff'], [41, 54, '#ffcb05'],
  // WTC south [45..49]
  [46, 20, '#ffcb05'], [47, 26, '#ffcb05'], [46, 32, '#4ad6ff'], [47, 38, '#ffcb05'],
  [46, 44, '#ffcb05'], [47, 50, '#ffcb05'], [46, 54, '#4ad6ff'],
  // [50..54]
  [51, 32, '#ffcb05'], [52, 38, '#4ad6ff'], [51, 46, '#ffcb05'],
  // Empire [55..60]
  [56, 26, '#ffcb05'], [58, 30, '#ffcb05'], [56, 36, '#4ad6ff'], [58, 42, '#ffcb05'],
  [56, 48, '#ffcb05'], [58, 52, '#ffcb05'],
  // [61..66]
  [62, 32, '#ffcb05'], [64, 38, '#4ad6ff'], [62, 48, '#ffcb05'],
  // [67..72]
  [68, 28, '#ffcb05'], [70, 32, '#ffcb05'], [69, 38, '#4ad6ff'], [71, 44, '#ffcb05'],
  [68, 50, '#ffcb05'],
  // [73..79]
  [74, 26, '#4ad6ff'], [76, 30, '#ffcb05'], [78, 36, '#ffcb05'], [74, 42, '#ffcb05'],
  [76, 48, '#ffcb05'], [78, 54, '#4ad6ff'],
  // [80..85]
  [81, 30, '#ffcb05'], [83, 36, '#4ad6ff'], [81, 44, '#ffcb05'], [83, 50, '#ffcb05'],
  // [86..91]
  [87, 24, '#ffcb05'], [89, 28, '#ffcb05'], [87, 34, '#4ad6ff'], [89, 40, '#ffcb05'],
  [87, 46, '#ffcb05'], [89, 52, '#ffcb05'],
  // [92..97]
  [93, 32, '#4ad6ff'], [95, 38, '#ffcb05'], [93, 46, '#ffcb05'], [95, 52, '#ffcb05'],
  // [98..102]
  [99, 24, '#ffcb05'], [100, 30, '#4ad6ff'], [99, 38, '#ffcb05'], [100, 46, '#ffcb05'],
  [99, 52, '#ffcb05'],
  // [103..108]
  [104, 30, '#ffcb05'], [106, 36, '#4ad6ff'], [104, 44, '#ffcb05'], [106, 50, '#ffcb05'],
  // [109..114]
  [110, 28, '#ffcb05'], [112, 32, '#ffcb05'], [110, 40, '#4ad6ff'], [112, 46, '#ffcb05'],
  [110, 52, '#ffcb05'],
  // [115..120]
  [116, 32, '#ffcb05'], [118, 38, '#4ad6ff'], [116, 46, '#ffcb05'], [118, 52, '#ffcb05'],
  // [121..127]
  [122, 28, '#ffcb05'], [124, 34, '#ffcb05'], [126, 40, '#4ad6ff'], [122, 46, '#ffcb05'],
  [124, 52, '#ffcb05'], [126, 56, '#ffcb05'],
];

// Mid-ground buildings (closer, slightly lighter)
const MID_BUILDINGS: [number, number, number, number][] = [
  [0,  42, 12, 16],
  [14, 38, 14, 20],
  [30, 42, 18, 16],  // hosts neon sign
  [50, 40, 14, 18],
  [66, 44, 16, 14],
  [84, 38, 14, 20],  // hosts fire escape
  [102,40, 16, 18],
  [120,44, 8,  14],
];

const MID_WINDOWS: [number, number, string][] = [
  [3, 46, '#ffcb05'], [6, 50, '#ffcb05'], [9, 54, '#4ad6ff'],
  [16, 44, '#ffcb05'], [20, 48, '#ffcb05'], [24, 52, '#ffcb05'],
  [33, 46, '#ffcb05'], [44, 48, '#4ad6ff'], [42, 54, '#ffcb05'],
  [52, 46, '#ffcb05'], [56, 50, '#ffcb05'], [60, 54, '#4ad6ff'],
  [68, 48, '#ffcb05'], [72, 52, '#ffcb05'], [78, 50, '#ffcb05'],
  [86, 44, '#ffcb05'], [90, 48, '#ffcb05'], [92, 54, '#ffcb05'],
  [105,46, '#ffcb05'], [110,52, '#ffcb05'], [114,48, '#4ad6ff'],
  [122,48, '#ffcb05'], [125,52, '#ffcb05'],
];

// ===== FIGURE =====
// 10 wide × 20 tall. Drawn with the figure facing AWAY from viewer (we see
// the back of a hooded trench coat). Right side has subtle rim light from
// the streetlamp. Pixel data uses letters for color buckets:
//   D = #0a0a14  (deepest shadow, inside-hood)
//   M = #16172a  (silhouette body)
//   R = #2a2b55  (rim light from lamp on right side)
//   H = #1f2040  (coat midtone)
const FIGURE_OFFSET_X = 50;
const FIGURE_OFFSET_Y = 47;

const FIG_GLYPHS = [
  '....MM....',  // 0
  '...MMRR...',  // 1
  '..MMMMMR..',  // 2  hood
  '..MDDDDR..',  // 3
  '..MDDDDR..',  // 4  inside hood (face hidden in shadow)
  '..MMMMMR..',  // 5
  '.MMMMMMMR.',  // 6  shoulders
  '.MHHHHHHR.',  // 7  collar
  '.MHHHHHHR.',  // 8  coat
  '.MHHHHHHR.',  // 9
  '.MHHHHHHR.',  //10
  '.MHHHHHHR.',  //11
  '.MHHHHHHR.',  //12
  '.MMHHHHMR.',  //13  cinched waist
  '.MMHHHHMR.',  //14
  '.MMMHHMMR.',  //15  hem
  '..MM..MR..',  //16  legs
  '..MM..MR..',  //17
  '..MM..MR..',  //18
  '.MMM..MMM.',  //19  shoes
];

const COLOR_MAP: Record<string, string> = {
  D: '#0a0a14',
  M: '#16172a',
  R: '#2a2b55',
  H: '#1f2040',
};

const FIGURE_PIXELS: [number, number, string][] = FIG_GLYPHS.flatMap(
  (row, y) => row.split('').map((ch, x) =>
    COLOR_MAP[ch] ? [x, y, COLOR_MAP[ch]] as [number, number, string] : null
  ).filter((p): p is [number, number, string] => p !== null)
);
