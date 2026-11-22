import * as THREE from 'three';
import { Physics } from '../physics';
import { StaticBatcher, rbox, cyl, sphere, torus, star3D, cone, fluffySphere } from '../../gfx/geom';
import { Mats } from '../../gfx/materials';
import { BANK, BANK_CHECKPOINTS, BANK_ZONES } from '../../shared/bankLayout';
import { TextureLib } from '../../gfx/textures';
import {
  BulbField,
  OrnamentField,
  bench,
  bow,
  candyCane,
  chandelier,
  christmasTree,
  coinPile,
  column,
  garland,
  lampPost,
  laserEmitter,
  lightString,
  present,
  snowflake,
  snowyPine,
  stanchion,
  wreath,
} from '../../gfx/props';
import { SnowVolume } from '../../gfx/Snow';
import { createSkyline } from '../../gfx/Sky';
import {
  AutoDoor,
  Conveyor,
  LaserRig,
  MovingPlatform,
  PressurePlate,
  Shutter,
  Sweeper,
  TimedGate,
  VaultDoor,
} from '../objects';
import { Destructible, PushBlock, SecurityCamera, Terminal, Vent, type DecorKind } from '../heistObjects';
import type { BouncePad, CrossingTruck, Mover, Rideable, Searchlight, Zipline } from '../escapeObjects';
import type { GetawayVan, PoliceUnit, TireTracks } from '../getaway';
import type { FX, ParticleSystem } from '../../gfx/Particles';
import { buildEscapeStages } from './escapeStages';
import type { GuardConfig } from '../Guard';
import type { LootKind, LootManager } from '../Loot';
import { Kit, box3, v3, type DecorFn } from './kit';

// =====================================================================
// Level data contract (consumed by Heist.ts)
// =====================================================================

export interface Checkpoint {
  id: string;
  box: THREE.Box3;
  pos: THREE.Vector3;
  yaw: number;
}

export interface ZoneInfo {
  id: string;
  name: string;
  box: THREE.Box3;
  objective?: { title: string; hint: string };
}

export interface Hazard {
  id: number;
  box: THREE.Box3;
  knock: (p: THREE.Vector3) => THREE.Vector3;
  damage: number;
  dropLoot: boolean;
  label: string;
}

/** One pooled point light's placement for a zone. */
export type LightSpec = [x: number, y: number, z: number, color: number, intensity: number, distance: number];

export interface StageInfo {
  /** Stage number shown to the player (1 … 10). */
  n: number;
  /** Difficulty pips 1 … 5. */
  difficulty: number;
  /** Wanted heat that can't cool below this once you get here. */
  wantedFloor?: number;
}

export interface BeltSpawner {
  conveyor: Conveyor;
  start: THREE.Vector3;
  end: THREE.Box3;
  timer: number;
  kinds: LootKind[];
}

export interface LevelData {
  root: THREE.Group;
  spawn: { pos: THREE.Vector3; yaw: number };
  checkpoints: Checkpoint[];
  zones: ZoneInfo[];
  killY: number;
  lasers: LaserRig[];
  sweepers: Sweeper[];
  platforms: MovingPlatform[];
  conveyors: Conveyor[];
  beltSpawners: BeltSpawner[];
  plate: PressurePlate;
  gate: TimedGate;
  shutters: Shutter[];
  autoDoors: AutoDoor[];
  vault: VaultDoor;
  terminal: Terminal;
  vents: Vent[];
  destructibles: Destructible[];
  cameras: SecurityCamera[];
  pushBlocks: PushBlock[];
  hazards: Hazard[];
  guards: GuardConfig[];
  reinforcements: { zoneId: string; spawn: THREE.Vector3; route: THREE.Vector3[]; zone: THREE.Box3 }[];
  getaway: GetawayVan;
  /** Moving hazards of the escape stages (drawers, presses, steam, traffic). */
  movers: Mover[];
  /** Things the robber can ride that aren't MovingPlatforms (coin presses). */
  rideables: Rideable[];
  pads: BouncePad[];
  fallZones: { box: THREE.Box3; title: string; label: string }[];
  zips: Zipline[];
  searchlights: Searchlight[];
  trucks: CrossingTruck[];
  parkedPolice: PoliceUnit[];
  chasePolice: PoliceUnit[];
  tracks: TireTracks;
  smoke: ParticleSystem;
  /** Per-frame ambient effects that need the particle systems. */
  fxHooks: ((t: number, dt: number, fx: FX) => void)[];
  /** Pooled point lights, moved per zone (adding lights later would recompile every shader). */
  lightPool: THREE.PointLight[];
  lightPresets: Record<string, LightSpec[]>;
  /** One spot light shared by the helicopter searchlight and the van's headlights. */
  spot: THREE.SpotLight;
  stageInfo: Record<string, StageInfo>;
  sun: THREE.DirectionalLight;
  alarmLight: THREE.PointLight;
  alarmBeacons: THREE.Object3D[];
  snow: SnowVolume[];
  animated: ((t: number, dt: number) => void)[];
  intro: { pos: THREE.Vector3[]; look: THREE.Vector3[] };
  minLoot: number;
  timeLimit: number;
}

// =====================================================================
// Build
// =====================================================================

