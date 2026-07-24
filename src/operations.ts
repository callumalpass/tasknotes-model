import { formatDateForStorage, getDatePart, parseDateToUTC, validateDateString } from "./date";
import { isCompletedStatus } from "./config";
import {
	addDTSTARTToRecurrenceRule,
	completeRecurringTask,
	getRecurringTaskActionDate,
	isDueByRRule,
	recalculateRecurringSchedule,
	updateDTSTARTInRecurrenceRule,
	updateToNextScheduledOccurrence,
} from "./recurrence";
import {
	buildStartTimeTrackingPlan,
	buildStopTimeTrackingPlan,
	getActiveTimeEntry,
	sanitizeTimeEntries,
} from "./time";
import {
	coerceStatusFrontmatterValue,
	mapTaskToFrontmatter,
	normalizeDependencyEntry,
	parseLinkToPath,
	serializeDependencies,
} from "./mapping";
import type {
	FieldMapping,
	FieldMappingKey,
	OccurrenceMaterializationMode,
	OccurrenceNextTrigger,
	StatusConfig,
	TaskDependency,
	TaskInfo,
	TaskOperationPlan,
	TaskPatchOperation,
	TaskUpdateInput,
	TaskValidationIssue,
	TimeEntry,
	UserMappedField,
} from "./types";

export interface BuildTaskUpdatePlanInput {
	originalTask: TaskInfo;
	updates: TaskUpdateInput;
	fieldMapping: FieldMapping;
	taskTag?: string;
	storeTitleInFilename?: boolean;
	userFields?: readonly UserMappedField[];
	statuses?: readonly StatusConfig[];
	now?: string;
	currentDateString?: string;
	maintainDueDateOffsetInRecurring?: boolean;
}

export interface BuildTaskPropertyUpdatePlanInput {
	freshTask: TaskInfo;
	property: keyof TaskInfo;
	value: unknown;
	fieldMapping: FieldMapping;
	statuses?: readonly StatusConfig[];
	now: string;
	currentDateString: string;
}

export interface RecurringTaskCompletePlan {
	updatedTask: TaskInfo;
	targetDate: Date;
	dateStr: string;
	newComplete: boolean;
	dateModified: string;
	originalRecurrence: unknown;
}

export interface RecurringTaskSkippedPlan {
	updatedTask: TaskInfo;
	targetDate: Date;
	dateStr: string;
	newSkipped: boolean;
	dateModified: string;
}

export interface BuildMaterializeOccurrencePlanInput {
	parentTask: TaskInfo;
	targetDate: string | Date;
	currentTimestamp: string;
	existingOccurrences?: readonly TaskInfo[];
	parentLink?: string;
	defaultStatus?: string;
	defaultPriority?: string;
	templateTask?: Partial<TaskInfo>;
	overrides?: Partial<TaskInfo>;
	allowNonGeneratedTarget?: boolean;
}

export interface MaterializeOccurrencePlan {
	kind: "occurrence.materialize";
	parentTask: TaskInfo;
	targetDate: string;
	parentReference: string;
	created: boolean;
	existingOccurrence?: TaskInfo;
	occurrenceTask: Partial<TaskInfo>;
	fields: Record<string, unknown>;
	issues: TaskValidationIssue[];
	metadata: Record<string, unknown>;
}

export interface BuildMaterializedOccurrenceCompletePlanInput {
	occurrenceTask: TaskInfo;
	parentTask: TaskInfo;
	completedStatus: string;
	currentTimestamp: string;
	targetDate?: string | Date;
	maintainDueDateOffsetInRecurring: boolean;
}

export interface BuildMaterializedOccurrenceUncompletePlanInput {
	occurrenceTask: TaskInfo;
	parentTask: TaskInfo;
	activeStatus: string;
	currentTimestamp: string;
	targetDate?: string | Date;
}

export interface BuildMaterializedOccurrenceSkipPlanInput {
	occurrenceTask: TaskInfo;
	parentTask: TaskInfo;
	skippedStatus?: string;
	currentTimestamp: string;
	targetDate?: string | Date;
	maintainDueDateOffsetInRecurring: boolean;
}

export interface BuildMaterializedOccurrenceUnskipPlanInput {
	occurrenceTask: TaskInfo;
	parentTask: TaskInfo;
	activeStatus: string;
	currentTimestamp: string;
	targetDate?: string | Date;
}

export interface MaterializedOccurrenceStatusPlan {
	kind:
		| "occurrence.complete"
		| "occurrence.uncomplete"
		| "occurrence.skip"
		| "occurrence.unskip";
	targetDate: string;
	updatedOccurrenceTask: TaskInfo;
	updatedParentTask: TaskInfo;
	occurrenceUpdates: Partial<TaskInfo>;
	parentUpdates: Partial<TaskInfo>;
	occurrenceFields: Record<string, unknown>;
	parentFields: Record<string, unknown>;
	dateModified: string;
	changed: boolean;
	materializeNextDate?: string;
	metadata: Record<string, unknown>;
}

export interface SpecTaskUpdatePlan {
	fields: Record<string, unknown>;
	updatedTask: TaskInfo;
	dateModified?: string;
	changed: boolean;
	metadata?: Record<string, unknown>;
}

export interface BuildSpecCompleteTaskUpdateInput {
	frontmatter: Record<string, unknown>;
	targetDate: string;
	completedStatus: string;
	currentTimestamp?: string;
	path?: string;
}

export interface BuildSpecRecurringSkipUpdateInput {
	frontmatter: Record<string, unknown>;
	targetDate: string;
	skip: boolean;
	currentTimestamp?: string;
	path?: string;
}

export interface BuildSpecTimeTrackingUpdateInput {
	frontmatter: Record<string, unknown>;
	currentTimestamp: string;
	path?: string;
}

export interface BuildSpecStartTimeTrackingUpdateInput extends BuildSpecTimeTrackingUpdateInput {
	startTimestamp?: string;
	description?: string;
}

export interface BuildSpecStopTimeTrackingUpdateInput extends BuildSpecTimeTrackingUpdateInput {
	stopTimestamp?: string;
}

export function buildTaskUpdatePlan({
	originalTask,
	updates,
	fieldMapping,
	taskTag,
	storeTitleInFilename = false,
	userFields = [],
	statuses = [],
	now = new Date().toISOString(),
	currentDateString = formatDateForStorage(parseDateToUTC(getDatePart(now))),
	maintainDueDateOffsetInRecurring = true,
}: BuildTaskUpdatePlanInput): TaskOperationPlan<TaskInfo> {
	const normalizedUpdates = normalizeTaskUpdateInput(updates);
	const dateModified = nextModifiedTimestamp(
		now,
		originalTask.dateCreated,
		originalTask.dateModified
	);
	const recurrenceUpdates = buildTaskUpdateRecurrenceUpdates({
		originalTask,
		updates: normalizedUpdates,
		maintainDueDateOffsetInRecurring,
	});
	const updatedTask = buildUpdatedTaskFromPlan({
		originalTask,
		updates: normalizedUpdates,
		recurrenceUpdates,
		newPath: originalTask.path,
		dateModified,
		currentDateString,
		normalizedDetails: normalizeTaskUpdateDetails(normalizedUpdates),
		isCompletedStatus: (status) => isCompletedStatus(status, statuses),
	});
	const mapped = mapTaskToFrontmatter(
		fieldMapping,
		updatedTask,
		taskTag,
		storeTitleInFilename,
		userFields
	);
	const frontmatterPatch = buildSetPatch(mapped);
	addUnsetMappedFieldDeletes(frontmatterPatch, { ...normalizedUpdates, ...recurrenceUpdates }, fieldMapping);
	return {
		kind: "task.update",
		updatedTask,
		frontmatterPatch,
		dateModified,
		metadata: { recurrenceUpdates },
	};
}

