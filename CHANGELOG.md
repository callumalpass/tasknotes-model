# Changelog

## Unreleased

### Added

- `planCalendarOccurrenceChoice` describes both choices for a calendar gesture on a generated recurring occurrence: editing only that occurrence (the occurrence date and the `scheduled`/`due`/`timeEstimate` overrides for its occurrence note, with the due date keeping its offset) or the whole series (`time`, `all-day`, `timed` or `duration`; absent when a series edit would change nothing, such as a move to another day at the same time). `buildInheritedOccurrenceTask` is exported.

### Fixed

- Materializing a recurring occurrence the parent records as completed or skipped creates the note with the completed (and `completedDate`) or skipped status instead of reopening it. `buildMaterializeOccurrencePlan` accepts `completedStatus` and `skippedStatus`, and throws `missing_skipped_status` for a skipped date when no skipped status is available.
- Moving a scheduled-to-due span shifts both dates by calendar days and wall-clock time, so a daylight-saving change inside the span no longer moves the due time by an hour. Dropping a timed span on a day (all-day row or month cell) stores date-only scheduled and due dates instead of midnight times.
- Calendar date/timezone conversions reuse one `Intl.DateTimeFormat` per zone and memoize results. Projecting 2,000 tasks into a new week range drops from about 970 ms to 15 ms (TaskNotes calendar view switches with large vaults).

## 0.3.0-rc.18

### Fixed

- TaskNotes #2396: moved native recurring calendar occurrences retain their original rule-date identity for IDs, completion/skip lookup, spans and materialized-child suppression. Their original date is not projected again; moves onto another rule date keep the two occurrences distinct. Recorded history and Google moved-date behavior are preserved.
- Calendar edit plans capture and preserve the mapped `recurrence_original_date`, delete it on return to the original day or a series/DTSTART edit, and anchor DTSTART-less rules to the old scheduled date and clock rather than the moved placement. Legacy unmarked off-pattern and completion-anchored tasks do not acquire guessed identities.

### Added

- Optional `recurrenceOriginalDate` field mapping (default `recurrence_original_date`), task/schema support and strict date normalization, with fallback for older saved mappings.
- Packaged moved-occurrence regression fixtures covering projection, mapped edits, history, materialization and timed/all-day spans.

## 0.3.0-rc.17

### Added

- Pure `@tasknotes/model/calendar` projection for scheduled tasks, deadlines, scheduled-to-due spans, recurring occurrences, materialized children, tracked sessions, overdue-on-today display, duration rules and gesture permissions. Timezone and clock inputs are explicit.
- Calendar edit plans using mapped frontmatter patches, including independent next-occurrence and DTSTART clock edits, reschedule completion/skip clearing, estimate resizes and time-entry changes.
- A bounded incremental per-task/range index and packaged shared fixtures at `@tasknotes/model/calendar/fixtures`, verified through uncached and cached projection, edits, ESM/CJS consumption and multiple runtime timezones.

### Fixed

- Calendar index membership/order changes retain explicit host revisions and cached expansions for unchanged task objects.
- Calendar recurrence day expansion no longer depends on the JavaScript process timezone for RFC TZID rules. Pattern edits preserve multiline RRULE/EXDATE data; duration ends in the second DST overlap clock retain their instant.

## 0.3.0-rc.16

### Fixed

- (TaskNotes #2148) Empty or null list properties no longer become literal `null` entries in contexts, projects or tags. Explicitly authored `"null"` strings remain unchanged. Thanks to @minchinweb for reporting this.
- Updating a completion-anchored DTSTART preserves RFC multiline recurrence rules, inclusion/exclusion date lines, timezone parameters and the original clock when only the date changes. Weekly rules retain their frequency and display label after completion; legacy semicolon rules remain supported.
