import * as functions from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';


const app = initializeApp();
const DB_ID = "ai-studio-485fb845-462f-4777-a3e8-0d2bb4a8cf18";
export const BACKEND_BUILD = "RIPPLE-V38-FEEDFIX";

let _db: FirebaseFirestore.Firestore;
function getDb() {
  if (!_db) {
    _db = getFirestore(app, DB_ID);
  }
  return _db;
}

export const recordPostView = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
  const postId = data.postId;
  if (!postId || typeof postId !== 'string') throw new functions.https.HttpsError('invalid-argument', 'Valid postId is required.');

  const viewerUid = context.auth!.uid;
  const db = getDb();
  
  const postRef = db.collection('posts').doc(postId);
  const postSnap = await postRef.get();
  
  if (!postSnap.exists) throw new functions.https.HttpsError('not-found', 'Post not found.');
  const postData = postSnap.data()!;
  
  if (postData.moderationStatus === 'removed' || postData.isDeleted) {
    throw new functions.https.HttpsError('failed-precondition', 'Post is not active.');
  }
  
  if (postData.authorId === viewerUid) return { success: true, ignored: true, reason: 'self-view' };
  
  if (postData.authorId === 'anonymous') {
    const ownerSnap = await db.collection('postOwners').doc(postId).get();
    if (ownerSnap.exists && ownerSnap.data()?.ownerId === viewerUid) {
      return { success: true, ignored: true, reason: 'self-view-anonymous' };
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const dedupId = `${viewerUid}_${today}`;
  
  const viewRecordRef = db.collection('postViews').doc(postId).collection('viewers').doc(dedupId);
  
  try {
    await db.runTransaction(async (transaction) => {
      const viewSnap = await transaction.get(viewRecordRef);
      if (viewSnap.exists) return;
      
      transaction.set(viewRecordRef, { viewerId: viewerUid, timestamp: FieldValue.serverTimestamp() });
      transaction.update(postRef, { viewCount: FieldValue.increment(1) });
    });
    return { success: true, counted: true };
  } catch (error) {
    throw new functions.https.HttpsError('internal', 'Failed to record view.');
  }
});

export const recordProfileView = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
  
  const profileUid = data.profileUid;
  if (!profileUid || typeof profileUid !== 'string') throw new functions.https.HttpsError('invalid-argument', 'Valid profileUid is required.');

  const viewerUid = context.auth!.uid;
  if (profileUid === viewerUid) return { success: true, ignored: true, reason: 'self-view' };
  
  const db = getDb();
  const userRef = db.collection('users').doc(profileUid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'Profile not found.');

  const today = new Date().toISOString().split('T')[0];
  const dedupId = `${viewerUid}_${today}`;
  const viewRecordRef = db.collection('profileViews').doc(profileUid).collection('viewers').doc(dedupId);
  const statsRef = db.collection('userStats').doc(profileUid);
  
  try {
    await db.runTransaction(async (transaction) => {
      const viewSnap = await transaction.get(viewRecordRef);
      if (viewSnap.exists) return;
      
      transaction.set(viewRecordRef, { viewerId: viewerUid, timestamp: FieldValue.serverTimestamp() });
      
      const statsSnap = await transaction.get(statsRef);
      if (!statsSnap.exists) {
        transaction.set(statsRef, { profileViews: 1 });
      } else {
        transaction.update(statsRef, { profileViews: FieldValue.increment(1) });
      }
    });
    return { success: true, counted: true };
  } catch (error) {
    throw new functions.https.HttpsError('internal', 'Failed to record profile view.');
  }
});

import { getFunctions } from 'firebase-admin/functions';

