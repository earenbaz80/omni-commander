// Simple dev-only logger. In production builds, Vite replaces import.meta.env.DEV
// with `false`, so the calls below are tree-shaken out of the final bundle.
export const log = {
  warn: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.error(...args);
  },
};
