# Validation

Verified on 2026-09-21 using Node 24.18.0.

## Source collection

- 11 JSONL files form 9 sessions; the two subagent files join their parent session.
- 1,443 valid source records remain accessible through normalized events or paired tool result records.
- 1,197 normalized timeline events, including 246 paired tool calls.
- No JSONL parse warnings in the supplied collection.
- Two Markdown memory documents; one has an explicit originating-session link.

No original session or memory files were modified or copied into the application. Demo content is fictional.

## Checks passed

All nine parser tests pass with `node --test parser.test.cjs`. They cover malformed lines, BOM/CRLF, tool pairing and provenance, agent separation, token deduplication, missing thinking, metadata, unknown events, memory linking, unsafe YAML keys, timestamp ranges, and record retention across the real collection. The real-file test skips when that collection is unavailable.

An isolated jsdom harness exercised the interface using the actual HTML, CSS, and JavaScript:

- Fictional demo, real collection import, and hidden empty-state behavior.
- Search, tool/error filters, reset synchronization, and filtered JSON export.
- Search-result previews and Go to result navigation into the normal paginated timeline, with the target highlighted and neighboring events visible.
- Structured AskUserQuestion parsing and rendering for single-select, multi-select, custom answers, annotations, rejected questions, and missing results.
- UTC timestamp rendering in `YYYY-MM-DD HH:mm:ss UTC` format.
- Imported HTML displayed as text, without creating executable elements.
- Malformed-line warnings and warning-only imports.
- Memory-only imports.
- Prompt navigation across three pages.
- Clear removing rendered content and cancelling an in-flight import.
- Partial import recovery when one file cannot be read.

All application JavaScript files pass syntax checks. Test-only dependencies were installed outside the application; the delivered viewer has no runtime dependencies.

## Remaining verification limit

No browser connection was available through the Browser skill. DOM checks verify behavior but do not establish visual layout quality, native file-picker behavior, downloads, or CSP behavior in a particular browser. A manual browser pass is still recommended for those surfaces.