export const finalizeViewOnce = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');
  const { conversationId, uploadId, text, replyToMessageId } = data;
  if (!conversationId || !uploadId) throw new functions.https.HttpsError('invalid-argument', 'Missing parameters');
  
  const db = getDb();
  const bucket = getStorage().bucket();
  const sourceFile = bucket.file(`view_once_uploads/${conversationId}/${context.auth!.uid}/${uploadId}`);
  const [exists] = await sourceFile.exists();
  if (!exists) throw new functions.https.HttpsError('not-found', 'Media not found.');
  
  const [metadata] = await sourceFile.getMetadata();
  const allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const mimeType = metadata.contentType;
  
  if (!mimeType || !allowedMime.includes(mimeType)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid MIME type. No SVG allowed.');
  }
  if (metadata.size && Number(metadata.size) > 5 * 1024 * 1024) {
    throw new functions.https.HttpsError('invalid-argument', 'File too large.');
  }

  const convRef = db.collection('conversations').doc(conversationId);
  
  let newMsgId = '';
  await db.runTransaction(async (t) => {
    const convSnap = await t.get(convRef);
    if (!convSnap.exists) throw new functions.https.HttpsError('not-found', 'Conversation not found.');
    
    const convData = convSnap.data()!;
    if (!convData.participants.includes(context.auth!.uid)) {
      throw new functions.https.HttpsError('permission-denied', 'Not a participant.');
    }
    
    if (convData.status === 'declined') {
      throw new functions.https.HttpsError('permission-denied', 'Conversation declined.');
    }
    if (convData.status === 'pending' && convData.requestedBy === context.auth!.uid && convData.lastMessageId) {
      throw new functions.https.HttpsError('permission-denied', 'Message request restriction.');
    }

    const otherUid = convData.participants.find((p: string) => p !== context.auth!.uid);
    if (otherUid) {
      const blockSnap1 = await t.get(db.collection('blocks').doc(`${context.auth!.uid}_${otherUid}`));
      const blockSnap2 = await t.get(db.collection('blocks').doc(`${otherUid}_${context.auth!.uid}`));
      if (blockSnap1.exists || blockSnap2.exists) {
        throw new functions.https.HttpsError('permission-denied', 'Blocked.');
      }
    }

    const messagesCol = convRef.collection('messages');
    const msgRef = messagesCol.doc();
    newMsgId = msgRef.id;

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const msgData: any = {
      senderId: context.auth!.uid,
      text: text || '',
      createdAt: FieldValue.serverTimestamp(),
      messageType: 'view_once_image',
      mediaPath: `view_once_media/${conversationId}/${newMsgId}`,
      mediaStatus: 'available',
      mediaExpiresAt: expiresAt,
      mimeType: mimeType
    };
    if (replyToMessageId) {
      msgData.replyToMessageId = replyToMessageId;
    }
    
    t.set(msgRef, msgData);

    const prevOtherUnread = (convData.unreadCount && otherUid && otherUid in convData.unreadCount) 
        ? convData.unreadCount[otherUid] : 0;
        
    const unreadCount: any = {};
    if (otherUid) {
      unreadCount[otherUid] = prevOtherUnread + 1;
    }
    unreadCount[context.auth!.uid] = 0;

    t.update(convRef, {
      lastMessageText: "Sent a view-once photo",
      lastMessageSenderId: context.auth!.uid,
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageId: newMsgId,
      updatedAt: FieldValue.serverTimestamp(),
      unreadCount: unreadCount
    });
  });

  const destFile = bucket.file(`view_once_media/${conversationId}/${newMsgId}`);
  await sourceFile.copy(destFile);
  await sourceFile.delete();

  try {
    const queue = getFunctions().taskQueue('cleanupViewOnce');
    await queue.enqueue(
      { conversationId, messageId: newMsgId },
      { scheduleDelaySeconds: 5 * 60 }
    );
  } catch (err) {
    // If scheduling fails, delete message and media to fail closed
    await db.collection('conversations').doc(conversationId).collection('messages').doc(newMsgId).delete();
    await destFile.delete();
    throw new functions.https.HttpsError('internal', 'Failed to schedule cleanup, rolling back.');
  }

  return { success: true, messageId: newMsgId, mimeType };
});

export const consumeViewOnce = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');
  const { conversationId, messageId } = data;
  if (!conversationId || !messageId) throw new functions.https.HttpsError('invalid-argument', 'Missing parameters');
  
  const db = getDb();
  
  const convSnap = await db.collection('conversations').doc(conversationId).get();
  if (!convSnap.exists) throw new functions.https.HttpsError('not-found', 'Conversation not found.');
  const convData = convSnap.data()!;
  
  if (!convData.participants.includes(context.auth!.uid)) {
    throw new functions.https.HttpsError('permission-denied', 'Not a participant.');
  }

  const otherUid = convData.participants.find((p: string) => p !== context.auth!.uid);
  if (otherUid) {
    const blockSnap1 = await db.collection('blocks').doc(`${context.auth!.uid}_${otherUid}`).get();
    const blockSnap2 = await db.collection('blocks').doc(`${otherUid}_${context.auth!.uid}`).get();
    if (blockSnap1.exists || blockSnap2.exists) {
      throw new functions.https.HttpsError('permission-denied', 'Blocked.');
    }
  }

  const msgRef = db.collection('conversations').doc(conversationId).collection('messages').doc(messageId);
  
  let msgData: any;
  await db.runTransaction(async (t) => {
    const snap = await t.get(msgRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Message not found.');
    msgData = snap.data()!;
    
    if (msgData.messageType !== 'view_once_image') {
      throw new functions.https.HttpsError('invalid-argument', 'Not a view once image.');
    }
    if (msgData.senderId === context.auth!.uid) {
      throw new functions.https.HttpsError('permission-denied', 'Sender cannot view.');
    }
    if (msgData.mediaStatus !== 'available') {
      throw new functions.https.HttpsError('failed-precondition', 'Media not available.');
    }
    
    let isExpired = false;
    if (msgData.mediaExpiresAt && msgData.mediaExpiresAt.toDate() < new Date()) {
      isExpired = true;
    }
    if (isExpired) {
      t.update(msgRef, { mediaStatus: 'expired' });
      throw new functions.https.HttpsError('failed-precondition', 'Media expired.');
    }

    t.update(msgRef, { 
      mediaStatus: 'consuming'
    });
  });

  const bucket = getStorage().bucket();
  const file = bucket.file(`view_once_media/${conversationId}/${messageId}`);
  let buffer;
  try {
    const [downloaded] = await file.download();
    buffer = downloaded;
  } catch (err) {
    console.error('Download failed', err);
    await msgRef.update({ mediaStatus: 'available' });
    throw new functions.https.HttpsError('internal', 'Failed to retrieve media.');
  }

  try {
    await file.delete();
  } catch (e) {
    console.warn("Failed to delete media after consumption", e);
  }

  await msgRef.update({
      mediaStatus: 'viewed', 
      mediaViewedAt: FieldValue.serverTimestamp(), 
      mediaViewedBy: context.auth!.uid 
  });

  return {
    success: true,
    imageBytes: buffer.toString('base64'),
    mimeType: msgData?.mimeType || 'image/jpeg'
  };
});

