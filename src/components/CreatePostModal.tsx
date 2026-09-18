import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { createPostOrRipple } from '../services/api';
import type { Post } from '../types';
import { X, Send, Waves, AlertCircle, User } from 'lucide-react';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentPost?: Post | null;
  onSuccess?: () => void;
}

export function CreatePostModal({ isOpen, onClose, parentPost, onSuccess }: CreatePostModalProps) {
  const { userProfile, isBlockedWith } = useAuth();
  const [content, setContent] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !userProfile) return null;

  const characterLimit = 400;
  const isParentBlocked = parentPost ? isBlockedWith(parentPost.authorId) : false;

  const handlePublish = async () => {
    const trimmed = content.trim();
    if (isParentBlocked) {
      setError("Cannot continue a Ripple from this post due to an active block.");
      return;
    }
    if (!trimmed) {
      setError("Please write something to share.");
      return;
    }
    if (trimmed.length > characterLimit) {
      setError(`Post exceeds ${characterLimit} characters limit.`);
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await createPostOrRipple({
        author: userProfile,
        content: trimmed,
        parentPost: parentPost || null,
        isAnonymous
      });

      setContent('');
      setIsAnonymous(false);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to post. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="create-post-modal" className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            {parentPost ? (
              <div className="flex items-center gap-1.5 text-blue-600 font-bold text-sm">
                <Waves className="w-4 h-4" />
                <span>Continue the Ripple</span>
              </div>
            ) : (
              <h3 className="font-extrabold text-slate-900 text-base">New Ripple Post</h3>
            )}
          </div>
          <button
            id="create-modal-close"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Replying Context Banner if continuing Ripple */}
        {parentPost && (
          <div className="px-5 py-3 bg-blue-50/70 border-b border-blue-100 text-xs text-slate-600 flex items-start gap-2.5">
            <span className="shrink-0 font-bold text-blue-700 mt-0.5">Responding to @{parentPost.authorUsername}:</span>
            <p className="line-clamp-2 italic text-slate-700">"{parentPost.content}"</p>
          </div>
        )}

        {/* Composer Area */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-full shrink-0 ring-2 ring-slate-100 overflow-hidden bg-slate-100 flex items-center justify-center text-slate-400">
              {isAnonymous ? (
                <User className="w-6 h-6" />
              ) : (
                <img
                  src={userProfile.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${userProfile.username}`}
                  alt={userProfile.displayName}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            <div className="flex-1">
              <div className="text-xs font-bold text-slate-800">
                {isAnonymous ? 'Anonymous' : userProfile.displayName} 
                {!isAnonymous && <span className="font-normal text-slate-400 ml-1">@{userProfile.username}</span>}
              </div>
              <textarea
                id="post-composer-textarea"
                autoFocus
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={characterLimit}
                placeholder={parentPost ? "Add your ripple to this thought..." : "What meaningful idea are you starting today?"}
                rows={4}
                className="w-full mt-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none resize-none bg-transparent"
              />
              
              <div className="mt-3 flex items-start gap-2">
                <input 
                  type="checkbox" 
                  id="anonymous-post" 
                  checked={isAnonymous}
                  onChange={(e) => setIsAnonymous(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div className="flex-1">
                  <label htmlFor="anonymous-post" className="text-sm font-semibold text-slate-700 cursor-pointer">
                    Post anonymously
                  </label>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                    Other Ripple users won't see which account posted this. Ripple retains limited private ownership data for moderation and account controls.
                  </p>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <div>
            <span className={`text-xs ${content.length > characterLimit - 20 ? 'text-amber-600 font-bold' : 'text-slate-400'}`}>
              {characterLimit - content.length} left
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="composer-cancel-btn"
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 rounded-xl transition"
            >
              Cancel
            </button>
            <button
              id="composer-publish-btn"
              type="button"
              disabled={loading || !content.trim()}
              onClick={handlePublish}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition flex items-center gap-1.5 disabled:opacity-40"
            >
              {loading ? (
                <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>{parentPost ? 'Ripple' : 'Post'}</span>
                  <Send className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
