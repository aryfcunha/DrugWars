import type { Action, FullState } from '../game/reducer';
import { ModalBackdrop } from './TravelModal';

interface Props {
  state: FullState;
  dispatch: React.Dispatch<Action>;
}

export function CopFightScreen({ state, dispatch }: Props) {
  if (!state.fight) return null;
  return (
    <ModalBackdrop>
      <div className="pixel-box p-4 flex flex-col gap-3 bg-[var(--color-bg-0)]">
        <div className="pixel text-[12px] text-center text-[var(--color-danger)]">★ COP CHASE ★</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="COPS" value={state.fight.copsLeft} color="var(--color-danger)" />
          <Stat label="GUNS" value={state.guns} color="var(--color-cyan)" />
          <Stat label="HP" value={state.hp} color={state.hp < 30 ? 'var(--color-danger)' : 'var(--color-success)'} />
        </div>

        <div className="bg-[var(--color-bg-2)] border-2 border-black p-2 h-32 overflow-y-auto text-sm scroll-y">
          {state.fight.log.map((line, i) => (
            <div key={i} className={i === state.fight!.log.length - 1 ? 'text-[var(--color-accent-2)]' : 'text-[var(--color-ink-dim)]'}>
              {'> '}{line}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            className="pixel-btn pixel-btn-primary"
            disabled={state.guns === 0}
            onClick={() => dispatch({ type: 'FIGHT' })}
          >
            FIGHT
          </button>
          <button
            className="pixel-btn pixel-btn-warn"
            onClick={() => dispatch({ type: 'RUN' })}
          >
            RUN
          </button>
        </div>
        {state.guns === 0 && (
          <div className="text-sm text-[var(--color-ink-dim)] text-center">No gun — can only run.</div>
        )}
      </div>
    </ModalBackdrop>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="pixel-box p-2 flex flex-col items-center bg-[var(--color-bg-1)]">
      <div className="pixel text-[8px] text-[var(--color-ink-dim)]">{label}</div>
      <div className="num text-lg" style={{ color }}>{value}</div>
    </div>
  );
}
