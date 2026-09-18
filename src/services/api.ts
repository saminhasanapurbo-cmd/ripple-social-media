import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  runTransaction, 
  addDoc,
  getCountFromServer,
  onSnapshot
} from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import type { Post, Comment, NotificationItem, ReportItem, UserProfile } from '../types';

// Check blocked user IDs in both directions (one-time fetch helper)
export async function getBlockedUserIds(currentUserId: string): Promise<string[]> {
  try {
    const [myBlocksSnap, blockedBySnap] = await Promise.all([
      getDocs(query(collection(db, 'blocks'), where('userId', '==', currentUserId))),
      getDocs(query(collection(db, 'blocks'), where('blockedUserId', '==', currentUserId)))
    ]);
    const blockedSet = new Set<string>();
    myBlocksSnap.forEach(d => {
      const data = d.data();
      if (data.blockedUserId) blockedSet.add(data.blockedUserId);
    });
    blockedBySnap.forEach(d => {
      const data = d.data();
      if (data.userId) blockedSet.add(data.userId);
    });
    return Array.from(blockedSet);
  } catch (err) {
    console.error("Error fetching blocks:", err);
    return [];
  }
}

// Real-time block relationship listener (bi-directional)
export function subscribeToBlockedRelationships(
  currentUserId: string,
  callback: (data: {
    blockedUserIds: string[];
    blockedByMe: Set<string>;
    blockedMe: Set<string>;
  }) => void
): () => void {
  let myBlockedList: string[] = [];
  let blockedByList: string[] = [];

  const emit = () => {
    const combined = Array.from(new Set([...myBlockedList, ...blockedByList]));
    callback({
      blockedUserIds: combined,
      blockedByMe: new Set(myBlockedList),
      blockedMe: new Set(blockedByList)
    });
  };

  const q1 = query(collection(db, 'blocks'), where('userId', '==', currentUserId));
  const unsub1 = onSnapshot(q1, (snap) => {
    myBlockedList = snap.docs.map(d => d.data().blockedUserId).filter(Boolean);
    emit();
  }, (err) => {
    console.warn("My blocks subscription error:", err.message);
  });

  const q2 = query(collection(db, 'blocks'), where('blockedUserId', '==', currentUserId));
  const unsub2 = onSnapshot(q2, (snap) => {
    blockedByList = snap.docs.map(d => d.data().userId).filter(Boolean);
    emit();
  }, (err) => {
    console.warn("Blocked-by subscription error:", err.message);
  });

  return () => {
    unsub1();
    unsub2();
  };
}

// Helper to check if two users have an active block in either direction
export async function checkIsBlocked(userA: string, userB: string): Promise<boolean> {
  if (!userA || !userB || userA === userB) return false;
  try {
    const [b1, b2] = await Promise.all([
      getDoc(doc(db, 'blocks', `${userA}_${userB}`)),
      getDoc(doc(db, 'blocks', `${userB}_${userA}`))
    ]);
    return b1.exists() || b2.exists();
  } catch (err) {
    console.error("Check is blocked err:", err);
    return false;
  }
}

export async function blockUser(currentUserId: string, blockedUserId: string) {
  if (currentUserId === blockedUserId) return;
  const blockDocId = `${currentUserId}_${blockedUserId}`;
  await setDoc(doc(db, 'blocks', blockDocId), {
    userId: currentUserId,
    blockedUserId,
    createdAt: Date.now()
  });

  // Remove existing follow relationships between these two accounts in BOTH directions
  const follow1 = doc(db, 'follows', `${currentUserId}_${blockedUserId}`);
  const follow2 = doc(db, 'follows', `${blockedUserId}_${currentUserId}`);
  const notif1 = doc(db, 'notifications', `follow_${currentUserId}_${blockedUserId}`);
  const notif2 = doc(db, 'notifications', `follow_${blockedUserId}_${currentUserId}`);

  await Promise.allSettled([
    deleteDoc(follow1),
    deleteDoc(follow2),
    deleteDoc(notif1),
    deleteDoc(notif2)
  ]);
}

export async function unblockUser(currentUserId: string, blockedUserId: string) {
  const blockDocId = `${currentUserId}_${blockedUserId}`;
  await deleteDoc(doc(db, 'blocks', blockDocId));
}

