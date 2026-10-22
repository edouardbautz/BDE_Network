import { describe, expect, it } from 'vitest';
import { accessFor } from './access';

/** What the session carries about an account's rights. Found by the mutation testing of the quality campaign. */

const role = { name: 'Trésorier', permissions: ['events.view'], allPermissions: false };

describe('accessFor', () => {
  it('carries the role of a member, its name and what it grants', () => {
    const access = accessFor({ status: 'MEMBER', roleId: 'r1', role }, ['events']);
    expect(access).toMatchObject({
      status: 'MEMBER',
      roleId: 'r1',
      roleName: 'Trésorier',
      permissions: ['events.view'],
      holdsAll: false,
    });
  });

  it('carries no role for an owner or a waiting account, even if the row names one (the database refuses it; the session must not repeat it)', () => {
    for (const status of ['OWNER', 'PENDING'] as const) {
      const access = accessFor({ status, roleId: 'r1', role }, ['events']);
      expect(access.roleId, status).toBeNull();
      expect(access.roleName, status).toBeNull();
    }
  });

  it('gives a member without a role nothing, and no name', () => {
    const access = accessFor({ status: 'MEMBER', roleId: null, role: null }, ['events']);
    expect(access).toMatchObject({
      roleId: null,
      roleName: null,
      permissions: [],
      holdsAll: false,
    });
  });
});
