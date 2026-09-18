import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, getDocs, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserProfile } from '../types';
import { Search as SearchIcon, ArrowRight, Loader2 } from 'lucide-react';

interface SearchViewProps {
  onSelectUser: (username: string) => void;
  blockedUserIds?: string[];
  searchTerm?: string;
  onSearchTermChange?: (term: string) => void;
}

export function SearchView({ 
  onSelectUser, 
  blockedUserIds = [],
  searchTerm: externalSearchTerm,
  onSearchTermChange
}: SearchViewProps) {
  const [localSearchTerm, setLocalSearchTerm] = useState('');
  const activeSearchTerm = externalSearchTerm !== undefined ? externalSearchTerm : localSearchTerm;
  const handleSearchChange = (val: string) => {
    if (onSearchTermChange) {
      onSearchTermChange(val);
    } else {
      setLocalSearchTerm(val);
    }
  };

  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [exactUser, setExactUser] = useState<UserProfile | null>(null);
  const [searchingExact, setSearchingExact] = useState(false);

  useEffect(() => {
    async function fetchSampleUsers() {
      setLoading(true);
      try {
        const q = query(collection(db, 'users'), limit(50));
        const snap = await getDocs(q);
        const users: UserProfile[] = [];
        snap.forEach(d => users.push(d.data() as UserProfile));
        setAllUsers(users);
      } catch (err) {
        console.error("Error fetching users for search:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchSampleUsers();
  }, []);

  // Exact @username or username lookup beyond first 50 users using /usernames/{normalized} mapping
  useEffect(() => {
    const clean = activeSearchTerm.trim().toLowerCase().replace(/^@/, '');
    if (!clean) {
      setExactUser(null);
      setSearchingExact(false);
      return;
    }

    let isCancelled = false;
    const timer = setTimeout(async () => {
      try {
        setSearchingExact(true);
        const usernameDoc = await getDoc(doc(db, 'usernames', clean));
        if (isCancelled) return;

        if (usernameDoc.exists()) {
          const uid = usernameDoc.data()?.uid;
          if (uid && !blockedUserIds.includes(uid)) {
            const userDoc = await getDoc(doc(db, 'users', uid));
            if (isCancelled) return;
            if (userDoc.exists()) {
              setExactUser(userDoc.data() as UserProfile);
            } else {
              setExactUser(null);
            }
          } else {
            setExactUser(null);
          }
        } else {
          setExactUser(null);
        }
      } catch (err) {
        console.error("Exact username lookup error:", err);
        if (!isCancelled) setExactUser(null);
      } finally {
        if (!isCancelled) setSearchingExact(false);
      }
    }, 200);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [activeSearchTerm, blockedUserIds]);

  const filtered = useMemo(() => {
    const term = activeSearchTerm.toLowerCase().trim();
    const matches = allUsers.filter(u => {
      if (blockedUserIds.includes(u.uid)) return false;
      if (!term) return true;
      return (
        u.username.toLowerCase().includes(term) ||
        u.displayName.toLowerCase().includes(term) ||
        (u.bio && u.bio.toLowerCase().includes(term))
      );
    });

    // If an exact user outside the sample 50 is resolved, place at top
    if (exactUser && !blockedUserIds.includes(exactUser.uid)) {
      if (!matches.some(u => u.uid === exactUser.uid)) {
        return [exactUser, ...matches];
      }
    }

    return matches;
  }, [allUsers, activeSearchTerm, blockedUserIds, exactUser]);

  return (
    <div id="search-view" className="w-full">
      {/* Top Search Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md p-3.5 sm:p-4 border-b border-slate-200/80">
        <div className="relative">
          <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            id="search-users-input"
            type="text"
            value={activeSearchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by name, @username, or keywords..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-100/80 border border-transparent focus:border-blue-500 focus:bg-white rounded-2xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
          />
          {searchingExact && (
            <div className="absolute right-3.5 top-3">
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
            </div>
          )}
        </div>
      </div>

      {/* Suggested Users / Results List */}
      <div className="p-3.5 sm:p-4 space-y-2.5">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1 mb-2 font-medium">
          <span>{activeSearchTerm ? 'Search Results' : 'Suggested Ripple Members'}</span>
          <span>{filtered.length} found</span>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400 text-xs">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin mx-auto mb-2" />
            <div>Finding members...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-slate-400 text-xs px-4">
            No users match "{activeSearchTerm}". Try another keyword or username.
          </div>
        ) : (
          filtered.map(user => (
            <div
              key={user.uid}
              onClick={() => onSelectUser(user.username)}
              className="p-3.5 bg-white hover:bg-slate-50 border border-slate-200/90 hover:border-slate-300 rounded-2xl flex items-center justify-between cursor-pointer transition shadow-2xs group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${user.username}`}
                  alt={user.displayName}
                  className="w-11 h-11 rounded-full object-cover ring-1 ring-slate-200 group-hover:ring-blue-500 transition shrink-0"
                />
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-blue-600 transition truncate">
                    {user.displayName}
                  </h4>
                  <span className="text-[11px] text-slate-400 truncate">@{user.username}</span>
                  {user.bio && (
                    <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5 max-w-[260px] sm:max-w-md">
                      {user.bio}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 text-slate-400 group-hover:text-blue-600 transition shrink-0 ml-2">
                <span className="text-[11px] font-semibold hidden sm:inline">{user.followersCount || 0} followers</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
