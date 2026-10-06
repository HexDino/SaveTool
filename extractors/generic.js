import {
  extractOpenGraph,
  extractJsonLd,
  extractDirectVideoUrls,
  extractDirectImageUrls,
  extractM3U8FromHtml,
  generateFilename
} from '../utils.js';

export async function extractGeneric(html, url) {
  const og = extractOpenGraph(html);
  const jsonLd = extractJsonLd(html);
  const directVideos = extractDirectVideoUrls(html);
  const directImages = extractDirectImageUrls(html);
  const m3u8s = extractM3U8FromHtml(html);

  let videoUrl = null;
  let audioUrl = null;
  let thumbnail = null;
  let title = 'Media';
  let duration = null;
  let isVideo = false;

  if (m3u8s.length > 0) {
    videoUrl = m3u8s[0];
    isVideo = true;
  }

  if (directVideos.length > 0 && !videoUrl) {
    videoUrl = directVideos[0];
    isVideo = true;
  }

  if (jsonLd.length > 0) {
    for (const item of jsonLd) {
      if (item['@type'] === 'VideoObject' || item['@type'] === 'Movie') {
        videoUrl = videoUrl || item.contentUrl || null;
        thumbnail = thumbnail || item.thumbnailUrl || item.thumbnail || null;
        title = title || item.name || item.headline || title;
        duration = duration || parseDuration(item.duration) || null;
        isVideo = true;
      }
      if (item['@type'] === 'ImageObject') {
        thumbnail = thumbnail || item.contentUrl || item.url || null;
        title = title || item.name || title;
      }
      if (Array.isArray(item['@graph'])) {
        for (const graphItem of item['@graph']) {
          if (graphItem['@type'] === 'VideoObject') {
            videoUrl = videoUrl || graphItem.contentUrl || null;
            thumbnail = thumbnail || graphItem.thumbnailUrl || null;
            title = title || graphItem.name || title;
            duration = duration || parseDuration(graphItem.duration) || null;
            isVideo = true;
          }
        }
      }
    }
  }

  if (og['og:title']) title = og['og:title'];
  if (og['og:image']) thumbnail = thumbnail || og['og:image'];
  if (og['og:video']) { videoUrl = videoUrl || og['og:video']; isVideo = true; }
  if (og['og:video:url']) { videoUrl = videoUrl || og['og:video:url']; isVideo = true; }
  if (og['og:video:secure_url']) { videoUrl = videoUrl || og['og:video:secure_url']; isVideo = true; }
  if (og['og:audio']) { audioUrl = audioUrl || og['og:audio']; }
  if (og['og:audio:url']) { audioUrl = audioUrl || og['og:audio:url']; }
  if (og['twitter:player:stream']) { videoUrl = videoUrl || og['twitter:player:stream']; isVideo = true; }
  if (og['twitter:image']) thumbnail = thumbnail || og['twitter:image'];

  if (directImages.length > 0 && !thumbnail) {
    thumbnail = directImages[0];
  }

  if (!videoUrl && !thumbnail) {
    throw new Error('No media found on page. This platform may not be supported or the content may be loaded dynamically.');
  }

  const hostname = new URL(url).hostname.replace('www.', '');
  const ext = (videoUrl && videoUrl.includes('.m3u8')) ? 'mp4' : (isVideo ? 'mp4' : 'jpg');
  return {
    videoUrl: videoUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    audioUrl: audioUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    thumbnail,
    filename: generateFilename(hostname, Date.now(), ext, title),
    title,
    duration,
    quality: isVideo ? 'Direct' : 'Image',
    isVideo
  };
}

function parseDuration(duration) {
  if (!duration) return null;
  if (typeof duration === 'number') return duration;
  const isoMatch = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (isoMatch) {
    const hours = parseInt(isoMatch[1] || 0);
    const minutes = parseInt(isoMatch[2] || 0);
    const seconds = parseInt(isoMatch[3] || 0);
    return hours * 3600 + minutes * 60 + seconds;
  }
  return null;
}