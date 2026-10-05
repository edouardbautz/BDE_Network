import type { DefaultSession } from 'next-auth';
import type { UserStatus } from '@/generated/prisma/client';

declare module 'next-auth' {
  interface User {
    login: string;
    campus: string;
  }

  interface Session {
    user: {
      id: string;
      login: string;
      campus: string;
      /** OWNER (bde.config.yml: everything), MEMBER (what its role grants) or PENDING (nothing). */
      status: UserStatus;
      roleId: string | null;
      roleName: string | null;
      /** The permissions held, among those of the enabled modules. Check with `can()`. */
      permissions: string[];
      /** Holds everything, including what future modules add (OWNER, or a role with all permissions). */
      holdsAll: boolean;
    } & DefaultSession['user'];
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    login?: string;
  }
}
