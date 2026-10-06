import {
  findJsonInHtml,
  extractOpenGraph,
  extractDirectVideoUrls,
  extractDirectImageUrls,
  generateFilename
} from '../utils.js';

export async function extractTiktok(html, url) {
  const videoIdMatch = url.match(/\/video\/(\d+)/) || url.match(/\/v\/(\d+)/);
  const videoId = videoIdMatch ? videoIdMatch[1] : null;

  const data = findJsonInHtml(html, [
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/,
    /"video":({[\s\S]*?"playAddr"[\s\S]*?})/,
    /"downloadAddr"\s*:\s*"([^"]+)"/,
    /"playAddr"\s*:\s*"([^"]+)"/,
    /"cover"\s*:\s*"([^"]+)"/,
  ]);

  let videoUrl = null;
  let audioUrl = null;
  let thumbnail = null;
  let title = 'TikTok Video';
  let duration = null;

  if (data) {
    videoUrl = data.video?.playAddr ||
      data.video?.downloadAddr ||
      data.playAddr ||
      data.downloadAddr ||
      data.video?.url;
    
    audioUrl = data.music?.playUrl ||
      data.audio?.playUrl ||
      data.music?.url ||
      null;
    
    thumbnail = data.video?.cover ||
      data.video?.thumbnail ||
      data.video?.originCover ||
      data.video?.dynamicCover ||
      data.cover ||
      null;
    
    title = data.video?.description ||
      data.video?.desc ||
      data.desc ||
      data.title ||
      title;
    
    duration = data.video?.duration || data.duration || null;
  }

  if (!videoUrl) {
    const directVideos = extractDirectVideoUrls(html);
    if (directVideos.length > 0) {
      videoUrl = directVideos[0];
    }
  }

  if (!videoUrl && !thumbnail) {
    const og = extractOpenGraph(html);
    const directVideos = extractDirectVideoUrls(html);
    const directImages = extractDirectImageUrls(html);
    
    if (directVideos.length > 0) {
      return {
        videoUrl: directVideos[0],
        audioUrl: null,
        thumbnail: directImages[0] || og['og:image'] || null,
        filename: generateFilename('tiktok', videoId, 'mp4', og['og:title']),
        title: og['og:title'] || 'TikTok Video',
        duration: null,
        quality: 'Direct',
        isVideo: true
      };
    }
    if (directImages.length > 0) {
      return {
        videoUrl: null,
        audioUrl: null,
        thumbnail: directImages[0],
        filename: generateFilename('tiktok', videoId, 'jpg', og['og:title']),
        title: og['og:title'] || 'TikTok Video',
        duration: null,
        quality: 'Image',
        isVideo: false
      };
    }
    throw new Error('Could not extract TikTok video');
  }

  return {
    videoUrl: videoUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    audioUrl: audioUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    thumbnail,
    filename: generateFilename('tiktok', videoId, 'mp4', title),
    title: title?.substring(0, 100) || 'TikTok Video',
    duration,
    quality: 'Best available',
    isVideo: true
  };
}