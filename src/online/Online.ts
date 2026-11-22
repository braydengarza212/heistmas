/**
 * Online play: accounts, the server browser, synchronized 5-minute rounds,
 * the live prize pot, and round results with payouts.
 *
 * Flow: PLAY → (create username → payout wallet) → pick a server → the level
 * loads and waits at the start line → GO when the round starts → escape fast.
 * Busted? Back to the start with the clock still running. When the round
 * ends, the 3 fastest verified escapes across all servers split the pot.
 */
import { api, ApiError, looksLikeSolanaAddress } from '../net/api';
import { GameClient } from '../net/GameClient';
import { Telemetry } from '../net/Telemetry';
import { loadSession, saveSession, type Session } from '../net/session';
import type { Menus, OnlineView } from '../ui/Screens';
import type { Hud } from '../ui/Hud';
import { solText } from '../ui/Hud';
import type { AudioEngine } from '../core/Audio';
import type { Heist, HeistEvent, HeistResult, OnlineHooks } from '../game/Heist';
import { formatTimeMs } from '../core/math';
import { ICON } from '../ui/icons';
import { USERNAME_RE, LAMPORTS_PER_SOL, shortWallet, type InfoResponse, type LeaderboardResponse, type RoundResults, type ServerInfo, type ServerMsg } from '../shared/protocol';

export interface OnlineApp {
  readonly heist: Heist | null;
  readonly inHeist: boolean;
  startHeist(online: OnlineHooks | null, onFinish: ((r: HeistResult) => void) | null, curtain: string): Promise<Heist | null>;
  toMenu(screen?: 'main' | 'servers' | null): void;
  practice(): void;
  hideCursorForPlay(): void;
}

type Stage = 'idle' | 'waiting' | 'racing' | 'escaped' | 'out' | 'over' | 'results' | 'late' | 'warmup' | 'building';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const PREP_MS = 9000;

export class Online implements OnlineView {
  readonly client = new GameClient();
  session: Session | null = loadSession();
  private infoCache: InfoResponse | null = null;
  private infoAt = 0;
  private infoTimer: number | null = null;
  private stage: Stage = 'idle';
  private targetRound = 0;
  private targetStart = 0;
  private targetEnd = 0;
  private attempt = 0;
  private telemetry: Telemetry | null = null;
  private myTime: { timeMs: number; rank: number | null; accepted: boolean; note?: string } | null = null;
  private goFlashUntil = 0;
  private lastRace = '';
  private regStep: 'name' | 'wallet' | 'login' = 'name';
  private regName = '';
  private regWallet = '';
  private nameCheck = 0;
  private serverMsg = '';

  constructor(
    private app: OnlineApp,
    private menus: Menus,
    private hud: Hud,
    private audio: AudioEngine,
  ) {
    menus.online = this;
    this.buildScreens();
    this.client.on((m) => this.onMessage(m));
  }

  // --------------------------------------------------------- OnlineView
  info() {
    return this.infoCache;
  }
  standings() {
    return this.client.standings ?? this.infoCache?.standings ?? null;
  }
  you() {
    return this.session?.username ?? null;
  }
  async leaderboard(): Promise<LeaderboardResponse | null> {
    try {
      return await api.leaderboard();
    } catch {
      return null;
    }
  }
  explorerTx(sig: string) {
    const tpl = this.client.config?.explorerTx ?? this.infoCache?.config.explorerTx ?? '';
    return tpl ? tpl.replace('{sig}', sig) : '';
  }
  private explorerAccount(addr: string) {
    const tpl = this.client.config?.explorerAccount ?? this.infoCache?.config.explorerAccount ?? '';
    return tpl ? tpl.replace('{addr}', addr) : '';
  }

  /** Polls the public info for the menu badge while not connected. */
  start() {
    const poll = async () => {
      if (this.client.connected) return;
      try {
        this.infoCache = await api.info();
        this.infoAt = Date.now();
      } catch {
        this.infoCache = null;
      }
      if (this.menus.active === 'main') this.menus.renderMainBadge();
      if (this.menus.active === 'servers') this.renderServers();
    };
    void poll();
    this.infoTimer = window.setInterval(poll, 10_000);
    window.setInterval(() => {
      if (this.menus.active === 'main' && this.infoCache) this.menus.renderMainBadge();
      if (this.menus.active === 'servers') this.renderServers();
    }, 1000);
    this.refreshInfo = poll;
  }

  private refreshInfo: () => Promise<void> = async () => {};

  get connected() {
    return this.client.connected;
  }

  // ---------------------------------------------------------- entry points
  play() {
    if (!this.infoCache) {
      // servers unreachable (e.g. a static-only host): explain and offer practice
      this.menus.show('servers');
      return;
    }
    if (!this.session) {
      this.regStep = 'name';
      this.menus.show('register');
      return;
    }
    this.menus.show('servers');
  }

  showCoin() {
    this.menus.show('coin');
  }

  leave() {
    this.telemetry?.stop();
    this.telemetry = null;
    this.client.close();
    this.stage = 'idle';
    this.hud.setOnline(false);
    this.hud.countdown(null);
    this.app.toMenu('main');
  }

