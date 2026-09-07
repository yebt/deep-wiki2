/**
 * Synthetic fixture: the read route's STATIC import chain (not
 * `dynamicImports`) reaches a ProseMirror module — the eager-shared-import
 * regression this layer exists to catch (design.md, "An eager shared
 * import fails the test").
 */
const client_precomputed = {
  dependencies: {
    'pages/pages/[id]/index.vue': {
      preload: {
        'pages/pages/[id]/index.vue': {
          name: '_id_',
          src: 'pages/pages/[id]/index.vue',
          file: 'read-route.js',
          imports: ['_shared.js'],
          dynamicImports: [],
        },
        '_shared.js': {
          name: 'shared',
          file: 'shared.js',
          imports: ['_prosemirror-model.js'],
        },
        '_prosemirror-model.js': {
          name: 'prosemirror-model',
          file: 'prosemirror-model.js',
          imports: [],
        },
      },
    },
  },
  entrypoints: [],
  modules: {},
};

export { client_precomputed as default };
