/** Reading the catalogue.
 *
 * TWO sources, on purpose, and only one of them is temporary.
 *
 * `useProgrammeList` is the console: `GET /api/programmes`, tenant-scoped,
 * paged and filtered by the server.
 *
 * `useProgrammes` is still the fixture. The coverage banner on the counsellor
 * roster reads it to work out which destinations nobody owns, and the student
 * widget resolves shortlist entries through the same fixture — where the
 * agent's `p_uk_001` means something and a uuid does not. Moving those is its
 * own step, after the agent reads Postgres.
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { repo } from "@/data/repo";

import {
  archiveProgramme,
  createProgramme,
  duplicateProgramme,
  getProgramme,
  listProgrammes,
  patchProgramme,
  putIntakes,
  readProgrammePage,
  putRequirements,
  verifyProgramme,
} from "./api";
import { catalogueKeys } from "./keys";
import type {
  IntakeRow,
  ProgrammeDetail,
  ProgrammeListParams,
  ProgrammeWrite,
  RequirementRow,
} from "./types";

/** One page of the catalogue, for the console. */
export function useProgrammeList(params: ProgrammeListParams) {
  return useQuery({
    queryKey: catalogueKeys.list(params),
    queryFn: () => listProgrammes(params),
    // Keep the previous page on screen while the next one loads. Without it
    // every keystroke in the search box empties the table and collapses the
    // layout, which reads as "no results" for as long as the request takes.
    placeholderData: keepPreviousData,
  });
}

/** The whole fixture catalogue. Not the console's — see the note above. */
export function useProgrammes() {
  return useQuery({
    queryKey: catalogueKeys.fixture(),
    queryFn: () => repo.listProgrammes(),
    // The catalogue changes when somebody edits it, not between two clicks on
    // the roster.
    staleTime: 5 * 60_000,
  });
}

/** Archive a programme, and refresh every list that might show it.
 *
 * `lists()` rather than the exact key: the table is keyed on its filters, and
 * a row archived under one set of filters has left every other set too.
 */
export function useArchiveProgramme() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveProgramme(id),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: catalogueKeys.lists() }),
  });
}

export function useDuplicateProgramme() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => duplicateProgramme(id),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: catalogueKeys.lists() }),
  });
}

/** One programme with its intakes and requirements, for the editor.
 *
 * `enabled` rather than a conditional hook: /catalogue/new mounts the same
 * route with no id, and hooks cannot be called conditionally.
 */
export function useProgrammeDetail(id: string | undefined) {
  return useQuery({
    queryKey: catalogueKeys.detail(id ?? "new"),
    queryFn: () => getProgramme(id as string),
    enabled: Boolean(id),
    // A form opened over a cached row would quietly edit a fee somebody else
    // has since corrected, and PATCH would write it back.
    staleTime: 0,
  });
}

export interface ProgrammeSave {
  /** Absent for a new programme. */
  id?: string;
  fields: ProgrammeWrite;
  intakes: IntakeRow[];
  requirements: RequirementRow[];
}

/** Save the editor: the row, then its intakes, then its requirements.
 *
 * Three requests because they are three endpoints — intakes and requirements
 * are PUT-the-whole-set, which is what lets a removed intake actually
 * disappear rather than needing a diff the client would have to compute.
 *
 * Sequential, not parallel: a new programme has no id until POST answers,
 * and the last response is the complete row the caches are then filled with.
 */
export function useSaveProgramme() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      fields,
      intakes,
      requirements,
    }: ProgrammeSave): Promise<ProgrammeDetail> => {
      let detail = id
        ? await patchProgramme(id, fields)
        : await createProgramme(fields);
      detail = await putIntakes(detail.id, intakes);
      detail = await putRequirements(detail.id, requirements);
      return detail;
    },
    onSuccess: (detail) => {
      client.setQueryData(catalogueKeys.detail(detail.id), detail);
      void client.invalidateQueries({ queryKey: catalogueKeys.lists() });
    },
  });
}

/** Verify a programme — a separate permission, so a separate call. */
export function useVerifyProgramme() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => verifyProgramme(id),
    onSuccess: (detail) => {
      client.setQueryData(catalogueKeys.detail(detail.id), detail);
      void client.invalidateQueries({ queryKey: catalogueKeys.lists() });
    },
  });
}

/** Read a course page into form fields.
 *
 * A mutation, though it writes nothing. Two reasons, and the second is the
 * one that matters: it spends money on every call, so it must never be a
 * query that the cache can refetch on a remount, a window focus or a
 * reconnect. Nothing is invalidated afterwards — no row changed, and the
 * result goes into the editor's own state for a person to confirm.
 */
export function useReadProgrammePage() {
  return useMutation({
    mutationFn: (url: string) => readProgrammePage(url),
  });
}
