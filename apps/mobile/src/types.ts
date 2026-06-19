export type Presence = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';
export type AppTab = 'home' | 'friends' | 'groups' | 'chats' | 'profile' | 'settings' | 'tickets' | 'admin' | 'staff';

export type User = {
  id: string;
  email: string;
  username: string;
  discriminator: string;
  tag: string;
  displayName: string;
  mobile?: string;
  alternateEmail?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  previousAvatars?: string[];
  previousBanners?: string[];
  profileColor: string;
  profileTheme?: 'terria' | 'ember' | 'ocean' | 'mono' | 'midnight' | 'forest' | 'rose' | 'graphite';
  language?: string;
  bio: string;
  pronouns?: string;
  customStatus?: string;
  presence: Presence;
  badges: string[];
  role: 'user' | 'staff' | 'admin';
  usernameChanges?: string[];
  activeAt?: string;
  lastIp?: string;
  privacy?: {
    dmPolicy: 'everyone' | 'friends' | 'none';
    profileLinks: boolean;
  };
  twoFactorEnabled?: boolean;
};

export type FriendRequest = {
  id: string;
  fromUser: User;
  toUser: User;
  status: 'pending' | 'accepted' | 'denied';
  createdAt: string;
};

export type FriendState = {
  friends: User[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  blocked: User[];
};

export type Group = {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  visibility?: 'private' | 'public';
  inviteCode?: string;
  voiceLimit?: number;
  videoLimit?: number;
  avatarUrl?: string;
  bannerUrl?: string;
  slowmodeSeconds: number;
  memberCount: number;
  unreadCount: number;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  type: 'text' | 'image' | 'video' | 'file' | 'gif';
  attachmentUrl?: string;
  isEdited: boolean;
  pinned?: boolean;
  deletedAt?: string;
  createdAt: string;
  readBy: string[];
  reactions: Record<string, string[]>;
};

export type Conversation = {
  id: string;
  kind: 'dm' | 'group';
  title: string;
  subtitle?: string;
  unreadCount: number;
  participants: User[];
  lastMessage?: Message;
  mutedUntil?: string;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  linkUrl?: string;
  linkLabel?: string;
  createdAt: string;
  isPopup: boolean;
  pinToHome: boolean;
  readAt?: string;
};

export type BlogPost = {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  linkUrl?: string;
  linkLabel?: string;
  category: string;
  authorName: string;
  createdAt: string;
  pinned: boolean;
};

export type Report = {
  id: string;
  type: 'message' | 'user' | 'group' | 'media';
  reason: string;
  status: 'open' | 'reviewing' | 'resolved';
  createdAt: string;
  proofUrl?: string;
  reporterId?: string;
  targetUserId?: string;
};

export type Ticket = {
  id: string;
  userId: string;
  type: 'support' | 'report' | 'recovery' | 'bug';
  subject: string;
  body: string;
  proofUrl?: string;
  targetUserId?: string;
  status: 'open' | 'reviewing' | 'resolved' | 'closed';
  claimedBy?: string;
  closedAt?: string;
  createdAt: string;
  updates?: Array<{ by: string; note: string; at: string }>;
};

export type DashboardStats = {
  users: number;
  reports: number;
  activeGroups: number;
  systemHealth: number;
  announcements?: number;
  blogs?: number;
  activeUsers?: number;
  errors?: number;
  altUsers?: number;
  invites?: number;
};

export type BadgeDefinition = {
  id: string;
  name: string;
  icon: string;
  color: string;
};

export type RoleDefinition = {
  id: 'user' | 'staff' | 'admin';
  name: string;
  permissions: string[];
};

export type AppUpdate = {
  version: string;
  title: string;
  notes: string;
  apkUrl?: string;
  required?: boolean;
};