export function buildChristmasBank(scene: THREE.Scene, physics: Physics, loot: LootManager, quality: { snow: number }): LevelData {
  const root = new THREE.Group();
  root.name = 'ChristmasBank';
  scene.add(root);
  const batch = new StaticBatcher();
  const k = new Kit(physics, batch, root);
  const bulbs = new BulbField();
  const warmBulbs = new BulbField();
  const ornaments = new OrnamentField();

  const d: LevelData = {
    root,
    spawn: { pos: v3(...BANK.spawn.pos), yaw: BANK.spawn.yaw },
    checkpoints: [],
    zones: [],
    killY: BANK.killY,
    lasers: [],
    sweepers: [],
    platforms: [],
    conveyors: [],
    beltSpawners: [],
    plate: null as unknown as PressurePlate,
    gate: null as unknown as TimedGate,
    shutters: [],
    autoDoors: [],
    vault: null as unknown as VaultDoor,
    terminal: null as unknown as Terminal,
    vents: [],
    destructibles: [],
    cameras: [],
    pushBlocks: [],
    hazards: [],
    guards: [],
    reinforcements: [],
    getaway: null as unknown as GetawayVan,
    movers: [],
    rideables: [],
    pads: [],
    fallZones: [],
    zips: [],
    searchlights: [],
    trucks: [],
    parkedPolice: [],
    chasePolice: [],
    tracks: null as unknown as TireTracks,
    smoke: null as unknown as ParticleSystem,
    fxHooks: [],
    lightPool: [],
    lightPresets: {},
    spot: null as unknown as THREE.SpotLight,
    stageInfo: {},
    sun: null as unknown as THREE.DirectionalLight,
    alarmLight: null as unknown as THREE.PointLight,
    alarmBeacons: [],
    snow: [],
    animated: [],
    intro: { pos: [], look: [] },
    minLoot: BANK.minLoot,
    timeLimit: BANK.timeLimit,
  };

  const decor = (kind: DecorKind, x: number, y: number, z: number, rotY = 0) => {
    d.destructibles.push(new Destructible(physics, root, v3(x, y, z), kind, rotY));
  };

  buildPlaza(k, d, bulbs, warmBulbs, ornaments, decor, quality);
  buildLobby(k, d, bulbs, warmBulbs, ornaments, decor, loot);
  buildLaserHall(k, d, loot);
  buildVent(k, d, loot);
  buildAtrium(k, d, bulbs, ornaments, decor, loot, quality);
  buildVault(k, d, decor, loot);
  buildCounting(k, d, decor, loot);
  // one spot light for the whole level, created up front: the helicopter's searchlight
  // over the rooftops, then the getaway van's headlights on the street
  const spot = new THREE.SpotLight(0xeaf2ff, 0, 90, 0.24, 0.65, 2);
  spot.castShadow = false;
  root.add(spot);
  root.add(spot.target);
  d.spot = spot;
  buildEscapeStages(k, d, { bulbs, warm: warmBulbs, decor, loot, q: quality });
  buildLights(scene, d);

  // ---- surrounding snowfield + snowy roofs (for the aerial intro and skyline views)
  const field = new THREE.Mesh(new THREE.PlaneGeometry(720, 720), Mats.snow(64, 64));
  field.rotation.x = -Math.PI / 2;
  field.position.set(90, -1.26, -80);
  field.receiveShadow = true;
  root.add(field);
  const roof = (x: number, y: number, z: number, w: number, dd: number) => k.block(x, y, z, w, 0.5, dd, Mats.snowCap(), { col: false, cast: false });
  roof(0, 12.85, -16.2, 38.4, 33.4); // lobby
  roof(0, 6.45, -45.6, 10.4, 26.6); // laser hall
  roof(13.5, 3.05, -45.4, 3.2, 26.2); // vent
  roof(0, 14.85, -63.3, 36.4, 9.6); // atrium (around the skylight)
  roof(0, 14.85, -90.5, 36.4, 9.2);
  roof(-12.5, 14.85, -76.5, 11.2, 18.2);
  roof(12.5, 14.85, -76.5, 11.2, 18.2);
  roof(0, 9.85, -110.2, 30.6, 31.4); // vault
  roof(27.6, 7.85, -109, 26.2, 28.4); // counting room
  roof(57.8, 7.85, -109, 33.6, 28.4); // deposit vaults

  batch.build(root);
  root.add(bulbs.build(6, 0.055));
  root.add(warmBulbs.build(5, 0.07));
  root.add(ornaments.build());
  root.add(createSkyline(v3(115, -1.2, -78), 228, 64, 3, [-0.36, -0.16], [-0.8, -0.58]));

  // ---- checkpoints & zones ----
  // Boxes come from the shared layout so the game server checks runs against the same geometry.
  for (const c of BANK_CHECKPOINTS) d.checkpoints.push({ id: c.id, box: box3(...c.box), pos: v3(...c.pos), yaw: c.yaw });
  const zoneText: Record<string, { name: string; objective: { title: string; hint: string } }> = {
    plaza: { name: 'Bank Plaza', objective: { title: 'Sneak into the bank', hint: 'Use the front doors — keep out of the penguins’ flashlights' } },
    lobby: { name: 'Grand Lobby', objective: { title: 'Find a way to the vault', hint: 'Hack the security terminal to cut the lasers — or find the vent' } },
    hall: { name: 'Laser Hall', objective: { title: 'Get through the laser hall', hint: 'Jump the low beams, slide [Ctrl] under the high ones' } },
    vent: { name: 'Air Duct', objective: { title: 'Crawl through the vent', hint: 'A secret shortcut past the lasers' } },
    atrium: { name: 'Vault Atrium', objective: { title: 'Cross the vault atrium', hint: 'Three routes: platforms, treadmill or stepping gifts' } },
    ante: { name: 'Vault Door', objective: { title: 'Crack the vault', hint: 'Walk up to the dial and press [E]' } },
    vault: { name: 'Grand Vault', objective: { title: 'Loot the vault, then escape', hint: 'The pressure plate opens the armored gate' } },
    counting: { name: 'Counting Room', objective: { title: 'Break out through the counting room', hint: 'Cross the conveyor belts — mind the Wrap-o-Matics' } },
    deposit: { name: 'Deposit Vaults', objective: { title: 'Get through the deposit vaults', hint: 'Drawers punch out of the walls — jump the low ones, slide [Ctrl] under the high ones' } },
    mint: { name: 'The Mint', objective: { title: 'Cross the mint and climb to the roof', hint: 'Time the coin presses, ride the gold raft, bounce up the catwalks' } },
    roof: { name: 'Rooftops', objective: { title: 'Run the rooftops to the zipline', hint: 'Stay out of the helicopter’s searchlight — ice is slippery!' } },
    street: { name: 'Getaway Street', objective: { title: 'Reach the getaway van!', hint: 'Jump the spike strip, slip the roadblock, dodge the plows' } },
  };
  d.stageInfo = {
    plaza: { n: 1, difficulty: 1 },
    lobby: { n: 2, difficulty: 1 },
    hall: { n: 3, difficulty: 2 },
    vent: { n: 3, difficulty: 2 },
    atrium: { n: 4, difficulty: 2 },
    ante: { n: 5, difficulty: 3 },
    vault: { n: 5, difficulty: 3 },
    counting: { n: 6, difficulty: 3 },
    deposit: { n: 7, difficulty: 4 },
    mint: { n: 8, difficulty: 4, wantedFloor: 55 },
    roof: { n: 9, difficulty: 5, wantedFloor: 62 },
    street: { n: 10, difficulty: 5, wantedFloor: 70 },
  };
  for (const z of BANK_ZONES) d.zones.push({ id: z.id, box: box3(...z.box), ...zoneText[z.id] });

  // ---- reinforcement spawns (4★+) ----
  const zoneBox = (id: string) => d.zones.find((z) => z.id === id)!.box.clone().expandByScalar(-0.6);
  d.reinforcements.push(
    { zoneId: 'lobby', spawn: v3(0, 0, -2.5), route: [v3(-6, 0, -6), v3(6, 0, -6)], zone: zoneBox('lobby') },
    { zoneId: 'vault', spawn: v3(8, 0, -123), route: [v3(-8, 0, -120), v3(8, 0, -120)], zone: zoneBox('vault') },
    { zoneId: 'counting', spawn: v3(38, 0, -98), route: [v3(36, 0, -100), v3(36, 0, -118)], zone: zoneBox('counting') },
    { zoneId: 'deposit', spawn: v3(70, 0, -98), route: [v3(70, 0, -98.5), v3(70, 0, -119.5)], zone: zoneBox('deposit') },
    { zoneId: 'mint', spawn: v3(110.5, 0, -123.5), route: [v3(110.5, 0, -123.5), v3(110.5, 0, -100)], zone: box3(104.7, -1, -125.6, 112.2, 3.5, -92.4) },
    { zoneId: 'roof', spawn: v3(150, 15.4, -125), route: [v3(150, 15.4, -125), v3(150, 15.4, -100)], zone: box3(136.8, 14.4, -126.8, 151.6, 19, -97.6) },
    { zoneId: 'street', spawn: v3(234, 0, -146), route: [v3(234, 0, -146), v3(226, 0, -146)], zone: box3(222.6, -1, -150.6, 236.2, 4, -127.4) },
  );

  // ---- intro flyover ----
  d.intro.pos = [v3(-26, 26, 70), v3(-14, 14, 48), v3(6, 7, 40), v3(0, 3.2, 34.5)];
  d.intro.look = [v3(0, 8, 0), v3(0, 7, 2), v3(0, 3, 18), v3(0, 0.4, 28)];
  return d;
}

