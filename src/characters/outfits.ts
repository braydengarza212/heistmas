/**
 * Visual definitions for every cosmetic. Unlock rules live in
 * progress/cosmetics.ts; this file is purely about looks.
 */

export type HatKind = 'santa' | 'beanie' | 'tophat' | 'elf' | 'antlers' | 'crown' | 'headband' | 'earmuffs' | 'star' | 'pudding' | 'none';
export type BodyFinish = 'velvet' | 'gold' | 'fur' | 'snow' | 'satin';

export interface SkinStyle {
  name: string;
  body: number;
  finish: BodyFinish;
  face: number;
  trim: number;
  fluffyTrim: boolean;
  belt: boolean;
  beltColor: number;
  buckle: number;
  gloves: number;
  boots: number;
  pants: number;
  beard: boolean;
  beardColor: number;
  brows: number;
  nose: number;
  carrotNose?: boolean;
  elfEars?: boolean;
  coalButtons?: boolean;
  scarf?: [number, number];
  frontPlacket?: boolean;
  defaultHat: HatKind;
  hatColor: number;
  hatTrim: number;
  /** Default facial expression bias. */
  scowl?: boolean;
}

export const SKINS: Record<string, SkinStyle> = {
  'skin.criminal': {
    name: 'Criminal Santa',
    body: 0xd31f2b,
    finish: 'velvet',
    face: 0xffcfae,
    trim: 0xfbf7f0,
    fluffyTrim: true,
    belt: true,
    beltColor: 0x16161b,
    buckle: 0xf2c14e,
    gloves: 0x1a1a20,
    boots: 0x16161b,
    pants: 0xb51623,
    beard: true,
    beardColor: 0xfbf7f2,
    brows: 0xfbf7f2,
    nose: 0xff9d8c,
    frontPlacket: true,
    defaultHat: 'santa',
    hatColor: 0xd31f2b,
    hatTrim: 0xfbf7f0,
  },
  'skin.elf': {
    name: 'Elf Robber',
    body: 0x1d9a55,
    finish: 'satin',
    face: 0xffd2b4,
    trim: 0xd92835,
    fluffyTrim: false,
    belt: true,
    beltColor: 0x5a2e14,
    buckle: 0xf2c14e,
    gloves: 0xd92835,
    boots: 0xd92835,
    pants: 0xfbf3e8,
    beard: false,
    beardColor: 0,
    brows: 0x8a4a1c,
    nose: 0xffa58f,
    elfEars: true,
    defaultHat: 'elf',
    hatColor: 0x1d9a55,
    hatTrim: 0xd92835,
  },
  'skin.snowman': {
    name: 'Snowman Robber',
    body: 0xf4f8ff,
    finish: 'snow',
    face: 0xf4f8ff,
    trim: 0xf4f8ff,
    fluffyTrim: false,
    belt: false,
    beltColor: 0,
    buckle: 0,
    gloves: 0x6a3d1f,
    boots: 0x2a2a30,
    pants: 0xe8eef8,
    beard: false,
    beardColor: 0,
    brows: 0x1a1a1f,
    nose: 0xff7b1c,
    carrotNose: true,
    coalButtons: true,
    scarf: [0xd31f2b, 0x1d9a55],
    defaultHat: 'tophat',
    hatColor: 0x1a1a1f,
    hatTrim: 0xd31f2b,
  },
  'skin.ninja': {
    name: 'Ninja Santa',
    body: 0x24242c,
    finish: 'satin',
    face: 0xffcfae,
    trim: 0xd31f2b,
    fluffyTrim: false,
    belt: true,
    beltColor: 0xd31f2b,
    buckle: 0x9ca6b4,
    gloves: 0x16161b,
    boots: 0x16161b,
    pants: 0x1c1c22,
    beard: true,
    beardColor: 0xfbf7f2,
    brows: 0xfbf7f2,
    nose: 0xff9d8c,
    defaultHat: 'headband',
    hatColor: 0xd31f2b,
    hatTrim: 0xd31f2b,
  },
  'skin.humbug': {
    name: 'The Humbug',
    body: 0x6cbf3a,
    finish: 'fur',
    face: 0x9ad46a,
    trim: 0x4a2a6b,
    fluffyTrim: false,
    belt: true,
    beltColor: 0x3a1f55,
    buckle: 0xc8cfd8,
    gloves: 0x4a2a6b,
    boots: 0x3a1f55,
    pants: 0x5aa832,
    beard: false,
    beardColor: 0,
    brows: 0x2f6b1a,
    nose: 0x5aa832,
    scarf: [0x7b3fb0, 0xf2c14e],
    defaultHat: 'beanie',
    hatColor: 0x7b3fb0,
    hatTrim: 0xf2c14e,
    scowl: true,
  },
  'skin.golden': {
    name: 'Golden Santa',
    body: 0xf2b93b,
    finish: 'gold',
    face: 0xffd9b8,
    trim: 0xfffaf0,
    fluffyTrim: true,
    belt: true,
    beltColor: 0x1a1a20,
    buckle: 0xeaf1f8,
    gloves: 0xfbf7f0,
    boots: 0x1a1a20,
    pants: 0xd9a12e,
    beard: true,
    beardColor: 0xffffff,
    brows: 0xffffff,
    nose: 0xffa58f,
    frontPlacket: true,
    defaultHat: 'santa',
    hatColor: 0xf2b93b,
    hatTrim: 0xfffaf0,
  },
  'skin.reindeer': {
    name: 'Reindeer Rogue',
    body: 0x8a5a2b,
    finish: 'fur',
    face: 0xc8956a,
    trim: 0xf2e6d2,
    fluffyTrim: true,
    belt: true,
    beltColor: 0x3a2414,
    buckle: 0xf2c14e,
    gloves: 0x3a2414,
    boots: 0x2a1a10,
    pants: 0x6e4520,
    beard: false,
    beardColor: 0,
    brows: 0x3a2414,
    nose: 0xe0141e,
    scarf: [0xd31f2b, 0xf2c14e],
    defaultHat: 'antlers',
    hatColor: 0x6b3f1d,
    hatTrim: 0xf2c14e,
  },
  'skin.gingerbread': {
    name: 'Gingerbread Bandit',
    body: 0xb06a32,
    finish: 'satin',
    face: 0xc47a3c,
    trim: 0xfdfaf3,
    fluffyTrim: false,
    belt: false,
    beltColor: 0,
    buckle: 0,
    gloves: 0xfdfaf3,
    boots: 0x7a4320,
    pants: 0xa05e2a,
    beard: false,
    beardColor: 0,
    brows: 0x5a2e14,
    nose: 0x9a5528,
    coalButtons: true,
    defaultHat: 'pudding',
    hatColor: 0x5a2e14,
    hatTrim: 0xfdfaf3,
  },
  'skin.nutcracker': {
    name: 'Nutcracker Captain',
    body: 0xc8162a,
    finish: 'satin',
    face: 0xf6d9c2,
    trim: 0xf2c14e,
    fluffyTrim: false,
    belt: true,
    beltColor: 0x111116,
    buckle: 0xf2c14e,
    gloves: 0xfbf7f0,
    boots: 0x111116,
    pants: 0x1b2c6e,
    beard: true,
    beardColor: 0xfbf7f2,
    brows: 0x111116,
    nose: 0xff9d8c,
    frontPlacket: true,
    defaultHat: 'tophat',
    hatColor: 0x111116,
    hatTrim: 0xf2c14e,
  },
  'skin.frost': {
    name: 'Frostbite Santa',
    body: 0x7fc8f0,
    finish: 'satin',
    face: 0xe6f4ff,
    trim: 0xffffff,
    fluffyTrim: true,
    belt: true,
    beltColor: 0x2a5a8a,
    buckle: 0xe9fbff,
    gloves: 0xffffff,
    boots: 0x2a5a8a,
    pants: 0x5aa8d8,
    beard: true,
    beardColor: 0xe9fbff,
    brows: 0xe9fbff,
    nose: 0x9fd8ff,
    frontPlacket: true,
    defaultHat: 'santa',
    hatColor: 0x7fc8f0,
    hatTrim: 0xffffff,
  },
  'skin.peppermint': {
    name: 'Peppermint Prowler',
    body: 0xfbf6ef,
    finish: 'velvet',
    face: 0xffd2b4,
    trim: 0xd31f2b,
    fluffyTrim: false,
    belt: true,
    beltColor: 0xd31f2b,
    buckle: 0xfbf6ef,
    gloves: 0xd31f2b,
    boots: 0xd31f2b,
    pants: 0xd31f2b,
    beard: false,
    beardColor: 0,
    brows: 0x8a4a1c,
    nose: 0xffa58f,
    scarf: [0xd31f2b, 0xfbf6ef],
    defaultHat: 'earmuffs',
    hatColor: 0xd31f2b,
    hatTrim: 0xfbf6ef,
  },
  'skin.midnight': {
    name: 'Midnight Santa',
    body: 0x1b2466,
    finish: 'velvet',
    face: 0xffcfae,
    trim: 0xc8d2ff,
    fluffyTrim: true,
    belt: true,
    beltColor: 0x0c1030,
    buckle: 0xc8d2ff,
    gloves: 0x0c1030,
    boots: 0x0c1030,
    pants: 0x141a4d,
    beard: true,
    beardColor: 0xeef2ff,
    brows: 0xeef2ff,
    nose: 0xff9d8c,
    frontPlacket: true,
    defaultHat: 'star',
    hatColor: 0x1b2466,
    hatTrim: 0xc8d2ff,
  },
};

