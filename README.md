# LLM session Analyzer

A standalone, offline viewer for Claude Code and Codex session JSONL files. Open `index.html` in a browser. No installation, server, account, or API key is needed. Keep `index.html`, `styles.css`, `parser.js`, `app.js`, and `demo.js` together.

## Use

1. Open `index.html` and choose files, drag in logs, or select a session-data folder. Folder import includes nested JSONL logs. Markdown is imported from `memory` or `memories` directories only, so selecting a broad folder such as `.codex` does not accidentally ingest skills and documentation. You can still select an individual `.md` memory file directly. Use **Demo** to try fictional data first.
2. Select a session. Browse prompts, assistant replies, recorded thinking, tool calls with their results, structured AskUserQuestion choices and answers, and system events. Expand a card to inspect its full content and source record. Timestamps are shown in UTC as `YYYY-MM-DD HH:mm:ss UTC`.
3. Search and filter the timeline by event type, tool, agent, or errors. Search results include **Go to result**, which restores the normal timeline on the correct page and focuses the matching event so you can read the surrounding context. Jump between prompts to follow the work. Export the filtered events as JSON, or choose **Save PDF** and select **Save as PDF** in the browser print dialog. The PDF contains all matching events across timeline pages plus linked memory.
4. Open the memory view to read imported Markdown documents and follow explicit origin-session links.

Select the folder containing your session logs as the import folder. For Claude Code, select the relevant Claude project/session directory. For Codex on this computer, you can select `/Users/vidura/.codex`; the viewer finds supported JSONL records below it and skips unrelated files, including skill and documentation Markdown. To narrow the import, select `/Users/vidura/.codex/sessions` instead. The viewer imports data only when you select it; it does not automatically scan your disk.

Importing an individual JSONL file cannot also read neighboring memory or subagent files: select those files too, or import their parent folder. Folder-imported Markdown must be below a directory named `memory` or `memories`; directly selected `.md` files are accepted wherever they live.

Folder import reads `.jsonl` logs and eligible memory `.md` documents, skipping unrelated files and agent `.meta.json` sidecars. System events start hidden to keep the timeline readable; enable **System** to inspect them. Thinking starts collapsed. Filters apply together, and export includes all matching events across pages.

Codex support includes session metadata and turn context; user, assistant, and recorded reasoning-summary messages; commands, file changes, MCP and collaboration tool calls with their outputs; web-search calls; recorded token totals; and compaction records. Duplicate low-level response records are suppressed, while lifecycle and runtime-state records remain inspectable as system events.

## What the viewer means

- **Thinking:** the thinking text actually present in the export. Missing or redacted thinking cannot be recovered.
- **Tool status:** a recorded result is paired with its call using session, agent, and tool-use ID. An error flag marks a recorded failure; a call without a result is pending/unknown, not proof it is still running. Commands are displayed as text and never executed.
- **Timeline:** recorded events, including branch/parent identifiers in the source records. It is an analysis view, not a reconstruction of a single canonical branch. System records can contain injected context, permission changes, compaction information, attachments, and bookkeeping.
- **Tokens:** recorded usage, deduplicated across assistant blocks with the same message ID within an agent. Cache reads and cache writes are shown separately. These are not a cost estimate or a billing statement.
- **Memory:** useful project context, but a current snapshot may have been edited after the session. An explicit `originSessionId` links a memory to a session; that link does not prove the whole current document was available at that time. Unlinked documents remain accessible.
- **Import warnings:** malformed lines are reported by file and line while valid records remain usable. Unknown record types remain inspectable as system events.

## Privacy and limits

Files are processed in browser memory. The app has no external dependencies, analytics, remote fonts, or network upload: selecting `/Users/vidura/.codex` does not send its contents anywhere. Reloading or clearing removes the imported workspace. Exports may contain the same sensitive information as the original logs, including prompts, tool arguments, and output.

Plain text rendering prevents imported HTML or scripts from executing. Markdown memory documents remain readable source text; links and embedded images are not fetched automatically. Imports are held in memory, so very large collections are limited by your browser's available memory. Timeline rendering is paginated to keep browsing responsive.

## Development

`parser.js` is a dependency-free parser usable both in the browser (`SessionParser`) and Node (`require('./parser.js')`). `app.js` handles local imports, state, filtering, and rendering. `styles.css` provides the layout; `demo.js` contains fictional examples only. See `CONTRACT.md` for the normalized event format.

Run parser tests with Node:

```sh
node --test parser.test.cjs
```

The original session and memory files are kept separate and are never modified by this viewer.

Real session data is not included in this repository. To run the optional aggregate tests against your own local logs, set `CLAUDE_SESSION_FIXTURES` to a Claude log parent folder and/or `CODEX_SESSION_FIXTURES` to a Codex session folder before running the tests. Keep imported logs, memories, and exports out of version control; `.gitignore` excludes common data paths and all `.jsonl` files.
