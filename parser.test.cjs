const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const P = require("./parser.js");

test("JSONL tolerates BOM, CRLF, blanks and malformed/non-object lines", () => {
  const p = P.parseJSONL('\ufeff{"type":"user"}\r\n\r\nbad\r\n[]', "x");
  assert.equal(p.records.length, 1);
  assert.equal(p.totalLines, 4);
  assert.equal(p.warnings.length, 2);
  assert.deepEqual(
    p.warnings.map((x) => x.line),
    [3, 4],
  );
});

test("memory reads nested origin id and preserves source text", () => {
  const text = "---\nname: Note\ncontext:\n  originSessionId: abc\n---\nBody";
  const m = P.parseMemory(text, "n.md");
  assert.equal(m.originSessionId, "abc");
  assert.equal(m.body, "Body");
  assert.equal(m.content, text);
});

test("pairs tools by session and agent, preserves provenance, and leaves orphan", () => {
  const rows = [
    {
      type: "assistant",
      sessionId: "s",
      agentId: "a",
      uuid: "u",
      message: {
        id: "m",
        model: "model",
        usage: { input_tokens: 5, output_tokens: 2 },
        content: [
          { type: "thinking", thinking: "" },
          { type: "tool_use", id: "t", name: "Run", input: { command: "ok" } },
        ],
      },
    },
    {
      type: "user",
      sessionId: "s",
      agentId: "a",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t", content: "done" }],
      },
    },
    {
      type: "user",
      sessionId: "s",
      agentId: "b",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t",
            content: "orphan",
            is_error: true,
          },
        ],
      },
    },
    {
      type: "assistant",
      sessionId: "s",
      agentId: "a",
      message: {
        id: "m",
        usage: { input_tokens: 5, output_tokens: 9 },
        content: [{ type: "text", text: "answer" }],
      },
    },
  ];
  const p = P.parseJSONL(rows.map(JSON.stringify).join("\n"), "f.jsonl"),
    w = P.buildWorkspace([p]),
    s = w.sessions[0];
  const tool = s.events.find((e) => e.kind === "tool");
  assert.equal(tool.tool.result, "done");
  assert.equal(tool.tool.resultLine, 2);
  assert.deepEqual(tool.raw, rows[0]);
  assert.ok(s.events.some((e) => e.kind === "result" && e.agentId === "b"));
  assert.match(
    s.events.find((e) => e.kind === "thinking").text,
    /unavailable/i,
  );
  assert.equal(s.stats.inputTokens, 5);
  assert.equal(s.stats.outputTokens, 9);
});

test("AskUserQuestion keeps choices and structured answers", () => {
  const question = "Which output formats?";
  const rows = [
    {
      type: "assistant",
      sessionId: "questions",
      message: {
        content: [
          {
            type: "tool_use",
            id: "ask-1",
            name: "AskUserQuestion",
            input: {
              questions: [
                {
                  header: "Formats",
                  question,
                  multiSelect: true,
                  options: [
                    { label: "JSON", description: "Machine readable" },
                    { label: "Markdown", description: "Human readable" },
                  ],
                },
              ],
            },
          },
        ],
      },
    },
    {
      type: "user",
      sessionId: "questions",
      toolUseResult: {
        questions: [
          {
            header: "Formats",
            question,
            multiSelect: true,
            options: [
              { label: "JSON", description: "Machine readable" },
              { label: "Markdown", description: "Human readable" },
            ],
          },
        ],
        answers: { [question]: "JSON, Markdown" },
        annotations: { [question]: { note: "Both are useful" } },
      },
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "ask-1",
            content: "Questions answered",
          },
        ],
      },
    },
  ];
  const tool = P.buildWorkspace([
    P.parseJSONL(rows.map(JSON.stringify).join("\n"), "questions.jsonl"),
  ]).sessions[0].events.find((event) => event.kind === "tool").tool;
  assert.equal(tool.questionInteraction.state, "answered");
  assert.equal(tool.questionInteraction.questions[0].answer, "JSON, Markdown");
  assert.deepEqual(
    tool.questionInteraction.questions[0].options.map(
      (option) => option.selected,
    ),
    [true, true],
  );
  assert.deepEqual(tool.questionInteraction.questions[0].annotation, {
    note: "Both are useful",
  });
});

