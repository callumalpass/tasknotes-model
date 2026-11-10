import type { UserMappedFieldType } from "./types";

/** One status in a vocabulary change. */
export interface TaskNotesStatusEdit {
	value: string;
	label: string;
	color: string;
	isCompleted: boolean;
	/** Omitted, a status keeps whether it counted as skipped. */
	isSkipped?: boolean;
	/** Omitted, a status keeps its icon. */
	icon?: string;
	/** Omitted, a status is ordered by its position in the list. */
	order?: number;
}

/** One priority in a vocabulary change. */
export interface TaskNotesPriorityEdit {
	value: string;
	label: string;
	color: string;
	/** Omitted, a priority keeps its icon. */
	icon?: string;
	/** Omitted, a priority is weighted by its position in the list. */
	weight?: number;
}

/** One custom field in a vocabulary change. */
export interface TaskNotesUserFieldEdit {
	key: string;
	displayName: string;
	type: UserMappedFieldType;
}

/**
 * A change to the words a collection's tasks may use. Statuses and priorities
 * are complete lists in display order. Custom fields are named changes, so a
 * property the host cannot edit is never rewritten.
 */
export interface TaskNotesVocabularyPatch {
	statuses?: TaskNotesStatusEdit[];
	priorities?: TaskNotesPriorityEdit[];
	userFields?: {
		add?: TaskNotesUserFieldEdit[];
		rename?: Array<Pick<TaskNotesUserFieldEdit, "key" | "displayName">>;
		remove?: string[];
	};
}

export type TaskNotesVocabularyList = "status" | "priority";

export type TaskNotesVocabularyProblem =
	| { kind: "empty-label"; list: TaskNotesVocabularyList }
	| { kind: "duplicate-value"; list: TaskNotesVocabularyList; value: string }
	| { kind: "no-open-status" }
	| { kind: "no-completed-status" }
	| { kind: "completed-and-skipped"; value: string }
	| { kind: "no-priority" }
	| { kind: "default-removed"; list: TaskNotesVocabularyList; value: string }
	| { kind: "field-name"; key: string }
	| { kind: "field-taken"; key: string }
	| { kind: "field-label"; key: string };

/** A vocabulary change the collection cannot accept as it stands. */
export class TaskNotesVocabularyError extends Error {
	constructor(readonly problem: TaskNotesVocabularyProblem) {
		super(`The task settings are not valid: ${problem.kind}.`);
		this.name = "TaskNotesVocabularyError";
	}
}

/** Tasks still hold a status or priority the change would remove. */
export class TaskNotesVocabularyInUseError extends Error {
	constructor(
		readonly list: TaskNotesVocabularyList,
		readonly value: string,
		readonly count: number
	) {
		super(`${count} task${count === 1 ? "" : "s"} still use the ${list} "${value}".`);
		this.name = "TaskNotesVocabularyInUseError";
	}
}

/** Whether a caught value is a TaskNotesVocabularyError, from any copy of this package. */
export function isTaskNotesVocabularyError(value: unknown): value is TaskNotesVocabularyError {
	return (
		value instanceof Error &&
		value.name === "TaskNotesVocabularyError" &&
		typeof (value as { problem?: unknown }).problem === "object"
	);
}

/** Whether a caught value is a TaskNotesVocabularyInUseError, from any copy of this package. */
export function isTaskNotesVocabularyInUseError(
	value: unknown
): value is TaskNotesVocabularyInUseError {
	return (
		value instanceof Error &&
		value.name === "TaskNotesVocabularyInUseError" &&
		typeof (value as { count?: unknown }).count === "number"
	);
}

/** Property names a custom field may take. */
export const TASKNOTES_USER_FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** A stored value for a new status or priority, made from its label. */
export function taskNotesVocabularyValue(label: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	const base =
		unaccented(label)
			.replace(/[^\p{Letter}\p{Number}]+/gu, "-")
			.replace(/^-+|-+$/g, "") || "option";
	let value = base;
	for (let suffix = 2; used.has(value); suffix += 1) value = `${base}-${suffix}`;
	return value;
}

