import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier/recommended';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  unicorn.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      parserOptions: {
        projectService: true,
      },
      sourceType: 'module',
    },
    rules: {
      'max-lines': ['warn', { max: 400 }],
      'max-params': ['warn', { max: 3 }],
    },
  },
  {
    extends: [tseslint.configs.disableTypeChecked],
    files: ['*.config.mjs'],
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      'max-lines': 'off',
    },
  },
);
