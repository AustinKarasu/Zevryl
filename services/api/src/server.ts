import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import argon2 from 'argon2';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { SignJWT, jwtVerify } from 'jose';
import { AccessToken } from 'livekit-server-sdk';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';

const env = {
  host: process.env.API_HOST ?? '0.0.0.0',
  port: Number(process.env.API_PORT ?? 4100),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://zevryl:zevryl@localhost:5432/zevryl',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  accessSecret: process.env.JWT_ACCESS_SECRET ?? 'replace-this-in-production',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'replace-this-refresh-in-production',
  adminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL,
  adminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD
  ,
  livekitUrl: process.env.LIVEKIT_URL ?? '',
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? '',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? '',
  publicAppUrl: process.env.PUBLIC_APP_URL ?? 'https://github.com/AustinKarasu/Zevryl/releases/latest',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  mailFrom: process.env.MAIL_FROM ?? 'Zevryl <noreply@zevryl.app>',
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX ?? 40),
  giphyApiKey: process.env.GIPHY_API_KEY ?? '',
  tenorApiKey: process.env.TENOR_API_KEY ?? ''
};

const app = Fastify({ logger: true });
const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: env.databasePoolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});
const redis = new Redis(env.redisUrl, { lazyConnect: true });
const accessKey = new TextEncoder().encode(env.accessSecret);
const refreshKey = new TextEncoder().encode(env.refreshSecret);
const authClockToleranceSeconds = 10 * 60;

type Auth = { id: string; role: 'user' | 'staff' | 'admin' };

declare module 'fastify' {
  interface FastifyRequest {
    auth?: Auth;
  }
}

const email = z.string().email().transform(v => v.toLowerCase());
const uuid = z.string().uuid();

function toUser(row: any) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    discriminator: row.discriminator ?? '0001',
    tag: `${row.username}#${row.discriminator ?? '0001'}`,
    displayName: row.display_name,
    mobile: row.mobile ?? undefined,
    alternateEmail: row.alternate_email ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    bannerUrl: row.banner_url ?? undefined,
    previousAvatars: row.previous_avatars ?? [],
    previousBanners: row.previous_banners ?? [],
    profileColor: row.profile_color,
    profileTheme: row.profile_theme ?? 'terria',
    density: row.display_density ?? 'comfortable',
    language: row.language ?? 'en',
    bio: row.bio ?? '',
    pronouns: row.pronouns ?? undefined,
    customStatus: row.custom_status ?? undefined,
    presence: row.presence,
    badges: row.badges ?? [],
    role: row.role,
    mutedUntil: row.muted_until ?? undefined,
    activeAt: row.active_at ?? undefined,
    lastIp: row.last_ip ?? undefined,
    privacy: {
      dmPolicy: row.dm_policy ?? 'friends',
      profileLinks: row.profile_links ?? true
    },
    twoFactorEnabled: Boolean(row.two_factor_secret)
  };
}

async function migrate() {
  await pool.query(`
    create table if not exists users (
      id uuid primary key,
      email text unique not null,
      username text unique not null,
      password_hash text not null,
      display_name text not null,
      avatar_url text,
      banner_url text,
      profile_color text not null default '#7CE7B2',
      bio text not null default '',
      pronouns text,
      custom_status text,
      presence text not null default 'offline',
      badges text[] not null default '{}',
      role text not null default 'user',
      is_banned boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists sessions (
      id uuid primary key,
      user_id uuid references users(id) on delete cascade,
      refresh_token_hash text not null,
      device_name text,
      ip_address text,
      user_agent text,
      last_seen_at timestamptz not null default now(),
      revoked_at timestamptz
    );
    create table if not exists friend_requests (
      id uuid primary key,
      from_user_id uuid references users(id) on delete cascade,
      to_user_id uuid references users(id) on delete cascade,
      status text not null default 'pending',
      created_at timestamptz not null default now(),
      responded_at timestamptz
    );
    create table if not exists friendships (
      user_a uuid references users(id) on delete cascade,
      user_b uuid references users(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (user_a, user_b)
    );
    create table if not exists blocks (
      blocker_id uuid references users(id) on delete cascade,
      blocked_id uuid references users(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (blocker_id, blocked_id)
    );
    create table if not exists groups (
      id uuid primary key,
      owner_id uuid references users(id) on delete restrict,
      name text not null,
      description text not null default '',
      avatar_url text,
      banner_url text,
      slowmode_seconds int not null default 0,
      archived_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists group_members (
      group_id uuid references groups(id) on delete cascade,
      user_id uuid references users(id) on delete cascade,
      role text not null default 'member',
      muted_until timestamptz,
      banned_at timestamptz,
      joined_at timestamptz not null default now(),
      primary key (group_id, user_id)
    );
    create table if not exists conversations (
      id uuid primary key,
      kind text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists messages (
      id uuid primary key,
      conversation_id uuid not null,
      sender_id uuid references users(id) on delete set null,
      body text not null,
      type text not null default 'text',
      attachment_url text,
      is_edited boolean not null default false,
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists announcements (
      id uuid primary key,
      title text not null,
      body text not null,
      created_by uuid references users(id) on delete set null,
      is_popup boolean not null default true,
      pin_to_home boolean not null default true,
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists announcement_reads (
      announcement_id uuid references announcements(id) on delete cascade,
      user_id uuid references users(id) on delete cascade,
      read_at timestamptz not null default now(),
      primary key (announcement_id, user_id)
    );
    create table if not exists reports (
      id uuid primary key,
      reporter_id uuid references users(id) on delete set null,
      type text not null,
      reason text not null,
      status text not null default 'open',
      created_at timestamptz not null default now()
    );
    create table if not exists audit_logs (
      id uuid primary key,
      actor_id uuid references users(id) on delete set null,
      action text not null,
      target_type text not null,
      target_id text not null,
      metadata jsonb not null default '{}',
      created_at timestamptz not null default now()
    );
    create table if not exists crash_logs (
      id uuid primary key,
      user_id uuid references users(id) on delete set null,
      reason text not null,
      device text,
      app_version text,
      created_at timestamptz not null default now()
    );
    alter table users add column if not exists discriminator text not null default '0001';
    alter table users add column if not exists mobile text;
    alter table users add column if not exists alternate_email text;
    alter table users add column if not exists previous_avatars text[] not null default '{}';
    alter table users add column if not exists previous_banners text[] not null default '{}';
    alter table users add column if not exists profile_theme text not null default 'terria';
    alter table users add column if not exists display_density text not null default 'comfortable';
    alter table users add column if not exists language text not null default 'en';
    alter table users add column if not exists active_at timestamptz;
    alter table users add column if not exists last_ip text;
    alter table users add column if not exists dm_policy text not null default 'friends';
    alter table users add column if not exists profile_links boolean not null default true;
    alter table users add column if not exists two_factor_secret text;
    alter table users add column if not exists muted_until timestamptz;
    alter table sessions add column if not exists created_at timestamptz not null default now();
    alter table messages add column if not exists pinned boolean not null default false;
    alter table reports add column if not exists proof_url text;
    alter table reports add column if not exists target_user_id uuid references users(id) on delete set null;
    create table if not exists conversation_members (
      conversation_id uuid references conversations(id) on delete cascade,
      user_id uuid references users(id) on delete cascade,
      muted_until timestamptz,
      blocked_at timestamptz,
      joined_at timestamptz not null default now(),
      primary key (conversation_id, user_id)
    );
    create table if not exists tickets (
      id uuid primary key,
      user_id uuid references users(id) on delete set null,
      type text not null,
      subject text not null,
      body text not null,
      proof_url text,
      target_user_id uuid references users(id) on delete set null,
      status text not null default 'open',
      claimed_by uuid references users(id) on delete set null,
      closed_at timestamptz,
      created_at timestamptz not null default now()
    );
    create table if not exists ticket_updates (
      id uuid primary key,
      ticket_id uuid references tickets(id) on delete cascade,
      by_user_id uuid references users(id) on delete set null,
      note text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists push_tokens (
      token text primary key,
      user_id uuid references users(id) on delete cascade,
      platform text not null,
      created_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now()
    );
    create table if not exists recovery_tokens (
      id uuid primary key,
      user_id uuid not null references users(id) on delete cascade,
      token_hash text not null unique,
      expires_at timestamptz not null,
      used_at timestamptz,
      created_at timestamptz not null default now()
    );
    create table if not exists blogs (
      id uuid primary key,
      title text not null,
      body text not null,
      image_url text,
      link_url text,
      link_label text,
      category text not null default 'Update',
      author_id uuid references users(id) on delete set null,
      pinned boolean not null default false,
      deleted_at timestamptz,
      created_at timestamptz not null default now()
    );
    alter table announcements add column if not exists image_url text;
    alter table announcements add column if not exists link_url text;
    alter table announcements add column if not exists link_label text;
    alter table conversations add column if not exists title text;
    alter table conversations add column if not exists group_id uuid references groups(id) on delete cascade;
    alter table groups add column if not exists visibility text not null default 'private';
    alter table groups add column if not exists invite_code text unique;
    alter table groups add column if not exists voice_limit int not null default 25;
    alter table groups add column if not exists video_limit int not null default 10;
    create table if not exists badge_definitions (
      id uuid primary key,
      name text unique not null,
      icon text not null default 'ribbon',
      color text not null default '#E6C07A',
      created_at timestamptz not null default now()
    );
    create table if not exists app_releases (
      version text primary key,
      title text not null,
      notes text not null,
      apk_url text,
      required boolean not null default false,
      created_at timestamptz not null default now()
    );
    insert into badge_definitions (id,name,icon,color) values
      ('00000000-0000-4000-8000-000000000001','Founder','diamond','#E6C07A'),
      ('00000000-0000-4000-8000-000000000002','Admin','shield-checkmark','#FFAAA8'),
      ('00000000-0000-4000-8000-000000000003','Mod','hammer','#8EC5FF'),
      ('00000000-0000-4000-8000-000000000004','Staff','briefcase','#A7E0A1'),
      ('00000000-0000-4000-8000-000000000005','Member','person','#D9E2CC'),
      ('00000000-0000-4000-8000-000000000006','Vip','star','#F7D774')
    on conflict (name) do nothing;
    create index if not exists idx_users_username on users(username);
    create index if not exists idx_users_active_at on users(active_at);
    create index if not exists idx_friendships_a on friendships(user_a);
    create index if not exists idx_friendships_b on friendships(user_b);
    create index if not exists idx_group_members_user on group_members(user_id);
    create index if not exists idx_group_members_group on group_members(group_id);
    create index if not exists idx_conversation_members_user on conversation_members(user_id);
    create index if not exists idx_messages_conversation_created on messages(conversation_id, created_at desc);
    create index if not exists idx_messages_pinned on messages(conversation_id, pinned) where pinned=true;
    create index if not exists idx_tickets_status_created on tickets(status, created_at desc);
    create index if not exists idx_push_tokens_user on push_tokens(user_id);
    create index if not exists idx_recovery_tokens_hash on recovery_tokens(token_hash);
    create index if not exists idx_audit_created on audit_logs(created_at desc);
  `);
}