/** A property name for a new custom field, made from its label. */
export function taskNotesUserFieldKey(label: string, taken: Iterable<string>): string {
	const used = new Set([...taken].map((key) => key.toLocaleLowerCase()));
	const base =
		unaccented(label)
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "")
			.replace(/^([0-9])/, "_$1") || "field";
	let key = base;
	for (let suffix = 2; used.has(key); suffix += 1) key = `${base}_${suffix}`;
	return key;
}

/**
 * The first rule a status and priority list breaks, if any. `defaults` names
 * the default status and priority the collection will have once the change is
 * saved.
 */
export function taskNotesVocabularyProblem(
	patch: Pick<TaskNotesVocabularyPatch, "statuses" | "priorities">,
	defaults: { status: string; priority: string }
): TaskNotesVocabularyProblem | null {
	if (patch.statuses) {
		const problem = listProblem("status", patch.statuses);
		if (problem) return problem;
		if (!patch.statuses.some((status) => !status.isCompleted))
			return { kind: "no-open-status" };
		if (!patch.statuses.some((status) => status.isCompleted))
			return { kind: "no-completed-status" };
		const both = patch.statuses.find(
			(status) => status.isCompleted && status.isSkipped === true
		);
		if (both) return { kind: "completed-and-skipped", value: both.value };
		if (!patch.statuses.some(({ value }) => value === defaults.status))
			return { kind: "default-removed", list: "status", value: defaults.status };
	}
	if (patch.priorities) {
		const problem = listProblem("priority", patch.priorities);
		if (problem) return problem;
		if (!patch.priorities.length) return { kind: "no-priority" };
		if (!patch.priorities.some(({ value }) => value === defaults.priority))
			return { kind: "default-removed", list: "priority", value: defaults.priority };
	}
	return null;
}

/**
 * The first status or priority a change removes while tasks still hold it.
 * Removing it would leave those tasks outside the type's own schema, and an
 * authority that validates writes would then refuse later edits to them.
 */
export function taskNotesVocabularyInUse(
	tasks: Iterable<{ status?: string | null; priority?: string | null }>,
	current: { statuses: readonly string[]; priorities: readonly string[] },
	patch: Pick<TaskNotesVocabularyPatch, "statuses" | "priorities">
): TaskNotesVocabularyInUseError | null {
	const removed = (before: readonly string[], after?: ReadonlyArray<{ value: string }>) => {
		if (!after) return new Map<string, number>();
		const kept = new Set(after.map(({ value }) => value));
		return new Map(before.filter((value) => !kept.has(value)).map((value) => [value, 0]));
	};
	const statuses = removed(current.statuses, patch.statuses);
	const priorities = removed(current.priorities, patch.priorities);
	if (!statuses.size && !priorities.size) return null;
	for (const task of tasks) {
		if (typeof task.status === "string") {
			const count = statuses.get(task.status);
			if (count !== undefined) statuses.set(task.status, count + 1);
		}
		if (typeof task.priority === "string") {
			const count = priorities.get(task.priority);
			if (count !== undefined) priorities.set(task.priority, count + 1);
		}
	}
	for (const [value, count] of statuses)
		if (count) return new TaskNotesVocabularyInUseError("status", value, count);
	for (const [value, count] of priorities)
		if (count) return new TaskNotesVocabularyInUseError("priority", value, count);
	return null;
}

function listProblem(
	list: TaskNotesVocabularyList,
	entries: ReadonlyArray<{ value: string; label: string }>
): TaskNotesVocabularyProblem | null {
	const seen = new Set<string>();
	for (const entry of entries) {
		if (!entry.label.trim() || !entry.value.trim()) return { kind: "empty-label", list };
		if (seen.has(entry.value)) return { kind: "duplicate-value", list, value: entry.value };
		seen.add(entry.value);
	}
	return null;
}

function unaccented(label: string): string {
	return label
		.trim()
		.toLocaleLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "");
}
