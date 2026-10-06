import {
  findJsonInHtml,
  extractOpenGraph,
  extractDirectVideoUrls,
  extractDirectImageUrls,
  generateFilename
} from '../utils.js';

export async function extractThreads(html, url) {
  const data = findJsonInHtml(html, [
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
    /window\.__additionalDataLoaded\([\s\S]*?({[\s\S]*?})\);/,
    /"thread_items"\s*:\s*(\[[\s\S]*?\])/,
    /"media"\s*:\s*({[\s\S]*?"video_url"[\s\S]*?})/,
    /"post"\s*:\s*({[\s\S]*?"media"[\s\S]*?})/,
  ]);

  let videoUrl = null;
  let audioUrl = null;
  let thumbnail = null;
  let title = 'Threads Post';
  let duration = null;
  let isVideo = false;

  if (data) {
    const media = data.props?.pageProps?.threadData?.thread_items?.[0]?.post?.media ||
      data.thread_items?.[0]?.post?.media ||
      data.media ||
      null;

    if (media) {
      isVideo = media.video_url || media.video_versions || media.product_type === 'video';
      videoUrl = media.video_url ||
        media.video_versions?.[0]?.url ||
        media.video_dash_manifest ||
        media.playbackUrl ||
        null;
      audioUrl = media.audio_url || null;
      thumbnail = media.image_versions2?.candidates?.[0]?.url ||
        media.thumbnail_url ||
        media.cover_image ||
        media.origin_image ||
        null;
      title = media.caption?.text || media.accessibility_caption || media.title || title;
      duration = media.video_duration || media.duration || null;
    }
  }

  if (!videoUrl && !thumbnail) {
    const og = extractOpenGraph(html);
    const directVideos = extractDirectVideoUrls(html);
    const directImages = extractDirectImageUrls(html);

    if (directVideos.length > 0) {
      videoUrl = directVideos[0];
      isVideo = true;
    }
    if (directImages.length > 0) {
      thumbnail = directImages[0];
    }
    if (og['og:title']) title = og['og:title'];
    if (og['og:image']) thumbnail = thumbnail || og['og:image'];
    if (og['og:video'] || og['og:video:url']) {
      videoUrl = videoUrl || og['og:video'] || og['og:video:url'];
      isVideo = true;
    }
  }

  if (!videoUrl && !thumbnail) {
    throw new Error('Could not extract Threads media');
  }

  const postIdMatch = url.match(/\/post\/([A-Za-z0-9_-]+)/) || url.match(/\/\w+\/(\d+)/);
  const postId = postIdMatch ? postIdMatch[1] : Date.now();
  const ext = (videoUrl && videoUrl.includes('.m3u8')) ? 'mp4' : (isVideo ? 'mp4' : 'jpg');

  return {
    videoUrl: videoUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    audioUrl: audioUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    thumbnail,
    filename: generateFilename('threads', postId, ext, title),
    title,
    duration,
    quality: 'Best available',
    isVideo
  };
}