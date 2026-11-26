'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';
    document.getElementById('site-url').textContent =
      url.replace(/^https?:\/\//, '').replace(/\/$/, '') || '—';
  } catch {
    document.getElementById('site-url').textContent = '—';
  }
});
