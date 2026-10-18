import assert from "node:assert/strict";
import test from "node:test";
import { updateToNextScheduledOccurrence } from "../dist/esm/recurrence.js";

test("advances due offset for recurring tasks with timed scheduled and due dates", () => {
	const result = updateToNextScheduledOccurrence(
		{
			title: "Timed daily task",
			recurrence: "DTSTART:20260604T103000;FREQ=DAILY",
			scheduled: "2026-06-04T10:30",
			due: "2026-06-05T10:30",
			complete_instances: ["2026-06-04"],
			skipped_instances: [],
		},
		true,
		{ today: "2026-06-05" }
	);

	assert.deepEqual(result, {
		scheduled: "2026-06-05T10:30",
		due: "2026-06-06T10:30",
	});
});

test("advances date-only due offset for recurring tasks with timed scheduled dates", () => {
	const result = updateToNextScheduledOccurrence(
		{
			title: "Timed daily task with date-only due date",
			recurrence: "DTSTART:20260604T103000;FREQ=DAILY",
			scheduled: "2026-06-04T10:30",
			due: "2026-06-05",
			complete_instances: ["2026-06-04"],
			skipped_instances: [],
		},
		true,
		{ today: "2026-06-05" }
	);

	assert.deepEqual(result, {
		scheduled: "2026-06-05T10:30",
		due: "2026-06-06",
	});
});

test("adds DTSTART for a minute-precision scheduled time (tasknotes#2328)", async () => {
	const { addDTSTARTToRecurrenceRule, updateDTSTARTInRecurrenceRule } = await import(
		"../dist/esm/recurrence.js"
	);
	const withSeconds = addDTSTARTToRecurrenceRule({
		recurrence: "FREQ=DAILY",
		scheduled: "2026-06-04T10:30:00",
	});
	assert.equal(
		addDTSTARTToRecurrenceRule({ recurrence: "FREQ=DAILY", scheduled: "2026-06-04T10:30" }),
		withSeconds
	);
	assert.equal(updateDTSTARTInRecurrenceRule("FREQ=DAILY", "2026-06-04T10:30"), withSeconds);
	assert.match(withSeconds, /^DTSTART:20260604T103000Z;FREQ=DAILY$/);
});

test("completing a materialized occurrence of a timed parent advances it (tasknotes#2328)", async () => {
	const { buildMaterializedOccurrenceCompletePlan } = await import("../dist/esm/operations.js");
	const plan = buildMaterializedOccurrenceCompletePlan({
		occurrenceTask: {
			path: "Tasks/Standup 2026-06-04.md",
			title: "Standup",
			status: "open",
			recurrence_parent: "[[Tasks/Standup]]",
			occurrence_date: "2026-06-04",
			scheduled: "2026-06-04T10:30",
		},
		parentTask: {
			path: "Tasks/Standup.md",
			title: "Standup",
			status: "open",
			recurrence: "FREQ=DAILY",
			scheduled: "2026-06-04T10:30",
			complete_instances: [],
			skipped_instances: [],
		},
		completedStatus: "done",
		currentTimestamp: "2026-06-04T11:00:00.000Z",
		completionDate: "2026-06-04",
		maintainDueDateOffsetInRecurring: true,
	});
	assert.deepEqual(plan.parentUpdates.complete_instances, ["2026-06-04"]);
	assert.equal(plan.parentUpdates.scheduled, "2026-06-05T10:30");
});
