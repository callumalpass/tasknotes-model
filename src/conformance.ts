import {
	buildSpecFieldMapping,
	defaultSpecFieldMapping,
	denormalizeSpecFrontmatter,
	detectTaskFile,
	getDefaultSpecCompletedStatus,
	isSpecCompletedStatus,
	mapTasknotesPluginConfig,
	normalizeSpecFrontmatter,
	resolveDisplayTitle,
} from "./config";
import {
	formatDateForStorage,
	getDatePart,
	hasTimeComponent,
	isBeforeDateSafe,
	isSameDateSafe,
	parseDateToLocal,
	parseDateToUTC,
	resolveOperationTargetDate,
	validateDateString,
} from "./date";
import { DEFAULT_FIELD_MAPPING, DEFAULT_PRIORITIES, DEFAULT_STATUSES } from "./defaults";
import {
	normalizeDependencyEntry,
	normalizeDependencyList,
	serializeDependencies,
} from "./mapping";
import {
	buildMaterializeOccurrencePlan,
	buildMaterializedOccurrenceCompletePlan,
	buildMaterializedOccurrenceSkipPlan,
	buildMaterializedOccurrenceUncompletePlan,
	buildMaterializedOccurrenceUnskipPlan,
} from "./operations";
import {
	completeRecurringTask,
	getEffectiveTaskStatus,
	recalculateRecurringSchedule,
} from "./recurrence";
import {
	buildDeleteTimeEntryPlan,
	buildStartTimeTrackingPlan,
	buildStopTimeTrackingPlan,
	calculateTotalTrackedMinutes,
	getActiveTimeEntry,
	replaceTimeEntries,
} from "./time";
import { evaluateCoreValidation, validateTask, validateTimeEntries } from "./validation";
import { TASKNOTES_SPEC_VERSION, type ConformanceEnvelope, type TaskInfo, type TimeEntry } from "./types";

export const conformanceMetadata = {
	implementation: "@tasknotes/model",
	version: "0.3.0-rc.1",
	spec_version: TASKNOTES_SPEC_VERSION,
	validation_modes: ["strict"],
	profiles: ["core-lite"],
	capabilities: [
		"date",
		"field-mapping",
		"create-compat",
		"ops-core",
		"claim",
		"config-lite",
		"validation-core",
	],
};

export const metadata = conformanceMetadata;

export async function execute(
	operation: string,
	input: Record<string, unknown> = {}
): Promise<ConformanceEnvelope> {
	return executeConformanceOperation(operation, input);
}