// =====================================================================
// PLAZA
// =====================================================================
function buildPlaza(
  k: Kit,
  d: LevelData,
  bulbs: BulbField,
  warm: BulbField,
  orn: OrnamentField,
  decor: DecorFn,
  q: { snow: number },
) {
  const G0 = -1.2;
  // snowy ground + cobble path
  k.block(0, G0 - 0.5, 20.5, 64, 1, 39.6, Mats.snow(1, 1), { tile: 6 });
  k.block(0, G0 + 0.015, 22.5, 6, 0.03, 29, Mats.cobble(1, 1), { tile: 4, col: false, cast: false });
  // landing + steps
  k.block(0, -0.6, 2.6, 24, 1.2, 4, Mats.marbleCream(1, 1), { tile: 4 });
  for (let s = 0; s < 3; s++) {
    const top = -0.3 * (s + 1);
    k.block(0, (G0 + top) / 2, 5.1 + s, 22 - s * 0.6, top - G0, 1.0, Mats.marbleCream(1, 1), { tile: 4 });
  }
  k.carpet(0, 5.5, 3.2, 3.2, 0.012 - 0.3);
  // facade
  const stone = Mats.stone(1, 1);
  k.block(-11.25, 6, 0, 17.5, 12.4, 1.2, stone, { tile: 4 });
  k.block(11.25, 6, 0, 17.5, 12.4, 1.2, stone, { tile: 4 });
  k.block(0, 8.6, 0, 5, 7.2, 1.2, stone, { tile: 4 });
  // cornice + base trims
  k.rblock(0, 12.3, 0.4, 41, 0.5, 2.0, Mats.marbleCream(), 0.15);
  k.rblock(0, 0.15, 0.7, 41, 0.3, 0.4, Mats.marbleCream(), 0.1);
  // columns
  for (const x of [-11, -7.5, -4, 4, 7.5, 11]) {
    k.prop(column(9, 0.55), x, 0, 3.0);
    k.physics.cylinder(x, 4.5, 3.0, 0.7, 9);
  }
  // entablature + pediment
  k.rblock(0, 9.65, 2.8, 25, 1.3, 4.6, Mats.marbleCream(), 0.12);
  const ped = new THREE.Shape();
  ped.moveTo(-12.8, 0);
  ped.lineTo(12.8, 0);
  ped.lineTo(0, 3.6);
  ped.closePath();
  const pedGeo = new THREE.ExtrudeGeometry(ped, { depth: 1.0, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 });
  k.batch.add(pedGeo, Mats.marbleCream(), new THREE.Matrix4().makeTranslation(0, 10.3, 3.8));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), Mats.signMat('THE CHRISTMAS BANK', 'SAVINGS · LOANS · STOCKINGS'));
  sign.position.set(0, 9.65, 5.12);
  k.live(sign);
  k.prop(wreath(1.0), 0, 11.6, 4.95);
  // garland swag under the entablature
  const swags = [-12.5, -7.5, -4, 4, 7.5, 12.5];
  for (let i = 0; i < swags.length - 1; i++) {
    if (swags[i] === -4) continue;
    const g = new THREE.Group();
    garland(v3(swags[i], 8.9, 5.2), v3(swags[i + 1], 8.9, 5.2), 0.7, g, bulbs, 0.12);
    k.prop(g, 0, 0, 0);
  }
  // facade windows (warm, lit from within)
  for (const x of [-15.5, -8, 8, 15.5]) {
    if (Math.abs(x) === 8) continue;
    k.rblock(x, 4.6, 0.62, 3.0, 5.2, 0.12, Mats.gold(), 0.05);
    k.rblock(x, 4.6, 0.7, 2.6, 4.8, 0.08, Mats.glow(0xffb465, 1.1), 0.02);
    for (let i = 1; i < 3; i++) k.rblock(x, 2.2 + i * 1.6, 0.76, 2.6, 0.08, 0.06, Mats.gold(), 0.02);
    k.rblock(x, 4.6, 0.76, 0.08, 4.8, 0.06, Mats.gold(), 0.02);
    k.prop(wreath(0.55), x, 7.8, 0.95);
  }
  // entrance arch + auto doors
  k.rblock(-2.75, 2.7, 0.65, 0.5, 5.4, 0.3, Mats.gold(), 0.08);
  k.rblock(2.75, 2.7, 0.65, 0.5, 5.4, 0.3, Mats.gold(), 0.08);
  k.rblock(0, 5.25, 0.65, 6, 0.5, 0.3, Mats.gold(), 0.08);
  d.autoDoors.push(new AutoDoor(k.physics, k.root, v3(0, 0, 0), 5, 5));
  // planters with small trees flanking the doors
  for (const x of [-5.6, 5.6]) {
    k.cylinder(x, 0.45, 1.6, 0.55, 0.9, Mats.plastic(0xd31f2b), { col: true, rt: 0.65 });
    k.prop(christmasTree(2.6, { bulbs, seed: x > 0 ? 3 : 4, star: true, at: v3(x, 0.9, 1.6) }), x, 0.9, 1.6);
  }
  // lamp posts
  const lampPositions = [
    [-7, 12],
    [7, 12],
    [-7, 22],
    [7, 22],
    [-7, 32],
    [7, 32],
  ];
  for (const [x, z] of lampPositions) {
    const g = new THREE.Group();
    lampPost(g, x, G0, z);
    k.prop(g, 0, 0, 0);
    k.physics.cylinder(x, G0 + 2, z, 0.25, 4);
  }
  // snowy pines + a decorated plaza tree
  const pines = [
    [-17, 9, 7],
    [17, 9, 7.5],
    [-21, 19, 8.5],
    [21, 18, 8],
    [-17, 30, 7],
    [18, 31, 9],
    [-24, 26, 6],
    [24, 25, 6.5],
  ];
  pines.forEach(([x, z, h], i) => {
    k.prop(snowyPine(h, i + 11), x, G0, z);
    k.physics.cylinder(x, G0 + 2, z, h * 0.17, 4);
  });
  const plazaTree = christmasTree(7.5, { bulbs, ornaments: orn, seed: 31, snow: true, at: v3(12.5, G0, 19) });
  k.prop(plazaTree, 12.5, G0, 19);
  k.physics.cylinder(12.5, G0 + 2, 19, 1.6, 4);
  // gift pile around the plaza tree
  [
    [10.6, 17.2, 0.9, 0],
    [14.2, 17.6, 0.7, 2],
    [11.2, 21, 0.8, 4],
    [14, 20.6, 0.6, 5],
  ].forEach(([x, z, s, v]) => {
    const p = present(s, s * 0.8, s, v);
    k.solidProp(p, x, G0, z, x * 0.3);
  });
  // perimeter fence + invisible barriers
  for (let x = -26; x <= 26; x += 2) {
    k.cylinder(x, G0 + 0.6, 37, 0.06, 1.2, Mats.darkMetal());
    k.prop(new THREE.Mesh(cone(0.09, 0.22, 8), Mats.gold()), x, G0 + 1.3, 37);
  }
  k.rblock(0, G0 + 1.05, 37, 52, 0.08, 0.08, Mats.darkMetal(), 0.03);
  k.rblock(0, G0 + 0.35, 37, 52, 0.08, 0.08, Mats.darkMetal(), 0.03);
  k.barrier(0, 4, 37.5, 60, 14, 1);
  k.barrier(-26.5, 4, 18, 1, 14, 40);
  k.barrier(26.5, 4, 18, 1, 14, 40);
  // snow drifts
  for (let i = 0; i < 18; i++) {
    const x = (i % 2 ? 1 : -1) * (10 + ((i * 7) % 13));
    const z = 6 + ((i * 11) % 30);
    const s = new THREE.Mesh(fluffySphere(1.4, 0.08, i % 4, 3), Mats.snowCap());
    s.scale.set(1.4 + (i % 3) * 0.4, 0.35, 1.1);
    k.solidProp(s, x, G0 - 0.1, z, 0, 1, 0.7);
  }
  // candy canes along the path
  for (let z = 10; z <= 34; z += 6) for (const x of [-3.6, 3.6]) k.solidProp(candyCane(1.3), x, G0, z, x > 0 ? Math.PI : 0);
  decor('snowman', -5.5, G0, 18, 0.4);
  decor('giftTower', 5.2, G0, 14.5);
  decor('snowman', 18, G0, 26, -0.5);
  // string lights over the plaza
  for (const z of [11, 20]) lightString(v3(-7, 3.9, z), v3(7, 3.9, z), 1.2, k.root, bulbs, 0.5);
  // snow
  const plazaSnow = new SnowVolume(v3(-30, G0, 2), v3(30, 18, 40), 3200 * q.snow);
  k.live(plazaSnow.points);
  d.snow.push(plazaSnow);
  void warm;
}

