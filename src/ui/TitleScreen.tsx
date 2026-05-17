import { useState } from 'react';

interface Props {
  onStart: (days: number) => void;
  onLeaderboard: () => void;
}

const DAY_OPTIONS = [15, 30, 60, 90];

export function TitleScreen({ onStart, onLeaderboard }: Props) {
  const [days, setDays] = useState(30);

  return (
    <div className="flex flex-col items-center justify-between h-full w-full px-4 py-8 max-w-md mx-auto">
      <div className="flex flex-col items-center gap-2 mt-2">
        <div className="pixel text-3xl text-[var(--color-accent)] text-center leading-tight crt">
          DRUG<br/>WARS
        </div>
        <div className="pixel text-[10px] text-[var(--color-ink-dim)] tracking-widest mt-2">
          STREETS OF NYC, 1984
        </div>
      </div>

      <div className="pixel-box p-4 w-full">
        <div className="pixel text-xs text-[var(--color-accent-2)] mb-3">SKULL FROM THE CALCULATOR</div>
        <Skull />
      </div>

      <div className="w-full flex flex-col gap-3">
        <div className="pixel text-[10px] text-[var(--color-ink-dim)] text-center">SELECT TOUR LENGTH</div>
        <div className="grid grid-cols-4 gap-2">
          {DAY_OPTIONS.map(d => (
            <button
              key={d}
              className={`pixel-btn ${days === d ? 'pixel-btn-warn' : ''}`}
              onClick={() => setDays(d)}
            >
              {d}D
            </button>
          ))}
        </div>

        <button className="pixel-btn pixel-btn-primary mt-2" onClick={() => onStart(days)}>
          ▶ START GAME
        </button>
        <button className="pixel-btn" onClick={onLeaderboard}>
          🏆 LEADERBOARD
        </button>
      </div>

      <div className="pixel text-[8px] text-[var(--color-ink-dim)] tracking-widest">
        © A PARODY GAME — NOT FOR PROFIT
      </div>
    </div>
  );
}

function Skull() {
  // Big pixel skull using a CSS grid of squares
  const pattern = [
    '0011111111100',
    '0111111111110',
    '1111111111111',
    '1100111110011',
    '1100110110011',
    '1111111111111',
    '1111100111111',
    '0111111111110',
    '0011111111100',
    '0010111110100',
    '0000010100000',
  ];
  return (
    <div className="mx-auto grid" style={{ gridTemplateColumns: 'repeat(13, 14px)' }}>
      {pattern.flatMap((row, y) =>
        row.split('').map((c, x) => (
          <div
            key={`${x}-${y}`}
            style={{
              width: 14, height: 14,
              background: c === '1' ? '#e8e6ff' : 'transparent',
              boxShadow: c === '1' ? 'inset -2px -2px 0 0 #8a86b8' : 'none',
            }}
          />
        ))
      )}
    </div>
  );
}
