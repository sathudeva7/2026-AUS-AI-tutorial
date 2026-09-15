/** Local catalogue edits, held across routes.
 *
 * The editor is its own route, so an edit made there has to survive the
 * navigation back to the table. There is no PUT /api/programmes to persist
 * to, so this is a session-scoped overlay on the fixture — edits and new
 * programmes live here until the page reloads, and the UI says so rather
 * than implying anything was saved to a catalogue the agent reads.
 *
 * A new programme is marked `draft`. That distinction is real in the product:
 * an unverified entry is not visible to the agent, and the console must never
 * show a draft as though matching could use it.
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

export function getProgramme(programmeId: string): Programme | undefined {
  return state.programmes.find((p) => p.programme_id === programmeId);
}

/** Save an edit. `verified_at` moves to today because a human just confirmed
 *  the figures — that is what verification is, and leaving the old date would
 *  under-report the freshness of a row someone just checked. */
export function saveProgramme(programme: Programme): void {
  const index = state.programmes.findIndex(
    (p) => p.programme_id === programme.programme_id,
  );
  const stamped = {
    ...programme,
    verified_at: new Date().toISOString().slice(0, 10),
  };
  // A NEW programme goes to the front, not the end.
  //
  // The table pages ten at a time, so appending put whatever you had just
  // created on page two — you pressed Save, landed on the catalogue, and your
  // programme was nowhere on screen. An edit keeps its position, because a row
  // jumping to the top when you correct a typo loses your place in the list.
  const programmes =
    index === -1
      ? [stamped, ...state.programmes]
      : state.programmes.map((p, i) => (i === index ? stamped : p));
  emit({ ...state, programmes });
}

/** Remove a programme from the session's catalogue.
 *
 * Session-scoped like every other write here: there is no DELETE endpoint, so
 * this removes the row from the overlay and a reload brings it back. The
 * confirmation says so in words rather than letting the table imply a
 * catalogue the agent reads has changed.
 */
export function deleteProgramme(programmeId: string): void {
  emit({
    ...state,
    programmes: state.programmes.filter((p) => p.programme_id !== programmeId),
  });
}

/** Copy a programme as a new DRAFT, inserted directly after the original.
 *
 * Draft is not a detail: an agency adding five courses at one university
 * copies the first four times, and a copy that inherited `verified_at` would
 * claim four unchecked entries had been confirmed on the original's date.
 * Every figure the agent states travels with that date, so the copy starts
 * unverified and invisible to the agent until somebody checks it.
 */
export function duplicateProgramme(programmeId: string): Programme | undefined {
  const source = state.programmes.find((p) => p.programme_id === programmeId);
  if (!source) return undefined;

  const copy: Programme = {
    ...source,
    programme_id: newProgrammeId(),
    name: `${source.name} (copy)`,
    // Epoch, not today. `isStale` treats it as overdue, so the copy shows up
    // in Needs Verification immediately — which is exactly what it is.
    verified_at: "1970-01-01",
    draft: true,
  };

  const at = state.programmes.findIndex((p) => p.programme_id === programmeId);
  const next = [...state.programmes];
  next.splice(at + 1, 0, copy);
  emit({ ...state, programmes: next });
  return copy;
}

export function newProgrammeId(): string {
  return `p_new_${state.programmes.length + 1}`;
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
