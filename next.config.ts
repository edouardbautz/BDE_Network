import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { securityHeaders } from './src/lib/security-headers';

// bde.config.yml is not read here any more: the build does not depend on the configuration (the platform's
// settings live in its database, src/lib/settings), so a missing or broken file must not stop a rebuild.

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // A self-contained server (server.js + only the files it needs) for the Docker image.
  output: 'standalone',
  poweredByHeader: false,
  // The settings page sends the logo (2 MB at most, src/lib/branding/image.ts) to a server action.
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
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
