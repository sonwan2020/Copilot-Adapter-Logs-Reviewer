/**
 * Parser module for Copilot Adapter log files.
 * Handles JSON parsing (including truncated files) and SSE response parsing.
 */

/**
 * Parse a log file text into an array of log entries.
 * Expects JSONL format: one valid JSON object per line, no wrapping array.
 * @param {string} text - Raw file content
 * @returns {{ entries: object[], truncated: boolean }}
 */
export function parseLogFile(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Log file is empty.');
  }

  // Parse as JSONL: one JSON object per line
  const entries = [];
  const lines = trimmed.split('\n');
  let parseErrors = 0;

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    try {
      entries.push(JSON.parse(l));
    } catch {
      parseErrors++;
    }
  }

  if (entries.length === 0) {
    throw new Error('Unable to parse log file. Expected one JSON object per line (JSONL format).');
  }

  // If the last line failed to parse, the file may be truncated
  const lastLine = lines[lines.length - 1].trim();
  let truncated = false;
  if (lastLine) {
    try {
      JSON.parse(lastLine);
    } catch {
      truncated = true;
    }
  }

  return { entries, truncated };
}

/**
 * Parse SSE response text into assembled content and usage stats.
 * @param {string} sseText - Raw SSE response text
 * @returns {{ content: string, usage: object|null, model: string|null, chunks: object[] }}
 */
export function parseSSEResponse(sseText) {
  if (!sseText) return { content: '', usage: null, model: null, chunks: [] };

  const lines = sseText.split('\n');
  const chunks = [];
  let content = '';
  let usage = null;
  let model = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;

    const dataStr = trimmed.slice(5).trim();
    if (dataStr === '[DONE]') continue;

    try {
      const data = JSON.parse(dataStr);
      chunks.push(data);

      if (data.model && !model) {
        model = data.model;
      }

      // Extract content from OpenAI-format streaming
      if (data.choices) {
        for (const choice of data.choices) {
          if (choice.delta?.content) {
            content += choice.delta.content;
          }
        }
      }

      // Extract usage stats
      if (data.usage) {
        usage = data.usage;
      }
    } catch {
      // Skip unparseable SSE chunks
    }
  }

  return { content, usage, model, chunks };
}

/**
 * Normalize message content to an array of content blocks.
 * @param {string|object[]} content
 * @returns {object[]}
 */
export function normalizeContent(content) {
  if (!content) return [];
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (Array.isArray(content)) {
    return content;
  }
  return [content];
}

/**
 * Extract summary metadata from a log entry.
 * @param {object} entry
 * @param {number} index
 * @returns {object}
 */
export function extractMetadata(entry, index) {
  const req = entry.anthropicRequest || {};
  const parsedResponse = parseSSEResponse(entry.copilotResponse);

  return {
    index,
    timestamp: entry.timestamp || null,
    model: req.model || 'unknown',
    streaming: entry.streaming ?? null,
    messageCount: req.messages?.length || 0,
    systemPromptCount: req.system?.length || 0,
    toolCount: req.tools?.length || 0,
    maxTokens: req.max_tokens || null,
    temperature: req.temperature ?? null,
    usage: parsedResponse.usage,
    responseModel: parsedResponse.model,
    responseContentLength: parsedResponse.content.length,
  };
}

/**
 * Format a timestamp for display.
 * @param {string} isoString
 * @returns {string}
 */
export function formatTimestamp(isoString) {
  if (!isoString) return 'N/A';
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

/**
 * Format byte size for display.
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