export interface MaskStyle {
  name: string;
  color: number;
  stripe?: number;
  metallic?: boolean;
  starry?: boolean;
}

export const MASKS: Record<string, MaskStyle> = {
  'mask.bandit': { name: 'Classic Bandit', color: 0x101015 },
  'mask.candy': { name: 'Candy Cane', color: 0xf7f2ea, stripe: 0xd31f2b },
  'mask.gold': { name: 'Gilded Domino', color: 0xf2b93b, metallic: true },
  'mask.midnight': { name: 'Midnight Sky', color: 0x16205a, starry: true },
  'mask.holly': { name: 'Holly Jolly', color: 0x1d7a3e, stripe: 0xd31f2b },
  'mask.frost': { name: 'Frosted Glass', color: 0x9fe6ff, metallic: true },
  'mask.peppermint': { name: 'Peppermint Swirl', color: 0xd31f2b, stripe: 0xfbf6ef },
  'mask.aurora': { name: 'Aurora', color: 0x0f5a5a, starry: true },
};

export const HATS: Record<string, { name: string; kind: HatKind | 'auto' }> = {
  'hat.auto': { name: 'Outfit Default', kind: 'auto' },
  'hat.santa': { name: 'Santa Hat', kind: 'santa' },
  'hat.beanie': { name: 'Getaway Beanie', kind: 'beanie' },
  'hat.tophat': { name: 'Fancy Top Hat', kind: 'tophat' },
  'hat.antlers': { name: 'Reindeer Antlers', kind: 'antlers' },
  'hat.crown': { name: 'Heist Crown', kind: 'crown' },
  'hat.elf': { name: 'Elf Cap', kind: 'elf' },
  'hat.earmuffs': { name: 'Cosy Earmuffs', kind: 'earmuffs' },
  'hat.star': { name: 'Star on a Spring', kind: 'star' },
  'hat.pudding': { name: 'Pudding Hat', kind: 'pudding' },
  'hat.none': { name: 'No Hat', kind: 'none' },
};

export interface SackStyle {
  name: string;
  kind: 'burlap' | 'velvet' | 'gold' | 'candy' | 'midnight' | 'frost' | 'holly' | 'ginger';
  tie: number;
}

export const SACKS: Record<string, SackStyle> = {
  'sack.burlap': { name: 'Burlap Sack', kind: 'burlap', tie: 0x6b3f1d },
  'sack.velvet': { name: 'Velvet Sack', kind: 'velvet', tie: 0xf2c14e },
  'sack.candy': { name: 'Candy Sack', kind: 'candy', tie: 0x1d9a55 },
  'sack.midnight': { name: 'Midnight Sack', kind: 'midnight', tie: 0xc8d2ff },
  'sack.gold': { name: 'Golden Sack', kind: 'gold', tie: 0xd31f2b },
  'sack.frost': { name: 'Frost Sack', kind: 'frost', tie: 0xe9fbff },
  'sack.holly': { name: 'Holly Sack', kind: 'holly', tie: 0xd31f2b },
  'sack.ginger': { name: 'Gingerbread Sack', kind: 'ginger', tie: 0xfdfaf3 },
};

export interface Outfit {
  skin: string;
  mask: string;
  hat: string;
  sack: string;
}
