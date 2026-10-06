import {
  findJsonInHtml,
  extractOpenGraph,
  extractDirectVideoUrls,
  extractDirectImageUrls,
  generateFilename
} from '../utils.js';

export async function extractInstagram(html, url) {
  const shortcodeMatch = url.match(/(?:reel|p|tv|embed)\/([A-Za-z0-9_-]+)/);
  const shortcode = shortcodeMatch ? shortcodeMatch[1] : null;

  const data = findJsonInHtml(html, [
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
    /window\._sharedData\s*=\s*({[\s\S]*?});/,
    /"xdt_api__v1__media__shortcode__web_info":({[\s\S]*?})/,
    /"graphql"\s*:\s*({[\s\S]*?"shortcode_media"[\s\S]*?})/,
    /"media"\s*:\s*({[\s\S]*?"video_url"[\s\S]*?})/,
  ]);

  let videoUrl = null;
  let audioUrl = null;
  let thumbnail = null;
  let title = 'Instagram Post';
  let duration = null;
  let isVideo = false;

  if (data) {
    const media = data.props?.pageProps?.videoData ||
      data.entry_data?.PostPage?.[0]?.graphql?.shortcode_media ||
      data.xdt_api__v1__media__shortcode__web_info?.items?.[0] ||
      data.media ||
      null;

    if (media) {
      isVideo = media.is_video || media.video_url || media.video_versions || media.product_type === 'video';
      videoUrl = media.video_url ||
        media.video_versions?.[0]?.url ||
        media.video_dash_manifest ||
        media.dash_info?.video_representation?.[0]?.base_url ||
        media.playbackUrl;
      audioUrl = media.audio_url ||
        media.dash_info?.audio_representation?.[0]?.base_url ||
        null;
      thumbnail = media.display_url ||
        media.thumbnail_url ||
        media.image_versions2?.candidates?.[0]?.url ||
        media.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url ||
        null;
      title = media.accessibility_caption || media.caption?.text || media.title || title;
      duration = media.video_duration || media.duration || null;
    }
  }

  if (!videoUrl && !thumbnail) {
    const og = extractOpenGraph(html);
    const directVideos = extractDirectVideoUrls(html);
    const directImages = extractDirectImageUrls(html);
    const m3u8s = extractDirectVideoUrls(html);

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
    throw new Error('Could not extract Instagram media. Make sure the post is public.');
  }

  const ext = (videoUrl && videoUrl.includes('.m3u8')) ? 'mp4' : (isVideo ? 'mp4' : 'jpg');
  return {
    videoUrl: videoUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    audioUrl: audioUrl?.replace(/\\u0025/g, '%').replace(/\\/g, ''),
    thumbnail,
    filename: generateFilename('instagram', shortcode, ext, title),
    title,
    duration,
    quality: 'Best available',
    isVideo
  };
}