import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  startAfter, 
  serverTimestamp, 
  increment, 
  writeBatch, 
  runTransaction,
  onSnapshot, 
  deleteField,
  type DocumentSnapshot 
} from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import type { Conversation, Message, UserProfile } from '../types';

/**
 * In-memory cache for user profiles with TTL and failure-eviction.
 * A temporary network failure does not permanently cache as null.
 */
interface CachedProfileEntry {
  profile: UserProfile;
  cachedAt: number;
}
const profileCache = new Map<string, CachedProfileEntry>();
const profileInFlight = new Map<string, Promise<UserProfile | null>>();
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute TTL

/**
 * Returns a stable, deterministic conversation ID for two users.
 * E.g., [uidA, uidB].sort().join('_')
 */
export function getConversationId(uid1: string, uid2: string): string {
  return [uid1, uid2].sort().join('_');
}

/**
 * Transaction-safe conversation creation.
 * If the conversation document already exists, it is left completely untouched:
 * timestamps, unread counts, and last-message metadata are NEVER overwritten.
 * Identity authority is `/users/{uid}`, so no client-spoofable participantDetails are written.
 */
export async function getOrCreateConversation(
  currentUser: UserProfile,
  targetUser: UserProfile
): Promise<string> {
  if (currentUser.uid === targetUser.uid) {
    throw new Error("You cannot start a conversation with yourself.");
  }

  const conversationId = getConversationId(currentUser.uid, targetUser.uid);
  const convRef = doc(db, 'conversations', conversationId);

  // 1. Fast check if conversation already exists
  try {
    const convSnap = await getDoc(convRef);
    if (convSnap.exists()) {
      return conversationId;
    }
  } catch (readErr: any) {
    console.warn("Conversation get check notice:", readErr);
  }

  // 2. Safely initialize conversation if not exists
  const participants = [currentUser.uid, targetUser.uid].sort();
  const newConv: Omit<Conversation, 'id'> = {
    participants,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessageText: '',
    lastMessageSenderId: '',
    unreadCount: {
      [participants[0]]: 0,
      [participants[1]]: 0
    }
  };

  try {
    await runTransaction(db, async (transaction) => {
      const convSnap = await transaction.get(convRef);
      if (!convSnap.exists()) {
        const followAtoB = await transaction.get(doc(db, 'follows', `${currentUser.uid}_${targetUser.uid}`));
        const followBtoA = await transaction.get(doc(db, 'follows', `${targetUser.uid}_${currentUser.uid}`));
        const isMutual = followAtoB.exists() && followBtoA.exists();
        
        const convPayload = {
            ...newConv,
            status: isMutual ? 'accepted' : 'pending'
        };
        if (!isMutual) {
          (convPayload as any).requestedBy = currentUser.uid;
        }
        transaction.set(convRef, convPayload);
      }
    });
  } catch (txErr: any) {
    console.warn("Transaction note, checking if document is available:", txErr);
    try {
      const checkSnap = await getDoc(convRef);
      if (checkSnap.exists()) {
        return conversationId;
      }
    } catch (_) {
      // Ignore inner error and throw original
    }
    throw txErr;
  }

  return conversationId;
}

/**
 * Sends a private text message atomically in a batch.
 * Inserts the message into /conversations/{conversationId}/messages/{messageId}
 * and updates parent conversation metadata (last message, sender, unread counts, lastMessageId).
 * Validated by Firestore security rules using existsAfter() and getAfter().
 */
