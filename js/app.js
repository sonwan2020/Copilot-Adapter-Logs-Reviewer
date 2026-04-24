/**
 * Main application module - wires everything together.
 */
import { parseLogFile, parseLogFileStreaming, formatSize, getToolsFromCache, getSystemPromptFromCache } from './parser.js';
import {
  renderEntryList,
  renderDetailHeader,
  renderMessagesTab,
  renderSystemTab,
  renderToolsTab,
  renderRequestTab,
  renderResponseTab,
  renderRawTab,
  createLazyToggleWrapper,
  modelLabel,
} from './renderer.js';

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
 * Helper function to get system prompt from an entry, handling both cached and inline system.
 * @param {object} entry
 * @returns {Array}
 */
function getSystemPrompt(entry) {
  const req = entry.anthropicRequest;
  if (!req) return [];

  // Check if system prompt is cached
  if (req._systemPromptCacheId) {
    return getSystemPromptFromCache(req._systemPromptCacheId) || [];
  }

  // Fall back to inline system (for backwards compatibility or if caching failed)
  return req.system || [];
}

// ===== State =====
let state = {
  entries: [],
  filteredEntries: [],
  selectedIndex: -1,
  activeTab: 'messages',
  fileName: '',
  fileSize: 0,
  truncated: false,
  searchMatchTab: {},
  searchMatches: [],
  searchMatchIndex: -1,
};

// ===== DOM References =====
const $ = (id) => document.getElementById(id);

const dropZone = $('dropZone');
const dropZoneContainer = $('dropZoneContainer');
const fileInput = $('fileInput');
const fileInfo = $('fileInfo');
const fileName = $('fileName');
const fileSize = $('fileSize');
const entryCount = $('entryCount');
const truncatedBadge = $('truncatedBadge');
const closeFileBtn = $('closeFile');
const mainContent = $('mainContent');
const entryList = $('entryList');
const modelFilter = $('modelFilter');
const searchInput = $('searchInput');
const filteredCount = $('filteredCount');
const detailEmpty = $('detailEmpty');
const detailView = $('detailView');
const detailHeader = $('detailHeader');
const tabContent = $('tabContent');
const tabs = $('tabs');
const themeToggle = $('themeToggle');
const systemCount = $('systemCount');
const toolsCount = $('toolsCount');
const searchNav = $('searchNav');
const searchPrev = $('searchPrev');
const searchNext = $('searchNext');
const searchMatchCountEl = $('searchMatchCount');

// ===== Theme =====
function initTheme() {
  const saved = localStorage.getItem('logs-reviewer-theme');
  if (saved) {
    document.documentElement.dataset.theme = saved;
  }
  updateThemeIcon();
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('logs-reviewer-theme', next);
  updateThemeIcon();
}

function updateThemeIcon() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  themeToggle.textContent = isDark ? '\u2600' : '\u263E';

  // Swap highlight.js theme
  const lightSheet = document.getElementById('hljs-theme-light');
  const darkSheet = document.getElementById('hljs-theme-dark');
  if (lightSheet) lightSheet.disabled = isDark;
  if (darkSheet) darkSheet.disabled = !isDark;
}

// ===== File Loading =====
function handleFiles(files) {
  if (!files || files.length === 0) return;

  const file = files[0]; // Handle first file

  // Use streaming parser for lower memory usage; fall back to FileReader
  // if the Blob.stream() API is not available.
  if (typeof file.stream === 'function') {
    handleFileStreaming(file);
  } else {
    handleFileLegacy(file);
  }
}

/**
 * Stream-parse the file in chunks. Shows a progress indicator while loading.
 * Peak memory ≈ parsed entries only (no full-file string copy).
 */
async function handleFileStreaming(file) {
  const progress = showLoadingProgress(file.name, file.size);

  try {
    const result = await parseLogFileStreaming(file, ({ bytesRead, totalBytes }) => {
      const pct = totalBytes > 0 ? Math.round((bytesRead / totalBytes) * 100) : 0;
      progress.update(pct, `Parsing\u2026 ${formatSize(bytesRead)} / ${formatSize(totalBytes)}`);
    });

    progress.remove();
    loadEntries(result.entries, file.name, file.size, result.truncated);
  } catch (err) {
    progress.remove();
    alert(`Error parsing file: ${err.message}`);
  }
}

