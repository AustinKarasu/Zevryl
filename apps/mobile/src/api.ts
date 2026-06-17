import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import type { Announcement, BlogPost, Conversation, DashboardStats, FriendState, Group, Message, Report, User } from './types';

const configuredUrl = normalizeApiUrl(
  process.env.EXPO_PUBLIC_API_URL ||
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
    ''
);
const requestTimeoutMs = 7000;

function normalizeApiUrl(url?: string) {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function token() {
  return SecureStore.getItemAsync('zevryl.accessToken');
}

export async function setTokens(accessToken: string, refreshToken?: string) {
  await SecureStore.setItemAsync('zevryl.accessToken', accessToken);
  if (refreshToken) await SecureStore.setItemAsync('zevryl.refreshToken', refreshToken);
}

export async function clearTokens() {
  await SecureStore.deleteItemAsync('zevryl.accessToken');
  await SecureStore.deleteItemAsync('zevryl.refreshToken');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!configuredUrl) {
    throw new ApiError(0, 'Backend API URL is not configured for this build.');
  }

  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const accessToken = await token();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response: Response;
  try {
    response = await fetch(`${configuredUrl}${path}`, { ...init, headers, signal: controller.signal });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    throw new ApiError(
      0,
      timedOut
        ? `Zevryl backend did not respond at ${configuredUrl}.`
        : `Cannot reach Zevryl backend at ${configuredUrl}. Check that the API is online and this device can access it.`
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let message = 'Something went wrong. Please try again.';
    try {
      const body = await response.json();
      message = body.message || message;
    } catch {
      message = await response.text() || message;
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  url: configuredUrl ?? 'Not configured',
  login: (emailOrUsername: string, password: string) =>
    request<{ user: User; accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ emailOrUsername, password })
    }),
  register: (payload: { fullName: string; email: string; username: string; password: string }) =>
    request<{ user: User; accessToken: string; refreshToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  me: () => request<User>('/me'),
  updateProfile: (payload: Partial<Pick<User, 'displayName' | 'bio' | 'pronouns' | 'customStatus' | 'profileColor'>>) =>
    request<User>('/me/profile', { method: 'PATCH', body: JSON.stringify(payload) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  forgotPassword: (email: string) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  friends: () => request<FriendState>('/friends'),
  requestFriend: (username: string) => request('/friends/request', { method: 'POST', body: JSON.stringify({ username }) }),
  acceptFriend: (id: string) => request(`/friends/requests/${id}/accept`, { method: 'POST' }),
  denyFriend: (id: string) => request(`/friends/requests/${id}/deny`, { method: 'POST' }),
  removeFriend: (id: string) => request(`/friends/${id}`, { method: 'DELETE' }),
  groups: () => request<Group[]>('/groups'),
  createGroup: (payload: { name: string; description: string; friendIds: string[] }) =>
    request<Group>('/groups', { method: 'POST', body: JSON.stringify(payload) }),
  latestAnnouncement: () => request<Announcement | null>('/announcements/latest'),
  announcements: () => request<Announcement[]>('/announcements'),
  markAnnouncementRead: (id: string) => request(`/announcements/${id}/read`, { method: 'POST' }),
  blogs: () => request<BlogPost[]>('/blogs'),
  conversations: () => request<Conversation[]>('/conversations'),
  createDm: (userId: string) => request<Conversation>('/conversations/dm', { method: 'POST', body: JSON.stringify({ userId }) }),
  messages: (conversationId: string) => request<Message[]>(`/messages/${conversationId}`),
  sendMessage: (payload: { conversationId: string; body: string; type?: Message['type']; attachmentUrl?: string }) =>
    request<Message>('/messages', { method: 'POST', body: JSON.stringify(payload) }),
  editMessage: (id: string, body: string) => request<Message>(`/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteMessage: (id: string) => request(`/messages/${id}`, { method: 'DELETE' }),
  callToken: (roomName: string) => request<{ url: string; token: string; roomName: string }>('/calls/token', {
    method: 'POST',
    body: JSON.stringify({ roomName, canPublish: true, canSubscribe: true })
  }),
  adminStats: () => request<DashboardStats>('/admin/stats'),
  adminAnnouncements: () => request<Announcement[]>('/admin/announcements'),
  createAnnouncement: (payload: { title: string; body: string; isPopup: boolean; pinToHome: boolean }) =>
    request<Announcement>('/admin/announcements', { method: 'POST', body: JSON.stringify(payload) }),
  createBlog: (payload: { title: string; body: string; category: string; pinned: boolean }) =>
    request<BlogPost>('/admin/blogs', { method: 'POST', body: JSON.stringify(payload) }),
  grantBadge: (payload: { username: string; badge: string }) =>
    request<User>('/admin/badges/grant', { method: 'POST', body: JSON.stringify(payload) }),
  setRole: (payload: { username: string; role: User['role'] }) =>
    request<User>('/admin/users/role', { method: 'POST', body: JSON.stringify(payload) }),
  reports: () => request<Report[]>('/staff/reports')
};
