import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskNotesMdbaseResources, resolveTaskNotesModelConfigFromMdbaseType, upgradeTaskNotesMdbaseTypeContract } from "../dist/esm/mdbase.js";
import {
	absentTaskNotesSettingsPatch,
	buildTaskNotesSettingsPatch,
	buildTaskNotesSettingsResources,
	conflictingTaskNotesSettings,
	newTaskNotesSettingsFrontmatter,
	readAppSettingsFrontmatter,
	resolveTaskNotesAppSettings,
	TASKNOTES_SETTINGS_PATH,
	writeAppSettingsDocument,
} from "../dist/esm/settings.js";

// An rc.5 binding still carries the settings rc.6 moved to the record.
function legacyBinding() {
	return {
		status: {
			values: ["open", "done", "cancelled"],
			definitions: [
				{ value: "open", next_status: "done", exclude_from_cycle: false, auto_archive: false, auto_archive_delay_minutes: 5 },
				{ value: "done", exclude_from_cycle: false, auto_archive: true, auto_archive_delay_minutes: 30 },
			],
		},
		archive: { archived_tag: "archived", move_on_archive: true, folder: "Archive" },
		templating: { enabled: true, template_path: "Templates/Task.md", occurrence_enabled: false },
		time_tracking: { auto_stop_on_complete: true },
		recurrence: { syntax: "tasknotes", reset_body_checkboxes: true },
		links: { accepted_formats: ["wikilink", "markdown"], write_format: "markdown" },
		nlp: { triggers: [{ property_id: "contexts", trigger: "@", enabled: true }] },
	};
}

const record = (fields) => ({ app: "dev.tasknotes", scope: "collection", settings_version: 1, ...fields });

test("reads each setting from the record, then an earlier binding, then the default", () => {
	const missing = resolveTaskNotesAppSettings(undefined, { legacyBinding: legacyBinding() });
	assert.equal(missing.recorded, false);
	assert.equal(missing.values.move_on_archive, true);
	assert.equal(missing.values.archive_folder, "Archive");
	assert.equal(missing.values.link_write_format, "markdown");
	assert.deepEqual(missing.values.status_behavior.done, { exclude_from_cycle: false, auto_archive: true, auto_archive_delay_minutes: 30 });

	const partial = resolveTaskNotesAppSettings(
		record({ archive_folder: "Filed", status_behavior: { done: { auto_archive_delay_minutes: 60 } } }),
		{ legacyBinding: legacyBinding() },
	);
	assert.equal(partial.values.archive_folder, "Filed");
	assert.equal(partial.values.move_on_archive, true, "an absent record field falls back to the binding");
	assert.deepEqual(partial.values.status_behavior.done, { exclude_from_cycle: false, auto_archive: true, auto_archive_delay_minutes: 60 });
	assert.equal(partial.values.status_behavior.open.next_status, "done");

	const plain = resolveTaskNotesAppSettings(record({ template_path: 42 }));
	assert.equal(plain.values.template_path, "");
	assert.equal(plain.values.link_write_format, "wikilink");
	assert.equal(plain.warnings.length, 1);

	// The model config follows the same order.
	const type = buildTaskNotesMdbaseResources().type;
	const legacyType = structuredClone(type);
	const implementation = legacyType.implements[0];
	implementation.version = "0.3.0-rc.5";
	implementation.binding.time_tracking = { auto_stop_on_complete: true };
	implementation.binding.recurrence.reset_body_checkboxes = true;
	const fromBinding = resolveTaskNotesModelConfigFromMdbaseType(legacyType);
	assert.equal(fromBinding.timeTracking.autoStopOnComplete, true);
	const fromRecord = resolveTaskNotesModelConfigFromMdbaseType(legacyType, {}, {
		settings: record({ auto_stop_time_tracking_on_complete: false }),
	});
	assert.equal(fromRecord.timeTracking.autoStopOnComplete, false);
	assert.equal(fromRecord.recurrence.resetCheckboxesOnRecurrence, true);
});

