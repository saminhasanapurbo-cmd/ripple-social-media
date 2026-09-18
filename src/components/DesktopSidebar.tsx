import React, { useState } from 'react';
import { 
  Home, Search, MessageCircle, Bell, User, Shield, Plus, Waves, LogOut, MoreHorizontal 
} from 'lucide-react';
import type { UserProfile } from '../types';

interface DesktopSidebarProps {
  currentTab: 'home' | 'search' | 'create' | 'messages' | 'notifications' | 'profile';
  onSelectTab: (tab: 'home' | 'search' | 'create' | 'messages' | 'notifications' | 'profile') => void;
  currentUser: UserProfile;
  unreadNotificationsCount?: number;
  unreadMessagesCount?: number;
  isAdmin?: boolean;
  pendingReportsCount?: number;
  onOpenAdmin?: () => void;
  onOpenCreate: () => void;
  onLogout: () => void;
}

export function DesktopSidebar({
  currentTab,
  onSelectTab,
  currentUser,
  unreadNotificationsCount = 0,
  unreadMessagesCount = 0,
  isAdmin = false,
  pendingReportsCount = 0,
  onOpenAdmin,
  onOpenCreate,
  onLogout
}: DesktopSidebarProps) {
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const navItems = [
    { id: 'home' as const, label: 'Home', icon: Home, badge: 0 },
    { id: 'search' as const, label: 'Explore', icon: Search, badge: 0 },
    { id: 'messages' as const, label: 'Messages', icon: MessageCircle, badge: unreadMessagesCount },
    { id: 'notifications' as const, label: 'Activity', icon: Bell, badge: unreadNotificationsCount },
    { id: 'profile' as const, label: 'Profile', icon: User, badge: 0 }
  ];

  return (
    <aside id="desktop-sidebar" className="hidden md:flex flex-col justify-between w-60 xl:w-68 h-screen sticky top-0 px-3 xl:px-4 py-4 border-r border-slate-200/80 bg-white select-none shrink-0">
      <div className="flex flex-col space-y-4">
        <div onClick={() => onSelectTab('home')} className="flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer hover:bg-slate-50 transition w-fit group">
          <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition">
            <Waves className="w-5 h-5" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-lg tracking-tight text-slate-900">Ripple</span>
            <span className="px-1.5 py-0.2 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">Beta</span>
            <span className="text-[10px] text-slate-400 font-medium">v41</span>
          </div>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                id={`sidebar-nav-${item.id}`}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition text-sm font-medium ${
                  isActive ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-5 h-5 transition-transform ${isActive ? 'stroke-[2.5] text-blue-600' : 'stroke-[1.75]'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge > 0 && (
                  <span className="px-1.5 py-0.5 min-w-[18px] text-[10px] font-bold rounded-full bg-blue-600 text-white flex items-center justify-center">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </button>
            );
          })}

          {isAdmin && onOpenAdmin && (
            <button id="sidebar-nav-admin" type="button" onClick={onOpenAdmin} className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition text-sm font-medium text-amber-800 hover:bg-amber-50">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-amber-600" />
                <span>Moderation</span>
              </div>
              {pendingReportsCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-rose-500 text-white">{pendingReportsCount}</span>
              )}
            </button>
          )}
        </nav>

        <div className="pt-2">
          <button id="sidebar-create-post-btn" type="button" onClick={onOpenCreate} className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-xs transition active:scale-[0.99]">
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Post</span>
          </button>
        </div>
      </div>

      <div className="relative pt-2 border-t border-slate-100">
        {showAccountMenu && (
          <div id="sidebar-account-dropdown" className="absolute bottom-full left-0 mb-2 w-full bg-white rounded-2xl shadow-xl border border-slate-200/90 p-1.5 z-30 animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="px-3 py-2 border-b border-slate-100">
              <p className="text-xs font-bold text-slate-900 truncate">{currentUser.displayName}</p>
              <p className="text-[11px] text-slate-400 truncate">@{currentUser.username}</p>
            </div>
            <button type="button" onClick={() => { setShowAccountMenu(false); onSelectTab('profile'); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 rounded-xl transition">
              <User className="w-4 h-4 text-slate-400" />
              <span>View Profile</span>
            </button>
            <button type="button" onClick={() => { setShowAccountMenu(false); onLogout(); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 rounded-xl transition">
              <LogOut className="w-4 h-4 text-rose-500" />
              <span>Log out @{currentUser.username}</span>
            </button>
          </div>
        )}

        <button type="button" onClick={() => setShowAccountMenu(!showAccountMenu)} className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-slate-100/80 transition group text-left">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src={currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${currentUser.username}`} alt={currentUser.displayName} className="w-9 h-9 rounded-full object-cover ring-1 ring-slate-200 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 truncate leading-tight group-hover:text-blue-600 transition">{currentUser.displayName}</p>
              <p className="text-[11px] text-slate-400 truncate">@{currentUser.username}</p>
            </div>
          </div>
          <MoreHorizontal className="w-4 h-4 text-slate-400 group-hover:text-slate-600 shrink-0 ml-1" />
        </button>
      </div>
    </aside>
  );
}
