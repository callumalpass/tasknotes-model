import YAML from "yaml";
import { resolveModelConfig } from "./config";
import {
	TASKNOTES_TASK_BINDING_SCHEMA,
	TASKNOTES_TASK_COMPLETED_EVENT_SCHEMA,
	TASKNOTES_TASK_SCHEMA,
} from "./generated/tasknotes-data-contract";
import { TASKNOTES_SPEC_VERSION } from "./types";
import type {
	FieldMapping,
	PriorityConfig,
	StatusConfig,
	TaskNotesModelConfig,
	UserMappedField,
} from "./types";

export const MDBASE_SPEC_VERSION = "0.3.0";
export const TASKNOTES_TASK_CONTRACT_VERSION = TASKNOTES_SPEC_VERSION;
export const TASKNOTES_TASK_COMPLETED_EVENT_VERSION = "1.0.0";

export const TASKNOTES_TASK_COMPLETED_EVENT_CONTRACT = {
	kind: "mdbase.contract",
	contract_type: "event",
	id: "tasknotes.task.completed",
	version: TASKNOTES_TASK_COMPLETED_EVENT_VERSION,
	name: "TaskNotes task completed",
	description:
		"A TaskNotes task moved from a non-completed status to a completed status.",
	data_schema: {
		dialect: "json-schema-2020-12",
		value: TASKNOTES_TASK_COMPLETED_EVENT_SCHEMA,
	},
} as const;

export const DEFAULT_TASKNOTES_MDBASE_PROFILES = [
	"core-lite",
	"recurrence",
	"templating",
	"materialized-occurrences",
	"extended",
] as const;

export const DEFAULT_TASKNOTES_MDBASE_CAPABILITIES = [
	"dependencies",
	"reminders",
	"links",
	"time-tracking",
	"materialized-occurrences",
	"archive",
	"templating",
] as const;

export interface TaskNotesMdbaseOptions {
	typeName?: string;
	tasksFolder?: string;
	typesFolder?: string;
	contractsFolder?: string;
	schemasFolder?: string;
	modelConfig?: Partial<TaskNotesModelConfig>;
	profiles?: readonly string[];
	capabilities?: readonly string[];
	legacyCompatibility?: boolean;
	collection?: {
		name?: string;
		description?: string;
		validation?: "off" | "warn" | "error";
		exclude?: readonly string[];
	};
	path?: {
		runtime?: string;
		template?: string;
		generatedBy?: string;
	};
	title?: {
		filenameFormat?: "title" | "zettel" | "timestamp" | "uuid" | "custom";
		customFilenameTemplate?: string;
	};
	links?: {
		writeFormat?: "wikilink" | "markdown";
	};
	archive?: {
		moveOnArchive?: boolean;
		folder?: string;
	};
	templating?: {
		enabled?: boolean;
		templatePath?: string;
		occurrenceEnabled?: boolean;
		occurrenceTemplatePath?: string;
	};
	stableId?: boolean;
}

export interface TaskNotesMdbaseResources {
	config: Record<string, unknown>;
	contract: Record<string, unknown>;
	type: Record<string, unknown>;
	taskSchema: Record<string, unknown>;
	bindingSchema: Record<string, unknown>;
	configDocument: string;
	contractDocument: string;
	typeDocument: string;
	taskSchemaDocument: string;
	bindingSchemaDocument: string;
	paths: {
		config: "mdbase.yaml";
		contract: string;
		type: string;
		taskSchema: string;
		bindingSchema: string;
		records: string;
	};
	modelConfig: TaskNotesModelConfig;
}

export interface TaskNotesMdbaseTypePack {
	manifest: {
		kind: "mdbase.type-pack";
		id: "tasknotes.task";
		version: string;
		name: string;
		description: string;
		resources: Array<{
			kind: "contract" | "type" | "schema";
			source: string;
			target: string;
			digest: string;
		}>;
	};
	resources: Array<{ source: string; document: string }>;
	provides: Array<{ id: "tasknotes.task"; version: string }>;
}

export interface TaskNotesMdbaseTypeSettingsPatch {
	defaultStatus?: string;
	defaultPriority?: string;
	recurrence?: {
		maintainDueDateOffset?: boolean;
		resetCheckboxesOnRecurrence?: boolean;
	};
	occurrences?: {
		defaultMaterialization?: "manual" | "on_completion" | "rolling";
		defaultNextTrigger?: "completion" | "completion_or_skip";
		pastHorizon?: string;
		futureHorizon?: string;
	};
	timeTracking?: {
		autoStopOnComplete?: boolean;
	};
	links?: {
		writeFormat?: "wikilink" | "markdown";
	};
	archive?: {
		moveOnArchive?: boolean;
		folder?: string;
	};
	templating?: {
		enabled?: boolean;
		templatePath?: string;
	};
	statusAutomation?: Record<
		string,
		{
			autoArchive?: boolean;
			autoArchiveDelay?: number;
		}
	>;
}

type LifecycleEvent = "on_create" | "on_update";

interface FieldOptions {
	required?: boolean;
	legacyNullable?: boolean;
	defaultValue?: unknown;
	createValue?: Record<string, unknown>;
	updateValue?: Record<string, unknown>;
	links?: Array<{ suffix?: string; targetType: "task" | "any" }>;
}

/**
 * Patch portable TaskNotes model settings in an existing mdbase type.
 *
 * The patch is deliberately constrained to settings whose schema vocabulary
 * does not change. Custom properties, collection paths, lifecycle rules, and
 * host extensions remain untouched.
 */
