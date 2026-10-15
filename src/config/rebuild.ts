/**
 * The command that builds the image from this folder, which is what copies `bde.config.yml` into it. Only a platform
 * driven by files (before the installer) needs it: the published image carries the template, not somebody's settings.
 */
export const REBUILD_COMMAND =
  'docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build';