function nextModifiedTimestamp(
	candidate: string,
	dateCreated?: string,
	previousModified?: string
): string {
	const candidateTime = Date.parse(candidate);
	if (!Number.isFinite(candidateTime)) return candidate;
	const storedTimes = [dateCreated, previousModified]
		.map((value) => (value ? Date.parse(value) : Number.NaN))
		.filter((value) => Number.isFinite(value));
	if (storedTimes.length === 0) return candidate;
	const floor = Math.max(...storedTimes);
	if (candidateTime > floor) return candidate;
	return new Date(floor + 1).toISOString();
}

export function normalizeTaskUpdateInput(updates: TaskUpdateInput): TaskUpdateInput {
	if (!Array.isArray(updates.timeEntries)) {
		return { ...updates };
	}
	return {
		...updates,
		timeEntries: updates.timeEntries.map(stripTimeEntryDuration),
	};
}

export function normalizeTaskUpdateDetails(updates: TaskUpdateInput): string | null {
	if (!Object.prototype.hasOwnProperty.call(updates, "details")) {
		return null;
	}
	return typeof updates.details === "string" ? updates.details.replace(/\r\n/g, "\n") : "";
}

export function buildTaskUpdateRecurrenceUpdates({
	originalTask,
	updates,
	maintainDueDateOffsetInRecurring,
}: {
	originalTask: TaskInfo;
	updates: TaskUpdateInput;
	maintainDueDateOffsetInRecurring: boolean;
}): Partial<TaskInfo> {
	const recurrenceUpdates: Partial<TaskInfo> = {};

	if (updates.recurrence !== undefined && updates.recurrence !== originalTask.recurrence) {
		const tempTask: TaskInfo = { ...originalTask, ...updates };
		const nextDates = updateToNextScheduledOccurrence(tempTask, maintainDueDateOffsetInRecurring);
		if (nextDates.scheduled) recurrenceUpdates.scheduled = nextDates.scheduled;
		if (nextDates.due) recurrenceUpdates.due = nextDates.due;
		if (typeof updates.recurrence === "string" && updates.recurrence && !updates.recurrence.includes("DTSTART:")) {
			const updatedRecurrence = addDTSTARTToRecurrenceRule({
				...originalTask,
				...updates,
				...recurrenceUpdates,
			});
			if (updatedRecurrence) recurrenceUpdates.recurrence = updatedRecurrence;
		}
	} else if (updates.recurrence !== undefined && !originalTask.recurrence && updates.recurrence) {
		if (typeof updates.recurrence === "string" && !updates.recurrence.includes("DTSTART:")) {
			const updatedRecurrence = addDTSTARTToRecurrenceRule({ ...originalTask, ...updates });
			if (updatedRecurrence) recurrenceUpdates.recurrence = updatedRecurrence;
		}
	}

	if (
		updates.scheduled !== undefined &&
		updates.scheduled !== originalTask.scheduled &&
		originalTask.recurrence &&
		typeof originalTask.recurrence === "string" &&
		!originalTask.recurrence.includes("DTSTART:")
	) {
		const updatedRecurrence = addDTSTARTToRecurrenceRule({ ...originalTask, ...updates });
		if (updatedRecurrence) recurrenceUpdates.recurrence = updatedRecurrence;
	}

	return recurrenceUpdates;
}

export function buildUpdatedTaskFromPlan({
	originalTask,
	updates,
	recurrenceUpdates,
	newPath,
	dateModified,
	currentDateString,
	normalizedDetails,
	finalTags,
	isCompletedStatus: isCompletedStatusFn,
}: {
	originalTask: TaskInfo;
	updates: TaskUpdateInput;
	recurrenceUpdates: Partial<TaskInfo>;
	newPath: string;
	dateModified: string;
	currentDateString: string;
	normalizedDetails: string | null;
	finalTags?: string[];
	isCompletedStatus: (status: string) => boolean;
}): TaskInfo {
	const updatedTask: TaskInfo = {
		...originalTask,
		...updates,
		...recurrenceUpdates,
		path: newPath,
		dateModified,
	};
	if (finalTags) updatedTask.tags = finalTags;
	if (normalizedDetails !== null) updatedTask.details = normalizedDetails;
	if (updates.status !== undefined && !originalTask.recurrence) {
		if (isCompletedStatusFn(updates.status)) {
			if (!originalTask.completedDate) updatedTask.completedDate = currentDateString;
		} else {
			updatedTask.completedDate = undefined;
		}
	}
	return updatedTask;
}

export function buildTaskPropertyUpdatePlan({
	freshTask,
	property,
	value,
	fieldMapping,
	statuses = [],
	now,
	currentDateString,
}: BuildTaskPropertyUpdatePlanInput): TaskOperationPlan<TaskInfo> {
	const normalizedValue = normalizeTaskPropertyValue(property, value);
	const updatedTask = { ...freshTask, [property]: normalizedValue, dateModified: now } as TaskInfo;

	if (property === "status" && !freshTask.recurrence) {
		const status = String(normalizedValue ?? "");
		updatedTask.completedDate = isCompletedStatus(status, statuses) ? currentDateString : undefined;
	}

	const fieldName = fieldNameForTaskProperty(fieldMapping, property);
	const frontmatterPatch: TaskPatchOperation[] = [{ op: "set", field: fieldMapping.dateModified, value: now }];
	if (fieldName) {
		if ((property === "due" || property === "scheduled") && !value) {
			frontmatterPatch.push({ op: "delete", field: fieldName });
		} else if (property === "status") {
			const status = String(normalizedValue ?? "");
			frontmatterPatch.push({ op: "set", field: fieldName, value: coerceStatusFrontmatterValue(status) });
			if (!freshTask.recurrence && isCompletedStatus(status, statuses)) {
				frontmatterPatch.push({ op: "set", field: fieldMapping.completedDate, value: currentDateString });
			} else if (!freshTask.recurrence) {
				frontmatterPatch.push({ op: "delete", field: fieldMapping.completedDate });
			}
		} else if (property === "blockedBy") {
			const dependencies = Array.isArray(normalizedValue) ? (normalizedValue as TaskDependency[]) : [];
			if (dependencies.length > 0) {
				frontmatterPatch.push({ op: "set", field: fieldName, value: serializeDependencies(dependencies) });
			} else {
				frontmatterPatch.push({ op: "delete", field: fieldName });
			}
		} else {
			frontmatterPatch.push({ op: "set", field: fieldName, value: normalizedValue });
		}
	}

	return {
		kind: "task.property-update",
		updatedTask,
		frontmatterPatch,
		dateModified: now,
		metadata: { property, normalizedValue },
	};
}

export function normalizeTaskPropertyValue(property: keyof TaskInfo, value: unknown): unknown {
	if (property === "blockedBy") {
		return normalizeBlockedByValue(value);
	}
	return value;
}

export function normalizeBlockedByValue(value: unknown): TaskDependency[] | undefined {
	if (value === null || value === undefined) return undefined;
	const normalized = (Array.isArray(value) ? value : [value])
		.map((entry) => normalizeDependencyEntry(entry))
		.filter((entry): entry is TaskDependency => !!entry);
	return normalized.length > 0 ? normalized : undefined;
}