export function patchTaskNotesMdbaseTypeSettings(
	type: Record<string, unknown>,
	patch: TaskNotesMdbaseTypeSettingsPatch
): Record<string, unknown> {
	const result = cloneValue(type) as Record<string, unknown>;
	const implementation = taskNotesImplementation(result);
	if (!implementation) {
		throw new Error("The mdbase type is not a TaskNotes task contract.");
	}
	const binding = isRecord(implementation.binding) ? implementation.binding : {};
	implementation.binding = binding;
	const model = resolveTaskNotesModelConfigFromMdbaseType(result);
	const status = contractSection(binding, "status");
	const priority = contractSection(binding, "priority");
	const recurrence = contractSection(binding, "recurrence");
	const occurrences = contractSection(binding, "occurrences");
	const timeTracking = contractSection(binding, "time_tracking");
	const links = contractSection(binding, "links");
	const archive = contractSection(binding, "archive");
	const templating = contractSection(binding, "templating");
	const properties = isRecord(isRecord(result.schema) ? result.schema.value : undefined)
		? (result.schema as Record<string, any>).value.properties
		: undefined;
	const collection = isRecord(result.collection) ? result.collection : {};
	const readDefaults = isRecord(collection.read_defaults)
		? collection.read_defaults
		: {};
	collection.read_defaults = readDefaults;
	result.collection = collection;

	if (patch.defaultStatus !== undefined) {
		const value = requiredConfiguredValue(
			patch.defaultStatus,
			model.statuses.map((entry) => entry.value),
			"default status"
		);
		status.default = value;
		readDefaults[model.fieldMapping.status] = value;
		if (isRecord(properties))
			applySchemaDefault(properties[model.fieldMapping.status], value);
	}
	if (patch.defaultPriority !== undefined) {
		const value = requiredConfiguredValue(
			patch.defaultPriority,
			model.priorities.map((entry) => entry.value),
			"default priority"
		);
		priority.default = value;
		readDefaults[model.fieldMapping.priority] = value;
		if (isRecord(properties))
			applySchemaDefault(properties[model.fieldMapping.priority], value);
	}
	if (patch.recurrence?.maintainDueDateOffset !== undefined)
		recurrence.maintain_due_date_offset =
			patch.recurrence.maintainDueDateOffset;
	if (patch.recurrence?.resetCheckboxesOnRecurrence !== undefined)
		recurrence.reset_body_checkboxes =
			patch.recurrence.resetCheckboxesOnRecurrence;
	if (patch.occurrences?.defaultMaterialization !== undefined) {
		occurrences.default_materialization =
			patch.occurrences.defaultMaterialization;
		readDefaults[model.fieldMapping.occurrenceMaterialization] =
			patch.occurrences.defaultMaterialization;
	}
	if (patch.occurrences?.defaultNextTrigger !== undefined) {
		occurrences.default_next_trigger = patch.occurrences.defaultNextTrigger;
		readDefaults[model.fieldMapping.occurrenceNextTrigger] =
			patch.occurrences.defaultNextTrigger;
	}
	if (patch.occurrences?.pastHorizon !== undefined)
		occurrences.past_horizon = requiredDuration(
			patch.occurrences.pastHorizon,
			"past occurrence horizon"
		);
	if (patch.occurrences?.futureHorizon !== undefined)
		occurrences.future_horizon = requiredDuration(
			patch.occurrences.futureHorizon,
			"future occurrence horizon"
		);
	if (patch.timeTracking?.autoStopOnComplete !== undefined)
		timeTracking.auto_stop_on_complete =
			patch.timeTracking.autoStopOnComplete;
	if (patch.links?.writeFormat !== undefined)
		links.write_format = patch.links.writeFormat;
	if (patch.archive?.moveOnArchive !== undefined)
		archive.move_on_archive = patch.archive.moveOnArchive;
	if (patch.archive?.folder !== undefined)
		archive.folder = cleanPath(patch.archive.folder, "archive folder");
	if (patch.templating?.templatePath !== undefined) {
		const path = patch.templating.templatePath.trim();
		if (path) templating.template_path = cleanPath(path, "template path");
		else delete templating.template_path;
	}
	if (patch.templating?.enabled !== undefined) {
		if (
			patch.templating.enabled &&
			!stringValue(templating.template_path)
		)
			throw new Error(
				"template path must be set before task templating is enabled."
			);
		templating.enabled = patch.templating.enabled;
	}
	if (patch.statusAutomation) {
		const supplied = new Map(Object.entries(patch.statusAutomation));
		const definitions = definitionMap(status.definitions);
		for (const value of supplied.keys()) {
			if (!model.statuses.some((candidate) => candidate.value === value))
				throw new Error(`Unknown task status "${value}".`);
		}
		status.definitions = model.statuses.map((entry) => {
			const automation = supplied.get(entry.value);
			const definition = {
				...(definitions.get(entry.value) ?? statusDefinition(entry)),
			};
			if (automation?.autoArchive !== undefined)
				definition.auto_archive = automation.autoArchive;
			if (automation?.autoArchiveDelay !== undefined) {
				if (
					!Number.isInteger(automation.autoArchiveDelay) ||
					automation.autoArchiveDelay < 0
				)
					throw new Error(
						`Auto-archive delay for "${entry.value}" must be a non-negative integer.`
					);
				definition.auto_archive_delay_minutes =
					automation.autoArchiveDelay;
			}
			return definition;
		});
	}

	return result;
}

/**
 * Build the canonical mdbase v0.3 collection files shared by every TaskNotes host.
 *
 * Hosts provide their effective TaskNotes settings and perform the actual IO.
 * The returned object model is authoritative; the documents are deterministic
 * serializations for filesystem-backed collections.
 */
