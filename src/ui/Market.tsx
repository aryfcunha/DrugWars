import { useState } from 'react';
import type { FullState, Action } from '../game/reducer';
import { DRUGS, type DrugId } from '../game/data';
import { inventoryFree } from '../game/state';
import { money, shortMoney } from './Format';

interface Props {
  state: FullState;
  dispatch: React.Dispatch<Action>;
}

export function Market({ state, dispatch }: Props) {
  const [selected, setSelected] = useState<DrugId | null>(null);

  return (
    <div className="pixel-box w-full p-3 flex flex-col gap-2">
      <div className="pixel text-[10px] text-[var(--color-accent-2)] text-center mb-1">— MARKET —</div>
      <div className="grid grid-cols-1 gap-1.5">
        {DRUGS.map(d => {
          const price = state.market.prices[d.id];
          const owned = state.inv.drugs[d.id];
          const absent = price == null;
          const isSelected = selected === d.id;
          return (
            <button
              key={d.id}
              disabled={absent && owned === 0}
              onClick={() => setSelected(isSelected ? null : d.id)}
              className={`flex items-center justify-between gap-2 px-3 py-2 border-2 border-black ${isSelected ? 'bg-[var(--color-bg-2)]' : 'bg-[var(--color-bg-1)]'} ${absent && owned === 0 ? 'opacity-30' : ''}`}
              style={{
                boxShadow: isSelected
                  ? 'inset 2px 2px 0 0 var(--color-accent), inset -2px -2px 0 0 #000'
                  : 'inset 2px 2px 0 0 #4a4b8a, inset -2px -2px 0 0 #0a0a1a',
              }}
            >
              <div className="flex items-center gap-2">
                <span style={{ color: d.color, fontSize: 18 }}>{d.glyph}</span>
                <span className="pixel text-[10px]">{d.name.toUpperCase()}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="num text-sm" style={{ color: absent ? 'var(--color-ink-dim)' : 'var(--color-success)' }}>
                  {absent ? '——' : shortMoney(price!)}
                </span>
                <span className="num text-sm text-[var(--color-ink-dim)] min-w-[2ch] text-right">{owned}</span>
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <TradePanel
          drug={selected}
          state={state}
          dispatch={dispatch}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function TradePanel({ drug, state, dispatch, onClose }: { drug: DrugId; state: FullState; dispatch: React.Dispatch<Action>; onClose: () => void }) {
  const [qty, setQty] = useState(1);
  const drugInfo = DRUGS.find(d => d.id === drug)!;
  const price = state.market.prices[drug];
  const owned = state.inv.drugs[drug];
  const free = inventoryFree(state);
  const maxBuy = price ? Math.min(free, Math.floor(state.cash / price)) : 0;
  const maxSell = owned;

  const canBuy = price != null && qty > 0 && qty <= maxBuy;
  const canSell = qty > 0 && qty <= maxSell;

  return (
    <div className="pixel-box p-3 mt-2 flex flex-col gap-2 bg-[var(--color-bg-0)]">
      <div className="flex items-center justify-between">
        <span className="pixel text-[10px]" style={{ color: drugInfo.color }}>{drugInfo.name.toUpperCase()}</span>
        <button className="pixel text-[10px] text-[var(--color-ink-dim)]" onClick={onClose}>✕</button>
      </div>
      <div className="text-sm flex justify-between text-[var(--color-ink-dim)]">
        <span>PRICE: {price ? money(price) : '——'}</span>
        <span>OWN: {owned}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <button className="pixel-btn" onClick={() => setQty(Math.max(1, qty - 10))}>-10</button>
        <button className="pixel-btn" onClick={() => setQty(Math.max(1, qty - 1))}>-1</button>
        <input
          type="number"
          inputMode="numeric"
          value={qty}
          min={1}
          onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
          className="num text-center bg-[var(--color-bg-2)] border-2 border-black text-[var(--color-ink)] w-20 py-2"
        />
        <button className="pixel-btn" onClick={() => setQty(qty + 1)}>+1</button>
        <button className="pixel-btn" onClick={() => setQty(qty + 10)}>+10</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button className="pixel-btn" onClick={() => setQty(maxBuy)} disabled={maxBuy <= 0}>MAX BUY ({maxBuy})</button>
        <button className="pixel-btn" onClick={() => setQty(maxSell)} disabled={maxSell <= 0}>MAX SELL ({maxSell})</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          className="pixel-btn pixel-btn-success"
          disabled={!canBuy}
          onClick={() => { dispatch({ type: 'BUY', drug, qty }); setQty(1); }}
        >BUY</button>
        <button
          className="pixel-btn pixel-btn-primary"
          disabled={!canSell}
          onClick={() => { dispatch({ type: 'SELL', drug, qty }); setQty(1); }}
        >SELL</button>
      </div>
    </div>
  );
}
