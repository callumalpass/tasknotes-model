import assert from "node:assert/strict";
import test from "node:test";
import {
	buildTaskNotesMdbaseResources,
	isTaskNotesVocabularyError,
	patchTaskNotesMdbaseTypeSettings,
	resolveTaskNotesModelConfigFromImplementation,
	resolveTaskNotesModelConfigFromMdbaseType,
	taskNotesMdbaseTypeDisagreements,
	TaskNotesVocabularyError,
	taskNotesUserFieldKey,
	taskNotesVocabularyInUse,
	taskNotesVocabularyProblem,
	taskNotesVocabularyValue,
} from "../dist/esm/mdbase.js";

const status = (value, label, isCompleted, extra = {}) => ({
	id: value,
	value,
	label,
	color: "#123456",
	isCompleted,
	order: 0,
	autoArchive: false,
	autoArchiveDelay: 5,
	...extra,
});

const AFTER = {
	statuses: [
		status("open", "To do", false, { order: 0 }),
		status("waiting", "Waiting", false, { order: 1, icon: "clock" }),
		status("dropped", "Dropped", false, { order: 2, isSkipped: true }),
		status("done", "Done", true, { order: 3 }),
		status("shipped", "Shipped", true, { order: 4 }),
	],
	priorities: [
		{ id: "someday", value: "someday", label: "Someday", color: "#aaaaaa", weight: 0 },
		{ id: "normal", value: "normal", label: "Normal", color: "#ffaa00", weight: 1 },
		{ id: "urgent", value: "urgent", label: "Urgent", color: "#ff0000", weight: 2, icon: "flame" },
	],
	userFields: [
		{ id: "client", key: "client", displayName: "Client", type: "text" },
		{ id: "points", key: "points", displayName: "Story points", type: "number" },
		{ id: "review_on", key: "review_on", displayName: "Review on", type: "date" },
		{ id: "billable", key: "billable", displayName: "Billable", type: "boolean" },
		{ id: "labels", key: "labels", displayName: "Labels", type: "list" },
	],
	defaults: { status: "waiting", priority: "urgent" },
};

/** The patch a host would send to turn the stock vocabulary into AFTER. */
function patchToAfter() {
	return {
		statuses: AFTER.statuses.map(({ value, label, color, isCompleted, isSkipped, icon }) => ({
			value,
			label,
			color,
			isCompleted,
			...(isSkipped !== undefined ? { isSkipped } : {}),
			...(icon !== undefined ? { icon } : {}),
		})),
		priorities: AFTER.priorities.map(({ value, label, color, icon }) => ({
			value,
			label,
			color,
			...(icon !== undefined ? { icon } : {}),
		})),
		userFields: {
			add: AFTER.userFields.map(({ key, displayName, type }) => ({ key, displayName, type })),
		},
		defaultStatus: AFTER.defaults.status,
		defaultPriority: AFTER.defaults.priority,
	};
}

for (const legacyCompatibility of [false, true]) {
	const mode = legacyCompatibility ? "a migrated v0.2 type" : "a canonical type";

	test(`editing ${mode} gives what the generator writes for the same settings`, () => {
		const before = buildTaskNotesMdbaseResources({ legacyCompatibility }).type;
		const generated = buildTaskNotesMdbaseResources({
			legacyCompatibility,
			modelConfig: AFTER,
		}).type;

		const edited = patchTaskNotesMdbaseTypeSettings(before, patchToAfter());

		assert.deepEqual(edited, generated);
	});

	test(`undoing an edit to ${mode} restores the generated type`, () => {
		const stock = buildTaskNotesMdbaseResources({ legacyCompatibility });
		const edited = patchTaskNotesMdbaseTypeSettings(stock.type, patchToAfter());
		const config = stock.modelConfig;

		const restored = patchTaskNotesMdbaseTypeSettings(edited, {
			statuses: config.statuses.map(({ value, label, color, isCompleted }) => ({
				value,
				label,
				color,
				isCompleted,
				isSkipped: false,
			})),
			priorities: config.priorities.map(({ value, label, color }) => ({ value, label, color })),
			userFields: { remove: AFTER.userFields.map(({ key }) => key) },
			defaultStatus: config.defaults.status,
			defaultPriority: config.defaults.priority,
		});

		assert.deepEqual(restored, stock.type);
	});
}

