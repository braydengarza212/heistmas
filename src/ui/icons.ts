/** Hand-authored SVG icons (no icon fonts, no emoji). */

export const ICON = {
  star: `<svg viewBox="0 0 64 64" class="star"><path d="M32 4.5l8.4 17.6 19.2 2.5-14 13.3 3.6 19.1L32 47.6 14.8 57l3.6-19.1-14-13.3 19.2-2.5z" stroke-linejoin="round"/></svg>`,
  heart: `<svg viewBox="0 0 64 64"><path d="M32 56S6 41 6 22.5C6 13.4 13 7 21 7c5 0 8.7 2.6 11 6.3C34.3 9.6 38 7 43 7c8 0 15 6.4 15 15.5C58 41 32 56 32 56z" stroke-linejoin="round"/></svg>`,
  sack: `<svg viewBox="0 0 80 80">
    <path d="M28 18c-3-6 2-11 6-8 3 2 5 2 6 0 2-3 8-3 9 1 1 3-1 6-4 8z" fill="#7a4a1e" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
    <path d="M26 22h28c14 10 20 24 18 36-2 12-14 18-32 18S10 70 8 58c-2-12 4-26 18-36z" fill="#b07a3e" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/>
    <rect x="25" y="19" width="30" height="6" rx="3" fill="#f6c453" stroke="#fff" stroke-width="2"/>
    <text x="40" y="62" font-family="Titan One, sans-serif" font-size="30" text-anchor="middle" fill="#f6c453" stroke="#5a3a14" stroke-width="2" paint-order="stroke">$</text></svg>`,
  clock: `<svg viewBox="0 0 64 64"><circle cx="32" cy="34" r="24" fill="none" stroke="#fff" stroke-width="6"/><path d="M32 20v15l9 6" fill="none" stroke="#f6c453" stroke-width="6" stroke-linecap="round"/><rect x="26" y="3" width="12" height="7" rx="3" fill="#fff"/></svg>`,
  lock: `<svg viewBox="0 0 64 64" class="lock"><rect x="12" y="28" width="40" height="30" rx="8" fill="#f6c453" stroke="#fff" stroke-width="4"/><path d="M20 28v-7a12 12 0 0124 0v7" fill="none" stroke="#fff" stroke-width="6"/><circle cx="32" cy="42" r="4" fill="#5a3a14"/></svg>`,
  play: `<svg viewBox="0 0 64 64"><path d="M18 10l36 22-36 22z" fill="#fff" stroke-linejoin="round" stroke="#fff" stroke-width="4"/></svg>`,
  target: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="none" stroke="#fff" stroke-width="6"/><circle cx="32" cy="32" r="11" fill="none" stroke="#f6c453" stroke-width="6"/><circle cx="32" cy="32" r="3" fill="#fff"/></svg>`,
  mask: `<svg viewBox="0 0 64 64"><path d="M6 26c8-6 18-6 26-1 8-5 18-5 26 1-1 12-9 17-16 17-5 0-8-4-10-7-2 3-5 7-10 7-7 0-15-5-16-17z" fill="#fff"/><ellipse cx="20" cy="31" rx="6" ry="4" fill="#241f52"/><ellipse cx="44" cy="31" rx="6" ry="4" fill="#241f52"/></svg>`,
  trophy: `<svg viewBox="0 0 64 64"><path d="M18 8h28v14a14 14 0 01-28 0z" fill="#f6c453" stroke="#fff" stroke-width="4"/><path d="M18 14H8c0 9 4 14 11 14M46 14h10c0 9-4 14-11 14" fill="none" stroke="#fff" stroke-width="4"/><path d="M28 36h8v10h-8z" fill="#fff"/><rect x="18" y="46" width="28" height="10" rx="4" fill="#fff"/></svg>`,
  gear: `<svg viewBox="0 0 64 64"><path d="M27 4h10l2 8 6 3 7-4 7 7-4 7 3 6 8 2v10l-8 2-3 6 4 7-7 7-7-4-6 3-2 8H27l-2-8-6-3-7 4-7-7 4-7-3-6-8-2V27l8-2 3-6-4-7 7-7 7 4 6-3z" fill="#fff"/><circle cx="32" cy="32" r="10" fill="#241f52"/></svg>`,
  back: `<svg viewBox="0 0 64 64"><path d="M38 12L18 32l20 20" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  bean: `<svg viewBox="0 0 80 100" class="spinner-bean"><path d="M40 6c18 0 30 18 30 46 0 26-12 42-30 42S10 78 10 52C10 24 22 6 40 6z" fill="#e8283a" stroke="#fff" stroke-width="4"/><rect x="12" y="34" width="56" height="16" rx="8" fill="#16161b"/><ellipse cx="30" cy="42" rx="7" ry="8" fill="#fff"/><ellipse cx="50" cy="42" rx="7" ry="8" fill="#fff"/><circle cx="31" cy="43" r="4" fill="#111"/><circle cx="51" cy="43" r="4" fill="#111"/><path d="M14 30c4-20 48-20 52 0" fill="#e8283a"/><path d="M12 30h56" stroke="#fff" stroke-width="8" stroke-linecap="round"/><path d="M26 58c0 12 28 12 28 0" fill="#fff"/></svg>`,
};

