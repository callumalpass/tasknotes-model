import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import {
	buildCalendarEntries,
	createCalendarEntryIndex,
	planCalendarEdit,
	calendarDateToInstant,
	calendarInstantToDate,
} from "../dist/esm/calendar.js";
import { calendarFixtures } from "../dist/esm/calendar-fixtures.js";
import { DEFAULT_FIELD_MAPPING } from "../dist/esm/defaults.js";

const byId = (entries) => [...entries].sort((a, b) => a.id.localeCompare(b.id));
const byField = (patch) => [...patch].sort((a, b) => a.field.localeCompare(b.field));
const fixture = (name) => structuredClone(calendarFixtures.find((f) => f.name === name));

for (const { name, input, expectedEntries, edits } of calendarFixtures) {
	test(`calendar fixture: ${name}`, () => {
		const before = structuredClone(input);
		assert.deepEqual(byId(buildCalendarEntries(input)), byId(expectedEntries));
		const index = createCalendarEntryIndex(input);
		index.setTasks(input.tasks);
		for (let repeat = 0; repeat < 2; repeat++) {
			assert.deepEqual(byId(index.entriesInRange(input.range)), byId(expectedEntries));
		}
		for (const edit of edits) {
			const entry = expectedEntries.find((entry) => entry.id === edit.entryId);
			assert.ok(entry);
			const task = input.tasks.find((task) => (task.id || task.path) === entry.taskId);
			const plan = planCalendarEdit({
				task,
				entry,
				change: edit.change,
				timezone: input.timezone,
				now: input.now,
				fieldMapping: DEFAULT_FIELD_MAPPING,
			});
			assert.deepEqual(plan.updates, edit.expectedUpdates);
			assert.deepEqual(byField(plan.frontmatterPatch), byField(edit.expectedFrontmatterPatch));
			assert.deepEqual(plan.clearedInstances, edit.expectedClearedInstances);
			assert.deepEqual(plan.updatedTask, { ...task, ...edit.expectedUpdates });
			assert.equal(plan.preserveRecurrenceSchedule, true);
		}
		assert.deepEqual(input, before, "building and editing leave caller data intact");
	});
}

test("incremental index tracks identities, revisions, order, child dependencies and settings", () => {
	const { input } = fixture("materialized-child-suppresses-parent");
	const index = createCalendarEntryIndex(input, 2);
	let tasks = [...input.tasks];
	let context = { ...input };
	const check = () =>
		assert.deepEqual(
			index.entriesInRange(input.range),
			buildCalendarEntries({ ...context, tasks }),
		);
	index.setTasks(tasks);
	check();
	// Add/remove a materialization invalidates the parent's recurrence result, not just the child.
	index.remove("b");
	tasks.pop();
	check();
	index.upsert("b", input.tasks[1]);
	tasks.push(input.tasks[1]);
	check();
	const renamed = { ...tasks[0], title: "Fresh title" };
	index.upsert("a", renamed);
	tasks[0] = renamed;
	check();
	// Mutable caches can supply a monotonic revision even when they reuse object identity.
	renamed.scheduled = "2026-03-08";
	index.upsert("a", renamed, 1);
	check();
	renamed.dateModified = "2026-03-08T17:00:00Z";
	renamed.timeEstimate = 60;
	index.upsert("a", renamed);
	check();
	tasks.reverse();
	index.setTasks(tasks);
	check();
	context = { ...context, settings: { showRecurring: false, showTimeEntries: false } };
	index.setContext(context);
	check();
	context = { ...context, settings: { showRecurring: true }, timezone: "Pacific/Auckland" };
	index.setContext(context);
	check();
	// Evict ranges, then revisit: output must not depend on cache history.
	index.entriesInRange({ start: "2026-01-01", end: "2026-02-01" });
	index.entriesInRange({ start: "2026-06-01", end: "2026-07-01" });
	check();
	const returned = index.entriesInRange(input.range);
	returned[0].title = "Host annotation";
	check();
	index.clear();
	assert.deepEqual(index.entriesInRange(input.range), []);
});

