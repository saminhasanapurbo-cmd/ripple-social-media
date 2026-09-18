import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import type { Post } from '../types';

export interface FeedCursor {
  postId: string;
  createdAt?: number;
}

export interface FeedResponse {
  posts: Post[];
  nextCursor: FeedCursor | null;
  hasMore: boolean;
  backendBuild?: string;
}

export interface FetchFeedParams {
  limit?: number;
  cursor?: FeedCursor | null;
  viewerUid?: string;
}

export interface FeedDiagnosticInfo {
  timestamp: string;
  code: string;
  message: string;
  details?: any;
  stack?: string;
  targetProject: string;
  targetRegion: string;
  targetFunction: string;
  databaseId: string;
  viewerUid?: string;
}

let lastFeedDiagnostic: FeedDiagnosticInfo | null = null;

export function getLastFeedDiagnostic(): FeedDiagnosticInfo | null {
  return lastFeedDiagnostic;
}

/**
 * Authoritative feed fetcher:
 * Uses ONLY the trusted backend `getFeedV41` callable function.
 * Fails closed if the function returns an error or is unavailable.
 * Direct client Firestore fallback has been permanently removed to guarantee
 * private anonymous owner protection and two-way block enforcement.
 */
export async function fetchFeedPosts(params: FetchFeedParams = {}): Promise<FeedResponse> {
  const limitCount = Math.min(Math.max(Number(params.limit) || 20, 1), 50);
  const cursor = params.cursor || null;

  try {
    const getFeedFn = httpsCallable<any, any>(functions, 'getFeedV41');
    const result = await getFeedFn({ limit: limitCount, cursor });
    if (result && result.data && Array.isArray(result.data.posts)) {
      return {
        posts: result.data.posts,
        nextCursor: result.data.nextCursor || null,
        hasMore: !!result.data.hasMore,
        backendBuild: result.data.backendBuild
      };
    }
    throw new Error('MALFORMED_FEED_RESPONSE');
  } catch (err: any) {
    console.error('[fetchFeedPosts] Backend getFeedV41 callable failed:', err);

    lastFeedDiagnostic = {
      timestamp: new Date().toISOString(),
      code: err?.code || 'functions/internal',
      message: err?.message || String(err),
      details: err?.details,
      stack: err?.stack,
      targetProject: 'kingly-multiplexer-gbg1d',
      targetRegion: 'us-central1',
      targetFunction: 'getFeedV41',
      databaseId: 'ai-studio-485fb845-462f-4777-a3e8-0d2bb4a8cf18',
      viewerUid: params.viewerUid
    };

    const code = err?.code 
      ? (String(err.code).startsWith('functions/') ? err.code : `functions/${err.code}`) 
      : 'functions/internal';
    const safeCode = err?.details?.safeCode || (err?.message && !String(err.message).startsWith('INTERNAL') ? err.message : null);
    const stage = err?.details?.stage;
    const backendBuild = err?.details?.backendBuild;

    const parts = [code];
    if (safeCode && safeCode !== code) parts.push(safeCode);
    if (stage) parts.push(stage);
    if (backendBuild) parts.push(backendBuild);

    const formattedError = parts.join(' · ');
    throw new Error(formattedError);
  }
}

