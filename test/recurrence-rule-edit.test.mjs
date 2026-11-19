import assert from "node:assert/strict";
import test from "node:test";
import {
	buildRecurringTaskCompletePlan,
	buildTaskUpdatePlan,
	DEFAULT_FIELD_MAPPING,
} from "../dist/esm/index.js";

process.env.TZ = "Australia/Melbourne";

const rule = (count) => `DTSTART:20261121T150000;FREQ=WEEKLY;INTERVAL=2;BYDAY=SA;COUNT=${count}`;
const task = {
	path: "Tasks/Fortnightly.md",
	title: "Fortnightly",
	status: "open",
	priority: "normal",
	archived: false,
	scheduled: "2026-11-21T15:00",
	recurrence: rule(10),
	recurrence_anchor: "completion",
	complete_instances: [],
	skipped_instances: [],
};

for (const due of [undefined, "2026-11-21T17:00"]) {
	for (const [edit, updates] of [
		["count", { recurrence: rule(3) }],
		["note policy", { occurrence_materialization: "rolling" }],
	]) {
		test(`editing ${edit} keeps the open occurrence ${due ? "with" : "without"} due`, (context) => {
			context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-21T14:59:00+11:00") });
			const { updatedTask } = buildTaskUpdatePlan({
				originalTask: due ? { ...task, due } : task,
				updates,
				fieldMapping: DEFAULT_FIELD_MAPPING,
			});
			assert.equal(updatedTask.recurrence, updates.recurrence ?? task.recurrence);
			assert.equal(updatedTask.occurrence_materialization, updates.occurrence_materialization);
			assert.equal(updatedTask.scheduled, task.scheduled);
			assert.equal(updatedTask.due, due);
			assert.deepEqual(updatedTask.complete_instances, []);
			assert.deepEqual(updatedTask.skipped_instances, []);
		});
	}
}

test("completing the open occurrence advances the edited series", (context) => {
	context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-21T15:01:00+11:00") });
	const { updatedTask } = buildRecurringTaskCompletePlan({
		freshTask: { ...task, due: "2026-11-21T17:00", recurrence: rule(3) },
		currentTimestamp: new Date().toISOString(),
		maintainDueDateOffsetInRecurring: true,
	});
	assert.deepEqual(updatedTask.complete_instances, ["2026-11-21"]);
	assert.equal(updatedTask.scheduled, "2026-12-05T15:00");
	assert.equal(updatedTask.due, "2026-12-05T17:00");
});