export const cleanupViewOnce = functions.tasks.taskQueue({
  retryConfig: { maxAttempts: 3 },
  rateLimits: { maxConcurrentDispatches: 500 }
}).onDispatch(async (data) => {
  const { conversationId, messageId } = data as any;
  if (!conversationId || !messageId) return;
  
  const db = getDb();
  const msgRef = db.collection('conversations').doc(conversationId).collection('messages').doc(messageId);
  
  try {
    await db.runTransaction(async (t) => {
      const snap = await t.get(msgRef);
      if (snap.exists && (snap.data()?.mediaStatus === 'available' || snap.data()?.mediaStatus === 'consuming')) {
        t.update(msgRef, { mediaStatus: 'expired' });
      }
    });
    
    const bucket = getStorage().bucket();
    const file = bucket.file(`view_once_media/${conversationId}/${messageId}`);
    try {
      const [exists] = await file.exists();
      if (exists) await file.delete();
    } catch (e) {
      console.warn("Cleanup file missing", e);
    }
  } catch (err) {
    console.error("Cleanup failed", err);
  }
});

// Helper for two-way block check
async function checkTwoWayBlocked(db: FirebaseFirestore.Firestore, userA: string, userB: string): Promise<boolean> {
  if (!userA || !userB || userA === userB) return false;
  const [b1, b2] = await Promise.all([
    db.collection('blocks').doc(`${userA}_${userB}`).get(),
    db.collection('blocks').doc(`${userB}_${userA}`).get()
  ]);
  return b1.exists || b2.exists;
}

// Deprecated getFeed function removed in favor of getFeedV41 (RIPPLE-V41-FEED-RESET)


// Helper for normalizeMillis (V41)
function normalizeMillisV41(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (value && typeof value.toMillis === 'function') {
    const m = value.toMillis();
    if (typeof m === 'number' && Number.isFinite(m) && m > 0) return m;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    if (Number.isFinite(t) && t > 0) return t;
  }
  return 0;
}

// Explicit serializable DTO serializer (V41)
function serializeFeedPostV41(docSnap: FirebaseFirestore.DocumentSnapshot): any {
  const d = docSnap.data() || {};
  const createdAt = normalizeMillisV41(d.createdAt);
  if (!createdAt) return null; // skip malformed

  return {
    id: String(docSnap.id),
    authorId: typeof d.authorId === 'string' ? d.authorId : '',
    authorUsername: typeof d.authorUsername === 'string' ? d.authorUsername : '',
    authorDisplayName: typeof d.authorDisplayName === 'string' ? d.authorDisplayName : '',
    authorPhotoURL: typeof d.authorPhotoURL === 'string' ? d.authorPhotoURL : '',
    content: typeof d.content === 'string' ? d.content : '',
    imageUrl: typeof d.imageUrl === 'string' ? d.imageUrl : '',
    createdAt,
    likesCount: typeof d.likesCount === 'number' && Number.isFinite(d.likesCount) ? d.likesCount : 0,
    commentsCount: typeof d.commentsCount === 'number' && Number.isFinite(d.commentsCount) ? d.commentsCount : 0,
    ripplesCount: typeof d.ripplesCount === 'number' && Number.isFinite(d.ripplesCount) ? d.ripplesCount : 0,
    parentPostId: typeof d.parentPostId === 'string' ? d.parentPostId : null,
    parentAuthorUsername: typeof d.parentAuthorUsername === 'string' ? d.parentAuthorUsername : null,
    rootPostId: typeof d.rootPostId === 'string' ? d.rootPostId : null,
    rippleDepth: typeof d.rippleDepth === 'number' && Number.isFinite(d.rippleDepth) ? d.rippleDepth : 0,
    isDeleted: Boolean(d.isDeleted),
    anonymous: Boolean(d.anonymous || d.authorId === 'anonymous'),
    viewCount: typeof d.viewCount === 'number' && Number.isFinite(d.viewCount) ? d.viewCount : 0,
    moderationStatus: d.moderationStatus === 'removed' ? 'removed' : 'active',
    removedReasonCode: typeof d.removedReasonCode === 'string' ? d.removedReasonCode : undefined,
    contextLabel: typeof d.contextLabel === 'string' ? d.contextLabel : undefined
  };
}

