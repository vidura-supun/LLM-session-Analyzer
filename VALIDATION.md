# Validation

Verified on 2026-09-21 using Node 24.18.0.

## Source collection

- The Claude fixture collection has 11 JSONL files forming 9 sessions; the two subagent files join their parent session.
- Its 1,443 valid source records remain accessible through normalized events or paired tool result records, producing 1,197 timeline events including 246 paired tool calls.
- The live Codex collection has 10 rollout files forming 5 parent sessions and 10 agent identities. It produces 3,949 normalized events, including 121 prompts, 1,508 recorded reasoning events, 442 assistant messages, 1,293 tool events, and 585 lifecycle/system events.
- No JSONL parse warnings occurred in either collection.
- Two Markdown memory documents; one has an explicit originating-session link.

No original session or memory files were modified or copied into the application. Demo content is fictional.

## Checks passed

All 14 parser tests pass with both optional fixture collections enabled. They cover malformed lines, BOM/CRLF, Claude and Codex tool normalization/provenance, agent separation and Codex child-rollout merging, token deduplication, recorded reasoning and missing thinking, Codex history/index enrichment, structured user questions, metadata, unknown records, memory linking, unsafe YAML keys, timestamp ranges, and real-collection invariants. Fixture tests skip when their environment variables are unavailable.

An isolated jsdom harness exercised the interface using the actual HTML, CSS, and JavaScript:

- Fictional demo, real collection import, and hidden empty-state behavior.
- Search, tool/error filters, reset synchronization, and filtered JSON export.
- Search-result previews and Go to result navigation into the normal paginated timeline, with the target highlighted and neighboring events visible.
- Structured AskUserQuestion parsing and rendering for single-select, multi-select, custom answers, annotations, rejected questions, and missing results.
- UTC timestamp rendering in `YYYY-MM-DD HH:mm:ss UTC` format.
- Print-to-PDF report generation across every filtered timeline page, including readable tool details, structured questions, and linked memory; report cleanup after printing.
- Imported HTML displayed as text, without creating executable elements.
- Malformed-line warnings and warning-only imports.
- Memory-only imports.
- Prompt navigation across three pages.
- Clear removing rendered content and cancelling an in-flight import.
- Partial import recovery when one file cannot be read.
- Broad `.codex` folder import into five sessions, with platform labels and unrelated plugin JSONL/skill Markdown skipped before file reads.

All application JavaScript files pass syntax checks. Test-only dependencies were installed outside the application; the delivered viewer has no runtime dependencies.

## Remaining verification limit

No browser connection was available through the Browser skill. DOM checks verify behavior but do not establish visual layout quality, native file-picker behavior, downloads, or CSP behavior in a particular browser. A manual browser pass is still recommended for those surfaces.
