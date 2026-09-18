import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { toggleLike, deletePostSecure, reportItem, blockUser, formatTime, recordPostView } from '../services/api';
import type { Post } from '../types';
import { 
  Heart, 
  MessageCircle, 
  Waves, 
  CornerDownRight, 
  MoreVertical, 
  Flag, 
  Trash2, 
  Eye, 
  UserX,
  X,
  AlertCircle,
  Shield,
  Loader2
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { doc, onSnapshot, collection, query, where, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface PostCardProps {
  key?: React.Key;
  post: Post;
  onOpenRippleChain: (post: Post) => void;
  onContinueRipple: (post: Post) => void;
  onOpenComments: (post: Post) => void;
  onViewProfile: (username: string) => void;
  onDeleted?: (postId: string) => void;
}

export const PostCard = React.memo(function PostCard({
  post,
  onOpenRippleChain,
  onContinueRipple,
  onOpenComments,
  onViewProfile,
  onDeleted
}: PostCardProps) {
  const { userProfile, isBlockedWith } = useAuth();
  const [likesCount, setLikesCount] = useState(post.likesCount || 0);
  const [commentsCount, setCommentsCount] = useState(post.commentsCount || 0);
  const [ripplesCount, setRipplesCount] = useState(post.ripplesCount || 0);
  const [isLiked, setIsLiked] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAnonOwner, setIsAnonOwner] = useState(false);

  useEffect(() => {
    if (post.anonymous && userProfile?.uid && post.authorId === 'anonymous') {
      getDoc(doc(db, 'postOwners', post.id)).then(snap => {
        if (snap.exists() && snap.data().ownerId === userProfile.uid) {
          setIsAnonOwner(true);
        }
      }).catch(() => {
        // Expected permission denied if not owner
      });
    }
  }, [post.id, post.anonymous, userProfile?.uid]);

  const isOwner = userProfile?.uid === post.authorId || isAnonOwner;
  const cardRef = useRef<HTMLElement>(null);
  const hasRecordedView = useRef(false);

  useEffect(() => {
    if (isOwner) return;
    if (hasRecordedView.current) return;
    
    let timer: any = null;
    
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.intersectionRatio >= 0.5 && !hasRecordedView.current) {
          if (!timer) {
            timer = setTimeout(() => {
              hasRecordedView.current = true;
              recordPostView(post.id).catch(console.error);
            }, 1000);
          }
        } else {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        }
      },
      { threshold: 0.5 }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => {
      observer.disconnect();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [post.id, isOwner]);

  const isBlocked = isBlockedWith(post.authorId);

  // In-app dialog states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('Spam');
  const [reportDetails, setReportDetails] = useState('');
  const [reportStatus, setReportStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [reportError, setReportError] = useState('');

  // Check if current user has liked
  useEffect(() => {
    if (!userProfile) return;
    const likeDocId = `${post.id}_${userProfile.uid}`;
    const unsub = onSnapshot(doc(db, 'likes', likeDocId), (docSnap) => {
      setIsLiked(docSnap.exists());
    });
    return () => unsub();
  }, [post.id, userProfile?.uid]);

  // Live counts from collections
  useEffect(() => {
    const q = query(collection(db, 'likes'), where('postId', '==', post.id));
    const unsub = onSnapshot(q, (snap) => {
      setLikesCount(snap.size);
    }, (err) => {
      console.warn("Likes count listener error:", err.message);
    });
    return () => unsub();
  }, [post.id]);

  useEffect(() => {
    const q = query(collection(db, 'comments'), where('postId', '==', post.id));
    const unsub = onSnapshot(q, (snap) => {
      setCommentsCount(snap.size);
    }, (err) => {
      console.warn("Comments count listener error:", err.message);
    });
    return () => unsub();
  }, [post.id]);

  useEffect(() => {
    const q = query(collection(db, 'posts'), where('parentPostId', '==', post.id));
    const unsub = onSnapshot(q, (snap) => {
      setRipplesCount(snap.size);
    }, (err) => {
      console.warn("Ripples count listener error:", err.message);
    });
    return () => unsub();
  }, [post.id]);

  const handleLike = async () => {
    if (!userProfile || isBlocked) return;
    try {
      const nowLiked = await toggleLike(post.id, userProfile, post.authorId);
      setIsLiked(nowLiked);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async () => {
    if (!userProfile || !isOwner) return;
    setIsDeleting(true);
    setShowDeleteModal(false);
    try {
      await deletePostSecure(post.id);
      if (onDeleted) onDeleted(post.id);
    } catch (err) {
      console.error("Delete post error:", err);
      setIsDeleting(false);
    }
  };

  const handleBlock = async () => {
    if (!userProfile) return;
    setShowBlockModal(false);
    try {
      if (post.authorId === 'anonymous' || post.anonymous) {
        const blockAnonFn = httpsCallable<any, { success: boolean }>(functions, 'blockAnonymousPostOwner');
        await blockAnonFn({ postId: post.id });
      } else {
        await blockUser(userProfile.uid, post.authorId);
      }
      if (onDeleted) onDeleted(post.id);
    } catch (err) {
      console.error("Block user error:", err);
    }
  };

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    setReportStatus('submitting');
    try {
      await reportItem({
        reporterId: userProfile.uid,
        targetType: 'post',
        targetId: post.id,
        reason: reportReason,
        details: reportDetails
      });
      setReportStatus('done');
      setTimeout(() => {
        setShowReportModal(false);
        setReportStatus('idle');
        setReportDetails('');
      }, 1500);
    } catch (err: any) {
      console.error("Report error:", err);
      setReportStatus('error');
      setReportError(err.message || "Failed to submit report");
    }
  };

  if (isDeleting) {
    return (
      <div className="p-4 bg-white rounded-2xl border border-slate-200/80 text-center text-xs text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
        Removing post...
      </div>
    );
  }

  const isAnonymous = post.anonymous === true;
  const isRemoved = post.moderationStatus === 'removed' || post.isDeleted;

  if (isRemoved) {
    return (
      <article className="bg-slate-50/80 rounded-2xl border border-slate-200/70 p-3.5 text-center my-2">
        <div className="flex items-center justify-center gap-2 text-slate-400 text-xs">
          <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="italic">This post was removed or deleted.</span>
        </div>
      </article>
    );
  }

  return (
    <article
      ref={cardRef}
      id={`post-${post.id}`}
      className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs hover:border-slate-300/80 p-4 sm:p-4.5 transition"
    >
      {/* Threaded Ripple Connection Indicator */}
      {post.parentPostId && (
        <div 
          onClick={() => onOpenRippleChain(post)}
          className="mb-2.5 flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 cursor-pointer transition w-fit group"
        >
          <CornerDownRight className="w-3.5 h-3.5 shrink-0 text-blue-500 group-hover:translate-x-0.5 transition-transform" />
          <span>
            Rippled from <strong className="font-semibold text-slate-700">
              {post.parentAuthorUsername === 'anonymous' ? 'Anonymous' : `@${post.parentAuthorUsername || 'author'}`}
            </strong>
          </span>
        </div>
      )}

      {/* Post Header: Avatar, Names, Time, Overflow Menu */}
      <div className="flex items-start justify-between gap-2">
        <div 
          onClick={() => !isAnonymous && onViewProfile(post.authorUsername)}
          className={`flex items-center gap-3 min-w-0 ${!isAnonymous ? 'cursor-pointer group' : ''}`}
        >
          {isAnonymous ? (
            <div 
              className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center ring-1 ring-slate-200 text-slate-500 shrink-0"
              title="Anonymous Member"
            >
              <Shield className="w-5 h-5" />
            </div>
          ) : (
            <img
              src={post.authorPhotoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${post.authorUsername}`}
              alt={post.authorDisplayName}
              className="w-10 h-10 rounded-full object-cover ring-1 ring-slate-200/80 group-hover:ring-blue-400 transition shrink-0"
            />
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-sm font-bold text-slate-900 truncate ${!isAnonymous ? 'group-hover:text-blue-600 transition' : ''}`}>
                {isAnonymous ? 'Anonymous' : post.authorDisplayName}
              </span>
              {isAnonymous && (
                <span className="px-1.5 py-0.2 text-[10px] font-semibold bg-slate-100 text-slate-600 rounded-md border border-slate-200">
                  Protected
                </span>
              )}
            </div>
            <div className="text-[12px] text-slate-500 truncate">
              {isAnonymous ? (
                formatTime(post.createdAt)
              ) : (
                <>@{post.authorUsername} · {formatTime(post.createdAt)}</>
              )}
            </div>
          </div>
        </div>

        {/* Options Menu Button */}
        <div className="relative shrink-0">
          <button
            id={`post-menu-btn-${post.id}`}
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition"
            aria-label="Post options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMenu && (
            <div 
              id={`post-menu-dropdown-${post.id}`}
              className="absolute right-0 top-7 z-20 w-44 bg-white rounded-2xl shadow-xl border border-slate-200/90 py-1 text-xs text-slate-700 animate-in fade-in duration-100"
            >
              {isOwner ? (
                <button
                  type="button"
                  onClick={() => { setShowMenu(false); setShowDeleteModal(true); }}
                  className="w-full text-left px-3 py-2 text-rose-600 hover:bg-rose-50 flex items-center gap-2 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Post</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => { setShowMenu(false); setShowReportModal(true); }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 transition"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    <span>Report Post</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowMenu(false); setShowBlockModal(true); }}
                    className="w-full text-left px-3 py-2 text-rose-600 hover:bg-rose-50 flex items-center gap-2 transition"
                  >
                    <UserX className="w-3.5 h-3.5" />
                    <span>{isAnonymous ? 'Block this account' : `Block @${post.authorUsername}`}</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Post Body Content with Proper Wrapping */}
      <div className="mt-3 text-[15px] text-slate-900 leading-[1.55] whitespace-pre-wrap break-words [overflow-wrap:anywhere] select-text">
        {post.content}
      </div>

      {/* Attached Image (Instagram-quality responsive container) */}
      {post.imageUrl && (
        <div className="mt-3 rounded-2xl overflow-hidden border border-slate-200/80 bg-slate-100 max-h-[480px] flex items-center justify-center">
          <img
            src={post.imageUrl}
            alt="Attached content"
            className="w-full max-h-[480px] object-cover hover:brightness-[0.98] transition cursor-pointer"
            loading="lazy"
          />
        </div>
      )}

      {/* Action Bar: Comment, Ripple, Like, Views (Single Eye icon) */}
      <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-1 sm:gap-2">
          {/* 1. Comment Action */}
          <button
            id={`post-comments-btn-${post.id}`}
            type="button"
            disabled={isBlocked}
            onClick={() => {
              if (isBlocked) return;
              onOpenComments(post);
            }}
            className={`flex items-center gap-1.5 py-1.5 px-2.5 rounded-xl transition ${
              isBlocked
                ? 'opacity-40 cursor-not-allowed text-slate-300'
                : 'hover:text-blue-600 hover:bg-blue-50/70 text-slate-500'
            }`}
            title={isBlocked ? "Interaction blocked" : "Comments"}
          >
            <MessageCircle className="w-4 h-4 stroke-[1.8]" />
            <span className="font-semibold text-xs">{commentsCount}</span>
          </button>

          {/* 2. Signature Ripple Actions (Wave Chain + Ripple continue) */}
          <button
            id={`post-view-chain-btn-${post.id}`}
            type="button"
            disabled={isBlocked}
            onClick={() => {
              if (isBlocked) return;
              onOpenRippleChain(post);
            }}
            className={`flex items-center gap-1.5 py-1.5 px-2.5 rounded-xl font-semibold transition ${
              isBlocked
                ? 'opacity-40 cursor-not-allowed text-slate-300 bg-slate-50'
                : 'text-blue-600 hover:bg-blue-50/80'
            }`}
            title={isBlocked ? "Interaction blocked" : "View Ripple wave"}
          >
            <Waves className="w-4 h-4 text-blue-600" />
            <span className="text-xs">{ripplesCount > 0 ? ripplesCount : '0'}</span>
          </button>

          <button
            id={`post-continue-ripple-btn-${post.id}`}
            type="button"
            disabled={isBlocked}
            onClick={() => {
              if (isBlocked) return;
              onContinueRipple(post);
            }}
            className={`flex items-center gap-1.5 py-1 px-2.5 rounded-xl font-bold transition text-xs ${
              isBlocked
                ? 'opacity-40 cursor-not-allowed bg-slate-200 text-slate-400'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white active:scale-95'
            }`}
            title={isBlocked ? "Interaction blocked" : "Continue the Ripple"}
          >
            <Waves className="w-3.5 h-3.5" />
            <span>Ripple</span>
          </button>

          {/* 3. Like Action */}
          <button
            id={`post-like-btn-${post.id}`}
            type="button"
            disabled={isBlocked}
            onClick={handleLike}
            className={`flex items-center gap-1.5 py-1.5 px-2.5 rounded-xl transition ${
              isBlocked
                ? 'opacity-40 cursor-not-allowed text-slate-300'
                : isLiked
                ? 'text-rose-600 font-bold bg-rose-50/80'
                : 'hover:text-rose-600 hover:bg-rose-50/60 text-slate-500'
            }`}
            title={isBlocked ? "Interaction blocked" : "Like"}
          >
            <Heart className={`w-4 h-4 ${isLiked ? 'fill-rose-500 text-rose-500' : 'stroke-[1.8]'}`} />
            <span className="font-semibold text-xs">{likesCount}</span>
          </button>
        </div>

        {/* 4. Single Views Count Indicator (Single Eye Icon) */}
        <div 
          className="flex items-center gap-1.5 py-1 px-2 text-slate-400 text-xs font-medium"
          title={`${post.viewCount || 0} views`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>{post.viewCount || 0}</span>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-100">
            <h3 className="font-extrabold text-slate-900 text-base">Delete post?</h3>
            <p className="text-xs text-slate-500 mt-1.5">
              This will permanently remove this post and all its replies from the Ripple network.
            </p>
            <div className="flex gap-2.5 mt-5">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition shadow-xs"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block Confirmation Modal */}
      {showBlockModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-100">
            <h3 className="font-extrabold text-slate-900 text-base">
              Block {isAnonymous ? 'this user' : `@${post.authorUsername}`}?
            </h3>
            <p className="text-xs text-slate-500 mt-1.5">
              They won't be able to view your posts, message you, or see your activity.
            </p>
            <div className="flex gap-2.5 mt-5">
              <button
                type="button"
                onClick={() => setShowBlockModal(false)}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBlock}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition shadow-xs"
              >
                Block
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-extrabold text-slate-900 text-base">Report Post</h3>
              <button 
                type="button" 
                onClick={() => setShowReportModal(false)} 
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {reportStatus === 'done' ? (
              <div className="py-6 text-center text-emerald-600 text-xs font-bold">
                Thank you. Report received for safety review.
              </div>
            ) : (
              <form onSubmit={handleReport} className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Reason</label>
                  <select
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="Spam">Spam or unwanted advertising</option>
                    <option value="Harassment">Harassment or bullying</option>
                    <option value="Hate Speech">Hate speech or discrimination</option>
                    <option value="Violence">Violence or threats</option>
                    <option value="Misinformation">Misinformation</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Details (Optional)</label>
                  <textarea
                    rows={2}
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    placeholder="Provide any additional context..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                  />
                </div>
                {reportError && (
                  <p className="text-xs text-rose-500">{reportError}</p>
                )}
                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowReportModal(false)}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={reportStatus === 'submitting'}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 transition shadow-xs"
                  >
                    {reportStatus === 'submitting' ? 'Submitting...' : 'Submit Report'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </article>
  );
});
