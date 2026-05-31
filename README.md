# @tasknotes/model

Portable TaskNotes model semantics for JavaScript and TypeScript consumers. This package is the shared, host-independent implementation of the TaskNotes data model.

It intentionally contains no Obsidian API usage, no vault IO, no process exits, and no UI code. Hosts such as the Obsidian plugin, `mdbase-tasknotes`, companion plugins, or automation tools should use this package for deterministic TaskNotes behavior, then perform their own persistence and presentation.

## Responsibilities

`@tasknotes/model` owns:

- TaskNotes task, config, field mapping, status, priority, recurrence, and time-entry types
- default model configuration
- TaskNotes frontmatter mapping and normalization
- date parsing, date comparison, and storage-date semantics
- recurrence evaluation and schedule advancement
- materialized occurrence identity, creation, completion, skip, and parent reconciliation plans
- time tracking entry planning and duration calculation
- validation helpers
- host-independent operation plans for common task mutations
- spec-normalized adapter helpers for CLI and mdbase-style consumers
- tasknotes-spec conformance operation helpers

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
| `@tasknotes/model/mapping` | TaskNotes frontmatter mapping, dependency mapping, and value normalization |
| `@tasknotes/model/schema` | Zod schemas for model validation |
| `@tasknotes/model/recurrence` | Recurrence evaluation, DTSTART handling, and schedule recalculation |
| `@tasknotes/model/time` | Time-entry sanitizing, timer plans, and duration totals |
| `@tasknotes/model/validation` | Task and time-entry validation |
| `@tasknotes/model/operations` | Host-independent task mutation planning, including materialized occurrence plans |
| `@tasknotes/model/frontmatter` | Markdown task document parse/serialize helpers |
| `@tasknotes/model/conformance` | tasknotes-spec conformance operation dispatcher |

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
	},
	targetDate: "2026-06-01",
	currentTimestamp: "2026-05-31T12:00:00Z",
});

// Host creates materialized.occurrenceTask if materialized.created is true.

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

The Obsidian plugin uses this package through its service layer and keeps runtime-only behavior, such as Obsidian vault writes, metadata-cache link resolution, notices, and plugin-specific clock hooks, outside the model package.