export function buildRecurringTaskCompletePlan({
	freshTask,
	targetDate,
	currentTimestamp,
	maintainDueDateOffsetInRecurring,
}: {
	freshTask: TaskInfo;
	targetDate?: Date;
	currentTimestamp: string;
	maintainDueDateOffsetInRecurring: boolean;
}): RecurringTaskCompletePlan {
	if (!freshTask.recurrence) throw new Error("Task is not recurring");
	const resolvedTargetDate = getRecurringTaskActionDate(freshTask, targetDate);
	const dateStr = formatDateForStorage(resolvedTargetDate);
	const completeInstances = getStringArray(freshTask.complete_instances);
	const currentComplete = completeInstances.includes(dateStr);
	const newComplete = !currentComplete;
	const updatedTask: TaskInfo = { ...freshTask, dateModified: currentTimestamp };

	if (newComplete) {
		updatedTask.complete_instances = completeInstances.includes(dateStr)
			? completeInstances
			: [...completeInstances, dateStr];
		updatedTask.skipped_instances = getStringArray(freshTask.skipped_instances).filter((date) => date !== dateStr);
	} else {
		updatedTask.complete_instances = completeInstances.filter((date) => date !== dateStr);
		updatedTask.skipped_instances = getStringArray(freshTask.skipped_instances).filter((date) => date !== dateStr);
	}

	if (newComplete && typeof updatedTask.recurrence === "string") {
		if ((updatedTask.recurrence_anchor || "scheduled") === "completion") {
			updatedTask.recurrence = updateDTSTARTInRecurrenceRule(updatedTask.recurrence, dateStr) || updatedTask.recurrence;
		} else if (!updatedTask.recurrence.includes("DTSTART:")) {
			updatedTask.recurrence = addDTSTARTToRecurrenceRule(updatedTask) || updatedTask.recurrence;
		}
	}

	const nextDates = updateToNextScheduledOccurrence(updatedTask, maintainDueDateOffsetInRecurring);
	if (nextDates.scheduled) updatedTask.scheduled = nextDates.scheduled;
	if (nextDates.due) updatedTask.due = nextDates.due;

	return {
		updatedTask,
		targetDate: resolvedTargetDate,
		dateStr,
		newComplete,
		dateModified: currentTimestamp,
		originalRecurrence: freshTask.recurrence,
	};
}

export function buildRecurringTaskSkippedPlan({
	freshTask,
	targetDate,
	currentTimestamp,
	maintainDueDateOffsetInRecurring,
}: {
	freshTask: TaskInfo;
	targetDate?: Date;
	currentTimestamp: string;
	maintainDueDateOffsetInRecurring: boolean;
}): RecurringTaskSkippedPlan {
	if (!freshTask.recurrence) throw new Error("Task is not recurring");
	const resolvedTargetDate = getRecurringTaskActionDate(freshTask, targetDate);
	const dateStr = formatDateForStorage(resolvedTargetDate);
	const skippedInstances = getStringArray(freshTask.skipped_instances);
	const currentlySkipped = skippedInstances.includes(dateStr);
	const newSkipped = !currentlySkipped;
	const updatedTask: TaskInfo = { ...freshTask, dateModified: currentTimestamp };

	if (newSkipped) {
		updatedTask.skipped_instances = skippedInstances.includes(dateStr)
			? skippedInstances
			: [...skippedInstances, dateStr];
		updatedTask.complete_instances = getStringArray(freshTask.complete_instances).filter((date) => date !== dateStr);
	} else {
		updatedTask.skipped_instances = skippedInstances.filter((date) => date !== dateStr);
	}

	const nextDates = updateToNextScheduledOccurrence(updatedTask, maintainDueDateOffsetInRecurring);
	if (nextDates.scheduled) updatedTask.scheduled = nextDates.scheduled;
	if (nextDates.due) updatedTask.due = nextDates.due;

	return {
		updatedTask,
		targetDate: resolvedTargetDate,
		dateStr,
		newSkipped,
		dateModified: currentTimestamp,
	};
}

export function recurringCompletePlanToFrontmatterPatch(
	plan: RecurringTaskCompletePlan,
	fieldMapping: FieldMapping
): TaskPatchOperation[] {
	const patch: TaskPatchOperation[] = [
		{ op: "set", field: fieldMapping.completeInstances, value: plan.updatedTask.complete_instances || [] },
		{ op: "set", field: fieldMapping.skippedInstances, value: plan.updatedTask.skipped_instances || [] },
		{ op: "set", field: fieldMapping.dateModified, value: plan.dateModified },
	];
	if (plan.updatedTask.recurrence !== plan.originalRecurrence) {
		patch.push({ op: "set", field: fieldMapping.recurrence, value: plan.updatedTask.recurrence });
	}
	if (plan.updatedTask.scheduled) patch.push({ op: "set", field: fieldMapping.scheduled, value: plan.updatedTask.scheduled });
	if (plan.updatedTask.due) patch.push({ op: "set", field: fieldMapping.due, value: plan.updatedTask.due });
	return patch;
}

export function recurringSkippedPlanToFrontmatterPatch(
	plan: RecurringTaskSkippedPlan,
	fieldMapping: FieldMapping
): TaskPatchOperation[] {
	const patch: TaskPatchOperation[] = [
		{ op: "set", field: fieldMapping.skippedInstances, value: plan.updatedTask.skipped_instances || [] },
		{ op: "set", field: fieldMapping.completeInstances, value: plan.updatedTask.complete_instances || [] },
		{ op: "set", field: fieldMapping.dateModified, value: plan.dateModified },
	];
	if (plan.updatedTask.scheduled) patch.push({ op: "set", field: fieldMapping.scheduled, value: plan.updatedTask.scheduled });
	if (plan.updatedTask.due) patch.push({ op: "set", field: fieldMapping.due, value: plan.updatedTask.due });
	return patch;
}

export function getOccurrenceMaterializationMode(
	task: Partial<TaskInfo>,
	defaultMode: OccurrenceMaterializationMode = "manual"
): OccurrenceMaterializationMode {
	return isOccurrenceMaterializationMode(task.occurrence_materialization)
		? task.occurrence_materialization
		: defaultMode;
}

export function getOccurrenceNextTrigger(
	task: Partial<TaskInfo>,
	defaultTrigger: OccurrenceNextTrigger = "completion"
): OccurrenceNextTrigger {
	return isOccurrenceNextTrigger(task.occurrence_next_trigger)
		? task.occurrence_next_trigger
		: defaultTrigger;
}

export function isMaterializedOccurrenceTask(
	task: Partial<TaskInfo>
): task is Partial<TaskInfo> & { recurrence_parent: string; occurrence_date: string } {
	return typeof task.recurrence_parent === "string" && typeof task.occurrence_date === "string";
}

export function normalizeTaskReference(value: string | undefined): string {
	if (!value) return "";
	return parseLinkToPath(value)
		.replace(/\\/g, "/")
		.replace(/^\/+/, "")
		.replace(/\.md$/i, "")
		.trim()
		.toLowerCase();
}

export function defaultOccurrenceParentReference(parentTask: Pick<TaskInfo, "path">): string {
	return `[[${parentTask.path.replace(/\.md$/i, "")}]]`;
}

export function findMaterializedOccurrence(
	occurrences: readonly TaskInfo[],
	parentTask: Pick<TaskInfo, "path">,
	targetDate: string,
	parentReference = defaultOccurrenceParentReference(parentTask)
): TaskInfo | undefined {
	const normalizedParentPath = normalizeTaskReference(parentTask.path);
	const normalizedParentReference = normalizeTaskReference(parentReference);
	return occurrences.find((task) => {
		if (task.occurrence_date !== targetDate || !task.recurrence_parent) return false;
		const normalized = normalizeTaskReference(task.recurrence_parent);
		return normalized === normalizedParentPath || normalized === normalizedParentReference;
	});
}

