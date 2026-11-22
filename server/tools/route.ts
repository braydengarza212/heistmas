/**
 * A plausible path through the whole heist, used by the scripted bots and the
 * run-check tests: [x, y, z] waypoints from the spawn to the getaway ring.
 * The y matters: the mint's catwalks sit under the rooftop zone.
 */
export const ROUTE: readonly (readonly [number, number, number])[] = [
  [0, -1.2, 28], // spawn
  [0, 0, 2],
  [0, 0, -12], // pickup
  [0, 0, -30],
  [0, 0, -45],
  [0, 0, -57],
  [0, 0, -70], // pickup
  [0, 0, -86],
  [0, 0, -91.5], // vault door: crack here
  [0, 0, -100],
  [0, 0, -106], // pickup
  [9, 0, -109],
  [16, 0, -109],
  [28, 0, -109],
  [39, 0, -109],
  [43.6, 0, -109], // deposit vaults
  [44.2, 0, -98.5],
  [66, 0, -98.5],
  [70, 0, -103.5],
  [72, 0, -109],
  [76.6, 0, -109], // the mint
  [91, 0, -109],
  [94.2, 0, -109],
  [101.5, 0, -109],
  [105.2, 0, -109],
  [107.6, 0, -109], // bounce pad
  [111, 4.2, -108],
  [111, 4.2, -97.6],
  [111, 8.6, -95.5], // hoist
  [97.8, 8.6, -95.5], // pad under the hatch
  [97.8, 14, -99.6], // rooftops
  [113.2, 14, -109],
  [118, 12.8, -110],
  [130.6, 12.8, -111],
  [133.7, 15.4, -111], // gondola
  [139, 15.4, -111],
  [151.6, 15.4, -111],
  [154.6, 15.5, -110.6], // chimneys
  [157.9, 15.5, -112.3],
  [161.6, 15.4, -113],
  [171.4, 15.4, -126.6], // zipline
  [191.5, 0.2, -140.5], // street
  [196.6, 0.6, -139.5],
  [206.6, 0, -139.2],
  [217, 0, -139],
  [224.8, 0, -139], // getaway ring
];

export const CRACK_AT = 8;

export const PICKUPS: readonly { at: number; v: number }[] = [
  { at: 2, v: 500 },
  { at: 6, v: 1000 },
  { at: 10, v: 5000 },
];

/** Horizontal length of the route (metres). */
export function routeLength() {
  let d = 0;
  for (let i = 1; i < ROUTE.length; i++) d += Math.hypot(ROUTE[i][0] - ROUTE[i - 1][0], ROUTE[i][2] - ROUTE[i - 1][2]);
  return d;
}
