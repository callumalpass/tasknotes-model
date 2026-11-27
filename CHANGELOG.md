# Changelog

## Unreleased

### Fixed

- `planCalendarEdit` no longer clears other occurrences' completed or skipped history when moving a scheduled-anchored recurring task. Moves without a `recurrence_original_date` (such as Google-synced or legacy off-pattern tasks) clear only the landing day when it is already recorded; completion-anchored tasks keep clearing recorded instances on or after the new date. Thanks to @martin-forge for reporting (TaskNotes #2691).
- Generated mdbase task types and the `tasknotes.task` 0.3.0-rc.7 contract accept floating `due`, `scheduled`, `dateCreated`, and `dateModified` values through the `local-date-time` format. Pack 0.3.0-rc.23 upgrades all earlier starters, including the TaskNotes #2706 fix.
- Calendar conversion accepts fractional seconds of any length and truncates to millisecond precision. Timestamp validation, task updates, and time tracking calculations use the collection timezone when callers supply it.

## 0.3.2 - 2026-11-20

### Fixed

- Editing a completion-anchored recurrence rule no longer moves the current occurrence's scheduled or due date.

## 0.3.1 - 2026-11-18

### Added

- `FieldMapping.id` names the stable task identity property. It defaults to `id`; mappings saved without it keep using `id`. `mapTaskFromFrontmatter` reads the ID from the mapped property, `toUserField`, `lookupMappingKey` and `validateFieldMapping` include it, and `DEFAULT_ID_PROPERTY` is exported from `@tasknotes/model/mapping`.
- `buildTaskNotesMdbaseResources` uses the mapped ID property for the type's `implements[].fields.id`, schema property, `on_create` UUID, uniqueness rule and the collection's `id_field`. `resolveTaskNotesModelConfigFromMdbaseType` reads a type's `fields.id` into the mapping, and with a remapped ID a plain `id` property resolves as a custom field.

## 0.3.0 - 2026-11-15

Promotes the package to stable semver, retaining the tasknotes-spec 0.3.0
schemas and the published `tasknotes.task` 0.3.0-rc.6 contract identity.

### Added

- `LEGACY_APP_SETTINGS_FOLDER`, `legacyAppSettingsPath(app)` and `resolveAppSettingsPath(app, { currentExists, legacyExists })`, exported from the root and `@tasknotes/model/settings`. The resolver chooses the new path when it exists, otherwise the legacy path when it exists, otherwise the new path for creation. Clients read and save the selected record without moving it.

