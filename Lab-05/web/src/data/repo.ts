/** The one place the UI learns where data comes from.
 *
 * Every surface reads through `repo`. Some of it is live against the student
 * agent on :8001; the rest is fixtures, because those endpoints do not exist
 * yet. Which is which is stated per method below and is the only thing that
 * has to change when an endpoint lands — replace a fixture body with a call
 * into `live.ts` and no component moves.
 *
 * Fixture-backed reads are wrapped in a resolved promise deliberately. Making
 * them async now means a real endpoint can be dropped in without turning
 * every caller's render path inside out later.
 */
import * as live from "./live";
import { PROGRAMMES } from "./fixtures/programmes";
import { COUNSELLORS, PROFILES } from "./fixtures/counsellors";
import { transcriptFor } from "./fixtures/transcripts";
import { REFRESH_ITEMS } from "./fixtures/freshness";
import { TENANT } from "./fixtures/tenant";
import { answerFor, SUGGESTED_ANSWERS } from "./fixtures/assistant";
import type { AssistantAnswer } from "./fixtures/assistant";
import { sessionTranscript } from "./session";
import type {
  Briefing,
  Counsellor,
  CounsellorProfile,
  Lead,
  Message,
  Programme,
  RefreshItem,
  TenantConfig,
} from "./types";

export interface Transcript {
  messages: Message[];
  /** True when these are messages this browser session actually exchanged
   *  with the agent, false when they are seed-lead fixtures. The Transcript
   *  tab says which — a fixture must never pass as a recorded conversation. */
  live: boolean;
}

export interface NorthboundRepo {
  // --- live: student agent on :8001 -------------------------------------
  listLeads(): Promise<Lead[]>;
  getBriefing(leadId: string): Promise<Briefing>;
  createLead(input: {
    name: string;
    email: string;
    country_of_residence?: string;
  }): Promise<Lead & { created: boolean }>;
  runAgent: typeof live.runAgent;

  // --- fixtures ----------------------------------------------------------
  listProgrammes(): Promise<Programme[]>;
  getProgramme(programmeId: string): Promise<Programme | null>;
  listCounsellors(): Promise<Counsellor[]>;
  getCounsellorProfile(counsellorId: string): Promise<CounsellorProfile | null>;
  getTranscript(leadId: string): Promise<Transcript>;
  listRefreshItems(): Promise<RefreshItem[]>;
  getTenant(): Promise<TenantConfig>;
  /** Returns null when the question is outside the canned set — the surface
   *  then says the assistant is not connected rather than improvising. */
  ask(question: string): Promise<AssistantAnswer | null>;
  suggestedQuestions(): AssistantAnswer[];
}

export const repo: NorthboundRepo = {
  listLeads: live.fetchLeads,
  getBriefing: live.fetchBriefing,
  createLead: live.createLead,
  runAgent: live.runAgent,

  async listProgrammes() {
    return PROGRAMMES;
  },
  async getProgramme(programmeId) {
    return PROGRAMMES.find((p) => p.programme_id === programmeId) ?? null;
  },
  async listCounsellors() {
    return COUNSELLORS;
  },
  async getCounsellorProfile(counsellorId) {
    return PROFILES[counsellorId] ?? null;
  },
  async getTranscript(leadId) {
    const fromSession = sessionTranscript(leadId);
    if (fromSession.length) return { messages: fromSession, live: true };
    return { messages: transcriptFor(leadId), live: false };
  },
  async listRefreshItems() {
    return REFRESH_ITEMS;
  },
  async getTenant() {
    return TENANT;
  },
  async ask(question) {
    return answerFor(question);
  },
  suggestedQuestions() {
    return SUGGESTED_ANSWERS;
  },
};

export type { AssistantAnswer };