export async function sendDirectMessage(
  conversationId: string,
  senderId: string,
  recipientId: string,
  text: string,
  imageUrl?: string,
  replyToMessageId?: string,
  messageType: 'text' | 'view_once_image' = 'text',
  mediaPath?: string
): Promise<string> {
  const cleanText = text.trim();
  if (!cleanText && !imageUrl && !mediaPath) {
    throw new Error("Message cannot be empty.");
  }
  if (cleanText.length > 4000) {
    throw new Error("Message exceeds 4,000 characters limit.");
  }

  if (messageType === 'view_once_image' && mediaPath) {
    const parts = mediaPath.split('/');
    const uploadId = parts[parts.length - 1];
    const finalizeFn = httpsCallable<any, { success: boolean, messageId: string }>(functions, 'finalizeViewOnce');
    try {
      const result = await finalizeFn({
        conversationId,
        uploadId,
        text: cleanText,
        replyToMessageId
      });
      return result.data.messageId;
    } catch (err: any) {
      console.error("finalizeViewOnce failed:", err);
      throw new Error("Failed to send view-once photo. " + (err.message || ''));
    }
  }

  const messagesCol = collection(db, 'conversations', conversationId, 'messages');
  const messageDocRef = doc(messagesCol);
  const convRef = doc(db, 'conversations', conversationId);

  const batch = writeBatch(db);

  // 1. Message document in subcollection
  const messageData: any = {
    senderId,
    text: cleanText,
    createdAt: serverTimestamp(),
    messageType
  };
  if (imageUrl) messageData.imageUrl = imageUrl;
  if (replyToMessageId) messageData.replyToMessageId = replyToMessageId;
  
  if (messageType === 'view_once_image' && mediaPath) {
    messageData.mediaPath = mediaPath;
    messageData.mediaStatus = 'available';
  }

  batch.set(messageDocRef, messageData);

  let summaryText = cleanText;
  if (imageUrl) summaryText = 'Sent an image';
  if (messageType === 'view_once_image') summaryText = 'Sent a view once photo';

  // 2. Parent conversation document metadata
  batch.update(convRef, {
    lastMessageText: summaryText,
    lastMessageSenderId: senderId,
    lastMessageAt: serverTimestamp(),
    lastMessageId: messageDocRef.id,
    updatedAt: serverTimestamp(),
    [`unreadCount.${recipientId}`]: increment(1),
    [`unreadCount.${senderId}`]: 0
  });

  await batch.commit();
  return messageDocRef.id;
}

/**
 * Resets the unread count ONLY for the current user when opening a conversation.
 * Crucially does NOT update `updatedAt`, preserving accurate conversation recency.
 */
export async function markConversationAsRead(
  conversationId: string,
  userId: string
): Promise<void> {
  try {
    const convRef = doc(db, 'conversations', conversationId);
    await updateDoc(convRef, {
      [`unreadCount.${userId}`]: 0
    });
  } catch (err) {
    console.warn("Error marking conversation as read:", err);
  }
}

export async function updateTypingStatus(
  conversationId: string,
  userId: string,
  isTyping: boolean
): Promise<void> {
  try {
    const convRef = doc(db, 'conversations', conversationId);
    await updateDoc(convRef, {
      [`typing.${userId}`]: isTyping ? serverTimestamp() : deleteField()
    });
  } catch (err) {
    console.warn("Error updating typing status:", err);
  }
}

export async function acceptMessageRequest(conversationId: string): Promise<void> {
  const convRef = doc(db, 'conversations', conversationId);
  await updateDoc(convRef, {
    status: 'accepted'
  });
}

export async function declineMessageRequest(conversationId: string): Promise<void> {
  const convRef = doc(db, 'conversations', conversationId);
  await updateDoc(convRef, {
    status: 'declined'
  });
}

/**
 * Real-time listener for the user's conversations.
 * Uses query `where('participants', 'array-contains', userId)` ordered by `updatedAt` desc.
 * Does NOT silently fall back to an unordered query so index requirements are never hidden.
 */
export async function toggleReaction(
  conversationId: string,
  messageId: string,
  userId: string,
  emoji: string
): Promise<void> {
  const msgRef = doc(db, 'conversations', conversationId, 'messages', messageId);
  try {
    await runTransaction(db, async (transaction) => {
      const msgDoc = await transaction.get(msgRef);
      if (!msgDoc.exists()) throw new Error("Message not found.");
      
      const data = msgDoc.data() as Message;
      const reactions = data.reactions || {};
      
      const newReactions = { ...reactions };
      if (newReactions[userId] === emoji) {
        delete newReactions[userId];
      } else {
        newReactions[userId] = emoji;
      }
      
      transaction.update(msgRef, { reactions: newReactions });
    });
  } catch (err) {
    console.error("Error toggling reaction:", err);
    throw err;
  }
}