- `patchTaskNotesMdbaseTypeSettings` is now the one editor for a TaskNotes task type. It accepts `statuses` and `priorities` (complete lists in display order) and `userFields` (`add`, `rename`, `remove`), and rewrites every place the type repeats them: the schema's allowed values and defaults, the completion rule, the collection's read defaults, the binding's `values`, `completed_values`, `skipped_values`, `default_skipped` and `definitions`, and the generator's `managed_fields`. A default named in the same patch may be one of the new values. The result equals what `buildTaskNotesMdbaseResources` generates for the same settings, in canonical and migrated-v0.2 types; definition keys and properties the patch does not name are kept.
- Vocabulary helpers, exported from `@tasknotes/model/mdbase`: `taskNotesVocabularyProblem` (empty label, duplicate value, no open or no completed status, a status both completed and skipped, no priority, a removed default), `taskNotesVocabularyInUse` (the first removed status or priority tasks still hold), `taskNotesVocabularyValue` and `taskNotesUserFieldKey` (a stored value or property name from a label), `TaskNotesVocabularyError`, `TaskNotesVocabularyInUseError` and the `isTaskNotesVocabularyError` / `isTaskNotesVocabularyInUseError` guards.
- `taskNotesMdbaseTypeDisagreements` reports where a type states its statuses, priorities or defaults more than once and the copies differ (schema enum, definitions, completion rule, schema default, read default against the binding). `reconcileTaskNotesMdbaseTypeVocabulary` returns the type with the copies agreeing, never taking away a value a task may hold.
- `resolveTaskNotesModelConfigFromImplementation` resolves the configuration from a tasknotes.task implementation (`fields`, `binding`, the type's schema and `match`), which is what an authority's catalog returns, without the type document. `resolveTaskNotesModelConfigFromMdbaseType` now delegates to it.

- `@tasknotes/model/settings`: the app-settings logic from mdbase Reader (resolve with defaults and warnings, patch only changed fields, conflicts, read-only on a newer `settings_version` or another app's record, new-record frontmatter, in-place Markdown writes that keep unknown fields, comments and the body) and the TaskNotes definition: `resolveTaskNotesAppSettings` (record, then legacy binding, then fallback), `taskNotesAppSettingsFromLegacyBinding`, `withoutTaskNotesAppSettings`, `absentTaskNotesSettingsPatch` (what a migration adds to a record another device created), `taskNotesAppSettingsFromModelConfig`, `applyTaskNotesAppSettingsToModelConfig`, and `buildTaskNotesSettingsResources` (contract, schema and `tasknotes-settings` type).
- `upgradeTaskNotesMdbaseTypeContract` lifts an rc.5/rc.3 type to rc.6 and returns the settings it removed. `TASKNOTES_ACCEPTED_CONTRACT_VERSIONS`, `TASKNOTES_LEGACY_CONTRACT_VERSIONS`, `TASKNOTES_LEGACY_CONTRACT_DIGESTS` and `taskNotesContractVersion` are exported.

- `planCalendarOccurrenceChoice` describes both choices for a calendar gesture on a generated recurring occurrence: editing only that occurrence (the occurrence date and the `scheduled`/`due`/`timeEstimate` overrides for its occurrence note, with the due date keeping its offset) or the whole series (`time`, `all-day`, `timed` or `duration`; absent when a series edit would change nothing, such as a move to another day at the same time). `buildInheritedOccurrenceTask` is exported.

- Optional `recurrenceOriginalDate` field mapping (default `recurrence_original_date`), task/schema support and strict date normalization, with fallback for older saved mappings.
- Packaged moved-occurrence regression fixtures covering projection, mapped edits, history, materialization and timed/all-day spans.

- Pure `@tasknotes/model/calendar` projection for scheduled tasks, deadlines, scheduled-to-due spans, recurring occurrences, materialized children, tracked sessions, overdue-on-today display, duration rules and gesture permissions. Timezone and clock inputs are explicit.
- Calendar edit plans using mapped frontmatter patches, including independent next-occurrence and DTSTART clock edits, reschedule completion/skip clearing, estimate resizes and time-entry changes.
- A bounded incremental per-task/range index and packaged shared fixtures at `@tasknotes/model/calendar/fixtures`, verified through uncached and cached projection, edits, ESM/CJS consumption and multiple runtime timezones.

### Changed

- **New-collection layout:** `APP_SETTINGS_FOLDER` and `appSettingsPath` / `TASKNOTES_SETTINGS_PATH` now use `_mdbase/settings`. New collection resources explicitly default to `_mdbase/types` and `_mdbase/contracts`; schema files follow the parent of the contracts folder. Existing collections keep their configured folders (or the unchanged mdbase spec defaults `_types` / `_contracts`); clients must use the path resolver rather than creating a second settings record.
- Settings resources implement `mdbase.app-settings` 2.0.0 and `tasknotes.settings` 1.1.0 with settings type version 2. The record's `settings_version` remains 1. `resolveAppSettings` accepts the path read as its third argument, and `resolveTaskNotesAppSettings` accepts `options.path`, so read-only messages identify the actual record.
- Vendor the `tasknotes.task` 0.3.0-rc.21 pack from mdbase-contracts PR #23 (`c50a6d08d975b02891fdb8f9c9f08011179efd51`). Generated packs now include the published settings resources, retained contracts/schemas and seed upgrade history, with configured folder targets and byte-identical support documents. `provides` includes the settings contracts as well as `tasknotes.task`. Refresh the vendored artifact with `MDBASE_CONTRACTS_ROOT=<checkout> npm run sync:mdbase-pack` after building that checkout's `dist/`.
- Documented `taskSchemaDocument`, `bindingSchemaDocument`, `paths.taskSchema` and `paths.bindingSchema` as tasknotes.task type-pack resources. A host must not write them as plain files: mdbase setup refuses a plain file at a path the pack manages unless it holds the exact resource bytes (tasknotes-app #436). The contract already carries both schemas inline.

- A custom field's display name is written to the type as the property's `title`, and read from it before the host's remembered name. Names now reach other TaskNotes hosts; types written earlier keep the host's name until they are next written.
- A status or priority only the schema allows (not in the binding's `values`) is read after the described ones instead of being hidden, so hosts show it and saving the list repairs the type.
- The camel-case spellings early bindings used (`isCompleted`, `isSkipped`, `defaultMaterialization`, `defaultNextTrigger`, `pastHorizon`, `futureHorizon`) are read after the current ones.
- Only a rule that requires the completion date is treated as the completion rule. Another `allOf` rule that tests the status is the collection's own: an edit to the statuses leaves it as written, and it is not reported as a disagreement.

- App behaviour moved out of the `tasknotes.task` binding into the TaskNotes settings record. The rc.6 binding no longer holds `nlp`, `templating`, `time_tracking`, `archive.move_on_archive`/`archive.folder`, `recurrence.reset_body_checkboxes`, `links.write_format`, or the per-status `next_status`, `exclude_from_cycle`, `auto_archive` and `auto_archive_delay_minutes`.
- `buildTaskNotesMdbaseResources` returns those settings as `appSettings`, uses a versioned `tasknotes.task/0.3.0-rc.6.md` contract path under the configured contracts folder (retaining earlier contracts for types that still implement them), and generates type version 5. The starter is revision 6; `TASKNOTES_MDBASE_PACK_VERSION` remains 0.3.0-rc.21.
- `patchTaskNotesMdbaseTypeSettings` no longer accepts `recurrence.resetCheckboxesOnRecurrence`, `timeTracking`, `links`, `archive`, `templating` or `statusAutomation`; write them with `buildTaskNotesSettingsPatch`.
- Types implementing rc.5 or rc.3 are still read. `resolveTaskNotesModelConfigFromMdbaseType(type, fallback, { settings })` reads each moved setting from the record, then the binding, then the fallback. A status without behaviour anywhere is out of the cycle exactly when it is skipped.

### Fixed

- Materializing a recurring occurrence the parent records as completed or skipped creates the note with the completed (and `completedDate`) or skipped status instead of reopening it. `buildMaterializeOccurrencePlan` accepts `completedStatus` and `skippedStatus`, and throws `missing_skipped_status` for a skipped date when no skipped status is available.
- Moving a scheduled-to-due span shifts both dates by calendar days and wall-clock time, so a daylight-saving change inside the span no longer moves the due time by an hour. Dropping a timed span on a day (all-day row or month cell) stores date-only scheduled and due dates instead of midnight times.
- Calendar date/timezone conversions reuse one `Intl.DateTimeFormat` per zone and memoize results. Projecting 2,000 tasks into a new week range drops from about 970 ms to 15 ms (TaskNotes calendar view switches with large vaults).

- TaskNotes #2396: moved native recurring calendar occurrences retain their original rule-date identity for IDs, completion/skip lookup, spans and materialized-child suppression. Their original date is not projected again; moves onto another rule date keep the two occurrences distinct. Recorded history and Google moved-date behavior are preserved.
- Calendar edit plans capture and preserve the mapped `recurrence_original_date`, delete it on return to the original day or a series/DTSTART edit, and anchor DTSTART-less rules to the old scheduled date and clock rather than the moved placement. Legacy unmarked off-pattern and completion-anchored tasks do not acquire guessed identities.

- Calendar index membership/order changes retain explicit host revisions and cached expansions for unchanged task objects.
- Calendar recurrence day expansion no longer depends on the JavaScript process timezone for RFC TZID rules. Pattern edits preserve multiline RRULE/EXDATE data; duration ends in the second DST overlap clock retain their instant.

- (TaskNotes #2148) Empty or null list properties no longer become literal `null` entries in contexts, projects or tags. Explicitly authored `"null"` strings remain unchanged. Thanks to @minchinweb for reporting this.
- Updating a completion-anchored DTSTART preserves RFC multiline recurrence rules, inclusion/exclusion date lines, timezone parameters and the original clock when only the date changes. Weekly rules retain their frequency and display label after completion; legacy semicolon rules remain supported.