export function medalSvg(rank: number) {
  const colors = [
    ['#e8a46a', '#a8622a'],
    ['#e6ecf5', '#9aa6b8'],
    ['#ffd96a', '#d0951c'],
    ['#c9f4ff', '#6fb8d8'],
  ][Math.max(0, Math.min(3, rank))];
  return `<svg viewBox="0 0 120 120" class="medal">
    <path d="M38 4h18l12 34H50z" fill="#e8283a" stroke="#fff" stroke-width="3"/>
    <path d="M82 4H64L52 38h18z" fill="#128a5c" stroke="#fff" stroke-width="3"/>
    <circle cx="60" cy="74" r="38" fill="${colors[1]}" stroke="#fff" stroke-width="5"/>
    <circle cx="60" cy="74" r="29" fill="${colors[0]}"/>
    <path d="M60 52l6.4 13.4 14.6 1.9-10.7 10.1 2.8 14.6L60 84.9 46.9 92l2.8-14.6L39 67.3l14.6-1.9z" fill="#fff" opacity="0.9"/></svg>`;
}

/** Simple CSS/SVG thumbnails for the heist selection cards. */
export const HEIST_ART = {
  bank: `<svg viewBox="0 0 300 190" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="hb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1f5c"/><stop offset="1" stop-color="#3b2a7a"/></linearGradient></defs>
    <rect width="300" height="190" fill="url(#hb)"/><circle cx="240" cy="40" r="18" fill="#fff6dc"/>
    <path d="M40 80L150 40l110 40z" fill="#f3ead9"/><rect x="50" y="80" width="200" height="12" fill="#f3ead9"/>
    ${[60, 95, 130, 165, 200, 235].map((x) => `<rect x="${x - 6}" y="92" width="12" height="62" fill="#fff"/>`).join('')}
    <rect x="40" y="152" width="220" height="14" fill="#e8dcc0"/><rect x="0" y="166" width="300" height="24" fill="#eef4ff"/>
    <rect x="128" y="104" width="44" height="50" rx="4" fill="#ffb465"/><circle cx="150" cy="62" r="9" fill="#128a5c" stroke="#e8283a" stroke-width="3"/>
    ${Array.from({ length: 30 }, (_, i) => `<circle cx="${(i * 37) % 300}" cy="${(i * 53) % 160}" r="2" fill="#fff" opacity="0.8"/>`).join('')}</svg>`,
  workshop: `<svg viewBox="0 0 300 190" preserveAspectRatio="xMidYMid slice"><rect width="300" height="190" fill="#7a1f2b"/>
    <rect x="0" y="130" width="300" height="60" fill="#3a1410"/><rect x="20" y="118" width="260" height="14" rx="7" fill="#26282d"/>
    ${[40, 100, 160, 220].map((x, i) => `<rect x="${x}" y="${92 - (i % 2) * 10}" width="34" height="26" rx="4" fill="${['#f6c453', '#2fd17f', '#5dd6ff', '#ff7aa2'][i]}"/>`).join('')}
    <circle cx="60" cy="50" r="22" fill="none" stroke="#f6c453" stroke-width="8" stroke-dasharray="10 6"/><circle cx="240" cy="54" r="16" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="8 5"/></svg>`,
  mall: `<svg viewBox="0 0 300 190" preserveAspectRatio="xMidYMid slice"><rect width="300" height="190" fill="#164b6b"/>
    <path d="M150 20l40 120H110z" fill="#128a5c"/><path d="M150 40l30 80h-60z" fill="#1fae6c"/><circle cx="150" cy="22" r="8" fill="#ffd96a"/>
    <path d="M0 150l80-60h20L20 150z" fill="#c8d2e0"/><path d="M300 150l-80-60h-20l80 60z" fill="#c8d2e0"/>
    <rect x="0" y="150" width="300" height="40" fill="#e9dcc4"/>
    ${[30, 60, 240, 270].map((x) => `<rect x="${x}" y="40" width="20" height="30" rx="3" fill="#ffb465"/>`).join('')}</svg>`,
  northpole: `<svg viewBox="0 0 300 190" preserveAspectRatio="xMidYMid slice"><rect width="300" height="190" fill="#0d2a4a"/>
    <path d="M0 120l60-40 50 30 60-50 70 40 60-30v120H0z" fill="#cfe8ff"/><path d="M0 150l80-20 80 20 80-25 60 15v50H0z" fill="#9fd0ff"/>
    <rect x="125" y="96" width="50" height="54" rx="25" fill="#5a6b8a" stroke="#cfe8ff" stroke-width="4"/>
    <rect x="148" y="10" width="5" height="90" fill="#e8283a"/><rect x="148" y="10" width="5" height="90" fill="url(#)" /><circle cx="150" cy="10" r="8" fill="#ffd96a"/></svg>`,
};