export function buildMaterializeOccurrencePlan({
	parentTask,
	targetDate,
	currentTimestamp,
	existingOccurrences = [],
	parentLink,
	defaultStatus = parentTask.status,
	defaultPriority = parentTask.priority,
	templateTask = {},
	overrides = {},
	allowNonGeneratedTarget = true,
}: BuildMaterializeOccurrencePlanInput): MaterializeOccurrencePlan {
	if (!parentTask.recurrence) throw new Error("occurrence_parent_not_recurring");
	const dateStr = normalizeOccurrenceTargetDate(targetDate);
	const parentReference = parentLink || defaultOccurrenceParentReference(parentTask);
	const existingOccurrence = findMaterializedOccurrence(existingOccurrences, parentTask, dateStr, parentReference);
	const issues: TaskValidationIssue[] = [];

	if (!isDueByRecurrenceRule(parentTask, dateStr)) {
		issues.push({
			code: "materialization_target_not_generated",
			message: `Target date "${dateStr}" is not generated by the parent recurrence rule.`,
			severity: allowNonGeneratedTarget ? "warning" : "error",
			field: "occurrence_date",
		});
	}

	if (existingOccurrence) {
		return {
			kind: "occurrence.materialize",
			parentTask,
			targetDate: dateStr,
			parentReference,
			created: false,
			existingOccurrence,
			occurrenceTask: existingOccurrence,
			fields: taskInfoToSpecFields(existingOccurrence),
			issues,
			metadata: { idempotent: true },
		};
	}

	const inheritedTask = buildInheritedOccurrenceTask(parentTask, dateStr);
	const customProperties = mergeCustomProperties(
		inheritedTask.customProperties,
		templateTask.customProperties,
		overrides.customProperties
	);
	const occurrenceTask = removeUndefined({
		...inheritedTask,
		...templateTask,
		...overrides,
		id: undefined,
		path: undefined,
		archived: undefined,
		status: overrides.status ?? templateTask.status ?? defaultStatus,
		priority: overrides.priority ?? templateTask.priority ?? parentTask.priority ?? defaultPriority,
		scheduled: overrides.scheduled ?? templateTask.scheduled ?? inheritedTask.scheduled ?? dateStr,
		due: overrides.due ?? templateTask.due ?? inheritedTask.due,
		customProperties,
		recurrence: undefined,
		recurrence_anchor: undefined,
		complete_instances: undefined,
		skipped_instances: undefined,
		recurrence_parent: parentReference,
		occurrence_date: dateStr,
		occurrence_materialization: undefined,
		occurrence_next_trigger: undefined,
		occurrence_template: undefined,
		occurrence_past_horizon: undefined,
		occurrence_future_horizon: undefined,
		completedDate: undefined,
		timeEntries: undefined,
		totalTrackedTime: undefined,
		icsEventId: undefined,
		googleCalendarEventId: undefined,
		googleCalendarExceptionEventId: undefined,
		googleCalendarExceptionOriginalScheduled: undefined,
		googleCalendarMovedOriginalDates: undefined,
		basesData: undefined,
		blocking: undefined,
		isBlocked: undefined,
		isBlocking: undefined,
		hasSubtasks: undefined,
		dateCreated: overrides.dateCreated ?? templateTask.dateCreated ?? currentTimestamp,
		dateModified: overrides.dateModified ?? templateTask.dateModified ?? currentTimestamp,
	});

	return {
		kind: "occurrence.materialize",
		parentTask,
		targetDate: dateStr,
		parentReference,
		created: true,
		occurrenceTask,
		fields: taskInfoToSpecFields(occurrenceTask),
		issues,
		metadata: {
			idempotent: false,
			template: parentTask.occurrence_template,
		},
	};
}

export function buildMaterializedOccurrenceCompletePlan({
	occurrenceTask,
	parentTask,
	completedStatus,
	currentTimestamp,
	targetDate,
	maintainDueDateOffsetInRecurring,
}: BuildMaterializedOccurrenceCompletePlanInput): MaterializedOccurrenceStatusPlan {
	const dateStr = resolveOccurrenceDateOrThrow(occurrenceTask, targetDate);
	assertMaterializedOccurrence(occurrenceTask, dateStr);
	if (!parentTask.recurrence) throw new Error("occurrence_parent_not_recurring");

	const parentCompleteInstances = appendUnique(getStringArray(parentTask.complete_instances), dateStr);
	const parentSkippedInstances = getStringArray(parentTask.skipped_instances).filter((date) => date !== dateStr);
	const parentUpdates = buildRecurringParentProgressionUpdates({
		parentTask,
		targetDate: dateStr,
		completeInstances: parentCompleteInstances,
		skippedInstances: parentSkippedInstances,
		currentTimestamp,
		maintainDueDateOffsetInRecurring,
		advanceCompletionAnchor: true,
	});
	const occurrenceUpdates: Partial<TaskInfo> = {
		status: completedStatus,
		completedDate: dateStr,
		dateModified: currentTimestamp,
	};
	const updatedParentTask = { ...parentTask, ...parentUpdates };
	const updatedOccurrenceTask = { ...occurrenceTask, ...occurrenceUpdates };
	const materializeNextDate =
		getOccurrenceMaterializationMode(parentTask) === "on_completion"
			? getDatePart(updatedParentTask.scheduled || "")
			: undefined;

	return buildMaterializedOccurrenceStatusPlan({
		kind: "occurrence.complete",
		targetDate: dateStr,
		occurrenceTask,
		parentTask,
		updatedOccurrenceTask,
		updatedParentTask,
		occurrenceUpdates,
		parentUpdates,
		currentTimestamp,
		materializeNextDate,
		metadata: { trigger: "completion" },
	});
}

export function buildMaterializedOccurrenceUncompletePlan({
	occurrenceTask,
	parentTask,
	activeStatus,
	currentTimestamp,
	targetDate,
}: BuildMaterializedOccurrenceUncompletePlanInput): MaterializedOccurrenceStatusPlan {
	const dateStr = resolveOccurrenceDateOrThrow(occurrenceTask, targetDate);
	assertMaterializedOccurrence(occurrenceTask, dateStr);
	const parentUpdates: Partial<TaskInfo> = {
		complete_instances: getStringArray(parentTask.complete_instances).filter((date) => date !== dateStr),
		dateModified: currentTimestamp,
	};
	const occurrenceUpdates: Partial<TaskInfo> = {
		status: activeStatus,
		completedDate: undefined,
		dateModified: currentTimestamp,
	};
	return buildMaterializedOccurrenceStatusPlan({
		kind: "occurrence.uncomplete",
		targetDate: dateStr,
		occurrenceTask,
		parentTask,
		updatedOccurrenceTask: { ...occurrenceTask, ...occurrenceUpdates },
		updatedParentTask: { ...parentTask, ...parentUpdates },
		occurrenceUpdates,
		parentUpdates,
		currentTimestamp,
		metadata: { trigger: "uncomplete" },
	});
}

