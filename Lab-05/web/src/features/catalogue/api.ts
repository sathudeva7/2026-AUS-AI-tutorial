/** The catalogue endpoints.
 *
 * Thin on purpose, like `features/users/api.ts`: one function per endpoint,
 * no caching or retry logic. That belongs in `queries.ts`.
 */
import { get, getWithMeta, patch, post, put } from "@/api/client";

import type { Extraction } from "./extraction";

import type {
  IntakeRow,
  ProgrammeCounts,
  ProgrammeDetail,
  ProgrammeListParams,
  ProgrammeListResult,
  ProgrammeRow,
  ProgrammeWrite,
  RequirementRow,
} from "./types";

interface ListMeta {
  total: number;
  counts: ProgrammeCounts;
  countries: string[];
  stale_after_days: number;
}

/** `GET /api/programmes` — one page of the catalogue.
 *
 * Filtering and paging happen on the server. They used to happen here, over
 * the whole fixture held in memory, which stops being possible the moment the
 * catalogue is a table somebody else is also writing to.
 *
 * `limit` is bounded at 100 by the backend and REFUSED above that rather than
 * clamped, so asking for 5000 is an error rather than a wrong answer.
 */
export async function listProgrammes(
  params: ProgrammeListParams = {},
): Promise<ProgrammeListResult> {
  const query = new URLSearchParams();
  // Only what was actually set: an empty `search=` or `country=` would be a
  // filter the server has to decide how to ignore.
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.country) query.set("country", params.country);
  if (params.status) query.set("status", params.status);
  query.set("limit", String(params.limit ?? 25));
  query.set("offset", String(params.offset ?? 0));

  const { data, meta } = await getWithMeta<ProgrammeRow[]>(
    `/api/programmes?${query}`,
  );
  const m = meta as unknown as ListMeta;

  return {
    rows: data,
    total: m.total,
    counts: m.counts,
    countries: m.countries,
    staleAfterDays: m.stale_after_days,
  };
}

/** `POST /api/programmes/{id}/archive` — out of the table, still in the
 *  database.
 *
 * There is no DELETE. Past `tool_calls` name this id and the dashboard
 * rebuilds shortlists from them, so removing the row would turn a completed
 * shortlist into a dangling reference nobody can explain.
 */
export async function archiveProgramme(id: string): Promise<ProgrammeRow> {
  return post<ProgrammeRow>(`/api/programmes/${id}/archive`);
}

/** `POST /api/programmes/{id}/duplicate` — a copy, as a new DRAFT.
 *
 * Unverified, and the server decides that rather than the client asking for
 * it: an agency adding five courses at one university copies the first four
 * times, and a copy inheriting the original's verification would put four
 * unchecked entries in front of students on somebody else's date.
 */
export async function duplicateProgramme(id: string): Promise<ProgrammeRow> {
  return post<ProgrammeRow>(`/api/programmes/${id}/duplicate`);
}

/** `GET /api/programmes/{id}` — one programme with its intakes and rules.
 *
 * The editor's source of truth. It used to read the in-memory fixture, which
 * is keyed on `p_uk_001` while the table now lists database uuids — so every
 * lookup missed and the form opened blank over a row that exists.
 */
export async function getProgramme(id: string): Promise<ProgrammeDetail> {
  return get<ProgrammeDetail>(`/api/programmes/${id}`);
}

/** `POST /api/programmes` — always a draft, never visible to students yet. */
export async function createProgramme(
  body: ProgrammeWrite,
): Promise<ProgrammeDetail> {
  return post<ProgrammeDetail>("/api/programmes", body);
}

/** `PATCH /api/programmes/{id}` — only the fields that changed.
 *
 * Only what the editor actually touched, so two counsellors with the same
 * programme open do not overwrite each other's untouched columns.
 */
export async function patchProgramme(
  id: string,
  body: ProgrammeWrite,
): Promise<ProgrammeDetail> {
  return patch<ProgrammeDetail>(`/api/programmes/${id}`, body);
}

/** `PUT /api/programmes/{id}/intakes` — the complete set, not a diff. */
export async function putIntakes(
  id: string,
  intakes: IntakeRow[],
): Promise<ProgrammeDetail> {
  return put<ProgrammeDetail>(`/api/programmes/${id}/intakes`, intakes);
}

/** `PUT /api/programmes/{id}/requirements` — the complete set, in order.
 *
 * Order is content: requirements are read as a list by a student, and "and
 * finally, IELTS 6.5" is not the same list reshuffled by primary key.
 */
export async function putRequirements(
  id: string,
  requirements: RequirementRow[],
): Promise<ProgrammeDetail> {
  return put<ProgrammeDetail>(
    `/api/programmes/${id}/requirements`,
    requirements.map(({ fact_key, rule, description, mandatory }) => ({
      fact_key,
      rule,
      description,
      mandatory,
    })),
  );
}

/** `POST /api/programmes/{id}/verify` — put your name on it, and let students
 *  see it. A different permission from editing, deliberately. */
export async function verifyProgramme(id: string): Promise<ProgrammeDetail> {
  return post<ProgrammeDetail>(`/api/programmes/${id}/verify`);
}

/** `POST /api/programmes/read` — a course page, read into form fields.
 *
 * Writes nothing. It is a POST because the url goes in a body rather than a
 * query string, and it costs money each time — two paid calls on the server,
 * a fetch and a reading — so it is never a query the cache may repeat on its
 * own. The caller drives it as a mutation.
 */
export async function readProgrammePage(url: string): Promise<Extraction> {
  return post<Extraction>("/api/programmes/read", { url });
}
