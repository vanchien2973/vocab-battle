/** Signed-in user from SWA built-in auth (/.auth/me). */
export interface AuthUser {
  userId: string;
  provider: string;
  name: string;
}

export type LoginProvider = 'github' | 'aad';
export const LOGIN_PROVIDERS: { id: LoginProvider; label: string }[] = [
  { id: 'github', label: 'GitHub' },
  { id: 'aad', label: 'Microsoft' },
];

/** The current user, or null when signed out or when /.auth is unavailable (e.g. plain `vite` dev server). */
export async function fetchMe(signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    const res = await fetch('/.auth/me', { signal, headers: { Accept: 'application/json' } });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const data = (await res.json()) as { clientPrincipal?: { userId?: string; identityProvider?: string; userDetails?: string; userRoles?: string[] } | null };
    const p = data.clientPrincipal;
    if (!p?.userId || !p.userRoles?.includes('authenticated')) return null;
    return { userId: p.userId, provider: p.identityProvider ?? '', name: p.userDetails ?? '' };
  } catch {
    return null;
  }
}

/** Come back to the same page (keeps ?share= / ?deck= links working through login). */
export function loginUrl(provider: LoginProvider, returnTo = window.location.pathname + window.location.search): string {
  return `/.auth/login/${provider}?post_login_redirect_uri=${encodeURIComponent(returnTo)}`;
}

export function logoutUrl(returnTo = '/'): string {
  return `/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(returnTo)}`;
}
