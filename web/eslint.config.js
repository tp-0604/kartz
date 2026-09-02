import globals from 'globals';

// One rule matters here: no-undef. The extractor modules were lifted out of a single script
// where everything was a global, and this is what finds the references that did not come
// along for the move.
export default [
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-undef': 'error',
      // Components and imported JSX tags look unused to a parser with no JSX plugin; anything
      // capitalised is left to the build to complain about.
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^(_|[A-Z])' }],
    },
  },
];
