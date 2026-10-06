const cookiesTextarea = document.getElementById('cookiesTextarea');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const statusEl = document.getElementById('status');

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['cookies'], (result) => {
    if (result.cookies) {
      cookiesTextarea.value = result.cookies;
    }
  });
});

saveBtn.addEventListener('click', () => {
  const cookies = cookiesTextarea.value;
  chrome.storage.local.set({ cookies }, () => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, 'error');
    } else {
      setStatus('Cookies saved successfully!', 'success');
    }
  });
});

loadBtn.addEventListener('click', () => {
  chrome.storage.local.get(['cookies'], (result) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, 'error');
    } else if (result.cookies) {
      cookiesTextarea.value = result.cookies;
      setStatus('Cookies loaded successfully!', 'success');
    } else {
      setStatus('No saved cookies found.', 'error');
    }
  });
});
