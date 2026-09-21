# LLM session Analyzer

A standalone, offline viewer for Claude Code session JSONL files. Open `index.html` in a browser. No installation, server, account, or API key is needed. Keep `index.html`, `styles.css`, `parser.js`, `app.js`, and `demo.js` together.

## Use

1. Open `index.html` and choose files, drag in logs, or select a project folder. Folder import includes nested subagent logs and Markdown memory files. Use **Demo** to try fictional data first.
2. Select a session. Browse prompts, assistant replies, recorded thinking, tool calls with their results, and system events. Expand a card to inspect its full content and source record.
3. Search and filter the timeline by event type, tool, agent, or errors. Jump between prompts to follow the work. Export the filtered events for further analysis.
4. Open the memory view to read imported Markdown documents and follow explicit origin-session links.

Select the folder containing your Claude session logs as the import folder. The viewer imports data only when you select it; it does not automatically scan your disk. Importing an individual JSONL file cannot also read neighboring memory or subagent files: select those files too, or import their parent folder.

Folder import reads `.jsonl` logs and `.md` documents, skipping unrelated files and agent `.meta.json` sidecars. System events start hidden to keep the timeline readable; enable **System** to inspect them. Thinking starts collapsed. Filters apply together, and export includes all matching events across pages.

## What the viewer means

- **Thinking:** the thinking text actually present in the export. Missing or redacted thinking cannot be recovered.
- **Tool status:** a recorded result is paired with its call using session, agent, and tool-use ID. An error flag marks a recorded failure; a call without a result is pending/unknown, not proof it is still running. Commands are displayed as text and never executed.
- **Timeline:** recorded events, including branch/parent identifiers in the source records. It is an analysis view, not a reconstruction of a single canonical branch. System records can contain injected context, permission changes, compaction information, attachments, and bookkeeping.
- **Tokens:** recorded usage, deduplicated across assistant blocks with the same message ID within an agent. Cache reads and cache writes are shown separately. These are not a cost estimate or a billing statement.
- **Memory:** useful project context, but a current snapshot may have been edited after the session. An explicit `originSessionId` links a memory to a session; that link does not prove the whole current document was available at that time. Unlinked documents remain accessible.
- **Import warnings:** malformed lines are reported by file and line while valid records remain usable. Unknown record types remain inspectable as system events.

## Privacy and limits

Files are processed in browser memory. The app has no external dependencies, analytics, remote fonts, or network upload. Reloading or clearing removes the imported workspace. Exports may contain the same sensitive information as the original logs, including prompts, tool arguments, and output.

Plain text rendering prevents imported HTML or scripts from executing. Markdown memory documents remain readable source text; links and embedded images are not fetched automatically. Imports are held in memory, so very large collections are limited by your browser's available memory. Timeline rendering is paginated to keep browsing responsive.

## Development

`parser.js` is a dependency-free parser usable both in the browser (`SessionParser`) and Node (`require('./parser.js')`). `app.js` handles local imports, state, filtering, and rendering. `styles.css` provides the layout; `demo.js` contains fictional examples only. See `CONTRACT.md` for the normalized event format.

Run parser tests with Node:

```sh
node --test parser.test.cjs
```

The original session and memory files are kept separate and are never modified by this viewer.

Real session data is not included in this repository. To run the optional aggregate test against your own local logs, set `CLAUDE_SESSION_FIXTURES` to their parent folder before running the tests. Keep imported logs, memories, and exports out of version control; `.gitignore` excludes common data paths and all `.jsonl` files.