test("AskUserQuestion records rejection and preserves unanswered question", () => {
  const rows = [
    {
      type: "assistant",
      sessionId: "questions",
      message: {
        content: [
          {
            type: "tool_use",
            id: "ask-2",
            name: "AskUserQuestion",
            input: {
              questions: [
                {
                  header: "Scope",
                  question: "What should change?",
                  multiSelect: false,
                  options: [{ label: "Parser", description: "Parsing only" }],
                },
              ],
            },
          },
        ],
      },
    },
    {
      type: "user",
      sessionId: "questions",
      toolUseResult: "Error: user wants to clarify these questions",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "ask-2",
            content: "The user doesn't want to proceed; clarify the question.",
            is_error: true,
          },
        ],
      },
    },
  ];
  const event = P.buildWorkspace([
    P.parseJSONL(rows.map(JSON.stringify).join("\n"), "questions.jsonl"),
  ]).sessions[0].events.find((item) => item.kind === "tool");
  assert.equal(event.tool.questionInteraction.state, "rejected");
  assert.equal(event.tool.questionInteraction.questions[0].answer, null);
  assert.equal(event.isError, true);
});

test("metadata users and unknown records remain system; memory links only explicitly", () => {
  const p = P.parseJSONL(
    [
      JSON.stringify({
        type: "user",
        sessionId: "s",
        isMeta: true,
        message: { content: "meta" },
      }),
      JSON.stringify({ type: "future", sessionId: "s", value: 1 }),
    ].join("\n"),
    "x",
  );
  const linked = P.parseMemory("---\noriginSessionId: s\n---\na", "a.md"),
    loose = P.parseMemory("b", "b.md");
  const w = P.buildWorkspace([p], [linked, loose]);
  assert.equal(w.sessions[0].platform, "Claude Code");
  assert.deepEqual(
    w.sessions[0].events.map((e) => e.kind),
    ["system", "system"],
  );
  assert.deepEqual(w.sessions[0].memories, [linked]);
  assert.equal(w.memories.length, 2);
});

test("file session fallback, duplicate/empty tool ids, and malicious YAML are safe", () => {
  const p = P.parseJSONL(
    [
      JSON.stringify({ type: "file-history-snapshot" }),
      JSON.stringify({
        type: "system",
        sessionId: "real",
        subtype: "model_refusal_fallback",
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "real",
        message: {
          content: [
            { type: "tool_use", id: "", name: "A" },
            { type: "tool_use", id: "same", name: "B" },
            { type: "tool_use", id: "same", name: "C" },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "real",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "same", content: "one" },
            { type: "tool_result", tool_use_id: "same", content: "two" },
          ],
        },
      }),
    ].join("\n"),
    "renamed.jsonl",
  );
  const w = P.buildWorkspace([p]);
  assert.equal(w.sessions.length, 1);
  assert.equal(w.sessions[0].id, "real");
  assert.equal(w.sessions[0].stats.errors, 1);
  const tools = w.sessions[0].events.filter((e) => e.kind === "tool");
  assert.equal(tools[0].tool.status, "pending");
  assert.deepEqual(
    tools.slice(1).map((e) => e.tool.result),
    ["one", "two"],
  );
  const m = P.parseMemory(
    "---\n__proto__:\n  polluted: yes\nconstructor: no\noriginSessionId: safe\n---\nx",
    "x.md",
  );
  assert.equal(m.originSessionId, "safe");
  assert.equal({}.polluted, undefined);
});

test("result timestamp extends range, usage is once per record, and file agent is inferred", () => {
  const rows = [
    {
      type: "assistant",
      sessionId: "s",
      agentId: "worker",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        usage: { input_tokens: 7, output_tokens: 3 },
        content: [
          { type: "tool_use", id: "t", name: "Work", input: {} },
          { type: "text", text: "working" },
        ],
      },
    },
    {
      type: "user",
      sessionId: "s",
      timestamp: "2026-01-01T00:02:00Z",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t", content: "done" }],
      },
    },
    {
      type: "user",
      sessionId: "s",
      timestamp: "2026-01-01T00:01:00Z",
      message: { content: "continue" },
    },
  ];
  const s = P.buildWorkspace([
    P.parseJSONL(rows.map(JSON.stringify).join("\n"), "renamed.jsonl"),
  ]).sessions[0];
  assert.equal(s.endTime, "2026-01-01T00:02:00Z");
  assert.equal(s.stats.inputTokens, 7);
  assert.equal(s.stats.outputTokens, 3);
  assert.deepEqual(s.agents, ["worker"]);
  assert.equal(s.events.find((e) => e.kind === "prompt").title, "Agent prompt");
});

