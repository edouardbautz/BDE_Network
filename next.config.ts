import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { ConfigError, getConfig } from './src/config';

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

const nextConfig: NextConfig = {};

export default withNextIntl(nextConfig);
