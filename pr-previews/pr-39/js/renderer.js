/**
 * Renderer module - creates DOM elements for log entry visualization.
 */
import { normalizeContent, parseSSEResponse, formatTimestamp, getToolsFromCache } from './parser.js';

/**
 * Helper function to get tools from an entry, handling both cached and inline tools.
 * @param {object} entry
 * @returns {Array}
 */
function getTools(entry) {
  const req = entry.anthropicRequest;
  if (!req) return [];

  // Check if tools are cached
  if (req._toolsCacheId) {
    return getToolsFromCache(req._toolsCacheId) || [];
  }

  // Fall back to inline tools (for backwards compatibility or if caching failed)
  return req.tools || [];
}

/**
 * Get a short model label from full model name.
 */
export function modelLabel(model) {
  if (!model) return 'unknown';
  if (model.includes('haiku')) return 'haiku';
  if (model.includes('opus')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  return model.split('-').pop() || model;
}

/**
 * Get model badge CSS class.
 */
function modelBadgeClass(model) {
  if (!model) return '';
  if (model.includes('haiku')) return 'haiku';
  if (model.includes('opus')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  return '';
}

/**
 * Create a copy-to-clipboard button.
 */
function createCopyButton(text) {
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.textContent = 'Copy';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
      }, 1500);
    } catch {
      btn.textContent = 'Failed';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    }
  });
  return btn;
}

/**
 * Create a JSON view with copy button.
 */
function createJsonView(obj) {
  const container = document.createElement('div');
  container.className = 'json-view-container';

  const pre = document.createElement('div');
  pre.className = 'json-view';
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  pre.textContent = text;

  container.appendChild(pre);
  container.appendChild(createCopyButton(text));
  return container;
}

/**
 * Create a markdown/plain text toggle wrapper with lazy rendering.
 * Only the plain text view is created initially; the markdown view
 * is built on first toggle to avoid expensive DOM tree creation upfront.
 *
 * @param {string} text - Raw text content
 * @param {string} initialBtnText - Initial button label (default: 'Plain Text')
 * @returns {HTMLElement}
 */
export function createLazyToggleWrapper(text, initialBtnText = 'Formatted') {
  const wrapper = document.createElement('div');
  wrapper.className = 'md-toggle-wrapper';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'md-toggle-btn';
  toggleBtn.textContent = initialBtnText;
  toggleBtn.title = 'Toggle between formatted and plain text';
  wrapper.appendChild(toggleBtn);

  const plainView = document.createElement('pre');
  plainView.className = 'plain-text-view';
  plainView.textContent = text;
  wrapper.appendChild(plainView);

  let mdView = null;

  toggleBtn.addEventListener('click', () => {
    const showingPlain = !plainView.classList.contains('hidden');
    if (showingPlain) {
      if (!mdView) {
        mdView = renderMarkdownContent(text);
        wrapper.appendChild(mdView);
      }
      plainView.classList.add('hidden');
      mdView.classList.remove('hidden');
      toggleBtn.textContent = 'Plain Text';
    } else {
      mdView.classList.add('hidden');
      plainView.classList.remove('hidden');
      toggleBtn.textContent = 'Formatted';
    }
  });

  return wrapper;
}

/**
 * Apply syntax highlighting to a <code> element using highlight.js.
 * Falls back gracefully if hljs is not loaded.
 * @param {HTMLElement} codeEl - The <code> element to highlight
 * @param {string} lang - Language identifier (e.g., 'javascript', 'python')
 */
function applyHighlight(codeEl, lang) {
  if (typeof hljs === 'undefined') return;
  if (lang) {
    codeEl.classList.add(`language-${lang}`);
  }
  hljs.highlightElement(codeEl);
}

/**
 * Escape HTML characters.
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Render text content with basic markdown code block handling.
 */
function renderTextContent(text) {
  const div = document.createElement('div');
  div.className = 'text-content';

  // Split on code blocks (```...```)
  const parts = text.split(/(```[\s\S]*?```)/g);

  for (const part of parts) {
    if (part.startsWith('```')) {
      const codeBlock = document.createElement('div');
      codeBlock.className = 'code-block';

      const content = part.slice(3, -3);
      const firstNewline = content.indexOf('\n');
      const lang = firstNewline > 0 ? content.slice(0, firstNewline).trim() : '';
      const code = firstNewline > 0 ? content.slice(firstNewline + 1) : content;

      const pre = document.createElement('pre');
      const codeEl = document.createElement('code');
      codeEl.textContent = code;
      if (lang) {
        codeEl.dataset.lang = lang;
        applyHighlight(codeEl, lang);
      }
      pre.appendChild(codeEl);
      codeBlock.appendChild(pre);
      codeBlock.appendChild(createCopyButton(code));
      div.appendChild(codeBlock);
    } else if (part.trim()) {
      // Handle inline code
      const span = document.createElement('span');
      span.innerHTML = escapeHtml(part).replace(
        /`([^`]+)`/g,
        '<code class="inline-code">$1</code>'
      );
      div.appendChild(span);
    }
  }

  return div;
}

/**
 * Render text as formatted markdown with syntax coloring.
 * Handles: headings, code blocks (with language label), inline code,
 * bold, italic, links, blockquotes, horizontal rules, and lists.
 */
export function renderMarkdownContent(text) {
  const container = document.createElement('div');
  container.className = 'md-rendered';

  // Detect if it's JSON
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      const pre = document.createElement('pre');
      pre.className = 'md-code-block';
      const code = document.createElement('code');
      code.className = 'md-code lang-json';
      code.textContent = JSON.stringify(parsed, null, 2);
      applyHighlight(code, 'json');
      pre.appendChild(code);
      container.appendChild(pre);
      return container;
    } catch { /* not JSON, continue with markdown */ }
  }

  // Split into code blocks and the rest
  const parts = text.split(/(```[\s\S]*?```)/g);

  for (const part of parts) {
    if (part.startsWith('```')) {
      // Fenced code block
      const content = part.slice(3, -3);
      const firstNewline = content.indexOf('\n');
      const lang = firstNewline > 0 ? content.slice(0, firstNewline).trim() : '';
      const code = firstNewline > 0 ? content.slice(firstNewline + 1) : content;

      const wrapper = document.createElement('div');
      wrapper.className = 'md-code-wrapper';

      if (lang) {
        const langLabel = document.createElement('span');
        langLabel.className = 'md-code-lang';
        langLabel.textContent = lang;
        wrapper.appendChild(langLabel);
      }

      const pre = document.createElement('pre');
      pre.className = 'md-code-block';
      const codeEl = document.createElement('code');
      codeEl.className = `md-code${lang ? ` lang-${lang}` : ''}`;
      codeEl.textContent = code;
      if (lang) applyHighlight(codeEl, lang);
      pre.appendChild(codeEl);
      wrapper.appendChild(pre);
      container.appendChild(wrapper);
    } else {
      // Process markdown lines
      const lines = part.split('\n');
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];

        // Horizontal rule
        if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
          container.appendChild(document.createElement('hr'));
          i++;
          continue;
        }

        // Headings
        const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const el = document.createElement(`h${level}`);
          el.className = 'md-heading';
          el.innerHTML = formatInlineMarkdown(headingMatch[2]);
          container.appendChild(el);
          i++;
          continue;
        }

        // Blockquote
        if (line.trimStart().startsWith('> ')) {
          const bq = document.createElement('blockquote');
          bq.className = 'md-blockquote';
          let bqLines = [];
          while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
            bqLines.push(lines[i].trimStart().slice(2));
            i++;
          }
          bq.innerHTML = formatInlineMarkdown(bqLines.join('\n'));
          container.appendChild(bq);
          continue;
        }

        // Unordered list
        if (/^\s*[-*+]\s+/.test(line)) {
          const ul = document.createElement('ul');
          ul.className = 'md-list';
          while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
            const li = document.createElement('li');
            li.innerHTML = formatInlineMarkdown(lines[i].replace(/^\s*[-*+]\s+/, ''));
            ul.appendChild(li);
            i++;
          }
          container.appendChild(ul);
          continue;
        }

        // Ordered list
        if (/^\s*\d+[.)]\s+/.test(line)) {
          const ol = document.createElement('ol');
          ol.className = 'md-list';
          while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
            const li = document.createElement('li');
            li.innerHTML = formatInlineMarkdown(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
            ol.appendChild(li);
            i++;
          }
          container.appendChild(ol);
          continue;
        }

        // Empty line = paragraph break
        if (line.trim() === '') {
          i++;
          continue;
        }

        // Regular paragraph
        const para = document.createElement('p');
        para.className = 'md-paragraph';
        let paraLines = [];
        while (i < lines.length && lines[i].trim() !== '' &&
               !lines[i].match(/^#{1,6}\s/) &&
               !/^\s*[-*+]\s+/.test(lines[i]) &&
               !/^\s*\d+[.)]\s+/.test(lines[i]) &&
               !lines[i].trimStart().startsWith('> ') &&
               !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())) {
          paraLines.push(lines[i]);
          i++;
        }
        para.innerHTML = formatInlineMarkdown(paraLines.join('\n'));
        container.appendChild(para);
      }
    }
  }

  return container;
}