// =====================================================================
// GRAND LOBBY
// =====================================================================
function buildLobby(k: Kit, d: LevelData, bulbs: BulbField, warm: BulbField, orn: OrnamentField, decor: DecorFn, loot: LootManager) {
  const wall = Mats.wallpaper(1, 1);
  const red = Mats.marbleRed(1, 1);
  // floor + ceiling
  k.block(0, -0.4, -16.2, 37, 0.8, 32.4, Mats.marbleFloor(1, 1), { tile: 8 });
  k.block(0, 12.3, -16, 37, 0.6, 33, Mats.plaster(), { cast: false, col: true });
  // side walls
  for (const s of [-1, 1]) {
    k.block(s * 18.6, 6, -16.3, 1.2, 12.4, 32.6, wall, { tile: 2 });
    k.block(s * 17.95, 0.75, -16.3, 0.1, 1.5, 31.4, red, { tile: 2, col: false });
    k.rblock(s * 17.9, 1.5, -16.3, 0.18, 0.14, 31.4, Mats.gold(), 0.04);
    k.rblock(s * 17.92, 7.5, -16.3, 0.14, 0.12, 31.4, Mats.gold(), 0.04);
    k.rblock(s * 17.85, 11.8, -16.3, 0.3, 0.4, 31.4, Mats.marbleCream(), 0.1);
  }
  // front wall interior trim
  k.block(-11.25, 0.75, -0.65, 13.5, 1.5, 0.1, red, { col: false });
  k.block(11.25, 0.75, -0.65, 13.5, 1.5, 0.1, red, { col: false });
  for (const x of [-15.5, 15.5]) {
    k.rblock(x, 4.6, -0.66, 3, 5.2, 0.1, Mats.gold(), 0.04);
    k.rblock(x, 4.6, -0.7, 2.6, 4.8, 0.05, Mats.windowNight(), 0.02);
  }
  // back wall with openings: hall door (x −3..3, h 4.6) and vent (x 12.5..14.5, h 2.2)
  const bz = -32;
  k.block(-10.5, 6, bz, 15, 12.4, 1.2, wall, { tile: 2 });
  k.block(7.75, 6, bz, 9.5, 12.4, 1.2, wall, { tile: 2 });
  k.block(16.25, 6, bz, 3.5, 12.4, 1.2, wall, { tile: 2 });
  k.block(0, 8.5, bz, 6, 7.4, 1.2, wall, { tile: 2 });
  k.block(13.5, 7.3, bz, 2, 9.8, 1.2, wall, { tile: 2 });
  k.block(-10.5, 0.75, bz + 0.65, 15, 1.5, 0.1, red, { col: false });
  k.block(7.75, 0.75, bz + 0.65, 9.5, 1.5, 0.1, red, { col: false });
  k.rblock(0, 2.4, bz + 0.62, 7.0, 0.5, 0.3, Mats.gold(), 0.08);
  k.rblock(-3.25, 2.3, bz + 0.62, 0.5, 4.6, 0.3, Mats.gold(), 0.08);
  k.rblock(3.25, 2.3, bz + 0.62, 0.5, 4.6, 0.3, Mats.gold(), 0.08);
  k.rblock(0, 4.85, bz + 0.62, 7.0, 0.5, 0.3, Mats.gold(), 0.08);
  // clock + banner above the hall door
  const clock = new THREE.Group();
  clock.add(new THREE.Mesh(cyl(1.1, 1.1, 0.12, 48), new THREE.MeshStandardMaterial({ map: TextureLib.clockFace(), roughness: 0.4 })));
  clock.children[0].rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(torus(1.15, 0.12, 12, 48), Mats.gold());
  clock.add(rim);
  const hand1 = new THREE.Mesh(rbox(0.08, 0.75, 0.04, 0.02), Mats.blackGloss());
  hand1.position.set(0, 0.3, 0.1);
  hand1.rotation.z = 0.3;
  const hand2 = new THREE.Mesh(rbox(0.1, 0.5, 0.04, 0.02), Mats.blackGloss());
  hand2.position.set(-0.18, 0.12, 0.12);
  hand2.rotation.z = 1.2;
  clock.add(hand1, hand2);
  k.prop(clock, 0, 6.6, bz + 0.72);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), Mats.signMat("SEASON'S GREETINGS"));
  banner.position.set(0, 9.4, bz + 0.65);
  k.live(banner);
  // ceiling coffers
  for (let x = -16; x <= 16; x += 4) k.rblock(x, 11.95, -16, 0.18, 0.12, 31, Mats.goldSatin(), 0.04, { cast: false });
  for (let z = -30; z <= -2; z += 4) k.rblock(0, 11.95, z, 35, 0.12, 0.18, Mats.goldSatin(), 0.04, { cast: false });
  // columns
  for (const [x, z] of [
    [-8, -9],
    [8, -9],
    [-8, -23],
    [8, -23],
  ]) {
    k.prop(column(11.6, 0.7, bulbs, v3(x, 0, z)), x, 0, z);
    k.physics.cylinder(x, 5.8, z, 0.95, 11.6);
  }
  // the great tree
  const tree = christmasTree(9.6, { bulbs, ornaments: orn, seed: 5, at: v3(0, 0.55, -16) });
  k.prop(tree, 0, 0.55, -16);
  k.cylinder(0, 0.3, -16, 2.6, 0.6, Mats.velvet(), { col: false, rt: 2.4 });
  const tRim = new THREE.Mesh(torus(2.5, 0.09, 10, 64), Mats.gold());
  tRim.rotation.x = Math.PI / 2;
  k.prop(tRim, 0, 0.6, -16);
  k.physics.cylinder(0, 2, -16, 2.7, 4);
  // decorative big gifts at the tree
  [
    [-2.2, -12.4, 1.1, 3],
    [2.6, -13.1, 0.9, 6],
    [2.4, -19.4, 1.2, 1],
    [-2.9, -19.0, 0.8, 4],
  ].forEach(([x, z, s, v]) => k.solidProp(present(s, s * 0.85, s, v), x, 0, z, x + z));
  // loot presents around the tree
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    loot.place('present', v3(Math.cos(a) * 3.35, 0, -16 + Math.sin(a) * 3.35), a);
  }
  // carpets
  k.carpet(0, -6.8, 3.4, 12);
  k.carpet(0, -25.8, 3.4, 11.6);
  // stanchions guiding to the tellers
  for (const z of [-7, -11, -15]) {
    const g = new THREE.Group();
    stanchion(g, v3(-9.2, 0, z), v3(-9.2, 0, z - 2.6));
    k.prop(g, 0, 0, 0);
  }

  // ---- teller counter (left) ----
  const cx = -12.8;
  k.block(cx, 0.575, -16, 1.2, 1.15, 22, Mats.wood(1, 1), { tile: 2 });
  k.rblock(cx, 1.2, -16, 1.45, 0.1, 22.3, Mats.marbleCream(), 0.04, { col: true });
  for (let i = 0; i <= 8; i++) {
    const z = -27 + i * 2.75;
    k.rblock(cx, 2.15, z, 0.14, 1.8, 0.14, Mats.gold(), 0.04);
    k.physics.box(cx, 2.15, z, 0.14, 1.8, 0.14);
    if (i < 8) {
      const plate = new THREE.Mesh(rbox(0.9, 0.3, 0.05, 0.02), Mats.gold());
      k.prop(plate, cx + 0.05, 3.25, z + 1.375, Math.PI / 2);
    }
  }
  k.rblock(cx, 3.08, -16, 0.16, 0.16, 22.2, Mats.gold(), 0.05);
  k.rblock(cx, 3.6, -16, 0.5, 0.8, 22.4, Mats.wood(), 0.08);
  // cash on the counter + behind it
  for (let i = 0; i < 4; i++) loot.place('cash', v3(cx, 1.25, -25.5 + i * 5.5), Math.PI / 2);
  for (const z of [-8, -14, -20, -26]) {
    k.rblock(-16.3, 0.45, z, 1.0, 0.9, 1.8, Mats.wood(), 0.06, { col: true });
    loot.place(z === -20 ? 'moneyBag' : 'cash', v3(-16.3, 0.92, z), 0.4);
  }
  loot.place('moneyBag', v3(-15, 0, -11));

  // ---- security office (right back) ----
  const glass = Mats.glass();
  // front partition along z = −20 (doorway x 12..14)
  for (const [x0, x1] of [
    [11, 12],
    [14, 17.9],
  ]) {
    const w = x1 - x0;
    const xc = (x0 + x1) / 2;
    k.block(xc, 0.5, -20, w, 1.0, 0.2, Mats.wood(1, 1), { tile: 2 });
    k.rblock(xc, 1.8, -20, w, 1.6, 0.06, glass, 0.02, { cast: false });
    k.rblock(xc, 2.65, -20, w + 0.1, 0.12, 0.24, Mats.gold(), 0.04);
    k.physics.box(xc, 1.4, -20, w, 2.8, 0.25);
  }
  // side partition along x = 11
  k.block(11, 0.5, -25.7, 0.2, 1.0, 11.4, Mats.wood(1, 1), { tile: 2 });
  k.rblock(11, 1.8, -25.7, 0.06, 1.6, 11.4, glass, 0.02, { cast: false });
  k.rblock(11, 2.65, -25.7, 0.24, 0.12, 11.5, Mats.gold(), 0.04);
  k.physics.box(11, 1.4, -25.7, 0.25, 2.8, 11.4);
  // desk with monitors
  k.rblock(15.6, 0.5, -24.5, 1.4, 1.0, 3.2, Mats.wood(), 0.06, { col: true });
  k.rblock(15.6, 1.03, -24.5, 1.5, 0.06, 3.3, Mats.marbleCream(), 0.02);
  for (let i = 0; i < 3; i++) {
    const z = -25.6 + i * 1.1;
    k.rblock(16.1, 1.55, z, 0.12, 0.7, 1.0, Mats.gunmetal(), 0.04);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.58), Mats.screen(i));
    scr.position.set(16.03, 1.55, z);
    scr.rotation.y = -Math.PI / 2;
    k.live(scr);
  }
  k.rblock(14.4, 0.55, -24.5, 0.7, 0.12, 0.7, Mats.velvet(), 0.05);
  k.rblock(14.1, 0.95, -24.5, 0.12, 0.8, 0.7, Mats.velvet(), 0.05);
  loot.place('goldPresent', v3(15.6, 1.07, -23.2));
  loot.place('cocoa', v3(15.5, 1.07, -26.2));
  for (const z of [-28.5, -30]) k.rblock(17.4, 0.9, z, 0.9, 1.8, 1.2, Mats.gunmetal(), 0.06, { col: true });
  d.terminal = new Terminal(k.root, v3(13.6, 0, -29.8), 0);
  k.physics.box(13.6, 0.8, -29.8, 1.4, 1.6, 0.9);
  // vent into the duct (back wall, x = 13.5)
  const vent = new Vent(k.physics, k.root, v3(13.5, 1.1, bz + 0.62), 2.0, 2.2, 0);
  vent.prompt = 'Pry Open Vent (secret shortcut)';
  d.vents.push(vent);
  k.rblock(13.5, 1.1, bz + 0.56, 2.3, 2.5, 0.06, Mats.darkMetal(), 0.04);
  // ---- waiting area (right front) ----
  k.prop(bench(3.2), 15.6, 0, -6.5, -Math.PI / 2);
  k.physics.box(15.7, 0.6, -6.5, 0.9, 1.2, 3.2);
  k.prop(bench(3.2), 15.6, 0, -12.5, -Math.PI / 2);
  k.physics.box(15.7, 0.6, -12.5, 0.9, 1.2, 3.2);
  k.cylinder(12.6, 0.35, -9.5, 0.9, 0.7, Mats.wood(), { col: true });
  k.cylinder(12.6, 0.72, -9.5, 0.95, 0.06, Mats.gold());
  loot.place('present', v3(12.6, 0.75, -9.5), 0.3);
  decor('nutTree', 16.8, 0, -2.6);
  decor('nutTree', 16.8, 0, -16.2);
  decor('nutTree', -16.8, 0, -2.6);
  decor('snowman', -7.5, 0, -3.2, 0.3);
  decor('ornaments', -6, 0, -13);
  decor('ornaments', 6, 0, -19.5);
  decor('giftTower', 6, 0, -12.5);
  decor('candyCanes', -16.6, 0, -29.6);

  // ---- wall decor ----
  for (const z of [-6, -13, -20, -27]) {
    k.prop(wreath(0.9), -17.85, 5.3, z, Math.PI / 2);
    k.prop(wreath(0.9), 17.85, 5.3, z, -Math.PI / 2);
  }
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const pts = [-2, -9.5, -16.5, -23.5, -30.5];
    for (let i = 0; i < pts.length - 1; i++) garland(v3(s * 17.7, 8.3, pts[i]), v3(s * 17.7, 8.3, pts[i + 1]), 0.9, g, bulbs, 0.15);
    k.prop(g, 0, 0, 0);
  }
  // chandeliers
  for (const z of [-8, -24]) {
    const c = chandelier(warm, 1.25, v3(0, 12, z));
    k.prop(c, 0, 12, z);
  }
  // lobby guards
  const lobbyZone = box3(-17.4, -1, -31.2, 17.4, 4, -0.8);
  d.guards.push(
    { name: 'tree', route: [v3(-4.6, 0, -10.6), v3(4.6, 0, -10.6), v3(4.8, 0, -21.4), v3(-4.8, 0, -21.4)], zone: lobbyZone, wait: 1.4 },
    { name: 'teller', route: [v3(-10, 0, -4), v3(-10, 0, -27.5), v3(-4.5, 0, -28.8)], zone: lobbyZone, wait: 2.2 },
    { name: 'office', route: [v3(12.4, 0, -22.4), v3(12.6, 0, -27.8)], zone: lobbyZone, wait: 3.5 },
  );
  // security cameras
  d.cameras.push(new SecurityCamera(k.root, v3(-17.3, 7.6, -16), v3(-9.5, 0, -6), v3(-9.5, 0, -26), 7, 2.3));
  d.cameras.push(new SecurityCamera(k.root, v3(17.3, 7.6, -14), v3(9.5, 0, -5), v3(9.5, 0, -18), 8.5, 2.3));
}

