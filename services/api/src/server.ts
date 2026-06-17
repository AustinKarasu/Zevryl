import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import argon2 from 'argon2';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { SignJWT, jwtVerify } from 'jose';
import { AccessToken } from 'livekit-server-sdk';
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
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? ''
};

const app = Fastify({ logger: true });
const pool = new pg.Pool({ connectionString: env.databaseUrl });
const redis = new Redis(env.redisUrl, { lazyConnect: true });
const accessKey = new TextEncoder().encode(env.accessSecret);
const refreshKey = new TextEncoder().encode(env.refreshSecret);

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
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? undefined,
    bannerUrl: row.banner_url ?? undefined,
    profileColor: row.profile_color,
    bio: row.bio ?? '',
    pronouns: row.pronouns ?? undefined,
    customStatus: row.custom_status ?? undefined,
    presence: row.presence,
    badges: row.badges ?? [],
    role: row.role
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
  `);
}

async function audit(actorId: string | null, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  await pool.query('insert into audit_logs (id,actor_id,action,target_type,target_id,metadata) values ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), actorId, action, targetType, targetId, metadata]);
}

async function sign(user: Auth, kind: 'access' | 'refresh') {
  return new SignJWT({ role: user.role, kind })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(kind === 'access' ? '15m' : '30d')
    .sign(kind === 'access' ? accessKey : refreshKey);
}

async function requireAuth(request: any) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw app.httpErrors.unauthorized('Please sign in.');
  const verified = await jwtVerify(header.slice(7), accessKey);
  request.auth = { id: String(verified.payload.sub), role: verified.payload.role as Auth['role'] };
}

function requireRole(request: any, roles: Auth['role'][]) {
  if (!request.auth || !roles.includes(request.auth.role)) throw app.httpErrors.forbidden('You do not have permission for this action.');
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
app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

app.addHook('preHandler', async request => {
  const url = request.routeOptions.url ?? '';
  if (url.startsWith('/auth/') || url === '/health') return;
  await requireAuth(request);
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

app.post('/auth/register', async request => {
  const body = z.object({ fullName: z.string().min(2), email, username: z.string().min(3), password: z.string().min(8) }).parse(request.body);
  const id = crypto.randomUUID();
  await pool.query('insert into users (id,email,username,password_hash,display_name,presence) values ($1,$2,$3,$4,$5,$6)', [id, body.email, body.username.toLowerCase(), await argon2.hash(body.password), body.fullName, 'online']);
  const user = toUser((await pool.query('select * from users where id=$1', [id])).rows[0]);
  const accessToken = await sign({ id, role: user.role }, 'access');
  const refreshToken = await sign({ id, role: user.role }, 'refresh');
  await pool.query('insert into sessions (id,user_id,refresh_token_hash,user_agent,ip_address) values ($1,$2,$3,$4,$5)', [crypto.randomUUID(), id, await argon2.hash(refreshToken), request.headers['user-agent'], request.ip]);
  await audit(id, 'auth.register', 'user', id);
  return { user, accessToken, refreshToken };
});

app.post('/auth/login', async request => {
  const body = z.object({ emailOrUsername: z.string().min(1), password: z.string().min(1) }).parse(request.body);
  const result = await pool.query('select * from users where (email=$1 or username=$1) and is_banned=false', [body.emailOrUsername.toLowerCase()]);
  const row = result.rows[0];
  if (!row || !(await argon2.verify(row.password_hash, body.password))) throw app.httpErrors.unauthorized('Email or password is incorrect.');
  await pool.query('update users set presence=$1 where id=$2', ['online', row.id]);
  const user = toUser({ ...row, presence: 'online' });
  const accessToken = await sign({ id: user.id, role: user.role }, 'access');
  const refreshToken = await sign({ id: user.id, role: user.role }, 'refresh');
  await pool.query('insert into sessions (id,user_id,refresh_token_hash,user_agent,ip_address) values ($1,$2,$3,$4,$5)', [crypto.randomUUID(), user.id, await argon2.hash(refreshToken), request.headers['user-agent'], request.ip]);
  await audit(user.id, 'auth.login', 'user', user.id);
  return { user, accessToken, refreshToken };
});

app.post('/auth/forgot-password', async () => ({ ok: true }));
app.post('/auth/reset-password', async () => ({ ok: true }));
app.post('/auth/otp/request', async () => ({ ok: true }));
app.post('/auth/otp/verify', async () => ({ ok: true }));
app.post('/auth/logout', async request => {
  await pool.query('update users set presence=$1 where id=$2', ['offline', request.auth!.id]);
  await audit(request.auth!.id, 'auth.logout', 'user', request.auth!.id);
  return { ok: true };
});

app.get('/me', async request => {
  const row = (await pool.query('select * from users where id=$1', [request.auth!.id])).rows[0];
  if (!row) throw app.httpErrors.notFound('Account not found.');
  return toUser(row);
});

app.get('/friends', async request => {
  const userId = request.auth!.id;
  const friends = await pool.query(`select u.* from users u join friendships f on (f.user_a=$1 and f.user_b=u.id) or (f.user_b=$1 and f.user_a=u.id)`, [userId]);
  const incoming = await pool.query(`select fr.*, from_u.*, to_u.id as to_id from friend_requests fr join users from_u on from_u.id=fr.from_user_id join users to_u on to_u.id=fr.to_user_id where fr.to_user_id=$1 and fr.status='pending'`, [userId]);
  const outgoing = await pool.query(`select fr.*, to_u.* from friend_requests fr join users to_u on to_u.id=fr.to_user_id where fr.from_user_id=$1 and fr.status='pending'`, [userId]);
  return {
    friends: friends.rows.map(toUser),
    incoming: incoming.rows.map(row => ({ id: row.id, fromUser: toUser(row), toUser: toUser({ ...row, id: row.to_id }), status: row.status, createdAt: row.created_at })),
    outgoing: outgoing.rows.map(row => ({ id: row.id, fromUser: toUser({ ...row, id: userId }), toUser: toUser(row), status: row.status, createdAt: row.created_at })),
    blocked: []
  };
});

app.post('/friends/request', async request => {
  const body = z.object({ username: z.string().min(3) }).parse(request.body);
  const target = (await pool.query('select id from users where username=$1', [body.username.toLowerCase()])).rows[0];
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
  await pool.query('update friend_requests set status=$1, responded_at=now() where id=$2', ['accepted', params.id]);
  await pool.query('insert into friendships (user_a,user_b) values ($1,$2) on conflict do nothing', [req.from_user_id, req.to_user_id]);
  await audit(request.auth!.id, 'friend.accept', 'friend_request', params.id);
  return { ok: true };
});

app.post('/friends/requests/:id/deny', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query('update friend_requests set status=$1, responded_at=now() where id=$2 and to_user_id=$3', ['denied', params.id, request.auth!.id]);
  await audit(request.auth!.id, 'friend.deny', 'friend_request', params.id);
  return { ok: true };
});

app.delete('/friends/:id', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query('delete from friendships where (user_a=$1 and user_b=$2) or (user_a=$2 and user_b=$1)', [request.auth!.id, params.id]);
  await audit(request.auth!.id, 'friend.remove', 'user', params.id);
  return { ok: true };
});

app.get('/groups', async request => {
  const rows = await pool.query(`select g.*, count(gm.user_id)::int as member_count from groups g join group_members gm on gm.group_id=g.id where g.archived_at is null and g.id in (select group_id from group_members where user_id=$1 and banned_at is null) group by g.id order by g.created_at desc`, [request.auth!.id]);
  return rows.rows.map(row => ({ id: row.id, name: row.name, description: row.description, ownerId: row.owner_id, avatarUrl: row.avatar_url, bannerUrl: row.banner_url, slowmodeSeconds: row.slowmode_seconds, memberCount: row.member_count, unreadCount: 0 }));
});

app.post('/groups', async request => {
  const body = z.object({ name: z.string().min(2), description: z.string().default(''), friendIds: z.array(uuid).min(1) }).parse(request.body);
  const groupId = crypto.randomUUID();
  await pool.query('insert into groups (id,owner_id,name,description) values ($1,$2,$3,$4)', [groupId, request.auth!.id, body.name, body.description]);
  await pool.query('insert into group_members (group_id,user_id,role) values ($1,$2,$3)', [groupId, request.auth!.id, 'owner']);
  for (const friendId of body.friendIds) await pool.query('insert into group_members (group_id,user_id,role) values ($1,$2,$3) on conflict do nothing', [groupId, friendId, 'member']);
  await audit(request.auth!.id, 'group.create', 'group', groupId);
  const row = (await pool.query('select *, $2::int as member_count from groups where id=$1', [groupId, body.friendIds.length + 1])).rows[0];
  return { id: row.id, name: row.name, description: row.description, ownerId: row.owner_id, slowmodeSeconds: row.slowmode_seconds, memberCount: row.member_count, unreadCount: 0 };
});

app.get('/announcements/latest', async request => {
  const row = (await pool.query(`select a.*, ar.read_at from announcements a left join announcement_reads ar on ar.announcement_id=a.id and ar.user_id=$1 where a.deleted_at is null order by a.created_at desc limit 1`, [request.auth!.id])).rows[0];
  if (!row) return null;
  return { id: row.id, title: row.title, body: row.body, createdAt: row.created_at, isPopup: row.is_popup, pinToHome: row.pin_to_home, readAt: row.read_at };
});

app.post('/announcements/:id/read', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query('insert into announcement_reads (announcement_id,user_id) values ($1,$2) on conflict do nothing', [params.id, request.auth!.id]);
  return { ok: true };
});

app.get('/messages/:conversationId', async request => {
  const params = z.object({ conversationId: uuid }).parse(request.params);
  const rows = await pool.query('select * from messages where conversation_id=$1 and deleted_at is null order by created_at asc limit 100', [params.conversationId]);
  return rows.rows.map(row => ({ id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, body: row.body, type: row.type, attachmentUrl: row.attachment_url, isEdited: row.is_edited, createdAt: row.created_at, readBy: [], reactions: {} }));
});

app.post('/messages', async request => {
  const body = z.object({ conversationId: uuid, body: z.string().min(1).max(4000) }).parse(request.body);
  const id = crypto.randomUUID();
  await pool.query('insert into messages (id,conversation_id,sender_id,body) values ($1,$2,$3,$4)', [id, body.conversationId, request.auth!.id, body.body]);
  await redis.publish('messages', JSON.stringify({ id, conversationId: body.conversationId })).catch(() => undefined);
  await audit(request.auth!.id, 'message.send', 'message', id);
  return { id, conversationId: body.conversationId, senderId: request.auth!.id, body: body.body, type: 'text', isEdited: false, createdAt: new Date().toISOString(), readBy: [], reactions: {} };
});

app.patch('/messages/:id', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  const body = z.object({ body: z.string().min(1).max(4000) }).parse(request.body);
  const row = (await pool.query('update messages set body=$1,is_edited=true,updated_at=now() where id=$2 and sender_id=$3 and deleted_at is null returning *', [body.body, params.id, request.auth!.id])).rows[0];
  if (!row) throw app.httpErrors.notFound('Message not found.');
  await audit(request.auth!.id, 'message.edit', 'message', params.id);
  return { id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, body: row.body, type: row.type, isEdited: row.is_edited, createdAt: row.created_at, readBy: [], reactions: {} };
});

app.delete('/messages/:id', async request => {
  const params = z.object({ id: uuid }).parse(request.params);
  await pool.query('update messages set deleted_at=now() where id=$1 and sender_id=$2', [params.id, request.auth!.id]);
  await audit(request.auth!.id, 'message.delete', 'message', params.id);
  return { ok: true };
});

app.post('/calls/token', async request => {
  const body = z.object({ roomName: z.string().min(1), canPublish: z.boolean().default(true), canSubscribe: z.boolean().default(true) }).parse(request.body);
  if (!env.livekitApiKey || !env.livekitApiSecret || !env.livekitUrl) throw app.httpErrors.serviceUnavailable('Calls are not configured yet.');
  const user = (await pool.query('select display_name from users where id=$1', [request.auth!.id])).rows[0];
  const token = new AccessToken(env.livekitApiKey, env.livekitApiSecret, {
    identity: request.auth!.id,
    name: user?.display_name ?? 'Zevryl User'
  });
  token.addGrant({ room: body.roomName, roomJoin: true, canPublish: body.canPublish, canSubscribe: body.canSubscribe });
  await audit(request.auth!.id, 'call.token', 'room', body.roomName);
  return { url: env.livekitUrl, token: await token.toJwt(), roomName: body.roomName };
});

app.get('/admin/stats', async request => {
  requireRole(request, ['admin']);
  const users = Number((await pool.query('select count(*) from users')).rows[0].count);
  const reports = Number((await pool.query(`select count(*) from reports where status <> 'resolved'`)).rows[0].count);
  const activeGroups = Number((await pool.query('select count(*) from groups where archived_at is null')).rows[0].count);
  return { users, reports, activeGroups, systemHealth: 99 };
});

app.post('/admin/announcements', async request => {
  requireRole(request, ['admin']);
  const body = z.object({ title: z.string().min(2), body: z.string().min(2), isPopup: z.boolean(), pinToHome: z.boolean() }).parse(request.body);
  const id = crypto.randomUUID();
  await pool.query('insert into announcements (id,title,body,created_by,is_popup,pin_to_home) values ($1,$2,$3,$4,$5,$6)', [id, body.title, body.body, request.auth!.id, body.isPopup, body.pinToHome]);
  await audit(request.auth!.id, 'announcement.create', 'announcement', id);
  return { id, title: body.title, body: body.body, createdAt: new Date().toISOString(), isPopup: body.isPopup, pinToHome: body.pinToHome };
});

app.get('/staff/reports', async request => {
  requireRole(request, ['admin', 'staff']);
  const rows = await pool.query('select * from reports order by created_at desc limit 100');
  return rows.rows.map(row => ({ id: row.id, type: row.type, reason: row.reason, status: row.status, createdAt: row.created_at }));
});

await migrate();
await bootstrapAdmin();
await app.listen({ host: env.host, port: env.port });
