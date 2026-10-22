'use client';

import { createContext, useContext, type ReactNode } from 'react';

interface Shell {
  /** The account menu as the header of a page shows it on a phone (the rail carries it on a larger screen). */
  userMenu: ReactNode;
}

export const ShellContext = createContext<Shell>({ userMenu: null });

export const useShell = (): Shell => useContext(ShellContext);
