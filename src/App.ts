import { Engine } from './core/Engine';
import { Input } from './core/Input';
import { AudioEngine } from './core/Audio';
import { SaveManager, type Settings } from './core/Save';
import { createLeaderboard, type ScoreSubmission } from './core/Leaderboard';
import { Hud } from './ui/Hud';
import { Menus, type ScreenName } from './ui/Screens';
import { MenuScene } from './menu/MenuScene';
import { Heist, RANKS, type HeistResult, type OnlineHooks } from './game/Heist';
import { Online } from './online/Online';
import { evaluateUnlocks } from './progress/cosmetics';
import { TextureLib } from './gfx/textures';
import { SKINS } from './characters/outfits';
import type { Slot } from './progress/cosmetics';

const VERSION = '1.1.0';

export class App {
  readonly save = new SaveManager();
  readonly engine: Engine;
  readonly input: Input;
  readonly audio = new AudioEngine();
  readonly board = createLeaderboard();
  readonly hud: Hud;
  readonly menus: Menus;
  readonly online: Online;
  private menuScene: MenuScene;
  heist: Heist | null = null;
  private mode: 'menu' | 'heist' = 'menu';
  private last = performance.now();
  private fpsAcc = 0;
  /** When the 'cursor lock blocked' note was first shown (-1 = not yet). */
  private lockBlockedShownAt = -1;
  private fpsFrames = 0;
  private pendingScore: ScoreSubmission | null = null;
  private expectUnlock = false;
  private loading = false;
  readonly params = new URLSearchParams(location.search);
  readonly debug: boolean;
  private fixedDt = 0;

