import scenarios from "../fixtures/calendar/scenarios.json";
import movedOccurrences from "../fixtures/calendar/moved-occurrences.json";
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

/** Static cross-host regression contract; no runtime projection used to produce expectations.
 * JSON cannot encode undefined: expectedUnsetProperties expands explicit update deletions.
 */
export const calendarFixtures: CalendarFixture[] = [...scenarios, ...movedOccurrences].map((fixture) => ({
	...fixture,
	edits: fixture.edits.map((raw) => {
		const edit = raw as CalendarFixture["edits"][number] & { expectedUnsetProperties?: Array<keyof TaskUpdateInput> };
		return {
			...edit,
			expectedUpdates: {
				...edit.expectedUpdates,
				...Object.fromEntries((edit.expectedUnsetProperties || []).map((key) => [key, undefined])),
			},
		};
	}),
})) as CalendarFixture[];
