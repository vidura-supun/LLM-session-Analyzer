/* Fictional, deliberately small demo for offline UI review. */
(function () {
  "use strict";
  const j = (x) => JSON.stringify(x);
  const records = [
    {
      type: "session_start",
      sessionId: "demo-session-01",
      cwd: "/fictional/harbor-notes",
      branch: "main",
      model: "claude-sonnet-demo",
      timestamp: "2026-09-18T08:01:00Z",
    },
    {
      type: "user",
      sessionId: "demo-session-01",
      uuid: "d-p1",
      timestamp: "2026-09-18T08:01:07Z",
      message: {
        role: "user",
        content:
          "Sketch a calm information architecture for a harbor field-notes app.",
      },
    },
    {
      type: "assistant",
      sessionId: "demo-session-01",
      uuid: "d-a1",
      timestamp: "2026-09-18T08:01:16Z",
      message: {
        id: "m-a1",
        role: "assistant",
        model: "claude-sonnet-demo",
        content: [
          {
            type: "thinking",
            thinking:
              "I will keep the primary path small: capture, browse, and connect.",
          },
          {
            type: "text",
            text: "I suggest three surfaces: Capture, Atlas, and Threads.",
          },
        ],
        usage: { input_tokens: 118, output_tokens: 42 },
      },
    },
    {
      type: "assistant",
      sessionId: "demo-session-01",
      uuid: "d-t1",
      timestamp: "2026-09-18T08:01:25Z",
      message: {
        id: "m-t1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Write",
            input: { path: "notes/ia.md", content: "# Harbor notes\n" },
          },
        ],
        usage: { input_tokens: 119, output_tokens: 20 },
      },
    },
    {
      type: "user",
      sessionId: "demo-session-01",
      uuid: "d-r1",
      timestamp: "2026-09-18T08:01:26Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "Wrote 20 bytes",
            is_error: false,
          },
        ],
      },
    },
    {
      type: "user",
      sessionId: "demo-session-01",
      uuid: "d-p2",
      timestamp: "2026-09-18T08:02:00Z",
      message: {
        role: "user",
        content:
          "Can you check the generated note and ask the research agent for a second opinion?",
      },
    },
    {
      type: "assistant",
      sessionId: "demo-session-01",
      agentId: "agent-research",
      uuid: "d-a2",
      timestamp: "2026-09-18T08:02:19Z",
      message: {
        id: "m-a2",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "The research agent found two useful distinctions: tide and weather should be separate facets.",
          },
        ],
        usage: { input_tokens: 40, output_tokens: 31 },
      },
    },
    {
      type: "assistant",
      sessionId: "demo-session-01",
      uuid: "d-t2",
      timestamp: "2026-09-18T08:02:32Z",
      message: {
        id: "m-t2",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-2",
            name: "Read",
            input: { path: "notes/missing.md" },
          },
        ],
      },
    },
    {
      type: "user",
      sessionId: "demo-session-01",
      uuid: "d-r2",
      timestamp: "2026-09-18T08:02:33Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-2",
            content: "No such file",
            is_error: true,
          },
        ],
      },
    },
    {
      type: "assistant",
      sessionId: "demo-session-01",
      uuid: "d-a3",
      timestamp: "2026-09-18T08:03:00Z",
      message: {
        id: "m-a3",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "I could not find that note, so I left the source untouched. The structure above is ready for a prototype.",
          },
        ],
        usage: { input_tokens: 22, output_tokens: 28 },
      },
    },
    {
      type: "assistant",
      sessionId: "demo-session-01",
      uuid: "d-t3",
      timestamp: "2026-09-18T08:03:10Z",
      message: {
        id: "m-t3",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-3",
            name: "Bash",
            input: { command: "deploy harbor-notes" },
          },
        ],
      },
    },
    {
      type: "user",
      sessionId: "demo-session-01",
      uuid: "d-p3",
      timestamp: "2026-09-18T08:03:11Z",
      message: { role: "user", content: "Hold there for now." },
    },
  ];
  const memory = `---\nname: Harbor field notes\ndescription: A fictional working memory for the demo\noriginSessionId: demo-session-01\n---\nKeep the harbor vocabulary concrete: tide, weather, vessel, and thread. This is a current context note, not proof of historical presence.`;
  window.LLMSessionAnalyzerDemo = {
    sessionId: "demo-session-01",
    sources: () => [
      {
        source: "fictional-demo.jsonl",
        parsed: window.SessionParser.parseJSONL(
          records.map(j).join("\n"),
          "fictional-demo.jsonl",
        ),
      },
      {
        source: "fictional-memory.md",
        memory: window.SessionParser.parseMemory(memory, "fictional-memory.md"),
      },
    ],
  };
})();
