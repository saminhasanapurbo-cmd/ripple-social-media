import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { formatTime } from '../services/api';
import type { NotificationItem } from '../types';
import { Bell, Heart, MessageCircle, UserPlus, Waves, Check, Shield, Loader2 } from 'lucide-react';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

interface NotificationsViewProps {
  onSelectPost: (postId: string) => void;
  onSelectUser: (username: string) => void;
  onOpenAdmin?: () => void;
}

export function NotificationsView({ onSelectPost, onSelectUser, onOpenAdmin }: NotificationsViewProps) {
  const { userProfile, isAdmin, pendingReports, pendingReportsCount, blockedUserIds } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [markingRead, setMarkingRead] = useState(false);

  useEffect(() => {
    if (!userProfile) return;
    const q = query(
      collection(db, 'notifications'),
      where('recipientId', '==', userProfile.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const items: NotificationItem[] = [];
      snap.forEach(d => {
        items.push({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) });
      });
      setNotifications(items);
      setLoading(false);
    }, (err) => {
      console.error("Notifications err:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userProfile?.uid]);

  const visibleNotifications = notifications.filter(n => !blockedUserIds.includes(n.actorId));

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const markAllAsRead = async () => {
    if (markingRead) return;
    const unread = visibleNotifications.filter(n => !n.read);
    if (unread.length === 0) return;

    setMarkingRead(true);
    setErrorMsg(null);

    // Optimistically mark all visible items as read in local state
    setNotifications(prev => prev.map(item => ({ ...item, read: true })));

    try {
      const batch = writeBatch(db);
      unread.forEach((n) => {
        const notifRef = doc(db, 'notifications', n.id);
        batch.update(notifRef, { read: true });
      });
      await batch.commit();
    } catch (err) {
      console.error("Mark all notifications read failed:", err);
      setErrorMsg("Failed to mark all as read. Please try again.");
    } finally {
      setMarkingRead(false);
    }
  };

  const handleNotificationClick = async (n: NotificationItem) => {
    if (!n.read) {
      // Optimistic local state update
      setNotifications(prev => prev.map(item => item.id === n.id ? { ...item, read: true } : item));
      try {
        await updateDoc(doc(db, 'notifications', n.id), { read: true });
      } catch (err) {
        console.error("Failed to mark single notification as read:", err);
      }
    }

    if (n.type === 'follow') {
      onSelectUser(n.actorUsername);
    } else if (n.postId) {
      onSelectPost(n.postId);
    }
  };

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'like':
        return <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />;
      case 'comment':
        return <MessageCircle className="w-4 h-4 text-blue-600 fill-blue-100" />;
      case 'follow':
        return <UserPlus className="w-4 h-4 text-indigo-600" />;
      case 'ripple':
        return <Waves className="w-4 h-4 text-blue-600" />;
      default:
        return <Bell className="w-4 h-4 text-slate-400" />;
    }
  };

  const getText = (n: NotificationItem) => {
    switch (n.type) {
      case 'like':
        return 'liked your post';
      case 'comment':
        return 'commented on your post';
      case 'follow':
        return 'started following you';
      case 'ripple':
        return 'continued your Ripple with a new thought';
    }
  };

  return (
    <div id="notifications-view" className="w-full">
      {/* Top Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md p-3.5 sm:p-4 border-b border-slate-200/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-blue-600" />
          <h2 className="font-extrabold text-slate-900 text-sm">Activity</h2>
        </div>
        {visibleNotifications.some(n => !n.read) && (
          <button
            type="button"
            id="mark-all-read-btn"
            disabled={markingRead}
            onClick={markAllAsRead}
            className="text-[11px] font-bold text-blue-600 hover:text-blue-700 disabled:opacity-50 transition flex items-center gap-1 cursor-pointer"
          >
            {markingRead ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            <span>{markingRead ? 'Marking...' : 'Mark all read'}</span>
          </button>
        )}
      </div>

      <div className="p-3.5 sm:p-4 space-y-3">
        {/* Admin Alerts Section (for verified admins only) */}
        {isAdmin && (
          <div id="admin-alerts-section" className="mb-4 bg-amber-50/80 border border-amber-200/80 rounded-2xl p-3.5 shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-amber-700" />
                <span className="text-xs font-bold text-amber-900">Admin alerts</span>
                {pendingReportsCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-amber-600 text-white text-[10px] font-bold leading-tight">
                    {pendingReportsCount}
                  </span>
                )}
              </div>
              {onOpenAdmin && (
                <button
                  onClick={onOpenAdmin}
                  className="text-[11px] font-bold text-amber-800 hover:text-amber-950 underline transition"
                >
                  Open Queue
                </button>
              )}
            </div>

            {pendingReports.length === 0 ? (
              <p className="text-[11px] text-amber-700/80">No pending reports awaiting moderation review.</p>
            ) : (
              <div className="space-y-2 mt-2">
                {pendingReports.slice(0, 5).map((report) => (
                  <div
                    key={report.id}
                    onClick={onOpenAdmin}
                    className="p-2.5 bg-white border border-amber-200/70 rounded-xl cursor-pointer hover:border-amber-300 transition shadow-2xs flex items-center justify-between gap-2"
                  >
                    <div className="text-xs">
                      <p className="font-semibold text-amber-950">
                        {report.targetType === 'post'
                          ? 'New post report awaiting review'
                          : 'New user report awaiting review'}
                      </p>
                      <p className="text-[11px] text-amber-800/80 line-clamp-1">
                        Reason: {report.reason}
                      </p>
                      <span className="text-[10px] text-amber-600/70">{formatTime(report.createdAt)}</span>
                    </div>
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100/70 px-2 py-1 rounded-lg shrink-0">
                      Review
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error notification banner */}
        {errorMsg && (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex items-center justify-between">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-red-700 hover:text-red-900 text-[10px] font-bold underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Social Notifications List */}
        <div className="space-y-2">
          {loading ? (
            <div className="py-20 text-center text-slate-400 text-xs">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin mx-auto mb-2" />
              <div>Checking activity...</div>
            </div>
          ) : visibleNotifications.length === 0 ? (
            <div className="py-24 text-center text-slate-400 text-xs">
              No activity yet. When other members like, follow, or ripple your posts, you will see them here!
            </div>
          ) : (
            visibleNotifications.map(n => (
              <div
                key={n.id}
                onClick={() => handleNotificationClick(n)}
                className={`p-3.5 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-3 ${
                  n.read
                    ? 'bg-white border-slate-200/80 hover:border-slate-300'
                    : 'bg-blue-50/50 border-blue-100 hover:border-blue-200 shadow-2xs'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    <img
                      src={n.actorPhotoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${n.actorUsername}`}
                      alt={n.actorDisplayName}
                      className="w-10 h-10 rounded-full object-cover ring-1 ring-slate-200"
                    />
                    <div className="absolute -bottom-1 -right-1 bg-white p-0.5 rounded-full shadow-xs">
                      {getIcon(n.type)}
                    </div>
                  </div>

                  <div className="text-xs min-w-0">
                    <p className="text-slate-900 leading-snug">
                      <strong className="font-bold hover:underline">{n.actorDisplayName}</strong>{' '}
                      <span className="text-slate-600">{getText(n)}</span>
                    </p>
                    <span className="text-[11px] text-slate-400 mt-0.5 block font-medium">
                      {formatTime(n.createdAt)}
                    </span>
                  </div>
                </div>

                {!n.read && (
                  <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