  /** Pause menu → restart: back to the start line, clock still running. */
  restartRun() {
    if (this.stage !== 'racing') return;
    void this.newAttempt('Back to the start — the clock is still running');
  }

  // ------------------------------------------------------------ screens
  private buildScreens() {
    const reg = this.menus.addScreen('register', 'register', `<div class="sheet panel reg"><div class="reg-steps"></div><div class="reg-body"></div></div>`, () => this.renderRegister());
    void reg;
    this.menus.addScreen(
      'servers',
      'servers',
      `<div class="sheet panel srv"><h2>Choose a server</h2><div class="srv-status"></div><div class="srv-grid"></div><div class="srv-msg"></div><div class="back-row"><button class="btn small" data-x="back">BACK</button><button class="btn small" data-x="practice">PRACTICE OFFLINE</button><span class="srv-me"></span></div></div>`,
      () => {
        this.renderServers();
        void this.refreshInfo();
      },
    );
    this.menus.addScreen('coin', 'coin', `<div class="sheet panel coin-sheet"></div>`, () => this.renderCoin());
    this.menus.addScreen('round', 'round', `<div class="sheet panel round-sheet"></div>`, () => this.renderRound());

    const servers = this.menus.screenEl('servers');
    servers.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-x]');
      if (!t) return;
      this.audio.play('select');
      const x = t.dataset.x!;
      if (x === 'back') this.menus.show('main');
      else if (x === 'practice') this.app.practice();
      else if (x === 'logout') {
        this.session = null;
        saveSession(null);
        this.menus.show('main');
      } else if (x === 'join') void this.join(Number(t.dataset.id));
    });
  }

  // ---- register / login
  private renderRegister() {
    const el = this.menus.screenEl('register');
    const steps = el.querySelector('.reg-steps') as HTMLElement;
    const body = el.querySelector('.reg-body') as HTMLElement;
    const stepName = this.regStep === 'login' ? '' : `<span class="${this.regStep === 'name' ? 'on' : 'done'}">1 · Robber name</span><span class="${this.regStep === 'wallet' ? 'on' : ''}">2 · Payout wallet</span>`;
    steps.innerHTML = stepName;
    if (this.regStep === 'name') {
      body.innerHTML = `
        <h2>Pick your robber name</h2>
        <p class="reg-lead">This name is permanent. It shows on the live standings and the winners' list.</p>
        <label class="field"><span>Username</span><input id="reg-name" type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="e.g. SneakySanta" value="${esc(this.regName)}"></label>
        <div class="field-note" id="reg-name-note">3–16 letters, numbers or underscores.</div>
        <div class="btn-row"><button class="btn primary" id="reg-next">NEXT</button><button class="btn small" id="reg-back">BACK</button></div>
        <p class="reg-alt">Already have an account? <button class="linkish" id="reg-login">Log in</button></p>`;
      const inp = body.querySelector<HTMLInputElement>('#reg-name')!;
      const note = body.querySelector<HTMLElement>('#reg-name-note')!;
      const next = body.querySelector<HTMLButtonElement>('#reg-next')!;
      const check = () => {
        const v = inp.value.trim();
        this.regName = v;
        const id = ++this.nameCheck;
        if (!USERNAME_RE.test(v)) {
          note.textContent = '3–16 letters, numbers or underscores.';
          note.className = 'field-note';
          return;
        }
        note.textContent = 'Checking…';
        note.className = 'field-note';
        window.setTimeout(async () => {
          if (id !== this.nameCheck) return;
          try {
            const r = await api.usernameAvailable(v);
            if (id !== this.nameCheck) return;
            note.textContent = r.available ? `✓ ${v} is available` : 'That name is taken or reserved.';
            note.className = `field-note ${r.available ? 'ok' : 'bad'}`;
          } catch (e) {
            note.textContent = (e as Error).message;
            note.className = 'field-note bad';
          }
        }, 350);
      };
      inp.addEventListener('input', check);
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') next.click();
      });
      next.addEventListener('click', () => {
        if (!USERNAME_RE.test(inp.value.trim())) {
          note.textContent = 'Use 3–16 letters, numbers or underscores.';
          note.className = 'field-note bad';
          return;
        }
        this.audio.play('select');
        this.regName = inp.value.trim();
        this.regStep = 'wallet';
        this.renderRegister();
      });
      body.querySelector('#reg-back')!.addEventListener('click', () => this.menus.show('main'));
      body.querySelector('#reg-login')!.addEventListener('click', () => {
        this.regStep = 'login';
        this.renderRegister();
      });
      if (this.regName) check();
      setTimeout(() => inp.focus(), 50);
      return;
    }
    if (this.regStep === 'wallet') {
      const split = this.infoCache?.config.split ?? [50, 30, 20];
      body.innerHTML = `
        <h2>Where should winnings go?</h2>
        <p class="reg-lead">Paste the <b>Solana wallet address</b> that receives your prizes when you finish in the top 3. It is locked to <b>${esc(this.regName)}</b> once set, so double-check it.</p>
        <label class="field"><span>Solana address</span><input id="reg-wallet" type="text" maxlength="44" autocomplete="off" spellcheck="false" placeholder="e.g. 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" value="${esc(this.regWallet)}"></label>
        <div class="field-note" id="reg-wallet-note">Your public address only. We never ask for a recovery phrase or private key — anyone who does is scamming you.</div>
        <label class="check"><input type="checkbox" id="reg-agree"><span>I'm 18 or older and I accept the rules: each round, only the 3 fastest verified escapes win (${split.map((p) => `${p}%`).join(' / ')} of the pot), payouts are sent automatically to this address, one account per person, and cheating voids prizes. Prize games may not be allowed where you live; that's on me to check.</span></label>
        <div class="field-note bad" id="reg-error"></div>
        <div class="btn-row"><button class="btn primary" id="reg-create">CREATE ACCOUNT</button><button class="btn small" id="reg-back">BACK</button></div>`;
      const inp = body.querySelector<HTMLInputElement>('#reg-wallet')!;
      const note = body.querySelector<HTMLElement>('#reg-wallet-note')!;
      const err = body.querySelector<HTMLElement>('#reg-error')!;
      const agree = body.querySelector<HTMLInputElement>('#reg-agree')!;
      const create = body.querySelector<HTMLButtonElement>('#reg-create')!;
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      inp.addEventListener('input', () => {
        const v = inp.value.trim();
        this.regWallet = v;
        if (!v) return;
        const ok = looksLikeSolanaAddress(v);
        note.textContent = ok ? '✓ Looks like a Solana address' : 'That does not look like a Solana address (32–44 letters and numbers).';
        note.className = `field-note ${ok ? 'ok' : 'bad'}`;
      });
      body.querySelector('#reg-back')!.addEventListener('click', () => {
        this.regStep = 'name';
        this.renderRegister();
      });
      create.addEventListener('click', async () => {
        const w = inp.value.trim();
        err.textContent = '';
        if (!looksLikeSolanaAddress(w)) {
          err.textContent = 'Enter a valid Solana address.';
          return;
        }
        if (!agree.checked) {
          err.textContent = 'Please confirm you are 18+ and accept the rules.';
          return;
        }
        create.disabled = true;
        create.textContent = 'CREATING…';
        try {
          const r = await api.register(this.regName, w, true);
          this.signedIn({ token: r.token, username: r.profile.username, wallet: r.profile.wallet });
        } catch (e) {
          err.textContent = (e as Error).message;
          if (e instanceof ApiError && (e.code === 'username-taken' || e.code === 'username-invalid' || e.code === 'username-blocked')) {
            this.regStep = 'name';
            window.setTimeout(() => this.renderRegister(), 1200);
          }
          create.disabled = false;
          create.textContent = 'CREATE ACCOUNT';
        }
      });
      setTimeout(() => inp.focus(), 50);
      return;
    }
    // login
    body.innerHTML = `
      <h2>Welcome back</h2>
      <p class="reg-lead">Log in with your robber name and the payout address you registered.</p>
      <label class="field"><span>Username</span><input id="log-name" type="text" maxlength="16" autocomplete="off" spellcheck="false"></label>
      <label class="field"><span>Solana address</span><input id="log-wallet" type="text" maxlength="44" autocomplete="off" spellcheck="false"></label>
      <div class="field-note bad" id="log-error"></div>
      <div class="btn-row"><button class="btn primary" id="log-go">LOG IN</button><button class="btn small" id="log-back">BACK</button></div>`;
    const name = body.querySelector<HTMLInputElement>('#log-name')!;
    const wallet = body.querySelector<HTMLInputElement>('#log-wallet')!;
    const err = body.querySelector<HTMLElement>('#log-error')!;
    for (const i of [name, wallet]) i.addEventListener('keydown', (e) => e.stopPropagation());
    body.querySelector('#log-back')!.addEventListener('click', () => {
      this.regStep = 'name';
      this.renderRegister();
    });
    const go = body.querySelector<HTMLButtonElement>('#log-go')!;
    go.addEventListener('click', async () => {
      err.textContent = '';
      go.disabled = true;
      try {
        const r = await api.login(name.value.trim(), wallet.value.trim());
        this.signedIn({ token: r.token, username: r.profile.username, wallet: r.profile.wallet });
      } catch (e) {
        err.textContent = (e as Error).message;
      }
      go.disabled = false;
    });
    setTimeout(() => name.focus(), 50);
  }

  private signedIn(s: Session) {
    this.session = s;
    saveSession(s);
    this.audio.play('unlock');
    this.regName = '';
    this.regWallet = '';
    this.menus.show('servers');
  }

  // ---- server browser
  private renderServers() {
    const el = this.menus.screenEl('servers');
    const info = this.infoCache;
    const status = el.querySelector('.srv-status') as HTMLElement;
    const grid = el.querySelector('.srv-grid') as HTMLElement;
    const me = el.querySelector('.srv-me') as HTMLElement;
    (el.querySelector('.srv-msg') as HTMLElement).textContent = this.serverMsg;
    me.innerHTML = this.session ? `Signed in as <b>${esc(this.session.username)}</b> · prizes to ${esc(shortWallet(this.session.wallet))} · <button class="linkish" data-x="logout">Log out</button>` : '';
    if (!info) {
      status.innerHTML = `<div class="srv-off">${ICON.lock}<div><b>Game servers are offline right now.</b><br>You can still practice the heist; prizes are only for online rounds.</div></div>`;
      grid.innerHTML = '';
      return;
    }
    const pot = info.pot;
    const payable = Math.floor(((pot.lamports + pot.pendingLamports) * (100 - pot.houseCutPercent)) / 100);
    const r = info.round;
    const now = info.now + (Date.now() - this.infoAt);
    const when = r.phase === 'live' ? `Round ${r.id} is live · ${mmss(r.endsAt - now)} left${now > r.lateJoinUntil ? ' · new players join the next round' : ''}` : r.phase === 'waiting' ? `Round ${r.id} starts in ${mmss(r.startsAt - now)}` : `Round ${r.id + 1} starts in ${mmss((r.nextStartsAt ?? now) - now)}`;
    status.innerHTML = `<div class="srv-pot"><span class="pot-tag">PRIZE POT</span><b>${solText(payable)} SOL</b><span>${when} · top 3 split ${info.config.split.map((p) => p + '%').join(' / ')} · all servers race the same round</span></div>`;
    grid.innerHTML = info.servers.map((s: ServerInfo) => this.serverCard(s)).join('');
  }

  private serverCard(s: ServerInfo) {
    const pct = Math.min(100, (s.players / s.capacity) * 100);
    const full = s.players >= s.capacity;
    return `<button class="srv-card ${full ? 'full' : ''}" data-x="join" data-id="${s.id}" ${full ? 'disabled' : ''}>
      <span class="srv-name">${esc(s.name)}</span>
      <span class="srv-count">${s.players.toLocaleString('en-US')} / ${s.capacity.toLocaleString('en-US')}</span>
      <span class="srv-bar"><i style="width:${pct}%"></i></span>
      <span class="srv-join">${full ? 'FULL' : 'JOIN'}</span></button>`;
  }

  // ---- $HEISTMAS
  private renderCoin() {
    const el = this.menus.screenEl('coin').querySelector('.coin-sheet') as HTMLElement;
    const info = this.infoCache;
    const tok = info?.config.token ?? { name: 'Heistmas', symbol: 'HEISTMAS', mint: null, pumpUrl: null, links: [] };
    const pot = info?.pot;
    const split = info?.config.split ?? [50, 30, 20];
    const dev = info?.config.devWallet;
    const mins = Math.round((info?.config.roundSeconds ?? 300) / 60);
    const every = mins === 1 ? 'Every minute' : `Every ${mins} minutes`;
    const servers = info?.config.serverCount ?? 10;
    const devLink = dev ? this.explorerAccount(dev) : '';
    const stat = (label: string, val: string) => `<div class="cstat"><small>${label}</small><b>${val}</b></div>`;
    const payable = pot ? Math.floor(((pot.lamports + pot.pendingLamports) * (100 - pot.houseCutPercent)) / 100) : 0;
    const usd = pot?.solUsd ? ` ≈ $${Math.round((payable / LAMPORTS_PER_SOL) * pot.solUsd).toLocaleString('en-US')}` : '';
    el.innerHTML = `
      <div class="coin-hero">
        <div class="coin-mark">$${esc(tok.symbol)}</div>
        <div><h2>A memecoin launched on pump.fun</h2>
        <p>Every trade of $${esc(tok.symbol)} pays a small creator fee. This game claims those fees around the clock and hands them to the fastest robbers. ${every}, a new pot is up for grabs.</p></div>
      </div>
      <div class="coin-ca"><span>Contract address</span>${tok.mint ? `<code>${esc(tok.mint)}</code><button class="btn small green" id="coin-copy">COPY</button>` : `<code>Announced at launch</code>`}</div>
      <div class="coin-links">${tok.pumpUrl ? `<a class="btn small gold" href="${esc(tok.pumpUrl)}" target="_blank" rel="noopener">View on pump.fun ↗</a>` : ''}${devLink ? `<a class="btn small" href="${esc(devLink)}" target="_blank" rel="noopener">Prize wallet on Solscan ↗</a>` : ''}${tok.links
        .map((l) => `<a class="btn small" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`)
        .join('')}</div>
      ${pot ? `<div class="coin-stats">${stat('Prize pot now', `${solText(payable)} SOL${usd}`)}${stat('Paid to winners so far', `${solText(pot.paidTotalLamports)} SOL`)}${stat('Creator fees claimed', `${solText(pot.claimedTotalLamports)} SOL`)}${stat('Rounds played', String(Math.max(0, (info!.round.id ?? 1) - 1)))}</div>` : ''}
      <h3>How the prize pot works</h3>
      <ol class="coin-steps">
        <li><b>Trades pay creator fees.</b> pump.fun sends a creator fee from every $${esc(tok.symbol)} trade to the coin's creator vault.</li>
        <li><b>Fees are claimed 24/7.</b> The game server claims them into the prize wallet as soon as they're there, day and night — watch the pot grow live while you play.</li>
        <li><b>${every}, a new race.</b> All ${servers} servers run the same round. Grab $5,000 of loot, fight through all 10 stages and reach the getaway van as fast as you can.</li>
        <li><b>Top 3 get paid.</b> The 3 fastest verified escapes split the pot ${split.map((p, i) => `${['1st', '2nd', '3rd', '4th', '5th'][i]} ${p}%`).join(', ')}. It's sent automatically to their Solana address, with a public transaction link. Nobody else wins; unclaimed shares roll into the next pot.</li>
      </ol>
      <p class="coin-fine">$${esc(tok.symbol)} is a memecoin with no intrinsic value and no expectation of financial return. It is not an investment and nothing here is financial advice. You do not need to buy or hold it to play or to win. Memecoin prices are extremely volatile; never spend money you can't afford to lose. Prize games may be restricted where you live, and you must be 18 or older to win.</p>
      <div class="back-row"><button class="btn small" id="coin-back">BACK</button></div>`;
    el.querySelector('#coin-back')!.addEventListener('click', () => this.menus.show('main'));
    const copy = el.querySelector<HTMLButtonElement>('#coin-copy');
    copy?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(tok.mint!);
        copy.textContent = 'COPIED!';
      } catch {
        copy.textContent = 'SELECT & COPY';
        const code = el.querySelector('.coin-ca code')!;
        const range = document.createRange();
        range.selectNodeContents(code);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      }
      setTimeout(() => (copy.textContent = 'COPY'), 1600);
    });
  }

  // ---- round screen (late join, escaped, round over, results)
  private renderRound() {
    const el = this.menus.screenEl('round').querySelector('.round-sheet') as HTMLElement;
    const r = this.client.round;
    const now = this.client.serverNow();
    const st = this.client.standings;
    const me = this.session?.username ?? null;
    const list = st?.top.length
      ? `<ol class="rr-live">${st.top
          .map((e) => `<li class="${e.username === me ? 'me' : ''}"><b>${e.rank}</b><span>${esc(e.username)}</span><span>${formatTimeMs(e.timeMs)}</span></li>`)
          .join('')}</ol>`
      : `<div class="empty-note">No escapes yet this round.</div>`;
    const nextIn = this.nextStartAt() - now;
    let html = '';
    if (this.stage === 'results' && this.client.results) {
      html = this.resultsHtml(this.client.results.results, this.client.results.you);
    } else if (this.stage === 'escaped') {
      const t = this.myTime;
      html = `<div class="rr-head"><span class="pill green">YOU ESCAPED!</span><span>Round ${this.targetRound}</span></div>
        <div class="rr-me">${t ? (t.accepted ? `<b>${formatTimeMs(t.timeMs)}</b> · currently <b>#${t.rank ?? '—'}</b>` : `<b>${formatTimeMs(t.timeMs)}</b> · ${esc(t.note ?? 'not eligible')}`) : 'Checking your run…'}</div>
        <h3>Live standings</h3>${list}
        <div class="rr-next">Round ends in <b data-cd="end">${mmss((r?.endsAt ?? now) - now)}</b>. Winners and payouts are announced then.</div>`;
    } else if (this.stage === 'late') {
      html = `<div class="rr-head"><span class="pill">ROUND ${r?.id ?? ''} IN PROGRESS</span></div>
        <p class="rr-lead">This round started a while ago, so you'll race in <b>round ${this.targetRound}</b>. Warm up on the course while you wait — it won't count.</p>
        <h3>Live standings</h3>${list}
        <div class="rr-next">Round ${this.targetRound} starts in <b data-cd="next">${mmss(nextIn)}</b></div>`;
    } else {
      html = `<div class="rr-head"><span class="pill">ROUND ${this.targetRound} OVER</span></div>
        <p class="rr-lead">${this.stage === 'out' ? 'The clock ran out before you escaped.' : 'Tallying the results and sending the prizes…'}</p>
        <h3>Final standings</h3>${list}
        <div class="rr-next">Next round starts in <b data-cd="next">${mmss(nextIn)}</b></div>`;
    }
    const warm = this.stage === 'late' ? `<button class="btn primary" data-r="warmup">WARM UP</button>` : '';
    el.innerHTML = `${html}<div class="btn-row">${warm}<button class="btn small" data-r="leave">LEAVE SERVER</button></div>`;
    el.querySelectorAll<HTMLElement>('[data-r]').forEach((b) =>
      b.addEventListener('click', () => {
        this.audio.play('select');
        if (b.dataset.r === 'leave') this.leave();
        else if (b.dataset.r === 'warmup') void this.warmUp();
      }),
    );
  }

  private resultsHtml(res: RoundResults, you: { rank: number | null; timeMs: number | null }) {
    const places = ['1st', '2nd', '3rd', '4th', '5th'];
    const order = res.winners.length >= 3 ? [1, 0, 2] : res.winners.map((_, i) => i);
    const me = this.session?.username;
    const pods = res.winners.length
      ? order
          .map((i) => res.winners[i])
          .filter(Boolean)
          .map((w) => {
            const link = w.signature ? this.explorerTx(w.signature) : '';
            const status =
              w.status === 'sent'
                ? link
                  ? `<a href="${link}" target="_blank" rel="noopener">Sent · view transaction ↗</a>`
                  : 'Sent'
                : w.status === 'sending'
                  ? 'Sending…'
                  : w.status === 'failed'
                    ? 'Delayed — retrying automatically'
                    : 'Below minimum — rolled over';
            return `<div class="pod p${w.place} ${w.username === me ? 'me' : ''}"><div class="pod-place">${places[w.place - 1]}</div><div class="pod-name">${esc(w.username)}</div><div class="pod-time">${formatTimeMs(w.timeMs)}</div><div class="pod-amt">${w.lamports ? `+${solText(w.lamports)} SOL` : '—'}</div><div class="pod-wallet">${esc(w.wallet)}</div><div class="pod-st">${status}</div></div>`;
          })
          .join('')
      : `<div class="empty-note">Nobody escaped in time. The whole pot rolls into the next round!</div>`;
    const mine = you.rank ? (you.rank <= res.winners.length ? `You placed <b>#${you.rank}</b> — you won! Check your wallet.` : `You placed <b>#${you.rank}</b> · ${formatTimeMs(you.timeMs ?? 0)}. Only the top 3 win.`) : `You didn't escape this round.`;
    const nextIn = this.nextStartAt() - this.client.serverNow();
    return `<div class="rr-head"><span class="pill gold">ROUND ${res.round} WINNERS</span><span>Prize pot ${solText(res.potLamports)} SOL · ${res.finishers} of ${res.players} escaped</span></div>
      <div class="podium">${pods}</div>
      ${res.rolledOverLamports > 1000 ? `<div class="rr-roll">${solText(res.rolledOverLamports)} SOL rolls over into the next pot</div>` : ''}
      <div class="rr-me">${mine}</div>
      <div class="rr-next">Round ${res.round + 1} starts in <b data-cd="next">${mmss(nextIn)}</b> — stay here and you're in.</div>`;
  }

  // ------------------------------------------------------------- joining
  private async join(serverId: number) {
    if (!this.session) return this.play();
    this.serverMsg = 'Connecting…';
    this.renderServers();
    const r = await this.client.join(this.session.token, serverId);
    if (r !== 'ok') {
      const msgs: Record<string, string> = {
        offline: 'Could not reach the game servers. Try again in a moment.',
        full: 'That server is full. Pick another one.',
        auth: 'Your session expired. Please log in again.',
        version: 'The game was updated. Refresh the page to play.',
        'ip-limit': 'Too many connections from your network.',
      };
      this.serverMsg = msgs[r] ?? 'Could not join that server.';
      if (r === 'auth') {
        this.session = null;
        saveSession(null);
        this.regStep = 'login';
        this.menus.show('register');
      } else this.renderServers();
      return;
    }
    this.serverMsg = '';
    this.audio.play('unlock');
    this.hud.setOnline(true);
    this.myTime = this.client.bestMs !== null ? { timeMs: this.client.bestMs, rank: null, accepted: true } : null;
    await this.enterNextRace();
  }

  /** Decides which round we race in and gets the level ready for it. */
  private async enterNextRace() {
    const r = this.client.round!;
    const now = this.client.serverNow();
    if (r.phase === 'waiting') return this.prepare(r.id, r.startsAt, r.endsAt, true);
    if (r.phase === 'live' && now < r.lateJoinUntil && this.client.bestMs === null && r.endsAt - now > 15_000) return this.prepare(r.id, r.startsAt, r.endsAt, false);
    // too late for this round: wait for the next one
    const cfg = this.client.config!;
    const nextStart = r.phase === 'live' ? r.endsAt + cfg.intermissionSeconds * 1000 : (r.nextStartsAt ?? now + cfg.intermissionSeconds * 1000);
    this.targetRound = r.id + 1;
    this.targetStart = nextStart;
    this.targetEnd = nextStart + cfg.roundSeconds * 1000;
    if (nextStart - now <= PREP_MS + 3000) return this.prepare(this.targetRound, this.targetStart, this.targetEnd, true);
    if (r.phase === 'settling' || r.phase === 'results') {
      this.stage = this.client.results && this.client.results.results.round === r.id ? 'results' : 'over';
    } else this.stage = 'late';
    if (this.app.inHeist) this.app.toMenu(null);
    this.menus.show('round');
  }

  private nextStartAt() {
    const r = this.client.round;
    if (!r) return this.targetStart;
    if (this.stage === 'late' || this.stage === 'waiting' || this.stage === 'warmup') return this.targetStart;
    if (r.phase === 'waiting') return r.startsAt;
    if (r.phase === 'live') return r.endsAt + (this.client.config?.intermissionSeconds ?? 30) * 1000;
    return r.nextStartsAt ?? this.targetStart;
  }

  /** Builds the level for a round; holds at the start line until GO when `hold`. */
  private async prepare(round: number, startsAt: number, endsAt: number, hold: boolean) {
    this.targetRound = round;
    this.targetStart = startsAt;
    this.targetEnd = endsAt;
    this.attempt = 0;
    this.myTime = null;
    this.telemetry?.stop();
    this.telemetry = null;
    this.stage = 'building';
    this.menus.show(null);
    const heist = await this.app.startHeist(this.hooks(hold), (res) => this.onHeistFinish(res), hold ? `Round ${round} — get ready!` : `Joining round ${round}…`);
    if (!heist) return;
    if (hold && this.client.serverNow() < startsAt) {
      this.stage = 'waiting';
    } else {
      this.go(heist);
    }
  }

  private hooks(hold: boolean): OnlineHooks {
    const end = this.targetEnd;
    return {
      hold,
      title: `ROUND ${this.targetRound}`,
      roundEndsAt: () => this.client.toPerf(end),
      onEvent: (e) => this.onHeistEvent(e),
      net: this.client,
    };
  }

  /** The race is on for this player: release control and start streaming. */
  private go(heist: Heist) {
    heist.release();
    this.stage = 'racing';
    this.goFlashUntil = performance.now() + 1100;
    this.attempt++;
    const tel = new Telemetry(this.client, this.attempt, () => heist.player.feet);
    this.telemetry = tel;
    const r = this.client.round;
    if (r && r.id === this.targetRound && r.phase === 'live') tel.begin();
  }

  private async newAttempt(curtain: string) {
    this.telemetry?.stop();
    this.telemetry = null;
    this.stage = 'building';
    const heist = await this.app.startHeist(this.hooks(false), (res) => this.onHeistFinish(res), curtain);
    if (!heist) return;
    const r = this.client.round;
    if (!r || r.id !== this.targetRound || r.phase !== 'live' || this.client.serverNow() > r.endsAt - 3000) {
      this.stage = 'over';
      heist.endRound();
      return;
    }
    this.go(heist);
  }

  private async warmUp() {
    this.stage = 'warmup';
    this.menus.show(null);
    const heist = await this.app.startHeist(null, () => {
      if (this.stage === 'warmup') {
        this.stage = 'late';
        this.app.toMenu(null);
        this.menus.show('round');
      }
    }, 'Warm-up run — this one does not count');
    if (heist) heist.skipIntro();
  }

  // ------------------------------------------------------------ heist events
  private onHeistEvent(e: HeistEvent) {
    const tel = this.telemetry;
    switch (e.k) {
      case 'pickup':
        tel?.event({ k: 'pickup', v: e.v, x: e.at.x, y: e.at.y, z: e.at.z });
        break;
      case 'drop':
        tel?.event({ k: 'drop', v: e.v });
        break;
      case 'crack':
        tel?.event({ k: 'crack' });
        break;
      case 'respawn':
        tel?.event({ k: 'respawn', x: e.at.x, y: e.at.y, z: e.at.z });
        break;
      case 'extract':
        tel?.finish(e.loot);
        this.stage = 'escaped';
        this.audio.play('success');
        break;
      case 'fail':
        tel?.stop();
        break;
    }
  }

  /** The round closed while this player was still running (or still loading). */
  private roundOver() {
    this.telemetry?.stop();
    this.telemetry = null;
    this.stage = this.client.results && this.client.results.results.round === this.targetRound ? 'results' : 'over';
    this.hud.countdown(null);
    this.app.toMenu(null);
    this.menus.show('round');
    this.audio.play('fail', { volume: 0.5 });
  }

  private onHeistFinish(res: HeistResult) {
    if (this.stage === 'escaped') {
      this.app.toMenu(null);
      this.menus.show('round');
      return;
    }
    const r = this.client.round;
    const liveLeft = r && r.id === this.targetRound && r.phase === 'live' ? r.endsAt - this.client.serverNow() : 0;
    if (!res.success && res.reason === 'busted' && liveLeft > 8000) {
      void this.newAttempt('Back to the start — the clock is still running');
      return;
    }
    this.stage = this.client.results && this.client.results.results.round === this.targetRound ? 'results' : 'out';
    this.app.toMenu(null);
    this.menus.show('round');
  }

  // ------------------------------------------------------------- messages
  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'pot':
        if (m.flash && this.app.inHeist) this.hud.flashFees(m.flash);
        break;
      case 'round': {
        const r = m.round;
        if (r.id === this.targetRound && r.phase === 'live' && this.telemetry && !this.telemetry.started) this.telemetry.begin();
        if (r.id === this.targetRound && r.phase === 'settling' && (this.stage === 'racing' || this.stage === 'waiting' || this.stage === 'building')) this.roundOver();
        if (this.menus.active === 'round') this.renderRound();
        break;
      }
      case 'finish':
        this.myTime = { timeMs: m.timeMs, rank: m.rank, accepted: m.accepted, note: m.note };
        if (m.accepted) this.hud.notify(`ESCAPED IN ${formatTimeMs(m.timeMs)}`, 'star', `You're #${m.rank} so far — the round decides the winners`);
        else this.hud.notify('RUN NOT COUNTED', 'bad', m.note ?? '');
        if (this.menus.active === 'round') this.renderRound();
        break;
      case 'results':
        if (this.stage === 'escaped' || this.stage === 'out' || this.stage === 'over' || this.stage === 'late' || this.stage === 'results') {
          this.stage = 'results';
          if (!this.app.inHeist) this.menus.show('round');
        } else if (this.stage === 'warmup' && this.menus.active !== 'round') {
          this.hud.notify(`ROUND ${m.results.round} WINNERS`, 'star', m.results.winners.map((w) => `${w.place}. ${w.username} +${solText(w.lamports)} SOL`).join(' · ') || 'Nobody escaped — pot rolls over');
        }
        if (m.you.rank && m.you.rank <= m.results.winners.length) this.audio.play('unlock');
        break;
      case 'payout':
        if (this.menus.active === 'round') this.renderRound();
        break;
      case 'standings':
        if (this.menus.active === 'round' && this.stage !== 'results') this.renderRound();
        break;
      case 'error':
        if (m.code === 'phase' && (this.stage === 'racing' || this.stage === 'building')) {
          // the server would not start our run (e.g. the round just ended): sit this one out
          this.telemetry?.stop();
          this.telemetry = null;
          this.hud.notify('NOT RACING THIS ROUND', 'bad', m.msg);
          const r = this.client.round;
          if (r) {
            const cfg = this.client.config!;
            this.targetRound = r.id + 1;
            this.targetStart = r.phase === 'live' ? r.endsAt + cfg.intermissionSeconds * 1000 : (r.nextStartsAt ?? this.client.serverNow() + cfg.intermissionSeconds * 1000);
            this.targetEnd = this.targetStart + cfg.roundSeconds * 1000;
          }
          this.stage = 'late';
          this.app.toMenu(null);
          this.menus.show('round');
          break;
        }
        if (m.code === 'replaced' || m.code === 'auth' || m.code === 'version') {
          this.serverMsg = m.msg;
          this.leave();
          this.menus.show('servers');
        }
        break;
    }
  }

  // ------------------------------------------------------------ per frame
  update() {
    if (this.stage === 'idle') return;
    const c = this.client;
    const now = c.serverNow();
    if (c.pot && this.app.inHeist) this.hud.setPot(c.pot, c.pot.round);
    if (this.app.inHeist && (this.stage === 'racing' || this.stage === 'waiting' || this.stage === 'escaped')) {
      const st = c.standings && c.standings.round === this.targetRound ? c.standings : null;
      const status = this.stage === 'waiting' ? 'waiting for GO' : this.stage === 'escaped' ? 'escaped!' : 'racing…';
      const key = `${JSON.stringify(st)}|${status}|${this.myTime?.timeMs}|${this.myTime?.rank}`;
      if (key !== this.lastRace) {
        this.lastRace = key;
        this.hud.setRace(st, this.session?.username ?? null, { status, timeMs: this.myTime?.accepted ? this.myTime.timeMs : null, rank: this.myTime?.rank ?? null });
      }
    }
    switch (this.stage) {
      case 'waiting': {
        const left = this.targetStart - now;
        const heist = this.app.heist;
        if (left <= 0 && heist) {
          this.go(heist);
          this.hud.countdown('GO!', '', '');
          this.audio.play('success');
          break;
        }
        const big = left > 3500 ? mmss(left) : String(Math.ceil(left / 1000));
        this.hud.countdown(big, `ROUND ${this.targetRound} STARTS IN`, `${(c.online || c.server?.players || 0).toLocaleString('en-US')} robbers online · fastest 3 escapes split the pot`);
        break;
      }
      case 'racing':
        if (performance.now() > this.goFlashUntil) this.hud.countdown(null);
        else this.hud.countdown('GO!', '', '');
        // missed the round-end message (e.g. a reconnect): don't keep racing a closed round
        if (c.round && (c.round.id > this.targetRound || (c.round.id === this.targetRound && c.round.phase !== 'live' && now > c.round.endsAt + 3000))) this.roundOver();
        break;
      case 'late':
      case 'results':
      case 'over':
      case 'out':
      case 'escaped': {
        this.hud.countdown(null);
        const next = this.nextStartAt();
        if (this.menus.active === 'round') {
          const el = this.menus.screenEl('round');
          const cdNext = el.querySelector<HTMLElement>('[data-cd="next"]');
          if (cdNext) cdNext.textContent = mmss(next - now);
          const cdEnd = el.querySelector<HTMLElement>('[data-cd="end"]');
          if (cdEnd && c.round) cdEnd.textContent = mmss(c.round.endsAt - now);
        }
        if (this.stage !== 'escaped' && next - now < PREP_MS && next > now) {
          const cfg = c.config!;
          const id = this.stage === 'late' ? this.targetRound : (c.round?.phase === 'waiting' ? c.round.id : (c.round?.id ?? this.targetRound) + 1);
          void this.prepare(id, next, next + cfg.roundSeconds * 1000, true);
        }
        break;
      }
      case 'warmup': {
        const next = this.targetStart;
        if (next - now < PREP_MS) {
          const cfg = c.config!;
          void this.prepare(this.targetRound, next, next + cfg.roundSeconds * 1000, true);
        } else this.hud.countdown(null);
        break;
      }
    }
  }
}