test("later explicit worker in a mixed main file does not relabel main records", () => {
  const rows = [
    { type: "user", sessionId: "s", message: { content: "main before" } },
    {
      type: "assistant",
      sessionId: "s",
      agentId: "worker",
      message: { content: [{ type: "text", text: "worker" }] },
    },
    { type: "user", sessionId: "s", message: { content: "main after" } },
  ];
  const events = P.buildWorkspace([
    P.parseJSONL(rows.map(JSON.stringify).join("\n"), "session.jsonl"),
  ]).sessions[0].events;
  assert.deepEqual(
    events.map((e) => e.agentId),
    ["main", "worker", "main"],
  );
  assert.equal(events[0].title, "Human prompt");
  assert.equal(events[2].title, "Human prompt");
});

test("named agent sources inherit the explicit identifier and unknown fields are searchable", () => {
  const rows = [
    {
      type: "assistant",
      sessionId: "s",
      agentId: "worker",
      message: {
        content: [{ type: "tool_use", id: "t", name: "Read", input: {} }],
      },
    },
    {
      type: "user",
      sessionId: "s",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t", content: "done" }],
      },
    },
    { type: "future", sessionId: "s", payload: "searchable detail" },
  ];
  const s = P.buildWorkspace([
    P.parseJSONL(
      rows.map(JSON.stringify).join("\n"),
      "s/subagents/agent-worker.jsonl",
    ),
  ]).sessions[0];
  assert.deepEqual(s.agents, ["worker"]);
  assert.equal(s.events.find((e) => e.kind === "tool").tool.status, "success");
  assert.match(
    s.events.find((e) => e.kind === "system").text,
    /searchable detail/,
  );
});

