/** The logo the platform ships, and the fallback of every address that is not one of its own. */
export const DEFAULT_LOGO = '/logo.svg';

/** An address a picture of the platform may have: a temporary address of the browser (a file just chosen), or a path of the site. */
const OWN_ADDRESS = /^(blob:|\/(?!\/))/;

/**
 * What the logo's `<img>` is given: the preview of a file just chosen (`blob:`), else the logo in use, else the one the platform
 * ships. Never a `javascript:` or `data:` address, nor one of another site (`//host`): the logo path comes from the settings
 * and the preview from the browser, and none of them is trusted to be what it should.
 */
export function logoSource(preview: string | null, logoPath: string): string {
  if (preview && OWN_ADDRESS.test(preview)) return preview;
  return OWN_ADDRESS.test(logoPath) ? logoPath : DEFAULT_LOGO;
}