/**
 * Format inline markdown: bold, italic, inline code, links.
 */
function formatInlineMarkdown(text) {
  return escapeHtml(text)
    // Inline code (must come first to prevent inner formatting)
    .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="md-bold">$1</strong>')
    .replace(/__(.+?)__/g, '<strong class="md-bold">$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em class="md-italic">$1</em>')
    .replace(/_(.+?)_/g, '<em class="md-italic">$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank">$1</a>')
    // Preserve newlines within paragraphs
    .replace(/\n/g, '<br>');
}

/**
 * File extension → code language mapping for syntax highlighting.
 */
const EXT_LANG_MAP = {
  '.json': 'json',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.jsx': 'javascript',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.xml': 'xml',
  '.svg': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.py': 'python',
  '.java': 'java',
  '.cs': 'csharp',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.r': 'r',
  '.lua': 'lua',
  '.md': null, // markdown renders via renderMarkdownContent
  '.txt': null,
};

/**
 * Detect code language from a Read-type tool's input file path.
 * Returns language string or null (for markdown fallback).
 */
function detectLangFromToolInput(toolName, input) {
  if (!toolName || !input) return null;
  // Only detect for Read-type tools
  const name = toolName.toLowerCase();
  if (name !== 'read' && name !== 'readfile' && name !== 'read_file') return null;
  // Extract file path from input
  const filePath = typeof input === 'string' ? input : (input.file_path || input.path || input.filePath || '');
  if (!filePath) return null;
  const dotIdx = filePath.lastIndexOf('.');
  if (dotIdx < 0) return null;
  const ext = filePath.slice(dotIdx).toLowerCase();
  return EXT_LANG_MAP.hasOwnProperty(ext) ? EXT_LANG_MAP[ext] : null;
}

/**
 * Render a single content block.
 */
function renderContentBlock(block, toolUseMap) {
  if (block.type === 'text') {
    return renderTextContent(block.text || '');
  }

  if (block.type === 'tool_use') {
    const div = document.createElement('div');
    div.className = 'tool-use-block';

    const header = document.createElement('div');
    header.className = 'tool-use-header';
    header.textContent = `Tool Call: ${block.name || 'unknown'}${block.id ? ` (${block.id})` : ''}`;
    div.appendChild(header);

    if (block.input) {
      const details = document.createElement('details');
      details.className = 'collapsible';
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = 'Input';
      const badge = document.createElement('span');
      badge.className = 'collapsible-badge';
      badge.textContent = typeof block.input === 'string'
        ? `${block.input.length} chars`
        : `${Object.keys(block.input).length} keys`;
      summary.appendChild(badge);
      details.appendChild(summary);

      const content = document.createElement('div');
      content.className = 'collapsible-content';
      content.appendChild(createJsonView(block.input));
      details.appendChild(content);
      div.appendChild(details);
    }

    return div;
  }

  if (block.type === 'tool_result') {
    const div = document.createElement('div');
    div.className = 'tool-result-block';

    // Look up linked tool_use info
    const toolInfo = (toolUseMap && block.tool_use_id) ? toolUseMap.get(block.tool_use_id) : null;
    const toolName = toolInfo?.name || 'unknown';

    // Header with tool name and id (always visible)
    const header = document.createElement('div');
    header.className = 'tool-result-header';
    header.textContent = `Tool Result: ${toolName}${block.tool_use_id ? ` (${block.tool_use_id})` : ''}`;
    div.appendChild(header);

    // Show linked tool input (always visible, outside collapsible)
    if (toolInfo?.input) {
      const inputSection = document.createElement('div');
      inputSection.className = 'tool-result-linked-input';
      const inputLabel = document.createElement('div');
      inputLabel.className = 'tool-result-input-label';
      inputLabel.textContent = 'Input';
      inputSection.appendChild(inputLabel);
      inputSection.appendChild(createJsonView(toolInfo.input));
      div.appendChild(inputSection);
    }

    // Collapsible content section (hidden by default, rendered lazily on first expand)
    if (block.content) {
      // Detect language from linked Read tool input
      const detectedLang = detectLangFromToolInput(toolName, toolInfo?.input);

      const contentHeader = document.createElement('div');
      contentHeader.className = 'tool-result-content-header';
      contentHeader.style.cursor = 'pointer';

      const toggleIcon = document.createElement('span');
      toggleIcon.className = 'tool-result-toggle-icon';
      toggleIcon.textContent = '\u25B6';
      contentHeader.appendChild(toggleIcon);

      const contentLabel = document.createElement('span');
      contentLabel.textContent = detectedLang ? `Content (${detectedLang})` : 'Content';
      contentHeader.appendChild(contentLabel);
      div.appendChild(contentHeader);

      const body = document.createElement('div');
      body.className = 'tool-result-body hidden';
      let bodyRendered = false;

      contentHeader.addEventListener('click', () => {
        const isHidden = body.classList.contains('hidden');

        // Lazy render: build body content on first expand
        if (isHidden && !bodyRendered) {
          bodyRendered = true;
          renderToolResultBody(body, block, toolName, toolInfo, toolUseMap, detectedLang);
        }

        body.classList.toggle('hidden');
        toggleIcon.textContent = isHidden ? '\u25BC' : '\u25B6';
      });

      div.appendChild(body);
    }

    return div;
  }

  // Fallback: show raw JSON
  const div = document.createElement('div');
  div.className = 'content-block';
  div.appendChild(createJsonView(block));
  return div;
}

