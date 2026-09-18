import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { formatTime } from '../services/api';
import type { ReportItem } from '../types';
import { Shield, Check, Trash2, ArrowLeft, AlertTriangle, Clock } from 'lucide-react';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';

interface AdminViewProps {
  onBack: () => void;
}

export function AdminView({ onBack }: AdminViewProps) {
  const { currentUser, isAdmin, pendingReportsCount } = useAuth();
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'resolved' | 'all'>('pending');
  const [actionMessage, setActionMessage] = useState('');

  // Real-time listener for all reports in Admin view
  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const q = query(
      collection(db, 'reports'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const list: ReportItem[] = [];
      snap.forEach(d => {
        list.push({ id: d.id, ...(d.data() as Omit<ReportItem, 'id'>) });
      });
      setReports(list);
      setLoading(false);
    }, (err) => {
      console.error("Admin real-time reports error:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="p-8 text-center max-w-md mx-auto">
        <Shield className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">Access Restricted</h2>
        <p className="text-xs text-slate-500 mt-1">You must be the designated admin to access the moderation dashboard.</p>
        <button
          onClick={onBack}
          className="mt-4 px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl"
        >
          Return to Profile
        </button>
      </div>
    );
  }

  const handleResolve = async (reportId: string) => {
    try {
      await updateDoc(doc(db, 'reports', reportId), { status: 'resolved' });
      setActionMessage("Report marked as resolved.");
      setTimeout(() => setActionMessage(''), 3000);
    } catch (err) {
      console.error(err);
      setActionMessage("Failed to update report status.");
      setTimeout(() => setActionMessage(''), 3000);
    }
  };

  const handleDeleteReportedPost = async (reportId: string, postId: string) => {
    try {
      // 1. Audit
      const auditId = 'audit_' + Date.now() + Math.random().toString(36).substring(2);
      await setDoc(doc(db, 'moderationAudit', auditId), {
        moderatorUid: currentUser?.uid,
        action: 'remove_post',
        postId,
        reason: 'Policy violation',
        timestamp: Date.now()
      });

      // 2. Remove post
      await updateDoc(doc(db, 'posts', postId), { 
        moderationStatus: 'removed',
        isDeleted: true,
        removedBy: currentUser?.uid || 'admin',
        removedReasonCode: 'policy_violation',
        removedAt: Date.now(),
        // Purge content
        content: '[Content removed by moderator]',
        imageUrl: null,
      });

      // 3. Resolve report
      await updateDoc(doc(db, 'reports', reportId), { status: 'resolved' });

      setActionMessage("Post successfully removed by administrator.");
      setTimeout(() => setActionMessage(''), 3000);
    } catch (err) {
      console.error(err);
      setActionMessage("Failed to remove post. Check permissions.");
      setTimeout(() => setActionMessage(''), 3000);
    }
  };
  
  const handleAddContext = async (reportId: string, postId: string) => {
    const contextText = prompt("Enter context label to display under this post:");
    if (!contextText) return;
    
    try {
      const auditId = 'audit_' + Date.now() + Math.random().toString(36).substring(2);
      await setDoc(doc(db, 'moderationAudit', auditId), {
        moderatorUid: currentUser?.uid,
        action: 'add_context',
        postId,
        reason: contextText,
        timestamp: Date.now()
      });

      await updateDoc(doc(db, 'posts', postId), { 
        contextLabel: contextText
      });
      await updateDoc(doc(db, 'reports', reportId), { status: 'resolved' });
      setActionMessage("Context added successfully.");
      setTimeout(() => setActionMessage(''), 3000);
    } catch (err) {
      console.error(err);
      setActionMessage("Failed to add context.");
      setTimeout(() => setActionMessage(''), 3000);
    }
  };
  
  const handleRevealAnonymous = async (postId: string) => {
    const reason = prompt("Enter reason for revealing anonymous author identity:");
    if (!reason) return;
    
    try {
      const revealFn = httpsCallable<any, { ownerId: string }>(functions, 'revealAnonymousAuthor');
      const result = await revealFn({ postId, reason });
      alert("Anonymous Author UID:\n" + result.data.ownerId);
    } catch (err) {
      console.error(err);
      alert("Failed to reveal identity.");
    }
  };

  const filteredReports = reports.filter(r => {
    if (filter === 'pending') return r.status === 'pending';
    if (filter === 'resolved') return r.status === 'resolved';
    return true;
  });

  const pendingCount = reports.filter(r => r.status === 'pending').length;
  const resolvedCount = reports.filter(r => r.status === 'resolved').length;

  return (
    <div id="admin-view" className="pb-24 max-w-md mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md p-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm">
              <Shield className="w-4 h-4 text-amber-600" />
              <span>Admin Moderation</span>
              {pendingCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-extrabold leading-tight">
                  {pendingCount}
                </span>
              )}
            </div>
            <span className="text-[11px] text-slate-400">Real-time moderation queue</span>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex border-b border-slate-200 bg-white">
        <button
          onClick={() => setFilter('pending')}
          className={`flex-1 py-2.5 text-center text-xs font-semibold transition border-b-2 flex items-center justify-center gap-1.5 ${
            filter === 'pending' ? 'border-amber-600 text-amber-700 font-bold' : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Pending ({pendingCount})</span>
        </button>
        <button
          onClick={() => setFilter('resolved')}
          className={`flex-1 py-2.5 text-center text-xs font-semibold transition border-b-2 flex items-center justify-center gap-1.5 ${
            filter === 'resolved' ? 'border-amber-600 text-amber-700 font-bold' : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Check className="w-3.5 h-3.5" />
          <span>Resolved ({resolvedCount})</span>
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 py-2.5 text-center text-xs font-semibold transition border-b-2 flex items-center justify-center gap-1.5 ${
            filter === 'all' ? 'border-amber-600 text-amber-700 font-bold' : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <span>All ({reports.length})</span>
        </button>
      </div>

      {/* Reports List */}
      <div className="p-4 space-y-3">
        {actionMessage && (
          <div className="p-3 bg-teal-50 border border-teal-200 text-teal-800 text-xs rounded-xl font-medium">
            {actionMessage}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-slate-400 text-xs">
            <span className="inline-block w-5 h-5 border-2 border-amber-500/40 border-t-amber-600 rounded-full animate-spin mb-2" />
            <div>Streaming moderation queue...</div>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="py-20 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-100 p-6">
            <Check className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="font-semibold text-slate-700">All clear!</p>
            <p className="text-[11px] text-slate-400 mt-1">
              {filter === 'pending' ? 'No pending reports awaiting moderation review.' : 'No reports found in this view.'}
            </p>
          </div>
        ) : (
          filteredReports.map(r => (
            <div
              key={r.id}
              className={`p-4 rounded-2xl border bg-white transition ${
                r.status === 'resolved' ? 'opacity-65 border-slate-200' : 'border-amber-200/90 shadow-2xs'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    r.status === 'resolved' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {r.status.toUpperCase()}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-700">
                    Reported {r.targetType.toUpperCase()}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">
                  {formatTime(r.createdAt)}
                </span>
              </div>

              <div className="mt-2 text-xs text-slate-800">
                <strong className="text-rose-600">Reason:</strong> {r.reason}
              </div>

              {r.details && (
                <div className="mt-1 text-xs text-slate-600 italic">
                  "{r.details}"
                </div>
              )}

              <div className="mt-3 text-[10px] text-slate-400 font-mono">
                Target ID: {r.targetId}
              </div>

              {r.status !== 'resolved' && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                  {r.targetType === 'post' && (
                    <>
                      <button
                        onClick={() => handleRevealAnonymous(r.targetId)}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition shadow-2xs"
                      >
                        Reveal Anon
                      </button>
                      <button
                        onClick={() => handleAddContext(r.id, r.targetId)}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition shadow-2xs"
                      >
                        Add Context
                      </button>
                      <button
                        onClick={() => handleDeleteReportedPost(r.id, r.targetId)}
                        className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition flex items-center gap-1 shadow-2xs"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove Post</span>
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleResolve(r.id)}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Dismiss / Resolve</span>
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