test("every copy of the status list agrees after an edit", () => {
	const type = buildTaskNotesMdbaseResources({
		modelConfig: { fieldMapping: { status: "state", completedDate: "finished" } },
	}).type;

	const edited = patchTaskNotesMdbaseTypeSettings(type, {
		statuses: [
			{ value: "open", label: "Open", color: "#808080", isCompleted: false },
			{ value: "shipped", label: "Shipped", color: "#00aa00", isCompleted: true },
		],
	});
	const schema = edited.schema.value;
	const binding = edited.implements[0].binding.status;

	assert.deepEqual(schema.properties.state.enum, ["open", "shipped"]);
	assert.deepEqual(binding.values, ["open", "shipped"]);
	assert.deepEqual(binding.definitions.map(({ value }) => value), ["open", "shipped"]);
	assert.deepEqual(binding.completed_values, ["shipped"]);
	assert.deepEqual(schema.allOf[0].if.properties.state.enum, ["shipped"]);
	assert.deepEqual(schema.allOf[0].then, { required: ["finished"] });
	assert.equal(edited.collection.read_defaults.state, "open");
});

test("an edit keeps what it does not name", () => {
	const type = buildTaskNotesMdbaseResources().type;
	const binding = type.implements[0].binding;
	binding.status.definitions[1]["x-host-note"] = "kept";
	binding.status.definitions[1].icon = "circle";
	binding.status.skipped_values = ["none"];
	binding.status.default_skipped = "none";
	type.schema.value.properties.client = { type: "string", description: "Hand-written" };
	type["x-host"] = { custom: true };

	const edited = patchTaskNotesMdbaseTypeSettings(type, {
		statuses: [
			{ value: "none", label: "None", color: "#cccccc", isCompleted: false },
			{ value: "open", label: "Open", color: "#808080", isCompleted: false },
			{ value: "done", label: "Done", color: "#00aa00", isCompleted: true },
		],
		userFields: { rename: [{ key: "client", displayName: "Customer" }] },
	});
	const status = edited.implements[0].binding.status;

	assert.equal(status.definitions[1]["x-host-note"], "kept");
	assert.equal(status.definitions[1].icon, "circle");
	assert.deepEqual(status.skipped_values, ["none"]);
	assert.equal(status.default_skipped, "none");
	assert.equal(status.definitions[0].is_skipped, true);
	assert.deepEqual(edited.schema.value.properties.client, {
		title: "Customer",
		type: "string",
		description: "Hand-written",
	});
	assert.deepEqual(edited["x-host"], { custom: true });
	assert.deepEqual(edited.implements[0].binding.priority, binding.priority);
	// The type handed in is not changed.
	assert.equal(type.schema.value.properties.client.title, undefined);
});

test("a status that stops being skipped leaves the skipped list", () => {
	const type = buildTaskNotesMdbaseResources().type;
	type.implements[0].binding.status.skipped_values = ["none"];
	type.implements[0].binding.status.default_skipped = "none";

	const edited = patchTaskNotesMdbaseTypeSettings(type, {
		statuses: [
			{ value: "open", label: "Open", color: "#808080", isCompleted: false },
			{ value: "done", label: "Done", color: "#00aa00", isCompleted: true },
		],
	});
	const status = edited.implements[0].binding.status;

	assert.deepEqual(status.skipped_values, []);
	assert.equal("default_skipped" in status, false);
});

