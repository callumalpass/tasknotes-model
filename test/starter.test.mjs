import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildTaskNotesMdbaseResources, buildTaskNotesMdbaseTypePack } from "../dist/esm/mdbase.js";
import {
	buildTaskNotesStarterResources,
	TASKNOTES_STARTER_TYPE_VERSION,
} from "../dist/esm/starter.js";

// The tasknotes.task 0.3.0-rc.22 pack, vendored from the mdbase-contracts
// dist/ in src/generated/tasknotes-type-pack.json. If the
// starter changes, publish a new starter revision in mdbase-contracts and
// update these digests together; collections upgrade by merging against the
// previous starter, so an unintended change here reaches every collection.
const PUBLISHED_RC22_RESOURCES = {
	"_mdbase/contracts/tasknotes.task.md": "sha256:ecadd00700e249940f4244aaa5b5985a96557d13340463ec491dfa5e89b032a4",
	"_mdbase/contracts/tasknotes.task/0.3.0-rc.4.md": "sha256:91165b7664f936bba9289aca984e2638901db7fedf68642ab755e8d0b424e734",
	"_mdbase/contracts/tasknotes.task/0.3.0-rc.3.md": "sha256:4761ee78615882170cae6e52590f98917f549bd89d852a0c40568583394d7264",
	"_mdbase/contracts/tasknotes.task/0.3.0-rc.6.md": "sha256:3f4eb90782948ed68112ffcc99575911036020544cf501de3d2265b588b38456",
	"_mdbase/types/task.md": "sha256:83bfd806bfbda7b99f1eb057b26cf6e0fbc1db6958a0ed3e610f0b20ff9b7aef",
	"_mdbase/_schemas/tasknotes/tasknotes-task.schema.json": "sha256:ac78a55f46669d6e8bd08d608b7c25338fec8ba7606dbf54ebd6b8d4e66b7035",
	"_mdbase/_schemas/tasknotes/tasknotes-task-binding.schema.json": "sha256:4f8f3288f593ce06a04525697308173147ff957e7066f83d9a922468d06be659",
	"_mdbase/schemas/mdbase.app-settings/1.0.0.schema.json": "sha256:f37ed43b57fe86465b5bb67216da71d6e351bc1b85bf55a20f95edf886f0749e",
	"_mdbase/contracts/mdbase.app-settings/1.0.0.md": "sha256:9028d8ccd99cfbb4034399777376315486eb8e699aea7757a6b193743f1084c8",
	"_mdbase/schemas/tasknotes.settings/1.0.0.schema.json": "sha256:3a4fc207e14ab1579ca478ce84b25cb8dd85b804b3aa79d01eda08e4554dfbb1",
	"_mdbase/contracts/tasknotes.settings/1.0.0.md": "sha256:e8c25653ef37c032fb4cb1f1c3f7c618092a09c4911a41aba42c0476796fe0d1",
	"_mdbase/contracts/mdbase.app-settings/2.0.0.md": "sha256:a6587ce4cac92b064b2a07f032045e1f114ae358f1749adf4d8d8f38970952e8",
	"_mdbase/contracts/tasknotes.settings/1.1.0.md": "sha256:7d4e6f55b6ba599faff00d837152ef7811ac5193ac20802f1ecdbc3ef7db5647",
	"_mdbase/types/tasknotes-settings.md": "sha256:044d3d07b75ab07e458e824bf2b31116a683778d46db33cccf6a00111f652739"
};

test("the starter reproduces the published TaskNotes pack resource bytes", async () => {
	const pack = await buildTaskNotesMdbaseTypePack(buildTaskNotesStarterResources());
	assert.equal(pack.manifest.version, "0.3.0-rc.22");
	assert.deepEqual(
		Object.fromEntries(pack.manifest.resources.map((resource) => [resource.target, resource.digest])),
		PUBLISHED_RC22_RESOURCES,
	);
});

test("the legacy layout reproduces the complete published pack including upgrade history", async () => {
	const published = JSON.parse(await readFile(new URL("../src/generated/tasknotes-type-pack.json", import.meta.url), "utf8"));
	const pack = await buildTaskNotesMdbaseTypePack(buildTaskNotesStarterResources({
		typesFolder: "_types", contractsFolder: "_contracts",
	}));
	assert.deepEqual(pack, published);
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
