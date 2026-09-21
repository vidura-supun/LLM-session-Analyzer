(function (root, factory) {
  var api = factory();
  root.SessionParser = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function object(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }
  function string(v) {
    return v == null
      ? ""
      : typeof v === "string"
        ? v
        : JSON.stringify(v, null, 2);
  }
  function number(v) {
    v = Number(v);
    return Number.isFinite(v) ? v : 0;
  }
  function basename(path) {
    return String(path || "import")
      .replace(/\\/g, "/")
      .split("/")
      .pop();
  }
  function fileSession(path) {
    var b = basename(path).replace(/\.jsonl$/i, "");
    if (/^agent-/i.test(b)) {
      var parts = String(path).replace(/\\/g, "/").split("/");
      var at = parts.lastIndexOf("subagents");
      if (at > 0) return parts[at - 1];
    }
    return b || "unknown-session";
  }
  function inferredAgent(path) {
    var m = basename(path).match(/^(agent-[^.]+)\.jsonl$/i);
    return m ? m[1] : "main";
  }
  function parseJSONL(text, sourceName) {
    text = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    var source = String(sourceName || "import.jsonl");
    var lines = text.split(/\r?\n/),
      records = [],
      warnings = [];
    lines.forEach(function (line, i) {
      if (!line.trim()) return;
      try {
        var raw = JSON.parse(line);
        if (!object(raw)) throw new Error("JSON value is not an object");
        records.push({ raw: raw, line: i + 1 });
      } catch (e) {
        warnings.push({
          source: source,
          line: i + 1,
          message: e.message || "Malformed JSON",
        });
      }
    });
    return {
      source: source,
      records: records,
      warnings: warnings,
      totalLines: lines.length,
    };
  }

  function yamlScalar(s) {
    s = s.trim();
    if (
      (s[0] === '"' && s[s.length - 1] === '"') ||
      (s[0] === "'" && s[s.length - 1] === "'")
    )
      return s.slice(1, -1);
    if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
    if (/^(null|~)$/i.test(s)) return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  }
  function parseMemory(text, sourceName) {
    text = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    var source = String(sourceName || "memory.md"),
      metadata = Object.create(null),
      body = text;
    var m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
    if (m) {
      var stack = [{ indent: -1, value: metadata }];
      m[1].split(/\r?\n/).forEach(function (line) {
        if (!line.trim() || /^\s*#/.test(line)) return;
        var x = line.match(/^(\s*)([^:#][^:]*):(?:\s*(.*))?$/);
        if (!x) return;
        var indent = x[1].length,
          key = x[2].trim(),
          rest = x[3] || "";
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent)
          stack.pop();
        if (key === "__proto__" || key === "prototype" || key === "constructor")
          return;
        var parent = stack[stack.length - 1].value;
        if (!rest.trim()) {
          parent[key] = Object.create(null);
          stack.push({ indent: indent, value: parent[key] });
        } else parent[key] = yamlScalar(rest);
      });
      body = text.slice(m[0].length);
    }
    function deepFind(o, wanted) {
      if (!object(o)) return "";
      var keys = Object.keys(o);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k.toLowerCase() === wanted.toLowerCase() && o[k] != null)
          return String(o[k]);
      }
      for (var j = 0; j < keys.length; j++) {
        var found = deepFind(o[keys[j]], wanted);
        if (found) return found;
      }
      return "";
    }
    var name =
      deepFind(metadata, "name") || basename(source).replace(/\.md$/i, "");
    return {
      id: deepFind(metadata, "id") || source,
      source: source,
      name: name,
      description: deepFind(metadata, "description"),
      originSessionId: deepFind(metadata, "originSessionId"),
      content: text,
      body: body,
      metadata: metadata,
    };
  }

  function contentBlocks(raw) {
    var c = object(raw.message) ? raw.message.content : raw.content;
    if (Array.isArray(c)) return c.length ? c : [{ type: "text", text: "" }];
    if (c !== undefined) return [{ type: "text", text: string(c) }];
    return [];
  }
  function titleFor(kind, raw, block) {
    if (kind === "tool") return block.name || "Tool call";
    if (kind === "result") return "Tool result";
    if (kind === "thinking")
      return block.thinking ? "Thinking" : "Thinking unavailable";
    if (kind === "prompt") return "Human prompt";
    if (kind === "assistant") return "Assistant";
    return raw.subtype || raw.type || "System";
  }
  function eventText(block, raw, kind) {
    if (kind === "thinking")
      return (
        block.thinking || "Thinking unavailable (redacted or not recorded)."
      );
    if (block.text !== undefined) return string(block.text);
    if (block.content !== undefined) return string(block.content);
    if (raw.content !== undefined) return string(raw.content);
    if (raw.attachment !== undefined) return string(raw.attachment);
    if (raw.lastPrompt !== undefined) return string(raw.lastPrompt);
    if (raw.aiTitle !== undefined) return string(raw.aiTitle);
    if (raw.agentName !== undefined) return string(raw.agentName);
    if (raw.operation !== undefined) return string(raw.operation);
    if (raw.message && typeof raw.message === "string") return raw.message;
    return kind === "system" ? string(raw) : "";
  }
  function questionList(input) {
    if (!object(input) || !Array.isArray(input.questions)) return [];
    return input.questions.filter(object).map(function (question) {
      return {
        header: string(question.header),
        question: string(question.question),
        multiSelect: !!question.multiSelect,
        options: (Array.isArray(question.options) ? question.options : [])
          .filter(object)
          .map(function (option) {
            return {
              label: string(option.label),
              description: string(option.description),
              preview: string(option.preview),
              selected: false,
            };
          }),
        answer: null,
        annotation: null,
      };
    });
  }
  function questionInteraction(input) {
    var questions = questionList(input);
    return questions.length
      ? { state: "pending", questions: questions, answers: {} }
      : null;
  }
  function applyQuestionResult(tool, raw, isError) {
    if (!tool.questionInteraction) return;
    var structured = object(raw.toolUseResult) ? raw.toolUseResult : null,
      resultQuestions = structured && questionList(structured),
      questions =
        resultQuestions && resultQuestions.length
          ? resultQuestions
          : tool.questionInteraction.questions,
      answers =
        structured && object(structured.answers)
          ? structured.answers
          : Object.create(null),
      annotations =
        structured && object(structured.annotations)
          ? structured.annotations
          : Object.create(null),
      answered = 0;
    questions.forEach(function (question) {
      if (Object.prototype.hasOwnProperty.call(answers, question.question)) {
        question.answer = answers[question.question];
        answered++;
      }
      if (Object.prototype.hasOwnProperty.call(annotations, question.question))
        question.annotation = annotations[question.question];
      var answerValues = [];
      if (Array.isArray(question.answer))
        answerValues = question.answer.map(String);
      else if (typeof question.answer === "string") {
        var exactOption = question.options.some(function (option) {
          return option.label === question.answer;
        });
        answerValues = exactOption
          ? [question.answer]
          : question.multiSelect
            ? question.answer.split(/,\s*/)
            : [question.answer];
      }
      question.options.forEach(function (option) {
        option.selected = answerValues.indexOf(option.label) >= 0;
      });
    });
    tool.questionInteraction.questions = questions;
    tool.questionInteraction.answers = answers;
    tool.questionInteraction.state = isError
      ? /clarif|doesn't want to proceed|rejected/i.test(tool.result)
        ? "rejected"
        : "error"
      : answered
        ? "answered"
        : "unanswered";
  }
  function codexPayload(raw) {
    return object(raw) && object(raw.payload) ? raw.payload : {};
  }
  function codexText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value))
      return value
        .map(function (part) {
          if (typeof part === "string") return part;
          if (!object(part)) return string(part);
          if (part.text !== undefined) return string(part.text);
          if (part.content !== undefined) return codexText(part.content);
          return "";
        })
        .filter(Boolean)
        .join("\n");
    if (object(value)) {
      if (value.text !== undefined) return string(value.text);
      if (value.content !== undefined) return codexText(value.content);
    }
    return string(value);
  }
  function codexJsonArgument(value) {
    if (typeof value !== "string") return object(value) ? value : {};
    try {
      var parsed = JSON.parse(value);
      return object(parsed) ? parsed : { value: parsed };
    } catch (_) {
      return { value: value };
    }
  }
  function codexToolStatus(status, isError) {
    var s = String(status || "").toLowerCase();
    if (isError || /fail|error|cancel|reject/.test(s)) return "error";
    if (/pending|running|in.progress|started/.test(s)) return "pending";
    return "success";
  }
  function codexTimestamp(value) {
    var n = number(value);
    if (!n) return null;
    if (Math.abs(n) < 1e12) n *= 1000;
    var d = new Date(n);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  function codexDurationMs(value) {
    if (typeof value === "number") return number(value) || null;
    if (!object(value)) return null;
    if (value.milliseconds != null) return number(value.milliseconds) || null;
    var milliseconds = number(value.secs) * 1000 + number(value.nanos) / 1e6;
    return milliseconds || null;
  }
  function codexAgentIdentity(meta) {
    if (!object(meta)) return "main";
    if (!meta.parent_thread_id && meta.id === meta.session_id) return "main";
    return String(
      meta.agent_nickname ||
        (meta.agent_path ? basename(meta.agent_path) : "") ||
        meta.id ||
        "agent",
    );
  }
  function buildWorkspace(parsedFiles, memories) {
    parsedFiles = Array.isArray(parsedFiles) ? parsedFiles : [];
    memories = Array.isArray(memories) ? memories : [];
    var warnings = [],
      sessions = new Map(),
      seq = 0,
      pendingResults = [],
      toolCalls = new Map(),
      codexUsages = new Map(),
      historyRows = [],
      indexRows = [];
    function session(id) {
      if (!sessions.has(id))
        sessions.set(id, {
          id: id,
          title: "",
          platform: "",
          cwd: "",
          branch: "",
          models: [],
          sources: [],
          events: [],
          agents: [],
          memories: [],
          stats: null,
          startTime: null,
          endTime: null,
          _titles: [],
          _times: [],
        });
      return sessions.get(id);
    }
    parsedFiles.forEach(function (pf, fileIndex) {
      if (!pf || !Array.isArray(pf.records)) return;
      if (Array.isArray(pf.warnings))
        warnings.push.apply(warnings, pf.warnings);
      var source = String(pf.source || "import.jsonl"),
        sourceAgent = inferredAgent(source);
      var sourceBase = basename(source).toLowerCase(),
        isHistory = sourceBase === "history.jsonl",
        isIndex = sourceBase === "session_index.jsonl",
        codexMeta = null,
        isCodex = false;
      pf.records.forEach(function (entry) {
        var raw = entry && entry.raw;
        if (!object(raw)) return;
        if (
          raw.type === "session_meta" ||
          raw.type === "event_msg" ||
          raw.type === "response_item" ||
          raw.type === "turn_context" ||
          raw.type === "token_usage_record" ||
          raw.type === "compacted"
        )
          isCodex = true;
        if (raw.type === "session_meta" && object(raw.payload) && !codexMeta)
          codexMeta = raw.payload;
      });
      if (isHistory || isIndex) {
        pf.records.forEach(function (entry) {
          if (!object(entry.raw)) return;
          (isHistory ? historyRows : indexRows).push({
            raw: entry.raw,
            source: source,
            line: entry.line,
          });
        });
        return;
      }
      var sourceSession = "",
        sourceHasAgentName = /^agent-[^.]+\.jsonl$/i.test(basename(source)),
        sawConversation = false;
      for (var sri = 0; sri < pf.records.length; sri++) {
        var srr = pf.records[sri].raw;
        if (!object(srr)) continue;
        if (!sourceSession && (srr.sessionId || srr.session_id))
          sourceSession = String(srr.sessionId || srr.session_id);
        if (
          !sourceSession &&
          srr.type === "session_meta" &&
          object(srr.payload) &&
          (srr.payload.session_id || srr.payload.id)
        )
          sourceSession = String(srr.payload.session_id || srr.payload.id);
        if (
          sourceHasAgentName &&
          !sawConversation &&
          (srr.agentId || srr.agent_id)
        ) {
          sourceAgent = String(srr.agentId || srr.agent_id);
          sawConversation = true;
        }
        if (
          !sourceHasAgentName &&
          !sawConversation &&
          (srr.type === "user" || srr.type === "assistant")
        ) {
          sawConversation = true;
          if (srr.agentId || srr.agent_id)
            sourceAgent = String(srr.agentId || srr.agent_id);
        }
      }
      if (isCodex) {
        if (codexMeta) {
          sourceSession = String(
            codexMeta.session_id || codexMeta.id || sourceSession || "",
          );
          sourceAgent = codexAgentIdentity(codexMeta);
        }
        if (!sourceSession) sourceSession = fileSession(source);
        if (!sourceAgent) sourceAgent = "main";
        var codexSession = session(sourceSession),
          codexAgent = sourceAgent,
          codexModel = "",
          codexCwd = (codexMeta && codexMeta.cwd) || "",
          canonicalItems = [],
          functionOutputs = new Map(),
          spawnCallIds = new Set();
        codexSession.platform = "Codex";
        if (codexSession.sources.indexOf(source) < 0)
          codexSession.sources.push(source);
        if (codexSession.agents.indexOf(codexAgent) < 0)
          codexSession.agents.push(codexAgent);
        if (!codexSession.cwd && codexCwd)
          codexSession.cwd = String(codexCwd);
        if (codexMeta && codexMeta.timestamp)
          codexSession._times.push({
            value: codexMeta.timestamp,
            ms: Date.parse(codexMeta.timestamp),
          });
        pf.records.forEach(function (entry) {
          var raw = entry.raw,
            payload = codexPayload(raw),
            item = object(payload.item) ? payload.item : null;
          if (
            raw.type === "event_msg" &&
            payload.type === "item_completed" &&
            item
          )
            canonicalItems.push(item);
          if (
            raw.type === "response_item" &&
            payload.type === "function_call_output" &&
            payload.call_id
          ) {
            var outputs = functionOutputs.get(String(payload.call_id)) || [];
            outputs.push(entry);
            functionOutputs.set(String(payload.call_id), outputs);
          }
          if (
            raw.type === "response_item" &&
            payload.type === "function_call" &&
            payload.name === "spawn_agent" &&
            payload.call_id
          )
            spawnCallIds.add(String(payload.call_id));
        });
        pf.records.forEach(function (entry) {
          var raw = entry.raw,
            line = entry.line,
            payload = codexPayload(raw),
            item = object(payload.item) ? payload.item : null,
            kind = "system",
            title = "Codex event",
            text = "",
            tool = null,
            timestamp = raw.timestamp || null,
            model = codexModel,
            eventAgent = codexAgent,
            eventError = false,
            recognizedSystem = false;
          if (!object(raw)) return;
          if (raw.type === "session_meta") {
            var meta = codexPayload(raw);
            if (meta.cwd && !codexSession.cwd)
              codexSession.cwd = String(meta.cwd);
            if (meta.timestamp && Number.isFinite(Date.parse(meta.timestamp)))
              codexSession._times.push({
                value: meta.timestamp,
                ms: Date.parse(meta.timestamp),
              });
            title = "Codex session metadata";
            text = [
              meta.originator && "Origin: " + meta.originator,
              meta.cli_version && "CLI: " + meta.cli_version,
              meta.thread_source && "Thread: " + meta.thread_source,
            ]
              .filter(Boolean)
              .join("\n");
            recognizedSystem = true;
          }
          if (raw.type === "turn_context") {
            var context = codexPayload(raw);
            if (context.model) {
              codexModel = String(context.model);
              if (codexSession.models.indexOf(codexModel) < 0)
                codexSession.models.push(codexModel);
              model = codexModel;
            }
            if (context.cwd) {
              codexCwd = String(context.cwd);
              if (!codexSession.cwd) codexSession.cwd = codexCwd;
            }
            title = "Turn context";
            text = [
              context.turn_id && "Turn: " + context.turn_id,
              context.model && "Model: " + context.model,
              context.effort && "Reasoning effort: " + context.effort,
              context.approval_policy &&
                "Approval policy: " + context.approval_policy,
            ]
              .filter(Boolean)
              .join("\n");
            recognizedSystem = true;
          }
          if (!recognizedSystem && raw.type === "token_usage_record") {
            var tokenPayload = codexPayload(raw),
              tokenValues = object(tokenPayload.thread_token_usage)
                ? tokenPayload.thread_token_usage
                : object(tokenPayload.turn_token_usage)
                  ? tokenPayload.turn_token_usage
                  : object(tokenPayload.usage)
                    ? tokenPayload.usage
                    : null;
            if (tokenValues) {
              var usageKey =
                  sourceSession + "\u0000" +
                  String(tokenPayload.thread_id || codexAgent) + "\u0000" +
                  (object(tokenPayload.thread_token_usage)
                    ? "thread"
                    : String(tokenPayload.turn_id || tokenPayload.response_id || line)),
                usage = codexUsages.get(usageKey) || {};
              [
                "input_tokens",
                "cached_input_tokens",
                "cache_write_input_tokens",
                "output_tokens",
              ].forEach(function (field) {
                usage[field] = Math.max(
                  number(usage[field]),
                  number(tokenValues[field]),
                );
              });
              codexUsages.set(usageKey, usage);
            }
            return;
          }
          if (recognizedSystem) {
            /* Session and turn metadata stay inspectable as hidden system events. */
          } else if (
            raw.type === "response_item" &&
            payload.type === "function_call_output"
          ) {
            return;
          } else if (
            raw.type === "response_item" &&
            payload.type === "function_call"
          ) {
            var args = codexJsonArgument(payload.arguments),
              callId = String(payload.call_id || payload.id || ""),
              outputEntry = (functionOutputs.get(callId) || []).shift(),
              outputRaw = outputEntry && outputEntry.raw,
              outputPayload = codexPayload(outputRaw),
              outputText = outputRaw ? codexText(outputPayload.output) : "",
              toolName = String(payload.name || "Function call");
            kind = "tool";
            title = toolName;
            text = "";
            tool = {
              id: callId,
              name: toolName,
              input: args,
              command: string(args.command || args.cmd || args.question || ""),
              status: outputRaw ? "success" : "pending",
              result: outputText,
              resultSource: outputEntry ? source : null,
              resultLine: outputEntry ? outputEntry.line : null,
              resultRaw: outputRaw || null,
              durationMs: null,
              questionInteraction:
                /request_user_input/i.test(toolName)
                  ? questionInteraction(args)
                  : null,
            };
            if (tool.questionInteraction) title = "Questions for user";
            if (outputRaw && tool.questionInteraction) {
              var structuredOutput = null;
              try {
                structuredOutput = JSON.parse(outputText);
              } catch (_) {}
              if (object(structuredOutput)) {
                applyQuestionResult(
                  tool,
                  { toolUseResult: structuredOutput },
                  false,
                );
              }
            }
            if (/spawn_agent/i.test(toolName) && callId)
              tool._codexSpawnCallId = callId;
          } else if (raw.type === "response_item" && payload.type === "agent_message") {
            var responseText = codexText(payload.content),
              duplicate = canonicalItems.some(function (canonical) {
                return (
                  (payload.id && canonical.id === payload.id) ||
                  (canonical.type === "AgentMessage" &&
                    codexText(canonical.content) === responseText)
                );
              });
            if (duplicate || !responseText) return;
            kind = "assistant";
            eventAgent = String(payload.author || codexAgent);
            title = payload.recipient
              ? "Agent message to " + String(payload.recipient)
              : "Assistant";
            text = responseText;
          } else if (raw.type === "event_msg" && item) {
            var itemType = String(item.type || "");
            if (itemType === "UserMessage") {
              kind = "prompt";
              title = codexAgent === "main" ? "Human prompt" : "Agent prompt";
              text = codexText(item.content);
            } else if (itemType === "AgentMessage") {
              kind = "assistant";
              title = "Assistant";
              text = codexText(item.content);
            } else if (itemType === "Reasoning") {
              kind = "thinking";
              title = "Thinking";
              text =
                codexText(item.summary_text) ||
                codexText(item.raw_content) ||
                "Thinking unavailable (redacted or not recorded).";
            } else if (itemType === "CommandExecution") {
              kind = "tool";
              title = "Command";
              var command = Array.isArray(item.command)
                  ? item.command.join(" ")
                  : string(item.command || ""),
                commandOutput =
                  item.aggregated_output ||
                  [item.stdout, item.stderr].filter(Boolean).join("\n") ||
                  item.formatted_output ||
                  "";
              text = command;
              tool = {
                id: String(item.id || ""),
                name: "Command",
                input: { command: item.command, cwd: item.cwd || codexCwd },
                command: command,
                status: codexToolStatus(
                  item.status,
                  number(item.exit_code) !== 0 && item.exit_code != null,
                ),
                result: codexText(commandOutput),
                resultSource: source,
                resultLine: line,
                resultRaw: raw,
                durationMs: codexDurationMs(item.duration),
                questionInteraction: null,
              };
            } else if (itemType === "FileChange") {
              kind = "tool";
              title = "File change";
              var changedPaths = object(item.changes)
                ? Object.keys(item.changes)
                : [];
              text = changedPaths.join("\n");
              tool = {
                id: String(item.id || ""),
                name: "File change",
                input: item.changes || {},
                command: changedPaths.join(", "),
                status: codexToolStatus(item.status, false),
                result: [item.stdout, item.stderr].filter(Boolean).join("\n"),
                resultSource: source,
                resultLine: line,
                resultRaw: raw,
                durationMs: null,
                questionInteraction: null,
              };
            } else if (itemType === "McpToolCall") {
              kind = "tool";
              var mcpName = [item.server, item.tool].filter(Boolean).join("/");
              title = mcpName || "MCP tool";
              text = codexText(item.arguments);
              tool = {
                id: String(item.id || ""),
                name: mcpName || "MCP tool",
                input: item.arguments || {},
                command: string(item.arguments || ""),
                status: codexToolStatus(
                  item.status,
                  !!(object(item.result) && item.result.isError),
                ),
                result: codexText(item.result),
                resultSource: source,
                resultLine: line,
                resultRaw: raw,
                durationMs: codexDurationMs(item.duration),
                questionInteraction: null,
              };
            } else if (itemType === "Extension") {
              kind = "tool";
              title = String(item.kind || "Extension");
              text = codexText(item.query || item.action || "");
              tool = {
                id: String(item.id || ""),
                name: title,
                input: item.query || item.action || {},
                command: string(item.query || ""),
                status: codexToolStatus(item.status, !!item.failure),
                result: codexText(item.results || item.result || item.failure),
                resultSource: source,
                resultLine: line,
                resultRaw: raw,
                durationMs: null,
                questionInteraction: null,
              };
            } else if (itemType === "ImageView") {
              kind = "tool";
              title = "Image view";
              text = string(item.path || "");
              tool = {
                id: String(item.id || ""),
                name: "Image view",
                input: { path: item.path || "" },
                command: String(item.path || ""),
                status: "success",
                result: String(item.path || ""),
                resultSource: source,
                resultLine: line,
                resultRaw: raw,
                durationMs: null,
                questionInteraction: null,
              };
            } else if (itemType === "SubAgentActivity") {
              if (spawnCallIds.has(String(item.id || ""))) return;
              kind = "system";
              title = "Sub-agent " + String(item.kind || "activity");
              text =
                String(item.agent_path || "") +
                (item.agent_thread_id ? " (" + item.agent_thread_id + ")" : "");
            } else if (itemType === "ContextCompaction") {
              kind = "system";
              title = "Context compacted";
              text = "Context compaction";
            } else {
              kind = "system";
              title = itemType || "Codex item";
              text = codexText(item);
            }
          } else if (raw.type === "compacted") {
            kind = "system";
            title = "Context compacted";
            text = codexText(payload.message) || "Context compacted";
          } else if (raw.type === "event_msg") {
            if (payload.type === "token_count") return;
            title = String(payload.type || "Codex event")
              .replace(/_/g, " ")
              .replace(/^./, function (letter) {
                return letter.toUpperCase();
              });
            text =
              codexText(payload.message || payload.last_agent_message) ||
              "Codex lifecycle event";
            eventError = /abort|fail|error/.test(
              String(payload.type || "").toLowerCase(),
            );
          } else if (raw.type === "world_state") {
            title = "World state";
            text = "Runtime state snapshot recorded";
          } else if (raw.type === "inter_agent_communication_metadata") {
            title = "Agent communication metadata";
            text = "Inter-agent communication metadata recorded";
          } else return;
          var event = {
            id: source + ":" + line + ":0",
            kind: kind,
            title: title,
            text: text,
            timestamp: timestamp,
            sessionId: sourceSession,
            agentId: eventAgent,
            source: source,
            line: line,
            uuid: (item && item.id) || payload.id || payload.call_id || null,
            parentUuid: null,
            model: model || null,
            isError: !!(
              eventError ||
              tool &&
              (tool.status === "error" ||
                (item && item.exit_code != null && number(item.exit_code) !== 0))
            ),
            raw: raw,
            _seq: seq++,
            _file: fileIndex,
          };
          if (tool) {
            if (tool._codexSpawnCallId) delete tool._codexSpawnCallId;
            event.tool = tool;
          }
          if (timestamp && Number.isFinite(Date.parse(timestamp)))
            codexSession._times.push({ value: timestamp, ms: Date.parse(timestamp) });
          codexSession.events.push(event);
        });
        return;
      }
      pf.records.forEach(function (entry) {
        var raw = entry.raw,
          line = entry.line;
        if (!object(raw)) return;
        var sid = String(
          raw.sessionId ||
            raw.session_id ||
            sourceSession ||
            fileSession(source),
        );
        var s = session(sid),
          agent = String(raw.agentId || raw.agent_id || sourceAgent || "main");
        if (!s.platform) s.platform = "Claude Code";
        if (s.sources.indexOf(source) < 0) s.sources.push(source);
        if (s.agents.indexOf(agent) < 0) s.agents.push(agent);
        if (!s.cwd && raw.cwd) s.cwd = String(raw.cwd);
        if (raw.gitBranch && !s.branch) s.branch = String(raw.gitBranch);
        if (raw.gitBranch && s.branch !== String(raw.gitBranch)) {
          /* branches remain on raw events */
        }
        if (raw.aiTitle) s._titles.push(String(raw.aiTitle));
        if (raw.timestamp && Number.isFinite(Date.parse(raw.timestamp)))
          s._times.push({
            value: raw.timestamp,
            ms: Date.parse(raw.timestamp),
          });
        var model =
          object(raw.message) && raw.message.model
            ? String(raw.message.model)
            : raw.model
              ? String(raw.model)
              : "";
        if (model && s.models.indexOf(model) < 0) s.models.push(model);
        var blocks = contentBlocks(raw),
          type = String(raw.type || "").toLowerCase();
        if (!blocks.length) blocks = [{}];
        blocks.forEach(function (block, bi) {
          if (!object(block)) block = { type: "text", text: string(block) };
          var bt = String(block.type || "").toLowerCase(),
            kind;
          if (bt === "tool_use") kind = "tool";
          else if (bt === "tool_result") kind = "result";
          else if (bt === "thinking" || bt === "redacted_thinking")
            kind = "thinking";
          else if (type === "user" && !raw.isMeta) kind = "prompt";
          else if (type === "assistant" && bt === "text") kind = "assistant";
          else if (type === "assistant" && (!bt || bt === "fallback"))
            kind = "system";
          else kind = "system";
          var ev = {
            id: source + ":" + line + ":" + bi,
            kind: kind,
            title: titleFor(kind, raw, block),
            text: eventText(block, raw, kind),
            timestamp:
              raw.timestamp ||
              (object(raw.message) ? raw.message.timestamp : null) ||
              null,
            sessionId: sid,
            agentId: agent,
            source: source,
            line: line,
            uuid: raw.uuid || null,
            parentUuid: raw.parentUuid || null,
            model: model || null,
            isError: !!(
              raw.error ||
              raw.isApiErrorMessage ||
              raw.subtype === "model_refusal_fallback" ||
              block.is_error
            ),
            raw: raw,
            _seq: seq++,
            _file: fileIndex,
          };
          if (type === "user" && agent !== "main")
            ev.title = raw.isMeta ? "Agent task" : "Agent prompt";
          if (kind === "tool") {
            var input = block.input == null ? {} : block.input;
            var command = object(input) ? input.command || input.cmd || "" : "";
            ev.tool = {
              id: String(block.id || ""),
              name: String(block.name || "Unknown tool"),
              input: input,
              command: string(command),
              status: "pending",
              result: "",
              resultSource: null,
              resultLine: null,
              resultRaw: null,
              durationMs: number(raw.durationMs) || null,
              questionInteraction:
                String(block.name || "").toLowerCase() === "askuserquestion"
                  ? questionInteraction(input)
                  : null,
            };
            if (ev.tool.questionInteraction) ev.title = "Questions for user";
            if (ev.tool.id) {
              var tk = sid + "\u0000" + agent + "\u0000" + ev.tool.id,
                tq = toolCalls.get(tk) || [];
              tq.push(ev);
              toolCalls.set(tk, tq);
            }
          }
          if (kind === "result")
            pendingResults.push({
              event: ev,
              toolId: String(
                block.tool_use_id ||
                  raw.tool_use_id ||
                  raw.sourceToolUseID ||
                  "",
              ),
              block: block,
            });
          s.events.push(ev);
        });
      });
    });
    var codexIndexTitles = new Map();
    indexRows.forEach(function (entry) {
      var raw = entry.raw,
        id = String(raw.id || ""),
        s = id && sessions.get(id);
      if (id && raw.thread_name)
        codexIndexTitles.set(id, String(raw.thread_name));
      if (!s) return;
      if (s.sources.indexOf(entry.source) < 0) s.sources.push(entry.source);
      if (raw.thread_name) s._indexTitle = String(raw.thread_name);
      if (raw.updated_at && Number.isFinite(Date.parse(raw.updated_at)))
        s._times.push({ value: raw.updated_at, ms: Date.parse(raw.updated_at) });
    });
    historyRows.forEach(function (entry) {
      var raw = entry.raw,
        id = String(raw.session_id || ""),
        s = id && sessions.get(id),
        text = typeof raw.text === "string" ? raw.text : "";
      if (!id || !text) return;
      if (!s) {
        s = session(id);
        s.platform = "Codex";
        s._indexTitle = codexIndexTitles.get(id) || "";
      }
      var alreadyPresent = s.events.some(function (event) {
        return event.kind === "prompt" && event.text === text;
      });
      if (alreadyPresent) return;
      var timestamp = codexTimestamp(raw.ts),
        historyFileIndex = parsedFiles.findIndex(function (pf) {
          return pf && pf.source === entry.source;
        }),
        event = {
          id: entry.source + ":" + entry.line + ":0",
          kind: "prompt",
          title: "Human prompt",
          text: text,
          timestamp: timestamp,
          sessionId: id,
          agentId: "main",
          source: entry.source,
          line: entry.line,
          uuid: null,
          parentUuid: null,
          model: null,
          isError: false,
          raw: raw,
          _seq: seq++,
          _file: historyFileIndex >= 0 ? historyFileIndex : 0,
        };
      if (s.sources.indexOf(entry.source) < 0) s.sources.push(entry.source);
      if (s.agents.indexOf("main") < 0) s.agents.push("main");
      if (timestamp)
        s._times.push({ value: timestamp, ms: Date.parse(timestamp) });
      s.events.push(event);
    });
    pendingResults.forEach(function (p) {
      var ev = p.event,
        key = ev.sessionId + "\u0000" + ev.agentId + "\u0000" + p.toolId,
        queue = p.toolId ? toolCalls.get(key) : null,
        call = queue && queue.shift();
      if (call) {
        call.tool.result = eventText(p.block, ev.raw, "result");
        call.tool.resultSource = ev.source;
        call.tool.resultLine = ev.line;
        call.tool.resultRaw = ev.raw;
        call.tool.status = ev.isError || p.block.is_error ? "error" : "success";
        call.isError = call.tool.status === "error";
        applyQuestionResult(call.tool, ev.raw, call.isError);
        if (!call.tool.durationMs && call.timestamp && ev.timestamp) {
          var elapsed = Date.parse(ev.timestamp) - Date.parse(call.timestamp);
          if (Number.isFinite(elapsed) && elapsed >= 0)
            call.tool.durationMs = elapsed;
        }
        var arr = session(ev.sessionId).events,
          ix = arr.indexOf(ev);
        if (ix >= 0) arr.splice(ix, 1);
      }
    });
    memories.forEach(function (m) {
      if (m && m.originSessionId && sessions.has(String(m.originSessionId)))
        sessions.get(String(m.originSessionId)).memories.push(m);
    });
    sessions.forEach(function (s) {
      var timed = s.events.filter(function (e) {
        return e.timestamp && Number.isFinite(Date.parse(e.timestamp));
      });
      s.events.forEach(function (e, i) {
        if (e.timestamp && Number.isFinite(Date.parse(e.timestamp)))
          e._sort = Date.parse(e.timestamp);
        else {
          var before = null,
            after = null;
          for (var a = i - 1; a >= 0; a--)
            if (
              s.events[a]._file === e._file &&
              s.events[a].timestamp &&
              Number.isFinite(Date.parse(s.events[a].timestamp))
            ) {
              before = Date.parse(s.events[a].timestamp);
              break;
            }
          for (var b = i + 1; b < s.events.length; b++)
            if (
              s.events[b]._file === e._file &&
              s.events[b].timestamp &&
              Number.isFinite(Date.parse(s.events[b].timestamp))
            ) {
              after = Date.parse(s.events[b].timestamp);
              break;
            }
          e._sort =
            before != null
              ? before +
                (after != null ? ((after - before) * (i - a)) / (b - a) : 0)
              : after != null
                ? after
                : e._file * 1e-3;
        }
      });
      s.events.sort(function (a, b) {
        return a._sort - b._sort || a._seq - b._seq;
      });
      var firstPrompt = s.events.find(function (e) {
        return e.kind === "prompt" && e.text.trim();
      });
      s.title =
        s._indexTitle ||
        s._titles[s._titles.length - 1] ||
        (firstPrompt
          ? firstPrompt.text.trim().replace(/\s+/g, " ").slice(0, 100)
          : s.id);
      var ts = s._times.slice().sort(function (a, b) {
        return a.ms - b.ms;
      });
      s.startTime = ts.length ? ts[0].value : null;
      s.endTime = ts.length ? ts[ts.length - 1].value : null;
      var st = {
        prompts: 0,
        assistant: 0,
        thinking: 0,
        tools: 0,
        errors: 0,
        events: s.events.length,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
      s.events.forEach(function (e) {
        if (e.kind === "prompt") st.prompts++;
        if (e.kind === "assistant") st.assistant++;
        if (e.kind === "thinking") st.thinking++;
        if (e.kind === "tool") st.tools++;
        if (e.isError || e.raw.subtype === "model_refusal_fallback")
          st.errors++;
      });
      var usage = new Map();
      s.events.forEach(function (e) {
        var m = e.raw.message;
        if (!object(m) || !object(m.usage)) return;
        var k =
          e.agentId +
          "\u0000" +
          String(m.id || e.raw.requestId || e.uuid || e.source + ":" + e.line);
        var old = usage.get(k) || {};
        [
          "input_tokens",
          "output_tokens",
          "cache_read_input_tokens",
          "cache_creation_input_tokens",
        ].forEach(function (f) {
          old[f] = Math.max(number(old[f]), number(m.usage[f]));
        });
        usage.set(k, old);
      });
      usage.forEach(function (u) {
        st.inputTokens += number(u.input_tokens);
        st.outputTokens += number(u.output_tokens);
        st.cacheReadTokens += number(u.cache_read_input_tokens);
        st.cacheWriteTokens += number(u.cache_creation_input_tokens);
      });
      var codexByAgent = new Map();
      codexUsages.forEach(function (u, key) {
        var parts = key.split("\u0000");
        if (parts[0] !== s.id) return;
        var agentKey = parts[1] || "main",
          current = codexByAgent.get(agentKey) || {
            thread: null,
            turns: new Map(),
          };
        if (parts[2] === "thread") current.thread = u;
        else current.turns.set(parts[2], u);
        codexByAgent.set(agentKey, current);
      });
      codexByAgent.forEach(function (entry) {
        var totals = entry.thread
          ? [entry.thread]
          : Array.from(entry.turns.values());
        totals.forEach(function (u) {
          st.inputTokens += number(u.input_tokens);
          st.outputTokens += number(u.output_tokens);
          st.cacheReadTokens += number(u.cached_input_tokens);
          st.cacheWriteTokens += number(u.cache_write_input_tokens);
        });
      });
      s.stats = st;
      s.events.forEach(function (e) {
        delete e._seq;
        delete e._file;
        delete e._sort;
      });
      delete s._titles;
      delete s._times;
      delete s._indexTitle;
    });
    return {
      sessions: Array.from(sessions.values()),
      memories: memories.slice(),
      warnings: warnings,
    };
  }
  return {
    parseJSONL: parseJSONL,
    parseMemory: parseMemory,
    buildWorkspace: buildWorkspace,
  };
});
