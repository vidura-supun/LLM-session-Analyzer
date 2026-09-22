# Validation

Verified on 2026-09-22 using Node 24.18.0.

## Source collection

- The Claude fixture collection has 11 JSONL files forming 9 sessions; the two subagent files join their parent session.
- Its 1,443 valid source records remain accessible through normalized events or paired tool result records, producing 1,197 timeline events including 246 paired tool calls.
- The live Codex collection has 10 rollout files forming 5 parent sessions and 10 agent identities. It produces 3,949 normalized events, including 121 prompts, 1,508 recorded reasoning events, 442 assistant messages, 1,293 tool events, and 585 lifecycle/system events.
- The Gemini/Antigravity collection has 70 canonical full transcripts forming 70 sessions and 3,305 events: 223 prompts, 827 recorded-thinking events, 356 assistant messages, 725 tools, and 1,174 system/checkpoint/error events. Alternate transcripts and chunks are excluded without duplicate warnings.
- A real sanitized OpenCode JSON export produced one session with 14 events, including prompts, reasoning, tools, errors, models, agents, and recorded token totals.
- No parse warnings occurred in the selected Claude, Codex, Gemini, or OpenCode sources.
- Two Markdown memory documents; one has an explicit originating-session link.

No original session or memory files were modified or copied into the application. Demo content is fictional.

## Checks passed

All 23 parser tests pass or skip only when an optional export fixture is not supplied: 22 passed against the available real Claude, Codex, and Gemini collections, with the OpenCode fixture-path test skipped after a real sanitized export was instead validated in memory. Coverage includes malformed JSON/JSONL, all four platform normalizers, tool result provenance, transcript deduplication, agent/subagent handling, token accounting, recorded reasoning, structured and plain recorded user answers, metadata/history enrichment, unknown records, memory linking, timestamps, and real-collection invariants.

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
- Broad `.gemini` import into 70 sessions, accepting only canonical full transcripts while skipping configuration JSON and alternate transcripts before file reads.
- A real sanitized OpenCode JSON export rendered as an OpenCode session with reasoning-token stats and tool filters.

All application JavaScript files pass syntax checks. Test-only dependencies were installed outside the application; the delivered viewer has no runtime dependencies.

## Remaining verification limit

No browser connection was available through the Browser skill. DOM checks verify behavior but do not establish visual layout quality, native file-picker behavior, downloads, or CSP behavior in a particular browser. A manual browser pass is still recommended for those surfaces.
