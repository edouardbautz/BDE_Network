import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({
  getConfig: vi.fn(() => ({
    modules: { enabled: ['events'] },
    events: { intraPublication: true },
  })),
}));

const { getConfig } = await import('@/config');
const { missingPlatforms, postingFacts, requiredFor, requiredPlatforms } =
  await import('./required');

const NONE = { main: { discord: false, slack: false }, staff: { discord: false, slack: false } };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(getConfig).mockReturnValue({
    modules: { enabled: ['events'] },
    events: { intraPublication: true },
  } as never);
});

describe('the platforms a person must give an id for', () => {
  it('are none when the BDE posts nowhere: nothing is asked', () => {
    expect(requiredPlatforms(NONE, false)).toEqual([]);
    expect(requiredPlatforms(NONE, true)).toEqual([]);
  });

  it('are the platforms of the BDE’s own webhook, for everybody', () => {
    const facts = { ...NONE, main: { discord: true, slack: false } };
    expect(requiredPlatforms(facts, false)).toEqual(['discord']);
    expect(requiredPlatforms({ ...NONE, main: { discord: true, slack: true } }, false)).toEqual([
      'discord',
      'slack',
    ]);
  });

  it('add the platform of the staff’s room for those who hold the right to publish on the intra, and only them', () => {
    const facts = { ...NONE, staff: { discord: false, slack: true } };
    expect(requiredPlatforms(facts, true)).toEqual(['slack']);
    expect(requiredPlatforms(facts, false)).toEqual([]);
    // both, once: a platform that is in both is asked once
    const both = { main: { discord: true, slack: false }, staff: { discord: true, slack: true } };
    expect(requiredPlatforms(both, true)).toEqual(['discord', 'slack']);
    expect(requiredPlatforms(both, false)).toEqual(['discord']);
  });
});

describe('what is still to give', () => {
  it('is the required platforms with no id', () => {
    const held = { discordUserId: '348291047563210241', slackUserId: null };
    expect(missingPlatforms(['discord', 'slack'], held)).toEqual(['slack']);
    expect(missingPlatforms(['discord'], held)).toEqual([]);
    expect(missingPlatforms([], { discordUserId: null, slackUserId: null })).toEqual([]);
    expect(
      missingPlatforms(['discord', 'slack'], { discordUserId: null, slackUserId: null }),
    ).toEqual(['discord', 'slack']);
  });
});

describe('the settings of the moment', () => {
  it('say where the BDE posts: its webhooks, and the staff’s only while it publishes on the intra', () => {
    vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://discord.com/api/webhooks/1/a');
    vi.stubEnv('SLACK_STAFF_WEBHOOK_URL', 'https://hooks.slack.com/services/T1/B1/x');
    expect(postingFacts()).toEqual({
      main: { discord: true, slack: false },
      staff: { discord: false, slack: true },
    });
    vi.mocked(getConfig).mockReturnValue({
      modules: { enabled: ['events'] },
      events: { intraPublication: false },
    } as never);
    expect(postingFacts().staff).toEqual({ discord: false, slack: false });
    vi.mocked(getConfig).mockReturnValue({ modules: { enabled: [] } } as never);
    expect(postingFacts().staff).toEqual({ discord: false, slack: false });
  });

  it('ask the holder of the intra right for the staff’s platform, by the rights they really hold', () => {
    vi.stubEnv('SLACK_STAFF_WEBHOOK_URL', 'https://hooks.slack.com/services/T1/B1/x');
    expect(
      requiredFor({ status: 'MEMBER', permissions: ['events.view', 'events.intra_publish'] }),
    ).toEqual(['slack']);
    expect(requiredFor({ status: 'MEMBER', permissions: ['events.view'] })).toEqual([]);
    // an owner holds every right of the enabled modules
    expect(
      requiredFor({ status: 'OWNER', permissions: ['events.view', 'events.intra_publish'] }),
    ).toEqual(['slack']);
    // somebody waiting holds nothing
    expect(requiredFor({ status: 'PENDING', permissions: [] })).toEqual([]);
  });

  it('ask everybody, a pending account included, for the platform of the BDE’s own webhook', () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.com/services/T1/B1/x');
    expect(requiredFor({ status: 'PENDING', permissions: [] })).toEqual(['slack']);
    expect(requiredFor({ status: 'MEMBER', permissions: [] })).toEqual(['slack']);
  });
});
