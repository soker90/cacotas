import { globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import neostandard from 'neostandard'
import tseslint from 'typescript-eslint'

export default [
  ...neostandard({ ts: true }),

  globalIgnores(['dist', 'dev-dist', 'coverage', 'public/push-handler.js']),

  // Type-aware rules on top of Standard: catches silent failures
  // (floating promises, misused async) that syntax-only linting cannot see.
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...tseslint.configs.recommendedTypeChecked[2].rules,
      // `void promise()` marks intentionally un-awaited promises
      'no-void': ['error', { allowAsStatement: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      'no-void': ['error', { allowAsStatement: true }],
    },
  },
]
