# @tasknotes/model

Portable TaskNotes model semantics for JavaScript and TypeScript consumers. This package is the shared, host-independent implementation of the TaskNotes data model.

It intentionally contains no Obsidian API usage, no vault IO, no process exits, and no UI code. Hosts such as the Obsidian plugin, `mdbase-tasknotes`, companion plugins, or automation tools should use this package for deterministic TaskNotes behavior, then perform their own persistence and presentation.

## Responsibilities

`@tasknotes/model` owns:

- TaskNotes task, config, field mapping, status, priority, recurrence, and time-entry types
- default model configuration
- TaskNotes frontmatter mapping and normalization
- portable person-ID assignments, including custom field mappings, explicit
  clearing, unresolved-reference preservation, and occurrence inheritance
- attachment-list normalization, safe collection-path resolution, canonical
  references, and validation
- date parsing, date comparison, and storage-date semantics
- recurrence evaluation and schedule advancement
- materialized occurrence identity, creation, completion, skip, and parent reconciliation plans
- time tracking entry planning and duration calculation
- calendar entry projection, calendar edit plans, and incremental range caching
- validation helpers
- host-independent operation plans for common task mutations
- spec-normalized adapter helpers for CLI and mdbase-style consumers
- tasknotes-spec conformance operation helpers
- canonical mdbase record and event contract artifacts

Hosts own:

- file, vault, database, or network IO
- Obsidian app APIs and metadata cache reads
- command registration and UI state
- notifications, logging, process exits, and error presentation
- sync provider lifecycles
- path resolution against host-specific collection or vault rules

## Module Map

The package exports both the root module and focused subpath modules:

| Module | Purpose |
| --- | --- |
| `@tasknotes/model` | Main barrel export for all public APIs |
| `@tasknotes/model/types` | Shared TaskNotes model and operation types |
| `@tasknotes/model/defaults` | Default field mapping, statuses, priorities, and model config |
| `@tasknotes/model/config` | Model config resolution and tasknotes-spec field mapping helpers |
| `@tasknotes/model/date` | Date parsing, validation, comparison, and storage formatting |
| `@tasknotes/model/attachments` | Canonical attachment references plus safe collection-path normalization and validation |
| `@tasknotes/model/mapping` | TaskNotes frontmatter mapping, dependency mapping, and value normalization |
| `@tasknotes/model/schema` | Zod schemas for model validation |
| `@tasknotes/model/recurrence` | Recurrence evaluation, DTSTART handling, and schedule recalculation |
| `@tasknotes/model/time` | Time-entry sanitizing, timer plans, and duration totals |
| `@tasknotes/model/calendar` | Neutral calendar entries, explicit-zone dates, calendar edit plans, and incremental index |
| `@tasknotes/model/calendar/fixtures` | Typed shared calendar building/editing fixtures (not in the root barrel) |
| `@tasknotes/model/validation` | Task and time-entry validation |
| `@tasknotes/model/operations` | Host-independent task mutation planning, including materialized occurrence plans |
| `@tasknotes/model/frontmatter` | Markdown task document parse/serialize helpers |
| `@tasknotes/model/mdbase` | Canonical mdbase v0.3 config, contract, schema, and implementing-type generation |
| `@tasknotes/model/starter` | The published TaskNotes starter type (`tasknotes.task` pack seed), pinned to mdbase-contracts by the test suite. Use it, not the plugin defaults in `defaults`, to build starter types |
| `@tasknotes/model/conformance` | tasknotes-spec conformance operation dispatcher |

## Calendar contract

```ts
import { buildCalendarEntries, createCalendarEntryIndex, planCalendarEdit } from "@tasknotes/model/calendar";

const context = {
	timezone: "America/New_York",
	now: "2026-03-08T16:00:00Z",
	settings: { showScheduled: true, showDue: true, showRecurring: true },
};
const range = { start: "2026-03-01", end: "2026-04-01" }; // exclusive end
const entries = buildCalendarEntries({ tasks, range, ...context });
const index = createCalendarEntryIndex(context);
index.setTasks(tasks);
index.upsert(task.id || task.path, task, revision); // revision optional; defaults to dateModified
const sameEntries = index.entriesInRange(range);
const plan = planCalendarEdit({
	task, entry: entries[0],
	change: { kind: "drop", start: "2026-03-09T11:00", allDay: false },
	timezone: context.timezone, now: context.now, fieldMapping,
});
// After any confirmation: apply plan.frontmatterPatch, or persist plan.updates exactly.
// Do NOT pass through automatic recurrence-schedule recalculation.
```

