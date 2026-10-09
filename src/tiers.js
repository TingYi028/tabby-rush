/*
 * 段位 (rank tiers) of the mission level ladder: a new badge every five levels, so the 29 levels of start-multiplier
 * growth have visible milestones. Pure data and arithmetic (no DOM): the views are in progression-ui.js.
 * `lvl` everywhere is the internal 0-based mission level (progression.js `lvl`); the player sees Lv.(lvl + 1).
 */

export const TIERS = [
  { id: 'rookie',   name: '見習', from: 1,  color: '#7fbf6a' },
  { id: 'bronze',   name: '銅牌', from: 5,  color: '#c8834a' },
  { id: 'silver',   name: '銀牌', from: 10, color: '#b9c3cc' },
  { id: 'gold',     name: '金牌', from: 15, color: '#ffd23f' },
  { id: 'platinum', name: '白金', from: 20, color: '#9fe3ff' },
  { id: 'diamond',  name: '鑽石', from: 25, color: '#6ad0ff' },
  { id: 'legend',   name: '傳說', from: 30, color: '#ff5fa8' },
];   // `from` = the level as shown (lvl + 1)

const TOP = TIERS.length - 1;

/** Index into TIERS for a mission level. */
export const tierOf = (lvl) => Math.max(0, Math.min(TOP, Math.floor((lvl + 1) / 5)));

/** Levels still to play for the next tier (0 at the top tier). */
export const levelsToNext = (lvl) => (tierOf(lvl) >= TOP ? 0 : TIERS[tierOf(lvl) + 1].from - (lvl + 1));

/** The tier after the one `lvl` is in, or null at the top. */
export const nextTier = (lvl) => TIERS[tierOf(lvl) + 1] || null;

/** True when reaching `lvl` moved the player into a new tier. */
export const tierUp = (lvl) => lvl > 0 && tierOf(lvl) > tierOf(lvl - 1);

export const tierIcon = (t) => `assets/ui/tier_${t.id}.webp`;
