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

  function parseJSON(text, sourceName) {
    text = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    var source = String(sourceName || "import.json"),
      lines = text.split(/\r?\n/),
      records = [],
      warnings = [];
    try {
      var raw = JSON.parse(text);
      if (!object(raw)) throw new Error("JSON value is not an object");
      if (!openCodeExport(raw))
        throw new Error("Unsupported JSON session export");
      records.push({ raw: raw, line: 1 });
    } catch (e) {
      warnings.push({
        source: source,
        line: 1,
        message: e.message || "Malformed JSON",
      });
    }
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
  function antigravitySourceInfo(source, records) {
    var parts = String(source || "")
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean),
      lower = parts.map(function (part) {
        return part.toLowerCase();
      }),
      brainAt = lower.lastIndexOf("brain"),
      systemAt = lower.lastIndexOf(".system_generated"),
      logsAt = lower.lastIndexOf("logs"),
      name = lower[parts.length - 1],
      relative = logsAt >= 0 ? lower.slice(logsAt + 1) : [],
      geminiRecord =
        Array.isArray(records) &&
        records.some(function (entry) {
          return (
            object(entry && entry.raw) &&
            /^(USER_INPUT|PLANNER_RESPONSE|GENERIC|SYSTEM_MESSAGE|ERROR_MESSAGE|EPHEMERAL_MESSAGE|CHECKPOINT|CONVERSATION_HISTORY|VIEW_FILE|CODE_ACTION|INVOKE_SUBAGENT|SEARCH_WEB|LIST_DIRECTORY|RUN_COMMAND|READ_URL_CONTENT|GREP_SEARCH|ASK_QUESTION)$/.test(
              String(entry.raw.type || "").toUpperCase(),
            )
          );
        }),
      hasLogDirectory =
        logsAt >= 0 &&
        lower[logsAt - 1] === ".system_generated" &&
        (lower.indexOf("antigravity-cli") >= 0 || name.indexOf("transcript") >= 0),
      hasCanonicalName =
        name === "transcript_full.jsonl" || name === "transcript.jsonl",
      rank = 0,
      chunk = false;
    if (
      (!hasLogDirectory && !hasCanonicalName && !geminiRecord) ||
      (brainAt >= 0 && !parts[brainAt + 1])
    )
      return null;
    if (name === "transcript_full.jsonl") rank = 4;
    else if (name === "transcript.jsonl") rank = 3;
    else if (
      relative.length === 3 &&
      relative[0] === "chunks" &&
      relative[2].endsWith(".jsonl") &&
      relative[1] === "transcript_full"
    ) {
      rank = 2;
      chunk = true;
    } else if (
      relative.length === 3 &&
      relative[0] === "chunks" &&
      relative[2].endsWith(".jsonl") &&
      relative[1] === "transcript"
    ) {
      rank = 1;
      chunk = true;
    }
    if (!rank && geminiRecord) rank = 4;
    if (!rank) return null;
    var sessionId =
      brainAt >= 0
        ? parts[brainAt + 1]
        : systemAt > 0
          ? parts[systemAt - 1]
          : "";
    if (!sessionId || sessionId === "logs") {
      var explicit = Array.isArray(records)
        ? records.find(function (entry) {
            var raw = entry && entry.raw;
            return object(raw) && (raw.sessionId || raw.session_id);
          })
        : null;
      sessionId = explicit
        ? String(explicit.raw.sessionId || explicit.raw.session_id)
        : parts.length > 1 && parts[parts.length - 2] !== "logs"
          ? parts[parts.length - 2]
          : fileSession(source);
    }
    return { sessionId: sessionId, rank: rank, chunk: chunk };
  }
  function antigravitySelectedFiles(parsedFiles) {
    var groups = new Map(),
      selected = new Set();
    parsedFiles.forEach(function (pf, index) {
      if (!pf) return;
      var info = antigravitySourceInfo(pf.source, pf.records);
      if (!info) return;
      var group = groups.get(info.sessionId) || { rank: 0, candidates: [] };
      if (info.rank > group.rank) {
        group.rank = info.rank;
        group.candidates = [index];
      } else if (info.rank === group.rank) group.candidates.push(index);
      groups.set(info.sessionId, group);
    });
    groups.forEach(function (group) {
      var seen = new Set();
      group.candidates.forEach(function (index) {
        var pf = parsedFiles[index],
          source = String((pf && pf.source) || "");
        if (group.rank >= 3 && seen.size) return;
        if (seen.has(source)) return;
        seen.add(source);
        selected.add(index);
      });
    });
    return selected;
  }
  function antigravityTimestamp(value) {
    if (!value) return null;
    var date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  function antigravityText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value))
      return value
        .map(function (part) {
          if (typeof part === "string") return part;
          if (!object(part)) return "";
          if (part.text !== undefined) return string(part.text);
          if (part.content !== undefined) return antigravityText(part.content);
          return "";
        })
        .filter(Boolean)
        .join("\n");
    if (object(value)) {
      if (value.text !== undefined) return string(value.text);
      if (value.content !== undefined) return antigravityText(value.content);
    }
    return string(value);
  }
  function antigravityToolType(name) {
    var value = String(name || "").toLowerCase(),
      aliases = {
        run_command: "RUN_COMMAND",
        search_web: "SEARCH_WEB",
        view_file: "VIEW_FILE",
        write_to_file: "CODE_ACTION",
        replace_file_content: "CODE_ACTION",
        invoke_subagent: "INVOKE_SUBAGENT",
        list_dir: "LIST_DIRECTORY",
        read_url_content: "READ_URL_CONTENT",
        grep_search: "GREP_SEARCH",
        ask_question: "ASK_QUESTION",
        send_message: "SEND_MESSAGE",
        define_subagent: "DEFINE_SUBAGENT",
        manage_subagents: "MANAGE_SUBAGENTS",
        schedule: "SCHEDULE",
        manage_task: "MANAGE_TASK",
        generate_image: "GENERATE_IMAGE",
        find_by_name: "FIND_BY_NAME",
        mcp_chrome_devtools_list_pages: "MCP_CHROME_DEVTOOLS_LIST_PAGES",
        mcp_chrome_devtools_new_page: "MCP_CHROME_DEVTOOLS_NEW_PAGE",
      };
    return aliases[value] || value.replace(/[^a-z0-9]+/g, "_").toUpperCase();
  }
  function antigravityToolName(type) {
    var names = {
      RUN_COMMAND: "run_command",
      SEARCH_WEB: "search_web",
      VIEW_FILE: "view_file",
      CODE_ACTION: "code_action",
      INVOKE_SUBAGENT: "invoke_subagent",
      LIST_DIRECTORY: "list_dir",
      READ_URL_CONTENT: "read_url_content",
      GREP_SEARCH: "grep_search",
      ASK_QUESTION: "ask_question",
      SEND_MESSAGE: "send_message",
      DEFINE_SUBAGENT: "define_subagent",
      MANAGE_SUBAGENTS: "manage_subagents",
      SCHEDULE: "schedule",
      MANAGE_TASK: "manage_task",
      GENERATE_IMAGE: "generate_image",
      FIND_BY_NAME: "find_by_name",
      MCP_CHROME_DEVTOOLS_LIST_PAGES: "mcp_chrome_devtools_list_pages",
      MCP_CHROME_DEVTOOLS_NEW_PAGE: "mcp_chrome_devtools_new_page",
    };
    return names[String(type || "").toUpperCase()] || "";
  }
  function antigravityToolStatus(status, isError) {
    var value = String(status || "").toLowerCase();
    if (isError || /error|fail|cancel|reject/.test(value)) return "error";
    if (/running|pending|start|progress/.test(value)) return "pending";
    return "success";
  }
  function antigravityCommand(input) {
    if (!object(input)) return "";
    return string(
      input.CommandLine ||
        input.command ||
        input.cmd ||
        input.Instruction ||
        input.Prompt ||
        input.Message ||
        input.Description ||
        input.query ||
        input.Query ||
        input.toolSummary ||
        input.toolAction ||
        "",
    );
  }
  function antigravityQuestionInput(input) {
    if (!object(input) || typeof input.questions !== "string") return input;
    try {
      var questions = JSON.parse(input.questions);
      if (Array.isArray(questions))
        return Object.assign({}, input, { questions: questions });
    } catch (_) {}
    return input;
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
  function openCodeExport(raw) {
    return (
      object(raw) &&
      object(raw.info) &&
      Array.isArray(raw.messages) &&
      raw.messages.every(function (message) {
        return (
          object(message) &&
          object(message.info) &&
          Array.isArray(message.parts)
        );
      })
    );
  }
  function openCodeTimestamp(value) {
    if (value == null || value === "") return null;
    if (typeof value === "string" && Number.isFinite(Date.parse(value)))
      return new Date(Date.parse(value)).toISOString();
    var n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (Math.abs(n) < 1e12) n *= 1000;
    var d = new Date(n);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  function openCodeModel(info) {
    if (!object(info)) return "";
    var model = object(info.model) ? info.model : null,
      provider = (model && model.providerID) || info.providerID || "",
      id = (model && (model.modelID || model.id)) || info.modelID || "";
    return [provider, id].filter(Boolean).join("/");
  }
  function openCodeErrorText(error) {
    if (error == null) return "";
    if (typeof error === "string") return error;
    if (object(error.data) && error.data.message != null)
      return string(error.data.message);
    if (error.message != null) return string(error.message);
    if (error.name) return String(error.name);
    return string(error);
  }
  function openCodeCommand(input) {
    if (!object(input)) return "";
    var value =
      input.command != null
        ? input.command
        : input.cmd != null
          ? input.cmd
          : input.script != null
            ? input.script
            : input.query != null
              ? input.query
              : "";
    return Array.isArray(value) ? value.map(string).join(" ") : string(value);
  }
  function openCodeToolStatus(status) {
    status = String(status || "").toLowerCase();
    if (/error|fail|cancel|reject/.test(status)) return "error";
    if (/complete|success|done/.test(status)) return "success";
    return "pending";
  }
  function openCodeTokens(tokens) {
    tokens = object(tokens) ? tokens : {};
    var cache = object(tokens.cache) ? tokens.cache : {};
    return {
      inputTokens: number(tokens.input),
      outputTokens: number(tokens.output),
      reasoningTokens: number(tokens.reasoning),
      cacheReadTokens: number(cache.read),
      cacheWriteTokens: number(cache.write),
    };
  }
  function addOpenCodeTokens(target, usage) {
    target.inputTokens += usage.inputTokens;
    target.outputTokens += usage.outputTokens;
    target.reasoningTokens += usage.reasoningTokens;
    target.cacheReadTokens += usage.cacheReadTokens;
    target.cacheWriteTokens += usage.cacheWriteTokens;
  }
  function openCodePartText(part) {
    if (!object(part)) return string(part);
    if (part.text != null) return string(part.text);
    if (part.content != null) return string(part.content);
    if (part.description != null) return string(part.description);
    if (part.prompt != null) return string(part.prompt);
    return string(part);
  }
  function openCodePartTitle(part, kind) {
    var type = String((part && part.type) || "");
    if (kind === "prompt") return "Human prompt";
    if (kind === "assistant") return "Assistant";
    if (kind === "thinking") return "Thinking";
    if (type === "compaction") return "Context compacted";
    if (type === "step-start") return "Step started";
    if (type === "step-finish") return "Step finished";
    if (type === "retry") return "Retry";
    if (type === "file") return "File attachment";
    if (type === "patch") return "Patch";
    if (type === "snapshot") return "Snapshot";
    if (type === "agent") return "Agent";
    return type || "OpenCode event";
  }
  function openCodePartTimestamp(part, info) {
    var partTime = object(part && part.time)
      ? part.time
      : object(part && part.state) && object(part.state.time)
        ? part.state.time
        : {};
    return openCodeTimestamp(
      partTime.start != null
        ? partTime.start
        : partTime.created != null
          ? partTime.created
          : object(info && info.time)
            ? info.time.created
            : null,
    );
  }
  function addOpenCodeExport(raw, source, fileIndex, session, nextSeq) {
    var info = raw.info,
      sid = String(info.id || fileSession(source)),
      s = session(sid),
      sessionAgent = String(info.agent || "main"),
      sessionModel = openCodeModel(info);
    s.platform = "OpenCode";
    if (s.sources.indexOf(source) < 0) s.sources.push(source);
    if (info.title) s._titles.push(String(info.title));
    if (!s.cwd && info.directory) s.cwd = String(info.directory);
    if (sessionAgent && s.agents.indexOf(sessionAgent) < 0)
      s.agents.push(sessionAgent);
    if (sessionModel && s.models.indexOf(sessionModel) < 0)
      s.models.push(sessionModel);
    if (object(info.time)) {
      [info.time.created, info.time.updated].forEach(function (value) {
        var timestamp = openCodeTimestamp(value);
        if (timestamp)
          s._times.push({ value: timestamp, ms: Date.parse(timestamp) });
      });
    }
    if (object(info.tokens)) s._openCodeSessionTokens = openCodeTokens(info.tokens);
    raw.messages.forEach(function (message, messageIndex) {
      var messageInfo = message.info,
        role = String(messageInfo.role || "").toLowerCase(),
        agent = String(messageInfo.agent || sessionAgent || "main"),
        model = openCodeModel(messageInfo) || sessionModel,
        messageTimestamp = openCodePartTimestamp(null, messageInfo),
        parts = message.parts;
      if (s.agents.indexOf(agent) < 0) s.agents.push(agent);
      if (model && s.models.indexOf(model) < 0) s.models.push(model);
      if (messageTimestamp)
        s._times.push({
          value: messageTimestamp,
          ms: Date.parse(messageTimestamp),
        });
      if (role === "assistant" && object(messageInfo.tokens)) {
        if (!s._openCodeMessageTokens) s._openCodeMessageTokens = new Map();
        s._openCodeMessageTokens.set(
          String(messageInfo.id || messageIndex),
          openCodeTokens(messageInfo.tokens),
        );
      }
      parts.forEach(function (part, partIndex) {
        if (!object(part)) part = { type: "text", text: string(part) };
        var type = String(part.type || "").toLowerCase(),
          kind = "system",
          title,
          text = openCodePartText(part),
          tool = null,
          state = object(part.state) ? part.state : {},
          partTimestamp = openCodePartTimestamp(part, messageInfo),
          isError = type === "retry";
        if (type === "text")
          kind = role === "user" ? "prompt" : role === "assistant" ? "assistant" : "system";
        else if (type === "reasoning") kind = "thinking";
        else if (type === "tool") {
          kind = "tool";
          title = String(part.tool || state.title || "Tool call");
          var status = openCodeToolStatus(state.status),
            start = openCodeTimestamp(object(state.time) ? state.time.start : null),
            end = openCodeTimestamp(object(state.time) ? state.time.end : null),
            duration = start && end ? Date.parse(end) - Date.parse(start) : null;
          tool = {
            id: String(part.callID || part.id || ""),
            name: String(part.tool || "Unknown tool"),
            input: object(state.input) ? state.input : {},
            command: openCodeCommand(state.input),
            status: status,
            result:
              status === "error"
                ? openCodeErrorText(state.error)
                : string(state.output || ""),
            resultSource: status === "pending" ? null : source,
            resultLine: status === "pending" ? null : 1,
            resultRaw: status === "pending" ? null : message,
            durationMs:
              duration != null && Number.isFinite(duration) && duration >= 0
                ? duration
                : null,
            questionInteraction: null,
          };
          text = tool.command;
          isError = status === "error";
        } else if (type === "subtask") {
          kind = "tool";
          title = "Subtask";
          tool = {
            id: String(part.id || ""),
            name: String(part.agent || "Subtask"),
            input: {
              prompt: part.prompt || "",
              description: part.description || "",
            },
            command: string(part.command || part.prompt || ""),
            status: "success",
            result: string(part.description || ""),
            resultSource: source,
            resultLine: 1,
            resultRaw: message,
            durationMs: null,
            questionInteraction: null,
          };
          text = tool.command;
        }
        title = title || openCodePartTitle(part, kind);
        var event = {
          id:
            source +
            ":1:" +
            String(messageInfo.id || messageIndex) +
            ":" +
            String(part.id || partIndex),
          kind: kind,
          title: title,
          text: text,
          timestamp: partTimestamp || messageTimestamp,
          sessionId: sid,
          agentId: agent,
          source: source,
          line: 1,
          uuid: part.id || messageInfo.id || null,
          parentUuid: messageInfo.parentID || null,
          model: model || null,
          isError: isError,
          raw: message,
          _seq: nextSeq(),
          _file: fileIndex,
        };
        if (tool) event.tool = tool;
        if (event.timestamp)
          s._times.push({
            value: event.timestamp,
            ms: Date.parse(event.timestamp),
          });
        s.events.push(event);
      });
      if (messageInfo.error) {
        var errorText = openCodeErrorText(messageInfo.error),
          errorEvent = {
            id:
              source +
              ":1:" +
              String(messageInfo.id || messageIndex) +
              ":error",
            kind: "system",
            title: String(messageInfo.error.name || "Assistant error"),
            text: errorText || "Assistant error",
            timestamp: openCodeTimestamp(
              object(messageInfo.time)
                ? messageInfo.time.completed || messageInfo.time.created
                : null,
            ),
            sessionId: sid,
            agentId: agent,
            source: source,
            line: 1,
            uuid: messageInfo.id || null,
            parentUuid: messageInfo.parentID || null,
            model: model || null,
            isError: true,
            raw: message,
            _seq: nextSeq(),
            _file: fileIndex,
          };
        if (errorEvent.timestamp)
          s._times.push({
            value: errorEvent.timestamp,
            ms: Date.parse(errorEvent.timestamp),
          });
        s.events.push(errorEvent);
      }
    });
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
      antigravityFiles = antigravitySelectedFiles(parsedFiles),
      antigravityCalls = new Map(),
      antigravityResults = [],
      antigravitySeen = new Map(),
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
      var source = String(pf.source || "import.jsonl"),
        sourceAgent = inferredAgent(source),
        antigravityInfo = antigravitySourceInfo(source, pf.records);
      if (antigravityInfo && !antigravityFiles.has(fileIndex)) return;
      if (Array.isArray(pf.warnings))
        warnings.push.apply(warnings, pf.warnings);
      var sourceBase = basename(source).toLowerCase(),
        isHistory = sourceBase === "history.jsonl",
        isIndex = sourceBase === "session_index.jsonl",
        codexMeta = null,
        isCodex = false,
        openCodeRecords = [];
      pf.records.forEach(function (entry) {
        var raw = entry && entry.raw;
        if (!object(raw)) return;
        if (openCodeExport(raw)) openCodeRecords.push(raw);
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
      if (openCodeRecords.length) {
        openCodeRecords.forEach(function (raw) {
          addOpenCodeExport(raw, source, fileIndex, session, function () {
            return seq++;
          });
        });
        return;
      }
      if (antigravityInfo) {
        var antigravityId = antigravityInfo.sessionId,
          antigravitySession = session(antigravityId),
          seenForSession = antigravitySeen.get(antigravityId) || new Set();
        antigravitySeen.set(antigravityId, seenForSession);
        antigravitySession.platform = "Gemini (Antigravity)";
        if (antigravitySession.sources.indexOf(source) < 0)
          antigravitySession.sources.push(source);
        pf.records.forEach(function (entry) {
          var raw = entry && entry.raw;
          if (!object(raw)) return;
          var dedupeKey = JSON.stringify(raw);
          if (seenForSession.has(dedupeKey)) return;
          seenForSession.add(dedupeKey);
          var line = entry.line,
            sid = String(raw.sessionId || raw.session_id || antigravityId),
            agent = String(
              raw.agentId || raw.agent_id || raw.agentName || raw.agent_name || "main",
            ),
            s = session(sid),
            type = String(raw.type || "UNKNOWN").toUpperCase(),
            timestamp = antigravityTimestamp(raw.created_at || raw.timestamp),
            model = String(raw.model || raw.model_name || raw.model_id || ""),
            explicitTitle = raw.sessionTitle || raw.session_title || raw.title || "";
          s.platform = "Gemini (Antigravity)";
          if (s.sources.indexOf(source) < 0) s.sources.push(source);
          if (s.agents.indexOf(agent) < 0) s.agents.push(agent);
          if (explicitTitle) s._titles.push(String(explicitTitle));
          if (model && s.models.indexOf(model) < 0) s.models.push(model);
          if (timestamp)
            s._times.push({ value: timestamp, ms: Date.parse(timestamp) });
          function addEvent(kind, title, text, detail) {
            detail = detail || {};
            var event = {
              id: source + ":" + line + ":" + (detail.index || 0),
              kind: kind,
              title: title,
              text: text,
              timestamp: timestamp,
              sessionId: sid,
              agentId: agent,
              source: source,
              line: line,
              uuid: detail.uuid || raw.uuid || raw.id || null,
              parentUuid: raw.parentUuid || raw.parent_uuid || null,
              model: model || null,
              isError: !!detail.isError,
              raw: raw,
              _seq: seq++,
              _file: fileIndex,
            };
            if (detail.tool) event.tool = detail.tool;
            s.events.push(event);
            return event;
          }
          if (type === "USER_INPUT") {
            var prompt = antigravityText(raw.content);
            if (prompt)
              addEvent(
                "prompt",
                agent === "main" ? "Human prompt" : "Agent prompt",
                prompt,
              );
            return;
          }
          if (type === "PLANNER_RESPONSE") {
            if (typeof raw.thinking === "string" && raw.thinking.trim())
              addEvent("thinking", "Thinking", raw.thinking, { index: 0 });
            var answer = antigravityText(raw.content),
              itemIndex = 1;
            if (answer.trim())
              addEvent("assistant", "Assistant", answer, { index: itemIndex++ });
            (Array.isArray(raw.tool_calls) ? raw.tool_calls : []).forEach(
              function (call) {
                if (!object(call)) return;
                var name = String(call.name || "Tool call"),
                  input = antigravityQuestionInput(
                    object(call.args) ? call.args : {},
                  ),
                  toolType = antigravityToolType(name),
                  toolId = String(call.id || call.call_id || ""),
                  tool = {
                    id: toolId,
                    name: name,
                    input: input,
                    command: antigravityCommand(input),
                    status: "pending",
                    result: "",
                    resultSource: null,
                    resultLine: null,
                    resultRaw: null,
                    durationMs: null,
                    questionInteraction:
                      name.toLowerCase() === "ask_question"
                        ? questionInteraction(input)
                        : null,
                  },
                  callEvent = addEvent(
                    "tool",
                    tool.questionInteraction
                      ? "Questions for user"
                      : name.replace(/_/g, " "),
                    tool.command,
                    { index: itemIndex++, uuid: toolId, tool: tool },
                  ),
                  key = sid + "\u0000" + agent + "\u0000" + toolType,
                  queue = antigravityCalls.get(key) || [];
                queue.push(callEvent);
                antigravityCalls.set(key, queue);
              },
            );
            if (!answer.trim() && !(typeof raw.thinking === "string" && raw.thinking.trim()) && !raw.tool_calls)
              addEvent("system", "Planner response", "Response content was not recorded.");
            return;
          }
          var resultName = antigravityToolName(type);
          if (resultName) {
            var resultEvent = addEvent(
                "result",
                "Tool result: " + resultName.replace(/_/g, " "),
                antigravityText(raw.content),
                { isError: !!raw.error || type === "ERROR_MESSAGE" },
              );
            antigravityResults.push({
              event: resultEvent,
              toolType: type,
              error: !!raw.error || /error/.test(String(raw.status || "").toLowerCase()),
            });
            return;
          }
          var error =
            type === "ERROR_MESSAGE" ||
            !!raw.error ||
            /error|fail|cancel|reject/.test(String(raw.status || "").toLowerCase()),
            labels = {
              SYSTEM_MESSAGE: "System message",
              ERROR_MESSAGE: "Error",
              CHECKPOINT: "Checkpoint",
              CONVERSATION_HISTORY: "Conversation history",
              EPHEMERAL_MESSAGE: "Ephemeral message",
              GENERIC: "Antigravity message",
            },
            label = labels[type] || type.replace(/_/g, " ").toLowerCase();
          addEvent(
            "system",
            label,
            antigravityText(raw.content) || antigravityText(raw.error),
            { isError: error },
          );
        });
        return;
      }
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
    antigravityCalls.forEach(function (queue) {
      queue.sort(function (left, right) {
        return (
          (Date.parse(left.timestamp) || 0) -
            (Date.parse(right.timestamp) || 0) ||
          left._seq - right._seq
        );
      });
    });
    antigravityResults.sort(function (left, right) {
      return (
        (Date.parse(left.event.timestamp) || 0) -
          (Date.parse(right.event.timestamp) || 0) ||
        left.event._seq - right.event._seq
      );
    });
    antigravityResults.forEach(function (pending) {
      var resultEvent = pending.event,
        key =
          resultEvent.sessionId +
          "\u0000" +
          resultEvent.agentId +
          "\u0000" +
          pending.toolType,
        queue = antigravityCalls.get(key),
        call = queue && queue.shift();
      if (!call) return;
      var raw = resultEvent.raw,
        status = antigravityToolStatus(
          raw.status,
          pending.error || resultEvent.isError,
        );
      call.tool.result =
        resultEvent.text || antigravityText(raw.error || raw.output || "");
      call.tool.status = status;
      call.tool.resultSource = resultEvent.source;
      call.tool.resultLine = resultEvent.line;
      call.tool.resultRaw = raw;
      call.isError = status === "error";
      if (call.tool.questionInteraction) {
        var structuredQuestionResult = object(raw.toolUseResult)
          ? raw.toolUseResult
          : null;
        if (!structuredQuestionResult && resultEvent.text) {
          try {
            var parsedQuestionResult = JSON.parse(resultEvent.text);
            if (object(parsedQuestionResult))
              structuredQuestionResult = parsedQuestionResult;
          } catch (_) {}
        }
        applyQuestionResult(
          call.tool,
          structuredQuestionResult
            ? { toolUseResult: structuredQuestionResult }
            : { toolUseResult: raw.toolUseResult },
          call.isError,
        );
        if (
          !call.isError &&
          call.tool.questionInteraction.state === "unanswered" &&
          call.tool.questionInteraction.questions.length === 1 &&
          resultEvent.text.trim()
        ) {
          var recordedQuestion = call.tool.questionInteraction.questions[0],
            recordedAnswer = resultEvent.text.trim();
          recordedQuestion.answer = recordedAnswer;
          call.tool.questionInteraction.answers[recordedQuestion.question] =
            recordedAnswer;
          call.tool.questionInteraction.state = "answered";
        }
      }
      if (!call.tool.durationMs && call.timestamp && resultEvent.timestamp) {
        var duration =
          Date.parse(resultEvent.timestamp) - Date.parse(call.timestamp);
        if (Number.isFinite(duration) && duration >= 0)
          call.tool.durationMs = duration;
      }
      var resultEvents = session(resultEvent.sessionId).events,
        resultIndex = resultEvents.indexOf(resultEvent);
      if (resultIndex >= 0) resultEvents.splice(resultIndex, 1);
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
        reasoningTokens: 0,
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
      if (s.platform === "OpenCode") {
        var openCodeUsage = {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        };
        if (s._openCodeSessionTokens)
          addOpenCodeTokens(openCodeUsage, s._openCodeSessionTokens);
        else if (s._openCodeMessageTokens)
          s._openCodeMessageTokens.forEach(function (tokens) {
            addOpenCodeTokens(openCodeUsage, tokens);
          });
        addOpenCodeTokens(st, openCodeUsage);
      }
      s.stats = st;
      s.events.forEach(function (e) {
        delete e._seq;
        delete e._file;
        delete e._sort;
      });
      delete s._titles;
      delete s._times;
      delete s._indexTitle;
      delete s._openCodeSessionTokens;
      delete s._openCodeMessageTokens;
    });
    return {
      sessions: Array.from(sessions.values()),
      memories: memories.slice(),
      warnings: warnings,
    };
  }
  return {
    parseJSONL: parseJSONL,
    parseJSON: parseJSON,
    parseMemory: parseMemory,
    buildWorkspace: buildWorkspace,
  };
});
