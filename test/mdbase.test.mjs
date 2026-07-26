import assert from "node:assert/strict";
import test from "node:test";
import YAML from "yaml";
import {
	buildTaskNotesMdbaseResources,
	resolveTaskNotesModelConfigFromMdbaseType,
} from "../dist/esm/mdbase.js";

test("builds one canonical TaskNotes and mdbase collection contract", () => {
	const resources = buildTaskNotesMdbaseResources();
	const type = resources.type;
	const extension = type["x-tasknotes"];
	const schema = type.schema.value;

	assert.equal(resources.config.spec_version, "0.3.0");
	assert.equal(extension.spec_version, "0.2.0");
	assert.deepEqual(extension.profiles, [
		"core-lite",
		"recurrence",
		"templating",
		"materialized-occurrences",
		"extended",
	]);
	assert.deepEqual(extension.capabilities, [
		"dependencies",
		"reminders",
		"links",
		"time-tracking",
		"materialized-occurrences",
		"archive",
		"templating",
	]);
	assert.equal(extension.field_roles.completedDate, "completedDate");
	assert.equal(extension.field_roles.id, "id");
	assert.deepEqual(type.collection.unique, [{ field: "id", scope: "type" }]);
	assert.deepEqual(type.lifecycle.on_create.set.id, { uuid: true });
	assert.deepEqual(schema.properties.completedDate, { type: "string", format: "date" });
	assert.deepEqual(schema.properties.dateModified, { type: "string", format: "date-time" });
	assert.deepEqual(YAML.parse(resources.configDocument), resources.config);

	const typeFrontmatter = resources.typeDocument.match(/^---\n([\s\S]*?)\n---\n/);
	assert.ok(typeFrontmatter);
	assert.deepEqual(YAML.parse(typeFrontmatter[1]), resources.type);
});

test("round-trips optional NLP trigger settings through the TaskNotes contract", () => {
	const resources = buildTaskNotesMdbaseResources({
		modelConfig: {
			nlp: {
				triggers: [
					{ propertyId: "tags", trigger: "#", enabled: true },
					{ propertyId: "priority", trigger: "!", enabled: false },
					{ propertyId: "energy", trigger: "~", enabled: true },
				],
			},
		},
	});

	assert.deepEqual(resources.type["x-tasknotes"].nlp, {
		triggers: [
			{ property_id: "tags", trigger: "#", enabled: true },
			{ property_id: "priority", trigger: "!", enabled: false },
			{ property_id: "energy", trigger: "~", enabled: true },
		],
	});
	assert.deepEqual(
		resolveTaskNotesModelConfigFromMdbaseType(resources.type).nlp,
		{
			triggers: [
				{ propertyId: "tags", trigger: "#", enabled: true },
				{ propertyId: "priority", trigger: "!", enabled: false },
				{ propertyId: "energy", trigger: "~", enabled: true },
			],
		}
	);
});

test("loads configured mappings and vocabularies from an mdbase task type", () => {
	const resources = buildTaskNotesMdbaseResources({
		modelConfig: {
			fieldMapping: { status: "state", completedDate: "finished" },
			statuses: [
				{ id: "queued", value: "queued", label: "Queued", color: "#aaa", isCompleted: false, order: 0, autoArchive: false, autoArchiveDelay: 0 },
				{ id: "closed", value: "closed", label: "Closed", color: "#0a0", isCompleted: true, order: 1, autoArchive: false, autoArchiveDelay: 0 },
			],
			defaults: { status: "queued" },
		},
	});
	const config = resolveTaskNotesModelConfigFromMdbaseType(resources.type);

	assert.equal(config.fieldMapping.status, "state");
	assert.equal(config.fieldMapping.completedDate, "finished");
	assert.equal(config.defaults.status, "queued");
	assert.deepEqual(config.statuses.map(({ value, isCompleted }) => ({ value, isCompleted })), [
		{ value: "queued", isCompleted: false },
		{ value: "closed", isCompleted: true },
	]);
});

test("projects configured mappings and status vocabularies into the type", () => {
	const resources = buildTaskNotesMdbaseResources({
		modelConfig: {
			fieldMapping: { completedDate: "finished_on", status: "state" },
			statuses: [
				{ id: "todo", value: "todo", label: "Todo", color: "#aaa", isCompleted: false, order: 0, autoArchive: false, autoArchiveDelay: 0 },
				{ id: "shipped", value: "shipped", label: "Shipped", color: "#0a0", isCompleted: true, order: 1, autoArchive: false, autoArchiveDelay: 0 },
			],
			defaults: { status: "todo" },
		},
	});
	const extension = resources.type["x-tasknotes"];
	const schema = resources.type.schema.value;

	assert.equal(extension.field_roles.completedDate, "finished_on");
	assert.deepEqual(extension.status.completed_values, ["shipped"]);
	assert.deepEqual(schema.properties.state, {
		enum: ["todo", "shipped"],
		default: "todo",
	});
	assert.deepEqual(schema.properties.finished_on, { type: "string", format: "date" });
});

test("recovers vocabularies from schema enums in older generated types", () => {
	const resources = buildTaskNotesMdbaseResources();
	const legacy = structuredClone(resources.type);
	delete legacy["x-tasknotes"].status.values;
	delete legacy["x-tasknotes"].priority.values;
	const config = resolveTaskNotesModelConfigFromMdbaseType(legacy);

	assert.deepEqual(config.statuses.map(({ value }) => value), [
		"none",
		"open",
		"in-progress",
		"done",
	]);
	assert.deepEqual(config.priorities.map(({ value }) => value), [
		"none",
		"low",
		"normal",
		"high",
	]);
	assert.equal(config.statuses.find(({ value }) => value === "done").isCompleted, true);
});

