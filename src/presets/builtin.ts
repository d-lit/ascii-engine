import broadcastGlitch from './broadcast-glitch.json' with { type: 'json' };
import dissolveLoop from './dissolve-loop.json' with { type: 'json' };
import liquidPortrait from './liquid-portrait.json' with { type: 'json' };
import pointerLens from './pointer-lens.json' with { type: 'json' };

/** Raw built-in presets; validated like any user file before use. */
export const BUILTIN_PRESETS: readonly unknown[] = [
  liquidPortrait,
  dissolveLoop,
  pointerLens,
  broadcastGlitch,
];