// Brand-new RIPPLE-V41-FEED-RESET authoritative callable
export const getFeedV41 = functions
  .region('us-central1')
  .https
  .onCall(async (data, context) => {
    let stage = 'auth';
    try {
      console.log('[getFeedV41] build=RIPPLE-V41-FEED-RESET stage=auth');

      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
      }

      // Probe mode: verified before any Firestore access
      if (data?.probeOnly === true) {
        return {
          ok: true,
          backendBuild: "RIPPLE-V41-FEED-RESET",
          functionName: "getFeedV41",
          region: "us-central1"
        };
      }

      const viewerUid = context.auth.uid;
      const limitCount = Math.min(Math.max(Number(data?.limit) || 20, 1), 50);
      const cursor = data?.cursor;
      const cursorPostId = cursor
        ? (typeof cursor === 'string' ? cursor : (cursor.postId || cursor.id || null))
        : null;

      stage = 'database-init';
      const db = getDb();

      stage = 'database-test';
      try {
        await db.collection('posts').limit(1).get();
      } catch (dbTestErr: any) {
        console.error('[getFeedV41] database-test failed:', dbTestErr?.message || dbTestErr);
        throw new functions.https.HttpsError(
          'internal',
          'FEED_DATABASE_TEST_FAILED',
          {
            safeCode: 'FEED_DATABASE_TEST_FAILED',
            stage: 'database-test',
            backendBuild: 'RIPPLE-V41-FEED-RESET'
          }
        );
      }

      stage = 'blocks-query';
      const blockedSet = new Set<string>();
      try {
        const [b1, b2, b3, b4] = await Promise.all([
          db.collection('blocks').where('userId', '==', viewerUid).get(),
          db.collection('blocks').where('blockedUserId', '==', viewerUid).get(),
          db.collection('blocks').where('blockerId', '==', viewerUid).get(),
          db.collection('blocks').where('blockedId', '==', viewerUid).get(),
        ]);
        b1.forEach(docSnap => {
          const d = docSnap.data();
          if (d?.blockedUserId) blockedSet.add(d.blockedUserId);
        });
        b2.forEach(docSnap => {
          const d = docSnap.data();
          if (d?.userId) blockedSet.add(d.userId);
        });
        b3.forEach(docSnap => {
          const d = docSnap.data();
          if (d?.blockedId) blockedSet.add(d.blockedId);
        });
        b4.forEach(docSnap => {
          const d = docSnap.data();
          if (d?.blockerId) blockedSet.add(d.blockerId);
        });
      } catch (blockErr: any) {
        console.error('[getFeedV41] blocks-query failed:', blockErr?.message || blockErr);
        throw new functions.https.HttpsError(
          'internal',
          'FEED_BLOCK_FILTER_FAILED',
          {
            safeCode: 'FEED_BLOCK_FILTER_FAILED',
            stage: 'blocks-query',
            backendBuild: 'RIPPLE-V41-FEED-RESET'
          }
        );
      }

      const postsRef = db.collection('posts');

      let cursorDocSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      if (cursorPostId) {
        stage = 'cursor-load';
        try {
          const snap = await postsRef.doc(String(cursorPostId)).get();
          if (snap.exists) {
            cursorDocSnap = snap;
          } else {
            console.warn(`[getFeedV41] Cursor doc not found for id=${cursorPostId}`);
            throw new functions.https.HttpsError(
              'failed-precondition',
              'FEED_CURSOR_EXPIRED',
              {
                safeCode: 'FEED_CURSOR_EXPIRED',
                stage: 'cursor-load',
                backendBuild: 'RIPPLE-V41-FEED-RESET'
              }
            );
          }
        } catch (cursorErr: any) {
          if (cursorErr instanceof functions.https.HttpsError) throw cursorErr;
          console.error('[getFeedV41] Cursor document fetch error:', cursorErr?.message || cursorErr);
          throw new functions.https.HttpsError(
            'internal',
            'FEED_CURSOR_LOAD_FAILED',
            {
              safeCode: 'FEED_CURSOR_LOAD_FAILED',
              stage: 'cursor-load',
              backendBuild: 'RIPPLE-V41-FEED-RESET'
            }
          );
        }
      }

      stage = 'posts-query';
      let currentQuery: FirebaseFirestore.Query = postsRef.orderBy('createdAt', 'desc');
      if (cursorDocSnap) {
        currentQuery = currentQuery.startAfter(cursorDocSnap);
      }
      currentQuery = currentQuery.limit(limitCount);

      const posts: any[] = [];
      let scannedCount = 0;
      const maxScanLimit = 150;
      let lastScannedDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      let hasMore = false;
      let queryIteration = 0;

      while (posts.length < limitCount && scannedCount < maxScanLimit) {
        queryIteration++;
        stage = 'posts-query';
        let snapshot: FirebaseFirestore.QuerySnapshot;
        try {
          snapshot = await currentQuery.get();
        } catch (queryErr: any) {
          console.error(`[getFeedV41] posts-query iteration ${queryIteration} failed:`, queryErr?.message || queryErr);
          throw new functions.https.HttpsError(
            'internal',
            'FEED_QUERY_FAILED',
            {
              safeCode: 'FEED_QUERY_FAILED',
              stage: 'posts-query',
              backendBuild: 'RIPPLE-V41-FEED-RESET'
            }
          );
        }

        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        for (const docSnap of snapshot.docs) {
          scannedCount++;
          lastScannedDoc = docSnap;

          let rawData: FirebaseFirestore.DocumentData;
          try {
            rawData = docSnap.data();
          } catch (readErr) {
            console.warn(`[getFeedV41] Skipping unreadable doc ${docSnap.id}`);
            continue;
          }

          // Filter deleted / moderated
          if (rawData.isDeleted === true || rawData.moderationStatus === 'removed') {
            continue;
          }

          // Anonymous owner resolution
          const isAnon = rawData.authorId === 'anonymous' || Boolean(rawData.anonymous);
          let effectiveOwnerId = rawData.authorId;

          if (isAnon) {
            stage = 'anonymous-owner-resolution';
            let ownerSnap: FirebaseFirestore.DocumentSnapshot;
            try {
              ownerSnap = await db.collection('postOwners').doc(docSnap.id).get();
            } catch (anonErr: any) {
              console.error(`[getFeedV41] Database failure loading postOwner for ${docSnap.id}:`, anonErr?.message || anonErr);
              throw new functions.https.HttpsError(
                'internal',
                'FEED_ANON_OWNER_LOOKUP_FAILED',
                {
                  safeCode: 'FEED_ANON_OWNER_LOOKUP_FAILED',
                  stage: 'anonymous-owner-resolution',
                  backendBuild: 'RIPPLE-V41-FEED-RESET'
                }
              );
            }

            if (!ownerSnap.exists || !ownerSnap.data()?.ownerId) {
              console.warn(`[getFeedV41] Missing postOwner mapping for anonymous post ${docSnap.id}, skipping.`);
              continue;
            }
            effectiveOwnerId = ownerSnap.data()!.ownerId;
          }

          // Two-way block filter
          if (effectiveOwnerId && blockedSet.has(effectiveOwnerId)) {
            continue;
          }

          // Serialize into explicit JSON-safe DTO
          stage = 'response-build';
          try {
            const serialized = serializeFeedPostV41(docSnap);
            if (!serialized) {
              console.warn(`[getFeedV41] Malformed post ${docSnap.id}, skipping.`);
              continue;
            }
            posts.push(serialized);
          } catch (serializeErr) {
            console.warn(`[getFeedV41] Serialization failed for post ${docSnap.id}, skipping:`, serializeErr);
            continue;
          }

          if (posts.length >= limitCount) {
            break;
          }
        }

        if (snapshot.size < limitCount) {
          hasMore = false;
          break;
        } else {
          hasMore = true;
          if (posts.length < limitCount && lastScannedDoc) {
            stage = 'posts-query';
            currentQuery = postsRef
              .orderBy('createdAt', 'desc')
              .startAfter(lastScannedDoc)
              .limit(limitCount);
          } else {
            break;
          }
        }
      }

      stage = 'response-build';
      let nextCursor: { postId: string } | null = null;
      if (lastScannedDoc && (hasMore || posts.length >= limitCount)) {
        nextCursor = {
          postId: String(lastScannedDoc.id)
        };
      }

      return {
        posts,
        nextCursor,
        hasMore: hasMore && (posts.length >= limitCount || scannedCount < maxScanLimit),
        backendBuild: "RIPPLE-V41-FEED-RESET"
      };
    } catch (err: any) {
      if (err instanceof functions.https.HttpsError) {
        throw err;
      }
      const safeCode = err?.code || 'FEED_INTERNAL_ERROR';
      const errMessage = err?.message || String(err);
      console.error(`[getFeedV41:CRITICAL] build=RIPPLE-V41-FEED-RESET stage=${stage} code=${safeCode} message=${errMessage}`);
      throw new functions.https.HttpsError(
        'internal',
        'FEED_QUERY_FAILED',
        {
          safeCode: 'FEED_QUERY_FAILED',
          stage,
          backendBuild: "RIPPLE-V41-FEED-RESET"
        }
      );
    }
  });