// =====================================================================
// LASER HALL
// =====================================================================
function buildLaserHall(k: Kit, d: LevelData, loot: LootManager) {
  const z0 = -32.6;
  const z1 = -58.6;
  const len = z0 - z1;
  const zc = (z0 + z1) / 2;
  k.block(0, -0.4, zc, 9.4, 0.8, len, Mats.panel(), { tile: 3 });
  k.block(0, 5.9, zc, 10, 0.6, len, Mats.darkMetal(), { cast: true });
  for (const s of [-1, 1]) {
    k.block(s * 4.6, 2.9, zc, 1.2, 5.8, len, Mats.panel(), { tile: 3 });
    k.rblock(s * 3.95, 0.04, zc, 0.12, 0.06, len, Mats.glow(0xff2a3d, 2.5), 0.02, { cast: false });
    k.rblock(s * 3.98, 2.9, zc, 0.06, 0.25, len, Mats.hazard(1, 6), 0.02, { cast: false });
  }
  for (let z = z0 - 2; z > z1 + 1; z -= 4) k.rblock(0, 5.55, z, 2.4, 0.08, 0.35, Mats.glow(0xdfe8ff, 3), 0.03, { cast: false });
  k.rblock(0, 0.012, z0 - 1.2, 7.8, 0.02, 1.2, Mats.hazard(5, 1), 0.005, { cast: false });

  const emit = (p: THREE.Vector3, rotY: number) => {
    const e = laserEmitter();
    k.prop(e, p.x, p.y, p.z, rotY);
    return e;
  };

  // 1) low static beam — jump it
  emit(v3(-3.95, 0.45, -36), Math.PI / 2);
  emit(v3(3.95, 0.45, -36), -Math.PI / 2);
  d.lasers.push(
    new LaserRig(k.root, 1, (t, b) => {
      b[0].a.set(-3.9, 0.45, -36);
      b[0].b.set(3.9, 0.45, -36);
    }, { zone: 'hall' }),
  );

  // 2) spinning laser cross
  const spinner = (z: number, arms: number, speed: number, h: number) => {
    const pylon = new THREE.Group();
    pylon.add(new THREE.Mesh(cyl(0.32, 0.4, h + 0.3, 20), Mats.gunmetal()));
    pylon.children[0].position.y = (h + 0.3) / 2;
    const cap = new THREE.Mesh(sphere(0.3, 16, 12), Mats.glow(0xff2a3d, 4));
    cap.position.y = h + 0.3;
    pylon.add(cap);
    pylon.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    k.prop(pylon, 0, 0, z);
    k.physics.cylinder(0, (h + 0.3) / 2, z, 0.38, h + 0.3);
    d.lasers.push(
      new LaserRig(k.root, arms, (t, b) => {
        for (let i = 0; i < arms; i++) {
          const a = t * speed + (i / arms) * Math.PI * 2;
          b[i].a.set(Math.cos(a) * 0.35, h, z + Math.sin(a) * 0.35);
          b[i].b.set(Math.cos(a) * 3.9, h, z + Math.sin(a) * 3.9);
        }
      }, { zone: 'hall' }),
    );
  };
  spinner(-41, 4, 1.6, 0.6);

  // 3) sweeping curtain of vertical beams
  const rail = new THREE.Mesh(rbox(7.8, 0.12, 0.3, 0.04), Mats.darkMetal());
  rail.position.set(0, 0.06, -46.5);
  k.live(rail);
  const rail2 = rail.clone();
  rail2.position.y = 5.55;
  k.live(rail2);
  const carts = [new THREE.Group(), new THREE.Group()];
  carts.forEach((c, i) => {
    c.add(new THREE.Mesh(rbox(1.3, 0.25, 0.45, 0.06), Mats.gunmetal()));
    c.position.set(0, i === 0 ? 0.15 : 5.45, -46.5);
    k.live(c);
  });
  d.lasers.push(
    new LaserRig(k.root, 3, (t, b) => {
      const c = Math.sin(t * 1.35) * 2.75;
      for (let i = 0; i < 3; i++) {
        const x = c + (i - 1) * 0.42;
        b[i].a.set(x, 0.2, -46.5);
        b[i].b.set(x, 5.4, -46.5);
      }
      carts[0].position.x = c;
      carts[1].position.x = c;
    }, { zone: 'hall' }),
  );

  // 4) slide-under wall: beams from 1.1 m up to the ceiling
  const heights = [1.12, 1.9, 2.7, 3.5, 4.3, 5.1];
  for (const h of heights) {
    emit(v3(-3.95, h, -51), Math.PI / 2);
    emit(v3(3.95, h, -51), -Math.PI / 2);
  }
  d.lasers.push(
    new LaserRig(k.root, heights.length, (t, b) => {
      heights.forEach((h, i) => {
        b[i].a.set(-3.9, h, -51);
        b[i].b.set(3.9, h, -51);
      });
    }, { zone: 'hall' }),
  );
  const sign = new THREE.Mesh(rbox(1.6, 0.5, 0.06, 0.04), Mats.hazard(2, 1));
  sign.position.set(-3.9, 0.6, -49.4);
  sign.rotation.y = Math.PI / 2;
  k.live(sign);

  // 5) faster tri-spinner
  spinner(-55.4, 3, -2.1, 0.58);

  loot.place('cash', v3(0, 0, -38.6));
  loot.place('cash', v3(2.5, 0, -49));
  loot.place('present', v3(-2.8, 0, -53.2));
}

// =====================================================================
// VENT DUCT (secret shortcut from the security office to the atrium)
// =====================================================================
function buildVent(k: Kit, d: LevelData, loot: LootManager) {
  const z0 = -32.6;
  const z1 = -58.1;
  const zc = (z0 + z1) / 2;
  const len = z0 - z1;
  k.block(13.5, -0.3, zc, 2.8, 0.6, len, Mats.steel(), { tile: 2 });
  k.block(13.5, 2.5, zc, 2.8, 0.6, len, Mats.steel(), { tile: 2, cast: false });
  for (const s of [-1, 1]) k.block(13.5 + s * 1.2, 1.1, zc, 0.4, 2.2, len, Mats.steel(), { tile: 2 });
  for (let z = z0 - 3; z > z1 + 1; z -= 5) {
    k.rblock(13.5, 2.15, z, 0.5, 0.08, 0.5, Mats.glow(0xbfe6ff, 3.2), 0.03, { cast: false });
    k.rblock(13.5, 2.13, z, 0.6, 0.04, 0.6, Mats.darkMetal(), 0.02, { cast: false });
  }
  // spinning fan in a side bay
  const fan = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(rbox(0.14, 0.75, 0.04, 0.03), Mats.chrome());
    blade.position.y = 0.4;
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * Math.PI * 2;
    arm.add(blade);
    fan.add(arm);
  }
  fan.add(new THREE.Mesh(sphere(0.12, 12, 8), Mats.gunmetal()));
  fan.position.set(12.42, 1.15, -45);
  fan.rotation.y = Math.PI / 2;
  k.live(fan);
  d.animated.push((t, dt) => (fan.rotation.x += dt * 9));
  loot.place('goldBar', v3(13.5, 0, -39));
  loot.place('moneyBag', v3(13.5, 0, -45.5));
  loot.place('goldBar', v3(13.5, 0, -52));
  const exit = new Vent(k.physics, k.root, v3(13.5, 1.1, -58.35), 2.0, 2.2, 0);
  exit.prompt = 'Kick Open Vent';
  d.vents.push(exit);
}