export function buildMaterializedOccurrenceSkipPlan({
	occurrenceTask,
	parentTask,
	skippedStatus,
	currentTimestamp,
	targetDate,
	maintainDueDateOffsetInRecurring,
}: BuildMaterializedOccurrenceSkipPlanInput): MaterializedOccurrenceStatusPlan {
	if (!skippedStatus) throw new Error("missing_skipped_status");
	const dateStr = resolveOccurrenceDateOrThrow(occurrenceTask, targetDate);
	assertMaterializedOccurrence(occurrenceTask, dateStr);
	if (!parentTask.recurrence) throw new Error("occurrence_parent_not_recurring");

	const parentSkippedInstances = appendUnique(getStringArray(parentTask.skipped_instances), dateStr);
	const parentCompleteInstances = getStringArray(parentTask.complete_instances).filter((date) => date !== dateStr);
	const parentUpdates = buildRecurringParentProgressionUpdates({
		parentTask,
		targetDate: dateStr,
		completeInstances: parentCompleteInstances,
		skippedInstances: parentSkippedInstances,
		currentTimestamp,
		maintainDueDateOffsetInRecurring,
		advanceCompletionAnchor: false,
	});
	const occurrenceUpdates: Partial<TaskInfo> = {
		status: skippedStatus,
		completedDate: undefined,
		dateModified: currentTimestamp,
	};
	const updatedParentTask = { ...parentTask, ...parentUpdates };
	const materializeNextDate =
		getOccurrenceMaterializationMode(parentTask) === "on_completion" &&
		getOccurrenceNextTrigger(parentTask) === "completion_or_skip"
			? getDatePart(updatedParentTask.scheduled || "")
			: undefined;

	return buildMaterializedOccurrenceStatusPlan({
		kind: "occurrence.skip",
		targetDate: dateStr,
		occurrenceTask,
		parentTask,
		updatedOccurrenceTask: { ...occurrenceTask, ...occurrenceUpdates },
		updatedParentTask,
		occurrenceUpdates,
		parentUpdates,
		currentTimestamp,
		materializeNextDate,
		metadata: { trigger: "skip" },
	});
}

export function buildMaterializedOccurrenceUnskipPlan({
	occurrenceTask,
	parentTask,
	activeStatus,
	currentTimestamp,
	targetDate,
}: BuildMaterializedOccurrenceUnskipPlanInput): MaterializedOccurrenceStatusPlan {
	const dateStr = resolveOccurrenceDateOrThrow(occurrenceTask, targetDate);
	assertMaterializedOccurrence(occurrenceTask, dateStr);
	const parentUpdates: Partial<TaskInfo> = {
		skipped_instances: getStringArray(parentTask.skipped_instances).filter((date) => date !== dateStr),
		dateModified: currentTimestamp,
	};
	const occurrenceUpdates: Partial<TaskInfo> = {
		status: activeStatus,
		completedDate: undefined,
		dateModified: currentTimestamp,
	};
	return buildMaterializedOccurrenceStatusPlan({
		kind: "occurrence.unskip",
		targetDate: dateStr,
		occurrenceTask,
		parentTask,
		updatedOccurrenceTask: { ...occurrenceTask, ...occurrenceUpdates },
		updatedParentTask: { ...parentTask, ...parentUpdates },
		occurrenceUpdates,
		parentUpdates,
		currentTimestamp,
		metadata: { trigger: "unskip" },
	});
}

export function taskInfoUpdatesToFrontmatterPatch(
	updates: Partial<TaskInfo>,
	fieldMapping: FieldMapping
): TaskPatchOperation[] {
	const patch: TaskPatchOperation[] = [];
	for (const [property, value] of Object.entries(updates) as Array<[keyof TaskInfo, unknown]>) {
		const field = fieldNameForTaskProperty(fieldMapping, property);
		if (!field) continue;
		if (value === undefined || (Array.isArray(value) && value.length === 0)) {
			patch.push({ op: "delete", field });
		} else if (property === "status") {
			patch.push({ op: "set", field, value: coerceStatusFrontmatterValue(String(value)) });
		} else {
			patch.push({ op: "set", field, value });
		}
	}
	return patch;
}

export function applyFrontmatterPatch(
	frontmatter: Record<string, unknown>,
	patch: readonly TaskPatchOperation[]
): Record<string, unknown> {
	const result = { ...frontmatter };
	for (const operation of patch) {
		if (operation.op === "set") {
			result[operation.field] = operation.value;
		} else {
			delete result[operation.field];
		}
	}
	return result;
}

export function specFrontmatterToTaskInfo(
	frontmatter: Record<string, unknown>,
	path = "task.md"
): TaskInfo {
	return {
		title: readString(frontmatter.title) || path.replace(/\.md$/i, ""),
		status: readString(frontmatter.status) || "open",
		priority: readString(frontmatter.priority) || "normal",
		path,
		archived: frontmatter.archived === true,
		due: readString(frontmatter.due),
		scheduled: readString(frontmatter.scheduled),
		completedDate: readString(frontmatter.completedDate),
		dateCreated: readString(frontmatter.dateCreated),
		dateModified: readString(frontmatter.dateModified),
		recurrence: readString(frontmatter.recurrence),
		recurrence_anchor:
			frontmatter.recurrenceAnchor === "completion" ? "completion" : "scheduled",
		complete_instances: getStringArray(frontmatter.completeInstances),
		skipped_instances: getStringArray(frontmatter.skippedInstances),
		recurrence_parent: readString(frontmatter.recurrenceParent),
		occurrence_date: readString(frontmatter.occurrenceDate),
		occurrence_materialization: readOccurrenceMaterializationMode(frontmatter.occurrenceMaterialization),
		occurrence_next_trigger: readOccurrenceNextTrigger(frontmatter.occurrenceNextTrigger),
		occurrence_template: readString(frontmatter.occurrenceTemplate),
		occurrence_past_horizon: readString(frontmatter.occurrencePastHorizon),
		occurrence_future_horizon: readString(frontmatter.occurrenceFutureHorizon),
		timeEntries: sanitizeTimeEntries(frontmatter.timeEntries as TimeEntry[] | undefined),
		tags: getStringArray(frontmatter.tags),
		contexts: getStringArray(frontmatter.contexts),
		projects: getStringArray(frontmatter.projects),
		timeEstimate:
			typeof frontmatter.timeEstimate === "number" ? frontmatter.timeEstimate : undefined,
		blockedBy: normalizeBlockedByValue(frontmatter.blockedBy),
		reminders: Array.isArray(frontmatter.reminders)
			? (frontmatter.reminders as TaskInfo["reminders"])
			: undefined,
	};
}

export function taskInfoToSpecFields(task: Partial<TaskInfo>): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	writeIfDefined(fields, "title", task.title);
	writeIfDefined(fields, "status", task.status);
	writeIfDefined(fields, "priority", task.priority);
	writeIfDefined(fields, "due", task.due);
	writeIfDefined(fields, "scheduled", task.scheduled);
	writeIfDefined(fields, "completedDate", task.completedDate);
	writeIfDefined(fields, "dateCreated", task.dateCreated);
	writeIfDefined(fields, "dateModified", task.dateModified);
	writeIfDefined(fields, "recurrence", task.recurrence);
	writeIfDefined(fields, "recurrenceAnchor", task.recurrence_anchor);
	writeIfDefined(fields, "completeInstances", task.complete_instances);
	writeIfDefined(fields, "skippedInstances", task.skipped_instances);
	writeIfDefined(fields, "recurrenceParent", task.recurrence_parent);
	writeIfDefined(fields, "occurrenceDate", task.occurrence_date);
	writeIfDefined(fields, "occurrenceMaterialization", task.occurrence_materialization);
	writeIfDefined(fields, "occurrenceNextTrigger", task.occurrence_next_trigger);
	writeIfDefined(fields, "occurrenceTemplate", task.occurrence_template);
	writeIfDefined(fields, "occurrencePastHorizon", task.occurrence_past_horizon);
	writeIfDefined(fields, "occurrenceFutureHorizon", task.occurrence_future_horizon);
	writeIfDefined(fields, "timeEntries", task.timeEntries);
	writeIfDefined(fields, "tags", task.tags);
	writeIfDefined(fields, "contexts", task.contexts);
	writeIfDefined(fields, "projects", task.projects);
	writeIfDefined(fields, "timeEstimate", task.timeEstimate);
	writeIfDefined(fields, "blockedBy", task.blockedBy);
	writeIfDefined(fields, "reminders", task.reminders);
	return fields;
}

