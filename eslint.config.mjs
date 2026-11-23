import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      // TypeScript provides prop validation; the JS-era prop-types rule is redundant.
      'react/prop-types': 'off',
      // Express identifies error middleware by arity, so an unused 4th `next`
      // parameter (and other intentionally-unused params) must be allowed.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    // BL-43: nothing logs through the console. The backend logger writes to stdout and stderr
    // on purpose (the main process captures them into app.log); the rest goes through
    // src/main/log.ts, the backend logger or the renderer's reportError.
    files: ['**/*.{ts,tsx}'],
    ignores: ['backend/src/services/logger.service.ts'],
    rules: { 'no-console': 'error' }
  },
  {
    // CommonJS build/tooling scripts — mirror the toolkit's treatment of *.js/*.mjs.
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  eslintConfigPrettier
)
