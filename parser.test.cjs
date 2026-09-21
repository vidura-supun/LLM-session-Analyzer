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
