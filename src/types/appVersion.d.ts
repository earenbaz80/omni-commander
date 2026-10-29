/**
 * The version in package.json, injected at build time by vite.config.ts.
 *
 * Declared here so the renderer can report the version the package was built
 * from instead of a literal that drifts away from it.
 */
declare const __APP_VERSION__: string;