export function executeConformanceOperation(
	operation: string,
	input: Record<string, unknown> = {}
): ConformanceEnvelope {
	try {
		switch (operation) {
			case "meta.claim":
				return ok({ ...conformanceMetadata });
			case "meta.has_capability":
				return ok({ value: conformanceMetadata.capabilities.includes(String(input.capability || "")) });
			case "meta.has_profile":
				return ok({ value: conformanceMetadata.profiles.includes(String(input.profile || "")) });
			case "date.parse_utc":
				return ok({ date: formatDateForStorage(parseDateToUTC(String(input.value || ""))) });
			case "date.parse_local":
				return dateParseLocal(input);
			case "date.validate":
				return ok({ value: validateDateString(String(input.value || "")) });
			case "date.get_part":
				return ok({ value: getDatePart(String(input.value || "")) });
			case "date.has_time":
				return ok({ value: hasTimeComponent(typeof input.value === "string" ? input.value : undefined) });
			case "date.is_same":
				return ok({ value: isSameDateSafe(String(input.a ?? input.left ?? ""), String(input.b ?? input.right ?? "")) });
			case "date.is_before":
				return ok({ value: isBeforeDateSafe(String(input.a ?? input.left ?? ""), String(input.b ?? input.right ?? "")) });
			case "date.resolve_operation_target":
				return ok({
					value: resolveOperationTargetDate(
						stringOrUndefined(input.explicitDate ?? input.date),
						stringOrUndefined(input.scheduled),
						stringOrUndefined(input.due)
					),
				});
			case "date.day_in_timezone":
				return dayInTimezone(input);
			case "field.default_mapping": {
				const mapping = defaultSpecFieldMapping();
				return ok({
					roleToField: mapping.roleToField,
					fieldToRole: mapping.fieldToRole,
					displayNameKey: mapping.displayNameKey,
				});
			}
			case "field.build_mapping": {
				const mapping = buildSpecFieldMapping(asRecord(input.fields), stringOrUndefined(input.displayNameKey));
				return ok(mapping);
			}
			case "field.normalize": {
				const mapping = buildSpecFieldMapping(asRecord(input.fields), stringOrUndefined(input.displayNameKey));
				return ok({ normalized: normalizeSpecFrontmatter(asRecord(input.frontmatter), mapping) });
			}
			case "field.denormalize": {
				const mapping = buildSpecFieldMapping(asRecord(input.fields), stringOrUndefined(input.displayNameKey));
				return ok({ denormalized: denormalizeSpecFrontmatter(asRecord(input.roleData ?? input.data ?? input.frontmatter), mapping) });
			}
			case "field.resolve_display_title": {
				const mapping = buildSpecFieldMapping(asRecord(input.fields), stringOrUndefined(input.displayNameKey));
				return ok({ value: resolveDisplayTitle(asRecord(input.frontmatter), mapping, stringOrUndefined(input.taskPath ?? input.path)) ?? null });
			}
			case "field.is_completed_status": {
				const mapping = buildSpecFieldMapping(asRecord(input.fields), stringOrUndefined(input.displayNameKey));
				return ok({ value: isSpecCompletedStatus(mapping, stringOrUndefined(input.status)) });
			}
			case "field.default_completed_status": {
				const mapping = buildSpecFieldMapping(asRecord(input.fields), stringOrUndefined(input.displayNameKey));
				return ok({ value: getDefaultSpecCompletedStatus(mapping) });
			}
			case "recurrence.complete":
				return ok(completeRecurringTask(normalizeRecurrenceCompletionInput(input)));
			case "recurrence.recalculate":
				return ok(recalculateRecurringSchedule(normalizeRecurrenceScheduleInput(input)));
			case "recurrence.effective_state":
				return ok({
					status: getEffectiveTaskStatus(asRecord(input.task) as Partial<TaskInfo>, parseDateToUTC(String(input.date || "")), String(input.completedStatus || "done")),
				});
			case "recurrence.uncomplete_instance":
				return ok(removeInstance(asRecord(input), "completeInstances"));
			case "recurrence.skip_instance":
				return ok(addRemoveInstance(asRecord(input), "skippedInstances", true));
			case "recurrence.unskip_instance":
				return ok(addRemoveInstance(asRecord(input), "skippedInstances", false));
			case "occurrence.materialize":
				return ok(buildMaterializeOccurrencePlan({
					parentTask: normalizeTaskForConformance(input.parentTask ?? input.parent),
					targetDate: String((input.targetDate ?? input.date) || ""),
					currentTimestamp: String(input.now || input.currentTimestamp || new Date().toISOString()),
					existingOccurrences: arrayValue(input.existingOccurrences ?? input.occurrences).map(normalizeTaskForConformance),
					parentLink: stringOrUndefined(input.parentLink ?? input.parent_reference),
					defaultStatus: stringOrUndefined(input.defaultStatus ?? input.default_status) || "open",
					defaultPriority: stringOrUndefined(input.defaultPriority ?? input.default_priority) || "normal",
					templateTask: asRecord(input.templateTask ?? input.template_task) as Partial<TaskInfo>,
					overrides: asRecord(input.overrides) as Partial<TaskInfo>,
				}));
			case "occurrence.complete":
				return ok(buildMaterializedOccurrenceCompletePlan({
					occurrenceTask: normalizeTaskForConformance(input.occurrenceTask ?? input.occurrence),
					parentTask: normalizeTaskForConformance(input.parentTask ?? input.parent),
					completedStatus: String(input.completedStatus || input.completed_status || "done"),
					currentTimestamp: String(input.now || input.currentTimestamp || new Date().toISOString()),
					targetDate: stringOrUndefined(input.targetDate ?? input.date),
					maintainDueDateOffsetInRecurring: input.maintainDueDateOffset !== false,
				}));
			case "occurrence.uncomplete":
				return ok(buildMaterializedOccurrenceUncompletePlan({
					occurrenceTask: normalizeTaskForConformance(input.occurrenceTask ?? input.occurrence),
					parentTask: normalizeTaskForConformance(input.parentTask ?? input.parent),
					activeStatus: String(input.activeStatus || input.active_status || "open"),
					currentTimestamp: String(input.now || input.currentTimestamp || new Date().toISOString()),
					targetDate: stringOrUndefined(input.targetDate ?? input.date),
				}));
			case "occurrence.skip":
				return ok(buildMaterializedOccurrenceSkipPlan({
					occurrenceTask: normalizeTaskForConformance(input.occurrenceTask ?? input.occurrence),
					parentTask: normalizeTaskForConformance(input.parentTask ?? input.parent),
					skippedStatus: stringOrUndefined(input.skippedStatus ?? input.skipped_status),
					currentTimestamp: String(input.now || input.currentTimestamp || new Date().toISOString()),
					targetDate: stringOrUndefined(input.targetDate ?? input.date),
					maintainDueDateOffsetInRecurring: input.maintainDueDateOffset !== false,
				}));
			case "occurrence.unskip":
				return ok(buildMaterializedOccurrenceUnskipPlan({
					occurrenceTask: normalizeTaskForConformance(input.occurrenceTask ?? input.occurrence),
					parentTask: normalizeTaskForConformance(input.parentTask ?? input.parent),
					activeStatus: String(input.activeStatus || input.active_status || "open"),
					currentTimestamp: String(input.now || input.currentTimestamp || new Date().toISOString()),
					targetDate: stringOrUndefined(input.targetDate ?? input.date),
				}));
			case "config.map_tasknotes_plugin":
				return ok({ value: mapTasknotesPluginConfig(asRecord(input.data ?? input.config ?? input)) });
			case "config.detect_task_file":
				return ok({ value: detectTaskFile(normalizeTaskDetectionInput(input)) });
			case "config.merge_top_level":
				return configMergeTopLevel(input);
			case "config.spec_version_effective":
				return configSpecVersionEffective(input);
			case "config.resolve_collection_path":
				return configResolveCollectionPath(input);
			case "config.provider_behavior":
				return configProviderBehavior(input);
			case "config.validate_schema":
				return configValidateSchema(input);
			case "create_compat.create":
				return createCompatibleTask(input);
			case "validation.core_evaluate":
				return ok(validateCoreConformance(input));
			case "validation.time_entries":
				return ok(validateTimeEntries(input.entries));
			case "op.mutate_with_validation":
				return mutateWithValidation(input);
			case "op.update_patch":
				return updatePatch(input);
			case "op.atomic_write":
				return atomicWrite(input);
			case "op.idempotency_check":
				return ok({ idempotent: true });
			case "op.detect_conflict":
			case "op.dry_run":
				return ok({ value: asRecord(input) });
			case "op.complete_nonrecurring":
				return completeNonRecurring(input);
			case "op.uncomplete_nonrecurring":
				return uncompleteNonRecurring(input);
			case "op.error_shape":
				return ok({ operation: input.operation, code: input.code, message: String(input.message || input.code || "operation failed"), ...(input.field ? { field: input.field } : {}) });
			case "delete.remove":
				return deleteRecord(input);
			case "dependency.validate_entry":
				return ok({ value: normalizeDependencyEntry(input.entry ?? input.value), valid: !!normalizeDependencyEntry(input.entry ?? input.value) });
			case "dependency.validate_set":
				return ok({ value: normalizeDependencyList(input.entries ?? input.value) ?? [], valid: true });
			case "dependency.add":
				return ok({ value: serializeDependencies([...(normalizeDependencyList(input.existing) ?? []), ...(normalizeDependencyList(input.entry ?? input.value) ?? [])]) });
			case "dependency.remove":
				return ok({ value: removeDependency(input) });
			case "dependency.replace":
				return ok({ value: serializeDependencies(normalizeDependencyList(input.entries ?? input.value) ?? []) });
			case "dependency.missing_target_behavior":
				return ok({ blocked: true, issue: "unresolved_dependency_target", severity: "warning" });
			case "reminder.validate_entry":
				return ok({ valid: isRecord(input.entry ?? input.value) });
			case "reminder.validate_set":
				return ok({ valid: Array.isArray(input.entries ?? input.value) });
			case "reminder.add":
				return ok({ value: [...arrayValue(input.existing), input.entry ?? input.value] });
			case "reminder.update":
				return ok({ value: input.entry ?? input.value });
			case "reminder.remove":
				return ok({ value: arrayValue(input.existing).filter((entry) => asRecord(entry).id !== input.id) });
			case "link.parse":
				return ok({ value: String(input.value || "") });
			case "link.resolve":
				return ok({ value: String(input.value || input.path || "") });
			case "time.start": {
				const task = normalizeTaskForConformance(input.task);
				return ok(buildStartTimeTrackingPlan(task, String(input.now || new Date().toISOString())));
			}
			case "time.stop": {
				const task = normalizeTaskForConformance(input.task);
				const active = getActiveTimeEntry(task);
				if (!active) return err("no_active_time_entry");
				return ok(buildStopTimeTrackingPlan(task, active, String(input.now || new Date().toISOString())));
			}
			case "time.replace_entries": {
				const task = normalizeTaskForConformance(input.task);
				return ok({ updatedTask: replaceTimeEntries(task, arrayValue(input.entries) as TimeEntry[], String(input.now || new Date().toISOString())) });
			}
			case "time.remove_entry": {
				const task = normalizeTaskForConformance(input.task);
				return ok(buildDeleteTimeEntryPlan(task, Number(input.index ?? 0), String(input.now || new Date().toISOString())));
			}
			case "time.auto_stop_on_complete":
				return ok({ value: true });
			case "time.report_totals":
				return ok({ minutes: calculateTotalTrackedMinutes(arrayValue(input.entries) as TimeEntry[]) });
			default:
				return err(`Unsupported operation: ${operation}`, { operation, code: "unsupported_operation" });
		}
	} catch (error) {
		return err(error instanceof Error ? error.message : String(error), { operation, code: "exception" });
	}
}

