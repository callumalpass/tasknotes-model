import assert from "node:assert/strict";
import test from "node:test";
const { DEFAULT_FIELD_MAPPING, mapTaskFromFrontmatter, mapTaskToFrontmatter, getFrontmatterTags } = await import("../dist/esm/index.js");

// Independent coverage of every list normalizer caller and explicit user values.
test("maps empty list-like frontmatter values to empty arrays", () => {
	const task = mapTaskFromFrontmatter(
		DEFAULT_FIELD_MAPPING,
		{
			title: "Empty list fields",
			contexts: null,
			projects: null,
			tags: ["", null, "task"],
		},
		"Tasks/Empty list fields.md"
	);
	assert.deepEqual(task.contexts, []);
	assert.deepEqual(task.projects, []);
	assert.deepEqual(task.tags, ["task"]);
});

for (const value of [null, "", "   ", [], [null, undefined, "", "\t"]]) {
	test(`nullable contexts/projects/ICS IDs/moved dates: ${JSON.stringify(value)}`, () => {
		const task = mapTaskFromFrontmatter(DEFAULT_FIELD_MAPPING, {
			contexts: value, projects: value,
			[DEFAULT_FIELD_MAPPING.icsEventId]: value,
			[DEFAULT_FIELD_MAPPING.googleCalendarMovedOriginalDates]: value,
		}, "Tasks/Empty.md");
		assert.deepEqual(task.contexts, []);
		assert.deepEqual(task.projects, []);
		assert.deepEqual(task.icsEventId, []);
		assert.deepEqual(task.googleCalendarMovedOriginalDates, []);
		const saved = mapTaskToFrontmatter(DEFAULT_FIELD_MAPPING, task);
		assert.ok(!JSON.stringify(saved).includes('"null"'));
	});
}

test("retains explicit literal null/undefined strings, numbers/booleans, links and Unicode", () => {
	const values = ["null", "undefined", "Deep Work 🧠", "[[Joe Smith]]", 0, false, 42];
	const task = mapTaskFromFrontmatter(DEFAULT_FIELD_MAPPING, { contexts: values, projects: values }, "Tasks/Mixed.md");
	assert.deepEqual(task.contexts, values.map(String));
	assert.deepEqual(task.projects, values.map(String));
});

test("removes only invalid/empty entries in mixed lists", () => {
	const task = mapTaskFromFrontmatter(DEFAULT_FIELD_MAPPING, {
		contexts: [null, undefined, "", " ", {}, "work", "Deep Work 🧠"],
		projects: [null, "[[Project]]", false, 0],
	}, "Tasks/Mixed.md");
	assert.deepEqual(task.contexts, ["work", "Deep Work 🧠"]);
	assert.deepEqual(task.projects, ["[[Project]]", "false", "0"]);
});

test("tags drop nullable entries but preserve normalization, deduplication and archive detection", () => {
	assert.deepEqual(getFrontmatterTags([null, undefined, {}, "", " ", "#task", "task", 0, false, "null", "Deep Work 🧠"]),
		["task", "0", "false", "null", "Deep-Work-🧠"]);
	const task = mapTaskFromFrontmatter(DEFAULT_FIELD_MAPPING, { tags: [null, "#archived"] }, "Tasks/Archived.md");
	assert.equal(task.archived, true);
	assert.deepEqual(task.tags, ["archived"]);
});

test("uses configured list property names and leaves custom properties alone", () => {
	const mapping = { ...DEFAULT_FIELD_MAPPING, contexts: "my_contexts", projects: "my_projects" };
	const task = mapTaskFromFrontmatter(mapping, { my_contexts: null, my_projects: null, custom: null }, "Tasks/Custom.md", false, [{ key: "custom" }]);
	assert.deepEqual(task.contexts, []);
	assert.deepEqual(task.projects, []);
	assert.equal(task.customProperties.custom, null);
});