// Admin-only reveal anonymous post owner for audit
export const revealAnonymousAuthor = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
  const { postId, reason } = data;
  if (!postId || !reason) throw new functions.https.HttpsError('invalid-argument', 'Missing parameters');
  
  const db = getDb();
  const adminSnap = await db.collection('admins').doc(context.auth!.uid).get();
  if (!adminSnap.exists) throw new functions.https.HttpsError('permission-denied', 'Must be an admin.');
  
  const ownerSnap = await db.collection('postOwners').doc(postId).get();
  if (!ownerSnap.exists) throw new functions.https.HttpsError('not-found', 'Post owner not found.');
  
  const ownerId = ownerSnap.data()!.ownerId;
  
  await db.collection('moderationAudit').add({
     action: 'reveal_anonymous',
     postId,
     adminId: context.auth!.uid,
     reason,
     timestamp: FieldValue.serverTimestamp()
  });
  
  return { ownerId };
});

// Block anonymous post owner without exposing their UID to the client
export const blockAnonymousPostOwner = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
  const { postId } = data;
  if (!postId) throw new functions.https.HttpsError('invalid-argument', 'Missing postId');
  
  const db = getDb();
  
  const postSnap = await db.collection('posts').doc(postId).get();
  if (!postSnap.exists) throw new functions.https.HttpsError('not-found', 'Post not found.');
  const postData = postSnap.data()!;
  if (postData.authorId !== 'anonymous') throw new functions.https.HttpsError('invalid-argument', 'Not an anonymous post.');
  
  const ownerSnap = await db.collection('postOwners').doc(postId).get();
  if (!ownerSnap.exists) throw new functions.https.HttpsError('not-found', 'Owner not found.');
  
  const ownerId = ownerSnap.data()!.ownerId;
  const viewerId = context.auth!.uid;
  
  if (ownerId === viewerId) throw new functions.https.HttpsError('invalid-argument', 'Cannot block yourself.');
  
  const batch = db.batch();
  const blockRef = db.collection('blocks').doc(`${viewerId}_${ownerId}`);
  batch.set(blockRef, { userId: viewerId, blockedUserId: ownerId, createdAt: Date.now() });
  
  const f1 = db.collection('follows').doc(`${viewerId}_${ownerId}`);
  const f2 = db.collection('follows').doc(`${ownerId}_${viewerId}`);
  batch.delete(f1);
  batch.delete(f2);
  
  await batch.commit();
  return { success: true };
});

