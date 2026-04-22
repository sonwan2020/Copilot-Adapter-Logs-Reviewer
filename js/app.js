/**
 * Main application module - wires everything together.
 */
import { parseLogFile, formatSize } from './parser.js';
import {
  renderEntryList,
  renderDetailHeader,
  renderMessagesTab,
  renderSystemTab,
  renderToolsTab,
  renderRequestTab,
  renderResponseTab,
  renderMarkdownContent,
  modelLabel,
} from './renderer.js';

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
}

// ===== File Loading =====
function handleFiles(files) {
  if (!files || files.length === 0) return;

  const file = files[0]; // Handle first file
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const result = parseLogFile(e.target.result);
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
      const system = entry.anthropicRequest?.system || [];
      const sysFound = system.some(s =>
        (s.text || JSON.stringify(s)).toLowerCase().includes(searchVal)
      );
      if (sysFound) {
        state.searchMatchTab[i] = 'system';
        return true;
      }

      // Search tools
      const tools = entry.anthropicRequest?.tools || [];
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
  systemCount.textContent = `(${entry.anthropicRequest?.system?.length || 0})`;
  toolsCount.textContent = `(${entry.anthropicRequest?.tools?.length || 0})`;

  // Auto-switch to the tab where search matched
  const searchVal = searchInput.value.trim();
  if (searchVal && state.searchMatchTab && state.searchMatchTab[index]) {
    setActiveTab(state.searchMatchTab[index]);
  } else {
    renderActiveTab();
  }

  // Scroll to first search match in the rendered tab content
  const activeSearchVal = searchInput.value.trim();
  if (activeSearchVal) {
    scrollToFirstMatch(tabContent, activeSearchVal);
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
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'content-viewer-body';

  // Render content with markdown formatting + plain text toggle
  const wrapper = document.createElement('div');
  wrapper.className = 'md-toggle-wrapper';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'md-toggle-btn';
  toggleBtn.textContent = 'Formatted';
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
  body.appendChild(wrapper);

  viewer.appendChild(header);
  viewer.appendChild(body);
  overlay.appendChild(viewer);

  // Close on overlay click (outside viewer)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
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

// ===== Search Scroll-to-Match =====
function scrollToFirstMatch(container, searchTerm) {
  if (!searchTerm) return;

  // Clean up previous highlights
  container.querySelectorAll('mark.search-highlight').forEach(mark => {
    const parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });

  const lowerTerm = searchTerm.toLowerCase();

  // Walk all text nodes, skipping hidden elements
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip text inside hidden elements (markdown/plain-text toggle)
      let el = node.parentElement;
      while (el && el !== container) {
        if (el.classList.contains('hidden')) return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let matchNode = null;
  let matchOffset = -1;

  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.toLowerCase();
    const idx = text.indexOf(lowerTerm);
    if (idx !== -1) {
      matchNode = walker.currentNode;
      matchOffset = idx;
      break;
    }
  }

  if (!matchNode) return;

  // Open any closed <details> ancestors so the match is visible
  let el = matchNode.parentElement;
  while (el && el !== container) {
    if (el.tagName === 'DETAILS' && !el.open) {
      el.open = true;
    }
    el = el.parentElement;
  }

  // Wrap the match in a <mark> using Range API
  const range = document.createRange();
  range.setStart(matchNode, matchOffset);
  range.setEnd(matchNode, matchOffset + searchTerm.length);

  const mark = document.createElement('mark');
  mark.className = 'search-highlight';
  range.surroundContents(mark);

  // Scroll to the highlight
  requestAnimationFrame(() => {
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
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
    searchTimeout = setTimeout(applyFilters, 300);
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
