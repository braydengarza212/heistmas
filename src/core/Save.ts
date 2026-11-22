import { STATS_EPOCH } from '../shared/protocol';
import { LOCAL_SCORES_KEY } from './Leaderboard';
import type { QualityLevel } from './Engine';

export interface Settings {
  quality: QualityLevel;
  sensitivity: number;
  invertY: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  showFps: boolean;
  cameraShake: boolean;
  playerName: string;
}

export interface Stats {
  heistsStarted: number;
  heistsCompleted: number;
  timesBusted: number;
  totalLoot: number;
  presents: number;
  diamonds: number;
  guardsStunned: number;
  decorationsBroken: number;
  bestScore: number;
  bestLoot: number;
  fastestEscapeMs: number | null;
  /** -1 = none, 0 bronze, 1 silver, 2 gold, 3 platinum */
  bestRank: number;
  stealthEscapes: number;
  fullHealthEscapes: number;
  starDiamond: boolean;
  lowestStarsEscape: number | null;
}

export interface Equipped {
  skin: string;
  mask: string;
  hat: string;
  sack: string;
}

export interface SaveData {
  version: 1;
  /** STATS_EPOCH these stats belong to (older stats are wiped on load). */
  statsEpoch?: number;
  settings: Settings;
  stats: Stats;
  unlocked: string[];
  equipped: Equipped;
}

const KEY = 'heistmas.save.v1';

function detectQuality(): QualityLevel {
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (mobile) return 'low';
  if (cores <= 4) return 'medium';
  return 'high';
}

export function defaultSave(): SaveData {
  return {
    version: 1,
    statsEpoch: STATS_EPOCH,
    settings: {
      quality: detectQuality(),
      sensitivity: 1,
      invertY: false,
      masterVolume: 0.8,
      musicVolume: 0.55,
      sfxVolume: 0.9,
      showFps: false,
      cameraShake: true,
      playerName: 'Santa',
    },
    stats: {
      heistsStarted: 0,
      heistsCompleted: 0,
      timesBusted: 0,
      totalLoot: 0,
      presents: 0,
      diamonds: 0,
      guardsStunned: 0,
      decorationsBroken: 0,
      bestScore: 0,
      bestLoot: 0,
      fastestEscapeMs: null,
      bestRank: -1,
      stealthEscapes: 0,
      fullHealthEscapes: 0,
      starDiamond: false,
      lowestStarsEscape: null,
    },
    unlocked: ['skin.criminal', 'mask.bandit', 'hat.auto', 'sack.burlap'],
    equipped: { skin: 'skin.criminal', mask: 'mask.bandit', hat: 'hat.auto', sack: 'sack.burlap' },
  };
}

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = '__heistmas_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export class SaveManager {
  data: SaveData;
  private store = storage();

  constructor() {
    this.data = this.load();
    // remember the reset right away so it only ever happens once
    if (this.wipedStats) this.save();
  }

  private wipedStats = false;

  private load(): SaveData {
    const base = defaultSave();
    if (!this.store) return base;
    try {
      const raw = this.store.getItem(KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      return {
        version: 1,
        settings: { ...base.settings, ...(parsed.settings ?? {}) },
        statsEpoch: STATS_EPOCH,
        // a stats reset (STATS_EPOCH bump) wipes older stats and the local high scores
        stats: parsed.statsEpoch === STATS_EPOCH ? { ...base.stats, ...(parsed.stats ?? {}) } : (this.wipeLocalScores(), base.stats),
        unlocked: Array.from(new Set([...base.unlocked, ...(parsed.unlocked ?? [])])),
        equipped: { ...base.equipped, ...(parsed.equipped ?? {}) },
      };
    } catch {
      return base;
    }
  }

  private wipeLocalScores() {
    this.wipedStats = true;
    try {
      this.store?.removeItem(LOCAL_SCORES_KEY);
    } catch {
      /* ignore */
    }
  }

  save() {
    if (!this.store) return;
    try {
      this.store.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage full or blocked: progress just won't persist */
    }
  }

  resetProgress() {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.save();
  }

  get persistent() {
    return this.store !== null;
  }
}
