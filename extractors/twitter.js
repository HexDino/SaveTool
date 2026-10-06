import {
  findJsonInHtml,
  extractOpenGraph,
  extractDirectVideoUrls,
  extractDirectImageUrls,
  generateFilename
} from '../utils.js';

export async function extractTwitter(html, url) {
  const tweetIdMatch = url.match(/status\/(\d+)/) || url.match(/\/\/(?:twitter|x)\.com\/\w+\/status\/(\d+)/);
  const tweetId = tweetIdMatch ? tweetIdMatch[1] : null;

  let videoUrl = null;
  let audioUrl = null;
  let thumbnail = null;
  let title = 'Twitter/X Video';
  let duration = null;

  const data = findJsonInHtml(html, [
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
    /"tweetResultByRestId":({[\s\S]*?"video"[\s\S]*?})/,
    /"media"\s*:\s*\[({[\s\S]*?"variants"[\s\S]*?})\]/,
    /"url"\s*:\s*"([^"]+\.mp4[^"]*)"/,
  ]);

  if (data) {
    const tweet = data.tweetResultByRestId?.result?.legacy ||
      data.tweetResultByRestId?.result?.tweet ||
      data.legacy ||
      data;

    if (tweet?.extended_entities?.media?.[0]?.video_info?.variants) {
      const variants = tweet.extended_entities.media[0].video_info.variants;
      variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      videoUrl = variants[0]?.url || null;
      duration = tweet.extended_entities.media[0].video_info?.duration_millis ? 
        Math.round(tweet.extended_entities.media[0].video_info.duration_millis / 1000) : null;
    }

    if (tweet?.entities?.media?.[0]?.media_url_https) {
      thumbnail = tweet.entities.media[0].media_url_https;
    }

    title = tweet?.full_text || tweet?.text || title;
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
        filename: generateFilename('twitter', tweetId, 'mp4', og['og:title']),
        title: og['og:title'] || og['og:description'] || 'Twitter/X Video',
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
        filename: generateFilename('twitter', tweetId, 'jpg', og['og:title']),
        title: og['og:title'] || og['og:description'] || 'Twitter/X Media',
        duration: null,
        quality: 'Image',
        isVideo: false
      };
    }
    throw new Error('Could not extract Twitter/X video');
  }

  return {
    videoUrl: videoUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    audioUrl: audioUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    thumbnail,
    filename: generateFilename('twitter', tweetId, 'mp4', title),
    title: title?.substring(0, 100) || 'Twitter/X Video',
    duration,
    quality: 'Best available',
    isVideo: true
  };
}