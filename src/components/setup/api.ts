'use client';

import { createContext, useContext } from 'react';
import type { ActionResult, CampusOption } from '@/app/[locale]/setup/actions';

/**
 * The server actions a step of the installer calls. The installer and the settings page show the same forms
 * (identity, address, 42 application, campuses, modules, notifications): each gives them its own actions, which
 * answer the same way (`ActionResult`), and the form does not know which one it talks to.
 */
export interface StepApi {
  saveIdentity(input: unknown): Promise<ActionResult>;
  saveAddress(input: unknown): Promise<ActionResult<{ url: string; redirectUrl: string }>>;
  verifyFortyTwo(input: unknown): Promise<ActionResult>;
  skipFortyTwoVerification(input: unknown): Promise<ActionResult>;
  loadCampuses(): Promise<ActionResult<{ campuses: CampusOption[] | null }>>;
  saveCampuses(input: unknown): Promise<ActionResult>;
  saveModules(input: unknown): Promise<ActionResult>;
  saveNotifications(input: unknown): Promise<ActionResult>;
  testNotification(notifications: unknown, input: unknown): Promise<ActionResult>;
}

/**
 * `wizard`: one step of a walk (a Back button, "Continue"). `section`: a form on the settings page, with its own
 * Save button, that does not take the focus when the page opens.
 */
export type FrameMode = 'wizard' | 'section';

export const FrameModeContext = createContext<FrameMode>('wizard');

export function useFrameMode(): FrameMode {
  return useContext(FrameModeContext);
}