// Like / Unlike post using deterministic ID {postId}_{userId}.
// Social counters are computed securely from collections, eliminating client-side tampering of post counts.
export async function toggleLike(
  postId: string, 
  currentUser: UserProfile, 
  postAuthorId: string
): Promise<boolean> {
  // If post is anonymous, resolve private owner and notification via trusted backend
  if (postAuthorId === 'anonymous') {
    const toggleLikeFn = httpsCallable<any, { liked: boolean }>(functions, 'toggleLikeSecure');
    const res = await toggleLikeFn({ postId });
    return res.data.liked;
  }

  if (currentUser.uid !== postAuthorId) {
    const isBlocked = await checkIsBlocked(currentUser.uid, postAuthorId);
    if (isBlocked) {
      throw new Error("Cannot interact with this post due to a block relationship");
    }
  }

  const likeDocId = `${postId}_${currentUser.uid}`;
  const likeRef = doc(db, 'likes', likeDocId);
  const postRef = doc(db, 'posts', postId);

  let isNowLiked = false;

  await runTransaction(db, async (transaction) => {
    const likeSnap = await transaction.get(likeRef);
    const postSnap = await transaction.get(postRef);
    if (!postSnap.exists()) throw new Error("Post no longer exists");

    if (likeSnap.exists()) {
      // Unlike
      transaction.delete(likeRef);
      // Delete corresponding notification if exists
      const notifRef = doc(db, 'notifications', `like_${postId}_${currentUser.uid}`);
      transaction.delete(notifRef);
      isNowLiked = false;
    } else {
      // Like
      transaction.set(likeRef, {
        postId,
        userId: currentUser.uid,
        createdAt: Date.now()
      });
      isNowLiked = true;

      // In-app notification if not self-like (deterministic ID prevents duplicates)
      if (postAuthorId !== currentUser.uid) {
        const notifRef = doc(db, 'notifications', `like_${postId}_${currentUser.uid}`);
        transaction.set(notifRef, {
          recipientId: postAuthorId,
          actorId: currentUser.uid,
          actorUsername: currentUser.username,
          actorDisplayName: currentUser.displayName,
          actorPhotoURL: currentUser.photoURL || '',
          type: 'like',
          postId,
          read: false,
          createdAt: Date.now()
        });
      }
    }
  });

  return isNowLiked;
}

// Follow / Unfollow user using deterministic ID {followerId}_{followingId}
export async function toggleFollow(
  currentUser: UserProfile, 
  targetUser: UserProfile
): Promise<boolean> {
  if (currentUser.uid === targetUser.uid) {
    throw new Error("You cannot follow yourself");
  }

  const isBlocked = await checkIsBlocked(currentUser.uid, targetUser.uid);
  if (isBlocked) {
    throw new Error("Cannot follow this user due to a block relationship");
  }

  const followDocId = `${currentUser.uid}_${targetUser.uid}`;
  const followRef = doc(db, 'follows', followDocId);

  let isNowFollowing = false;

  await runTransaction(db, async (transaction) => {
    const followSnap = await transaction.get(followRef);

    if (followSnap.exists()) {
      // Unfollow
      transaction.delete(followRef);
      const notifRef = doc(db, 'notifications', `follow_${currentUser.uid}_${targetUser.uid}`);
      transaction.delete(notifRef);
      isNowFollowing = false;
    } else {
      // Follow
      transaction.set(followRef, {
        followerId: currentUser.uid,
        followingId: targetUser.uid,
        createdAt: Date.now()
      });
      isNowFollowing = true;

      // Notify target user with deterministic ID
      const notifRef = doc(db, 'notifications', `follow_${currentUser.uid}_${targetUser.uid}`);
      transaction.set(notifRef, {
        recipientId: targetUser.uid,
        actorId: currentUser.uid,
        actorUsername: currentUser.username,
        actorDisplayName: currentUser.displayName,
        actorPhotoURL: currentUser.photoURL || '',
        type: 'follow',
        read: false,
        createdAt: Date.now()
      });
    }
  });

  return isNowFollowing;
}