/**
 * Legacy path: read entire file into a string via FileReader.
 * Used only when Blob.stream() is unavailable (older browsers).
 */
function handleFileLegacy(file) {
  const reader = new FileReader();

  reader.onload = async (e) => {
    try {
      const result = await parseLogFile(e.target.result);
      loadEntries(result.entries, file.name, file.size, result.truncated);
    } catch (err) {
      alert(`Error parsing file: ${err.message}`);
    }
  };

  reader.onerror = () => {
    alert('Error reading file.');
  };

  reader.readAsText(file);
}

/**
 * Show an overlay progress bar while a file is being parsed.
 * Returns { update(pct, text), remove() }.
 */
function showLoadingProgress(name, size) {
  const overlay = document.createElement('div');
  overlay.className = 'loading-overlay';

  const box = document.createElement('div');
  box.className = 'loading-box';

  const title = document.createElement('div');
  title.className = 'loading-title';
  title.textContent = `Loading ${name} (${formatSize(size)})`;
  box.appendChild(title);

  const barOuter = document.createElement('div');
  barOuter.className = 'loading-bar-outer';
  const barInner = document.createElement('div');
  barInner.className = 'loading-bar-inner';
  barInner.style.width = '0%';
  barOuter.appendChild(barInner);
  box.appendChild(barOuter);

  const status = document.createElement('div');
  status.className = 'loading-status';
  status.textContent = 'Starting\u2026';
  box.appendChild(status);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  return {
    update(pct, text) {
      barInner.style.width = `${pct}%`;
      status.textContent = text;
    },
    remove() {
      overlay.remove();
    },
  };
}

function loadEntries(entries, name, size, truncated) {
  state.entries = entries;
  state.fileName = name;
  state.fileSize = size;
  state.truncated = truncated;
  state.selectedIndex = -1;
  state.activeTab = 'messages';

  // Show file info
  fileName.textContent = name;
  fileSize.textContent = formatSize(size);
  entryCount.textContent = `${entries.length} entries`;
  truncatedBadge.classList.toggle('hidden', !truncated);
  fileInfo.classList.remove('hidden');

  // Compact drop zone
  dropZone.classList.add('compact');

  // Populate model filter
  const models = [...new Set(entries.map(e => e.anthropicRequest?.model || 'unknown'))];
  modelFilter.innerHTML = '<option value="">All models</option>';
  for (const model of models) {
    const opt = document.createElement('option');
    opt.value = model;
    opt.textContent = model;
    modelFilter.appendChild(opt);
  }

  // Show main content
  mainContent.classList.remove('hidden');

  // Apply filters and render
  applyFilters();

  // Auto-select first entry
  if (entries.length > 0) {
    selectEntry(0);
  }
}

function closeFile() {
  state = {
    entries: [],
    filteredEntries: [],
    selectedIndex: -1,
    activeTab: 'messages',
    fileName: '',
    fileSize: 0,
    truncated: false,
    searchMatchTab: {},
    searchMatches: [],
    searchMatchIndex: -1,
  };

  fileInfo.classList.add('hidden');
  mainContent.classList.add('hidden');
  detailEmpty.classList.remove('hidden');
  detailView.classList.add('hidden');
  dropZone.classList.remove('compact');
  entryList.innerHTML = '';
  tabContent.innerHTML = '';
  searchInput.value = '';
  modelFilter.innerHTML = '<option value="">All models</option>';
  updateSearchNav();
}

