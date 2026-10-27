import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskNotesMdbaseResources, buildTaskNotesMdbaseTypePack } from "../dist/esm/mdbase.js";
import {
	buildTaskNotesStarterResources,
	TASKNOTES_STARTER_TYPE_VERSION,
} from "../dist/esm/starter.js";

// The tasknotes.task 0.3.0-rc.19 pack in mdbase-contracts
// (packs/tasknotes.task/0.3.0-rc.19.pack.yaml, published at
// https://mdbase.dev/contracts/packs/tasknotes.task/0.3.0-rc.19.json). If the
// starter changes, publish a new starter revision in mdbase-contracts and
// update these digests together; collections upgrade by merging against the
// previous starter, so an unintended change here reaches every collection.
const PUBLISHED_RC19_RESOURCES = {
	"_contracts/tasknotes.task/0.3.0-rc.6.md":
		"sha256:3f4eb90782948ed68112ffcc99575911036020544cf501de3d2265b588b38456",
	"_types/task.md":
		"sha256:87e52c25b474a06283b29e2983ae4fc6e618fd1a4cbcc5856ff9a67328df605b",
	"_schemas/tasknotes/tasknotes-task.schema.json":
		"sha256:ac78a55f46669d6e8bd08d608b7c25338fec8ba7606dbf54ebd6b8d4e66b7035",
	"_schemas/tasknotes/tasknotes-task-binding.schema.json":
		"sha256:4f8f3288f593ce06a04525697308173147ff957e7066f83d9a922468d06be659",
};

test("the starter reproduces the published TaskNotes pack byte for byte", async () => {
	const pack = await buildTaskNotesMdbaseTypePack(buildTaskNotesStarterResources());
	assert.deepEqual(
		Object.fromEntries(pack.manifest.resources.map((resource) => [resource.target, resource.digest])),
		PUBLISHED_RC19_RESOURCES,
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