test("custom field names are shared through the type", () => {
	const type = buildTaskNotesMdbaseResources({
		modelConfig: {
			userFields: [{ id: "client", key: "client", displayName: "Customer", type: "text" }],
		},
	}).type;

	assert.equal(type.schema.value.properties.client.title, "Customer");
	// A host that remembers another name still reads the type's.
	const resolved = resolveTaskNotesModelConfigFromMdbaseType(type, {
		userFields: [{ id: "f1", key: "client", displayName: "Old name", type: "text" }],
	});
	assert.deepEqual(resolved.userFields, [
		{ id: "f1", key: "client", displayName: "Customer", type: "text" },
	]);

	// Types written before titles keep the host's name.
	delete type.schema.value.properties.client.title;
	assert.equal(
		resolveTaskNotesModelConfigFromMdbaseType(type, {
			userFields: [{ id: "f1", key: "client", displayName: "Old name", type: "text" }],
		}).userFields[0].displayName,
		"Old name"
	);
});

test("refuses vocabulary a collection cannot hold", () => {
	const type = buildTaskNotesMdbaseResources().type;
	const open = { value: "open", label: "Open", color: "#808080", isCompleted: false };
	const done = { value: "done", label: "Done", color: "#00aa00", isCompleted: true };
	const problem = (patch) => {
		try {
			patchTaskNotesMdbaseTypeSettings(type, patch);
		} catch (error) {
			assert.ok(error instanceof TaskNotesVocabularyError);
			assert.ok(isTaskNotesVocabularyError(error));
			return error.problem;
		}
		return null;
	};

	assert.deepEqual(problem({ statuses: [open] }), { kind: "no-completed-status" });
	assert.deepEqual(problem({ statuses: [done] }), { kind: "no-open-status" });
	assert.deepEqual(problem({ statuses: [open, { ...done, label: " " }] }), {
		kind: "empty-label",
		list: "status",
	});
	assert.deepEqual(problem({ statuses: [open, done, { ...done }] }), {
		kind: "duplicate-value",
		list: "status",
		value: "done",
	});
	assert.deepEqual(problem({ statuses: [open, { ...done, isSkipped: true }] }), {
		kind: "completed-and-skipped",
		value: "done",
	});
	assert.deepEqual(
		problem({ statuses: [{ ...open, value: "todo" }, done] }),
		{ kind: "default-removed", list: "status", value: "open" }
	);
	assert.equal(
		problem({ statuses: [{ ...open, value: "todo" }, done], defaultStatus: "todo" }),
		null
	);
	assert.deepEqual(problem({ priorities: [] }), { kind: "no-priority" });
	assert.deepEqual(
		problem({ priorities: [{ value: "high", label: "High", color: "#f00" }] }),
		{ kind: "default-removed", list: "priority", value: "normal" }
	);
	assert.deepEqual(
		problem({ userFields: { add: [{ key: "my field", displayName: "My field", type: "text" }] } }),
		{ kind: "field-name", key: "my field" }
	);
	assert.deepEqual(
		problem({ userFields: { add: [{ key: "Status", displayName: "Status", type: "text" }] } }),
		{ kind: "field-taken", key: "Status" }
	);
	assert.deepEqual(
		problem({ userFields: { add: [{ key: "client", displayName: " ", type: "text" }] } }),
		{ kind: "field-label", key: "client" }
	);
	// A contract field is never removed as though it were a custom field.
	const kept = patchTaskNotesMdbaseTypeSettings(type, { userFields: { remove: ["due"] } });
	assert.deepEqual(kept.schema.value.properties.due, type.schema.value.properties.due);
});

test("finds tasks that hold a status or priority being removed", () => {
	const current = { statuses: ["open", "waiting", "done"], priorities: ["low", "high"] };
	const tasks = [
		{ status: "open", priority: "low" },
		{ status: "waiting", priority: "high" },
		{ status: "waiting" },
		{ status: null, priority: null },
	];
	const open = { value: "open", label: "Open", color: "", isCompleted: false };
	const done = { value: "done", label: "Done", color: "", isCompleted: true };

	const inUse = taskNotesVocabularyInUse(tasks, current, { statuses: [open, done] });
	assert.equal(inUse.list, "status");
	assert.equal(inUse.value, "waiting");
	assert.equal(inUse.count, 2);
	assert.match(inUse.message, /2 tasks still use the status "waiting"/);

	const priority = taskNotesVocabularyInUse(tasks, current, {
		priorities: [{ value: "low", label: "Low", color: "" }],
	});
	assert.equal(priority.list, "priority");
	assert.equal(priority.count, 1);

	assert.equal(
		taskNotesVocabularyInUse(tasks, current, {
			statuses: [open, { ...open, value: "waiting" }, done],
		}),
		null
	);
	assert.equal(taskNotesVocabularyInUse(tasks, current, {}), null);
});

