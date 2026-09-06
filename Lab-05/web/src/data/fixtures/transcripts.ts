/** Conversation transcripts for the seed leads.
 *
 * `mocks/data/northbound/messages.json` is empty until a conversation
 * actually runs, and there is no `GET /api/messages` to read it back, so the
 * dashboard has no live source for a seed lead's history.
 *
 * The resolution, per surface:
 *   - a lead this browser session talked to → the real messages, from the
 *     widget's own store (data/session.ts)
 *   - a seed lead → these fixtures
 * The Transcript tab labels which it is showing. It never presents a fixture
 * as a recorded conversation.
 *
 * Each exchange below is written against that lead's actual facts and
 * `source_quote` values in `leads.json`, so the quote a counsellor sees on
 * the Profile tab is the sentence they read here.
 */
import type { Message } from "../types";

function m(
  lead_id: string,
  role: Message["role"],
  timestamp: string,
  content: string,
): Message {
  return { lead_id, role, timestamp, content };
}

export const TRANSCRIPTS: Record<string, Message[]> = {
  lead_001: [
    m("lead_001", "student", "2026-08-28T09:14:00Z", "I want to do my masters in the UK"),
    m(
      "lead_001",
      "agent",
      "2026-08-28T09:14:30Z",
      "Good evening. I'm Northbound's assistant — I'm an AI, and I can start your assessment now rather than waiting for office hours. What field are you looking at?",
    ),
    m("lead_001", "student", "2026-08-28T09:15:00Z", "something in data science or analytics"),
    m(
      "lead_001",
      "agent",
      "2026-08-28T09:16:00Z",
      "Noted: United Kingdom, data science, postgraduate. What did you study, and where?",
    ),
    m(
      "lead_001",
      "student",
      "2026-08-28T09:17:00Z",
      "I did my BSc in Computer Science at Delhi University, it was a 3 year course",
    ),
    m(
      "lead_001",
      "agent",
      "2026-08-28T09:18:00Z",
      "Thank you — I've recorded that as a three-year BSc. Some UK programmes set a four-year minimum, and I'll show you exactly where that matters rather than filtering them out quietly.",
    ),
    m(
      "lead_001",
      "agent",
      "2026-08-28T09:24:00Z",
      "Camden Met's rule is a four-year bachelor's degree. Yours is three years, so I can't settle that one from what's on file — an official transcript showing your credit hours would resolve it either way. I'm holding it as unresolved rather than guessing in either direction.",
    ),
  ],
  lead_002: [
    m("lead_002", "student", "2026-08-29T18:02:00Z", "thinking about Canada"),
    m(
      "lead_002",
      "agent",
      "2026-08-29T18:02:20Z",
      "Canada — recorded. That's the only thing I know so far, and I'd rather ask than assume the rest. What would you like to study, and at what level?",
    ),
  ],
  lead_003: [
    m(
      "lead_003",
      "student",
      "2026-08-27T20:41:00Z",
      "I'm looking at mechanical engineering masters in Germany",
    ),
    m(
      "lead_003",
      "agent",
      "2026-08-27T20:41:40Z",
      "Germany, mechanical engineering, postgraduate — noted. What's your budget for tuition per year?",
    ),
    m(
      "lead_003",
      "agent",
      "2026-08-27T20:58:00Z",
      "No counsellor at Northbound currently owns Germany, so I'm placing you in the unassigned queue rather than handing you to someone who doesn't cover it. A manager picks these up directly.",
    ),
  ],
  lead_004: [
    m(
      "lead_004",
      "student",
      "2026-08-30T02:11:00Z",
      "data science in Australia, starting Feb 2027",
    ),
    m(
      "lead_004",
      "agent",
      "2026-08-30T02:11:30Z",
      "Australia, data science, February 2027 intake. Your IELTS 7.0 and four-year engineering degree clear every entry rule I have on file for that country.",
    ),
  ],
  lead_005: [
    m(
      "lead_005",
      "student",
      "2026-08-26T15:30:00Z",
      "business analytics in the UK for September 2027",
    ),
    m(
      "lead_005",
      "agent",
      "2026-08-26T15:31:00Z",
      "Recorded. Before I go further — have you ever been refused a visa for any country?",
    ),
    m(
      "lead_005",
      "student",
      "2026-08-26T15:33:00Z",
      "yes, the UK refused my student visa in 2023. does that ruin my chances?",
    ),
    m(
      "lead_005",
      "agent",
      "2026-08-26T15:33:20Z",
      "Thank you for telling me. I'm not going to ask for the details or offer a view on how it affects your application — that's a counsellor's conversation and it matters that it's handled properly. Priya Raman covers the UK and I've passed this to her.",
    ),
  ],
};

export function transcriptFor(leadId: string): Message[] {
  return TRANSCRIPTS[leadId] ?? [];
}