test("Codex rollouts normalize completed items, merge agents, and enrich from auxiliary files", () => {
  const question = "Continue with this plan?";
  const mainRows = [
    {
      type: "session_meta",
      timestamp: "2026-09-01T00:00:00.000Z",
      payload: {
        id: "root-thread",
        session_id: "root-thread",
        timestamp: "2026-09-01T00:00:00.000Z",
        cwd: "/workspace/project",
      },
    },
    {
      type: "turn_context",
      payload: { model: "codex-test", cwd: "/workspace/project" },
    },
    { type: "token_usage_record", payload: {
      session_id: "root-thread",
      thread_id: "root-thread",
      turn_id: "turn-1",
      thread_token_usage: {
        input_tokens: 15,
        cached_input_tokens: 4,
        cache_write_input_tokens: 2,
        output_tokens: 8,
      },
    } },
    {
      type: "event_msg",
      timestamp: "2026-09-01T00:01:00.000Z",
      payload: {
        type: "item_completed",
        item: { type: "UserMessage", id: "user-1", content: [{ type: "text", text: "hello" }] },
      },
    },
    {
      type: "event_msg",
      timestamp: "2026-09-01T00:01:01.000Z",
      payload: {
        type: "item_completed",
        item: { type: "Reasoning", id: "reason-1", summary_text: ["Planning carefully"] },
      },
    },
    {
      type: "response_item",
      timestamp: "2026-09-01T00:01:02.000Z",
      payload: { type: "agent_message", id: "assistant-1", content: [{ type: "output_text", text: "I can help." }] },
    },
    {
      type: "event_msg",
      timestamp: "2026-09-01T00:01:02.000Z",
      payload: {
        type: "item_completed",
        item: { type: "AgentMessage", id: "assistant-1", content: [{ type: "Text", text: "I can help." }] },
      },
    },
    {
      type: "event_msg",
      timestamp: "2026-09-01T00:01:03.000Z",
      payload: {
        type: "item_completed",
        item: {
          type: "CommandExecution",
          id: "command-1",
          command: ["node", "--version"],
          cwd: "/workspace/project",
          status: "completed",
          exit_code: 0,
          aggregated_output: "v22.0.0",
          duration: { secs: 0, nanos: 25000000 },
        },
      },
    },
    {
      type: "event_msg",
      timestamp: "2026-09-01T00:01:04.000Z",
      payload: {
        type: "item_completed",
        item: { type: "FileChange", id: "files-1", status: "completed", changes: { "src/app.js": { type: "update", content: "updated" } } },
      },
    },
    {
      type: "event_msg",
      timestamp: "2026-09-01T00:01:05.000Z",
      payload: {
        type: "item_completed",
        item: { type: "McpToolCall", id: "mcp-1", server: "docs", tool: "search", arguments: { query: "Codex" }, status: "failed", result: { isError: true, content: [{ type: "text", text: "unavailable" }] } },
      },
    },
    {
      type: "event_msg",
      timestamp: "2026-09-01T00:01:06.000Z",
      payload: {
        type: "item_completed",
        item: { type: "Extension", id: "extension-1", kind: "web.search", query: "Codex compatibility", results: ["result"], status: "completed" },
      },
    },
    {
      type: "event_msg",
      timestamp: "2026-09-01T00:01:07.000Z",
      payload: {
        type: "item_completed",
        item: { type: "ImageView", id: "image-1", path: "images/diagram.png" },
      },
    },
    {
      type: "response_item",
      timestamp: "2026-09-01T00:01:08.000Z",
      payload: { type: "function_call", id: "spawn-1", call_id: "spawn-call", name: "spawn_agent", arguments: JSON.stringify({ task_name: "reviewer" }) },
    },
    {
      type: "response_item",
      timestamp: "2026-09-01T00:01:08.500Z",
      payload: { type: "function_call_output", call_id: "spawn-call", output: "Started reviewer" },
    },
    {
      type: "event_msg",
      timestamp: "2026-09-01T00:01:08.500Z",
      payload: {
        type: "item_completed",
        item: { type: "SubAgentActivity", id: "spawn-call", agent_thread_id: "review-thread", agent_path: "reviewer", kind: "started" },
      },
    },
    {
      type: "response_item",
      timestamp: "2026-09-01T00:01:09.000Z",
      payload: { type: "function_call", id: "ask-1", call_id: "ask-call", name: "request_user_input_async", arguments: JSON.stringify({ questions: [{ header: "Plan", question, multiSelect: false, options: [{ label: "Proceed", description: "Continue" }] }] }) },
    },
    {
      type: "response_item",
      timestamp: "2026-09-01T00:01:10.000Z",
      payload: { type: "function_call_output", call_id: "ask-call", output: JSON.stringify({ questions: [{ header: "Plan", question, multiSelect: false, options: [{ label: "Proceed", description: "Continue" }] }], answers: { [question]: "Proceed" } }) },
    },
    {
      type: "event_msg",
      timestamp: "2026-09-01T00:01:11.000Z",
      payload: { type: "item_completed", item: { type: "ContextCompaction", id: "compact-1" } },
    },
    {
      type: "compacted",
      timestamp: "2026-09-01T00:01:12.000Z",
      payload: { message: "Older context summarized", window_number: 2 },
    },
    {
      type: "event_msg",
      timestamp: "2026-09-01T00:01:13.000Z",
      payload: {
        type: "item_completed",
        item: { type: "FutureCodexItem", id: "future-1", detail: "kept" },
      },
    },
    {
      type: "response_item",
      payload: { type: "custom_tool_call", id: "low-level-1", call_id: "low-call", name: "exec", input: "{\"cmd\":\"node --version\"}" },
    },
  ];
  const childRows = [
    {
      type: "session_meta",
      timestamp: "2026-09-01T00:01:20.000Z",
      payload: {
        id: "review-thread",
        session_id: "root-thread",
        parent_thread_id: "root-thread",
        agent_nickname: "Reviewer",
        agent_path: "agents/reviewer.md",
        cwd: "/workspace/project",
      },
    },
    { type: "turn_context", payload: { model: "codex-review" } },
    {
      type: "event_msg",
      timestamp: "2026-09-01T00:01:21.000Z",
      payload: { type: "item_completed", item: { type: "AgentMessage", id: "review-message", content: [{ type: "Text", text: "Review complete." }] } },
    },
    { type: "token_usage_record", payload: {
      session_id: "root-thread",
      thread_id: "review-thread",
      turn_id: "review-turn",
      thread_token_usage: { input_tokens: 5, cached_input_tokens: 1, cache_write_input_tokens: 1, output_tokens: 5 },
    } },
  ];
  const historyRows = [
    { session_id: "root-thread", text: "hello", ts: 1788220860000 },
    { session_id: "root-thread", text: "history-only prompt", ts: 1788220861000 },
  ];
  const indexRows = [
    { id: "root-thread", thread_name: "Indexed title", updated_at: "2026-09-01T00:02:00.000Z" },
  ];
  const files = [
    [mainRows, "rollout-main.jsonl"],
    [childRows, "rollout-child.jsonl"],
    [historyRows, "history.jsonl"],
    [indexRows, "session_index.jsonl"],
  ].map(([rows, source]) => P.parseJSONL(rows.map(JSON.stringify).join("\n"), source));
  const workspace = P.buildWorkspace(files),
    session = workspace.sessions.find((item) => item.id === "root-thread");
  assert.equal(workspace.sessions.length, 1);
  assert.equal(session.platform, "Codex");
  assert.equal(session.title, "Indexed title");
  assert.equal(session.cwd, "/workspace/project");
  assert.deepEqual(session.agents, ["main", "Reviewer"]);
  assert.ok(session.models.includes("codex-test"));
  assert.ok(session.models.includes("codex-review"));
  assert.equal(session.stats.prompts, 2);
  assert.equal(session.stats.inputTokens, 20);
  assert.equal(session.stats.outputTokens, 13);
  assert.equal(session.stats.cacheReadTokens, 5);
  assert.equal(session.stats.cacheWriteTokens, 3);
  assert.ok(session.events.some((event) => event.text === "history-only prompt"));
  assert.equal(session.events.filter((event) => event.text === "I can help.").length, 1);
  assert.ok(session.events.some((event) => event.kind === "thinking" && /Planning carefully/.test(event.text)));
  const command = session.events.find((event) => event.tool && event.tool.name === "Command");
  assert.equal(command.tool.status, "success");
  assert.equal(command.tool.result, "v22.0.0");
  assert.equal(command.tool.durationMs, 25);
  assert.equal(command.model, "codex-test");
  assert.ok(session.events.some((event) => event.tool && event.tool.name === "File change" && /src\/app\.js/.test(event.text)));
  assert.ok(session.events.some((event) => event.tool && event.tool.name === "docs/search" && event.tool.status === "error"));
  assert.ok(session.events.some((event) => event.tool && event.tool.name === "web.search"));
  assert.ok(session.events.some((event) => event.tool && event.tool.name === "Image view"));
  assert.equal(session.events.filter((event) => event.tool && event.tool.name === "spawn_agent").length, 1);
  assert.equal(session.events.filter((event) => /Sub-agent started/.test(event.title)).length, 0);
  const questionTool = session.events.find((event) => event.tool && event.tool.name === "request_user_input_async").tool;
  assert.equal(questionTool.questionInteraction.state, "answered");
  assert.equal(questionTool.questionInteraction.questions[0].answer, "Proceed");
  assert.ok(session.events.some((event) => event.title === "Context compacted"));
  assert.ok(session.events.some((event) => event.title === "Codex session metadata"));
  assert.ok(session.events.some((event) => event.title === "Turn context"));
  assert.ok(
    session.events.some(
      (event) => event.kind === "system" && event.title === "FutureCodexItem",
    ),
  );
  assert.ok(!session.events.some((event) => event.raw.type === "response_item" && event.raw.payload.type === "custom_tool_call"));
  assert.equal(
    session.events.find(
      (event) => event.agentId === "Reviewer" && event.kind === "assistant",
    ).model,
    "codex-review",
  );
});