test("upgrades an rc.5 type by moving its settings out of the binding", () => {
	const type = buildTaskNotesMdbaseResources().type;
	type.implements[0].version = "0.3.0-rc.5";
	type.implements[0].binding = { ...type.implements[0].binding, ...legacyBinding(), "x-custom": 1 };
	const { type: upgraded, appSettings, upgraded: changed } = upgradeTaskNotesMdbaseTypeContract(type);
	const binding = upgraded.implements[0].binding;
	assert.equal(changed, true);
	assert.equal(upgraded.implements[0].version, "0.3.0-rc.6");
	assert.equal(binding.templating, undefined);
	assert.equal(binding.time_tracking, undefined);
	assert.equal(binding.nlp, undefined);
	assert.deepEqual(binding.archive, { archived_tag: "archived" });
	assert.equal(binding.status.definitions[0].next_status, undefined);
	assert.equal(binding["x-custom"], 1);
	assert.equal(appSettings.template_path, "Templates/Task.md");
	assert.equal(appSettings.auto_stop_time_tracking_on_complete, true);
	assert.equal(appSettings.status_behavior.open.next_status, "done");
	assert.equal(upgradeTaskNotesMdbaseTypeContract(upgraded).upgraded, false);
});

test("saves patch only changed fields, keep unknown content, and report conflicts", () => {
	const stored = record({ archive_folder: "Archive", "x-newer-client": true });
	assert.deepEqual(buildTaskNotesSettingsPatch(stored, { archive_folder: "Archive", move_on_archive: true }), { move_on_archive: true });
	assert.deepEqual(buildTaskNotesSettingsPatch(stored, { archive_folder: null }), { archive_folder: null });
	assert.deepEqual(buildTaskNotesSettingsPatch(stored, { archive_folder: "Archive" }), {});

	const markdown = writeAppSettingsDocument(null, {}, {
		frontmatter: newTaskNotesSettingsFrontmatter({ archive_folder: "Archive", template_path: undefined }),
		type: "tasknotes-settings",
		typeKey: "mdbase_type",
	});
	const edited = `${markdown.replace("scope:", "# kept\nscope:")}Notes stay.\n`;
	const next = writeAppSettingsDocument(edited, { move_on_archive: true, archive_folder: null });
	assert.match(next, /# kept/);
	assert.match(next, /Notes stay\.\n$/);
	assert.deepEqual(readAppSettingsFrontmatter(next), {
		mdbase_type: "tasknotes-settings",
		app: "dev.tasknotes",
		scope: "collection",
		settings_version: 1,
		move_on_archive: true,
	});

	assert.deepEqual(
		conflictingTaskNotesSettings(record({ archive_folder: "A" }), record({ archive_folder: "B" }), { archive_folder: "C", move_on_archive: true }),
		["archive_folder"],
	);
	assert.equal(resolveTaskNotesAppSettings(record({ settings_version: 2 })).readOnly !== undefined, true);
	assert.equal(resolveTaskNotesAppSettings(record({ app: "dev.other" })).readOnly !== undefined, true);
});

test("a migration adds only the fields an existing record lacks", () => {
	const existing = record({ archive_folder: "Theirs", status_behavior: { done: { auto_archive: false } } });
	const patch = absentTaskNotesSettingsPatch(existing, {
		archive_folder: "Mine",
		move_on_archive: true,
		status_behavior: { done: { auto_archive: true }, open: { next_status: "done" } },
	});
	assert.deepEqual(patch, {
		move_on_archive: true,
		status_behavior: { done: { auto_archive: false }, open: { next_status: "done" } },
	});
	assert.deepEqual(absentTaskNotesSettingsPatch({ ...existing, ...patch }, { archive_folder: "Mine", move_on_archive: true }), {});
});

test("publishes the settings contract, schema and type", () => {
	const resources = buildTaskNotesSettingsResources();
	assert.equal(resources.paths.record, TASKNOTES_SETTINGS_PATH);
	assert.equal(TASKNOTES_SETTINGS_PATH, "_settings/dev.tasknotes.md");
	assert.deepEqual(resources.type.collection, { unique: [{ field: "app", scope: "type" }] });
	assert.deepEqual(resources.type.implements.map(({ contract, version }) => `${contract}@${version}`), [
		"mdbase.app-settings@1.0.0",
		"tasknotes.settings@1.0.0",
	]);
	assert.equal(resources.type.schema.value.title, "tasknotes.settings 1.0.0");
});
