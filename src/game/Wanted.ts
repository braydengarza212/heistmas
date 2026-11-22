/**
 * Five-star wanted system.
 *   ★     Suspicious guards        (investigate noises, wider vision)
 *   ★★    Active pursuit           (guards chase on sight)
 *   ★★★   Alarms                   (sirens, extra laser grids power up)
 *   ★★★★  Reinforcements           (elite guards arrive, shutters cycle)
 *   ★★★★★ Lockdown                 (everyone hunts you, fastest shutters)
 */
export const STAR_THRESHOLDS = [10, 30, 50, 70, 88];
export const STAR_LABELS = ['', 'SUSPICIOUS', 'PURSUIT', 'ALARM', 'REINFORCEMENTS', 'LOCKDOWN'];
export const STAR_DESCRIPTIONS = [
  'Nobody suspects a thing',
  'Guards are suspicious',
  'Security is chasing you',
  'Alarms raised — extra lasers online',
  'Reinforcements and security doors',
  'Full lockdown — maximum pursuit',
];

export class Wanted {
  heat = 0;
  floor = 0;
  stars = 0;
  maxStars = 0;
  private unseen = 0;
  /** Seconds since the last heat increase (HUD flashes stars while cooling). */
  cooling = false;
  onChange: ((stars: number, prev: number) => void) | null = null;
  pressure = 0;

  add(amount: number) {
    if (amount <= 0) return;
    this.heat = Math.min(100, this.heat + amount);
    this.unseen = 0;
    this.refresh();
  }

  raiseTo(min: number) {
    if (this.heat < min) {
      this.heat = min;
      this.unseen = 0;
      this.refresh();
    }
  }

  reduce(amount: number) {
    this.heat = Math.max(this.floor, this.heat - amount);
    this.refresh();
  }

  setFloor(f: number) {
    this.floor = Math.max(this.floor, f);
    this.raiseTo(this.floor);
  }

  update(dt: number, seen: boolean, chased: boolean) {
    if (seen || chased) this.unseen = 0;
    else this.unseen += dt;
    this.cooling = this.unseen > 4 && this.heat > this.floor + 0.5;
    if (this.cooling) this.heat = Math.max(this.floor, this.heat - 1.7 * dt);
    if (this.pressure > 0) this.heat = Math.min(100, this.heat + this.pressure * dt);
    this.refresh();
  }

  private refresh() {
    let s = 0;
    for (const t of STAR_THRESHOLDS) if (this.heat >= t) s++;
    if (s !== this.stars) {
      const prev = this.stars;
      this.stars = s;
      this.maxStars = Math.max(this.maxStars, s);
      this.onChange?.(s, prev);
    }
  }
}
