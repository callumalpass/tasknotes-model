import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FIELD_MAPPING, mapTaskFromFrontmatter, mapTaskToFrontmatter, buildTaskUpdatePlan, buildTaskNotesMdbaseResources } from "../dist/esm/index.js";

const mapping = { ...DEFAULT_FIELD_MAPPING, assignees: "owners" };
test("portable assignments preserve exact IDs through custom field mappings", () => {
  const ids = ["Person_A", "person_missing"];
  const task = mapTaskFromFrontmatter(mapping, { title: "Assigned", owners: ids }, "tasks/assigned.md");
  assert.deepEqual(task.assignees, ids);
  assert.deepEqual(mapTaskToFrontmatter(mapping, task).owners, ids);
  assert.deepEqual(mapTaskToFrontmatter(mapping, { ...task, assignees: [] }).owners, []);
});

test("ordinary task updates retain unresolved assignments and explicitly clear them", () => {
  const originalTask = { title: "Assigned", path: "tasks/assigned.md", status: "open", priority: "normal", archived: false, assignees: ["person_missing"] };
  const options = { originalTask, fieldMapping: mapping, now: "2026-09-13T12:00:00Z", currentDateString: "2026-09-13" };
  assert.deepEqual(buildTaskUpdatePlan({ ...options, updates: { title: "Renamed" } }).updatedTask.assignees, ["person_missing"]);
  assert.deepEqual(buildTaskUpdatePlan({ ...options, updates: { assignees: [] } }).updatedTask.assignees, []);
});

test("the new task contract declares assignments without pretending they are file links", () => {
  const resources = buildTaskNotesMdbaseResources();
  assert.equal(resources.contract.version, "0.3.0-rc.4");
  assert.equal(resources.taskSchema.properties.assignees.uniqueItems, true);
  assert.equal(resources.type.implements[0].fields.assignees, "assignees");
  assert.equal(resources.type.collection.links["assignees[]"], undefined);
});
