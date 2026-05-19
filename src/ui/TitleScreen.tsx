import { useState } from 'react';
import { Cityscape } from './Cityscape';
import type { GameMode } from '../game/state';

interface Props {
  onStart: (mode: GameMode, days: number) => void;
  onLeaderboard: () => void;
}

type TourOption = { label: string; days: number; mode: GameMode };

const TOUR_OPTIONS: TourOption[] = [
  { label: '15D',  days: 15, mode: 'fixed' },
  { label: '30D',  days: 30, mode: 'fixed' },
  { label: '60D',  days: 60, mode: 'fixed' },
  { label: '90D',  days: 90, mode: 'fixed' },
  { label: '∞',    days: 0,  mode: 'endless' },
];

export function TitleScreen({ onStart, onLeaderboard }: Props) {
  const [selected, setSelected] = useState<TourOption>(TOUR_OPTIONS[1]);

  return (
    <div className="flex flex-col items-center justify-between h-full w-full px-4 py-6 max-w-md mx-auto gap-3">

      {/* Title block */}
      <div className="flex flex-col items-center gap-1 mt-2">
        <div
          className="pixel text-3xl text-center leading-tight crt"
          style={{ color: 'var(--color-accent)' }}
        >
          DRUG<br />WARS
        </div>
        <div className="pixel text-[9px] tracking-widest mt-1" style={{ color: 'var(--color-amber)' }}>
          ★ NYC 1984 ★
        </div>
        <div className="pixel text-[8px] tracking-widest" style={{ color: 'var(--color-ink-dim)' }}>
          STREETS OF NEW YORK CITY
        </div>
      </div>

      {/* Cityscape art panel */}
      <div className="pixel-box w-full overflow-hidden" style={{ padding: 3 }}>
        <Cityscape />
      </div>

      {/* Game config */}
      <div className="w-full flex flex-col gap-3">
        <div className="pixel text-[10px] text-center" style={{ color: 'var(--color-ink-dim)' }}>
          {selected.mode === 'endless'
            ? '— ENDLESS MODE: DIE OR RETIRE —'
            : '— SELECT TOUR LENGTH —'}
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {TOUR_OPTIONS.map(opt => (
            <button
              key={opt.label}
              className={`pixel-btn ${selected.label === opt.label ? 'pixel-btn-warn' : ''}`}
              style={{ fontSize: 10, padding: '12px 4px' }}
              onClick={() => setSelected(opt)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          className="pixel-btn pixel-btn-primary mt-1"
          onClick={() => onStart(selected.mode, selected.days)}
        >
          ▶ START GAME
        </button>
        <button className="pixel-btn" onClick={onLeaderboard}>
          🏆 HALL OF FAME
        </button>
      </div>

      {/* Footer */}
      <div className="flex flex-col items-center gap-0.5">
        <div className="pixel text-[7px]" style={{ color: 'var(--color-ink-dim)' }}>
          © A PARODY GAME — NOT FOR PROFIT
        </div>
        <div className="pixel text-[7px]" style={{ color: 'var(--color-border)' }}>
          BUY LOW · SELL HIGH · DON'T GET CAUGHT
        </div>
      </div>
    </div>
  );
}
