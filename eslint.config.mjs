import { builtinModules } from 'node:module'
import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

const noMain = {
  group: ['electron', 'electron/*', 'node:*', '**/main/**', '**/preload/**'],
  message: 'The renderer and shared code reach the main process only through window.sandtable.'
}
const noRenderer = {
  group: ['**/renderer/**', '@/*'],
  message: 'The main process, preload, and shared code never import the renderer.'
}

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
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }]
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
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  { files: ['build/*.mjs'], rules: { '@typescript-eslint/explicit-function-return-type': 'off' } },
  {
    files: ['src/renderer/src/components/ui/**'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      'react-refresh/only-export-components': 'off'
    }
  },
  {
    files: ['src/renderer/**'],
    rules: { 'no-restricted-imports': ['error', { paths: builtinModules, patterns: [noMain] }] }
  },
  {
    files: ['src/main/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [noRenderer] }] }
  },
  {
    files: ['src/preload/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noRenderer,
            {
              group: ['**/main/**'],
              message: 'The preload reaches the main process only over IPC.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/shared/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: builtinModules, patterns: [noMain, noRenderer] }]
    }
  },
  eslintConfigPrettier
)