// Trusted like/unlike on posts (privately resolves anonymous post owner and sends notification to real owner)
export const toggleLikeSecure = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
  const postId = data.postId;
  if (!postId || typeof postId !== 'string') throw new functions.https.HttpsError('invalid-argument', 'Valid postId required.');
  
  const viewerUid = context.auth.uid;
  const db = getDb();
  
  const postRef = db.collection('posts').doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) throw new functions.https.HttpsError('not-found', 'Post not found.');
  const postData = postSnap.data()!;
  
  if (postData.isDeleted === true || postData.moderationStatus === 'removed') {
    throw new functions.https.HttpsError('failed-precondition', 'Post is not active.');
  }

  let ownerId = postData.authorId;
  if (ownerId === 'anonymous') {
    const ownerSnap = await db.collection('postOwners').doc(postId).get();
    if (!ownerSnap.exists) throw new functions.https.HttpsError('not-found', 'Post owner not found.');
    ownerId = ownerSnap.data()!.ownerId;
  }

  const isBlocked = await checkTwoWayBlocked(db, viewerUid, ownerId);
  if (isBlocked) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot interact with this post due to a block relationship.');
  }

  const likeRef = db.collection('likes').doc(`${postId}_${viewerUid}`);
  const notifRef = db.collection('notifications').doc(`like_${postId}_${viewerUid}`);

  let isNowLiked = false;

  await db.runTransaction(async (transaction) => {
    const likeSnap = await transaction.get(likeRef);
    if (likeSnap.exists) {
      // Unlike
      transaction.delete(likeRef);
      transaction.delete(notifRef);
      isNowLiked = false;
    } else {
      // Like
      transaction.set(likeRef, {
        postId,
        userId: viewerUid,
        createdAt: Date.now()
      });
      isNowLiked = true;

      if (viewerUid !== ownerId) {
        const viewerSnap = await transaction.get(db.collection('users').doc(viewerUid));
        const viewerData = viewerSnap.exists ? viewerSnap.data()! : { username: 'user', displayName: 'User', photoURL: '' };
        
        transaction.set(notifRef, {
          recipientId: ownerId,
          actorId: viewerUid,
          actorUsername: viewerData.username || 'user',
          actorDisplayName: viewerData.displayName || 'User',
          actorPhotoURL: viewerData.photoURL || '',
          type: 'like',
          postId,
          read: false,
          createdAt: Date.now()
        });
      }
    }
  });

  return { liked: isNowLiked };
});

