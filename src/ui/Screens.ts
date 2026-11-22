import type { SaveManager, Settings } from '../core/Save';
import type { LeaderboardService, ScoreEntry } from '../core/Leaderboard';
import type { AudioEngine } from '../core/Audio';
import type { QualityLevel } from '../core/Engine';
import { QUALITY } from '../core/Engine';
import { COSMETICS, cosmetic, type Slot } from '../progress/cosmetics';
import { ICON, HEIST_ART, medalSvg } from './icons';
import { formatMoney, formatTimeMs } from '../core/math';
import type { HeistResult } from '../game/Heist';
import { RANKS } from '../game/Heist';
import type { InfoResponse, LeaderboardResponse, RoundResults, Standings } from '../shared/protocol';
import { LAMPORTS_PER_SOL } from '../shared/protocol';
import { solText } from './Hud';

export type ScreenName = 'main' | 'select' | 'customize' | 'leaderboard' | 'settings' | 'pause' | 'results' | 'register' | 'servers' | 'coin' | 'round';

/** Live data the menus show when the game servers are reachable. */
export interface OnlineView {
  info(): InfoResponse | null;
  leaderboard(): Promise<LeaderboardResponse | null>;
  standings(): Standings | null;
  you(): string | null;
  explorerTx(sig: string): string;
}

export interface MenuCallbacks {
  play: () => void;
  onScreen: (s: ScreenName | null) => void;
  equip: (slot: Slot, id: string) => void;
  settingsChanged: (s: Settings, key: keyof Settings) => void;
  resetProgress: () => void;
  resume: () => void;
  restart: () => void;
  quit: () => void;
  playAgain: () => void;
  toMenu: () => void;
  submitScore: (name: string) => void;
  fullscreen: () => void;
  coin: () => void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class Menus {
  private screens = new Map<ScreenName, HTMLDivElement>();
  private current: ScreenName | null = null;
  private settingsReturn: ScreenName = 'main';
  private tab: Slot = 'skin';
  private curtainEl: HTMLDivElement;
  private seenUnlocks = new Set<string>();
  private onShowHooks = new Map<ScreenName, () => void>();
  private lbTab: 'round' | 'winners' | 'alltime' | 'local' = 'round';
  newUnlocks = new Set<string>();
  online: OnlineView | null = null;

  constructor(
    private root: HTMLElement,
    private save: SaveManager,
    private board: LeaderboardService,
    private audio: AudioEngine,
    private cb: MenuCallbacks,
  ) {
    this.build();
    this.curtainEl = document.createElement('div');
    this.curtainEl.className = 'curtain';
    this.curtainEl.innerHTML = `${ICON.bean}<div class="msg">Casing the joint…</div><div class="bar"><i></i></div><div class="tip"></div>`;
    root.appendChild(this.curtainEl);
  }

  // --------------------------------------------------------------- plumbing
  /** Adds a screen from another module; `onShow` runs every time it opens. */
  addScreen(name: ScreenName, cls: string, html: string, onShow?: () => void) {
    const el = this.screen(name, cls, html);
    if (onShow) this.onShowHooks.set(name, onShow);
    return el;
  }

  screenEl(name: ScreenName) {
    return this.screens.get(name)!;
  }

  private screen(name: ScreenName, cls: string, html: string) {
    const el = document.createElement('div');
    el.className = `screen ${cls}`;
    el.innerHTML = html;
    this.root.appendChild(el);
    this.screens.set(name, el);
    return el;
  }

  private wire(el: HTMLElement) {
    el.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => {
      b.addEventListener('mouseenter', () => this.audio.play('hover'));
      b.addEventListener('click', () => {
        this.audio.unlock();
        this.audio.play('select');
        this.act(b.dataset.act!, b);
      });
    });
  }

