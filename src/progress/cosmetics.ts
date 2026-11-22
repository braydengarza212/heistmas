import type { Stats } from '../core/Save';

export type Slot = 'skin' | 'mask' | 'hat' | 'sack';

export interface CosmeticDef {
  id: string;
  slot: Slot;
  name: string;
  requirement: string;
  unlocked: (s: Stats) => boolean;
  swatch: string;
}

const always = () => true;

/** Every cosmetic and how it is earned through play. */
export const COSMETICS: CosmeticDef[] = [
  // ---- outfits
  { id: 'skin.criminal', slot: 'skin', name: 'Criminal Santa', requirement: 'Starter outfit', unlocked: always, swatch: 'radial-gradient(circle at 50% 40%, #ffcfae 0 22%, #16161b 22% 30%, #d31f2b 30%)' },
  { id: 'skin.elf', slot: 'skin', name: 'Elf Robber', requirement: 'Complete 1 heist', unlocked: (s) => s.heistsCompleted >= 1, swatch: 'radial-gradient(circle at 50% 40%, #ffd2b4 0 22%, #16161b 22% 30%, #1d9a55 30%)' },
  { id: 'skin.snowman', slot: 'skin', name: 'Snowman Robber', requirement: 'Steal $100,000 in total', unlocked: (s) => s.totalLoot >= 100000, swatch: 'radial-gradient(circle at 50% 45%, #ff7b1c 0 6%, #f4f8ff 6%)' },
  { id: 'skin.ninja', slot: 'skin', name: 'Ninja Santa', requirement: 'Escape with 2★ or fewer', unlocked: (s) => s.stealthEscapes >= 1, swatch: 'linear-gradient(180deg, #24242c 0 40%, #d31f2b 40% 50%, #24242c 50%)' },
  { id: 'skin.humbug', slot: 'skin', name: 'The Humbug', requirement: 'Bonk 10 penguins', unlocked: (s) => s.guardsStunned >= 10, swatch: 'radial-gradient(circle at 50% 40%, #9ad46a 0 25%, #7b3fb0 25% 33%, #6cbf3a 33%)' },
  { id: 'skin.golden', slot: 'skin', name: 'Golden Santa', requirement: 'Earn a Gold rank', unlocked: (s) => s.bestRank >= 2, swatch: 'linear-gradient(135deg, #fff1b8, #f2b93b 45%, #a8781f)' },
  // ---- masks
  { id: 'mask.bandit', slot: 'mask', name: 'Classic Bandit', requirement: 'Starter mask', unlocked: always, swatch: 'linear-gradient(180deg, #fff 0 35%, #101015 35% 65%, #fff 65%)' },
  { id: 'mask.candy', slot: 'mask', name: 'Candy Cane', requirement: 'Steal 25 presents in total', unlocked: (s) => s.presents >= 25, swatch: 'repeating-linear-gradient(45deg, #d31f2b 0 10px, #f7f2ea 10px 20px)' },
  { id: 'mask.gold', slot: 'mask', name: 'Gilded Domino', requirement: 'Steal the Star of the North', unlocked: (s) => s.starDiamond, swatch: 'linear-gradient(135deg, #fff1b8, #f2b93b 50%, #a8781f)' },
  { id: 'mask.midnight', slot: 'mask', name: 'Midnight Sky', requirement: 'Escape in under 3:00', unlocked: (s) => s.fastestEscapeMs !== null && s.fastestEscapeMs < 180000, swatch: 'radial-gradient(circle at 30% 40%, #fff1b0 0 4%, transparent 5%), radial-gradient(circle at 70% 60%, #fff1b0 0 3%, transparent 4%), #16205a' },
  // ---- hats
  { id: 'hat.auto', slot: 'hat', name: 'Outfit Default', requirement: 'Always available', unlocked: always, swatch: 'linear-gradient(135deg, #3a3470, #241f52)' },
  { id: 'hat.santa', slot: 'hat', name: 'Santa Hat', requirement: 'Always available', unlocked: always, swatch: 'linear-gradient(180deg, #d31f2b 0 70%, #fbf7f0 70%)' },
  { id: 'hat.beanie', slot: 'hat', name: 'Getaway Beanie', requirement: 'Complete 1 heist', unlocked: (s) => s.heistsCompleted >= 1, swatch: 'repeating-linear-gradient(90deg, #7b3fb0 0 8px, #8f52c4 8px 16px)' },
  { id: 'hat.tophat', slot: 'hat', name: 'Fancy Top Hat', requirement: 'Steal $250,000 in total', unlocked: (s) => s.totalLoot >= 250000, swatch: 'linear-gradient(180deg, #1a1a1f 0 60%, #d31f2b 60% 75%, #1a1a1f 75%)' },
  { id: 'hat.antlers', slot: 'hat', name: 'Reindeer Antlers', requirement: 'Smash 20 decorations', unlocked: (s) => s.decorationsBroken >= 20, swatch: 'linear-gradient(135deg, #b07a3e, #6b3f1d)' },
  { id: 'hat.crown', slot: 'hat', name: 'Heist Crown', requirement: 'Earn a Platinum rank', unlocked: (s) => s.bestRank >= 3, swatch: 'linear-gradient(135deg, #fff1b8, #f5bf45 50%, #c8871e)' },
  { id: 'hat.none', slot: 'hat', name: 'No Hat', requirement: 'Always available', unlocked: always, swatch: 'linear-gradient(135deg, #22223a, #11111f)' },
  // ---- sacks
  { id: 'sack.burlap', slot: 'sack', name: 'Burlap Sack', requirement: 'Starter sack', unlocked: always, swatch: 'repeating-linear-gradient(0deg, #9a6b3c 0 4px, #8a5c30 4px 8px)' },
  { id: 'sack.velvet', slot: 'sack', name: 'Velvet Sack', requirement: 'Complete 2 heists', unlocked: (s) => s.heistsCompleted >= 2, swatch: 'radial-gradient(circle at 40% 35%, #ff6a6a, #b3121f 60%)' },
  { id: 'sack.candy', slot: 'sack', name: 'Candy Sack', requirement: 'Escape with full health', unlocked: (s) => s.fullHealthEscapes >= 1, swatch: 'repeating-linear-gradient(45deg, #d31f2b 0 10px, #fbf6ef 10px 20px)' },
  { id: 'sack.midnight', slot: 'sack', name: 'Midnight Sack', requirement: 'Complete 5 heists', unlocked: (s) => s.heistsCompleted >= 5, swatch: 'radial-gradient(circle at 40% 35%, #6f80ff, #1b2466 60%)' },
  { id: 'sack.gold', slot: 'sack', name: 'Golden Sack', requirement: 'Steal $500,000 in total', unlocked: (s) => s.totalLoot >= 500000, swatch: 'linear-gradient(135deg, #fff1b8, #f2b93b 50%, #a8781f)' },
];

export function cosmetic(id: string) {
  return COSMETICS.find((c) => c.id === id);
}

/** Returns ids that just became unlocked (and records them). */
export function evaluateUnlocks(stats: Stats, unlocked: string[]) {
  const fresh: string[] = [];
  for (const c of COSMETICS) {
    if (!unlocked.includes(c.id) && c.unlocked(stats)) {
      unlocked.push(c.id);
      fresh.push(c.id);
    }
  }
  return fresh;
}
