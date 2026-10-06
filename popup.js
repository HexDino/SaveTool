const urlInput = document.getElementById('urlInput');
const downloadBtn = document.getElementById('downloadBtn');
const statusEl = document.getElementById('status');
const progressBar = document.getElementById('progressBar');
const platformBadge = document.getElementById('platformBadge');
const mediaInfo = document.getElementById('mediaInfo');
const mediaPreview = document.getElementById('mediaPreview');
const mediaMeta = document.getElementById('mediaMeta');
const btnMp4 = document.getElementById('btnMp4');
const btnMp3 = document.getElementById('btnMp3');
const qualityGroup = document.getElementById('qualityGroup');
const qualitySelect = document.getElementById('qualitySelect');
const audioGroup = document.getElementById('audioGroup');
const audioSelect = document.getElementById('audioSelect');

let selectedFormat = 'mp4';
let detectedPlatform = null;
let currentMedia = null;
let currentMediaUrl = null;
let selectedQuality = null;
let selectedAudio = null;

function detectPlatform(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    if (hostname.includes('instagram.com')) return 'instagram';
    if (hostname.includes('facebook.com') || hostname.includes('fbcdn.net')) return 'facebook';
    if (hostname.includes('threads.net') || hostname.includes('threads.com')) return 'threads';
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
    if (hostname.includes('tiktok.com')) return 'tiktok';
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function updatePlatformBadge(platform) {
  detectedPlatform = platform;
  platformBadge.textContent = platform.charAt(0).toUpperCase() + platform.slice(1);
  platformBadge.className = `platform-badge ${platform}`;
  platformBadge.style.display = 'inline-block';
}

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  progressBar.classList.toggle('active', type === 'loading');
}

function showMediaInfo(media) {
  currentMedia = media;
  mediaPreview.innerHTML = '';
  if (media.thumbnail) {
    const img = document.createElement('img');
    img.src = media.thumbnail;
    img.alt = 'Preview';
    mediaPreview.appendChild(img);
  }
  mediaMeta.textContent = `${media.title || 'Media'} • ${media.duration ? formatDuration(media.duration) : 'Unknown duration'} • ${media.quality || 'Best quality'}`;
  mediaInfo.classList.add('visible');

  populateQualitySelect(media);
  populateAudioSelect(media);
  updateFormatUI();
}

function populateQualitySelect(media) {
  qualitySelect.innerHTML = '';
  if (media.formats && media.formats.length > 0) {
    media.formats.forEach((f, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = f.label;
      qualitySelect.appendChild(opt);
    });
    selectedQuality = 0;
  } else {
    const opt = document.createElement('option');
    opt.value = 0;
    opt.textContent = media.quality || 'Best quality';
    qualitySelect.appendChild(opt);
    selectedQuality = 0;
  }
}

function populateAudioSelect(media) {
  audioSelect.innerHTML = '';
  if (media.audioFormats && media.audioFormats.length > 0) {
    media.audioFormats.forEach((f, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = f.label;
      audioSelect.appendChild(opt);
    });
    selectedAudio = 0;
  } else {
    const opt = document.createElement('option');
    opt.value = 0;
    opt.textContent = 'Best audio';
    audioSelect.appendChild(opt);
    selectedAudio = 0;
  }
}

function updateFormatUI() {
  if (selectedFormat === 'mp4') {
    qualityGroup.style.display = currentMedia ? 'block' : 'none';
    audioGroup.style.display = 'none';
  } else {
    qualityGroup.style.display = 'none';
    audioGroup.style.display = currentMedia ? 'block' : 'none';
  }
}

function formatDuration(seconds) {
  if (!seconds) return 'Unknown';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function setDownloading(downloading) {
  downloadBtn.disabled = downloading;
  downloadBtn.textContent = downloading ? 'Working...' : (currentMedia ? 'Download Selected' : 'Download');
  btnMp4.disabled = downloading;
  btnMp3.disabled = downloading;
  urlInput.disabled = downloading;
  qualitySelect.disabled = downloading;
  audioSelect.disabled = downloading;
}

urlInput.addEventListener('input', () => {
  const url = urlInput.value.trim();
  const platform = detectPlatform(url);
  if (platform !== 'unknown') {
    updatePlatformBadge(platform);
    downloadBtn.disabled = false;
    if (url !== currentMediaUrl) {
      currentMedia = null;
      currentMediaUrl = null;
      mediaInfo.classList.remove('visible');
      qualityGroup.style.display = 'none';
      audioGroup.style.display = 'none';
    }
    setStatus('');
  } else {
    currentMedia = null;
    currentMediaUrl = null;
    platformBadge.style.display = 'none';
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Download';
    mediaInfo.classList.remove('visible');
    qualityGroup.style.display = 'none';
    audioGroup.style.display = 'none';
    setStatus('');
  }
});

document.querySelectorAll('.format-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedFormat = btn.dataset.format;
    updateFormatUI();
  });
});

qualitySelect.addEventListener('change', () => {
  selectedQuality = parseInt(qualitySelect.value);
});

audioSelect.addEventListener('change', () => {
  selectedAudio = parseInt(audioSelect.value);
});

downloadBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url || detectedPlatform === 'unknown') return;

  setDownloading(true);

  try {
    // Step 1: extract media info for preview + quality list (if not already extracted for this URL)
    if (!currentMedia || currentMediaUrl !== url) {
      setStatus('Extracting with yt-dlp...', 'loading');
      const response = await chrome.runtime.sendMessage({
        type: 'EXTRACT_MEDIA',
        url,
        format: selectedFormat,
        platform: detectedPlatform
      });

      if (!response || response.error) {
        setStatus((response && response.error) || 'Extraction failed', 'error');
        return;
      }

      showMediaInfo(response);
      currentMediaUrl = url;
      setStatus('Pick a format/quality, then click Download Selected.', '');
      return;
    }

    // Step 2: ask the native host to download via yt-dlp with the chosen format
    let formatId = null;
    if (selectedFormat === 'mp4') {
      const f = currentMedia.formats && currentMedia.formats[selectedQuality];
      formatId = f ? f.id : null;
    } else {
      const f = currentMedia.audioFormats && currentMedia.audioFormats[selectedAudio];
      formatId = f ? f.id : null;
    }

    setStatus('Downloading via yt-dlp...', 'loading');
    const downloadResponse = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_MEDIA',
      url,
      format: selectedFormat,
      formatId,
      title: currentMedia.title || 'download'
    });

    if (!downloadResponse || downloadResponse.error) {
      setStatus((downloadResponse && downloadResponse.error) || 'Download failed', 'error');
    } else {
      const note = downloadResponse.note ? `\n\nNote: ${downloadResponse.note}` : '';
      const where = downloadResponse.path ? `\nSaved to: ${downloadResponse.path}` : '';
      setStatus(`Download complete!${where}${note}`, 'success');
      urlInput.value = '';
      platformBadge.style.display = 'none';
      mediaInfo.classList.remove('visible');
      qualityGroup.style.display = 'none';
      audioGroup.style.display = 'none';
      currentMedia = null;
      currentMediaUrl = null;
    }
  } catch (err) {
    let errorMsg = `Error: ${err.message}`;
    if (err.message.includes('Native host') || err.message.includes('native messaging')) {
      errorMsg += '\n\nFix: Run native_host/install.ps1 with your Extension ID, then reload the extension.';
    }
    setStatus(errorMsg, 'error');
  } finally {
    setDownloading(false);
  }
});