  show(name: ScreenName | null) {
    if (name === 'settings' && this.current && this.current !== 'settings') this.settingsReturn = this.current;
    for (const [n, el] of this.screens) el.classList.toggle('show', n === name);
    this.current = name;
    if (name === 'customize') this.renderCustomize();
    if (name === 'leaderboard') void this.renderLeaderboard();
    if (name === 'select') this.renderSelect();
    if (name === 'settings') this.renderSettings();
    if (name === 'main') this.renderMainBadge();
    if (name) this.onShowHooks.get(name)?.();
    this.cb.onScreen(name);
    const first = name ? this.screens.get(name)?.querySelector<HTMLElement>('.btn') : null;
    first?.focus({ preventScroll: true });
  }

  get active() {
    return this.current;
  }

  back() {
    if (this.current === 'settings') this.show(this.settingsReturn);
    else if (this.current === 'select' || this.current === 'customize' || this.current === 'leaderboard' || this.current === 'register' || this.current === 'servers' || this.current === 'coin') this.show('main');
    else if (this.current === 'pause') this.cb.resume();
  }

  private act(a: string, el: HTMLElement) {
    switch (a) {
      case 'play':
        this.cb.play();
        break;
      case 'select':
      case 'customize':
      case 'leaderboard':
      case 'settings':
        this.show(a);
        break;
      case 'back':
        this.back();
        break;
      case 'resume':
        this.cb.resume();
        break;
      case 'restart':
        this.cb.restart();
        break;
      case 'quit':
        this.cb.quit();
        break;
      case 'again':
        this.cb.playAgain();
        break;
      case 'menu':
        this.cb.toMenu();
        break;
      case 'heist':
        if (el.dataset.id === 'bank') this.cb.play();
        break;
      case 'tab':
        this.tab = el.dataset.slot as Slot;
        this.renderCustomize();
        break;
      case 'fullscreen':
        this.cb.fullscreen();
        break;
      case 'coin':
        this.cb.coin();
        break;
      case 'lbtab':
        this.lbTab = el.dataset.tab as typeof this.lbTab;
        void this.renderLeaderboard();
        break;
      case 'reset':
        if (el.dataset.confirm === '1') {
          this.cb.resetProgress();
          el.dataset.confirm = '0';
          el.textContent = 'Progress reset';
        } else {
          el.dataset.confirm = '1';
          el.textContent = 'Click again to confirm';
        }
        break;
    }
  }

