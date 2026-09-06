/** The overnight refresh queue.
 *
 * The job searches official sources and diffs them against stored catalogue
 * values. It raises a review item and stops there — it never writes to the
 * catalogue itself. Approval by a human is the only path from a retrieved
 * figure to one the agent is allowed to state.
 *
 * Every item below points at a real programme in `programmes.ts`, so
 * approving one and then opening that programme in the editor shows a
 * consistent story.
 *
 * Fixture, not live data. There is no refresh job running against this lab.
 */
import type { RefreshItem } from "../types";

export const REFRESH_ITEMS: RefreshItem[] = [
  {
    item_id: "rf_001",
    programme: "MSc Data Science — Camden Metropolitan University",
    field: "Tuition · international · last verified 22 days ago",
    was: "GBP 24,500",
    now: "GBP 25,900",
    source: "camdenmetropolitan.example/fees · retrieved today 03:12",
    state: "awaiting",
  },
  {
    item_id: "rf_002",
    programme: "MSc Artificial Intelligence — Thameside University",
    field: "Application deadline · 2027-09 intake",
    was: "31 May 2027",
    now: "14 May 2027",
    source: "thamesideuniversity.example · retrieved today 03:14",
    state: "awaiting",
  },
  {
    item_id: "rf_003",
    programme: "Master of Data Science — Port Phillip University",
    field: "English requirement · no change detected",
    was: "IELTS 6.5",
    now: "IELTS 6.5",
    source: "portphillipuniversity.example · retrieved today 03:09",
    state: "unchanged",
  },
];
