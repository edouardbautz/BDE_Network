// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

/**
 * The Slack app that BDEs create with one link (docs/notifications.md): the link must be the very
 * manifest of the repository, and that manifest must ask Slack for nothing but incoming webhooks.
 */

const root = process.cwd();
const manifestText = readFileSync(join(root, 'docs/slack-app-manifest.yml'), 'utf8');
const docs = readFileSync(join(root, 'docs/notifications.md'), 'utf8');

interface Manifest {
  display_information: { name: string; description: string; background_color?: string };
  features?: Record<string, unknown>;
  oauth_config: { scopes: Record<string, string[]> };
  settings?: Record<string, unknown>;
}
const manifest = load(manifestText) as Manifest;

describe('the Slack app manifest', () => {
  it('names the app BDE_Network, within what Slack accepts', () => {
    expect(manifest.display_information.name).toBe('BDE_Network');
    expect(manifest.display_information.name.length).toBeLessThanOrEqual(35);
    expect(manifest.display_information.description.length).toBeLessThanOrEqual(140);
  });

  it('asks for incoming webhooks and nothing else: one bot scope, no user scope', () => {
    expect(manifest.oauth_config.scopes).toEqual({ bot: ['incoming-webhook'] });
  });

  it('turns on nothing that listens or acts: no events, no interactivity, no sockets, no commands', () => {
    expect(manifest.settings).toMatchObject({
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    });
    expect(JSON.stringify(manifest)).not.toMatch(
      /event_subscriptions|interactivity|slash_commands|request_url|redirect_urls/,
    );
    expect(Object.keys(manifest.features ?? {})).toEqual(['bot_user']);
  });

  it('contains nothing personal: no address, no token, no identifier', () => {
    expect(manifestText).not.toMatch(/https?:\/\//);
    expect(manifestText).not.toMatch(/xox[a-z]-|hooks\.slack\.com|T0[A-Z0-9]{6,}/);
  });
});

describe('the pre-filled link of docs/notifications.md', () => {
  // Written as [text](<address>): the address has parentheses (the description), which end an
  // ordinary Markdown link; the angle brackets are what keeps it whole.
  const links = [
    ...docs.matchAll(/\]\(<(https:\/\/api\.slack\.com\/apps\?new_app=1&manifest_yaml=[^>\s]+)>\)/g),
  ].map((match) => match[1] ?? '');

  it('is in the documentation, once', () => {
    expect(links).toHaveLength(1);
  });

  it('is exactly the manifest of the repository, encoded', () => {
    expect(links[0]).toBe(
      `https://api.slack.com/apps?new_app=1&manifest_yaml=${encodeURIComponent(manifestText)}`,
    );
  });

  it('is wrapped in angle brackets, which keep its parentheses from ending the Markdown link', () => {
    expect(links[0]).toMatch(/[()]/);
    expect(docs).toContain(`](<${links[0]}>)`);
  });

  it('decodes to a manifest that parses to the same thing', () => {
    const encoded = (links[0] ?? '').split('manifest_yaml=')[1] ?? '';
    expect(load(decodeURIComponent(encoded))).toEqual(manifest);
  });

  it('says that Discord is the simplest option, and gives the manual way if the link fails', () => {
    expect(docs).toContain("Discord est l'option la plus simple");
    expect(docs).toContain('From a manifest');
  });
});
