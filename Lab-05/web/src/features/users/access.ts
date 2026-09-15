/** Who may change what on the roster screen.
 *
 * UX only. Every rule here is enforced again by the endpoint, and a hidden
 * button is not a permission — this exists so the screen does not offer
 * actions that will come back 403, not to secure anything.
 *
 * Its own module rather than a helper inside a component file: two components
 * on this screen ask the same question (the profile header's Edit button and
 * the contact card's), and a rule with two copies is a rule that eventually
 * has two answers.
 */
import { useSession } from "@/data/SessionProvider";

import type { User } from "./types";

/** Self, or `users.edit`.
 *
 * Not a plain permission check, because everyone may edit their own row —
 * which is also the rule `PATCH /api/users/{id}` and the availability write
 * both apply. Someone who cannot set their own hours has them decided by a
 * colleague in another timezone.
 */
export function useMayEditUser(user: User): boolean {
  const { session, can } = useSession();
  return can("users.edit") || session?.user_id === user.id;
}
