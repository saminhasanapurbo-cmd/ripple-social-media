import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from './context/AuthContext';
import { AuthModal } from './components/AuthModal';
import { ProfileSetupModal } from './components/ProfileSetupModal';
import { BottomNav } from './components/BottomNav';
import { DesktopSidebar } from './components/DesktopSidebar';
import { RightSidebar } from './components/RightSidebar';
import { PostComposer } from './components/PostComposer';
import { PostCard } from './components/PostCard';
import { PostSkeleton, FeedSkeletonList } from './components/PostSkeleton';
import { CreatePostModal } from './components/CreatePostModal';
import { CommentsModal } from './components/CommentsModal';
import { RippleChainView } from './components/RippleChainView';
import { ProfileView } from './components/ProfileView';
import { SearchView } from './components/SearchView';
import { NotificationsView } from './components/NotificationsView';
import { AdminView } from './components/AdminView';
import { MessagesView } from './components/MessagesView';
import { FeedDiagnosticModal } from './components/FeedDiagnosticModal';
import { subscribeToUserConversations } from './services/messaging';
import type { Post, UserProfile, Conversation } from './types';
import { Waves, Sparkles, Plus, Bell, RefreshCw, Shield, MessageCircle, Terminal } from 'lucide-react';
import { collection, query, orderBy, limit, onSnapshot, startAfter, getDocs, getDoc, doc, where } from 'firebase/firestore';
import { db, functions } from './firebase';
import { fetchFeedPosts } from './services/feed';

export const BUILD_ID = 'RIPPLE-V41-FEED-RESET';
if (typeof document !== 'undefined') {
  document.documentElement.dataset.rippleBuild = BUILD_ID;
  console.info('Ripple build:', BUILD_ID);
}

