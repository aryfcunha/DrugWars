import type { Action, FullState } from '../game/reducer';
import { ModalBackdrop } from './TravelModal';

interface Props {
  state: FullState;
  dispatch: React.Dispatch<Action>;
}

export function EventModal({ state, dispatch }: Props) {
  const ev = state.pendingEventGenerated;
  if (!ev) return null;
  const hasOffer = !!ev.offer;
  const cost = -(ev.offer?.accept.cashDelta ?? 0);
  const canAfford = cost <= state.cash;

  const isCop = !!ev.startCopFight;
  return (
    <ModalBackdrop>
      <div className={`pixel-box p-4 flex flex-col gap-3 ${isCop ? 'shake' : ''}`}>
        <div className="pixel text-[12px] text-center" style={{ color: isCop ? 'var(--color-danger)' : 'var(--color-accent-2)' }}>
          ⚠ {ev.title} ⚠
        </div>
        <div className="text-base leading-tight">{ev.message}</div>
        {hasOffer ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              className="pixel-btn pixel-btn-success"
              disabled={!canAfford}
              onClick={() => dispatch({ type: 'EVENT_ACCEPT_OFFER' })}
            >{ev.offer!.label}</button>
            <button
              className="pixel-btn"
              onClick={() => dispatch({ type: 'EVENT_DECLINE_OFFER' })}
            >PASS</button>
          </div>
        ) : (
          <button className="pixel-btn pixel-btn-primary" onClick={() => dispatch({ type: 'EVENT_OK' })}>
            {isCop ? 'FACE THEM' : 'OK'}
          </button>
        )}
      </div>
    </ModalBackdrop>
  );
}
