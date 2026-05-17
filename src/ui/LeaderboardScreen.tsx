import { useEffect, useState } from 'react';
import { SUPABASE_CONFIGURED, fetchTopScores, type LeaderEntry } from '../lib/supabase';
import { money } from './Format';

interface Props {
  onBack: () => void;
}

export function LeaderboardScreen({ onBack }: Props) {
  const [entries, setEntries] = useState<LeaderEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) {
      setLoading(false);
      return;
    }
    fetchTopScores(50).then(rows => {
      setEntries(rows);
      setLoading(false);
    });
  }, []);

  return (
    <div className="flex flex-col items-center h-full w-full px-4 py-6 max-w-md mx-auto gap-3">
      <div className="pixel text-xl text-[var(--color-accent-2)] crt">★ HALL OF FAME ★</div>

      <div className="pixel-box w-full p-3 flex flex-col gap-1 flex-1 overflow-hidden">
        {!SUPABASE_CONFIGURED ? (
          <div className="text-sm text-[var(--color-ink-dim)] text-center my-6">
            Leaderboard not configured. Set VITE_SUPABASE_URL &amp; VITE_SUPABASE_ANON_KEY.
          </div>
        ) : loading ? (
          <div className="text-center my-6 text-[var(--color-ink-dim)] text-sm">
            <span className="blink">LOADING<span className="blink">_</span></span>
          </div>
        ) : !entries || entries.length === 0 ? (
          <div className="text-sm text-[var(--color-ink-dim)] text-center my-6">No scores yet. Be the first.</div>
        ) : (
          <div className="scroll-y flex-1 flex flex-col gap-1">
            {entries.map((e, i) => (
              <div key={e.id ?? i} className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-[var(--color-border)]/30">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`pixel text-[9px] w-7 ${i === 0 ? 'text-[var(--color-accent-2)]' : 'text-[var(--color-ink-dim)]'}`}>
                    #{String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="num truncate uppercase">{e.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="pixel text-[8px] text-[var(--color-ink-dim)]">{e.days}D</span>
                  <span className="num text-sm" style={{ color: e.net_worth >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {money(e.net_worth)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="pixel-btn pixel-btn-primary w-full" onClick={onBack}>BACK</button>
    </div>
  );
}
