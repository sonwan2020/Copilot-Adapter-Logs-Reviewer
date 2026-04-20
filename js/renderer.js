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
        <span class="entry-item-index">#${i + 1}</span>
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
    header.innerHTML = `<span>${escapeHtml(msg.role.toUpperCase())}</span>`;

    const body = document.createElement('div');
    body.className = 'message-body';

    const blocks = normalizeContent(msg.content);
    for (const block of blocks) {
      const rendered = renderContentBlock(block);
      body.appendChild(rendered);
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
    content.appendChild(renderTextContent(text));

    details.appendChild(summary);
    details.appendChild(content);
    container.appendChild(details);
  });

  return container;
}

/**
 * Render the Tools tab content.
 */
export function renderToolsTab(entry) {
  const container = document.createElement('div');
  const tools = entry.anthropicRequest?.tools || [];

  if (tools.length === 0) {
    container.textContent = 'No tools defined in this entry.';
    return container;
  }

  tools.forEach((tool) => {
    const details = document.createElement('details');
    details.className = 'tool-card';

    const summary = document.createElement('summary');
    summary.textContent = tool.name || 'unnamed';

    const content = document.createElement('div');
    content.className = 'tool-card-content';

    if (tool.description) {
      const desc = document.createElement('div');
      desc.style.marginBottom = '8px';
      desc.appendChild(renderTextContent(tool.description));
      content.appendChild(desc);
    }

    if (tool.input_schema) {
      const schemaDetails = document.createElement('details');
      schemaDetails.className = 'collapsible';
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
    // Show a summary (without full message content to avoid huge renders)
    const summary = { ...entry.anthropicRequest };
    summary.messages = (summary.messages || []).map((m, i) => ({
      role: m.role,
      content: `[${normalizeContent(m.content).length} block(s)]`,
      _index: i,
    }));
    summary.system = (summary.system || []).map((s, i) => ({
      type: s.type,
      text: `[${(s.text || '').length} chars]`,
      _index: i,
    }));
    summary.tools = `[${(summary.tools || []).length} tools]`;
    anthropicCol.appendChild(createJsonView(summary));

    // Add clickable links below the JSON view
    const linksDiv = document.createElement('div');
    linksDiv.className = 'request-links';

    // Tools link
    const toolCount = (entry.anthropicRequest.tools || []).length;
    if (toolCount > 0) {
      const toolLink = document.createElement('a');
      toolLink.className = 'request-link';
      toolLink.href = '#';
      toolLink.textContent = `View ${toolCount} tools →`;
      toolLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (callbacks.onSwitchTab) callbacks.onSwitchTab('tools');
      });
      linksDiv.appendChild(toolLink);
    }

    // System content links
    const system = entry.anthropicRequest.system || [];
    system.forEach((s, i) => {
      const text = s.text || s.content || JSON.stringify(s);
      const link = document.createElement('a');
      link.className = 'request-link';
      link.href = '#';
      link.textContent = `View system prompt #${i + 1} (${text.length} chars) →`;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (callbacks.onShowContent) callbacks.onShowContent(`System Prompt #${i + 1}`, text);
      });
      linksDiv.appendChild(link);
    });

    // Message content links
    const messages = entry.anthropicRequest.messages || [];
    messages.forEach((m, i) => {
      const blocks = normalizeContent(m.content);
      const fullText = blocks.map(b => b.text || JSON.stringify(b)).join('\n');
      if (fullText.length > 200) {
        const link = document.createElement('a');
        link.className = 'request-link';
        link.href = '#';
        link.textContent = `View message #${i + 1} [${m.role}] (${fullText.length} chars) →`;
        link.addEventListener('click', (e) => {
          e.preventDefault();
          if (callbacks.onShowContent) callbacks.onShowContent(`Message #${i + 1} (${m.role})`, fullText);
        });
        linksDiv.appendChild(link);
      }
    });

    anthropicCol.appendChild(linksDiv);
  }

  // OpenAI Request
  const openaiCol = document.createElement('div');
  openaiCol.className = 'comparison-column';
  const openaiTitle = document.createElement('h3');
  openaiTitle.textContent = 'OpenAI Request';
  openaiCol.appendChild(openaiTitle);
  if (entry.openaiRequest) {
    const summary = { ...entry.openaiRequest };
    summary.messages = (summary.messages || []).map((m, i) => ({
      role: m.role,
      content: `[${(m.content || '').length} chars]`,
      _index: i,
    }));
    summary.tools = `[${(summary.tools || []).length} tools]`;
    openaiCol.appendChild(createJsonView(summary));

    // Add clickable links below the JSON view
    const linksDiv = document.createElement('div');
    linksDiv.className = 'request-links';

    // Tools link
    const toolCount = (entry.openaiRequest.tools || []).length;
    if (toolCount > 0) {
      const toolLink = document.createElement('a');
      toolLink.className = 'request-link';
      toolLink.href = '#';
      toolLink.textContent = `View ${toolCount} tools →`;
      toolLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (callbacks.onSwitchTab) callbacks.onSwitchTab('tools');
      });
      linksDiv.appendChild(toolLink);
    }

    // Message content links
    const messages = entry.openaiRequest.messages || [];
    messages.forEach((m, i) => {
      const content = m.content || '';
      if (content.length > 200) {
        const link = document.createElement('a');
        link.className = 'request-link';
        link.href = '#';
        link.textContent = `View message #${i + 1} [${m.role}] (${content.length} chars) →`;
        link.addEventListener('click', (e) => {
          e.preventDefault();
          if (callbacks.onShowContent) callbacks.onShowContent(`Message #${i + 1} (${m.role})`, content);
        });
        linksDiv.appendChild(link);
      }
    });

    openaiCol.appendChild(linksDiv);
  }

  grid.appendChild(anthropicCol);
  grid.appendChild(openaiCol);
  container.appendChild(grid);

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
    contentSection.appendChild(renderTextContent(parsed.content));
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

    const statsGrid = document.createElement('div');
    statsGrid.className = 'usage-stats';

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
      const stat = document.createElement('div');
      stat.className = 'usage-stat';
      stat.innerHTML = `<div class="label">${escapeHtml(label)}</div><div class="value">${Number(value).toLocaleString()}</div>`;
      statsGrid.appendChild(stat);
    }
    container.appendChild(statsGrid);
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

  // Raw SSE (collapsible)
  if (entry.copilotResponse) {
    const rawDetails = document.createElement('details');
    rawDetails.className = 'collapsible';
    rawDetails.style.marginTop = '16px';
    const rawSummary = document.createElement('summary');
    rawSummary.textContent = 'Raw SSE Response';
    const badge = document.createElement('span');
    badge.className = 'collapsible-badge';
    badge.textContent = `${entry.copilotResponse.length} chars`;
    rawSummary.appendChild(badge);
    rawDetails.appendChild(rawSummary);

    const rawContent = document.createElement('div');
    rawContent.className = 'collapsible-content';
    rawContent.appendChild(createJsonView(entry.copilotResponse));
    rawDetails.appendChild(rawContent);
    container.appendChild(rawDetails);
  }

  return container;
}
