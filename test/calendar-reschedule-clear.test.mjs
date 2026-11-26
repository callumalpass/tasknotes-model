import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCalendarEntries, planCalendarEdit } from "../dist/esm/calendar.js";
import { DEFAULT_FIELD_MAPPING } from "../dist/esm/defaults.js";

const RANGE = { start: "2026-11-01", end: "2026-12-06" };
const TIMEZONE = "UTC";
const NOW = "2026-11-20T12:00:00Z";

function weeklyTask(overrides = {}) {
	return {
		id: "weekly",
		path: "Tasks/Weekly review.md",
		title: "Weekly review",
		status: "open",
		priority: "normal",
		archived: false,
		scheduled: "2026-11-22",
		recurrence: "DTSTART:20261101;FREQ=WEEKLY",
		complete_instances: ["2026-11-08", "2026-11-15"],
		skipped_instances: ["2026-11-29"],
		...overrides,
	};
}

function moveNext(task, start, allDay = !start.includes("T")) {
	const entry = buildCalendarEntries({
		tasks: [task],
		range: RANGE,
		timezone: TIMEZONE,
		now: NOW,
	}).find((candidate) => candidate.recurringKind === "next-scheduled");
	assert.ok(entry, "expected a next-scheduled calendar entry");
	return planCalendarEdit({
		task,
		entry,
		change: { kind: "drop", start, allDay },
		timezone: TIMEZONE,
		now: NOW,
		fieldMapping: DEFAULT_FIELD_MAPPING,
	});
}

test("scheduled-anchored native moves keep completed and skipped history on every other day (#2691)", () => {
	const task = weeklyTask();

	// Moving 22 Nov to Saturday 21 Nov keeps the skip on 29 Nov.
	const toSat = moveNext(task, "2026-11-21");
	assert.equal(toSat.updates.scheduled, "2026-11-21");
	assert.equal(toSat.updates.recurrence_original_date, "2026-11-22");
	assert.equal(toSat.updates.complete_instances, undefined);
	assert.equal(toSat.updates.skipped_instances, undefined);
	assert.deepEqual(toSat.clearedInstances, { complete: [], skipped: [] });

	// Moving 22 Nov back onto completed 15 Nov keeps 15 Nov completed and 29 Nov skipped.
	const toCompleted = moveNext(task, "2026-11-15");
	assert.equal(toCompleted.updates.scheduled, "2026-11-15");
	assert.equal(toCompleted.updates.recurrence_original_date, "2026-11-22");
	assert.equal(toCompleted.updates.complete_instances, undefined);
	assert.equal(toCompleted.updates.skipped_instances, undefined);
	assert.deepEqual(toCompleted.clearedInstances, { complete: [], skipped: [] });

	// Moving 22 Nov onto skipped 29 Nov keeps both 15 Nov and 29 Nov.
	const toSkipped = moveNext(task, "2026-11-29");
	assert.equal(toSkipped.updates.scheduled, "2026-11-29");
	assert.equal(toSkipped.updates.recurrence_original_date, "2026-11-22");
	assert.equal(toSkipped.updates.complete_instances, undefined);
	assert.equal(toSkipped.updates.skipped_instances, undefined);
	assert.deepEqual(toSkipped.clearedInstances, { complete: [], skipped: [] });
});

test("already-moved scheduled-anchored occurrence preserves history on subsequent moves and return home", () => {
	const moved = weeklyTask({
		scheduled: "2026-11-21",
		recurrence_original_date: "2026-11-22",
	});

	const ontoCompleted = moveNext(moved, "2026-11-15");
	assert.equal(ontoCompleted.updates.recurrence_original_date, "2026-11-22");
	assert.deepEqual(ontoCompleted.clearedInstances, { complete: [], skipped: [] });
	assert.equal(ontoCompleted.updates.complete_instances, undefined);
	assert.equal(ontoCompleted.updates.skipped_instances, undefined);

	// Returning an exhausted moved occurrence back to its own original date does not clear it.
	const exhaustedMoved = weeklyTask({
		scheduled: "2026-11-21",
		recurrence: "DTSTART:20261115;FREQ=WEEKLY;COUNT=2",
		recurrence_original_date: "2026-11-22",
		complete_instances: ["2026-11-15", "2026-11-22"],
		skipped_instances: [],
	});
	const returnedHome = moveNext(exhaustedMoved, "2026-11-22");
	assert.equal(returnedHome.updates.scheduled, "2026-11-22");
	assert.equal(returnedHome.updates.recurrence_original_date, undefined);
	assert.deepEqual(returnedHome.clearedInstances, { complete: [], skipped: [] });
	assert.equal(returnedHome.updates.complete_instances, undefined);
});