export function subscribeToUserConversations(
  userId: string,
  pageSize: number = 40,
  onUpdate: (conversations: Conversation[], lastSnapshot: DocumentSnapshot | null) => void,
  onError?: (error: Error) => void
): () => void {
  const convQuery = query(
    collection(db, 'conversations'),
    where('participants', 'array-contains', userId),
    orderBy('updatedAt', 'desc'),
    limit(pageSize)
  );

  return onSnapshot(
    convQuery,
    (snapshot) => {
      const convList: Conversation[] = [];
      snapshot.forEach((d) => {
        convList.push({ id: d.id, ...(d.data() as Omit<Conversation, 'id'>) });
      });
      const lastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
      onUpdate(convList, lastDoc);
    },
    (err) => {
      console.error("Conversations subscription error:", err);
      if (onError) onError(err);
    }
  );
}

/**
 * Loads a page of older conversations using cursor pagination (startAfter).
 */
export async function loadOlderConversations(
  userId: string,
  lastSnapshot: DocumentSnapshot,
  pageSize: number = 30
): Promise<{ conversations: Conversation[]; lastSnapshot: DocumentSnapshot | null; hasMore: boolean }> {
  try {
    const q = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', userId),
      orderBy('updatedAt', 'desc'),
      startAfter(lastSnapshot),
      limit(pageSize)
    );
    const snap = await getDocs(q);
    const convList: Conversation[] = [];
    snap.forEach((d) => {
      convList.push({ id: d.id, ...(d.data() as Omit<Conversation, 'id'>) });
    });
    const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
    return {
      conversations: convList,
      lastSnapshot: lastDoc,
      hasMore: snap.docs.length === pageSize
    };
  } catch (err) {
    console.error("Error loading older conversations:", err);
    throw err;
  }
}

/**
 * Safely fetches a specific conversation document directly by ID and validates caller membership.
 * Useful when opening older conversations from Profile -> Message that may not be in the loaded page.
 */
export async function getConversationSafely(
  conversationId: string,
  currentUid: string
): Promise<Conversation | null> {
  try {
    const convRef = doc(db, 'conversations', conversationId);
    const snap = await getDoc(convRef);
    if (!snap.exists()) return null;
    const data = snap.data() as Omit<Conversation, 'id'>;
    if (!data.participants || !data.participants.includes(currentUid)) {
      throw new Error("You do not have access to this conversation.");
    }
    return { id: snap.id, ...data };
  } catch (err) {
    console.error("Error fetching conversation safely:", err);
    throw err;
  }
}

/**
 * Subscribes in real-time to the newest messages of a conversation.
 * Returns the messages in chronological order (oldest -> newest for chat rendering)
 * and the oldest snapshot in the window for pagination.
 */
