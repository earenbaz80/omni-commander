// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from 'eslint-plugin-storybook';

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'dev-dist/**', 'release/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // Rest-destructuring is how this codebase omits form-only keys before
      // persisting; those siblings are intentionally unused.
      '@typescript-eslint/no-unused-vars': ['warn', { ignoreRestSiblings: true }],
    },
  },
  {
    // Test doubles stand in for shapes a test does not need to describe in full
    // (a fetch stub, a mocked engine), so `any` there is deliberate and local.
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  storybook.configs['flat/recommended'],
);