/**
 * Render the content body of a tool_result block.
 * Extracted so it can be called lazily on first expand.
 */
function renderToolResultBody(body, block, toolName, toolInfo, toolUseMap, detectedLang) {
  const contentBlocks = normalizeContent(block.content);
  for (const cb of contentBlocks) {
    if (cb.type === 'text') {
      const rawText = cb.text || '';
      const trimmedText = rawText.trim();

      // Try to detect if content is JSON
      if ((trimmedText.startsWith('{') || trimmedText.startsWith('[')) && trimmedText.length > 1) {
        try {
          const parsed = JSON.parse(trimmedText);
          body.appendChild(createJsonView(parsed));
          continue;
        } catch {
          // Not valid JSON, fall through
        }
      }

      // Use pre-detected language for syntax highlighting
      if (detectedLang) {
        // Render as syntax-highlighted code block (no lang label — shown in header)
        const wrapper = document.createElement('div');
        wrapper.className = 'md-toggle-wrapper';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'md-toggle-btn';
        toggleBtn.textContent = 'Plain Text';
        toggleBtn.title = 'Toggle between formatted and plain text';

        const codeWrapper = document.createElement('div');
        codeWrapper.className = 'md-code-wrapper';
        const pre = document.createElement('pre');
        pre.className = 'md-code-block';
        const codeEl = document.createElement('code');
        codeEl.className = `md-code lang-${detectedLang}`;
        codeEl.textContent = rawText;
        applyHighlight(codeEl, detectedLang);
        pre.appendChild(codeEl);
        codeWrapper.appendChild(pre);

        const plainView = document.createElement('pre');
        plainView.className = 'plain-text-view hidden';
        plainView.textContent = rawText;

        toggleBtn.addEventListener('click', () => {
          const showingCode = !codeWrapper.classList.contains('hidden');
          if (showingCode) {
            codeWrapper.classList.add('hidden');
            plainView.classList.remove('hidden');
            toggleBtn.textContent = 'Formatted';
          } else {
            plainView.classList.add('hidden');
            codeWrapper.classList.remove('hidden');
            toggleBtn.textContent = 'Plain Text';
          }
        });

        wrapper.appendChild(toggleBtn);
        wrapper.appendChild(codeWrapper);
        wrapper.appendChild(plainView);
        body.appendChild(wrapper);
      } else {
        body.appendChild(createLazyToggleWrapper(rawText));
      }
    } else {
      body.appendChild(renderContentBlock(cb, toolUseMap));
    }
  }
}

/**
 * Render the entry list sidebar items.
 */
export function renderEntryList(entries, container, onSelect) {
  container.innerHTML = '';

  entries.forEach((entry, i) => {
    const item = document.createElement('div');
    item.className = 'entry-item';
    item.dataset.index = i;

    const req = entry.anthropicRequest || {};
    const model = req.model || 'unknown';
    const time = entry.timestamp ? new Date(entry.timestamp) : null;
    const timeStr = time
      ? time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : 'N/A';

    const msgCount = req.messages?.length || 0;
    const toolCount = getTools(entry).length;

    item.innerHTML = `
      <div class="entry-item-header">
        <span class="entry-item-index">#${entry._index}</span>
        <span class="entry-item-time">${escapeHtml(timeStr)}</span>
      </div>
      <div class="entry-item-model">
        <span class="model-badge ${modelBadgeClass(model)}">${escapeHtml(modelLabel(model))}</span>
        <span style="font-size:12px;color:var(--text-secondary);margin-left:4px;">${escapeHtml(model)}</span>
      </div>
      <div class="entry-item-meta">
        <span>${msgCount} msg${msgCount !== 1 ? 's' : ''}</span>
        ${toolCount > 0 ? `<span>${toolCount} tools</span>` : ''}
        ${entry.streaming ? '<span>streaming</span>' : ''}
      </div>
    `;

    item.addEventListener('click', () => onSelect(i));
    container.appendChild(item);
  });
}

/**
 * Render the detail header for a selected entry.
 */
export function renderDetailHeader(entry, container) {
  const req = entry.anthropicRequest || {};
  container.innerHTML = '';

  const items = [
    { label: 'Model', value: req.model || 'N/A' },
    { label: 'Time', value: formatTimestamp(entry.timestamp) },
    { label: 'Streaming', value: entry.streaming ? 'Yes' : 'No' },
    { label: 'Max Tokens', value: req.max_tokens || 'N/A' },
    { label: 'Temperature', value: req.temperature ?? 'N/A' },
  ];

  for (const { label, value } of items) {
    const div = document.createElement('div');
    div.className = 'detail-header-item';
    div.innerHTML = `<span class="label">${escapeHtml(label)}</span> <span class="value">${escapeHtml(String(value))}</span>`;
    container.appendChild(div);
  }
}

/**
 * Render the Messages tab content.
 */
