'use strict';
import { formatLogsAsText } from './lib/logger.js';

const logContainer = document.getElementById('logContainer');
const searchInput = document.getElementById('searchInput');
const levelFilter = document.getElementById('levelFilter');
const categoryFilter = document.getElementById('categoryFilter');
const btnRefresh = document.getElementById('btnRefresh');
const btnCopy = document.getElementById('btnCopy');
const btnDownload = document.getElementById('btnDownload');
const btnClear = document.getElementById('btnClear');

let currentLogs = [];

async function loadLogs() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_LOGS' });
    currentLogs = Array.isArray(res?.logs) ? res.logs : [];
    renderLogs();
  } catch (err) {
    logContainer.innerHTML = `<div class="empty-state">Không thể tải nhật ký: ${err?.message || err}</div>`;
  }
}

function renderLogs() {
  const query = (searchInput.value || '').trim().toLowerCase();
  const level = levelFilter.value;
  const category = categoryFilter.value;

  const filtered = currentLogs.filter(item => {
    if (level !== 'ALL' && item.level !== level) return false;
    if (category !== 'ALL' && item.category !== category) return false;
    if (query) {
      const target = `${item.timeFormatted || ''} ${item.level || ''} ${item.category || ''} ${item.message || ''} ${item.details || ''}`.toLowerCase();
      if (!target.includes(query)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    logContainer.innerHTML = `<div class="empty-state">Không có bản ghi nhật ký nào phù hợp.</div>`;
    return;
  }

  logContainer.innerHTML = '';
  // Show newest at top
  const rows = [...filtered].reverse();
  for (const item of rows) {
    const row = document.createElement('div');
    row.className = 'log-row';

    const timeEl = document.createElement('span');
    timeEl.className = 'log-time';
    timeEl.textContent = item.timeFormatted || item.timestamp?.slice(11, 19) || '';

    const lvlBadge = document.createElement('span');
    const lvlKey = (item.level || 'INFO').toLowerCase();
    lvlBadge.className = `badge ${lvlKey}`;
    lvlBadge.textContent = item.level || 'INFO';

    const catBadge = document.createElement('span');
    catBadge.className = 'badge category';
    catBadge.textContent = item.category || 'SYSTEM';

    const msgBox = document.createElement('div');
    msgBox.className = 'log-msg';
    msgBox.textContent = item.message || '';

    if (item.details) {
      const detailsEl = document.createElement('div');
      detailsEl.className = 'log-details';
      detailsEl.textContent = item.details;
      msgBox.appendChild(detailsEl);
    }

    row.append(timeEl, lvlBadge, catBadge, msgBox);
    logContainer.appendChild(row);
  }
}

searchInput.addEventListener('input', renderLogs);
levelFilter.addEventListener('change', renderLogs);
categoryFilter.addEventListener('change', renderLogs);

btnRefresh.addEventListener('click', loadLogs);

btnCopy.addEventListener('click', async () => {
  const text = formatLogsAsText(currentLogs, chrome.runtime.getManifest().version);
  try {
    await navigator.clipboard.writeText(text);
    btnCopy.textContent = '✓ Đã sao chép';
    setTimeout(() => { btnCopy.textContent = '📋 Sao chép'; }, 2000);
  } catch (err) {
    alert('Không thể sao chép: ' + err?.message);
  }
});

btnDownload.addEventListener('click', () => {
  const text = formatLogsAsText(currentLogs, chrome.runtime.getManifest().version);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pacs_extension_activity_${new Date().toISOString().slice(0, 10)}.log`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

btnClear.addEventListener('click', async () => {
  if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ nhật ký hoạt động không?')) return;
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
    currentLogs = [];
    renderLogs();
  } catch (err) {
    alert('Không thể xóa: ' + err?.message);
  }
});

loadLogs();
