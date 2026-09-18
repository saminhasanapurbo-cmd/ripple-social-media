import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { toggleFollow, blockUser, unblockUser, getUserCounts, recordProfileView } from '../services/api';
import type { UserProfile, Post } from '../types';
import { PostCard } from './PostCard';
import { 
  UserPlus, 
  UserCheck, 
  Settings, 
  Grid, 
  Waves, 
  UserX, 
  Calendar, 
  Edit3, 
  LogOut, 
  Check, 
  X,
  Shield,
  ArrowLeft,
  Lock,
  MessageCircle,
  Eye,
  Loader2
} from 'lucide-react';
import { collection, query, where, orderBy, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface ProfileViewProps {
  targetUsername: string;
  onBack?: () => void;
  onOpenRippleChain: (post: Post) => void;
  onContinueRipple: (post: Post) => void;
  onOpenComments: (post: Post) => void;
  onViewProfile: (username: string) => void;
  onOpenAdmin?: () => void;
  onMessageUser?: (user: UserProfile) => void;
}

export function ProfileView({
  targetUsername,
  onBack,
  onOpenRippleChain,
  onContinueRipple,
  onOpenComments,
  onViewProfile,
  onOpenAdmin,
  onMessageUser
}: ProfileViewProps) {
  const { userProfile: myProfile, isAdmin, pendingReportsCount, logout, updateProfileDetails, getBlockState, isBlockedWith } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'posts' | 'ripples'>('posts');
  
  // Real-time calculated counters
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [postsCount, setPostsCount] = useState(0);
  const [profileViews, setProfileViews] = useState(0);

  // Edit profile state
  const [isEditing, setIsEditing] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  const cleanUsername = targetUsername.replace(/^@/, '').toLowerCase();
  const isOwnProfile = myProfile?.username.toLowerCase() === cleanUsername;
  const blockState = profile ? getBlockState(profile.uid) : 'none';

  // Load user profile & follow state
  useEffect(() => {
    async function loadUser() {
      setLoading(true);
      try {
        const uq = query(collection(db, 'users'), where('username', '==', cleanUsername));
        const userDocs = await getDocs(uq);

        if (!userDocs.empty) {
          const uData = userDocs.docs[0].data() as UserProfile;
          setProfile(uData);
          setEditDisplayName(uData.displayName);
          setEditBio(uData.bio || '');

          const counts = await getUserCounts(uData.uid, isOwnProfile);
          
          if (!isOwnProfile && myProfile) {
            recordProfileView(uData.uid).catch(console.error);
          }
          setFollowersCount(counts.followersCount);
          setFollowingCount(counts.followingCount);
          setPostsCount(counts.postsCount);
          setProfileViews(counts.profileViews || 0);

          if (myProfile && !isOwnProfile) {
            if (isBlockedWith(uData.uid)) {
              setIsFollowing(false);
            } else {
              const followDoc = await getDoc(doc(db, 'follows', `${myProfile.uid}_${uData.uid}`));
              setIsFollowing(followDoc.exists());
            }
          }

          if (myProfile && !isOwnProfile && isBlockedWith(uData.uid)) {
            setPosts([]);
          } else {
            const pq = query(
              collection(db, 'posts'),
              where('authorId', '==', uData.uid),
              orderBy('createdAt', 'desc')
            );
            const pDocs = await getDocs(pq);
            const pList: Post[] = [];
            pDocs.forEach((d) => {
              pList.push({ id: d.id, ...(d.data() as Omit<Post, 'id'>) });
            });
            setPosts(pList);
          }
        } else {
          setProfile(null);
        }
      } catch (err) {
        console.error("Error loading profile:", err);
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, [cleanUsername, myProfile?.uid, blockState]);

  const handleFollowToggle = async () => {
    if (!myProfile || !profile || blockState !== 'none') return;
    try {
      const willFollow = !isFollowing;
      setIsFollowing(willFollow);
      setFollowersCount(prev => willFollow ? prev + 1 : Math.max(0, prev - 1));
      await toggleFollow(myProfile, profile);
    } catch (err) {
      console.error(err);
      setIsFollowing(!isFollowing);
    }
  };

  const handleBlockToggle = async () => {
    if (!myProfile || !profile) return;
    try {
      if (blockState === 'blocked_by_me') {
        await unblockUser(myProfile.uid, profile.uid);
      } else {
        await blockUser(myProfile.uid, profile.uid);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDisplayName.trim()) {
      setEditError("Display name cannot be empty.");
      return;
    }
    setSavingEdit(true);
    setEditError('');
    try {
      await updateProfileDetails(editDisplayName.trim(), editBio.trim());
      if (profile) {
        setProfile({
          ...profile,
          displayName: editDisplayName.trim(),
          bio: editBio.trim()
        });
      }
      setIsEditing(false);
    } catch (err: any) {
      console.error(err);
      setEditError("Failed to save changes.");
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center text-slate-400 text-xs">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600 mx-auto mb-2" />
        <div>Loading profile...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="py-24 text-center px-4">
        <h3 className="font-extrabold text-slate-900 text-base">User Not Found</h3>
        <p className="text-xs text-slate-500 mt-1">
          The member @{cleanUsername} does not exist or has closed their account.
        </p>
        {onBack && (
          <button
            onClick={onBack}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-xs hover:bg-blue-700 transition"
          >
            Go Back
          </button>
        )}
      </div>
    );
  }

  const ripples = posts.filter(p => p.parentPostId);
  const regularPosts = posts.filter(p => !p.parentPostId);
  const displayedPosts = activeTab === 'posts' ? regularPosts : ripples;

  return (
    <div id="profile-view" className="w-full">
      {/* Top Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md px-4 py-3 border-b border-slate-200/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1.5 -ml-1.5 rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div>
            <h2 className="font-extrabold text-slate-900 text-sm leading-tight">{profile.displayName}</h2>
            <p className="text-[11px] text-slate-400 font-medium">{postsCount} posts</p>
          </div>
        </div>

        {isOwnProfile && (
          <div className="flex items-center gap-2">
            {isAdmin && onOpenAdmin && (
              <button
                onClick={onOpenAdmin}
                className="flex items-center gap-1.5 text-[11px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-xl transition shadow-2xs"
                title="Admin Moderation"
              >
                <Shield className="w-3.5 h-3.5 text-amber-600" />
                <span>Admin</span>
                {pendingReportsCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                    {pendingReportsCount}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={() => logout()}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Instagram-Quality Profile Header */}
      <div className="bg-white p-4 sm:p-6 border-b border-slate-200/80">
        <div className="flex items-start justify-between gap-4">
          <img
            src={profile.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${profile.username}`}
            alt={profile.displayName}
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover ring-2 ring-slate-100 shadow-xs shrink-0"
          />

          {/* Action Button Row */}
          <div className="flex items-center gap-2 flex-wrap justify-end pt-1">
            {isOwnProfile ? (
              <button
                id="edit-profile-btn"
                type="button"
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-700 transition flex items-center gap-1.5 shadow-2xs"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Profile</span>
              </button>
            ) : blockState === 'blocked_by_me' ? (
              <button
                type="button"
                onClick={handleBlockToggle}
                className="px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 shadow-2xs"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Unblock</span>
              </button>
            ) : blockState === 'blocked_me' ? (
              <div className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-500 flex items-center gap-1.5 border border-slate-200">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>Unavailable</span>
              </div>
            ) : (
              <>
                <button
                  id="follow-toggle-btn"
                  type="button"
                  onClick={handleFollowToggle}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs ${
                    isFollowing 
                      ? 'bg-slate-100 text-slate-700 hover:bg-rose-50 hover:text-rose-600 border border-slate-200/80' 
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isFollowing ? (
                    <>
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Following</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Follow</span>
                    </>
                  )}
                </button>
                
                <button
                  id="message-user-btn"
                  type="button"
                  onClick={() => onMessageUser && onMessageUser(profile)}
                  className="px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 shadow-2xs active:scale-95"
                  title={`Send message to @${profile.username}`}
                >
                  <MessageCircle className="w-3.5 h-3.5 text-blue-600" />
                  <span>Message</span>
                </button>

                <button
                  type="button"
                  onClick={handleBlockToggle}
                  className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 text-xs transition"
                  title="Block user"
                >
                  <UserX className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Identity & Bio */}
        <div className="mt-3.5">
          <h1 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight">{profile.displayName}</h1>
          <p className="text-xs text-slate-400">@{profile.username}</p>
          {profile.bio && (
            <p className="mt-2.5 text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
              {profile.bio}
            </p>
          )}
        </div>

        {/* Social Metrics Bar */}
        <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center gap-6 text-xs">
          <div>
            <strong className="font-extrabold text-slate-900">{postsCount}</strong>{' '}
            <span className="text-slate-500 font-medium">Posts</span>
          </div>
          <div>
            <strong className="font-extrabold text-slate-900">{followersCount}</strong>{' '}
            <span className="text-slate-500 font-medium">Followers</span>
          </div>
          <div>
            <strong className="font-extrabold text-slate-900">{followingCount}</strong>{' '}
            <span className="text-slate-500 font-medium">Following</span>
          </div>
          {isOwnProfile && (
            <div className="flex items-center gap-1.5 text-slate-500 font-medium">
              <Eye className="w-3.5 h-3.5 text-blue-500" />
              <strong className="font-extrabold text-slate-900">{profileViews}</strong>{' '}
              <span>Profile Views</span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-white border-b border-slate-200/80 sticky top-[53px] z-20">
        <button
          type="button"
          onClick={() => setActiveTab('posts')}
          className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 transition border-b-2 ${
            activeTab === 'posts' 
              ? 'border-blue-600 text-blue-600' 
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Grid className="w-3.5 h-3.5" />
          <span>Posts ({regularPosts.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('ripples')}
          className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 transition border-b-2 ${
            activeTab === 'ripples' 
              ? 'border-blue-600 text-blue-600' 
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Waves className="w-3.5 h-3.5" />
          <span>Ripples ({ripples.length})</span>
        </button>
      </div>

      {/* Posts List */}
      <div className="p-3 sm:p-4 space-y-3">
        {displayedPosts.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-xs">
            {activeTab === 'posts' ? (
              <span>No posts published yet.</span>
            ) : (
              <span>No Ripple chains started yet.</span>
            )}
          </div>
        ) : (
          displayedPosts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              onOpenRippleChain={onOpenRippleChain}
              onContinueRipple={onContinueRipple}
              onOpenComments={onOpenComments}
              onViewProfile={onViewProfile}
              onDeleted={(id) => setPosts(prev => prev.filter(p => p.id !== id))}
            />
          ))
        )}
      </div>

      {/* Edit Profile Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-5 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-extrabold text-slate-900 text-base">Edit Profile</h3>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Display Name</label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  maxLength={50}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Bio</label>
                <textarea
                  rows={3}
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  maxLength={160}
                  placeholder="Tell the Ripple community about yourself..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                />
                <span className="text-[10px] text-slate-400 block text-right">
                  {160 - editBio.length} left
                </span>
              </div>

              {editError && (
                <p className="text-xs text-rose-500">{editError}</p>
              )}

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 transition shadow-xs"
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