export function buildSpecCompleteTaskUpdate({
	frontmatter,
	targetDate,
	completedStatus,
	currentTimestamp,
	path,
}: BuildSpecCompleteTaskUpdateInput): SpecTaskUpdatePlan {
	const task = specFrontmatterToTaskInfo(frontmatter, path);
	if (!task.recurrence) {
		const fields: Record<string, unknown> = {
			status: completedStatus,
			completedDate: targetDate,
		};
		if (currentTimestamp) fields.dateModified = currentTimestamp;
		return {
			fields,
			updatedTask: applySpecFieldsToTaskInfo(task, fields),
			dateModified: currentTimestamp,
			changed: true,
			metadata: { recurring: false, targetDate },
		};
	}

	const completeInstances = getStringArray(frontmatter.completeInstances);
	if (completeInstances.includes(targetDate)) {
		return {
			fields: {},
			updatedTask: task,
			dateModified: currentTimestamp,
			changed: false,
			metadata: { recurring: true, targetDate, alreadyCompleted: true },
		};
	}

	const recurring = completeRecurringTask({
		recurrence: task.recurrence,
		recurrenceAnchor: task.recurrence_anchor,
		scheduled: task.scheduled,
		due: task.due,
		dateCreated: task.dateCreated,
		completionDate: targetDate,
		completeInstances: task.complete_instances,
		skippedInstances: task.skipped_instances,
	});
	const fields: Record<string, unknown> = {
		recurrence: recurring.updatedRecurrence,
		completeInstances: recurring.completeInstances,
		skippedInstances: recurring.skippedInstances,
	};

	if (recurring.nextScheduled) {
		fields.scheduled = recurring.nextScheduled;
		if (recurring.nextDue) fields.due = recurring.nextDue;
	} else {
		fields.status = completedStatus;
		fields.completedDate = targetDate;
	}
	if (currentTimestamp) fields.dateModified = currentTimestamp;

	return {
		fields,
		updatedTask: applySpecFieldsToTaskInfo(task, fields),
		dateModified: currentTimestamp,
		changed: true,
		metadata: {
			recurring: true,
			targetDate,
			nextScheduled: recurring.nextScheduled,
			nextDue: recurring.nextDue,
		},
	};
}

export function buildSpecRecurringSkipUpdate({
	frontmatter,
	targetDate,
	skip,
	currentTimestamp,
	path,
}: BuildSpecRecurringSkipUpdateInput): SpecTaskUpdatePlan {
	const task = specFrontmatterToTaskInfo(frontmatter, path);
	if (!task.recurrence) {
		throw new Error("Skip/unskip is only supported for recurring tasks.");
	}

	const skippedInstances = getStringArray(frontmatter.skippedInstances);
	const completeInstances = getStringArray(frontmatter.completeInstances);
	const alreadyInState = skip
		? skippedInstances.includes(targetDate)
		: !skippedInstances.includes(targetDate);
	if (alreadyInState) {
		return {
			fields: {},
			updatedTask: task,
			dateModified: currentTimestamp,
			changed: false,
			metadata: { targetDate, skip, alreadyInState: true },
		};
	}

	const nextSkippedInstances = skip
		? appendUnique(skippedInstances, targetDate)
		: skippedInstances.filter((date) => date !== targetDate);
	const nextCompleteInstances = completeInstances.filter((date) => date !== targetDate);
	const schedule = recalculateRecurringSchedule({
		recurrence: task.recurrence,
		recurrenceAnchor: task.recurrence_anchor,
		scheduled: task.scheduled,
		due: task.due,
		dateCreated: task.dateCreated,
		completeInstances: nextCompleteInstances,
		skippedInstances: nextSkippedInstances,
		referenceDate: targetDate,
	});
	const fields: Record<string, unknown> = {
		recurrence: schedule.updatedRecurrence,
		completeInstances: nextCompleteInstances,
		skippedInstances: nextSkippedInstances,
	};
	if (schedule.nextScheduled) fields.scheduled = schedule.nextScheduled;
	if (schedule.nextDue) fields.due = schedule.nextDue;
	if (currentTimestamp) fields.dateModified = currentTimestamp;

	return {
		fields,
		updatedTask: applySpecFieldsToTaskInfo(task, fields),
		dateModified: currentTimestamp,
		changed: true,
		metadata: {
			targetDate,
			skip,
			nextScheduled: schedule.nextScheduled,
			nextDue: schedule.nextDue,
		},
	};
}

export function buildSpecStartTimeTrackingUpdate({
	frontmatter,
	currentTimestamp,
	startTimestamp = currentTimestamp,
	description,
	path,
}: BuildSpecStartTimeTrackingUpdateInput): SpecTaskUpdatePlan {
	const task = specFrontmatterToTaskInfo(frontmatter, path);
	if (getActiveTimeEntry(task)) {
		throw new Error("time_tracking_already_active");
	}
	const plan = buildStartTimeTrackingPlan(
		task,
		currentTimestamp,
		startTimestamp,
		description ?? ""
	);
	if (description === undefined && plan.newEntry.description === "") {
		delete plan.newEntry.description;
		const entries = plan.updatedTask.timeEntries ?? [];
		const lastEntry = entries[entries.length - 1];
		if (lastEntry) delete lastEntry.description;
	}
	return {
		fields: taskInfoToSpecFields({
			timeEntries: plan.updatedTask.timeEntries,
			dateModified: plan.dateModified,
		}),
		updatedTask: plan.updatedTask,
		dateModified: plan.dateModified,
		changed: true,
		metadata: { newEntry: plan.newEntry },
	};
}

export function buildSpecStopTimeTrackingUpdate({
	frontmatter,
	currentTimestamp,
	stopTimestamp = currentTimestamp,
	path,
}: BuildSpecStopTimeTrackingUpdateInput): SpecTaskUpdatePlan {
	const task = specFrontmatterToTaskInfo(frontmatter, path);
	const activeEntry = getActiveTimeEntry(task);
	if (!activeEntry) {
		throw new Error("no_active_time_entry");
	}
	const plan = buildStopTimeTrackingPlan(task, activeEntry, currentTimestamp, stopTimestamp);
	const stoppedEntry = plan.updatedTask.timeEntries?.find(
		(entry) => entry.startTime === activeEntry.startTime
	);
	return {
		fields: taskInfoToSpecFields({
			timeEntries: plan.updatedTask.timeEntries,
			dateModified: plan.dateModified,
		}),
		updatedTask: plan.updatedTask,
		dateModified: plan.dateModified,
		changed: true,
		metadata: { activeEntry, stoppedEntry },
	};
}

function buildSetPatch(frontmatter: Record<string, unknown>): TaskPatchOperation[] {
	return Object.entries(frontmatter)
		.filter(([, value]) => value !== undefined)
		.map(([field, value]) => ({ op: "set", field, value }) satisfies TaskPatchOperation);
}