// =====================================================================
// VAULT ATRIUM
// =====================================================================
function buildAtrium(k: Kit, d: LevelData, bulbs: BulbField, orn: OrnamentField, decor: DecorFn, loot: LootManager, q: { snow: number }) {
  const cream = Mats.marbleCream(1, 1);
  // front wall (z = −58.6) with hall + vent openings
  const fz = -58.6;
  k.block(0, -7.2, fz, 34, 14.4, 1.2, cream, { tile: 4 });
  k.block(-10, 7, fz, 14, 14, 1.2, cream, { tile: 4 });
  k.block(7.75, 7, fz, 9.5, 14, 1.2, cream, { tile: 4 });
  k.block(15.75, 7, fz, 2.5, 14, 1.2, cream, { tile: 4 });
  k.block(0, 9.3, fz, 6, 9.4, 1.2, cream, { tile: 4 });
  k.block(13.5, 8.1, fz, 2, 11.8, 1.2, cream, { tile: 4 });
  // side walls
  for (const s of [-1, 1]) {
    k.block(s * 17.6, 0, -76.6, 1.2, 28.4, 37, cream, { tile: 4 });
    for (let z = -61; z >= -92; z -= 6.2) {
      k.rblock(s * 16.9, 5, z, 0.3, 18, 0.9, Mats.goldSatin(), 0.08);
      k.prop(snowflake(0.9, Mats.gold()), s * 16.85, 7.4, z - 3.1, s > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
    // hanging velvet banners
    for (const z of [-67, -79]) {
      const b = new THREE.Group();
      b.add(new THREE.Mesh(rbox(0.1, 5, 1.8, 0.05), Mats.velvet()));
      const st = new THREE.Mesh(star3D(0.45, 0.2, 0.08), Mats.gold());
      st.position.set(s * -0.08, 0.6, 0);
      st.rotation.y = Math.PI / 2;
      b.add(st);
      k.prop(b, s * 16.8, 9, z);
    }
  }
  // ledges
  k.block(0, -7.2, -60.8, 34, 14.4, 4.4, Mats.marbleFloor(1, 1), { tile: 8 });
  k.rblock(0, 0.02, -63, 34, 0.1, 0.25, Mats.gold(), 0.04);
  k.block(0, -7.2, -91.3, 34, 14.4, 6.6, Mats.marbleFloor(1, 1), { tile: 8 });
  k.rblock(0, 0.02, -88, 34, 0.1, 0.25, Mats.gold(), 0.04);
  // pit floor: glowing security grid
  const gridTex = TextureLib.laserGrid().clone();
  gridTex.repeat.set(17, 12.5);
  gridTex.needsUpdate = true;
  const gridMat = new THREE.MeshBasicMaterial({ map: gridTex, color: new THREE.Color(2.2, 2.2, 2.2) });
  k.block(0, -14.4, -75.5, 34, 0.8, 25, gridMat, { tile: 2 });
  for (const y of [-11, -7.5]) {
    const fog = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 25),
      new THREE.MeshBasicMaterial({ map: TextureLib.radial('rgba(255,40,60,0.55)', 'rgba(255,40,60,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    fog.rotation.x = -Math.PI / 2;
    fog.position.set(0, y, -75.5);
    fog.userData.noAO = true;
    k.live(fog);
  }
  // roof with skylight
  k.block(0, 14.3, -63.3, 36, 0.6, 9.4, Mats.plaster(), { cast: false });
  k.block(0, 14.3, -90.5, 36, 0.6, 9, Mats.plaster(), { cast: false });
  k.block(-12.5, 14.3, -76.5, 11, 0.6, 18, Mats.plaster(), { cast: false });
  k.block(12.5, 14.3, -76.5, 11, 0.6, 18, Mats.plaster(), { cast: false });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(14, 18), new THREE.MeshPhysicalMaterial({ color: 0x8fb6ff, transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false }));
  sky.rotation.x = Math.PI / 2;
  sky.position.set(0, 14.1, -76.5);
  k.live(sky);
  for (let x = -7; x <= 7; x += 3.5) k.rblock(x, 14, -76.5, 0.15, 0.2, 18, Mats.gold(), 0.04, { cast: false });
  for (let z = -85; z <= -68; z += 4.25) k.rblock(0, 14, z, 14, 0.2, 0.15, Mats.gold(), 0.04, { cast: false });
  // moonlight shafts
  for (const r of [0.35, -0.35]) {
    const shaft = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 26),
      new THREE.MeshBasicMaterial({ map: TextureLib.radial('rgba(150,190,255,0.22)', 'rgba(150,190,255,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    shaft.position.set(0, 2, -76.5);
    shaft.rotation.set(0, r + Math.PI / 2, 0.12);
    shaft.userData.noAO = true;
    k.live(shaft);
  }
  const snow = new SnowVolume(v3(-7, -13, -85), v3(7, 14, -68), 1200 * q.snow, { speed: 0.9, opacity: 0.7 });
  k.live(snow.points);
  d.snow.push(snow);

  // ---- center route ----
  k.cylinder(0, -7, -66.6, 1.7, 14, Mats.marbleCream(1, 3), { col: true });
  const rimA = new THREE.Mesh(torus(1.7, 0.1, 10, 48), Mats.gold());
  rimA.rotation.x = Math.PI / 2;
  k.prop(rimA, 0, 0, -66.6);
  const giftPlat = (variant: number) => {
    const g = present(3.2, 0.7, 3.2, variant, 0xf2c14e, false, false);
    g.children.forEach((c) => (c.position.y -= 0.35));
    return g;
  };
  const p2 = giftPlat(2);
  k.live(p2);
  d.platforms.push(new MovingPlatform(k.physics, p2, v3(1.6, 0.35, 1.6), (t, o) => o.set(Math.sin(t * 0.9) * 4.2, -0.35, -71.3)));
  k.cylinder(0, -7, -78, 5, 14, Mats.marbleCream(1, 3), { col: true });
  const rimB = new THREE.Mesh(torus(5, 0.14, 10, 80), Mats.gold());
  rimB.rotation.x = Math.PI / 2;
  k.prop(rimB, 0, 0, -78);
  k.rblock(0, 0.01, -78, 9.4, 0.02, 0.02, Mats.gold(), 0.005, { cast: false });
  d.sweepers.push(new Sweeper(k.physics, k.root, v3(0, 0, -78), { length: 4.1, arms: 2, height: 0.62, speed: 1.15 }));
  const p4 = giftPlat(5);
  k.live(p4);
  d.platforms.push(new MovingPlatform(k.physics, p4, v3(1.6, 0.35, 1.6), (t, o) => o.set(0, -0.35, -85.4 + Math.sin(t * 1.1) * 1.45)));

  // ---- right route: treadmill bridge (runs against you) ----
  const belt = new Conveyor(k.physics, k.root, v3(10, 0.0, -75.5), 2.6, 24.4, false, 4.2);
  d.conveyors.push(belt);
  for (const z of [-63.6, -87.4]) k.cylinder(10, -7, z, 0.5, 14, Mats.gunmetal());
  for (const z of [-69.5, -75.5, -81.5]) {
    k.rblock(10, 0.24, z, 2.5, 0.42, 0.42, Mats.candy(2, 1), 0.2, { col: true });
  }
  loot.place('goldBar', v3(10, 0.45, -72.5));
  loot.place('cash', v3(10, 0.45, -78.5));
  loot.place('goldBar', v3(10, 0.45, -84.5));

  // ---- left route: bobbing gift boxes ----
  const zs = [-66.9, -70.9, -74.9, -78.9, -82.9, -86.2];
  zs.forEach((z, i) => {
    const g = present(2.4, 0.7, 2.4, i + 1, [0xf2c14e, 0xffffff][i % 2], false, false);
    g.children.forEach((c) => (c.position.y -= 0.35));
    k.live(g);
    d.platforms.push(new MovingPlatform(k.physics, g, v3(1.2, 0.35, 1.2), (t, o) => o.set(-10, -0.35 + Math.sin(t * 1.25 + i * 1.15) * 1.05, z)));
  });
  loot.place('diamond', v3(-10, 1.6, -78.9));

  // ---- far ledge decor ----
  for (const s of [-1, 1]) {
    const tr = christmasTree(7.2, { bulbs, ornaments: orn, seed: s > 0 ? 41 : 42, at: v3(s * 10.5, 0, -91.8) });
    k.prop(tr, s * 10.5, 0, -91.8);
    k.physics.cylinder(s * 10.5, 2, -91.8, 1.6, 4);
  }
  loot.place('cocoa', v3(14.5, 0, -90.5));
  loot.place('cash', v3(-14.5, 0, -90.5));
  decor('ornaments', -14.4, 0, -60.8);
  decor('candyCanes', 15.6, 0, -60.8);
  decor('giftTower', -6.5, 0, -92.2);

  // garlands across the atrium
  for (const z of [-66, -76, -86]) {
    const g = new THREE.Group();
    garland(v3(-16.8, 11, z), v3(0, 11.2, z), 1.6, g, bulbs, 0.18);
    garland(v3(0, 11.2, z), v3(16.8, 11, z), 1.6, g, bulbs, 0.18);
    k.prop(g, 0, 0, 0);
    const bb = new THREE.Group();
    bow(bb, 0, 11, z, 0.9);
    k.prop(bb, 0, 0, 0);
  }

  // ---- vault wall with round opening ----
  const shape = new THREE.Shape();
  shape.moveTo(-17, 0);
  shape.lineTo(17, 0);
  shape.lineTo(17, 14);
  shape.lineTo(-17, 14);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 3.1, 3.45, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const wallGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false, curveSegments: 48 });
  const uv = wallGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
  k.batch.add(wallGeo, cream, new THREE.Matrix4().makeTranslation(0, 0, -95.2));
  k.physics.box(-9.6, 7, -94.6, 14.8, 14, 1.2);
  k.physics.box(9.6, 7, -94.6, 14.8, 14, 1.2);
  k.physics.box(0, 9.85, -94.6, 4.4, 8.3, 1.2);
  const frame = new THREE.Mesh(torus(3.62, 0.34, 18, 80), Mats.gold());
  k.prop(frame, 0, 3.1, -93.95);
  const frame2 = new THREE.Mesh(torus(3.55, 0.2, 14, 80), Mats.chrome());
  k.prop(frame2, 0, 3.1, -94.2);
  k.rblock(0, 0.03, -94.6, 4.6, 0.06, 1.4, Mats.gold(), 0.02);
  k.prop(wreath(1.25), 0, 8.4, -93.75);
  k.rblock(0, 10.4, -93.95, 9, 1.2, 0.3, Mats.velvet(), 0.1);
  const vsign = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 1.0), Mats.signMat('GRAND VAULT'));
  vsign.position.set(0, 10.4, -93.78);
  k.live(vsign);
  d.vault = new VaultDoor(k.physics, k.root, v3(0, 3.1, -94.6), 3.4);

  // cameras sweeping the side routes
  d.cameras.push(new SecurityCamera(k.root, v3(-16.9, 9.5, -76), v3(-10, -0.3, -66), v3(-10, -0.3, -86), 7.5, 2.4));
  d.cameras.push(new SecurityCamera(k.root, v3(16.9, 9.5, -76), v3(10, 0, -66), v3(10, 0, -86), 6.5, 2.4));
}

// =====================================================================
// GRAND VAULT
// =====================================================================
function buildVault(k: Kit, d: LevelData, decor: DecorFn, loot: LootManager) {
  const z0 = -95.2;
  const z1 = -125.2;
  const zc = (z0 + z1) / 2;
  const len = z0 - z1;
  const dep = Mats.deposit(1, 1);
  k.block(0, -0.4, zc, 29.2, 0.8, len, Mats.marbleRed(1, 1), { tile: 3 });
  k.block(0, 9.3, zc, 30, 0.6, len, Mats.plaster(), { cast: false });
  k.block(-14.6, 4.5, zc, 1.2, 9, len, dep, { tile: 2.4 });
  k.block(0, 4.5, z1 - 0.6, 30.4, 9, 1.2, dep, { tile: 2.4 });
  // right wall with the armored gate opening (z −110.9 … −107.1)
  k.block(14.6, 4.5, (-110.9 + z1) / 2, 1.2, 9, -110.9 - z1, dep, { tile: 2.4 });
  k.block(14.6, 4.5, (-107.1 + z0) / 2, 1.2, 9, z0 + 107.1, dep, { tile: 2.4 });
  k.block(14.6, 6.4, -109, 1.2, 5.2, 3.8, dep, { tile: 2.4 });
  // inner side of the vault-door wall
  k.rblock(-9.3, 4.5, -95.25, 9.6, 9, 0.1, dep, 0.02);
  k.rblock(9.3, 4.5, -95.25, 9.6, 9, 0.1, dep, 0.02);
  // gold floor inlay + coffered gold ceiling
  const inlay = new THREE.Mesh(torus(3.6, 0.08, 8, 80), Mats.gold());
  inlay.rotation.x = Math.PI / 2;
  k.prop(inlay, 0, 0.005, -110);
  for (let x = -12; x <= 12; x += 4) k.rblock(x, 8.95, zc, 0.2, 0.14, len, Mats.gold(), 0.04, { cast: false });
  for (let z = -98; z >= -122; z -= 4) k.rblock(0, 8.95, z, 28, 0.14, 0.2, Mats.gold(), 0.04, { cast: false });

  // central pedestal + the Star of the North
  k.cylinder(0, 0.55, -110, 1.25, 1.1, Mats.marbleCream(1, 1), { col: true, rt: 1.05 });
  const pr = new THREE.Mesh(torus(1.25, 0.08, 10, 48), Mats.gold());
  pr.rotation.x = Math.PI / 2;
  k.prop(pr, 0, 0.05, -110);
  const pr2 = pr.clone();
  k.prop(pr2, 0, 1.1, -110, 0, 0.85);
  loot.place('starDiamond', v3(0, 1.1, -110));
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 1.4, 7.6, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.45, 0.25), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  shaft.position.set(0, 4.9, -110);
  shaft.userData.noAO = true;
  k.live(shaft);
  for (const y of [0.02, 3.35]) {
    const ring = new THREE.Mesh(torus(2.3, 0.07, 8, 64), Mats.darkMetal());
    ring.rotation.x = Math.PI / 2;
    k.prop(ring, 0, y, -110);
  }
  d.lasers.push(
    new LaserRig(k.root, 2, (t, b) => {
      for (let i = 0; i < 2; i++) {
        const a = t * 1.15 + i * Math.PI;
        const x = Math.cos(a) * 2.3;
        const z = -110 + Math.sin(a) * 2.3;
        b[i].a.set(x, 0.05, z);
        b[i].b.set(x, 3.3, z);
      }
    }, { zone: 'vault' }),
  );

  // coin mountains (decor) + collectable gold piles
  const pile1 = coinPile(3.3, 2.6, 300, 3);
  pile1.position.set(-10.3, 0, -121.3);
  k.live(pile1);
  k.physics.cylinder(-10.3, 0.7, -121.3, 2.8, 1.4);
  const pile2 = coinPile(3.3, 2.6, 300, 7);
  pile2.position.set(10.3, 0, -121.3);
  k.live(pile2);
  k.physics.cylinder(10.3, 0.7, -121.3, 2.8, 1.4);
  decor('goldPile', -11.2, 0, -110);
  decor('goldPile', 11.2, 0, -116.5);
  decor('goldPile', -5.5, 0, -118.5);
  decor('goldPile', 5.5, 0, -104);

  // gold bars on pallets
  for (const [x, z] of [
    [-11.2, -104],
    [-5.8, -123],
    [5.8, -123],
  ]) {
    k.rblock(x, 0.12, z, 1.7, 0.24, 1.3, Mats.wood(), 0.04, { col: true });
    loot.place('goldBar', v3(x - 0.45, 0.24, z), 0.2);
    loot.place('goldBar', v3(x + 0.45, 0.24, z), -0.2);
  }
  // golden presents on mini plinths
  for (const [x, z] of [
    [-12.6, -116.8],
    [12.6, -120],
    [0, -123.6],
    [4.2, -116.5],
  ]) {
    k.rblock(x, 0.3, z, 1.0, 0.6, 1.0, Mats.marbleCream(), 0.08, { col: true });
    loot.place('goldPresent', v3(x, 0.6, z));
  }
  loot.place('moneyBag', v3(-8, 0, -114));
  loot.place('moneyBag', v3(8.4, 0, -110.6));
  loot.place('moneyBag', v3(-3.5, 0, -116.2));

  // pressure plate + push block + armored gate
  d.plate = new PressurePlate(k.root, v3(6.2, 0, -100.3), 1.0);
  d.pushBlocks.push(new PushBlock(k.physics, k.root, v3(2.6, 0, -103.8), 1.5));
  d.gate = new TimedGate(k.physics, k.root, v3(14.6, 0, -109), 3.6, 3.6, Math.PI / 2, 4.5);
  const hint = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), Mats.signMat('PRESS TO OPEN GATE'));
  hint.position.set(6.2, 2.6, -98.1);
  k.live(hint);
  k.rblock(6.2, 1.3, -98.0, 0.12, 2.6, 0.12, Mats.gold(), 0.04, { col: true });

  // alarm-only laser fence between the treasure and the gate (blinks)
  for (const y of [0.45, 1.05, 1.65]) {
    k.prop(laserEmitter(), 9, y, -103.3);
    k.prop(laserEmitter(), 9, y, -114.7, Math.PI);
  }
  d.lasers.push(
    new LaserRig(k.root, 3, (t, b) => {
      const on = t % 2.6 < 1.5;
      [0.45, 1.05, 1.65].forEach((y, i) => {
        b[i].a.set(9, y, -103.4);
        b[i].b.set(9, y, -114.6);
        b[i].on = on;
      });
    }, { zone: 'vault-alarm', alarmOnly: true }),
  );
  // alarm beacons
  for (const x of [-7, 7]) {
    const bcn = new THREE.Group();
    bcn.add(new THREE.Mesh(cyl(0.25, 0.3, 0.2, 16), Mats.darkMetal()));
    const lamp = new THREE.Mesh(sphere(0.24, 16, 12), Mats.glow(0x551015, 1));
    lamp.position.y = -0.22;
    bcn.add(lamp);
    bcn.position.set(x, 8.9, -110);
    k.live(bcn);
    d.alarmBeacons.push(bcn);
  }
  d.cameras.push(new SecurityCamera(k.root, v3(13.9, 7.4, -97), v3(-6, 0, -114), v3(6, 0, -114), 6, 2.2));
}

