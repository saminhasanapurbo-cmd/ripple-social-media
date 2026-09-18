import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import type { Post } from '../types';
import { PostCard } from './PostCard';
import { X, Waves, GitBranch, ArrowLeft, Plus } from 'lucide-react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getTimestampMillis } from '../services/api';

interface RippleChainViewProps {
  post: Post;
  onClose: () => void;
  onContinueRipple: (post: Post) => void;
  onOpenComments: (post: Post) => void;
  onViewProfile: (username: string) => void;
}

export function RippleChainView({
  post,
  onClose,
  onContinueRipple,
  onOpenComments,
  onViewProfile
}: RippleChainViewProps) {
  const { isBlockedWith } = useAuth();
  const [chainPosts, setChainPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  // Load the root post and all downstream ripples connected to this branch
  useEffect(() => {
    async function loadFullRippleChain() {
      setLoading(true);
      try {
        const rootId = post.rootPostId || post.id;
        const postsList: Post[] = [];

        // 1. Fetch Root post
        const rootDoc = await getDoc(doc(db, 'posts', rootId));
        if (rootDoc.exists()) {
          postsList.push({ id: rootDoc.id, ...(rootDoc.data() as Omit<Post, 'id'>) });
        } else if (post.id === rootId) {
          postsList.push(post);
        }

        // 2. Fetch all child posts that have this rootPostId
        const qChild = query(
          collection(db, 'posts'),
          where('rootPostId', '==', rootId)
        );
        const childSnap = await getDocs(qChild);
        childSnap.forEach((d) => {
          if (d.id !== rootId) {
            postsList.push({ id: d.id, ...(d.data() as Omit<Post, 'id'>) });
          }
        });

        // Also check if current post is a direct child of another without rootPostId set
        if (!postsList.some(p => p.id === post.id)) {
          postsList.push(post);
        }

        // Sort chronologically to show clear progression of the Ripple wave
        postsList.sort((a, b) => getTimestampMillis(a.createdAt) - getTimestampMillis(b.createdAt));
        setChainPosts(postsList);
      } catch (err) {
        console.error("Failed to load ripple chain:", err);
      } finally {
        setLoading(false);
      }
    }

    loadFullRippleChain();
  }, [post]);

  const visiblePosts = chainPosts.filter(p => !isBlockedWith(p.authorId));
  const latestUnblockedPost = [...visiblePosts].reverse().find(p => !isBlockedWith(p.authorId));

  return (
    <div id="ripple-chain-view" className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-xl bg-slate-50 sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col h-full sm:h-[90vh] overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-white border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="p-1 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
                <Waves className="w-4 h-4 text-blue-600" />
                <span>Ripple Wave Chain</span>
              </div>
              <span className="text-[11px] text-slate-400">
                {visiblePosts.length} connected post{visiblePosts.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          {latestUnblockedPost && (
            <button
              onClick={() => onContinueRipple(latestUnblockedPost)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add to Ripple</span>
            </button>
          )}
        </div>

        {/* Chain Content Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="py-20 text-center text-slate-400 text-sm">
              <span className="inline-block w-6 h-6 border-2 border-blue-500/40 border-t-blue-600 rounded-full animate-spin mb-2" />
              <div>Tracing Ripple chain...</div>
            </div>
          ) : visiblePosts.length === 0 ? (
            <div className="py-20 text-center text-slate-400 text-sm">
              No accessible posts in this Ripple chain.
            </div>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:left-3 before:top-4 before:bottom-4 before:w-0.5 before:bg-blue-200">
              {visiblePosts.map((chainPost, index) => {
                const isTarget = chainPost.id === post.id;
                const isRoot = index === 0;

                return (
                  <div key={chainPost.id} className="relative">
                    {/* Visual node on chain line */}
                    <div 
                      className={`absolute -left-6 top-5 w-6 h-6 rounded-full flex items-center justify-center -translate-x-1/2 border-2 ${
                        isTarget 
                          ? 'bg-blue-600 text-white border-white shadow-md' 
                          : isRoot 
                          ? 'bg-slate-800 text-white border-white' 
                          : 'bg-white text-blue-600 border-blue-400'
                      }`}
                    >
                      <Waves className="w-3 h-3" />
                    </div>

                    <div className={isTarget ? 'ring-2 ring-blue-500 rounded-2xl' : ''}>
                      <PostCard
                        post={chainPost}
                        onOpenRippleChain={() => {}}
                        onContinueRipple={onContinueRipple}
                        onOpenComments={onOpenComments}
                        onViewProfile={onViewProfile}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