- Inputs are validated task dates, an IANA timezone, and explicit `now`. Date-only and
  floating datetimes are civil values in that zone; offset values are instants.
  DST overlaps choose the earlier clock, gaps move forward. Ambiguous duration ends
  retain an ISO instant. Timed durations are elapsed minutes; all-day durations are
  nominal calendar days × 1440. Invalid dates/zones/ranges throw.
- Entries contain no task object, renderer types or colours. Join `taskId` back to
  the host task/row. Stable IDs prefer task `id`, falling back to `path`. IDs must
  uniquely identify tasks. `end` is exclusive; absent `end` uses the explicit
  `durationMinutes` renderer default (60 minutes or one day unless configured).
- Task visibility settings use the Bases names. Defaults match the plugin:
  scheduled/due/recurring/time entries and completed/skipped history on, spans and
  overdue-on-today off. Pass configured completed status values, not status IDs.
  `calendarView` plus `showAllDaySlot` covers list-specific all-day filtering.
  Layout/weekends and external/property/timeblock visibility stay with hosts.
- Scheduled→due all-day spans include the due day. Timed spans are work blocks on
  each day at the scheduled clock, **not** a single continuous timed interval.
  Due entries are 30-minute deadline markers clipped to midnight, independent of
  estimates. Only finished time entries are projected.
- Recurrence uses the model RRULE implementation with civil occurrence dates.
  Stored RFC TZID/EXDATE properties are retained; TZID is removed only from parser
  input to avoid process-zone conversion of occurrence-day anchors. The selected
  calendar zone determines display clocks. Due stays a standalone deadline rather
  than being projected on each recurrence date. Materialized children suppress
  virtual parent occurrences; supply `materializedOccurrences` for children outside
  the visible task set, keyed by resolved parent task ID.
- Native scheduled-anchor moves use `recurrence_original_date` as the pending
  occurrence's identity, while `scheduled` remains its placement. Forward both
  fields and `recurrence_anchor` in host projection adapters, alongside completion/
  skip history and Google moved-date fields. IDs, completion/skip lookup, spans and
  materialized-child suppression use the original identity; a move onto another
  rule date leaves that real occurrence distinct. Unmarked legacy off-pattern
  dates are not assigned guessed identities. Completion-anchor tasks ignore this
  marker. Recorded history remains available when its moved placement is outside
  the range.
- `FieldMapping.recurrenceOriginalDate` defaults to `recurrence_original_date`,
  including for older mappings that omit the key. Mapping accepts only real,
  strict `YYYY-MM-DD` identities. Calendar moves preserve this identity across
  repeated moves, remove it on return to its original day, and pin missing DTSTART
  to the old scheduled date/clock. A series/DTSTART clock edit clears the marker.
  This is a model extension; it does not change the pinned spec contract version.
- Edit plans mirror plugin gestures: next-occurrence drops reschedule `scheduled`;
  pattern drops change only DTSTART's clock (preserving its date); recorded drops
  change the scheduled clock without moving its date. No gesture materializes a
  note. Pattern all-day/timed changes leave `scheduled` independent. Recurring
  spans are read-only. Resizes change only the estimate, not `scheduled`/`due`,
  except time-entry resizes, which replace their range. `clearedInstances` reports
  completion/skip dates removed by a next-occurrence reschedule, for confirmation.
- Shared fixtures include `fixtures/calendar/moved-occurrences.json`. Raw JSON
  edits use `expectedUnsetProperties` to name updates whose value is `undefined`;
  the typed `calendar/fixtures` export expands these deletions automatically.
- The index caches eight ranges per task by default. Supply immutable task objects
  or call `upsert` with a changed revision after mutation. `setTasks` preserves
  cached unchanged objects and updates order/membership; `remove` and materialized
  child changes update parent suppression. `setContext` invalidates on settings,
  timezone or materialization changes; `now` changes invalidate only when overdue
  display uses it. Returned entries can be annotated without corrupting the cache.
- Shared expectations are available as `calendarFixtures` from
  `@tasknotes/model/calendar/fixtures` and raw JSON at
  `@tasknotes/model/fixtures/calendar/scenarios.json`. Every scenario includes full
  inputs and expected entries; edits include exact model updates and frontmatter
  patches. Both ESM and CJS consumers can use them without a JSON loader.

## Examples

Map TaskNotes frontmatter into normalized task data:

```ts
import { DEFAULT_FIELD_MAPPING, mapTaskFromFrontmatter } from "@tasknotes/model";

const task = mapTaskFromFrontmatter(
	DEFAULT_FIELD_MAPPING,
	{
		title: "Ship package",
		status: "open",
		priority: "normal",
		scheduled: "2026-06-01",
	},
	"Tasks/Ship package.md",
	false,
	[]
);
```

Normalize host-independent attachment membership without storing binary
metadata in frontmatter:

