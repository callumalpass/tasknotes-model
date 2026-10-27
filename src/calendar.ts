import { addDTSTARTToRecurrenceRule, generateRecurringInstances } from "./recurrence.js";
import { normalizeRecurrenceOriginalDate } from "./mapping.js";
import {
	buildInheritedOccurrenceTask,
	normalizeTaskReference,
	taskInfoUpdatesToFrontmatterPatch,
} from "./operations.js";
import type { FieldMapping, TaskInfo, TaskOperationPlan, TaskUpdateInput } from "./types.js";
import {
	addCalendarDays,
	calendarDateToInstant,
	calendarDay,
	calendarDaysBetween,
	calendarInstantToDate,
} from "./calendar-date.js";
export { calendarDateToInstant, calendarInstantToDate } from "./calendar-date.js";

/** Hosts filter rows/archives and resolve storage identities before calling the model. */
export type CalendarTask = Pick<TaskInfo, "path" | "title"> & Partial<TaskInfo>;
export interface CalendarRange {
	start: string;
	end: string;
}
export interface CalendarSettings {
	showScheduled?: boolean;
	showDue?: boolean;
	showScheduledToDueSpan?: boolean;
	showRecurring?: boolean;
	showCompletedRecurringInstances?: boolean;
	showSkippedRecurringInstances?: boolean;
	showTimeEntries?: boolean;
	showOverdueOnToday?: boolean;
	/** Bases hides all-day entries in list views when the all-day slot is off. */
	showAllDaySlot?: boolean;
	/** Active host view name (e.g. listWeek), not necessarily the saved initial view. */
	calendarView?: string;
	hideCompletedFromOverdue?: boolean;
	completedStatuses?: readonly string[];
	/** Implicit renderer lengths; absence of timeEstimate never writes an estimate. */
	defaultTimedMinutes?: number;
	defaultAllDayDays?: number;
}
export interface CalendarContext {
	timezone: string;
	/** ISO instant (required even when overdue display is off). */
	now: string;
	settings?: CalendarSettings;
	/** Resolved parent task id -> dates, including children outside the filtered rows. */
	materializedOccurrences?: Readonly<Record<string, readonly string[]>>;
}
export type CalendarEntryType =
	"scheduled" | "due" | "scheduledToDueSpan" | "recurring" | "timeEntry";
export type CalendarRecurringKind = "next-scheduled" | "pattern" | "recorded";
export interface CalendarEntry {
	id: string;
	taskId: string;
	title: string;
	type: CalendarEntryType;
	start: string;
	/** Exclusive end; omitted when the renderer should use its default duration. */
	end?: string;
	allDay: boolean;
	durationMinutes: number;
	isCompleted: boolean;
	isSkipped: boolean;
	startEditable: boolean;
	durationEditable: boolean;
	editReason:
		| "date"
		| "span-shift"
		| "deadline-marker"
		| "time-entry"
		| "next-occurrence"
		| "series-time"
		| "recorded-time"
		| "recurring-span-readonly";
	recurringKind?: CalendarRecurringKind;
	instanceDate?: string;
	recurringTemplateTime?: string;
	timeEntryIndex?: number;
	isMaterializedOccurrence?: boolean;
	occurrenceParent?: string;
	isOverdueOnToday?: boolean;
}
export interface BuildCalendarEntriesInput extends CalendarContext {
	tasks: readonly CalendarTask[];
	range: CalendarRange;
}

export function calendarTaskId(task: CalendarTask): string {
	return task.id || task.path;
}

function settings(context: CalendarContext) {
	return {
		showScheduled: true,
		showDue: true,
		showScheduledToDueSpan: false,
		showRecurring: true,
		showCompletedRecurringInstances: true,
		showSkippedRecurringInstances: true,
		showTimeEntries: true,
		showOverdueOnToday: false,
		hideCompletedFromOverdue: true,
		completedStatuses: ["done"] as readonly string[],
		defaultTimedMinutes: 60,
		defaultAllDayDays: 1,
		...context.settings,
	};
}

