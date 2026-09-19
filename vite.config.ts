import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base:'./' keeps asset paths relative so the build deploys to any static host or
// sub-path — same choice as the station-portfolio site.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5174, strictPort: false },
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
