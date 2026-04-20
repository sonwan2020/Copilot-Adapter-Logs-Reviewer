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

  state.filteredEntries = state.entries.filter((entry, i) => {
    // Model filter
    if (modelVal && (entry.anthropicRequest?.model || 'unknown') !== modelVal) {
      return false;
    }

    // Text search
    if (searchVal) {
      const messages = entry.anthropicRequest?.messages || [];
      const found = messages.some(msg => {
        const content = typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
        return content.toLowerCase().includes(searchVal);
      });
      if (!found) {
        // Also search system prompts
        const system = entry.anthropicRequest?.system || [];
        const sysFound = system.some(s =>
          (s.text || JSON.stringify(s)).toLowerCase().includes(searchVal)
        );
        if (!sysFound) return false;
      }
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

  // Render active tab
  renderActiveTab();

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
      tabContent.appendChild(renderToolsTab(entry));
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

  // Render content with markdown formatting
  body.appendChild(renderMarkdown(text));

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

/**
 * Render text as formatted markdown with syntax coloring.
 * Handles: headings, code blocks (with language label), inline code,
 * bold, italic, links, blockquotes, horizontal rules, and lists.
 */
function renderMarkdown(text) {
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
          el.innerHTML = formatInline(headingMatch[2]);
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
          bq.innerHTML = formatInline(bqLines.join('\n'));
          container.appendChild(bq);
          continue;
        }

        // Unordered list
        if (/^\s*[-*+]\s+/.test(line)) {
          const ul = document.createElement('ul');
          ul.className = 'md-list';
          while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
            const li = document.createElement('li');
            li.innerHTML = formatInline(lines[i].replace(/^\s*[-*+]\s+/, ''));
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
            li.innerHTML = formatInline(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
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
        para.innerHTML = formatInline(paraLines.join('\n'));
        container.appendChild(para);
      }
    }
  }

  return container;
}

/**
 * Format inline markdown: bold, italic, inline code, links.
 */
function formatInline(text) {
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
 * Escape HTML characters.
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
