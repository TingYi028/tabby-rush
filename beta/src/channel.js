/*
 * Release channel. The beta build (dist/beta, made by tools/build_dist.py beta) carries
 * <meta name="tabby-channel" content="beta">. Beta and live share one origin (and so one localStorage), so the beta keeps
 * its own copy of every save under its own prefix: switching between the two builds never rewrites the other's progress.
 * The beta also stays off the world leaderboards (its track and rules can differ from live; see leaderboard.js).
 */
export const BETA = typeof document !== 'undefined' && document.querySelector?.('meta[name="tabby-channel"]')?.content === 'beta';
export const PREFIX = BETA ? 'tabbyrush-beta.' : 'tabbyrush.';

// First beta visit: start from a copy of the live saves (coins, upgrades, cosmetics, settings), once.
if (BETA) {
  try {
    if (localStorage.getItem(`${PREFIX}copied`) === null) {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); // snapshot first: adding keys can reorder them
      for (const k of keys) {
        if (k && k.startsWith('tabbyrush.') && localStorage.getItem(PREFIX + k.slice(10)) === null) localStorage.setItem(PREFIX + k.slice(10), localStorage.getItem(k));
      }
      localStorage.setItem(`${PREFIX}copied`, 'true');
    }
  } catch { /* storage unavailable: the beta just starts fresh in memory */ }
}
