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
  { id: 'skin.reindeer', slot: 'skin', name: 'Reindeer Rogue', requirement: 'Play 10 heists', unlocked: (s) => s.heistsStarted >= 10, swatch: 'radial-gradient(circle at 50% 55%, #e0141e 0 9%, #c8956a 9% 26%, #8a5a2b 26%)' },
  { id: 'skin.gingerbread', slot: 'skin', name: 'Gingerbread Bandit', requirement: 'Steal 50 presents in total', unlocked: (s) => s.presents >= 50, swatch: 'radial-gradient(circle at 50% 35%, #fdfaf3 0 6%, transparent 7%), radial-gradient(circle at 50% 65%, #fdfaf3 0 6%, transparent 7%), #b06a32' },
  { id: 'skin.nutcracker', slot: 'skin', name: 'Nutcracker Captain', requirement: 'Freeze or bonk 25 penguins', unlocked: (s) => s.guardsStunned >= 25, swatch: 'linear-gradient(180deg, #111116 0 25%, #c8162a 25% 70%, #f2c14e 70% 76%, #1b2c6e 76%)' },
  { id: 'skin.frost', slot: 'skin', name: 'Frostbite Santa', requirement: 'Escape 3 times with full health', unlocked: (s) => s.fullHealthEscapes >= 3, swatch: 'radial-gradient(circle at 50% 40%, #e6f4ff 0 22%, #ffffff 22% 30%, #7fc8f0 30%)' },
  { id: 'skin.peppermint', slot: 'skin', name: 'Peppermint Prowler', requirement: 'Complete 10 heists', unlocked: (s) => s.heistsCompleted >= 10, swatch: 'repeating-conic-gradient(from 0deg, #d31f2b 0 30deg, #fbf6ef 30deg 60deg)' },
  { id: 'skin.midnight', slot: 'skin', name: 'Midnight Santa', requirement: 'Escape 3 times with 2★ or fewer', unlocked: (s) => s.stealthEscapes >= 3, swatch: 'radial-gradient(circle at 70% 30%, #fff1b0 0 5%, transparent 6%), radial-gradient(circle at 50% 50%, #ffcfae 0 20%, #c8d2ff 20% 27%, #1b2466 27%)' },
  // ---- masks
  { id: 'mask.bandit', slot: 'mask', name: 'Classic Bandit', requirement: 'Starter mask', unlocked: always, swatch: 'linear-gradient(180deg, #fff 0 35%, #101015 35% 65%, #fff 65%)' },
  { id: 'mask.candy', slot: 'mask', name: 'Candy Cane', requirement: 'Steal 25 presents in total', unlocked: (s) => s.presents >= 25, swatch: 'repeating-linear-gradient(45deg, #d31f2b 0 10px, #f7f2ea 10px 20px)' },
  { id: 'mask.gold', slot: 'mask', name: 'Gilded Domino', requirement: 'Steal the Star of the North', unlocked: (s) => s.starDiamond, swatch: 'linear-gradient(135deg, #fff1b8, #f2b93b 50%, #a8781f)' },
  { id: 'mask.midnight', slot: 'mask', name: 'Midnight Sky', requirement: 'Escape in under 3:00', unlocked: (s) => s.fastestEscapeMs !== null && s.fastestEscapeMs < 180000, swatch: 'radial-gradient(circle at 30% 40%, #fff1b0 0 4%, transparent 5%), radial-gradient(circle at 70% 60%, #fff1b0 0 3%, transparent 4%), #16205a' },
  { id: 'mask.holly', slot: 'mask', name: 'Holly Jolly', requirement: 'Complete 3 heists', unlocked: (s) => s.heistsCompleted >= 3, swatch: 'repeating-linear-gradient(45deg, #1d7a3e 0 10px, #d31f2b 10px 20px)' },
  { id: 'mask.frost', slot: 'mask', name: 'Frosted Glass', requirement: 'Get busted 5 times', unlocked: (s) => s.timesBusted >= 5, swatch: 'linear-gradient(135deg, #ffffff, #9fe6ff 50%, #4aa8d8)' },
  { id: 'mask.peppermint', slot: 'mask', name: 'Peppermint Swirl', requirement: 'Steal $1,000,000 in total', unlocked: (s) => s.totalLoot >= 1000000, swatch: 'repeating-linear-gradient(-45deg, #d31f2b 0 10px, #fbf6ef 10px 20px)' },
  { id: 'mask.aurora', slot: 'mask', name: 'Aurora', requirement: 'Steal 10 diamonds in total', unlocked: (s) => s.diamonds >= 10, swatch: 'radial-gradient(circle at 30% 40%, #b8ffe8 0 4%, transparent 5%), linear-gradient(135deg, #0f5a5a, #2a8a6a 50%, #5a3a8a)' },
  // ---- hats
  { id: 'hat.auto', slot: 'hat', name: 'Outfit Default', requirement: 'Always available', unlocked: always, swatch: 'linear-gradient(135deg, #3a3470, #241f52)' },
  { id: 'hat.santa', slot: 'hat', name: 'Santa Hat', requirement: 'Always available', unlocked: always, swatch: 'linear-gradient(180deg, #d31f2b 0 70%, #fbf7f0 70%)' },
  { id: 'hat.beanie', slot: 'hat', name: 'Getaway Beanie', requirement: 'Complete 1 heist', unlocked: (s) => s.heistsCompleted >= 1, swatch: 'repeating-linear-gradient(90deg, #7b3fb0 0 8px, #8f52c4 8px 16px)' },
  { id: 'hat.tophat', slot: 'hat', name: 'Fancy Top Hat', requirement: 'Steal $250,000 in total', unlocked: (s) => s.totalLoot >= 250000, swatch: 'linear-gradient(180deg, #1a1a1f 0 60%, #d31f2b 60% 75%, #1a1a1f 75%)' },
  { id: 'hat.antlers', slot: 'hat', name: 'Reindeer Antlers', requirement: 'Smash 20 decorations', unlocked: (s) => s.decorationsBroken >= 20, swatch: 'linear-gradient(135deg, #b07a3e, #6b3f1d)' },
  { id: 'hat.crown', slot: 'hat', name: 'Heist Crown', requirement: 'Earn a Platinum rank', unlocked: (s) => s.bestRank >= 3, swatch: 'linear-gradient(135deg, #fff1b8, #f5bf45 50%, #c8871e)' },
  { id: 'hat.elf', slot: 'hat', name: 'Elf Cap', requirement: 'Complete 1 heist', unlocked: (s) => s.heistsCompleted >= 1, swatch: 'linear-gradient(160deg, #1d9a55 0 75%, #d92835 75%)' },
  { id: 'hat.earmuffs', slot: 'hat', name: 'Cosy Earmuffs', requirement: 'Play 3 heists', unlocked: (s) => s.heistsStarted >= 3, swatch: 'radial-gradient(circle at 20% 60%, #fbf6ef 0 18%, transparent 19%), radial-gradient(circle at 80% 60%, #fbf6ef 0 18%, transparent 19%), #d31f2b' },
  { id: 'hat.star', slot: 'hat', name: 'Star on a Spring', requirement: 'Escape in under 2:30', unlocked: (s) => s.fastestEscapeMs !== null && s.fastestEscapeMs < 150000, swatch: 'radial-gradient(circle at 50% 40%, #fff1b8 0 16%, #f2b93b 16% 26%, #1b2466 27%)' },
  { id: 'hat.pudding', slot: 'hat', name: 'Pudding Hat', requirement: 'Smash 50 decorations', unlocked: (s) => s.decorationsBroken >= 50, swatch: 'linear-gradient(180deg, #fdfaf3 0 30%, #4a2414 30%)' },
  { id: 'hat.none', slot: 'hat', name: 'No Hat', requirement: 'Always available', unlocked: always, swatch: 'linear-gradient(135deg, #22223a, #11111f)' },
  // ---- sacks
  { id: 'sack.burlap', slot: 'sack', name: 'Burlap Sack', requirement: 'Starter sack', unlocked: always, swatch: 'repeating-linear-gradient(0deg, #9a6b3c 0 4px, #8a5c30 4px 8px)' },
  { id: 'sack.velvet', slot: 'sack', name: 'Velvet Sack', requirement: 'Complete 2 heists', unlocked: (s) => s.heistsCompleted >= 2, swatch: 'radial-gradient(circle at 40% 35%, #ff6a6a, #b3121f 60%)' },
  { id: 'sack.candy', slot: 'sack', name: 'Candy Sack', requirement: 'Escape with full health', unlocked: (s) => s.fullHealthEscapes >= 1, swatch: 'repeating-linear-gradient(45deg, #d31f2b 0 10px, #fbf6ef 10px 20px)' },
  { id: 'sack.midnight', slot: 'sack', name: 'Midnight Sack', requirement: 'Complete 5 heists', unlocked: (s) => s.heistsCompleted >= 5, swatch: 'radial-gradient(circle at 40% 35%, #6f80ff, #1b2466 60%)' },
  { id: 'sack.gold', slot: 'sack', name: 'Golden Sack', requirement: 'Steal $500,000 in total', unlocked: (s) => s.totalLoot >= 500000, swatch: 'linear-gradient(135deg, #fff1b8, #f2b93b 50%, #a8781f)' },
  { id: 'sack.frost', slot: 'sack', name: 'Frost Sack', requirement: 'Freeze or bonk 50 penguins', unlocked: (s) => s.guardsStunned >= 50, swatch: 'radial-gradient(circle at 40% 35%, #ffffff, #bfe9ff 45%, #5aa8d8)' },
  { id: 'sack.holly', slot: 'sack', name: 'Holly Sack', requirement: 'Steal 100 presents in total', unlocked: (s) => s.presents >= 100, swatch: 'radial-gradient(circle at 40% 35%, #4ad47a, #17703a 60%)' },
  { id: 'sack.ginger', slot: 'sack', name: 'Gingerbread Sack', requirement: 'Complete 15 heists', unlocked: (s) => s.heistsCompleted >= 15, swatch: 'radial-gradient(circle at 40% 35%, #e0a060, #b06a32 60%)' },
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
