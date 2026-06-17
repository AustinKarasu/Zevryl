export type Presence = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';
export type AppTab = 'home' | 'friends' | 'groups' | 'chats' | 'profile' | 'settings' | 'admin' | 'staff';

export type User = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  bannerUrl?: string;
  profileColor: string;
  bio: string;
  pronouns?: string;
  customStatus?: string;
  presence: Presence;
  badges: string[];
  role: 'user' | 'staff' | 'admin';
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
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  isPopup: boolean;
  pinToHome: boolean;
  readAt?: string;
};

export type BlogPost = {
  id: string;
  title: string;
  body: string;
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
};

export type DashboardStats = {
  users: number;
  reports: number;
  activeGroups: number;
  systemHealth: number;
  announcements?: number;
  blogs?: number;
};