  // ------------------------------------------------------------------ build
  private build() {
    const main = this.screen(
      'main',
      'menu-main',
      `<div class="logo"><h1>HEISTMAS</h1><button class="ticker" data-act="coin" title="About the $HEISTMAS memecoin">$Heistmas</button><span class="tagline">Silent Night. Five Stars.</span></div>
       <div class="btn-stack">
         <button class="btn primary" data-act="play"><span class="ico">${ICON.play}</span>PLAY</button>
         <button class="btn" data-act="select"><span class="ico">${ICON.target}</span>SELECT HEIST</button>
         <button class="btn" data-act="customize"><span class="ico">${ICON.mask}</span>CUSTOMIZE</button>
         <button class="btn" data-act="leaderboard"><span class="ico">${ICON.trophy}</span>LEADERBOARD</button>
         <button class="btn" data-act="settings"><span class="ico">${ICON.gear}</span>SETTINGS</button>
       </div>
       <div class="menu-badge panel"></div>
       <button class="coin-strip" data-act="coin"><span class="cs-tag">$HEISTMAS</span><span class="cs-text">A memecoin launched on pump.fun</span><span class="cs-ca"></span><span class="cs-more">How the prize pot works →</span></button>
       <div class="menu-footer">Free to play · no purchase needed to play or win · v1.1 &nbsp;|&nbsp; Best with mouse &amp; keyboard</div>`,
    );
    this.wire(main);

    this.screen('select', 'heist-select', `<div class="sheet panel"><h2>Select Heist</h2><div class="heist-cards"></div><div class="back-row"><button class="btn small" data-act="back">${ICON.back.replace('<svg', '<svg width="18" height="18"')} BACK</button></div></div>`);
    this.screen('customize', 'customize', `<div class="sheet panel"><h2>Customize</h2><div class="tabs"></div><div class="items"></div><div class="back-row"><button class="btn small" data-act="back">BACK</button></div><p style="opacity:.7;font-size:14px;margin:12px 0 0">Tip: drag on the left to spin your robber.</p></div>`);
    this.screen('leaderboard', 'leaderboard', `<div class="sheet panel"><h2>Leaderboard</h2><div class="tabs"></div><div class="lb-body"></div><div class="back-row"><button class="btn small" data-act="back">BACK</button></div></div>`);
    this.screen('settings', 'settings', `<div class="sheet panel"><h2>Settings</h2><div class="settings-body"></div><div class="back-row"><button class="btn small" data-act="back">BACK</button></div></div>`);
    const pause = this.screen(
      'pause',
      'pause',
      `<div class="sheet panel"><h2>Paused</h2>
        <div class="btn-stack">
          <button class="btn primary" data-act="resume">RESUME</button>
          <button class="btn" data-act="restart">RESTART HEIST</button>
          <button class="btn" data-act="settings">SETTINGS</button>
          <button class="btn" data-act="quit">QUIT TO MENU</button>
        </div>
        <div class="controls-table">
          <kbd>W A S D</kbd><span>Move (arrow keys work too)</span>
          <kbd>Mouse</kbd><span>Look around · wheel to zoom</span>
          <kbd>Space</kbd><span>Jump (hold for higher)</span>
          <kbd>Shift</kbd><span>Sprint (noisy!)</span>
          <kbd>Ctrl / C / RMB</kbd><span>Dive in the air · slide on the ground · bonk penguins</span>
          <kbd>E</kbd><span>Interact: crack vaults, hack terminals, open vents</span>
          <kbd>Esc</kbd><span>Pause</span>
        </div></div>`,
    );
    this.wire(pause);
    this.screen('results', 'results', `<div class="sheet panel"></div>`);
  }

  renderMainBadge() {
    const s = this.save.data.stats;
    const main = this.screens.get('main')!;
    const el = main.querySelector('.menu-badge') as HTMLElement;
    const info = this.online?.info() ?? null;
    const best = s.bestScore > 0 ? `<span class="mb-best">Practice best <b>${formatMoney(s.bestScore).replace('$', '')}</b> · ${s.heistsCompleted} heist${s.heistsCompleted === 1 ? '' : 's'} pulled</span>` : '';
    if (info) {
      const pot = info.pot;
      const payable = Math.floor(((pot.lamports + pot.pendingLamports) * (100 - pot.houseCutPercent)) / 100);
      const usd = pot.solUsd ? ` <small>≈ $${Math.round((payable / LAMPORTS_PER_SOL) * pot.solUsd).toLocaleString('en-US')}</small>` : '';
      const r = info.round;
      const now = info.now + (Date.now() - this.infoAt(info));
      const left = r.phase === 'live' ? `${formatTimeMs(Math.max(0, r.endsAt - now)).replace(/\.\d+$/, '')} left in round ${r.id}` : r.phase === 'waiting' ? `Round ${r.id} starts in ${formatTimeMs(Math.max(0, r.startsAt - now)).replace(/\.\d+$/, '')}` : `Round ${r.id + 1} starts in ${formatTimeMs(Math.max(0, (r.nextStartsAt ?? now) - now)).replace(/\.\d+$/, '')}`;
      el.classList.add('live');
      el.innerHTML = `<span class="mb-tag">PRIZE POT</span><div class="mb-pot"><b>${solText(payable)}</b> SOL${usd}</div><div class="mb-sub">${left} · ${info.playersOnline.toLocaleString('en-US')} online</div>${best}`;
    } else {
      el.classList.remove('live');
      el.innerHTML = `Best score<br><b>${formatMoney(s.bestScore).replace('$', '')}</b><br><span style="font-family:var(--body);font-size:13px;opacity:.85">${s.heistsCompleted} heist${s.heistsCompleted === 1 ? '' : 's'} pulled · ${formatMoney(s.totalLoot)} stolen</span>`;
    }
    const ca = main.querySelector('.cs-ca') as HTMLElement;
    const mint = info?.config.token.mint;
    ca.textContent = mint ? `CA ${mint.slice(0, 4)}…${mint.slice(-4)}` : '';
    (main.querySelector('.coin-strip') as HTMLElement).style.display = info ? '' : 'none';
  }

