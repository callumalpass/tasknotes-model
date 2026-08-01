import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_FIELD_MAPPING,
	buildMaterializeOccurrencePlan,
	buildMaterializedOccurrenceCompletePlan,
	buildMaterializedOccurrenceUncompletePlan,
	buildRecurringTaskCompletePlan,
	buildSpecCompleteTaskUpdate,
	buildSpecRecurringSkipUpdate,
	buildSpecStartTimeTrackingUpdate,
	buildSpecStopTimeTrackingUpdate,
	buildStartTimeTrackingPlan,
	calculateTotalTrackedMinutes,
	executeConformanceOperation,
	formatDateForStorage,
	getDatePart,
	mapTaskFromFrontmatter,
	mapTaskToFrontmatter,
	parseDateToUTC,
	parseTaskDocument,
	recalculateRecurringSchedule,
	serializeTaskDocument,
} from "../dist/esm/index.js";

test("maps TaskNotes frontmatter to normalized task data", () => {
	const task = mapTaskFromFrontmatter(
		DEFAULT_FIELD_MAPPING,
		{
			title: "Ship model",
			status: "Done",
			priority: "high",
			due: "2026-06-01",
			tags: ["task", "archived"],
			complete_instances: ["2026-05-30", "not-a-date"],
			recurrence_parent: "[[Tasks/Daily task]]",
			occurrence_date: "2026-06-01",
			occurrence_materialization: "on_completion",
		},
		"Tasks/Ship model.md",
		false,
		[],
		[
			{
				id: "done",
				value: "done",
				label: "Done",
				color: "#00aa00",
				isCompleted: true,
				order: 0,
				autoArchive: false,
				autoArchiveDelay: 5,
			},
		]
	);

	assert.equal(task.title, "Ship model");
	assert.equal(task.status, "done");
	assert.equal(task.archived, true);
	assert.deepEqual(task.complete_instances, ["2026-05-30"]);
	assert.equal(task.recurrence_parent, "[[Tasks/Daily task]]");
	assert.equal(task.occurrence_date, "2026-06-01");
	assert.equal(task.occurrence_materialization, "on_completion");
});

test("denormalizes task data to configured frontmatter", () => {
	const frontmatter = mapTaskToFrontmatter(DEFAULT_FIELD_MAPPING, {
		title: "Ship model",
		status: "done",
		priority: "high",
		path: "Tasks/Ship model.md",
		archived: false,
		tags: ["task"],
		recurrence_parent: "[[Tasks/Daily task]]",
		occurrence_date: "2026-06-01",
		occurrence_next_trigger: "completion_or_skip",
	});

	assert.equal(frontmatter.title, "Ship model");
	assert.equal(frontmatter.status, "done");
	assert.deepEqual(frontmatter.tags, ["task"]);
	assert.equal(frontmatter.recurrence_parent, "[[Tasks/Daily task]]");
	assert.equal(frontmatter.occurrence_date, "2026-06-01");
	assert.equal(frontmatter.occurrence_next_trigger, "completion_or_skip");
});

test("parses dates with UTC storage semantics", () => {
	assert.equal(formatDateForStorage(parseDateToUTC("2026-02-28")), "2026-02-28");
	assert.equal(getDatePart("2026-02-28T10:30:00"), "2026-02-28");
	assert.throws(() => parseDateToUTC("2026-02-30"), /Invalid date/);
});

test("recalculates recurring schedules with DTSTART", () => {
	const result = recalculateRecurringSchedule({
		recurrence: "FREQ=DAILY;COUNT=3",
		scheduled: "2026-06-01",
		referenceDate: "2026-06-01",
		completeInstances: ["2026-06-01"],
	});

	assert.equal(result.updatedRecurrence, "DTSTART:20260601;FREQ=DAILY;COUNT=3");
	assert.equal(result.nextScheduled, "2026-06-02");
});

test("builds recurring complete plans without host IO", () => {
	const plan = buildRecurringTaskCompletePlan({
		freshTask: {
			title: "Daily task",
			status: "open",
			priority: "normal",
			path: "Tasks/Daily task.md",
			archived: false,
			recurrence: "FREQ=DAILY",
			scheduled: "2026-06-01",
		},
		targetDate: parseDateToUTC("2026-06-01"),
		currentTimestamp: "2026-06-01T12:00:00Z",
		maintainDueDateOffsetInRecurring: true,
	});

	assert.equal(plan.newComplete, true);
	assert.deepEqual(plan.updatedTask.complete_instances, ["2026-06-01"]);
	assert.equal(plan.updatedTask.dateModified, "2026-06-01T12:00:00Z");
});

