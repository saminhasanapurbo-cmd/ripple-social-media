import React, { useState } from 'react';
import { Shield, ShieldCheck, Loader2 } from 'lucide-react';
import type { UserProfile, Post } from '../types';
import { createPostOrRipple } from '../services/api';

interface PostComposerProps {
  currentUser: UserProfile;
  parentPost?: Post | null;
  onPostCreated?: () => void;
}

export function PostComposer({ currentUser, parentPost, onPostCreated }: PostComposerProps) {
  const [content, setContent] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const characterLimit = 400;
  const remainingChars = characterLimit - content.length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) {
      setError("Write something to start the wave.");
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
        author: currentUser,
        content: trimmed,
        parentPost: parentPost || null,
        isAnonymous
      });

      setContent('');
      setIsAnonymous(false);
      setIsFocused(false);
      if (onPostCreated) onPostCreated();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to post. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-3.5 sm:p-4 mb-3 transition">
      <form onSubmit={handleSubmit}>
        <div className="flex gap-3">
          {/* Avatar / Anon state */}
          <div className="shrink-0 pt-0.5">
            {isAnonymous ? (
              <div 
                className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 ring-1 ring-slate-200"
                title="Anonymous Mode"
              >
                <Shield className="w-5 h-5" />
              </div>
            ) : (
              <img
                src={currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${currentUser.username}`}
                alt={currentUser.displayName}
                className="w-10 h-10 rounded-full object-cover ring-1 ring-slate-200"
              />
            )}
          </div>

          {/* Input Area */}
          <div className="flex-1 min-w-0">
            <textarea
              rows={isFocused || content.length > 0 ? 3 : 2}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onFocus={() => setIsFocused(true)}
              placeholder="What's happening in your wave?"
              maxLength={characterLimit}
              className="w-full text-sm text-slate-900 placeholder-slate-400 bg-transparent border-0 focus:outline-none focus:ring-0 resize-none leading-relaxed p-0 pt-1"
            />

            {/* Error Message */}
            {error && (
              <div className="mt-2 text-xs text-rose-600 bg-rose-50 px-2.5 py-1.5 rounded-lg">
                {error}
              </div>
            )}

            {/* Bottom Controls Bar */}
            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100">
              <div className="flex items-center gap-2">
                {/* Anonymous Toggle */}
                <button
                  type="button"
                  onClick={() => setIsAnonymous(!isAnonymous)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                    isAnonymous
                      ? 'bg-slate-800 text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
                  }`}
                  title="Toggle anonymous posting"
                >
                  {isAnonymous ? (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Posting anonymously</span>
                    </>
                  ) : (
                    <>
                      <Shield className="w-3.5 h-3.5 text-slate-400" />
                      <span>Anonymous</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-3">
                {/* Character Counter */}
                {(isFocused || content.length > 0) && (
                  <span className={`text-[11px] font-mono ${remainingChars < 30 ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>
                    {remainingChars}
                  </span>
                )}

                {/* Submit Post Button */}
                <button
                  type="submit"
                  disabled={loading || !content.trim()}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition shadow-xs flex items-center gap-1.5 active:scale-95"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Posting...</span>
                    </>
                  ) : (
                    <span>Post</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
