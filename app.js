/* LLM session Analyzer UI. Imported values are escaped before reaching markup. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id),
    esc = (v) =>
      String(v == null ? "" : v).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const kinds = () =>
    new Set(["prompt", "assistant", "thinking", "tool", "result"]);
  const state = {
    parsed: [],
    memories: [],
    readWarnings: [],
    workspace: null,
    activeId: null,
    page: 0,
    pageSize: 35,
    generation: 0,
    filters: { query: "", tool: "", agent: "", errors: false, kinds: kinds() },
  };
  const text = (v) =>
      typeof v === "string" ? v : v == null ? "" : JSON.stringify(v, null, 2),
    num = (n) => new Intl.NumberFormat().format(Number(n || 0));
  const date = (t) => {
    if (!t) return "No timestamp recorded";
    const d = new Date(t);
    return isNaN(d)
      ? String(t)
      : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  };
  function announce(s) {
    let e = $("status-live");
    if (!e) {
      e = document.createElement("div");
      e.id = "status-live";
      e.setAttribute("aria-live", "polite");
      document.body.appendChild(e);
    }
    e.textContent = s;
  }
  function tab(name) {
    document.querySelectorAll("[data-tab]").forEach((e) => {
      const on = e.dataset.tab === name;
      e.classList.toggle("active", on);
      e.setAttribute("aria-selected", String(on));
      e.tabIndex = on ? 0 : -1;
    });
    $("timeline-pane").hidden = name !== "timeline";
    $("memory-pane").hidden = name !== "memory";
  }
  function resetFilters(render) {
    state.filters = {
      query: "",
      tool: "",
      agent: "",
      errors: false,
      kinds: kinds(),
    };
    state.page = 0;
    if ($("timeline-search")) $("timeline-search").value = "";
    if ($("tool-filter")) $("tool-filter").value = "";
    if ($("agent-filter")) $("agent-filter").value = "";
    if ($("errors-filter")) $("errors-filter").checked = false;
    document
      .querySelectorAll("[data-kind]")
      .forEach((e) => (e.checked = e.dataset.kind !== "system"));
    if (render) renderTimeline();
  }
  function resetView() {
    resetFilters(false);
    $("session-search").value = "";
    document
      .querySelectorAll("input[type=file]")
      .forEach((e) => (e.value = ""));
    tab("timeline");
  }
  async function parseFile(file) {
    const source = file.webkitRelativePath || file.name,
      n = file.name.toLowerCase();
    if (/\.meta\.json$/i.test(n) || (!/\.jsonl$/i.test(n) && !/\.md$/i.test(n)))
      return { skipped: true, source };
    const raw = await file.text(),
      p = window.SessionParser;
    if (!p) throw Error("parser.js did not load");
    return /\.md$/i.test(n)
      ? { memory: p.parseMemory(raw, source), source }
      : { parsed: p.parseJSONL(raw, source), source };
  }
  function rebuild(preferred) {
    state.workspace = window.SessionParser.buildWorkspace(
      state.parsed.map((x) => x.parsed),
      state.memories,
    );
    state.workspace.warnings = (state.workspace.warnings || []).concat(
      state.readWarnings,
    );
    const ss = state.workspace.sessions || [];
    state.activeId = preferred || state.activeId || (ss[0] && ss[0].id) || null;
    if (state.activeId && !ss.some((s) => s.id === state.activeId))
      state.activeId = (ss[0] && ss[0].id) || null;
    renderAll();
  }
  function importResults(rs, preferred) {
    rs.forEach((r) => {
      if (r.memory) {
        state.memories = state.memories.filter((m) => m.source !== r.source);
        state.memories.push(r.memory);
      } else if (r.parsed) {
        state.parsed = state.parsed.filter((p) => p.source !== r.source);
        state.parsed.push(r);
      }
    });
    resetFilters(false);
    tab("timeline");
    rebuild(preferred);
    if (
      !(state.workspace.sessions || []).length &&
      (state.workspace.memories || []).length
    )
      tab("memory");
  }
  async function importFiles(files) {
    const a = Array.from(files || []);
    if (!a.length) return;
    announce(`Reading ${a.length} selected file${a.length === 1 ? "" : "s"}…`);
    const generation = state.generation,
      r = await Promise.allSettled(a.map(parseFile));
    if (generation !== state.generation) return;
    const good = [],
      bad = [];
    r.forEach((x, i) =>
      x.status === "fulfilled"
        ? good.push(x.value)
        : bad.push({
            source: a[i].webkitRelativePath || a[i].name,
            message: `Could not read file: ${(x.reason && x.reason.message) || x.reason}`,
          }),
    );
    state.readWarnings.push(...bad);
    importResults(good);
    const imported = good.filter((x) => !x.skipped).length,
      skipped = good.length - imported;
    announce(
      `${imported} source${imported === 1 ? "" : "s"} imported${skipped ? `; ${skipped} unrelated file${skipped === 1 ? "" : "s"} skipped` : ""}${bad.length ? `; ${bad.length} read error${bad.length === 1 ? "" : "s"}` : ""}.`,
    );
  }
  function session() {
    return ((state.workspace && state.workspace.sessions) || []).find(
      (s) => s.id === state.activeId,
    );
  }
  function renderAll() {
    renderSidebar();
    const has =
      state.workspace &&
      ((state.workspace.sessions || []).length ||
        (state.workspace.memories || []).length ||
        (state.workspace.warnings || []).length);
    $("empty-state").hidden = !!has;
    $("workspace").hidden = !has;
    if (has) {
      renderSummary();
      renderMemory();
      renderTimeline();
    } else {
      [
        "timeline",
        "memory-list",
        "prompt-jump",
        "session-tags",
        "stat-grid",
        "warnings-list",
        "session-title",
        "session-meta",
        "active-source",
      ].forEach((id) => $(id).replaceChildren());
      if ($("warnings-dialog").open) $("warnings-dialog").close();
    }
  }
  function renderSidebar() {
    const all = (state.workspace && state.workspace.sessions) || [],
      q = ($("session-search").value || "").toLowerCase(),
      ss = all.filter((s) =>
        [s.title, s.id, s.cwd, s.branch]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    $("session-count").textContent = all.length;
    const n = state.parsed.length + state.memories.length;
    $("source-count").textContent = `${n} source${n === 1 ? "" : "s"}`;
    $("session-list").innerHTML = ss.length
      ? ss
          .map(
            (s) =>
              `<button class="session-item ${s.id === state.activeId ? "active" : ""}" data-session-id="${esc(s.id)}"><strong>${esc(s.title || "Untitled session")}</strong><small>${esc(s.branch || s.cwd || "Recorded events")} · ${num((s.events || []).length)} events</small></button>`,
          )
          .join("")
      : `<div class="sidebar-empty">${all.length ? "No matching sessions." : "No session logs loaded"}</div>`;
    $("session-list")
      .querySelectorAll("[data-session-id]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            state.activeId = b.dataset.sessionId;
            resetFilters(false);
            tab("timeline");
            renderAll();
          }),
      );
    $("warning-count").textContent = (
      (state.workspace && state.workspace.warnings) ||
      []
    ).length;
  }
  function renderSummary() {
    const s = session(),
      st = (s && s.stats) || {};
    const emptyTitle = state.memories.length
      ? "Memory workspace"
      : "Import report";
    $("active-source").textContent = s ? s.title || s.id : emptyTitle;
    $("session-title").textContent = s
      ? s.title || "Untitled session"
      : emptyTitle;
    $("session-meta").textContent = s
      ? [
          s.cwd,
          s.branch,
          s.startTime && s.endTime
            ? `${date(s.startTime)} — ${date(s.endTime)}`
            : s.startTime && date(s.startTime),
        ]
          .filter(Boolean)
          .join(" · ")
      : state.memories.length
        ? "No session logs imported; memories remain available below."
        : "No usable session records were found. Open Warnings for file and line details.";
    const tags = s
      ? [
          ...(s.models || []).map((m) => `Model: ${m}`),
          `${(s.agents || []).length || 1} agent${(s.agents || []).length === 1 ? "" : "s"}`,
          `${(s.sources || []).length} source${(s.sources || []).length === 1 ? "" : "s"}`,
        ]
      : [];
    $("session-tags").innerHTML = tags
      .map((x) => `<span class="tag">${esc(x)}</span>`)
      .join("");
    const vals = [
      ["Recorded events", st.events || ((s && s.events) || []).length],
      ["Prompts", st.prompts],
      ["Tools", st.tools],
      ["Errors", st.errors],
      ["Recorded input tokens", st.inputTokens],
      ["Recorded output tokens", st.outputTokens],
      ["Cache read tokens", st.cacheReadTokens],
      ["Cache write tokens", st.cacheWriteTokens],
    ];
    $("stat-grid").innerHTML =
      vals
        .map(
          (v) =>
            `<div class="stat"><div class="stat-value">${num(v[1])}</div><div class="stat-label">${esc(v[0])}</div></div>`,
        )
        .join("") +
      (s
        ? '<p class="usage-note">Token values are recorded counts, not billing totals.</p>'
        : "");
    $("timeline-count").textContent = s ? (s.events || []).length : "—";
    $("memory-count").textContent = (
      (state.workspace && state.workspace.memories) ||
      []
    ).length;
  }
  function filtered() {
    const s = session();
    if (!s) return [];
    const q = state.filters.query.toLowerCase();
    return (s.events || []).filter(
      (e) =>
        state.filters.kinds.has(e.kind) &&
        (!state.filters.tool ||
          (e.tool && e.tool.name) === state.filters.tool) &&
        (!state.filters.agent ||
          (e.agentId || "main") === state.filters.agent) &&
        (!state.filters.errors ||
          e.isError ||
          (e.tool && e.tool.status === "error")) &&
        (!q ||
          [
            e.title,
            e.text,
            e.kind,
            e.model,
            e.agentId,
            e.parentUuid,
            e.tool && e.tool.name,
            e.tool && e.tool.input,
            e.tool && e.tool.result,
            e.tool && e.tool.command,
            e.tool && e.tool.resultRaw,
          ]
            .map(text)
            .join("\n")
            .toLowerCase()
            .includes(q)),
    );
  }
  function eventHTML(e) {
    const t = e.tool,
      d = [];
    if (t && t.input != null) d.push(["Input", text(t.input)]);
    if (t && t.command) d.push(["Command", t.command]);
    if (t) d.push(["Output", text(t.result)]);
    if (t && t.resultRaw != null)
      d.push(["Raw result record", text(t.resultRaw)]);
    if (e.raw != null) d.push(["Raw call/event record", text(e.raw)]);
    let p = `${e.source || "unknown source"}${e.line ? ` · line ${e.line}` : ""}`;
    if (e.uuid) p += ` · UUID ${e.uuid}`;
    if (e.parentUuid) p += ` · parent ${e.parentUuid}`;
    if (e.model) p += ` · model ${e.model}`;
    d.push(["Provenance", p]);
    if (t && t.resultSource)
      d.push([
        "Result provenance",
        `${t.resultSource}${t.resultLine ? ` · line ${t.resultLine}` : ""}`,
      ]);
    if (t && t.durationMs != null)
      d.push(["Elapsed duration", `${num(t.durationMs)} ms`]);
    const body =
      e.kind === "thinking"
        ? `<details><summary>Show thinking</summary><p class="event-text" tabindex="0">${esc(e.text || "Thinking unavailable")}</p></details>`
        : e.text
          ? `<p class="event-text" tabindex="0">${esc(e.text)}</p>`
          : "";
    const status =
      t && t.status === "pending" ? "No recorded result" : t && t.status;
    return `<article data-event-id="${esc(e.id || "")}" class="event ${esc(e.kind)} ${e.isError ? "error" : ""}"><div class="event-head"><span class="kind-pill">${esc(e.kind)}</span>${t ? `<span class="tool-status ${esc(t.status || "")}">${esc(status || "recorded")}</span>` : ""}<span class="event-meta">${esc(e.agentId && e.agentId !== "main" ? e.agentId + " · " : "")}${esc(date(e.timestamp))}</span></div><div class="event-body"><h3 class="event-title">${esc(e.title || (t && t.name) || e.kind)}</h3>${body}<details><summary>${t && t.command ? esc(t.command.slice(0, 100)) + " · " : ""}Inspect record &amp; provenance</summary><div class="detail-grid">${d.map((x) => `<div class="detail-block"><div class="detail-label">${esc(x[0])}</div><div class="codebox" tabindex="0">${esc(x[1])}</div></div>`).join("")}</div></details></div></article>`;
  }
  function renderTimeline() {
    const s = session();
    if (!s) {
      $("timeline").innerHTML =
        '<div class="memory-card"><h3>No session selected</h3><p>Open Memory to browse imported memories.</p></div>';
      $("prompt-jump").hidden = true;
      $("match-count").textContent = "0 matches";
      $("page-label").textContent = "Page 1 of 1";
      $("prev-page").disabled = true;
      $("next-page").disabled = true;
      $("tool-filter").innerHTML = '<option value="">All tools</option>';
      $("agent-filter").innerHTML = '<option value="">All agents</option>';
      return;
    }
    const tools = [
        ...new Set(
          (s.events || []).map((e) => e.tool && e.tool.name).filter(Boolean),
        ),
      ].sort(),
      agents = [
        ...new Set((s.events || []).map((e) => e.agentId || "main")),
      ].sort();
    function fill(id, a, label, current) {
      const e = $(id);
      e.innerHTML =
        `<option value="">${label}</option>` +
        a.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
      e.value = a.includes(current) ? current : "";
      return e.value;
    }
    state.filters.tool = fill(
      "tool-filter",
      tools,
      "All tools",
      state.filters.tool,
    );
    state.filters.agent = fill(
      "agent-filter",
      agents,
      "All agents",
      state.filters.agent,
    );
    const ev = filtered(),
      pages = Math.max(1, Math.ceil(ev.length / state.pageSize));
    state.page = Math.max(0, Math.min(state.page, pages - 1));
    const page = ev.slice(
      state.page * state.pageSize,
      (state.page + 1) * state.pageSize,
    );
    $("timeline").innerHTML = page.length
      ? page.map(eventHTML).join("")
      : '<div class="memory-card"><h3>No events match these filters.</h3><p>Try resetting the filters.</p></div>';
    $("page-label").textContent = `Page ${state.page + 1} of ${pages}`;
    $("prev-page").disabled = state.page <= 0;
    $("next-page").disabled = state.page >= pages - 1;
    $("match-count").textContent =
      `${ev.length} match${ev.length === 1 ? "" : "es"}`;
    const prompts = (s.events || []).filter((e) => e.kind === "prompt");
    $("prompt-jump").hidden = !prompts.length;
    $("prompt-jump").innerHTML = prompts.length
      ? `<label class="select-wrap"><select id="prompt-select" aria-label="Jump to a recorded prompt"><option value="">Jump to a recorded prompt…</option>${prompts.map((p, i) => `<option value="${esc(p.id || i)}">${esc((p.text || "").slice(0, 100) || "Prompt " + (i + 1))}</option>`).join("")}</select></label>`
      : "";
    const ps = $("prompt-select");
    if (ps)
      ps.onchange = () => {
        const id = ps.value;
        if (!id) return;
        resetFilters(false);
        tab("timeline");
        const all = filtered(),
          i = all.findIndex((e) => String(e.id) === id);
        state.page = i < 0 ? 0 : Math.floor(i / state.pageSize);
        renderTimeline();
        requestAnimationFrame(() => {
          const n = Array.from(
            document.querySelectorAll("[data-event-id]"),
          ).find((x) => x.dataset.eventId === id);
          if (n) {
            n.scrollIntoView({ behavior: "smooth", block: "center" });
            n.tabIndex = -1;
            n.focus({ preventScroll: true });
          }
        });
      };
  }
  function renderMemory() {
    const ms = (state.workspace && state.workspace.memories) || [],
      loaded = new Set(
        ((state.workspace && state.workspace.sessions) || []).map((s) => s.id),
      );
    $("memory-list").innerHTML = ms.length
      ? '<p class="muted">Memory is a current snapshot of context, not proof it was present during the recorded session.</p>' +
        ms
          .map(
            (m) =>
              `<article class="memory-card"><h3>${esc(m.name || m.id || "Memory")}</h3>${m.description ? `<p class="muted">${esc(m.description)}</p>` : ""}<dl class="frontmatter"><dt>Source</dt><dd>${esc(m.source || "")}</dd>${m.originSessionId ? `<dt>Origin session</dt><dd>${loaded.has(m.originSessionId) ? `<button class="origin-link" data-origin="${esc(m.originSessionId)}">${esc(m.originSessionId)}</button>` : esc(m.originSessionId) + " (not loaded)"}</dd>` : "<dt>Link</dt><dd>Unlinked workspace memory</dd>"}</dl><details open><summary>Full memory text and front matter</summary><div class="codebox" tabindex="0">${esc(m.content || m.body || "")}</div></details></article>`,
          )
          .join("")
      : '<div class="memory-card"><h3>No memories imported</h3><p>Markdown files with optional YAML front matter appear here.</p></div>';
    $("memory-list")
      .querySelectorAll("[data-origin]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            state.activeId = b.dataset.origin;
            resetFilters(false);
            tab("timeline");
            renderAll();
          }),
      );
  }
  function exportFiltered() {
    const b = new Blob(
        [
          JSON.stringify(
            {
              exportedAt: new Date().toISOString(),
              sessionId: state.activeId,
              events: filtered(),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = "llm-session-analyzer-filtered.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  }
  function showWarnings() {
    const w = (state.workspace && state.workspace.warnings) || [];
    $("warnings-list").innerHTML = w.length
      ? w
          .map(
            (x) =>
              `<div class="warning"><strong>${esc(x.source || "source")}${x.line ? ` · line ${x.line}` : ""}</strong><br>${esc(x.message || "Warning")}</div>`,
          )
          .join("")
      : '<p class="muted">No import warnings.</p>';
    $("warnings-dialog").showModal();
  }
  function bind() {
    document.querySelectorAll("input[type=file]").forEach(
      (i) =>
        (i.onchange = (e) => {
          const selected = Array.from(e.target.files || []);
          e.target.value = "";
          importFiles(selected);
        }),
    );
    document.querySelectorAll("[data-import]").forEach(
      (b) =>
        (b.onclick = () => {
          const i = $(b.dataset.import);
          if (i) i.click();
        }),
    );
    ["demo-button", "empty-demo"].forEach(
      (id) =>
        $(id) &&
        ($(id).onclick = () => {
          if (window.LLMSessionAnalyzerDemo) {
            state.generation++;
            resetView();
            importResults(
              window.LLMSessionAnalyzerDemo.sources(),
              window.LLMSessionAnalyzerDemo.sessionId,
            );
            announce("Fictional demo opened.");
          }
        }),
    );
    const dz = $("dropzone"),
      pick = () => $("file-input") && $("file-input").click();
    dz.onclick = pick;
    dz.ondragover = (e) => {
      e.preventDefault();
      dz.classList.add("is-over");
    };
    dz.ondragleave = () => dz.classList.remove("is-over");
    dz.ondrop = (e) => {
      e.preventDefault();
      dz.classList.remove("is-over");
      importFiles(e.dataTransfer.files);
    };
    dz.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick();
      }
    };
    $("session-search").oninput = renderSidebar;
    $("timeline-search").oninput = (e) => {
      state.filters.query = e.target.value;
      state.page = 0;
      renderTimeline();
    };
    $("tool-filter").onchange = (e) => {
      state.filters.tool = e.target.value;
      state.page = 0;
      renderTimeline();
    };
    $("agent-filter").onchange = (e) => {
      state.filters.agent = e.target.value;
      state.page = 0;
      renderTimeline();
    };
    $("errors-filter").onchange = (e) => {
      state.filters.errors = e.target.checked;
      state.page = 0;
      renderTimeline();
    };
    document.querySelectorAll("[data-kind]").forEach(
      (c) =>
        (c.onchange = (e) => {
          const ks =
            e.target.dataset.kind === "tool"
              ? ["tool", "result"]
              : [e.target.dataset.kind];
          ks.forEach((k) =>
            e.target.checked
              ? state.filters.kinds.add(k)
              : state.filters.kinds.delete(k),
          );
          state.page = 0;
          renderTimeline();
        }),
    );
    $("reset-filters").onclick = () => resetFilters(true);
    $("prev-page").onclick = () => {
      state.page--;
      renderTimeline();
    };
    $("next-page").onclick = () => {
      state.page++;
      renderTimeline();
    };
    $("export-button").onclick = exportFiltered;
    $("warnings-button").onclick = showWarnings;
    document.querySelector("[data-close-dialog]").onclick = () =>
      $("warnings-dialog").close();
    $("clear-button").onclick = () => {
      state.generation++;
      state.parsed = [];
      state.memories = [];
      state.readWarnings = [];
      state.workspace = null;
      state.activeId = null;
      resetView();
      renderAll();
      announce("Workspace cleared.");
    };
    document
      .querySelectorAll("[data-tab]")
      .forEach((t) => (t.onclick = () => tab(t.dataset.tab)));
    $("timeline-tab").onkeydown = (e) => {
      if (e.key === "ArrowRight") {
        $("memory-tab").focus();
        $("memory-tab").click();
      }
    };
    $("memory-tab").onkeydown = (e) => {
      if (e.key === "ArrowLeft") {
        $("timeline-tab").focus();
        $("timeline-tab").click();
      }
    };
    document.addEventListener("keydown", (e) => {
      if (
        e.key === "/" &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
      ) {
        e.preventDefault();
        $("session-search").focus();
      }
    });
  }
  resetFilters(false);
  tab("timeline");
  bind();
  renderAll();
})();
