# Copilot Adapter Logs Reviewer

A lightweight, client-side web application for analyzing and visualizing Copilot Adapter log files. No server required — runs entirely in the browser.

## Features

- **Drag & drop** JSONL log files to load
- **5 detail tabs**: Messages, System Prompts, Tools, Request (Anthropic vs OpenAI side-by-side), Response
- **Markdown rendering** with syntax-colored code blocks and plain text toggle
- **Full-text search** across messages, system prompts, tools, and responses — auto-navigates to the matching tab
- **Light / Dark theme** with persistent preference
- **Usage statistics** table for token counts
- **Content viewer** modal for expanding large text blocks
- **Zero dependencies** — pure HTML, CSS, and JavaScript (ES modules)
- **Strict Content Security Policy** — no inline scripts, no external resources

## Usage

1. Open `index.html` in a modern browser (Chrome, Firefox, Safari)
2. Drag & drop a `.jsonl` log file (or click to browse)
3. Browse entries in the sidebar, use the search box and model filter to narrow results
4. Click an entry to view details across the tabs

## Log File Format

JSONL format — one JSON object per line:

```json
{"timestamp":"2026-04-20T12:34:56Z","streaming":true,"anthropicRequest":{...},"openaiRequest":{...},"copilotResponse":"data: {...}\n..."}
```

Each entry contains the Anthropic request, the equivalent OpenAI request, and the streamed SSE response.

## Deployment

Static site — deploy to any web server or GitHub Pages. A GitHub Actions workflow (`deploy-pages.yml`) is included for automatic deployment on push to `master`.

## Architecture

| File | Role |
|------|------|
| `index.html` | Entry point, layout structure, strict CSP |
| `js/app.js` | State management, file I/O, events, search/filter |
| `js/parser.js` | JSONL parsing, SSE response parsing, utilities |
| `js/renderer.js` | DOM rendering, custom markdown engine, interactive UI |
| `css/style.css` | Theming (CSS variables), responsive layout |
