'use client';

import { createContext, useContext } from 'react';
import type { Me, Tenant } from './api';

export interface SessionValue {
  me: Me;
  tenant: Tenant | null;
  /** Without campusId: held anywhere. With campusId: held for that campus. */
  can: (permission: string, campusId?: string) => boolean;
  /** Held for every campus (needed for school-wide records such as subjects). */
  canEverywhere: (permission: string) => boolean;
  reload: () => Promise<void>;
}

export const SessionContext = createContext<SessionValue | null>(null);

export const useSession = (): SessionValue => {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside the app layout');
  return value;
};