async function audit(actorId: string | null, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  await pool.query('insert into audit_logs (id,actor_id,action,target_type,target_id,metadata) values ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), actorId, action, targetType, targetId, metadata]);
}

async function sign(user: Auth, kind: 'access' | 'refresh') {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: user.role, kind })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + (kind === 'access' ? 60 * 60 : 60 * 60 * 24 * 30))
    .sign(kind === 'access' ? accessKey : refreshKey);
}

async function requireAuth(request: any) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw app.httpErrors.unauthorized('Please sign in.');
  let verified;
  try {
    verified = await jwtVerify(header.slice(7), accessKey, { clockTolerance: authClockToleranceSeconds });
  } catch {
    throw app.httpErrors.unauthorized('Session expired. Please sign in again.');
  }
  const userId = String(verified.payload.sub ?? '');
  const user = (await pool.query('select id, role from users where id=$1 limit 1', [userId])).rows[0];
  if (!user) throw app.httpErrors.unauthorized('Please sign in again.');
  request.auth = { id: user.id, role: user.role as Auth['role'] };
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function sendRecoveryEmail(to: string, recoveryUrl: string) {
  return sendEmail({
    to,
    subject: 'Reset your Zevryl password',
    text: `Use this link to reset your Zevryl password. It expires in 30 minutes.\n\n${recoveryUrl}`
  });
}

async function sendEmail({ to, subject, text }: { to: string; subject: string; text: string }) {
  if (!env.resendApiKey) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.mailFrom,
      to,
      subject,
      text
    })
  });
  return response.ok;
}

function requestDeviceName(request: any) {
  const header = request.headers['x-zevryl-device'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : undefined;
}

async function approximateIpLocation(ip: string) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('::ffff:127.')) return 'Local network';
  const cleanIp = ip.replace(/^::ffff:/, '');
  try {
    const response = await fetch(`https://ipapi.co/${encodeURIComponent(cleanIp)}/json/`);
    if (!response.ok) return 'Unknown';
    const data = await response.json() as { city?: string; region?: string; country_name?: string };
    return [data.city, data.region, data.country_name].filter(Boolean).join(', ') || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

async function sendLoginAlert(user: any, request: any) {
  const device = requestDeviceName(request) || 'Unknown device';
  const ip = request.ip || 'Unknown IP';
  const location = await approximateIpLocation(ip);
  const userAgent = request.headers['user-agent'] || 'Unknown user agent';
  const when = new Date().toISOString();
  await sendEmail({
    to: user.email,
    subject: 'New login to your Zevryl account',
    text: [
      `Hi ${user.display_name || user.username},`,
      '',
      'Your Zevryl account was just used to sign in.',
      '',
      `Device: ${device}`,
      `IP: ${ip}`,
      `Location: ${location}`,
      `Model/User agent: ${userAgent}`,
      `Time: ${when}`,
      '',
      'If this was not you, change your password and log out all devices from Settings > Devices.'
    ].join('\n')
  }).catch(() => false);
}

function requireRole(request: any, roles: Auth['role'][]) {
  if (!request.auth || !roles.includes(request.auth.role)) throw app.httpErrors.forbidden('You do not have permission for this action.');
}

function userLookupParts(identifier: string) {
  const raw = identifier.trim().toLowerCase();
  const tagMatch = raw.match(/^([a-z0-9_]{3,24})#(\d{4,8})$/);
  return { raw, username: tagMatch?.[1], discriminator: tagMatch?.[2] };
}

async function findUserForAdmin(identifier: string) {
  const lookup = userLookupParts(identifier);
  const result = await pool.query(
    `select * from users
     where lower(email)=$1
        or lower(username)=$1
        or (lower(username)=$2 and discriminator=$3)
     limit 1`,
    [lookup.raw, lookup.username ?? lookup.raw, lookup.discriminator ?? '']
  );
  return result.rows[0];
}

async function conversationFor(row: any, viewerId: string) {
  const participants = await pool.query(
    `select u.* from users u join conversation_members cm on cm.user_id=u.id where cm.conversation_id=$1 order by u.display_name`,
    [row.id]
  );
  const last = (await pool.query('select * from messages where conversation_id=$1 and deleted_at is null order by created_at desc limit 1', [row.id])).rows[0];
  const muted = (await pool.query('select muted_until from conversation_members where conversation_id=$1 and user_id=$2', [row.id, viewerId])).rows[0];
  const users = participants.rows.map(toUser);
  const other = users.find((user: any) => user.id !== viewerId);
  return {
    id: row.id,
    kind: row.kind,
    title: row.title || (row.kind === 'dm' ? other?.displayName || 'Direct Message' : 'Group Chat'),
    subtitle: row.kind === 'dm' ? other?.tag : `${users.length} members`,
    unreadCount: 0,
    participants: users,
    lastMessage: last ? toMessage(last) : undefined,
    mutedUntil: muted?.muted_until ?? undefined
  };
}

function toMessage(row: any) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    type: row.type,
    attachmentUrl: row.attachment_url ?? undefined,
    isEdited: row.is_edited,
    pinned: row.pinned,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
    readBy: [],
    reactions: {}
  };
}

async function ticketWithUpdates(row: any) {
  const updates = await pool.query('select * from ticket_updates where ticket_id=$1 order by created_at asc', [row.id]);
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    subject: row.subject,
    body: row.body,
    proofUrl: row.proof_url ?? undefined,
    targetUserId: row.target_user_id ?? undefined,
    status: row.status,
    claimedBy: row.claimed_by ?? undefined,
    closedAt: row.closed_at ?? undefined,
    createdAt: row.created_at,
    updates: updates.rows.map(update => ({ by: update.by_user_id ?? 'system', note: update.note, at: update.created_at }))
  };
}

async function notifyConversation(conversationId: string, senderId: string, body: string) {
  const sender = (await pool.query('select display_name from users where id=$1', [senderId])).rows[0];
  const tokens = await pool.query(
    `select pt.token from push_tokens pt
     join conversation_members cm on cm.user_id=pt.user_id
     where cm.conversation_id=$1 and pt.user_id<>$2 and (cm.muted_until is null or cm.muted_until < now())`,
    [conversationId, senderId]
  );
  if (!tokens.rowCount) return;
  const messages = tokens.rows.map(row => ({
    to: row.token,
    sound: 'default',
    channelId: 'messages',
    title: sender?.display_name ? `${sender.display_name} sent a message` : 'New Zevryl message',
    body: body.length > 140 ? `${body.slice(0, 137)}...` : body,
    data: { conversationId, kind: 'message' }
  }));
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages)
  }).catch(() => undefined);
}

async function notifyCall(roomName: string, senderId: string, kind: 'voice' | 'video') {
  const conversationId = roomName.replace(/^(voice|video)-/, '');
  const sender = (await pool.query('select display_name from users where id=$1', [senderId])).rows[0];
  const members = await pool.query('select count(*)::int as count from conversation_members where conversation_id=$1', [conversationId]);
  const tokens = await pool.query(
    `select pt.token from push_tokens pt join conversation_members cm on cm.user_id=pt.user_id
     where cm.conversation_id=$1 and pt.user_id<>$2 and (cm.muted_until is null or cm.muted_until < now())`,
    [conversationId, senderId]
  );
  if (!tokens.rowCount) return;
  const count = members.rows[0]?.count ?? 1;
  const messages = tokens.rows.map(row => ({
    to: row.token,
    sound: 'default',
    title: `${sender?.display_name ?? 'Someone'} started a ${kind} call`,
    body: `${count} member${count === 1 ? '' : 's'} can join this ${kind} call.`,
    categoryId: 'incoming-call',
    data: { conversationId, roomName, kind: 'call' }
  }));
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages)
  }).catch(() => undefined);
}

const fallbackGifs = [
  { id: 'fallback-wave', url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif', previewUrl: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif', title: 'Wave', source: 'fallback' },
  { id: 'fallback-wow', url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif', previewUrl: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif', title: 'Wow', source: 'fallback' },
  { id: 'fallback-laugh', url: 'https://media.giphy.com/media/ely3apij36BJhoZ234/giphy.gif', previewUrl: 'https://media.giphy.com/media/ely3apij36BJhoZ234/giphy.gif', title: 'Laugh', source: 'fallback' }
] as const;

