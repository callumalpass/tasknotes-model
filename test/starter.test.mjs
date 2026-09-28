import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskNotesMdbaseResources, buildTaskNotesMdbaseTypePack } from "../dist/esm/mdbase.js";
import {
	buildTaskNotesStarterResources,
	TASKNOTES_STARTER_TYPE_VERSION,
} from "../dist/esm/starter.js";

// The published tasknotes.task 0.3.0-rc.17 pack
// (https://mdbase.dev/contracts/packs/tasknotes.task/0.3.0-rc.17.json). If the
// starter changes, publish a new starter type version in mdbase-contracts and
// update these digests together; collections upgrade by merging against the
// previous starter, so an unintended change here reaches every collection.
const PUBLISHED_RC17_RESOURCES = {
	"_contracts/tasknotes.task.md":
		"sha256:ecadd00700e249940f4244aaa5b5985a96557d13340463ec491dfa5e89b032a4",
	"_types/task.md":
		"sha256:b3cf8dbe8885b331c494d2eeb36abfb052890e06b757877d655c269e666487dc",
	"_schemas/tasknotes/tasknotes-task.schema.json":
		"sha256:aec95578a093be95cbce0fb500964e7aeaeeacc611624fc2893074637dbd4125",
	"_schemas/tasknotes/tasknotes-task-binding.schema.json":
		"sha256:5b38e8a1c426b7f7fa92d8353fe35dd98e632305cbb15ffccde387473166b267",
};

test("the starter reproduces the published TaskNotes pack byte for byte", async () => {
	const pack = await buildTaskNotesMdbaseTypePack(buildTaskNotesStarterResources());
	assert.deepEqual(
		Object.fromEntries(pack.manifest.resources.map((resource) => [resource.target, resource.digest])),
		PUBLISHED_RC17_RESOURCES,
	);
});

test("the starter keeps cancelled as a skipped status and declares only implemented profiles", () => {
	const { type } = buildTaskNotesStarterResources();
	const binding = type.implements.find((entry) => entry.contract === "tasknotes.task").binding;
	assert.equal(type.version, TASKNOTES_STARTER_TYPE_VERSION);
	assert.ok(type.schema.value.properties.status.enum.includes("cancelled"));
	assert.deepEqual(binding.status.skipped_values, ["cancelled"]);
	assert.equal(binding.status.default_skipped, "cancelled");
	assert.deepEqual(binding.profiles, ["core-lite", "recurrence", "materialized-occurrences"]);
});

test("types written for migrated v0.2 collections declare assignees as the starter does", () => {
	const starter = buildTaskNotesStarterResources().type;
	const legacy = buildTaskNotesMdbaseResources({ legacyCompatibility: true }).type;
	assert.equal(legacy.version, starter.version);
	assert.deepEqual(
		legacy.schema.value.properties.assignees,
		starter.schema.value.properties.assignees,
	);
});
