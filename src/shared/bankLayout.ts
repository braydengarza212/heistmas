/**
 * Geometry of The Christmas Bank that both the browser and the game server
 * need: the level builder uses it to place zones and checkpoints, and the
 * server's run checks use it to tell whether a reported run is possible.
 * Plain numbers only (no three.js), so the server can import it.
 *
 * Route (east is +x, "deeper" is −z):
 *   plaza → lobby → laser hall | air duct → atrium → vault door → grand vault
 *   → counting room → deposit vaults → the mint (climb to its roof)
 *   → rooftops (zipline down) → getaway street.
 */

/** [x0, y0, z0, x1, y1, z1] */
export type Box = readonly [number, number, number, number, number, number];

export interface ZoneDef {
  id: string;
  box: Box;
  /** Progress stage: plaza 0 … street 10. Hall and vent are alternative stage-2 routes. */
  stage: number;
}

/** Order matters: a point inside several boxes belongs to the first (the mint's hall sits under the rooftop box). */
export const BANK_ZONES: readonly ZoneDef[] = [
  { id: 'plaza', box: [-26, -3, 0.7, 26, 20, 37], stage: 0 },
  { id: 'lobby', box: [-18, -1, -31.4, 18, 12, -0.7], stage: 1 },
  { id: 'hall', box: [-4, -1, -58.5, 4, 6, -31.5], stage: 2 },
  { id: 'vent', box: [12.3, -1, -58.5, 14.7, 3, -32.4], stage: 2 },
  { id: 'atrium', box: [-17, -15, -88, 17, 14, -58.7], stage: 3 },
  { id: 'ante', box: [-17, -1, -94.2, 17, 10, -88], stage: 4 },
  { id: 'vault', box: [-14, -1, -125, 14, 9, -95.2], stage: 5 },
  { id: 'counting', box: [15.2, -1, -122.5, 40.5, 7, -95.5], stage: 6 },
  { id: 'deposit', box: [40.6, -1, -122.5, 73.6, 7, -95.5], stage: 7 },
  { id: 'mint', box: [73.6, -6, -126.5, 112.8, 13.2, -91.5], stage: 8 },
  { id: 'roof', box: [73, 9.5, -130, 174, 40, -88], stage: 9 },
  { id: 'street', box: [172, -1, -152, 240, 9.5, -127], stage: 10 },
];

/** Highest progress stage (the getaway street). */
export const BANK_LAST_STAGE = 10;

/** Which zones you can walk between directly. */
export const BANK_ADJACENT: Readonly<Record<string, readonly string[]>> = {
  plaza: ['lobby'],
  lobby: ['plaza', 'hall', 'vent'],
  hall: ['lobby', 'atrium'],
  vent: ['lobby', 'atrium'],
  atrium: ['hall', 'vent', 'ante'],
  ante: ['atrium', 'vault'],
  vault: ['ante', 'counting'],
  counting: ['vault', 'deposit'],
  deposit: ['counting', 'mint'],
  mint: ['deposit', 'roof'],
  roof: ['mint', 'street'],
  street: ['roof'],
};

/**
 * Some doorways are the only way between two zones: the hatch over the
 * mint's last bounce pad onto the roof, and the zipline down to the street.
 * A run that changes zone anywhere else went through a wall.
 */
export const BANK_GATES: Readonly<Record<string, Box>> = {
  'mint>roof': [92.5, 8, -102, 103, 40, -90.5],
  'roof>street': [176, -1, -153, 202, 40, -129.5],
};

export interface CheckpointDef {
  id: string;
  box: Box;
  pos: readonly [number, number, number];
  yaw: number;
}

const EAST = Math.PI / 2;

export const BANK_CHECKPOINTS: readonly CheckpointDef[] = [
  { id: 'start', box: [-26, -3, 4, 26, 10, 37], pos: [0, -1.2, 28], yaw: Math.PI },
  { id: 'lobby', box: [-18, -1, -31, 18, 8, -1.5], pos: [0, 0, -3], yaw: Math.PI },
  { id: 'atrium', box: [-17, -1, -63, 17, 6, -58.7], pos: [0, 0, -61], yaw: Math.PI },
  { id: 'ante', box: [-17, -1, -94, 17, 6, -88.2], pos: [6, 0, -91], yaw: Math.PI },
  { id: 'vault', box: [-14, -1, -125, 14, 6, -96], pos: [6, 0, -99], yaw: Math.PI },
  { id: 'counting', box: [15.3, -1, -122, 40, 6, -96], pos: [17.2, 0, -109], yaw: EAST },
  { id: 'deposit', box: [41.2, -1, -122, 46, 6, -96], pos: [43.6, 0, -109], yaw: EAST },
  { id: 'mint', box: [74.4, -1, -126, 78.4, 6, -92], pos: [76.6, 0, -109], yaw: EAST },
  { id: 'climb', box: [103.6, -1, -126, 112.4, 2.5, -92], pos: [105.2, 0, -105.5], yaw: EAST },
  { id: 'roof', box: [92, 13.3, -127, 113.6, 24, -90.8], pos: [101.5, 14, -101], yaw: EAST },
  { id: 'roof2', box: [136.4, 14.6, -126, 145, 25, -98], pos: [139.2, 15.4, -112], yaw: EAST },
  { id: 'street', box: [182, -1, -151, 200, 6, -128], pos: [190, 0, -137], yaw: EAST },
];

export const BANK = {
  spawn: { pos: [0, -1.2, 28] as const, yaw: Math.PI },
  killY: -6,
  minLoot: 5000,
  /** Single-player time limit. Online rounds use the round length instead. */
  timeLimit: 540,
  /** Getaway van position (facing +x); the extraction ring sits 5.2 m behind its rear doors. */
  getaway: [230, 0, -139] as const,
  extraction: { x: 224.8, y: 0, z: -139, radius: 2.4 },
  /** Most valuable single pickup (The Star of the North). */
  maxPickupValue: 10000,
} as const;

export function inBox(b: Box, x: number, y: number, z: number, margin = 0) {
  return x >= b[0] - margin && x <= b[3] + margin && y >= b[1] - margin && y <= b[4] + margin && z >= b[2] - margin && z <= b[5] + margin;
}

/** First zone whose box contains the point, as the client's HUD does. */
export function zoneAt(x: number, y: number, z: number): ZoneDef | null {
  for (const zd of BANK_ZONES) if (inBox(zd.box, x, y, z)) return zd;
  return null;
}