test("Codex history remains useful without rollout files", () => {
  const history = P.parseJSONL(
      JSON.stringify({ session_id: "history-only", text: "saved prompt", ts: 1788220860 }),
      "history.jsonl",
    ),
    index = P.parseJSONL(
      JSON.stringify({ id: "history-only", thread_name: "Saved thread" }),
      "session_index.jsonl",
    ),
    workspace = P.buildWorkspace([index, history]),
    session = workspace.sessions[0];
  assert.equal(workspace.sessions.length, 1);
  assert.equal(session.platform, "Codex");
  assert.equal(session.title, "Saved thread");
  assert.equal(session.events[0].kind, "prompt");
  assert.equal(session.events[0].timestamp, "2026-09-01T00:01:00.000Z");
});

test(
  "real Codex fixtures normalize canonical items and suppress duplicate response records",
  { skip: !process.env.CODEX_SESSION_FIXTURES },
  () => {
    const root = path.resolve(process.env.CODEX_SESSION_FIXTURES),
      files = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name.endsWith(".jsonl")) files.push(file);
      }
    }
    if (fs.existsSync(root)) walk(root);
    const parsed = files.map((file) =>
      P.parseJSONL(fs.readFileSync(file, "utf8"), path.relative(root, file)),
    );
    const workspace = P.buildWorkspace(parsed),
      codexItems = parsed.reduce(
        (count, file) =>
          count +
          file.records.filter((record) => {
            const raw = record.raw,
              payload = raw.payload || {};
            return (
              raw.type === "event_msg" &&
              payload.type === "item_completed" &&
              payload.item &&
              [
                "UserMessage",
                "AgentMessage",
                "Reasoning",
                "CommandExecution",
                "FileChange",
                "McpToolCall",
                "Extension",
                "ImageView",
                "SubAgentActivity",
                "ContextCompaction",
              ].includes(payload.item.type)
            );
          }).length,
        0,
      );
    assert.ok(files.length > 0);
    assert.ok(codexItems > 0);
    assert.ok(workspace.sessions.length > 0);
    const represented = new Set();
    for (const session of workspace.sessions) {
      assert.equal(session.stats.events, session.events.length);
      for (const event of session.events) {
        represented.add(event.source + ":" + event.line);
        assert.ok(event.sessionId);
        assert.ok(event.agentId);
      }
    }
    for (const file of parsed) {
      for (const record of file.records) {
        const raw = record.raw,
          item = raw.payload && raw.payload.item,
          isCanonical =
            raw.type === "event_msg" &&
            raw.payload.type === "item_completed" &&
            item &&
            [
              "UserMessage",
              "AgentMessage",
              "Reasoning",
              "CommandExecution",
              "FileChange",
              "McpToolCall",
              "Extension",
              "ImageView",
              "ContextCompaction",
            ].includes(item.type);
        if (isCanonical)
          assert.ok(
            represented.has(file.source + ":" + record.line),
            "Canonical Codex items should remain visible",
          );
      }
    }
    assert.equal(workspace.warnings.length, 0);
  },
);