export function buildTaskNotesMdbaseResources(
	options: TaskNotesMdbaseOptions = {}
): TaskNotesMdbaseResources {
	const typeName = cleanSegment(options.typeName ?? "task", "typeName");
	const tasksFolder = cleanOptionalPath(options.tasksFolder ?? "tasks", "tasksFolder");
	const typesFolder = cleanPath(options.typesFolder ?? "_types", "typesFolder");
	const contractsFolder = cleanPath(
		options.contractsFolder ?? "_contracts",
		"contractsFolder"
	);
	const schemasFolder = cleanPath(
		options.schemasFolder ?? "_schemas/tasknotes",
		"schemasFolder"
	);
	if (contractsFolder === typesFolder) {
		throw new Error("contractsFolder must differ from typesFolder.");
	}
	const modelConfig = resolveModelConfig(options.modelConfig);
	const profiles = uniqueStrings(options.profiles ?? DEFAULT_TASKNOTES_MDBASE_PROFILES);
	const capabilities = uniqueStrings(
		options.capabilities ?? DEFAULT_TASKNOTES_MDBASE_CAPABILITIES
	);
	const legacyCompatibility = options.legacyCompatibility === true;
	const statusValues = uniqueStrings(modelConfig.statuses.map((status) => status.value));
	const priorityValues = uniqueStrings(modelConfig.priorities.map((priority) => priority.value));
	const completedValues = uniqueStrings(
		modelConfig.statuses.filter((status) => status.isCompleted).map((status) => status.value)
	);
	const skippedValues = uniqueStrings(
		modelConfig.statuses.filter((status) => status.isSkipped === true).map((status) => status.value)
	);

	validateVocabulary(modelConfig, statusValues, priorityValues, completedValues);

	const collectionName = options.collection?.name?.trim() || "TaskNotes";
	const collectionDescription =
		options.collection?.description?.trim() ||
		"Task collection managed by TaskNotes for Obsidian";
	const excludes = uniqueStrings(options.collection?.exclude ?? [typesFolder]);
	const config = {
		spec_version: MDBASE_SPEC_VERSION,
		name: collectionName,
		description: collectionDescription,
		settings: {
			types_folder: typesFolder,
			contracts_folder: contractsFolder,
			record_extensions: ["md"],
			validation: options.collection?.validation ?? "warn",
			explicit_type_keys: ["type", "types"],
			id_field: "id",
			...(excludes.length > 0 ? { exclude: excludes } : {}),
		},
	};

	const properties: Record<string, unknown> = {};
	const required: string[] = [];
	const readDefaults: Record<string, unknown> = {};
	const links: Record<string, unknown> = {};
	const fieldRoles: Record<string, string> = {};
	const lifecycle: Record<string, unknown> = {};
	const omittedCollectionPaths = new Set<string>();
	const mapping = modelConfig.fieldMapping;

	const addField = (
		role: string,
		fieldName: string,
		schema: Record<string, unknown>,
		fieldOptions: FieldOptions = {}
	): void => {
		properties[fieldName] =
			legacyCompatibility &&
			fieldOptions.required !== true &&
			fieldOptions.legacyNullable !== false
			? nullable(schema)
			: schema;
		fieldRoles[role] = fieldName;
		if (fieldOptions.required === true) required.push(fieldName);
		if (fieldOptions.defaultValue !== undefined) {
			applySchemaDefault(properties[fieldName], fieldOptions.defaultValue);
			readDefaults[fieldName] = cloneValue(fieldOptions.defaultValue);
		}
		if (fieldOptions.createValue) {
			addLifecycleValue(
				lifecycle,
				"on_create",
				fieldName,
				fieldOptions.createValue,
				omittedCollectionPaths
			);
		}
		if (fieldOptions.updateValue) {
			addLifecycleValue(
				lifecycle,
				"on_update",
				fieldName,
				fieldOptions.updateValue,
				omittedCollectionPaths
			);
		}
		for (const link of fieldOptions.links ?? []) {
			const path = `${fieldName}${link.suffix ?? ""}`;
			if (!isMdbaseFieldPath(path)) {
				omittedCollectionPaths.add(path);
				continue;
			}
			links[path] = {
				target_type: link.targetType,
				validate_exists: false,
			};
		}
	};

	if (options.stableId !== false) {
		addField("id", "id", stringSchema({ minLength: 1 }, legacyCompatibility), {
			createValue: { uuid: true },
		});
	}

	addField(
		"title",
		mapping.title,
		stringSchema({ minLength: 1 }, legacyCompatibility),
		{
			required: !modelConfig.storeTitleInFilename,
			legacyNullable: false,
		}
	);
	addField("status", mapping.status, { enum: statusValues }, {
		required: true,
		defaultValue: modelConfig.defaults.status,
	});
	addField("priority", mapping.priority, { enum: priorityValues }, {
		defaultValue: modelConfig.defaults.priority,
	});
	addField("due", mapping.due, taskDateSchema(legacyCompatibility));
	addField("scheduled", mapping.scheduled, taskDateSchema(legacyCompatibility));
	addField("contexts", mapping.contexts, arraySchema(stringSchema({}, legacyCompatibility), legacyCompatibility));
	addField(
		"projects",
		mapping.projects,
		arraySchema(stringSchema({}, legacyCompatibility), legacyCompatibility),
		{ links: [{ suffix: "[]", targetType: "any" }] }
	);
	addField(
		"timeEstimate",
		mapping.timeEstimate,
		integerSchema({ minimum: 0 }, legacyCompatibility)
	);
	addField("completedDate", mapping.completedDate, dateSchema(legacyCompatibility));
	addField("dateCreated", mapping.dateCreated, dateTimeSchema(legacyCompatibility), {
		required: true,
		createValue: { now: true },
	});
	addField("dateModified", mapping.dateModified, dateTimeSchema(legacyCompatibility), {
		createValue: { now: true },
		updateValue: { now: true },
	});
	addField("recurrence", mapping.recurrence, stringSchema({}, legacyCompatibility));
	addField("recurrenceAnchor", mapping.recurrenceAnchor, {
		enum: ["scheduled", "completion"],
	}, { defaultValue: "scheduled" });
	addField(
		"occurrenceMaterialization",
		mapping.occurrenceMaterialization,
		{ enum: ["manual", "on_completion", "rolling"] },
		{ defaultValue: modelConfig.occurrences.defaultMaterialization }
	);
	addField(
		"occurrenceNextTrigger",
		mapping.occurrenceNextTrigger,
		{ enum: ["completion", "completion_or_skip"] },
		{ defaultValue: modelConfig.occurrences.defaultNextTrigger }
	);
	addField(
		"occurrenceTemplate",
		mapping.occurrenceTemplate,
		stringSchema({}, legacyCompatibility),
		{ links: [{ targetType: "any" }] }
	);
	addField(
		"occurrencePastHorizon",
		mapping.occurrencePastHorizon,
		stringSchema({}, legacyCompatibility)
	);
	addField(
		"occurrenceFutureHorizon",
		mapping.occurrenceFutureHorizon,
		stringSchema({}, legacyCompatibility)
	);
	addField(
		"recurrenceParent",
		mapping.recurrenceParent,
		stringSchema({}, legacyCompatibility),
		{ links: [{ targetType: "task" }] }
	);
	addField("occurrenceDate", mapping.occurrenceDate, dateSchema(legacyCompatibility));
	addField(
		"tags",
		"tags",
		arraySchema(stringSchema({}, legacyCompatibility), legacyCompatibility)
	);
	addField("timeEntries", mapping.timeEntries, timeEntriesSchema(legacyCompatibility));
	addField("reminders", mapping.reminders, reminderSchema(legacyCompatibility));
	addField("blockedBy", mapping.blockedBy, dependenciesSchema(legacyCompatibility), {
		links: [{ suffix: "[].uid", targetType: "task" }],
	});
	addField(
		"completeInstances",
		mapping.completeInstances,
		arraySchema(dateSchema(legacyCompatibility), legacyCompatibility)
	);
	addField(
		"skippedInstances",
		mapping.skippedInstances,
		arraySchema(dateSchema(legacyCompatibility), legacyCompatibility)
	);
	addField(
		"icsEventId",
		mapping.icsEventId,
		arraySchema(stringSchema({}, legacyCompatibility), legacyCompatibility)
	);
	addField(
		"googleCalendarEventId",
		mapping.googleCalendarEventId,
		stringSchema({}, legacyCompatibility)
	);
	addField(
		"googleCalendarExceptionEventId",
		mapping.googleCalendarExceptionEventId,
		stringSchema({}, legacyCompatibility)
	);
	addField(
		"googleCalendarExceptionOriginalScheduled",
		mapping.googleCalendarExceptionOriginalScheduled,
		dateSchema(legacyCompatibility)
	);
	addField(
		"googleCalendarMovedOriginalDates",
		mapping.googleCalendarMovedOriginalDates,
		arraySchema(dateSchema(legacyCompatibility), legacyCompatibility)
	);
	addField("sortOrder", mapping.sortOrder, numberSchema({}, legacyCompatibility));

	for (const userField of modelConfig.userFields) {
		properties[userField.key] = userFieldSchema(userField, legacyCompatibility);
		if (userField.defaultValue !== undefined) {
			applySchemaDefault(properties[userField.key], userField.defaultValue);
			readDefaults[userField.key] = cloneValue(userField.defaultValue);
		}
	}

	const titleField = fieldRoles.title;
	const collection: Record<string, unknown> = {
		read_defaults: readDefaults,
		links,
		path: {
			runtime: options.path?.runtime?.trim() || "tasknotes",
			template: options.path?.template?.trim() || defaultFilenameTemplate(modelConfig),
			folder: tasksFolder,
			generated_by: options.path?.generatedBy?.trim() || "tasknotes.filename.create",
		},
	};
	if (isMdbaseFieldPath(titleField)) {
		collection.display = { name_field: titleField };
	} else {
		omittedCollectionPaths.add(titleField);
	}
	if (options.stableId !== false) {
		collection.unique = [{ field: "id", scope: "type" }];
	}

	const filenameFormat =
		options.title?.filenameFormat ??
		(modelConfig.storeTitleInFilename ? "title" : "zettel");
	const customFilenameTemplate = options.title?.customFilenameTemplate?.trim();
	if (filenameFormat === "custom" && !customFilenameTemplate) {
		throw new Error("A custom TaskNotes filename format requires a template.");
	}
	const defaultSkipped = skippedValues[0];
	const templatePath = options.templating?.templatePath?.trim();
	const occurrenceTemplatePath = options.templating?.occurrenceTemplatePath?.trim();
	const templateEnabled = options.templating?.enabled === true && Boolean(templatePath);
	const occurrenceTemplateEnabled =
		options.templating?.occurrenceEnabled === true && Boolean(occurrenceTemplatePath);
	const binding: Record<string, unknown> = {
		profiles,
		capabilities,
		title: {
			storage: modelConfig.storeTitleInFilename ? "filename" : "frontmatter",
			filename_format: filenameFormat,
			...(filenameFormat === "custom"
				? { custom_filename_template: customFilenameTemplate }
				: {}),
		},
		status: {
			values: statusValues,
			default: modelConfig.defaults.status,
			completed_values: completedValues,
			skipped_values: skippedValues,
			...(defaultSkipped ? { default_skipped: defaultSkipped } : {}),
			definitions: modelConfig.statuses.map(statusDefinition),
		},
		priority: {
			values: priorityValues,
			default: modelConfig.defaults.priority,
			definitions: modelConfig.priorities.map(priorityDefinition),
		},
		recurrence: {
			syntax: "tasknotes",
			maintain_due_date_offset: modelConfig.recurrence.maintainDueDateOffset,
			reset_body_checkboxes: modelConfig.recurrence.resetCheckboxesOnRecurrence,
		},
		occurrences: {
			identity_roles: ["recurrenceParent", "occurrenceDate"],
			default_materialization: modelConfig.occurrences.defaultMaterialization,
			default_next_trigger: modelConfig.occurrences.defaultNextTrigger,
			...(modelConfig.occurrences.pastHorizon?.trim()
				? { past_horizon: modelConfig.occurrences.pastHorizon.trim() }
				: {}),
			...(modelConfig.occurrences.futureHorizon?.trim()
				? { future_horizon: modelConfig.occurrences.futureHorizon.trim() }
				: {}),
		},
		links: {
			accepted_formats: ["wikilink", "markdown"],
			write_format: options.links?.writeFormat ?? "wikilink",
		},
		archive: {
			archived_tag: mapping.archiveTag,
			move_on_archive: options.archive?.moveOnArchive === true,
			...(options.archive?.folder?.trim() ? { folder: options.archive.folder.trim() } : {}),
		},
		time_tracking: {
			auto_stop_on_complete: modelConfig.timeTracking.autoStopOnComplete,
		},
		...(modelConfig.nlp
			? {
					nlp: {
						triggers: modelConfig.nlp.triggers.map((trigger) => ({
							property_id: trigger.propertyId,
							trigger: trigger.trigger,
							enabled: trigger.enabled,
						})),
					},
				}
			: {}),
		templating: {
			enabled: templateEnabled,
			...(templatePath ? { template_path: templatePath } : {}),
			occurrence_enabled: occurrenceTemplateEnabled,
			...(occurrenceTemplatePath
				? { occurrence_template_path: occurrenceTemplatePath }
				: {}),
		},
	};
	const generator: Record<string, unknown> = {
		managed_fields: Object.keys(properties).sort(),
	};
	if (omittedCollectionPaths.size > 0 || legacyCompatibility) {
		Object.assign(generator, {
			...(omittedCollectionPaths.size > 0
				? { omitted_collection_paths: [...omittedCollectionPaths].sort() }
				: {}),
			...(legacyCompatibility ? { legacy_compatibility: true } : {}),
		});
	}

	const schema: Record<string, unknown> = {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		type: "object",
		additionalProperties: true,
		properties,
		allOf: [
			{
				if: {
					required: [mapping.status],
					properties: { [mapping.status]: { enum: completedValues } },
					not: { required: [mapping.recurrence] },
				},
				then: { required: [mapping.completedDate] },
			},
		],
	};
	const requiredFields = uniqueStrings(required);
	if (requiredFields.length > 0) schema.required = requiredFields;

	const type: Record<string, unknown> = {
		kind: "mdbase.type",
		name: typeName,
		version: 1,
		description: "A task managed by TaskNotes.",
		match: buildMatch(modelConfig),
		schema: {
			dialect: "json-schema-2020-12",
			value: schema,
		},
		collection,
		lifecycle,
		implements: [
			{
				contract: "tasknotes.task",
				version: TASKNOTES_SPEC_VERSION,
				fields: fieldRoles,
				binding,
			},
		],
		"x-tasknotes-generator": generator,
		...(legacyCompatibility
			? { "x-legacy-v0.2": { coercion_compatible_schema: true } }
			: {}),
	};
	const taskSchema = cloneValue(TASKNOTES_TASK_SCHEMA) as Record<string, unknown>;
	const bindingSchema = cloneValue(
		TASKNOTES_TASK_BINDING_SCHEMA
	) as Record<string, unknown>;
	const contract: Record<string, unknown> = {
		kind: "mdbase.contract",
		contract_type: "record",
		id: "tasknotes.task",
		version: TASKNOTES_SPEC_VERSION,
		name: "TaskNotes task",
		description: `Portable task data and behavior defined by tasknotes-spec ${TASKNOTES_SPEC_VERSION}.`,
		record_schema: {
			dialect: "json-schema-2020-12",
			ref: relativeResourceReference(
				`${contractsFolder}/tasknotes.task.md`,
				`${schemasFolder}/tasknotes-task.schema.json`
			),
		},
		binding_schema: {
			dialect: "json-schema-2020-12",
			ref: relativeResourceReference(
				`${contractsFolder}/tasknotes.task.md`,
				`${schemasFolder}/tasknotes-task-binding.schema.json`
			),
		},
	};
	const taskSchemaDocument = `${JSON.stringify(taskSchema, null, 2)}\n`;
	const bindingSchemaDocument = `${JSON.stringify(bindingSchema, null, 2)}\n`;
	const contractDocument = [
		"---",
		YAML.stringify(contract, { lineWidth: 0 }).trimEnd(),
		"---",
		"",
		"# TaskNotes task contract",
		"",
		"Types implement this contract through `implements`; applications consume",
		"the normalized contract view rather than assuming frontmatter names.",
		"",
	].join("\n");

	return {
		config,
		contract,
		type,
		taskSchema,
		bindingSchema,
		configDocument: `${YAML.stringify(config, { lineWidth: 0 }).trimEnd()}\n`,
		contractDocument,
		typeDocument: [
			"---",
			YAML.stringify(type, { lineWidth: 0 }).trimEnd(),
			"---",
			"",
			"# Task",
			"",
			"This type definition implements the TaskNotes contract for this mdbase collection.",
			"Its JSON Schema describes persisted task frontmatter; collection and lifecycle",
			"metadata describe generic mdbase behavior; `implements` maps the portable",
			"TaskNotes task view and supplies TaskNotes behavior.",
			"",
			"Changes made here are loaded by TaskNotes. Portable changes made in TaskNotes",
			"settings are written back while unknown extensions are preserved.",
			"",
		].join("\n"),
		taskSchemaDocument,
		bindingSchemaDocument,
		paths: {
			config: "mdbase.yaml",
			contract: `${contractsFolder}/tasknotes.task.md`,
			type: `${typesFolder}/${typeName}.md`,
			taskSchema: `${schemasFolder}/tasknotes-task.schema.json`,
			bindingSchema: `${schemasFolder}/tasknotes-task-binding.schema.json`,
			records: tasksFolder,
		},
		modelConfig,
	};
}

