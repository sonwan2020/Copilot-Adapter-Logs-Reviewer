# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Copilot Adapter Logs Viewer is a zero-dependency, client-side web application for visualizing Copilot Adapter log files (JSONL format). It runs entirely in the browser with a strict Content Security Policy — no server, no bundler.

## Development

Open `index.html` directly in a browser. No build step, no package manager, no tests.

Deployed via GitHub Pages (`deploy-pages.yml`): push to `main` triggers deployment.

## Architecture

Three ES modules loaded via `<script type="module">`, plus vendored highlight.js:

- **`js/app.js`** — Orchestrator: owns the centralized `state` object, file I/O (drag-drop + streaming/legacy FileReader), event delegation, theme toggle, search/filter logic, search match navigation with highlight, content viewer modal.
- **`js/parser.js`** — Data processing: JSONL parsing (two paths: `parseLogFileStreaming` via ReadableStream for modern browsers, `parseLogFile` via FileReader as fallback), SSE response parsing, content normalization. All pure/exported functions.
- **`js/renderer.js`** — DOM generation: renders all 6 tabs (Messages, System, Tools, Request, Response, Raw), custom markdown engine, syntax highlighting via `hljs` global, interactive elements (copy buttons, collapsibles, plain-text toggles, inline JSON links).
- **`css/style.css`** — Full theming via CSS custom properties (`[data-theme="light"]` / `[data-theme="dark"]`), flexbox/grid layout, responsive breakpoint at 768px.
- **`js/vendor/highlight.min.js`** + **`css/vendor/hljs-*.min.css`** — Vendored highlight.js for syntax coloring. Loaded as a global script (not a module). Theme CSS swapped on light/dark toggle via `disabled` attribute. Guarded with `typeof hljs === 'undefined'` check.

**Data flow:** File drop → `parseLogFile[Streaming]()` → `state.entries` (each entry gets `_index` added) → `applyFilters()` → `renderEntryList()` + `render*Tab()`.

## Key Architectural Patterns

- **Strict CSP**: `default-src 'none'; style-src 'self'; script-src 'self'; img-src 'none'; connect-src 'none'`. No inline styles, no external resources. All dynamic content via DOM APIs.
- **XSS prevention**: User text always set via `.textContent`. HTML escaping via `escapeHtml()` for any `.innerHTML` usage.
- **Lazy DOM rendering**: Performance-critical pattern used throughout `renderer.js`. Message bodies, tool result content, system prompts, and thinking blocks are NOT rendered until first expand. Each uses a `bodyRendered` flag to avoid re-rendering. New content must follow this pattern — render expensive DOM trees on first toggle, not on initial page paint.
- **Plain text toggle pattern**: Use `createLazyToggleWrapper(text)` from `renderer.js`. Starts as plain text `<pre>`, builds markdown view lazily on first toggle. All text views (user messages, system prompts, tool descriptions, response body, content viewer) use `.md-toggle-wrapper` / `.md-toggle-btn` / `.plain-text-view`.
- **Tool use/result linking**: Messages tab builds a `toolUseMap` (`Map<id, {name, input}>`) from `tool_use` blocks, so `tool_result` blocks can display linked tool name and input.
- **Inline JSON links**: Request tab uses `createLinkedJsonView()` with `__LINK_*__` placeholder substitution to embed clickable links inside JSON text that open content viewers or switch tabs.
- **Custom markdown renderer**: `renderMarkdownContent()` in `renderer.js` — headings, fenced code blocks with language labels and hljs highlighting, bold/italic/links, lists, blockquotes, HR, JSON auto-detect. No external markdown library.

## Log File Format

JSONL: one JSON object per line, no wrapping `[]` array. Each entry contains:
- `timestamp`, `streaming`
- `anthropicRequest` (model, messages, system, tools, max_tokens, temperature)
- `openaiRequest` (OpenAI-format equivalent)
- `copilotResponse` (SSE text: `data: {...}\n` lines)

## State Object

`app.js` owns a single `state` object: `entries`, `filteredEntries`, `selectedIndex`, `activeTab`, `fileName`, `fileSize`, `truncated`, `searchMatchTab` (maps entry index → tab name), `searchMatches`, `searchMatchIndex`. Reset fully on `closeFile()`.

## Search Behavior

Search scans messages → system → tools (name+description) → response in that priority order. `state.searchMatchTab` tracks which tab matched per entry. On selection, auto-switches to the matching tab. `collectAllMatches()` builds a cross-tab match list; `highlightNthMatch()` walks text nodes, wraps all matches with `<mark>`, and scrolls to the current one. For tools, matching tools auto-expand and scroll into view.

## CSS Theming

All colors use CSS custom properties defined in `:root` (light) and `[data-theme="dark"]`. Theme persists in `localStorage('logs-reviewer-theme')`. Markdown code blocks have per-language colors (`.md-code.lang-json`, `.lang-js`, etc.) with dark-theme overrides. Highlight.js theme CSS is swapped by toggling `disabled` on the two `<link>` elements.