```ts
import {
	attachmentPathFromReference,
	canonicalAttachmentReference,
	validateAttachmentReferences,
} from "@tasknotes/model/attachments";

const reference = canonicalAttachmentReference("Attachments/receipt.jpg");
// [[Attachments/receipt.jpg]]

const path = attachmentPathFromReference(
	"[receipt](../Attachments/receipt.jpg)",
	"Tasks/Expense report.md"
);
// Attachments/receipt.jpg

const validation = validateAttachmentReferences([reference]);
// { valid: true, issues: [] }
```

Advance a recurring task without doing any host IO:

```ts
import { completeRecurringTask } from "@tasknotes/model/recurrence";

const result = completeRecurringTask({
	recurrence: "FREQ=DAILY",
	scheduled: "2026-06-01",
	completionDate: "2026-06-01",
	completeInstances: [],
	skippedInstances: [],
});

// Host decides how to persist result.updatedRecurrence,
// result.nextScheduled, result.completeInstances, and result.skippedInstances.
```

Build a spec-normalized adapter update for a CLI or mdbase-style surface:

```ts
import { buildSpecCompleteTaskUpdate } from "@tasknotes/model/operations";

const plan = buildSpecCompleteTaskUpdate({
	frontmatter: {
		title: "Daily check",
		status: "open",
		priority: "normal",
		recurrence: "FREQ=DAILY",
		scheduled: "2026-06-01",
		completeInstances: [],
		skippedInstances: [],
	},
	targetDate: "2026-06-01",
	completedStatus: "done",
	currentTimestamp: new Date().toISOString(),
});

// plan.fields is spec-normalized. A host can denormalize it to its own field names
// before writing to a file, database, or collection.
```

Materialize and reconcile a recurring occurrence:

```ts
import {
	buildMaterializeOccurrencePlan,
	buildMaterializedOccurrenceCompletePlan,
} from "@tasknotes/model/operations";

const materialized = buildMaterializeOccurrencePlan({
	parentTask: {
		title: "Weekly review",
		status: "open",
		priority: "normal",
		path: "Tasks/Weekly review.md",
		archived: false,
		recurrence: "DTSTART:20260601;FREQ=WEEKLY;BYDAY=MO",
		occurrence_materialization: "on_completion",
		scheduled: "2026-06-01T09:30:00",
		timeEstimate: 45,
	},
	targetDate: "2026-06-01",
	currentTimestamp: "2026-05-31T12:00:00Z",
	templateTask: {
		contexts: ["work"],
	},
});

// Host creates materialized.occurrenceTask if materialized.created is true.
// Occurrence tasks inherit parent planning fields such as scheduled time,
// tags/projects/contexts, reminders, details, and time estimate, but not
// parent recurrence, complete/skipped instance history, or time entries.

const complete = buildMaterializedOccurrenceCompletePlan({
	occurrenceTask: {
		...materialized.occurrenceTask,
		path: "Tasks/Weekly review 2026-06-01.md",
		archived: false,
	},
	parentTask: materialized.parentTask,
	completedStatus: "done",
	currentTimestamp: "2026-06-01T17:00:00Z",
	maintainDueDateOffsetInRecurring: true,
});

// Host applies complete.occurrenceUpdates to the occurrence note and
// complete.parentUpdates to the recurring parent. If complete.materializeNextDate
// is present, the host can call buildMaterializeOccurrencePlan again for that date.
```

Start and stop time tracking:

```ts
import {
	buildStartTimeTrackingPlan,
	buildStopTimeTrackingPlan,
	getActiveTimeEntry,
} from "@tasknotes/model/time";

const start = buildStartTimeTrackingPlan(task, "2026-06-01T09:00:00Z");
const active = getActiveTimeEntry(start.updatedTask);

if (active) {
	const stop = buildStopTimeTrackingPlan(
		start.updatedTask,
		active,
		"2026-06-01T09:30:00Z"
	);
}
```

## Development

From this package repository:

```bash
npm run build
npm test
```

The package build emits ESM, CommonJS, and TypeScript declaration output under `dist`. Release tooling should build it before packing or publishing.

The conformance adapter reports its claimed TaskNotes profile and implements
the official `core-lite` operation surface. Its fixture run currently passes
4,974 cases with zero failures; the extended-profile fixture remains outside
that claim. The mdbase generator emits the `tasknotes.task 0.3.0-rc.1` record contract,
its two JSON Schemas, and a type whose `implements` entry contains field
mappings and TaskNotes behavior. Round-trip tests resolve those resources back
into model configuration so filesystem-backed hosts can treat the type as a
configuration provider.

The Obsidian plugin uses this package through its service layer and keeps runtime-only behavior, such as Obsidian vault writes, metadata-cache link resolution, notices, and plugin-specific clock hooks, outside the model package.
