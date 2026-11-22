import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { splitPot } from '../../src/shared/protocol';
import { RunCheck } from '../anticheat';
import { ROUTE, CRACK_AT, routeLength } from '../tools/route';
import { Store } from '../store';
import { Accounts, AccountError } from '../accounts';
import { Treasury } from '../treasury';
import { MockChain } from '../chain/mock';
import { config } from '../config';

const require = createRequire(import.meta.url);
const { Keypair, PublicKey } = require('@solana/web3.js') as typeof import('@solana/web3.js');
const wallet = () => Keypair.generate().publicKey.toBase58();

// ------------------------------------------------------------------ payouts
test('pot splits 50/30/20 in whole lamports, 1st gets the most', () => {
  const r = splitPot(1_000_000_001, [50, 30, 20], 3, 1_000_000);
  assert.deepEqual(r.amounts, [500_000_000, 300_000_000, 200_000_000]);
  assert.equal(r.rolledOver, 1);
  assert.ok(r.amounts[0] > r.amounts[1] && r.amounts[1] > r.amounts[2]);
});

test('unclaimed places roll over', () => {
  const r = splitPot(1_000_000_000, [50, 30, 20], 1, 1_000_000);
  assert.deepEqual(r.amounts, [500_000_000, 0, 0]);
  assert.equal(r.rolledOver, 500_000_000);
  const none = splitPot(1_000_000_000, [50, 30, 20], 0, 1_000_000);
  assert.equal(none.paid, 0);
  assert.equal(none.rolledOver, 1_000_000_000);
});

test('shares below the minimum payout roll over instead of being sent', () => {
  const r = splitPot(4_000_000, [50, 30, 20], 3, 1_000_000);
  assert.deepEqual(r.amounts, [2_000_000, 1_200_000, 0]);
  assert.equal(r.rolledOver, 800_000);
});

function freshStore() {
  return new Store(mkdtempSync(join(tmpdir(), 'heistmas-test-')));
}

test('treasury claims fees, pays winners, and retries a failed payout exactly once', async () => {
  const store = freshStore();
  const chain = new MockChain(0, 1_000_000_000);
  await chain.init();
  const logs: string[] = [];
  const cfg = { ...config, claimMinLamports: 1, claimMinIntervalSeconds: 0, dryRun: false };
  const t = new Treasury(chain, store, cfg, (m) => logs.push(m));
  chain.addFees(2_000_005_000);
  await t.check(true);
  assert.equal(t.potLamports(), 2_000_000_000);

  const u = (n: string) => ({ userId: n.toLowerCase(), username: n, wallet: wallet(), timeMs: 60_000 });
  chain.failNextPayouts = 1;
  const res = await t.settle(1, [u('Ana'), u('Ben'), u('Cy'), u('Dee')]);
  assert.equal(res.potLamports, 2_000_000_000);
  assert.deepEqual(
    res.winners.map((w) => w.lamports),
    [1_000_000_000, 600_000_000, 400_000_000],
  );
  assert.ok(res.winners.every((w) => w.status === 'failed'));
  assert.equal(store.treasury.data.owedLamports, 2_000_000_000);
  assert.equal(t.potLamports(), 0, 'the next pot starts empty; failed payouts are owed, not rolled over');

  // The failed attempt's signature never landed; after the wait the retry sends it once.
  const rec = store.treasury.data.payouts[0];
  rec.sentAt = Date.now() - 200_000;
  await (t as unknown as { retryFailed: () => Promise<void> }).retryFailed();
  assert.equal(rec.status, 'sent');
  assert.equal(store.treasury.data.paidTotalLamports, 2_000_000_000);
  assert.equal(store.treasury.data.owedLamports, 0);
  const before = await chain.walletBalance();
  await (t as unknown as { retryFailed: () => Promise<void> }).retryFailed();
  assert.equal(await chain.walletBalance(), before, 'a sent payout is never sent again');
});

test('house cut and rollover carry into the next pot', async () => {
  const store = freshStore();
  const chain = new MockChain(0, 1_000_000_000);
  await chain.init();
  const t = new Treasury(chain, store, { ...config, houseCutPercent: 10, claimMinLamports: 1, claimMinIntervalSeconds: 0 }, () => {});
  chain.addFees(1_000_005_000);
  await t.check(true);
  const res = await t.settle(7, [{ userId: 'solo', username: 'Solo', wallet: wallet(), timeMs: 90_000 }]);
  assert.equal(res.houseLamports, 100_000_000);
  assert.equal(res.winners[0].lamports, 450_000_000); // 50% of the 900M after the cut
  assert.equal(res.rolledOverLamports, 450_000_000);
  assert.equal(t.potLamports(), 450_000_000);
});