async function searchProviderGifs(q: string, limit: number) {
  const [giphy, tenor] = await Promise.all([
    env.giphyApiKey
      ? fetch(`https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(env.giphyApiKey)}&q=${encodeURIComponent(q)}&limit=${Math.min(limit, 50)}&rating=pg-13&lang=en`)
          .then(response => response.ok ? response.json() : null)
          .catch(() => null)
      : null,
    env.tenorApiKey
      ? fetch(`https://tenor.googleapis.com/v2/search?key=${encodeURIComponent(env.tenorApiKey)}&q=${encodeURIComponent(q)}&limit=${Math.min(limit, 50)}&media_filter=gif,tinygif&contentfilter=medium`)
          .then(response => response.ok ? response.json() : null)
          .catch(() => null)
      : null
  ]);
  const results: Array<{ id: string; url: string; previewUrl?: string; title?: string; source: 'giphy' | 'tenor' | 'fallback' }> = [];
  for (const item of Array.isArray(giphy?.data) ? giphy.data : []) {
    const url = item?.images?.original?.url || item?.images?.downsized?.url;
    if (url) results.push({ id: `giphy-${item.id}`, url, previewUrl: item?.images?.fixed_width_small?.url || url, title: item.title, source: 'giphy' });
  }
  for (const item of Array.isArray(tenor?.results) ? tenor.results : []) {
    const media = item?.media_formats ?? {};
    const url = media.gif?.url || media.mediumgif?.url || media.tinygif?.url;
    if (url) results.push({ id: `tenor-${item.id}`, url, previewUrl: media.tinygif?.url || url, title: item.content_description, source: 'tenor' });
  }
  const unique = new Map<string, typeof results[number]>();
  for (const item of results) unique.set(item.url, item);
  return Array.from(unique.values()).slice(0, limit);
}

async function bootstrapAdmin() {
  if (!env.adminEmail || !env.adminPassword) return;
  const exists = await pool.query('select id from users where email=$1', [env.adminEmail.toLowerCase()]);
  if (exists.rowCount) return;
  await pool.query(
    'insert into users (id,email,username,password_hash,display_name,role,presence,badges) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [crypto.randomUUID(), env.adminEmail.toLowerCase(), 'admin', await argon2.hash(env.adminPassword), 'Zevryl Admin', 'admin', 'online', ['Founder']]
  );
}

app.register(sensible);
app.register(helmet);
app.register(cors, { origin: true });
app.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute',
  keyGenerator: request => `${request.ip}:${request.routeOptions.url ?? request.url}`
});

const authRateLimit = { max: 8, timeWindow: '1 minute' };
const recoveryRateLimit = { max: 3, timeWindow: '15 minutes' };

app.addHook('preHandler', async request => {
  const url = request.routeOptions.url ?? '';
  if (url.startsWith('/auth/') || url === '/health' || url === '/app/latest') return;
  await requireAuth(request);
  await pool.query(
    'update sessions set last_seen_at=now() where user_id=$1 and ip_address=$2 and user_agent is not distinct from $3 and revoked_at is null',
    [request.auth!.id, request.ip, request.headers['user-agent']]
  ).catch(() => undefined);
});

app.get('/health', async () => {
  const db = await pool.query('select 1 as ok');
  let redisStatus = 'offline';
  try {
    if (redis.status === 'wait') await redis.connect();
    redisStatus = await redis.ping();
  } catch {
    redisStatus = 'unavailable';
  }
  return { ok: true, database: db.rows[0].ok === 1, redis: redisStatus };
});

