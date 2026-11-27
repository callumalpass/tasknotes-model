import { timestampForComparison } from "./calendar-date";
import type { TaskInfo, TimeEntry } from "./types";

export interface StartTimeTrackingPlan {
	updatedTask: TaskInfo;
	newEntry: TimeEntry;
	dateModified: string;
}

export interface StopTimeTrackingPlan {
	updatedTask: TaskInfo;
	stopTimestamp: string;
	dateModified: string;
}

export interface DeleteTimeEntryPlan {
	updatedTask: TaskInfo;
	timeEntryIndex: number;
	dateModified: string;
}

export function removeTimeEntryDuration(entry: TimeEntry): TimeEntry {
	const sanitizedEntry = { ...entry };
	delete sanitizedEntry.duration;
	return sanitizedEntry;
}

export function sanitizeTimeEntries(entries: readonly TimeEntry[] | undefined): TimeEntry[] {
	return Array.isArray(entries) ? entries.map(removeTimeEntryDuration) : [];
}

export function getActiveTimeEntry(task: Pick<TaskInfo, "timeEntries">): TimeEntry | undefined {
	return sanitizeTimeEntries(task.timeEntries).find((entry) => !entry.endTime);
}

export function calculateTimeEntryMinutes(entry: TimeEntry, timezone?: string): number {
	if (!entry.endTime) return 0;
	return calculateElapsedTimeEntryMinutes(entry, entry.endTime, timezone);
}

export function calculateElapsedTimeEntryMinutes(
	entry: TimeEntry,
	now = new Date().toISOString(),
	timezone?: string
): number {
	const start = timestampForComparison(entry.startTime, timezone);
	const end = timestampForComparison(entry.endTime || now, timezone);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
		return 0;
	}
	return Math.round((end - start) / 60000);
}

export function calculateTotalTrackedMinutes(entries: readonly TimeEntry[] | undefined, timezone?: string): number {
	return sanitizeTimeEntries(entries).reduce((total, entry) => total + calculateTimeEntryMinutes(entry, timezone), 0);
}

export function buildStartTimeTrackingPlan(
	task: TaskInfo,
	currentTimestamp: string,
	startTimestamp = currentTimestamp,
	description = "Work session"
): StartTimeTrackingPlan {
	const newEntry: TimeEntry = {
		startTime: startTimestamp,
		description,
	};
	const updatedTask: TaskInfo = {
		...task,
		dateModified: currentTimestamp,
		timeEntries: [...sanitizeTimeEntries(task.timeEntries), newEntry],
	};
	return { updatedTask, newEntry, dateModified: currentTimestamp };
}

export function buildStopTimeTrackingPlan(
	task: TaskInfo,
	activeSession: TimeEntry,
	currentTimestamp: string,
	stopTimestamp = currentTimestamp
): StopTimeTrackingPlan {
	const updatedTask: TaskInfo = {
		...task,
		dateModified: currentTimestamp,
	};
	const timeEntries = sanitizeTimeEntries(task.timeEntries);
	const entryIndex = timeEntries.findIndex(
		(entry) => entry.startTime === activeSession.startTime && !entry.endTime
	);
	if (entryIndex !== -1) {
		timeEntries[entryIndex] = {
			...timeEntries[entryIndex],
			endTime: stopTimestamp,
		};
		updatedTask.timeEntries = timeEntries;
	}
	return { updatedTask, stopTimestamp, dateModified: currentTimestamp };
}

export function buildDeleteTimeEntryPlan(
	task: TaskInfo,
	timeEntryIndex: number,
	currentTimestamp: string
): DeleteTimeEntryPlan {
	if (!Array.isArray(task.timeEntries)) {
		throw new Error("Task has no time entries");
	}
	if (timeEntryIndex < 0 || timeEntryIndex >= task.timeEntries.length) {
		throw new Error("Invalid time entry index");
	}
	return {
		updatedTask: {
			...task,
			dateModified: currentTimestamp,
			timeEntries: sanitizeTimeEntries(task.timeEntries).filter((_, index) => index !== timeEntryIndex),
		},
		timeEntryIndex,
		dateModified: currentTimestamp,
	};
}

export function replaceTimeEntries(
	task: TaskInfo,
	entries: readonly TimeEntry[],
	currentTimestamp: string
): TaskInfo {
	return {
		...task,
		dateModified: currentTimestamp,
		timeEntries: sanitizeTimeEntries(entries),
	};
}
