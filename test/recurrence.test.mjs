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
