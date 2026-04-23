/**
 * Parser module for Copilot Adapter log files.
 * Handles JSON parsing (including truncated files) and SSE response parsing.
 */

// Global tools cache: Map<hash, tools array>
// Deduplicates tool definitions across all entries to reduce memory usage
const toolsCache = new Map();

// Global system prompt cache: Map<hash, system prompt array>
// Deduplicates system prompts across all entries to reduce memory usage
const systemPromptCache = new Map();

/**
 * Compute a SHA-256 hash for a tools array.
 * Uses the Web Crypto API to create a secure hash identifier.
 * @param {Array} tools
 * @returns {Promise<string>}
 */
async function hashTools(tools) {
  if (!tools || tools.length === 0) return '';

  // Convert tools to JSON string for hashing
  const str = JSON.stringify(tools);

  // Use Web Crypto API for SHA-256 hashing
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert hash to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Cache tools array and return a cache ID.
 * If the same tools array is already cached, returns existing ID.
 * @param {Array} tools
 * @returns {Promise<string|null>} - Cache ID or null if no tools
 */
async function cacheTools(tools) {
  if (!tools || tools.length === 0) return null;

  const hash = await hashTools(tools);
  if (!toolsCache.has(hash)) {
    toolsCache.set(hash, tools);
  }
  return hash;
}

/**
 * Retrieve tools from cache by ID.
 * @param {string} cacheId
 * @returns {Array|null}
 */
export function getToolsFromCache(cacheId) {
  if (!cacheId) return null;
  return toolsCache.get(cacheId) || null;
}

/**
 * Clear the tools cache. Useful for testing or memory cleanup.
 */
export function clearToolsCache() {
  toolsCache.clear();
}

/**
 * Compute a SHA-256 hash for a system prompt array.
 * Uses the Web Crypto API to create a secure hash identifier.
 * @param {Array} systemPrompt
 * @returns {Promise<string>}
 */
async function hashSystemPrompt(systemPrompt) {
  if (!systemPrompt || systemPrompt.length === 0) return '';

  // Convert system prompt to JSON string for hashing
  const str = JSON.stringify(systemPrompt);

  // Use Web Crypto API for SHA-256 hashing
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert hash to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Cache system prompt array and return a cache ID.
 * If the same system prompt array is already cached, returns existing ID.
 * @param {Array} systemPrompt
 * @returns {Promise<string|null>} - Cache ID or null if no system prompts
 */
async function cacheSystemPrompt(systemPrompt) {
  if (!systemPrompt || systemPrompt.length === 0) return null;

  const hash = await hashSystemPrompt(systemPrompt);
  if (!systemPromptCache.has(hash)) {
    systemPromptCache.set(hash, systemPrompt);
  }
  return hash;
}

/**
 * Retrieve system prompts from cache by ID.
 * @param {string} cacheId
 * @returns {Array|null}
 */
export function getSystemPromptFromCache(cacheId) {
  if (!cacheId) return null;
  return systemPromptCache.get(cacheId) || null;
}

/**
 * Clear the system prompt cache. Useful for testing or memory cleanup.
 */
export function clearSystemPromptCache() {
  systemPromptCache.clear();
}

/**
 * Parse a log file text into an array of log entries.
 * Expects JSONL format: one valid JSON object per line, no wrapping array.
 * @param {string} text - Raw file content
 * @returns {Promise<{ entries: object[], truncated: boolean }>}
 */
export async function parseLogFile(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Log file is empty.');
  }

  // Clear caches at start of new file load
  clearToolsCache();
  clearSystemPromptCache();

  // Parse as JSONL: one JSON object per line
  const entries = [];
  const lines = trimmed.split('\n');
  let parseErrors = 0;

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    try {
      const entry = JSON.parse(l);
      entry._index = entries.length;

      // Cache tools and replace with reference
      if (entry.anthropicRequest?.tools) {
        const cacheId = await cacheTools(entry.anthropicRequest.tools);
        if (cacheId) {
          entry.anthropicRequest._toolsCacheId = cacheId;
          delete entry.anthropicRequest.tools;
        }
      }

      // Cache system prompts (Anthropic Request)
      if (entry.anthropicRequest?.system) {
        const cacheId = await cacheSystemPrompt(entry.anthropicRequest.system);
        if (cacheId) {
          entry.anthropicRequest._systemPromptCacheId = cacheId;
          delete entry.anthropicRequest.system;
        }
      }

      // Cache system prompts (OpenAI Request)
      // OpenAI format uses system messages in the messages array, but may also have a system field
      if (entry.openaiRequest?.system) {
        const cacheId = await cacheSystemPrompt(entry.openaiRequest.system);
        if (cacheId) {
          entry.openaiRequest._systemPromptCacheId = cacheId;
          delete entry.openaiRequest.system;
        }
      }

      entries.push(entry);
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
 * Parse a log file using streaming to minimize memory usage.
 * Reads the file in chunks via ReadableStream, parses each complete JSONL
 * line immediately, and discards raw text — never holding the full file in memory.
 *
 * @param {File} file - The File object to parse
 * @param {function} onProgress - Called with { bytesRead, totalBytes } during parsing
 * @returns {Promise<{ entries: object[], truncated: boolean }>}
 */
export async function parseLogFileStreaming(file, onProgress) {
  // Clear caches at start of new file load
  clearToolsCache();
  clearSystemPromptCache();

  const totalBytes = file.size;
  const entries = [];
  let lineBuffer = '';
  let bytesRead = 0;
  let lastLineFailed = false;
  let hasContent = false;

  const stream = file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');

  // Batch progress updates — report at most every 100ms to avoid UI thrashing
  let lastProgressTime = 0;
  const PROGRESS_INTERVAL = 100;

  function reportProgress() {
    if (!onProgress) return;
    const now = performance.now();
    if (now - lastProgressTime >= PROGRESS_INTERVAL) {
      lastProgressTime = now;
      onProgress({ bytesRead, totalBytes });
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      bytesRead += value.byteLength;
      const chunk = decoder.decode(value, { stream: true });

      // Append chunk to buffer and extract complete lines
      lineBuffer += chunk;
      let newlineIdx;
      while ((newlineIdx = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, newlineIdx).trim();
        lineBuffer = lineBuffer.slice(newlineIdx + 1);

        if (!line) continue;
        hasContent = true;

        try {
          const entry = JSON.parse(line);
          entry._index = entries.length;

          // Cache tools and replace with reference
          if (entry.anthropicRequest?.tools) {
            const cacheId = await cacheTools(entry.anthropicRequest.tools);
            if (cacheId) {
              entry.anthropicRequest._toolsCacheId = cacheId;
              delete entry.anthropicRequest.tools;
            }
          }

          // Cache system prompts (Anthropic Request)
          if (entry.anthropicRequest?.system) {
            const cacheId = await cacheSystemPrompt(entry.anthropicRequest.system);
            if (cacheId) {
              entry.anthropicRequest._systemPromptCacheId = cacheId;
              delete entry.anthropicRequest.system;
            }
          }

          // Cache system prompts (OpenAI Request)
          if (entry.openaiRequest?.system) {
            const cacheId = await cacheSystemPrompt(entry.openaiRequest.system);
            if (cacheId) {
              entry.openaiRequest._systemPromptCacheId = cacheId;
              delete entry.openaiRequest.system;
            }
          }

          entries.push(entry);
          lastLineFailed = false;
        } catch {
          lastLineFailed = true;
        }
      }

      reportProgress();

      // Yield to the event loop periodically so the UI stays responsive
      // (every ~2MB of data processed)
      if (bytesRead % (2 * 1024 * 1024) < value.byteLength) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // Flush any remaining content in the buffer (last line without trailing newline)
    const remaining = lineBuffer.trim();
    if (remaining) {
      hasContent = true;
      try {
        const entry = JSON.parse(remaining);
        entry._index = entries.length;

        // Cache tools and replace with reference
        if (entry.anthropicRequest?.tools) {
          const cacheId = await cacheTools(entry.anthropicRequest.tools);
          if (cacheId) {
            entry.anthropicRequest._toolsCacheId = cacheId;
            delete entry.anthropicRequest.tools;
          }
        }

        // Cache system prompts (Anthropic Request)
        if (entry.anthropicRequest?.system) {
          const cacheId = await cacheSystemPrompt(entry.anthropicRequest.system);
          if (cacheId) {
            entry.anthropicRequest._systemPromptCacheId = cacheId;
            delete entry.anthropicRequest.system;
          }
        }

        // Cache system prompts (OpenAI Request)
        if (entry.openaiRequest?.system) {
          const cacheId = await cacheSystemPrompt(entry.openaiRequest.system);
          if (cacheId) {
            entry.openaiRequest._systemPromptCacheId = cacheId;
            delete entry.openaiRequest.system;
          }
        }

        entries.push(entry);
        lastLineFailed = false;
      } catch {
        lastLineFailed = true;
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Final progress report
  if (onProgress) {
    onProgress({ bytesRead: totalBytes, totalBytes });
  }

  if (!hasContent) {
    throw new Error('Log file is empty.');
  }

  if (entries.length === 0) {
    throw new Error('Unable to parse log file. Expected one JSON object per line (JSONL format).');
  }

  return { entries, truncated: lastLineFailed };
}

/**
 * Parse SSE response text into assembled content and usage stats.
 * @param {string} sseText - Raw SSE response text
 * @returns {{ content: string, usage: object|null, model: string|null, id: string|null, chunks: object[], deltaRows: object[], finishReason: string|null, hasDone: boolean }}
 */
export function parseSSEResponse(sseText) {
  if (!sseText) return { content: '', usage: null, model: null, id: null, chunks: [], deltaRows: [], finishReason: null, hasDone: false };

  const lines = sseText.split('\n');
  const chunks = [];
  const deltaRows = [];
  let content = '';
  let usage = null;
  let model = null;
  let id = null;
  let finishReason = null;
  let hasDone = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;

    const dataStr = trimmed.slice(5).trim();
    if (dataStr === '[DONE]') {
      hasDone = true;
      continue;
    }

    try {
      const data = JSON.parse(dataStr);
      chunks.push(data);

      if (data.id && !id) {
        id = data.id;
      }

      if (data.model && !model) {
        model = data.model;
      }

      // Extract content from OpenAI-format streaming
      if (data.choices) {
        for (const choice of data.choices) {
          const deltaContent = choice.delta?.content || null;
          const deltaReasoning = choice.delta?.reasoning_text || null;
          const deltaToolCalls = choice.delta?.tool_calls || null;

          // Build a row if there's any delta data
          if (deltaContent || deltaReasoning || deltaToolCalls) {
            const row = { created: data.created || null, fields: [], chunkIndex: chunks.length - 1 };

            if (deltaContent) {
              content += deltaContent;
              row.type = 'content';
              row.fields.push({ label: 'content', value: deltaContent });
            }
            if (deltaReasoning) {
              row.type = 'reasoning_text';
              row.fields.push({ label: 'reasoning_text', value: deltaReasoning });
            }
            if (deltaToolCalls) {
              row.type = 'function';
              for (const tc of deltaToolCalls) {
                if (tc.id) row.fields.push({ label: 'function id', value: tc.id });
                if (tc.function?.name) row.fields.push({ label: 'function name', value: tc.function.name });
                if (tc.function?.arguments) row.fields.push({ label: 'function arguments', value: tc.function.arguments, isJson: true });
              }
            }

            if (row.fields.length > 0) {
              deltaRows.push(row);
            }
          }

          if (choice.finish_reason && !finishReason) {
            finishReason = choice.finish_reason;
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

  return { content, usage, model, id, chunks, deltaRows, finishReason, hasDone };
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

  // Get tool count from cache if tools are cached
  let toolCount = 0;
  if (req._toolsCacheId) {
    const tools = getToolsFromCache(req._toolsCacheId);
    toolCount = tools?.length || 0;
  } else {
    toolCount = req.tools?.length || 0;
  }

  // Get system prompt count from cache if system prompts are cached
  let systemPromptCount = 0;
  if (req._systemPromptCacheId) {
    const systemPrompt = getSystemPromptFromCache(req._systemPromptCacheId);
    systemPromptCount = systemPrompt?.length || 0;
  } else {
    systemPromptCount = req.system?.length || 0;
  }

  return {
    index,
    timestamp: entry.timestamp || null,
    model: req.model || 'unknown',
    streaming: entry.streaming ?? null,
    messageCount: req.messages?.length || 0,
    systemPromptCount,
    toolCount,
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
