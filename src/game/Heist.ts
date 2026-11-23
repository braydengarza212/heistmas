import * as THREE from 'three';
import { RAPIER, Physics, G, groups } from './physics';
import { Player, WALK_SPEED, type PlayerInput } from './Player';
import { CameraRig } from './CameraRig';
import { Guard } from './Guard';
import { LootManager, LOOT } from './Loot';
import { Wanted, STAR_LABELS, STAR_DESCRIPTIONS } from './Wanted';
import { buildChristmasBank, type LevelData, type ZoneInfo } from './levels/ChristmasBank';
import { DebrisManager } from './heistObjects';
import { EscapeCinematic } from './getaway';
import { Arsenal, FREEZE_SECONDS, WEAPON_AMMO, WEAPONS, netIndex, type Pickup, type WeaponDef } from './Arsenal';
import { RemotePlayers } from './RemotePlayers';
import { HeartPickups, MAX_HEARTS } from './HeartPickups';
import { CHAR_SCALE } from './scale';
import type { GameClient } from '../net/GameClient';
import { ANIMS, FLAG_FROZEN, FLAG_SPRINT, NET_WEAPONS, PLAYER_FREEZE_MS, STATE_HZ, type ServerMsg } from '../shared/protocol';
import type { Mover } from './escapeObjects';
import type { Interactable } from './objects';
import { FX } from '../gfx/Particles';
import { createSky } from '../gfx/Sky';
import { sharedTime } from '../gfx/props';
import type { Engine } from '../core/Engine';
import type { Input } from '../core/Input';
import type { AudioEngine, Sfx } from '../core/Audio';
import type { Outfit } from '../characters/outfits';
import type { Hud } from '../ui/Hud';
import { VaultCrack, TerminalHack } from '../ui/minigames';
import { clamp, damp, formatMoney, lerp, easeInOutCubic } from '../core/math';

export type HeistState = 'loading' | 'intro' | 'ready' | 'play' | 'crack' | 'hack' | 'vaultOpening' | 'zip' | 'extract' | 'failing' | 'done';

/** What an online round needs to know about the run (streamed to the game server). */
export type HeistEvent =
  | { k: 'pickup'; v: number; at: THREE.Vector3 }
  | { k: 'drop'; v: number }
  | { k: 'crack' }
  | { k: 'respawn'; at: THREE.Vector3 }
  | { k: 'extract'; loot: number }
  | { k: 'fail'; reason: 'busted' | 'timeout' };

export interface OnlineHooks {
  /** Wait at the start line (world frozen) until release(). */
  hold: boolean;
  /** performance.now() time when the round's race ends. */
  roundEndsAt: () => number;
  /** Title shown while waiting, e.g. "ROUND 42". */
  title: string;
  onEvent: (e: HeistEvent) => void;
  /** Shared world: the live connection (other robbers in your bank). */
  net?: GameClient;
}

export interface HeistResult {
  success: boolean;
  reason?: 'busted' | 'timeout';
  loot: number;
  timeLeft: number;
  elapsedMs: number;
  maxStars: number;
  health: number;
  maxHealth: number;
  presents: number;
  diamonds: number;
  guardsStunned: number;
  decorationsBroken: number;
  starDiamond: boolean;
  score: number;
  breakdown: { label: string; value: number }[];
  rank: number;
}

export const RANKS = [
  { name: 'Bronze Bandit', min: 0 },
  { name: 'Silver Swindler', min: 35000 },
  { name: 'Golden Grinner', min: 60000 },
  { name: 'Platinum Phantom', min: 85000 },
];

const STAGE: Record<string, number> = { plaza: 0, lobby: 1, hall: 2, vent: 2, atrium: 3, ante: 4, vault: 5, counting: 6, deposit: 7, mint: 8, roof: 9, street: 10 };
const DOWN = new THREE.Vector3(0, -1, 0);
const ZERO_INPUT: PlayerInput = { move: new THREE.Vector2(), sprint: false, jumpPressed: false, jumpHeld: false, divePressed: false };

export interface HeistDeps {
  engine: Engine;
  input: Input;
  audio: AudioEngine;
  hud: Hud;
  outfit: Outfit;
  settings: { sensitivity: number; invertY: boolean; cameraShake: boolean };
  debug?: boolean;
  skipIntro?: boolean;
  online?: OnlineHooks;
}

export class Heist {
  readonly scene = new THREE.Scene();
  readonly physics = new Physics();
  level!: LevelData;
  player!: Player;
  readonly cam: CameraRig;
  guards: Guard[] = [];
  loot!: LootManager;
  fx!: FX;
  debris!: DebrisManager;
  readonly wanted = new Wanted();
  state: HeistState = 'loading';
  paused = false;
  t = 0;
  timeLeft = 360;
  private elapsed = 0;
  lootValue = 0;
  health = 5;
  /** Grows with hidden heart pickups (up to MAX_HEARTS). */
  maxHealth = 5;
  private hearts!: HeartPickups;
  private checkpointIdx = 0;
  private zone: ZoneInfo | null = null;
  private stage = 0;
  private interactables: Interactable[] = [];
  private focusInteract: Interactable | null = null;
  private crack: VaultCrack | null = null;
  private hack: TerminalHack | null = null;
  private sky!: ReturnType<typeof createSky>;
  private guardCC!: RAPIER.KinematicCharacterController;
  private beltItems: { item: ReturnType<LootManager['spawn']>; spawner: number }[] = [];
  private noiseT = 0;
  private comboT = 0;
  private combo = 0;
  private minLootNagT = 0;
  private cameraRadioT = 0;
  private extractT = 0;
  private extractFrom = new THREE.Vector3();
  private introT = 0;
  private failT = 0;
  private reinforced = [false, false];
  private lastTick = 0;
  private stats = { presents: 0, diamonds: 0, guardsStunned: 0, decorationsBroken: 0, starDiamond: false };
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private moveVec = new THREE.Vector2();
  private suspiciousSfxT = 0;
  onFinish: ((r: HeistResult) => void) | null = null;
  private vaultInteract!: Interactable;
  private alarmOn = false;
  readonly dbg: Record<string, unknown> = {};
  private cine: EscapeCinematic | null = null;
  private arsenal!: Arsenal;
  /** A weapon lying under the robber that would replace a loaded one (press E). */
  private swapPickup: Pickup | null = null;
  private frozenToastT = 0;
  /** Q toggles: robber always faces where the camera points */
  private camLock = false;
  /** Shared world (online only). */
  private net: GameClient | null = null;
  private remote: RemotePlayers | null = null;
  private netOff: (() => void) | null = null;
  private stateT = 0;
  private zipFeet = new THREE.Vector3();
  private shownStage = 1;
  private lightZone = '';
  private heliRadioT = 0;
  private rayO = new THREE.Vector3();

  constructor(private deps: HeistDeps) {
    this.cam = new CameraRig(this.physics);
    this.cam.sensitivity = deps.settings.sensitivity;
    this.cam.invertY = deps.settings.invertY;
    this.cam.shakeEnabled = deps.settings.cameraShake;
  }

  get hud() {
    return this.deps.hud;
  }
  get audio() {
    return this.deps.audio;
  }