function applySpecFieldsToTaskInfo(task: TaskInfo, fields: Record<string, unknown>): TaskInfo {
	const updatedTask = { ...task };
	if (Object.prototype.hasOwnProperty.call(fields, "title")) updatedTask.title = readString(fields.title) || updatedTask.title;
	if (Object.prototype.hasOwnProperty.call(fields, "status")) updatedTask.status = readString(fields.status) || updatedTask.status;
	if (Object.prototype.hasOwnProperty.call(fields, "priority")) updatedTask.priority = readString(fields.priority) || updatedTask.priority;
	if (Object.prototype.hasOwnProperty.call(fields, "due")) updatedTask.due = readString(fields.due);
	if (Object.prototype.hasOwnProperty.call(fields, "scheduled")) updatedTask.scheduled = readString(fields.scheduled);
	if (Object.prototype.hasOwnProperty.call(fields, "completedDate")) updatedTask.completedDate = readString(fields.completedDate);
	if (Object.prototype.hasOwnProperty.call(fields, "dateCreated")) updatedTask.dateCreated = readString(fields.dateCreated);
	if (Object.prototype.hasOwnProperty.call(fields, "dateModified")) updatedTask.dateModified = readString(fields.dateModified);
	if (Object.prototype.hasOwnProperty.call(fields, "recurrence")) updatedTask.recurrence = readString(fields.recurrence);
	if (Object.prototype.hasOwnProperty.call(fields, "recurrenceAnchor")) {
		updatedTask.recurrence_anchor = fields.recurrenceAnchor === "completion" ? "completion" : "scheduled";
	}
	if (Object.prototype.hasOwnProperty.call(fields, "completeInstances")) {
		updatedTask.complete_instances = getStringArray(fields.completeInstances);
	}
	if (Object.prototype.hasOwnProperty.call(fields, "skippedInstances")) {
		updatedTask.skipped_instances = getStringArray(fields.skippedInstances);
	}
	if (Object.prototype.hasOwnProperty.call(fields, "recurrenceParent")) {
		updatedTask.recurrence_parent = readString(fields.recurrenceParent);
	}
	if (Object.prototype.hasOwnProperty.call(fields, "occurrenceDate")) {
		updatedTask.occurrence_date = readString(fields.occurrenceDate);
	}
	if (Object.prototype.hasOwnProperty.call(fields, "occurrenceMaterialization")) {
		updatedTask.occurrence_materialization = readOccurrenceMaterializationMode(fields.occurrenceMaterialization);
	}
	if (Object.prototype.hasOwnProperty.call(fields, "occurrenceNextTrigger")) {
		updatedTask.occurrence_next_trigger = readOccurrenceNextTrigger(fields.occurrenceNextTrigger);
	}
	if (Object.prototype.hasOwnProperty.call(fields, "occurrenceTemplate")) {
		updatedTask.occurrence_template = readString(fields.occurrenceTemplate);
	}
	if (Object.prototype.hasOwnProperty.call(fields, "occurrencePastHorizon")) {
		updatedTask.occurrence_past_horizon = readString(fields.occurrencePastHorizon);
	}
	if (Object.prototype.hasOwnProperty.call(fields, "occurrenceFutureHorizon")) {
		updatedTask.occurrence_future_horizon = readString(fields.occurrenceFutureHorizon);
	}
	if (Object.prototype.hasOwnProperty.call(fields, "timeEntries")) {
		updatedTask.timeEntries = sanitizeTimeEntries(fields.timeEntries as TimeEntry[] | undefined);
	}
	return updatedTask;
}

function addUnsetMappedFieldDeletes(
	patch: TaskPatchOperation[],
	updates: TaskUpdateInput,
	fieldMapping: FieldMapping
): void {
	const deletable: Array<[keyof TaskUpdateInput, FieldMappingKey]> = [
		["due", "due"],
		["scheduled", "scheduled"],
		["contexts", "contexts"],
		["timeEstimate", "timeEstimate"],
		["completedDate", "completedDate"],
		["recurrence", "recurrence"],
		["recurrence_parent", "recurrenceParent"],
		["occurrence_date", "occurrenceDate"],
		["occurrence_materialization", "occurrenceMaterialization"],
		["occurrence_next_trigger", "occurrenceNextTrigger"],
		["occurrence_template", "occurrenceTemplate"],
		["occurrence_past_horizon", "occurrencePastHorizon"],
		["occurrence_future_horizon", "occurrenceFutureHorizon"],
		["blockedBy", "blockedBy"],
		["googleCalendarExceptionOriginalScheduled", "googleCalendarExceptionOriginalScheduled"],
	];
	for (const [updateKey, mappingKey] of deletable) {
		if (Object.prototype.hasOwnProperty.call(updates, updateKey) && updates[updateKey] === undefined) {
			patch.push({ op: "delete", field: fieldMapping[mappingKey] });
		}
	}
	if (Object.prototype.hasOwnProperty.call(updates, "projects")) {
		if (!Array.isArray(updates.projects) || updates.projects.length === 0) {
			patch.push({ op: "delete", field: fieldMapping.projects });
		}
	}
	if (
		Object.prototype.hasOwnProperty.call(updates, "googleCalendarMovedOriginalDates") &&
		(!Array.isArray(updates.googleCalendarMovedOriginalDates) ||
			updates.googleCalendarMovedOriginalDates.length === 0)
	) {
		patch.push({ op: "delete", field: fieldMapping.googleCalendarMovedOriginalDates });
	}
}

function fieldNameForTaskProperty(fieldMapping: FieldMapping, property: keyof TaskInfo): string | undefined {
	const explicit: Partial<Record<keyof TaskInfo, FieldMappingKey>> = {
		title: "title",
		status: "status",
		priority: "priority",
		due: "due",
		scheduled: "scheduled",
		contexts: "contexts",
		projects: "projects",
		timeEstimate: "timeEstimate",
		completedDate: "completedDate",
		dateCreated: "dateCreated",
		dateModified: "dateModified",
		recurrence: "recurrence",
		recurrence_anchor: "recurrenceAnchor",
		complete_instances: "completeInstances",
		skipped_instances: "skippedInstances",
		recurrence_parent: "recurrenceParent",
		occurrence_date: "occurrenceDate",
		occurrence_materialization: "occurrenceMaterialization",
		occurrence_next_trigger: "occurrenceNextTrigger",
		occurrence_template: "occurrenceTemplate",
		occurrence_past_horizon: "occurrencePastHorizon",
		occurrence_future_horizon: "occurrenceFutureHorizon",
		timeEntries: "timeEntries",
		blockedBy: "blockedBy",
		reminders: "reminders",
		sortOrder: "sortOrder",
	};
	const mappingKey = explicit[property];
	return mappingKey ? fieldMapping[mappingKey] : undefined;
}

function isOccurrenceMaterializationMode(value: unknown): value is OccurrenceMaterializationMode {
	return value === "manual" || value === "on_completion" || value === "rolling";
}

function isOccurrenceNextTrigger(value: unknown): value is OccurrenceNextTrigger {
	return value === "completion" || value === "completion_or_skip";
}

function readOccurrenceMaterializationMode(value: unknown): OccurrenceMaterializationMode | undefined {
	return isOccurrenceMaterializationMode(value) ? value : undefined;
}

function readOccurrenceNextTrigger(value: unknown): OccurrenceNextTrigger | undefined {
	return isOccurrenceNextTrigger(value) ? value : undefined;
}

function normalizeOccurrenceTargetDate(value: string | Date): string {
	return validateDateString(value instanceof Date ? formatDateForStorage(value) : getDatePart(value));
}

function resolveOccurrenceDateOrThrow(task: TaskInfo, targetDate?: string | Date): string {
	return normalizeOccurrenceTargetDate(targetDate ?? task.occurrence_date ?? "");
}