function materializedIndex(
	tasks: readonly CalendarTask[],
	context: CalendarContext,
): Map<string, Set<string>> {
	const result = new Map<string, Set<string>>();
	const aliases = new Map<string, string>();
	for (const task of tasks) {
		aliases.set(normalizeTaskReference(task.path), calendarTaskId(task));
		aliases.set(normalizeTaskReference(calendarTaskId(task)), calendarTaskId(task));
	}
	const add = (parent: string, date: string) => {
		const key = aliases.get(normalizeTaskReference(parent)) || parent;
		const dates = result.get(key) || new Set<string>();
		dates.add(calendarDay(date));
		result.set(key, dates);
	};
	for (const [parent, dates] of Object.entries(context.materializedOccurrences || {})) {
		for (const date of dates) add(parent, date);
	}
	for (const task of tasks) {
		if (task.recurrence_parent && task.occurrence_date)
			add(task.recurrence_parent, task.occurrence_date);
	}
	return result;
}

function rangeBounds(range: CalendarRange, context: CalendarContext) {
	const start = calendarDateToInstant(range.start, context.timezone);
	const end = calendarDateToInstant(range.end, context.timezone);
	if (end <= start) throw new Error("invalid-calendar-range");
	return { start, end };
}

function buildTaskEntries(
	task: CalendarTask,
	range: CalendarRange,
	context: CalendarContext,
	materialized: ReadonlySet<string>,
): CalendarEntry[] {
	const s = settings(context);
	const zone = context.timezone;
	const bounds = rangeBounds(range, context);
	const startDay = calendarInstantToDate(bounds.start, zone, true);
	const endDate = calendarInstantToDate(bounds.end, zone, true);
	const endDay =
		bounds.end > calendarDateToInstant(endDate, zone) ? addCalendarDays(endDate, 1) : endDate;
	const taskId = calendarTaskId(task);
	const entries: CalendarEntry[] = [];
	const isCompleted = s.completedStatuses.includes(task.status || "");
	const today = calendarInstantToDate(calendarDateToInstant(context.now, zone), zone, true);
	const timed = (value: string) => value.includes("T");
	const instants = new Map<string, number>();
	const instant = (value: string) => {
		let ms = instants.get(value);
		if (ms === undefined) {
			ms = calendarDateToInstant(value, zone);
			instants.set(value, ms);
		}
		return ms;
	};
	const civil = (value: string) =>
		timed(value) ? calendarInstantToDate(instant(value), zone) : value;
	const dayOf = (value: string) => calendarDay(civil(value));
	const endAt = (ms: number) => {
		const civil = calendarInstantToDate(ms, zone);
		// A second fall-back clock cannot be represented by a floating value alone.
		return instant(civil) === ms ? civil : new Date(ms).toISOString();
	};
	const visible = (entry: CalendarEntry) => {
		const start = instant(entry.start);
		const end = entry.end ? instant(entry.end) : start;
		return start < bounds.end && (end > start ? end > bounds.start : start >= bounds.start);
	};
	const base = (
		type: CalendarEntryType,
		start: string,
		id: string,
		end?: string,
	): CalendarEntry => {
		const allDay = !timed(start);
		const entry: CalendarEntry = {
			id,
			taskId,
			title: task.title,
			type,
			start,
			...(end ? { end } : {}),
			allDay,
			durationMinutes: end
				? allDay
					? calendarDaysBetween(start, end) * 1440
					: Math.round((instant(end) - instant(start)) / 60000)
				: allDay
					? s.defaultAllDayDays * 1440
					: s.defaultTimedMinutes,
			isCompleted,
			isSkipped: false,
			startEditable: true,
			durationEditable: type === "scheduled" || type === "recurring" || type === "timeEntry",
			editReason:
				type === "timeEntry"
					? "time-entry"
					: type === "due"
						? "deadline-marker"
						: type === "scheduledToDueSpan"
							? "span-shift"
							: "date",
		};
		if (task.recurrence_parent && task.occurrence_date) {
			entry.isMaterializedOccurrence = true;
			entry.instanceDate = calendarDay(task.occurrence_date);
			entry.occurrenceParent = task.recurrence_parent;
		}
		return entry;
	};
	const durationEnd = (start: string): string | undefined =>
		task.timeEstimate
			? timed(start)
				? endAt(instant(start) + task.timeEstimate * 60000)
				: addCalendarDays(calendarDay(start), Math.ceil(task.timeEstimate / 1440))
			: undefined;
	const scheduled = (start: string) =>
		base("scheduled", start, `scheduled-${taskId}`, durationEnd(start));
	const due = () => {
		const start = task.due!;
		const end = timed(start)
			? endAt(
					Math.min(
						instant(start) + 30 * 60000,
						instant(addCalendarDays(calendarInstantToDate(instant(start), zone, true), 1)),
					),
				)
			: undefined;
		return base("due", start, `due-${taskId}`, end);
	};
	const spans = (scheduledInput: string, dueInput: string): CalendarEntry[] => {
		const scheduledValue = civil(scheduledInput);
		const dueValue = civil(dueInput);
		if (instant(dueValue) <= instant(scheduledValue)) return [];
		if (!timed(scheduledValue)) {
			return [
				base(
					"scheduledToDueSpan",
					calendarDay(scheduledValue),
					`span-${taskId}`,
					addCalendarDays(calendarDay(dueValue), 1),
				),
			].filter(visible);
		}
		const result: CalendarEntry[] = [];
		// Clip long spans before iterating, retaining overnight work that overlaps the range.
		const lookback = Math.max(1, Math.ceil((task.timeEstimate || 0) / 1440));
		const first =
			calendarDay(scheduledValue) > addCalendarDays(startDay, -lookback)
				? calendarDay(scheduledValue)
				: addCalendarDays(startDay, -lookback);
		const last = calendarDay(dueValue) < endDay ? calendarDay(dueValue) : endDay;
		for (let day = first; day <= last; day = addCalendarDays(day, 1)) {
			const start = `${day}T${scheduledValue.slice(11, 16)}`;
			const entry = base("scheduledToDueSpan", start, `span-${taskId}-${day}`, durationEnd(start));
			if (visible(entry)) result.push(entry);
		}
		return result;
	};
	const generated: CalendarEntry[] = [];
	let includeScheduled = s.showScheduled;
	let includeDue = s.showDue;
	let allowSpan = true;
	if (
		task.recurrence &&
		task.scheduled &&
		(s.showRecurring || s.showCompletedRecurringInstances || s.showSkippedRecurringInstances)
	) {
		const nextDate = dayOf(task.scheduled);
		const nextIdentity =
			(task.recurrence_anchor || "scheduled") === "scheduled"
				? normalizeRecurrenceOriginalDate(task.recurrence_original_date) || nextDate
				: nextDate;
		const dtstartTime = /DTSTART(?:;[^:\r\n]+)?:\d{8}T(\d{2})(\d{2})/.exec(task.recurrence);
		const templateTime = dtstartTime
			? `${dtstartTime[1]}:${dtstartTime[2]}`
			: civil(task.scheduled).slice(11, 16) || "09:00";
		const spanOffset =
			s.showScheduledToDueSpan && task.due && instant(task.due) > instant(task.scheduled)
				? calendarDaysBetween(civil(task.scheduled), civil(task.due))
				: null;
		const searchStart = addCalendarDays(
			startDay,
			-Math.max(spanOffset || 0, Math.ceil((task.timeEstimate || 0) / 1440)),
		);
		const moved = new Set(task.googleCalendarMovedOriginalDates || []);
		if (nextIdentity !== nextDate) moved.add(nextIdentity);
		if (task.googleCalendarExceptionOriginalScheduled)
			moved.add(calendarDay(task.googleCalendarExceptionOriginalScheduled));
		const dates: Array<[string, CalendarRecurringKind]> = [];
		if (s.showRecurring) {
			dates.push([nextIdentity, "next-scheduled"]);
			// Date-only bounds avoid every process-local date parser in recurrence.ts.
			// RRULE dates are civil anchors, like scheduled/complete_instances. rrule's
			// TZID conversion depends on the process zone and may shift the anchor day.
			// Normalize parser input only; preserve all stored RFC properties for edits.
			const civilTask = {
				...task,
				scheduled: civil(task.scheduled),
				recurrence: task.recurrence.replace(/;TZID=[^:;\r\n]+/g, ""),
			};
			for (const date of generateRecurringInstances(
				civilTask,
				new Date(`${searchStart}T00:00:00Z`),
				new Date(`${endDay}T00:00:00Z`),
			)) {
				const day = date.toISOString().slice(0, 10);
				if (day >= searchStart && day < endDay && day !== nextIdentity && !moved.has(day))
					dates.push([day, "pattern"]);
			}
		}
		for (const day of [
			...(s.showCompletedRecurringInstances ? task.complete_instances || [] : []),
			...(s.showSkippedRecurringInstances ? task.skipped_instances || [] : []),
		].sort()) {
			if (day >= searchStart && day < endDay) dates.push([day, "recorded"]);
		}
		const emitted = new Set<string>();
		for (const [day, kind] of dates) {
			const completed = !!task.complete_instances?.includes(day);
			const skipped = !!task.skipped_instances?.includes(day);
			if (
				emitted.has(day) ||
				materialized.has(day) ||
				(kind !== "recorded" &&
					((completed && !s.showCompletedRecurringInstances) ||
						(skipped && !s.showSkippedRecurringInstances)))
			)
				continue;
			const clock =
				kind === "next-scheduled" ? civil(task.scheduled).slice(11, 16) || "09:00" : templateTime;
			const start =
				kind === "next-scheduled"
					? task.scheduled
					: timed(task.scheduled)
						? `${day}T${clock}`
						: day;
			const placementDay = kind === "next-scheduled" ? nextDate : day;
			const recurringEntries =
				spanOffset !== null && task.due
					? spans(
							start,
							`${addCalendarDays(placementDay, spanOffset)}${timed(task.due) ? `T${civil(task.due).slice(11, 16)}` : ""}`,
						)
					: [scheduled(start)];
			for (const entry of recurringEntries) {
				const span = entry.type === "scheduledToDueSpan";
				entry.id = span
					? `span-${kind}-${taskId}-${day}-${calendarDay(entry.start)}`
					: `${kind === "next-scheduled" ? "next-scheduled" : kind === "pattern" ? "recurring" : "recurring-recorded"}-${taskId}-${day}`;
				if (!span && kind !== "next-scheduled") entry.type = "recurring";
				Object.assign(entry, {
					recurringKind: kind,
					instanceDate: day,
					recurringTemplateTime: clock,
					isCompleted: completed,
					isSkipped: skipped,
					startEditable: !span,
					durationEditable: !span,
					editReason: span
						? "recurring-span-readonly"
						: kind === "next-scheduled"
							? "next-occurrence"
							: kind === "pattern"
								? "series-time"
								: "recorded-time",
				});
				if (visible(entry)) {
					generated.push(entry);
					emitted.add(day);
				}
			}
		}
		entries.push(...generated);
		if (s.showRecurring) {
			includeScheduled = false;
			allowSpan = false;
			if (generated.some((e) => e.type === "scheduledToDueSpan")) includeDue = false;
		}
	}
	let showedSpan = false;
	if (allowSpan && s.showScheduledToDueSpan && task.scheduled && task.due) {
		const spanEntries = spans(task.scheduled, task.due);
		entries.push(...spanEntries);
		showedSpan = spanEntries.length > 0;
	}
	const addDate = (entry: CalendarEntry, suppressOverdue = false): boolean => {
		if (visible(entry)) {
			entries.push(entry);
			return false;
		}
		if (
			!s.showOverdueOnToday ||
			suppressOverdue ||
			dayOf(entry.start) >= today ||
			(s.hideCompletedFromOverdue && entry.isCompleted) ||
			instant(entry.start) >= instant(context.now)
		)
			return false;
		const start = `${today}${civil(entry.start).slice(10)}`;
		const endMs = entry.end
			? instant(start) + instant(entry.end) - instant(entry.start)
			: undefined;
		const end =
			endMs === undefined
				? undefined
				: entry.allDay
					? calendarInstantToDate(endMs, zone, true)
					: endAt(endMs);
		const overdue = {
			...entry,
			id: `${entry.id}-overdue-today`,
			start,
			...(end ? { end } : {}),
			isOverdueOnToday: true,
		};
		if (!visible(overdue)) return false;
		entries.push(overdue);
		return true;
	};
	if (!showedSpan) {
		const scheduledOverdue =
			includeScheduled && task.scheduled ? addDate(scheduled(task.scheduled)) : false;
		const sameDayDue =
			task.scheduled && task.due && !timed(task.due) && dayOf(task.scheduled) === dayOf(task.due);
		if (includeDue && task.due && !((includeScheduled || generated.length > 0) && sameDayDue)) {
			addDate(
				due(),
				!timed(task.due) &&
					(scheduledOverdue || generated.some((entry) => dayOf(entry.start) === today)),
			);
		}
	}
	if (s.showTimeEntries) {
		for (const [index, timeEntry] of (task.timeEntries || []).entries()) {
			// Plugin semantics: only finished sessions appear on the calendar.
			if (!timeEntry.endTime) continue;
			const entry = base(
				"timeEntry",
				timeEntry.startTime,
				`timeentry-${taskId}-${index}`,
				timeEntry.endTime,
			);
			entry.timeEntryIndex = index;
			if (visible(entry)) entries.push(entry);
		}
	}
	return s.showAllDaySlot === false && s.calendarView?.startsWith("list")
		? entries.filter((entry) => !entry.allDay)
		: entries;
}