test("materializes recurring occurrences idempotently", () => {
	const parent = {
		title: "Daily task",
		status: "open",
		priority: "normal",
		path: "Tasks/Daily task.md",
		archived: false,
		recurrence: "DTSTART:20260601;FREQ=DAILY",
		scheduled: "2026-06-01",
	};
	const created = buildMaterializeOccurrencePlan({
		parentTask: parent,
		targetDate: "2026-06-01",
		currentTimestamp: "2026-06-01T08:00:00Z",
		defaultStatus: "open",
		defaultPriority: "normal",
	});

	assert.equal(created.created, true);
	assert.equal(created.occurrenceTask.recurrence_parent, "[[Tasks/Daily task]]");
	assert.equal(created.occurrenceTask.occurrence_date, "2026-06-01");
	assert.equal(created.occurrenceTask.scheduled, "2026-06-01");

	const existing = {
		...created.occurrenceTask,
		title: "Daily task",
		status: "open",
		priority: "normal",
		path: "Tasks/Daily task 2026-06-01.md",
		archived: false,
	};
	const duplicate = buildMaterializeOccurrencePlan({
		parentTask: parent,
		targetDate: "2026-06-01",
		currentTimestamp: "2026-06-01T09:00:00Z",
		existingOccurrences: [existing],
	});

	assert.equal(duplicate.created, false);
	assert.equal(duplicate.existingOccurrence.path, "Tasks/Daily task 2026-06-01.md");
});

test("materialized occurrences inherit planning fields but not parent history", () => {
	const parent = {
		title: "Morning review",
		status: "waiting",
		priority: "high",
		path: "Tasks/Morning review.md",
		archived: false,
		recurrence: "DTSTART:20260601;FREQ=DAILY",
		recurrence_anchor: "scheduled",
		scheduled: "2026-06-01T09:30:00",
		due: "2026-06-02T11:00:00",
		contexts: ["office"],
		projects: ["[[Projects/Launch]]"],
		tags: ["task", "review"],
		timeEstimate: 45,
		timeEntries: [{ startTime: "2026-06-01T09:30:00Z", endTime: "2026-06-01T10:00:00Z" }],
		complete_instances: ["2026-06-01"],
		skipped_instances: ["2026-06-02"],
		completedDate: "2026-06-01",
		reminders: [{ id: "rem-1", type: "relative", relatedTo: "scheduled", offset: "-PT15M" }],
		blockedBy: [{ uid: "[[Tasks/Prep]]", reltype: "FINISHTOSTART" }],
		details: "- [ ] Review notes",
		customProperties: { energy: "high", checklist: ["a", "b"] },
		occurrence_materialization: "on_completion",
		occurrence_next_trigger: "completion_or_skip",
		googleCalendarEventId: "parent-event",
	};

	const plan = buildMaterializeOccurrencePlan({
		parentTask: parent,
		targetDate: "2026-06-08",
		currentTimestamp: "2026-06-08T08:00:00Z",
		defaultStatus: "open",
		defaultPriority: "normal",
	});
	const occurrence = plan.occurrenceTask;

	assert.equal(occurrence.status, "open");
	assert.equal(occurrence.priority, "high");
	assert.equal(occurrence.scheduled, "2026-06-08T09:30:00");
	assert.equal(occurrence.due, "2026-06-09T11:00:00");
	assert.deepEqual(occurrence.contexts, ["office"]);
	assert.deepEqual(occurrence.projects, ["[[Projects/Launch]]"]);
	assert.deepEqual(occurrence.tags, ["task", "review"]);
	assert.equal(occurrence.timeEstimate, 45);
	assert.deepEqual(occurrence.reminders, parent.reminders);
	assert.deepEqual(occurrence.blockedBy, parent.blockedBy);
	assert.equal(occurrence.details, "- [ ] Review notes");
	assert.deepEqual(occurrence.customProperties, { energy: "high", checklist: ["a", "b"] });
	assert.equal("timeEntries" in occurrence, false);
	assert.equal("complete_instances" in occurrence, false);
	assert.equal("skipped_instances" in occurrence, false);
	assert.equal("completedDate" in occurrence, false);
	assert.equal("recurrence" in occurrence, false);
	assert.equal("occurrence_materialization" in occurrence, false);
	assert.equal("googleCalendarEventId" in occurrence, false);
});

