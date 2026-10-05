import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { ConfigError, getConfig } from './src/config';
import { securityHeaders } from './src/lib/security-headers';

try {
  getConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`\n❌ ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // A self-contained server (server.js + only the files it needs) for the Docker image.
  output: 'standalone',
  poweredByHeader: false,
  // No image goes through next/image (the logo is a local SVG, avatars are plain <img>):
  // switching the optimizer off removes the /_next/image endpoint and the native
  // image libraries it needs.
  images: { unoptimized: true },
  // Left out of the standalone bundle: sharp and its native libraries (only the image
  // optimizer, switched off above, uses them) and TypeScript (only next.config.ts needs it, at build).
  outputFileTracingExcludes: {
    '*': ['node_modules/@img/**/*', 'node_modules/sharp/**/*', 'node_modules/typescript/**/*'],
  },
  async headers() {
    return securityHeaders(process.env.NODE_ENV === 'production' ? 'production' : 'development');
  },
};

export default withNextIntl(nextConfig);