function assertMaterializedOccurrence(task: TaskInfo, targetDate: string): void {
	if (!task.recurrence_parent || !task.occurrence_date) {
		throw new Error("task_not_materialized_occurrence");
	}
	if (task.occurrence_date !== targetDate) {
		throw new Error("occurrence_date_mismatch");
	}
}

function buildInheritedOccurrenceTask(parentTask: TaskInfo, targetDate: string): Partial<TaskInfo> {
	const scheduled = parentTask.scheduled
		? rebaseDateLikeToOccurrence(parentTask.scheduled, parentTask.scheduled, targetDate)
		: targetDate;
	const due = parentTask.due
		? rebaseDateLikeToOccurrence(parentTask.due, parentTask.scheduled || parentTask.due, targetDate)
		: undefined;

	return removeUndefined({
		title: parentTask.title,
		priority: parentTask.priority,
		due,
		scheduled,
		contexts: cloneArray(parentTask.contexts),
		projects: cloneArray(parentTask.projects),
		tags: cloneArray(parentTask.tags),
		timeEstimate: parentTask.timeEstimate,
		reminders: cloneObjectArray(parentTask.reminders),
		blockedBy: cloneObjectArray(parentTask.blockedBy),
		details: parentTask.details,
		customProperties: cloneCustomProperties(parentTask.customProperties),
	});
}

function rebaseDateLikeToOccurrence(
	value: string,
	parentAnchor: string,
	targetDate: string
): string | undefined {
	try {
		const valueDate = getDatePart(value);
		const anchorDate = getDatePart(parentAnchor);
		if (!valueDate || !anchorDate) return undefined;

		const offsetDays = daysBetween(anchorDate, valueDate);
		const rebasedDate = addDaysToDateString(targetDate, offsetDays);
		return replaceDatePart(value, rebasedDate);
	} catch {
		return undefined;
	}
}

function replaceDatePart(value: string, datePart: string): string {
	const trimmed = value.trim();
	const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})(.*)$/);
	if (!match) return datePart;
	return `${datePart}${match[2] ?? ""}`;
}

function daysBetween(startDate: string, endDate: string): number {
	const msPerDay = 24 * 60 * 60 * 1000;
	const start = parseDateToUTC(startDate).getTime();
	const end = parseDateToUTC(endDate).getTime();
	return Math.round((end - start) / msPerDay);
}

function addDaysToDateString(date: string, offsetDays: number): string {
	const next = parseDateToUTC(date);
	next.setUTCDate(next.getUTCDate() + offsetDays);
	return formatDateForStorage(next);
}

function cloneArray<T>(value: readonly T[] | undefined): T[] | undefined {
	return Array.isArray(value) ? [...value] : undefined;
}

function cloneObjectArray<T extends object>(value: readonly T[] | undefined): T[] | undefined {
	return Array.isArray(value) ? value.map((entry) => ({ ...entry }) as T) : undefined;
}

function cloneCustomProperties(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	if (!value || Object.keys(value).length === 0) return undefined;
	return cloneRecord(value);
}

function mergeCustomProperties(
	...values: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
	const merged: Record<string, unknown> = {};
	for (const value of values) {
		if (!value) continue;
		Object.assign(merged, cloneRecord(value));
	}
	return Object.keys(merged).length > 0 ? merged : undefined;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (Array.isArray(entry)) {
			result[key] = [...entry];
		} else if (isPlainRecord(entry)) {
			result[key] = { ...entry };
		} else {
			result[key] = entry;
		}
	}
	return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDueByRecurrenceRule(parentTask: TaskInfo, targetDate: string): boolean {
	try {
		return isDueByRRule(parentTask, parseDateToUTC(targetDate));
	} catch {
		return false;
	}
}

function buildRecurringParentProgressionUpdates({
	parentTask,
	targetDate,
	completeInstances,
	skippedInstances,
	currentTimestamp,
	maintainDueDateOffsetInRecurring,
	advanceCompletionAnchor,
}: {
	parentTask: TaskInfo;
	targetDate: string;
	completeInstances: string[];
	skippedInstances: string[];
	currentTimestamp: string;
	maintainDueDateOffsetInRecurring: boolean;
	advanceCompletionAnchor: boolean;
}): Partial<TaskInfo> {
	let recurrence = parentTask.recurrence;
	if (typeof recurrence === "string" && recurrence.length > 0) {
		if (advanceCompletionAnchor && (parentTask.recurrence_anchor || "scheduled") === "completion") {
			recurrence = updateDTSTARTInRecurrenceRule(recurrence, targetDate) || recurrence;
		} else if (!recurrence.includes("DTSTART:")) {
			recurrence = addDTSTARTToRecurrenceRule(parentTask) || recurrence;
		}
	}

	const workingTask: TaskInfo = {
		...parentTask,
		recurrence,
		complete_instances: completeInstances,
		skipped_instances: skippedInstances,
	};
	const nextDates = updateToNextScheduledOccurrence(
		workingTask,
		maintainDueDateOffsetInRecurring,
		{ today: targetDate }
	);
	const updates: Partial<TaskInfo> = {
		recurrence,
		complete_instances: completeInstances,
		skipped_instances: skippedInstances,
		dateModified: currentTimestamp,
	};
	if (nextDates.scheduled) updates.scheduled = nextDates.scheduled;
	if (nextDates.due) updates.due = nextDates.due;
	return updates;
}

function buildMaterializedOccurrenceStatusPlan({
	kind,
	targetDate,
	occurrenceTask,
	parentTask,
	updatedOccurrenceTask,
	updatedParentTask,
	occurrenceUpdates,
	parentUpdates,
	currentTimestamp,
	materializeNextDate,
	metadata,
}: {
	kind: MaterializedOccurrenceStatusPlan["kind"];
	targetDate: string;
	occurrenceTask: TaskInfo;
	parentTask: TaskInfo;
	updatedOccurrenceTask: TaskInfo;
	updatedParentTask: TaskInfo;
	occurrenceUpdates: Partial<TaskInfo>;
	parentUpdates: Partial<TaskInfo>;
	currentTimestamp: string;
	materializeNextDate?: string;
	metadata: Record<string, unknown>;
}): MaterializedOccurrenceStatusPlan {
	return {
		kind,
		targetDate,
		updatedOccurrenceTask,
		updatedParentTask,
		occurrenceUpdates,
		parentUpdates,
		occurrenceFields: taskInfoToSpecFields(occurrenceUpdates),
		parentFields: taskInfoToSpecFields(parentUpdates),
		dateModified: currentTimestamp,
		changed: hasTaskUpdateChanges(occurrenceTask, occurrenceUpdates) || hasTaskUpdateChanges(parentTask, parentUpdates),
		materializeNextDate: materializeNextDate || undefined,
		metadata,
	};
}

function hasTaskUpdateChanges(task: Partial<TaskInfo>, updates: Partial<TaskInfo>): boolean {
	return Object.entries(updates).some(([key, value]) => task[key as keyof TaskInfo] !== value);
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
	const result: Partial<T> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (entry !== undefined) {
			result[key as keyof T] = entry as T[keyof T];
		}
	}
	return result;
}

function stripTimeEntryDuration(entry: TimeEntry): TimeEntry {
	const sanitizedEntry = { ...entry };
	delete sanitizedEntry.duration;
	return sanitizedEntry;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function writeIfDefined(target: Record<string, unknown>, key: string, value: unknown): void {
	if (value !== undefined) {
		target[key] = value;
	}
}

function appendUnique(values: string[], value: string): string[] {
	return values.includes(value) ? values : [...values, value];
}

function getStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