test("checks a vocabulary before it is saved", () => {
	assert.equal(
		taskNotesVocabularyProblem(
			{
				statuses: [
					{ value: "open", label: "Open", color: "", isCompleted: false },
					{ value: "done", label: "Done", color: "", isCompleted: true },
				],
			},
			{ status: "open", priority: "normal" }
		),
		null
	);
});

test("makes stored values and property names from labels", () => {
	assert.equal(taskNotesVocabularyValue("  Waiting on Élodie ", []), "waiting-on-elodie");
	assert.equal(taskNotesVocabularyValue("Waiting", ["waiting", "waiting-2"]), "waiting-3");
	assert.equal(taskNotesVocabularyValue("保留", []), "保留");
	assert.equal(taskNotesVocabularyValue("!!!", []), "option");
	assert.equal(taskNotesUserFieldKey("Story points", []), "story_points");
	assert.equal(taskNotesUserFieldKey("2nd reviewer", []), "_2nd_reviewer");
	assert.equal(taskNotesUserFieldKey("Client", ["client", "CLIENT_2"]), "client_3");
	assert.equal(taskNotesUserFieldKey("保留", []), "field");
});

test("reports where a type states its vocabulary twice and the copies differ", () => {
	for (const legacyCompatibility of [false, true]) {
		const generated = buildTaskNotesMdbaseResources({ legacyCompatibility }).type;
		assert.deepEqual(taskNotesMdbaseTypeDisagreements(generated), []);
		assert.deepEqual(
			taskNotesMdbaseTypeDisagreements(
				patchTaskNotesMdbaseTypeSettings(generated, patchToAfter())
			),
			[]
		);
	}

	// The generator shares one list between the schema and the binding; a type
	// read back from a collection does not.
	const type = JSON.parse(JSON.stringify(buildTaskNotesMdbaseResources().type));
	const binding = type.implements[0].binding;
	// A hand edit: a status and a priority the binding does not describe, a
	// binding status the schema refuses, and defaults that moved in one place.
	type.schema.value.properties.status.enum.push("blocked");
	binding.status.values.push("waiting");
	binding.status.completed_values.push("cancelled");
	binding.status.default = "none";
	type.schema.value.properties.priority.enum.push("urgent");
	type.collection.read_defaults.priority = "high";

	assert.deepEqual(taskNotesMdbaseTypeDisagreements(type), [
		{
			list: "status",
			part: "schema-enum",
			binding: ["none", "open", "in-progress", "done", "waiting"],
			found: ["none", "open", "in-progress", "done", "blocked"],
		},
		{
			list: "status",
			part: "definitions",
			binding: ["none", "open", "in-progress", "done", "waiting"],
			found: ["none", "open", "in-progress", "done"],
		},
		{ list: "status", part: "schema-default", binding: ["none"], found: ["open"] },
		{ list: "status", part: "read-default", binding: ["none"], found: ["open"] },
		{
			list: "status",
			part: "completion-rule",
			binding: ["done", "cancelled"],
			found: ["done"],
		},
		{
			list: "priority",
			part: "schema-enum",
			binding: ["none", "low", "normal", "high"],
			found: ["none", "low", "normal", "high", "urgent"],
		},
		{ list: "priority", part: "read-default", binding: ["normal"], found: ["high"] },
	]);
	assert.deepEqual(taskNotesMdbaseTypeDisagreements({ kind: "mdbase.type", name: "note" }), []);
});

