import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ArrowLeft, 
  Send, 
  ChevronDown, 
  AlertCircle, 
  Lock, 
  Loader2,
  MessageSquare,
  Image as ImageIcon,
  X,
  Reply,
  Smile,
  Eye
} from 'lucide-react';
import { 
  subscribeToMessages, 
  loadOlderMessages, 
  sendDirectMessage, 
  markConversationAsRead,
  formatMessagingError,
  acceptMessageRequest,
  declineMessageRequest,
  updateTypingStatus,
  toggleReaction
} from '../services/messaging';
import type { 
  Conversation, 
  Message, 
  UserProfile, 
  ConversationParticipantSummary 
} from '../types';
import type { DocumentSnapshot } from 'firebase/firestore';

import { uploadMessageImage, deleteMessageImage, uploadViewOnceImage } from '../services/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';

function ViewOnceMessage({ msg, isMe, conversationId, currentUser }: { msg: Message, isMe: boolean, conversationId: string, currentUser: UserProfile }) {
  const [imgData, setImgData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showImage, setShowImage] = useState(false);

  const isViewed = msg.mediaStatus === 'viewed';
  const isExpired = msg.mediaStatus === 'expired';
  const isConsuming = msg.mediaStatus === 'consuming';

  const handleView = async () => {
    if (isExpired || isViewed || isConsuming || isMe || !msg.mediaPath) return;
    setLoading(true);
    try {
      const consumeFn = httpsCallable<any, { success: boolean, imageBytes: string, mimeType: string }>(functions, 'consumeViewOnce');
      const result = await consumeFn({
        conversationId,
        messageId: msg.id
      });
      const { imageBytes, mimeType } = result.data;
      setImgData(`data:${mimeType};base64,${imageBytes}`);
      setShowImage(true);
    } catch (err) {
      console.error(err);
      setError("Photo unavailable or expired");
    } finally {
      setLoading(false);
    }
  };

  const closeViewer = () => {
    setShowImage(false);
    setImgData(null);
  };

  if (isMe) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border border-blue-500/50 rounded-xl bg-blue-600 text-white min-w-0 max-w-[280px]">
        <ImageIcon className="w-4 h-4 opacity-80 shrink-0" />
        <span className="text-sm italic truncate">You sent a View Once photo</span>
        {isConsuming && <span className="text-xs ml-1 opacity-80 shrink-0">(Opening...)</span>}
        {isViewed && <span className="text-xs ml-1 opacity-70 shrink-0">(Viewed)</span>}
        {isExpired && <span className="text-xs ml-1 opacity-70 shrink-0">(Expired)</span>}
      </div>
    );
  }

  if (isConsuming) {
    return (
      <div className="flex items-center gap-2 px-3.5 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-slate-600 min-w-0 max-w-[280px]">
        <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
        <span className="text-xs font-semibold truncate">Opening photo...</span>
      </div>
    );
  }

  if (isExpired || isViewed) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 text-slate-500 min-w-0 max-w-[280px]">
        <ImageIcon className="w-4 h-4 opacity-50 shrink-0" />
        <span className="text-sm italic truncate">Photo {isViewed ? 'viewed' : 'expired'}</span>
      </div>
    );
  }

  if (showImage && imgData) {
    return (
      <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4">
        <button 
          onClick={closeViewer}
          className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition"
        >
          <X className="w-6 h-6" />
        </button>
        <img 
          src={imgData} 
          alt="View once" 
          className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl"
          onContextMenu={(e) => e.preventDefault()}
        />
        <div className="mt-6 text-white/50 text-sm flex items-center gap-2">
          <Eye className="w-4 h-4" /> This photo has been deleted from our servers
        </div>
      </div>
    );
  }

  return (
    <button 
      onClick={handleView}
      disabled={loading}
      className="flex items-center gap-2 px-3.5 py-2.5 sm:px-4 sm:py-3 border border-slate-200 rounded-xl bg-white hover:bg-slate-50 text-slate-700 transition w-full sm:w-auto min-w-0 max-w-[280px] text-left"
    >
      <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Eye className="w-5 h-5" />}
      </div>
      <div className="min-w-0">
        <div className="font-bold text-sm truncate">View Photo</div>
        {error ? (
          <div className="text-xs text-rose-500 font-medium truncate">{error}</div>
        ) : (
          <div className="text-xs text-slate-500 font-medium truncate">Tap to open once</div>
        )}
      </div>
    </button>
  );
}