export function renderMessagesTab(entry) {
  const container = document.createElement('div');
  const messages = entry.anthropicRequest?.messages || [];

  if (messages.length === 0) {
    container.textContent = 'No messages in this entry.';
    return container;
  }

  // Build a map of tool_use id → { name, input } for tool_result lookups
  const toolUseMap = new Map();
  for (const msg of messages) {
    const blocks = normalizeContent(msg.content);
    for (const block of blocks) {
      if (block.type === 'tool_use' && block.id) {
        toolUseMap.set(block.id, { name: block.name || 'unknown', input: block.input || null });
      }
    }
  }

  for (const msg of messages) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${msg.role}`;

    const header = document.createElement('div');
    header.className = 'message-header';
    header.style.cursor = 'pointer';

    const roleSpan = document.createElement('span');
    roleSpan.textContent = msg.role.toUpperCase();
    header.appendChild(roleSpan);

    // Preview text for collapsed state
    const blocks = normalizeContent(msg.content);
    let previewText = '';
    for (const block of blocks) {
      if (block.type === 'text' && block.text && block.text.trim()) {
        previewText = block.text.substring(0, 80).replace(/\n/g, ' ');
        break;
      } else if (block.type === 'thinking') {
        previewText = 'Thinking...';
        break;
      } else if (block.type === 'tool_use') {
        previewText = `Tool: ${block.name || 'unknown'}`;
        break;
      } else if (block.type === 'tool_result') {
        const toolInfo = block.tool_use_id ? toolUseMap.get(block.tool_use_id) : null;
        previewText = `Tool Result: ${toolInfo?.name || 'unknown'}`;
        break;
      }
    }
    const previewSpan = document.createElement('span');
    previewSpan.className = 'message-preview';
    previewSpan.textContent = previewText + (previewText.length >= 80 ? '...' : '');
    header.appendChild(previewSpan);

    const jsonToggleBtn = document.createElement('button');
    jsonToggleBtn.className = 'msg-json-btn';
    jsonToggleBtn.textContent = '{ }';
    jsonToggleBtn.title = 'Show raw JSON';
    header.appendChild(jsonToggleBtn);

    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'message-toggle-icon';
    toggleIcon.textContent = '\u25B6';
    header.appendChild(toggleIcon);

    const body = document.createElement('div');
    body.className = 'message-body hidden';

    const formattedBody = document.createElement('div');
    const jsonBody = document.createElement('div');
    jsonBody.className = 'hidden';
    body.appendChild(formattedBody);
    body.appendChild(jsonBody);

    let bodyRendered = false;
    let jsonRendered = false;
    let showingJson = false;

    header.addEventListener('click', () => {
      const isHidden = body.classList.contains('hidden');

      // Lazy render: build formatted message body on first expand
      if (isHidden && !bodyRendered) {
        bodyRendered = true;
        renderMessageBody(formattedBody, msg, blocks, toolUseMap);
      }

      body.classList.toggle('hidden');
      toggleIcon.textContent = isHidden ? '\u25BC' : '\u25B6';
      previewSpan.classList.toggle('hidden', isHidden);
    });

    jsonToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showingJson = !showingJson;

      // Expand the body if it is currently collapsed
      if (body.classList.contains('hidden')) {
        body.classList.remove('hidden');
        toggleIcon.textContent = '\u25BC';
        previewSpan.classList.add('hidden');
      }

      if (showingJson) {
        // Lazy render the JSON view on first toggle
        if (!jsonRendered) {
          jsonRendered = true;
          jsonBody.appendChild(createJsonView(msg));
        }
        // Ensure the formatted body is also rendered for when the user switches back
        if (!bodyRendered) {
          bodyRendered = true;
          renderMessageBody(formattedBody, msg, blocks, toolUseMap);
        }
        formattedBody.classList.add('hidden');
        jsonBody.classList.remove('hidden');
        jsonToggleBtn.textContent = 'Formatted';
        jsonToggleBtn.title = 'Show formatted view';
      } else {
        formattedBody.classList.remove('hidden');
        jsonBody.classList.add('hidden');
        jsonToggleBtn.textContent = '{ }';
        jsonToggleBtn.title = 'Show raw JSON';
      }
    });

    msgDiv.appendChild(header);
    msgDiv.appendChild(body);
    container.appendChild(msgDiv);
  }

  // Expand the last user message by default and scroll to it
  const allMessages = container.querySelectorAll('.message');
  let lastUserMsg = null;
  for (const m of allMessages) {
    if (m.classList.contains('user')) lastUserMsg = m;
  }
  const expandTarget = lastUserMsg || container.lastElementChild;
  if (expandTarget) {
    const targetHeader = expandTarget.querySelector('.message-header');
    if (targetHeader) targetHeader.click();
  }

  return container;
}

/**
 * Render the body content of a single message.
 * Called lazily on first expand to avoid building DOM for collapsed messages.
 */
function renderMessageBody(body, msg, blocks, toolUseMap) {
  // Pre-process blocks: group all thinking blocks together, skip empty text blocks
  const processedBlocks = [];
  const thinkingTexts = [];
  let thinkingInserted = false;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === 'text' && (!block.text || !block.text.trim())) continue;
    if (block.type === 'thinking') {
      if (block.thinking) thinkingTexts.push(block.thinking);
      continue;
    }
    if (!thinkingInserted && thinkingTexts.length > 0) {
      processedBlocks.push({ type: '_thinking_group', text: thinkingTexts.join('') });
      thinkingInserted = true;
    }
    processedBlocks.push(block);
  }
  if (!thinkingInserted && thinkingTexts.length > 0) {
    processedBlocks.push({ type: '_thinking_group', text: thinkingTexts.join('') });
  }

  for (const block of processedBlocks) {
    if (block.type === '_thinking_group') {
      const thinkDiv = document.createElement('div');
      thinkDiv.className = 'thinking-block';

      const thinkHeader = document.createElement('div');
      thinkHeader.className = 'thinking-header';
      thinkHeader.style.cursor = 'pointer';

      const thinkIcon = document.createElement('span');
      thinkIcon.className = 'tool-result-toggle-icon';
      thinkIcon.textContent = '\u25B6';
      thinkHeader.appendChild(thinkIcon);

      const thinkLabel = document.createElement('span');
      thinkLabel.textContent = 'Thinking';
      thinkHeader.appendChild(thinkLabel);
      thinkDiv.appendChild(thinkHeader);

      const thinkBody = document.createElement('div');
      thinkBody.className = 'thinking-body hidden';
      let thinkRendered = false;

      thinkHeader.addEventListener('click', () => {
        const isHidden = thinkBody.classList.contains('hidden');
        if (isHidden && !thinkRendered) {
          thinkRendered = true;
          thinkBody.appendChild(createLazyToggleWrapper(block.text));
        }
        thinkBody.classList.toggle('hidden');
        thinkIcon.textContent = isHidden ? '\u25BC' : '\u25B6';
      });

      thinkDiv.appendChild(thinkBody);
      body.appendChild(thinkDiv);
    } else if (block.type === 'text' && msg.role === 'user') {
      body.appendChild(createLazyToggleWrapper(block.text || ''));
    } else {
      body.appendChild(renderContentBlock(block, toolUseMap));
    }
  }
}

/**
 * Render the System Prompts tab content.
 */
export function renderSystemTab(entry) {
  const container = document.createElement('div');
  const system = entry.anthropicRequest?.system || [];

  if (system.length === 0) {
    container.textContent = 'No system prompts in this entry.';
    return container;
  }

  system.forEach((s, i) => {
    const details = document.createElement('details');
    details.className = 'collapsible';

    const summary = document.createElement('summary');
    const text = s.text || s.content || JSON.stringify(s);
    const preview = text.substring(0, 80).replace(/\n/g, ' ');
    summary.textContent = `System Prompt #${i + 1}: ${preview}...`;

    const badge = document.createElement('span');
    badge.className = 'collapsible-badge';
    badge.textContent = `${text.length} chars`;
    summary.appendChild(badge);

    const content = document.createElement('div');
    content.className = 'collapsible-content';
    let contentRendered = false;

    // Lazy render: build content on first expand
    details.addEventListener('toggle', () => {
      if (details.open && !contentRendered) {
        contentRendered = true;
        content.appendChild(createLazyToggleWrapper(text));
      }
    });

    details.appendChild(summary);
    details.appendChild(content);
    container.appendChild(details);
  });

  return container;
}

