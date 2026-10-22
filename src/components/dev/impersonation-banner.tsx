import { FlaskConical } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { getImpersonation, isDevImpersonationEnabled } from '@/lib/dev-impersonation';
import { startImpersonation, stopImpersonation } from '@/lib/dev-impersonation-actions';
import { prisma } from '@/lib/prisma';

/** Dev-only banner + role switcher, rendered at the very top of every page
 * (see [locale]/layout.tsx) so it stays "always accessible" regardless of
 * which page a simulated role lands on. Resolves to null — no markup, no
 * client bundle for it — unless dev impersonation is enabled AND the real
 * signed-in user is OWNER. */
export async function ImpersonationBanner() {
  if (!isDevImpersonationEnabled()) {
    return null;
  }

  const session = await auth();
  if (!session?.user || session.user.status !== 'OWNER') {
    return null;
  }

  const [impersonation, roles, t, tRoles] = await Promise.all([
    getImpersonation(),
    prisma.role.findMany({
      select: { id: true, name: true, isDefault: true },
      orderBy: { name: 'asc' },
    }),
    getTranslations('devImpersonation'),
    getTranslations('roles'),
  ]);

  if (impersonation) {
    const label =
      impersonation.kind === 'pending'
        ? tRoles('PENDING')
        : (roles.find((role) => role.id === impersonation.roleId)?.name ?? impersonation.roleId);
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-center gap-3 bg-warning-soft px-4 py-2 text-body-strong text-warning"
      >
        <span className="inline-flex items-center gap-2">
          <FlaskConical aria-hidden="true" className="size-4" />
          {t('active', { role: label })}
        </span>
        <form action={stopImpersonation}>
          <button
            type="submit"
            className="rounded-pill bg-ink px-3.5 py-1.5 text-small text-bg transition-colors hover:opacity-90"
          >
            {t('exit')}
          </button>
        </form>
      </div>
    );
  }

  const defaultRole = roles.find((role) => role.isDefault) ?? roles[0];
  const defaultChoice = defaultRole ? `role:${defaultRole.id}` : 'PENDING';

  return (
    <div className="bg-surface-2 text-muted-foreground flex flex-wrap items-center justify-center gap-2 px-4 py-1.5 text-small">
      <span>{t('pickRole')}</span>
      <form
        action={async (formData: FormData) => {
          'use server';
          await startImpersonation(String(formData.get('role') ?? ''));
        }}
        className="flex items-center gap-2"
      >
        <select
          name="role"
          defaultValue={defaultChoice}
          className="bg-surface rounded-pill px-3 py-1 text-small"
        >
          <option value="PENDING">{tRoles('PENDING')}</option>
          {roles.map((role) => (
            <option key={role.id} value={`role:${role.id}`}>
              {role.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="bg-accent-fill text-accent-on hover:bg-accent-fill-hover rounded-pill px-3.5 py-1.5 text-small transition-colors"
        >
          {t('start')}
        </button>
      </form>
    </div>
  );
}
