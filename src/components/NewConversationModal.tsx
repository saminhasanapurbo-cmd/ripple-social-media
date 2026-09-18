import React, { useState, useEffect } from 'react';
import { Search, X, User, AlertCircle, Loader2 } from 'lucide-react';
import { db } from '../firebase';
import { collection, query, where, limit, getDocs } from 'firebase/firestore';
import { findUserByUsername } from '../services/messaging';
import type { UserProfile } from '../types';

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  blockedUserIds: string[];
  onSelectUser: (user: UserProfile) => Promise<void> | void;
}

export function NewConversationModal({
  isOpen,
  onClose,
  currentUser,
  blockedUserIds,
  onSelectUser
}: NewConversationModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [startingUserUid, setStartingUserUid] = useState<string | null>(null);
  const [results, setResults] = useState<UserProfile[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setResults([]);
      setErrorMsg(null);
      setStartingUserUid(null);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    const cleanTerm = searchTerm.trim().toLowerCase().replace(/^@/, '');
    if (!cleanTerm) {
      setResults([]);
      setErrorMsg(null);
      setLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const foundUsers: UserProfile[] = [];
        const seenUids = new Set<string>();

        // 1. Direct resolution via unique /usernames/{cleanTerm} mapping
        const exactMatch = await findUserByUsername(cleanTerm);
        if (exactMatch) {
          foundUsers.push(exactMatch);
          seenUids.add(exactMatch.uid);
        }

        // 2. Prefix query on /users collection
        try {
          const q = query(
            collection(db, 'users'),
            where('username', '>=', cleanTerm),
            where('username', '<=', cleanTerm + '\uf8ff'),
            limit(8)
          );
          const snap = await getDocs(q);
          snap.forEach((d) => {
            const u = d.data() as UserProfile;
            if (!seenUids.has(u.uid)) {
              foundUsers.push(u);
              seenUids.add(u.uid);
            }
          });
        } catch (prefixErr) {
          console.warn("Prefix query search notice:", prefixErr);
        }

        setResults(foundUsers);
      } catch (err) {
        console.error("User search error:", err);
        setErrorMsg("Failed to search users. Please try again.");
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  if (!isOpen) return null;

  const handlePickUser = async (user: UserProfile) => {
    if (user.uid === currentUser.uid) {
      setErrorMsg("You cannot start a private conversation with yourself.");
      return;
    }
    if (blockedUserIds.includes(user.uid)) {
      setErrorMsg("You can't send messages to this user.");
      return;
    }

    setStartingUserUid(user.uid);
    setErrorMsg(null);
    try {
      await onSelectUser(user);
      onClose();
    } catch (err: any) {
      console.error("Error starting chat:", err);
      setErrorMsg(err?.message || "Failed to start conversation. Please try again.");
    } finally {
      setStartingUserUid(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div 
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 flex flex-col overflow-hidden max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">New Message</h2>
            <p className="text-xs text-slate-500">Search for a Ripple user to start a conversation</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search input */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by @username..."
              autoFocus
              className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 transition"
            />
            {loading && (
              <Loader2 className="w-4 h-4 text-teal-600 animate-spin absolute right-3.5 top-3" />
            )}
          </div>

          {errorMsg && (
            <div className="mt-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 divide-y divide-slate-50">
          {searchTerm.trim() && !loading && results.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs px-4">
              <User className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p className="font-semibold text-slate-600">No user found</p>
              <p className="mt-1 text-slate-400">Make sure the @username is spelled correctly.</p>
            </div>
          ) : !searchTerm.trim() ? (
            <div className="py-10 text-center text-slate-400 text-xs px-4">
              <p className="font-medium text-slate-500">Type a username to find people on Ripple.</p>
            </div>
          ) : (
            results.map((u) => {
              const isSelf = u.uid === currentUser.uid;
              const isBlocked = blockedUserIds.includes(u.uid);
              const isStarting = startingUserUid === u.uid;

              return (
                <button
                  key={u.uid}
                  type="button"
                  onClick={() => handlePickUser(u)}
                  disabled={isSelf || isBlocked || startingUserUid !== null}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition text-left ${
                    isSelf || isBlocked
                      ? 'opacity-50 cursor-not-allowed bg-slate-50'
                      : isStarting
                      ? 'bg-teal-50 border border-teal-200'
                      : 'hover:bg-teal-50/60 active:bg-teal-100/50'
                  }`}
                >
                  <img
                    src={u.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${u.username}`}
                    alt={u.displayName}
                    className="w-10 h-10 rounded-full object-cover ring-1 ring-slate-200 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 truncate">
                        {u.displayName}
                      </span>
                      {isSelf && (
                        <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.2 rounded-full font-medium">
                          You
                        </span>
                      )}
                      {isBlocked && (
                        <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.2 rounded-full font-medium">
                          Blocked
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">@{u.username}</p>
                    {u.bio && (
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">{u.bio}</p>
                    )}
                  </div>
                  {isStarting && (
                    <Loader2 className="w-4 h-4 text-teal-600 animate-spin shrink-0 ml-2" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