// ---------------------------------------------------------------- run checks
function simulate(opts: { speed?: number; teleportAt?: number; clockScale?: number; crack?: boolean; startAt?: [number, number, number]; loot?: number; route?: readonly (readonly [number, number, number])[] } = {}) {
  const R = opts.route ?? ROUTE;
  const speed = opts.speed ?? 9;
  const limits = { maxSpeed: 24, maxAvgSpeed: 13.5, minFinishMs: 15_000 };
  const start = 1_000_000;
  const run = new RunCheck(1, start, limits);
  let ms = 0;
  const pts: number[] = [];
  const push = (x: number, y: number, z: number) => pts.push(ms, x, y, z);
  let [x, y, z] = opts.startAt ?? R[0];
  push(x, y, z);
  const flush = () => {
    run.addSamples(pts.splice(0), start + ms / (opts.clockScale ?? 1));
  };
  for (let i = 1; i < R.length; i++) {
    const [tx, ty, tz] = R[i];
    if (opts.teleportAt === i) {
      x = tx;
      y = ty;
      z = tz;
    }
    // walking along a straight line between waypoints (y follows along)
    const y0 = y;
    const total = Math.hypot(tx - x, tz - z);
    while (Math.hypot(tx - x, tz - z) > 0.01) {
      const d = Math.hypot(tx - x, tz - z);
      const stepLen = Math.min(d, speed * 0.25);
      x += ((tx - x) / d) * stepLen;
      z += ((tz - z) / d) * stepLen;
      y = total > 0 ? y0 + (ty - y0) * (1 - Math.hypot(tx - x, tz - z) / total) : ty;
      ms += 250;
      push(x, y, z);
      if (pts.length >= 16) flush();
    }
    y = ty;
    if (i === CRACK_AT && opts.crack !== false) {
      flush();
      run.addEvent({ k: 'crack', ms });
      for (let k = 0; k < 8; k++) {
        ms += 250;
        push(x, y, z);
      }
    }
    if (i === 10) {
      flush();
      run.addEvent({ k: 'pickup', ms, v: opts.loot ?? 6000, x, y, z });
    }
  }
  flush();
  const ok = run.finish(ms, opts.loot ?? 6000, Math.round(ms / (opts.clockScale ?? 1)));
  return { ok, reasons: run.reasons, ms };
}

test('a plausible run through every stage is accepted', () => {
  const r = simulate();
  assert.equal(r.ok, true, r.reasons.join('; '));
});

test('teleporting to the getaway is rejected', () => {
  const r = simulate({ teleportAt: 40 });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes('teleported'), r.reasons.join('; '));
});

test('running faster than a sprint is rejected', () => {
  const r = simulate({ speed: 20 });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes('speed') || x === 'too fast' || x.includes('minimum time')), r.reasons.join('; '));
});

test('a client clock running fast (speed hack) is rejected', () => {
  const r = simulate({ clockScale: 1.5 });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes('client clock running fast'), r.reasons.join('; '));
});

test('skipping the vault crack is rejected', () => {
  const r = simulate({ crack: false });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes('vault never cracked'));
});

test('starting away from the spawn point is rejected', () => {
  const r = simulate({ startAt: [0, 0, -40] });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes('did not start at the spawn point'));
});

test('climbing onto the roof anywhere but the hatch is rejected', () => {
  // straight from the mint's dock up through the roof slab
  const route = [...ROUTE.slice(0, 21), [86, 14, -112] as const, ...ROUTE.slice(31)];
  const r = simulate({ route });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith('impossible route mint→roof')), r.reasons.join('; '));
});

test('skipping the zipline (dropping off the roof) is rejected', () => {
  const route = [...ROUTE.slice(0, 37), [158, 9, -127] as const, [176, 0, -132] as const, ...ROUTE.slice(42)];
  const r = simulate({ route });
  assert.equal(r.ok, false, r.reasons.join('; '));
});

test('the default minimum finish time is below a flat-out sprint through the route', () => {
  const sprintMs = (routeLength() / 9.8) * 1000;
  assert.ok(config.minFinishSeconds * 1000 < sprintMs, `${config.minFinishSeconds}s vs ${Math.round(sprintMs / 1000)}s`);
});

test('too little loot is rejected', () => {
  const r = simulate({ loot: 3000 });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes('not enough loot'));
});

// ------------------------------------------------------------------ accounts
test('usernames are unique ignoring case, wallets are one per player, login needs both', () => {
  const store = freshStore();
  const acc = new Accounts(store, 100);
  const w = wallet();
  const { token } = acc.register('Comet', w, true, '1.1.1.1');
  assert.ok(acc.byToken(token));
  assert.throws(() => acc.register('comet', wallet(), true, '1.1.1.1'), (e: AccountError) => e.code === 'username-taken');
  assert.throws(() => acc.register('Cupid', w, true, '1.1.1.1'), (e: AccountError) => e.code === 'wallet-taken');
  assert.throws(() => acc.register('Dasher', wallet(), false, '1.1.1.1'), (e: AccountError) => e.code === 'terms');
  assert.throws(() => acc.register('x', wallet(), true, '1.1.1.1'), (e: AccountError) => e.code === 'username-invalid');
  assert.throws(() => acc.login('Comet', wallet()), (e: AccountError) => e.code === 'mismatch');
  assert.ok(acc.login('comet', w).token);
});

test('program-derived addresses are refused as payout wallets', () => {
  const store = freshStore();
  const acc = new Accounts(store, 100);
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('heistmas')], new PublicKey('11111111111111111111111111111111'));
  assert.throws(() => acc.register('Vixen', pda.toBase58(), true, '2.2.2.2'), (e: AccountError) => e.code === 'wallet-invalid');
});
