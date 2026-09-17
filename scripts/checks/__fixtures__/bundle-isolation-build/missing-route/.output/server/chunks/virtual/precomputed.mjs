/** Synthetic fixture: the pages directory has the read route, but the build's chunk graph has no entry for it — a stale build, or Nuxt keying the graph differently. */
const client_precomputed = {
  dependencies: {
    'pages/index.vue': {
      preload: {
        'pages/index.vue': { name: 'index', src: 'pages/index.vue', file: 'index.js', imports: [] },
      },
    },
  },
  entrypoints: [],
  modules: {},
};

export { client_precomputed as default };
