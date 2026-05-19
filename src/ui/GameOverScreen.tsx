import { useEffect, useState } from 'react';
import type { Action, FullState } from '../game/reducer';
import { netWorth } from '../game/state';
import { money } from './Format';
import { SUPABASE_CONFIGURED, submitScore } from '../lib/supabase';

interface Props {
  state: FullState;
  dispatch: React.Dispatch<Action>;
}

export function GameOverScreen({ state, dispatch }: Props) {
  const score = netWorth(state);
  const died = state.hp <= 0;
  const [name, setName] = useState(() => localStorage.getItem('dw_name') ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (name) localStorage.setItem('dw_name', name);
  }, [name]);

  // For endless mode, days = days survived. For fixed, days = tour length bucket.
  const submittedDays = state.mode === 'endless' ? Math.max(1, state.day) : state.totalDays;

  const onSubmit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setErr(null);
    const res = await submitScore({
      name: name.trim(),
      net_worth: score,
      days: submittedDays,
      mode: state.mode,
    });
    setSubmitting(false);
    if (res.ok) setSubmitted(true);
    else setErr(res.error ?? 'Unknown error');
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full px-4 py-6 max-w-md mx-auto gap-4">
      <div className="pixel text-2xl text-center text-[var(--color-accent)] crt">
        {died ? '☠ YOU DIED ☠' : '— GAME OVER —'}
      </div>

      <div className="pixel-box w-full p-4 flex flex-col gap-2">
        <Row
          label={state.mode === 'endless' ? 'SURVIVED' : 'DAYS'}
          value={state.mode === 'endless' ? `${state.day} DAYS` : `${Math.min(state.day, state.totalDays)} / ${state.totalDays}`}
        />
        <Row label="MODE" value={state.mode === 'endless' ? 'ENDLESS' : `${state.totalDays}-DAY`} color="var(--color-accent-2)" />
        <Row label="CASH" value={money(state.cash)} />
        <Row label="BANK" value={money(state.bank)} />
        <Row label="DEBT" value={money(state.debt)} color="var(--color-danger)" />
        <div className="border-t border-[var(--color-border)] my-1" />
        <Row label="NET WORTH" value={money(score)} color={score >= 0 ? 'var(--color-success)' : 'var(--color-danger)'} big />
      </div>

      {SUPABASE_CONFIGURED ? (
        <div className="pixel-box w-full p-3 flex flex-col gap-2">
          <div className="pixel text-[10px] text-[var(--color-accent-2)]">SUBMIT TO HALL OF FAME</div>
          <div className="flex gap-2">
            <input
              type="text"
              maxLength={16}
              value={name}
              onChange={e => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
              placeholder="YOUR NAME"
              disabled={submitted}
              className="num bg-[var(--color-bg-2)] border-2 border-black text-[var(--color-ink)] flex-1 py-2 px-2 uppercase tracking-widest"
            />
            <button
              className="pixel-btn pixel-btn-success"
              disabled={!name.trim() || submitted || submitting}
              onClick={onSubmit}
            >
              {submitted ? 'DONE ✓' : submitting ? '...' : 'SAVE'}
            </button>
          </div>
          {err && <div className="text-sm text-[var(--color-danger)]">{err}</div>}
        </div>
      ) : (
        <div className="text-sm text-[var(--color-ink-dim)] text-center">Hall of Fame offline (env not configured).</div>
      )}

      <div className="grid grid-cols-2 gap-2 w-full">
        <button className="pixel-btn pixel-btn-primary" onClick={() => dispatch({ type: 'BACK_TO_TITLE' })}>NEW GAME</button>
        <button className="pixel-btn" onClick={() => dispatch({ type: 'TO_LEADERBOARD' })}>🏆 HALL OF FAME</button>
      </div>
    </div>
  );
}

function Row({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className={`pixel text-[10px] ${big ? 'text-[var(--color-accent-2)]' : 'text-[var(--color-ink-dim)]'}`}>{label}</span>
      <span className={`num ${big ? 'text-xl' : 'text-base'}`} style={{ color }}>{value}</span>
    </div>
  );
}