export default function App() {
  const { 
    currentUser, 
    userProfile, 
    authLoading,
    profileLoading,
    authError,
    profileError,
    needsProfileSetup,
    retryAuth,
    retryProfileLoad,
    isAdmin, 
    blockedUserIds,
    pendingReportsCount,
    isBlockedWith,
    logout
  } = useAuth();

  // Navigation & Views
  const [currentTab, setCurrentTab] = useState<'home' | 'search' | 'create' | 'messages' | 'notifications' | 'profile'>('home');
  const [activeProfileUsername, setActiveProfileUsername] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [initialMessageTarget, setInitialMessageTarget] = useState<UserProfile | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Feed & Posts State
  const [posts, setPosts] = useState<Post[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMorePosts, setHasMorePosts] = useState(true);
  const [lastFeedCursor, setLastFeedCursor] = useState<any>(null);
  const [feedError, setFeedError] = useState<string | null>(null);

  // Memoize visible posts to avoid filtering the array on every re-render
  const visiblePosts = useMemo(() => {
    if (!blockedUserIds || blockedUserIds.length === 0) return posts;
    const blockedSet = new Set(blockedUserIds);
    return posts.filter(p => !blockedSet.has(p.authorId));
  }, [posts, blockedUserIds]);

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [rippleParentPost, setRippleParentPost] = useState<Post | null>(null);
  const [selectedChainPost, setSelectedChainPost] = useState<Post | null>(null);
  const [selectedCommentsPost, setSelectedCommentsPost] = useState<Post | null>(null);

  // Unread Trackers & Conversations State (Shared across header unread badge and MessagesView)
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [lastConversationDoc, setLastConversationDoc] = useState<any>(null);
  const [conversationsError, setConversationsError] = useState<Error | null>(null);

  const fetchFeed = async () => {
    setFeedLoading(true);
    setFeedError(null);
    try {
      const result = await fetchFeedPosts({ limit: 20, viewerUid: currentUser?.uid });
      setPosts(result.posts || []);
      setLastFeedCursor(result.nextCursor || null);
      setHasMorePosts(!!result.hasMore);
    } catch (err: any) {
      console.warn("Feed fetch failure:", err);
      setFeedError(err?.message || 'FEED_FUNCTION_FAILED');
    } finally {
      setFeedLoading(false);
    }
  };

  // Real-time Chronological Feed (Pure Chronological, No algorithmic manipulation)
  useEffect(() => {
    if (!currentUser || needsProfileSetup || !userProfile) return;
    fetchFeed();
  }, [currentUser, needsProfileSetup, userProfile]);

  // Unread notifications tracker
  useEffect(() => {
    if (!userProfile) return;
    const q = query(
      collection(db, 'notifications'),
      where('recipientId', '==', userProfile.uid)
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      let count = 0;
      snap.forEach(d => {
        const data = d.data();
        if (!data.read && !blockedUserIds.includes(data.actorId)) {
          count++;
        }
      });
      setUnreadCount(count);
    });

    return () => unsubscribe();
  }, [userProfile?.uid, blockedUserIds]);

  // Unread messages & user conversations tracker (Single authoritative listener for badge + view)
  useEffect(() => {
    if (!userProfile?.uid) {
      setConversations([]);
      setUnreadMessagesCount(0);
      setLoadingConversations(false);
      return;
    }

    setLoadingConversations(true);
    setConversationsError(null);
    const unsubscribe = subscribeToUserConversations(
      userProfile.uid,
      40,
      (convs, lastDoc) => {
        setConversations(convs);
        setLastConversationDoc(lastDoc);
        setLoadingConversations(false);
        setConversationsError(null);
        let totalUnread = 0;
        convs.forEach((c) => {
          const count = c.unreadCount?.[userProfile.uid] || 0;
          totalUnread += count;
        });
        setUnreadMessagesCount(totalUnread);
      },
      (err) => {
        console.error("Conversations tracker error:", err);
        setConversationsError(err);
        setLoadingConversations(false);
      }
    );

    return () => unsubscribe();
  }, [userProfile?.uid]);

  // Handlers wrapped in useCallback to keep memoized feed list stable
  const handleOpenRippleChain = useCallback((post: Post) => {
    if (blockedUserIds.includes(post.authorId)) return;
    setSelectedChainPost(post);
  }, [blockedUserIds]);

  const handleContinueRipple = useCallback((post: Post) => {
    if (blockedUserIds.includes(post.authorId)) return;
    setRippleParentPost(post);
    setIsCreateOpen(true);
  }, [blockedUserIds]);

  const handleOpenComments = useCallback((post: Post) => {
    if (blockedUserIds.includes(post.authorId)) return;
    setSelectedCommentsPost(post);
  }, [blockedUserIds]);

  const handleViewProfile = useCallback((username: string) => {
    setActiveProfileUsername(username);
    setCurrentTab('profile');
    setShowAdmin(false);
  }, []);

  const handlePostDeleted = useCallback((id: string) => {
    setPosts(prev => prev.filter(p => p.id !== id));
  }, []);

  // Memoize the combined feed list to prevent redundant mapping and array re-allocation operations
  // during loadMorePosts or state updates that don't affect the raw posts data.
  const combinedFeedList = useMemo(() => {
    return visiblePosts.map((post) => (
      <PostCard
        key={post.id}
        post={post}
        onOpenRippleChain={handleOpenRippleChain}
        onContinueRipple={handleContinueRipple}
        onOpenComments={handleOpenComments}
        onViewProfile={handleViewProfile}
        onDeleted={handlePostDeleted}
      />
    ));
  }, [visiblePosts, handleOpenRippleChain, handleContinueRipple, handleOpenComments, handleViewProfile, handlePostDeleted]);
  
  const loadMorePosts = async () => {
    if (!hasMorePosts || loadingMore || !lastFeedCursor) return;
    setLoadingMore(true);
    try {
      const result = await fetchFeedPosts({ limit: 20, cursor: lastFeedCursor, viewerUid: currentUser?.uid });
      const newPosts = result.posts || [];
      setPosts(prev => {
        const map = new Map(prev.map(p => [p.id, p]));
        newPosts.forEach((p: Post) => map.set(p.id, p));
        return Array.from(map.values());
      });
      setLastFeedCursor(result.nextCursor || null);
      setHasMorePosts(!!result.hasMore);
    } catch (err: any) {
      console.warn("Load more feed fetch error:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleMessageUser = (targetUser: UserProfile) => {
    setInitialMessageTarget(targetUser);
    setCurrentTab('messages');
    setActiveProfileUsername(null);
    setShowAdmin(false);
  };

  const handleSelectPostFromNotification = async (postId: string) => {
    try {
      const postSnap = await getDoc(doc(db, 'posts', postId));
      if (postSnap.exists()) {
        const p = { id: postSnap.id, ...(postSnap.data() as Omit<Post, 'id'>) };
        if (!p.isDeleted && !blockedUserIds.includes(p.authorId)) {
          setSelectedCommentsPost(p);
        }
      }
    } catch (err) {
      console.error("Open notif post err:", err);
    }
  };

  // 1. Auth Loading Screen
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/20 animate-pulse mb-3">
          <Waves className="w-8 h-8" />
        </div>
        <div className="text-sm font-bold text-slate-700">Connecting to Ripple...</div>
        <span className="mt-3 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">v41</span>
      </div>
    );
  }

  // 2. Auth Error Screen
  if (authError) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-sm w-full">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center font-bold text-xl mx-auto mb-3">!</div>
          <h2 className="text-base font-extrabold text-slate-800 mb-1">Ripple couldn't connect</h2>
          <p className="text-xs text-slate-500 mb-2">We couldn't initialize your connection to the server.</p>
          <div className="inline-block font-mono text-[11px] bg-slate-100 text-slate-600 px-2 py-1 rounded-md mb-6">{authError}</div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => retryAuth()}
              className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs shadow-md shadow-blue-600/20 hover:bg-blue-700 transition cursor-pointer"
            >
              Retry
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold text-xs hover:bg-slate-200 transition cursor-pointer"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Not logged in -> Show Auth Modal
  if (!currentUser) {
    return <AuthModal />;
  }

  // 4. Profile Loading Screen
  if (profileLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/20 animate-pulse mb-3">
          <Waves className="w-8 h-8" />
        </div>
        <div className="text-sm font-bold text-slate-700">Loading your profile...</div>
        <span className="mt-3 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">v41</span>
      </div>
    );
  }

  // 5. Profile Load Error Screen (Distinct from missing profile)
  if (profileError) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-sm w-full">
          <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center font-bold text-xl mx-auto mb-3">!</div>
          <h2 className="text-base font-extrabold text-slate-800 mb-1">Couldn't load your Ripple profile</h2>
          <p className="text-xs text-slate-500 mb-2">There was an issue fetching your account information.</p>
          <div className="inline-block font-mono text-[11px] bg-slate-100 text-slate-600 px-2 py-1 rounded-md mb-6">{profileError}</div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => retryProfileLoad()}
              className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs shadow-md shadow-blue-600/20 hover:bg-blue-700 transition cursor-pointer"
            >
              Retry
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold text-xs hover:bg-slate-200 transition cursor-pointer"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 6. Confirmed missing profile -> Force initial profile setup
  if (needsProfileSetup) {
    return <ProfileSetupModal />;
  }

  // Fallback if profile not loaded yet
  if (!userProfile) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/20 animate-pulse mb-3">
          <Waves className="w-8 h-8" />
        </div>
        <div className="text-sm font-bold text-slate-700">Connecting to Ripple...</div>
        <span className="mt-3 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">v41</span>
      </div>
    );
  }

  return (
    <div id="ripple-app" className="min-h-screen bg-slate-50 text-slate-800 antialiased selection:bg-blue-100 selection:text-blue-900">
      
      {/* 3-Column Shell (Desktop: Sidebar - Feed - Sidebar; Mobile: Single column with BottomNav) */}
      <div className="max-w-[1280px] mx-auto min-h-screen flex justify-center">
        
        {/* Left Column: Desktop Navigation Sidebar */}
        <DesktopSidebar
          currentTab={currentTab}
          onSelectTab={(tab) => {
            if (tab === 'create') {
              setRippleParentPost(null);
              setIsCreateOpen(true);
            } else {
              setCurrentTab(tab);
              if (tab === 'profile') {
                setActiveProfileUsername(null);
              }
              setShowAdmin(false);
            }
          }}
          currentUser={userProfile}
          unreadNotificationsCount={unreadCount}
          unreadMessagesCount={unreadMessagesCount}
          isAdmin={isAdmin}
          pendingReportsCount={pendingReportsCount}
          onOpenAdmin={isAdmin ? () => setShowAdmin(true) : undefined}
          onOpenCreate={() => {
            setRippleParentPost(null);
            setIsCreateOpen(true);
          }}
          onLogout={logout}
        />

        {/* Center Column: Main Content & Feed */}
        <main className={`flex-1 min-w-0 min-h-screen flex flex-col bg-white border-r md:border-x border-slate-200/80 ${
          currentTab === 'messages' ? 'max-w-4xl' : 'max-w-[640px]'
        }`}>
          
          {/* Mobile-Only Top Header (< md) */}
          <header id="mobile-header" className="md:hidden sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 h-14 flex items-center justify-between">
            <div 
              onClick={() => { setCurrentTab('home'); setActiveProfileUsername(null); setShowAdmin(false); }}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition">
                <Waves className="w-4.5 h-4.5" />
              </div>
              <span className="font-extrabold text-base tracking-tight text-slate-900">Ripple</span>
              <span className="px-1.5 py-0.2 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">Beta</span>
              <span className="ml-1 text-[10px] text-slate-400 font-medium tracking-tight">v41</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="header-messages-btn"
                type="button"
                onClick={() => { setCurrentTab('messages'); setActiveProfileUsername(null); setShowAdmin(false); }}
                className={`flex items-center justify-center w-9 h-9 rounded-full relative transition ${
                  currentTab === 'messages'
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                }`}
                title="Messages"
              >
                <MessageCircle className="w-5 h-5" />
                {unreadMessagesCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-3.5 px-1 rounded-full bg-blue-600 text-white text-[8.5px] font-bold flex items-center justify-center ring-2 ring-white">
                    {unreadMessagesCount > 9 ? '9+' : unreadMessagesCount}
                  </span>
                )}
              </button>

              {isAdmin && (
                <button
                  id="header-admin-btn"
                  type="button"
                  onClick={() => setShowAdmin(true)}
                  className="flex items-center gap-1.5 py-1 px-2.5 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 text-xs font-bold transition active:scale-95 shadow-xs"
                  title="Admin Moderation Queue"
                >
                  <Shield className="w-3.5 h-3.5 text-amber-600" />
                  <span>Admin {pendingReportsCount > 0 ? `(${pendingReportsCount})` : ''}</span>
                </button>
              )}
              <button
                id="header-create-btn"
                type="button"
                onClick={() => { setRippleParentPost(null); setIsCreateOpen(true); }}
                className="flex items-center gap-1.5 py-1.5 px-3 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs shadow-blue-600/20 transition active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Post</span>
              </button>
            </div>
          </header>

          {/* Desktop-Only Center Header (>= md) - only on Home to avoid duplicate headers */}
          {currentTab === 'home' && !activeProfileUsername && !showAdmin && (
            <div className="hidden md:flex items-center justify-between px-4 h-14 sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-slate-100">
              <h1 className="text-base font-bold text-slate-900">Home</h1>
              <button
                type="button"
                onClick={fetchFeed}
                disabled={feedLoading}
                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition cursor-pointer"
                title="Refresh Feed"
              >
                <RefreshCw className={`w-4 h-4 ${feedLoading ? 'animate-spin text-blue-600' : ''}`} />
              </button>
            </div>
          )}

          {/* Main View Area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Admin Dashboard */}
            {showAdmin ? (
              <AdminView onBack={() => setShowAdmin(false)} />
            ) : currentTab === 'home' && !activeProfileUsername ? (
              /* Home Chronological Feed */
              <div id="home-feed-tab" className="pb-24 md:pb-8 p-3 sm:p-4 space-y-3">
                {/* Desktop/In-feed Post Composer */}
                <PostComposer 
                  currentUser={userProfile} 
                  onPostCreated={fetchFeed} 
                />

                {/* Friendly Beta Banner */}
                <div className="bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-blue-500/10 border border-blue-200/60 rounded-2xl p-3.5 text-xs text-slate-700 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900">Welcome to Ripple Private Beta!</p>
                    <p className="text-slate-600 text-[11px] mt-0.5">Posts can become social chains. Click "Ripple" on any post to continue the wave.</p>
                  </div>
                </div>

                {feedLoading ? (
                  <FeedSkeletonList count={3} />
                ) : feedError ? (
                  <div className="py-16 text-center bg-white rounded-2xl border border-red-100 p-8 shadow-xs">
                    <div className="w-10 h-10 bg-red-50 text-red-600 rounded-xl flex items-center justify-center font-bold mx-auto mb-3">!</div>
                    <h3 className="font-bold text-slate-900 text-sm">Couldn't load the feed.</h3>
                    <p className="text-slate-500 text-xs mt-1 mb-4 font-mono">Code: {feedError}</p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={fetchFeed}
                        className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs shadow-md shadow-blue-600/20 hover:bg-blue-700 transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Retry
                      </button>
                      <button
                        onClick={() => setIsDiagnosticOpen(true)}
                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Terminal className="w-3.5 h-3.5 text-slate-500" />
                        Diagnostic Logs
                      </button>
                    </div>
                  </div>
                ) : visiblePosts.length === 0 ? (
                  <div className="py-20 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-100 p-8">
                    <Waves className="w-10 h-10 text-blue-400 mx-auto mb-3 opacity-60" />
                    <h3 className="font-bold text-slate-800 text-sm">No posts yet</h3>
                    <p className="text-slate-500 text-xs mt-1 max-w-xs mx-auto">
                      Be the very first one to drop an idea into Ripple and watch others continue the wave!
                    </p>
                    <button
                      onClick={() => { setRippleParentPost(null); setIsCreateOpen(true); }}
                      className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs shadow-md shadow-blue-600/20 hover:bg-blue-700 transition"
                    >
                      Create First Post
                    </button>
                  </div>
                ) : (
                  combinedFeedList
                )}
                {loadingMore && (
                  <div className="pt-1">
                    <PostSkeleton />
                  </div>
                )}
                {hasMorePosts && !feedLoading && !feedError && visiblePosts.length > 0 && (
                  <div className="pt-4 pb-12 flex justify-center">
                    <button 
                      onClick={loadMorePosts}
                      disabled={loadingMore}
                      className="px-6 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-200 transition disabled:opacity-50"
                    >
                      {loadingMore ? 'Loading older posts...' : 'Load older posts'}
                    </button>
                  </div>
                )}
              </div>
            ) : currentTab === 'search' ? (
              /* Search Members */
              <div className="pb-24 md:pb-8 flex-1 flex flex-col">
                <SearchView 
                  onSelectUser={handleViewProfile} 
                  blockedUserIds={blockedUserIds} 
                  searchTerm={searchQuery}
                  onSearchTermChange={setSearchQuery}
                />
              </div>
            ) : currentTab === 'messages' ? (
              /* Private Messages */
              <div className="flex-1 flex flex-col">
                <MessagesView
                  currentUser={userProfile}
                  conversations={conversations}
                  loading={loadingConversations}
                  initialConversationDoc={lastConversationDoc}
                  conversationsError={conversationsError}
                  blockedUserIds={blockedUserIds}
                  isBlockedWith={isBlockedWith}
                  initialTargetUser={initialMessageTarget}
                  onClearInitialTargetUser={() => setInitialMessageTarget(null)}
                  onViewProfile={handleViewProfile}
                />
              </div>
            ) : currentTab === 'notifications' ? (
              /* In-App Notifications */
              <div className="pb-24 md:pb-8 flex-1 flex flex-col">
                <NotificationsView
                  onSelectPost={handleSelectPostFromNotification}
                  onSelectUser={handleViewProfile}
                  onOpenAdmin={() => setShowAdmin(true)}
                />
              </div>
            ) : (
              /* Profile (either target user or own profile) */
              <div className="pb-24 md:pb-8 flex-1 flex flex-col">
                <ProfileView
                  targetUsername={activeProfileUsername || userProfile.username}
                  onBack={activeProfileUsername ? () => setActiveProfileUsername(null) : undefined}
                  onOpenRippleChain={handleOpenRippleChain}
                  onContinueRipple={handleContinueRipple}
                  onOpenComments={handleOpenComments}
                  onViewProfile={handleViewProfile}
                  onOpenAdmin={() => setShowAdmin(true)}
                  onMessageUser={handleMessageUser}
                />
              </div>
            )}
          </div>
        </main>

        {/* Right Column: Desktop Right Sidebar */}
        {currentTab !== 'messages' && !showAdmin && (
          <RightSidebar
            currentUser={userProfile}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onNavigateTab={(tab) => {
              setCurrentTab(tab);
              if (tab === 'profile') {
                setActiveProfileUsername(null);
              }
              setShowAdmin(false);
            }}
            onViewProfile={handleViewProfile}
          />
        )}

      </div>

      {/* Mobile Bottom Navigation Bar */}
      <BottomNav
        currentTab={currentTab}
        onSelectTab={(tab) => {
          if (tab === 'create') {
            setRippleParentPost(null);
            setIsCreateOpen(true);
          } else {
            setCurrentTab(tab);
            if (tab === 'profile') {
              setActiveProfileUsername(null);
            }
            setShowAdmin(false);
          }
        }}
        unreadNotificationsCount={unreadCount + (isAdmin ? pendingReportsCount : 0)}
        unreadMessagesCount={unreadMessagesCount}
      />

      {/* Modals & Visual Chains */}
      <CreatePostModal
        isOpen={isCreateOpen}
        onClose={() => { setIsCreateOpen(false); setRippleParentPost(null); }}
        parentPost={rippleParentPost}
      />

      {selectedCommentsPost && (
        <CommentsModal
          post={selectedCommentsPost}
          onClose={() => setSelectedCommentsPost(null)}
          onViewProfile={handleViewProfile}
        />
      )}

      {selectedChainPost && (
        <RippleChainView
          post={selectedChainPost}
          onClose={() => setSelectedChainPost(null)}
          onContinueRipple={handleContinueRipple}
          onOpenComments={handleOpenComments}
          onViewProfile={handleViewProfile}
        />
      )}

      <FeedDiagnosticModal
        isOpen={isDiagnosticOpen}
        onClose={() => setIsDiagnosticOpen(false)}
        feedErrorCode={feedError}
        onRetry={fetchFeed}
      />

    </div>
  );
}
