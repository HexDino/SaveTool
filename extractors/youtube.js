import {
  findJsonInHtml,
  extractOpenGraph,
  extractDirectVideoUrls,
  extractDirectImageUrls,
  extractM3U8FromHtml,
  generateFilename
} from '../utils.js';

export async function extractYoutube(html, url) {
  const videoIdMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  const videoId = videoIdMatch ? videoIdMatch[1] : null;

  const playerData = findJsonInHtml(html, [
    /ytInitialPlayerResponse\s*=\s*({[\s\S]*?});<\/script>/i,
    /ytInitialData\s*=\s*({[\s\S]*?});<\/script>/i
  ]);

  if (!playerData) {
    const og = extractOpenGraph(html);
    const directVideos = extractDirectVideoUrls(html);
    const directImages = extractDirectImageUrls(html);
    if (directVideos.length > 0) {
      return {
        videoUrl: directVideos[0],
        audioUrl: null,
        thumbnail: directImages[0] || og['og:image'] || null,
        filename: generateFilename('youtube', videoId, 'mp4', og['og:title']),
        title: og['og:title'] || 'YouTube Video',
        duration: null,
        quality: 'Unknown',
        isVideo: true
      };
    }
    if (directImages.length > 0) {
      return {
        videoUrl: null,
        audioUrl: null,
        thumbnail: directImages[0],
        filename: generateFilename('youtube', videoId, 'jpg', og['og:title']),
        title: og['og:title'] || 'YouTube Video',
        duration: null,
        quality: 'Image',
        isVideo: false
      };
    }
    throw new Error('Could not extract YouTube data');
  }

  const videoDetails = playerData.videoDetails;
  const streamingData = playerData.streamingData;
  const microformat = playerData.microformat?.playerMicroformatRenderer;

  const title = videoDetails?.title || 'YouTube Video';
  const thumbnail = videoDetails?.thumbnail?.thumbnails?.pop()?.url || microformat?.thumbnail?.thumbnails?.pop()?.url || null;
  const duration = videoDetails?.lengthSeconds ? parseInt(videoDetails.lengthSeconds) : null;

  let videoUrl = null;
  let audioUrl = null;

  if (streamingData?.formats?.length > 0) {
    const formats = streamingData.formats.filter(f => f.mimeType?.startsWith('video/'));
    formats.sort((a, b) => (b.height || 0) - (a.height || 0));
    videoUrl = formats[0]?.decodedUrl || formats[0]?.url || null;
  }

  if (streamingData?.adaptiveFormats?.length > 0) {
    const videoFormats = streamingData.adaptiveFormats.filter(f => f.mimeType?.startsWith('video/'));
    videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
    if (!videoUrl) {
      videoUrl = videoFormats[0]?.decodedUrl || videoFormats[0]?.url || null;
    }
    const audioFormats = streamingData.adaptiveFormats.filter(f => f.mimeType?.startsWith('audio/'));
    audioUrl = audioFormats[0]?.decodedUrl || audioFormats[0]?.url || null;
  }

  if (!videoUrl && !audioUrl && !thumbnail) {
    const og = extractOpenGraph(html);
    const directVideos = extractDirectVideoUrls(html);
    const directImages = extractDirectImageUrls(html);
    if (directVideos.length > 0) {
      return {
        videoUrl: directVideos[0],
        audioUrl: null,
        thumbnail: directImages[0] || og['og:image'] || null,
        filename: generateFilename('youtube', videoId, 'mp4', title),
        title,
        duration,
        quality: 'Direct',
        isVideo: true
      };
    }
    throw new Error('No playable video found');
  }

  return {
    videoUrl: videoUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    audioUrl: audioUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    thumbnail,
    filename: generateFilename('youtube', videoId, 'mp4', title),
    title,
    duration,
    quality: videoUrl ? 'Best available' : 'Audio only',
    isVideo: !!videoUrl
  };
}