export function money(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-US');
  return n < 0 ? `-$${s}` : `$${s}`;
}

export function shortMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `$${(n / 1_000).toFixed(1)}K`;
  return money(n);
}