test(
  "real fixtures parse in aggregate without dropping valid records",
  { skip: !process.env.CLAUDE_SESSION_FIXTURES },
  () => {
    const roots = [path.resolve(process.env.CLAUDE_SESSION_FIXTURES)];
    const files = [];
    function walk(d) {
      for (const n of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, n.name);
        if (n.isDirectory()) walk(p);
        else if (n.name.endsWith(".jsonl")) files.push(p);
      }
    }
    roots.filter(fs.existsSync).forEach(walk);
    const parsed = files.map((f) =>
      P.parseJSONL(
        fs.readFileSync(f, "utf8"),
        path.relative(path.dirname(roots[0]), f),
      ),
    );
    const valid = parsed.reduce((n, p) => n + p.records.length, 0),
      w = P.buildWorkspace(parsed);
    assert.ok(files.length > 0);
    assert.ok(valid > 0);
    assert.ok(w.sessions.length > 0);
    const represented = new Set();
    for (const s of w.sessions)
      for (const e of s.events) {
        represented.add(e.source + ":" + e.line);
        if (e.tool && e.tool.resultRaw)
          represented.add(e.tool.resultSource + ":" + e.tool.resultLine);
      }
    for (const p of parsed)
      for (const record of p.records)
        assert.ok(
          represented.has(p.source + ":" + record.line),
          "Source record must remain accessible",
        );
    assert.equal(w.warnings.length, 0);
    assert.ok(w.sessions.every((s) => s.stats.events === s.events.length));
  },
);