  private infoAtMap = new WeakMap<InfoResponse, number>();
  /** When a given /api/info snapshot was received (to keep countdowns ticking). */
  private infoAt(info: InfoResponse) {
    let t = this.infoAtMap.get(info);
    if (t === undefined) {
      t = Date.now();
      this.infoAtMap.set(info, t);
    }
    return t;
  }

  private renderSelect() {
    const s = this.save.data.stats;
    const cards = [
      { id: 'bank', name: 'The Christmas Bank', desc: 'Ten stages: laser halls, a vault the size of a house, a coin mint over molten gold and a rooftop escape. Mind the penguins.', art: HEIST_ART.bank, ok: true },
      { id: 'workshop', name: "Santa's Workshop", desc: 'Toy conveyor belts, giant presents and security elves on the night shift.', art: HEIST_ART.workshop, ok: false },
      { id: 'mall', name: 'The Christmas Mall', desc: 'Escalators, gift shops and the biggest tree in town. Late-night shopping.', art: HEIST_ART.mall, ok: false },
      { id: 'northpole', name: 'The North Pole Vault', desc: 'An icy underground fortress guarding the rarest loot on Earth.', art: HEIST_ART.northpole, ok: false },
    ];
    const el = this.screens.get('select')!.querySelector('.heist-cards') as HTMLElement;
    el.innerHTML = cards
      .map(
        (c) => `<div class="heist-card ${c.ok ? '' : 'locked'}" ${c.ok ? `data-act="heist" data-id="${c.id}"` : ''}>
          <div class="art">${c.art}</div>${c.ok ? '<div class="ribbon">PLAY</div>' : '<div class="ribbon soon">SOON</div>'}
          <div class="info"><div class="name">${c.name}</div><div class="desc">${c.desc}</div>
          <div class="meta">${c.ok ? (s.bestScore ? `Best: ${formatMoney(s.bestScore)} · ${s.bestRank >= 0 ? RANKS[s.bestRank].name : ''}` : 'Not attempted yet') : 'Coming soon'}</div></div></div>`,
      )
      .join('');
    this.wire(el);
    this.wire(this.screens.get('select')!.querySelector('.back-row') as HTMLElement);
  }

  private renderCustomize() {
    const el = this.screens.get('customize')!;
    const tabs = el.querySelector('.tabs') as HTMLElement;
    const names: Record<Slot, string> = { skin: 'OUTFITS', mask: 'MASKS', hat: 'HATS', sack: 'SACKS' };
    tabs.innerHTML = (Object.keys(names) as Slot[]).map((s) => `<span class="tab ${s === this.tab ? 'on' : ''}" data-act="tab" data-slot="${s}">${names[s]}</span>`).join('');
    const items = el.querySelector('.items') as HTMLElement;
    const d = this.save.data;
    items.innerHTML = COSMETICS.filter((c) => c.slot === this.tab)
      .map((c) => {
        const unlocked = d.unlocked.includes(c.id);
        const on = d.equipped[c.slot] === c.id;
        const isNew = this.newUnlocks.has(c.id) && !this.seenUnlocks.has(c.id);
        return `<div class="item ${on ? 'on' : ''} ${unlocked ? '' : 'locked'}" data-id="${c.id}">
          <div class="swatch" style="background:${c.swatch}"></div>${unlocked ? '' : ICON.lock}
          ${isNew ? '<div class="new">NEW</div>' : ''}
          <div class="nm">${c.name}</div><div class="req">${unlocked ? (on ? 'Equipped' : '&nbsp;') : c.requirement}</div></div>`;
      })
      .join('');
    items.querySelectorAll<HTMLElement>('.item').forEach((it) => {
      it.addEventListener('mouseenter', () => this.audio.play('hover'));
      it.addEventListener('click', () => {
        const id = it.dataset.id!;
        if (!d.unlocked.includes(id)) {
          this.audio.play('fail', { volume: 0.4 });
          return;
        }
        this.seenUnlocks.add(id);
        this.audio.play('select');
        this.cb.equip(this.tab, id);
        this.renderCustomize();
      });
    });
    this.wire(tabs);
    this.wire(el.querySelector('.back-row') as HTMLElement);
  }

