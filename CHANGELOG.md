# Changelog

## 0.3.0-rc.16

### Fixed

- (TaskNotes #2148) Empty or null list properties no longer become literal `null` entries in contexts, projects or tags. Explicitly authored `"null"` strings remain unchanged. Thanks to @minchinweb for reporting this.
- Updating a completion-anchored DTSTART preserves RFC multiline recurrence rules, inclusion/exclusion date lines, timezone parameters and the original clock when only the date changes. Weekly rules retain their frequency and display label after completion; legacy semicolon rules remain supported.
