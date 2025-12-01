import { load } from 'cheerio';

/**
 * Normalize URL by removing query parameters and fragments
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Keep protocol, hostname, and pathname only
    return `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
  } catch (err) {
    // If URL parsing fails, return original
    return url;
  }
}

/**
 * Fetch Open Graph and basic metadata from a URL
 */
export async function fetchUrlMetadata(url: string): Promise<{
  title: string | null;
  description: string | null;
  image: string | null;
  author: string | null;
  siteName: string | null;
}> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CollectiveSocial/1.0)',
      },
    });
    console.log({ response });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);

    // Try Open Graph tags first, fall back to standard meta tags
    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text() ||
      null;

    const description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      null;

    const image =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      null;

    const author =
      $('meta[name="author"]').attr('content') ||
      $('meta[property="article:author"]').attr('content') ||
      null;

    const siteName = $('meta[property="og:site_name"]').attr('content') || null;

    return {
      title: title ? title.trim() : null,
      description: description ? description.trim() : null,
      image: image ? image.trim() : null,
      author: author ? author.trim() : null,
      siteName: siteName ? siteName.trim() : null,
    };
  } catch (err) {
    console.log({ err });
    console.error('Failed to fetch URL metadata:', err);
    return {
      title: null,
      description: null,
      image: null,
      author: null,
      siteName: null,
    };
  }
}

/**
 * Detect media type based on URL patterns
 */
export function detectMediaTypeFromUrl(url: string): 'article' | 'video' {
  const urlLower = url.toLowerCase();

  // Video patterns
  if (
    urlLower.includes('youtube.com') ||
    urlLower.includes('youtu.be') ||
    urlLower.includes('vimeo.com') ||
    urlLower.includes('dailymotion.com') ||
    urlLower.includes('twitch.tv')
  ) {
    return 'video';
  }

  // Default to article for everything else
  return 'article';
}
