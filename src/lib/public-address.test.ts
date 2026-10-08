// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { setRuntimeSettings } from '@/lib/settings/runtime';
import {
  canonicalHost,
  isUnspecifiedHost,
  originOfRequest,
  publicOrigin,
  registeredAddress,
} from './public-address';

const register = (APP_URL?: string) =>
  setRuntimeSettings({
    config: {} as never,
    values: APP_URL ? { APP_URL } : {},
    source: 'database',
  });
const requestWith = (headers: Record<string, string>) => new Headers(headers);

afterEach(() => setRuntimeSettings(undefined));

describe('isUnspecifiedHost', () => {
  it.each(['0.0.0.0', '0.1.2.3', '0', '::', '[::]', '0:0:0:0:0:0:0:0', ' 0.0.0.0 '])(
    '%s is where a server listens, not an address',
    (host) => expect(isUnspecifiedHost(host)).toBe(true),
  );

  it.each([
    'localhost',
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.5',
    'bde.exemple.fr',
    '::1',
    '[::1]',
    '0.example.fr',
  ])('%s is an address', (host) => expect(isUnspecifiedHost(host)).toBe(false));
});

describe('canonicalHost', () => {
  it('writes this computer as localhost, as Next.js does, and leaves the rest alone', () => {
    expect(canonicalHost('127.0.0.1')).toBe('localhost');
    expect(canonicalHost('127.1.2.3')).toBe('localhost');
    expect(canonicalHost('[::1]')).toBe('localhost');
    expect(canonicalHost('Localhost')).toBe('localhost');
    expect(canonicalHost('192.168.1.5')).toBe('192.168.1.5');
    expect(canonicalHost('bde.exemple.fr')).toBe('bde.exemple.fr');
  });
});

describe('registeredAddress', () => {
  it('is the address of the settings as an origin', () => {
    register('https://bde.exemple.fr');
    expect(registeredAddress()).toBe('https://bde.exemple.fr');
    register('http://localhost:3000/');
    expect(registeredAddress()).toBe('http://localhost:3000');
    register('https://bde.exemple.fr:443/some/path?x=1');
    expect(registeredAddress()).toBe('https://bde.exemple.fr');
    register('http://127.0.0.1:3000');
    expect(registeredAddress()).toBe('http://localhost:3000');
  });

  it('is null when there is none, or when it cannot be used', () => {
    register(undefined);
    expect(registeredAddress()).toBeNull();
    for (const unusable of [
      'http://0.0.0.0:3000',
      'ftp://bde.exemple.fr',
      'bde.exemple.fr',
      'not a url',
    ]) {
      register(unusable);
      expect(registeredAddress(), unusable).toBeNull();
    }
  });
});

describe('originOfRequest', () => {
  it('is what the browser used: the forwarded host and protocol of a proxy, else Host', () => {
    expect(
      originOfRequest(
        requestWith({ 'x-forwarded-host': 'bde.exemple.fr', 'x-forwarded-proto': 'https' }),
      ),
    ).toBe('https://bde.exemple.fr');
    expect(originOfRequest(requestWith({ host: 'localhost:3500' }))).toBe('http://localhost:3500');
    expect(
      originOfRequest(
        requestWith({
          'x-forwarded-host': 'bde.exemple.fr, proxy.internal',
          'x-forwarded-proto': 'https, http',
        }),
      ),
    ).toBe('https://bde.exemple.fr');
  });

  it('never gives 0.0.0.0 back: a browser pointed there is told localhost', () => {
    expect(originOfRequest(requestWith({ host: '0.0.0.0:3000' }))).toBe('http://localhost:3000');
    expect(originOfRequest(requestWith({ 'x-forwarded-host': '[::]:3000' }))).toBe(
      'http://localhost:3000',
    );
  });

  it('has a default, and does not trust a protocol other than http(s)', () => {
    expect(originOfRequest(requestWith({}))).toBe('http://localhost:3000');
    expect(
      originOfRequest(requestWith({ host: 'bde.exemple.fr', 'x-forwarded-proto': 'javascript' })),
    ).toBe('http://bde.exemple.fr');
    expect(originOfRequest(requestWith({ host: 'bad host' }))).toBe('http://localhost:3000');
  });
});

describe('publicOrigin', () => {
  it('prefers the registered address to whatever the request says', () => {
    register('https://bde.exemple.fr');
    expect(publicOrigin(requestWith({ host: '0.0.0.0:3000' }))).toBe('https://bde.exemple.fr');
  });

  it('falls back on the request without one', () => {
    register(undefined);
    expect(publicOrigin(requestWith({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
  });
});
