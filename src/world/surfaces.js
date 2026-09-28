// Surface ids stored per heightfield sample and per collider (DECISIONS #9).
// Physical values live in src/tuning.js (surfaces table). There is no packed snow any more
// (DECISIONS #80): id 0 is plain snow (firm footing, the look and sound of snow), 1 is deep powder.
export const SURFACE = { SNOW: 0, POWDER: 1, ICE: 2, ROCK: 3 };
export const SURFACE_NAMES = ['snow', 'powder', 'ice', 'rock'];