/** Pure task-only calendar projection. Range end is exclusive. */
export function buildCalendarEntries(input: BuildCalendarEntriesInput): CalendarEntry[] {
	rangeBounds(input.range, input);
	calendarDateToInstant(input.now, input.timezone);
	const materialized = materializedIndex(input.tasks, input);
	return input.tasks.flatMap((task) =>
		buildTaskEntries(task, input.range, input, materialized.get(calendarTaskId(task)) || new Set()),
	);
}

export interface CalendarChange {
	kind: "drop" | "drop-on-day" | "resize";
	start: string;
	end?: string;
	allDay: boolean;
}
export interface CalendarEditPlan extends TaskOperationPlan<TaskInfo> {
	updates: TaskUpdateInput;
	/** Caller may confirm these destructive removals before persisting the plan. */
	clearedInstances: { complete: string[]; skipped: string[] };
	/** Apply exact updates/patch; generic task.update recurrence progression must not run. */
	preserveRecurrenceSchedule: true;
}
export interface PlanCalendarEditInput {
	task: TaskInfo;
	entry: CalendarEntry;
	change: CalendarChange;
	timezone: string;
	now: string;
	fieldMapping: FieldMapping;
}

/** Plans a calendar gesture against fresh task data; never mutates or materializes tasks. */
export function planCalendarEdit({
	task,
	entry,
	change,
	timezone,
	now,
	fieldMapping,
}: PlanCalendarEditInput): CalendarEditPlan {
	if (entry.taskId !== calendarTaskId(task)) throw new Error("calendar-task-mismatch");
	if (change.kind === "resize" ? !entry.durationEditable : !entry.startEditable)
		throw new Error("calendar-entry-readonly");
	const start = calendarDateToInstant(change.start, timezone);
	const end = change.end ? calendarDateToInstant(change.end, timezone) : undefined;
	calendarDateToInstant(now, timezone);
	const value = calendarInstantToDate(
		start,
		timezone,
		change.allDay || change.kind === "drop-on-day",
	);
	const dayOf = (date: string) =>
		calendarInstantToDate(calendarDateToInstant(date, timezone), timezone, true);
	const updates: TaskUpdateInput = {};
	const clearedInstances = { complete: [] as string[], skipped: [] as string[] };
	if (entry.type === "timeEntry") {
		if (entry.timeEntryIndex === undefined || end === undefined)
			throw new Error("missing-time-entry-range");
		const timeEntries = (task.timeEntries || []).map(({ duration: _duration, ...rest }) => ({
			...rest,
		}));
		const current = timeEntries[entry.timeEntryIndex];
		if (!current?.endTime) throw new Error("missing-time-entry");
		if (change.kind === "resize") {
			current.startTime = new Date(start).toISOString();
			current.endTime = new Date(end).toISOString();
		} else {
			const delta = start - calendarDateToInstant(entry.start, timezone);
			current.startTime = new Date(
				calendarDateToInstant(current.startTime, timezone) + delta,
			).toISOString();
			current.endTime = new Date(
				calendarDateToInstant(current.endTime, timezone) + delta,
			).toISOString();
		}
		updates.timeEntries = timeEntries;
	} else if (change.kind === "resize") {
		if (end === undefined) throw new Error("missing-calendar-range");
		updates.timeEstimate = change.allDay
			? Math.round((end - start) / 86_400_000) * 1440
			: Math.round((end - start) / 60000);
	} else if (entry.type === "scheduledToDueSpan") {
		// Shift by calendar days and wall-clock minutes, not elapsed time, so a
		// daylight-saving change inside the span never moves either clock. A drop
		// on a day (all-day row, month cell) makes both dates date-only.
		const toDay = change.allDay || change.kind === "drop-on-day";
		const from = calendarInstantToDate(calendarDateToInstant(entry.start, timezone), timezone, entry.allDay);
		const days = calendarDaysBetween(from, value);
		const clock = (civil: string) => Number(civil.slice(11, 13)) * 60 + Number(civil.slice(14, 16));
		const minutes = !toDay && from.includes("T") ? clock(value) - clock(from) : 0;
		for (const property of ["scheduled", "due"] as const) {
			const current = task[property];
			if (!current) continue;
			const civil = calendarInstantToDate(
				calendarDateToInstant(current, timezone),
				timezone,
				!current.includes("T"),
			);
			updates[property] =
				toDay || !civil.includes("T")
					? addCalendarDays(calendarDay(civil), days)
					: new Date(Date.parse(`${civil}Z`) + days * 86_400_000 + minutes * 60_000)
							.toISOString()
							.slice(0, 16);
		}
	} else if (entry.recurringKind === "pattern" && !entry.isMaterializedOccurrence) {
		if (!task.recurrence) throw new Error("missing-recurrence");
		// Preserve the DTSTART date, parameters and RFC lines; only the pattern clock changes.
		const pattern = /DTSTART(?:;[^:\r\n]+)?:([^;\r\n]+)/;
		const match = pattern.exec(task.recurrence);
		const source =
			match?.[1].slice(0, 8) ||
			(task.scheduled || task.dateCreated
				? dayOf(task.scheduled || task.dateCreated!).replace(/-/g, "")
				: "");
		if (!/^\d{8}$/.test(source)) throw new Error("missing-recurrence-start");
		const dateOnly = change.allDay || change.kind === "drop-on-day";
		const prefix = match ? match[0].slice(0, match[0].length - match[1].length) : "DTSTART:";
		const nextPrefix = dateOnly
			? prefix.replace(/;TZID=[^:;]+/, "").replace(/;VALUE=DATE-TIME/, ";VALUE=DATE")
			: prefix.replace(/;VALUE=DATE(?=;|:)/, "");
		const dtstart = dateOnly
			? source
			: `${source}T${value.slice(11, 16).replace(":", "")}00${nextPrefix.includes(";TZID=") ? "" : "Z"}`;
		updates.recurrence = match
			? task.recurrence.replace(pattern, () => nextPrefix + dtstart)
			: `${nextPrefix}${dtstart};${task.recurrence}`;
	} else {
		const property = entry.type === "due" ? "due" : "scheduled";
		updates[property] =
			entry.recurringKind === "recorded" && !entry.isMaterializedOccurrence
				? `${dayOf(task.scheduled || entry.start)}${value.slice(10)}`
				: value;
	}
	if (
		entry.type !== "scheduledToDueSpan" &&
		updates.scheduled &&
		task.recurrence &&
		task.scheduled &&
		dayOf(updates.scheduled) !== dayOf(task.scheduled)
	) {
		const day = calendarDay(updates.scheduled);
		clearedInstances.complete = (task.complete_instances || []).filter((date) => date >= day);
		clearedInstances.skipped = (task.skipped_instances || []).filter((date) => date >= day);
		if (clearedInstances.complete.length || clearedInstances.skipped.length) {
			updates.complete_instances = (task.complete_instances || []).filter((date) => date < day);
			updates.skipped_instances = (task.skipped_instances || []).filter((date) => date < day);
		}
	}
	// Mirror the plugin's recurring-provider exception bookkeeping, without provider IO.
	const tracksException =
		!!task.recurrence &&
		(task.recurrence_anchor || "scheduled") === "scheduled" &&
		!!(
			task.googleCalendarEventId ||
			task.googleCalendarExceptionEventId ||
			task.googleCalendarExceptionOriginalScheduled ||
			task.googleCalendarMovedOriginalDates?.length
		);
	if (
		entry.type !== "scheduledToDueSpan" &&
		tracksException &&
		updates.scheduled &&
		updates.scheduled !== task.scheduled
	) {
		const source = task.googleCalendarExceptionOriginalScheduled || task.scheduled || task.due;
		const original = source ? dayOf(source) : "";
		if (original)
			updates.googleCalendarExceptionOriginalScheduled =
				calendarDay(updates.scheduled) !== original ? original : undefined;
	}
	// A calendar move changes the pending placement, not the native rule identity.
	// Freeze DTSTART against the old cursor before it can become the new seed.
	if (updates.scheduled && updates.scheduled !== task.scheduled && task.recurrence) {
		const originalCivilTask = {
			...task,
			scheduled: task.scheduled
				? calendarInstantToDate(
						calendarDateToInstant(task.scheduled, timezone),
						timezone,
						!task.scheduled.includes("T"),
					)
				: undefined,
		};
		if (!/DTSTART(?:;[^:\r\n]+)?:/.test(task.recurrence)) {
			const pinned = addDTSTARTToRecurrenceRule(originalCivilTask);
			if (pinned) updates.recurrence = pinned;
		}
		if ((task.recurrence_anchor || "scheduled") === "scheduled") {
			const previous = task.scheduled ? dayOf(task.scheduled) : "";
			const next = dayOf(updates.scheduled);
			if (previous !== next) {
				let original = normalizeRecurrenceOriginalDate(task.recurrence_original_date);
				if (!original && !tracksException && previous) {
					const target = new Date(`${previous}T00:00:00Z`);
					const occurrences = generateRecurringInstances(
						{
							...originalCivilTask,
							recurrence: task.recurrence.replace(/;TZID=[^:;\r\n]+/g, ""),
						},
						target,
						target,
					);
					if (occurrences.some((date) => date.toISOString().slice(0, 10) === previous))
						original = previous;
				}
				if (task.recurrence_original_date || original) {
					updates.recurrence_original_date = original && next !== original ? original : undefined;
				}
			}
		} else if (task.recurrence_original_date) {
			updates.recurrence_original_date = undefined;
		}
	} else if (
		updates.recurrence !== undefined &&
		updates.recurrence !== task.recurrence &&
		task.recurrence_original_date
	) {
		// Pattern/DTSTART edits establish a new series contract.
		updates.recurrence_original_date = undefined;
	}
	updates.dateModified = now;
	return {
		kind: "calendar.edit",
		updates,
		updatedTask: { ...task, ...updates },
		frontmatterPatch: taskInfoUpdatesToFrontmatterPatch(updates, fieldMapping),
		dateModified: now,
		clearedInstances,
		preserveRecurrenceSchedule: true,
	};
}