test("unchanged tasks are not re-expanded when another task or an unused clock changes", () => {
	const { input } = fixture("weekly-recorded-off-pattern-and-add-dtstart");
	const original = input.tasks[0];
	let recurrenceReads = 0;
	const instrumented = {
		...original,
		get recurrence() {
			recurrenceReads++;
			return original.recurrence;
		},
	};
	const index = createCalendarEntryIndex(input);
	index.setTasks([instrumented]);
	index.entriesInRange(input.range);
	const reads = recurrenceReads;
	assert.ok(reads > 0);
	index.entriesInRange(input.range);
	index.upsert("other", { path: "other", title: "Other", scheduled: "2026-03-09" });
	index.setContext({ ...input, now: "2026-03-08T17:00:00Z" });
	index.entriesInRange(input.range);
	assert.equal(recurrenceReads, reads);
	index.upsert("a", instrumented, 2);
	index.entriesInRange(input.range);
	assert.ok(recurrenceReads > reads);
});

test("explicit timezone is independent of the runtime timezone for every fixture and edit", () => {
	const script = `
		import assert from 'node:assert/strict';
		import {buildCalendarEntries, createCalendarEntryIndex, planCalendarEdit} from './dist/esm/calendar.js';
		import {calendarFixtures} from './dist/esm/calendar-fixtures.js';
		import {DEFAULT_FIELD_MAPPING} from './dist/esm/defaults.js';
		const sort = a => [...a].sort((x,y) => x.id.localeCompare(y.id));
		for (const f of calendarFixtures) {
			assert.deepEqual(sort(buildCalendarEntries(f.input)), sort(f.expectedEntries), f.name);
			const index = createCalendarEntryIndex(f.input); index.setTasks(f.input.tasks);
			assert.deepEqual(sort(index.entriesInRange(f.input.range)), sort(f.expectedEntries), f.name);
			for (const e of f.edits) {
				const entry = f.expectedEntries.find(x => x.id === e.entryId);
				const task = f.input.tasks.find(x => (x.id || x.path) === entry.taskId);
				const plan = planCalendarEdit({task, entry, change:e.change, timezone:f.input.timezone, now:f.input.now, fieldMapping:DEFAULT_FIELD_MAPPING});
				assert.deepEqual(plan.updates,e.expectedUpdates,f.name);
			}
		}`;
	for (const TZ of ["UTC", "America/Los_Angeles", "Pacific/Auckland"]) {
		execFileSync(process.execPath, ["--input-type=module", "-e", script], {
			env: { ...process.env, TZ },
			stdio: "pipe",
		});
	}
});

test("civil DST disambiguation and offset instants have explicit compatible semantics", () => {
	assert.equal(
		new Date(calendarDateToInstant("2026-03-08T02:30", "America/New_York")).toISOString(),
		"2026-03-08T07:30:00.000Z",
	);
	assert.equal(
		new Date(calendarDateToInstant("2026-11-01T01:30", "America/New_York")).toISOString(),
		"2026-11-01T05:30:00.000Z",
	);
	assert.equal(
		calendarInstantToDate(
			calendarDateToInstant("2026-03-08T15:30:00+13:00", "UTC"),
			"Pacific/Auckland",
		),
		"2026-03-08T15:30",
	);
	assert.throws(() => calendarDateToInstant("2026-02-30", "UTC"), /invalid-calendar-date/);
});

test("edit guards prevent unsupported gestures and custom field patches remain storage-neutral", () => {
	const { input, expectedEntries } = fixture("recurring-spans-readonly");
	const args = {
		task: input.tasks[0],
		entry: expectedEntries[0],
		change: { kind: "drop", start: "2026-03-08", allDay: true },
		timezone: input.timezone,
		now: input.now,
		fieldMapping: DEFAULT_FIELD_MAPPING,
	};
	assert.throws(() => planCalendarEdit(args), /readonly/);
	assert.throws(
		() =>
			planCalendarEdit({ ...args, change: { ...args.change, kind: "resize", end: "2026-03-09" } }),
		/readonly/,
	);
	const due = fixture("due-only");
	args.task = due.input.tasks[0];
	args.entry = due.expectedEntries[0];
	assert.throws(
		() =>
			planCalendarEdit({ ...args, change: { ...args.change, kind: "resize", end: "2026-03-09" } }),
		/readonly/,
	);
	const plan = planCalendarEdit({
		...args,
		fieldMapping: { ...DEFAULT_FIELD_MAPPING, due: "deadline", dateModified: "modified" },
	});
	assert.deepEqual(plan.frontmatterPatch, [
		{ op: "set", field: "deadline", value: "2026-03-08" },
		{ op: "set", field: "modified", value: input.now },
	]);
});
