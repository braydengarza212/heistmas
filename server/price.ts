/** SOL→USD price for showing the pot in dollars. Optional: failures just hide the dollar figure. */
export function startPriceFeed(url: string, onPrice: (usd: number | null) => void, log: (m: string) => void) {
  if (!url) return () => {};
  let warned = false;
  const run = async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const usd = findPrice(await res.json());
      if (usd === null) throw new Error('no price in response');
      onPrice(usd);
      warned = false;
    } catch (e) {
      if (!warned) log(`price: unavailable (${(e as Error).message}); the pot is shown in SOL only`);
      warned = true;
      onPrice(null);
    }
  };
  void run();
  const t = setInterval(run, 60_000);
  return () => clearInterval(t);
}

/** Accepts Jupiter's `{ <mint>: { usdPrice } }`, CoinGecko's `{ solana: { usd } }` or `{ price }`. */
function findPrice(j: unknown, depth = 0): number | null {
  if (!j || typeof j !== 'object' || depth > 3) return null;
  const o = j as Record<string, unknown>;
  for (const k of ['usdPrice', 'usd', 'price']) {
    const v = o[k];
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n;
  }
  for (const v of Object.values(o)) {
    const n = findPrice(v, depth + 1);
    if (n !== null) return n;
  }
  return null;
}