interface ChatViewProps {
  key?: React.Key;
  conversation: Conversation;
  currentUser: UserProfile;
  otherUserSummary?: ConversationParticipantSummary;
  isBlocked: boolean;
  onBack?: () => void;
  onViewProfile: (username: string) => void;
}

export function ChatView({
  conversation,
  currentUser,
  otherUserSummary,
  isBlocked,
  onBack,
  onViewProfile
}: ChatViewProps) {
  // State separated for older loaded history and real-time newest messages to prevent wipes
  const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([]);
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showScrollBottomPill, setShowScrollBottomPill] = useState(false);
  const [processingRequest, setProcessingRequest] = useState(false);
  const [activeReactionMenu, setActiveReactionMenu] = useState<string | null>(null);
  // local trick to force typing expiration rerender
  const [, setTick] = useState(0);

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [isViewOnce, setIsViewOnce] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDeclined = conversation.status === 'declined';
  const isPendingRequesterCompleted = conversation.status === 'pending' && conversation.requestedBy === currentUser.uid && !!conversation.lastMessageId;
  const isPendingRecipient = conversation.status === 'pending' && conversation.requestedBy !== currentUser.uid;
  const canSend = !isBlocked && !(otherUserSummary?.isDeleted) && !isDeclined && !isPendingRequesterCompleted && !isPendingRecipient;

  // References
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const isInitialLoadRef = useRef(true);
  const oldestCursorRef = useRef<DocumentSnapshot | null>(null);
  const prevScrollHeightRef = useRef(0);
  const prevScrollTopRef = useRef(0);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  // Clear typing status on unmount
  useEffect(() => {
    return () => {
      if (isTypingRef.current) {
        updateTypingStatus(conversation.id, currentUser.uid, false).catch(() => {});
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [conversation.id, currentUser.uid]);

  // Other user identifier
  const otherUid = useMemo(() => {
    return conversation.participants.find((uid) => uid !== currentUser.uid) || '';
  }, [conversation.participants, currentUser.uid]);

  // Fallback other profile if summary is still loading
  const otherProfile = useMemo(() => {
    if (otherUserSummary) return otherUserSummary;
    return {
      uid: otherUid,
      username: 'user',
      displayName: 'Ripple Member',
      photoURL: '',
      isDeleted: false
    };
  }, [otherUserSummary, otherUid]);

  // Combine older loaded messages with realtime incoming messages, deduplicating and sorting chronologically
  const messages = useMemo(() => {
    const map = new Map<string, Message>();
    // 1. Add older paginated messages
    for (const msg of olderMessages) {
      map.set(msg.id, msg);
    }
    // 2. Add real-time messages (overriding older if overlap exists)
    for (const msg of realtimeMessages) {
      map.set(msg.id, msg);
    }

    const list = Array.from(map.values());

    const getTimestampMs = (val: any): number => {
      if (!val) return 0;
      if (typeof val === 'number') return val;
      if (typeof val.toMillis === 'function') return val.toMillis();
      if (typeof val.seconds === 'number') return val.seconds * 1000;
      return 0;
    };

    list.sort((a, b) => getTimestampMs(a.createdAt) - getTimestampMs(b.createdAt));
    return list;
  }, [olderMessages, realtimeMessages]);

  // Mark conversation as read on initial mount or conversation switch
  useEffect(() => {
    markConversationAsRead(conversation.id, currentUser.uid);
  }, [conversation.id, currentUser.uid]);

  // Real-time messages subscription
  useEffect(() => {
    setLoading(true);
    setSendError(null);
    isInitialLoadRef.current = true;
    oldestCursorRef.current = null;
    setOlderMessages([]);

    const unsubscribe = subscribeToMessages(
      conversation.id,
      35,
      (newestBatch, oldestSnapshot) => {
        setRealtimeMessages(newestBatch);

        // Save pagination cursor on first batch or update if not yet paginating
        if (isInitialLoadRef.current) {
          oldestCursorRef.current = oldestSnapshot;
          setHasMoreOlder(newestBatch.length >= 35);
        }

        setLoading(false);

        // Smart scroll logic
        setTimeout(() => {
          const container = scrollContainerRef.current;
          if (!container) return;

          if (isInitialLoadRef.current) {
            container.scrollTop = container.scrollHeight;
            isInitialLoadRef.current = false;
          } else if (isNearBottomRef.current) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
            setShowScrollBottomPill(false);
          } else {
            setShowScrollBottomPill(true);
          }
        }, 50);

        // Mark read when actively viewing conversation
        markConversationAsRead(conversation.id, currentUser.uid);
      },
      (err) => {
        console.error("Messages subscription failed:", err);
        setSendError(formatMessagingError(err));
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [conversation.id, currentUser.uid]);

  // Handle scroll events to detect if user is near bottom
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const threshold = 120;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceFromBottom <= threshold;
    isNearBottomRef.current = nearBottom;

    if (nearBottom) {
      setShowScrollBottomPill(false);
    }
  };

  const scrollToBottom = () => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      setShowScrollBottomPill(false);
    }
  };

  // Load older messages via cursor pagination
  const handleLoadOlder = async () => {
    const cursor = oldestCursorRef.current;
    if (!cursor || loadingOlder || !hasMoreOlder) return;

    const container = scrollContainerRef.current;
    if (container) {
      prevScrollHeightRef.current = container.scrollHeight;
      prevScrollTopRef.current = container.scrollTop;
    }

    setLoadingOlder(true);
    try {
      const { messages: olderBatch, oldestDoc: nextOldest, hasMore } = await loadOlderMessages(
        conversation.id,
        cursor,
        30
      );

      setOlderMessages((prev) => [...olderBatch, ...prev]);
      oldestCursorRef.current = nextOldest;
      setHasMoreOlder(hasMore);

      // Preserve scroll position without jumping
      requestAnimationFrame(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight;
          const heightDiff = newScrollHeight - prevScrollHeightRef.current;
          container.scrollTop = prevScrollTopRef.current + heightDiff;
        }
      });
    } catch (err) {
      console.error("Failed to load older messages:", err);
      setSendError(formatMessagingError(err));
    } finally {
      setLoadingOlder(false);
    }
  };

  // Local typing expiration trick
  useEffect(() => {
    const activeTyping = conversation.typing && conversation.typing[otherUid];
    if (activeTyping) {
      const now = Date.now();
      const typingTime = typeof activeTyping === 'number' ? activeTyping : (activeTyping as any).toMillis?.() || now;
      const elapsed = now - typingTime;
      if (elapsed < 10000) {
        // Not expired yet, set a timeout to re-render when it expires
        const remaining = 10000 - elapsed;
        const t = setTimeout(() => setTick(n => n + 1), remaining);
        return () => clearTimeout(t);
      }
    }
  }, [conversation.typing, otherUid]);

  // Handle typing input
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    
    if (!canSend) return;

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      updateTypingStatus(conversation.id, currentUser.uid, true).catch(() => {});
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      updateTypingStatus(conversation.id, currentUser.uid, false).catch(() => {});
    }, 3000);
  };

  // Send message handler
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const textToSend = inputText.trim();

    if ((!textToSend && !selectedImage) || sending || isBlocked || otherProfile.isDeleted) return;
    if (textToSend.length > 4000) {
      setSendError("Message cannot exceed 4,000 characters.");
      return;
    }

    setSending(true);
    setSendError(null);
    
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    isTypingRef.current = false;
    updateTypingStatus(conversation.id, currentUser.uid, false).catch(() => {});

    try {
      let imageUrl = undefined;
      let storagePath = undefined;
      
      if (selectedImage) {
        if (isViewOnce) {
          const result = await uploadViewOnceImage(conversation.id, currentUser.uid, selectedImage);
          storagePath = result.path;
        } else {
          const result = await uploadMessageImage(conversation.id, currentUser.uid, selectedImage);
          imageUrl = result.url;
          storagePath = result.path;
        }
      }

      try {
        await sendDirectMessage(
          conversation.id,
          currentUser.uid,
          otherUid,
          textToSend,
          imageUrl,
          replyingTo?.id,
          isViewOnce && selectedImage ? 'view_once_image' : 'text',
          isViewOnce && selectedImage ? storagePath : undefined
        );
      } catch (sendErr) {
        if (storagePath) {
          await deleteMessageImage(storagePath);
        }
        throw sendErr;
      }

      setInputText('');
      setSelectedImage(null);
      setIsViewOnce(false);
      setReplyingTo(null);
      
      // Force scroll to bottom on own send
      setTimeout(() => {
        scrollToBottom();
      }, 50);
    } catch (err: any) {
      console.error("Send message error:", err);
      setSendError(formatMessagingError(err));
    } finally {
      setSending(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(file.type)) {
        setSendError("Only JPEG, PNG, WEBP, and GIF images are allowed.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setSendError("Image must be under 5MB.");
        return;
      }
      setSelectedImage(file);
    }
  };

  // Keydown handler: Enter to send, Shift+Enter for newline
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Formatting helpers
  const formatTime = (ts: any) => {
    if (!ts) return '';
    const date = typeof ts === 'number' ? new Date(ts) : typeof ts.toDate === 'function' ? ts.toDate() : new Date();
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleAcceptRequest = async () => {
    setProcessingRequest(true);
    setSendError(null);
    try {
      await acceptMessageRequest(conversation.id);
    } catch (err) {
      console.error("Accept error:", err);
      setSendError(formatMessagingError(err));
      setProcessingRequest(false);
    }
  };

  const handleDeclineRequest = async () => {
    setProcessingRequest(true);
    setSendError(null);
    try {
      await declineMessageRequest(conversation.id);
      if (onBack) onBack();
    } catch (err) {
      console.error("Decline error:", err);
      setSendError(formatMessagingError(err));
      setProcessingRequest(false);
    }
  };

  const handleToggleReaction = async (msgId: string, emoji: string) => {
    setActiveReactionMenu(null);
    try {
      await toggleReaction(conversation.id, msgId, currentUser.uid, emoji);
    } catch (err) {
      console.error("Error toggling reaction:", err);
      setSendError(formatMessagingError(err));
    }
  };

  const formatDateDivider = (ts: any) => {
    if (!ts) return '';
    const date = typeof ts === 'number' ? new Date(ts) : typeof ts.toDate === 'function' ? ts.toDate() : new Date();
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return date.toLocaleDateString([], { 
      month: 'short', 
      day: 'numeric', 
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined 
    });
  };

  return (
    <div id="chat-view-container" className="flex flex-col h-full bg-slate-50/50 relative overflow-hidden">
      {/* Top Header */}
      <div className="h-15 px-4 bg-white border-b border-slate-200/80 flex items-center justify-between shrink-0 shadow-xs z-20">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1.5 -ml-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-full transition"
              title="Back to conversations"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          <div 
            onClick={() => {
              if (!otherProfile.isDeleted) {
                onViewProfile(otherProfile.username);
              }
            }}
            className={`flex items-center gap-2.5 min-w-0 ${!otherProfile.isDeleted ? 'cursor-pointer group' : 'cursor-default'}`}
          >
            <img
              src={otherProfile.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${otherProfile.username}`}
              alt={otherProfile.displayName}
              className="w-9 h-9 rounded-full object-cover ring-1 ring-slate-200 shrink-0 group-hover:scale-105 transition"
            />
            <div className="min-w-0">
              <h3 className={`text-xs font-bold leading-tight truncate transition ${
                otherProfile.isDeleted ? 'text-slate-500 italic' : 'text-slate-900 group-hover:text-blue-600'
              }`}>
                {otherProfile.displayName}
              </h3>
              <p className="text-[11px] text-slate-400 leading-none truncate mt-0.5">
                {otherProfile.isDeleted ? 'Account Deleted' : `@${otherProfile.username}`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Messages Scroll Container */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3 relative"
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full py-16 text-slate-400 text-xs">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600 mb-2" />
            <span>Loading conversation...</span>
          </div>
        ) : (
          <>
            {/* Load older messages button */}
            {hasMoreOlder && (
              <div className="text-center py-2">
                <button
                  type="button"
                  onClick={handleLoadOlder}
                  disabled={loadingOlder}
                  className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200/80 rounded-full text-[11px] font-semibold text-slate-600 shadow-2xs transition active:scale-95 flex items-center gap-1.5 mx-auto"
                >
                  {loadingOlder && <Loader2 className="w-3 h-3 animate-spin text-blue-600" />}
                  <span>{loadingOlder ? 'Loading older messages...' : 'Load older messages'}</span>
                </button>
              </div>
            )}

            {/* Empty conversation prompt */}
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-20 text-center px-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-slate-800">No messages yet</h4>
                <p className="text-xs text-slate-500 max-w-xs mt-1">
                  {otherProfile.isDeleted 
                    ? 'This user account is no longer active.'
                    : `Send the first message to say hello to ${otherProfile.displayName}!`}
                </p>
              </div>
            ) : (
              messages.map((msg, index) => {
                const isMe = msg.senderId === currentUser.uid;
                const prevMsg = index > 0 ? messages[index - 1] : null;

                // Check if day changed between messages
                const showDateDivider = 
                  !prevMsg || 
                  formatDateDivider(msg.createdAt) !== formatDateDivider(prevMsg.createdAt);

                const isLastMessage = index === messages.length - 1;

                return (
                  <React.Fragment key={msg.id}>
                    {showDateDivider && (
                      <div className="flex items-center justify-center my-3">
                        <span className="px-2.5 py-0.5 rounded-full bg-slate-200/70 text-[10px] font-semibold text-slate-600">
                          {formatDateDivider(msg.createdAt)}
                        </span>
                      </div>
                    )}

                    <div className="flex flex-col group relative w-full mb-1 min-w-0">
                      {msg.replyToMessageId && (
                        <div className={`text-[10px] text-slate-500 bg-slate-100 px-2 py-1 rounded-t-xl mb-[-4px] pb-2 max-w-[80%] min-w-0 truncate ${isMe ? 'self-end mr-2' : 'self-start ml-2'}`}>
                          Replying to {messages.find(m => m.id === msg.replyToMessageId)?.senderId === currentUser.uid ? 'you' : otherProfile.displayName}
                        </div>
                      )}
                      
                      <div className={`flex items-end gap-2 w-full min-w-0 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div className="relative max-w-[85%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] min-w-0">
                          <div
                            className={`text-[15px] break-words shadow-2xs leading-relaxed min-w-[2.5rem] ${
                              isMe
                                ? 'bg-blue-600 text-white rounded-2xl rounded-br-xs'
                                : 'bg-slate-100 text-slate-900 rounded-2xl rounded-bl-xs'
                            } ${((msg.imageUrl || msg.messageType === 'view_once_image') && !msg.text) ? 'p-1 bg-transparent border-0 shadow-none' : 'px-3.5 py-2'}`}
                            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                          >
                            {msg.messageType === 'view_once_image' && (
                              <ViewOnceMessage msg={msg} isMe={isMe} conversationId={conversation.id} currentUser={currentUser} />
                            )}
                            {msg.imageUrl && msg.messageType !== 'view_once_image' && (
                              <img src={msg.imageUrl} alt="Attached" className={`rounded-xl w-full max-w-[240px] object-cover ${msg.text ? 'mb-2' : ''}`} referrerPolicy="no-referrer" />
                            )}
                            {msg.text}
                          </div>
                          
                          {/* Display Reactions */}
                          {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                            <div className={`absolute -bottom-3 flex flex-wrap gap-1 ${isMe ? 'right-2 flex-row-reverse' : 'left-2'}`}>
                              {Object.entries(
                                Object.entries(msg.reactions).reduce((acc, [key, value]) => {
                                  if (Array.isArray(value)) {
                                    // V11 Legacy: key is emoji, value is array of UIDs
                                    if (!acc[key]) acc[key] = [];
                                    value.forEach(uid => {
                                      if (!acc[key].includes(uid)) acc[key].push(uid);
                                    });
                                  } else if (typeof value === 'string') {
                                    // V12: key is UID, value is emoji
                                    if (!acc[value]) acc[value] = [];
                                    if (!acc[value].includes(key)) acc[value].push(key);
                                  }
                                  return acc;
                                }, {} as Record<string, string[]>)
                              ).map(([emoji, users]) => {
                                return (
                                  <button
                                    key={emoji}
                                    onClick={() => handleToggleReaction(msg.id, emoji)}
                                    className={`px-1.5 py-0.5 rounded-full text-[10px] shadow-sm border ${users.includes(currentUser.uid) ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'} flex items-center gap-1 hover:scale-105 transition`}
                                  >
                                    <span>{emoji}</span>
                                    {users.length > 1 && <span className="text-slate-500">{users.length}</span>}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {!otherProfile.isDeleted && !isBlocked && (
                          <div className={`opacity-0 group-hover:opacity-100 transition flex items-center gap-1 shrink-0 relative ${isMe ? 'mr-1' : 'ml-1'}`}>
                            <button
                              onClick={() => setReplyingTo(msg)}
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition bg-white shadow-xs border border-slate-200/50"
                              title="Reply"
                            >
                              <Reply className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setActiveReactionMenu(activeReactionMenu === msg.id ? null : msg.id)}
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition bg-white shadow-xs border border-slate-200/50"
                              title="React"
                            >
                              <Smile className="w-3.5 h-3.5" />
                            </button>
                            
                            {/* Reaction Menu */}
                            {activeReactionMenu === msg.id && (
                              <div className={`absolute bottom-full mb-2 ${isMe ? 'right-0' : 'left-0'} bg-white border border-slate-200 shadow-lg rounded-full px-2 py-1 flex items-center gap-1 z-30 animate-in fade-in zoom-in-95 duration-100`}>
                                {['❤️', '😂', '👍', '😮', '😢'].map((emoji) => (
                                  <button
                                    key={emoji}
                                    onClick={() => handleToggleReaction(msg.id, emoji)}
                                    className={`p-1.5 hover:scale-125 transition-transform text-lg ${
                                      msg.reactions?.[currentUser.uid] === emoji || (Array.isArray(msg.reactions?.[emoji]) && (msg.reactions?.[emoji] as any as string[]).includes(currentUser.uid))
                                        ? 'bg-slate-100 rounded-full' 
                                        : ''
                                    }`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      
                      <div className={`flex items-center gap-1 px-1 ${msg.reactions && Object.keys(msg.reactions).length > 0 ? 'mt-4' : 'mt-1'} ${isMe ? 'self-end' : 'self-start'}`}>
                        <span className="text-[10px] text-slate-400">
                          {formatTime(msg.createdAt)}
                        </span>
                        {isMe && isLastMessage && conversation.unreadCount?.[otherUid] === 0 && (
                          <span className="text-[10px] text-slate-500 font-medium ml-1">
                            • Seen
                          </span>
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })
            )}
            
            {/* Typing indicator */}
            {conversation.typing?.[otherUid] && Date.now() - (conversation.typing[otherUid]?.toMillis?.() || Date.now()) < 10000 && (
              <div className="flex items-end mb-2">
                <div className="bg-slate-100 text-slate-500 px-3.5 py-2.5 rounded-2xl rounded-bl-xs text-[11px] font-medium inline-flex items-center gap-1.5">
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce"></span>
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating "New Message" pill when user is scrolled up */}
      {showScrollBottomPill && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-20 right-5 z-20 px-3 py-1.5 bg-slate-900/90 text-white hover:bg-slate-900 rounded-full shadow-lg text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 animate-in fade-in slide-in-from-bottom-2"
        >
          <span>New message</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Error alert */}
      {sendError && (
        <div className="mx-4 mb-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
          <span className="flex-1">{sendError}</span>
          <button 
            onClick={() => setSendError(null)}
            className="text-rose-500 hover:text-rose-800 text-xs font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Blocked or Deleted user state or composer */}
      {isBlocked ? (
        <div className="p-4 bg-slate-100 border-t border-slate-200 text-center shrink-0">
          <div className="flex items-center justify-center gap-2 text-slate-500 text-xs font-semibold">
            <Lock className="w-4 h-4 text-slate-400" />
            <span>You can't send messages to this user.</span>
          </div>
        </div>
      ) : otherProfile.isDeleted ? (
        <div className="p-4 bg-slate-100 border-t border-slate-200 text-center shrink-0">
          <div className="flex items-center justify-center gap-2 text-slate-500 text-xs font-semibold">
            <Lock className="w-4 h-4 text-slate-400" />
            <span>This user account has been deleted. You cannot send messages.</span>
          </div>
        </div>
      ) : isDeclined ? (
        <div className="p-4 bg-slate-100 border-t border-slate-200 text-center shrink-0">
          <div className="flex items-center justify-center gap-2 text-slate-500 text-xs font-semibold">
            <Lock className="w-4 h-4 text-slate-400" />
            <span>You can't send messages in this conversation.</span>
          </div>
        </div>
      ) : isPendingRequesterCompleted ? (
        <div className="p-4 bg-slate-100 border-t border-slate-200 text-center shrink-0">
          <div className="flex items-center justify-center gap-2 text-slate-500 text-xs font-semibold">
            <Lock className="w-4 h-4 text-slate-400" />
            <div className="flex flex-col text-slate-600 gap-1 text-[11px]">
               <strong className="text-sm">Message request sent</strong>
               <span>You'll be able to send more messages if {otherProfile.displayName} accepts your request.</span>
            </div>
          </div>
        </div>
      ) : conversation.status === 'pending' && conversation.requestedBy !== currentUser.uid ? (
        <div className="p-4 bg-white border-t border-slate-200/80 text-center shrink-0 z-10">
          <h4 className="text-sm font-bold text-slate-900 mb-1">Accept message request?</h4>
          <p className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
            If you accept, they will be able to message you directly. If you decline, they won't be notified.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleDeclineRequest}
              disabled={processingRequest}
              className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-full transition disabled:opacity-50"
            >
              Decline
            </button>
            <button
              onClick={handleAcceptRequest}
              disabled={processingRequest}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-full transition disabled:opacity-50 flex items-center gap-2"
            >
              {processingRequest && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Accept
            </button>
          </div>
        </div>
      ) : (
        <form 
          onSubmit={handleSendMessage}
          className="p-3 bg-white border-t border-slate-200/80 shrink-0 z-10 flex flex-col gap-2"
        >
          {replyingTo && (
            <div className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
              <div className="flex items-center gap-2 text-xs truncate">
                <Reply className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-semibold text-slate-700">
                  {replyingTo.senderId === currentUser.uid ? 'Replying to yourself' : `Replying to ${otherProfile.displayName}`}
                </span>
                <span className="text-slate-500 truncate">- {replyingTo.text || 'Image'}</span>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {selectedImage && (
            <div className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
              <div className="flex items-center gap-2 text-xs truncate">
                <ImageIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-semibold text-slate-700 truncate">
                  {selectedImage.name}
                </span>
                
                <div className="ml-2 pl-2 border-l border-slate-300 flex items-center gap-1.5 cursor-pointer" onClick={() => setIsViewOnce(!isViewOnce)}>
                  <input
                    type="checkbox"
                    checked={isViewOnce}
                    onChange={(e) => setIsViewOnce(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3 h-3 cursor-pointer"
                  />
                  <span className="text-slate-600 font-medium select-none text-[11px]">View Once</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          
          <div className="flex items-end gap-2 max-w-4xl mx-auto w-full">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition shrink-0"
              title="Attach image"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              ref={fileInputRef}
              onChange={handleImageSelect}
            />
            
            <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl p-1 focus-within:bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition">
              <textarea
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Write a message... (Enter to send)"
                rows={1}
                maxLength={4000}
                className="w-full px-3 py-2 bg-transparent text-xs text-slate-800 placeholder-slate-400 resize-none focus:outline-none max-h-32 min-h-[36px]"
              />
              {inputText.length > 3500 && (
                <div className="text-[10px] text-right text-slate-400 px-2 pb-1">
                  {4000 - inputText.length} characters left
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={(!inputText.trim() && !selectedImage) || sending}
              className={`p-2.5 rounded-xl flex items-center justify-center transition shrink-0 ${
                (inputText.trim() || selectedImage) && !sending
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs active:scale-95'
                  : 'bg-slate-100 text-slate-300 cursor-not-allowed'
              }`}
              title="Send message"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
