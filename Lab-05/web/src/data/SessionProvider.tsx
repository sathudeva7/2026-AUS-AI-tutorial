/** Who the signed-in person is, according to the BACKEND.
 *
 * Clerk knows the user and the organization. It does not know their role in
 * this application or what they may do — that lives in the database, and
 * `/api/me` is how the browser learns it.
 *
 * This is also what makes provisioning deterministic. A brand-new agency is
 * created in Clerk in the browser; the backend first hears of it when a
 * request arrives carrying the org. Before this provider, that happened to be
 * whichever protected endpoint the first page called — so landing somewhere
 * that fetched nothing meant no agency row. Now one known call does it.
 *
 * `permissions` is for hiding what someone cannot do. It is NOT a security
 * boundary: every one of these endpoints re-checks server-side, because a
 * hidden button is still reachable with curl.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@clerk/react";
import { fetchMe } from "./live";

interface Session {
  tenant_id: string;
  user_id: string;
  role: string;
  permissions: string[];
}

interface SessionValue {
  session: Session | null;
  loading: boolean;
  error: Error | null;
  /** Whether to show a control. The server decides whether it works. */
  can: (permission: string) => boolean;
  reload: () => void;
}

const SessionContext = createContext<SessionValue>({
  session: null,
  loading: true,
  error: null,
  can: () => false,
  reload: () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, orgId } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !orgId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMe()
      .then((me) => {
        if (!cancelled) setSession(me);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err as Error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, orgId, nonce]);

  const can = useCallback(
    (permission: string) => session?.permissions.includes(permission) ?? false,
    [session],
  );

  return (
    <SessionContext.Provider value={{ session, loading, error, can, reload }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
