import { globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import neostandard from 'neostandard'

export default [
  ...neostandard({ ts: true }),

  globalIgnores(['dist', 'dev-dist', 'coverage']),

  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      // `void promise()` marks intentionally un-awaited promises
      'no-void': ['error', { allowAsStatement: true }],
    },
  },
]
