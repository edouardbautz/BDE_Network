import { describe, expect, it } from 'vitest';
import {
  canManageMembers,
  canViewAuditLog,
  hasMinRole,
  hasModuleAccess,
  isApproved,
} from './permissions';

describe('hasMinRole', () => {
  it('ranks OWNER above ADMIN above MEMBER above PENDING', () => {
    expect(hasMinRole('OWNER', 'ADMIN')).toBe(true);
    expect(hasMinRole('ADMIN', 'OWNER')).toBe(false);
    expect(hasMinRole('MEMBER', 'MEMBER')).toBe(true);
    expect(hasMinRole('PENDING', 'MEMBER')).toBe(false);
  });
});

describe('isApproved', () => {
  it('is false only for PENDING', () => {
    expect(isApproved('PENDING')).toBe(false);
    expect(isApproved('MEMBER')).toBe(true);
    expect(isApproved('ADMIN')).toBe(true);
    expect(isApproved('OWNER')).toBe(true);
  });
});

describe('canManageMembers', () => {
  it('allows ADMIN and OWNER only', () => {
    expect(canManageMembers('OWNER')).toBe(true);
    expect(canManageMembers('ADMIN')).toBe(true);
    expect(canManageMembers('MEMBER')).toBe(false);
    expect(canManageMembers('PENDING')).toBe(false);
  });
});

describe('canViewAuditLog', () => {
  it('allows OWNER only', () => {
    expect(canViewAuditLog('OWNER')).toBe(true);
    expect(canViewAuditLog('ADMIN')).toBe(false);
  });
});

describe('hasModuleAccess', () => {
  it('always grants OWNER access, regardless of granted modules', () => {
    expect(hasModuleAccess('OWNER', [], 'finance')).toBe(true);
  });

  it('grants MEMBER/ADMIN access only when the module was explicitly granted', () => {
    expect(hasModuleAccess('ADMIN', ['finance'], 'finance')).toBe(true);
    expect(hasModuleAccess('ADMIN', [], 'finance')).toBe(false);
    expect(hasModuleAccess('MEMBER', ['events'], 'finance')).toBe(false);
  });
});
