import type { Action, FullState } from '../game/reducer';
import { LOCATIONS } from '../game/data';

interface Props {
  state: FullState;
  dispatch: React.Dispatch<Action>;
  onClose: () => void;
}

export function TravelModal({ state, dispatch, onClose }: Props) {
  return (
    <ModalBackdrop onClose={onClose}>
      <div className="pixel-box p-4 w-full max-w-md flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="pixel text-[12px] text-[var(--color-accent-2)]">SUBWAY</span>
          <button className="pixel text-xs text-[var(--color-ink-dim)]" onClick={onClose}>✕</button>
        </div>
        <div className="text-sm text-[var(--color-ink-dim)]">Travelling advances 1 day. Debt grows 10%.</div>
        <div className="grid grid-cols-2 gap-2">
          {LOCATIONS.map(loc => (
            <button
              key={loc.id}
              disabled={loc.id === state.locationId}
              className={`pixel-btn ${loc.id === state.locationId ? '' : 'pixel-btn-primary'}`}
              onClick={() => { dispatch({ type: 'TRAVEL', locationId: loc.id }); onClose(); }}
            >
              {loc.name.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </ModalBackdrop>
  );
}

export function ModalBackdrop({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md">
        {children}
      </div>
    </div>
  );
}
