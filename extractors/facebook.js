import {
  findJsonInHtml,
  extractOpenGraph,
  extractDirectVideoUrls,
  extractDirectImageUrls,
  generateFilename
} from '../utils.js';

function extractFromInlineScript(html) {
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const content = match[1];
    if (content.includes('video') && (content.includes('playable_url') || content.includes('browser_native_hd_url') || content.includes('hd_src'))) {
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
      } catch {
        continue;
      }
    }
  }
  return null;
}

function traverseForVideo(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.playable_url || obj.browser_native_hd_url || obj.hd_src || obj.sd_src) {
    return {
      videoUrl: obj.playable_url || obj.browser_native_hd_url || obj.hd_src || obj.sd_src,
      audioUrl: null,
      thumbnail: obj.thumbnail || obj.poster_image || obj.preview_image || null,
      title: obj.title || obj.description || null,
      duration: obj.video_duration || obj.duration || null
    };
  }
  for (const key of Object.keys(obj)) {
    const result = traverseForVideo(obj[key]);
    if (result) return result;
  }
  return null;
}

export async function extractFacebook(html, url) {
  let videoUrl = null;
  let audioUrl = null;
  let thumbnail = null;
  let title = 'Facebook Video';
  let duration = null;

  const data = findJsonInHtml(html, [
    /__PRELOADED_STATE__\s*=\s*({[\s\S]*?});/,
    /window\.__initialData__\s*=\s*({[\s\S]*?});/,
    /"video"\s*:\s*({[\s\S]*?"playable_url"[\s\S]*?})/,
    /"browser_native_hd_url"\s*:\s*"([^"]+)"/,
    /"hd_src"\s*:\s*"([^"]+)"/,
    /"sd_src"\s*:\s*"([^"]+)"/,
    /"playable_url"\s*:\s*"([^"]+)"/,
  ]);

  if (data) {
    const result = traverseForVideo(data);
    if (result) {
      videoUrl = result.videoUrl;
      audioUrl = result.audioUrl;
      thumbnail = result.thumbnail;
      title = result.title || title;
      duration = result.duration;
    }
  }

  if (!videoUrl) {
    const inlineData = extractFromInlineScript(html);
    if (inlineData) {
      const result = traverseForVideo(inlineData);
      if (result) {
        videoUrl = result.videoUrl;
        audioUrl = result.audioUrl;
        thumbnail = result.thumbnail;
        title = result.title || title;
        duration = result.duration;
      }
    }
  }

  if (!videoUrl) {
    const directVideos = extractDirectVideoUrls(html);
    if (directVideos.length > 0) {
      videoUrl = directVideos[0];
    }
  }

  if (!thumbnail) {
    const og = extractOpenGraph(html);
    const directImages = extractDirectImageUrls(html);
    thumbnail = directImages[0] || og['og:image'] || null;
    if (og['og:title']) title = og['og:title'];
    if (og['og:description'] && title === 'Facebook Video') title = og['og:description'];
  }

  if (!videoUrl && !thumbnail) {
    throw new Error('Could not extract Facebook video. Facebook heavily obfuscates video URLs. Try using yt-dlp for better results.');
  }

  const videoIdMatch = url.match(/(?:videos?|watch|reel|share)\/(\d+)/) || url.match(/fbid=(\d+)/) || url.match(/\/(\d{10,})\//);
  const videoId = videoIdMatch ? videoIdMatch[1] : Date.now();

  return {
    videoUrl: videoUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    audioUrl: audioUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    thumbnail,
    filename: generateFilename('facebook', videoId, 'mp4', title),
    title,
    duration,
    quality: videoUrl?.includes('hd') ? 'HD' : (videoUrl ? 'SD' : 'Unknown'),
    isVideo: !!videoUrl
  };
}