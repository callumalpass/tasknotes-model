import scenarios from "../fixtures/calendar/scenarios.json";
import type { BuildCalendarEntriesInput, CalendarChange, CalendarEntry } from "./calendar.js";
import type { TaskInfo, TaskPatchOperation, TaskUpdateInput } from "./types.js";

export interface CalendarFixture {
	name: string;
	input: Omit<BuildCalendarEntriesInput, "tasks"> & { tasks: TaskInfo[] };
	expectedEntries: CalendarEntry[];
	edits: Array<{
		entryId: string;
		change: CalendarChange;
		expectedUpdates: TaskUpdateInput;
		expectedFrontmatterPatch: TaskPatchOperation[];
		expectedClearedInstances: { complete: string[]; skipped: string[] };
	}>;
}

/** Static cross-host regression contract; no runtime projection used to produce expectations. */
export const calendarFixtures = scenarios as CalendarFixture[];