  // =================================================================== init
  async init(onProgress?: (p: number, label: string) => void) {
    const { engine } = this.deps;
    const q = engine.preset;
    this.scene.environment = engine.envTexture;
    this.scene.environmentIntensity = 0.42;
    this.scene.background = new THREE.Color(0x070a1c);
    this.sky = createSky();
    this.scene.add(this.sky.mesh);
    this.fx = new FX(this.scene, q.particleScale);
    this.debris = new DebrisManager(this.physics, this.scene);
    this.loot = new LootManager(this.physics, this.fx, this.scene);
    onProgress?.(0.15, 'Casing the joint…');
    await nextFrame();
    this.level = buildChristmasBank(this.scene, this.physics, this.loot, { snow: q.snowScale });
    this.timeLeft = this.level.timeLimit;
    onProgress?.(0.55, 'Training the penguins…');
    await nextFrame();

    // player
    const sp = this.level.spawn;
    let spawnAt = sp.pos;
    if (this.deps.online) {
      // a bank holds up to 200 robbers: spread the start line across the plaza (clear floor only)
      for (let i = 0; i < 12; i++) {
        const c = sp.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 14, 0, (Math.random() - 0.5) * 6));
        const d = this.physics.rayWorld(c.clone().setY(c.y + 3), new THREE.Vector3(0, -1, 0), 6, 0xffff);
        if (d !== null && Math.abs(c.y + 3 - d - sp.pos.y) < 0.2) {
          spawnAt = c;
          break;
        }
      }
    }
    this.player = new Player(this.physics, this.scene, this.deps.outfit, spawnAt, sp.yaw);
    for (const p of this.level.platforms) this.player.platforms.set(p.id, p);
    for (const r of this.level.rideables) this.player.platforms.set(r.id, r);
    // a snowball weapon hides on every stage (the same spots for everyone in an online round)
    let seed = Math.floor(Math.random() * 1e9);
    if (this.deps.online) {
      seed = 7;
      for (const ch of this.deps.online.title) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    }
    this.arsenal = new Arsenal(this.physics, this.scene, seed, this.player.bean.root);
    // an extra-life heart hides on every other stage (never in the weapon's nook)
    this.hearts = new HeartPickups(this.scene, seed, new Map(this.arsenal.pickups.map((pk) => [pk.def.stage, pk.spot])));
    // shared world: other robbers in this bank
    const net = this.deps.online?.net;
    if (net) {
      this.net = net;
      this.remote = new RemotePlayers(this.scene, Math.round(5 + 9 * clamp(q.particleScale, 0, 1)));
      this.netOff = net.on((m) => this.onNet(m));
      const o = this.deps.outfit;
      net.send({ t: 'look', o: `${o.skin}|${o.mask}|${o.hat}|${o.sack}` });
    }
    this.hookEscapeHazards();
    this.player.events = {
      jump: () => this.sfx('jump', 0.8),
      land: (impact) => {
        if (impact > 6) {
          this.sfx('land', clamp(impact / 14, 0.3, 1));
          this.fx.dust(this.player.feet.clone().add(new THREE.Vector3(0, 0.1, 0)), Math.round(4 + impact * 0.4), 0.45);
        }
        if (impact > 15) this.cam.addTrauma(0.25);
      },
      dive: () => this.sfx('dive', 0.9),
      slide: () => this.sfx('slide', 0.9),
      knocked: () => {
        this.sfx('hit');
        this.cam.addTrauma(0.45);
      },
    };
    this.cam.setBehind(sp.yaw);
    this.cam.snap(this.player.feet.clone().add(new THREE.Vector3(0, 1.5, 0)));

    // guards
    this.guardCC = this.physics.world.createCharacterController(0.02);
    this.guardCC.setUp({ x: 0, y: 1, z: 0 });
    this.guardCC.enableAutostep(0.35, 0.2, false);
    this.guardCC.enableSnapToGround(0.3);
    this.guardCC.setSlideEnabled(true);
    for (const cfg of this.level.guards) this.addGuard(cfg);

    // loot events
    this.loot.onPickup = (e) => this.onPickup(e.item.kind, e.value, e.position);

    // wanted level
    this.wanted.onChange = (s, prev) => this.onStars(s, prev);

    // interactables
    const v = this.level.vault;
    this.vaultInteract = {
      pos: new THREE.Vector3(v.front.x, 0, -92.6),
      radius: 2.6,
      prompt: 'Crack the Vault',
      enabled: () => v.state === 'locked' && this.state === 'play',
      interact: () => this.startCrack(),
    };
    this.interactables.push(this.vaultInteract);
    const term = this.level.terminal;
    term.onUse = () => this.startHack();
    this.interactables.push(term);
    for (const vent of this.level.vents) {
      vent.onOpen = () => {
        const push = this.player.forward.multiplyScalar(5).add(new THREE.Vector3(0, 3, 0));
        vent.open(this.debris, push);
        this.sfx('clang');
        this.cam.addTrauma(0.15);
        this.noise(this.player.feet, 9);
        this.hud.notify('Vent opened', 'info', 'Secret shortcut unlocked');
      };
      this.interactables.push(vent);
    }

    this.level.vault.onBoom = () => {
      this.sfx('vault');
      this.cam.addTrauma(0.8);
      this.fx.confetti(new THREE.Vector3(0, 3, -95.5), 50);
      this.fx.glints.emit(new THREE.Vector3(0, 3, -95), { count: 40, color: [0xffd75a, 0xffffff], speed: 7, size: 0.6, life: 1.2, gravity: 2 });
    };

    // HUD
    this.hud.setHealth(this.health, this.maxHealth);
    this.hud.setLoot(0, this.level.minLoot);
    this.hud.setStars(0, false, '');
    this.hud.setTimer(this.timeLeft);
    const plaza = this.level.zones[0];
    this.hud.setObjective(plaza.objective!.title, plaza.objective!.hint);
    this.zone = plaza;
    this.level.getaway.setExtractionVisible(true);

    // view
    // gentle bloom: only genuinely bright points glow, and the halos stay tight (no screen-filling glare)
    engine.setView(this.scene, this.cam.camera, { bloomStrength: 0.22, bloomRadius: 0.25, bloomThreshold: 4.2, exposure: 1.0, aoIntensity: 0.9 });
    onProgress?.(0.75, 'Warming up the cocoa…');
    // pre-compile shaders to avoid hitches on first sight of each material
    this.cam.camera.position.set(0, 20, 40);
    this.cam.camera.lookAt(0, 0, -40);
    try {
      await engine.renderer.compileAsync(this.scene, this.cam.camera);
    } catch {
      /* compileAsync unsupported: shaders compile lazily */
    }
    onProgress?.(1, 'Ready');
    this.state = 'intro';
    this.introT = 0;
    // online rounds show the start countdown instead of a title card
    if (!this.deps.online) this.hud.titleCard('THE CHRISTMAS BANK', 'Heist No. 1 · Silent Night, Five Stars');
    this.audio.setMusic('heist');
    this.audio.setIntensity(0);
    if (this.deps.skipIntro) this.skipIntro();
  }

  private addGuard(cfg: Parameters<typeof this.makeGuard>[0], at?: THREE.Vector3) {
    const g = this.makeGuard(cfg);
    if (at) {
      g.body.setTranslation({ x: at.x, y: at.y + 0.72, z: at.z }, true);
      g.pos.copy(at);
    }
    this.guards.push(g);
    return g;
  }

  private makeGuard(cfg: LevelData['guards'][number]) {
    const g = new Guard(this.physics, this.guardCC, this.scene, cfg);
    g.events = {
      spotted: (gg) => {
        this.wanted.raiseTo(30);
        this.wanted.add(6);
        this.sfx('whistle', 1, gg.pos);
        this.sfx('spotted');
        this.hud.notify('SPOTTED!', 'bad', 'Run! Dive [Ctrl] into a penguin to bonk it');
        this.cam.addTrauma(0.15);
        for (const o of this.guards) if (o !== gg && o.pos.distanceTo(gg.pos) < 24) o.radio(this.player.feet);
      },
      suspicious: (gg) => {
        if (this.suspiciousSfxT <= 0) {
          this.sfx('suspicious', 0.8, gg.pos);
          this.suspiciousSfxT = 2.5;
        }
      },
      caught: (gg) => this.onCaught(gg),
    };
    return g;
  }

  skipIntro() {
    if (this.state !== 'intro') return;
    this.introT = 99;
  }

  /** Online rounds: the race is on. */
  release() {
    if (this.state !== 'intro' && this.state !== 'ready') return;
    this.introT = 99;
    this.state = 'play';
    this.cam.cineTarget = 0;
    this.hud.hideTitle();
    this.hud.notify('GO! GO! GO!', 'star', `Steal ${formatMoney(this.level.minLoot)}, then reach the getaway van`);
    this.announceBlaster();
    this.sfx('checkpoint', 1);
  }

  private get online() {
    return this.deps.online;
  }

  // ================================================================= update
  update(dt: number) {
    if (this.disposed || this.state === 'loading' || this.state === 'done') return;
    const input = this.deps.input;
    if (this.paused) {
      input.consumeMouse();
      return;
    }
    dt = Math.min(dt, this.deps.debug ? 0.25 : 1 / 20);
    sharedTime.value += dt;

    // mouse look (once per frame)
    const m = input.consumeMouse();
    if (this.state === 'play' || this.state === 'zip' || this.state === 'failing' || this.state === 'ready') this.cam.look(m.x, m.y);
    if (input.wheel) this.cam.zoom(input.wheel);

    // Online rounds: the world stays frozen until the race starts, so every
    // player's guards, lasers and platforms begin in the same state at GO.
    if (this.online && (this.state === 'intro' || this.state === 'ready')) {
      this.frameUpdate(dt);
      return;
    }

    // gather player input once per frame
    const inp: PlayerInput = {
      move: this.cam.moveVector(input.moveX, input.moveY, this.moveVec),
      sprint: input.sprint,
      jumpPressed: input.jumpPressed,
      jumpHeld: input.jumpHeld,
      divePressed: input.divePressed,
    };
    const interactPressed = input.interactPressed;

    const steps = Math.max(1, Math.ceil(dt / (1 / 60) - 0.01));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.fixedUpdate(h, i === 0 ? inp : { ...inp, jumpPressed: false, divePressed: false }, i === 0 && interactPressed);
      if (this.disposed) return;
      this.physics.world.timestep = h;
      this.physics.world.step();
    }
    this.frameUpdate(dt);
  }

  private fixedUpdate(h: number, inp: PlayerInput, interactPressed: boolean) {
    this.t += h;
    const t = this.t;
    const L = this.level;
    const stars = this.wanted.stars;
    const p = this.player;
    const active = this.state === 'play' || this.state === 'crack' || this.state === 'hack' || this.state === 'vaultOpening' || this.state === 'zip';

    // ---- world objects
    for (const m of L.movers) m.update(t, h);
    for (const pl of L.platforms) pl.update(t);
    for (const s of L.sweepers) s.update(h);
    for (const r of L.lasers) r.update(t, h, stars);
    L.vault.update(h);
    for (const ad of L.autoDoors) if (ad.update(h, p.feet)) this.sfx('door', 0.6, ad.center);
    const plateHeld = this.plateHeld();
    L.plate.update(h, plateHeld);
    if (plateHeld && L.gate.timer <= 0.001) this.sfx('door', 0.8, L.gate.pos);
    L.gate.update(h, plateHeld, L.gate.doorway.containsPoint(p.feet));
    for (const sh of L.shutters) if (sh.update(t, h, stars, sh.doorway.containsPoint(p.feet))) this.sfx('door', 1, sh.pos);
    for (const pb of L.pushBlocks) pb.update();
    for (const c of L.conveyors) {
      c.update(h);
      this.loot.applyConveyor(c.box, c.velocity);
    }
    this.updateBelts(h);
    for (const cam of L.cameras) cam.update(t, stars >= 3);
    L.terminal.update(t);

    // ---- player
    const playerInput = this.state === 'play' && p.iceT <= 0 ? inp : ZERO_INPUT;
    p.slowFactor = 1 - 0.15 * clamp(this.lootValue / 80000, 0, 1);
    p.faceYaw = this.camLock && this.state === 'play' ? this.cam.forwardYaw : null;
    if (this.state !== 'extract') p.update(h, playerInput);
    if (this.state === 'zip') this.updateZip(h);

    // ---- festive arsenal: walk onto a weapon to take it (E swaps a loaded one)
    this.swapPickup = null;
    this.frozenToastT -= h;
    if (this.state === 'play' && !p.knocked) {
      const pk = this.arsenal.nearby(p.feet);
      if (pk) {
        if (this.arsenal.wantsAny) this.takeWeapon(pk);
        else this.swapPickup = pk;
      }
    }
    // ---- hidden hearts: one more life
    this.hearts.update(h, p.feet);
    if (this.state === 'play' && !p.knocked) {
      const heart = this.hearts.tryPickup(p.feet);
      if (heart) this.gainHeart(heart.spot);
    }
    this.arsenal.update(h, this.guards, p.feet, {
      hitGuard: (g, dir, at, def) => {
        g.suppress(dir, FREEZE_SECONDS, def.knock);
        this.hud.pulseCrosshair('hit');
        this.stats.guardsStunned++;
        this.wanted.add(3);
        this.sfx('splat', 1, at);
        this.sfx('stun', 0.7, at);
        this.fx.snowPuff(at, 16);
        this.fx.stars(at.clone().add(new THREE.Vector3(0, 0.8, 0)));
        if (this.frozenToastT <= 0) {
          this.frozenToastT = 1.2;
          this.hud.notify('FROZEN!', 'good', `Penguin blasted — frozen for ${FREEZE_SECONDS} seconds`);
        }
      },
      hitWorld: (at, def) => {
        this.fx.snowPuff(at, def.splash > 0 ? 4 : 8);
        if (def.splash <= 0) this.sfx('splat', 0.5, at);
      },
      burst: (at, def) => {
        this.fx.snowPuff(at, 46);
        this.fx.glints.emit(at.clone().add(new THREE.Vector3(0, 0.4, 0)), { count: 40, color: [def.glow, 0xffffff], speed: 7, up: 3, size: 0.45, life: 0.9, gravity: 4 });
        this.sfx('splat', 1.3, at);
        this.sfx('crash', 0.45, at);
        if (at.distanceTo(p.center) < 14) this.cam.addTrauma(0.25);
      },
      hitPlayer: (id, _dir, at, def) => {
        this.net?.send({ t: 'hit', v: id, w: netIndex(def) });
        this.hud.pulseCrosshair('hit');
        this.sfx('splat', 1, at);
        this.fx.snowPuff(at, 14);
        if (this.frozenToastT <= 0) {
          this.frozenToastT = 1.2;
          this.hud.notify('ROBBER FROZEN!', 'good', `Rival blasted — frozen for ${PLAYER_FREEZE_MS / 1000} seconds`);
        }
      },
    }, this.remote?.targets());

    // ---- bounce pads, zipline grab
    for (const pad of L.pads) {
      pad.update(h);
      if (this.state === 'play' && !p.knocked && pad.check(p.feet, p.grounded, p.vel.y)) {
        if (pad.vertical) p.vel.set(0, 0, 0);
        p.launch(pad.power);
        this.sfx('boing', 1, pad.pos);
        this.fx.glints.emit(p.feet.clone().add(new THREE.Vector3(0, 0.3, 0)), { count: 1, color: 0x6dffa8, kind: 'ring', speed: 0, size: 2.6, life: 0.45, gravity: 0 });
        this.fx.dust(p.feet.clone(), 6, 0.5);
        this.noise(p.feet, 7);
      }
    }
    if (this.state === 'play' && !p.knocked) {
      for (const z of L.zips) {
        if (z.canGrab(p.feet)) {
          z.begin();
          this.state = 'zip';
          this.sfx('zip', 1);
          this.hud.notify('WHEEE!', 'good', 'Zipline down to the street');
          break;
        }
      }
    }

    // ---- hazards / lasers
    if (active && !p.knocked && this.state !== 'zip') this.checkHazards();

    // ---- guards
    const chest = this.tmpA.copy(p.feet).add(new THREE.Vector3(0, 1.0, 0));
    const diving = p.state === 'dive' || p.state === 'slide';
    const vulnerable = !p.knocked && p.invuln <= 0 && this.state === 'play' && !diving;
    let seen = false;
    let chased = false;
    for (const g of this.guards) {
      // dive-bonk (checked first: a well-timed dive beats a grab)
      if (diving && !g.busy && g.pos.distanceTo(p.feet) < 1.5) {
        const dir = g.pos.clone().sub(p.feet).setY(0).normalize();
        if (g.stun(dir)) {
          this.stats.guardsStunned++;
          this.wanted.add(4);
          this.sfx('stun', 1, g.pos);
          this.fx.stars(g.pos.clone().add(new THREE.Vector3(0, 1.6, 0)));
          this.cam.addTrauma(0.2);
          this.hud.notify('BONK!', 'good', 'Penguin stunned for 3 seconds');
        }
      }
      g.update(h, {
        time: t,
        playerChest: chest,
        playerFeet: p.feet,
        playerHidden: !active || this.state === 'vaultOpening',
        playerSprinting: p.sprinting,
        playerVulnerable: vulnerable,
        stars,
      });
      if (g.seesPlayer) seen = true;
      if (g.state === 'chase' || g.state === 'lunge') chased = true;
    }
    // cameras
    this.cameraRadioT -= h;
    // helicopter searchlight
    this.heliRadioT -= h;
    for (const sl of L.searchlights) {
      if (sl.lit && this.state === 'play') {
        seen = true;
        this.wanted.add(13 * h);
        if (this.heliRadioT <= 0) {
          this.heliRadioT = 2.2;
          this.sfx('beep', 1.4);
          this.hud.notify('SPOTLIGHT!', 'bad', 'The helicopter has you — keep moving!');
          for (const g of this.guards) if (g.inZone(p.feet, 8)) g.radio(p.feet);
        }
      }
    }
    for (const cam of L.cameras) {
      cam.seeing = active && this.state === 'play' && cam.sees(p.feet, t);
      if (cam.seeing) {
        seen = true;
        this.wanted.add(9 * h);
        if (this.cameraRadioT <= 0) {
          this.cameraRadioT = 1.6;
          this.sfx('beep', 1.2);
          this.hud.notify('CAMERA!', 'bad', 'Security cameras are tracking you');
          for (const g of this.guards) if (g.inZone(p.feet, 6)) g.radio(p.feet);
        }
      }
    }
    if (active) this.wanted.update(h, seen, chased);

    // ---- noise from sprinting
    this.noiseT -= h;
    if (p.sprinting && this.noiseT <= 0 && this.state === 'play') {
      this.noiseT = 0.6;
      this.noise(p.feet, stars >= 1 ? 8.5 : 6.5);
    }

    // ---- loot
    this.loot.update(h, chest.clone().add(new THREE.Vector3(0, 0.2, 0)), this.state === 'play' && !p.knocked, 2.6);

    // ---- destructibles
    if (this.state === 'play') this.checkDestructibles();

    // ---- interactions
    this.focusInteract = null;
    if (this.state === 'play' && !p.knocked) {
      let best = Infinity;
      for (const it of this.interactables) {
        if (!it.enabled()) continue;
        const d = Math.hypot(it.pos.x - p.feet.x, it.pos.z - p.feet.z);
        if (d < it.radius && Math.abs(it.pos.y - p.feet.y) < 2.6 && d < best) {
          best = d;
          this.focusInteract = it;
        }
      }
      if (this.focusInteract && interactPressed) this.focusInteract.interact();
      else if (!this.focusInteract && this.swapPickup && interactPressed) this.takeWeapon(this.swapPickup);
    }

    // ---- zones, checkpoints, extraction, kill plane
    this.updateZones();
    if (this.state === 'play' && L.getaway.inZone(p.feet)) this.tryExtract();
    if (active && p.feet.y < L.killY) this.fellOff();
    else if (active && this.state !== 'zip') {
      for (const fz of L.fallZones) {
        if (fz.box.containsPoint(p.feet)) {
          this.fellOff(fz.title, fz.label);
          break;
        }
      }
    }

    // ---- vault opening cinematic
    if (this.state === 'vaultOpening' && L.vault.state === 'open') {
      this.state = 'play';
      p.setState('move');
      this.cam.cineTarget = 0;
      this.hud.notify('VAULT OPEN!', 'star', 'Grab everything — then get out!');
      this.stage = Math.max(this.stage, 5);
      const z = L.zones.find((zz) => zz.id === 'vault')!;
      this.hud.setObjective(z.objective!.title, z.objective!.hint);
    }

    // ---- timer
    if (active) {
      if (this.online) this.timeLeft = (this.online.roundEndsAt() - performance.now()) / 1000;
      else this.timeLeft -= h;
      this.elapsed += h;
      const sec = Math.ceil(this.timeLeft);
      if (sec <= 10 && sec !== this.lastTick && sec > 0) {
        this.lastTick = sec;
        this.sfx('tick');
      }
      if (this.timeLeft <= 0) this.fail('timeout');
    }

    // ---- extraction / failing sequences
    if (this.state === 'extract') this.updateExtract(h);
    if (this.state === 'failing') {
      this.failT += h;
      if (this.failT > 2.4) this.finish(false, this.failReason);
    }
  }

  private frameUpdate(dt: number) {
    const p = this.player;
    const L = this.level;
    // intro flyover
    if (this.state === 'intro') {
      this.introT += dt;
      const k = clamp(this.introT / 4.6, 0, 1);
      const e = easeInOutCubic(k);
      const posCurve = new THREE.CatmullRomCurve3(L.intro.pos);
      const lookCurve = new THREE.CatmullRomCurve3(L.intro.look);
      this.cam.forceCinematic(posCurve.getPoint(e), lookCurve.getPoint(e));
      if (k >= 1) {
        this.cam.cineTarget = 0;
        if (this.online?.hold) {
          this.state = 'ready';
        } else {
          this.state = 'play';
          this.hud.hideTitle();
          this.hud.notify('Steal at least ' + formatMoney(L.minLoot), 'info', 'then escape over the rooftops to the getaway van');
          this.announceBlaster();
        }
      }
    }
    // camera lock (Q): the robber faces straight ahead of the camera
    if (this.state === 'play' && this.deps.input.lockPressed) {
      this.camLock = !this.camLock;
      this.hud.setCamLock(this.camLock);
      this.sfx('click', 0.6);
    }
    const armed = this.arsenal.armed;
    const aiming = this.state === 'play' && (armed || this.camLock);
    this.cam.shoulderTarget = aiming ? 1 : 0;
    this.hud.setCrosshair(this.state === 'play' && armed);
    // fire the blaster where the camera is looking
    const trigger = this.arsenal.auto ? this.deps.input.fireHeld : this.deps.input.firePressed;
    if (this.state === 'play' && !p.knocked && p.iceT <= 0 && this.arsenal.canFire && trigger) {
      const def = this.arsenal.held!;
      const cam = this.cam.camera;
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      const toi = this.physics.rayWorld(cam.position, dir, 80, G.WORLD);
      const aim = cam.position.clone().addScaledVector(dir, toi ?? 60);
      const from = this.arsenal.fire(aim);
      if (this.net) {
        const d = this.arsenal.lastDir;
        this.net.send({ t: 'shot', w: netIndex(def), o: [r2(from.x), r2(from.y), r2(from.z)], d: [r3(d.x), r3(d.y), r3(d.z)] });
      }
      this.sfx('blaster', def.pellets > 1 || def.splash > 0 ? 1.3 : 1);
      this.fx.glints.emit(from, { count: 8 + def.pellets * 2, color: [def.glow, 0xffffff], speed: 3, size: 0.25, life: 0.3, gravity: 0 });
      if (def.pellets > 1 || def.splash > 0) this.cam.addTrauma(0.12);
      this.hud.setWeapon(def, this.arsenal.ammo);
      if (this.arsenal.ammo <= 0) this.hud.notify('OUT OF SNOWBALLS', 'info', 'Another weapon is hidden on every stage');
      this.hud.pulseCrosshair('fire');
      this.noise(p.feet, 6);
    }
    // shared world: draw other robbers, stream our state
    if (this.remote && this.net) {
      this.remote.update(dt, this.net.serverNow(), this.cam.camera.position);
      this.stateT -= dt;
      if (this.stateT <= 0 && this.net.connected) {
        this.stateT = 1 / STATE_HZ;
        const anim = Math.max(0, ANIMS.indexOf(p.netAnim as (typeof ANIMS)[number]));
        const held = this.arsenal.armed ? netIndex(this.arsenal.held!) + 1 : 0;
        const flags = (p.iceT > 0 ? FLAG_FROZEN : 0) | (p.sprinting ? FLAG_SPRINT : 0);
        const f = p.knocked ? p.center.clone().setY(p.center.y - 0.4) : p.feet;
        this.net.send({ t: 'st', s: [Math.round(f.x * 10), Math.round(f.y * 10), Math.round(f.z * 10), Math.round(p.yaw * 100), anim, Math.round(p.horizontalSpeed * 10), held, flags] });
      }
      this.hud.setBank(this.net.bank?.name ?? null, this.remote.bankCount + 1);
    }
    // camera
    const focus = this.tmpB.copy(p.knocked ? p.center : p.feet).add(new THREE.Vector3(0, (p.knocked ? 0.9 : 1.55) * CHAR_SCALE, 0));
    this.cam.update(dt, focus, p.horizontalSpeed, p.sprinting, p.state === 'dive' || p.state === 'slide');

    // sun shadow follows the player — or the van during the getaway (snapped to reduce shimmer)
    const sun = L.sun;
    const snap = 0.5;
    const sf = this.state === 'extract' ? L.getaway.rig.root.position : p.feet;
    const fx = Math.round(sf.x / snap) * snap;
    const fz = Math.round(sf.z / snap) * snap;
    sun.target.position.set(fx, sf.y, fz);
    sun.position.set(fx + 14, sf.y + 40, fz + 12);
    this.updateEscapeVisuals(dt);

    // alarm light & beacons
    const stars = this.wanted.stars;
    const alarm = stars >= 3;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * (stars >= 5 ? 9 : 6));
    L.alarmLight.intensity = alarm ? 18 + pulse * (stars >= 5 ? 70 : 45) : 0;
    L.alarmLight.position.set(p.feet.x + 2, p.feet.y + 6, p.feet.z + 2);
    for (const b of L.alarmBeacons) {
      b.rotation.y += dt * 6;
      const lamp = b.children[1] as THREE.Mesh;
      lamp.material = alarm && pulse > 0.5 ? (lampOn ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 0.4, 0.4) })) : (lampOff ??= new THREE.MeshBasicMaterial({ color: 0x551015 }));
    }

    // ambient FX
    const vh = this.deps.engine.renderer.domElement.height;
    for (const s of L.snow) s.update(this.t, this.cam.camera, vh);
    this.sky.uniforms.uTime.value = this.t;
    this.fx.update(dt, this.cam.camera, vh);
    this.debris.update(dt);
    L.getaway.update(dt);
    for (const a of L.animated) a(this.t, dt);
    for (const hook of L.fxHooks) hook(this.t, dt, this.fx);
    L.smoke.update(dt, this.cam.camera, vh);
    if (p.wantsDust()) this.fx.dust(p.feet.clone().add(new THREE.Vector3(0, 0.15, 0)), 2, 0.35);
    this.suspiciousSfxT -= dt;
    this.comboT -= dt;
    this.minLootNagT -= dt;

    // HUD
    if (this.online && this.state !== 'done') this.timeLeft = Math.max(0, (this.online.roundEndsAt() - performance.now()) / 1000);
    this.hud.setTimer(this.timeLeft);
    this.hud.setStars(stars, this.wanted.cooling, STAR_LABELS[stars]);
    this.hud.prompt(this.focusInteract ? this.focusInteract.prompt : this.swapPickup ? `Swap for ${this.swapPickup.def.name}` : null);
    this.hud.setVignette(alarm ? 0.25 + pulse * 0.25 : this.health <= 1 ? 0.35 : 0, alarm ? 'alarm' : 'hurt');
    this.hud.update(dt, this.cam.camera);
    this.audio.setIntensity(stars);
    // minigames read edge-triggered input, so they tick once per frame
    if (this.state === 'crack' && this.crack) {
      this.crack.update(dt);
      this.crack?.render();
    }
    if (this.state === 'hack' && this.hack) this.hack.update(dt);
  }

  // ============================================================ mechanics
  private sfx(name: Sfx, volume = 1, at?: THREE.Vector3) {
    let pan = 0;
    let vol = volume;
    if (at) {
      const c = this.cam.camera;
      const rel = at.clone().sub(c.position);
      const dist = rel.length();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(c.quaternion);
      pan = clamp(rel.normalize().dot(right), -0.8, 0.8);
      vol *= clamp(1.4 - dist / 26, 0.05, 1);
    }
    this.audio.play(name, { volume: vol, pan });
  }

  private noise(at: THREE.Vector3, loudness: number) {
    for (const g of this.guards) g.hear(at, loudness, this.wanted.stars);
  }

  private plateHeld() {
    const L = this.level;
    const pp = L.plate.pos;
    const p = this.player.feet;
    if (Math.hypot(p.x - pp.x, p.z - pp.z) < L.plate.radius + 0.2 && Math.abs(p.y - pp.y) < 0.6) return true;
    for (const b of L.pushBlocks) {
      const bp = b.position;
      if (Math.hypot(bp.x - pp.x, bp.z - pp.z) < L.plate.radius + 0.25 && bp.y < pp.y + 1.4) return true;
    }
    return false;
  }

  private checkHazards() {
    const p = this.player;
    if (p.invuln > 0) return;
    // kinematic hazards (sweepers) via shape intersection
    const c = p.center;
    const shape = new RAPIER.Capsule(p.isCrouched ? 0.02 : 0.35, p.radius + 0.08);
    let hit: THREE.Vector3 | null = null;
    this.physics.world.intersectionsWithShape(
      { x: c.x, y: c.y, z: c.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      (col) => {
        const tag = this.physics.tagOf(col);
        if (tag && tag.kind === 'hazard') {
          const sw = this.level.sweepers.find((s) => s.id === tag.id);
          if (sw) hit = sw.knock(p.feet);
          return false;
        }
        return true;
      },
      undefined,
      groups(0xffff, G.HAZARD),
    );
    if (hit) {
      if (p.knock(hit)) {
        this.fx.stars(p.center.clone());
        this.hud.notify('WHACK!', 'bad');
      }
      return;
    }
    // escape-stage movers (drawers, presses, steam, traffic)
    {
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const r = p.capsule(a, b);
      for (const m of this.level.movers) {
        const k = m.test(a, b, r);
        if (!k) continue;
        if (p.knock(k)) this.moverHit(m);
        return;
      }
    }
    // static hazards (wrap machines)
    for (const hz of this.level.hazards) {
      if (hz.box.containsPoint(p.feet) || hz.box.containsPoint(c)) {
        if (p.knock(hz.knock(p.feet))) {
          this.hurt(hz.damage, hz.label);
          if (hz.dropLoot) this.dropLoot(0.1);
        }
        return;
      }
    }
    // lasers
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const r = p.capsule(a, b);
    for (const rig of this.level.lasers) {
      for (const beam of rig.beams) {
        if (beam.hits(a, b, r)) {
          this.laserHit(beam.a.clone().lerp(beam.b, 0.5), rig.zone);
          return;
        }
      }
    }
  }

  private laserHit(beamMid: THREE.Vector3, _zone: string) {
    const p = this.player;
    const away = p.feet.clone().sub(beamMid).setY(0);
    if (away.lengthSq() < 0.01) away.copy(p.forward).multiplyScalar(-1);
    away.normalize().multiplyScalar(3.5);
    away.y = 5.5;
    if (!p.knock(away)) return;
    this.sfx('zap');
    this.fx.zap(p.center.clone());
    this.wanted.add(14);
    this.hurt(1, 'Laser');
    this.hud.flash('red');
    this.hud.notify('ALARM TRIPPED!', 'bad', 'Lasers raise your wanted level');
    this.noise(p.feet, 14);
  }

  private hurt(amount: number, reason: string) {
    if (this.state !== 'play' && this.state !== 'crack' && this.state !== 'hack') return;
    this.health = Math.max(0, this.health - amount);
    this.hud.setHealth(this.health, this.maxHealth, true);
    void reason;
    if (this.health <= 0) this.fail('busted');
  }

  private dropLoot(frac: number) {
    if (this.lootValue <= 0) return 0;
    const amount = Math.floor(Math.min(this.lootValue, Math.max(300, Math.round((this.lootValue * frac) / 100) * 100)) / 100) * 100;
    if (amount <= 0) return 0;
    const dropped = this.loot.burst(this.player.center.clone().add(new THREE.Vector3(0, 0.6, 0)), amount, 0.8, 12);
    this.lootValue -= dropped;
    if (dropped > 0) this.online?.onEvent({ k: 'drop', v: dropped });
    this.updateLootVisual();
    if (dropped > 0) this.hud.floatText(this.player.center.clone().add(new THREE.Vector3(0, 1.8, 0)), '-' + formatMoney(dropped), '#ff6b7a');
    return dropped;
  }

  private onCaught(g: Guard) {
    const p = this.player;
    if (p.knocked || p.invuln > 0 || this.state !== 'play') return;
    const dir = p.feet.clone().sub(g.pos).setY(0).normalize().multiplyScalar(6);
    dir.y = 6.5;
    p.knock(dir, true);
    const dropped = this.dropLoot(0.15);
    this.wanted.add(5);
    this.sfx('whistle', 1, g.pos);
    this.hurt(1, 'Caught');
    this.hud.flash('red');
    this.hud.notify('NABBED!', 'bad', dropped > 0 ? `Dropped ${formatMoney(dropped)} — grab it back!` : 'Keep away from the penguins!');
  }

  private onPickup(kind: keyof typeof LOOT, value: number, at: THREE.Vector3) {
    const info = LOOT[kind];
    if (kind === 'cocoa') {
      if (this.health < this.maxHealth) {
        this.health++;
        this.hud.setHealth(this.health, this.maxHealth);
      }
      this.sfx('heal');
      this.hud.notify('Hot Cocoa!', 'good', '+1 health');
      return;
    }
    this.comboT > 0 ? this.combo++ : (this.combo = 0);
    this.comboT = 0.7;
    const pitch = 1 + Math.min(this.combo, 10) * 0.06;
    const sfx: Sfx = kind === 'coin' || kind === 'cash' ? 'coin' : kind === 'present' || kind === 'moneyBag' ? 'present' : kind === 'diamond' || kind === 'starDiamond' ? 'diamond' : 'gold';
    this.sfx(sfx, 1);
    if (pitch > 1 && sfx === 'coin') this.audio.play('coin', { pitch, volume: 0.4 });
    this.lootValue += value;
    this.online?.onEvent({ k: 'pickup', v: value, at });
    if (kind === 'present' || kind === 'goldPresent') this.stats.presents++;
    if (kind === 'diamond' || kind === 'starDiamond') this.stats.diamonds++;
    if (kind === 'starDiamond') {
      this.stats.starDiamond = true;
      this.wanted.add(10);
      this.cam.addTrauma(0.3);
      this.hud.notify('THE STAR OF THE NORTH!', 'star', '+' + formatMoney(value));
    } else if (info.big) {
      this.hud.notify(info.label, 'loot', '+' + formatMoney(value));
    }
    this.wanted.add((value / 1000) * 0.3);
    this.hud.floatText(at.clone().add(new THREE.Vector3(0, 1.2, 0)), '+' + formatMoney(value), info.big ? '#ffd75a' : '#ffffff');
    this.player.bean.onPickup(info.big);
    this.updateLootVisual();
  }

  private updateLootVisual() {
    this.player.bean.setLoot(clamp(this.lootValue / 70000, 0, 1));
    this.hud.setLoot(this.lootValue, this.level.minLoot);
  }

  private checkDestructibles() {
    const p = this.player;
    const smashing = p.state === 'dive' || p.state === 'slide' || p.knocked || (p.sprinting && p.horizontalSpeed > 8.5);
    if (!smashing) return;
    const pos = p.knocked ? p.center : p.feet;
    for (const d of this.level.destructibles) {
      if (d.broken) continue;
      const dist = Math.hypot(pos.x - d.pos.x, pos.z - d.pos.z);
      if (dist < d.radius + 0.8 && pos.y > d.pos.y - 0.8 && pos.y < d.pos.y + 2.6) {
        const dir = new THREE.Vector3(d.pos.x - pos.x, 0, d.pos.z - pos.z).normalize();
        const gifts = d.break(this.debris, dir);
        this.stats.decorationsBroken++;
        const center = d.pos.clone().add(new THREE.Vector3(0, 0.8, 0));
        this.fx.shards(center, d.colors, 22);
        this.sfx(d.kind === 'goldPile' ? 'gold' : 'crash', 1, d.pos);
        this.cam.addTrauma(0.15);
        if (d.coinValue > 0) this.loot.burst(center, d.coinValue, 0.25, d.kind === 'goldPile' ? 12 : 4);
        for (const gp of gifts) this.loot.spawn('present', gp, new THREE.Vector3((Math.random() - 0.5) * 4, 4, (Math.random() - 0.5) * 4), 0.3);
        this.noise(d.pos, 12);
        this.wanted.add(d.kind === 'goldPile' ? 1 : 3);
      }
    }
  }

  private updateBelts(h: number) {
    const L = this.level;
    L.beltSpawners.forEach((s, idx) => {
      s.timer -= h;
      const alive = this.beltItems.filter((b) => b.spawner === idx && !b.item.collected).length;
      if (s.timer <= 0 && alive < 4) {
        s.timer = 2.4 + Math.random() * 1.6;
        const kind = s.kinds[Math.floor(Math.random() * s.kinds.length)];
        const it = this.loot.spawn(kind, s.start.clone(), new THREE.Vector3(0, -2, 0));
        this.beltItems.push({ item: it, spawner: idx });
        this.fx.dust(s.start.clone(), 3, 0.4);
      }
    });
    for (let i = this.beltItems.length - 1; i >= 0; i--) {
      const b = this.beltItems[i];
      if (b.item.collected || !b.item.body) {
        this.beltItems.splice(i, 1);
        continue;
      }
      const s = L.beltSpawners[b.spawner];
      if (s.end.containsPoint(b.item.visual.position)) {
        // eaten by the Wrap-o-Matic
        this.fx.dust(b.item.visual.position.clone(), 4, 0.5);
        this.physics.removeBody(b.item.body);
        b.item.body = null;
        b.item.collected = true;
        b.item.collecting = 1;
        b.item.visual.visible = false;
        this.beltItems.splice(i, 1);
      }
    }
  }

  private updateZones() {
    const L = this.level;
    const p = this.player.feet;
    // checkpoints (only advance)
    for (let i = this.checkpointIdx + 1; i < L.checkpoints.length; i++) {
      if (L.checkpoints[i].box.containsPoint(p)) {
        this.checkpointIdx = i;
        if (i > 0) {
          this.sfx('checkpoint', 0.7);
          this.hud.notify('Checkpoint', 'info');
        }
        break;
      }
    }
    const z = L.zones.find((zz) => zz.box.containsPoint(p)) ?? null;
    if (z && z !== this.zone) {
      this.zone = z;
      this.hud.zoneLabel(z.name);
      const st = STAGE[z.id] ?? 0;
      const vaultOpen = L.vault.state === 'open' || L.vault.state === 'opening';
      if (st > this.stage && z.objective && !(z.id === 'ante' && vaultOpen)) {
        this.stage = st;
        this.hud.setObjective(z.objective.title, z.objective.hint);
      }
      const info = L.stageInfo[z.id];
      if (info && info.n > this.shownStage && st >= this.stage) {
        this.shownStage = info.n;
        if (info.n >= 2) {
          this.hud.stageBanner(info.n, 10, z.name, info.difficulty);
          const pk = this.arsenal.pickupForStage(info.n);
          if (pk) this.hud.notify(`HIDDEN HERE: ${pk.def.name}`, 'star', `${pk.def.kind} — ${pk.def.blurb}`);
          if (this.hearts.forStage(info.n)) this.hud.notify('A HEART IS HIDDEN HERE', 'good', 'Find it for an extra life');
        }
        if (info.wantedFloor) this.wanted.setFloor(info.wantedFloor);
        if (info.n >= 7) this.sfx('checkpoint', 0.8);
      }
    }
  }

  private fellOff(title = 'Whoops!', label = 'Back to the last checkpoint') {
    const cp = this.level.checkpoints[this.checkpointIdx];
    this.hud.flash('dark');
    this.sfx('hit', 0.6);
    if (title === 'MELTED!') {
      this.fx.glints.emit(this.player.feet.clone().setY(-1.0), { count: 30, color: [0xffc84a, 0xff7a1a, 0xffffff], speed: 6, up: 5, size: 0.35, life: 0.8, gravity: 9 });
      this.sfx('zap', 0.8);
    }
    this.hurt(1, label);
    if (this.health <= 0) return;
    this.online?.onEvent({ k: 'respawn', at: cp.pos });
    this.player.teleport(cp.pos, cp.yaw);
    this.player.invuln = 1.5;
    this.cam.setBehind(cp.yaw);
    this.cam.snap(cp.pos.clone().add(new THREE.Vector3(0, 1.5, 0)));
    this.hud.notify(title, 'bad', title === 'Whoops!' ? label : `${label} — back to the last checkpoint`);
  }

  // ------------------------------------------------------------ minigames
  private startCrack() {
    if (this.state !== 'play') return;
    const v = this.level.vault;
    v.state = 'cracking';
    this.state = 'crack';
    const p = this.player;
    p.setState('interact');
    const dialWorld = new THREE.Vector3(v.center.x + v.R * 0.5, v.center.y + v.R * 0.42, v.center.z + 0.6);
    p.faceTowards(dialWorld);
    this.cam.setCinematic(new THREE.Vector3(dialWorld.x + 2.6, 2.6, dialWorld.z + 4.6), dialWorld.clone().add(new THREE.Vector3(-0.6, -0.6, 0)));
    this.crack = new VaultCrack(this.deps.input, this.audio);
    this.crack.onDial = (a) => v.setDial(a);
    this.crack.onMiss = () => {
      this.wanted.add(6);
      this.cam.addTrauma(0.2);
      this.noise(p.feet, 10);
    };
    this.crack.onSuccess = () => this.vaultCracked();
    this.crack.onCancel = () => {
      v.state = 'locked';
      this.state = 'play';
      p.setState('move');
      this.cam.cineTarget = 0;
      this.crack = null;
    };
    this.crack.start();
  }

  private vaultCracked() {
    const v = this.level.vault;
    this.crack = null;
    this.online?.onEvent({ k: 'crack' });
    this.state = 'vaultOpening';
    this.cam.setCinematic(new THREE.Vector3(7.5, 4.2, -84.5), new THREE.Vector3(0, 2.6, -96));
    v.open();
    this.wanted.setFloor(50);
    this.wanted.pressure = 0.32;
    this.hud.notify('VAULT CRACKED!', 'star', 'Alarms are blaring — move fast');
  }

  private startHack() {
    const term = this.level.terminal;
    if (this.state !== 'play' || term.used) return;
    this.state = 'hack';
    this.player.setState('interact');
    this.player.faceTowards(term.pos);
    this.hack = new TerminalHack(this.deps.input, this.audio);
    this.hack.onDone = (ok) => {
      this.hack = null;
      this.state = 'play';
      this.player.setState('move');
      if (ok) {
        term.used = true;
        term.setState('granted');
        const until = this.t + 30;
        for (const r of this.level.lasers) if (r.zone === 'hall') r.disabledUntil = until;
        for (const c of this.level.cameras) c.disabledUntil = until;
        this.wanted.reduce(20);
        this.sfx('success', 0.6);
        this.hud.notify('SECURITY OFFLINE', 'good', 'Hall lasers & cameras down for 30 seconds');
      } else {
        term.setState('locked');
        this.wanted.add(15);
        this.sfx('fail');
        this.hud.notify('HACK FAILED', 'bad', 'Terminal locked for 10 seconds');
        setTimeout(() => {
          if (!term.used) term.setState('ready');
        }, 10000);
        term.used = true;
        setTimeout(() => (term.used = false), 10000);
      }
    };
    this.hack.start();
  }

  // ------------------------------------------------------------ wanted
  private onStars(s: number, prev: number) {
    if (s > prev) {
      this.sfx('star');
      this.hud.notify('★'.repeat(s) + '  ' + STAR_LABELS[s], 'star', STAR_DESCRIPTIONS[s]);
    }
    const alarm = s >= 3;
    if (alarm !== this.alarmOn) {
      this.alarmOn = alarm;
      this.audio.setSiren(alarm, s >= 5);
    } else if (alarm) this.audio.setSiren(true, s >= 5);
    if (s >= 4 && !this.reinforced[0]) {
      this.reinforced[0] = true;
      this.spawnReinforcements(2);
    }
    if (s >= 5 && !this.reinforced[1]) {
      this.reinforced[1] = true;
      this.spawnReinforcements(2);
      for (const g of this.guards) if (g.inZone(this.player.feet, 4)) g.alert(this.player.feet);
    }
  }

  private spawnReinforcements(n: number) {
    const order = ['lobby', 'vault', 'counting', 'deposit', 'mint', 'roof', 'street'];
    const zid = this.zone?.id ?? 'lobby';
    let idx = order.indexOf(zid === 'ante' || zid === 'atrium' ? 'vault' : zid === 'hall' || zid === 'vent' || zid === 'plaza' ? 'lobby' : zid);
    if (idx < 0) idx = 0;
    for (let i = 0; i < n; i++) {
      const r = this.level.reinforcements.find((rr) => rr.zoneId === order[Math.min(order.length - 1, idx + i)]);
      if (!r) continue;
      const g = this.addGuard({ route: r.route, zone: r.zone, elite: true, wait: 0.8, name: 'elite' }, r.spawn);
      this.fx.dust(r.spawn.clone().add(new THREE.Vector3(0, 0.5, 0)), 14, 0.9);
      if (g.inZone(this.player.feet, 2)) g.alert(this.player.feet);
    }
    this.hud.notify('REINFORCEMENTS!', 'bad', 'Elite penguins have arrived');
    this.sfx('whistle', 1);
  }

  // ------------------------------------------------------------ endings
  private tryExtract() {
    if (this.lootValue < this.level.minLoot) {
      if (this.minLootNagT <= 0) {
        this.minLootNagT = 3;
        this.hud.notify('Not worth the gas!', 'bad', `Steal at least ${formatMoney(this.level.minLoot)} first`);
        this.sfx('fail', 0.5);
      }
      return;
    }
    this.state = 'extract';
    this.online?.onEvent({ k: 'extract', loot: this.lootValue });
    this.extractT = 0;
    this.extractFrom.copy(this.player.feet);
    this.player.setState('frozen');
    this.audio.setSiren(false);
    this.hud.prompt(null);
    const L = this.level;
    L.getaway.setExtractionVisible(false);
    for (const t of L.trucks) t.freeze();
    // the cops on the street lose track of you: no cones or alert icons in the movie
    for (const g of this.guards) {
      g.cone.fan.visible = false;
      g.cone.beam.visible = false;
      g.model.root.visible = g.pos.distanceTo(L.getaway.pos) > 12;
    }
    const p = this.player;
    this.cine = new EscapeCinematic({
      van: L.getaway,
      chase: L.chasePolice,
      parked: L.parkedPolice,
      tracks: L.tracks,
      smoke: L.smoke,
      shot: (pos, look, fov) => {
        this.cam.forceCinematic(pos, look);
        this.cam.fovOverride = fov;
      },
      bean: {
        root: p.bean.root,
        setVisible: (v) => p.bean.setVisible(v),
        pose: (dt) => p.bean.update(dt, { state: 'dive', speed: 6, maxSpeed: 10, vy: 0, turnRate: 0, sprinting: false, accel: 0 }),
      },
      blob: p.blob,
      sfx: (name, volume, at) => this.sfx(name, volume, at),
      siren: (on) => this.audio.setSiren(on, true),
      title: (title, sub) => this.hud.titleCard(title, sub),
      heli: L.searchlights[0] ?? null,
      headlight: L.spot,
      policeLight: L.lightPool[1] ?? null,
      shake: (a) => this.cam.addTrauma(a),
      snowBurst: (at, n) => {
        this.fx.snowPuff(at, Math.round(n * 0.4));
        L.smoke.emit(at, { count: n, color: 0xffffff, kind: 'puff', speed: 6, up: 3, spread: 1, size: 1.4, life: 1.6, gravity: 5, drag: 2, radius: 0.8 });
      },
    });
    this.cine.start(this.player.feet);
    this.hud.setCinematic(true);
  }

  /** Shared-world messages from the server. */
  private onNet(m: ServerMsg) {
    const r = this.remote;
    if (!r) return;
    switch (m.t) {
      case 'ros':
        r.roster(m.add, m.del);
        break;
      case 'pl':
        r.snapshot(m.ts, m.n, m.p);
        break;
      case 'shot': {
        const from = new THREE.Vector3(m.o[0], m.o[1], m.o[2]);
        const def = this.arsenal.fireVisual(m.w, from, new THREE.Vector3(m.d[0], m.d[1], m.d[2]));
        if (def) this.sfx('blaster', 0.55, from);
        break;
      }
      case 'hitby': {
        const p = this.player;
        const def = WEAPONS.find((d) => d.id === NET_WEAPONS[m.w]?.id) ?? WEAPONS[0];
        if (p.snowFreeze(new THREE.Vector3(m.dx, 0, m.dz), def.knock, PLAYER_FREEZE_MS / 1000)) {
          this.sfx('splat', 1.2);
          this.sfx('stun', 0.9);
          this.fx.snowPuff(p.center.clone(), 24);
          this.cam.addTrauma(0.35);
          this.hud.notify(`FROZEN BY ${m.by}!`, 'bad', `${def.name} — you're stuck in ice for ${PLAYER_FREEZE_MS / 1000} seconds`);
        }
        break;
      }
    }
  }

  /** A hidden heart: one more heart slot, filled. */
  private gainHeart(at: THREE.Vector3) {
    const before = this.maxHealth;
    this.maxHealth = Math.min(MAX_HEARTS, this.maxHealth + 1);
    this.health = Math.min(this.maxHealth, this.health + 1);
    this.hud.setHealth(this.health, this.maxHealth);
    this.sfx('heal');
    this.sfx('unlock', 0.6);
    this.fx.glints.emit(at.clone().add(new THREE.Vector3(0, 0.8, 0)), { count: 34, color: [0xff4d6d, 0xffffff], speed: 4.5, up: 2.5, size: 0.4, life: 0.9, gravity: 2 });
    this.hud.notify('EXTRA LIFE!', 'good', this.maxHealth > before ? `+1 heart — you now have ${this.maxHealth} hearts` : '+1 heart');
  }

  private takeWeapon(pk: Pickup) {
    const p = this.player;
    this.arsenal.take(pk);
    const def: WeaponDef = pk.def;
    this.sfx('unlock');
    this.fx.glints.emit(p.center.clone(), { count: 30, color: [def.glow, 0xffffff], speed: 5, up: 2, size: 0.4, life: 0.8, gravity: 3 });
    this.hud.notify(`${def.name}!`, 'star', `${def.kind} · ${this.arsenal.ammo} snowballs — [F] or click${def.auto ? ' (hold)' : ''} to fire`);
    this.hud.setWeapon(def, this.arsenal.ammo);
  }

  private announceBlaster() {
    this.hud.announce(
      'A WEAPON IS HIDDEN ON EVERY STAGE',
      'FESTIVE ARSENAL',
      `Starting with the Frosty Blaster, hidden somewhere in this plaza. Every gun fires snowballs and holds ${WEAPON_AMMO} shots: blast penguin guards back and freeze them for ${FREEZE_SECONDS} seconds! Every other stage also hides a heart that gives you an extra life.`,
      7,
    );
  }

  /** Any key once the getaway has started (but not in the first second). */
  skipCinematic() {
    if (this.state === 'extract' && this.cine && this.cine.t > 1.2) this.cine.skip();
  }

  private updateExtract(h: number) {
    this.extractT += h;
    if (!this.cine) return;
    if (this.cine.update(h)) {
      this.cam.fovOverride = null;
      this.hud.setCinematic(false);
      this.finish(true);
    }
  }

  // ------------------------------------------------------------ escape stages
  private hookEscapeHazards() {
    const L = this.level;
    for (const m of L.movers) {
      const withEvents = m as Mover & { onEvent?: unknown };
      if (!('onEvent' in withEvents)) continue;
      (withEvents as { onEvent: (kind: string, at: THREE.Vector3, s: number) => void }).onEvent = (kind, at, strength) => {
        const near = this.player.feet.distanceTo(at);
        if (near > 40) return;
        switch (kind) {
          case 'drawer':
            this.sfx('drawer', 0.9, at);
            break;
          case 'press':
            this.sfx('press', 1, at);
            if (near < 9) this.cam.addTrauma(0.12 * (1 - near / 9));
            this.fx.glints.emit(at.clone().add(new THREE.Vector3(0, 0.2, 0)), { count: 14, color: [0xffd75a, 0xffffff, 0xff9a3a], speed: 6, up: 2, size: 0.28, life: 0.45, gravity: 10 });
            this.fx.soft.emit(at.clone().add(new THREE.Vector3(0, 0.3, 0)), { count: 6, color: 0xd8dde6, kind: 'puff', speed: 3, up: 0.6, size: 0.9, life: 0.7, gravity: -0.5, drag: 3, radius: 0.6 });
            break;
          case 'steam':
            this.sfx('steam', 0.9, at);
            break;
          case 'steamWarn':
            this.fx.soft.emit(at.clone().add(new THREE.Vector3(0, 0.2, 0)), {
              count: strength > 0.5 ? 3 : 1,
              color: [0xf2f5fa, 0xdfe5ee],
              kind: 'puff',
              speed: 1 + strength * 4,
              up: 2 + strength * 7,
              spread: 0.25,
              size: 0.9 + strength * 0.9,
              life: 0.9,
              gravity: -1,
              drag: 1.4,
              radius: 0.3,
            });
            if (strength < 0.5 && Math.random() < 0.3) this.sfx('hiss', 0.6, at);
            break;
          case 'truck':
            if (near < 30) this.sfx('horn', 0.7, at);
            break;
        }
      };
    }
    L.getaway.onExhaust = (at, strength) => {
      L.smoke.emit(at, { count: 1, color: [0x9ea4ad, 0xc4c9d1], kind: 'puff', speed: 0.6 + strength, up: 0.3, spread: 0.4, size: 0.5 + strength * 0.5, life: 1.4, gravity: -0.6, drag: 1.2, radius: 0.05, dir: new THREE.Vector3(-1, 0, 0) });
    };
  }

  private moverHit(m: Mover) {
    const p = this.player;
    this.sfx('hit');
    this.fx.stars(p.center.clone());
    if (m.damage > 0) {
      this.hurt(m.damage, m.label);
      this.hud.flash('red');
    }
    if (m.dropLoot) this.dropLoot(0.1);
    this.hud.notify(m.label === 'Coin press' ? 'STAMPED!' : m.label === 'Snowplow' ? 'PLOWED!' : m.label === 'Steam vent' ? 'PFFFT!' : 'WHACK!', 'bad', m.damage > 0 ? `${m.label} — watch the timing` : '');
    this.noise(p.feet, 10);
  }

  private updateZip(h: number) {
    const z = this.level.zips.find((zz) => zz.riding);
    const p = this.player;
    if (!z) {
      this.state = 'play';
      return;
    }
    const feet = z.update(h, this.zipFeet);
    if (feet) {
      p.carry(feet, z.heading, h);
      if (Math.random() < 0.3) this.fx.glints.emit(z.pos.clone(), { count: 1, color: [0xffd27a, 0xffffff], speed: 2, size: 0.18, life: 0.3, gravity: 6 });
    } else {
      p.release(z.releaseVelocity());
      this.state = 'play';
      p.invuln = 0.6;
    }
  }

  /** Lights, searchlight, police strobes and the van's headlights for the escape stages. */
  private updateEscapeVisuals(dt: number) {
    const L = this.level;
    const p = this.player;
    const extracting = this.state === 'extract';
    // skip drawing far-away moving gadgets (each is a handful of draw calls)
    const cp = this.cam.camera.position;
    for (const m of L.movers) {
      const g = (m as { group?: THREE.Object3D }).group ?? (m as { rig?: { root: THREE.Object3D } }).rig?.root;
      if (g) g.visible = g.position.distanceTo(cp) < ((m as { rig?: unknown }).rig ? 170 : 80);
    }
    for (const pad of L.pads) pad.group.visible = pad.group.position.distanceTo(cp) < 80;
    for (const u of L.parkedPolice) u.rig.root.visible = u.rig.root.position.distanceTo(cp) < 220;
    const zid = extracting ? 'street' : (this.zone?.id ?? 'plaza');
    // pooled point lights: fade out, move, fade back in when the zone changes
    const preset = L.lightPresets[zid] ?? L.lightPresets.plaza;
    if (preset) {
      if (zid !== this.lightZone) this.lightZone = zid;
      L.lightPool.forEach((l, i) => {
        if (extracting && i === 1) return; // the chase cruiser drives this one
        const [x, y, z, col, inten, dist] = preset[i];
        const far = Math.abs(l.position.x - x) + Math.abs(l.position.y - y) + Math.abs(l.position.z - z) > 0.5;
        if (far) {
          l.intensity = damp(l.intensity, 0, 16, dt);
          if (l.intensity < 0.4) {
            l.position.set(x, y, z);
            l.color.setHex(col);
            l.distance = dist;
          }
        } else if (!(zid === 'street' && i === 1)) {
          l.intensity = damp(l.intensity, inten, 6, dt);
        }
      });
    }
    // roadblock lightbars + their shared strobe light
    const stage = STAGE[zid] ?? 0;
    if (stage >= 9 || extracting) {
      let side = 0;
      for (const u of L.parkedPolice) side = u.update(dt) || side;
      if (!extracting && zid === 'street') {
        const l = L.lightPool[1];
        if (l) {
          l.color.setHex(side >= 0 ? 0xff2a3a : 0x2a5bff);
          l.intensity = side === 0 ? 3 : 32;
        }
      }
    }
    // helicopter over the rooftops (and over the getaway)
    const sl = L.searchlights[0];
    if (sl && !(stage >= 8 || extracting) && sl.visible) sl.setVisible(false);
    if (sl && (stage >= 8 || extracting)) {
      if (!sl.visible) sl.setVisible(true);
      const ground = (x: number, z: number) => {
        this.rayO.set(x, 45, z);
        const toi = this.physics.rayWorld(this.rayO, DOWN, 70, G.WORLD);
        return toi === null ? null : 45 - toi;
      };
      sl.update(this.t, dt, p.feet, ground, zid === 'roof' && this.state === 'play');
      const d = this.cam.camera.position.distanceTo(sl.heli.root.position);
      this.audio.setRotor(clamp(1.25 - d / 70, 0, 1));
    } else this.audio.setRotor(0);
    // the one spot light: searchlight on the roofs, headlights on the street
    const spot = L.spot;
    if (zid === 'roof' && sl) {
      spot.position.copy(sl.lampPos);
      spot.target.position.copy(sl.target);
      spot.angle = 0.11;
      spot.distance = 90;
      spot.intensity = damp(spot.intensity, 2600, 4, dt);
    } else if (zid === 'street' || extracting) {
      if (!extracting) {
        spot.position.copy(L.getaway.front);
        const r = L.getaway.rig.root;
        spot.target.position.set(r.position.x + Math.cos(r.rotation.y) * 16, 0, r.position.z - Math.sin(r.rotation.y) * 16);
      }
      spot.angle = 0.42;
      spot.distance = 45;
      spot.intensity = damp(spot.intensity, 300, 4, dt);
    } else spot.intensity = damp(spot.intensity, 0, 6, dt);
  }

  private failReason: 'busted' | 'timeout' = 'busted';
  private fail(reason: 'busted' | 'timeout') {
    if (this.state === 'failing' || this.state === 'done' || this.state === 'extract') return;
    this.failReason = reason;
    this.state = 'failing';
    this.online?.onEvent({ k: 'fail', reason });
    this.failT = 0;
    this.crack?.stop();
    this.hack?.stop();
    this.crack = null;
    this.hack = null;
    this.player.setState(this.player.knocked ? 'knocked' : 'caught');
    this.audio.setSiren(false);
    this.sfx('busted');
    if (this.online && reason === 'timeout') this.hud.titleCard('ROUND OVER', 'The clock ran out before you escaped', 'bad');
    else if (this.online) this.hud.titleCard('BUSTED!', 'Back to the start — the round clock keeps running', 'bad');
    else this.hud.titleCard(reason === 'busted' ? 'BUSTED!' : "TIME'S UP!", reason === 'busted' ? 'The penguins got you this time' : 'The police have surrounded the bank', 'bad');
    for (const g of this.guards) if (!g.busy) g.alert(this.player.feet);
  }

  private finish(success: boolean, reason?: 'busted' | 'timeout') {
    if (this.state === 'done') return;
    this.state = 'done';
    this.audio.setSiren(false);
    this.hud.hideTitle();
    const timeLeft = Math.max(0, this.timeLeft);
    const breakdown: { label: string; value: number }[] = [];
    let score = 0;
    if (success) {
      const timeBonus = Math.round(timeLeft) * 40;
      const ms = this.wanted.maxStars;
      const stealth = ms <= 1 ? 15000 : ms <= 2 ? 8000 : ms <= 3 ? 3000 : 0;
      const healthBonus = this.health * 1000;
      breakdown.push({ label: 'Loot stolen', value: this.lootValue });
      breakdown.push({ label: `Time bonus (${Math.round(timeLeft)}s left)`, value: timeBonus });
      breakdown.push({ label: `Stealth bonus (max ${ms}★)`, value: stealth });
      breakdown.push({ label: `Health bonus (${this.health}♥)`, value: healthBonus });
      score = this.lootValue + timeBonus + stealth + healthBonus;
    }
    let rank = -1;
    if (success) for (let i = RANKS.length - 1; i >= 0; i--) if (score >= RANKS[i].min) {
      rank = i;
      break;
    }
    const result: HeistResult = {
      success,
      reason,
      loot: this.lootValue,
      timeLeft,
      elapsedMs: Math.round(this.elapsed * 1000),
      maxStars: this.wanted.maxStars,
      health: this.health,
      maxHealth: this.maxHealth,
      presents: this.stats.presents,
      diamonds: this.stats.diamonds,
      guardsStunned: this.stats.guardsStunned,
      decorationsBroken: this.stats.decorationsBroken,
      starDiamond: this.stats.starDiamond,
      score,
      breakdown,
      rank,
    };
    this.onFinish?.(result);
  }

  /** Online: the round ended while this run was still going. */
  endRound() {
    if (this.state === 'intro' || this.state === 'ready') {
      this.state = 'done';
      return;
    }
    this.fail('timeout');
  }

  // ------------------------------------------------------------- debug
  debugTeleport(x: number, y: number, z: number, yaw = Math.PI) {
    this.player.teleport(new THREE.Vector3(x, y, z), yaw);
    this.cam.cineBlend = 0;
    this.cam.cineTarget = 0;
    this.cam.setBehind(yaw);
    this.cam.snap(new THREE.Vector3(x, y + 1.5, z));
  }
  debugOpenVault() {
    this.level.vault.open();
    this.wanted.setFloor(50);
  }

  private disposed = false;

  dispose() {
    this.disposed = true;
    this.crack?.stop();
    this.hack?.stop();
    this.audio.setSiren(false);
    this.audio.setRotor(0);
    this.arsenal?.dispose();
    this.hearts?.dispose();
    this.netOff?.();
    this.remote?.dispose();
    this.cam.fovOverride = null;
    this.hud.setCinematic(false);
    for (const g of this.guards) g.cone.dispose();
    this.fx.dispose();
    this.player?.dispose(this.scene);
    for (const s of this.level?.snow ?? []) s.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.matrixAutoUpdate === false && m.parent === this.level?.root) m.geometry.dispose();
    });
    this.physics.dispose();
    this.scene.clear();
  }
}

let lampOn: THREE.MeshBasicMaterial | undefined;
let lampOff: THREE.MeshBasicMaterial | undefined;

function nextFrame() {
  return new Promise<void>((r) => requestAnimationFrame(() => r()));
}

export { lerp, WALK_SPEED };

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