/**
 * Package generated TaskNotes artifacts as one connector-installable transaction.
 *
 * The pack deliberately excludes `mdbase.yaml`: applications may add this
 * contract to an existing collection without taking ownership of collection
 * configuration.
 */
export async function buildTaskNotesMdbaseTypePack(
	resources: TaskNotesMdbaseResources
): Promise<TaskNotesMdbaseTypePack> {
	const typeSource = `types/${resources.paths.type.split("/").slice(-1)[0]}`;
	const definitions = [
		{
			kind: "contract" as const,
			source: "contracts/tasknotes.task.md",
			target: resources.paths.contract,
			document: resources.contractDocument,
		},
		{
			kind: "type" as const,
			source: typeSource,
			target: resources.paths.type,
			document: resources.typeDocument,
		},
		{
			kind: "schema" as const,
			source: "schemas/tasknotes-task.schema.json",
			target: resources.paths.taskSchema,
			document: resources.taskSchemaDocument,
		},
		{
			kind: "schema" as const,
			source: "schemas/tasknotes-task-binding.schema.json",
			target: resources.paths.bindingSchema,
			document: resources.bindingSchemaDocument,
		},
	];
	return {
		manifest: {
			kind: "mdbase.type-pack",
			id: "tasknotes.task",
			version: TASKNOTES_SPEC_VERSION,
			name: "TaskNotes task",
			description:
				"TaskNotes task contract, implementation, and referenced JSON Schemas.",
			resources: await Promise.all(
				definitions.map(async ({ kind, source, target, document }) => ({
					kind,
					source,
					target,
					digest: await sha256(document),
				}))
			),
		},
		resources: definitions.map(({ source, document }) => ({
			source,
			document,
		})),
		provides: [{ id: "tasknotes.task", version: TASKNOTES_SPEC_VERSION }],
	};
}

