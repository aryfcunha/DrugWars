import { useState } from 'react';
import { Cityscape } from './Cityscape';

interface Props {
  onStart: (days: number) => void;
  onLeaderboard: () => void;
}

const DAY_OPTIONS = [15, 30, 60, 90];

export function TitleScreen({ onStart, onLeaderboard }: Props) {
  const [days, setDays] = useState(30);

  return (
    <div className="flex flex-col items-center justify-between h-full w-full px-4 py-6 max-w-md mx-auto gap-3">
      <div className="flex flex-col items-center gap-1 mt-2">
        <div className="pixel text-3xl text-[var(--color-accent)] text-center leading-tight crt">
          DRUG<br/>WARS
        </div>
        <div className="pixel text-[10px] text-[var(--color-ink-dim)] tracking-widest mt-2">
          STREETS OF NYC, 1984
        </div>
      </div>

      <div className="pixel-box w-full overflow-hidden" style={{ padding: 4 }}>
        <Cityscape />
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
