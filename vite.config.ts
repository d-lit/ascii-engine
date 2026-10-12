import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths: the build runs from any folder, e.g. GitHub Pages
  // at /ascii-engine/ (DECISIONS 019).
  base: './',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
  },
});
