import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, VIEW_MAX } from '../world';
import { FLAG_FROZEN, SNAP_STRIDE, type ServerMsg } from '../../src/shared/protocol';

function mk(world: World, name: string) {
  const inbox: ServerMsg[] = [];
  const m = world.member(name, (msg) => inbox.push(typeof msg === 'string' ? (JSON.parse(msg) as ServerMsg) : msg));
  return { m, inbox };
}
const st = (x: number, z: number) => [x * 10, 0, z * 10, 0, 1, 50, 0, 0];
const tick = (w: World) => (w as unknown as { tick: () => void }).tick();

test('a server fills banks of 200, then opens the next bank', () => {
  const w = new World(200);
  const ms = Array.from({ length: 450 }, (_, i) => mk(w, `r${i}`));
  for (const { m } of ms) w.join(0, 'North Pole', m);
  assert.deepEqual(w.bankSizes(0), [200, 200, 50]);
  const first = ms[0].inbox.find((x) => x.t === 'bank');
  assert.ok(first && first.t === 'bank' && first.capacity === 200 && first.name === 'North Pole · Bank 1');
  // leaving frees a seat that the next robber takes (fullest bank with room first)
  w.leave(ms[3].m);
  const late = mk(w, 'late');
  w.join(0, 'North Pole', late.m);
  assert.deepEqual(w.bankSizes(0), [200, 200, 50]);
});

test('each robber is sent the nearest robbers only, with a roster entry the first time', () => {
  const w = new World(200);
  const ms = Array.from({ length: 120 }, (_, i) => mk(w, `r${i}`));
  const now = Date.now();
  ms.forEach(({ m }, i) => {
    w.join(0, 'S', m);
    w.setLook(m, 'skin.criminal|mask.bandit|hat.auto|sack.burlap');
    // everyone in a 12 × 10 grid, 2 m apart
    w.setState(m, st((i % 12) * 2, Math.floor(i / 12) * 2), now);
  });
  // one far away robber nobody should see
  const far = mk(w, 'far');
  w.join(0, 'S', far.m);
  w.setState(far.m, st(500, 500), now);
  tick(w);
  const me = ms[0].inbox;
  const pl = me.filter((x) => x.t === 'pl').pop();
  assert.ok(pl && pl.t === 'pl');
  assert.equal(pl.p.length / SNAP_STRIDE, VIEW_MAX);
  assert.equal(pl.n, 121);
  const ros = me.filter((x) => x.t === 'ros');
  const names = ros.flatMap((r) => (r.t === 'ros' ? r.add.map((a) => a[1]) : []));
  assert.equal(names.length, VIEW_MAX);
  assert.ok(!names.includes('far'));
  // the second tick sends no roster again
  const before = me.length;
  tick(w);
  assert.equal(me.slice(before).filter((x) => x.t === 'ros').length, 0);
});

test('a snowball hit freezes a rival only if the shooter really fired, in range, once', () => {
  const w = new World(200);
  const a = mk(w, 'alice');
  const b = mk(w, 'bob');
  const now = Date.now();
  for (const { m } of [a, b]) w.join(0, 'S', m);
  w.setState(a.m, st(0, 0), now);
  w.setState(b.m, st(10, 0), now);
  // no shot fired: rejected
  assert.equal(w.hit(a.m, b.m.pid, 0, now), false);
  // muzzle far from the shooter: the shot is ignored
  w.shot(a.m, 0, [50, 1, 50], [1, 0, 0], now);
  assert.equal(w.hit(a.m, b.m.pid, 0, now), false);
  w.shot(a.m, 0, [0.5, 1, 0], [1, 0, 0], now);
  assert.equal(w.hit(a.m, b.m.pid, 0, now), true);
  const hb = b.inbox.find((x) => x.t === 'hitby');
  assert.ok(hb && hb.t === 'hitby' && hb.by === 'alice' && hb.dx > 0.99);
  assert.ok(b.m.st[7] & FLAG_FROZEN);
  // a frozen robber can't be frozen again
  w.shot(a.m, 0, [0.5, 1, 0], [1, 0, 0], now + 100);
  assert.equal(w.hit(a.m, b.m.pid, 0, now + 100), false);
  // the client can't clear its own frozen flag
  w.setState(b.m, st(10, 0), now + 200);
  assert.ok(b.m.st[7] & FLAG_FROZEN);
  // out of range for the shotgun (30 m)
  w.setState(b.m, st(80, 0), now + 9000);
  w.shot(a.m, 2, [0.5, 1, 0], [1, 0, 0], now + 9000);
  assert.equal(w.hit(a.m, b.m.pid, 2, now + 9000), false);
});