app.post('/auth/register', { config: { rateLimit: authRateLimit } }, async request => {
  const body = z.object({ fullName: z.string().min(2), email, username: z.string().min(3), password: z.string().min(8) }).parse(request.body);
  const id = crypto.randomUUID();
  const discriminator = String(Math.floor(1000 + Math.random() * 9000));
  await pool.query('insert into users (id,email,username,discriminator,password_hash,display_name,presence,active_at,last_ip) values ($1,$2,$3,$4,$5,$6,$7,now(),$8)', [id, body.email, body.username.toLowerCase(), discriminator, await argon2.hash(body.password), body.fullName, 'online', request.ip]);
  const user = toUser((await pool.query('select * from users where id=$1', [id])).rows[0]);
  const accessToken = await sign({ id, role: user.role }, 'access');
  const refreshToken = await sign({ id, role: user.role }, 'refresh');
  await pool.query('insert into sessions (id,user_id,refresh_token_hash,device_name,user_agent,ip_address) values ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), id, await argon2.hash(refreshToken), requestDeviceName(request), request.headers['user-agent'], request.ip]);
  await audit(id, 'auth.register', 'user', id);
  return { user, accessToken, refreshToken };
});

app.post('/auth/login', { config: { rateLimit: authRateLimit } }, async request => {
  const body = z.object({ emailOrUsername: z.string().min(1), password: z.string().min(1) }).parse(request.body);
  const result = await pool.query('select * from users where (email=$1 or username=$1) and is_banned=false', [body.emailOrUsername.toLowerCase()]);
  const row = result.rows[0];
  if (!row || !(await argon2.verify(row.password_hash, body.password))) throw app.httpErrors.unauthorized('Email or password is incorrect.');
  await pool.query('update users set presence=$1, active_at=now(), last_ip=$2 where id=$3', ['online', request.ip, row.id]);
  const user = toUser({ ...row, presence: 'online', active_at: new Date().toISOString(), last_ip: request.ip });
  const accessToken = await sign({ id: user.id, role: user.role }, 'access');
  const refreshToken = await sign({ id: user.id, role: user.role }, 'refresh');
  await pool.query('insert into sessions (id,user_id,refresh_token_hash,device_name,user_agent,ip_address) values ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), user.id, await argon2.hash(refreshToken), requestDeviceName(request), request.headers['user-agent'], request.ip]);
  await audit(user.id, 'auth.login', 'user', user.id);
  sendLoginAlert(row, request).catch(() => undefined);
  return { user, accessToken, refreshToken };
});

app.post('/auth/refresh', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async request => {
  const body = z.object({ refreshToken: z.string().min(20) }).parse(request.body);
  let verified;
  try {
    verified = await jwtVerify(body.refreshToken, refreshKey, { clockTolerance: authClockToleranceSeconds });
  } catch {
    throw app.httpErrors.unauthorized('Session expired. Please sign in again.');
  }
  if (verified.payload.kind !== 'refresh') throw app.httpErrors.unauthorized('Invalid refresh token.');
  const userId = String(verified.payload.sub ?? '');
  const user = (await pool.query('select * from users where id=$1 and is_banned=false', [userId])).rows[0];
  if (!user) throw app.httpErrors.unauthorized('Please sign in again.');
  const sessions = await pool.query('select refresh_token_hash from sessions where user_id=$1 and revoked_at is null order by created_at desc limit 20', [userId]);
  let validSession = false;
  for (const session of sessions.rows) {
    if (await argon2.verify(session.refresh_token_hash, body.refreshToken).catch(() => false)) {
      validSession = true;
      break;
    }
  }
  if (!validSession) throw app.httpErrors.unauthorized('Please sign in again.');
  const auth = { id: user.id, role: user.role as Auth['role'] };
  return { user: toUser(user), accessToken: await sign(auth, 'access'), refreshToken: body.refreshToken };
});

app.post('/auth/forgot-password', { config: { rateLimit: recoveryRateLimit } }, async request => {
  const body = z.object({ email }).parse(request.body);
  const user = (await pool.query('select * from users where email=$1 and is_banned=false', [body.email])).rows[0];
  if (!user) return { ok: true, delivery: 'accepted' };
  const rawToken = randomBytes(32).toString('base64url');
  const recoveryUrl = `${env.publicAppUrl}${env.publicAppUrl.includes('?') ? '&' : '?'}resetToken=${rawToken}`;
  await pool.query(
    'insert into recovery_tokens (id,user_id,token_hash,expires_at) values ($1,$2,$3,now() + interval \'30 minutes\')',
    [crypto.randomUUID(), user.id, hashToken(rawToken)]
  );
  const sent = await sendRecoveryEmail(user.email, recoveryUrl).catch(() => false);
  if (!sent) {
    const ticketId = crypto.randomUUID();
    await pool.query(
      'insert into tickets (id,user_id,type,subject,body) values ($1,$2,$3,$4,$5)',
      [ticketId, user.id, 'recovery', 'Password recovery requested', 'Email delivery is not configured. Staff should verify the account owner before resetting the password.']
    );
    await audit(user.id, 'recovery.ticket_created', 'ticket', ticketId);
  }
  await audit(user.id, sent ? 'recovery.email_sent' : 'recovery.email_queued', 'user', user.id);
  return { ok: true, delivery: sent ? 'email' : 'ticket' };
});

app.post('/auth/reset-password', async request => {
  const body = z.object({ token: z.string().min(20), password: z.string().min(8) }).parse(request.body);
  const tokenHash = hashToken(body.token);
  const row = (await pool.query(
    `select rt.*, u.role from recovery_tokens rt
     join users u on u.id=rt.user_id
     where rt.token_hash=$1 and rt.used_at is null and rt.expires_at > now()`,
    [tokenHash]
  )).rows[0];
  if (!row) throw app.httpErrors.badRequest('Recovery link expired. Send a new recovery email.');
  await pool.query('update users set password_hash=$2, updated_at=now() where id=$1', [row.user_id, await argon2.hash(body.password)]);
  await pool.query('update recovery_tokens set used_at=now() where id=$1', [row.id]);
  await pool.query('update sessions set revoked_at=now() where user_id=$1', [row.user_id]);
  await audit(row.user_id, 'recovery.password_reset', 'user', row.user_id);
  return { ok: true };
});
app.post('/auth/otp/request', async () => ({ ok: true }));
app.post('/auth/otp/verify', async () => ({ ok: true }));
app.post('/auth/logout', async request => {
  await requireAuth(request);
  await pool.query('update users set presence=$1 where id=$2', ['offline', request.auth!.id]);
  await pool.query(
    'update sessions set revoked_at=now() where user_id=$1 and ip_address=$2 and user_agent is not distinct from $3 and revoked_at is null',
    [request.auth!.id, request.ip, request.headers['user-agent']]
  );
  await audit(request.auth!.id, 'auth.logout', 'user', request.auth!.id);
  return { ok: true };
});

app.post('/auth/logout-all', async request => {
  await requireAuth(request);
  await pool.query('update sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [request.auth!.id]);
  await pool.query('update users set presence=$1 where id=$2', ['offline', request.auth!.id]);
  await audit(request.auth!.id, 'auth.logout_all', 'user', request.auth!.id);
  return { ok: true };
});

app.get('/me', async request => {
  const row = (await pool.query('select * from users where id=$1', [request.auth!.id])).rows[0];
  if (!row) throw app.httpErrors.notFound('Account not found.');
  return toUser(row);
});

app.get('/me/sessions', async request => {
  const rows = await pool.query(
    `select id, device_name, ip_address, user_agent, created_at, last_seen_at, revoked_at,
            (ip_address=$2 and user_agent is not distinct from $3 and revoked_at is null) as current
     from sessions
     where user_id=$1
     order by revoked_at is null desc, last_seen_at desc, created_at desc
     limit 50`,
    [request.auth!.id, request.ip, request.headers['user-agent']]
  );
  return rows.rows.map(row => ({
    id: row.id,
    deviceName: row.device_name ?? undefined,
    ipAddress: row.ip_address ?? undefined,
    userAgent: row.user_agent ?? undefined,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at ?? undefined,
    current: row.current
  }));
});

app.patch('/me/profile', async request => {
  const body = z.object({
    displayName: z.string().min(2).max(60).optional(),
    bio: z.string().max(500).optional(),
    pronouns: z.string().max(40).optional(),
    customStatus: z.string().max(80).optional(),
    profileColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    profileTheme: z.enum(['terria', 'ember', 'ocean', 'mono', 'midnight', 'forest', 'rose', 'graphite']).optional(),
    density: z.enum(['compact', 'comfortable', 'spacious']).optional(),
    avatarUrl: z.string().optional(),
    bannerUrl: z.string().optional(),
    presence: z.enum(['online', 'idle', 'dnd', 'invisible', 'offline']).optional(),
    language: z.string().min(2).max(12).optional()
  }).parse(request.body);
  const current = (await pool.query('select * from users where id=$1', [request.auth!.id])).rows[0];
  const row = (await pool.query(
    `update users set
      display_name=coalesce($2,display_name),
      bio=coalesce($3,bio),
      pronouns=$4,
      custom_status=$5,
      profile_color=coalesce($6,profile_color),
      profile_theme=coalesce($7,profile_theme),
      avatar_url=coalesce($8,avatar_url),
      banner_url=coalesce($9,banner_url),
      presence=coalesce($10,presence),
      language=coalesce($11,language),
      display_density=coalesce($12,display_density),
      previous_avatars=case when $8::text is not null and avatar_url is not null then array_append(previous_avatars, avatar_url) else previous_avatars end,
      previous_banners=case when $9::text is not null and banner_url is not null then array_append(previous_banners, banner_url) else previous_banners end,
      updated_at=now()
     where id=$1 returning *`,
    [request.auth!.id, body.displayName, body.bio, body.pronouns ?? current.pronouns, body.customStatus ?? current.custom_status, body.profileColor, body.profileTheme, body.avatarUrl, body.bannerUrl, body.presence, body.language, body.density]
  )).rows[0];
  await audit(request.auth!.id, 'profile.update', 'user', request.auth!.id);
  return toUser(row);
});

app.patch('/me/account', async request => {
  const body = z.object({ username: z.string().min(3).optional(), discriminator: z.string().min(4).max(8).optional(), mobile: z.string().optional(), alternateEmail: z.string().email().optional() }).parse(request.body);
  const row = (await pool.query(
    `update users set username=coalesce($2,username), discriminator=coalesce($3,discriminator), mobile=$4, alternate_email=$5, updated_at=now() where id=$1 returning *`,
    [request.auth!.id, body.username?.toLowerCase(), body.discriminator, body.mobile, body.alternateEmail?.toLowerCase()]
  )).rows[0];
  return toUser(row);
});

app.patch('/me/privacy', async request => {
  const body = z.object({ dmPolicy: z.enum(['everyone', 'friends', 'none']), profileLinks: z.boolean() }).parse(request.body);
  const row = (await pool.query('update users set dm_policy=$2, profile_links=$3 where id=$1 returning *', [request.auth!.id, body.dmPolicy, body.profileLinks])).rows[0];
  return toUser(row);
});

app.post('/me/2fa/setup', async () => ({ secret: 'manual-setup-required', otpauthUrl: 'otpauth://totp/Zevryl', qrUrl: '' }));
app.post('/me/2fa/verify', async request => {
  await pool.query('update users set two_factor_secret=$2 where id=$1', [request.auth!.id, 'enabled']);
  return toUser((await pool.query('select * from users where id=$1', [request.auth!.id])).rows[0]);
});
app.post('/me/2fa/disable', async request => {
  await pool.query('update users set two_factor_secret=null where id=$1', [request.auth!.id]);
  return toUser((await pool.query('select * from users where id=$1', [request.auth!.id])).rows[0]);
});

app.get('/friends', async request => {
  const userId = request.auth!.id;
  const friends = await pool.query(
    `select u.* from users u
     join friendships f on (f.user_a=$1 and f.user_b=u.id) or (f.user_b=$1 and f.user_a=u.id)
     left join blocks b on b.blocker_id=$1 and b.blocked_id=u.id
     where b.blocked_id is null`,
    [userId]
  );
  const incoming = await pool.query(
    `select fr.id as request_id, fr.status as request_status, fr.created_at as request_created_at, from_u.*, to_u.id as to_id
     from friend_requests fr
     join users from_u on from_u.id=fr.from_user_id
     join users to_u on to_u.id=fr.to_user_id
     left join blocks b on b.blocker_id=$1 and b.blocked_id=from_u.id
     where fr.to_user_id=$1 and fr.status='pending' and b.blocked_id is null`,
    [userId]
  );
  const outgoing = await pool.query(
    `select fr.id as request_id, fr.status as request_status, fr.created_at as request_created_at, to_u.*
     from friend_requests fr
     join users to_u on to_u.id=fr.to_user_id
     left join blocks b on b.blocker_id=$1 and b.blocked_id=to_u.id
     where fr.from_user_id=$1 and fr.status='pending' and b.blocked_id is null`,
    [userId]
  );
  const blocked = await pool.query(`select u.* from users u join blocks b on b.blocked_id=u.id where b.blocker_id=$1 order by b.created_at desc`, [userId]);
  return {
    friends: friends.rows.map(toUser),
    incoming: incoming.rows.map(row => ({ id: row.request_id, fromUser: toUser(row), toUser: toUser({ ...row, id: row.to_id }), status: row.request_status, createdAt: row.request_created_at })),
    outgoing: outgoing.rows.map(row => ({ id: row.request_id, fromUser: toUser({ ...row, id: userId }), toUser: toUser(row), status: row.request_status, createdAt: row.request_created_at })),
    blocked: blocked.rows.map(toUser)
  };
});

app.post('/friends/request', async request => {
  const body = z.object({ username: z.string().min(3) }).parse(request.body);
  const [rawName, discriminator] = body.username.toLowerCase().split('#');
  const target = (await pool.query('select id from users where username=$1 and ($2::text is null or discriminator=$2)', [rawName, discriminator ?? null])).rows[0];
  if (!target) throw app.httpErrors.notFound('User not found.');
  if (target.id === request.auth!.id) throw app.httpErrors.badRequest('You cannot add yourself.');
  await pool.query('insert into friend_requests (id,from_user_id,to_user_id) values ($1,$2,$3) on conflict do nothing', [crypto.randomUUID(), request.auth!.id, target.id]);
  await audit(request.auth!.id, 'friend.request', 'user', target.id);
  return { ok: true };
});

app.post('/friends/requests/:id/accept', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const req = (await pool.query('select * from friend_requests where id=$1 and to_user_id=$2 and status=$3', [params.id, request.auth!.id, 'pending'])).rows[0];
  if (!req) throw app.httpErrors.notFound('Request not found.');
  await pool.query('update friend_requests set status=$1, responded_at=now() where id=$2 and status=$3', ['accepted', params.id, 'pending']);
  await pool.query('insert into friendships (user_a,user_b) values ($1,$2) on conflict do nothing', [req.from_user_id, req.to_user_id]);
  await audit(request.auth!.id, 'friend.accept', 'friend_request', params.id);
  return { ok: true };
});

app.post('/friends/requests/:id/deny', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const row = (await pool.query('update friend_requests set status=$1, responded_at=now() where id=$2 and to_user_id=$3 and status=$4 returning id', ['denied', params.id, request.auth!.id, 'pending'])).rows[0];
  if (!row) throw app.httpErrors.notFound('Request not found.');
  await audit(request.auth!.id, 'friend.deny', 'friend_request', params.id);
  return { ok: true };
});

app.delete('/friends/requests/:id', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const row = (await pool.query('delete from friend_requests where id=$1 and from_user_id=$2 and status=$3 returning id,to_user_id', [params.id, request.auth!.id, 'pending'])).rows[0];
  if (!row) throw app.httpErrors.notFound('Request not found.');
  await audit(request.auth!.id, 'friend.cancel', 'friend_request', params.id, { toUserId: row.to_user_id });
  return { ok: true };
});