/**
 * What a series-wide calendar edit of a pattern occurrence changes: its clock
 * ("time"), all occurrences to all-day ("all-day") or to timed ("timed"), or
 * their duration ("duration"). A pattern drop never moves the series' days.
 */
export type CalendarSeriesEffect = "time" | "all-day" | "timed" | "duration";
export interface CalendarOccurrenceChoice {
	/** Edit only this occurrence: materialize its note with these overrides. */
	occurrence: {
		occurrenceDate: string;
		overrides: Pick<Partial<TaskInfo>, "scheduled" | "due" | "timeEstimate">;
	};
	/** Edit every occurrence through planCalendarEdit; absent when that would change nothing. */
	series?: CalendarSeriesEffect;
}
export interface PlanCalendarOccurrenceChoiceInput {
	task: TaskInfo;
	entry: CalendarEntry;
	change: CalendarChange;
	timezone: string;
}

/**
 * For a gesture on a generated (pattern) occurrence, describes both choices a
 * host should offer: this occurrence only, or the whole series. Returns
 * undefined for any other entry, which planCalendarEdit handles directly.
 */
export function planCalendarOccurrenceChoice({
	task,
	entry,
	change,
	timezone,
}: PlanCalendarOccurrenceChoiceInput): CalendarOccurrenceChoice | undefined {
	if (entry.recurringKind !== "pattern" || entry.isMaterializedOccurrence) return undefined;
	if (entry.taskId !== calendarTaskId(task)) throw new Error("calendar-task-mismatch");
	const occurrenceDate = entry.instanceDate || calendarDay(entry.start);
	const start = calendarDateToInstant(change.start, timezone);
	if (change.kind === "resize") {
		if (!change.end) throw new Error("missing-calendar-range");
		const end = calendarDateToInstant(change.end, timezone);
		const timeEstimate = change.allDay
			? Math.round((end - start) / 86_400_000) * 1440
			: Math.round((end - start) / 60000);
		return {
			occurrence: { occurrenceDate, overrides: { timeEstimate } },
			series: "duration",
		};
	}
	const toDay = change.allDay || change.kind === "drop-on-day";
	const scheduled = calendarInstantToDate(start, timezone, toDay);
	const overrides: CalendarOccurrenceChoice["occurrence"]["overrides"] = { scheduled };
	// The due date keeps its offset from the occurrence's day.
	const inheritedDue = buildInheritedOccurrenceTask(task, occurrenceDate).due;
	if (inheritedDue) {
		const days = calendarDaysBetween(occurrenceDate, calendarDay(scheduled));
		overrides.due = `${addCalendarDays(calendarDay(inheritedDue), days)}${inheritedDue.slice(10)}`;
	}
	const from = calendarInstantToDate(calendarDateToInstant(entry.start, timezone), timezone, entry.allDay);
	const series: CalendarSeriesEffect | undefined =
		toDay && !entry.allDay
			? "all-day"
			: !toDay && entry.allDay
				? "timed"
				: !toDay && from.slice(11, 16) !== scheduled.slice(11, 16)
					? "time"
					: undefined;
	return { occurrence: { occurrenceDate, overrides }, series };
}

