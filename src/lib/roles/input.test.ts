import { describe, expect, it } from 'vitest';
import { permissionDefinitions } from '@/lib/permissions';
import {
  DESCRIPTION_MAX_LENGTH,
  NAME_MAX_LENGTH,
  parseRoleInput,
  type RawRoleInput,
} from './input';

const definitions = permissionDefinitions(['events']);

const raw = (overrides: Partial<RawRoleInput> = {}): RawRoleInput => ({
  name: 'Trésorier',
  description: '',
  allPermissions: false,
  permissions: [],
  ...overrides,
});

const parse = (overrides: Partial<RawRoleInput> = {}) =>
  parseRoleInput(raw(overrides), definitions);

describe('parseRoleInput', () => {
  it('accepts a name alone: a role with no permission is allowed', () => {
    expect(parse()).toEqual({
      ok: true,
      data: { name: 'Trésorier', description: null, allPermissions: false, permissions: [] },
    });
  });

  it('trims, collapses spaces and keeps a description', () => {
    const result = parse({
      name: '  Resp.   événements ',
      description: '  Organise   les soirées ',
    });
    expect(result).toMatchObject({
      ok: true,
      data: { name: 'Resp. événements', description: 'Organise les soirées' },
    });
  });

  it('adds what a permission implies, sorted, without duplicates', () => {
    const result = parse({ permissions: ['events.manage', 'members.manage', 'events.manage'] });
    expect(result).toMatchObject({
      ok: true,
      data: { permissions: ['events.manage', 'events.view', 'members.manage'] },
    });
  });

  it('stores no explicit permission for a role with all permissions', () => {
    const result = parse({ allPermissions: true, permissions: ['events.view'] });
    expect(result).toMatchObject({ ok: true, data: { allPermissions: true, permissions: [] } });
  });

  describe('name', () => {
    it.each(['', '   ', '\t'])('is required: %j', (name) => {
      expect(parse({ name })).toEqual({ ok: false, errors: { name: 'required' } });
    });

    it('is limited in length, counted after cleaning', () => {
      expect(parse({ name: 'a'.repeat(NAME_MAX_LENGTH) }).ok).toBe(true);
      expect(parse({ name: 'a'.repeat(NAME_MAX_LENGTH + 1) })).toEqual({
        ok: false,
        errors: { name: 'tooLong' },
      });
    });

    it.each([
      ['a line break', 'Pré' + String.fromCharCode(10) + 'sident'],
      ['a carriage return', 'Pré' + String.fromCharCode(13) + 'sident'],
      ['a NUL character', 'Pré' + String.fromCharCode(0) + 'sident'],
      ['a Unicode line separator', 'Pré' + String.fromCharCode(0x2028) + 'sident'],
    ])('refuses %s', (_label, name) => {
      expect(parse({ name })).toEqual({ ok: false, errors: { name: 'invalid' } });
    });
  });

  describe('description', () => {
    it('is limited in length', () => {
      expect(parse({ description: 'a'.repeat(DESCRIPTION_MAX_LENGTH) }).ok).toBe(true);
      expect(parse({ description: 'a'.repeat(DESCRIPTION_MAX_LENGTH + 1) })).toEqual({
        ok: false,
        errors: { description: 'tooLong' },
      });
    });

    it('is one line of plain text', () => {
      expect(parse({ description: 'ligne un\nligne deux' })).toEqual({
        ok: false,
        errors: { description: 'invalid' },
      });
    });
  });

  describe('permissions', () => {
    // A key that does not exist means a tampered request or a stale form: refuse, do not drop.
    it.each([['audit.view'], ['owner'], ['finance.manage'], ['events.view', 'nope'], ['*']])(
      'refuses the unknown key(s) %j',
      (...keys) => {
        expect(parse({ permissions: keys })).toEqual({
          ok: false,
          errors: { permissions: 'unknown' },
        });
      },
    );

    it('refuses the keys of a module that is not enabled', () => {
      const result = parseRoleInput(
        raw({ permissions: ['finance.view'] }),
        permissionDefinitions(['events']),
      );
      expect(result).toEqual({ ok: false, errors: { permissions: 'unknown' } });
      expect(
        parseRoleInput(
          raw({ permissions: ['finance.view'] }),
          permissionDefinitions(['events', 'finance']),
        ).ok,
      ).toBe(true);
    });
  });

  it('reports every problem at once', () => {
    expect(parse({ name: '', description: 'a\nb', permissions: ['nope'] })).toEqual({
      ok: false,
      errors: { name: 'required', description: 'invalid', permissions: 'unknown' },
    });
  });
});
