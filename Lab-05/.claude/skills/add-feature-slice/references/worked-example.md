# One slice, end to end — and the bug it is named for

The catalogue: `features/catalogue/` plus `routes/CatalogueRoute.tsx` and
`routes/ProgrammeEditorRoute.tsx`. Read those alongside this.

## The bug, first, because it is the point

The catalogue moved to Postgres in two halves. The table was rewired to
`GET /api/programmes`; the editor was not. The table navigated with the
server row's **uuid**:

```ts
onOpen={(id) => navigate(`/catalogue/${id}`)}
```

and the editor resolved that id against the in-memory fixture store, keyed on
`p_uk_001`:

```ts
const existing = programmeId ? getProgramme(programmeId) : undefined;
const [draft, setDraft] = useState<Programme>(() => existing ?? blankProgramme());
```

The lookup always missed. `?? blankProgramme()` turned the miss into a blank
form drawn over a live programme — and saving it wrote into a session-only
overlay that a reload discarded, so nothing reached the database.

Three lessons, in order of how much they cost:

1. **A half-migrated slice is worse than an unmigrated one.** Both halves
   worked in isolation; the seam was broken and nothing pointed at it.
2. **`??` on a lookup hides a failed lookup.** A missing record is not an
   empty record. If the id should exist, a miss is an error state.
3. **Two id vocabularies in one app will meet.** The API speaks uuids, the
   fixtures and the agent speak `p_uk_001`. Anywhere they cross needs a
   deliberate translation or a deliberate wall.

## What the fix looks like

**`types.ts`** names the wire shape and says why it is not the fixture type:

> Deliberately NOT `data/types.ts`'s `Programme` … a shortlist entry names
> `p_uk_001`, this names a uuid. One type stretched across both would be a
> type that is half true everywhere.

**`api.ts`** — one function per endpoint. Note the query string built from
only what is set:

```ts
if (params.search?.trim()) query.set("search", params.search.trim());
```

**`keys.ts`** — a factory with a `detail(id)` alongside `list(params)`, so a
write can invalidate `lists()` without knowing the filters any open table
happens to be using.

**`queries.ts`** — `useProgrammeDetail` with `staleTime: 0`, because a form
opened over a cached row would quietly edit a fee somebody else has since
corrected, and PATCH would write it back. The save hook sequences three
calls, because a new programme has no id until POST answers:

```ts
let detail = id ? await patchProgramme(id, fields) : await createProgramme(fields);
detail = await putIntakes(detail.id, intakes);
detail = await putRequirements(detail.id, requirements);
```

**The route** splits in two: a loader that owns pending/error, and a form
that owns the draft.

```tsx
<ProgrammeForm key={detail.data?.id ?? "new"} existing={...} />
```

`key` remounts the form when a different programme is opened, so the draft is
seeded from the row that was actually fetched. An effect syncing state to
props would edit the previous programme for one render.

## Three conversions that live in the slice

- **Money.** Stored minor, edited plain: `minorUnitsToInput(2450000, "GBP")`
  → `"24500.00"`, sent back as the string the person typed. `formatMinorUnits`
  is for display only — a `£24,500` in an editable box is refused as
  unparseable or, worse, read as a different number.
- **Country.** The picker's values are ISO codes, its labels are names. The
  server runs `normalise_country` and refuses `"United Kingdom"`. A stored
  code the list lacks stays selectable, so editing a fee does not silently
  blank a country nobody touched.
- **PATCH.** Diff the draft against what was loaded, send only what moved,
  and keep the fee and its currency together in both directions.

## Honesty about what is not stored

The editor has a Source URL box and there is no `source_url` column — it
lands as its own table in migration 006. The box says so:

> Not stored yet. Sources land as their own table in 006, one per figure.

A field that looks like it saves and does not is worse than one that admits
it. This is the frontend reading of "prefer failing loudly".

## The shape to copy

```
features/<x>/types.ts    the wire shape, named for the wire
           /api.ts       one function per endpoint, no caching
           /keys.ts      factory with lists() and detail(id)
           /queries.ts   staleTime per use · invalidate lists() after writes
           /display.ts   shared row → label logic
routes/<X>Route.tsx      loader owns pending/error · form owns the draft ·
                         remount by key, never sync by effect
e2e/<x>.spec.ts          the path a person takes, plus a failure
```
