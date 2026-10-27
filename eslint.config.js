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
      '@typescript-eslint/no-explicit-any': 'off',
      // Rest-destructuring is how this codebase omits form-only keys before
      // persisting; those siblings are intentionally unused.
      '@typescript-eslint/no-unused-vars': ['warn', { ignoreRestSiblings: true }],
    },
  },
  storybook.configs['flat/recommended'],
);
