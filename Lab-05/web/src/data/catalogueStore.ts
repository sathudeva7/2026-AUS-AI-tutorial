/** The catalogue fixture, and the refresh queue's decisions.
 *
 * What is LEFT here after the console moved to Postgres. Programmes are read
 * and written through `features/catalogue` and `GET /api/programmes` now —
 * the editor used to save into this store, which is keyed on the fixture's
 * `p_uk_001` while the table lists database uuids, so an edit landed in a
 * copy nothing else could see and a reload threw it away.
 *
 * Two things still read the fixture list and have not moved: the rules tab,
 * which shows requirement text the agent evaluates by `p_uk_001`, and the
 * freshness queue, whose review items are fixtures with no table behind them
 * yet. Both go when the agent reads Postgres.
 */
import { useSyncExternalStore } from "react";
import { PROGRAMMES } from "./fixtures/programmes";
import { REFRESH_ITEMS } from "./fixtures/freshness";
import type { Programme, RefreshItem } from "./types";

interface CatalogueState {
  programmes: Programme[];
  refreshItems: RefreshItem[];
}

let state: CatalogueState = {
  programmes: PROGRAMMES,
  refreshItems: REFRESH_ITEMS,
};

const listeners = new Set<() => void>();

function emit(next: CatalogueState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCatalogue(): CatalogueState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Approving writes the retrieved value into the catalogue. Rejecting keeps
 *  the stored one. Either way the item is decided by a person — the refresh
 *  job itself never writes. */
export function decideRefreshItem(
  itemId: string,
  decision: "approved" | "rejected",
): void {
  emit({
    ...state,
    refreshItems: state.refreshItems.map((item) =>
      item.item_id === itemId ? { ...item, state: decision } : item,
    ),
  });
}
