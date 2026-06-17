import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, clearTokens, setTokens } from './api';
import type {
  Announcement,
  AppTab,
  BlogPost,
  Conversation,
  DashboardStats,
  FriendState,
  Group,
  Message,
  Report,
  User
} from './types';

const logo = require('../assets/zevryl-logo.png');
const wordmark = require('../assets/zevryl-wordmark.png');

type Loadable<T> = { loading: boolean; data: T; error?: string };
type NoticeTone = 'error' | 'success' | 'info';
type Notice = { tone: NoticeTone; text: string } | null;

const emptyFriends: FriendState = { friends: [], incoming: [], outgoing: [], blocked: [] };
const emptyStats: DashboardStats = { users: 0, reports: 0, activeGroups: 0, systemHealth: 0, announcements: 0, blogs: 0 };
const emojis = ['😀', '🔥', '✅', '💬', '⭐', '🛡️', '🌿', '⚒️'];
const badgeIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  Founder: 'diamond',
  Admin: 'shield-checkmark',
  Mod: 'hammer',
  Staff: 'briefcase',
  Member: 'person',
  Vip: 'star',
  Partner: 'people',
  Demo: 'flask'
};
const presenceMeta: Record<User['presence'], { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  online: { label: 'Online', icon: 'ellipse', color: '#4FCC7A' },
  dnd: { label: 'Do Not Disturb', icon: 'remove-circle', color: '#E15E55' },
  idle: { label: 'Idle', icon: 'moon', color: '#D9A441' },
  invisible: { label: 'Invisible', icon: 'ellipse-outline', color: '#8D9688' },
  offline: { label: 'Offline', icon: 'ellipse-outline', color: '#8D9688' }
};
const gifs = [
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExb2d4MzgzdTBqOWc3eGxxZGNzYnRydjF0dDhtczlmbzhmOWUwajU2MiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/111ebonMs90YLu/giphy.gif',
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExZmRnOWlzZ2l3enV4Mmpyc2t6Zm82dzV5N2Vzd3NlNXQ2Ynpmb3pyNCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/l0HlNaQ6gWfllcjDO/giphy.gif',
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExYnV3d2VudnV3enVscnE2djZxa2U5bXF0OWM1eXo0d3hnMHU3bHVqNCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/26ufdipQqU2lhNA4g/giphy.gif'
];

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<AppTab>('home');
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const insets = useSafeAreaInsets();

  const showNotice = (tone: NoticeTone, text: string) => {
    setNotice({ tone, text });
    setTimeout(() => setNotice(current => (current?.text === text ? null : current)), 5200);
  };

  useEffect(() => {
    Promise.all([api.me(), api.latestAnnouncement()])
      .then(([me, latest]) => {
        setUser(me);
        setAnnouncement(latest);
        setShowAnnouncement(Boolean(latest?.isPopup && !latest.readAt));
      })
      .catch(() => undefined)
      .finally(() => setTimeout(() => setBooting(false), 550));
  }, []);

  async function completeAuth(nextUser: User, accessToken: string, refreshToken: string) {
    await setTokens(accessToken, refreshToken);
    setUser(nextUser);
    setTab('home');
    const latest = await api.latestAnnouncement().catch(() => null);
    setAnnouncement(latest);
    setShowAnnouncement(Boolean(latest?.isPopup && !latest.readAt));
  }

  if (booting) return <SplashScreen />;
  if (!user) return <AuthScreen onDone={completeAuth} notify={showNotice} notice={notice} />;

  return (
    <TerraShell>
      <SafeAreaView style={styles.app}>
        <Header user={user} setTab={setTab} />
        <View style={styles.content}>
          {renderTab(tab, user, {
            setUser,
            setAnnouncement,
            setShowAnnouncement,
            setTab,
            notify: showNotice
          })}
        </View>
        <NoticeFooter notice={notice} bottom={insets.bottom + 94} />
        <BottomNav tab={tab} setTab={setTab} user={user} bottom={Math.max(insets.bottom + 18, 34)} />
        <AnnouncementModal
          announcement={announcement}
          visible={showAnnouncement}
          onClose={async () => {
            setShowAnnouncement(false);
            if (announcement) await api.markAnnouncementRead(announcement.id).catch(() => undefined);
          }}
        />
      </SafeAreaView>
    </TerraShell>
  );
}

function renderTab(
  tab: AppTab,
  user: User,
  tools: {
    setUser: (user: User | null) => void;
    setAnnouncement: (a: Announcement | null) => void;
    setShowAnnouncement: (v: boolean) => void;
    setTab: (tab: AppTab) => void;
    notify: (tone: 'error' | 'success' | 'info', text: string) => void;
  }
) {
  if (tab === 'admin' && user.role !== 'admin') return <LockedScreen title="Admin only" />;
  if (tab === 'staff' && user.role !== 'staff' && user.role !== 'admin') return <LockedScreen title="Staff only" />;
  if (tab === 'home') return <HomeScreen user={user} notify={tools.notify} />;
  if (tab === 'friends') return <FriendsScreen notify={tools.notify} setTab={tools.setTab} />;
  if (tab === 'groups') return <GroupsScreen notify={tools.notify} />;
  if (tab === 'chats') return <ChatScreen user={user} notify={tools.notify} />;
  if (tab === 'profile') return <ProfileScreen user={user} setUser={tools.setUser} notify={tools.notify} />;
  if (tab === 'settings') return <SettingsScreen user={user} setTab={tools.setTab} setUser={tools.setUser} notify={tools.notify} />;
  if (tab === 'admin') return <AdminScreen setAnnouncement={tools.setAnnouncement} setShowAnnouncement={tools.setShowAnnouncement} notify={tools.notify} />;
  if (tab === 'staff') return <StaffScreen notify={tools.notify} />;
  return null;
}

function TerraShell({ children }: { children: React.ReactNode }) {
  return (
    <LinearGradient colors={['#111712', '#19221A', '#2A2118']} style={styles.shell}>
      <View style={styles.terraBandTop} />
      <View style={styles.terraBandBottom} />
      {children}
    </LinearGradient>
  );
}

function SplashScreen() {
  return (
    <TerraShell>
      <SafeAreaView style={styles.splash}>
        <View style={styles.splashContent}>
          <Image source={wordmark} style={styles.splashWordmark} resizeMode="contain" />
          <Text style={styles.brandTitle}>Zevryl</Text>
          <Text style={styles.brandSub}>SECURE COMMUNITY</Text>
          <Text style={styles.splashTagline}>Connect privately, chat freely</Text>
        </View>
        <View style={styles.splashFooter}>
          <View style={styles.loadingBar}>
            <View style={styles.loadingFill} />
          </View>
          <Text style={styles.loadingText}>Initializing secure connection...</Text>
        </View>
      </SafeAreaView>
    </TerraShell>
  );
}