// =====================================================================
// COUNTING ROOM
// =====================================================================
function buildCounting(k: Kit, d: LevelData, decor: DecorFn, loot: LootManager) {
  const x0 = 15.2;
  const x1 = 40;
  const xc = (x0 + x1) / 2;
  const w = x1 - x0;
  k.block(xc, -0.4, -109, w, 0.8, 27.2, Mats.steel(), { tile: 3 });
  k.block(xc, 7.3, -109, w + 1, 0.6, 28, Mats.darkMetal(), { cast: false });
  k.block(xc, 3.5, -122.6, w + 1.2, 7, 1.2, Mats.brick(1, 1), { tile: 3 });
  k.block(xc, 3.5, -95.4, w + 1.2, 7, 1.2, Mats.brick(1, 1), { tile: 3 });
  k.block(40.6, 3.5, (-111 - 122) / 2, 1.2, 7, 11, Mats.brick(1, 1), { tile: 3 });
  k.block(40.6, 3.5, (-107 - 96) / 2, 1.2, 7, 11, Mats.brick(1, 1), { tile: 3 });
  k.block(40.6, 5.6, -109, 1.2, 2.8, 4, Mats.brick(1, 1), { tile: 3 });
  // industrial lamps
  for (const x of [20, 28, 36])
    for (const z of [-102, -116]) {
      const lamp = new THREE.Group();
      lamp.add(new THREE.Mesh(cone(0.6, 0.45, 20, ), Mats.plastic(0x1d9a55)));
      const b = new THREE.Mesh(sphere(0.2, 12, 10), Mats.glow(0xfff0d0, 5));
      b.position.y = -0.2;
      lamp.add(b);
      lamp.add(new THREE.Mesh(cyl(0.02, 0.02, 1.6, 6), Mats.darkMetal()));
      lamp.children[2].position.y = 0.9;
      k.prop(lamp, x, 5.9, z);
    }
  // conveyors crossing the escape route
  const belts: [number, number][] = [
    [20.3, 5],
    [26.1, -5.5],
    [31.9, 6],
  ];
  belts.forEach(([x, speed], i) => {
    const c = new Conveyor(k.physics, k.root, v3(x, 0.06, -109), 3, 20, false, speed);
    d.conveyors.push(c);
    const endZ = speed > 0 ? -97.6 : -120.4;
    const startZ = speed > 0 ? -119.6 : -98.4;
    // wrap-o-matic machine at the belt's end (hazard)
    const m = new THREE.Group();
    m.add(new THREE.Mesh(rbox(3.8, 2.7, 2.2, 0.35), Mats.candy(3, 2)));
    m.children[0].position.y = 1.35;
    const mouth = new THREE.Mesh(rbox(3.0, 1.0, 0.3, 0.12), Mats.blackGloss());
    mouth.position.set(0, 0.6, speed > 0 ? -1.05 : 1.05);
    m.add(mouth);
    for (const yy of [0.25, 1.0]) {
      const roller = new THREE.Mesh(cyl(0.2, 0.2, 3.2, 16), Mats.chrome());
      roller.rotation.z = Math.PI / 2;
      roller.position.set(0, yy, speed > 0 ? -1.15 : 1.15);
      m.add(roller);
    }
    const lightTop = new THREE.Mesh(sphere(0.22, 12, 10), Mats.glow(0x4dff8a, 4));
    lightTop.position.set(1.4, 2.85, 0);
    m.add(lightTop);
    const st = new THREE.Mesh(star3D(0.4, 0.18, 0.1), Mats.gold());
    st.position.set(0, 1.9, speed > 0 ? -1.12 : 1.12);
    m.add(st);
    m.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    k.prop(m, x, 0, endZ);
    k.physics.box(x, 1.35, endZ, 3.8, 2.7, 2.2);
    const hz = { id: 1000 + i, box: box3(x - 2.1, 0, endZ - 1.4, x + 2.1, 2.8, endZ + 1.4), knock: (p: THREE.Vector3) => v3(Math.sign(p.x - x || 1) * 3, 7, -Math.sign(speed) * 9), damage: 1, dropLoot: true, label: 'Wrap-o-Matic' };
    d.hazards.push(hz);
    // hopper at the belt start that spits out loot
    const hop = new THREE.Group();
    const funnel = new THREE.Mesh(cyl(1.1, 0.5, 1.2, 20, true), new THREE.MeshPhysicalMaterial({ color: 0x4a515e, metalness: 0.9, roughness: 0.42, side: THREE.DoubleSide }));
    funnel.position.y = 3.6;
    hop.add(funnel);
    const pipe = new THREE.Mesh(cyl(0.45, 0.45, 1.6, 16), Mats.gunmetal());
    pipe.position.y = 2.3;
    hop.add(pipe);
    k.prop(hop, x, 0, startZ);
    d.beltSpawners.push({ conveyor: c, start: v3(x, 1.4, startZ), end: box3(x - 2, -1, endZ - 1.5, x + 2, 3, endZ + 1.5), timer: 1 + i, kinds: ['present', 'cash', 'cash', 'moneyBag', 'present'] });
  });
  // counting tables with cash
  for (const [x, z] of [
    [17.4, -98.6],
    [37.6, -98.6],
    [37.6, -119.4],
  ]) {
    k.rblock(x, 0.5, z, 2.2, 1.0, 1.4, Mats.wood(), 0.06, { col: true });
    loot.place('cash', v3(x - 0.5, 1.02, z));
    loot.place('cash', v3(x + 0.5, 1.02, z));
  }
  loot.place('cocoa', v3(17.4, 1.02, -119.2));
  k.rblock(17.4, 0.5, -119.4, 2.2, 1.0, 1.4, Mats.wood(), 0.06, { col: true });
  // shelving with cash boxes
  for (const z of [-104, -114]) {
    k.rblock(39.4, 1.6, z, 0.8, 3.2, 3.2, Mats.gunmetal(), 0.05, { col: true });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) k.rblock(39.2, 0.5 + r * 1.0, z - 1 + c, 0.6, 0.55, 0.85, Mats.matte(0x3f8f4f, 0.6), 0.04);
  }
  decor('giftTower', 37.2, 0, -103.4);
  decor('candyCanes', 16.6, 0, -103.2);
  decor('giftTower', 23.2, 0, -120.6);
  const zone = box3(15.6, -1, -121.6, 39.6, 4, -96.4);
  d.guards.push({ name: 'counting', route: [v3(23.1, 0, -102.8), v3(29, 0, -102.8), v3(29, 0, -115.2), v3(23.1, 0, -115.2)], zone, wait: 1.5 });
  // exit shutter
  d.shutters.push(new Shutter(k.physics, k.root, v3(40.6, 0, -109), 4, 4, Math.PI / 2, 0));
  const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), Mats.signMat('EXIT'));
  exitSign.position.set(39.95, 5.0, -109);
  exitSign.rotation.y = -Math.PI / 2;
  k.live(exitSign);
}