// ===== Filtering =====
function applyFilters() {
  const modelVal = modelFilter.value;
  const searchVal = searchInput.value.toLowerCase().trim();

  // Track which tab the search matched in for each entry
  state.searchMatchTab = {};

  state.filteredEntries = state.entries.filter((entry, i) => {
    // Model filter
    if (modelVal && (entry.anthropicRequest?.model || 'unknown') !== modelVal) {
      return false;
    }

    // Text search
    if (searchVal) {
      // Search messages
      const messages = entry.anthropicRequest?.messages || [];
      const msgFound = messages.some(msg => {
        const content = typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
        return content.toLowerCase().includes(searchVal);
      });
      if (msgFound) {
        state.searchMatchTab[i] = 'messages';
        return true;
      }

      // Search system prompts
      const system = getSystemPrompt(entry);
      const sysFound = system.some(s =>
        (s.text || JSON.stringify(s)).toLowerCase().includes(searchVal)
      );
      if (sysFound) {
        state.searchMatchTab[i] = 'system';
        return true;
      }

      // Search tools
      const tools = getTools(entry);
      const toolFound = tools.some(t =>
        (t.name || '').toLowerCase().includes(searchVal) ||
        (t.description || '').toLowerCase().includes(searchVal)
      );
      if (toolFound) {
        state.searchMatchTab[i] = 'tools';
        return true;
      }

      // Search response
      const response = entry.copilotResponse || '';
      if (response.toLowerCase().includes(searchVal)) {
        state.searchMatchTab[i] = 'response';
        return true;
      }

      return false;
    }

    return true;
  });

  filteredCount.textContent = `${state.filteredEntries.length}/${state.entries.length}`;

  renderEntryList(state.filteredEntries, entryList, (filteredIndex) => {
    // Map filtered index back to original index
    const entry = state.filteredEntries[filteredIndex];
    const originalIndex = state.entries.indexOf(entry);
    selectEntry(originalIndex);
  });

  // Highlight active entry in the list
  updateActiveEntryInList();
}

function updateActiveEntryInList() {
  const items = entryList.querySelectorAll('.entry-item');
  items.forEach((item) => {
    const entry = state.filteredEntries[parseInt(item.dataset.index)];
    const originalIndex = state.entries.indexOf(entry);
    item.classList.toggle('active', originalIndex === state.selectedIndex);
  });
}

// ===== Entry Selection =====
function selectEntry(index) {
  if (index < 0 || index >= state.entries.length) return;

  state.selectedIndex = index;
  const entry = state.entries[index];

  // Show detail view
  detailEmpty.classList.add('hidden');
  detailView.classList.remove('hidden');

  // Render header
  renderDetailHeader(entry, detailHeader);

  // Update tab counts
  systemCount.textContent = `(${getSystemPrompt(entry).length})`;
  toolsCount.textContent = `(${getTools(entry).length})`;

  // Collect search matches and navigate to first one
  const searchVal = searchInput.value.trim();
  if (searchVal && state.searchMatchTab && state.searchMatchTab[index]) {
    state.searchMatches = collectAllMatches(entry, searchVal);
    state.searchMatchIndex = -1;
    setActiveTab(state.searchMatchTab[index]);
    navigateToMatch(0);
  } else {
    state.searchMatches = [];
    state.searchMatchIndex = -1;
    // Preserve current tab when switching entries; default to 'messages' on first selection
    setActiveTab(state.activeTab || 'messages');
    updateSearchNav();
  }

  // Update active entry in sidebar
  updateActiveEntryInList();
}

// ===== Tab Rendering =====
function renderActiveTab() {
  const entry = state.entries[state.selectedIndex];
  if (!entry) return;

  tabContent.innerHTML = '';

  switch (state.activeTab) {
    case 'messages':
      tabContent.appendChild(renderMessagesTab(entry));
      // Scroll to the last user message
      {
        const userMsgs = tabContent.querySelectorAll('.message.user');
        const lastUser = userMsgs[userMsgs.length - 1];
        if (lastUser) {
          requestAnimationFrame(() => lastUser.scrollIntoView({ block: 'start' }));
        }
      }
      break;
    case 'system':
      tabContent.appendChild(renderSystemTab(entry));
      break;
    case 'tools':
      tabContent.appendChild(renderToolsTab(entry, searchInput.value.trim()));
      break;
    case 'request':
      tabContent.appendChild(renderRequestTab(entry, {
        onSwitchTab: (tabName) => setActiveTab(tabName),
        onShowContent: (title, text) => showContentViewer(title, text),
      }));
      break;
    case 'response':
      tabContent.appendChild(renderResponseTab(entry));
      break;
    case 'raw':
      tabContent.appendChild(renderRawTab(entry));
      break;
  }
}

function setActiveTab(tabName) {
  state.activeTab = tabName;

  // Update tab buttons
  tabs.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  renderActiveTab();
}

