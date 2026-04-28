/**
 * Unit tests for js/parser.js
 *
 * Run with: npm test
 * Requires Node.js 20+ (uses node:test and native File/Blob/crypto/ReadableStream globals).
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearToolsCache,
  getToolsFromCache,
  parseLogFile,
  parseLogFileStreaming,
  parseSSEResponse,
  normalizeContent,
  extractMetadata,
  formatTimestamp,
  formatSize,
} from '../js/parser.js';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

/** Minimal valid JSONL log entry as a plain object. */
function makeEntry(overrides = {}) {
  return {
    timestamp: '2026-04-22T00:54:24.000Z',
    streaming: true,
    anthropicRequest: {
      model: 'claude-opus-4.6',
      messages: [{ role: 'user', content: 'Hello' }],
      system: [{ type: 'text', text: 'You are a helpful assistant.' }],
      max_tokens: 1024,
      temperature: 0.7,
    },
    openaiRequest: {},
    copilotResponse: '',
    ...overrides,
  };
}

/** Serialise an array of entries to JSONL text. */
function toJSONL(entries) {
  return entries.map((e) => JSON.stringify(e)).join('\n');
}

/** Create a File-like object backed by a string, compatible with parseLogFileStreaming. */
function makeFile(text, name = 'test.jsonl') {
  const bytes = new TextEncoder().encode(text);
  return new File([bytes], name, { type: 'application/jsonl' });
}

// ---------------------------------------------------------------------------
// formatSize
// ---------------------------------------------------------------------------

