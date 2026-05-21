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
  const [confirmRetire, setConfirmRetire] = useState(false);
  const inBronx = state.locationId === 'bronx';
  const isEndless = state.mode === 'endless';

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
            <button
              className="pixel-btn"
              disabled={state.cash < TRENCH_COAT_COST * 10}
              onClick={() => dispatch({ type: 'BUY_COAT', qty: 10 })}
            >
              COAT ×10 +{TRENCH_COAT_BONUS * 10} (${TRENCH_COAT_COST * 10})
            </button>
            <button
              className="pixel-btn"
              disabled={state.cash < TRENCH_COAT_COST * 100}
              onClick={() => dispatch({ type: 'BUY_COAT', qty: 100 })}
            >
              COAT ×100 +{TRENCH_COAT_BONUS * 100} (${(TRENCH_COAT_COST * 100).toLocaleString()})
            </button>
            {isEndless && (
              <button
                className="pixel-btn col-span-2"
                style={{ background: 'var(--color-bg-2)', color: 'var(--color-danger)' }}
                onClick={() => setConfirmRetire(true)}
              >
                ⚑ RETIRE (CASH OUT)
              </button>
            )}
          </div>
        </div>

        <LogPanel state={state} />
      </div>

      {showTravel && <TravelModal state={state} dispatch={dispatch} onClose={() => setShowTravel(false)} />}
      {showBronx && <BronxPanel state={state} dispatch={dispatch} onClose={() => setShowBronx(false)} />}
      {confirmRetire && (
        <RetireConfirm
          onCancel={() => setConfirmRetire(false)}
          onConfirm={() => { setConfirmRetire(false); dispatch({ type: 'RETIRE' }); }}
        />
      )}
    </div>
  );
}

function RetireConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md">
        <div className="pixel-box p-4 flex flex-col gap-3">
          <div className="pixel text-[12px] text-center text-[var(--color-accent-2)]">RETIRE?</div>
          <div className="text-base">
            End the run, submit your net worth, and call it a career. No going back.
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="pixel-btn" onClick={onCancel}>CANCEL</button>
            <button className="pixel-btn pixel-btn-primary" onClick={onConfirm}>RETIRE</button>
          </div>
        </div>
      </div>
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