  private async renderLeaderboard() {
    const el = this.screens.get('leaderboard')!;
    const tabs = el.querySelector('.tabs') as HTMLElement;
    const body = el.querySelector('.lb-body') as HTMLElement;
    const names: [typeof this.lbTab, string][] = [
      ['round', 'THIS ROUND'],
      ['winners', 'RECENT WINNERS'],
      ['alltime', 'ALL-TIME'],
      ['local', 'MY RECORDS'],
    ];
    const online = !!this.online?.info();
    if (!online && this.lbTab !== 'local') this.lbTab = 'local';
    tabs.innerHTML = names
      .filter(([k]) => online || k === 'local')
      .map(([k, label]) => `<span class="tab ${k === this.lbTab ? 'on' : ''}" data-act="lbtab" data-tab="${k}">${label}</span>`)
      .join('');
    this.wire(tabs);
    this.wire(el.querySelector('.back-row') as HTMLElement);
    const me = this.online?.you() ?? null;
    if (this.lbTab === 'round') {
      const st = this.online!.standings() ?? this.online!.info()!.standings;
      body.innerHTML = st.top.length
        ? `<p class="lb-note">Round ${st.round} · ${st.finishers} escaped of ${st.players} racing · the 3 fastest split the prize pot</p><table class="lb"><thead><tr><th>#</th><th>Robber</th><th>Time</th><th>Server</th></tr></thead><tbody>${st.top
            .map((e) => `<tr class="${e.username === me ? 'me' : ''} ${e.rank <= 3 ? 'podium' : ''}"><td>${e.rank}</td><td>${esc(e.username)}</td><td>${formatTimeMs(e.timeMs)}</td><td>${e.server + 1}</td></tr>`)
            .join('')}</tbody></table>`
        : `<div class="empty-note">No one has escaped in round ${st.round} yet.<br>The 3 fastest escapes win the prize pot.</div>`;
      return;
    }
    if (this.lbTab === 'winners' || this.lbTab === 'alltime') {
      body.innerHTML = `<div class="empty-note">Loading…</div>`;
      const lb = await this.online!.leaderboard();
      if (!lb) {
        body.innerHTML = `<div class="empty-note">Could not load the leaderboard. Try again in a moment.</div>`;
        return;
      }
      if (this.lbTab === 'alltime') {
        body.innerHTML = lb.allTime.length
          ? `<table class="lb"><thead><tr><th>#</th><th>Robber</th><th>Won</th><th>Wins</th><th>Podiums</th><th>Best time</th></tr></thead><tbody>${lb.allTime
              .map((u, i) => `<tr class="${u.username === me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(u.username)}<br><small style="opacity:.7">${esc(u.wallet)}</small></td><td>${solText(u.wonLamports)} SOL</td><td>${u.wins}</td><td>${u.podiums}</td><td>${u.bestTimeMs ? formatTimeMs(u.bestTimeMs) : '—'}</td></tr>`)
              .join('')}</tbody></table>`
          : `<div class="empty-note">No winners yet. The first round's top 3 will appear here.</div>`;
      } else {
        body.innerHTML = lb.recent.length ? `<div class="winners-list">${lb.recent.map((r) => this.roundCard(r, me)).join('')}</div>` : `<div class="empty-note">No rounds have finished yet.</div>`;
      }
      return;
    }
    const list = await this.board.top('christmas-bank', 10);
    const meLocal = this.save.data.settings.playerName;
    const s = this.save.data.stats;
    const rec = (label: string, val: string) => `<div class="record"><small>${label}</small><b>${val}</b></div>`;
    body.innerHTML = `<div class="lb-grid"><div class="lb-table">${
      list.length
        ? `<table class="lb"><thead><tr><th>#</th><th>Robber</th><th>Score</th><th>Loot</th><th>Time</th><th>Max ★</th></tr></thead><tbody>${list
            .map(
              (e: ScoreEntry, i: number) =>
                `<tr class="${e.name === meLocal ? 'me' : ''}"><td>${i + 1}</td><td>${esc(e.name)}<br><small style="opacity:.7">${esc(e.outfit)}</small></td><td>${e.score.toLocaleString('en-US')}</td><td>${formatMoney(e.loot)}</td><td>${formatTimeMs(e.timeMs)}</td><td>${e.maxStars}</td></tr>`,
            )
            .join('')}</tbody></table>`
        : `<div class="empty-note">No practice heists on record yet.<br>Pull one off to claim the top spot!</div>`
    }</div><div><h3 style="margin-top:0">Personal Records</h3><div class="records">${[
      rec('Best score', s.bestScore ? s.bestScore.toLocaleString('en-US') : '—'),
      rec('Best rank', s.bestRank >= 0 ? RANKS[s.bestRank].name : '—'),
      rec('Biggest haul', s.bestLoot ? formatMoney(s.bestLoot) : '—'),
      rec('Fastest escape', s.fastestEscapeMs ? formatTimeMs(s.fastestEscapeMs) : '—'),
      rec('Heists pulled', `${s.heistsCompleted} / ${s.heistsStarted}`),
      rec('Total stolen', formatMoney(s.totalLoot)),
      rec('Penguins bonked', String(s.guardsStunned)),
      rec('Decorations smashed', String(s.decorationsBroken)),
      rec('Presents nabbed', String(s.presents)),
      rec('Times busted', String(s.timesBusted)),
    ].join('')}</div></div></div>`;
  }

  /** One finished round: pot and the top 3 with what they were sent. */
  roundCard(r: RoundResults, me: string | null) {
    const places = ['1st', '2nd', '3rd', '4th', '5th'];
    const rows = r.winners.length
      ? r.winners
          .map((w) => {
            const link = w.signature && this.online?.explorerTx(w.signature);
            const status = w.status === 'sent' ? (link ? `<a href="${link}" target="_blank" rel="noopener">sent ↗</a>` : 'sent') : w.status === 'sending' ? 'sending…' : w.status === 'failed' ? 'retrying' : 'rolled over';
            return `<div class="wr ${w.username === me ? 'me' : ''}"><span class="pl p${w.place}">${places[w.place - 1]}</span><span class="nm">${esc(w.username)}</span><span class="tm">${formatTimeMs(w.timeMs)}</span><span class="amt">${w.lamports ? `${solText(w.lamports)} SOL` : '—'}</span><span class="st">${status}</span></div>`;
          })
          .join('')
      : `<div class="wr none">Nobody escaped — the pot rolled over.</div>`;
    return `<div class="round-card"><div class="rc-head"><b>Round ${r.round}</b><span>Pot ${solText(r.potLamports)} SOL · ${r.finishers}/${r.players} escaped</span></div>${rows}</div>`;
  }

  private renderSettings() {
    const st = this.save.data.settings;
    const body = this.screens.get('settings')!.querySelector('.settings-body') as HTMLElement;
    const q = (Object.keys(QUALITY) as QualityLevel[]).map((k) => `<button data-q="${k}" class="${st.quality === k ? 'on' : ''}">${QUALITY[k].label}</button>`).join('');
    const slider = (key: keyof Settings, min: number, max: number, step: number) => `<input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${st[key] as number}">`;
    const toggle = (key: keyof Settings) => `<div class="toggle ${st[key] ? 'on' : ''}" data-toggle="${key}"></div>`;
    body.innerHTML = `
      <h3>Graphics</h3>
      <div class="row"><span>Quality</span><div class="seg">${q}</div></div>
      <div class="row"><span>Show FPS</span>${toggle('showFps')}</div>
      <div class="row"><span>Fullscreen</span><button class="btn small" data-act="fullscreen">Toggle</button></div>
      <h3>Controls</h3>
      <div class="row"><span>Mouse sensitivity</span>${slider('sensitivity', 0.2, 2.5, 0.05)}</div>
      <div class="row"><span>Invert camera Y</span>${toggle('invertY')}</div>
      <div class="row"><span>Camera shake</span>${toggle('cameraShake')}</div>
      <h3>Audio</h3>
      <div class="row"><span>Master volume</span>${slider('masterVolume', 0, 1, 0.01)}</div>
      <div class="row"><span>Music</span>${slider('musicVolume', 0, 1, 0.01)}</div>
      <div class="row"><span>Sound effects</span>${slider('sfxVolume', 0, 1, 0.01)}</div>
      <h3>Profile</h3>
      <div class="row"><span>Robber name</span><input type="text" maxlength="16" data-key="playerName" value="${esc(st.playerName)}"></div>
      <div class="row"><span>Progress ${this.save.persistent ? 'saves automatically in this browser' : 'cannot be saved (storage blocked)'}</span><button class="btn small" data-act="reset">Reset progress</button></div>`;
    body.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) =>
      b.addEventListener('click', () => {
        st.quality = b.dataset.q as QualityLevel;
        this.audio.play('select');
        this.cb.settingsChanged(st, 'quality');
        this.renderSettings();
      }),
    );
    body.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) =>
      inp.addEventListener('input', () => {
        const key = inp.dataset.key as keyof Settings;
        (st as unknown as Record<string, number>)[key] = parseFloat(inp.value);
        this.cb.settingsChanged(st, key);
      }),
    );
    body.querySelectorAll<HTMLElement>('[data-toggle]').forEach((t) =>
      t.addEventListener('click', () => {
        const key = t.dataset.toggle as keyof Settings;
        (st as unknown as Record<string, boolean>)[key] = !st[key];
        t.classList.toggle('on', !!st[key]);
        this.audio.play('select');
        this.cb.settingsChanged(st, key);
      }),
    );
    const name = body.querySelector<HTMLInputElement>('input[type=text]')!;
    name.addEventListener('change', () => {
      st.playerName = name.value.trim().slice(0, 16) || 'Santa';
      this.cb.settingsChanged(st, 'playerName');
    });
    name.addEventListener('keydown', (e) => e.stopPropagation());
    this.wire(body);
    this.wire(this.screens.get('settings')!.querySelector('.back-row') as HTMLElement);
  }

  /** Online rounds: restart keeps the clock running, quit leaves the server. */
  setPauseMode(online: boolean) {
    const el = this.screens.get('pause')!;
    (el.querySelector('[data-act="restart"]') as HTMLElement).textContent = online ? 'RESTART RUN (CLOCK KEEPS RUNNING)' : 'RESTART HEIST';
    (el.querySelector('[data-act="quit"]') as HTMLElement).textContent = online ? 'LEAVE SERVER' : 'QUIT TO MENU';
  }

  // ---------------------------------------------------------------- results
  showResults(r: HeistResult, extra: { records: string[]; unlocks: string[] }) {
    const el = this.screens.get('results')!;
    el.classList.toggle('fail', !r.success);
    const sheet = el.querySelector('.sheet') as HTMLElement;
    const lines = r.breakdown
      .map((b, i) => `<div class="line" style="animation-delay:${0.25 + i * 0.18}s"><span>${b.label}</span><b>${formatMoney(b.value)}</b></div>`)
      .join('');
    const total = `<div class="line total" style="animation-delay:${0.3 + r.breakdown.length * 0.18}s"><span>SCORE</span><span>${r.score.toLocaleString('en-US')}</span></div>`;
    const chips = [
      ['Time', formatTimeMs(r.elapsedMs)],
      ['Max wanted', `${r.maxStars}★`],
      ['Presents', String(r.presents)],
      ['Diamonds', String(r.diamonds)],
      ['Penguins bonked', String(r.guardsStunned)],
      ['Decor smashed', String(r.decorationsBroken)],
    ]
      .map(([k, v]) => `<span class="chip">${k}: <b>${v}</b></span>`)
      .join('');
    const badges = [
      ...extra.records.map((t, i) => `<span class="badge" style="animation-delay:${1 + i * 0.15}s">${t}</span>`),
      ...extra.unlocks.map((id, i) => `<span class="badge unlock" style="animation-delay:${1.3 + i * 0.15}s">UNLOCKED: ${cosmetic(id)?.name ?? id}</span>`),
    ].join('');
    if (r.success) {
      sheet.innerHTML = `
        ${medalSvg(r.rank)}
        <h2>HEIST COMPLETE!</h2>
        <div class="rank-name">${RANKS[Math.max(0, r.rank)].name}</div>
        <div class="breakdown">${lines}${total}</div>
        <div class="stats-row">${chips}</div>
        <div class="badges">${badges}</div>
        <div class="name-entry">Sign the leaderboard as <input type="text" maxlength="16" value="${esc(this.save.data.settings.playerName)}"><button class="btn small green" data-sign>SIGN</button></div>
        <div class="btn-row"><button class="btn primary" data-act="again">PLAY AGAIN</button><button class="btn" data-act="menu">MAIN MENU</button></div>`;
      const inp = sheet.querySelector<HTMLInputElement>('.name-entry input')!;
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      const sign = sheet.querySelector<HTMLButtonElement>('[data-sign]')!;
      sign.addEventListener('click', () => {
        this.cb.submitScore(inp.value.trim().slice(0, 16) || 'Santa');
        sign.textContent = 'SIGNED!';
        sign.disabled = true;
        inp.disabled = true;
        this.audio.play('unlock');
      });
    } else {
      sheet.innerHTML = `
        <h2>${r.reason === 'timeout' ? "TIME'S UP!" : 'BUSTED!'}</h2>
        <div class="rank-name">${r.reason === 'timeout' ? 'The police surrounded the bank.' : 'The penguins caught you red-handed.'}</div>
        <p style="font-size:18px;margin:14px 0 6px">You had <b style="color:var(--gold)">${formatMoney(r.loot)}</b> in the sack.</p>
        <div class="stats-row">${chips}</div>
        <div class="badges">${badges}</div>
        <div class="btn-row"><button class="btn primary" data-act="again">TRY AGAIN</button><button class="btn" data-act="menu">MAIN MENU</button></div>`;
    }
    this.wire(sheet);
    this.show('results');
  }

  // ---------------------------------------------------------------- curtain
  curtain(show: boolean, msg = '', progress = 0) {
    this.curtainEl.classList.toggle('show', show);
    if (msg) (this.curtainEl.querySelector('.msg') as HTMLElement).textContent = msg;
    (this.curtainEl.querySelector('.bar i') as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
    if (show && progress === 0) {
      const tips = [
        'Penguins see in a cone in front of them — sneak around behind.',
        'Diving into a penguin knocks it over for a few seconds.',
        'Sprinting is fast but noisy. Walk past sleeping guards.',
        'The security terminal can switch off the laser hall for 30 seconds.',
        'A bigger sack slows you down a little — greed has a price.',
        'Push the giant golden gift onto the pressure plate to keep the gate open.',
        'Smash decorations by diving into them — coins fly everywhere.',
        'Look for the vent in the security office: it skips the laser hall.',
      ];
      (this.curtainEl.querySelector('.tip') as HTMLElement).textContent = 'Tip: ' + tips[Math.floor(Math.random() * tips.length)];
    }
  }
}