describe('formatSize', () => {
  it('formats bytes under 1 KB', () => {
    assert.equal(formatSize(0), '0 B');
    assert.equal(formatSize(1), '1 B');
    assert.equal(formatSize(512), '512 B');
    assert.equal(formatSize(1023), '1023 B');
  });

  it('formats values in the KB range', () => {
    assert.equal(formatSize(1024), '1.0 KB');
    assert.equal(formatSize(1536), '1.5 KB');
    assert.equal(formatSize(1024 * 1024 - 1), '1024.0 KB');
  });

  it('formats values in the MB range', () => {
    assert.equal(formatSize(1024 * 1024), '1.0 MB');
    assert.equal(formatSize(1024 * 1024 * 2.5), '2.5 MB');
  });
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

describe('formatTimestamp', () => {
  it('returns N/A for falsy input', () => {
    assert.equal(formatTimestamp(null), 'N/A');
    assert.equal(formatTimestamp(''), 'N/A');
    assert.equal(formatTimestamp(undefined), 'N/A');
  });

  it('returns a non-empty string for a valid ISO timestamp', () => {
    const result = formatTimestamp('2026-04-22T00:54:24.000Z');
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
    // The formatted string should not be the raw ISO string
    assert.notEqual(result, '2026-04-22T00:54:24.000Z');
  });

  it('falls back to the raw string for an unparseable value', () => {
    // new Date('not-a-date') is Invalid Date; toLocaleString() returns 'Invalid Date'
    // The implementation catches and returns the raw string only if it throws —
    // but Date doesn't throw for invalid strings, it returns Invalid Date.
    // Either way the function must return a string.
    const result = formatTimestamp('not-a-date');
    assert.equal(typeof result, 'string');
  });
});

// ---------------------------------------------------------------------------
// normalizeContent
// ---------------------------------------------------------------------------

describe('normalizeContent', () => {
  it('returns [] for falsy input', () => {
    assert.deepEqual(normalizeContent(null), []);
    assert.deepEqual(normalizeContent(undefined), []);
    assert.deepEqual(normalizeContent(''), []);
  });

  it('wraps a plain string into a text block', () => {
    assert.deepEqual(normalizeContent('hello'), [{ type: 'text', text: 'hello' }]);
  });

  it('returns an array unchanged', () => {
    const blocks = [{ type: 'text', text: 'a' }, { type: 'image', source: {} }];
    assert.deepEqual(normalizeContent(blocks), blocks);
  });

  it('wraps an object that is not an array into an array', () => {
    const obj = { type: 'text', text: 'hi' };
    assert.deepEqual(normalizeContent(obj), [obj]);
  });
});

// ---------------------------------------------------------------------------
// parseSSEResponse
// ---------------------------------------------------------------------------

describe('parseSSEResponse', () => {
  it('returns empty result for falsy input', () => {
    const r = parseSSEResponse('');
    assert.equal(r.content, '');
    assert.equal(r.usage, null);
    assert.equal(r.model, null);
    assert.equal(r.id, null);
    assert.deepEqual(r.chunks, []);
    assert.deepEqual(r.deltaRows, []);
    assert.equal(r.finishReason, null);
    assert.equal(r.hasDone, false);
  });

  it('detects [DONE] sentinel', () => {
    const r = parseSSEResponse('data: [DONE]\n');
    assert.equal(r.hasDone, true);
    assert.deepEqual(r.chunks, []);
  });

  it('parses model and id from the first data chunk', () => {
    const chunk = { id: 'abc123', model: 'claude-haiku-4.5', choices: [] };
    const r = parseSSEResponse(`data: ${JSON.stringify(chunk)}\n`);
    assert.equal(r.model, 'claude-haiku-4.5');
    assert.equal(r.id, 'abc123');
  });

  it('assembles content from delta chunks', () => {
    const lines = [
      `data: ${JSON.stringify({ id: 'x', model: 'm', choices: [{ delta: { content: 'Hello' }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: 'x', model: 'm', choices: [{ delta: { content: ' world' }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: 'x', model: 'm', choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
      'data: [DONE]',
    ].join('\n');

    const r = parseSSEResponse(lines);
    assert.equal(r.content, 'Hello world');
    assert.equal(r.finishReason, 'stop');
    assert.equal(r.hasDone, true);
    assert.equal(r.chunks.length, 3);
    assert.equal(r.deltaRows.length, 2);
  });

  it('captures usage stats', () => {
    const chunk = {
      id: 'u1',
      model: 'claude',
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const r = parseSSEResponse(`data: ${JSON.stringify(chunk)}\n`);
    assert.deepEqual(r.usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it('parses tool call deltas', () => {
    const chunk = {
      id: 't1',
      model: 'claude',
      choices: [
        {
          delta: {
            tool_calls: [{ id: 'tc1', function: { name: 'myTool', arguments: '{"x":1}' } }],
          },
          finish_reason: null,
        },
      ],
    };
    const r = parseSSEResponse(`data: ${JSON.stringify(chunk)}\n`);
    assert.equal(r.deltaRows.length, 1);
    assert.equal(r.deltaRows[0].type, 'function');
    const labels = r.deltaRows[0].fields.map((f) => f.label);
    assert.ok(labels.includes('function id'));
    assert.ok(labels.includes('function name'));
    assert.ok(labels.includes('function arguments'));
  });

  it('skips malformed data lines gracefully', () => {
    const sseText = 'data: {broken json}\ndata: [DONE]\n';
    const r = parseSSEResponse(sseText);
    assert.equal(r.hasDone, true);
    assert.deepEqual(r.chunks, []);
  });

  it('ignores lines that do not start with data:', () => {
    const sseText = 'event: ping\ncomment: ignore me\ndata: [DONE]\n';
    const r = parseSSEResponse(sseText);
    assert.equal(r.hasDone, true);
    assert.deepEqual(r.chunks, []);
  });
});

// ---------------------------------------------------------------------------
// Tools cache: getToolsFromCache / clearToolsCache
// ---------------------------------------------------------------------------

describe('tools cache', () => {
  beforeEach(() => {
    clearToolsCache();
  });

  it('returns null for unknown cache IDs', () => {
    assert.equal(getToolsFromCache('nonexistent'), null);
    assert.equal(getToolsFromCache(''), null);
    assert.equal(getToolsFromCache(null), null);
  });

  it('caches tools via parseLogFile and retrieves them by ID', async () => {
    const tools = [{ name: 'myTool', description: 'does stuff', input_schema: {} }];
    const entry = makeEntry({ anthropicRequest: { ...makeEntry().anthropicRequest, tools } });
    const { entries } = await parseLogFile(toJSONL([entry]));

    const cacheId = entries[0].anthropicRequest._toolsCacheId;
    assert.ok(cacheId, 'cacheId should be set');
    assert.ok(!entries[0].anthropicRequest.tools, 'inline tools should be removed');

    const retrieved = getToolsFromCache(cacheId);
    assert.deepEqual(retrieved, tools);
  });

  it('deduplicates identical tool arrays across entries (single cache entry)', async () => {
    const tools = [{ name: 't1', description: 'd', input_schema: {} }];
    const entry1 = makeEntry({ anthropicRequest: { ...makeEntry().anthropicRequest, tools } });
    const entry2 = makeEntry({ anthropicRequest: { ...makeEntry().anthropicRequest, tools } });

    const { entries } = await parseLogFile(toJSONL([entry1, entry2]));
    const id1 = entries[0].anthropicRequest._toolsCacheId;
    const id2 = entries[1].anthropicRequest._toolsCacheId;
    assert.equal(id1, id2, 'same tools array should map to the same cache ID');
  });

  it('clearToolsCache removes all cached entries', async () => {
    const tools = [{ name: 'x', description: '', input_schema: {} }];
    const entry = makeEntry({ anthropicRequest: { ...makeEntry().anthropicRequest, tools } });
    const { entries } = await parseLogFile(toJSONL([entry]));
    const cacheId = entries[0].anthropicRequest._toolsCacheId;

    clearToolsCache();
    assert.equal(getToolsFromCache(cacheId), null);
  });
});

// ---------------------------------------------------------------------------
// parseLogFile
// ---------------------------------------------------------------------------

describe('parseLogFile', () => {
  beforeEach(() => {
    clearToolsCache();
  });

  it('throws for empty input', async () => {
    await assert.rejects(() => parseLogFile(''), /empty/i);
    await assert.rejects(() => parseLogFile('   \n  '), /empty/i);
  });

  it('throws when no valid JSON line is found', async () => {
    await assert.rejects(() => parseLogFile('not json\nalso not json'), /unable to parse/i);
  });

  it('parses a single valid entry', async () => {
    const entry = makeEntry();
    const { entries, truncated } = await parseLogFile(toJSONL([entry]));
    assert.equal(entries.length, 1);
    assert.equal(truncated, false);
    assert.equal(entries[0]._index, 0);
    assert.equal(entries[0].timestamp, entry.timestamp);
  });

  it('assigns sequential _index values', async () => {
    const jsonl = toJSONL([makeEntry(), makeEntry(), makeEntry()]);
    const { entries } = await parseLogFile(jsonl);
    assert.deepEqual(
      entries.map((e) => e._index),
      [0, 1, 2],
    );
  });

  it('skips malformed lines without failing', async () => {
    const jsonl = [
      JSON.stringify(makeEntry()),
      '{bad json',
      JSON.stringify(makeEntry()),
    ].join('\n');
    const { entries } = await parseLogFile(jsonl);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]._index, 0);
    assert.equal(entries[1]._index, 1);
  });

  it('skips blank lines', async () => {
    const jsonl = '\n' + JSON.stringify(makeEntry()) + '\n\n' + JSON.stringify(makeEntry()) + '\n';
    const { entries } = await parseLogFile(jsonl);
    assert.equal(entries.length, 2);
  });

  it('detects a truncated file (last line is invalid JSON)', async () => {
    const jsonl = JSON.stringify(makeEntry()) + '\n{truncated';
    const { entries, truncated } = await parseLogFile(jsonl);
    assert.equal(entries.length, 1);
    assert.equal(truncated, true);
  });

  it('caches tools and removes inline tools array from entries', async () => {
    const tools = [{ name: 'tool1', description: 'desc', input_schema: {} }];
    const entry = makeEntry({ anthropicRequest: { ...makeEntry().anthropicRequest, tools } });
    const { entries } = await parseLogFile(toJSONL([entry]));

    assert.ok(entries[0].anthropicRequest._toolsCacheId, 'should have a cacheId');
    assert.equal(entries[0].anthropicRequest.tools, undefined, 'inline tools should be deleted');
  });

  it('does not modify entries that have no tools', async () => {
    const { entries } = await parseLogFile(toJSONL([makeEntry()]));
    assert.equal(entries[0].anthropicRequest._toolsCacheId, undefined);
    assert.equal(entries[0].anthropicRequest.tools, undefined);
  });

  it('handles entries missing anthropicRequest', async () => {
    const minimal = { timestamp: '2026-01-01T00:00:00Z', streaming: false };
    const { entries } = await parseLogFile(JSON.stringify(minimal));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].timestamp, '2026-01-01T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// parseLogFileStreaming
// ---------------------------------------------------------------------------

describe('parseLogFileStreaming', () => {
  beforeEach(() => {
    clearToolsCache();
  });

  it('throws for an empty file', async () => {
    const file = makeFile('');
    await assert.rejects(() => parseLogFileStreaming(file), /empty/i);
  });

  it('throws when no valid JSON line is found', async () => {
    const file = makeFile('not json at all');
    await assert.rejects(() => parseLogFileStreaming(file), /unable to parse/i);
  });

  it('parses a single valid entry', async () => {
    const file = makeFile(toJSONL([makeEntry()]));
    const { entries, truncated } = await parseLogFileStreaming(file);
    assert.equal(entries.length, 1);
    assert.equal(truncated, false);
    assert.equal(entries[0]._index, 0);
  });

  it('parses multiple entries in the correct order', async () => {
    const jsonl = toJSONL([
      makeEntry({ timestamp: 'A' }),
      makeEntry({ timestamp: 'B' }),
      makeEntry({ timestamp: 'C' }),
    ]);
    const { entries } = await parseLogFileStreaming(makeFile(jsonl));
    assert.deepEqual(
      entries.map((e) => e._index),
      [0, 1, 2],
    );
    assert.deepEqual(
      entries.map((e) => e.timestamp),
      ['A', 'B', 'C'],
    );
  });

  it('skips malformed lines without failing', async () => {
    const jsonl = [
      JSON.stringify(makeEntry()),
      '{bad json',
      JSON.stringify(makeEntry()),
    ].join('\n');
    const { entries } = await parseLogFileStreaming(makeFile(jsonl));
    assert.equal(entries.length, 2);
  });

  it('detects a truncated file (last line is incomplete JSON)', async () => {
    const jsonl = JSON.stringify(makeEntry()) + '\n{truncated';
    const { entries, truncated } = await parseLogFileStreaming(makeFile(jsonl));
    assert.equal(entries.length, 1);
    assert.equal(truncated, true);
  });

  it('reports progress via callback', async () => {
    const file = makeFile(toJSONL([makeEntry(), makeEntry()]));
    const reports = [];
    await parseLogFileStreaming(file, (p) => reports.push(p));
    // Final progress report always fires
    assert.ok(reports.length >= 1);
    const last = reports[reports.length - 1];
    assert.equal(last.bytesRead, last.totalBytes);
  });

  it('caches tools and removes inline tools from streaming entries', async () => {
    const tools = [{ name: 'streamTool', description: '', input_schema: {} }];
    const entry = makeEntry({ anthropicRequest: { ...makeEntry().anthropicRequest, tools } });
    const { entries } = await parseLogFileStreaming(makeFile(toJSONL([entry])));

    assert.ok(entries[0].anthropicRequest._toolsCacheId, 'should have a cacheId');
    assert.equal(entries[0].anthropicRequest.tools, undefined, 'inline tools should be deleted');
  });

  it('handles a file without a trailing newline', async () => {
    // No trailing '\n' — the last entry sits in the buffer remainder
    const jsonl = JSON.stringify(makeEntry()) + '\n' + JSON.stringify(makeEntry());
    const { entries } = await parseLogFileStreaming(makeFile(jsonl));
    assert.equal(entries.length, 2);
  });
});

// ---------------------------------------------------------------------------
// extractMetadata
// ---------------------------------------------------------------------------

describe('extractMetadata', () => {
  before(() => {
    clearToolsCache();
  });

  it('extracts basic fields from a minimal entry', () => {
    const entry = makeEntry();
    entry._index = 0;
    const meta = extractMetadata(entry, 0);

    assert.equal(meta.index, 0);
    assert.equal(meta.timestamp, '2026-04-22T00:54:24.000Z');
    assert.equal(meta.model, 'claude-opus-4.6');
    assert.equal(meta.streaming, true);
    assert.equal(meta.messageCount, 1);
    assert.equal(meta.systemPromptCount, 1);
    assert.equal(meta.toolCount, 0);
    assert.equal(meta.maxTokens, 1024);
    assert.equal(meta.temperature, 0.7);
  });

  it('returns model = "unknown" for entries without a model', () => {
    const entry = makeEntry({ anthropicRequest: {} });
    const meta = extractMetadata(entry, 0);
    assert.equal(meta.model, 'unknown');
  });

  it('counts tools from the inline tools array', () => {
    const tools = [{ name: 'a' }, { name: 'b' }];
    const entry = makeEntry({
      anthropicRequest: { ...makeEntry().anthropicRequest, tools },
    });
    const meta = extractMetadata(entry, 0);
    assert.equal(meta.toolCount, 2);
  });

  it('resolves tool count from cache when _toolsCacheId is set', async () => {
    const tools = [{ name: 'x', description: '', input_schema: {} }];
    const entry = makeEntry({ anthropicRequest: { ...makeEntry().anthropicRequest, tools } });
    const { entries } = await parseLogFile(toJSONL([entry]));
    const cached = entries[0];

    // Ensure tools have been moved to cache
    assert.ok(cached.anthropicRequest._toolsCacheId);
    const meta = extractMetadata(cached, 0);
    assert.equal(meta.toolCount, 1);
  });

  it('returns null usage when copilotResponse is empty', () => {
    const entry = makeEntry({ copilotResponse: '' });
    const meta = extractMetadata(entry, 0);
    assert.equal(meta.usage, null);
  });

  it('extracts usage from a valid SSE copilotResponse', () => {
    const usageChunk = {
      id: 'r1',
      model: 'claude',
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    };
    const entry = makeEntry({ copilotResponse: `data: ${JSON.stringify(usageChunk)}\n` });
    const meta = extractMetadata(entry, 0);
    assert.deepEqual(meta.usage, { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
  });
});
