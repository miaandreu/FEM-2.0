/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` makes every asset URL relative, so the same build works on a
// GitHub Pages project site (https://user.github.io/<repo>/), a user site, or
// any static host. The app has no client-side router (state lives in the URL
// hash), so relative paths are safe.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