// Create new post or continue a Ripple
export async function createPostOrRipple({
  author,
  content,
  imageUrl,
  parentPost,
  isAnonymous
}: {
  author: UserProfile;
  content: string;
  imageUrl?: string;
  parentPost?: Post | null;
  isAnonymous?: boolean;
}): Promise<string> {
  const trimmed = content.trim();
  if (!trimmed && !imageUrl) {
    throw new Error("Post content or image is required");
  }
  if (trimmed.length > 400) {
    throw new Error("Post content exceeds 400 characters limit");
  }

  // If continuing a Ripple from an anonymous post, use trusted backend to resolve private owner and check blocks
  if (parentPost && parentPost.authorId === 'anonymous') {
    const createRippleFn = httpsCallable<any, { success: boolean; postId: string }>(functions, 'createRippleSecure');
    const res = await createRippleFn({
      content: trimmed,
      imageUrl: imageUrl || '',
      parentPostId: parentPost.id,
      isAnonymous: !!isAnonymous
    });
    return res.data.postId;
  }

  if (parentPost && parentPost.authorId !== author.uid && parentPost.authorId !== 'anonymous') {
    const isBlocked = await checkIsBlocked(author.uid, parentPost.authorId);
    if (isBlocked) {
      throw new Error("Cannot continue Ripple on this post due to a block relationship");
    }
  }

  const postsCollection = collection(db, 'posts');
  let rootPostId: string | null = null;
  let rippleDepth = 0;

  if (parentPost) {
    rootPostId = parentPost.rootPostId || parentPost.id;
    rippleDepth = (parentPost.rippleDepth || 0) + 1;
  }

  const postDocRef = doc(postsCollection);
  const now = Date.now();

  const newPostData: Omit<Post, 'id'> = {
    authorId: isAnonymous ? 'anonymous' : author.uid,
    authorUsername: isAnonymous ? 'anonymous' : author.username,
    authorDisplayName: isAnonymous ? 'Anonymous' : author.displayName,
    authorPhotoURL: isAnonymous ? '' : (author.photoURL || ''),
    content: trimmed,
    imageUrl: imageUrl || '',
    createdAt: now,
    parentPostId: parentPost ? parentPost.id : null,
    parentAuthorUsername: parentPost ? parentPost.authorUsername : null,
    rootPostId: rootPostId,
    rippleDepth: rippleDepth,
    isDeleted: false,
    anonymous: !!isAnonymous,
    viewCount: 0,
    moderationStatus: 'active'
  };

  await runTransaction(db, async (transaction) => {
    transaction.set(postDocRef, newPostData);

    if (isAnonymous) {
      const ownerRef = doc(db, 'postOwners', postDocRef.id);
      transaction.set(ownerRef, {
        ownerId: author.uid,
        postId: postDocRef.id,
        createdAt: now
      });
    }

    // If it's a ripple and parent author is not the same, send notification with deterministic ID
    if (parentPost && parentPost.authorId !== author.uid && parentPost.authorId !== 'anonymous') {
      const notifRef = doc(db, 'notifications', `ripple_${postDocRef.id}`);
      transaction.set(notifRef, {
        recipientId: parentPost.authorId,
        actorId: isAnonymous ? 'anonymous' : author.uid,
        actorUsername: isAnonymous ? 'anonymous' : author.username,
        actorDisplayName: isAnonymous ? 'Anonymous' : author.displayName,
        actorPhotoURL: isAnonymous ? '' : (author.photoURL || ''),
        type: 'ripple',
        postId: postDocRef.id,
        read: false,
        createdAt: now
      });
    }
  });

  return postDocRef.id;
}

// Add comment to post with input validation
export async function addComment({
  postId,
  postAuthorId,
  currentUser,
  content
}: {
  postId: string;
  postAuthorId: string;
  currentUser: UserProfile;
  content: string;
}): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > 280) {
    throw new Error("Comment exceeds 280 characters limit");
  }

  // If commenting on an anonymous post, use trusted backend to resolve private owner and check blocks
  if (postAuthorId === 'anonymous') {
    const addCommentFn = httpsCallable<any, { success: boolean; commentId: string }>(functions, 'addCommentSecure');
    await addCommentFn({ postId, content: trimmed });
    return;
  }

  if (postAuthorId !== currentUser.uid) {
    const isBlocked = await checkIsBlocked(currentUser.uid, postAuthorId);
    if (isBlocked) {
      throw new Error("Cannot comment on this post due to a block relationship");
    }
  }

  const commentRef = doc(collection(db, 'comments'));
  const postRef = doc(db, 'posts', postId);
  const now = Date.now();

  const commentData: Omit<Comment, 'id'> = {
    postId,
    authorId: currentUser.uid,
    authorUsername: currentUser.username,
    authorDisplayName: currentUser.displayName,
    authorPhotoURL: currentUser.photoURL || '',
    content: trimmed,
    createdAt: now
  };

  await runTransaction(db, async (transaction) => {
    const postSnap = await transaction.get(postRef);
    if (!postSnap.exists()) throw new Error("Post does not exist");

    transaction.set(commentRef, commentData);

    if (postAuthorId !== currentUser.uid) {
      const notifRef = doc(db, 'notifications', `comment_${commentRef.id}`);
      transaction.set(notifRef, {
        recipientId: postAuthorId,
        actorId: currentUser.uid,
        actorUsername: currentUser.username,
        actorDisplayName: currentUser.displayName,
        actorPhotoURL: currentUser.photoURL || '',
        type: 'comment',
        postId,
        commentId: commentRef.id,
        read: false,
        createdAt: now
      });
    }
  });
}

