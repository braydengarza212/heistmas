/**
 * Character scale. Robbers and penguin guards are drawn and collide at this
 * fraction of their original size while the bank, jumps, speeds and timings
 * stay the same, which is the same as making every stage 1 / CHAR_SCALE times
 * bigger around them (room for a 200-robber bank). The camera follows suit.
 */
export const CHAR_SCALE = 0.68;
