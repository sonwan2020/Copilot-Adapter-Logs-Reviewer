/**
 * Renderer module - creates DOM elements for log entry visualization.
 */
import { normalizeContent, parseSSEResponse, formatTimestamp } from './parser.js';

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
      if (lang) codeEl.dataset.lang = lang;
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
 * Render a single content block.
 */
function renderContentBlock(block) {
  if (block.type === 'text') {
    return renderTextContent(block.text || '');
  }

  if (block.type === 'tool_use') {
    const div = document.createElement('div');
    div.className = 'tool-use-block';

    const header = document.createElement('div');
    header.className = 'tool-use-header';
    header.textContent = `Tool Call: ${block.name || 'unknown'}`;
    div.appendChild(header);

    if (block.input) {
      const details = document.createElement('details');
      details.className = 'collapsible';
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

    const header = document.createElement('div');
    header.className = 'tool-result-header';
    header.textContent = `Tool Result${block.tool_use_id ? ` (${block.tool_use_id.substring(0, 8)}...)` : ''}`;
    div.appendChild(header);

    if (block.content) {
      const contentBlocks = normalizeContent(block.content);
      for (const cb of contentBlocks) {
        div.appendChild(renderContentBlock(cb));
      }
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
    const toolCount = req.tools?.length || 0;

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
      if (block.type === 'text') {
        previewText = (block.text || '').substring(0, 80).replace(/\n/g, ' ');
        break;
      } else if (block.type === 'tool_use') {
        previewText = `Tool: ${block.name || 'unknown'}`;
        break;
      } else if (block.type === 'tool_result') {
        previewText = `Tool Result`;
        break;
      }
    }
    const previewSpan = document.createElement('span');
    previewSpan.className = 'message-preview';
    previewSpan.textContent = previewText + (previewText.length >= 80 ? '...' : '');
    header.appendChild(previewSpan);

    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'message-toggle-icon';
    toggleIcon.textContent = '\u25B6';
    header.appendChild(toggleIcon);

    const body = document.createElement('div');
    body.className = 'message-body hidden';

    header.addEventListener('click', () => {
      const isHidden = body.classList.contains('hidden');
      body.classList.toggle('hidden');
      toggleIcon.textContent = isHidden ? '\u25BC' : '\u25B6';
      previewSpan.classList.toggle('hidden', isHidden);
    });

    for (const block of blocks) {
      if (block.type === 'text' && msg.role === 'user') {
        // Render user messages with full markdown formatting + plain text toggle
        const rawText = block.text || '';
        const wrapper = document.createElement('div');
        wrapper.className = 'md-toggle-wrapper';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'md-toggle-btn';
        toggleBtn.textContent = 'Plain Text';
        toggleBtn.title = 'Toggle between formatted and plain text';

        const mdView = renderMarkdownContent(rawText);
        mdView.classList.add('hidden');
        const plainView = document.createElement('pre');
        plainView.className = 'plain-text-view';
        plainView.textContent = rawText;

        toggleBtn.addEventListener('click', () => {
          const showingPlain = !plainView.classList.contains('hidden');
          if (showingPlain) {
            plainView.classList.add('hidden');
            mdView.classList.remove('hidden');
            toggleBtn.textContent = 'Plain Text';
          } else {
            mdView.classList.add('hidden');
            plainView.classList.remove('hidden');
            toggleBtn.textContent = 'Formatted';
          }
        });

        wrapper.appendChild(toggleBtn);
        wrapper.appendChild(mdView);
        wrapper.appendChild(plainView);
        body.appendChild(wrapper);
      } else {
        body.appendChild(renderContentBlock(block));
      }
    }

    msgDiv.appendChild(header);
    msgDiv.appendChild(body);
    container.appendChild(msgDiv);
  }

  return container;
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
    if (i === 0) details.open = true;

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

    const wrapper = document.createElement('div');
    wrapper.className = 'md-toggle-wrapper';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'md-toggle-btn';
    toggleBtn.textContent = 'Plain Text';
    toggleBtn.title = 'Toggle between formatted and plain text';

    const mdView = renderMarkdownContent(text);
    mdView.classList.add('hidden');
    const plainView = document.createElement('pre');
    plainView.className = 'plain-text-view';
    plainView.textContent = text;

    toggleBtn.addEventListener('click', () => {
      const showingPlain = !plainView.classList.contains('hidden');
      if (showingPlain) {
        plainView.classList.add('hidden');
        mdView.classList.remove('hidden');
        toggleBtn.textContent = 'Plain Text';
      } else {
        mdView.classList.add('hidden');
        plainView.classList.remove('hidden');
        toggleBtn.textContent = 'Formatted';
      }
    });

    wrapper.appendChild(toggleBtn);
    wrapper.appendChild(mdView);
    wrapper.appendChild(plainView);
    content.appendChild(wrapper);

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
  const tools = entry.anthropicRequest?.tools || [];

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

    if (tool.description) {
      const desc = document.createElement('div');
      desc.style.marginBottom = '8px';

      const wrapper = document.createElement('div');
      wrapper.className = 'md-toggle-wrapper';

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'md-toggle-btn';
      toggleBtn.textContent = 'Formatted';
      toggleBtn.title = 'Toggle between formatted and plain text';

      const mdView = renderMarkdownContent(tool.description);
      mdView.classList.add('hidden');
      const plainView = document.createElement('pre');
      plainView.className = 'plain-text-view';
      plainView.textContent = tool.description;

      toggleBtn.addEventListener('click', () => {
        const showingPlain = !plainView.classList.contains('hidden');
        if (showingPlain) {
          plainView.classList.add('hidden');
          mdView.classList.remove('hidden');
          toggleBtn.textContent = 'Plain Text';
        } else {
          mdView.classList.add('hidden');
          plainView.classList.remove('hidden');
          toggleBtn.textContent = 'Formatted';
        }
      });

      wrapper.appendChild(toggleBtn);
      wrapper.appendChild(mdView);
      wrapper.appendChild(plainView);
      desc.appendChild(wrapper);
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

    const toolCount = (summary.tools || []).length;
    const toolPlaceholder = `__LINK_TOOLS__`;
    anthropicLinks.push({
      placeholder: toolPlaceholder,
      label: `[${toolCount} tools]`,
      action: () => {
        if (callbacks.onSwitchTab) callbacks.onSwitchTab('tools');
      },
    });
    summary.tools = toolPlaceholder;

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
  const parsed = parseSSEResponse(entry.copilotResponse);

  // Assembled content
  const contentSection = document.createElement('div');
  contentSection.className = 'response-content';
  const contentTitle = document.createElement('h3');
  contentTitle.textContent = 'Assembled Response';
  contentTitle.style.marginBottom = '8px';
  contentTitle.style.fontSize = '14px';
  contentSection.appendChild(contentTitle);

  if (parsed.content) {
    const wrapper = document.createElement('div');
    wrapper.className = 'md-toggle-wrapper';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'md-toggle-btn';
    toggleBtn.textContent = 'Plain Text';
    toggleBtn.title = 'Toggle between formatted and plain text';

    const mdView = renderMarkdownContent(parsed.content);
    mdView.classList.add('hidden');
    const plainView = document.createElement('pre');
    plainView.className = 'plain-text-view';
    plainView.textContent = parsed.content;

    toggleBtn.addEventListener('click', () => {
      const showingPlain = !plainView.classList.contains('hidden');
      if (showingPlain) {
        plainView.classList.add('hidden');
        mdView.classList.remove('hidden');
        toggleBtn.textContent = 'Plain Text';
      } else {
        mdView.classList.add('hidden');
        plainView.classList.remove('hidden');
        toggleBtn.textContent = 'Formatted';
      }
    });

    wrapper.appendChild(toggleBtn);
    wrapper.appendChild(mdView);
    wrapper.appendChild(plainView);
    contentSection.appendChild(wrapper);
  } else {
    const empty = document.createElement('div');
    empty.style.color = 'var(--text-muted)';
    empty.textContent = 'No content extracted from response.';
    contentSection.appendChild(empty);
  }
  container.appendChild(contentSection);

  // Usage stats
  if (parsed.usage) {
    const usageTitle = document.createElement('h3');
    usageTitle.textContent = 'Usage Statistics';
    usageTitle.style.marginBottom = '8px';
    usageTitle.style.fontSize = '14px';
    container.appendChild(usageTitle);

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
    container.appendChild(table);
  }

  // Response model
  if (parsed.model) {
    const modelInfo = document.createElement('div');
    modelInfo.style.marginTop = '12px';
    modelInfo.style.fontSize = '13px';
    modelInfo.style.color = 'var(--text-secondary)';
    modelInfo.textContent = `Response Model: ${parsed.model}`;
    container.appendChild(modelInfo);
  }

  // SSE Response section with formatted/raw toggle
  if (entry.copilotResponse) {
    const sseSection = document.createElement('div');
    sseSection.style.marginTop = '16px';

    const sseHeader = document.createElement('div');
    sseHeader.style.display = 'flex';
    sseHeader.style.alignItems = 'center';
    sseHeader.style.gap = '8px';
    sseHeader.style.marginBottom = '8px';

    const sseTitle = document.createElement('h3');
    sseTitle.textContent = 'SSE Response';
    sseTitle.style.fontSize = '14px';
    sseTitle.style.margin = '0';
    sseHeader.appendChild(sseTitle);

    const sseToggleBtn = document.createElement('button');
    sseToggleBtn.className = 'sse-toggle-btn';
    sseToggleBtn.textContent = 'Raw';
    sseToggleBtn.title = 'Toggle between formatted and raw SSE';
    sseHeader.appendChild(sseToggleBtn);

    sseSection.appendChild(sseHeader);

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
        row.innerHTML = `<td class="usage-table-label">${escapeHtml(label)}</td><td class="usage-table-value" style="font-size:13px;font-weight:normal;text-align:left;">${escapeHtml(String(value))}</td>`;
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

          // Grouped text
          const textDiv = document.createElement('div');
          textDiv.className = 'sse-delta-group-text';
          textDiv.textContent = allText;
          groupDiv.appendChild(textDiv);

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

    sseSection.appendChild(formattedView);

    // === Raw SSE view (hidden by default) ===
    const rawView = document.createElement('div');
    rawView.className = 'hidden';
    rawView.appendChild(createJsonView(entry.copilotResponse));
    sseSection.appendChild(rawView);

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

    container.appendChild(sseSection);
  }

  return container;
}