test("projects and resolves the complete portable TaskNotes settings snapshot", () => {
	const resources = buildTaskNotesMdbaseResources({
		tasksFolder: "TaskNotes/Tasks",
		typesFolder: "System/_types",
		modelConfig: {
			fieldMapping: {
				title: "summary",
				status: "state",
				priority: "importance",
				archiveTag: "filed-away",
			},
			statuses: [
				{
					id: "todo",
					value: "todo",
					label: "To do",
					color: "#888888",
					icon: "circle",
					isCompleted: false,
					isSkipped: false,
					excludeFromCycle: false,
					nextStatus: "done",
					order: 1,
					autoArchive: false,
					autoArchiveDelay: 5,
				},
				{
					id: "done",
					value: "done",
					label: "Done",
					color: "#00aa00",
					isCompleted: true,
					isSkipped: false,
					excludeFromCycle: false,
					order: 2,
					autoArchive: true,
					autoArchiveDelay: 15,
				},
				{
					id: "cancelled",
					value: "cancelled",
					label: "Cancelled",
					color: "#aa0000",
					isCompleted: false,
					isSkipped: true,
					excludeFromCycle: true,
					order: 3,
					autoArchive: false,
					autoArchiveDelay: 5,
				},
			],
			priorities: [
				{
					id: "routine",
					value: "routine",
					label: "Routine",
					color: "#777777",
					weight: 1,
				},
				{
					id: "critical",
					value: "critical",
					label: "Critical",
					color: "#ff0000",
					icon: "flame",
					weight: 5,
				},
			],
			defaults: { status: "todo", priority: "routine", taskTag: "action" },
			taskIdentification: {
				method: "property",
				tag: "action",
				propertyName: "isTask",
				propertyValue: "true",
			},
			storeTitleInFilename: false,
			recurrence: {
				maintainDueDateOffset: true,
				resetCheckboxesOnRecurrence: true,
			},
			occurrences: {
				defaultMaterialization: "rolling",
				defaultNextTrigger: "completion_or_skip",
				pastHorizon: "P1D",
				futureHorizon: "P21D",
			},
			timeTracking: {
				autoStopOnComplete: false,
				autoStopNotification: false,
				defaultSessionDescription: "Work",
			},
		},
		path: { template: "{{priority}}-{{title}}" },
		title: {
			filenameFormat: "custom",
			customFilenameTemplate: "{{priority}}-{{title}}",
		},
		links: { writeFormat: "markdown" },
		archive: { moveOnArchive: true, folder: "Archive/Tasks" },
		templating: {
			enabled: true,
			templatePath: "Templates/Task.md",
			occurrenceEnabled: true,
			occurrenceTemplatePath: "Templates/Occurrence.md",
		},
	});
	const extension = resources.type["x-tasknotes"];
	const resolved = resolveTaskNotesModelConfigFromMdbaseType(resources.type);

	assert.deepEqual(resources.type.match, { where: { isTask: { eq: true } } });
	assert.equal(resources.type.collection.path.folder, "TaskNotes/Tasks");
	assert.equal(resources.type.collection.path.template, "{{priority}}-{{title}}");
	assert.equal(extension.title.filename_format, "custom");
	assert.equal(extension.status.default_skipped, "cancelled");
	assert.equal(extension.status.definitions[1].auto_archive_delay_minutes, 15);
	assert.equal(extension.priority.definitions[1].icon, "flame");
	assert.deepEqual(extension.occurrences, {
		identity_roles: ["recurrenceParent", "occurrenceDate"],
		default_materialization: "rolling",
		default_next_trigger: "completion_or_skip",
		past_horizon: "P1D",
		future_horizon: "P21D",
	});
	assert.deepEqual(extension.templating, {
		enabled: true,
		template_path: "Templates/Task.md",
		occurrence_enabled: true,
		occurrence_template_path: "Templates/Occurrence.md",
	});
	assert.equal(resolved.fieldMapping.title, "summary");
	assert.equal(resolved.statuses.find(({ value }) => value === "done").autoArchiveDelay, 15);
	assert.equal(resolved.statuses.find(({ value }) => value === "cancelled").isSkipped, true);
	assert.equal(resolved.priorities.find(({ value }) => value === "critical").icon, "flame");
	assert.equal(resolved.occurrences.defaultMaterialization, "rolling");
	assert.equal(resolved.timeTracking.autoStopOnComplete, false);
});

test("emits a disclosed coercion-compatible schema for migrated v0.2 collections", () => {
	const resources = buildTaskNotesMdbaseResources({ legacyCompatibility: true });
	const properties = resources.type.schema.value.properties;

	assert.deepEqual(properties.title.type, ["string", "number", "boolean"]);
	assert.ok(properties.priority.anyOf.some((entry) => entry.type === "null"));
	assert.match(properties.dateCreated.pattern, /\[\+-\]/);
	assert.deepEqual(resources.type["x-legacy-v0.2"], {
		coercion_compatible_schema: true,
	});
	assert.equal(resources.type["x-tasknotes"].generator.legacy_compatibility, true);
});