  constructor(container: HTMLElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const app = this;
    const q = this.params.get('quality');
    if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') this.save.data.settings.quality = q;
    this.debug = this.params.has('debug');
    if (this.debug && this.params.get('dt')) this.fixedDt = Math.min(0.25, parseFloat(this.params.get('dt')!) || 0);
    this.engine = new Engine(container, this.save.data.settings.quality);
    TextureLib.anisotropy = this.engine.maxAnisotropy;
    this.input = new Input(this.engine.canvas);
    const ui = document.createElement('div');
    ui.id = 'ui';
    container.appendChild(ui);
    this.hud = new Hud(ui);
    this.menus = new Menus(ui, this.save, this.board, this.audio, {
      play: () => this.online.play(),
      coin: () => this.online.showCoin(),
      onScreen: (s) => this.onScreen(s),
      equip: (slot, id) => this.equip(slot, id),
      settingsChanged: (s, k) => this.applySettings(s, k),
      resetProgress: () => {
        this.save.resetProgress();
        this.menuScene.setOutfit(this.save.data.equipped);
      },
      resume: () => this.resume(),
      restart: () => {
        if (this.onlineRun) {
          this.resume();
          this.online.restartRun();
        } else void this.restartHeist();
      },
      quit: () => (this.onlineRun ? this.online.leave() : this.quitToMenu(true)),
      playAgain: () => void this.restartHeist(),
      toMenu: () => this.quitToMenu(false),
      submitScore: (name) => this.submitScore(name),
      fullscreen: () => this.toggleFullscreen(),
    });
    this.menuScene = new MenuScene(this.engine, this.save.data.equipped);
    this.online = new Online(
      {
        get heist() {
          return app.heist;
        },
        get inHeist() {
          return app.mode === 'heist';
        },
        startHeist: (online, onFinish, curtain) => this.startHeist(online, onFinish, curtain),
        toMenu: (screen) => this.toMenu(screen),
        practice: () => void this.practice(),
        hideCursorForPlay: () => this.input.requestPointerLock(),
      },
      this.menus,
      this.hud,
      this.audio,
    );
    this.applySettings(this.save.data.settings, 'masterVolume');
    this.hud.setFps(null);

    this.input.onPointerLockChange = (locked) => {
      if (this.mode !== 'heist' || !this.heist) return;
      if (locked) this.hud.showLockHint(null);
      else if (!this.expectUnlock && !this.heist.paused && (this.heist.state === 'play' || this.heist.state === 'intro')) this.pause();
      this.expectUnlock = false;
    };
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.engine.canvas.addEventListener('mousedown', () => {
      if (this.mode === 'heist' && this.heist?.state === 'intro' && !this.heist.paused) this.heist.skipIntro();
      if (this.mode === 'heist' && this.heist?.state === 'extract') this.heist.skipCinematic();
    });
    // first interaction unlocks audio (browser autoplay policy)
    const unlock = () => {
      this.audio.unlock();
      if (this.mode === 'menu') this.audio.setMusic('menu');
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'heist' && this.heist && !this.heist.paused && this.heist.state === 'play') this.pause();
    });
    window.addEventListener('beforeunload', (e) => {
      // guards against an accidental Ctrl+W while diving mid-heist
      if (this.mode === 'heist' && this.heist && this.heist.state !== 'done') {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  async start() {
    this.menuScene.activate();
    this.menus.show('main');
    try {
      await this.engine.renderer.compileAsync(this.menuScene.scene, this.menuScene.camera);
    } catch {
      /* ignore */
    }
    requestAnimationFrame(this.loop);
    this.online.start();
    if (this.params.has('autostart')) void this.practice();
    if (this.debug) (window as unknown as Record<string, unknown>).__heistmas = this;
  }

  private loop = () => {
    const now = performance.now();
    // ?debug&dt=0.2 fixes the timestep so slow headless test runs advance game time
    const dt = this.fixedDt > 0 ? this.fixedDt : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.mode === 'menu') this.menuScene.update(dt);
    else if (this.heist && !this.loading) this.heist.update(dt);
    this.online.update();
    if (this.mode === 'menu') this.hud.tickPot(dt);
    this.engine.render();
    this.input.endFrame();
    this.engine.trackFrameTime(dt);
    if (this.save.data.settings.showFps) {
      this.fpsAcc += dt;
      this.fpsFrames++;
      if (this.fpsAcc > 0.5) {
        this.hud.setFps(this.fpsFrames / this.fpsAcc);
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
    }
    const st = this.heist?.state;
    if (this.mode === 'heist' && this.heist && !this.heist.paused && (st === 'play' || st === 'ready' || st === 'intro')) {
      const inp = this.input;
      if (inp.pointerLocked) this.lockBlockedShownAt = -1;
      else if (!inp.pointerLockFailed) this.hud.showLockHint('ask');
      // explain once (for 8 s) that this browser can't lock the cursor
      if (!inp.pointerLocked && inp.pointerLockFailed) {
        if (this.lockBlockedShownAt < 0) this.lockBlockedShownAt = performance.now();
        this.hud.showLockHint(performance.now() - this.lockBlockedShownAt < 8000 ? 'blocked' : null);
      } else if (inp.pointerLocked) this.hud.showLockHint(null);
    } else this.hud.showLockHint(null);
    requestAnimationFrame(this.loop);
  };

  private onKey(e: KeyboardEvent) {
    if (e.code === 'Escape') {
      if (this.mode === 'heist' && this.heist) {
        if (this.heist.paused) {
          if (this.menus.active === 'settings') this.menus.back();
          else this.resume();
        } else if (this.heist.state === 'play' || this.heist.state === 'intro' || this.heist.state === 'crack' || this.heist.state === 'hack') this.pause();
      } else if (this.mode === 'menu') this.menus.back();
      return;
    }
    if (this.mode === 'heist' && this.heist?.state === 'intro' && !this.heist.paused) this.heist.skipIntro();
    if (this.mode === 'heist' && this.heist?.state === 'extract' && !this.heist.paused) this.heist.skipCinematic();
  }

  private onScreen(s: ScreenName | null) {
    if (this.mode !== 'menu') return;
    this.menuScene.setMode(s === 'customize' ? 'customize' : s === 'main' ? 'main' : 'wide');
  }

  private equip(slot: Slot, id: string) {
    this.save.data.equipped[slot] = id;
    this.save.save();
    this.menuScene.setOutfit(this.save.data.equipped);
  }

  private applySettings(s: Settings, key: keyof Settings) {
    if (key === 'quality') {
      this.engine.setQuality(s.quality);
      TextureLib.anisotropy = this.engine.maxAnisotropy;
    }
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    if (this.heist) {
      this.heist.cam.sensitivity = s.sensitivity;
      this.heist.cam.invertY = s.invertY;
      this.heist.cam.shakeEnabled = s.cameraShake;
    }
    if (!s.showFps) this.hud.setFps(null);
    this.save.save();
  }

  private toggleFullscreen() {
    const doc = document as Document & { webkitFullscreenElement?: Element };
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      void document.exitFullscreen?.();
      return;
    }
    const el = document.documentElement;
    void el
      .requestFullscreen?.()
      .then(() => {
        // In fullscreen, Chrome lets games capture Ctrl+W & friends.
        const kb = (navigator as Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void> } }).keyboard;
        void kb?.lock?.(['ControlLeft', 'ControlRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'Escape']).catch(() => {});
      })
      .catch(() => {
        /* Fullscreen refused (e.g. embedded in a sandboxed frame) — keep playing windowed. */
      });
  }

  // =============================================================== heist flow
  /** Single-player practice run (no prizes). */
  private practice() {
    this.hud.setOnline(false);
    return this.startHeist(null, null, 'Casing the joint…');
  }

  /** True while the current heist belongs to an online round. */
  private onlineRun = false;

  private async startHeist(online: OnlineHooks | null = null, onFinish: ((r: HeistResult) => void) | null = null, curtainMsg = 'Casing the joint…'): Promise<Heist | null> {
    if (this.loading) return null;
    this.loading = true;
    this.onlineRun = !!online;
    this.audio.unlock();
    this.audio.setMusic('off');
    this.menus.show(null);
    this.menus.curtain(true, curtainMsg, 0.02);
    this.hud.reset();
    await new Promise((r) => setTimeout(r, 350));
    if (this.heist) {
      this.heist.dispose();
      this.heist = null;
    }
    const s = this.save.data.settings;
    const heist = new Heist({
      engine: this.engine,
      input: this.input,
      audio: this.audio,
      hud: this.hud,
      outfit: this.save.data.equipped,
      settings: { sensitivity: s.sensitivity, invertY: s.invertY, cameraShake: s.cameraShake },
      debug: this.debug,
      skipIntro: this.params.has('skipintro') && !online,
      online: online ?? undefined,
    });
    this.heist = heist;
    await heist.init((p, label) => this.menus.curtain(true, label, p));
    heist.onFinish = (r) => {
      if (onFinish) {
        this.expectUnlock = true;
        this.input.exitPointerLock();
        this.input.gameplayActive = false;
        // after this frame: the callback may dispose the level that is mid-update
        setTimeout(() => onFinish(r), 0);
      } else this.onHeistFinished(r);
    };
    this.save.data.stats.heistsStarted++;
    this.save.save();
    this.mode = 'heist';
    this.loading = false;
    this.input.gameplayActive = true;
    this.hud.show();
    this.menus.curtain(false);
    this.engine.canvas.focus();
    this.input.requestPointerLock();
    const tp = this.params.get('tp');
    if (tp && this.debug) {
      const [x, y, z, yaw] = tp.split(',').map(Number);
      heist.skipIntro();
      setTimeout(() => heist.debugTeleport(x, y, z, Number.isFinite(yaw) ? yaw : Math.PI), 50);
    }
    this.menus.setPauseMode(!!online);
    return heist;
  }

  /** Leaves the level for the menus; `screen` null keeps whatever the caller shows next. */
  private toMenu(screen: 'main' | 'servers' | null = 'main') {
    this.expectUnlock = true;
    this.input.exitPointerLock();
    this.input.gameplayActive = false;
    this.heist?.dispose();
    this.heist = null;
    this.onlineRun = false;
    if (this.mode !== 'menu') {
      this.mode = 'menu';
      this.hud.hide();
      this.menuScene.setOutfit(this.save.data.equipped);
      this.menuScene.activate();
      this.audio.setMusic('menu');
    }
    if (screen) this.menus.show(screen);
  }

  private async restartHeist() {
    this.flushScore();
    this.heist && (this.heist.paused = false);
    await this.practice();
  }

  private pause() {
    if (!this.heist) return;
    if (this.debug) console.log('[debug] pause', new Error().stack?.split('\n').slice(1, 5).join(' | '), 'locked=', this.input.pointerLocked, 'hidden=', document.hidden);
    this.heist.paused = true;
    this.expectUnlock = true;
    this.input.exitPointerLock();
    this.input.gameplayActive = false;
    this.input.reset();
    this.menus.show('pause');
  }

  private resume() {
    if (!this.heist) return;
    this.heist.paused = false;
    this.menus.show(null);
    this.input.gameplayActive = true;
    this.input.reset();
    this.input.requestPointerLock(true);
  }

  private quitToMenu(_abandoned: boolean) {
    this.flushScore();
    this.toMenu('main');
  }

  private onHeistFinished(r: HeistResult) {
    this.expectUnlock = true;
    this.input.exitPointerLock();
    this.input.gameplayActive = false;
    const st = this.save.data.stats;
    const records: string[] = [];
    st.guardsStunned += r.guardsStunned;
    st.decorationsBroken += r.decorationsBroken;
    if (r.success) {
      st.heistsCompleted++;
      st.totalLoot += r.loot;
      st.presents += r.presents;
      st.diamonds += r.diamonds;
      if (r.score > st.bestScore) {
        if (st.bestScore > 0) records.push('NEW HIGH SCORE!');
        st.bestScore = r.score;
      }
      if (r.loot > st.bestLoot) {
        if (st.bestLoot > 0) records.push('BIGGEST HAUL!');
        st.bestLoot = r.loot;
      }
      if (st.fastestEscapeMs === null || r.elapsedMs < st.fastestEscapeMs) {
        if (st.fastestEscapeMs !== null) records.push('FASTEST ESCAPE!');
        st.fastestEscapeMs = r.elapsedMs;
      }
      if (r.rank > st.bestRank) {
        if (st.bestRank >= 0) records.push(`NEW RANK: ${RANKS[r.rank].name.toUpperCase()}`);
        st.bestRank = r.rank;
      }
      if (r.maxStars <= 2) st.stealthEscapes++;
      if (r.health >= r.maxHealth) st.fullHealthEscapes++;
      if (r.starDiamond) st.starDiamond = true;
      st.lowestStarsEscape = st.lowestStarsEscape === null ? r.maxStars : Math.min(st.lowestStarsEscape, r.maxStars);
      const outfit = SKINS[this.save.data.equipped.skin]?.name ?? 'Santa';
      this.pendingScore = {
        name: this.save.data.settings.playerName,
        heist: 'christmas-bank',
        score: r.score,
        loot: r.loot,
        timeMs: r.elapsedMs,
        maxStars: r.maxStars,
        rank: r.rank,
        outfit,
        date: Date.now(),
        clientVersion: VERSION,
      };
      this.audio.play('success');
    } else {
      st.timesBusted++;
    }
    const unlocks = evaluateUnlocks(st, this.save.data.unlocked);
    unlocks.forEach((u) => this.menus.newUnlocks.add(u));
    this.save.save();
    if (unlocks.length) setTimeout(() => this.audio.play('unlock'), 1200);
    this.audio.setMusic('menu');
    this.menus.showResults(r, { records, unlocks });
  }

  private submitScore(name: string) {
    if (!this.pendingScore) return;
    this.save.data.settings.playerName = name;
    this.save.save();
    this.pendingScore.name = name;
    void this.board.submit(this.pendingScore);
    this.pendingScore = null;
  }

  private flushScore() {
    if (this.pendingScore) {
      void this.board.submit(this.pendingScore);
      this.pendingScore = null;
    }
  }
}