// =====================================================================
// LIGHTING
// =====================================================================
function buildLights(scene: THREE.Scene, d: LevelData) {
  const hemi = new THREE.HemisphereLight(0xb4c8ff, 0x3a2418, 0.55);
  d.root.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe6c8, 2.35);
  sun.castShadow = true;
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.035;
  sun.position.set(14, 40, 12);
  d.root.add(sun);
  d.root.add(sun.target);
  d.sun = sun;
  const pl = (x: number, y: number, z: number, color: number, intensity: number, dist: number) => {
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.set(x, y, z);
    d.root.add(l);
    return l;
  };
  // Four pooled lights follow the robber from room to room (see LightSpec).
  const front: LightSpec[] = [
    [7, 3.6, 12, 0xffb86b, 30, 20],
    [0, 8.4, -8, 0xffd9a0, 60, 30],
    [0, 8.4, -24, 0xffd9a0, 60, 30],
    [0, 7.4, -110, 0xffc45a, 85, 32],
  ];
  const counting: LightSpec = [27.6, 5.6, -109, 0xfff0d0, 45, 24];
  const depositW: LightSpec = [49, 5.8, -105, 0xe6eeff, 42, 22];
  const depositE: LightSpec = [66, 5.8, -112, 0xe6eeff, 42, 22];
  const mintGlow: LightSpec = [91, 2.6, -109, 0xff8a2a, 75, 34];
  const vault: LightSpec = [0, 7.4, -110, 0xffc45a, 85, 32];
  const street: LightSpec[] = [
    [188, 6.5, -139, 0xffcf8a, 55, 30],
    [206, 3.4, -139, 0xff2a3a, 30, 22],
    [225, 6.5, -139, 0xffcf8a, 45, 32],
    [255, 6.5, -139, 0xffcf8a, 55, 32],
  ];
  const roof: LightSpec[] = [
    [124, 16, -110, 0xffc890, 34, 24],
    [145, 19, -103, 0xff5ca8, 40, 24],
    [166, 18, -118, 0xffc890, 30, 22],
    [102, 16.5, -100, 0xffb070, 30, 20],
  ];
  d.lightPresets = {
    plaza: front,
    lobby: front,
    hall: front,
    vent: front,
    atrium: front,
    ante: front,
    vault: [counting, [0, 8.4, -24, 0xffd9a0, 60, 30], depositW, vault],
    counting: [counting, depositW, depositE, vault],
    deposit: [counting, depositW, depositE, mintGlow],
    mint: [mintGlow, [108, 10, -108, 0xffd9a0, 70, 28], depositE, [77, 6, -109, 0xffd9a0, 40, 20]],
    roof,
    street,
  };
  d.lightPool = front.map(([x, y, z, c, i, dist]) => pl(x, y, z, c, i, dist));
  d.alarmLight = pl(0, 6, -60, 0xff2233, 0, 34);
  scene.fog = new THREE.Fog(0x0b1030, 60, 220);
}
