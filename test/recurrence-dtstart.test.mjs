import assert from "node:assert/strict";
import test from "node:test";
import {
	completeRecurringTask,
	generateRecurringInstances,
	getRecurrenceDisplayText,
	updateDTSTARTInRecurrenceRule,
} from "../dist/esm/index.js";

const rule = "FREQ=WEEKLY;BYDAY=MO,WE,FR";
const date = (value) => new Date(`${value}T00:00:00Z`);
const expand = (recurrence) => generateRecurringInstances(
	{ recurrence }, date("2026-01-01"), date("2026-01-16")
).map((value) => value.toISOString().slice(0, 10));

for (const separator of [";", "\nRRULE:", "\r\nRRULE:"]) {
	test(`DTSTART replacement preserves frequency, delimiter and time (${JSON.stringify(separator)})`, () => {
		const original = `DTSTART:20260101T090000Z${separator}${rule}`;
		const updated = updateDTSTARTInRecurrenceRule(original, "2026-01-05");
		assert.equal(updated, `DTSTART:20260105T090000Z${separator}${rule}`);
		assert.equal(getRecurrenceDisplayText(original), "every week on Monday, Wednesday, Friday");
		assert.equal(getRecurrenceDisplayText(updated), getRecurrenceDisplayText(original));
		assert.deepEqual(expand(original), ["2026-01-02", "2026-01-05", "2026-01-07", "2026-01-09", "2026-01-12", "2026-01-14", "2026-01-16"]);
		assert.deepEqual(expand(updated), expand(original).slice(1));
	});
}

test("completion-anchor round trip retains the RFC rule and clock", () => {
	const recurrence = `DTSTART:20260101T090000Z\nRRULE:${rule}`;
	const completed = completeRecurringTask({
		recurrence, recurrenceAnchor: "completion", completionDate: "2026-01-05",
		scheduled: "2026-01-05T09:00:00", completeInstances: [],
	});
	assert.equal(completed.updatedRecurrence, `DTSTART:20260105T090000Z\nRRULE:${rule}`);
	assert.equal(completed.nextScheduled, "2026-01-07T09:00:00");
	assert.deepEqual(expand(completed.updatedRecurrence), expand(recurrence).slice(1));
});

test("date-only DTSTART remains date-only and keeps RDATE/EXDATE lines", () => {
	const tail = `\nRRULE:${rule}\nRDATE:20260106\nEXDATE:20260107`;
	const updated = updateDTSTARTInRecurrenceRule(`DTSTART;VALUE=DATE:20260101${tail}`, "2026-01-05");
	assert.equal(updated, `DTSTART;VALUE=DATE:20260105${tail}`);
	assert.equal(getRecurrenceDisplayText(updated), "every week on Monday, Wednesday, Friday");
	assert.deepEqual(expand(updated), ["2026-01-05", "2026-01-06", "2026-01-09", "2026-01-12", "2026-01-14", "2026-01-16"]);
});

test("preserves TZID, floating clock and all additional recurrence lines", () => {
	const original = `DTSTART;TZID=Europe/London:20260101T093015\nRRULE:${rule}\nRDATE;TZID=Europe/London:20260106T093015\nEXDATE;TZID=Europe/London:20260107T093015`;
	const updated = updateDTSTARTInRecurrenceRule(original, "2026-01-05");
	assert.equal(updated, original.replace("20260101", "20260105"));
	assert.deepEqual(expand(updated), ["2026-01-05", "2026-01-06", "2026-01-09", "2026-01-12", "2026-01-14", "2026-01-16"]);
});

test("explicit timestamp updates replace the clock but never the surrounding rule", () => {
	const recurrence = `DTSTART:20260101T090000Z\nRRULE:${rule}`;
	assert.equal(updateDTSTARTInRecurrenceRule(recurrence, "2026-01-05T14:30:00"),
		`DTSTART:20260105T143000Z\nRRULE:${rule}`);
});
