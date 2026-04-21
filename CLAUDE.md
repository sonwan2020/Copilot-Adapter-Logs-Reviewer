# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Copilot Adapter Logs Viewer is a zero-dependency, client-side web application for visualizing Copilot Adapter log files (JSONL format). It runs entirely in the browser with a strict Content Security Policy — no server, no bundler, no external libraries.

## Development

Open `index.html` directly in a browser. No build step required.

Deployed via GitHub Pages (`deploy-pages.yml`): push to main triggers deployment.

## Architecture

Three ES modules loaded via `<script type="module">`:

- **`js/app.js`** — Orchestrator: state management, file I/O (drag-drop/FileReader), event delegation, theme toggle, search/filter logic, content viewer modal. Owns the centralized state object.
- **`js/parser.js`** — Data processing: JSONL parsing, SSE response parsing, content normalization, formatting utilities. All pure functions.
- **`js/renderer.js`** — DOM generation: renders all 5 tabs (Messages, System, Tools, Request, Response), custom markdown engine, interactive elements (copy buttons, collapsibles, plain-text toggles, inline JSON links).
- **`css/style.css`** — Full theming via CSS custom properties (`[data-theme="light"]` / `[data-theme="dark"]`), flexbox/grid layout.

**Data flow:** File drop → `parseLogFile()` → state.entries → `applyFilters()` → `renderEntryList()` + `render*Tab()`.

## Key Conventions

- **Strict CSP**: `default-src 'none'; style-src 'self'; script-src 'self'`. No inline styles, no external resources. All dynamic content via DOM APIs.
- **XSS prevention**: User text always set via `.textContent`. HTML escaping via `escapeHtml()` for any `.innerHTML` usage.
- **No external dependencies**: Custom markdown renderer in `renderer.js` (headings, code blocks with language labels, bold/italic/links, lists, blockquotes, JSON auto-detect).
- **Plain text toggle pattern**: Markdown-rendered views (user messages, system prompts, tool descriptions, response body, content viewer) all include a "Plain Text / Formatted" toggle button using the `.md-toggle-wrapper` / `.md-toggle-btn` / `.plain-text-view` pattern.
- **Inline JSON links**: Request tab uses `createLinkedJsonView()` with placeholder substitution to embed clickable links inside JSON text that open content viewers or switch tabs.

## Log File Format

JSONL: one JSON object per line, no wrapping `[]` array. Each entry contains:
- `timestamp`, `streaming`
- `anthropicRequest` (model, messages, system, tools, max_tokens, temperature)
- `openaiRequest` (OpenAI-format equivalent)
- `copilotResponse` (SSE text: `data: {...}\n` lines)

## Search Behavior

Search scans messages → system → tools (name+description) → response in that priority order. `state.searchMatchTab` tracks which tab matched per entry. On selection, auto-switches to the matching tab. For tools, matching tools auto-expand and scroll into view.

## CSS Theming

All colors use CSS custom properties defined in `:root` (light) and `[data-theme="dark"]`. Theme persists in `localStorage('logs-reviewer-theme')`. Markdown code blocks have per-language colors (`.md-code.lang-json`, `.lang-js`, etc.) with dark-theme overrides.