/** Resolve the TaskNotes configuration advertised by an mdbase task type. */
export function resolveTaskNotesModelConfigFromMdbaseType(
	value: unknown,
	fallback: Partial<TaskNotesModelConfig> = {}
): TaskNotesModelConfig {
	const base = resolveModelConfig(fallback);
	if (!isRecord(value)) return base;
	const implementation = taskNotesImplementation(value);
	if (!implementation) return base;
	const extension = isRecord(implementation.binding)
		? implementation.binding
		: {};
	const roles = isRecord(implementation.fields) ? implementation.fields : {};
	const fieldMapping = { ...base.fieldMapping };
	for (const key of Object.keys(fieldMapping) as (keyof FieldMapping)[]) {
		const candidate = roles[key];
		if (typeof candidate === "string" && candidate.trim()) fieldMapping[key] = candidate.trim();
	}

	const schemaProperties: Record<string, unknown> =
		isRecord(value.schema) && isRecord(value.schema.value) && isRecord(value.schema.value.properties)
			? (value.schema.value.properties as Record<string, unknown>)
			: {};
	const status = isRecord(extension.status) ? extension.status : {};
	const priority = isRecord(extension.priority) ? extension.priority : {};
	const rawStatusProperty = schemaProperties[fieldMapping.status];
	const rawPriorityProperty = schemaProperties[fieldMapping.priority];
	const statusProperty: Record<string, unknown> = isRecord(rawStatusProperty)
		? rawStatusProperty
		: {};
	const priorityProperty: Record<string, unknown> = isRecord(rawPriorityProperty)
		? rawPriorityProperty
		: {};
	const statusValues = firstNonEmpty(
		stringArray(status.values),
		stringArray(statusProperty.enum)
	);
	const priorityValues = firstNonEmpty(
		stringArray(priority.values),
		stringArray(priorityProperty.enum)
	);
	const statuses = resolveStatuses(statusValues, status, base.statuses);
	const priorities = resolvePriorities(priorityValues, priority, base.priorities);
	const title = isRecord(extension.title) ? extension.title : {};
	const recurrence = isRecord(extension.recurrence) ? extension.recurrence : {};
	const occurrences = isRecord(extension.occurrences) ? extension.occurrences : {};
	const timeTracking = isRecord(extension.time_tracking) ? extension.time_tracking : {};
	const taskIdentification = resolveTaskIdentification(value.match, base.taskIdentification);
	const userFields = resolveUserFields(schemaProperties, fieldMapping, base.userFields);
	const nlp = isRecord(extension.nlp) ? extension.nlp : {};
	const defaultStatus = stringValue(status.default) ?? base.defaults.status;
	const defaultPriority = stringValue(priority.default) ?? base.defaults.priority;

	return resolveModelConfig({
		...base,
		fieldMapping,
		statuses,
		priorities,
		defaults: {
			...base.defaults,
			status: statuses.some((entry) => entry.value === defaultStatus)
				? defaultStatus
				: statuses[0]?.value ?? base.defaults.status,
			priority: priorities.some((entry) => entry.value === defaultPriority)
				? defaultPriority
				: priorities[0]?.value ?? base.defaults.priority,
			taskTag:
				taskIdentification.method === "tag"
					? taskIdentification.tag
					: base.defaults.taskTag,
		},
		taskIdentification,
		storeTitleInFilename: title.storage === "filename",
		userFields,
		recurrence: {
			...base.recurrence,
			maintainDueDateOffset:
				booleanValue(recurrence.maintain_due_date_offset) ??
				base.recurrence.maintainDueDateOffset,
			resetCheckboxesOnRecurrence:
				booleanValue(recurrence.reset_body_checkboxes) ??
				base.recurrence.resetCheckboxesOnRecurrence,
		},
		occurrences: {
			...base.occurrences,
			defaultMaterialization:
				occurrences.default_materialization === "manual" ||
				occurrences.default_materialization === "on_completion" ||
				occurrences.default_materialization === "rolling"
					? occurrences.default_materialization
					: base.occurrences.defaultMaterialization,
			defaultNextTrigger:
				occurrences.default_next_trigger === "completion" ||
				occurrences.default_next_trigger === "completion_or_skip"
					? occurrences.default_next_trigger
					: base.occurrences.defaultNextTrigger,
			pastHorizon: stringValue(occurrences.past_horizon) ?? base.occurrences.pastHorizon,
			futureHorizon:
				stringValue(occurrences.future_horizon) ?? base.occurrences.futureHorizon,
		},
		timeTracking: {
			...base.timeTracking,
			autoStopOnComplete:
				booleanValue(timeTracking.auto_stop_on_complete) ??
				base.timeTracking.autoStopOnComplete,
		},
		nlp: resolveNlpConfig(nlp, base.nlp),
	});
}

