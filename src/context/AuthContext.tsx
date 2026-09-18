import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut as fbSignOut, 
  onAuthStateChanged, 
  type FirebaseUser 
} from '../firebase';
import { 
  doc, 
  getDoc, 
  updateDoc, 
  onSnapshot, 
  runTransaction,
  collection,
  query,
  where
} from 'firebase/firestore';
import type { UserProfile, ReportItem, BlockState } from '../types';
import { subscribeToBlockedRelationships } from '../services/api';

const AUTH_TIMEOUT_MS = 12000;
const PROFILE_TIMEOUT_MS = 12000;

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  authLoading: boolean;
  profileLoading: boolean;
  authError: string | null;
  profileError: string | null;
  needsProfileSetup: boolean;
  loading: boolean; // Backwards-compatible alias for (authLoading || profileLoading)
  isAdmin: boolean;
  retryAuth: () => Promise<void>;
  retryProfileLoad: () => Promise<void>;
  blockedUserIds: string[];
  blockedByMe: Set<string>;
  blockedMe: Set<string>;
  getBlockState: (targetUid: string) => BlockState;
  isBlockedWith: (targetUid: string) => boolean;
  pendingReports: ReportItem[];
  pendingReportsCount: number;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  signupWithEmail: (email: string, pass: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  createUserProfile: (username: string, displayName: string, bio: string, photoURL?: string) => Promise<void>;
  updateProfileDetails: (displayName: string, bio: string, photoURL?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Split Auth and Profile States
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Real-time bi-directional block state
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [blockedByMe, setBlockedByMe] = useState<Set<string>>(new Set());
  const [blockedMe, setBlockedMe] = useState<Set<string>>(new Set());

  // Real-time admin pending reports
  const [pendingReports, setPendingReports] = useState<ReportItem[]>([]);
  const [pendingReportsCount, setPendingReportsCount] = useState<number>(0);

  // Stale-request guards and listener cleanup refs
  const profileRequestSeq = useRef(0);
  const authTimeoutTimer = useRef<any>(null);
  const profileTimeoutTimer = useRef<any>(null);
  const authResolvedRef = useRef(false);

  const unsubscribeAdminRef = useRef<(() => void) | null>(null);
  const unsubscribeProfileRef = useRef<(() => void) | null>(null);
  const unsubscribeBlocksRef = useRef<(() => void) | null>(null);

  const cleanupListeners = useCallback(() => {
    if (unsubscribeAdminRef.current) {
      unsubscribeAdminRef.current();
      unsubscribeAdminRef.current = null;
    }
    if (unsubscribeProfileRef.current) {
      unsubscribeProfileRef.current();
      unsubscribeProfileRef.current = null;
    }
    if (unsubscribeBlocksRef.current) {
      unsubscribeBlocksRef.current();
      unsubscribeBlocksRef.current = null;
    }
  }, []);

  // Attach continuous realtime listeners AFTER initial load succeeds
  const attachRealtimeListeners = useCallback((uid: string) => {
    cleanupListeners();

    // 1. Admin authorization listener (/admins/{uid})
    const adminDocRef = doc(db, 'admins', uid);
    unsubscribeAdminRef.current = onSnapshot(adminDocRef, (snap) => {
      setIsAdmin(snap.exists());
    }, (err) => {
      console.warn("Admin verification check notice:", err.message);
      setIsAdmin(false);
    });

    // 2. Real-time bi-directional block listener
    unsubscribeBlocksRef.current = subscribeToBlockedRelationships(uid, (data) => {
      setBlockedUserIds(data.blockedUserIds);
      setBlockedByMe(data.blockedByMe);
      setBlockedMe(data.blockedMe);
    });

    // 3. User profile ongoing changes
    const userDocRef = doc(db, 'users', uid);
    unsubscribeProfileRef.current = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        setUserProfile(snapshot.data() as UserProfile);
      }
    }, (err) => {
      console.warn("Real-time profile updates subscription notice:", err.message);
    });
  }, [cleanupListeners]);

  // Initial one-time profile fetch with timeout, stale guard, and explicit error handling
  const loadUserProfile = useCallback(async (uid: string) => {
    const reqId = ++profileRequestSeq.current;
    setProfileLoading(true);
    setProfileError(null);
    console.info('[Ripple Profile] loading');

    if (profileTimeoutTimer.current) {
      clearTimeout(profileTimeoutTimer.current);
    }

    profileTimeoutTimer.current = setTimeout(() => {
      if (profileRequestSeq.current === reqId) {
        console.warn('[Ripple Profile] timeout');
        setProfileLoading(false);
        setProfileError('PROFILE_LOAD_TIMEOUT');
      }
    }, PROFILE_TIMEOUT_MS);

    try {
      const userDocRef = doc(db, 'users', uid);
      const snap = await getDoc(userDocRef);

      if (profileRequestSeq.current !== reqId) {
        return; // Discard stale request
      }

      if (profileTimeoutTimer.current) {
        clearTimeout(profileTimeoutTimer.current);
        profileTimeoutTimer.current = null;
      }

      if (snap.exists()) {
        console.info('[Ripple Profile] loaded');
        setUserProfile(snap.data() as UserProfile);
        setNeedsProfileSetup(false);
        setProfileError(null);
        setProfileLoading(false);

        // Attach ongoing real-time listeners
        attachRealtimeListeners(uid);
      } else {
        // Firestore confirmed profile does not exist
        console.info('[Ripple Profile] missing');
        setUserProfile(null);
        setNeedsProfileSetup(true);
        setProfileError(null);
        setProfileLoading(false);
      }
    } catch (err: any) {
      if (profileRequestSeq.current !== reqId) {
        return;
      }

      if (profileTimeoutTimer.current) {
        clearTimeout(profileTimeoutTimer.current);
        profileTimeoutTimer.current = null;
      }

      console.error('[Ripple Profile] failed');
      setProfileLoading(false);
      setNeedsProfileSetup(false); // CRITICAL: NEVER send to Profile Setup on fetch errors
      const isPermDenied = err?.code === 'permission-denied' || String(err?.message || '').toLowerCase().includes('permission');
      setProfileError(isPermDenied ? 'PROFILE_PERMISSION_DENIED' : 'PROFILE_LOAD_FAILED');
    }
  }, [attachRealtimeListeners]);

  // Firebase Auth listener initialization
  useEffect(() => {
    console.info('[Ripple Auth] initializing');
    authResolvedRef.current = false;
    setAuthLoading(true);
    setAuthError(null);

    authTimeoutTimer.current = setTimeout(() => {
      if (!authResolvedRef.current) {
        console.warn('[Ripple Auth] timeout');
        setAuthLoading(false);
        setAuthError('AUTH_INIT_TIMEOUT');
      }
    }, AUTH_TIMEOUT_MS);

    const unsubscribeAuth = onAuthStateChanged(
      auth,
      async (user) => {
        authResolvedRef.current = true;
        if (authTimeoutTimer.current) {
          clearTimeout(authTimeoutTimer.current);
          authTimeoutTimer.current = null;
        }

        setAuthLoading(false);
        setAuthError(null);
        setCurrentUser(user);

        if (user) {
          console.info('[Ripple Auth] signed in');
          loadUserProfile(user.uid);
        } else {
          console.info('[Ripple Auth] signed out');
          cleanupListeners();
          setUserProfile(null);
          setNeedsProfileSetup(false);
          setProfileLoading(false);
          setProfileError(null);
          setIsAdmin(false);
          setBlockedUserIds([]);
          setBlockedByMe(new Set());
          setBlockedMe(new Set());
          setPendingReports([]);
          setPendingReportsCount(0);
        }
      },
      (err: any) => {
        authResolvedRef.current = true;
        if (authTimeoutTimer.current) {
          clearTimeout(authTimeoutTimer.current);
          authTimeoutTimer.current = null;
        }
        console.error('[Ripple Auth] failed');
        setAuthLoading(false);
        setAuthError(err?.code ? 'AUTH_INIT_FAILED' : 'FIREBASE_INIT_FAILED');
      }
    );

    return () => {
      if (authTimeoutTimer.current) {
        clearTimeout(authTimeoutTimer.current);
      }
      if (profileTimeoutTimer.current) {
        clearTimeout(profileTimeoutTimer.current);
      }
      unsubscribeAuth();
      cleanupListeners();
    };
  }, [loadUserProfile, cleanupListeners]);

  // Real-time listener for pending reports when user is confirmed admin
  useEffect(() => {
    if (!currentUser || !isAdmin) {
      setPendingReports([]);
      setPendingReportsCount(0);
      return;
    }

    const reportsQuery = query(collection(db, 'reports'), where('status', '==', 'pending'));
    const unsubscribeReports = onSnapshot(reportsQuery, (snap) => {
      const reportsList: ReportItem[] = [];
      snap.forEach((d) => {
        reportsList.push({ id: d.id, ...(d.data() as Omit<ReportItem, 'id'>) });
      });
      // Sort newest pending reports first
      reportsList.sort((a, b) => {
        const tA = typeof a.createdAt === 'number' ? a.createdAt : 0;
        const tB = typeof b.createdAt === 'number' ? b.createdAt : 0;
        return tB - tA;
      });
      setPendingReports(reportsList);
      setPendingReportsCount(reportsList.length);
    }, (err) => {
      console.warn("Real-time reports listener notice:", err.message);
    });

    return () => {
      unsubscribeReports();
    };
  }, [currentUser?.uid, isAdmin]);

  const retryProfileLoad = useCallback(async () => {
    const user = auth.currentUser;
    if (user) {
      await loadUserProfile(user.uid);
    }
  }, [loadUserProfile]);

  const retryAuth = useCallback(async () => {
    console.info('[Ripple Auth] initializing');
    setAuthLoading(true);
    setAuthError(null);
    authResolvedRef.current = false;

    if (authTimeoutTimer.current) {
      clearTimeout(authTimeoutTimer.current);
    }

    authTimeoutTimer.current = setTimeout(() => {
      if (!authResolvedRef.current) {
        console.warn('[Ripple Auth] timeout');
        setAuthLoading(false);
        setAuthError('AUTH_INIT_TIMEOUT');
      }
    }, AUTH_TIMEOUT_MS);

    // If currentUser is already available on the auth instance
    if (auth.currentUser) {
      authResolvedRef.current = true;
      if (authTimeoutTimer.current) {
        clearTimeout(authTimeoutTimer.current);
        authTimeoutTimer.current = null;
      }
      setAuthLoading(false);
      setAuthError(null);
      setCurrentUser(auth.currentUser);
      await loadUserProfile(auth.currentUser.uid);
    }
  }, [loadUserProfile]);

  const getBlockState = (targetUid: string): BlockState => {
    if (!currentUser || targetUid === currentUser.uid) return 'none';
    if (blockedByMe.has(targetUid)) return 'blocked_by_me';
    if (blockedMe.has(targetUid)) return 'blocked_me';
    return 'none';
  };

  const isBlockedWith = (targetUid: string): boolean => {
    return blockedUserIds.includes(targetUid);
  };

  const loginWithEmail = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), pass);
  };

  const signupWithEmail = async (email: string, pass: string) => {
    await createUserWithEmailAndPassword(auth, email.trim(), pass);
  };

  const loginWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const logout = async () => {
    await fbSignOut(auth);
  };

  const createUserProfile = async (
    username: string, 
    displayName: string, 
    bio: string, 
    photoURL?: string
  ) => {
    if (!currentUser) throw new Error("Not logged in");

    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
    if (cleanUsername.length < 3 || cleanUsername.length > 24) {
      throw new Error("Username must be between 3 and 24 characters (letters, numbers, underscores).");
    }

    const cleanDisplayName = displayName.trim() || cleanUsername;
    if (cleanDisplayName.length > 40) {
      throw new Error("Display name must be 40 characters or fewer.");
    }

    const cleanBio = bio.trim();
    if (cleanBio.length > 160) {
      throw new Error("Bio must be 160 characters or fewer.");
    }

    // Uniqueness reservation using transaction
    const usernameDocRef = doc(db, 'usernames', cleanUsername);
    const userDocRef = doc(db, 'users', currentUser.uid);

    const defaultAvatar = photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${cleanUsername}&backgroundColor=0ea5e9,38bdf8,0284c7`;

    const newProfile: UserProfile = {
      uid: currentUser.uid,
      username: cleanUsername,
      displayName: cleanDisplayName,
      bio: cleanBio,
      photoURL: defaultAvatar,
      createdAt: Date.now(),
      followersCount: 0,
      followingCount: 0,
      postsCount: 0
    };

    await runTransaction(db, async (transaction) => {
      const usernameSnap = await transaction.get(usernameDocRef);
      if (usernameSnap.exists()) {
        const existingData = usernameSnap.data();
        if (existingData.uid !== currentUser.uid) {
          throw new Error(`Username @${cleanUsername} is already taken. Please choose another.`);
        }
      }

      transaction.set(usernameDocRef, { uid: currentUser.uid, createdAt: Date.now() });
      transaction.set(userDocRef, newProfile);
    });

    setUserProfile(newProfile);
    setNeedsProfileSetup(false);
    attachRealtimeListeners(currentUser.uid);
  };

  const updateProfileDetails = async (displayName: string, bio: string, photoURL?: string) => {
    if (!currentUser || !userProfile) throw new Error("No user profile to update");
    const cleanDisplayName = displayName.trim();
    if (!cleanDisplayName || cleanDisplayName.length > 40) {
      throw new Error("Display name must be between 1 and 40 characters.");
    }
    const cleanBio = bio.trim();
    if (cleanBio.length > 160) {
      throw new Error("Bio must be 160 characters or fewer.");
    }

    const userDocRef = doc(db, 'users', currentUser.uid);
    const updates: Record<string, any> = {
      displayName: cleanDisplayName,
      bio: cleanBio,
    };
    if (photoURL !== undefined) {
      updates.photoURL = photoURL;
    }
    await updateDoc(userDocRef, updates);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        authLoading,
        profileLoading,
        authError,
        profileError,
        needsProfileSetup,
        loading: authLoading || profileLoading,
        isAdmin,
        retryAuth,
        retryProfileLoad,
        blockedUserIds,
        blockedByMe,
        blockedMe,
        getBlockState,
        isBlockedWith,
        pendingReports,
        pendingReportsCount,
        loginWithEmail,
        signupWithEmail,
        loginWithGoogle,
        logout,
        createUserProfile,
        updateProfileDetails,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