app.delete('/friends/:id', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query('delete from friendships where (user_a=$1 and user_b=$2) or (user_a=$2 and user_b=$1)', [request.auth!.id, params.id]);
  await audit(request.auth!.id, 'friend.remove', 'user', params.id);
  return { ok: true };
});

app.post('/friends/:id/block', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query('insert into blocks (blocker_id,blocked_id) values ($1,$2) on conflict do nothing', [request.auth!.id, params.id]);
  await pool.query('delete from friendships where (user_a=$1 and user_b=$2) or (user_a=$2 and user_b=$1)', [request.auth!.id, params.id]);
  await pool.query('delete from friend_requests where ((from_user_id=$1 and to_user_id=$2) or (from_user_id=$2 and to_user_id=$1)) and status=$3', [request.auth!.id, params.id, 'pending']);
  await audit(request.auth!.id, 'friend.block', 'user', params.id);
  return { ok: true };
});

app.post('/friends/:id/unblock', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const row = (await pool.query('delete from blocks where blocker_id=$1 and blocked_id=$2 returning blocked_id', [request.auth!.id, params.id])).rows[0];
  if (!row) throw app.httpErrors.notFound('Blocked user not found.');
  await audit(request.auth!.id, 'friend.unblock', 'user', params.id);
  return { ok: true };
});

app.post('/friends/:id/mute', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const body = z.object({ hours: z.number().int().min(1).max(8760).optional() }).parse(request.body ?? {});
  const conversations = await pool.query(
    `select c.id from conversations c
     join conversation_members a on a.conversation_id=c.id and a.user_id=$1
     join conversation_members b on b.conversation_id=c.id and b.user_id=$2
     where c.kind='dm'`,
    [request.auth!.id, params.id]
  );
  for (const row of conversations.rows) {
    await pool.query('update conversation_members set muted_until=now() + ($3::int || \' hours\')::interval where conversation_id=$1 and user_id=$2', [row.id, request.auth!.id, body.hours ?? 8]);
  }
  return { ok: true };
});

app.post('/friends/:id/unmute', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query(
    `update conversation_members cm set muted_until=null
     from conversation_members other, conversations c
     where cm.conversation_id=other.conversation_id and cm.conversation_id=c.id and c.kind='dm' and cm.user_id=$1 and other.user_id=$2`,
    [request.auth!.id, params.id]
  );
  return { ok: true };
});

app.get('/groups', async request => {
  const rows = await pool.query(
    `select g.*, c.id as conversation_id, count(gm.user_id)::int as member_count
     from groups g
     join group_members gm on gm.group_id=g.id
     left join conversations c on c.group_id=g.id and c.kind='group'
     where g.archived_at is null
       and g.id in (select group_id from group_members where user_id=$1 and banned_at is null)
     group by g.id, c.id
     order by g.created_at desc`,
    [request.auth!.id]
  );
  return rows.rows.map(row => ({ id: row.id, name: row.name, description: row.description, ownerId: row.owner_id, conversationId: row.conversation_id, avatarUrl: row.avatar_url, bannerUrl: row.banner_url, slowmodeSeconds: row.slowmode_seconds, visibility: row.visibility, inviteCode: row.invite_code, voiceLimit: row.voice_limit, videoLimit: row.video_limit, memberCount: row.member_count, unreadCount: 0 }));
});

app.post('/groups', async request => {
  const body = z.object({ name: z.string().min(2), description: z.string().default(''), friendIds: z.array(uuid).min(1), visibility: z.enum(['private', 'public']).default('private'), voiceLimit: z.number().int().min(2).max(5000).default(25), videoLimit: z.number().int().min(2).max(5000).default(10) }).parse(request.body);
  const groupId = crypto.randomUUID();
  const inviteCode = crypto.randomUUID().slice(0, 8);
  await pool.query('insert into groups (id,owner_id,name,description,visibility,invite_code,voice_limit,video_limit) values ($1,$2,$3,$4,$5,$6,$7,$8)', [groupId, request.auth!.id, body.name, body.description, body.visibility, inviteCode, body.voiceLimit, body.videoLimit]);
  await pool.query('insert into group_members (group_id,user_id,role) values ($1,$2,$3)', [groupId, request.auth!.id, 'owner']);
  for (const friendId of body.friendIds) await pool.query('insert into group_members (group_id,user_id,role) values ($1,$2,$3) on conflict do nothing', [groupId, friendId, 'member']);
  const conversationId = crypto.randomUUID();
  await pool.query('insert into conversations (id,kind,title,group_id) values ($1,$2,$3,$4)', [conversationId, 'group', body.name, groupId]);
  await pool.query('insert into conversation_members (conversation_id,user_id) values ($1,$2)', [conversationId, request.auth!.id]);
  for (const friendId of body.friendIds) await pool.query('insert into conversation_members (conversation_id,user_id) values ($1,$2) on conflict do nothing', [conversationId, friendId]);
  await audit(request.auth!.id, 'group.create', 'group', groupId);
  const row = (await pool.query('select *, $2::int as member_count from groups where id=$1', [groupId, body.friendIds.length + 1])).rows[0];
  return { id: row.id, name: row.name, description: row.description, ownerId: row.owner_id, conversationId, slowmodeSeconds: row.slowmode_seconds, visibility: row.visibility, inviteCode: row.invite_code, voiceLimit: row.voice_limit, videoLimit: row.video_limit, memberCount: row.member_count, unreadCount: 0 };
});

app.delete('/groups/:id', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const body = z.object({ confirmName: z.string() }).parse(request.body);
  const group = (await pool.query('select * from groups where id=$1', [params.id])).rows[0];
  if (!group) throw app.httpErrors.notFound('Group not found.');
  if (group.owner_id !== request.auth!.id) throw app.httpErrors.forbidden('Only the group owner can delete this group.');
  if (body.confirmName !== group.name) throw app.httpErrors.badRequest('Group name confirmation did not match.');
  await pool.query('update groups set archived_at=now() where id=$1', [params.id]);
  await audit(request.auth!.id, 'group.delete', 'group', params.id);
  return { ok: true };
});

app.post('/groups/:id/invite', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const group = (await pool.query('select * from groups where id=$1 and owner_id=$2', [params.id, request.auth!.id])).rows[0];
  if (!group) throw app.httpErrors.notFound('Group not found or not owned by you.');
  const inviteCode = group.invite_code || crypto.randomUUID().slice(0, 8);
  await pool.query('update groups set invite_code=$2 where id=$1', [params.id, inviteCode]);
  return { inviteCode, inviteUrl: `zevryl://invite/${inviteCode}` };
});

app.post('/groups/invites/:code/join', async request => {
  const params = z.object({ code: z.string().min(4) }).parse(request.params);
  const group = (await pool.query('select * from groups where invite_code=$1 and archived_at is null', [params.code])).rows[0];
  if (!group) throw app.httpErrors.notFound('Invite not found.');
  await pool.query('insert into group_members (group_id,user_id,role) values ($1,$2,$3) on conflict do nothing', [group.id, request.auth!.id, 'member']);
  const conversation = (await pool.query('select id from conversations where group_id=$1 limit 1', [group.id])).rows[0];
  if (conversation) await pool.query('insert into conversation_members (conversation_id,user_id) values ($1,$2) on conflict do nothing', [conversation.id, request.auth!.id]);
  await audit(request.auth!.id, 'group.invite.join', 'group', group.id, { inviteCode: params.code });
  return { id: group.id, name: group.name, description: group.description, ownerId: group.owner_id, conversationId: conversation?.id, slowmodeSeconds: group.slowmode_seconds, visibility: group.visibility, inviteCode: group.invite_code, voiceLimit: group.voice_limit, videoLimit: group.video_limit, memberCount: 1, unreadCount: 0 };
});

app.get('/conversations', async request => {
  const rows = await pool.query(
    `select c.* from conversations c join conversation_members cm on cm.conversation_id=c.id
     where cm.user_id=$1 and cm.blocked_at is null order by c.created_at desc`,
    [request.auth!.id]
  );
  return Promise.all(rows.rows.map(row => conversationFor(row, request.auth!.id)));
});

app.post('/conversations/dm', async request => {
  const body = z.object({ userId: uuid }).parse(request.body);
  const blocked = (await pool.query(
    'select 1 from blocks where (blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1) limit 1',
    [request.auth!.id, body.userId]
  )).rows[0];
  if (blocked) throw app.httpErrors.forbidden('You cannot start a DM with this user.');
  const existing = (await pool.query(
    `select c.* from conversations c
     join conversation_members a on a.conversation_id=c.id and a.user_id=$1
     join conversation_members b on b.conversation_id=c.id and b.user_id=$2
     where c.kind='dm' limit 1`,
    [request.auth!.id, body.userId]
  )).rows[0];
  if (existing) return conversationFor(existing, request.auth!.id);
  const id = crypto.randomUUID();
  await pool.query('insert into conversations (id,kind) values ($1,$2)', [id, 'dm']);
  await pool.query('insert into conversation_members (conversation_id,user_id) values ($1,$2),($1,$3)', [id, request.auth!.id, body.userId]);
  await audit(request.auth!.id, 'conversation.dm.create', 'conversation', id);
  return conversationFor((await pool.query('select * from conversations where id=$1', [id])).rows[0], request.auth!.id);
});

app.post('/conversations/:id/mute', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const body = z.object({ hours: z.number().optional() }).parse(request.body ?? {});
  await pool.query('update conversation_members set muted_until=now() + ($3::int || \' hours\')::interval where conversation_id=$1 and user_id=$2', [params.id, request.auth!.id, body.hours ?? 8]);
  return { ok: true };
});