/**
 * Render the Tools tab content.
 */
export function renderToolsTab(entry, searchTerm = '') {
  const container = document.createElement('div');
  const tools = getTools(entry);

  if (tools.length === 0) {
    container.textContent = 'No tools defined in this entry.';
    return container;
  }

  const lowerSearch = searchTerm.toLowerCase();
  let firstMatch = null;

  tools.forEach((tool) => {
    const details = document.createElement('details');
    details.className = 'tool-card';

    // Auto-expand if tool matches search term
    const nameMatches = lowerSearch && (tool.name || '').toLowerCase().includes(lowerSearch);
    const descMatches = lowerSearch && (tool.description || '').toLowerCase().includes(lowerSearch);
    if (nameMatches || descMatches) {
      details.open = true;
      if (!firstMatch) firstMatch = details;
    }

    const summary = document.createElement('summary');
    summary.textContent = tool.name || 'unnamed';

    const content = document.createElement('div');
    content.className = 'tool-card-content';
    let toolContentRendered = false;

    // Lazy render: build description + schema on first expand
    function renderToolContent() {
      if (toolContentRendered) return;
      toolContentRendered = true;

      if (tool.description) {
        const desc = document.createElement('div');
        desc.style.marginBottom = '8px';
        desc.appendChild(createLazyToggleWrapper(tool.description, 'Formatted'));
        content.appendChild(desc);
      }

      if (tool.input_schema) {
        const schemaDetails = document.createElement('details');
        schemaDetails.className = 'collapsible';
        schemaDetails.open = true;
        const schemaSummary = document.createElement('summary');
        schemaSummary.textContent = 'Input Schema';
        schemaDetails.appendChild(schemaSummary);
        const schemaContent = document.createElement('div');
        schemaContent.className = 'collapsible-content';
        schemaContent.appendChild(createJsonView(tool.input_schema));
        schemaDetails.appendChild(schemaContent);
        content.appendChild(schemaDetails);
      }
    }

    details.addEventListener('toggle', () => {
      if (details.open) renderToolContent();
    });

    // If auto-expanded by search, render immediately
    if (details.open) renderToolContent();

    details.appendChild(summary);
    details.appendChild(content);
    container.appendChild(details);
  });

  // Scroll to first matching tool
  if (firstMatch) {
    requestAnimationFrame(() => {
      firstMatch.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return container;
}

/**
 * Render the Request Comparison tab.
 * @param {object} entry
 * @param {object} callbacks - { onSwitchTab, onShowContent }
 */
export function renderRequestTab(entry, callbacks = {}) {
  const container = document.createElement('div');

  const grid = document.createElement('div');
  grid.className = 'comparison-grid';

  // Anthropic Request
  const anthropicCol = document.createElement('div');
  anthropicCol.className = 'comparison-column';
  const anthropicTitle = document.createElement('h3');
  anthropicTitle.textContent = 'Anthropic Request';
  anthropicCol.appendChild(anthropicTitle);
  if (entry.anthropicRequest) {
    const summary = { ...entry.anthropicRequest };
    const anthropicLinks = [];

    summary.messages = (summary.messages || []).map((m, i) => {
      const blocks = normalizeContent(m.content);
      const fullText = blocks.map(b => b.text || JSON.stringify(b)).join('\n');
      const placeholder = `__LINK_MSG_${i}__`;
      anthropicLinks.push({
        placeholder,
        label: `[${fullText.length} chars]`,
        action: () => {
          if (callbacks.onShowContent) callbacks.onShowContent(`Message #${i + 1} (${m.role})`, fullText);
        },
      });
      return { role: m.role, content: placeholder, _index: i };
    });

    summary.system = (summary.system || []).map((s, i) => {
      const text = s.text || s.content || JSON.stringify(s);
      const placeholder = `__LINK_SYS_${i}__`;
      anthropicLinks.push({
        placeholder,
        label: `[${text.length} chars]`,
        action: () => {
          if (callbacks.onShowContent) callbacks.onShowContent(`System Prompt #${i + 1}`, text);
        },
      });
      return { type: s.type, text: placeholder, _index: i };
    });

    // Get tools from cache if needed
    const tools = getTools(entry);
    const toolCount = tools.length;
    const toolPlaceholder = `__LINK_TOOLS__`;
    anthropicLinks.push({
      placeholder: toolPlaceholder,
      label: `[${toolCount} tools]`,
      action: () => {
        if (callbacks.onSwitchTab) callbacks.onSwitchTab('tools');
      },
    });
    summary.tools = toolPlaceholder;
    // Remove cache ID from display
    delete summary._toolsCacheId;

    anthropicCol.appendChild(createLinkedJsonView(summary, anthropicLinks));
  }

  // OpenAI Request
  const openaiCol = document.createElement('div');
  openaiCol.className = 'comparison-column';
  const openaiTitle = document.createElement('h3');
  openaiTitle.textContent = 'OpenAI Request';
  openaiCol.appendChild(openaiTitle);
  if (entry.openaiRequest) {
    const summary = { ...entry.openaiRequest };
    const openaiLinks = [];

    summary.messages = (summary.messages || []).map((m, i) => {
      const content = m.content || '';
      const placeholder = `__LINK_MSG_${i}__`;
      openaiLinks.push({
        placeholder,
        label: `[${content.length} chars]`,
        action: () => {
          if (callbacks.onShowContent) callbacks.onShowContent(`Message #${i + 1} (${m.role})`, content);
        },
      });
      return { role: m.role, content: placeholder, _index: i };
    });

    const toolCount = (summary.tools || []).length;
    const toolPlaceholder = `__LINK_TOOLS__`;
    openaiLinks.push({
      placeholder: toolPlaceholder,
      label: `[${toolCount} tools]`,
      action: () => {
        if (callbacks.onSwitchTab) callbacks.onSwitchTab('tools');
      },
    });
    summary.tools = toolPlaceholder;

    openaiCol.appendChild(createLinkedJsonView(summary, openaiLinks));
  }

  grid.appendChild(anthropicCol);
  grid.appendChild(openaiCol);
  container.appendChild(grid);

  return container;
}

/**
 * Create a JSON view with clickable links embedded inline.
 * @param {object} obj - The object to display as JSON
 * @param {Array} links - Array of { placeholder, label, action }
 */
function createLinkedJsonView(obj, links) {
  const container = document.createElement('div');
  container.className = 'json-view-container';

  const pre = document.createElement('div');
  pre.className = 'json-view';

  const jsonText = JSON.stringify(obj, null, 2);

  // Split the JSON text by placeholders and build DOM with links
  let remaining = jsonText;
  const fragment = document.createDocumentFragment();

  // Find all placeholder positions and sort by appearance order
  const occurrences = [];
  for (const link of links) {
    // Placeholder appears quoted in JSON: "__LINK_..."
    const quoted = `"${link.placeholder}"`;
    let startIdx = remaining.indexOf(quoted);
    if (startIdx === -1) {
      // Try without quotes (shouldn't happen but fallback)
      startIdx = remaining.indexOf(link.placeholder);
      if (startIdx !== -1) {
        occurrences.push({ idx: startIdx, len: link.placeholder.length, link });
      }
    } else {
      occurrences.push({ idx: startIdx, len: quoted.length, link });
    }
  }
  occurrences.sort((a, b) => a.idx - b.idx);

  let cursor = 0;
  for (const occ of occurrences) {
    // Add text before this link
    if (occ.idx > cursor) {
      const textNode = document.createTextNode(remaining.slice(cursor, occ.idx));
      fragment.appendChild(textNode);
    }

    // Add the clickable link
    const a = document.createElement('a');
    a.className = 'json-inline-link';
    a.href = '#';
    a.textContent = occ.link.label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      occ.link.action();
    });
    fragment.appendChild(a);

    cursor = occ.idx + occ.len;
  }

  // Add remaining text
  if (cursor < remaining.length) {
    fragment.appendChild(document.createTextNode(remaining.slice(cursor)));
  }

  pre.appendChild(fragment);
  container.appendChild(pre);
  container.appendChild(createCopyButton(jsonText));

  // Scroll to bottom after render
  requestAnimationFrame(() => {
    pre.scrollTop = pre.scrollHeight;
  });

  return container;
}

/**
 * Render the Response tab.
 */
export function renderResponseTab(entry) {
  const container = document.createElement('div');
  // Cache parsed SSE result to avoid re-parsing on every tab switch
  if (!entry._parsedResponse) {
    entry._parsedResponse = parseSSEResponse(entry.copilotResponse);
  }
  const parsed = entry._parsedResponse;

  // Assembled content (collapsible, expanded by default)
  const contentSection = document.createElement('div');
  contentSection.className = 'response-content';

  const contentHeader = document.createElement('div');
  contentHeader.className = 'response-section-header';

  const contentTitle = document.createElement('h3');
  contentTitle.textContent = 'Assembled Response';
  contentHeader.appendChild(contentTitle);

  const contentArrow = document.createElement('span');
  contentArrow.className = 'response-section-arrow';
  contentArrow.textContent = '\u25BC';
  contentHeader.appendChild(contentArrow);

  contentSection.appendChild(contentHeader);

  const contentBody = document.createElement('div');

  if (parsed.content) {
    contentBody.appendChild(createLazyToggleWrapper(parsed.content));
  } else {
    const empty = document.createElement('div');
    empty.style.color = 'var(--text-muted)';
    empty.textContent = 'No content extracted from response.';
    contentBody.appendChild(empty);
  }

  contentHeader.addEventListener('click', () => {
    const isHidden = contentBody.classList.contains('hidden');
    contentBody.classList.toggle('hidden');
    contentArrow.textContent = isHidden ? '\u25BC' : '\u25B6';
  });

  contentSection.appendChild(contentBody);
  container.appendChild(contentSection);

  // Usage stats (collapsible, expanded by default)
  if (parsed.usage) {
    const usageSection = document.createElement('div');
    usageSection.style.marginBottom = '16px';

    const usageHeader = document.createElement('div');
    usageHeader.className = 'response-section-header';

    const usageTitle = document.createElement('h3');
    usageTitle.textContent = 'Usage Statistics';
    usageHeader.appendChild(usageTitle);

    const usageArrow = document.createElement('span');
    usageArrow.className = 'response-section-arrow';
    usageArrow.textContent = '\u25BC';
    usageHeader.appendChild(usageArrow);

    usageSection.appendChild(usageHeader);

    const usageBody = document.createElement('div');

    // Response model (shown before the table)
    if (parsed.model) {
      const modelInfo = document.createElement('div');
      modelInfo.style.fontSize = '20px';
      modelInfo.style.marginBottom = '8px';
      modelInfo.style.color = 'var(--text-secondary)';
      modelInfo.innerHTML = `Response Model: <strong style="color:var(--text-primary)">${escapeHtml(parsed.model)}</strong>`;
      usageBody.appendChild(modelInfo);
    }

    const table = document.createElement('table');
    table.className = 'usage-table';

    const usageItems = [
      { label: 'Prompt Tokens', value: parsed.usage.prompt_tokens },
      { label: 'Completion Tokens', value: parsed.usage.completion_tokens },
      { label: 'Total Tokens', value: parsed.usage.total_tokens },
    ];

    if (parsed.usage.prompt_tokens_details?.cached_tokens != null) {
      usageItems.push({
        label: 'Cached Tokens',
        value: parsed.usage.prompt_tokens_details.cached_tokens,
      });
    }

    for (const { label, value } of usageItems) {
      if (value == null) continue;
      const row = document.createElement('tr');
      row.innerHTML = `<td class="usage-table-label">${escapeHtml(label)}</td><td class="usage-table-value">${Number(value).toLocaleString()}</td>`;
      table.appendChild(row);
    }
    usageBody.appendChild(table);

    usageHeader.addEventListener('click', () => {
      const isHidden = usageBody.classList.contains('hidden');
      usageBody.classList.toggle('hidden');
      usageArrow.textContent = isHidden ? '\u25BC' : '\u25B6';
    });

    usageSection.appendChild(usageBody);
    container.appendChild(usageSection);
  }

  // SSE Response section with formatted/raw toggle (collapsible, expanded by default)
  if (entry.copilotResponse) {
    const sseSection = document.createElement('div');
    sseSection.style.marginTop = '16px';

    const sseHeader = document.createElement('div');
    sseHeader.className = 'response-section-header';

    const sseTitle = document.createElement('h3');
    sseTitle.textContent = 'SSE Response';
    sseHeader.appendChild(sseTitle);

    const sseRight = document.createElement('div');
    sseRight.className = 'response-section-header-right';

    const sseArrow = document.createElement('span');
    sseArrow.className = 'response-section-arrow';
    sseArrow.textContent = '\u25BC';
    sseRight.appendChild(sseArrow);

    const sseToggleBtn = document.createElement('button');
    sseToggleBtn.className = 'sse-toggle-btn';
    sseToggleBtn.textContent = 'Raw';
    sseToggleBtn.title = 'Toggle between formatted and raw SSE';
    sseToggleBtn.addEventListener('click', (e) => e.stopPropagation());
    sseRight.appendChild(sseToggleBtn);

    sseHeader.appendChild(sseRight);
    sseSection.appendChild(sseHeader);

    const sseBody = document.createElement('div');
    renderSseBody(sseBody, parsed, entry, sseToggleBtn);

    sseHeader.addEventListener('click', () => {
      const isHidden = sseBody.classList.contains('hidden');
      sseBody.classList.toggle('hidden');
      sseArrow.textContent = isHidden ? '\u25BC' : '\u25B6';
    });

    sseSection.appendChild(sseBody);
    container.appendChild(sseSection);
  }

  return container;
}

/**
 * Render the SSE Response body content (formatted + raw views).
 * Called lazily on first expand.
 */
function renderSseBody(sseBody, parsed, entry, sseToggleBtn) {
    // === Formatted SSE view (default, visible) ===
    const formattedView = document.createElement('div');
    formattedView.className = 'sse-formatted-view';

    // Header properties table (id, model, created)
    const firstChunk = parsed.chunks[0];
    if (firstChunk) {
      const metaTable = document.createElement('table');
      metaTable.className = 'usage-table';
      metaTable.style.marginBottom = '12px';

      const metaItems = [];
      if (parsed.id) metaItems.push({ label: 'ID', value: parsed.id });
      if (parsed.model) metaItems.push({ label: 'Model', value: parsed.model });
      if (firstChunk.created) {
        const createdDate = new Date(firstChunk.created * 1000);
        metaItems.push({ label: 'Created', value: createdDate.toLocaleString() });
      }
      if (firstChunk.system_fingerprint) metaItems.push({ label: 'System Fingerprint', value: firstChunk.system_fingerprint });

      for (const { label, value } of metaItems) {
        const row = document.createElement('tr');
        const labelTd = document.createElement('td');
        labelTd.className = 'usage-table-label';
        labelTd.textContent = label;
        const valueTd = document.createElement('td');
        valueTd.className = 'usage-table-value sse-meta-value';
        valueTd.textContent = String(value);
        row.appendChild(labelTd);
        row.appendChild(valueTd);
        metaTable.appendChild(row);
      }
      formattedView.appendChild(metaTable);
    }

    // Delta groups — group consecutive rows of the same type
    if (parsed.deltaRows.length > 0) {
      const groups = [];
      let currentGroup = null;

      for (const row of parsed.deltaRows) {
        const groupType = row.type || 'content';
        if (!currentGroup || currentGroup.type !== groupType) {
          currentGroup = { type: groupType, rows: [] };
          groups.push(currentGroup);
        }
        currentGroup.rows.push(row);
      }

      const deltaSection = document.createElement('div');
      deltaSection.className = 'sse-delta-groups';

      groups.forEach((group, gi) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'sse-delta-group';

        if (group.type === 'content' || group.type === 'reasoning_text') {
          // Concatenate all text values
          const allText = group.rows.map(r => {
            const field = r.fields.find(f => f.label === group.type);
            return field ? field.value : '';
          }).join('');

          // Title
          const titleDiv = document.createElement('div');
          titleDiv.className = 'sse-delta-group-title';
          titleDiv.textContent = group.type === 'content' ? 'Content' : 'Reasoning';
          groupDiv.appendChild(titleDiv);

          // Grouped text with Formatted / Plain Text toggle
          groupDiv.appendChild(createLazyToggleWrapper(allText));

          // Collapsible detail: individual chunks
          if (group.rows.length > 1) {
            const details = document.createElement('details');
            details.className = 'sse-delta-detail';
            const detailSummary = document.createElement('summary');
            detailSummary.textContent = `Show ${group.rows.length} individual chunks`;
            details.appendChild(detailSummary);

            const chunkList = document.createElement('div');
            chunkList.className = 'sse-delta-chunk-list';
            group.rows.forEach((row) => {
              const pre = document.createElement('pre');
              pre.className = 'sse-delta-chunk-json';
              const originalChunk = parsed.chunks[row.chunkIndex];
              pre.textContent = originalChunk ? JSON.stringify(originalChunk) : '';
              chunkList.appendChild(pre);
            });
            details.appendChild(chunkList);
            groupDiv.appendChild(details);
          }

        } else if (group.type === 'function') {
          // Group function rows by function id
          const funcCalls = [];
          let currentFunc = null;

          for (const row of group.rows) {
            const idField = row.fields.find(f => f.label === 'function id');
            const nameField = row.fields.find(f => f.label === 'function name');

            // New function call starts when we see a function id
            if (idField) {
              currentFunc = { id: idField.value, name: '', args: '', rowCount: 0 };
              funcCalls.push(currentFunc);
              if (nameField) currentFunc.name = nameField.value;
            }

            // If no current function yet, create a default one
            if (!currentFunc) {
              currentFunc = { id: '', name: '', args: '', rowCount: 0 };
              funcCalls.push(currentFunc);
            }

            currentFunc.rowCount++;

            // Accumulate name and arguments
            if (!idField && nameField) {
              currentFunc.name = nameField.value;
            }
            const argsField = row.fields.find(f => f.label === 'function arguments');
            if (argsField) {
              currentFunc.args += argsField.value;
            }
          }

          for (const fc of funcCalls) {
            const funcDiv = document.createElement('div');
            funcDiv.className = 'sse-delta-func';

            // Title
            const titleDiv = document.createElement('div');
            titleDiv.className = 'sse-delta-group-title';
            titleDiv.textContent = 'Function';
            funcDiv.appendChild(titleDiv);

            // Fields grid
            const fieldsGrid = document.createElement('div');
            fieldsGrid.className = 'sse-delta-func-grid';

            if (fc.id) {
              const idLabel = document.createElement('span');
              idLabel.className = 'sse-delta-func-label';
              idLabel.textContent = 'Id';
              fieldsGrid.appendChild(idLabel);
              const idSep = document.createElement('span');
              idSep.className = 'sse-delta-func-sep';
              idSep.textContent = ':';
              fieldsGrid.appendChild(idSep);
              const idVal = document.createElement('span');
              idVal.className = 'sse-delta-func-value';
              idVal.textContent = fc.id;
              fieldsGrid.appendChild(idVal);
            }

            if (fc.name) {
              const nameLabel = document.createElement('span');
              nameLabel.className = 'sse-delta-func-label';
              nameLabel.textContent = 'Name';
              fieldsGrid.appendChild(nameLabel);
              const nameSep = document.createElement('span');
              nameSep.className = 'sse-delta-func-sep';
              nameSep.textContent = ':';
              fieldsGrid.appendChild(nameSep);
              const nameVal = document.createElement('span');
              nameVal.className = 'sse-delta-func-value';
              nameVal.textContent = fc.name;
              fieldsGrid.appendChild(nameVal);
            }

            if (fc.args) {
              const argsLabel = document.createElement('span');
              argsLabel.className = 'sse-delta-func-label';
              argsLabel.textContent = 'Arguments';
              fieldsGrid.appendChild(argsLabel);
              const argsSep = document.createElement('span');
              argsSep.className = 'sse-delta-func-sep';
              argsSep.textContent = ':';
              fieldsGrid.appendChild(argsSep);
              const argsVal = document.createElement('span');
              argsVal.className = 'sse-delta-func-value';
              fieldsGrid.appendChild(argsVal);
            }

            funcDiv.appendChild(fieldsGrid);

            if (fc.args) {
              const pre = document.createElement('pre');
              pre.className = 'sse-delta-json';
              try {
                pre.textContent = JSON.stringify(JSON.parse(fc.args), null, 2);
              } catch {
                pre.textContent = fc.args;
              }
              funcDiv.appendChild(pre);
            }

            // Show individual chunks toggle
            if (fc.rowCount > 1) {
              const details = document.createElement('details');
              details.className = 'sse-delta-detail';
              const detailSummary = document.createElement('summary');
              detailSummary.textContent = `Show ${fc.rowCount} individual chunks`;
              details.appendChild(detailSummary);

              // Replay the rows for this function to build chunk list
              const chunkList = document.createElement('div');
              chunkList.className = 'sse-delta-chunk-list';
              let inFunc = false;
              for (const row of group.rows) {
                const ridField = row.fields.find(f => f.label === 'function id');
                if (ridField && ridField.value === fc.id) {
                  inFunc = true;
                } else if (ridField && ridField.value !== fc.id) {
                  if (inFunc) break;
                }
                if (inFunc) {
                  const pre = document.createElement('pre');
                  pre.className = 'sse-delta-chunk-json';
                  const originalChunk = parsed.chunks[row.chunkIndex];
                  pre.textContent = originalChunk ? JSON.stringify(originalChunk) : '';
                  chunkList.appendChild(pre);
                }
              }
              details.appendChild(chunkList);
              funcDiv.appendChild(details);
            }

            groupDiv.appendChild(funcDiv);
          }
        }

        deltaSection.appendChild(groupDiv);
      });

      formattedView.appendChild(deltaSection);
    }

    // Special lines: finish_reason and [DONE]
    if (parsed.finishReason || parsed.hasDone) {
      const metaLines = document.createElement('div');
      metaLines.className = 'sse-meta-lines';
      metaLines.style.marginTop = '8px';

      if (parsed.finishReason) {
        const fr = document.createElement('span');
        fr.className = 'sse-meta-badge';
        fr.textContent = `finish_reason: ${parsed.finishReason}`;
        metaLines.appendChild(fr);
      }

      if (parsed.hasDone) {
        const done = document.createElement('span');
        done.className = 'sse-meta-badge sse-meta-done';
        done.textContent = '[DONE]';
        metaLines.appendChild(done);
      }

      formattedView.appendChild(metaLines);
    }

    sseBody.appendChild(formattedView);

    // === Raw SSE view (hidden by default) ===
    const rawView = document.createElement('div');
    rawView.className = 'hidden';
    rawView.appendChild(createJsonView(entry.copilotResponse));
    sseBody.appendChild(rawView);

    // Toggle handler
    sseToggleBtn.addEventListener('click', () => {
      const showingFormatted = !formattedView.classList.contains('hidden');
      if (showingFormatted) {
        formattedView.classList.add('hidden');
        rawView.classList.remove('hidden');
        sseToggleBtn.textContent = 'Formatted';
      } else {
        rawView.classList.add('hidden');
        formattedView.classList.remove('hidden');
        sseToggleBtn.textContent = 'Raw';
      }
    });
}

/**
 * Render the Raw JSON tab — shows the full entry as pretty-printed JSON with copy button.
 */
export function renderRawTab(entry) {
  const container = document.createElement('div');

  // Cache stringified JSON to avoid multi-MB re-serialization on every tab switch
  if (!entry._rawJson) {
    const displayEntry = { ...entry };
    delete displayEntry._index;
    delete displayEntry._parsedResponse;
    delete displayEntry._rawJson;
    entry._rawJson = JSON.stringify(displayEntry, null, 2);
  }
  const jsonText = entry._rawJson;

  const jsonContainer = document.createElement('div');
  jsonContainer.className = 'json-view-container';

  const pre = document.createElement('div');
  pre.className = 'json-view';
  pre.textContent = jsonText;

  jsonContainer.appendChild(pre);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(jsonText);
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('copied');
      }, 1500);
    } catch {
      copyBtn.textContent = 'Failed';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    }
  });
  jsonContainer.appendChild(copyBtn);

  container.appendChild(jsonContainer);
  return container;
}