test("reconciles materialized occurrence completion with parent instances", () => {
	const parent = {
		title: "Daily task",
		status: "open",
		priority: "normal",
		path: "Tasks/Daily task.md",
		archived: false,
		recurrence: "DTSTART:20260601;FREQ=DAILY",
		scheduled: "2026-06-01",
		skipped_instances: ["2026-06-01"],
		occurrence_materialization: "on_completion",
	};
	const occurrence = {
		title: "Daily task",
		status: "open",
		priority: "normal",
		path: "Tasks/Daily task 2026-06-01.md",
		archived: false,
		recurrence_parent: "[[Tasks/Daily task]]",
		occurrence_date: "2026-06-01",
		scheduled: "2026-06-01",
	};

	const plan = buildMaterializedOccurrenceCompletePlan({
		occurrenceTask: occurrence,
		parentTask: parent,
		completedStatus: "done",
		currentTimestamp: "2026-06-01T12:00:00Z",
		maintainDueDateOffsetInRecurring: true,
	});

	assert.equal(plan.updatedOccurrenceTask.status, "done");
	assert.equal(plan.updatedOccurrenceTask.completedDate, "2026-06-01");
	assert.deepEqual(plan.updatedParentTask.complete_instances, ["2026-06-01"]);
	assert.deepEqual(plan.updatedParentTask.skipped_instances, []);
	assert.equal(plan.updatedParentTask.scheduled, "2026-06-02");
	assert.equal(plan.materializeNextDate, "2026-06-02");

	const uncomplete = buildMaterializedOccurrenceUncompletePlan({
		occurrenceTask: plan.updatedOccurrenceTask,
		parentTask: plan.updatedParentTask,
		activeStatus: "open",
		currentTimestamp: "2026-06-01T13:00:00Z",
	});
	assert.equal(uncomplete.updatedOccurrenceTask.status, "open");
	assert.equal(uncomplete.updatedOccurrenceTask.completedDate, undefined);
	assert.deepEqual(uncomplete.updatedParentTask.complete_instances, []);
	assert.equal(uncomplete.updatedParentTask.scheduled, "2026-06-02");
});

test("advances recurrence anchor to the real completion date, not the occurrence identity date", () => {
	const parent = {
		title: "Weekly task",
		status: "open",
		priority: "normal",
		path: "Tasks/Task2.md",
		archived: false,
		recurrence: "DTSTART:20260101;FREQ=WEEKLY",
		recurrence_anchor: "completion",
		scheduled: "2026-01-01",
		occurrence_materialization: "on_completion",
	};
	const occurrence = {
		title: "Weekly task",
		status: "open",
		priority: "normal",
		path: "Tasks/Task2 2026-01-02.md",
		archived: false,
		recurrence_parent: "[[Task2]]",
		occurrence_date: "2026-01-02",
		scheduled: "2026-01-03",
	};

	const plan = buildMaterializedOccurrenceCompletePlan({
		occurrenceTask: occurrence,
		parentTask: parent,
		completedStatus: "done",
		currentTimestamp: "2026-01-04T08:00:00Z",
		maintainDueDateOffsetInRecurring: true,
		completionDate: new Date(Date.UTC(2026, 0, 4)),
	});

	// The occurrence's own completedDate must be the real completion date (2026-01-04),
	// not the occurrence identity date (2026-01-02).
	assert.equal(plan.updatedOccurrenceTask.completedDate, "2026-01-04");

	// Parent instance history remains keyed by the occurrence identity date.
	assert.deepEqual(plan.updatedParentTask.complete_instances, ["2026-01-02"]);

	// Anchor/progression must be tied to the actual completion date (2026-01-04), not
	// occurrence_date (2026-01-02).
	assert.equal(plan.updatedParentTask.recurrence, "DTSTART:20260104;FREQ=WEEKLY");
	assert.equal(plan.updatedParentTask.scheduled, "2026-01-11");

	const uncomplete = buildMaterializedOccurrenceUncompletePlan({
		occurrenceTask: plan.updatedOccurrenceTask,
		parentTask: plan.updatedParentTask,
		activeStatus: "open",
		currentTimestamp: "2026-01-04T09:00:00Z",
	});

	assert.deepEqual(uncomplete.updatedParentTask.complete_instances, []);
	// Ordinary uncomplete removes instance state but does not rewind completion progression.
	assert.equal(uncomplete.updatedParentTask.recurrence, "DTSTART:20260104;FREQ=WEEKLY");
	assert.equal(uncomplete.updatedParentTask.scheduled, "2026-01-11");
});

