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
  function buildWorkspace(parsedFiles, memories) {
    parsedFiles = Array.isArray(parsedFiles) ? parsedFiles : [];
    memories = Array.isArray(memories) ? memories : [];
    var warnings = [],
      sessions = new Map(),
      seq = 0,
      pendingResults = [],
      toolCalls = new Map();
    function session(id) {
      if (!sessions.has(id))
        sessions.set(id, {
          id: id,
          title: "",
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
      var sourceSession = "",
        sourceHasAgentName = /^agent-[^.]+\.jsonl$/i.test(basename(source)),
        sawConversation = false;
      for (var sri = 0; sri < pf.records.length; sri++) {
        var srr = pf.records[sri].raw;
        if (!object(srr)) continue;
        if (!sourceSession && (srr.sessionId || srr.session_id))
          sourceSession = String(srr.sessionId || srr.session_id);
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
      s.stats = st;
      s.events.forEach(function (e) {
        delete e._seq;
        delete e._file;
        delete e._sort;
      });
      delete s._titles;
      delete s._times;
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
