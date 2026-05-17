import { useState } from 'react';
import type { Action, FullState } from '../game/reducer';
import { Hud } from './Hud';
import { Market } from './Market';
import { TravelModal } from './TravelModal';
import { BronxPanel } from './BronxPanel';
import { TRENCH_COAT_COST, TRENCH_COAT_BONUS } from '../game/data';

interface Props {
  state: FullState;
  dispatch: React.Dispatch<Action>;
}

export function GameScreen({ state, dispatch }: Props) {
  const [showTravel, setShowTravel] = useState(false);
  const [showBronx, setShowBronx] = useState(false);
  const inBronx = state.locationId === 'bronx';

  return (
    <div className="flex flex-col gap-2 px-2 py-2 h-full w-full max-w-md mx-auto overflow-hidden">
      <Hud state={state} />

      <div className="flex-1 overflow-y-auto scroll-y flex flex-col gap-2">
        <Market state={state} dispatch={dispatch} />

        <div className="pixel-box p-3 flex flex-col gap-2">
          <div className="pixel text-[10px] text-[var(--color-accent-2)] text-center">— ACTIONS —</div>
          <div className="grid grid-cols-2 gap-2">
            {inBronx && (
              <button className="pixel-btn pixel-btn-warn col-span-2" onClick={() => setShowBronx(true)}>
                BRONX: LOAN / BANK
              </button>
            )}
            <button
              className="pixel-btn"
              disabled={state.cash < TRENCH_COAT_COST}
              onClick={() => dispatch({ type: 'BUY_COAT' })}
            >
              COAT +{TRENCH_COAT_BONUS} (${TRENCH_COAT_COST})
            </button>
            <button className="pixel-btn pixel-btn-primary" onClick={() => setShowTravel(true)}>
              ▶ TRAVEL
            </button>
          </div>
        </div>

        <LogPanel state={state} />
      </div>

      {showTravel && <TravelModal state={state} dispatch={dispatch} onClose={() => setShowTravel(false)} />}
      {showBronx && <BronxPanel state={state} dispatch={dispatch} onClose={() => setShowBronx(false)} />}
    </div>
  );
}

function LogPanel({ state }: { state: FullState }) {
  const recent = state.log.slice(-8).reverse();
  return (
    <div className="pixel-box p-2 text-sm">
      <div className="pixel text-[9px] text-[var(--color-ink-dim)] mb-1">LOG</div>
      <div className="flex flex-col">
        {recent.map((l, i) => (
          <div key={i} className={i === 0 ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-dim)]'}>
            {'> '}{l}
          </div>
        ))}
      </div>
    </div>
  );
}
