import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FIELD_MAPPING } from "../dist/esm/defaults.js";
import {
	lookupMappingKey,
	mapTaskFromFrontmatter,
	toUserField,
	validateFieldMapping,
} from "../dist/esm/mapping.js";
import {
	buildTaskNotesMdbaseResources,
	resolveTaskNotesModelConfigFromMdbaseType,
} from "../dist/esm/mdbase.js";

const mapping = { ...DEFAULT_FIELD_MAPPING, id: "tasknote_id" };

test("the stable ID is read from its mapped property", () => {
	assert.equal(DEFAULT_FIELD_MAPPING.id, "id");
	const task = mapTaskFromFrontmatter(
		mapping,
		{ tasknote_id: "abc", id: "someone-elses", title: "Task" },
		"tasks/Task.md"
	);
	assert.equal(task.id, "abc");
	assert.equal(lookupMappingKey(mapping, "tasknote_id"), "id");
	assert.equal(lookupMappingKey(mapping, "id"), null);
	assert.equal(mapTaskFromFrontmatter(mapping, { id: "plain" }, "tasks/T.md").id, undefined);
	assert.equal(validateFieldMapping({ ...mapping, title: "tasknote_id" }).valid, false);
});

test("mappings saved before the ID field existed keep using id", () => {
	const legacy = { ...DEFAULT_FIELD_MAPPING };
	delete legacy.id;
	assert.equal(toUserField(legacy, "id"), "id");
	assert.equal(mapTaskFromFrontmatter(legacy, { id: "abc" }, "tasks/T.md").id, "abc");
	assert.equal(validateFieldMapping(legacy).valid, true);
});

test("a remapped ID is generated into the mdbase type and read back from it", () => {
	const resources = buildTaskNotesMdbaseResources({ modelConfig: { fieldMapping: mapping } });
	const { type, config } = resources;
	const taskNotes = type.implements.find((entry) => entry.contract === "tasknotes.task");

	assert.equal(taskNotes.fields.id, "tasknote_id");
	assert.ok(type.schema.value.properties.tasknote_id);
	assert.equal(type.schema.value.properties.id, undefined);
	assert.deepEqual(type.lifecycle.on_create.set.tasknote_id, { uuid: true });
	assert.equal(type.lifecycle.on_create.set.id, undefined);
	assert.deepEqual(type.collection.unique, [{ field: "tasknote_id", scope: "type" }]);
	assert.equal(config.settings.id_field, "tasknote_id");

	const resolved = resolveTaskNotesModelConfigFromMdbaseType(type);
	assert.equal(resolved.fieldMapping.id, "tasknote_id");
	assert.equal(resolveTaskNotesModelConfigFromMdbaseType(
		buildTaskNotesMdbaseResources().type
	).fieldMapping.id, "id");
});

test("with a remapped ID, a plain id property is the vault's own field", () => {
	const { type } = buildTaskNotesMdbaseResources({ modelConfig: { fieldMapping: mapping } });
	type.schema.value.properties.id = { type: "string" };
	const resolved = resolveTaskNotesModelConfigFromMdbaseType(type);
	assert.deepEqual(resolved.userFields.map((field) => field.key), ["id"]);
});
