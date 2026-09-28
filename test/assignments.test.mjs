import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FIELD_MAPPING, mapTaskFromFrontmatter, mapTaskToFrontmatter, buildTaskUpdatePlan, buildTaskNotesMdbaseResources } from "../dist/esm/index.js";

const mapping = { ...DEFAULT_FIELD_MAPPING, assignees: "owners" };
test("portable assignments preserve exact IDs through custom field mappings", () => {
  const ids = ["[[People/Alex Rivera]]", "[[Former teammate]]"];
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

test("the task contract declares assignments as links resolved by the collection", () => {
  const resources = buildTaskNotesMdbaseResources();
  assert.equal(resources.contract.version, "0.3.0-rc.5");
  assert.equal(resources.type.version, 3);
  assert.equal(resources.taskSchema.properties.assignees.uniqueItems, true);
  assert.equal(resources.type.implements[0].fields.assignees, "assignees");
  // No target_type: several local types may implement mdbase.person.
  assert.deepEqual(resources.type.collection.links["assignees[]"], { validate_exists: false });
  const custom = buildTaskNotesMdbaseResources({ modelConfig: { fieldMapping: { ...DEFAULT_FIELD_MAPPING, assignees: "owners" } } });
  assert.deepEqual(custom.type.collection.links["owners[]"], { validate_exists: false });
});

test("hand-edited assignee values are read as IDs or left exactly as written", () => {
  const scalar = mapTaskFromFrontmatter(mapping, { title: "One", owners: "alex" }, "tasks/one.md");
  assert.deepEqual(scalar.assignees, ["alex"]);
  for (const owners of [["alex", 5], { id: "alex" }, 7]) {
    const task = mapTaskFromFrontmatter(mapping, { title: "Odd", owners }, "tasks/odd.md");
    assert.equal(task.assignees, undefined);
    assert.equal(Object.hasOwn(mapTaskToFrontmatter(mapping, task), "owners"), false);
  }
});
