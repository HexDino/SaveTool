export function extractOpenGraph(html) {
  const result = {};
  const regex = /<meta[^>]+(?:property|name)=["'](og:[^"']+)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    result[match[1]] = match[2];
  }
  
  const twitterRegex = /<meta[^>]+name=["'](twitter:[^"']+)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  while ((match = twitterRegex.exec(html)) !== null) {
    result[match[1]] = match[2];
  }
  
  return result;
}

export function extractJsonLd(html) {
  const results = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      results.push(JSON.parse(match[1]));
    } catch {
      continue;
    }
  }
  return results;
}

export function findJsonInHtml(html, patterns) {
  for (const pattern of patterns) {
    const matches = html.match(pattern);
    if (matches) {
      for (const match of matches) {
        try {
          return JSON.parse(match);
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

export function extractInlineJson(html, keywords) {
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const content = match[1];
    const hasKeyword = keywords.some(kw => content.includes(kw));
    if (hasKeyword) {
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

export function parseM3U8(content) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l);
  const streams = [];
  let currentStream = null;
  
  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
      const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
      currentStream = {
        bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0,
        resolution: resolutionMatch ? resolutionMatch[1] : null,
        url: null
      };
    } else if (currentStream && !line.startsWith('#')) {
      currentStream.url = line;
      streams.push(currentStream);
      currentStream = null;
    }
  }
  
  return streams.sort((a, b) => b.bandwidth - a.bandwidth);
}

export function extractM3U8FromHtml(html) {
  const m3u8Urls = [];
  const patterns = [
    /"url"\s*:\s*"([^"]+\.m3u8[^"]*)"/gi,
    /"hlsManifestUrl"\s*:\s*"([^"]+)"/gi,
    /"playbackUrl"\s*:\s*"([^"]+\.m3u8[^"]*)"/gi,
    /https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/gi
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (!m3u8Urls.includes(match[1])) {
        m3u8Urls.push(match[1]);
      }
    }
  }
  
  return m3u8Urls;
}

export function extractDirectVideoUrls(html) {
  const urls = [];
  const patterns = [
    /<video[^>]*src=["']([^"']+\.(?:mp4|webm|mov))["'][^>]*>/gi,
    /<source[^>]*src=["']([^"']+\.(?:mp4|webm|mov))["'][^>]*>/gi,
    /"video_url"\s*:\s*"([^"]+)"/gi,
    /"contentUrl"\s*:\s*"([^"]+)"/gi,
    /"encodingFormat"\s*:\s*"video\/[^"]+"[^}]*"contentUrl"\s*:\s*"([^"]+)"/gi
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (!urls.includes(match[1])) {
        urls.push(match[1]);
      }
    }
  }
  
  return urls;
}

export function extractDirectImageUrls(html) {
  const urls = [];
  const patterns = [
    /<meta property="og:image" content="([^"]+)"/gi,
    /<meta property="og:image:url" content="([^"]+)"/gi,
    /"thumbnailUrl"\s*:\s*"([^"]+)"/gi,
    /"image"\s*:\s*"([^"]+)"/gi,
    /https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^"'\s]*)?/gi
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (!urls.includes(match[1])) {
        urls.push(match[1]);
      }
    }
  }
  
  return urls;
}

export function generateFilename(platform, id, ext, title) {
  const safeTitle = title
    .replace(/[^a-z0-9]/gi, '_')
    .substring(0, 50);
  return `${platform}_${id || Date.now()}${safeTitle ? '_' + safeTitle : ''}.${ext}`;
}