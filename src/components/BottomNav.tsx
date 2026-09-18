import React from 'react';
import { Home, Search, Plus, Bell, User } from 'lucide-react';

interface BottomNavProps {
  currentTab: 'home' | 'search' | 'create' | 'messages' | 'notifications' | 'profile';
  onSelectTab: (tab: 'home' | 'search' | 'create' | 'messages' | 'notifications' | 'profile') => void;
  unreadNotificationsCount?: number;
  unreadMessagesCount?: number;
}

export function BottomNav({ 
  currentTab, 
  onSelectTab, 
  unreadNotificationsCount = 0
}: BottomNavProps) {
  return (
    <nav 
      id="bottom-navigation-bar" 
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 safe-area-bottom shadow-xs"
    >
      <div className="max-w-md mx-auto flex items-center justify-between h-14 px-2">
        <button
          id="nav-tab-home"
          type="button"
          onClick={() => onSelectTab('home')}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[44px] transition-colors ${
            currentTab === 'home' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
          }`}
          aria-label="Home"
        >
          <Home className={`w-5 h-5 transition-transform ${currentTab === 'home' ? 'scale-105 stroke-[2.5]' : 'stroke-[1.75]'}`} />
          <span className={`text-[10px] mt-0.5 ${currentTab === 'home' ? 'font-bold text-blue-600' : 'font-medium'}`}>Home</span>
        </button>

        <button
          id="nav-tab-search"
          type="button"
          onClick={() => onSelectTab('search')}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[44px] transition-colors ${
            currentTab === 'search' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
          }`}
          aria-label="Explore"
        >
          <Search className={`w-5 h-5 transition-transform ${currentTab === 'search' ? 'scale-105 stroke-[2.5]' : 'stroke-[1.75]'}`} />
          <span className={`text-[10px] mt-0.5 ${currentTab === 'search' ? 'font-bold text-blue-600' : 'font-medium'}`}>Search</span>
        </button>

        <button
          id="nav-tab-create"
          type="button"
          onClick={() => onSelectTab('create')}
          className="flex flex-col items-center justify-center flex-1 h-full min-h-[44px] group"
          aria-label="Create Post"
        >
          <div className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow-sm shadow-blue-500/25 group-active:scale-95 transition">
            <Plus className="w-5 h-5 stroke-[2.5]" />
          </div>
        </button>

        <button
          id="nav-tab-notifications"
          type="button"
          onClick={() => onSelectTab('notifications')}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[44px] relative transition-colors ${
            currentTab === 'notifications' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
          }`}
          aria-label="Activity"
        >
          <div className="relative">
            <Bell className={`w-5 h-5 transition-transform ${currentTab === 'notifications' ? 'scale-105 stroke-[2.5]' : 'stroke-[1.75]'}`} />
            {unreadNotificationsCount > 0 && (
              <span className="absolute -top-1 -right-1.5 min-w-[15px] h-3.5 px-1 rounded-full bg-rose-500 text-white text-[8.5px] font-bold flex items-center justify-center ring-2 ring-white">
                {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
              </span>
            )}
          </div>
          <span className={`text-[10px] mt-0.5 ${currentTab === 'notifications' ? 'font-bold text-blue-600' : 'font-medium'}`}>Activity</span>
        </button>

        <button
          id="nav-tab-profile"
          type="button"
          onClick={() => onSelectTab('profile')}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[44px] transition-colors ${
            currentTab === 'profile' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
          }`}
          aria-label="Profile"
        >
          <User className={`w-5 h-5 transition-transform ${currentTab === 'profile' ? 'scale-105 stroke-[2.5]' : 'stroke-[1.75]'}`} />
          <span className={`text-[10px] mt-0.5 ${currentTab === 'profile' ? 'font-bold text-blue-600' : 'font-medium'}`}>Profile</span>
        </button>
      </div>
    </nav>
  );
}