function resolveTaskIdentification(
	value: unknown,
	fallback: TaskNotesModelConfig["taskIdentification"]
): TaskNotesModelConfig["taskIdentification"] {
	if (!isRecord(value) || !isRecord(value.where)) {
		return { ...fallback };
	}

	const entries = Object.entries(value.where);
	if (entries.length !== 1) {
		return { ...fallback };
	}

	const [propertyName, predicate] = entries[0];
	if (!isRecord(predicate)) {
		return { ...fallback };
	}

	if (propertyName === "tags") {
		const tag = stringValue(predicate.contains);
		return tag
			? {
					...fallback,
					method: "tag",
					tag,
				}
			: { ...fallback };
	}

	if (Object.prototype.hasOwnProperty.call(predicate, "eq")) {
		const rawValue = predicate.eq;
		if (
			typeof rawValue !== "string" &&
			typeof rawValue !== "number" &&
			typeof rawValue !== "boolean"
		) {
			return { ...fallback };
		}
		return {
			...fallback,
			method: "property",
			propertyName,
			propertyValue: String(rawValue),
		};
	}

	if (predicate.exists === true) {
		return {
			...fallback,
			method: "property",
			propertyName,
			propertyValue: "",
		};
	}

	return { ...fallback };
}

function resolveUserFields(
	schemaProperties: Record<string, unknown>,
	fieldMapping: FieldMapping,
	fallback: UserMappedField[]
): UserMappedField[] {
	const reserved = new Set([...Object.values(fieldMapping), "id", "tags"]);
	const resolved: UserMappedField[] = [];

	for (const [key, schema] of Object.entries(schemaProperties)) {
		if (reserved.has(key)) continue;
		const type = resolveUserFieldType(schema);
		if (!type) continue;
		const existing = fallback.find((field) => field.key === key);
		const defaultValue = readSchemaDefault(schema);
		resolved.push({
			id: existing?.id ?? key,
			displayName: existing?.displayName ?? humanize(key),
			key,
			type,
			...(defaultValue !== undefined ? { defaultValue } : {}),
		});
	}

	return resolved;
}

function resolveUserFieldType(value: unknown): UserMappedField["type"] | null {
	if (!isRecord(value)) return null;
	if (Array.isArray(value.anyOf)) {
		for (const branch of value.anyOf) {
			const resolved = resolveUserFieldType(branch);
			if (resolved) return resolved;
		}
		return null;
	}
	if (value.format === "date") return "date";
	if (value.type === "string") return "text";
	if (value.type === "number" || value.type === "integer") return "number";
	if (value.type === "boolean") return "boolean";
	if (value.type === "array") return "list";
	return null;
}

function readSchemaDefault(value: unknown): UserMappedField["defaultValue"] | undefined {
	if (!isRecord(value)) return undefined;
	if (value.default !== undefined) {
		return isUserFieldDefault(value.default)
			? Array.isArray(value.default)
				? [...value.default]
				: value.default
			: undefined;
	}
	if (Array.isArray(value.anyOf)) {
		for (const branch of value.anyOf) {
			const resolved = readSchemaDefault(branch);
			if (resolved !== undefined) return resolved;
		}
	}
	return undefined;
}

function isUserFieldDefault(value: unknown): value is UserMappedField["defaultValue"] {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		(Array.isArray(value) && value.every((entry) => typeof entry === "string"))
	);
}

function resolveNlpConfig(
	value: Record<string, unknown>,
	fallback: TaskNotesModelConfig["nlp"]
): TaskNotesModelConfig["nlp"] {
	if (!Array.isArray(value.triggers)) {
		return fallback
			? { triggers: fallback.triggers.map((trigger) => ({ ...trigger })) }
			: undefined;
	}
	const triggers = value.triggers.flatMap((raw) => {
		if (!isRecord(raw)) return [];
		const propertyId =
			stringValue(raw.property_id) ?? stringValue(raw.propertyId);
		const trigger = stringValue(raw.trigger);
		if (!propertyId || !trigger) return [];
		return [
			{
				propertyId,
				trigger,
				enabled: booleanValue(raw.enabled) ?? true,
			},
		];
	});
	return { triggers };
}

function validateVocabulary(
	config: TaskNotesModelConfig,
	statusValues: string[],
	priorityValues: string[],
	completedValues: string[]
): void {
	if (completedValues.length === 0) {
		throw new Error("TaskNotes requires at least one completed status.");
	}
	if (!statusValues.includes(config.defaults.status)) {
		throw new Error("The default TaskNotes status must be a configured status.");
	}
	if (!priorityValues.includes(config.defaults.priority)) {
		throw new Error("The default TaskNotes priority must be configured.");
	}
	const skippedValues = config.statuses
		.filter((status) => status.isSkipped === true)
		.map((status) => status.value);
	if (completedValues.some((value) => skippedValues.includes(value))) {
		throw new Error("A TaskNotes status cannot be both completed and skipped.");
	}
}

function buildMatch(config: TaskNotesModelConfig): Record<string, unknown> {
	const detection = config.taskIdentification;
	if (detection.method === "property" && detection.propertyName.trim()) {
		const rawValue = detection.propertyValue.trim();
		const value = rawValue.toLowerCase() === "true"
			? true
			: rawValue.toLowerCase() === "false"
				? false
				: rawValue;
		return {
			where: {
				[detection.propertyName.trim()]: rawValue
					? { eq: value }
					: { exists: true },
			},
		};
	}
	return {
		where: {
			tags: { contains: detection.tag.trim() || config.defaults.taskTag || "task" },
		},
	};
}

