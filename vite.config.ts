import { defineConfig } from 'vite';

// `base: './'` makes the production build work from any folder or sub-path
// (e.g. https://example.com/heistmas/), not only from the domain root.
export default defineConfig(({ mode }) => {
  // `npm run build:cdn` — game code only; three.js, Rapier and fonts load from CDNs.
  if (mode === 'cdn') {
    return {
      base: './',
      build: {
        target: 'es2022',
        outDir: 'dist-cdn',
        sourcemap: false,
        modulePreload: { polyfill: false },
        chunkSizeWarningLimit: 6000,
        rolldownOptions: {
          input: 'index.cdn.html',
          external: ['three', /^three\//, '@dimforge/rapier3d-compat'],
        },
      },
    };
  }
  return {
    base: './',
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 6000,
      sourcemap: false,
      rolldownOptions: {
        output: {
          // Separate long-lived vendor chunks so game updates don't force players
          // to re-download the physics engine or three.js.
          codeSplitting: {
            groups: [
              { name: 'rapier', test: /@dimforge[\\/]rapier3d/ },
              { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            ],
          },
        },
      },
    },
    // `npm run dev` + `npm start` (port 8080): the dev page talks to the local game server
    server: { host: true, proxy: { '/api': 'http://localhost:8080', '/ws': { target: 'ws://localhost:8080', ws: true } } },
  };
});
