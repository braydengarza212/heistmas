import * as THREE from 'three';
import { ICON } from './icons';
import { formatMoney, formatTime, formatTimeMs } from '../core/math';
import { LAMPORTS_PER_SOL, type PotState, type Standings } from '../shared/protocol';

type ToastKind = 'good' | 'bad' | 'info' | 'star' | 'loot';

interface Floater {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  life: number;
}

/** In-game heads-up display (DOM overlay). */
export class Hud {
  readonly el: HTMLDivElement;
  private q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private objective: HTMLDivElement;
  private timerEl: HTMLDivElement;
  private wantedEl: HTMLDivElement;
  private stars: HTMLElement[];
  private starLabel: HTMLDivElement;
  private healthEl: HTMLDivElement;
  private lootEl: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private toasts: HTMLDivElement;
  private floatLayer: HTMLDivElement;
  private vignette: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private title: HTMLDivElement;
  private zoneEl: HTMLDivElement;
  private controls: HTMLDivElement;
  private lockHint: HTMLDivElement;
  private fpsEl: HTMLDivElement;
  private potEl: HTMLDivElement;
  private raceEl: HTMLDivElement;
  private cdEl: HTMLDivElement;
  private stageEl: HTMLDivElement;
  private stageTimer = 0;
  private potShown = 0;
  private potClock = performance.now();
  private potTarget = 0;
  private potKey = '';
  private flashT = 0;
  private lastCd = '';
  private floaters: Floater[] = [];
  private lastStars = -1;
  private lastTimer = '';
  private lastPrompt: string | null = '';
  private lastLoot = -1;
  private lastHealth = -1;
  private zoneTimer = 0;
  private toastList: HTMLDivElement[] = [];
  private v = new THREE.Vector3();

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="vignette"></div>
      <div class="flash"></div>
      <div class="floaters"></div>
      <div class="objective panel"><div class="tag">OBJECTIVE</div><div class="title"></div><div class="hint"></div></div>
      <div class="zone-label"></div>
      <div class="timer panel">${ICON.clock}<span>6:00</span></div>
      <div class="wanted panel"><div class="stars">${ICON.star.repeat(5)}</div><div class="label"></div></div>
      <div class="health panel">${ICON.heart.repeat(10)}</div>
      <div class="pot panel">
        <div class="pot-top"><span class="pot-tag">PRIZE POT</span><span class="pot-round"></span></div>
        <div class="pot-amount"><b>0.000</b><span class="unit">SOL</span><span class="usd"></span></div>
        <div class="pot-label">Creator fees up for grabs this round</div>
        <div class="pot-split"></div>
        <div class="pot-live"><i></i><span>Fees are claimed live, around the clock</span></div>
      </div>
      <div class="crosshair"><i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><b></b></div>
      <div class="camlock"><kbd>Q</kbd> CAMERA LOCKED</div>
      <div class="weapon panel"><b>❄</b><div><div class="w-name"></div><div class="w-kind"></div><div class="w-ammo"></div></div></div>
      <div class="loot panel">${ICON.sack}<div><div class="amount">$0</div><div class="bar"><i></i></div><div class="sub"></div></div></div>
      <div class="race panel"><div class="race-head"><span>LIVE TOP 3</span><span class="race-count"></span></div><ol class="race-list"></ol><div class="race-you"></div><div class="race-bank"></div></div>
      <div class="countdown"><div class="cd-label"></div><div class="cd-num"></div><div class="cd-sub"></div></div>
      <div class="prompt panel"></div>
      <div class="toasts"></div>
      <div class="title-card"><h1></h1><p></p><div class="skip">Press any key to skip</div></div>
      <div class="stage-banner"><div class="sb-num"></div><div class="sb-name"></div><div class="sb-diff"></div></div>
      <div class="letterbox top"></div><div class="letterbox bottom"><span>Press any key to skip</span></div>
      <div class="controls-hint"><kbd>WASD</kbd> move · <kbd>Mouse</kbd> look · <kbd>Space</kbd> jump · <kbd>Shift</kbd> sprint · <kbd>Ctrl</kbd>/<kbd>C</kbd> dive &amp; slide · <kbd>E</kbd> interact · <kbd>Q</kbd> lock camera · <kbd>Esc</kbd> pause</div>
      <div class="lock-hint">Click or press any key to lock the cursor</div>
      <div class="fps"></div>`;
    root.appendChild(this.el);
    this.objective = this.q('.objective');
    this.timerEl = this.q('.timer');
    this.wantedEl = this.q('.wanted');
    this.stars = Array.from(this.el.querySelectorAll('.wanted .star')) as HTMLElement[];
    this.starLabel = this.q('.wanted .label');
    this.healthEl = this.q('.health');
    this.lootEl = this.q('.loot');
    this.promptEl = this.q('.prompt');
    this.toasts = this.q('.toasts');
    this.floatLayer = this.q('.floaters');
    this.vignette = this.q('.vignette');
    this.flashEl = this.q('.flash');
    this.title = this.q('.title-card');
    this.zoneEl = this.q('.zone-label');
    this.controls = this.q('.controls-hint');
    this.lockHint = this.q('.lock-hint');
    this.fpsEl = this.q('.fps');
    this.potEl = this.q('.pot');
    this.raceEl = this.q('.race');
    this.cdEl = this.q('.countdown');
    this.stageEl = this.q('.stage-banner');
  }

  /** "STAGE 7 / 10" banner with difficulty pips when the robber reaches a new stage. */
  stageBanner(n: number, total: number, name: string, difficulty: number) {
    this.stageEl.classList.remove('announce');
    (this.stageEl.querySelector('.sb-num') as HTMLElement).textContent = `STAGE ${n} / ${total}`;
    (this.stageEl.querySelector('.sb-name') as HTMLElement).textContent = name.toUpperCase();
    const pips = Array.from({ length: 5 }, (_, i) => `<i class="${i < difficulty ? 'on' : ''}"></i>`).join('');
    const label = ['EASY', 'EASY', 'MEDIUM', 'TRICKY', 'HARD', 'EXTREME'][difficulty] ?? '';
    (this.stageEl.querySelector('.sb-diff') as HTMLElement).innerHTML = `<span>${label}</span>${pips}`;
    this.stageEl.classList.toggle('hard', difficulty >= 4);
    this.stageEl.classList.remove('show');
    void this.stageEl.offsetWidth;
    this.stageEl.classList.add('show');
    this.stageTimer = 3.2;
  }

  /** Big centered announcement in the stage-banner style. */
  announce(top: string, name: string, sub: string, seconds = 5) {
    (this.stageEl.querySelector('.sb-num') as HTMLElement).textContent = top;
    (this.stageEl.querySelector('.sb-name') as HTMLElement).textContent = name;
    (this.stageEl.querySelector('.sb-diff') as HTMLElement).innerHTML = `<span class="sb-sub">${sub}</span>`;
    this.stageEl.classList.remove('hard', 'show');
    this.stageEl.classList.add('announce');
    void this.stageEl.offsetWidth;
    this.stageEl.classList.add('show');
    this.stageTimer = seconds;
  }

  /** Weapon in hand (null hides the panel). */
  setWeapon(w: { name: string; kind: string; auto: boolean } | null, ammo = 0, max = 5) {
    const el = this.q('.weapon');
    el.classList.toggle('show', w !== null);
    if (!w) return;
    (el.querySelector('.w-name') as HTMLElement).textContent = w.name;
    (el.querySelector('.w-kind') as HTMLElement).textContent = `${w.kind} · [F] / click${w.auto ? ' (hold)' : ''}`;
    const pips = Array.from({ length: max }, (_, i) => `<i class="${i < ammo ? 'on' : ''}"></i>`).join('');
    (el.querySelector('.w-ammo') as HTMLElement).innerHTML = ammo > 0 ? pips : '<span>Out of snowballs — find another weapon</span>';
  }

  /** Shared world: which bank you're in and how many robbers share it. */
  setBank(name: string | null, players: number) {
    const el = this.raceEl.querySelector('.race-bank') as HTMLElement;
    const txt = name ? `${name} · ${players} robber${players === 1 ? '' : 's'}` : '';
    if (el.textContent !== txt) el.textContent = txt;
  }

  setCrosshair(on: boolean) {
    this.q('.crosshair').classList.toggle('show', on);
  }

  /** Little recoil kick (fire) or ice-blue hit marker (hit). */
  pulseCrosshair(kind: 'fire' | 'hit') {
    const el = this.q('.crosshair');
    el.classList.remove(kind);
    void (el as HTMLElement).offsetWidth;
    el.classList.add(kind);
  }

  setCamLock(on: boolean) {
    this.q('.camlock').classList.toggle('show', on);
  }

  /** Letterboxed film look for the getaway; hides gameplay panels. */
  setCinematic(on: boolean) {
    this.el.classList.toggle('cine', on);
  }

  // ------------------------------------------------------------ online HUD
  setOnline(on: boolean) {
    this.el.classList.toggle('online', on);
    if (!on) this.countdown(null);
  }

  /** Prize pot above the loot counter: claimed + still-unclaimed fees, split by place. */
  setPot(pot: PotState, round: number) {
    const payable = Math.floor(((pot.lamports + pot.pendingLamports) * (100 - pot.houseCutPercent)) / 100);
    this.potTarget = payable;
    const key = `${payable}|${round}|${pot.solUsd}|${pot.split.join(',')}`;
    if (key === this.potKey) return;
    this.potKey = key;
    (this.potEl.querySelector('.pot-round') as HTMLElement).textContent = `ROUND ${round}`;
    const usd = pot.solUsd ? `≈ $${Math.round((payable / LAMPORTS_PER_SOL) * pot.solUsd).toLocaleString('en-US')}` : '';
    (this.potEl.querySelector('.usd') as HTMLElement).textContent = usd;
    const places = ['1st', '2nd', '3rd', '4th', '5th'];
    (this.potEl.querySelector('.pot-split') as HTMLElement).innerHTML = pot.split
      .map((pct, i) => `<span class="p${i + 1}"><i>${places[i] ?? `#${i + 1}`}</i>${solText(Math.floor((payable * pct) / 100))}</span>`)
      .join('');
    this.potEl.classList.toggle('degraded', pot.status !== 'ok');
  }

  /** A fresh fee claim landed in the pot. */
  flashFees(lamports: number) {
    const live = this.potEl.querySelector('.pot-live span') as HTMLElement;
    live.textContent = `+${solText(lamports)} SOL in fees just claimed`;
    this.flashT = 4;
    this.potEl.classList.remove('pot-flash');
    void this.potEl.offsetWidth;
    this.potEl.classList.add('pot-flash');
  }

  setRace(st: Standings | null, you: string | null, me: { status: string; timeMs: number | null; rank: number | null }) {
    const list = this.raceEl.querySelector('.race-list') as HTMLElement;
    const top = st?.top.slice(0, 3) ?? [];
    list.innerHTML = top.length
      ? top.map((e) => `<li class="${e.username === you ? 'me' : ''}"><b>${e.rank}</b><span class="nm">${escapeHtml(e.username)}</span>${e.loot !== undefined ? `<span class="lt">${formatMoney(e.loot)}</span>` : ''}<span class="tm">${formatTimeMs(e.timeMs)}</span></li>`).join('')
      : '<li class="empty">No escapes yet — be the first!</li>';
    (this.raceEl.querySelector('.race-count') as HTMLElement).textContent = st ? `${st.finishers} of ${st.players} escaped` : '';
    const youEl = this.raceEl.querySelector('.race-you') as HTMLElement;
    youEl.textContent = me.timeMs !== null ? `You: #${me.rank ?? '—'} · ${formatTimeMs(me.timeMs)}` : `You: ${me.status}`;
  }

  /** Big centered countdown (null hides it). */
  countdown(text: string | null, label = '', sub = '') {
    const key = `${text}|${label}|${sub}`;
    if (key === this.lastCd) return;
    this.lastCd = key;
    this.cdEl.classList.toggle('show', text !== null);
    if (text === null) return;
    (this.cdEl.querySelector('.cd-label') as HTMLElement).textContent = label;
    const num = this.cdEl.querySelector('.cd-num') as HTMLElement;
    if (num.textContent !== text) {
      num.textContent = text;
      num.classList.remove('tick');
      void num.offsetWidth;
      num.classList.add('tick');
    }
    (this.cdEl.querySelector('.cd-sub') as HTMLElement).textContent = sub;
  }

  show() {
    this.el.classList.add('show');
    this.controls.style.opacity = '1';
    setTimeout(() => (this.controls.style.opacity = '0'), 14000);
  }

  hide() {
    this.el.classList.remove('show');
    this.reset();
  }

  reset() {
    this.toasts.innerHTML = '';
    this.toastList = [];
    for (const f of this.floaters) f.el.remove();
    this.floaters = [];
    this.lastStars = -1;
    this.lastLoot = -1;
    this.lastHealth = -1;
    this.lastPrompt = '';
    this.hideTitle();
    this.prompt(null);
    this.stageEl.classList.remove('show');
    this.setCinematic(false);
    this.setWeapon(null);
    this.setCrosshair(false);
    this.setCamLock(false);
  }

  setObjective(title: string, hint: string) {
    (this.objective.querySelector('.title') as HTMLElement).textContent = title;
    (this.objective.querySelector('.hint') as HTMLElement).textContent = hint;
    this.objective.classList.remove('pop');
    void this.objective.offsetWidth;
    this.objective.classList.add('pop');
    requestAnimationFrame(() => this.el.style.setProperty('--obj-h', this.objective.offsetHeight + 'px'));
  }

  zoneLabel(name: string) {
    this.zoneEl.textContent = name.toUpperCase();
    this.zoneEl.classList.add('show');
    this.zoneTimer = 3.5;
  }

  setTimer(seconds: number) {
    const s = formatTime(seconds);
    if (s === this.lastTimer) return;
    this.lastTimer = s;
    (this.timerEl.querySelector('span') as HTMLElement).textContent = s;
    this.timerEl.classList.toggle('urgent', seconds <= 30);
  }

  setStars(stars: number, cooling: boolean, label: string) {
    if (stars !== this.lastStars) {
      this.stars.forEach((st, i) => {
        const on = i < stars;
        const was = st.classList.contains('on');
        st.classList.toggle('on', on);
        if (on && !was && this.lastStars >= 0) {
          st.classList.remove('bump');
          void st.getBoundingClientRect();
          st.classList.add('bump');
        }
      });
      this.starLabel.textContent = label;
      this.wantedEl.classList.toggle('alarm', stars >= 3);
      this.lastStars = stars;
    }
    this.wantedEl.classList.toggle('cooling', cooling);
  }

  setHealth(h: number, max: number, hit = false) {
    if (h === this.lastHealth && !hit) return;
    const hearts = this.healthEl.querySelectorAll('svg');
    hearts.forEach((s, i) => {
      s.classList.toggle('empty', i >= h);
      // hearts from hidden pickups (beyond the starting five) are gold-rimmed
      s.classList.toggle('bonus', i >= 5);
      (s as SVGElement).style.display = i < max ? '' : 'none';
    });
    this.healthEl.classList.toggle('many', max > 5);
    if (hit) {
      this.healthEl.classList.remove('hit');
      void this.healthEl.offsetWidth;
      this.healthEl.classList.add('hit');
    }
    this.lastHealth = h;
  }

  setLoot(value: number, min: number) {
    if (value === this.lastLoot) return;
    const up = value > this.lastLoot && this.lastLoot >= 0;
    this.lastLoot = value;
    (this.lootEl.querySelector('.amount') as HTMLElement).textContent = formatMoney(value);
    const pct = Math.min(1, value / min);
    (this.lootEl.querySelector('.bar i') as HTMLElement).style.width = `${pct * 100}%`;
    const sub = this.lootEl.querySelector('.sub') as HTMLElement;
    if (value >= min) {
      sub.textContent = 'Getaway unlocked — more loot, more score!';
      sub.classList.add('ok');
    } else {
      sub.textContent = `${formatMoney(min - value)} more to make the getaway`;
      sub.classList.remove('ok');
    }
    if (up) {
      this.lootEl.classList.remove('bump');
      void this.lootEl.offsetWidth;
      this.lootEl.classList.add('bump');
    }
  }

  prompt(text: string | null) {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    if (text) this.promptEl.innerHTML = `<kbd>E</kbd>${text}`;
    this.promptEl.classList.toggle('show', !!text);
  }

  notify(title: string, kind: ToastKind = 'info', sub = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.innerHTML = `<b></b>${sub ? '<span></span>' : ''}`;
    (t.querySelector('b') as HTMLElement).textContent = title;
    if (sub) (t.querySelector('span') as HTMLElement).textContent = sub;
    this.toasts.prepend(t);
    this.toastList.push(t);
    while (this.toastList.length > 3) {
      const old = this.toastList.shift()!;
      old.remove();
    }
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => {
        t.remove();
        this.toastList = this.toastList.filter((x) => x !== t);
      }, 360);
    }, kind === 'star' ? 3200 : 2400);
  }

  floatText(pos: THREE.Vector3, text: string, color = '#ffffff') {
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.color = color;
    this.floatLayer.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), life: 0 });
    if (this.floaters.length > 14) this.floaters.shift()!.el.remove();
  }

  flash(kind: 'red' | 'dark') {
    this.flashEl.className = 'flash';
    void this.flashEl.offsetWidth;
    this.flashEl.className = `flash ${kind}`;
  }

  setVignette(amount: number, kind: 'alarm' | 'hurt') {
    this.vignette.style.opacity = String(amount);
    this.vignette.classList.toggle('hurt', kind === 'hurt');
  }

  titleCard(title: string, sub: string, kind: 'normal' | 'bad' = 'normal') {
    (this.title.querySelector('h1') as HTMLElement).textContent = title;
    (this.title.querySelector('p') as HTMLElement).textContent = sub;
    (this.title.querySelector('.skip') as HTMLElement).style.display = kind === 'bad' ? 'none' : '';
    this.title.classList.toggle('bad', kind === 'bad');
    const h1 = this.title.querySelector('h1') as HTMLElement;
    h1.style.animation = 'none';
    void h1.offsetWidth;
    h1.style.animation = '';
    this.title.classList.add('show');
  }

  hideTitle() {
    this.title.classList.remove('show');
  }

  /** 'ask': cursor can be locked; 'blocked': this browser refuses (in-app browsers, embedded panes). */
  showLockHint(mode: 'ask' | 'blocked' | null) {
    const text =
      mode === 'blocked'
        ? 'This browser won\u2019t lock the cursor \u2014 hold the mouse button and drag to look, or open the game in Chrome, Edge or Firefox'
        : 'Click or press any key to lock the cursor';
    if (mode && this.lockHint.textContent !== text) this.lockHint.textContent = text;
    this.lockHint.classList.toggle('show', mode !== null);
    this.lockHint.classList.toggle('blocked', mode === 'blocked');
  }

  setFps(fps: number | null) {
    this.fpsEl.textContent = fps === null ? '' : `${fps.toFixed(0)} FPS`;
  }

  /** Ticks the pot counter; safe to call without a camera (menus). */
  tickPot(_dt: number) {
    // wall-clock time: the game's own timestep is capped and crawls on slow machines
    const now = performance.now();
    const dt = Math.min(0.5, (now - this.potClock) / 1000);
    this.potClock = now;
    if (this.potShown !== this.potTarget) {
      const diff = this.potTarget - this.potShown;
      this.potShown = Math.abs(diff) < 2000 ? this.potTarget : this.potShown + diff * Math.min(1, dt * 4);
      (this.potEl.querySelector('.pot-amount b') as HTMLElement).textContent = solText(this.potShown);
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        (this.potEl.querySelector('.pot-live span') as HTMLElement).textContent = 'Fees are claimed live, around the clock';
        this.potEl.classList.remove('pot-flash');
      }
    }
  }

  update(dt: number, camera: THREE.Camera) {
    if (this.stageTimer > 0) {
      this.stageTimer -= dt;
      if (this.stageTimer <= 0) this.stageEl.classList.remove('show');
    }
    this.tickPot(dt);
    if (this.zoneTimer > 0) {
      this.zoneTimer -= dt;
      if (this.zoneTimer <= 0) this.zoneEl.classList.remove('show');
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life += dt;
      f.pos.y += dt * 1.3;
      this.v.copy(f.pos).project(camera);
      const visible = this.v.z < 1 && f.life < 1.1;
      if (!visible) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      const s = f.life < 0.15 ? 0.5 + (f.life / 0.15) * 0.7 : 1.2 - Math.min(0.2, (f.life - 0.15) * 0.4);
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
      f.el.style.left = '0';
      f.el.style.top = '0';
      f.el.style.opacity = String(Math.min(1, (1.1 - f.life) * 3));
    }
  }
}

export function solText(lamports: number) {
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol >= 1000) return sol.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (sol >= 1) return sol.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return sol.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
