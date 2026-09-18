export interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  bio: string;
  photoURL?: string;
  createdAt: number | any;
  followersCount: number;
  followingCount: number;
  postsCount: number;
}

export interface UserStats {
  profileViews: number;
}

export interface AdminRecord {
  role?: string;
  createdAt?: number | any;
}

export interface Post {
  id: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorPhotoURL?: string;
  content: string;
  imageUrl?: string;
  createdAt: number | any;
  likesCount?: number;
  commentsCount?: number;
  ripplesCount?: number;
  parentPostId?: string | null;
  parentAuthorUsername?: string | null;
  rootPostId?: string | null;
  rippleDepth?: number;
  isDeleted?: boolean;
  anonymous?: boolean;
  viewCount?: number;
  moderationStatus?: 'active' | 'removed';
  removedReasonCode?: string;
  removedAt?: number | any;
  removedBy?: string;
  contextLabel?: string;
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorPhotoURL?: string;
  content: string;
  createdAt: number | any;
}

export interface NotificationItem {
  id: string;
  recipientId: string;
  actorId: string;
  actorUsername: string;
  actorDisplayName: string;
  actorPhotoURL?: string;
  type: 'like' | 'comment' | 'follow' | 'ripple';
  postId?: string;
  commentId?: string;
  read: boolean;
  createdAt: number | any;
}

export interface ReportItem {
  id: string;
  reporterId: string;
  targetType: 'post' | 'user';
  targetId: string;
  reason: 'spam' | 'scam' | 'impersonation' | 'deceptive_content' | 'threat' | 'harassment' | 'doxxing' | 'sexual_exploitation' | 'malware' | 'illegal_content' | 'other' | string;
  details?: string;
  createdAt: number | any;
  status: 'pending' | 'resolved' | 'dismissed';
}

export type BlockState = 'none' | 'blocked_by_me' | 'blocked_me';

export interface ConversationParticipantSummary {
  uid: string;
  username: string;
  displayName: string;
  photoURL?: string;
  isDeleted?: boolean;
}

export interface Conversation {
  id: string;
  participants: string[];
  participantDetails?: {
    [uid: string]: {
      username: string;
      displayName: string;
      photoURL?: string;
    };
  };
  createdAt: number | any;
  updatedAt: number | any;
  lastMessageText?: string;
  lastMessageSenderId?: string;
  lastMessageAt?: number | any;
  lastMessageId?: string;
  unreadCount?: {
    [uid: string]: number;
  };
  status?: 'pending' | 'accepted' | 'declined';
  requestedBy?: string;
  typing?: {
    [uid: string]: any;
  };
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  createdAt: number | any;
  isPending?: boolean;
  failed?: boolean;
  replyToMessageId?: string;
  imageUrl?: string;
  messageType?: 'text' | 'view_once_image';
  mediaPath?: string;
  mediaStatus?: 'available' | 'consuming' | 'viewed' | 'expired';
  mediaExpiresAt?: number | any;
  mediaViewedAt?: number | any;
  mediaViewedBy?: string;
  reactions?: {
    [uid: string]: string;
  };
}
