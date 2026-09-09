/** Synthetic fixture: a real build whose chunk graph has no entry for the expected read-route source path — e.g. the route was renamed or moved. */
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