test("advances recurrence anchor when the parent already has prior completion-anchored instances", () => {
	const parent = {
		title: "Weekly task",
		status: "open",
		priority: "normal",
		path: "Tasks/Task2.md",
		archived: false,
		// DTSTART reflects the last completion date, while complete_instances stores
		// the occurrence identity dates for the two earlier cycles.
		recurrence: "DTSTART:20251225;FREQ=WEEKLY",
		recurrence_anchor: "completion",
		scheduled: "2026-01-01",
		complete_instances: ["2025-12-17", "2025-12-24"],
		occurrence_materialization: "on_completion",
	};
	const occurrence = {
		title: "Weekly task",
		status: "open",
		priority: "normal",
		path: "Tasks/Task2 2026-01-02.md",
		archived: false,
		recurrence_parent: "[[Task2]]",
		occurrence_date: "2026-01-02",
		scheduled: "2026-01-03",
	};

	const plan = buildMaterializedOccurrenceCompletePlan({
		occurrenceTask: occurrence,
		parentTask: parent,
		completedStatus: "done",
		currentTimestamp: "2026-01-08T08:00:00Z",
		maintainDueDateOffsetInRecurring: true,
		completionDate: new Date(Date.UTC(2026, 0, 8)),
	});

	// The occurrence's own completedDate is the real completion date, not occurrence_date.
	assert.equal(plan.updatedOccurrenceTask.completedDate, "2026-01-08");

	// The occurrence identity date is appended; the earlier cycles are untouched.
	assert.deepEqual(plan.updatedParentTask.complete_instances, [
		"2025-12-17",
		"2025-12-24",
		"2026-01-02",
	]);
	assert.equal(plan.updatedParentTask.recurrence, "DTSTART:20260108;FREQ=WEEKLY");
	assert.equal(plan.updatedParentTask.scheduled, "2026-01-15");

	const uncomplete = buildMaterializedOccurrenceUncompletePlan({
		occurrenceTask: plan.updatedOccurrenceTask,
		parentTask: plan.updatedParentTask,
		activeStatus: "open",
		currentTimestamp: "2026-01-08T09:00:00Z",
	});

	// Only the just-completed instance is removed - the earlier history survives.
	assert.deepEqual(uncomplete.updatedParentTask.complete_instances, [
		"2025-12-17",
		"2025-12-24",
	]);
	assert.equal(uncomplete.updatedParentTask.recurrence, "DTSTART:20260108;FREQ=WEEKLY");
});

test("plans time tracking and total reporting", () => {
	const start = buildStartTimeTrackingPlan(
		{
			title: "Timed task",
			status: "open",
			priority: "normal",
			path: "Tasks/Timed task.md",
			archived: false,
		},
		"2026-06-01T09:00:00Z"
	);
	const entries = [
		{ ...start.newEntry, endTime: "2026-06-01T09:30:00Z" },
		{ startTime: "2026-06-01T10:00:00Z", endTime: "2026-06-01T10:45:00Z" },
	];

	assert.equal(calculateTotalTrackedMinutes(entries), 75);
});

test("builds spec-normalized updates for adapter surfaces", () => {
	const complete = buildSpecCompleteTaskUpdate({
		frontmatter: {
			title: "Daily task",
			status: "open",
			priority: "normal",
			recurrence: "FREQ=DAILY",
			scheduled: "2026-06-01",
			completeInstances: [],
			skippedInstances: ["2026-06-01"],
		},
		targetDate: "2026-06-01",
		completedStatus: "done",
		currentTimestamp: "2026-06-01T12:00:00Z",
		path: "Tasks/Daily task.md",
	});

	assert.equal(complete.fields.recurrence, "DTSTART:20260601;FREQ=DAILY");
	assert.equal(complete.fields.scheduled, "2026-06-02");
	assert.deepEqual(complete.fields.completeInstances, ["2026-06-01"]);
	assert.deepEqual(complete.fields.skippedInstances, []);

	const skip = buildSpecRecurringSkipUpdate({
		frontmatter: complete.fields,
		targetDate: "2026-06-02",
		skip: true,
	});

	assert.deepEqual(skip.fields.skippedInstances, ["2026-06-02"]);
	assert.equal(skip.fields.scheduled, "2026-06-03");

	const start = buildSpecStartTimeTrackingUpdate({
		frontmatter: { title: "Timed task", status: "open", priority: "normal" },
		currentTimestamp: "2026-06-01T09:00:00Z",
	});
	assert.deepEqual(start.fields.timeEntries, [{ startTime: "2026-06-01T09:00:00Z" }]);

	const stop = buildSpecStopTimeTrackingUpdate({
		frontmatter: start.fields,
		currentTimestamp: "2026-06-01T09:30:00Z",
	});
	assert.deepEqual(stop.fields.timeEntries, [
		{
			startTime: "2026-06-01T09:00:00Z",
			endTime: "2026-06-01T09:30:00Z",
		},
	]);
});

test("round-trips markdown task documents", () => {
	const document = parseTaskDocument("---\ntitle: Test\nstatus: open\n---\nBody\n", {
		path: "Tasks/Test.md",
	});

	assert.equal(document.task.title, "Test");
	assert.equal(document.body, "Body\n");
	assert.match(serializeTaskDocument(document.task, document.body), /title: Test/);
});

test("exposes conformance envelopes", () => {
	const result = executeConformanceOperation("date.validate", { value: "2026-06-01" });
	assert.equal(result.ok, true);
	assert.deepEqual(result.result, { value: "2026-06-01" });
});
