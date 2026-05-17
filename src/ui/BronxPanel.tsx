import { useState } from 'react';
import type { Action, FullState } from '../game/reducer';
import { ModalBackdrop } from './TravelModal';
import { money } from './Format';

interface Props {
  state: FullState;
  dispatch: React.Dispatch<Action>;
  onClose: () => void;
}

type Tab = 'loan' | 'bank';

export function BronxPanel({ state, dispatch, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('loan');
  const [amount, setAmount] = useState('');
  const n = parseInt(amount, 10) || 0;

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="pixel-box p-4 w-full flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="pixel text-[12px] text-[var(--color-accent-2)]">— BRONX —</span>
          <button className="pixel text-xs text-[var(--color-ink-dim)]" onClick={onClose}>✕</button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button className={`pixel-btn ${tab === 'loan' ? 'pixel-btn-primary' : ''}`} onClick={() => setTab('loan')}>LOAN SHARK</button>
          <button className={`pixel-btn ${tab === 'bank' ? 'pixel-btn-success' : ''}`} onClick={() => setTab('bank')}>BANK</button>
        </div>

        {tab === 'loan' ? (
          <div className="flex flex-col gap-2">
            <Row label="DEBT" value={money(state.debt)} color="var(--color-danger)" />
            <Row label="CASH" value={money(state.cash)} />
            <div className="text-sm text-[var(--color-ink-dim)]">10% daily interest. Pay down ASAP.</div>
            <AmountRow value={amount} onChange={setAmount} max={Math.min(state.cash, state.debt)} />
            <button
              className="pixel-btn pixel-btn-primary"
              disabled={n <= 0 || n > Math.min(state.cash, state.debt)}
              onClick={() => { dispatch({ type: 'PAY_LOAN', amount: n }); setAmount(''); }}
            >
              PAY ${n}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Row label="BANK" value={money(state.bank)} color="var(--color-cyan)" />
            <Row label="CASH" value={money(state.cash)} />
            <div className="text-sm text-[var(--color-ink-dim)]">Earns 5% per day. Safe from muggers.</div>
            <AmountRow value={amount} onChange={setAmount} max={Math.max(state.cash, state.bank)} />
            <div className="grid grid-cols-2 gap-2">
              <button
                className="pixel-btn pixel-btn-success"
                disabled={n <= 0 || n > state.cash}
                onClick={() => { dispatch({ type: 'DEPOSIT', amount: n }); setAmount(''); }}
              >
                DEPOSIT ${n}
              </button>
              <button
                className="pixel-btn"
                disabled={n <= 0 || n > state.bank}
                onClick={() => { dispatch({ type: 'WITHDRAW', amount: n }); setAmount(''); }}
              >
                WITHDRAW ${n}
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="pixel text-[10px] text-[var(--color-ink-dim)]">{label}</span>
      <span className="num text-base" style={{ color }}>{value}</span>
    </div>
  );
}

function AmountRow({ value, onChange, max }: { value: string; onChange: (v: string) => void; max: number }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        placeholder="0"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="num bg-[var(--color-bg-2)] border-2 border-black text-[var(--color-ink)] flex-1 py-2 px-2 text-base"
      />
      <button className="pixel-btn" onClick={() => onChange(String(max))}>MAX</button>
    </div>
  );
}
