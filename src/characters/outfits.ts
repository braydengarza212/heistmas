/**
 * Visual definitions for every cosmetic. Unlock rules live in
 * progress/cosmetics.ts; this file is purely about looks.
 */

export type HatKind = 'santa' | 'beanie' | 'tophat' | 'elf' | 'antlers' | 'crown' | 'headband' | 'none';
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
};

export const HATS: Record<string, { name: string; kind: HatKind | 'auto' }> = {
  'hat.auto': { name: 'Outfit Default', kind: 'auto' },
  'hat.santa': { name: 'Santa Hat', kind: 'santa' },
  'hat.beanie': { name: 'Getaway Beanie', kind: 'beanie' },
  'hat.tophat': { name: 'Fancy Top Hat', kind: 'tophat' },
  'hat.antlers': { name: 'Reindeer Antlers', kind: 'antlers' },
  'hat.crown': { name: 'Heist Crown', kind: 'crown' },
  'hat.none': { name: 'No Hat', kind: 'none' },
};

export interface SackStyle {
  name: string;
  kind: 'burlap' | 'velvet' | 'gold' | 'candy' | 'midnight';
  tie: number;
}

export const SACKS: Record<string, SackStyle> = {
  'sack.burlap': { name: 'Burlap Sack', kind: 'burlap', tie: 0x6b3f1d },
  'sack.velvet': { name: 'Velvet Sack', kind: 'velvet', tie: 0xf2c14e },
  'sack.candy': { name: 'Candy Sack', kind: 'candy', tie: 0x1d9a55 },
  'sack.midnight': { name: 'Midnight Sack', kind: 'midnight', tie: 0xc8d2ff },
  'sack.gold': { name: 'Golden Sack', kind: 'gold', tie: 0xd31f2b },
};

export interface Outfit {
  skin: string;
  mask: string;
  hat: string;
  sack: string;
}