// Authoritative graph-safe post deletion (tombstones if child nodes or comments exist, hard deletes if leaf)
export async function deletePostSecure(postId: string): Promise<{ success: boolean; mode: 'deleted' | 'tombstoned' }> {
  const deleteFn = httpsCallable<any, { success: boolean; mode: 'deleted' | 'tombstoned' }>(functions, 'deletePostSecure');
  const res = await deleteFn({ postId });
  return res.data;
}

// Delete post (only owner or admin can delete; delegates to secure authoritative callable)
export async function deletePost(postId: string, _currentUserId?: string): Promise<void> {
  await deletePostSecure(postId);
}

// Delete comment (only author can delete)
export async function deleteComment(commentId: string, postId: string, currentUserId: string): Promise<void> {
  const commentRef = doc(db, 'comments', commentId);

  await runTransaction(db, async (transaction) => {
    const commentSnap = await transaction.get(commentRef);
    if (!commentSnap.exists()) return;
    const commentData = commentSnap.data() as Comment;
    if (commentData.authorId !== currentUserId) {
      throw new Error("Unauthorized to delete this comment");
    }

    transaction.delete(commentRef);
  });
}

// Report content or user with validation
export async function reportItem({
  reporterId,
  targetType,
  targetId,
  reason,
  details
}: {
  reporterId: string;
  targetType: 'post' | 'user';
  targetId: string;
  reason: string;
  details?: string;
}) {
  const cleanReason = reason.trim();
  if (cleanReason.length < 2 || cleanReason.length > 100) {
    throw new Error("Please specify a reason between 2 and 100 characters");
  }
  const cleanDetails = (details || '').trim();
  if (cleanDetails.length > 300) {
    throw new Error("Details must be 300 characters or fewer");
  }

  await addDoc(collection(db, 'reports'), {
    reporterId,
    targetType,
    targetId,
    reason: cleanReason,
    details: cleanDetails,
    status: 'pending',
    createdAt: Date.now()
  });
}

// Live, tamper-proof user count fetcher using Firestore native aggregation
export async function getUserCounts(userId: string, isOwnProfile: boolean = false): Promise<{
  followersCount: number;
  followingCount: number;
  postsCount: number;
  profileViews?: number;
}> {
  try {
        const [followersSnap, followingSnap, postsSnap] = await Promise.all([
      getCountFromServer(query(collection(db, 'follows'), where('followingId', '==', userId))),
      getCountFromServer(query(collection(db, 'follows'), where('followerId', '==', userId))),
      getCountFromServer(query(collection(db, 'posts'), where('authorId', '==', userId)))
    ]);
    
    let profileViews = 0;
    if (isOwnProfile) {
      try {
        const statsSnap = await getDoc(doc(db, 'userStats', userId));
        if (statsSnap.exists()) {
          profileViews = statsSnap.data().profileViews || 0;
        }
      } catch (e) {
        console.warn("Could not fetch profile views", e);
      }
    }
    
    return {
      followersCount: followersSnap.data().count,
      followingCount: followingSnap.data().count,
      postsCount: postsSnap.data().count,
      profileViews: isOwnProfile ? profileViews : undefined
    };
  } catch (err) {
    console.error("Error getting user counts:", err);
    return { followersCount: 0, followingCount: 0, postsCount: 0 };
  }
}

// Timestamp normalization utility
export function getTimestampMillis(ts: any): number {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return Date.now();
}

// Human-readable relative time formatter
export function formatTime(ts: any): string {
  const ms = getTimestampMillis(ts);
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export async function recordPostView(postId: string): Promise<void> {
  try {
    const recordFn = httpsCallable<any, any>(functions, 'recordPostView');
    await recordFn({ postId });
  } catch (err) {
    console.warn("recordPostView error (Cloud Function likely not deployed):", err);
    // Silent fallback
  }
}

export async function recordProfileView(profileUid: string): Promise<void> {
  try {
    const recordFn = httpsCallable<any, any>(functions, 'recordProfileView');
    await recordFn({ profileUid });
  } catch (err) {
    console.warn("recordProfileView error (Cloud Function likely not deployed):", err);
    // Silent fallback
  }
}