app.post('/conversations/:id/block', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query('update conversation_members set blocked_at=now() where conversation_id=$1 and user_id=$2', [params.id, request.auth!.id]);
  const others = await pool.query('select user_id from conversation_members where conversation_id=$1 and user_id<>$2', [params.id, request.auth!.id]);
  for (const other of others.rows) {
    await pool.query('insert into blocks (blocker_id,blocked_id) values ($1,$2) on conflict do nothing', [request.auth!.id, other.user_id]);
  }
  return { ok: true };
});

app.post('/conversations/:id/unfriend', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const other = (await pool.query('select user_id from conversation_members where conversation_id=$1 and user_id<>$2 limit 1', [params.id, request.auth!.id])).rows[0];
  if (other) await pool.query('delete from friendships where (user_a=$1 and user_b=$2) or (user_a=$2 and user_b=$1)', [request.auth!.id, other.user_id]);
  return { ok: true };
});

app.get('/conversations/:id/download', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const rows = await pool.query('select m.*, u.username from messages m left join users u on u.id=m.sender_id where m.conversation_id=$1 order by m.created_at asc', [params.id]);
  return rows.rows.map(row => `${row.created_at},${row.username ?? 'deleted'},${JSON.stringify(row.body)}`).join('\n');
});

app.get('/announcements/latest', async request => {
  const row = (await pool.query(`select a.*, ar.read_at from announcements a left join announcement_reads ar on ar.announcement_id=a.id and ar.user_id=$1 where a.deleted_at is null order by a.created_at desc limit 1`, [request.auth!.id])).rows[0];
  if (!row) return null;
  return { id: row.id, title: row.title, body: row.body, createdAt: row.created_at, isPopup: row.is_popup, pinToHome: row.pin_to_home, readAt: row.read_at };
});

app.get('/announcements', async request => {
  const rows = await pool.query(`select * from announcements where deleted_at is null order by pin_to_home desc, created_at desc limit 50`);
  return rows.rows.map(row => ({ id: row.id, title: row.title, body: row.body, imageUrl: row.image_url, linkUrl: row.link_url, linkLabel: row.link_label, createdAt: row.created_at, isPopup: row.is_popup, pinToHome: row.pin_to_home }));
});

app.post('/announcements/:id/read', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query('insert into announcement_reads (announcement_id,user_id) values ($1,$2) on conflict do nothing', [params.id, request.auth!.id]);
  return { ok: true };
});

app.get('/blogs', async () => {
  const rows = await pool.query(`select b.*, u.display_name from blogs b left join users u on u.id=b.author_id where b.deleted_at is null order by b.pinned desc, b.created_at desc limit 50`);
  return rows.rows.map(row => ({ id: row.id, title: row.title, body: row.body, imageUrl: row.image_url, linkUrl: row.link_url, linkLabel: row.link_label, category: row.category, authorName: row.display_name ?? 'Zevryl Staff', createdAt: row.created_at, pinned: row.pinned }));
});

app.get('/gifs/search', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async request => {
  const query = z.object({ q: z.string().trim().min(1).max(80).default('hello'), limit: z.coerce.number().int().min(1).max(80).default(40) }).parse(request.query);
  const results = await searchProviderGifs(query.q, query.limit);
  return results.length ? results : fallbackGifs.filter(item => item.title.toLowerCase().includes(query.q.toLowerCase()) || query.q.toLowerCase().includes(item.title.toLowerCase()));
});

app.get('/messages/:conversationId', async request => {
  const params = z.object({ conversationId: uuid }).parse(request.params);
  const query = z.object({ q: z.string().optional(), pinned: z.string().optional() }).parse(request.query);
  const rows = await pool.query(
    `select m.*, u.display_name as sender_name, b.blocked_id is not null as blocked_by_viewer
     from messages m
     left join users u on u.id=m.sender_id
     left join blocks b on b.blocker_id=$4 and b.blocked_id=m.sender_id
     where m.conversation_id=$1 and m.deleted_at is null
       and ($2::text is null or m.body ilike '%' || $2 || '%')
       and ($3::boolean is false or m.pinned=true)
     order by m.created_at asc limit 100`,
    [params.conversationId, query.q ?? null, query.pinned === '1', request.auth!.id]
  );
  return rows.rows.map(row => {
    const message = toMessage(row);
    if (row.blocked_by_viewer && row.sender_id !== request.auth!.id) {
      return { ...message, blocked: true, blockedAuthorName: row.sender_name ?? 'Unknown user' };
    }
    return message;
  });
});

app.post('/messages', async request => {
  const body = z.object({ conversationId: uuid, body: z.string().min(1).max(4000), type: z.enum(['text', 'image', 'video', 'file', 'gif']).default('text'), attachmentUrl: z.string().optional() }).parse(request.body);
  const mute = (await pool.query('select muted_until from users where id=$1 and muted_until > now()', [request.auth!.id])).rows[0];
  if (mute?.muted_until) throw app.httpErrors.forbidden(`You are muted until ${new Date(mute.muted_until).toLocaleString()}.`);
  const blocked = (await pool.query(
    `select 1 from conversation_members cm
     join blocks b on (b.blocker_id=$2 and b.blocked_id=cm.user_id) or (b.blocker_id=cm.user_id and b.blocked_id=$2)
     where cm.conversation_id=$1 and cm.user_id<>$2 limit 1`,
    [body.conversationId, request.auth!.id]
  )).rows[0];
  if (blocked) throw app.httpErrors.forbidden('This conversation includes a blocked user.');
  const id = crypto.randomUUID();
  await pool.query('insert into messages (id,conversation_id,sender_id,body,type,attachment_url) values ($1,$2,$3,$4,$5,$6)', [id, body.conversationId, request.auth!.id, body.body, body.type, body.attachmentUrl]);
  await redis.publish('messages', JSON.stringify({ id, conversationId: body.conversationId })).catch(() => undefined);
  await notifyConversation(body.conversationId, request.auth!.id, body.body);
  await audit(request.auth!.id, 'message.send', 'message', id);
  return { id, conversationId: body.conversationId, senderId: request.auth!.id, body: body.body, type: body.type, attachmentUrl: body.attachmentUrl, isEdited: false, pinned: false, createdAt: new Date().toISOString(), readBy: [], reactions: {} };
});

app.patch('/messages/:id', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const body = z.object({ body: z.string().min(1).max(4000) }).parse(request.body);
  const row = (await pool.query('update messages set body=$1,is_edited=true,updated_at=now() where id=$2 and sender_id=$3 and deleted_at is null returning *', [body.body, params.id, request.auth!.id])).rows[0];
  if (!row) throw app.httpErrors.notFound('Message not found.');
  await audit(request.auth!.id, 'message.edit', 'message', params.id);
  return toMessage(row);
});

app.post('/messages/:id/pin', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const row = (await pool.query('update messages set pinned=not pinned where id=$1 and deleted_at is null returning *', [params.id])).rows[0];
  if (!row) throw app.httpErrors.notFound('Message not found.');
  return toMessage(row);
});

app.delete('/messages/:id', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query('update messages set deleted_at=now() where id=$1 and sender_id=$2', [params.id, request.auth!.id]);
  await audit(request.auth!.id, 'message.delete', 'message', params.id);
  return { ok: true };
});

app.post('/typing/:conversationId', async request => {
  const params = z.object({ conversationId: uuid }).parse(request.params);
  const isMember = await pool.query('select 1 from conversation_members where conversation_id=$1 and user_id=$2', [params.conversationId, request.auth!.id]);
  if (!isMember.rowCount) throw app.httpErrors.forbidden('You are not in this chat.');
  const user = (await pool.query('select display_name, username from users where id=$1', [request.auth!.id])).rows[0];
  await redis.setex(`typing:${params.conversationId}:${request.auth!.id}`, 4, JSON.stringify({ id: request.auth!.id, displayName: user?.display_name ?? user?.username ?? 'Someone' }));
  return { ok: true };
});

app.get('/typing/:conversationId', async request => {
  const params = z.object({ conversationId: uuid }).parse(request.params);
  const isMember = await pool.query('select 1 from conversation_members where conversation_id=$1 and user_id=$2', [params.conversationId, request.auth!.id]);
  if (!isMember.rowCount) throw app.httpErrors.forbidden('You are not in this chat.');
  const keys = await redis.keys(`typing:${params.conversationId}:*`);
  if (!keys.length) return [];
  const values = await redis.mget(keys);
  return values
    .map(value => {
      try { return value ? JSON.parse(value) : null; } catch { return null; }
    })
    .filter((item): item is { id: string; displayName: string } => Boolean(item && item.id !== request.auth!.id));
});

app.post('/calls/token', async request => {
  const body = z.object({ roomName: z.string().min(1), canPublish: z.boolean().default(true), canSubscribe: z.boolean().default(true) }).parse(request.body);
  const kind = body.roomName.startsWith('video-') ? 'video' : 'voice';
  const conversationId = body.roomName.replace(/^(voice|video)-/, '');
  const group = (await pool.query(`select g.* from groups g join conversations c on c.group_id=g.id where c.id=$1`, [conversationId])).rows[0];
  if (group) {
    const memberCount = Number((await pool.query('select count(*) from conversation_members where conversation_id=$1', [conversationId])).rows[0].count);
    const limit = kind === 'video' ? group.video_limit : group.voice_limit;
    if (memberCount > limit) throw app.httpErrors.forbidden(`${kind === 'video' ? 'Video' : 'Voice'} call limit is ${limit} members for this group.`);
  }
  await notifyCall(body.roomName, request.auth!.id, kind);
  if (!env.livekitApiKey || !env.livekitApiSecret || !env.livekitUrl) {
    await audit(request.auth!.id, 'call.notify', 'room', body.roomName);
    return { url: '', token: '', roomName: body.roomName };
  }
  const user = (await pool.query('select display_name from users where id=$1', [request.auth!.id])).rows[0];
  const token = new AccessToken(env.livekitApiKey, env.livekitApiSecret, {
    identity: request.auth!.id,
    name: user?.display_name ?? 'Zevryl User',
    ttl: 60 * 60 * 12
  });
  token.addGrant({ room: body.roomName, roomJoin: true, canPublish: body.canPublish, canSubscribe: body.canSubscribe });
  await audit(request.auth!.id, 'call.token', 'room', body.roomName);
  return { url: env.livekitUrl, token: await token.toJwt(), roomName: body.roomName };
});

