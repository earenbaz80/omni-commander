import type { StorybookConfig } from '@storybook/react-vite';
import type { UserConfig } from 'vite';

// Storybook builds with the app's vite.config.ts, and two of its plugins belong
// only to the app. The PWA plugin precaches whatever the build emits, and
// Storybook's manager runtime is a single 3.3 MB file, past workbox's 2 MiB
// ceiling: `storybook build` used to die inside generateSW and never finish, so
// the docs could not be built at all. The policy plugin writes the app's
// document policy into every HTML it sees, which is not something a docs site
// should carry. Everything else -- React, Tailwind and the version define --
// still comes from the app config, so a story runs the same code the app does.
const APP_ONLY_PLUGINS = ['vite-plugin-pwa', 'omni-content-security-policy'];

const isAppOnly = (plugin: unknown): boolean => {
  const name = (plugin as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && APP_ONLY_PLUGINS.some((prefix) => name.startsWith(prefix));
};

const withoutAppOnlyPlugins = (config: UserConfig): UserConfig => {
  // The app config nests plugin arrays and leaves falsy entries behind; Vite
  // accepts both, so flatten before filtering and hand back a flat list.
  const flattened = (config.plugins ?? []).flat(Infinity) as unknown[];
  config.plugins = flattened.filter((plugin) => !isAppOnly(plugin)) as UserConfig['plugins'];
  return config;
};

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@chromatic-com/storybook',
    '@storybook/addon-vitest',
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-mcp',
  ],
  framework: '@storybook/react-vite',
  viteFinal: withoutAppOnlyPlugins,
};
export default config;
