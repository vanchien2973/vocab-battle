import { useEffect, useState } from 'react';
import type { OnlineSession, OnlineSnapshot } from '../net/session';

export function useOnlineSession(session: OnlineSession | null): OnlineSnapshot | null {
  const [snapshot, setSnapshot] = useState(session?.snapshot ?? null);
  useEffect(() => {
    setSnapshot(session?.snapshot ?? null);
    return session?.subscribe(setSnapshot);
  }, [session]);
  return snapshot;
}
