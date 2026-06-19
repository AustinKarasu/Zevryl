import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { AdminAnalytics, Announcement, AppUpdate, AuditLog, BadgeDefinition, BlogPost, Conversation, DashboardStats, DeviceSession, FriendState, GifResult, Group, Message, Report, RoleDefinition, StaffAnalytics, Ticket, User } from './types';

const configuredUrl = normalizeApiUrl(
  process.env.EXPO_PUBLIC_API_URL ||
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
    ''
);
const requestTimeoutMs = 15000;
const accessRefreshSkewSeconds = 300;
let refreshInFlight: Promise<boolean> | null = null;

function deviceLabel() {
  return [
    Device.deviceName,
    Device.manufacturer,
    Device.modelName,
    Platform.OS,
    Platform.Version
  ].filter(Boolean).join(' / ');
}

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

function friendlyApiMessage(input: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!input) return fallback;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return fallback;
    try {
      return friendlyApiMessage(JSON.parse(trimmed), fallback);
    } catch {
      return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
    }
  }
  if (Array.isArray(input)) {
    return input.map(item => friendlyApiMessage(item, '')).filter(Boolean).join('\n') || fallback;
  }
  if (typeof input === 'object') {
    const body = input as Record<string, unknown>;
    if (typeof body.message === 'string' && body.message.trim()) return friendlyApiMessage(body.message, fallback);
    if (typeof body.error === 'string' && body.error.trim()) return friendlyApiMessage(body.error, fallback);
    const issues = body.issues || body.errors;
    if (Array.isArray(issues)) {
      const lines = issues.map(issue => {
        if (typeof issue === 'string') return issue;
        if (!issue || typeof issue !== 'object') return '';
        const record = issue as Record<string, unknown>;
        const path = Array.isArray(record.path) ? record.path.join('.') : '';
        const message = typeof record.message === 'string' ? record.message : '';
        return [path, message].filter(Boolean).join(': ');
      }).filter(Boolean);
      if (lines.length) return lines.join('\n');
    }
  }
  return fallback;
}

async function responseErrorMessage(response: Response) {
  const fallback = response.status === 401
    ? 'Please sign in again.'
    : response.status === 403
      ? 'You do not have permission for this action.'
      : response.status === 404
        ? 'This item was not found.'
        : 'Something went wrong. Please try again.';
  const text = await response.text();
  return friendlyApiMessage(text, fallback);
}

async function token() {
  return SecureStore.getItemAsync('zevryl.accessToken');
}

async function refreshToken() {
  return SecureStore.getItemAsync('zevryl.refreshToken');
}

export async function setTokens(accessToken: string, refreshToken?: string) {
  await SecureStore.setItemAsync('zevryl.accessToken', accessToken);
  if (refreshToken) await SecureStore.setItemAsync('zevryl.refreshToken', refreshToken);
}

export async function clearTokens() {
  await SecureStore.deleteItemAsync('zevryl.accessToken');
  await SecureStore.deleteItemAsync('zevryl.refreshToken');
}

