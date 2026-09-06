/** The words behind each seed lead's facts.
 *
 * `GET /api/leads` and `GET /api/briefing` return `facts.known()`, which is
 * Python's flat key → value view — the `source_quote` is dropped on the way
 * out. So the console recovers quotes two ways, in this order:
 *
 *   1. the audit trail. Every `update_lead_facts` call in `briefing.tool_calls`
 *      carries the quote in its args, so any fact the agent wrote is
 *      reconstructable from the record. That is CLAUDE.md's "everything is
 *      reconstructable from ToolCall + Message" doing real work rather than
 *      being a slogan.
 *   2. this file, for facts that were SEEDED rather than written by a tool
 *      call — those have no audit row to recover from.
 *
 * A fact with neither says so plainly. It never shows a fabricated quote.
 *
 * Generated from `Lab-05/mocks/data/northbound/leads.json`.
 */
import type { Fact, FactKey } from "../types";

export const SEED_QUOTES: Record<string, Partial<Record<FactKey, Fact>>> = {
  "lead_001": {
    target_country: {
      value: "UK",
      source_quote: "I want to do my masters in the UK",
      stated_at: "2026-08-28T09:14:00Z",
    },
    field_of_study: {
      value: "data science",
      source_quote: "something in data science or analytics",
      stated_at: "2026-08-28T09:15:00Z",
    },
    qualification: {
      value: "3-year BSc Computer Science, Delhi University",
      source_quote: "I did my BSc in Computer Science at Delhi University, it was a 3 year course",
      stated_at: "2026-08-28T09:17:00Z",
    },
    grades: {
      value: 72,
      source_quote: "I got 72% overall",
      stated_at: "2026-08-28T09:17:00Z",
    },
    english_test: {
      value: "IELTS 6.5",
      source_quote: "IELTS 6.5 overall, 6.0 in writing",
      stated_at: "2026-08-28T09:19:00Z",
    },
    budget_per_year: {
      value: 25000,
      source_quote: "my family can manage around 25000 pounds a year",
      stated_at: "2026-08-28T09:21:00Z",
    },
    intended_intake: {
      value: "2027-09",
      source_quote: "looking at September 2027",
      stated_at: "2026-08-28T09:22:00Z",
    },
  },
  "lead_002": {
    target_country: {
      value: "Canada",
      source_quote: "hi, im interested in studying in canada",
      stated_at: "2026-09-01T16:40:00Z",
    },
  },
  "lead_003": {
    target_country: {
      value: "Germany",
      source_quote: "I'm set on Germany, my brother studied in Aachen",
      stated_at: "2026-08-30T11:02:00Z",
    },
    field_of_study: {
      value: "mechanical engineering",
      source_quote: "mechanical engineering, ideally automotive",
      stated_at: "2026-08-30T11:03:00Z",
    },
    qualification: {
      value: "4-year BEng Mechanical Engineering, American University of Sharjah",
      source_quote: "I have a 4 year BEng in Mechanical Engineering from American University of Sharjah",
      stated_at: "2026-08-30T11:05:00Z",
    },
    grades: {
      value: 88,
      source_quote: "my GPA converts to about 88%",
      stated_at: "2026-08-30T11:06:00Z",
    },
    english_test: {
      value: "IELTS 7.5",
      source_quote: "IELTS 7.5, took it in June",
      stated_at: "2026-08-30T11:07:00Z",
    },
    budget_per_year: {
      value: 15000,
      source_quote: "I can cover about 15000 euros a year including living costs",
      stated_at: "2026-08-30T11:09:00Z",
    },
    intended_intake: {
      value: "2027-10",
      source_quote: "the October 2027 intake",
      stated_at: "2026-08-30T11:10:00Z",
    },
  },
  "lead_004": {
    target_country: {
      value: "Australia",
      source_quote: "Australia is my first choice",
      stated_at: "2026-08-26T03:31:00Z",
    },
    field_of_study: {
      value: "data science",
      source_quote: "I want to move into data science",
      stated_at: "2026-08-26T03:32:00Z",
    },
    qualification: {
      value: "4-year Bachelor of Engineering in Software Engineering",
      source_quote: "I have a four year Bachelor of Engineering in Software Engineering",
      stated_at: "2026-08-26T03:34:00Z",
    },
    grades: {
      value: 85,
      source_quote: "my average was 85 out of 100",
      stated_at: "2026-08-26T03:34:00Z",
    },
    english_test: {
      value: "IELTS 7.0",
      source_quote: "IELTS 7.0 overall",
      stated_at: "2026-08-26T03:36:00Z",
    },
    budget_per_year: {
      value: 50000,
      source_quote: "up to 50000 AUD per year is fine",
      stated_at: "2026-08-26T03:38:00Z",
    },
    intended_intake: {
      value: "2027-02",
      source_quote: "February 2027 if I can make the deadline",
      stated_at: "2026-08-26T03:39:00Z",
    },
  },
  "lead_005": {
    target_country: {
      value: "UK",
      source_quote: "I applied for the UK last year",
      stated_at: "2026-08-19T07:55:00Z",
    },
    field_of_study: {
      value: "business analytics",
      source_quote: "business analytics",
      stated_at: "2026-08-19T07:56:00Z",
    },
    qualification: {
      value: "3-year BCom, University of Kerala",
      source_quote: "BCom from University of Kerala, 3 years",
      stated_at: "2026-08-19T07:58:00Z",
    },
    grades: {
      value: 68,
      source_quote: "68 percent",
      stated_at: "2026-08-19T07:58:00Z",
    },
    budget_per_year: {
      value: 22000,
      source_quote: "around 22000 pounds",
      stated_at: "2026-08-19T08:01:00Z",
    },
    intended_intake: {
      value: "2027-09",
      source_quote: "September 2027",
      stated_at: "2026-08-19T08:02:00Z",
    },
  },
};