function ok(result: unknown): ConformanceEnvelope {
	return { ok: true, result };
}

function err(error: string, errorDetails?: Record<string, unknown>): ConformanceEnvelope {
	return { ok: false, error, error_details: errorDetails };
}

function localYmd(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function dateParseLocal(input: Record<string, unknown>): ConformanceEnvelope {
	const parsed = parseDateToLocal(String(input.value || ""));
	return ok({ localDate: localYmd(parsed), isoDate: formatDateForStorage(parsed) });
}

function dayInTimezone(input: Record<string, unknown>): ConformanceEnvelope {
	const instant = parseDateToUTC(String(input.instant ?? input.value ?? ""));
	const timezone = stringOrUndefined(input.timezone)?.trim();
	if (!timezone) return err("timezone missing");
	try {
		const parts = new Intl.DateTimeFormat("en-CA", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).formatToParts(instant);
		const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
		const year = part("year");
		const month = part("month");
		const day = part("day");
		return year && month && day ? ok({ value: `${year}-${month}-${day}` }) : err("timezone conversion failed");
	} catch {
		return err(`invalid timezone: ${timezone}`);
	}
}

function normalizeTaskDetectionInput(input: Record<string, unknown>): Parameters<typeof detectTaskFile>[0] {
	const source = asRecord(input.taskDetection);
	return {
		frontmatter: asRecord(input.frontmatter),
		body: stringOrUndefined(input.body),
		filePath: stringOrUndefined(input.filePath),
		taskDetection: {
			method: source.method as "tag" | "property" | undefined,
			methods: Array.isArray(source.methods) ? source.methods.map(String) : undefined,
			combine: source.combine === "and" ? "and" : source.combine === "or" ? "or" : undefined,
			tag: stringOrUndefined(source.tag) ?? "task",
			propertyName: stringOrUndefined(source.property_name ?? source.propertyName) ?? "",
			propertyValue: stringOrUndefined(source.property_value ?? source.propertyValue) ?? "",
			excludedFolders: source.excluded_folders as string | string[] | undefined,
		},
	};
}

function configMergeTopLevel(input: Record<string, unknown>): ConformanceEnvelope {
	const merged: Record<string, unknown> = {};
	for (const provider of arrayValue(input.providers)) {
		if (isRecord(provider)) Object.assign(merged, provider);
	}
	return ok({ value: merged });
}

function configSpecVersionEffective(input: Record<string, unknown>): ConformanceEnvelope {
	const provider = stringOrUndefined(input.providerSpecVersion)?.trim();
	const target = stringOrUndefined(input.targetSpecVersion)?.trim() || TASKNOTES_SPEC_VERSION;
	return ok(provider ? { value: provider, synthesized: false } : { value: target, synthesized: true });
}

function configResolveCollectionPath(input: Record<string, unknown>): ConformanceEnvelope {
	const normalize = (value: unknown): string | undefined => {
		if (value === null || value === undefined) return undefined;
		const text = String(value).trim().replace(/\\/g, "/");
		if (!text) return undefined;
		return text.replace(/^\.\//, "").replace(/\/\.\//g, "/");
	};
	return ok({
		value:
			normalize(input.flagPath ?? input.path) ??
			normalize(input.envPath) ??
			normalize(input.persistedPath) ??
			normalize(input.cwd) ??
			".",
	});
}

function configProviderBehavior(input: Record<string, unknown>): ConformanceEnvelope {
	const mode = stringOrUndefined(input.mode) ?? "strict";
	if (mode !== "strict" && mode !== "permissive") return err("configuration mode unsupported");
	if (mode === "strict" && (input.providersReadable !== true || input.hasRequiredKeys !== true)) {
		return err("strict configuration requires providers readable and required effective keys");
	}
	return ok({ value: "accepted" });
}

const DEPENDENCY_RELTYPES = new Set(["FINISHTOSTART", "STARTTOSTART", "FINISHTOFINISH", "STARTTOFINISH"]);

function configValidateSchema(input: Record<string, unknown>): ConformanceEnvelope {
	const kind = stringOrUndefined(input.kind) ?? "";
	const value = asRecord(input.value);
	if (kind === "validation") {
		if (value.mode !== undefined && value.mode !== "strict" && value.mode !== "permissive") return err("validation.mode unsupported");
		if (value.reject_unknown_fields !== undefined && typeof value.reject_unknown_fields !== "boolean") return err("validation.reject_unknown_fields invalid");
		return ok({ value: "valid" });
	}
	if (kind === "title") {
		if (value.storage !== undefined && value.storage !== "filename" && value.storage !== "frontmatter") return err("title.storage invalid");
		if (value.filename_format !== undefined && value.filename_format !== "slug" && value.filename_format !== "custom") return err("title.filename_format invalid");
		if (value.filename_format === "custom" && !stringOrUndefined(value.custom_filename_template)?.trim()) return err("title.custom_filename_template missing");
		return ok({ value: "valid" });
	}
	if (kind === "templating") {
		if (value.enabled !== undefined && typeof value.enabled !== "boolean") return err("templating.enabled invalid");
		if (value.enabled === true && !stringOrUndefined(value.template_path)?.trim()) return err("templating.template_path missing");
		if (value.failure_mode !== undefined && value.failure_mode !== "warning_fallback" && value.failure_mode !== "error_abort") return err("templating.failure_mode invalid");
		if (value.unknown_variable_policy !== undefined && !["preserve", "error", "empty"].includes(String(value.unknown_variable_policy))) return err("templating.unknown_variable_policy invalid");
		return ok({ value: "valid" });
	}
	if (kind === "reminders") {
		if (value.date_only_anchor_time !== undefined && (typeof value.date_only_anchor_time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.date_only_anchor_time))) return err("reminders.date_only_anchor_time invalid");
		if (value.apply_defaults_when_explicit !== undefined && typeof value.apply_defaults_when_explicit !== "boolean") return err("reminders.apply_defaults_when_explicit invalid");
		return ok({ value: "valid" });
	}
	if (kind === "time_tracking") {
		if (value.auto_stop_on_complete !== undefined && typeof value.auto_stop_on_complete !== "boolean") return err("time_tracking.auto_stop_on_complete invalid");
		if (value.auto_stop_notification !== undefined && typeof value.auto_stop_notification !== "boolean") return err("time_tracking.auto_stop_notification invalid");
		return ok({ value: "valid" });
	}
	if (kind === "status") {
		const values = arrayValue(value.values).filter((entry): entry is string => typeof entry === "string");
		if (value.values !== undefined && values.length !== arrayValue(value.values).length) return err("status.values invalid");
		if (typeof value.default === "string" && values.length && !values.includes(value.default)) return err("status.default must be one of status.values");
		if (value.completed_values !== undefined) {
			const completed = arrayValue(value.completed_values).filter((entry): entry is string => typeof entry === "string");
			if (!completed.length) return err("status.completed_values non-empty");
			if (completed.length !== arrayValue(value.completed_values).length) return err("status.completed_values invalid");
			if (values.length && completed.some((entry) => !values.includes(entry))) return err("status.completed_values must be in status.values");
		}
		return ok({ value: "valid" });
	}
	if (kind === "task_detection") {
		if (value.combine !== undefined && value.combine !== "and" && value.combine !== "or") return err("task_detection.combine invalid");
		return ok({ value: "valid" });
	}
	if (kind === "dependencies") {
		if (value.default_reltype !== undefined && !DEPENDENCY_RELTYPES.has(String(value.default_reltype))) return err("dependencies.default_reltype invalid");
		if (value.unresolved_target_severity !== undefined && value.unresolved_target_severity !== "warning" && value.unresolved_target_severity !== "error") return err("dependencies.unresolved_target_severity invalid");
		return ok({ value: "valid" });
	}
	if (kind === "links") {
		if (value.extensions !== undefined && (!Array.isArray(value.extensions) || value.extensions.some((entry) => typeof entry !== "string"))) return err("links.extensions invalid");
		if (value.unresolved_default_severity !== undefined && value.unresolved_default_severity !== "warning" && value.unresolved_default_severity !== "error") return err("links.unresolved_default_severity invalid");
		return ok({ value: "valid" });
	}
	return err(`config kind unsupported:${kind}`);
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function normalizeTaskForConformance(value: unknown): TaskInfo {
	const record = asRecord(value);
	return {
		title: typeof record.title === "string" ? record.title : "",
		status: typeof record.status === "string" ? record.status : "open",
		priority: typeof record.priority === "string" ? record.priority : "normal",
		path: typeof record.path === "string" ? record.path : "task.md",
		archived: record.archived === true,
		...record,
	} as TaskInfo;
}

function addConformanceIssue(
	issues: Record<string, unknown>[],
	code: string,
	severity: "error" | "warning" | "info",
	field?: string,
	message?: string
): void {
	issues.push({ code, severity, ...(field ? { field } : {}), ...(message ? { message } : {}) });
}

function validateCoreConformance(input: Record<string, unknown>): Record<string, unknown> {
	const fields = asRecord(input.fields);
	const frontmatter = asRecord(input.frontmatter);
	const mapping = buildSpecFieldMapping(fields, stringOrUndefined(input.displayNameKey));
	const normalized = normalizeSpecFrontmatter(frontmatter, mapping);
	const issues: Record<string, unknown>[] = [];
	for (const role of ["status", "dateCreated", "dateModified"] as const) {
		const value = normalized[role];
		if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
			addConformanceIssue(issues, "missing_required", "error", mapping.roleToField[role]);
		}
	}
	const title = resolveDisplayTitle(frontmatter, mapping, stringOrUndefined(input.taskPath));
	if (!title?.trim()) addConformanceIssue(issues, "unresolvable_title", "error", mapping.roleToField.title);

	for (const role of ["status", "due", "scheduled", "completedDate", "dateCreated", "dateModified"] as const) {
		const value = normalized[role];
		if (value !== undefined && value !== null && value !== "" && typeof value !== "string") {
			addConformanceIssue(issues, "invalid_type", "error", mapping.roleToField[role]);
		}
	}
	for (const role of ["tags", "contexts", "projects"] as const) {
		const value = normalized[role];
		if (value !== undefined && value !== null && !Array.isArray(value)) {
			addConformanceIssue(issues, "invalid_type", "error", mapping.roleToField[role]);
		}
	}

	for (const role of ["due", "scheduled", "completedDate", "dateCreated", "dateModified"] as const) {
		const value = normalized[role];
		if (typeof value !== "string" || !value.trim()) continue;
		try {
			if (role === "completedDate" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("date required");
			parseDateToUTC(value);
		} catch {
			addConformanceIssue(issues, "invalid_date_value", "error", mapping.roleToField[role]);
		}
	}
	if (typeof normalized.status === "string" && isSpecCompletedStatus(mapping, normalized.status) && !normalized.recurrence) {
		if (normalized.completedDate === undefined || normalized.completedDate === null || normalized.completedDate === "") {
			addConformanceIssue(issues, "missing_required", "error", mapping.roleToField.completedDate);
		}
	}
	if (typeof normalized.dateCreated === "string" && typeof normalized.dateModified === "string") {
		try {
			if (parseDateToUTC(normalized.dateModified).getTime() < parseDateToUTC(normalized.dateCreated).getTime()) {
				addConformanceIssue(issues, "date_modified_before_created", "error", mapping.roleToField.dateModified);
			}
		} catch {
			// Invalid temporal values were reported above.
		}
	}

	const timeEntries = normalized.timeEntries;
	if (timeEntries !== undefined && timeEntries !== null) {
		if (!Array.isArray(timeEntries)) {
			addConformanceIssue(issues, "invalid_type", "error", mapping.roleToField.timeEntries);
		} else {
			let active = 0;
			for (const entry of timeEntries) {
				if (!isRecord(entry) || typeof entry.startTime !== "string" || !entry.startTime) {
					addConformanceIssue(issues, "missing_time_entry_start", "error", mapping.roleToField.timeEntries);
					continue;
				}
				if (!entry.endTime) active += 1;
			}
			if (active > 1) addConformanceIssue(issues, "multiple_active_time_entries", "error", mapping.roleToField.timeEntries);
		}
	}

	const known = new Set([...Object.values(mapping.roleToField), ...Object.keys(mapping.roleToField)]);
	for (const key of Object.keys(frontmatter)) {
		if (!known.has(key)) addConformanceIssue(issues, "unknown_field", input.rejectUnknownFields ? "error" : "info", key);
	}
	const codes = (severity: string) => issues.filter((issue) => issue.severity === severity).map((issue) => String(issue.code));
	return {
		hasErrors: codes("error").length > 0,
		issues,
		errorCodes: codes("error"),
		warningCodes: codes("warning"),
		infoCodes: codes("info"),
		allCodes: [...new Set(issues.map((issue) => String(issue.code)))],
	};
}

function mutateWithValidation(input: Record<string, unknown>): ConformanceEnvelope {
	const frontmatter = asRecord(input.frontmatter);
	for (const field of ["title", "status", "dateCreated", "dateModified"]) {
		if (typeof frontmatter[field] !== "string" || !String(frontmatter[field]).trim()) {
			return err(`validation invalid_type or missing_required: ${field}`);
		}
	}
	return ok({ value: "accepted" });
}

function atomicWrite(input: Record<string, unknown>): ConformanceEnvelope {
	const original = asRecord(input.original);
	return input.simulateFailureAfterWrite === true
		? ok({ committed: false, persisted: original })
		: ok({ committed: true, persisted: { ...original, ...asRecord(input.patch) } });
}

function updatePatch(input: Record<string, unknown>): ConformanceEnvelope {
	const original = asRecord(input.original);
	const patch = asRecord(input.patch);
	return ok({
		changed: Object.entries(patch).some(([key, value]) => !Object.is(original[key], value)),
		frontmatter: { ...original, ...patch },
	});
}

function createCompatibleTask(input: Record<string, unknown>): ConformanceEnvelope {
	if (input.forceCreateError) return err(String(input.forceCreateError));
	const type = asRecord(input.taskType);
	const fields = asRecord(type.fields);
	const frontmatter = { ...asRecord(input.frontmatter) };
	const now = stringOrUndefined(input.fixedNow) ? new Date(String(input.fixedNow)) : new Date();
	if (Number.isNaN(now.getTime())) return err("invalid fixedNow");
	for (const [name, rawDefinition] of Object.entries(fields)) {
		const definition = asRecord(rawDefinition);
		if (definition.default !== undefined && !hasCreateValue(frontmatter[name])) {
			frontmatter[name] = definition.default;
		}
	}
	for (const field of ["dateCreated", "dateModified"]) {
		if (fields[field] && !hasCreateValue(frontmatter[field])) frontmatter[field] = now.toISOString();
	}
	const where = asRecord(asRecord(type.match).where);
	for (const [field, rawCondition] of Object.entries(where)) {
		if (!isRecord(rawCondition)) {
			if (!hasCreateValue(frontmatter[field])) frontmatter[field] = rawCondition;
			continue;
		}
		if (rawCondition.eq !== undefined && !hasCreateValue(frontmatter[field])) frontmatter[field] = rawCondition.eq;
		else if (rawCondition.contains !== undefined) {
			const current = frontmatter[field];
			if (Array.isArray(current)) {
				if (!current.some((entry) => String(entry) === String(rawCondition.contains))) frontmatter[field] = [...current, rawCondition.contains];
			} else if (typeof current === "string") {
				if (!current.includes(String(rawCondition.contains))) frontmatter[field] = `${current} ${String(rawCondition.contains)}`.trim();
			} else if (!hasCreateValue(current)) frontmatter[field] = [rawCondition.contains];
		} else if (rawCondition.exists === true && !hasCreateValue(frontmatter[field])) frontmatter[field] = true;
	}

	const pattern = stringOrUndefined(type.path_pattern)?.trim();
	if (!pattern) return err("path_required");
	const values = createTemplateValues(frontmatter, now);
	const missing = new Set<string>();
	const rendered = pattern.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (_match, left: string, right: string) => {
		const key = left ?? right;
		const value = values[key];
		if (!value) {
			missing.add(key);
			return "";
		}
		return value;
	});
	if (missing.size) return err(`path_required: missing template values for ${[...missing].sort().join(", ")}`);
	const path = rendered
		.replace(/\\/g, "/")
		.split("/")
		.map((entry) => entry.trim())
		.filter((entry) => entry && entry !== ".")
		.join("/");
	if (!path || path.includes("..") || path.includes("\0")) return err("path_required: invalid path");
	return ok({ path: path.endsWith(".md") ? path : `${path}.md`, frontmatter, warnings: [], callCount: 2 });
}

function createTemplateValues(frontmatter: Record<string, unknown>, now: Date): Record<string, string> {
	const read = (value: unknown): string =>
		typeof value === "string" || typeof value === "number" || typeof value === "boolean"
			? String(value).trim()
			: "";
	const sanitize = (value: string): string =>
		value.replace(/[<>:"|?*\u0000-\u001f]/g, "").replace(/[\\/]+/g, "-").replace(/\s+/g, " ").trim();
	const rawTitle = read(frontmatter.title) || "task";
	const words = rawTitle.split(/[^A-Za-z0-9]+/).filter(Boolean);
	const cap = (value: string) => value ? `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}` : "";
	const pad = (value: number) => String(value).padStart(2, "0");
	const year = String(now.getFullYear());
	const month = pad(now.getMonth() + 1);
	const day = pad(now.getDate());
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	const priority = sanitize(read(frontmatter.priority) || "normal");
	const status = sanitize(read(frontmatter.status) || "open");
	const values: Record<string, string> = {
		title: sanitize(rawTitle),
		titleKebab: words.map((word) => word.toLowerCase()).join("-"),
		titleSnake: words.map((word) => word.toLowerCase()).join("_"),
		titleCamel: words.length ? words[0].toLowerCase() + words.slice(1).map(cap).join("") : "",
		titlePascal: words.map(cap).join(""),
		titleUpper: rawTitle.toUpperCase(),
		titleLower: rawTitle.toLowerCase(),
		priority,
		priorityShort: priority.slice(0, 3).toLowerCase(),
		status,
		statusShort: status.slice(0, 3).toLowerCase(),
		due: read(frontmatter.due),
		dueDate: read(frontmatter.due),
		scheduled: read(frontmatter.scheduled),
		scheduledDate: read(frontmatter.scheduled),
		year,
		month,
		day,
		date: `${year}-${month}-${day}`,
		shortDate: `${year}${month}${day}`,
		time,
		timestamp: `${year}${month}${day}${time}`,
		zettel: `${year}${month}${day}${time}`,
		week: pad(isoWeek(now)),
		monthName: sanitize(new Intl.DateTimeFormat("en", { month: "long" }).format(now)),
		monthNameShort: sanitize(new Intl.DateTimeFormat("en", { month: "short" }).format(now)),
	};
	for (const key of ["contexts", "projects", "tags"]) {
		const value = frontmatter[key];
		values[key] = (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((entry) => sanitize(read(entry))).filter(Boolean).join("-");
	}
	values.timeEstimate = read(frontmatter.timeEstimate);
	for (const [key, value] of Object.entries(frontmatter)) if (values[key] === undefined) values[key] = sanitize(read(value));
	return values;
}

function isoWeek(date: Date): number {
	const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
	const start = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
	return Math.ceil(((value.getTime() - start.getTime()) / 86_400_000 + 1) / 7);
}

function hasCreateValue(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	if (typeof value === "string") return !!value.trim();
	if (Array.isArray(value)) return value.length > 0;
	return true;
}

function normalizeRecurrenceCompletionInput(input: Record<string, unknown>) {
	return {
		recurrence: String(input.recurrence || ""),
		recurrenceAnchor: stringOrUndefined(input.recurrenceAnchor ?? input.recurrence_anchor),
		scheduled: stringOrUndefined(input.scheduled),
		due: stringOrUndefined(input.due),
		dateCreated: stringOrUndefined(input.dateCreated ?? input.date_created),
		completionDate: String((input.completionDate ?? input.completion_date ?? input.date) || ""),
		completeInstances: arrayValue(input.completeInstances ?? input.complete_instances) as string[],
		skippedInstances: arrayValue(input.skippedInstances ?? input.skipped_instances) as string[],
	};
}

function normalizeRecurrenceScheduleInput(input: Record<string, unknown>) {
	return {
		recurrence: String(input.recurrence || ""),
		recurrenceAnchor: stringOrUndefined(input.recurrenceAnchor ?? input.recurrence_anchor),
		scheduled: stringOrUndefined(input.scheduled),
		due: stringOrUndefined(input.due),
		dateCreated: stringOrUndefined(input.dateCreated ?? input.date_created),
		completeInstances: arrayValue(input.completeInstances ?? input.complete_instances) as string[],
		skippedInstances: arrayValue(input.skippedInstances ?? input.skipped_instances) as string[],
		referenceDate: String((input.referenceDate ?? input.reference_date ?? input.date) || ""),
	};
}

function addRemoveInstance(
	input: Record<string, unknown>,
	field: "completeInstances" | "skippedInstances",
	shouldAdd: boolean
): Record<string, unknown> {
	const date = String(input.date || "");
	const values = new Set(arrayValue(input[field] ?? input[field === "completeInstances" ? "complete_instances" : "skipped_instances"]) as string[]);
	if (shouldAdd) values.add(date);
	else values.delete(date);
	return { [field]: [...values] };
}

function removeInstance(input: Record<string, unknown>, field: "completeInstances"): Record<string, unknown> {
	return addRemoveInstance(input, field, false);
}

function completeNonRecurring(input: Record<string, unknown>): ConformanceEnvelope {
	const statuses = arrayValue(input.completedValues).filter((entry): entry is string => typeof entry === "string" && !!entry.trim());
	const explicit = stringOrUndefined(input.explicitDate)?.trim();
	return ok({
		status: statuses[0] ?? "done",
		completedDate: explicit ? validateDateString(getDatePart(explicit)) : localYmd(new Date()),
	});
}

function uncompleteNonRecurring(input: Record<string, unknown>): ConformanceEnvelope {
	const frontmatter = asRecord(input.frontmatter);
	return ok({
		status: stringOrUndefined(input.defaultStatus) ?? "open",
		completedDate: input.clearCompletedDate === true ? null : (frontmatter.completedDate ?? null),
	});
}

function deleteRecord(input: Record<string, unknown>): ConformanceEnvelope {
	if (input.checkBacklinks === true && input.force !== true && arrayValue(input.brokenLinks).length > 0) {
		return err("backlink dependency prevents delete without force");
	}
	return ok({ deleted: true });
}

function removeDependency(input: Record<string, unknown>): unknown[] {
	const existing = normalizeDependencyList(input.existing) ?? [];
	const target = normalizeDependencyEntry(input.entry ?? input.value);
	if (!target) return serializeDependencies(existing);
	return serializeDependencies(existing.filter((entry) => entry.uid !== target.uid));
}

export { DEFAULT_FIELD_MAPPING, DEFAULT_PRIORITIES, DEFAULT_STATUSES };