test("a value only the schema allows is still read, and saving the list repairs the type", () => {
	const type = JSON.parse(JSON.stringify(buildTaskNotesMdbaseResources().type));
	type.schema.value.properties.status.enum.push("blocked");
	type.schema.value.properties.priority.enum.push("urgent");

	const config = resolveTaskNotesModelConfigFromMdbaseType(type);
	assert.deepEqual(config.statuses.map(({ value }) => value), [
		"none",
		"open",
		"in-progress",
		"done",
		"blocked",
	]);
	assert.deepEqual(config.statuses.at(-1), {
		id: "blocked",
		value: "blocked",
		label: "Blocked",
		color: "#808080",
		isCompleted: false,
		isSkipped: false,
		excludeFromCycle: false,
		order: 4,
		autoArchive: false,
		autoArchiveDelay: 5,
	});
	assert.equal(config.priorities.at(-1).value, "urgent");

	const repaired = patchTaskNotesMdbaseTypeSettings(type, {
		statuses: config.statuses.map(({ value, label, color, isCompleted }) => ({
			value,
			label,
			color,
			isCompleted,
		})),
		priorities: config.priorities.map(({ value, label, color }) => ({ value, label, color })),
	});
	assert.deepEqual(taskNotesMdbaseTypeDisagreements(repaired), []);
	assert.deepEqual(repaired.implements[0].binding.status.values.at(-1), "blocked");
});

test("resolves a configuration from what an authority describes, without the type document", () => {
	const resources = buildTaskNotesMdbaseResources({
		modelConfig: {
			...AFTER,
			fieldMapping: { status: "state", due: "deadline" },
			taskIdentification: { method: "property", propertyName: "kind", propertyValue: "task" },
		},
	});
	const type = resources.type;
	const implementation = type.implements[0];

	const fromImplementation = resolveTaskNotesModelConfigFromImplementation({
		fields: implementation.fields,
		binding: implementation.binding,
		schema: type.schema.value,
		match: type.match,
	});

	assert.deepEqual(fromImplementation, resolveTaskNotesModelConfigFromMdbaseType(type));
	assert.equal(fromImplementation.fieldMapping.status, "state");
	assert.equal(fromImplementation.taskIdentification.propertyName, "kind");
	assert.deepEqual(
		fromImplementation.userFields.map(({ key, displayName }) => [key, displayName]),
		AFTER.userFields.map(({ key, displayName }) => [key, displayName])
	);
	// Nothing but defaults when the authority describes nothing.
	assert.deepEqual(
		resolveTaskNotesModelConfigFromImplementation({}).statuses,
		resolveTaskNotesModelConfigFromMdbaseType(undefined).statuses
	);
});

test("reads the camel-case spellings early bindings used", () => {
	const type = buildTaskNotesMdbaseResources().type;
	const binding = type.implements[0].binding;
	binding.status.completed_values = [];
	binding.status.definitions = binding.status.definitions.map(
		({ is_completed, is_skipped, ...definition }) => ({
			...definition,
			isCompleted: is_completed,
			isSkipped: definition.value === "none",
		})
	);
	binding.occurrences = {
		defaultMaterialization: "rolling",
		defaultNextTrigger: "completion_or_skip",
		pastHorizon: "P2D",
		futureHorizon: "P30D",
	};

	const config = resolveTaskNotesModelConfigFromMdbaseType(type);

	assert.equal(config.statuses.find(({ value }) => value === "done").isCompleted, true);
	assert.equal(config.statuses.find(({ value }) => value === "none").isSkipped, true);
	assert.deepEqual(
		{
			defaultMaterialization: config.occurrences.defaultMaterialization,
			defaultNextTrigger: config.occurrences.defaultNextTrigger,
			pastHorizon: config.occurrences.pastHorizon,
			futureHorizon: config.occurrences.futureHorizon,
		},
		{
			defaultMaterialization: "rolling",
			defaultNextTrigger: "completion_or_skip",
			pastHorizon: "P2D",
			futureHorizon: "P30D",
		}
	);
});