// ===== Content Viewer =====
function showContentViewer(title, text) {
  // Remove existing viewer if any
  const existing = document.querySelector('.content-viewer-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'content-viewer-overlay';

  const viewer = document.createElement('div');
  viewer.className = 'content-viewer';

  const header = document.createElement('div');
  header.className = 'content-viewer-header';
  header.innerHTML = `<span class="content-viewer-title"></span>`;
  header.querySelector('.content-viewer-title').textContent = title;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'content-viewer-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', () => {
    overlay.remove();
    document.removeEventListener('keydown', escHandler);
  });
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'content-viewer-body';

  // Render content with lazy markdown/plain text toggle
  body.appendChild(createLazyToggleWrapper(text, 'Formatted'));

  viewer.appendChild(header);
  viewer.appendChild(body);
  overlay.appendChild(viewer);

  // Close on overlay click (outside viewer)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    }
  });

  // Close on Escape key
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  document.body.appendChild(overlay);
}

// ===== Search Match Navigation =====

/**
 * Collect all search matches in an entry across tabs (Messages → System → Tools).
 * Each match: { tab, occurrenceInTab } — we track which tab and the Nth occurrence within that tab.
 */
function collectAllMatches(entry, searchTerm) {
  const matches = [];
  const lowerTerm = searchTerm.toLowerCase();

  // Helper: count all occurrences in a string
  function countOccurrences(text) {
    const lower = text.toLowerCase();
    let count = 0;
    let pos = 0;
    while ((pos = lower.indexOf(lowerTerm, pos)) !== -1) {
      count++;
      pos += lowerTerm.length;
    }
    return count;
  }

  // Messages tab
  const messages = entry.anthropicRequest?.messages || [];
  let msgTotal = 0;
  for (const msg of messages) {
    const blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }];
    for (const block of blocks) {
      const text = block.text || (block.type === 'text' ? '' : JSON.stringify(block));
      msgTotal += countOccurrences(text);
    }
  }
  for (let i = 0; i < msgTotal; i++) {
    matches.push({ tab: 'messages', occurrenceInTab: i });
  }

  // System tab
  const system = getSystemPrompt(entry);
  let sysTotal = 0;
  for (const s of system) {
    const text = s.text || s.content || JSON.stringify(s);
    sysTotal += countOccurrences(text);
  }
  for (let i = 0; i < sysTotal; i++) {
    matches.push({ tab: 'system', occurrenceInTab: i });
  }

  // Tools tab
  const tools = getTools(entry);
  let toolTotal = 0;
  for (const t of tools) {
    toolTotal += countOccurrences(t.name || '');
    toolTotal += countOccurrences(t.description || '');
  }
  for (let i = 0; i < toolTotal; i++) {
    matches.push({ tab: 'tools', occurrenceInTab: i });
  }

  // Response tab (search copilotResponse raw text)
  const response = entry.copilotResponse || '';
  let respTotal = countOccurrences(response);
  for (let i = 0; i < respTotal; i++) {
    matches.push({ tab: 'response', occurrenceInTab: i });
  }

  return matches;
}

/**
 * Navigate to a specific match by index. Switches tab if needed, highlights, and scrolls.
 */
function navigateToMatch(index) {
  if (index < 0 || index >= state.searchMatches.length) return;

  const match = state.searchMatches[index];
  state.searchMatchIndex = index;

  // Switch tab if needed (setActiveTab re-renders content)
  if (state.activeTab !== match.tab) {
    setActiveTab(match.tab);
  }

  // Highlight the Nth occurrence within the current tab's rendered content
  highlightNthMatch(tabContent, searchInput.value.trim(), match.occurrenceInTab);
  updateSearchNav();
}

/**
 * Walk visible text nodes in container, highlight ALL occurrences of searchTerm
 * with lighter yellow, and the Nth occurrence (current) with bright yellow. Scroll to current.
 */
