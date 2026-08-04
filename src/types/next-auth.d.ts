import type { DefaultSession } from 'next-auth';
import type { Role } from '@/generated/prisma/client';

declare module 'next-auth' {
  interface User {
    login: string;
    campus: string;
  }

  interface Session {
    user: {
      id: string;
      login: string;
      role: Role;
      campus: string;
    } & DefaultSession['user'];
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    login?: string;
  }
}