// Trusted comment on posts (privately resolves anonymous post owner and sends notification to real owner)
export const addCommentSecure = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
  const { postId, content } = data;
  if (!postId || typeof postId !== 'string') throw new functions.https.HttpsError('invalid-argument', 'Valid postId required.');
  
  const trimmed = (typeof content === 'string' ? content : '').trim();
  if (!trimmed) throw new functions.https.HttpsError('invalid-argument', 'Comment cannot be empty.');
  if (trimmed.length > 280) throw new functions.https.HttpsError('invalid-argument', 'Comment exceeds 280 characters.');

  const commenterUid = context.auth.uid;
  const db = getDb();
  
  const postRef = db.collection('posts').doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) throw new functions.https.HttpsError('not-found', 'Post not found.');
  const postData = postSnap.data()!;
  
  if (postData.isDeleted === true || postData.moderationStatus === 'removed') {
    throw new functions.https.HttpsError('failed-precondition', 'Post is not active.');
  }

  let ownerId = postData.authorId;
  if (ownerId === 'anonymous') {
    const ownerSnap = await db.collection('postOwners').doc(postId).get();
    if (!ownerSnap.exists) throw new functions.https.HttpsError('not-found', 'Post owner not found.');
    ownerId = ownerSnap.data()!.ownerId;
  }

  const isBlocked = await checkTwoWayBlocked(db, commenterUid, ownerId);
  if (isBlocked) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot comment on this post due to a block relationship.');
  }

  const commenterSnap = await db.collection('users').doc(commenterUid).get();
  const commenterData = commenterSnap.exists ? commenterSnap.data()! : { username: 'user', displayName: 'User', photoURL: '' };

  const commentRef = db.collection('comments').doc();
  const now = Date.now();

  const batch = db.batch();
  batch.set(commentRef, {
    postId,
    authorId: commenterUid,
    authorUsername: commenterData.username || 'user',
    authorDisplayName: commenterData.displayName || 'User',
    authorPhotoURL: commenterData.photoURL || '',
    content: trimmed,
    createdAt: now
  });

  if (commenterUid !== ownerId) {
    const notifRef = db.collection('notifications').doc(`comment_${commentRef.id}`);
    batch.set(notifRef, {
      recipientId: ownerId,
      actorId: commenterUid,
      actorUsername: commenterData.username || 'user',
      actorDisplayName: commenterData.displayName || 'User',
      actorPhotoURL: commenterData.photoURL || '',
      type: 'comment',
      postId,
      commentId: commentRef.id,
      read: false,
      createdAt: now
    });
  }

  await batch.commit();
  return { success: true, commentId: commentRef.id };
});