app.post('/notifications/register', async request => {
  const body = z.object({ token: z.string().min(8), platform: z.string().min(2) }).parse(request.body);
  await pool.query(
    'insert into push_tokens (token,user_id,platform) values ($1,$2,$3) on conflict (token) do update set user_id=$2, platform=$3, last_seen_at=now()',
    [body.token, request.auth!.id, body.platform]
  );
  return { ok: true };
});

app.get('/app/latest', async () => {
  const row = (await pool.query('select * from app_releases order by created_at desc limit 1')).rows[0];
  if (row) {
    return {
      version: row.version,
      title: row.title,
      notes: row.notes,
      apkUrl: row.apk_url,
      required: row.required
    };
  }
  return {
    version: '1.0.0',
    title: 'New Update 1.0.0',
    notes: 'Professional launch build with improved friends, groups, calls, tickets, themes, notifications, and admin tools.',
    apkUrl: 'https://github.com/AustinKarasu/Zevryl/releases/latest',
    required: false
  };
});

app.get('/tickets', async request => {
  const rows = await pool.query('select * from tickets where user_id=$1 order by created_at desc', [request.auth!.id]);
  return Promise.all(rows.rows.map(ticketWithUpdates));
});

app.post('/tickets', async request => {
  const body = z.object({ type: z.enum(['support', 'report', 'recovery', 'bug']), subject: z.string().min(2), body: z.string().min(2), proofUrl: z.string().optional(), targetUserId: uuid.optional() }).parse(request.body);
  const id = crypto.randomUUID();
  await pool.query('insert into tickets (id,user_id,type,subject,body,proof_url,target_user_id) values ($1,$2,$3,$4,$5,$6,$7)', [id, request.auth!.id, body.type, body.subject, body.body, body.proofUrl, body.targetUserId]);
  if (body.type === 'report') await pool.query('insert into reports (id,reporter_id,type,reason,proof_url,target_user_id) values ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), request.auth!.id, 'user', body.body, body.proofUrl, body.targetUserId]);
  await audit(request.auth!.id, 'ticket.create', 'ticket', id);
  return ticketWithUpdates((await pool.query('select * from tickets where id=$1', [id])).rows[0]);
});

app.patch('/tickets/:id', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const body = z.object({ status: z.enum(['open', 'reviewing', 'resolved', 'closed']).optional(), note: z.string().optional(), action: z.enum(['claim', 'close', 'reopen', 'delete', 'ban']).optional() }).parse(request.body);
  const ticket = (await pool.query('select * from tickets where id=$1', [params.id])).rows[0];
  if (!ticket) throw app.httpErrors.notFound('Ticket not found.');
  const isOwner = ticket.user_id === request.auth!.id;
  const isStaff = request.auth!.role === 'staff' || request.auth!.role === 'admin';
  if (!isOwner && !isStaff) throw app.httpErrors.forbidden('You cannot access this ticket.');
  if (body.note?.trim()) await pool.query('insert into ticket_updates (id,ticket_id,by_user_id,note) values ($1,$2,$3,$4)', [crypto.randomUUID(), params.id, request.auth!.id, body.note.trim()]);
  if (body.action === 'claim' && isStaff) await pool.query('update tickets set status=$2, claimed_by=$3 where id=$1', [params.id, 'reviewing', request.auth!.id]);
  if (body.action === 'close') await pool.query('update tickets set status=$2, closed_at=now() where id=$1', [params.id, 'closed']);
  if (body.action === 'reopen') await pool.query('update tickets set status=$2, closed_at=null where id=$1', [params.id, 'open']);
  if (body.status) await pool.query('update tickets set status=$2 where id=$1', [params.id, body.status]);
  if (body.action === 'ban' && isStaff && ticket.target_user_id) await pool.query('update users set is_banned=true where id=$1', [ticket.target_user_id]);
  return ticketWithUpdates((await pool.query('select * from tickets where id=$1', [params.id])).rows[0]);
});

app.delete('/tickets/:id', async request => {
  requireRole(request, ['admin', 'staff']);
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query('delete from tickets where id=$1', [params.id]);
  return { ok: true };
});

app.get('/tickets/:id/download', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const ticket = (await pool.query('select * from tickets where id=$1', [params.id])).rows[0];
  if (!ticket) throw app.httpErrors.notFound('Ticket not found.');
  const full = await ticketWithUpdates(ticket);
  return [`Ticket: ${full.subject}`, `Status: ${full.status}`, `Type: ${full.type}`, '', full.body, '', ...(full.updates ?? []).map(update => `[${update.at}] ${update.by}: ${update.note}`)].join('\n');
});

app.get('/admin/stats', async request => {
  requireRole(request, ['admin']);
  const users = Number((await pool.query('select count(*) from users')).rows[0].count);
  const reports = Number((await pool.query(`select count(*) from reports where status <> 'resolved'`)).rows[0].count);
  const activeGroups = Number((await pool.query('select count(*) from groups where archived_at is null')).rows[0].count);
  const announcements = Number((await pool.query('select count(*) from announcements where deleted_at is null')).rows[0].count);
  const blogs = Number((await pool.query('select count(*) from blogs where deleted_at is null')).rows[0].count);
  const activeUsers = Number((await pool.query(`select count(*) from users where active_at > now() - interval '15 minutes'`)).rows[0].count);
  const altUsers = Number((await pool.query(`select count(*) from users where alternate_email is not null or mobile is not null`)).rows[0].count);
  const invites = Number((await pool.query(`select count(*) from groups where invite_code is not null`)).rows[0].count);
  return { users, reports, activeGroups, systemHealth: 99, announcements, blogs, activeUsers, errors: 0, altUsers, invites };
});

app.get('/admin/users', async request => {
  requireRole(request, ['admin']);
  const rows = await pool.query('select * from users order by created_at desc limit 500');
  return rows.rows.map(toUser);
});

app.get('/admin/audit', async request => {
  requireRole(request, ['admin']);
  const query = z.object({ type: z.string().optional() }).parse(request.query);
  const values: string[] = [];
  const where = query.type ? 'where target_type=$1 or action like $1 || \'.%\'' : '';
  if (query.type) values.push(query.type);
  const rows = await pool.query(
    `select al.*, actor.email as actor_email, actor.display_name as actor_name
     from audit_logs al
     left join users actor on actor.id=al.actor_id
     ${where ? where.replace('target_type', 'al.target_type').replace('action', 'al.action') : ''}
     order by al.created_at desc limit 200`,
    values
  );
  return rows.rows.map(row => ({
    id: row.id,
    actorId: row.actor_id ?? undefined,
    actorEmail: row.actor_email ?? undefined,
    actorName: row.actor_name ?? undefined,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at
  }));
});

app.get('/admin/analytics', async request => {
  requireRole(request, ['admin']);
  const series = async (sql: string) => (await pool.query(sql)).rows.map(row => ({ date: row.day, count: Number(row.count) }));
  const [dailyUsers, newUsers, tickets, reports, crashLogs] = await Promise.all([
    series(`select to_char(day, 'YYYY-MM-DD') as day, coalesce(count(distinct u.id),0) as count from generate_series(current_date - interval '13 days', current_date, interval '1 day') day left join users u on date(u.active_at)=day::date group by day order by day`),
    series(`select to_char(day, 'YYYY-MM-DD') as day, coalesce(count(u.id),0) as count from generate_series(current_date - interval '13 days', current_date, interval '1 day') day left join users u on date(u.created_at)=day::date group by day order by day`),
    series(`select to_char(day, 'YYYY-MM-DD') as day, coalesce(count(t.id),0) as count from generate_series(current_date - interval '13 days', current_date, interval '1 day') day left join tickets t on date(t.created_at)=day::date group by day order by day`),
    series(`select to_char(day, 'YYYY-MM-DD') as day, coalesce(count(r.id),0) as count from generate_series(current_date - interval '13 days', current_date, interval '1 day') day left join reports r on date(r.created_at)=day::date group by day order by day`),
    pool.query('select id, reason, device, created_at from crash_logs order by created_at desc limit 50')
  ]);
  return {
    dailyUsers,
    newUsers,
    tickets,
    reports,
    crashLogs: crashLogs.rows.map(row => ({ id: row.id, reason: row.reason, device: row.device ?? undefined, createdAt: row.created_at }))
  };
});

app.get('/admin/announcements', async request => {
  requireRole(request, ['admin']);
  const rows = await pool.query('select * from announcements where deleted_at is null order by created_at desc');
  return rows.rows.map(row => ({ id: row.id, title: row.title, body: row.body, imageUrl: row.image_url, linkUrl: row.link_url, linkLabel: row.link_label, createdAt: row.created_at, isPopup: row.is_popup, pinToHome: row.pin_to_home }));
});