function AuthScreen({ onDone, notify, notice }: { onDone: (user: User, accessToken: string, refreshToken: string) => Promise<void>; notify: (tone: 'error' | 'success' | 'info', text: string) => void; notice: Notice }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email || !password) return notify('error', 'Enter your email and password.');
    if (mode === 'register' && (!fullName || !username)) return notify('error', 'Fill in all account details.');
    if (mode === 'register' && password !== confirm) return notify('error', 'Passwords do not match.');
    setBusy(true);
    try {
      const result = mode === 'login'
        ? await api.login(email, password)
        : await api.register({ fullName, email, username, password });
      await onDone(result.user, result.accessToken, result.refreshToken);
      notify('success', 'Signed in.');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    if (!email) return notify('error', 'Enter your email first.');
    await api.forgotPassword(email)
      .then(() => notify('success', 'Password reset request accepted.'))
      .catch(error => notify('error', error.message));
  }

  return (
    <TerraShell>
      <SafeAreaView style={styles.authWrap}>
        <View style={styles.authPanel}>
          <Image source={wordmark} style={styles.authWordmark} resizeMode="contain" />
          <Text style={styles.authText}>A grounded Terria workspace for friends, staff, updates, and secure DMs.</Text>
          {mode === 'register' && <Field icon="person" placeholder="Full name" value={fullName} onChangeText={setFullName} />}
          <Field icon="mail" placeholder="Email or username" value={email} onChangeText={setEmail} autoCapitalize="none" />
          {mode === 'register' && <Field icon="at" placeholder="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />}
          <Field icon="lock-closed" placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {mode === 'register' && <Field icon="shield-checkmark" placeholder="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry />}
          {mode === 'login' && <Pressable onPress={forgotPassword}><Text style={styles.link}>Forgot password?</Text></Pressable>}
          <PrimaryButton label={mode === 'login' ? 'Login' : 'Create Account'} icon={mode === 'login' ? 'arrow-forward' : 'person-add'} busy={busy} onPress={submit} />
          <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')} style={styles.switchAuth}>
            <Text style={styles.muted}>{mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Login'}</Text>
          </Pressable>
        </View>
        <NoticeFooter notice={notice} bottom={24} />
      </SafeAreaView>
    </TerraShell>
  );
}

function HomeScreen({ user, notify }: { user: User; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [announcements, setAnnouncements] = useState<Loadable<Announcement[]>>({ loading: true, data: [] });
  const [blogs, setBlogs] = useState<Loadable<BlogPost[]>>({ loading: true, data: [] });
  const [view, setView] = useState<'updates' | 'support'>('updates');

  const load = () => {
    Promise.all([api.announcements(), api.blogs()])
      .then(([a, b]) => {
        setAnnouncements({ loading: false, data: a });
        setBlogs({ loading: false, data: b });
      })
      .catch(error => {
        setAnnouncements({ loading: false, data: [], error: error.message });
        setBlogs({ loading: false, data: [], error: error.message });
        notify('error', error.message);
      });
  };
  useEffect(() => { load(); }, []);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.homeHeader}>
        <View>
          <Text style={styles.kicker}>Terria Network</Text>
          <Text style={styles.hero}>Home</Text>
        </View>
        <StatusPill presence={user.presence} />
      </View>
      <View style={styles.segment}>
        <Pressable style={[styles.segmentItem, view === 'updates' && styles.segmentActive]} onPress={() => setView('updates')}><Text style={styles.segmentText}>Updates</Text></Pressable>
        <Pressable style={[styles.segmentItem, view === 'support' && styles.segmentActive]} onPress={() => setView('support')}><Text style={styles.segmentText}>Support</Text></Pressable>
      </View>
      {view === 'support' ? (
        <>
          <FeatureCard title="Need help?" body="Use staff reports for safety issues, or DM a staff member when available." icon="help-circle" />
          <FeatureCard title="Account recovery" body="Forgot password accepts recovery requests. Staff can review support cases from the dashboard." icon="key" />
          <FeatureCard title="Community safety" body="Reports, badges, roles, and announcements are managed through role-gated tools." icon="shield-checkmark" />
        </>
      ) : (
        <>
          <SectionTitle title="Announcements" action="Refresh" onPress={load} />
          {announcements.loading ? <LoadingState /> : announcements.error ? <ErrorState message={announcements.error} onRetry={load} /> : announcements.data.length === 0 ? <EmptyState title="No announcements" body="Official updates will appear here." /> : announcements.data.map(item => (
            <AnnouncementCard key={item.id} item={item} />
          ))}
          <SectionTitle title="Posts" />
          {blogs.loading ? <LoadingState /> : blogs.data.length === 0 ? <EmptyState title="No posts yet" body="Admin blog posts will appear here." /> : blogs.data.map(post => (
            <GlassCard key={post.id} style={styles.postCard}>
              {post.imageUrl ? <Image source={{ uri: post.imageUrl }} style={styles.postImage} resizeMode="cover" /> : null}
              <View style={styles.postTop}><Text style={styles.badge}>{post.category}</Text><Text style={styles.meta}>{new Date(post.createdAt).toLocaleDateString()}</Text></View>
              <Text style={styles.cardTitle}>{post.title}</Text>
              <RichText text={post.body} />
              {post.linkUrl ? <Pressable onPress={() => openLink(post.linkUrl)}><Text style={styles.link}>{post.linkLabel || post.linkUrl}</Text></Pressable> : null}
              <Text style={styles.meta}>By {post.authorName}</Text>
            </GlassCard>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function FriendsScreen({ notify, setTab }: { notify: (tone: 'error' | 'success' | 'info', text: string) => void; setTab: (tab: AppTab) => void }) {
  const [state, setState] = useState<Loadable<FriendState>>({ loading: true, data: emptyFriends });
  const [username, setUsername] = useState('');

  const load = () => api.friends()
    .then(data => setState({ loading: false, data }))
    .catch(error => { setState({ loading: false, data: emptyFriends, error: error.message }); notify('error', error.message); });
  useEffect(() => { load(); }, []);

  async function action(task: Promise<unknown>, ok: string) {
    await task.then(() => notify('success', ok)).catch(error => notify('error', error.message));
    load();
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <SectionTitle title="Friends" action="Refresh" onPress={load} />
      <GlassCard>
        <Text style={styles.cardTitle}>Add Friend</Text>
        <Field icon="person-add" placeholder="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
        <PrimaryButton label="Send Request" icon="send" onPress={() => username ? action(api.requestFriend(username), 'Friend request sent.') : notify('error', 'Enter a username first.')} />
      </GlassCard>
      {state.loading ? <LoadingState /> : state.error ? <ErrorState message={state.error} onRetry={load} /> : null}
      <UserList title="Direct Messages" users={state.data.friends} empty="Add a friend to start a DM." right={(friend) => (
        <View style={styles.rowActions}>
          <IconButton icon="chatbubble" onPress={async () => {
            await api.createDm(friend.id).then(() => { notify('success', `DM ready with ${friend.displayName}.`); setTab('chats'); }).catch(error => notify('error', error.message));
          }} />
          <IconButton icon="close" onPress={() => action(api.removeFriend(friend.id), 'Friend removed.')} />
        </View>
      )} />
      <RequestList title="Incoming Requests" requests={state.data.incoming} accept={id => action(api.acceptFriend(id), 'Request accepted.')} deny={id => action(api.denyFriend(id), 'Request denied.')} />
      <RequestList title="Outgoing Requests" requests={state.data.outgoing} />
    </ScrollView>
  );
}

function GroupsScreen({ notify }: { notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [groups, setGroups] = useState<Loadable<Group[]>>({ loading: true, data: [] });
  const [friends, setFriends] = useState<FriendState>(emptyFriends);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const load = () => Promise.all([api.groups(), api.friends()])
    .then(([groupData, friendData]) => { setGroups({ loading: false, data: groupData }); setFriends(friendData); })
    .catch(error => { setGroups({ loading: false, data: [], error: error.message }); notify('error', error.message); });
  useEffect(() => { load(); }, []);

  async function create() {
    if (!name.trim()) return notify('error', 'Group name required.');
    if (selected.length < 1) return notify('error', 'Select at least one friend.');
    await api.createGroup({ name, description, friendIds: selected })
      .then(() => { setName(''); setDescription(''); setSelected([]); notify('success', 'Group created.'); load(); })
      .catch(error => notify('error', error.message));
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <SectionTitle title="Groups" action="Refresh" onPress={load} />
      {groups.loading ? <LoadingState /> : groups.error ? <ErrorState message={groups.error} onRetry={load} /> : groups.data.map(group => (
        <GlassCard key={group.id} style={styles.listCard}><Text style={styles.cardTitle}>{group.name}</Text><Text style={styles.muted}>{group.description || 'No description yet.'}</Text><Text style={styles.badge}>{group.memberCount} members · {group.unreadCount} unread</Text></GlassCard>
      ))}
      {groups.data.length === 0 && !groups.loading && <EmptyState title="No groups yet" body="Create a group after adding at least one friend." />}
      <GlassCard>
        <Text style={styles.cardTitle}>Create Group</Text>
        <Field icon="people" placeholder="Group name" value={name} onChangeText={setName} />
        <Field icon="document-text" placeholder="Description" value={description} onChangeText={setDescription} />
        <Text style={styles.label}>Select Friends</Text>
        {friends.friends.map(friend => <Pressable key={friend.id} style={styles.memberPick} onPress={() => setSelected(prev => prev.includes(friend.id) ? prev.filter(id => id !== friend.id) : [...prev, friend.id])}><Text style={styles.body}>{friend.displayName}</Text><Ionicons name={selected.includes(friend.id) ? 'radio-button-on' : 'radio-button-off'} size={22} color="#CDA16A" /></Pressable>)}
        {friends.friends.length === 0 && <Text style={styles.muted}>Add at least one friend before creating a group.</Text>}
        <PrimaryButton label="Create Group" icon="add" onPress={create} />
      </GlassCard>
    </ScrollView>
  );
}

function ChatScreen({ user, notify }: { user: User; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [conversations, setConversations] = useState<Loadable<Conversation[]>>({ loading: true, data: [] });
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGif, setShowGif] = useState(false);

  const loadConversations = () => api.conversations()
    .then(data => {
      setConversations({ loading: false, data });
      if (!selected && data[0]) setSelected(data[0]);
    })
    .catch(error => { setConversations({ loading: false, data: [], error: error.message }); notify('error', error.message); });
  useEffect(() => { loadConversations(); }, []);

  useEffect(() => {
    if (!selected) return;
    api.messages(selected.id).then(setMessages).catch(error => notify('error', error.message));
  }, [selected?.id]);

  async function send(payload?: { type?: Message['type']; attachmentUrl?: string; body?: string }) {
    if (!selected) return notify('error', 'Open a DM first.');
    const text = payload?.body ?? body;
    if (!text.trim() && !payload?.attachmentUrl) return;
    await api.sendMessage({ conversationId: selected.id, body: text || payload?.attachmentUrl || '', type: payload?.type ?? 'text', attachmentUrl: payload?.attachmentUrl })
      .then(message => {
        setMessages(prev => [...prev, message]);
        setBody('');
        setShowEmoji(false);
        setShowGif(false);
      })
      .catch(error => notify('error', error.message));
  }

  async function pickChatImage(camera = false) {
    if (!selected) return notify('error', 'Open a DM first.');
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return notify('error', camera ? 'Camera permission is required.' : 'Gallery permission is required.');
    const result = camera
      ? await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.74, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.74, base64: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const uri = asset.base64 ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}` : asset.uri;
    await send({ type: 'image', attachmentUrl: uri, body: 'Image' });
  }

  async function remove(message: Message) {
    await api.deleteMessage(message.id)
      .then(() => setMessages(prev => prev.filter(item => item.id !== message.id)))
      .catch(error => notify('error', error.message));
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <View style={styles.chatLayout}>
        {!selected ? (
          <ScrollView contentContainerStyle={styles.dmListFull}>
            <SectionTitle title="Direct Messages" action="Refresh" onPress={loadConversations} />
            {conversations.loading ? <LoadingState /> : conversations.data.length === 0 ? <EmptyState title="No DMs" body="Open Friends and start a DM." /> : conversations.data.map(item => (
              <Pressable key={item.id} style={styles.dmCard} onPress={() => setSelected(item)}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{item.title.slice(0, 1)}</Text></View>
                <View style={styles.flex}>
                  <Text style={styles.dmTitle}>{item.title}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{item.lastMessage?.body || item.subtitle || 'No messages yet'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#9AA391" />
              </Pressable>
            ))}
          </ScrollView>
        ) : (
        <View style={styles.thread}>
          <View style={styles.threadHeader}>
            <IconButton icon="chevron-back" onPress={() => setSelected(null)} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{selected.title}</Text>
              <Text style={styles.meta}>Private DM</Text>
            </View>
            <IconButton icon="call" onPress={() => notify('info', 'Voice call setup is ready for LiveKit configuration.')} />
            <IconButton icon="videocam" onPress={() => notify('info', 'Video call setup is ready for LiveKit configuration.')} />
          </View>
          <ScrollView contentContainerStyle={styles.messageList}>
            {messages.length === 0 ? <EmptyState title="No messages" body="Send the first message, emoji, sticker, GIF, or image." /> : messages.map(message => {
              const author = selected.participants.find(p => p.id === message.senderId) || user;
              return (
              <Pressable key={message.id} onLongPress={() => message.senderId === user.id && remove(message)} style={[styles.messageRow, message.senderId === user.id && styles.messageOwn]}>
                <View style={styles.messageAuthor}><Text style={styles.messageName}>@{author.username}</Text>{normalizeBadges(author.badges).slice(0, 2).map(b => <BadgeIcon key={b} badge={b} />)}</View>
                <View style={[styles.messageBubble, message.senderId === user.id && styles.messageBubbleOwn]}>
                  {(message.type === 'gif' || message.type === 'image') && message.attachmentUrl ? <Image source={{ uri: message.attachmentUrl }} style={styles.chatImage} resizeMode="cover" /> : null}
                  {message.body ? <Text style={styles.body}>{message.body}</Text> : null}
                  <Text style={styles.meta}>{message.isEdited ? 'edited · ' : ''}{new Date(message.createdAt).toLocaleTimeString()}</Text>
                </View>
              </Pressable>
            );})}
          </ScrollView>
          {showEmoji && <View style={styles.pickerRow}>{emojis.map(item => <Pressable key={item} style={styles.pickerButton} onPress={() => setBody(prev => `${prev}${item}`)}><Text style={styles.emojiText}>{item}</Text></Pressable>)}</View>}
          {showGif && <View style={styles.gifPicker}>{gifs.map(item => <Pressable key={item} onPress={() => send({ type: 'gif', attachmentUrl: item, body: 'GIF' })}><Image source={{ uri: item }} style={styles.gifThumb} /></Pressable>)}</View>}
          <View style={styles.composer}>
            <IconButton icon="happy" onPress={() => { setShowEmoji(prev => !prev); setShowGif(false); }} />
            <IconButton icon="images" onPress={() => { setShowGif(prev => !prev); setShowEmoji(false); }} />
            <IconButton icon="image" onPress={() => pickChatImage(false)} />
            <IconButton icon="camera" onPress={() => pickChatImage(true)} />
            <TextInput style={styles.composerInput} placeholder="Message" placeholderTextColor="#899486" value={body} onChangeText={setBody} multiline />
            <IconButton icon="send" onPress={() => send()} />
          </View>
        </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function ProfileScreen({ user, setUser, notify }: { user: User; setUser: (user: User) => void; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [editing, setEditing] = useState(false);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <GlassCard style={styles.profileHero}>
        {user.bannerUrl ? <Image source={{ uri: user.bannerUrl }} style={styles.profileBannerImage} resizeMode="cover" /> : <View style={[styles.profileBanner, { backgroundColor: user.profileColor || '#58764A' }]} />}
        <View>
          <Image source={user.avatarUrl ? { uri: user.avatarUrl } : logo} style={styles.profileLogo} />
          <View style={[styles.statusDot, { backgroundColor: presenceMeta[user.presence].color }]} />
        </View>
        <Text style={styles.profileName}>{user.displayName}</Text>
        <Text style={styles.muted}>@{user.username}</Text>
        <View style={styles.badgeRow}>{normalizeBadges(user.badges).map(badge => <BadgeChip key={badge} badge={badge} />)}</View>
        <PrimaryButton label="Edit Profile" icon="create" onPress={() => setEditing(true)} />
      </GlassCard>
      
      {user.pronouns && (
        <GlassCard>
          <Text style={styles.cardTitle}>About</Text>
          <View style={styles.infoRow}>
            <Text style={styles.muted}>Pronouns</Text>
            <Text style={styles.body}>{user.pronouns}</Text>
          </View>
        </GlassCard>
      )}
      
      {user.bio && (
        <GlassCard>
          <Text style={styles.cardTitle}>Biography</Text>
          <RichText text={user.bio || 'No bio yet.'} />
        </GlassCard>
      )}
      
      {user.customStatus && (
        <FeatureCard title="Status" body={user.customStatus} icon="radio" />
      )}
      
      <GlassCard>
        <Text style={styles.cardTitle}>Presence</Text>
        <View style={[styles.infoRow, { marginTop: 8 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name={presenceMeta[user.presence].icon} size={14} color={presenceMeta[user.presence].color} />
            <Text style={styles.body}>{presenceMeta[user.presence].label}</Text>
          </View>
        </View>
      </GlassCard>
      
      <ProfileEditor visible={editing} user={user} onClose={() => setEditing(false)} onSaved={(next) => { setUser(next); setEditing(false); notify('success', 'Profile updated.'); }} notify={notify} />
    </ScrollView>
  );
}

function ProfileEditor({ visible, user, onClose, onSaved, notify }: { visible: boolean; user: User; onClose: () => void; onSaved: (user: User) => void; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [pronouns, setPronouns] = useState(user.pronouns || '');
  const [customStatus, setCustomStatus] = useState(user.customStatus || '');
  const [profileColor, setProfileColor] = useState(user.profileColor || '#58764A');
  const [presence, setPresence] = useState<User['presence']>(user.presence);
  const [avatarUri, setAvatarUri] = useState(user.avatarUrl || '');
  const [bannerUri, setBannerUri] = useState(user.bannerUrl || '');
  const [busy, setBusy] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  useEffect(() => {
    if (visible) {
      setDisplayName(user.displayName);
      setBio(user.bio);
      setPronouns(user.pronouns || '');
      setCustomStatus(user.customStatus || '');
      setProfileColor(user.profileColor || '#58764A');
      setPresence(user.presence);
      setAvatarUri(user.avatarUrl || '');
      setBannerUri(user.bannerUrl || '');
    }
  }, [user.id, visible]);

  async function pickImage(kind: 'avatar' | 'banner') {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        notify('error', 'Gallery permission required to upload images.');
        return;
      }
      
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: kind === 'avatar' ? [1, 1] : [16, 6],
        quality: 0.75,
        base64: true
      });
      
      if (result.canceled || !result.assets[0]) return;
      
      const asset = result.assets[0];
      const base64 = asset.base64;
      
      if (!base64) {
        notify('error', 'Could not process image. Please try again.');
        return;
      }
      
      const mimeType = asset.mimeType || 'image/jpeg';
      const uri = `data:${mimeType};base64,${base64}`;
      
      if (kind === 'avatar') {
        setUploadingAvatar(true);
        setAvatarUri(uri);
        notify('success', 'Avatar image selected. Save to upload.');
        setUploadingAvatar(false);
      } else {
        setUploadingBanner(true);
        setBannerUri(uri);
        notify('success', 'Banner image selected. Save to upload.');
        setUploadingBanner(false);
      }
    } catch (error) {
      notify('error', `Failed to pick image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async function save() {
    try {
      if (!displayName.trim()) {
        notify('error', 'Display name is required.');
        return;
      }
      
      setBusy(true);
      const updated = await api.updateProfile({ 
        displayName: displayName.trim(), 
        bio: bio || undefined, 
        pronouns: pronouns || undefined, 
        customStatus: customStatus || undefined, 
        profileColor, 
        presence, 
        avatarUrl: avatarUri || undefined, 
        bannerUrl: bannerUri || undefined 
      });
      
      notify('success', 'Profile updated successfully!');
      onSaved(updated);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to update profile';
      notify('error', errorMsg);
      console.error('Profile update error:', error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide">
      <SafeAreaView style={styles.modalBackdrop}>
        <ScrollView contentContainerStyle={styles.editorPanelScroll}>
          <View style={styles.editorHeader}>
            <Pressable style={styles.editorCloseButton} onPress={onClose}>
              <Ionicons name="close" size={24} color="#E6C07A" />
            </Pressable>
            <Text style={styles.heroSmall}>Edit Profile</Text>
            <View style={styles.spacer} />
          </View>
          
          <GlassCard>
            <Text style={styles.label}>Profile Images</Text>
            {bannerUri && (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.cardTitle}>Banner Preview</Text>
                <Image source={{ uri: bannerUri }} style={styles.bannerPreview} resizeMode="cover" />
              </View>
            )}
            {avatarUri && (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.cardTitle}>Avatar Preview</Text>
                <Image source={{ uri: avatarUri }} style={styles.avatarPreview} resizeMode="cover" />
              </View>
            )}
            <View style={styles.mediaActions}>
              <SecondaryButton label="Avatar" icon="camera" onPress={() => pickImage('avatar')} />
              <SecondaryButton label="Banner" icon="image" onPress={() => pickImage('banner')} />
            </View>
          </GlassCard>
          
          <GlassCard>
            <Text style={styles.label}>Basic Information</Text>
            <Field icon="person" placeholder="Display name" value={displayName} onChangeText={setDisplayName} />
            <Field icon="document-text" placeholder="Bio" value={bio} onChangeText={setBio} multiline />
            <Field icon="sparkles" placeholder="Pronouns" value={pronouns} onChangeText={setPronouns} />
            <Field icon="radio" placeholder="Custom status" value={customStatus} onChangeText={setCustomStatus} />
          </GlassCard>
          
          <GlassCard>
            <Text style={styles.label}>Online Status</Text>
            <View style={styles.segment}>
              {(['online', 'dnd', 'idle', 'invisible'] as const).map(item => (
                <Pressable key={item} style={[styles.segmentItem, presence === item && styles.segmentActive]} onPress={() => setPresence(item)}>
                  <Ionicons name={presenceMeta[item].icon} size={14} color={presenceMeta[item].color} />
                  <Text style={styles.segmentText}>{presenceMeta[item].label}</Text>
                </Pressable>
              ))}
            </View>
          </GlassCard>
          
          <GlassCard>
            <Text style={styles.label}>Profile Color</Text>
            <Text style={styles.muted}>Choose a color theme for your profile.</Text>
            <View style={styles.colorRow}>{['#58764A', '#7B6F45', '#8C5E3C', '#4B6D78'].map(color => <Pressable key={color} style={[styles.colorDot, { backgroundColor: color }, profileColor === color && styles.colorDotActive]} onPress={() => setProfileColor(color)} />)}</View>
          </GlassCard>
          
          <View style={styles.modalActions}>
            <SecondaryButton label="Cancel" icon="close" onPress={onClose} />
            <PrimaryButton label="Save Changes" icon="save" busy={busy} onPress={save} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function SettingsScreen({ user, setTab, setUser, notify }: { user: User; setTab: (tab: AppTab) => void; setUser: (user: User | null) => void; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [panel, setPanel] = useState<'account' | 'privacy' | 'devices' | 'appearance' | 'voice' | null>(null);
  
  async function logout() {
    try {
      await api.logout().catch(() => undefined);
      await clearTokens();
      setUser(null);
      notify('success', 'Logged out successfully.');
    } catch (error) {
      notify('error', 'Failed to logout. Please try again.');
    }
  }
  
  if (panel) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.panelHeader}>
          <Pressable style={styles.backButton} onPress={() => setPanel(null)}>
            <Ionicons name="chevron-back" size={24} color="#E6C07A" />
          </Pressable>
          <Text style={styles.heroSmall}>{settingsPanelTitle(panel)}</Text>
          <View style={styles.spacer} />
        </View>
        
        {panel === 'account' && (
          <>
            <GlassCard>
              <Text style={styles.cardTitle}>Email Address</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>{user.email}</Text>
              <Text style={[styles.muted, { marginTop: 12, fontSize: 13 }]}>Your email is used for login and account recovery.</Text>
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Account Recovery</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Forgot your password? We can send you a recovery link.</Text>
              <PrimaryButton label="Send Recovery Email" icon="mail" onPress={() => {
                api.forgotPassword(user.email)
                  .then(() => notify('success', 'Recovery email sent to your inbox.'))
                  .catch(error => notify('error', error instanceof Error ? error.message : 'Failed to send recovery email'));
              }} />
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Account Info</Text>
              <View style={styles.infoRow}>
                <Text style={styles.muted}>Username</Text>
                <Text style={styles.body}>@{user.username}</Text>
              </View>
              <View style={[styles.infoRow, { borderTopWidth: 1, borderTopColor: 'rgba(218,226,202,.08)', paddingTop: 12 }]}>
                <Text style={styles.muted}>Account Created</Text>
                <Text style={styles.body}>Active</Text>
              </View>
            </GlassCard>
          </>
        )}
        
        {panel === 'privacy' && (
          <>
            <GlassCard>
              <Text style={styles.cardTitle}>Direct Messages</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Control who can send you direct messages.</Text>
              <Text style={[styles.badge, { marginTop: 12 }]}>All friends can message</Text>
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Blocked Users</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>You have no blocked users. Users you block cannot see your profile or send messages.</Text>
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Reports & Moderation</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Report users or content that violates community guidelines. Our moderation team reviews all reports.</Text>
              <PrimaryButton label="View Your Reports" icon="warning" onPress={() => setTab('staff')} />
            </GlassCard>
          </>
        )}
        
        {panel === 'devices' && (
          <>
            <GlassCard>
              <View style={styles.deviceRow}>
                <View style={styles.deviceIcon}>
                  <Ionicons name="phone-portrait" size={20} color="#E6C07A" />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>This Device</Text>
                  <Text style={styles.muted}>Mobile · Current session</Text>
                </View>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>Active</Text>
                </View>
              </View>
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Session Management</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Future updates will allow you to view and manage all active devices and sessions here.</Text>
              <PrimaryButton label="Log Out All Devices" icon="power" onPress={() => {
                Alert.alert('Log Out All Devices', 'This will sign you out on all devices. Continue?', [
                  { text: 'Cancel', onPress: () => {}, style: 'cancel' },
                  { text: 'Log Out', onPress: () => logout(), style: 'destructive' }
                ]);
              }} />
            </GlassCard>
          </>
        )}
        
        {panel === 'appearance' && (
          <>
            <GlassCard>
              <Text style={styles.cardTitle}>Active Theme</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Terria</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>A nature-inspired color palette optimized for mobile.</Text>
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Color Palette</Text>
              <View style={styles.colorGrid}>
                {['#58764A', '#7B6F45', '#8C5E3C', '#4B6D78'].map(color => (
                  <View key={color} style={[styles.colorSwatch, { backgroundColor: color }]} />
                ))}
              </View>
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Density</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Comfortable</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Cards and spacing optimized for touch targets and readability.</Text>
            </GlassCard>
          </>
        )}
        
        {panel === 'voice' && (
          <>
            <GlassCard>
              <Text style={styles.cardTitle}>Call Readiness</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Voice and video calls are ready to configure.</Text>
              <Text style={[styles.badge, { marginTop: 12 }]}>LiveKit integration pending</Text>
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Media Permissions</Text>
              <View style={styles.permissionItem}>
                <Text style={styles.body}>Microphone</Text>
                <Text style={styles.muted}>Requested when needed</Text>
              </View>
              <View style={[styles.permissionItem, { borderTopWidth: 1, borderTopColor: 'rgba(218,226,202,.08)', paddingTop: 12 }]}>
                <Text style={styles.body}>Camera</Text>
                <Text style={styles.muted}>Requested when needed</Text>
              </View>
            </GlassCard>
          </>
        )}
        
        <View style={styles.panelFooter}>
          <Pressable style={styles.closePanelButton} onPress={() => setPanel(null)}>
            <Text style={styles.closePanelText}>Close</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }
  
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.heroSmall}>Settings</Text>
      <SettingsRow icon="person" title="Account" body="Profile, email, password recovery" onPress={() => setPanel('account')} />
      <SettingsRow icon="shield" title="Privacy" body="DM privacy, blocked users, reports" onPress={() => setPanel('privacy')} />
      <SettingsRow icon="phone-portrait" title="Devices" body="Active sessions and device management" onPress={() => setPanel('devices')} />
      <SettingsRow icon="color-palette" title="Appearance" body="Theme, colors, and display settings" onPress={() => setPanel('appearance')} />
      <SettingsRow icon="videocam" title="Voice & Video" body="Call settings and media permissions" onPress={() => setPanel('voice')} />
      
      {user.role === 'admin' && (
        <>
          <Text style={[styles.label, { marginTop: 20 }]}>Administration</Text>
          <PrimaryButton label="Admin Dashboard" icon="shield-checkmark" onPress={() => setTab('admin')} />
        </>
      )}
      {(user.role === 'staff' || user.role === 'admin') && <PrimaryButton label="Staff Dashboard" icon="briefcase" onPress={() => setTab('staff')} />}
      
      <Pressable style={styles.logout} onPress={logout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </Pressable>
    </ScrollView>
  );
}

function AdminScreen({ setAnnouncement, setShowAnnouncement, notify }: { setAnnouncement: (a: Announcement | null) => void; setShowAnnouncement: (v: boolean) => void; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [adminAnnouncements, setAdminAnnouncements] = useState<Announcement[]>([]);
  const [adminBlogs, setAdminBlogs] = useState<BlogPost[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [blogTitle, setBlogTitle] = useState('');
  const [blogBody, setBlogBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [blogImageUrl, setBlogImageUrl] = useState('');
  const [blogLinkUrl, setBlogLinkUrl] = useState('');
  const [badgeUser, setBadgeUser] = useState('');
  const [badge, setBadge] = useState('Founder');
  const [roleUser, setRoleUser] = useState('');
  const [role, setRole] = useState<User['role']>('staff');

  const load = () => Promise.all([api.adminStats(), api.adminAnnouncements(), api.blogs()])
    .then(([nextStats, nextAnnouncements, nextBlogs]) => {
      setStats(nextStats);
      setAdminAnnouncements(nextAnnouncements);
      setAdminBlogs(nextBlogs);
    })
    .catch(error => notify('error', error.message));
  useEffect(() => { load(); }, []);

  async function broadcast() {
    if (!title.trim() || !body.trim()) return notify('error', 'Add a title and message.');
    await api.createAnnouncement({ title, body, isPopup: true, pinToHome: true, imageUrl, linkUrl, linkLabel: 'Open link' })
      .then(a => { setAnnouncement(a); setShowAnnouncement(true); setTitle(''); setBody(''); setImageUrl(''); setLinkUrl(''); notify('success', 'Announcement published.'); load(); })
      .catch(error => notify('error', error.message));
  }

  async function createBlog() {
    if (!blogTitle.trim() || !blogBody.trim()) return notify('error', 'Add a blog title and body.');
    await api.createBlog({ title: blogTitle, body: blogBody, category: 'Update', pinned: true, imageUrl: blogImageUrl, linkUrl: blogLinkUrl, linkLabel: 'Read more' })
      .then(() => { setBlogTitle(''); setBlogBody(''); setBlogImageUrl(''); setBlogLinkUrl(''); notify('success', 'Blog post published.'); load(); })
      .catch(error => notify('error', error.message));
  }

  async function removeAnnouncement(id: string) {
    await api.deleteAnnouncement(id)
      .then(() => { notify('success', 'Announcement deleted.'); load(); })
      .catch(error => notify('error', error.message));
  }

  async function removeBlog(id: string) {
    await api.deleteBlog(id)
      .then(() => { notify('success', 'Blog post deleted.'); load(); })
      .catch(error => notify('error', error.message));
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.heroSmall}>Admin Dashboard</Text>
      <StatsGrid values={[['Users', String(stats.users)], ['Reports', String(stats.reports)], ['Groups', String(stats.activeGroups)], ['Health', `${stats.systemHealth}%`]]} />
      <GlassCard><Text style={styles.cardTitle}>Announcement</Text><Field icon="megaphone" placeholder="Title" value={title} onChangeText={setTitle} /><Field icon="document-text" placeholder="Message with links" value={body} onChangeText={setBody} multiline /><Field icon="image" placeholder="Image URL" value={imageUrl} onChangeText={setImageUrl} autoCapitalize="none" /><Field icon="link" placeholder="Clickable link URL" value={linkUrl} onChangeText={setLinkUrl} autoCapitalize="none" /><PrimaryButton label="Publish Announcement" icon="send" onPress={broadcast} /></GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Manage Announcements</Text><PrimaryButton label="Refresh" icon="refresh" onPress={load} /><Text style={styles.muted}>Announcements remain visible until deleted manually from this dashboard.</Text>{adminAnnouncements.length === 0 ? <Text style={styles.muted}>No announcements published.</Text> : adminAnnouncements.map(item => <View key={item.id} style={styles.manageRow}><View style={styles.flex}><Text style={styles.body}>{item.title}</Text><Text style={styles.meta}>{new Date(item.createdAt).toLocaleDateString()}</Text></View><IconButton icon="trash" onPress={() => removeAnnouncement(item.id)} /></View>)}</GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Blog Post</Text><Field icon="newspaper" placeholder="Title" value={blogTitle} onChangeText={setBlogTitle} /><Field icon="document-text" placeholder="Body with links" value={blogBody} onChangeText={setBlogBody} multiline /><Field icon="image" placeholder="Image URL" value={blogImageUrl} onChangeText={setBlogImageUrl} autoCapitalize="none" /><Field icon="link" placeholder="Clickable link URL" value={blogLinkUrl} onChangeText={setBlogLinkUrl} autoCapitalize="none" /><PrimaryButton label="Publish Blog" icon="cloud-upload" onPress={createBlog} /></GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Manage Blog Posts</Text>{adminBlogs.length === 0 ? <Text style={styles.muted}>No blog posts published.</Text> : adminBlogs.map(item => <View key={item.id} style={styles.manageRow}><View style={styles.flex}><Text style={styles.body}>{item.title}</Text><Text style={styles.meta}>{item.category || 'Update'}</Text></View><IconButton icon="trash" onPress={() => removeBlog(item.id)} /></View>)}</GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Badges</Text><Field icon="at" placeholder="Username" value={badgeUser} onChangeText={setBadgeUser} autoCapitalize="none" /><Field icon="ribbon" placeholder="Badge" value={badge} onChangeText={setBadge} /><PrimaryButton label="Grant Badge" icon="ribbon" onPress={() => api.grantBadge({ username: badgeUser, badge }).then(() => notify('success', 'Badge granted.')).catch(error => notify('error', error.message))} /></GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Roles</Text><Field icon="at" placeholder="Username" value={roleUser} onChangeText={setRoleUser} autoCapitalize="none" /><View style={styles.segment}>{(['user', 'staff', 'admin'] as const).map(item => <Pressable key={item} style={[styles.segmentItem, role === item && styles.segmentActive]} onPress={() => setRole(item)}><Text style={styles.segmentText}>{item}</Text></Pressable>)}</View><PrimaryButton label="Update Role" icon="key" onPress={() => api.setRole({ username: roleUser, role }).then(() => notify('success', 'Role updated.')).catch(error => notify('error', error.message))} /></GlassCard>
    </ScrollView>
  );
}

function StaffScreen({ notify }: { notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [reports, setReports] = useState<Loadable<Report[]>>({ loading: true, data: [] });
  const load = () => api.reports().then(data => setReports({ loading: false, data })).catch(error => { setReports({ loading: false, data: [], error: error.message }); notify('error', error.message); });
  useEffect(() => { load(); }, []);
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <SectionTitle title="Staff Dashboard" action="Refresh" onPress={load} />
      <StatsGrid values={[['Queue', String(reports.data.length)], ['Open', String(reports.data.filter(r => r.status === 'open').length)], ['Reviewing', String(reports.data.filter(r => r.status === 'reviewing').length)], ['Resolved', String(reports.data.filter(r => r.status === 'resolved').length)]]} />
      <FeatureCard title="Moderation Tools" body="Review reports, check user context, and escalate incidents to admins." icon="hammer" />
      <FeatureCard title="Safety Watch" body="Track flagged DMs, suspicious groups, and account recovery requests." icon="warning" />
      {reports.loading ? <LoadingState /> : reports.error ? <ErrorState message={reports.error} onRetry={load} /> : reports.data.map(report => <GlassCard key={report.id}><Text style={styles.cardTitle}>{report.type}</Text><Text style={styles.muted}>{report.reason}</Text><Text style={styles.badge}>{report.status}</Text></GlassCard>)}
      {reports.data.length === 0 && !reports.loading && <EmptyState title="No reports" body="The moderation queue is clear." />}
    </ScrollView>
  );
}

function Header({ user, setTab }: { user: User; setTab: (tab: AppTab) => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => setTab('home')} style={styles.headerBrand}><Image source={logo} style={styles.headerLogo} /><Text style={styles.headerTitle}>Zevryl</Text></Pressable>
      <View style={styles.headerActions}><Text style={styles.headerUser}>{user.displayName}</Text><IconButton icon="person" onPress={() => setTab('profile')} /></View>
    </View>
  );
}

function BottomNav({ tab, setTab, user, bottom }: { tab: AppTab; setTab: (tab: AppTab) => void; user: User; bottom: number }) {
  const items: Array<[AppTab, keyof typeof Ionicons.glyphMap]> = [['home', 'home'], ['friends', 'people'], ['chats', 'chatbubbles'], ['groups', 'grid'], ['profile', 'person'], ['settings', 'settings']];
  return (
    <BlurView intensity={70} tint="dark" style={[styles.nav, { bottom }]}>
      {items.map(([key, icon]) => <Pressable key={key} onPress={() => setTab(key)} style={styles.navItem}><Ionicons name={icon} size={21} color={tab === key ? '#E6C07A' : '#9AA391'} /></Pressable>)}
      {(user.role === 'staff' || user.role === 'admin') && <Pressable onPress={() => setTab('staff')} style={styles.navItem}><Ionicons name="briefcase" size={20} color={tab === 'staff' ? '#E6C07A' : '#9AA391'} /></Pressable>}
      {user.role === 'admin' && <Pressable onPress={() => setTab('admin')} style={styles.navItem}><Ionicons name="shield-checkmark" size={20} color={tab === 'admin' ? '#E6C07A' : '#9AA391'} /></Pressable>}
    </BlurView>
  );
}

function AnnouncementModal({ announcement, visible, onClose }: { announcement: Announcement | null; visible: boolean; onClose: () => void }) {
  if (!announcement) return null;
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.announcementModal}>
          <Text style={styles.kicker}>Announcement</Text>
          <Text style={styles.heroSmall}>{announcement.title}</Text>
          <Text style={styles.body}>{announcement.body}</Text>
          <PrimaryButton label="Mark Read" icon="checkmark" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function AnnouncementCard({ item }: { item: Announcement }) {
  return (
    <GlassCard style={styles.announcementCard}>
      <View style={styles.announcementIcon}><Ionicons name={item.isPopup ? 'megaphone' : 'newspaper'} size={20} color="#E6C07A" /></View>
      <View style={styles.flex}>
        <View style={styles.postTop}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.meta}>{new Date(item.createdAt).toLocaleDateString()}</Text></View>
        {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.postImage} resizeMode="cover" /> : null}
        <RichText text={item.body} />
        {item.linkUrl ? <Pressable onPress={() => openLink(item.linkUrl)}><Text style={styles.link}>{item.linkLabel || item.linkUrl}</Text></Pressable> : null}
      </View>
    </GlassCard>
  );
}

function SettingsRow({ icon, title, body, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <GlassCard style={styles.featureCard}>
        <View style={styles.iconContainer}>
          <Ionicons name={icon} size={20} color="#E6C07A" />
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.muted}>{body}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9AA391" />
      </GlassCard>
    </Pressable>
  );
}

function settingsPanelTitle(panel: 'account' | 'privacy' | 'devices' | 'appearance' | 'voice') {
  return ({ account: 'Account', privacy: 'Privacy', devices: 'Logged In Devices', appearance: 'Appearance', voice: 'Voice & Video' })[panel];
}

function settingsPanelBody(panel: 'account' | 'privacy' | 'devices' | 'appearance' | 'voice') {
  return ({
    account: 'Manage profile details and send a recovery request for your account.',
    privacy: 'DM privacy, block controls, and report management are active. More granular toggles can be added without changing account data.',
    devices: 'Current device is signed in. Full device history will appear here once persistent sessions are enabled.',
    appearance: 'Terria is the active theme. The layout is tuned for mobile readability and raised system navigation.',
    voice: 'Call and video controls are visible in DMs. LiveKit credentials are required before calls can connect.'
  })[panel];
}

function StatusPill({ presence }: { presence: User['presence'] }) {
  const meta = presenceMeta[presence];
  return <View style={styles.rolePill}><Ionicons name={meta.icon} size={11} color={meta.color} /><Text style={styles.roleText}>{meta.label}</Text></View>;
}

function BadgeChip({ badge }: { badge: string }) {
  return <Pressable onPress={() => Alert.alert(badge, `${badge} badge`)} style={styles.badgeChip}><Ionicons name={badgeIcons[badge] || 'ribbon'} size={12} color="#E6C07A" /><Text style={styles.badgeChipText}>{badge}</Text></Pressable>;
}

function BadgeIcon({ badge }: { badge: string }) {
  return <Pressable onPress={() => Alert.alert(badge, `${badge} badge`)} style={styles.badgeIcon}><Ionicons name={badgeIcons[badge] || 'ribbon'} size={11} color="#E6C07A" /></Pressable>;
}

function normalizeBadges(badges: string[]) {
  return badges.length ? badges : ['Member'];
}

function openLink(url?: string) {
  if (!url) return;
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  Linking.openURL(normalized).catch(() => undefined);
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+|www\.[^\s]+)/g);
  return <Text style={styles.body}>{parts.map((part, index) => /^(https?:\/\/|www\.)/i.test(part) ? <Text key={`${part}-${index}`} style={styles.inlineLink} onPress={() => openLink(part)}>{part}</Text> : <Text key={`${part}-${index}`}>{part}</Text>)}</Text>;
}

function NoticeFooter({ notice, bottom }: { notice: Notice; bottom: number }) {
  if (!notice) return null;
  return <View style={[styles.notice, notice.tone === 'error' ? styles.noticeError : notice.tone === 'success' ? styles.noticeSuccess : styles.noticeInfo, { bottom }]}><Text style={styles.noticeText}>{notice.text}</Text></View>;
}

function Field(props: React.ComponentProps<typeof TextInput> & { icon: keyof typeof Ionicons.glyphMap }) {
  return <View style={styles.field}><Ionicons name={props.icon} size={16} color="#B8C4A5" /><TextInput {...props} placeholderTextColor="#899486" style={[styles.input, props.multiline && styles.inputMulti]} /></View>;
}

function PrimaryButton({ label, icon, busy, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; busy?: boolean; onPress: () => void }) {
  return <Pressable onPress={busy ? undefined : onPress} style={styles.primaryButton}><LinearGradient colors={['#6F7F43', '#B88A4A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryGradient}>{busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name={icon} size={18} color="#fff" /><Text style={styles.primaryText}>{label}</Text></>}</LinearGradient></Pressable>;
}

function SecondaryButton({ label, icon, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.secondaryButton}><Ionicons name={icon} size={18} color="#D9E2CC" /><Text style={styles.secondaryText}>{label}</Text></Pressable>;
}

function IconButton({ icon, onPress }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.iconButton}><Ionicons name={icon} size={19} color="#E4EAD9" /></Pressable>;
}

function GlassCard({ children, style }: { children: React.ReactNode; style?: object }) {
  return <BlurView intensity={18} tint="dark" style={[styles.glassCard, style]}>{children}</BlurView>;
}

function FeatureCard({ title, body, icon }: { title: string; body: string; icon: keyof typeof Ionicons.glyphMap }) {
  return <GlassCard style={styles.featureCard}><Ionicons name={icon} size={22} color="#E6C07A" /><View style={styles.flex}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.muted}>{body}</Text></View></GlassCard>;
}

function StatsGrid({ values }: { values: Array<[string, string]> }) {
  return <View style={styles.statsGrid}>{values.map(([label, value]) => <GlassCard key={label} style={styles.statCard}><Text style={styles.statValue} numberOfLines={1}>{value}</Text><Text style={styles.statLabel}>{label}</Text></GlassCard>)}</View>;
}

function SectionTitle({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  return <View style={styles.sectionTitle}><Text style={styles.heroSmall}>{title}</Text>{action && <Pressable onPress={onPress}><Text style={styles.link}>{action}</Text></Pressable>}</View>;
}

function UserList({ title, users, empty, right }: { title: string; users: User[]; empty: string; right?: (user: User) => React.ReactNode }) {
  return <View><Text style={styles.label}>{title}</Text>{users.length === 0 ? <EmptyState title="Empty" body={empty} /> : users.map(user => <GlassCard key={user.id} style={styles.userRow}><View style={styles.avatar}><Text style={styles.avatarText}>{user.displayName.slice(0, 1)}</Text></View><View style={styles.flex}><Text style={styles.body}>{user.displayName}</Text><Text style={styles.muted}>{user.customStatus || user.presence}</Text><View style={styles.badgeRowMini}>{user.badges.slice(0, 3).map(b => <Text key={b} style={styles.badgeMini}>{b}</Text>)}</View></View>{right?.(user)}</GlassCard>)}</View>;
}

function RequestList({ title, requests, accept, deny }: { title: string; requests: FriendState['incoming']; accept?: (id: string) => void; deny?: (id: string) => void }) {
  return <View><Text style={styles.label}>{title}</Text>{requests.length === 0 ? <Text style={styles.muted}>None</Text> : requests.map(req => <GlassCard key={req.id} style={styles.userRow}><View style={styles.avatar}><Text style={styles.avatarText}>{req.fromUser.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.flex}><Text style={styles.body}>{req.fromUser.displayName}</Text><Text style={styles.muted}>{req.status}</Text></View>{accept && <IconButton icon="checkmark" onPress={() => accept(req.id)} />}{deny && <IconButton icon="close" onPress={() => deny(req.id)} />}</GlassCard>)}</View>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <GlassCard style={styles.empty}><Ionicons name="leaf" size={22} color="#E6C07A" /><Text style={styles.cardTitle}>{title}</Text><Text style={styles.muted}>{body}</Text></GlassCard>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <GlassCard><Text style={styles.cardTitle}>Could not load</Text><Text style={styles.errorText}>{message}</Text><PrimaryButton label="Try Again" icon="refresh" onPress={onRetry} /></GlassCard>;
}

function LoadingState() {
  return <GlassCard style={styles.empty}><ActivityIndicator color="#E6C07A" /><Text style={styles.muted}>Loading...</Text></GlassCard>;
}

function LockedScreen({ title }: { title: string }) {
  return <View style={styles.locked}><Ionicons name="lock-closed" size={34} color="#E6C07A" /><Text style={styles.heroSmall}>{title}</Text><Text style={styles.muted}>This area is role-gated.</Text></View>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#111712' },
  app: { flex: 1 },
  flex: { flex: 1 },
  terraBandTop: { position: 'absolute', left: 0, right: 0, top: 0, height: 170, backgroundColor: 'rgba(90,111,65,.24)' },
  terraBandBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 180, backgroundColor: 'rgba(94,61,38,.22)' },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'space-between', padding: 26 },
  splashContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  splashLogo: { width: 170, height: 170 },
  splashWordmark: { width: '88%', maxWidth: 360, height: 128 },
  brandTitle: { color: '#F4F0E6', fontSize: 32, fontWeight: '900', marginTop: 8, letterSpacing: -0.5 },
  brandSub: { color: '#E6C07A', fontSize: 12, letterSpacing: 3.5, marginTop: 8, fontWeight: '800' },
  splashTagline: { color: '#C9D1BE', fontSize: 15, marginTop: 6, letterSpacing: 0.3, fontStyle: 'italic' },
  splashFooter: { gap: 14, paddingBottom: 16 },
  loadingBar: { width: 200, height: 4, backgroundColor: '#20291E', borderRadius: 2, overflow: 'hidden' },
  loadingFill: { width: '68%', height: 4, backgroundColor: 'rgba(205,161,106,.8)', borderRadius: 2 },
  loadingText: { color: '#B8A47D', fontSize: 12, textAlign: 'center', fontWeight: '600', letterSpacing: 0.5 },
  helper: { color: '#B8A47D', fontSize: 11, letterSpacing: 1.5, marginTop: 10, fontWeight: '600' },
  authWrap: { flex: 1, justifyContent: 'center', padding: 16 },
  authPanel: { borderRadius: 10, borderWidth: 1, borderColor: 'rgba(230,192,122,.25)', backgroundColor: 'rgba(20,28,21,.92)', padding: 22, alignItems: 'center', gap: 14 },
  authCard: { alignItems: 'center', gap: 12 },
  authLogo: { width: 104, height: 104 },
  authWordmark: { width: '92%', maxWidth: 300, height: 92 },
  authText: { color: '#C9D1BE', textAlign: 'center', marginBottom: 8, lineHeight: 22, fontSize: 15 },
  header: { height: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(230,192,122,.08)' },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerLogo: { width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(230,192,122,.12)' },
  headerTitle: { color: '#F4F0E6', fontWeight: '800', fontSize: 18, letterSpacing: 0.3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerUser: { color: '#C9D1BE', maxWidth: 130 },
  content: { flex: 1 },
  scroll: { padding: 16, gap: 18, paddingBottom: 140 },
  chatScroll: { padding: 16, gap: 14, paddingBottom: 80 },
  homeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 },
  kicker: { color: '#E6C07A', textTransform: 'uppercase', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  hero: { color: '#F4F0E6', fontWeight: '900', fontSize: 32, lineHeight: 38, letterSpacing: -0.5, marginBottom: 6 },
  heroSmall: { color: '#F4F0E6', fontWeight: '900', fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  heroSub: { color: '#C9D1BE', fontSize: 16, lineHeight: 24, marginBottom: 16 },
  rolePill: { borderRadius: 8, borderWidth: 1, borderColor: 'rgba(230,192,122,.28)', paddingHorizontal: 12, paddingVertical: 7, backgroundColor: 'rgba(50,60,39,.72)', flexDirection: 'row', alignItems: 'center', gap: 6 },
  rolePillInline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roleText: { color: '#E6C07A', textTransform: 'uppercase', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  glassCard: { borderRadius: 14, borderWidth: 1, borderColor: 'rgba(218,226,202,.14)', backgroundColor: 'rgba(22,30,23,.86)', padding: 18, overflow: 'hidden', gap: 4 },
  postCard: { gap: 10 },
  postImage: { width: '100%', height: 150, borderRadius: 10, backgroundColor: '#111712', marginTop: 8 },
  postTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  announcementCard: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', borderColor: 'rgba(230,192,122,.2)', borderWidth: 1.5 },
  announcementIcon: { width: 42, height: 42, borderRadius: 8, backgroundColor: 'rgba(230,192,122,.14)', alignItems: 'center', justifyContent: 'center' },
  manageRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: 'rgba(218,226,202,.09)', paddingTop: 12, marginTop: 12 },
  cardTitle: { color: '#F4F0E6', fontWeight: '800', fontSize: 17, letterSpacing: 0.2 },
  muted: { color: '#AEB8A5', lineHeight: 22, fontSize: 14 },
  body: { color: '#E7EBDD', lineHeight: 22, fontSize: 15, fontWeight: '500' },
  meta: { color: '#899486', fontSize: 12, marginTop: 6, fontWeight: '600' },
  errorText: { color: '#FFAAA8', lineHeight: 20 },
  link: { color: '#E6C07A', fontWeight: '800', fontSize: 14 },
  inlineLink: { color: '#E6C07A', fontWeight: '800' },
  formMessage: { color: '#FFAAA8', textAlign: 'center', fontSize: 13, marginTop: 8, fontWeight: '600' },
  successMessage: { color: '#98D6A1', textAlign: 'center', fontSize: 13, marginTop: 8, fontWeight: '600' },
  
  // Form Fields
  field: { flexDirection: 'row', alignItems: 'center', width: '100%', minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(218,226,202,.14)', backgroundColor: 'rgba(11,16,12,.75)', paddingHorizontal: 14, gap: 10, marginTop: 10 },
  fieldFocused: { borderColor: 'rgba(230,192,122,.4)', backgroundColor: 'rgba(230,192,122,.08)' },
  fieldError: { borderColor: 'rgba(255,170,168,.35)', backgroundColor: 'rgba(255,170,168,.08)' },
  input: { flex: 1, color: '#F4F0E6', minHeight: 50, paddingVertical: 10, fontSize: 15 },
  inputMulti: { minHeight: 86, textAlignVertical: 'top' },
  
  // Buttons
  primaryButton: { width: '100%', borderRadius: 12, overflow: 'hidden', marginTop: 12, opacity: 1 },
  primaryButtonPressed: { opacity: 0.85 },
  primaryGradient: { minHeight: 54, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, borderRadius: 12 },
  primaryGradientPressed: { opacity: 0.9 },
  primaryText: { color: '#fff', fontWeight: '900', fontSize: 15, letterSpacing: 0.3 },
  secondaryButton: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(218,226,202,.18)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 14, marginTop: 12 },
  secondaryText: { color: '#D9E2CC', fontWeight: '800' },
  switchAuth: { padding: 12 },
  
  // Stats & Badges
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { width: '47%', minHeight: 96, justifyContent: 'flex-start', padding: 16 },
  statValue: { color: '#E6C07A', fontWeight: '900', fontSize: 26, letterSpacing: -0.5 },
  statLabel: { color: '#899486', marginTop: 10, textTransform: 'uppercase', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  sectionTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, marginBottom: 2 },
  label: { color: '#C9D1BE', fontWeight: '800', textTransform: 'uppercase', fontSize: 12, marginTop: 14, marginBottom: 10, letterSpacing: 1.2 },
  
  // Feature Cards
  featureCard: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  
  // Lists
  listCard: { gap: 8 },
  groupsList: { gap: 12 },
  groupCard: { gap: 10 },
  groupFooter: { flexDirection: 'row', gap: 12, marginTop: 8 },
  
  userListContainer: { gap: 12 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  userRowNotLast: { borderBottomWidth: 1, borderBottomColor: 'rgba(218,226,202,.08)' },
  userRowContent: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  userRowActions: { flexDirection: 'row', gap: 8 },
  
  avatar: { width: 50, height: 50, borderRadius: 12, backgroundColor: '#33412E', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#7D8B58' },
  avatarSmall: { width: 36, height: 36, borderRadius: 9, backgroundColor: '#33412E', alignItems: 'center', justifyContent: 'center' },
  avatarLarge: { width: 96, height: 96, borderRadius: 24, backgroundColor: '#33412E', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#7D8B58' },
  avatarText: { color: '#F4F0E6', fontWeight: '900', fontSize: 18 },
  
  rowActions: { flexDirection: 'row', gap: 8 },
  requestActions: { flexDirection: 'row', gap: 8 },
  
  // Icon Button
  iconButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(255,255,255,.06)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,.08)' },
  iconButtonPressed: { backgroundColor: 'rgba(255,255,255,.12)' },
  iconContainer: { width: 42, height: 42, borderRadius: 10, backgroundColor: 'rgba(230,192,122,.12)', alignItems: 'center', justifyContent: 'center' },
  
  badge: { color: '#E6C07A', fontSize: 12, fontWeight: '800', backgroundColor: 'rgba(230,192,122,.12)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, alignSelf: 'flex-start' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  badgeRowMini: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badgeChip: { color: '#F4F0E6', backgroundColor: 'rgba(230,192,122,.14)', borderColor: 'rgba(230,192,122,.28)', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, fontSize: 12, fontWeight: '800' },
  badgeChipText: { color: '#F4F0E6', fontSize: 12, fontWeight: '800' },
  badgeIcon: { width: 18, height: 18, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(230,192,122,.14)' },
  badgeMini: { color: '#E6C07A', fontSize: 11, fontWeight: '800' },
  
  // Empty & Error States
  empty: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  errorContent: { alignItems: 'center', gap: 12, marginBottom: 12 },
  
  // Member Selection
  memberPick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, paddingHorizontal: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.04)', marginTop: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,.06)' },
  friendsSelector: { gap: 10, marginTop: 12 },
  friendOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, paddingHorizontal: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,.06)', paddingVertical: 12 },
  friendOptionSelected: { backgroundColor: 'rgba(230,192,122,.12)', borderColor: 'rgba(230,192,122,.3)' },
  friendOptionText: { color: '#E7EBDD', fontSize: 15, fontWeight: '500', flex: 1 },
  
  // Chat & Messages
  chatLayout: { flex: 1, paddingHorizontal: 10, paddingBottom: 118, gap: 10 },
  dmListFull: { padding: 6, gap: 10 },
  dmCard: { minHeight: 66, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(218,226,202,.13)', backgroundColor: 'rgba(22,30,23,.82)', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dmRail: { width: 122, borderRightWidth: 1, borderColor: 'rgba(218,226,202,.1)', paddingTop: 8, gap: 8 },
  dmItem: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10 },
  dmItemActive: { backgroundColor: 'rgba(230,192,122,.14)' },
  dmTitle: { color: '#F4F0E6', fontWeight: '800', fontSize: 14 },
  emptyRail: { color: '#899486', fontSize: 12 },
  thread: { flex: 1 },
  threadHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: 'rgba(218,226,202,.1)' },
  threadHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  
  messagesContainer: { gap: 10, marginVertical: 14 },
  messageList: { paddingVertical: 12, gap: 10, paddingBottom: 16 },
  messageRow: { alignItems: 'flex-start' },
  messageOwn: { alignItems: 'flex-end' },
  messageBubble: { maxWidth: '92%', borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: 'rgba(30,42,33,.8)' },
  messageAuthor: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  messageName: { color: '#E6C07A', fontSize: 12, fontWeight: '800' },
  messageBubbleOther: { backgroundColor: 'rgba(30,42,33,.8)' },
  messageBubbleOwn: { backgroundColor: '#4A5934', alignSelf: 'flex-end' },
  messageBody: { color: '#F2F8F5', fontSize: 15, lineHeight: 22, fontWeight: '500' },
  messageFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  messageTime: { color: '#899486', fontSize: 12, fontWeight: '600' },
  messageEdited: { color: '#B8A47D', fontSize: 11, fontWeight: '700' },
  messageDelete: { marginTop: 8 },
  messageDeleteText: { color: '#FFAAA8', fontWeight: '700', fontSize: 12 },
  
  gifImage: { width: 190, height: 130, borderRadius: 10, backgroundColor: '#111712' },
  chatImage: { width: 214, height: 150, borderRadius: 10, backgroundColor: '#111712' },
  pickerRow: { flexDirection: 'row', gap: 6, paddingVertical: 8, flexWrap: 'wrap' },
  pickerButton: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#202A21', alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 22 },
  gifPicker: { flexDirection: 'row', gap: 8, paddingVertical: 10 },
  gifThumb: { width: 80, height: 60, borderRadius: 10, backgroundColor: '#111712' },
  
  chatCard: { gap: 12 },
  composerContainer: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, padding: 14, borderTopWidth: 1, borderColor: 'rgba(255,255,255,.08)', backgroundColor: 'rgba(5,7,11,.92)' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingVertical: 10 },
  composerInput: { flex: 1, minHeight: 48, maxHeight: 110, color: '#F4F0E6', borderRadius: 12, backgroundColor: '#151D16', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: 'rgba(218,226,202,.12)' },
  callActions: { flexDirection: 'row', gap: 10 },
  callCard: { gap: 12, borderColor: 'rgba(255,170,168,.15)', borderWidth: 1 },
  
  // Profile
  profileHero: { alignItems: 'center', gap: 14, paddingTop: 8, paddingVertical: 20 },
  profileBanner: { height: 90, alignSelf: 'stretch', marginHorizontal: -18, marginTop: -18, marginBottom: -32 },
  profileBannerImage: { height: 116, alignSelf: 'stretch', marginHorizontal: -18, marginTop: -18, marginBottom: -42, backgroundColor: '#111712' },
  profileAvatarLarge: { width: 96, height: 96, borderRadius: 24, backgroundColor: '#33412E', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#7D8B58' },
  profileAvatarText: { color: '#F4F0E6', fontWeight: '900', fontSize: 36 },
  profileLogo: { width: 96, height: 96, borderRadius: 20, borderWidth: 3, borderColor: '#1B241C' },
  statusDot: { position: 'absolute', width: 18, height: 18, borderRadius: 9, right: 1, bottom: 5, borderWidth: 3, borderColor: '#1B241C' },
  profileName: { color: '#F4F0E6', fontSize: 28, fontWeight: '900', letterSpacing: -0.3 },
  profileBadgeContainer: { flexDirection: 'row', gap: 10, marginTop: 8 },
  colorRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  mediaActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  colorDot: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  colorDotActive: { borderColor: '#F4F0E6' },
  
  // Settings & Logout
  logout: { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,120,130,.35)', minHeight: 54, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  logoutText: { color: '#FFAAA8', fontWeight: '800', fontSize: 15 },
  
  // Navigation
  nav: { position: 'absolute', left: 16, right: 16, bottom: 16, height: 68, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(218,226,202,.14)', backgroundColor: 'rgba(18,25,19,.88)' },
  navItem: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  
  // Notifications & Modals
  notice: { position: 'absolute', left: 18, right: 18, minHeight: 46, borderRadius: 10, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, zIndex: 20 },
  noticeError: { backgroundColor: 'rgba(79,23,25,.94)', borderColor: 'rgba(255,170,168,.44)' },
  noticeSuccess: { backgroundColor: 'rgba(36,72,44,.94)', borderColor: 'rgba(152,214,161,.44)' },
  noticeInfo: { backgroundColor: 'rgba(46,58,82,.94)', borderColor: 'rgba(160,184,220,.44)' },
  noticeText: { color: '#fff', fontWeight: '800' },
  
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.68)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  announcementModal: { width: '100%', borderRadius: 12, backgroundColor: '#182019', borderWidth: 1, borderColor: 'rgba(230,192,122,.3)', padding: 20, gap: 14 },
  modalCard: { width: '100%', gap: 14, alignItems: 'center', padding: 24 },
  editorPanel: { width: '100%', borderRadius: 12, backgroundColor: '#182019', borderWidth: 1, borderColor: 'rgba(230,192,122,.28)', padding: 18, gap: 8 },
  editorPanelScroll: { paddingVertical: 12, paddingHorizontal: 16, gap: 16 },
  editorHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, height: 56 },
  editorCloseButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(230,192,122,.12)', alignItems: 'center', justifyContent: 'center' },
  bannerPreview: { width: '100%', height: 150, borderRadius: 12, marginTop: 8 },
  avatarPreview: { width: 100, height: 100, borderRadius: 50, marginTop: 8 },
  modalActions: { gap: 10 },
  
  segment: { flexDirection: 'row', gap: 10, marginTop: 12 },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(218,226,202,.14)', alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: 'rgba(230,192,122,.18)', borderColor: 'rgba(230,192,122,.4)' },
  segmentText: { color: '#D9E2CC', fontWeight: '800' },
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  
  // Settings Panels
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, height: 56 },
  backButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(230,192,122,.12)', alignItems: 'center', justifyContent: 'center' },
  spacer: { width: 44 },
  panelFooter: { paddingTop: 20, paddingBottom: 10, gap: 10 },
  closePanelButton: { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(218,226,202,.18)', minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  closePanelText: { color: '#D9E2CC', fontWeight: '800', fontSize: 15 },
  
  // Settings Rows
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  settingsRowContent: { flex: 1 },
  // Info Display
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 12 },
  deviceIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(230,192,122,.14)', alignItems: 'center', justifyContent: 'center' },
  statusBadge: { backgroundColor: 'rgba(79,204,122,.14)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { color: '#4FCC7A', fontWeight: '800', fontSize: 11 },
  permissionItem: { paddingVertical: 12 },
  colorGrid: { flexDirection: 'row', gap: 12, marginTop: 12 },
  colorSwatch: { width: 48, height: 48, borderRadius: 10 },
  
  videoGrid: { minHeight: 240, gap: 10, borderRadius: 18, overflow: 'hidden', backgroundColor: '#05070B', alignItems: 'center', justifyContent: 'center' },
  videoTile: { width: '100%', height: 240, borderRadius: 18 }
});