function decodeJwtExp(jwt: string): number | null {
  const payload = jwt.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map(char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join('')
    );
    const parsed = JSON.parse(json) as { exp?: unknown };
    return typeof parsed.exp === 'number' ? parsed.exp : null;
  } catch {
    return null;
  }
}

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshSessionNow().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function refreshSessionNow(): Promise<boolean> {
  const savedRefreshToken = await refreshToken();
  if (!savedRefreshToken || !configuredUrl) return false;
  const response = await fetch(`${configuredUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: savedRefreshToken })
  }).catch(() => null);
  if (!response?.ok) {
    if (response?.status === 401) await clearTokens();
    return false;
  }
  const data = await response.json() as { accessToken: string; refreshToken?: string };
  await setTokens(data.accessToken, data.refreshToken || savedRefreshToken);
  return true;
}

async function validAccessToken() {
  const accessToken = await token();
  if (!accessToken) return null;
  const exp = decodeJwtExp(accessToken);
  const expiresSoon = exp !== null && exp <= Math.floor(Date.now() / 1000) + accessRefreshSkewSeconds;
  if (expiresSoon && await refreshSession()) return token();
  if (exp !== null && exp <= Math.floor(Date.now() / 1000)) {
    await clearTokens();
    return null;
  }
  return accessToken;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!configuredUrl) {
    throw new ApiError(0, 'Backend API URL is not configured for this build.');
  }

  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('X-Zevryl-Device', deviceLabel() || 'Mobile app');
  const accessToken = await validAccessToken();
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
        ? `Zevryl API is taking too long to respond at ${configuredUrl}. Please try again.`
        : `Cannot reach Zevryl backend at ${configuredUrl}. Check that the API is online and this device can access it.`
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    if (response.status === 401 && retry && await refreshSession()) return request<T>(path, init, false);
    if (response.status === 401) await clearTokens();
    throw new ApiError(response.status, await responseErrorMessage(response));
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function requestText(path: string, init: RequestInit = {}, retry = true): Promise<string> {
  if (!configuredUrl) throw new ApiError(0, 'Backend API URL is not configured for this build.');
  const headers = new Headers(init.headers);
  headers.set('X-Zevryl-Device', deviceLabel() || 'Mobile app');
  const accessToken = await validAccessToken();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${configuredUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    if (response.status === 401 && retry && await refreshSession()) return requestText(path, init, false);
    if (response.status === 401) await clearTokens();
    throw new ApiError(response.status, await responseErrorMessage(response));
  }
  return response.text();
}

async function uploadFile(asset: { uri: string; name?: string | null; mimeType?: string | null }, retry = true) {
  if (!configuredUrl) throw new ApiError(0, 'Backend API URL is not configured for this build.');
  const headers = new Headers();
  headers.set('X-Zevryl-Device', deviceLabel() || 'Mobile app');
  const accessToken = await validAccessToken();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const form = new FormData();
  form.append('file', {
    uri: asset.uri,
    name: asset.name || 'document',
    type: asset.mimeType || 'application/octet-stream'
  } as unknown as Blob);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  let response: Response;
  try {
    response = await fetch(`${configuredUrl}/uploads`, {
      method: 'POST',
      headers,
      body: form,
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    throw new ApiError(0, timedOut ? 'Upload timed out. Please try again on a stronger connection.' : `Cannot reach Zevryl backend at ${configuredUrl}.`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    if (response.status === 401 && retry && await refreshSession()) return uploadFile(asset, false);
    if (response.status === 401) await clearTokens();
    throw new ApiError(response.status, await responseErrorMessage(response));
  }
  return response.json() as Promise<{ url: string; filename: string; contentType: string }>;
}

export const api = {
  url: configuredUrl ?? 'Not configured',
  login: (emailOrUsername: string, password: string, twoFactorCode?: string) =>
    request<{ user: User; accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ emailOrUsername, password, twoFactorCode })
    }),
  register: (payload: { fullName: string; email: string; username: string; password: string }) =>
    request<{ user: User; accessToken: string; refreshToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  me: () => request<User>('/me'),
  updateProfile: (payload: Partial<Pick<User, 'displayName' | 'bio' | 'pronouns' | 'customStatus' | 'profileColor' | 'profileTheme' | 'density' | 'avatarUrl' | 'bannerUrl' | 'presence' | 'language'>>) =>
    request<User>('/me/profile', { method: 'PATCH', body: JSON.stringify(payload) }),
  updateAccount: (payload: { username?: string; discriminator?: string; mobile?: string; alternateEmail?: string }) =>
    request<User>('/me/account', { method: 'PATCH', body: JSON.stringify(payload) }),
  updatePrivacy: (payload: { dmPolicy: 'everyone' | 'friends' | 'none'; profileLinks: boolean }) =>
    request<User>('/me/privacy', { method: 'PATCH', body: JSON.stringify(payload) }),
  setup2fa: () => request<{ secret: string; otpauthUrl: string; qrUrl: string }>('/me/2fa/setup', { method: 'POST' }),
  verify2fa: (code: string) => request<User>('/me/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) }),
  disable2fa: (code: string) => request<User>('/me/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  logoutAll: () => request('/auth/logout-all', { method: 'POST' }),
  forgotPassword: (email: string) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  sessions: () => request<DeviceSession[]>('/me/sessions'),
  friends: () => request<FriendState>('/friends'),
  requestFriend: (username: string) => request('/friends/request', { method: 'POST', body: JSON.stringify({ username }) }),
  acceptFriend: (id: string) => request(`/friends/requests/${id}/accept`, { method: 'POST' }),
  denyFriend: (id: string) => request(`/friends/requests/${id}/deny`, { method: 'POST' }),
  cancelFriendRequest: (id: string) => request(`/friends/requests/${id}`, { method: 'DELETE' }),
  removeFriend: (id: string) => request(`/friends/${id}`, { method: 'DELETE' }),
  friendAction: (id: string, action: 'mute' | 'unmute' | 'block', payload: { hours?: number } = {}) =>
    request(`/friends/${id}/${action}`, { method: 'POST', body: JSON.stringify(payload) }),
  unblockFriend: (id: string) => request(`/friends/${id}/unblock`, { method: 'POST' }),
  groups: () => request<Group[]>('/groups'),
  createGroup: (payload: { name: string; description: string; friendIds: string[]; visibility?: 'private' | 'public'; voiceLimit?: number; videoLimit?: number }) =>
    request<Group>('/groups', { method: 'POST', body: JSON.stringify(payload) }),
  groupInvite: (id: string) => request<{ inviteCode: string; inviteUrl: string }>(`/groups/${id}/invite`, { method: 'POST' }),
  joinGroupInvite: (inviteCode: string) => request<Group>(`/groups/invites/${inviteCode}/join`, { method: 'POST' }),
  deleteGroup: (id: string, confirmName: string) => request(`/groups/${id}`, { method: 'DELETE', body: JSON.stringify({ confirmName }) }),
  latestAnnouncement: () => request<Announcement | null>('/announcements/latest'),
  announcements: () => request<Announcement[]>('/announcements'),
  markAnnouncementRead: (id: string) => request(`/announcements/${id}/read`, { method: 'POST' }),
  blogs: () => request<BlogPost[]>('/blogs'),
  conversations: () => request<Conversation[]>('/conversations'),
  createDm: (userId: string) => request<Conversation>('/conversations/dm', { method: 'POST', body: JSON.stringify({ userId }) }),
  messages: (conversationId: string, query?: { q?: string; pinned?: boolean }) => {
    const params = new URLSearchParams();
    if (query?.q) params.set('q', query.q);
    if (query?.pinned) params.set('pinned', '1');
    const suffix = params.toString() ? `?${params}` : '';
    return request<Message[]>(`/messages/${conversationId}${suffix}`);
  },
  sendMessage: (payload: { conversationId: string; body: string; type?: Message['type']; attachmentUrl?: string }) =>
    request<Message>('/messages', { method: 'POST', body: JSON.stringify(payload) }),
  uploadFile,
  sendTyping: (conversationId: string) => request('/typing/' + conversationId, { method: 'POST' }),
  typingUsers: (conversationId: string) => request<Array<{ id: string; displayName: string }>>('/typing/' + conversationId),
  searchGifs: (q: string, limit = 40) => request<GifResult[]>(`/gifs/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  editMessage: (id: string, body: string) => request<Message>(`/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  pinMessage: (id: string) => request<Message>(`/messages/${id}/pin`, { method: 'POST' }),
  deleteMessage: (id: string) => request(`/messages/${id}`, { method: 'DELETE' }),
  conversationAction: (id: string, action: 'mute' | 'block' | 'unfriend', payload: { hours?: number } = {}) =>
    request(`/conversations/${id}/${action}`, { method: 'POST', body: JSON.stringify(payload) }),
  tickets: () => request<Ticket[]>('/tickets'),
  createTicket: (payload: { type: Ticket['type']; subject: string; body: string; proofUrl?: string; targetUserId?: string }) =>
    request<Ticket>('/tickets', { method: 'POST', body: JSON.stringify(payload) }),
  callToken: (roomName: string, notify = true) => request<{ url: string; token: string; roomName: string }>('/calls/token', {
    method: 'POST',
    body: JSON.stringify({ roomName, canPublish: true, canSubscribe: true, notify })
  }),
  registerPushToken: (token: string, platform: string) => request('/notifications/register', { method: 'POST', body: JSON.stringify({ token, platform }) }),
  latestUpdate: () => request<AppUpdate>('/app/latest'),
  downloadConversation: (conversationId: string) => requestText(`/conversations/${conversationId}/download`),
  updateTicket: (id: string, payload: { status?: Ticket['status']; note?: string; action?: 'claim' | 'close' | 'reopen' | 'delete' | 'ban' }) =>
    request<Ticket>(`/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteTicket: (id: string) => request(`/tickets/${id}`, { method: 'DELETE' }),
  downloadTicket: (id: string) => requestText(`/tickets/${id}/download`),
  adminStats: () => request<DashboardStats>('/admin/stats'),
  adminAnnouncements: () => request<Announcement[]>('/admin/announcements'),
  createAnnouncement: (payload: { title: string; body: string; isPopup: boolean; pinToHome: boolean; imageUrl?: string; linkUrl?: string; linkLabel?: string }) =>
    request<Announcement>('/admin/announcements', { method: 'POST', body: JSON.stringify(payload) }),
  deleteAnnouncement: (id: string) => request(`/admin/announcements/${id}`, { method: 'DELETE' }),
  createBlog: (payload: { title: string; body: string; category: string; pinned: boolean; imageUrl?: string; linkUrl?: string; linkLabel?: string }) =>
    request<BlogPost>('/admin/blogs', { method: 'POST', body: JSON.stringify(payload) }),
  deleteBlog: (id: string) => request(`/admin/blogs/${id}`, { method: 'DELETE' }),
  grantBadge: (payload: { username: string; badge: string }) =>
    request<User>('/admin/badges/grant', { method: 'POST', body: JSON.stringify(payload) }),
  badgeCatalog: () => request<BadgeDefinition[]>('/admin/badges'),
  createBadge: (payload: { name: string; icon: string; color: string }) =>
    request<BadgeDefinition>('/admin/badges', { method: 'POST', body: JSON.stringify(payload) }),
  deleteBadge: (id: string) => request(`/admin/badges/${id}`, { method: 'DELETE' }),
  roles: () => request<RoleDefinition[]>('/admin/roles'),
  setRole: (payload: { username: string; role: User['role'] }) =>
    request<User>('/admin/users/role', { method: 'POST', body: JSON.stringify(payload) }),
  searchUsers: (q: string) => request<User[]>(`/admin/users/search?q=${encodeURIComponent(q)}`),
  moderateUser: (payload: { userId: string; action: 'mute' | 'ban' | 'unban'; reason?: string; hours?: number }) =>
    request('/admin/users/moderate', { method: 'POST', body: JSON.stringify(payload) }),
  auditLogs: (type?: string) => request<AuditLog[]>(`/admin/audit${type ? `?type=${encodeURIComponent(type)}` : ''}`),
  adminUsers: () => request<User[]>('/admin/users'),
  adminAnalytics: () => request<AdminAnalytics>('/admin/analytics'),
  updateUser: (payload: { username: string; newUsername?: string; discriminator?: string; mobile?: string; alternateEmail?: string; newPassword?: string; resetUsernameLimit?: boolean }) =>
    request<User>('/admin/users/update', { method: 'POST', body: JSON.stringify(payload) }),
  exportUsers: () => requestText('/admin/users/export'),
  reports: () => request<{ reports: Report[]; tickets: Ticket[] }>('/staff/reports'),
  staffLogs: () => request<AuditLog[]>('/staff/logs'),
  staffAnalytics: () => request<StaffAnalytics>('/staff/analytics')
};