function defaultFilenameTemplate(config: TaskNotesModelConfig): string {
	return config.storeTitleInFilename ? "{{title}}" : "{{zettel}}";
}

function stringSchema(
	extra: Record<string, unknown>,
	legacyCompatibility: boolean
): Record<string, unknown> {
	return legacyCompatibility
		? { type: ["string", "number", "boolean"], ...extra }
		: { type: "string", ...extra };
}

function integerSchema(
	extra: Record<string, unknown>,
	legacyCompatibility: boolean
): Record<string, unknown> {
	return legacyCompatibility
		? {
				anyOf: [
					{ type: "integer" },
					{ type: "number", multipleOf: 1 },
					{ type: "string", pattern: "^-?(?:0|[1-9][0-9]*)(?:\\.0+)?$" },
				],
				...extra,
			}
		: { type: "integer", ...extra };
}

function numberSchema(
	extra: Record<string, unknown>,
	legacyCompatibility: boolean
): Record<string, unknown> {
	return legacyCompatibility
		? {
				anyOf: [
					{ type: "number" },
					{
						type: "string",
						pattern:
							"^-?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$",
					},
				],
				...extra,
			}
		: { type: "number", ...extra };
}

function booleanSchema(legacyCompatibility: boolean): Record<string, unknown> {
	return legacyCompatibility
		? { anyOf: [{ type: "boolean" }, { enum: ["true", "false", "yes", "no", "on", "off"] }] }
		: { type: "boolean" };
}

function dateSchema(_legacyCompatibility: boolean): Record<string, unknown> {
	return { type: "string", format: "date" };
}

function taskDateSchema(legacyCompatibility: boolean): Record<string, unknown> {
	return {
		anyOf: [
			dateSchema(legacyCompatibility),
			dateTimeSchema(legacyCompatibility),
		],
	};
}

function dateTimeSchema(legacyCompatibility: boolean): Record<string, unknown> {
	return legacyCompatibility
		? {
				type: "string",
				pattern:
					"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$",
			}
		: { type: "string", format: "date-time" };
}

function arraySchema(
	itemSchema: Record<string, unknown>,
	legacyCompatibility: boolean
): Record<string, unknown> {
	return {
		type: "array",
		items: legacyCompatibility ? nullable(itemSchema) : itemSchema,
	};
}

function objectSchema(
	properties: Record<string, Record<string, unknown>>,
	required: string[],
	legacyCompatibility: boolean
): Record<string, unknown> {
	const adjusted = Object.fromEntries(
		Object.entries(properties).map(([key, schema]) => [
			key,
			legacyCompatibility && !required.includes(key) ? nullable(schema) : schema,
		])
	);
	return {
		type: "object",
		additionalProperties: legacyCompatibility || Object.keys(properties).length === 0,
		properties: adjusted,
		...(required.length > 0 ? { required } : {}),
	};
}

function timeEntriesSchema(legacyCompatibility: boolean): Record<string, unknown> {
	return arraySchema(
		objectSchema(
			{
				startTime: dateTimeSchema(legacyCompatibility),
				endTime: dateTimeSchema(legacyCompatibility),
				description: stringSchema({}, legacyCompatibility),
				duration: integerSchema({}, legacyCompatibility),
			},
			[],
			legacyCompatibility
		),
		legacyCompatibility
	);
}

function dependenciesSchema(legacyCompatibility: boolean): Record<string, unknown> {
	return arraySchema(
		objectSchema(
			{
				uid: stringSchema({}, legacyCompatibility),
				reltype: stringSchema({}, legacyCompatibility),
				gap: stringSchema({}, legacyCompatibility),
			},
			["uid"],
			legacyCompatibility
		),
		legacyCompatibility
	);
}

function reminderSchema(legacyCompatibility: boolean): Record<string, unknown> {
	if (legacyCompatibility) {
		return arraySchema(
			objectSchema(
				{
					id: stringSchema({}, true),
					type: { enum: ["absolute", "relative"] },
					description: stringSchema({}, true),
					relatedTo: { enum: ["due", "scheduled"] },
					offset: stringSchema({}, true),
					absoluteTime: dateTimeSchema(true),
				},
				["id"],
				true
			),
			true
		);
	}
	return {
		type: "array",
		items: {
			oneOf: [
				{
					type: "object",
					required: ["id", "type", "absoluteTime"],
					additionalProperties: false,
					properties: {
						id: { type: "string" },
						type: { const: "absolute" },
						description: { type: "string" },
						absoluteTime: { type: "string", format: "date-time" },
					},
				},
				{
					type: "object",
					required: ["id", "type", "relatedTo", "offset"],
					additionalProperties: false,
					properties: {
						id: { type: "string" },
						type: { const: "relative" },
						description: { type: "string" },
						relatedTo: { enum: ["due", "scheduled"] },
						offset: { type: "string" },
					},
				},
			],
		},
	};
}

function userFieldSchema(
	field: UserMappedField,
	legacyCompatibility: boolean
): Record<string, unknown> {
	const schema = field.type === "number"
		? numberSchema({}, legacyCompatibility)
		: field.type === "date"
			? dateSchema(legacyCompatibility)
			: field.type === "boolean"
				? booleanSchema(legacyCompatibility)
				: field.type === "list"
					? arraySchema(stringSchema({}, legacyCompatibility), legacyCompatibility)
					: stringSchema({}, legacyCompatibility);
	return legacyCompatibility ? nullable(schema) : schema;
}

function statusDefinition(status: StatusConfig): Record<string, unknown> {
	return {
		value: status.value,
		label: status.label,
		color: status.color,
		...(status.icon?.trim() ? { icon: status.icon.trim() } : {}),
		is_completed: status.isCompleted,
		is_skipped: status.isSkipped === true,
		exclude_from_cycle: status.excludeFromCycle === true,
		...(status.nextStatus?.trim() ? { next_status: status.nextStatus.trim() } : {}),
		order: status.order,
		auto_archive: status.autoArchive,
		auto_archive_delay_minutes: status.autoArchiveDelay,
	};
}

function priorityDefinition(priority: PriorityConfig): Record<string, unknown> {
	return {
		value: priority.value,
		label: priority.label,
		color: priority.color,
		...(priority.icon?.trim() ? { icon: priority.icon.trim() } : {}),
		weight: priority.weight,
	};
}