test("scheduled-anchored Google-synced task clears only a recorded landing day", () => {
	const synced = weeklyTask({ googleCalendarEventId: "gcal-evt-1" });

	// Moving onto an unrecorded day leaves later skipped history intact.
	const toUnrecorded = moveNext(synced, "2026-11-21");
	assert.equal(toUnrecorded.updates.recurrence_original_date, undefined);
	assert.deepEqual(toUnrecorded.clearedInstances, { complete: [], skipped: [] });
	assert.equal(toUnrecorded.updates.complete_instances, undefined);
	assert.equal(toUnrecorded.updates.skipped_instances, undefined);

	// Moving onto a completed day (including timed drop) clears only that day, keeping earlier & later dates.
	const toCompleted = moveNext(synced, "2026-11-15T14:30", false);
	assert.equal(toCompleted.updates.recurrence_original_date, undefined);
	assert.deepEqual(toCompleted.clearedInstances, { complete: ["2026-11-15"], skipped: [] });
	assert.deepEqual(toCompleted.updates.complete_instances, ["2026-11-08"]);
	assert.deepEqual(toCompleted.updates.skipped_instances, ["2026-11-29"]);

	// Moving onto a skipped day clears only that day, keeping earlier completions.
	const toSkipped = moveNext(synced, "2026-11-29");
	assert.deepEqual(toSkipped.clearedInstances, { complete: [], skipped: ["2026-11-29"] });
	assert.deepEqual(toSkipped.updates.complete_instances, ["2026-11-08", "2026-11-15"]);
	assert.deepEqual(toSkipped.updates.skipped_instances, []);
});

test("scheduled-anchored legacy off-pattern note without marker clears only a recorded landing day", () => {
	const legacyOffPattern = weeklyTask({ scheduled: "2026-11-19" });

	const toUnrecorded = moveNext(legacyOffPattern, "2026-11-21");
	assert.equal(toUnrecorded.updates.recurrence_original_date, undefined);
	assert.deepEqual(toUnrecorded.clearedInstances, { complete: [], skipped: [] });
	assert.equal(toUnrecorded.updates.complete_instances, undefined);
	assert.equal(toUnrecorded.updates.skipped_instances, undefined);

	const toCompleted = moveNext(legacyOffPattern, "2026-11-15");
	assert.equal(toCompleted.updates.recurrence_original_date, undefined);
	assert.deepEqual(toCompleted.clearedInstances, { complete: ["2026-11-15"], skipped: [] });
	assert.deepEqual(toCompleted.updates.complete_instances, ["2026-11-08"]);
	assert.deepEqual(toCompleted.updates.skipped_instances, ["2026-11-29"]);

	const toSkipped = moveNext(legacyOffPattern, "2026-11-29");
	assert.deepEqual(toSkipped.clearedInstances, { complete: [], skipped: ["2026-11-29"] });
	assert.deepEqual(toSkipped.updates.complete_instances, ["2026-11-08", "2026-11-15"]);
	assert.deepEqual(toSkipped.updates.skipped_instances, []);
});

test("completion-anchored recurring tasks keep clearing recorded instances on or after the new date", () => {
	const completionAnchored = weeklyTask({ recurrence_anchor: "completion" });

	const toSat = moveNext(completionAnchored, "2026-11-21");
	assert.deepEqual(toSat.clearedInstances, { complete: [], skipped: ["2026-11-29"] });
	assert.deepEqual(toSat.updates.complete_instances, ["2026-11-08", "2026-11-15"]);
	assert.deepEqual(toSat.updates.skipped_instances, []);

	const toEarlier = moveNext(completionAnchored, "2026-11-15");
	assert.deepEqual(toEarlier.clearedInstances, {
		complete: ["2026-11-15"],
		skipped: ["2026-11-29"],
	});
	assert.deepEqual(toEarlier.updates.complete_instances, ["2026-11-08"]);
	assert.deepEqual(toEarlier.updates.skipped_instances, []);

	// Time-only change on the same calendar day clears nothing.
	const timed = weeklyTask({
		recurrence_anchor: "completion",
		scheduled: "2026-11-22T09:00",
	});
	const retimed = moveNext(timed, "2026-11-22T14:00", false);
	assert.deepEqual(retimed.clearedInstances, { complete: [], skipped: [] });
	assert.equal(retimed.updates.complete_instances, undefined);
	assert.equal(retimed.updates.skipped_instances, undefined);
});
