import type { FullState } from '../game/reducer';
import { inventoryUsed } from '../game/state';
import { LOCATION_BY_ID } from '../game/data';
import { money } from './Format';

interface Props {
  state: FullState;
}

export function Hud({ state }: Props) {
  const used = inventoryUsed(state);
  const dayLabel = state.mode === 'endless' ? `${state.day} ∞` : `${state.day} / ${state.totalDays}`;
  return (
    <div className="pixel-box w-full p-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
      <Row label="DAY" value={dayLabel} accent />
      <Row label="LOC" value={LOCATION_BY_ID[state.locationId].name.toUpperCase()} accent />
      <Row label="CASH" value={money(state.cash)} color="var(--color-success)" />
      <Row label="DEBT" value={money(state.debt)} color="var(--color-danger)" />
      <Row label="BANK" value={money(state.bank)} color="var(--color-cyan)" />
      <Row label="HP" value={`${state.hp}/100`} color={state.hp < 30 ? 'var(--color-danger)' : 'var(--color-ink)'} />
      <Row label="GUNS" value={String(state.guns)} />
      <Row label="COAT" value={`${used}/${state.capacity}`} color={used >= state.capacity ? 'var(--color-danger)' : 'var(--color-ink)'} />
    </div>
  );
}

function Row({ label, value, color, accent }: { label: string; value: string; color?: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className={`pixel text-[9px] ${accent ? 'text-[var(--color-accent-2)]' : 'text-[var(--color-ink-dim)]'}`}>{label}</span>
      <span className="num truncate text-right" style={{ color }}>{value}</span>
    </div>
  );
}
