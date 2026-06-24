import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**'],
    // Tests run in development-auth mode so importing config (which fails closed
    // when Cloudflare Access is required but unconfigured) does not throw.
    env: {
      REQUIRE_CLOUDFLARE_ACCESS: 'false'
    }
  }
});
