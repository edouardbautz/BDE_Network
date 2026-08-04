export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { getConfig, ConfigError } = await import('@/config');

  try {
    getConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n❌ ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