function highlightNthMatch(container, searchTerm, n) {
  if (!searchTerm) return;

  // Clean up previous highlights
  container.querySelectorAll('mark.search-highlight, mark.search-highlight-all').forEach(mark => {
    const parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });

  const lowerTerm = searchTerm.toLowerCase();

  // First pass: collect all match positions (node + offset) by walking text nodes
  const allMatches = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement;
      while (el && el !== container) {
        if (el.classList.contains('hidden')) return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const text = textNode.textContent.toLowerCase();
    let pos = 0;
    while ((pos = text.indexOf(lowerTerm, pos)) !== -1) {
      allMatches.push({ node: textNode, offset: pos });
      pos += lowerTerm.length;
    }
  }

  if (allMatches.length === 0) return;

  // Wrap matches in reverse order so earlier offsets stay valid
  let currentMark = null;
  for (let i = allMatches.length - 1; i >= 0; i--) {
    const { node, offset } = allMatches[i];
    const isCurrent = i === n;

    // Open any closed <details> ancestors for the current match
    if (isCurrent) {
      let el = node.parentElement;
      while (el && el !== container) {
        if (el.tagName === 'DETAILS' && !el.open) {
          el.open = true;
        }
        el = el.parentElement;
      }
    }

    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + searchTerm.length);

    const mark = document.createElement('mark');
    mark.className = isCurrent ? 'search-highlight' : 'search-highlight-all';
    range.surroundContents(mark);

    if (isCurrent) {
      currentMark = mark;
    }
  }

  // Scroll to the current match
  if (currentMark) {
    requestAnimationFrame(() => {
      currentMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
}

/**
 * Update Prev/Next button states and match counter.
 */
function updateSearchNav() {
  const hasSearch = searchInput.value.trim().length > 0;
  const total = state.searchMatches.length;
  const idx = state.searchMatchIndex;

  if (hasSearch && total > 0) {
    searchNav.classList.remove('hidden');
    searchMatchCountEl.textContent = `${idx + 1} / ${total}`;
    searchPrev.disabled = idx <= 0;
    searchNext.disabled = idx >= total - 1;
  } else {
    searchNav.classList.toggle('hidden', !hasSearch);
    searchMatchCountEl.textContent = hasSearch ? '0 / 0' : '';
    searchPrev.disabled = true;
    searchNext.disabled = true;
  }
}

// ===== Drag & Drop =====
function initDragDrop() {
  // Prevent default for drag events on the document (prevents browser file open)
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
    document.addEventListener(event, (e) => {
      e.preventDefault();
    });
  });

  // Visual feedback on drop zone
  dropZone.addEventListener('dragenter', () => dropZone.classList.add('drag-over'));
  dropZone.addEventListener('dragover', () => dropZone.classList.add('drag-over'));
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

  // Also allow dropping anywhere on the page
  document.addEventListener('dragenter', () => dropZone.classList.add('drag-over'));
  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) {
      dropZone.classList.remove('drag-over');
    }
  });

  // Handle drop anywhere on the document (single handler to avoid double processing)
  document.addEventListener('drop', (e) => {
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  });

  // Click to browse
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = ''; // Reset so same file can be re-selected
  });
}

// ===== Event Listeners =====
function initEventListeners() {
  // Theme toggle
  themeToggle.addEventListener('click', toggleTheme);

  // Close file
  closeFileBtn.addEventListener('click', closeFile);

  // Tab switching
  tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab && tab.dataset.tab) {
      setActiveTab(tab.dataset.tab);
    }
  });

  // Model filter
  modelFilter.addEventListener('change', applyFilters);

  // Search with debounce
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      applyFilters();
      // Reset match nav when search changes
      state.searchMatches = [];
      state.searchMatchIndex = -1;
      updateSearchNav();
    }, 300);
  });

  // Search navigation buttons
  searchPrev.addEventListener('click', () => {
    if (state.searchMatchIndex > 0) {
      navigateToMatch(state.searchMatchIndex - 1);
    }
  });
  searchNext.addEventListener('click', () => {
    if (state.searchMatchIndex < state.searchMatches.length - 1) {
      navigateToMatch(state.searchMatchIndex + 1);
    }
  });

  // Keyboard navigation (works with filtered list)
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (state.filteredEntries.length === 0) return;

    // Find current position in filtered list
    const currentEntry = state.entries[state.selectedIndex];
    const filteredIdx = state.filteredEntries.indexOf(currentEntry);

    if (e.key === 'ArrowUp') {
      const prevIdx = filteredIdx > 0 ? filteredIdx - 1 : 0;
      const originalIndex = state.entries.indexOf(state.filteredEntries[prevIdx]);
      if (originalIndex >= 0) selectEntry(originalIndex);
    } else if (e.key === 'ArrowDown') {
      const nextIdx = filteredIdx < state.filteredEntries.length - 1 ? filteredIdx + 1 : filteredIdx;
      const originalIndex = state.entries.indexOf(state.filteredEntries[nextIdx]);
      if (originalIndex >= 0) selectEntry(originalIndex);
    }
  });
}

// ===== Initialize =====
function init() {
  initTheme();
  initDragDrop();
  initEventListeners();
}

document.addEventListener('DOMContentLoaded', init);
