import { cloneDefaultModelConfig } from "./defaults";
import { serializeMarkdownDocument } from "./frontmatter";
import {
	buildTaskNotesMdbaseResources,
	TASKNOTES_MDBASE_TYPE_VERSION,
	type TaskNotesMdbaseOptions,
	type TaskNotesMdbaseResources,
} from "./mdbase";
import { TASKNOTES_SPEC_VERSION, type TaskNotesModelConfig } from "./types";

/**
 * The published TaskNotes starter: the `tasknotes.task` pack's seed type that
 * applications install into new collections (mdbase-contracts
 * `types/tasknotes-task/<TASKNOTES_STARTER_TYPE_VERSION>.md`).
 *
 * It differs from the plugin defaults in `DEFAULT_STATUSES`: it adds the
 * skipped `cancelled` status, uses its own palette and declares only the
 * profiles its binding implements. Collections keep whatever they customise,
 * because pack upgrades merge against the previous starter; so any change
 * here is a new starter version and must be deliberate. The test suite checks
 * this output against the published type.
 */
export const TASKNOTES_STARTER_TYPE_VERSION = TASKNOTES_MDBASE_TYPE_VERSION;

/**
 * Revision of the published starter document (mdbase-contracts
 * `types/tasknotes-task/<revision>.md`). A revision that does not change the
 * type's data keeps TASKNOTES_STARTER_TYPE_VERSION, so collections that already
 * have that version do not see a conflicting version change on upgrade.
 */
export const TASKNOTES_STARTER_REVISION = 5;

/**
 * The generator bookkeeping published in the first starter. Collections keep
 * their own list (it follows their field mapping), so pack upgrades must not
 * change it: the starter always publishes this list.
 */
export const TASKNOTES_STARTER_MANAGED_FIELDS: readonly string[] = [
	"attachments",
	"blockedBy",
	"complete_instances",
	"completedDate",
	"contexts",
	"dateCreated",
	"dateModified",
	"due",
	"googleCalendarEventId",
	"googleCalendarExceptionEventId",
	"googleCalendarExceptionOriginalScheduled",
	"googleCalendarMovedOriginalDates",
	"icsEventId",
	"id",
	"occurrence_date",
	"occurrence_future_horizon",
	"occurrence_materialization",
	"occurrence_next_trigger",
	"occurrence_past_horizon",
	"occurrence_template",
	"priority",
	"projects",
	"recurrence",
	"recurrence_anchor",
	"recurrence_parent",
	"reminders",
	"scheduled",
	"skipped_instances",
	"status",
	"tags",
	"tasknotes_manual_order",
	"timeEntries",
	"timeEstimate",
	"title",
];

export const TASKNOTES_STARTER_PROFILES = [
	"core-lite",
	"recurrence",
	"materialized-occurrences",
] as const;

export const TASKNOTES_STARTER_STATUS_COLORS: Readonly<Record<string, string>> = {
	none: "#94a3b8",
	open: "#64748b",
	"in-progress": "#3b82f6",
	done: "#22c55e",
	cancelled: "#94a3b8",
};

export const TASKNOTES_STARTER_PRIORITY_COLORS: Readonly<Record<string, string>> = {
	none: "#94a3b8",
	low: "#3b82f6",
	normal: "#f59e0b",
	high: "#ef4444",
};

/** Model configuration that the published starter type is generated from. */
export function cloneTaskNotesStarterModelConfig(): TaskNotesModelConfig {
	const modelConfig = cloneDefaultModelConfig();
	modelConfig.statuses = modelConfig.statuses.map((status) => ({
		...status,
		color: TASKNOTES_STARTER_STATUS_COLORS[status.value] ?? status.color,
	}));
	modelConfig.priorities = modelConfig.priorities.map((priority) => ({
		...priority,
		color: TASKNOTES_STARTER_PRIORITY_COLORS[priority.value] ?? priority.color,
	}));
	modelConfig.statuses.push({
		id: "cancelled",
		value: "cancelled",
		label: "Cancelled",
		color: TASKNOTES_STARTER_STATUS_COLORS.cancelled,
		isCompleted: false,
		isSkipped: true,
		excludeFromCycle: true,
		order: modelConfig.statuses.length,
		autoArchive: false,
		autoArchiveDelay: 5,
	});
	return modelConfig;
}

/** The published starter's type, schemas and contract resources. */
export function buildTaskNotesStarterResources(
	options: Omit<TaskNotesMdbaseOptions, "modelConfig" | "profiles"> = {},
): TaskNotesMdbaseResources {
	const modelConfig = cloneTaskNotesStarterModelConfig();
	const resources = buildTaskNotesMdbaseResources({
		...options,
		profiles: TASKNOTES_STARTER_PROFILES,
		modelConfig,
	});
	const type = structuredClone(resources.type) as Record<string, any>;
	const implementation = type.implements.find(
		(candidate: { contract: string; version: string }) =>
			candidate.contract === "tasknotes.task" && candidate.version === TASKNOTES_SPEC_VERSION,
	);
	if (!implementation) {
		throw new Error(`The generated type does not implement tasknotes.task ${TASKNOTES_SPEC_VERSION}.`);
	}
	type.version = TASKNOTES_STARTER_TYPE_VERSION;
	type["x-tasknotes-generator"] = {
		...type["x-tasknotes-generator"],
		managed_fields: [...TASKNOTES_STARTER_MANAGED_FIELDS],
	};
	// One shared date schema, so due and scheduled cannot drift apart.
	const taskDateSchema = {
		anyOf: [
			{ type: "string", format: "date" },
			{ type: "string", format: "date-time" },
		],
	};
	type.schema.value.properties[implementation.fields.due] = taskDateSchema;
	type.schema.value.properties[implementation.fields.scheduled] = taskDateSchema;
	implementation.binding.status = {
		...implementation.binding.status,
		skipped_values: ["cancelled"],
		default_skipped: "cancelled",
	};
	const body = `# Task\n\nTask records live under \`${resources.paths.records}/\`.\n`;
	return {
		...resources,
		type,
		typeDocument: serializeMarkdownDocument(type, body),
	};
}