export function subscribeToMessages(
  conversationId: string,
  limitCount: number = 35,
  onUpdate: (messages: Message[], oldestDoc: DocumentSnapshot | null) => void,
  onError?: (error: Error) => void
): () => void {
  const messagesQuery = query(
    collection(db, 'conversations', conversationId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  );

  return onSnapshot(
    messagesQuery,
    (snapshot) => {
      const items: Message[] = [];
      const docs = snapshot.docs;
      const oldestDoc = docs.length > 0 ? docs[docs.length - 1] : null;

      // Reverse so display order is chronological (oldest at top, newest at bottom)
      for (let i = docs.length - 1; i >= 0; i--) {
        const d = docs[i];
        items.push({ id: d.id, ...(d.data() as Omit<Message, 'id'>) });
      }

      onUpdate(items, oldestDoc);
    },
    (err) => {
      console.error("Messages subscription error:", err);
      if (onError) onError(err);
    }
  );
}

/**
 * Loads a page of older messages using cursor pagination (startAfter).
 */
export async function loadOlderMessages(
  conversationId: string,
  oldestDoc: DocumentSnapshot,
  pageSize: number = 30
): Promise<{ messages: Message[]; oldestDoc: DocumentSnapshot | null; hasMore: boolean }> {
  try {
    const q = query(
      collection(db, 'conversations', conversationId, 'messages'),
      orderBy('createdAt', 'desc'),
      startAfter(oldestDoc),
      limit(pageSize)
    );

    const snapshot = await getDocs(q);
    const docs = snapshot.docs;
    const newOldest = docs.length > 0 ? docs[docs.length - 1] : null;

    const olderItems: Message[] = [];
    for (let i = docs.length - 1; i >= 0; i--) {
      const d = docs[i];
      olderItems.push({ id: d.id, ...(d.data() as Omit<Message, 'id'>) });
    }

    return {
      messages: olderItems,
      oldestDoc: newOldest,
      hasMore: docs.length === pageSize
    };
  } catch (err) {
    console.error("Error loading older messages:", err);
    throw err;
  }
}

/**
 * Resolves a user profile by exact username using the existing /usernames/{username} collection,
 * without downloading random user collections.
 */
export async function findUserByUsername(username: string): Promise<UserProfile | null> {
  const clean = username.trim().toLowerCase().replace(/^@/, '');
  if (!clean) return null;

  try {
    const claimSnap = await getDoc(doc(db, 'usernames', clean));
    if (!claimSnap.exists()) return null;

    const uid = claimSnap.data()?.uid;
    if (!uid) return null;

    return getCachedUserProfile(uid);
  } catch (err) {
    console.error("Error finding user by username:", err);
    return null;
  }
}

/**
 * Safely fetches a UserProfile by UID with graceful fallback if the account was deleted.
 */
export async function fetchUserProfileSafely(uid: string): Promise<UserProfile | null> {
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      return userSnap.data() as UserProfile;
    }
    return null;
  } catch (err) {
    console.warn("Could not fetch user profile for uid:", uid, err);
    return null;
  }
}

/**
 * Retrieves a user profile from the in-memory cache with TTL.
 * Failed/null reads are NOT permanently cached so temporary network issues do not turn users into 'Deleted User'.
 */
export async function getCachedUserProfile(uid: string): Promise<UserProfile | null> {
  if (!uid) return null;
  const now = Date.now();
  const cached = profileCache.get(uid);
  if (cached && (now - cached.cachedAt < PROFILE_CACHE_TTL_MS)) {
    return cached.profile;
  }

  const existingInFlight = profileInFlight.get(uid);
  if (existingInFlight) {
    return existingInFlight;
  }

  const promise = (async () => {
    try {
      const profile = await fetchUserProfileSafely(uid);
      if (profile) {
        profileCache.set(uid, { profile, cachedAt: Date.now() });
      } else {
        profileCache.delete(uid);
      }
      return profile;
    } catch (err) {
      profileCache.delete(uid);
      return null;
    } finally {
      profileInFlight.delete(uid);
    }
  })();

  profileInFlight.set(uid, promise);
  return promise;
}

/**
 * Formats user-friendly error messages for messaging operations,
 * suppressing raw Firebase codes and surfacing index requirements clearly.
 */
export function formatMessagingError(err: any): string {
  if (!err) return "An unexpected error occurred. Please try again.";
  const msg = typeof err === 'string' ? err : (err.message || '');
  const code = err.code || '';

  if (code === 'failed-precondition' || msg.includes('requires an index') || msg.toLowerCase().includes('index')) {
    return "Firestore composite index required: The conversations query requires an index on (participants Array-contains, updatedAt Descending). Please deploy firestore.indexes.json or configure it in Firebase Console.";
  }
  if (
    code === 'permission-denied' ||
    msg.toLowerCase().includes('permission') ||
    msg.toLowerCase().includes('denied') ||
    msg.toLowerCase().includes('blocked')
  ) {
    return "You cannot start or continue this conversation due to privacy or block restrictions.";
  }
  if (msg.includes("yourself")) {
    return "You cannot start a conversation with yourself.";
  }
  if (msg.includes("deleted") || code === 'not-found') {
    return "This user account is no longer available.";
  }
  if (
    code === 'unavailable' ||
    msg.toLowerCase().includes('network') ||
    msg.toLowerCase().includes('offline')
  ) {
    return "Connection problem. Please check your network and try again.";
  }
  return msg || "Unable to complete request. Please try again.";
}