app.post('/admin/announcements', async request => {
  requireRole(request, ['admin']);
  const body = z.object({ title: z.string().min(2), body: z.string().min(2), isPopup: z.boolean(), pinToHome: z.boolean(), imageUrl: z.string().optional(), linkUrl: z.string().optional(), linkLabel: z.string().optional() }).parse(request.body);
  const id = crypto.randomUUID();
  await pool.query('insert into announcements (id,title,body,created_by,is_popup,pin_to_home,image_url,link_url,link_label) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, body.title, body.body, request.auth!.id, body.isPopup, body.pinToHome, body.imageUrl, body.linkUrl, body.linkLabel]);
  await audit(request.auth!.id, 'announcement.create', 'announcement', id);
  return { id, title: body.title, body: body.body, imageUrl: body.imageUrl, linkUrl: body.linkUrl, linkLabel: body.linkLabel, createdAt: new Date().toISOString(), isPopup: body.isPopup, pinToHome: body.pinToHome };
});

app.delete('/admin/announcements/:id', async request => {
  requireRole(request, ['admin']);
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query('update announcements set deleted_at=now() where id=$1', [params.id]);
  return { ok: true };
});

app.post('/admin/blogs', async request => {
  requireRole(request, ['admin']);
  const body = z.object({ title: z.string().min(2), body: z.string().min(2), category: z.string().default('Update'), pinned: z.boolean().default(false), imageUrl: z.string().optional(), linkUrl: z.string().optional(), linkLabel: z.string().optional() }).parse(request.body);
  const id = crypto.randomUUID();
  await pool.query('insert into blogs (id,title,body,category,pinned,image_url,link_url,link_label,author_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, body.title, body.body, body.category, body.pinned, body.imageUrl, body.linkUrl, body.linkLabel, request.auth!.id]);
  return { id, title: body.title, body: body.body, category: body.category, pinned: body.pinned, imageUrl: body.imageUrl, linkUrl: body.linkUrl, linkLabel: body.linkLabel, authorName: 'Admin', createdAt: new Date().toISOString() };
});

app.get('/admin/badges', async request => {
  requireRole(request, ['admin']);
  const rows = await pool.query('select * from badge_definitions order by created_at asc');
  return rows.rows.map(row => ({ id: row.id, name: row.name, icon: row.icon, color: row.color }));
});

app.post('/admin/badges', async request => {
  requireRole(request, ['admin']);
  const body = z.object({ name: z.string().min(2), icon: z.string().default('ribbon'), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#E6C07A') }).parse(request.body);
  const row = (await pool.query('insert into badge_definitions (id,name,icon,color) values ($1,$2,$3,$4) on conflict (name) do update set icon=$3,color=$4 returning *', [crypto.randomUUID(), body.name, body.icon, body.color])).rows[0];
  return { id: row.id, name: row.name, icon: row.icon, color: row.color };
});

app.delete('/admin/badges/:id', async request => {
  requireRole(request, ['admin']);
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query('delete from badge_definitions where id=$1', [params.id]);
  return { ok: true };
});

app.get('/admin/roles', async request => {
  requireRole(request, ['admin']);
  return [
    { id: 'user', name: 'User', permissions: ['chat', 'friends', 'groups', 'tickets'] },
    { id: 'staff', name: 'Staff', permissions: ['ticket.reply', 'ticket.close', 'moderation.view', 'user.mute'] },
    { id: 'admin', name: 'Admin', permissions: ['all', 'roles.manage', 'badges.manage', 'users.ban', 'announcements.manage'] }
  ];
});

app.get('/admin/users/search', async request => {
  requireRole(request, ['admin', 'staff']);
  const query = z.object({ q: z.string().default('') }).parse(request.query);
  const rows = await pool.query(`select * from users where username ilike '%' || $1 || '%' or display_name ilike '%' || $1 || '%' or email ilike '%' || $1 || '%' order by active_at desc nulls last limit 20`, [query.q]);
  return rows.rows.map(toUser);
});

app.post('/admin/users/moderate', async request => {
  requireRole(request, ['admin', 'staff']);
  const body = z.object({ userId: uuid, action: z.enum(['mute', 'ban', 'unban']), reason: z.string().optional(), hours: z.number().optional() }).parse(request.body);
  if (body.action === 'ban') await pool.query('update users set is_banned=true where id=$1', [body.userId]);
  if (body.action === 'unban') await pool.query('update users set is_banned=false where id=$1', [body.userId]);
  if (body.action === 'mute') await pool.query('update users set muted_until=now() + ($2::int || \' hours\')::interval where id=$1', [body.userId, body.hours ?? 8]);
  await audit(request.auth!.id, `punishment.${body.action}`, 'punishment', body.userId, {
    action: body.action,
    hours: body.action === 'mute' ? body.hours ?? 8 : body.hours,
    reason: body.reason || 'No reason provided.'
  });
  await audit(request.auth!.id, `user.${body.action}`, 'user', body.userId, { reason: body.reason, hours: body.hours });
  return { ok: true };
});

app.delete('/admin/blogs/:id', async request => {
  requireRole(request, ['admin']);
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query('update blogs set deleted_at=now() where id=$1', [params.id]);
  return { ok: true };
});

app.post('/admin/badges/grant', async request => {
  requireRole(request, ['admin']);
  const body = z.object({ username: z.string(), badge: z.string().min(1) }).parse(request.body);
  const target = await findUserForAdmin(body.username);
  if (!target) throw app.httpErrors.notFound('User not found.');
  const row = (await pool.query(
    `update users
     set badges=case when $2=any(badges) then badges else array_append(badges,$2) end
     where id=$1 returning *`,
    [target.id, body.badge]
  )).rows[0];
  return toUser(row);
});

app.post('/admin/users/role', async request => {
  requireRole(request, ['admin']);
  const body = z.object({ username: z.string(), role: z.enum(['user', 'staff', 'admin']) }).parse(request.body);
  const target = await findUserForAdmin(body.username);
  if (!target) throw app.httpErrors.notFound('User not found.');
  const row = (await pool.query('update users set role=$2 where id=$1 returning *', [target.id, body.role])).rows[0];
  return toUser(row);
});

app.post('/admin/users/update', async request => {
  requireRole(request, ['admin']);
  const body = z.object({ username: z.string(), newUsername: z.string().optional(), discriminator: z.string().optional(), mobile: z.string().optional(), alternateEmail: z.string().email().optional(), newPassword: z.string().min(8).optional(), resetUsernameLimit: z.boolean().optional() }).parse(request.body);
  const target = await findUserForAdmin(body.username);
  if (!target) throw app.httpErrors.notFound('User not found.');
  const passwordHash = body.newPassword ? await argon2.hash(body.newPassword) : undefined;
  const row = (await pool.query(
    `update users
     set username=coalesce($2,username),
         discriminator=coalesce($3,discriminator),
         mobile=coalesce($4,mobile),
         alternate_email=coalesce($5,alternate_email),
         password_hash=coalesce($6,password_hash),
         updated_at=now()
     where id=$1 returning *`,
    [target.id, body.newUsername?.toLowerCase(), body.discriminator, body.mobile, body.alternateEmail, passwordHash]
  )).rows[0];
  return toUser(row);
});

app.get('/admin/users/export', async request => {
  requireRole(request, ['admin']);
  const rows = await pool.query('select id,username,discriminator,email,role,presence,active_at,last_ip from users order by created_at desc');
  return ['id,username,email,role,presence,active_at,last_ip', ...rows.rows.map(row => `${row.id},${row.username}#${row.discriminator},${row.email},${row.role},${row.presence},${row.active_at ?? ''},${row.last_ip ?? ''}`)].join('\n');
});

app.get('/staff/reports', async request => {
  requireRole(request, ['admin', 'staff']);
  const rows = await pool.query('select * from reports order by created_at desc limit 100');
  const tickets = await pool.query('select * from tickets order by created_at desc limit 100');
  return {
    reports: rows.rows.map(row => ({ id: row.id, type: row.type, reason: row.reason, status: row.status, createdAt: row.created_at, proofUrl: row.proof_url, reporterId: row.reporter_id, targetUserId: row.target_user_id })),
    tickets: await Promise.all(tickets.rows.map(ticketWithUpdates))
  };
});

app.get('/staff/logs', async request => {
  requireRole(request, ['admin', 'staff']);
  const rows = await pool.query(
    `select al.*, actor.email as actor_email, actor.display_name as actor_name from audit_logs al
     left join users actor on actor.id=al.actor_id
     where coalesce(actor.role, 'user') <> 'admin'
       and (al.target_type in ('ticket','report','punishment','user') or al.action like 'punishment.%')
     order by al.created_at desc limit 200`
  );
  return rows.rows.map(row => ({
    id: row.id,
    actorId: row.actor_id ?? undefined,
    actorEmail: row.actor_email ?? undefined,
    actorName: row.actor_name ?? undefined,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at
  }));
});

app.get('/staff/analytics', async request => {
  requireRole(request, ['admin', 'staff']);
  const series = async (sql: string) => (await pool.query(sql)).rows.map(row => ({ date: row.day, count: Number(row.count) }));
  const [dailyReports, dailyBansMutes] = await Promise.all([
    series(`select to_char(day, 'YYYY-MM-DD') as day, coalesce(count(r.id),0) as count from generate_series(current_date - interval '13 days', current_date, interval '1 day') day left join reports r on date(r.created_at)=day::date group by day order by day`),
    series(`select to_char(day, 'YYYY-MM-DD') as day, coalesce(count(al.id),0) as count from generate_series(current_date - interval '13 days', current_date, interval '1 day') day left join audit_logs al on date(al.created_at)=day::date and al.action in ('punishment.ban','punishment.mute') group by day order by day`)
  ]);
  return { dailyReports, dailyBansMutes };
});

await migrate();
await bootstrapAdmin();
await app.listen({ host: env.host, port: env.port });
