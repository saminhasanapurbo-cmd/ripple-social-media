import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { addComment, deleteComment, formatTime } from '../services/api';
import type { Post, Comment } from '../types';
import { X, Send, Trash2, MessageCircle, AlertCircle } from 'lucide-react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

interface CommentsModalProps {
  post: Post | null;
  onClose: () => void;
  onViewProfile: (username: string) => void;
}

export function CommentsModal({ post, onClose, onViewProfile }: CommentsModalProps) {
  const { userProfile, isBlockedWith } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!post) return;
    const q = query(
      collection(db, 'comments'),
      where('postId', '==', post.id),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: Comment[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...(doc.data() as Omit<Comment, 'id'>) });
      });
      setComments(items);
    }, (err) => {
      console.error("Comments error:", err);
    });

    return () => unsubscribe();
  }, [post?.id]);

  if (!post) return null;

  const isPostAuthorBlocked = isBlockedWith(post.authorId);
  const visibleComments = comments.filter(c => !isBlockedWith(c.authorId));

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !userProfile || isPostAuthorBlocked) return;
    setLoading(true);
    setError(null);
    try {
      await addComment({
        postId: post.id,
        postAuthorId: post.authorId,
        currentUser: userProfile,
        content: newComment.trim()
      });
      setNewComment('');
    } catch (err: any) {
      console.error(err);
      setError("Failed to add comment.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!userProfile) return;
    try {
      await deleteComment(commentId, post.id, userProfile.uid);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div id="comments-modal" className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col h-[85vh] sm:h-[650px] overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
            <MessageCircle className="w-5 h-5 text-teal-600" />
            <span>Comments ({visibleComments.length})</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Original Post Preview */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs text-slate-600 flex items-start gap-2.5">
          <span className="font-semibold text-slate-800 shrink-0">@{post.authorUsername}:</span>
          <p className="line-clamp-2 text-slate-700 italic">"{post.content}"</p>
        </div>

        {/* Comments List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {visibleComments.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              No comments yet. Start the conversation!
            </div>
          ) : (
            visibleComments.map((comment) => (
              <div key={comment.id} className="flex gap-3 group">
                <img
                  src={comment.authorPhotoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${comment.authorUsername}`}
                  alt={comment.authorDisplayName}
                  onClick={() => { onClose(); onViewProfile(comment.authorUsername); }}
                  className="w-8 h-8 rounded-full object-cover shrink-0 cursor-pointer"
                />
                <div className="flex-1 bg-slate-50 rounded-2xl p-3 border border-slate-100">
                  <div className="flex items-center justify-between">
                    <span 
                      onClick={() => { onClose(); onViewProfile(comment.authorUsername); }}
                      className="text-xs font-bold text-slate-900 cursor-pointer hover:text-teal-600 transition"
                    >
                      {comment.authorDisplayName} <span className="font-normal text-slate-400">@{comment.authorUsername}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400">{formatTime(comment.createdAt)}</span>
                      {userProfile?.uid === comment.authorId && (
                        <button
                          type="button"
                          onClick={() => handleDeleteComment(comment.id)}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 transition p-0.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-slate-700 whitespace-pre-wrap">{comment.content}</p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Comment Input */}
        {isPostAuthorBlocked ? (
          <div className="p-4 bg-slate-50 border-t border-slate-100 text-center text-xs text-slate-400 italic">
            Commenting is unavailable due to an active block.
          </div>
        ) : (
          <form onSubmit={handleAddComment} className="p-4 bg-white border-t border-slate-100 flex items-center gap-2">
            {userProfile && (
              <img
                src={userProfile.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${userProfile.username}`}
                alt={userProfile.displayName}
                className="w-8 h-8 rounded-full object-cover shrink-0"
              />
            )}
            <input
              id="new-comment-input"
              type="text"
              maxLength={280}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a thoughtful reply (max 280 chars)..."
              className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
            />
            <button
              id="new-comment-submit-btn"
              type="submit"
              disabled={loading || !newComment.trim()}
              className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        )}

      </div>
    </div>
  );
}
