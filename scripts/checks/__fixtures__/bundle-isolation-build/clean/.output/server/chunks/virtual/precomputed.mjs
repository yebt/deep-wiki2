/**
 * Synthetic fixture, shaped like Nuxt's real
 * `.output/server/chunks/virtual/precomputed.mjs`: the read route's
 * static import chain reaches only ordinary chunks, and its
 * `dynamicImports` reaches an editor chunk — which must NOT fail the
 * check, since the async edit chunk legitimately exists.
 */
const client_precomputed = {
  dependencies: {
    'pages/pages/[id].vue': {
      preload: {
        'pages/pages/[id].vue': {
          name: '_id_',
          src: 'pages/pages/[id].vue',
          file: 'read-route.js',
          imports: ['_shared.js'],
          dynamicImports: ['_editor-mount.js'],
        },
        '_shared.js': {
          name: 'shared',
          file: 'shared.js',
          imports: [],
        },
        '_editor-mount.js': {
          name: 'milkdown-mount',
          file: 'editor-mount.js',
          imports: [],
        },
      },
    },
  },
  entrypoints: [],
  modules: {},
};

export { client_precomputed as default };
