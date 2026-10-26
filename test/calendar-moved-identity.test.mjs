import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCalendarEntries, createCalendarEntryIndex, planCalendarEdit } from "../dist/esm/calendar.js";
import { calendarFixtures } from "../dist/esm/calendar-fixtures.js";
import { DEFAULT_FIELD_MAPPING } from "../dist/esm/defaults.js";
import {
	isRecognizedProperty,
	mapTaskFromFrontmatter,
	mapTaskToFrontmatter,
	normalizeRecurrenceOriginalDate,
	toUserField,
	validateFieldMapping,
} from "../dist/esm/mapping.js";
import { applyFrontmatterPatch, taskInfoUpdatesToFrontmatterPatch } from "../dist/esm/operations.js";
import { taskInfoSchema } from "../dist/esm/schema.js";

const moved = () => structuredClone(calendarFixtures.find((f) => f.name === "native-moved-annual-preserves-and-clears-identity").input);

test("original identity mapping is strict, configurable and compatible with old settings", () => {
	const mapping = { ...DEFAULT_FIELD_MAPPING, recurrenceOriginalDate: "rule_day" };
	const input = moved();
	const task = taskInfoSchema.parse(input.tasks[0]);
	assert.equal(task.recurrence_original_date, "2026-10-18");
	const frontmatter = mapTaskToFrontmatter(mapping, task);
	assert.equal(frontmatter.rule_day, "2026-10-18");
	assert.equal(frontmatter.recurrence_original_date, undefined);
	assert.equal(mapTaskFromFrontmatter(mapping, frontmatter, task.path).recurrence_original_date, "2026-10-18");
	assert.deepEqual(taskInfoUpdatesToFrontmatterPatch({ recurrence_original_date: undefined }, mapping), [{ op: "delete", field: "rule_day" }]);
	for (const invalid of ["2026-02-30", "2026-13-01", "2026-10-18T09:00", "2026-1-2", "", null, 20261018, ["2026-10-18"]]) {
		assert.equal(normalizeRecurrenceOriginalDate(invalid), undefined);
		assert.equal(mapTaskFromFrontmatter(mapping, { rule_day: invalid }, task.path).recurrence_original_date, undefined);
		assert.equal(mapTaskToFrontmatter(mapping, { recurrence_original_date: invalid }).rule_day, undefined);
	}
	assert.equal(normalizeRecurrenceOriginalDate(" 2028-02-29 "), "2028-02-29");
	const legacy = { ...DEFAULT_FIELD_MAPPING };
	delete legacy.recurrenceOriginalDate;
	assert.equal(toUserField(legacy, "recurrenceOriginalDate"), "recurrence_original_date");
	assert.equal(isRecognizedProperty(legacy, "recurrence_original_date"), true);
	assert.equal(validateFieldMapping({ ...legacy, due: "recurrence_original_date" }).valid, false);
	assert.equal(mapTaskFromFrontmatter(legacy, { recurrence_original_date: "2026-10-18" }, task.path).recurrence_original_date, "2026-10-18");
});

test("persisted calendar moves preserve identity through clock/estimate edits, then delete it on return or series edit", () => {
	const context = moved();
	const mapping = { ...DEFAULT_FIELD_MAPPING, recurrenceOriginalDate: "rule_day" };
	let task = context.tasks[0];
	let frontmatter = mapTaskToFrontmatter(mapping, task);
	const index = createCalendarEntryIndex(context);
	const edit = (start, kind = "drop", end) => {
		index.setTasks([task]);
		const entry = index.entriesInRange(context.range).find((e) => e.recurringKind === "next-scheduled");
		const plan = planCalendarEdit({ task, entry, change: { kind, start, end, allDay: !start.includes("T") }, timezone: context.timezone, now: context.now, fieldMapping: mapping });
		frontmatter = applyFrontmatterPatch(frontmatter, plan.frontmatterPatch);
		task = { ...task, ...plan.updates };
		assert.equal(mapTaskFromFrontmatter(mapping, frontmatter, task.path).recurrence_original_date, task.recurrence_original_date);
		return plan;
	};
	edit("2027-10-18");
	assert.equal(frontmatter.rule_day, "2026-10-18");
	assert.equal(buildCalendarEntries({ ...context, tasks: [task] }).filter((e) => e.start === "2027-10-18").length, 2);
	edit("2027-10-18T11:30");
	edit("2027-10-18T11:30", "resize", "2027-10-18T12:15");
	assert.equal(frontmatter.rule_day, "2026-10-18");
	const back = edit("2026-10-18T11:30");
	assert.ok(back.frontmatterPatch.some((p) => p.op === "delete" && p.field === "rule_day"));
	assert.equal(Object.hasOwn(frontmatter, "rule_day"), false);
	index.setTasks([task]);
	assert.deepEqual(index.entriesInRange(context.range), buildCalendarEntries({ ...context, tasks: [task] }));
	assert.equal(index.entriesInRange(context.range).filter((e) => e.instanceDate === "2026-10-18").length, 1);

	// A series clock edit is not another move of the pending occurrence.
	task = context.tasks[0];
	const pattern = buildCalendarEntries(context).find((e) => e.recurringKind === "pattern");
	const plan = planCalendarEdit({ task, entry: pattern, change: { kind: "drop", start: "2027-10-18T14:00", allDay: false }, timezone: context.timezone, now: context.now, fieldMapping: mapping });
	assert.equal(plan.updates.recurrence_original_date, undefined);
	assert.ok(plan.frontmatterPatch.some((p) => p.op === "delete" && p.field === "rule_day"));
});

test("native identity never aliases completion anchors, malformed markers or a different materialized occurrence", () => {
	const input = moved();
	input.range.end = "2026-11-01";
	for (const task of [
		{ ...input.tasks[0], recurrence_original_date: "2026-02-30" },
		{ ...input.tasks[0], recurrence_anchor: "completion" },
	]) {
		const entries = buildCalendarEntries({ ...input, tasks: [task] });
		assert.equal(entries.find((e) => e.recurringKind === "next-scheduled").instanceDate, "2026-10-12");
		assert.ok(entries.some((e) => e.start === "2026-10-18"));
	}
	const child = { ...input.tasks[0], id: "child", path: "child.md", recurrence: undefined, recurrence_parent: "[[a]]", occurrence_date: "2026-10-18", scheduled: "2026-10-13" };
	assert.equal(buildCalendarEntries({ ...input, tasks: [input.tasks[0], child] }).filter((e) => e.taskId === "a").length, 0);
	child.occurrence_date = "2026-10-12";
	assert.equal(buildCalendarEntries({ ...input, tasks: [input.tasks[0], child] }).find((e) => e.taskId === "a").instanceDate, "2026-10-18");
	const history = buildCalendarEntries({ ...input, tasks: [{ ...input.tasks[0], googleCalendarMovedOriginalDates: ["2027-10-18"], complete_instances: ["2027-10-18"] }], range: { start: "2027-10-01", end: "2027-11-01" } });
	assert.deepEqual(history.map((e) => [e.recurringKind, e.instanceDate, e.isCompleted]), [["recorded", "2027-10-18", true]]);
});