export interface CalendarEntryIndex {
	setTasks(tasks: readonly CalendarTask[]): void;
	/** New object identity OR revision invalidates task-local range expansions. */
	upsert(taskId: string, task: CalendarTask, revision?: string | number): void;
	remove(taskId: string): void;
	setContext(context: CalendarContext): void;
	entriesInRange(range: CalendarRange): CalendarEntry[];
	clear(): void;
}

/** Bounded per-task/range cache. IdentityTasks outside the view go in materializedOccurrences. */
export function createCalendarEntryIndex(
	initialContext: CalendarContext,
	maxRangesPerTask = 8,
): CalendarEntryIndex {
	if (!Number.isInteger(maxRangesPerTask) || maxRangesPerTask < 1)
		throw new Error("invalid-calendar-cache-size");
	const snapshot = (value: CalendarContext): CalendarContext => ({
		timezone: value.timezone,
		now: value.now,
		settings: value.settings
			? {
					...value.settings,
					...(value.settings.completedStatuses
						? { completedStatuses: [...value.settings.completedStatuses] }
						: {}),
				}
			: undefined,
		materializedOccurrences: value.materializedOccurrences
			? Object.fromEntries(
					Object.entries(value.materializedOccurrences).map(([id, dates]) => [id, [...dates]]),
				)
			: undefined,
	});
	let context = snapshot(initialContext);
	const cacheContextKey = (value: CalendarContext) =>
		JSON.stringify({ ...value, now: value.settings?.showOverdueOnToday ? value.now : "" });
	let contextKey = cacheContextKey(context);
	const tasks = new Map<
		string,
		{ task: CalendarTask; revision?: string | number; explicitRevision: boolean; ranges: Map<string, CalendarEntry[]> }
	>();
	const upsert: CalendarEntryIndex["upsert"] = (id, task, revision) => {
		if (id !== calendarTaskId(task)) throw new Error("calendar-task-mismatch");
		const explicitRevision = revision !== undefined;
		const effectiveRevision = revision ?? task.dateModified;
		const previous = tasks.get(id);
		if (previous?.task === task && previous.revision === effectiveRevision) {
			previous.explicitRevision = explicitRevision;
			return;
		}
		tasks.set(id, { task, revision: effectiveRevision, explicitRevision, ranges: new Map() });
	};
	return {
		upsert,
		setTasks(next) {
			const ordered = next.map((task) => {
				const id = calendarTaskId(task);
				const previous = tasks.get(id);
				// Membership/order updates must not replace a host revision with
				// dateModified for the very same object. Default revisions still
				// observe a changed dateModified on mutable task inputs.
				upsert(id, task, previous?.task === task && previous.explicitRevision ? previous.revision : undefined);
				return [id, tasks.get(id)!] as const;
			});
			tasks.clear();
			for (const [id, value] of ordered) tasks.set(id, value);
		},
		remove(id) {
			tasks.delete(id);
		},
		setContext(next) {
			const copied = snapshot(next);
			const key = cacheContextKey(copied);
			if (key !== contextKey) {
				for (const value of tasks.values()) value.ranges.clear();
			}
			context = copied;
			contextKey = key;
		},
		entriesInRange(range) {
			rangeBounds(range, context);
			const materialized = materializedIndex(
				[...tasks.values()].map(({ task }) => task),
				context,
			);
			return [...tasks].flatMap(([id, value]) => {
				const dates = materialized.get(id) || new Set<string>();
				const key = JSON.stringify([range, [...dates].sort()]);
				let entries = value.ranges.get(key);
				if (!entries) {
					entries = buildTaskEntries(value.task, range, context, dates);
					value.ranges.set(key, entries);
					if (value.ranges.size > maxRangesPerTask)
						value.ranges.delete(value.ranges.keys().next().value!);
				} else {
					value.ranges.delete(key);
					value.ranges.set(key, entries);
				}
				// Callers may attach presentation metadata without poisoning cached projections.
				return entries.map((entry) => ({ ...entry }));
			});
		},
		clear() {
			tasks.clear();
		},
	};
}
