/**
 * HTTP client for the Collective Social API.
 *
 * The MCP server delegates all operations to the Collective API rather than
 * accessing the database directly. This keeps the MCP server stateless and
 * ensures all business logic (ATProto writes, validation, etc.) stays in one place.
 */

export interface CollectiveClientOptions {
  baseUrl: string;
  token: string;
}

export interface MediaItem {
  id: number;
  mediaType: string;
  title: string;
  creator?: string;
  isbn?: string;
  url?: string;
  coverImage?: string;
  description?: string;
  publishedYear?: number;
  length?: number;
  averageRating?: number;
  totalReviews?: number;
}

export interface UserItem {
  uri: string;
  cid: string;
  mediaItemId: number;
  title: string;
  creator?: string;
  mediaType: string;
  status: 'want' | 'in-progress' | 'completed';
  rating?: number;
  notes?: string;
  completedAt?: string;
  createdAt: string;
}

export interface GroupSegment {
  uri: string;
  rkey: string;
  label: string;
  assignedDate?: string;
  order: number;
  segmentType?: string;
  startPage?: number;
  endPage?: number;
  startPercent?: number;
  endPercent?: number;
}

export interface SegmentProgress {
  uri: string;
  rkey: string;
  completed: boolean;
  createdAt: string;
}

export interface GroupMembership {
  communityDid: string;
  name: string;
  description?: string;
  avatar?: string;
}

export class CollectiveClient {
  private baseUrl: string;
  private token: string;

  constructor(options: CollectiveClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Cookie: `sid=${this.token}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Collective API error: ${res.status} ${res.statusText} - ${text}`
      );
    }

    return res.json() as Promise<T>;
  }

  // --- Media Search ---

  async searchMedia(
    query: string,
    mediaType?: string,
    limit = 10
  ): Promise<{ results: MediaItem[]; total: number }> {
    return this.request('POST', '/media/search', {
      query,
      mediaType,
      limit,
      offset: 0,
    });
  }

  async getMedia(id: number): Promise<MediaItem> {
    return this.request('GET', `/media/${id}`);
  }

  async addMedia(item: {
    title: string;
    creator?: string;
    mediaType: string;
    isbn?: string;
    coverImage?: string;
    publishYear?: number;
    url?: string;
    length?: number;
  }): Promise<{ mediaItemId: number; existed: boolean }> {
    return this.request('POST', '/media/add', item);
  }

  // --- User Library ---

  async listLibrary(): Promise<UserItem[]> {
    return this.request('GET', '/useritems');
  }

  async getUserItemByMedia(mediaItemId: number): Promise<UserItem | null> {
    try {
      return await this.request('GET', `/useritems/by-media/${mediaItemId}`);
    } catch {
      return null;
    }
  }

  async addToLibrary(item: {
    title: string;
    creator?: string;
    mediaItemId: number;
    mediaType?: string;
    status: 'want' | 'in-progress' | 'completed';
    rating?: number;
    notes?: string;
  }): Promise<{ uri: string; cid: string; existing?: boolean }> {
    return this.request('POST', '/useritems', item);
  }

  async updateItemStatus(
    useritemUri: string,
    update: {
      status?: 'want' | 'in-progress' | 'completed';
      rating?: number;
      notes?: string;
      completedAt?: string;
    }
  ): Promise<UserItem> {
    const encodedUri = encodeURIComponent(useritemUri);
    return this.request('PUT', `/useritems/${encodedUri}`, update);
  }

  // --- Group Segments ---

  async listGroups(): Promise<GroupMembership[]> {
    return this.request('GET', '/groups');
  }

  async listSegments(
    communityDid: string,
    itemRkey: string
  ): Promise<{ segments: GroupSegment[] }> {
    return this.request(
      'GET',
      `/groups/${communityDid}/items/${itemRkey}/segments`
    );
  }

  async getSegmentProgress(
    communityDid: string,
    segmentRkey: string
  ): Promise<{ progress: SegmentProgress | null }> {
    return this.request(
      'GET',
      `/groups/${communityDid}/segments/${segmentRkey}/progress`
    );
  }

  async completeSegment(
    communityDid: string,
    segmentRkey: string
  ): Promise<{ progress: SegmentProgress; alreadyExists?: boolean }> {
    return this.request(
      'POST',
      `/groups/${communityDid}/segments/${segmentRkey}/progress`,
      {}
    );
  }
}
