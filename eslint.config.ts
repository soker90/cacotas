import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { globalIgnores } from 'eslint/config';

const TS_FILES = ['**/*.ts', '**/*.tsx'];

export default [
  globalIgnores(['dist', 'dev-dist', 'coverage']),

  ...tseslint.configs.strictTypeChecked,

  {
    files: TS_FILES,
    plugins: reactHooks.configs.flat['recommended-latest'].plugins,
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['src/**/*.tsx'],
    plugins: reactRefresh.configs.vite.plugins,
    rules: reactRefresh.configs.vite.rules,
  },

  {
    files: TS_FILES,
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
];
