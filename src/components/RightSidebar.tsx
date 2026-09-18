import React, { useState, useEffect } from 'react';
import { Search, ShieldCheck, ArrowRight, UserCheck, Waves } from 'lucide-react';
import type { UserProfile } from '../types';
import { getUserCounts } from '../services/api';

interface RightSidebarProps {
  currentUser: UserProfile;
  onNavigateTab: (tab: 'home' | 'search' | 'create' | 'messages' | 'notifications' | 'profile') => void;
  onViewProfile: (username: string) => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
}

export function RightSidebar({
  currentUser,
  onNavigateTab,
  onViewProfile,
  searchQuery,
  onSearchChange
}: RightSidebarProps) {
  const [localSearchTerm, setLocalSearchTerm] = useState('');
  const activeSearch = searchQuery !== undefined ? searchQuery : localSearchTerm;
  const handleSearchUpdate = (val: string) => {
    if (onSearchChange) {
      onSearchChange(val);
    } else {
      setLocalSearchTerm(val);
    }
  };
  const [counts, setCounts] = useState<{ followersCount: number; followingCount: number; postsCount: number }>({
    followersCount: 0,
    followingCount: 0,
    postsCount: 0
  });

  useEffect(() => {
    getUserCounts(currentUser.uid, true).then(res => {
      setCounts({
        followersCount: res.followersCount,
        followingCount: res.followingCount,
        postsCount: res.postsCount
      });
    }).catch(console.error);
  }, [currentUser.uid]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNavigateTab('search');
  };

  return (
    <aside 
      id="desktop-right-sidebar"
      className="hidden xl:block w-72 lg:w-80 shrink-0 sticky top-0 h-screen p-4 space-y-4 overflow-y-auto"
    >
      {/* Search Input Box */}
      <form onSubmit={handleSearchSubmit} className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
        <input
          id="right-sidebar-search-input"
          type="text"
          value={activeSearch}
          onChange={(e) => {
            handleSearchUpdate(e.target.value);
            onNavigateTab('search');
          }}
          onFocus={() => onNavigateTab('search')}
          placeholder="Search Ripple..."
          className="w-full pl-10 pr-4 py-2.5 bg-slate-100/80 hover:bg-slate-100 border border-transparent focus:border-blue-500 focus:bg-white rounded-2xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
        />
      </form>

      {/* Profile Overview Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <img
            src={currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${currentUser.username}`}
            alt={currentUser.displayName}
            className="w-12 h-12 rounded-full object-cover ring-2 ring-slate-100"
          />
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-bold text-slate-900 truncate">{currentUser.displayName}</h4>
            <p className="text-[11px] text-slate-400 truncate">@{currentUser.username}</p>
          </div>
        </div>

        {currentUser.bio && (
          <p className="text-xs text-slate-600 mt-2.5 line-clamp-2 leading-relaxed">
            {currentUser.bio}
          </p>
        )}

        {/* Social Metrics */}
        <div className="grid grid-cols-3 gap-2 mt-3.5 pt-3 border-t border-slate-100 text-center">
          <div>
            <span className="block text-xs font-bold text-slate-900">{counts.postsCount}</span>
            <span className="text-[10px] text-slate-400 font-medium">Posts</span>
          </div>
          <div>
            <span className="block text-xs font-bold text-slate-900">{counts.followersCount}</span>
            <span className="text-[10px] text-slate-400 font-medium">Followers</span>
          </div>
          <div>
            <span className="block text-xs font-bold text-slate-900">{counts.followingCount}</span>
            <span className="text-[10px] text-slate-400 font-medium">Following</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onViewProfile(currentUser.username)}
          className="mt-3.5 w-full py-2 px-3 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 border border-slate-200/60"
        >
          <span>View My Profile</span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>

      {/* Ripple Anonymity & Privacy Explainer */}
      <div className="bg-gradient-to-br from-blue-50/70 via-slate-50 to-indigo-50/50 rounded-2xl border border-blue-100/80 p-4 shadow-xs">
        <div className="flex items-center gap-2 text-blue-700 font-bold text-xs mb-1.5">
          <ShieldCheck className="w-4 h-4 text-blue-600" />
          <span>Ripple Privacy Promise</span>
        </div>
        <p className="text-[11px] text-slate-600 leading-relaxed">
          When posting anonymously, your account identity is not shown publicly on your post while preserving the conversation thread.
        </p>
        <div className="mt-3 pt-2.5 border-t border-blue-100/60 flex items-center justify-between text-[10px] text-blue-700 font-medium">
          <span>Protected Reach</span>
          <span className="flex items-center gap-1">
            <Waves className="w-3 h-3 text-blue-500" />
            Active
          </span>
        </div>
      </div>

      {/* Platform & Version Footer */}
      <div className="px-2 pt-2 text-[11px] text-slate-400 space-y-1.5">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-400">
          <button type="button" onClick={() => onNavigateTab('home')} className="hover:underline">Home</button>
          <button type="button" onClick={() => onNavigateTab('search')} className="hover:underline">Explore</button>
          <button type="button" onClick={() => onNavigateTab('messages')} className="hover:underline">Messages</button>
        </div>
        <div className="text-[10px] text-slate-400">
          Ripple Social · <span className="font-semibold text-slate-500">v41</span> · Built for real conversation
        </div>
      </div>
    </aside>
  );
}
