const NATIVE_HOST = 'com.socialdownloader.ytdlp';

let savedCookies = '';

async function loadCookies() {
  const { cookies } = await chrome.storage.local.get('cookies');
  savedCookies = cookies || '';
  return savedCookies;
}

loadCookies();

// Send one request over a fresh native messaging port and wait for one reply.
function nativeRequest(message, timeoutMs = 65000) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (err) {
      reject(new Error(`Native host error: ${err.message}. Run native_host/install.ps1 with your Extension ID.`));
      return;
    }

    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { port.disconnect(); } catch {}
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('Native host request timed out. Make sure yt-dlp is installed and the native host is configured.'));
    }, timeoutMs);

    port.onMessage.addListener((msg) => {
      if (msg && msg.error) {
        finish(reject, new Error(msg.error));
      } else {
        finish(resolve, msg);
      }
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      finish(reject, new Error(err ? err.message : 'Native host disconnected unexpectedly'));
    });

    try {
      port.postMessage(message);
    } catch (err) {
      finish(reject, new Error(err.message));
    }
  });
}

async function extractWithYtDlp(url) {
  return nativeRequest({ action: 'extract', url, cookies: savedCookies }, 65000);
}

async function downloadWithYtDlp(url, format, formatId, title) {
  return nativeRequest(
    { action: 'download', url, cookies: savedCookies, format, format_id: formatId, title },
    600000
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_MEDIA') {
    (async () => {
      try {
        const media = await extractWithYtDlp(message.url);
        sendResponse(media);
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'DOWNLOAD_MEDIA') {
    (async () => {
      try {
        const result = await downloadWithYtDlp(message.url, message.format, message.formatId, message.title);
        sendResponse(result && result.success !== false ? { success: true, path: result.path, note: result.note } : { error: (result && result.error) || 'Download failed' });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
});
