import React, { useState, useEffect, useMemo } from 'react';
import { 
  MessageSquarePlus, 
  Search, 
  MessageSquare, 
  Loader2,
  AlertCircle
} from 'lucide-react';
import { doc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { 
  subscribeToUserConversations, 
  loadOlderConversations,
  getConversationSafely,
  getOrCreateConversation, 
  getConversationId,
  getCachedUserProfile,
  formatMessagingError
} from '../services/messaging';
import { ChatView } from './ChatView';
import { NewConversationModal } from './NewConversationModal';
import type { 
  Conversation, 
  UserProfile, 
  ConversationParticipantSummary 
} from '../types';

interface MessagesViewProps {
  currentUser: UserProfile;
  conversations?: Conversation[];
  loading?: boolean;
  initialConversationDoc?: DocumentSnapshot | null;
  conversationsError?: Error | null;
  blockedUserIds: string[];
  isBlockedWith: (targetUid: string) => boolean;
  initialTargetUser?: UserProfile | null;
  onClearInitialTargetUser?: () => void;
  onViewProfile: (username: string) => void;
}

export function MessagesView({
  currentUser,
  conversations: externalConversations,
  loading: externalLoading,
  initialConversationDoc,
  conversationsError: externalConversationsError,
  blockedUserIds,
  isBlockedWith,
  initialTargetUser,
  onClearInitialTargetUser,
  onViewProfile
}: MessagesViewProps) {
  // If parent (App.tsx) provides conversations, use them to avoid duplicate listeners.
  // Otherwise fall back to a dedicated internal listener.
  const [internalConversations, setInternalConversations] = useState<Conversation[]>([]);
  const [internalLoading, setInternalLoading] = useState(true);
  const [internalLastDoc, setInternalLastDoc] = useState<DocumentSnapshot | null>(null);
  const [internalError, setInternalError] = useState<Error | null>(null);

  const conversations = externalConversations !== undefined ? externalConversations : internalConversations;
  const loading = externalLoading !== undefined ? externalLoading : internalLoading;
  const activeError = externalConversationsError !== undefined ? externalConversationsError : internalError;

  // Pagination for older conversations
  const [olderConversations, setOlderConversations] = useState<Conversation[]>([]);
  const [lastConvDoc, setLastConvDoc] = useState<DocumentSnapshot | null>(initialConversationDoc || null);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [openingConversation, setOpeningConversation] = useState(false);

  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [directConversation, setDirectConversation] = useState<Conversation | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // In-memory profiles map for other participants, authoritative from /users/{uid}
  const [profiles, setProfiles] = useState<Record<string, UserProfile | null>>({});

  // Sync pagination cursor from parent or internal listener
  useEffect(() => {
    const docToUse = initialConversationDoc !== undefined ? initialConversationDoc : internalLastDoc;
    setLastConvDoc(docToUse);
    setHasMoreOlder(conversations.length >= 40);
  }, [initialConversationDoc, internalLastDoc, conversations.length]);

  // Fallback internal subscription if parent does not supply conversations
  useEffect(() => {
    if (externalConversations !== undefined) return;

    setInternalLoading(true);
    setInternalError(null);
    const unsubscribe = subscribeToUserConversations(
      currentUser.uid,
      40,
      (convs, lastDoc) => {
        setInternalConversations(convs);
        setInternalLastDoc(lastDoc);
        setInternalLoading(false);
      },
      (err) => {
        console.error("Internal conversations subscription error:", err);
        setInternalError(err);
        setInternalLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser.uid, externalConversations]);

  // Ensure direct conversation document is always subscribed when an ID is active
  useEffect(() => {
    if (!selectedConversationId) {
      setDirectConversation(null);
      return;
    }

    const convRef = doc(db, 'conversations', selectedConversationId);
    const unsubscribe = onSnapshot(
      convRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Omit<Conversation, 'id'>;
          setDirectConversation({ id: snap.id, ...data });
        }
      },
      (err) => {
        console.warn("Direct conversation snapshot notice:", err);
      }
    );

    return () => unsubscribe();
  }, [selectedConversationId]);

  // Combine newest 40 realtime conversations + older paginated conversations
  const allConversations = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const c of olderConversations) {
      map.set(c.id, c);
    }
    for (const c of conversations) {
      map.set(c.id, c);
    }

    const list = Array.from(map.values());
    const getTimestampMs = (val: any): number => {
      if (!val) return 0;
      if (typeof val === 'number') return val;
      if (typeof val.toMillis === 'function') return val.toMillis();
      if (typeof val.seconds === 'number') return val.seconds * 1000;
      return 0;
    };
    list.sort((a, b) => getTimestampMs(b.updatedAt) - getTimestampMs(a.updatedAt));
    return list;
  }, [conversations, olderConversations]);

  // Resolve verified user profiles for all other participants in active conversations
  useEffect(() => {
    const missingUids: string[] = [];
    allConversations.forEach((c) => {
      const otherUid = c.participants.find((uid) => uid !== currentUser.uid);
      if (otherUid && profiles[otherUid] === undefined && !missingUids.includes(otherUid)) {
        missingUids.push(otherUid);
      }
    });

    if (directConversation) {
      const otherUid = directConversation.participants.find((uid) => uid !== currentUser.uid);
      if (otherUid && profiles[otherUid] === undefined && !missingUids.includes(otherUid)) {
        missingUids.push(otherUid);
      }
    }

    if (missingUids.length === 0) return;

    let isMounted = true;
    missingUids.forEach((uid) => {
      getCachedUserProfile(uid)
        .then((profile) => {
          if (isMounted) {
            setProfiles((prev) => ({ ...prev, [uid]: profile }));
          }
        })
        .catch(() => {
          if (isMounted) {
            setProfiles((prev) => ({ ...prev, [uid]: null }));
          }
        });
    });

    return () => {
      isMounted = false;
    };
  }, [allConversations, directConversation, currentUser.uid, profiles]);

  // Load older paginated conversations
  const handleLoadOlderConversations = async () => {
    if (!lastConvDoc || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const { conversations: olderBatch, lastSnapshot: nextDoc, hasMore } = await loadOlderConversations(
        currentUser.uid,
        lastConvDoc,
        30
      );
      setOlderConversations((prev) => [...prev, ...olderBatch]);
      setLastConvDoc(nextDoc);
      setHasMoreOlder(hasMore);
    } catch (err: any) {
      console.error("Failed to load older conversations:", err);
      setGeneralError(formatMessagingError(err));
    } finally {
      setLoadingOlder(false);
    }
  };

  // Handle incoming initial target user from ProfileView "Message" button
  // NEVER creates an optimistic fake conversation - verifies real existence first
  useEffect(() => {
    if (!initialTargetUser) return;

    let isCancelled = false;

    async function openChatWithTarget(target: UserProfile) {
      setOpeningConversation(true);
      setGeneralError(null);
      // Pre-cache profile
      setProfiles((prev) => ({ ...prev, [target.uid]: target }));

      const convId = getConversationId(currentUser.uid, target.uid);

      try {
        if (isBlockedWith(target.uid) || blockedUserIds.includes(target.uid)) {
          throw new Error("You cannot start a conversation with a blocked user.");
        }

        // 1. Check if already present in loaded conversations
        const existingInList = allConversations.find((c) => c.id === convId);
        if (existingInList) {
          if (!isCancelled) {
            setDirectConversation(existingInList);
            setSelectedConversationId(convId);
          }
          return;
        }

        // 2. Check if exists on server (e.g. outside the newest 40 page)
        const existingDoc = await getConversationSafely(convId, currentUser.uid);
        if (existingDoc) {
          if (!isCancelled) {
            setDirectConversation(existingDoc);
            setSelectedConversationId(convId);
          }
          return;
        }

        // 3. Document does not exist: create safely via transaction
        await getOrCreateConversation(currentUser, target);

        // 4. Confirm created document before opening chat view
        const confirmedDoc = await getConversationSafely(convId, currentUser.uid);
        if (confirmedDoc) {
          if (!isCancelled) {
            setDirectConversation(confirmedDoc);
            setSelectedConversationId(convId);
          }
        } else {
          throw new Error("Unable to confirm conversation creation.");
        }
      } catch (err: any) {
        console.error("Failed to open chat with user:", err);
        if (!isCancelled) {
          // COMPLETE ROLLBACK - NEVER LEAVE FAKE STATE
          setSelectedConversationId(null);
          setDirectConversation(null);
          setGeneralError(formatMessagingError(err));
        }
      } finally {
        if (!isCancelled) {
          setOpeningConversation(false);
        }
        if (onClearInitialTargetUser) {
          onClearInitialTargetUser();
        }
      }
    }

    openChatWithTarget(initialTargetUser);

    return () => {
      isCancelled = true;
    };
  }, [initialTargetUser, currentUser, allConversations, isBlockedWith, blockedUserIds, onClearInitialTargetUser]);

  const [activeTab, setActiveTab] = useState<'messages' | 'requests'>('messages');

  // Filter conversations by search input (matching verified display names, usernames, or text)
  const filteredConversations = useMemo(() => {
    return allConversations.filter((conv) => {
      const otherUid = conv.participants.find((uid) => uid !== currentUser.uid) || '';
      const profile = profiles[otherUid];
      
      const term = searchFilter.trim().toLowerCase();
      if (!term) return true;

      const displayName = profile?.displayName?.toLowerCase() || (profile === null ? 'deleted user' : '');
      const username = profile?.username?.toLowerCase() || '';
      const lastMsg = conv.lastMessageText ? conv.lastMessageText.toLowerCase() : '';

      return (
        displayName.includes(term) ||
        username.includes(term) ||
        lastMsg.includes(term)
      );
    });
  }, [allConversations, currentUser.uid, searchFilter, profiles]);

  const normalConversations = useMemo(() => {
    return filteredConversations.filter((conv) => {
      // Don't show declined requests at all, or requests waiting for us to accept
      if (conv.status === 'declined') return false;
      return conv.status !== 'pending' || conv.requestedBy === currentUser.uid;
    });
  }, [filteredConversations, currentUser.uid]);

  const requestConversations = useMemo(() => {
    return filteredConversations.filter((conv) => {
      // Hide empty requests from recipient to prevent empty rows
      if (!conv.lastMessageText && !conv.lastMessageSenderId && conv.requestedBy !== currentUser.uid) {
        return false;
      }
      return conv.status === 'pending' && conv.requestedBy !== currentUser.uid;
    });
  }, [filteredConversations, currentUser.uid]);

  const currentConversations = activeTab === 'messages' ? normalConversations : requestConversations;

  // Active selected conversation
  const activeConversation = useMemo(() => {
    if (!selectedConversationId) return null;
    return allConversations.find((c) => c.id === selectedConversationId) || directConversation;
  }, [allConversations, selectedConversationId, directConversation]);

  // Verified summary of the other participant in the active conversation
  const activeOtherUserSummary = useMemo<ConversationParticipantSummary | undefined>(() => {
    if (!activeConversation) return undefined;
    const otherUid = activeConversation.participants.find((uid) => uid !== currentUser.uid) || '';
    const profile = profiles[otherUid];

    if (profile) {
      return {
        uid: otherUid,
        username: profile.username,
        displayName: profile.displayName,
        photoURL: profile.photoURL || '',
        isDeleted: false
      };
    }

    if (profile === null) {
      return {
        uid: otherUid,
        username: 'deleted',
        displayName: 'Deleted User',
        photoURL: '',
        isDeleted: true
      };
    }

    return {
      uid: otherUid,
      username: 'user',
      displayName: 'Ripple Member',
      photoURL: '',
      isDeleted: false
    };
  }, [activeConversation, currentUser.uid, profiles]);

  // Handle user pick from NewConversationModal
  const handleSelectUserFromModal = async (targetUser: UserProfile) => {
    setGeneralError(null);
    setProfiles((prev) => ({ ...prev, [targetUser.uid]: targetUser }));

    const convId = getConversationId(currentUser.uid, targetUser.uid);

    try {
      if (isBlockedWith(targetUser.uid) || blockedUserIds.includes(targetUser.uid)) {
        throw new Error("You cannot start a conversation with a blocked user.");
      }

      // Check if already in loaded list
      const existingInList = allConversations.find((c) => c.id === convId);
      if (existingInList) {
        setDirectConversation(existingInList);
        setSelectedConversationId(convId);
        setIsNewModalOpen(false);
        return;
      }

      // Check if exists on server
      const existingDoc = await getConversationSafely(convId, currentUser.uid);
      if (existingDoc) {
        setDirectConversation(existingDoc);
        setSelectedConversationId(convId);
        setIsNewModalOpen(false);
        return;
      }

      // Create safely
      await getOrCreateConversation(currentUser, targetUser);

      // Confirm created doc
      const confirmedDoc = await getConversationSafely(convId, currentUser.uid);
      if (confirmedDoc) {
        setDirectConversation(confirmedDoc);
        setSelectedConversationId(convId);
        setIsNewModalOpen(false);
      } else {
        throw new Error("Unable to confirm conversation creation.");
      }
    } catch (err: any) {
      console.error("Error starting conversation from modal:", err);
      // ROLL BACK ALL STATE
      setSelectedConversationId(null);
      setDirectConversation(null);
      setGeneralError(formatMessagingError(err));
      throw err;
    }
  };

  // Helper for relative timestamps
  const formatListTimestamp = (ts: any) => {
    if (!ts) return '';
    const date = typeof ts === 'number' ? new Date(ts) : typeof ts.toDate === 'function' ? ts.toDate() : new Date();
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24 && date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Determine if active error is a missing index error
  const isIndexError = activeError && (
    (activeError as any).code === 'failed-precondition' ||
    activeError.message?.toLowerCase().includes('index')
  );

  return (
    <div id="messages-view-container" className="h-[calc(100vh-3.5rem-4rem)] md:h-[calc(100vh-3.5rem)] flex flex-col max-w-5xl mx-auto bg-white md:rounded-2xl md:my-4 md:border md:border-slate-200/80 md:shadow-xs overflow-hidden relative">
      
      {/* Alert banner if any general error occurs */}
      {generalError && (
        <div className="p-3 bg-rose-50 border-b border-rose-200 text-rose-700 text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{generalError}</span>
          </div>
          <button 
            onClick={() => setGeneralError(null)}
            className="text-rose-600 hover:text-rose-800 font-bold ml-2 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Prominent Missing Index Banner when Firestore index is not deployed */}
      {isIndexError && (
        <div className="p-3 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs shrink-0">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-bold">Firestore Composite Index Required</div>
              <p className="mt-0.5 text-amber-800 text-[11px] leading-relaxed">
                The conversation query requires a composite index on collection <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">conversations</code>:
                <br />
                <span className="font-semibold">• participants:</span> Arrays
                <br />
                <span className="font-semibold">• updatedAt:</span> Descending
              </p>
              <p className="mt-1 text-amber-700 text-[11px]">
                Deploy <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">firestore.indexes.json</code> or configure this composite index in the Firebase Console.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Conversation List */}
        {/* On mobile: hidden if active conversation is selected */}
        <div 
          className={`w-full md:w-80 lg:w-96 flex flex-col border-r border-slate-200/80 bg-white shrink-0 ${
            selectedConversationId ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* Header */}
          <div className="p-4 border-b border-slate-100 flex flex-col shrink-0 bg-white">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base font-extrabold text-slate-900 tracking-tight">Messages</h2>
                <p className="text-[11px] text-slate-500">Private, one-to-one conversations</p>
              </div>
              <button
                id="new-message-button"
                type="button"
                onClick={() => setIsNewModalOpen(true)}
                className="p-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 transition flex items-center gap-1.5 text-xs font-bold shadow-2xs active:scale-95"
                title="Start new message"
              >
                <MessageSquarePlus className="w-4 h-4" />
                <span className="hidden sm:inline">New</span>
              </button>
            </div>
            
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveTab('messages')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-md transition ${activeTab === 'messages' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Primary
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('requests')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-md transition flex items-center justify-center gap-1.5 ${activeTab === 'requests' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Requests
                {requestConversations.length > 0 && (
                  <span className="bg-rose-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                    {requestConversations.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/50 shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search conversations..."
                className="w-full pl-8.5 pr-3 py-1.5 bg-white border border-slate-200/90 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
              />
            </div>
          </div>

          {/* Conversation Items List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
            {loading ? (
              <div className="py-16 text-center text-slate-400 text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600 mx-auto mb-2" />
                <span>Loading messages...</span>
              </div>
            ) : currentConversations.length === 0 ? (
              <div className="py-16 px-6 text-center text-slate-400 text-xs">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3">
                  <MessageSquare className="w-6 h-6 opacity-70" />
                </div>
                <h4 className="font-bold text-slate-800 text-sm">
                  {searchFilter ? 'No matching conversations' : (activeTab === 'requests' ? 'No message requests' : 'Your messages will appear here')}
                </h4>
                <p className="mt-1 text-slate-500 max-w-xs mx-auto text-xs">
                  {searchFilter
                    ? 'Try searching with a different name or username.'
                    : (activeTab === 'requests' ? 'When you receive a message from someone you don\'t follow, it will appear here.' : 'Start a private conversation with any Ripple member.')}
                </p>
                {!searchFilter && activeTab === 'messages' && (
                  <button
                    onClick={() => setIsNewModalOpen(true)}
                    className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm shadow-blue-600/20 transition active:scale-95"
                  >
                    Start a Conversation
                  </button>
                )}
              </div>
            ) : (
              <>
                {currentConversations.map((conv) => {
                  const otherUid = conv.participants.find((uid) => uid !== currentUser.uid) || '';
                  const profile = profiles[otherUid];
                  const isDeleted = profile === null;

                  const displayName = profile ? profile.displayName : (isDeleted ? 'Deleted User' : 'Ripple Member');
                  const username = profile ? `@${profile.username}` : (isDeleted ? 'Account Deleted' : '');
                  const photoURL = profile ? profile.photoURL : '';

                  const unreadCount = conv.unreadCount?.[currentUser.uid] || 0;
                  const isSelected = selectedConversationId === conv.id;

                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => setSelectedConversationId(conv.id)}
                      className={`w-full p-3.5 flex items-start gap-3 text-left transition relative ${
                        isSelected
                          ? 'bg-blue-50/70 border-l-4 border-l-blue-600'
                          : 'hover:bg-slate-50/80 active:bg-slate-100/60'
                      }`}
                    >
                      <img
                        src={photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${displayName}`}
                        alt={displayName}
                        className="w-11 h-11 rounded-full object-cover ring-1 ring-slate-200 shrink-0 mt-0.5"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-1">
                          <span className={`text-xs font-bold truncate ${isDeleted ? 'text-slate-500 italic' : 'text-slate-900'}`}>
                            {displayName}
                          </span>
                          <span className="text-[10px] text-slate-400 shrink-0">
                            {formatListTimestamp(conv.lastMessageAt || conv.updatedAt)}
                          </span>
                        </div>

                        {username && (
                          <div className="text-[11px] text-slate-400 truncate leading-tight">
                            {username}
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-2 mt-1">
                          <p className={`text-xs truncate ${unreadCount > 0 ? 'font-bold text-slate-900' : 'text-slate-500'}`}>
                            {conv.lastMessageText ? (
                              conv.lastMessageSenderId === currentUser.uid
                                ? `You: ${conv.lastMessageText}`
                                : conv.lastMessageText
                            ) : (
                              <span className="italic text-slate-400">No messages yet</span>
                            )}
                          </p>

                          {unreadCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold shrink-0 min-w-[18px] text-center shadow-xs">
                              {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* Load older conversations button */}
                {hasMoreOlder && (
                  <div className="p-3 text-center bg-slate-50/50">
                    <button
                      type="button"
                      onClick={handleLoadOlderConversations}
                      disabled={loadingOlder}
                      className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      {loadingOlder ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                          <span>Loading older chats...</span>
                        </>
                      ) : (
                        <span>Load older conversations</span>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Column: Chat View */}
        {/* On mobile: full width if active conversation is selected */}
        <div 
          className={`flex-1 flex flex-col bg-slate-50/50 ${
            selectedConversationId ? 'flex' : 'hidden md:flex'
          }`}
        >
          {selectedConversationId && !activeConversation ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-400">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
              <p className="text-xs text-slate-500 font-medium">Opening conversation...</p>
              <button
                type="button"
                onClick={() => {
                  setSelectedConversationId(null);
                  setDirectConversation(null);
                }}
                className="mt-4 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
              >
                Back to Conversations
              </button>
            </div>
          ) : activeConversation ? (
            <ChatView
              key={activeConversation.id}
              conversation={activeConversation}
              currentUser={currentUser}
              otherUserSummary={activeOtherUserSummary}
              isBlocked={isBlockedWith(activeOtherUserSummary?.uid || '')}
              onBack={() => {
                setSelectedConversationId(null);
                setDirectConversation(null);
              }}
              onViewProfile={onViewProfile}
            />
          ) : (
            <div className="hidden md:flex flex-col items-center justify-center h-full p-8 text-center text-slate-400">
              <div className="w-16 h-16 rounded-3xl bg-slate-100 flex items-center justify-center text-slate-400 mb-4 shadow-inner">
                <MessageSquare className="w-8 h-8 opacity-60" />
              </div>
              <h3 className="text-sm font-bold text-slate-700">Select a conversation</h3>
              <p className="text-xs text-slate-500 max-w-xs mt-1">
                Choose an existing conversation from the list or start a new message.
              </p>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(true)}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition active:scale-95 flex items-center gap-1.5"
              >
                <MessageSquarePlus className="w-4 h-4" />
                <span>New Message</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Opening Conversation Modal Spinner */}
      {openingConversation && (
        <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-5 max-w-xs w-full text-center flex flex-col items-center gap-3">
            <Loader2 className="w-7 h-7 text-blue-600 animate-spin" />
            <div>
              <p className="text-sm font-bold text-slate-800">Opening conversation...</p>
              <p className="text-xs text-slate-500 mt-0.5">Connecting securely to chat</p>
            </div>
          </div>
        </div>
      )}

      {/* New Conversation Search Modal */}
      <NewConversationModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        currentUser={currentUser}
        blockedUserIds={blockedUserIds}
        onSelectUser={handleSelectUserFromModal}
      />

    </div>
  );
}