function resolveStatuses(
	values: string[],
	policy: Record<string, unknown>,
	fallback: StatusConfig[]
): StatusConfig[] {
	const completed = new Set(stringArray(policy.completed_values));
	const skipped = new Set(stringArray(policy.skipped_values));
	const definitions = definitionMap(policy.definitions);
	return values.length
		? values.map((value, index) => {
				const existing = fallback.find((candidate) => candidate.value === value);
				const definition = definitions.get(value);
				return {
					id: stringValue(definition?.id) ?? existing?.id ?? value,
					value,
					label: stringValue(definition?.label) ?? existing?.label ?? humanize(value),
					color: stringValue(definition?.color) ?? existing?.color ?? "#808080",
					...(stringValue(definition?.icon) ?? existing?.icon
						? { icon: stringValue(definition?.icon) ?? existing?.icon }
						: {}),
					isCompleted:
						booleanValue(definition?.is_completed) ?? completed.has(value),
					isSkipped: booleanValue(definition?.is_skipped) ?? skipped.has(value),
					excludeFromCycle:
						booleanValue(definition?.exclude_from_cycle) ??
						existing?.excludeFromCycle ??
						false,
					...(stringValue(definition?.next_status) ?? existing?.nextStatus
						? {
								nextStatus:
									stringValue(definition?.next_status) ?? existing?.nextStatus,
							}
						: {}),
					order: numberValue(definition?.order) ?? existing?.order ?? index,
					autoArchive:
						booleanValue(definition?.auto_archive) ?? existing?.autoArchive ?? false,
					autoArchiveDelay:
						numberValue(definition?.auto_archive_delay_minutes) ??
						existing?.autoArchiveDelay ??
						5,
				};
			})
		: fallback.map((status) => ({ ...status }));
}

function resolvePriorities(
	values: string[],
	policy: Record<string, unknown>,
	fallback: PriorityConfig[]
): PriorityConfig[] {
	const definitions = definitionMap(policy.definitions);
	return values.length
		? values.map((value, index) => {
				const existing = fallback.find((candidate) => candidate.value === value);
				const definition = definitions.get(value);
				return {
					id: stringValue(definition?.id) ?? existing?.id ?? value,
					value,
					label: stringValue(definition?.label) ?? existing?.label ?? humanize(value),
					color: stringValue(definition?.color) ?? existing?.color ?? "#808080",
					...(stringValue(definition?.icon) ?? existing?.icon
						? { icon: stringValue(definition?.icon) ?? existing?.icon }
						: {}),
					weight: numberValue(definition?.weight) ?? existing?.weight ?? index,
				};
			})
		: fallback.map((priority) => ({ ...priority }));
}

function definitionMap(value: unknown): Map<string, Record<string, unknown>> {
	const result = new Map<string, Record<string, unknown>>();
	if (!Array.isArray(value)) return result;
	for (const entry of value) {
		if (!isRecord(entry)) continue;
		const key = stringValue(entry.value);
		if (key) result.set(key, entry);
	}
	return result;
}

function contractSection(
	extension: Record<string, unknown>,
	key: string
): Record<string, unknown> {
	const section = isRecord(extension[key]) ? extension[key] : {};
	extension[key] = section;
	return section;
}

function taskNotesImplementation(
	type: Record<string, unknown>
): Record<string, any> | undefined {
	if (!Array.isArray(type.implements)) return undefined;
	return type.implements.find(
		(candidate): candidate is Record<string, any> =>
			isRecord(candidate) &&
			candidate.contract === "tasknotes.task" &&
			candidate.version === TASKNOTES_SPEC_VERSION
	);
}

function relativeResourceReference(
	sourcePath: string,
	targetPath: string
): string {
	const sourceDirectory = sourcePath.split("/").slice(0, -1);
	const target = targetPath.split("/");
	let common = 0;
	while (
		common < sourceDirectory.length &&
		common < target.length &&
		sourceDirectory[common] === target[common]
	) {
		common += 1;
	}
	const segments = [
		...sourceDirectory.slice(common).map(() => ".."),
		...target.slice(common),
	];
	return segments.join("/");
}

function requiredConfiguredValue(
	value: string,
	allowed: readonly string[],
	label: string
): string {
	const normalized = value.trim();
	if (!allowed.includes(normalized))
		throw new Error(
			`${label} must be one of: ${allowed.join(", ")}.`
		);
	return normalized;
}

function requiredDuration(value: string, label: string): string {
	const normalized = value.trim().toUpperCase();
	if (!/^P(?=.+)(?:\d+(?:\.\d+)?Y)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?W)?(?:\d+(?:\.\d+)?D)?(?:T(?=.+)(?:\d+(?:\.\d+)?H)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?S)?)?$/.test(normalized))
		throw new Error(`${label} must be an ISO 8601 duration.`);
	return normalized;
}

function addLifecycleValue(
	lifecycle: Record<string, unknown>,
	event: LifecycleEvent,
	fieldName: string,
	value: Record<string, unknown>,
	omittedCollectionPaths: Set<string>
): void {
	if (!isMdbaseFieldPath(fieldName)) {
		omittedCollectionPaths.add(fieldName);
		return;
	}
	const action = isRecord(lifecycle[event]) ? lifecycle[event] : {};
	const set = isRecord(action.set) ? action.set : {};
	set[fieldName] = value;
	action.set = set;
	lifecycle[event] = action;
}

function applySchemaDefault(schema: unknown, value: unknown): void {
	if (!isRecord(schema)) return;
	if (Array.isArray(schema.anyOf)) {
		const branch = schema.anyOf.find((entry) => isRecord(entry) && entry.type !== "null");
		if (isRecord(branch)) branch.default = cloneValue(value);
		return;
	}
	schema.default = cloneValue(value);
}

function nullable(schema: Record<string, unknown>): Record<string, unknown> {
	return { anyOf: [schema, { type: "null" }] };
}

function isMdbaseFieldPath(value: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_:-]*(?:\[\])?(?:\.[A-Za-z_][A-Za-z0-9_:-]*(?:\[\])?)*$/.test(
		value
	);
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cleanSegment(value: string, name: string): string {
	const normalized = value.trim().toLowerCase();
	if (!/^[a-z0-9_-]+$/.test(normalized)) {
		throw new Error(`${name} must be a lower-case mdbase identifier.`);
	}
	return normalized;
}

function cleanPath(value: string, name: string): string {
	const normalized = cleanOptionalPath(value, name);
	if (!normalized) throw new Error(`${name} must not be empty.`);
	return normalized;
}

function cleanOptionalPath(value: string, name: string): string {
	const normalized = value.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
	if (normalized.split("/").some((segment) => segment === "." || segment === "..")) {
		throw new Error(`${name} must be a safe collection-relative path.`);
	}
	return normalized;
}

function cloneValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(cloneValue);
	if (isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [key, cloneValue(child)])
		);
	}
	return value;
}

async function sha256(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0")
	).join("")}`;
}

function isRecord(value: unknown): value is Record<string, any> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? uniqueStrings(value.filter((entry): entry is string => typeof entry === "string"))
		: [];
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function humanize(value: string): string {
	const text = value.replace(/[-_]+/g, " ").trim();
	return text ? `${text[0].toUpperCase()}${text.slice(1)}` : value;
}

function firstNonEmpty(primary: string[], fallback: string[]): string[] {
	return primary.length ? primary : fallback;
}