// Trusted ripple creation: handles anonymous parent post privately, checks blocks, and creates child node
export const createRippleSecure = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
  const { content, imageUrl, parentPostId, isAnonymous } = data;
  
  const trimmed = (typeof content === 'string' ? content : '').trim();
  const validImage = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (!trimmed && !validImage) {
    throw new functions.https.HttpsError('invalid-argument', 'Post content or image is required.');
  }
  if (trimmed.length > 400) {
    throw new functions.https.HttpsError('invalid-argument', 'Post content exceeds 400 characters.');
  }

  const authorUid = context.auth.uid;
  const db = getDb();

  let parentOwnerId: string | null = null;
  let rootPostId: string | null = null;
  let rippleDepth = 0;
  let parentAuthorUsername: string | null = null;

  if (parentPostId && typeof parentPostId === 'string') {
    const parentSnap = await db.collection('posts').doc(parentPostId).get();
    if (!parentSnap.exists) throw new functions.https.HttpsError('not-found', 'Parent post not found.');
    const parentData = parentSnap.data()!;
    if (parentData.isDeleted === true || parentData.moderationStatus === 'removed') {
      throw new functions.https.HttpsError('failed-precondition', 'Parent post is no longer active.');
    }

    parentAuthorUsername = parentData.authorUsername || null;
    rootPostId = parentData.rootPostId || parentData.id;
    rippleDepth = (parentData.rippleDepth || 0) + 1;

    parentOwnerId = parentData.authorId;
    if (parentOwnerId === 'anonymous') {
      const ownerSnap = await db.collection('postOwners').doc(parentPostId).get();
      if (!ownerSnap.exists) throw new functions.https.HttpsError('not-found', 'Parent post owner not found.');
      parentOwnerId = ownerSnap.data()!.ownerId;
    }

    if (parentOwnerId) {
      const isBlocked = await checkTwoWayBlocked(db, authorUid, parentOwnerId);
      if (isBlocked) {
        throw new functions.https.HttpsError('permission-denied', 'Cannot continue Ripple on this post due to a block relationship.');
      }
    }
  }

  const authorSnap = await db.collection('users').doc(authorUid).get();
  const authorData = authorSnap.exists ? authorSnap.data()! : { username: 'user', displayName: 'User', photoURL: '' };

  const postDocRef = db.collection('posts').doc();
  const now = Date.now();

  const isAnon = !!isAnonymous;
  const newPostData: any = {
    authorId: isAnon ? 'anonymous' : authorUid,
    authorUsername: isAnon ? 'anonymous' : (authorData.username || 'user'),
    authorDisplayName: isAnon ? 'Anonymous' : (authorData.displayName || 'User'),
    authorPhotoURL: isAnon ? '' : (authorData.photoURL || ''),
    content: trimmed,
    imageUrl: validImage,
    createdAt: now,
    parentPostId: parentPostId || null,
    parentAuthorUsername,
    rootPostId,
    rippleDepth,
    isDeleted: false,
    anonymous: isAnon,
    viewCount: 0,
    moderationStatus: 'active'
  };

  const batch = db.batch();
  batch.set(postDocRef, newPostData);

  if (isAnon) {
    const ownerRef = db.collection('postOwners').doc(postDocRef.id);
    batch.set(ownerRef, {
      ownerId: authorUid,
      postId: postDocRef.id,
      createdAt: now
    });
  }

  if (parentPostId && parentOwnerId && authorUid !== parentOwnerId) {
    const notifRef = db.collection('notifications').doc(`ripple_${postDocRef.id}`);
    batch.set(notifRef, {
      recipientId: parentOwnerId,
      actorId: isAnon ? 'anonymous' : authorUid,
      actorUsername: isAnon ? 'anonymous' : (authorData.username || 'user'),
      actorDisplayName: isAnon ? 'Anonymous' : (authorData.displayName || 'User'),
      actorPhotoURL: isAnon ? '' : (authorData.photoURL || ''),
      type: 'ripple',
      postId: postDocRef.id,
      read: false,
      createdAt: now
    });
  }

  await batch.commit();
  return { success: true, postId: postDocRef.id };
});

// Graph-safe authoritative post deletion:
// If child ripples or comments exist, TOMBSTONES the post so the graph is preserved.
// If no dependent content exists, performs a safe hard delete.
export const deletePostSecure = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
  const postId = data.postId;
  if (!postId || typeof postId !== 'string') throw new functions.https.HttpsError('invalid-argument', 'Valid postId required.');
  
  const callerUid = context.auth.uid;
  const db = getDb();
  
  const postRef = db.collection('posts').doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) throw new functions.https.HttpsError('not-found', 'Post not found.');
  const postData = postSnap.data()!;

  // Check admin status
  const adminSnap = await db.collection('admins').doc(callerUid).get();
  const isAdmin = adminSnap.exists;

  let ownerId = postData.authorId;
  let isAnonymousPost = false;
  if (ownerId === 'anonymous') {
    isAnonymousPost = true;
    const ownerSnap = await db.collection('postOwners').doc(postId).get();
    if (!ownerSnap.exists) {
      if (!isAdmin) throw new functions.https.HttpsError('permission-denied', 'Cannot verify post ownership.');
    } else {
      ownerId = ownerSnap.data()!.ownerId;
    }
  }

  if (callerUid !== ownerId && !isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Unauthorized to delete this post.');
  }

  // Authoritative dependent content check (querying real database nodes, not stale counters)
  const [childrenSnap, commentsSnap] = await Promise.all([
    db.collection('posts').where('parentPostId', '==', postId).limit(1).get(),
    db.collection('comments').where('postId', '==', postId).limit(1).get()
  ]);

  const hasDependents = !childrenSnap.empty || !commentsSnap.empty;

  if (hasDependents) {
    // Tombstone: preserve node id, parentPostId, parentAuthorUsername, rootPostId, rippleDepth, createdAt
    // Graph chain remains completely valid
    await postRef.update({
      isDeleted: true,
      content: "This post was deleted.",
      imageUrl: null,
      authorId: 'deleted',
      authorUsername: 'deleted',
      authorDisplayName: 'Deleted User',
      authorPhotoURL: ''
    });
    return { success: true, mode: 'tombstoned' };
  } else {
    // Safe hard delete: no dependent content in the social graph
    await postRef.delete();
    if (isAnonymousPost) {
      await db.collection('postOwners').doc(postId).delete().catch(() => {});
    }
    return { success: true, mode: 'deleted' };
  }
});

// Alias deleteAnonymousPost for backward compatibility
export const deleteAnonymousPost = deletePostSecure;

