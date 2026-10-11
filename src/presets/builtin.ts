// Every JSON file in this folder is a built-in preset; order is by file name,
// so a numeric prefix (`01-…`) sets the position in the list.
const modules = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' });

/** Raw built-in presets; validated like any user file before use. */
export const BUILTIN_PRESETS: readonly unknown[] = Object.keys(modules)
  .sort()
  .map((path) => modules[path]);
