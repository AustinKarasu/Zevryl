import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, clearTokens, setTokens } from './api';
import type { Announcement, AppTab, DashboardStats, FriendState, Group, Message, Report, User } from './types';

const logo = require('../assets/zevryl-logo.png');

type Loadable<T> = { loading: boolean; data: T; error?: string };

const emptyFriends: FriendState = { friends: [], incoming: [], outgoing: [], blocked: [] };
const emptyStats: DashboardStats = { users: 0, reports: 0, activeGroups: 0, systemHealth: 0 };

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

  useEffect(() => {
    Promise.all([api.me(), api.latestAnnouncement()])
      .then(([me, latest]) => {
        setUser(me);
        setAnnouncement(latest);
        setShowAnnouncement(Boolean(latest?.isPopup && !latest.readAt));
      })
      .catch(() => undefined)
      .finally(() => setTimeout(() => setBooting(false), 850));
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
  if (!user) return <AuthScreen onDone={completeAuth} />;

  return (
    <TerraShell>
      <SafeAreaView style={styles.app}>
        <Header user={user} tab={tab} setTab={setTab} />
        <View style={styles.content}>{renderTab(tab, user, announcement, setAnnouncement, setShowAnnouncement, setTab)}</View>
        <BottomNav tab={tab} setTab={setTab} isAdmin={user.role === 'admin'} isStaff={user.role === 'staff' || user.role === 'admin'} />
        <AnnouncementModal announcement={announcement} visible={showAnnouncement} onClose={async () => {
          setShowAnnouncement(false);
          if (announcement) await api.markAnnouncementRead(announcement.id).catch(() => undefined);
        }} />
      </SafeAreaView>
    </TerraShell>
  );
}

function renderTab(tab: AppTab, user: User, announcement: Announcement | null, setAnnouncement: (a: Announcement | null) => void, setShowAnnouncement: (v: boolean) => void, setTab: (tab: AppTab) => void) {
  if (tab === 'home') return <HomeScreen user={user} announcement={announcement} />;
  if (tab === 'friends') return <FriendsScreen />;
  if (tab === 'groups') return <GroupsScreen />;
  if (tab === 'chats') return <ChatScreen user={user} />;
  if (tab === 'profile') return <ProfileScreen user={user} />;
  if (tab === 'settings') return <SettingsScreen setTab={setTab} />;
  if (tab === 'admin') return <AdminScreen setAnnouncement={setAnnouncement} setShowAnnouncement={setShowAnnouncement} />;
  if (tab === 'staff') return <StaffScreen />;
  return null;
}

function TerraShell({ children }: { children: React.ReactNode }) {
  return (
    <LinearGradient colors={['#05070B', '#081213', '#11061E']} style={styles.shell}>
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      {children}
    </LinearGradient>
  );
}

function SplashScreen() {
  return (
    <TerraShell>
      <SafeAreaView style={styles.splash}>
        <Image source={logo} style={styles.splashLogo} resizeMode="contain" />
        <Text style={styles.brandTitle}>Zevryl</Text>
        <Text style={styles.brandSub}>FUTURE SECURE</Text>
        <View style={styles.loadingBar}><View style={styles.loadingFill} /></View>
        <Text style={styles.helper}>Starting secure link...</Text>
      </SafeAreaView>
    </TerraShell>
  );
}

function AuthScreen({ onDone }: { onDone: (user: User, accessToken: string, refreshToken: string) => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit() {
    setMessage('');
    if (!email || !password) return setMessage('Enter your email and password.');
    if (mode === 'register' && (!fullName || !username)) return setMessage('Fill in all account details.');
    if (mode === 'register' && password !== confirm) return setMessage('Passwords do not match.');
    setBusy(true);
    try {
      const result = mode === 'login'
        ? await api.login(email, password)
        : await api.register({ fullName, email, username, password });
      await onDone(result.user, result.accessToken, result.refreshToken);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    if (!email) return setMessage('Enter your email first.');
    await api.forgotPassword(email).then(() => setMessage('Password reset email sent.')).catch(error => setMessage(error.message));
  }

  return (
    <TerraShell>
      <SafeAreaView style={styles.authWrap}>
        <GlassCard style={styles.authCard}>
          <Image source={logo} style={styles.authLogo} resizeMode="contain" />
          <Text style={styles.brandTitle}>Zevryl</Text>
          <Text style={styles.authText}>Secure your future in the digital elite lounge.</Text>
          {mode === 'register' && <Field icon="person" placeholder="Full name" value={fullName} onChangeText={setFullName} />}
          <Field icon="mail" placeholder="Email address" value={email} onChangeText={setEmail} autoCapitalize="none" />
          {mode === 'register' && <Field icon="at" placeholder="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />}
          <Field icon="lock-closed" placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {mode === 'register' && <Field icon="shield-checkmark" placeholder="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry />}
          {mode === 'login' && <Pressable onPress={forgotPassword}><Text style={styles.link}>Forgot password?</Text></Pressable>}
          {message ? <Text style={styles.formMessage}>{message}</Text> : null}
          <PrimaryButton label={mode === 'login' ? 'Login' : 'Create Account'} icon={mode === 'login' ? 'arrow-forward' : 'flash'} busy={busy} onPress={submit} />
          <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')} style={styles.switchAuth}>
            <Text style={styles.muted}>{mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Login'}</Text>
          </Pressable>
        </GlassCard>
      </SafeAreaView>
    </TerraShell>
  );
}

function HomeScreen({ user, announcement }: { user: User; announcement: Announcement | null }) {
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {announcement?.pinToHome && <GlassCard style={styles.announcementTop}><Ionicons name="shield-checkmark" size={22} color="#7CE7B2" /><View style={styles.flex}><Text style={styles.cardTitle}>{announcement.title}</Text><Text style={styles.muted}>{announcement.body}</Text></View></GlassCard>}
      <Text style={styles.hero}>Connect Privately. Chat Freely.</Text>
      <Text style={styles.heroSub}>High-end communication for friends, groups, and secure communities.</Text>
      <PrimaryButton label="Start a Chat" icon="chatbubble-ellipses" onPress={() => Alert.alert('Start chat', 'Open Friends to add someone, then start a direct message.')} />
      <StatsGrid values={[
        ['Welcome', user.displayName],
        ['Status', user.presence],
        ['Security', 'Enabled'],
        ['Network', 'Online']
      ]} />
      <FeatureCard title="Secure Channel Alpha" body="Private conversations, group controls, and call-ready architecture." icon="people" />
      <FeatureCard title="Zero Trace Controls" body="Session management, reports, and audit trails for safety." icon="shield" />
      <FeatureCard title="Ultra Fast" body="Realtime messages backed by WebSocket and Redis." icon="flash" />
    </ScrollView>
  );
}

function FriendsScreen() {
  const [state, setState] = useState<Loadable<FriendState>>({ loading: true, data: emptyFriends });
  const [username, setUsername] = useState('');

  const load = () => api.friends().then(data => setState({ loading: false, data })).catch(error => setState({ loading: false, data: emptyFriends, error: error.message }));
  useEffect(() => { void load(); }, []);

  async function action(task: Promise<unknown>) {
    await task.catch(error => Alert.alert('Action failed', error.message));
    load();
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <SectionTitle title="Friends" action="Refresh" onPress={load} />
      <GlassCard>
        <Text style={styles.cardTitle}>Add Friend</Text>
        <Field icon="person-add" placeholder="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
        <PrimaryButton label="Send Request" icon="person-add" onPress={() => username ? action(api.requestFriend(username)) : Alert.alert('Username required', 'Enter a username first.')} />
      </GlassCard>
      {state.loading ? <LoadingState /> : state.error ? <ErrorState message={state.error} onRetry={load} /> : null}
      <UserList title="Online Friends" users={state.data.friends} empty="No friends yet. Send a request to start chatting." right={(friend) => (
        <View style={styles.rowActions}>
          <IconButton icon="chatbubble" onPress={() => Alert.alert('Direct message', `Opening chat with ${friend.displayName}`)} />
          <IconButton icon="call" onPress={() => Alert.alert('Voice call', 'Call setup will open when LiveKit is connected.')} />
          <IconButton icon="close" onPress={() => action(api.removeFriend(friend.id))} />
        </View>
      )} />
      <RequestList title="Incoming Requests" requests={state.data.incoming} accept={id => action(api.acceptFriend(id))} deny={id => action(api.denyFriend(id))} />
      <RequestList title="Outgoing Requests" requests={state.data.outgoing} />
    </ScrollView>
  );
}

function GroupsScreen() {
  const [groups, setGroups] = useState<Loadable<Group[]>>({ loading: true, data: [] });
  const [friends, setFriends] = useState<FriendState>(emptyFriends);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const load = () => Promise.all([api.groups(), api.friends()])
    .then(([groupData, friendData]) => { setGroups({ loading: false, data: groupData }); setFriends(friendData); })
    .catch(error => setGroups({ loading: false, data: [], error: error.message }));
  useEffect(() => { void load(); }, []);

  async function create() {
    if (!name.trim()) return Alert.alert('Group name required', 'Enter a group name.');
    if (selected.length < 1) return Alert.alert('Add a friend', 'You must add at least one friend to create a group.');
    await api.createGroup({ name, description, friendIds: selected }).then(() => {
      setName('');
      setDescription('');
      setSelected([]);
      load();
    }).catch(error => Alert.alert('Could not create group', error.message));
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <SectionTitle title="Active Enclaves" action="Refresh" onPress={load} />
      {groups.loading ? <LoadingState /> : groups.error ? <ErrorState message={groups.error} onRetry={load} /> : groups.data.map(group => <GlassCard key={group.id} style={styles.listCard}><Text style={styles.cardTitle}>{group.name}</Text><Text style={styles.muted}>{group.description || 'No description yet.'}</Text><Text style={styles.badge}>{group.memberCount} members · {group.unreadCount} unread</Text></GlassCard>)}
      {groups.data.length === 0 && !groups.loading && <EmptyState title="No groups yet" body="Create a group after adding at least one friend." />}
      <GlassCard>
        <Text style={styles.cardTitle}>Create Group</Text>
        <Field icon="people" placeholder="Group name" value={name} onChangeText={setName} />
        <Field icon="document-text" placeholder="Description" value={description} onChangeText={setDescription} />
        <Text style={styles.label}>Select Friends</Text>
        {friends.friends.map(friend => <Pressable key={friend.id} style={styles.memberPick} onPress={() => setSelected(prev => prev.includes(friend.id) ? prev.filter(id => id !== friend.id) : [...prev, friend.id])}><Text style={styles.body}>{friend.displayName}</Text><Ionicons name={selected.includes(friend.id) ? 'radio-button-on' : 'radio-button-off'} size={22} color="#B94DFF" /></Pressable>)}
        {friends.friends.length === 0 && <Text style={styles.muted}>Add at least one friend before creating a group.</Text>}
        <PrimaryButton label="Create Lounge" icon="flash" onPress={create} />
      </GlassCard>
    </ScrollView>
  );
}

function ChatScreen({ user }: { user: User }) {
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [callRoom, setCallRoom] = useState('');
  const [callToken, setCallToken] = useState<{ url: string; token: string; roomName: string } | null>(null);

  async function load() {
    if (!conversationId) return Alert.alert('Conversation required', 'Enter a conversation ID from the backend.');
    setLoading(true);
    await api.messages(conversationId).then(setMessages).catch(error => Alert.alert('Could not load messages', error.message));
    setLoading(false);
  }

  async function send() {
    if (!conversationId || !body.trim()) return;
    await api.sendMessage({ conversationId, body }).then(message => {
      setMessages(prev => [...prev, message]);
      setBody('');
    }).catch(error => Alert.alert('Could not send message', error.message));
  }

  async function edit(message: Message) {
    if (message.senderId !== user.id) return Alert.alert('Not allowed', 'You can edit only your own messages.');
    Alert.prompt?.('Edit message', '', async text => {
      if (!text) return;
      const updated = await api.editMessage(message.id, text);
      setMessages(prev => prev.map(item => item.id === updated.id ? updated : item));
    });
  }

  async function remove(message: Message) {
    if (message.senderId !== user.id) return Alert.alert('Not allowed', 'You can delete only your own messages.');
    await api.deleteMessage(message.id).then(() => setMessages(prev => prev.filter(item => item.id !== message.id))).catch(error => Alert.alert('Could not delete', error.message));
  }

  async function startCall(video = false) {
    const roomName = callRoom || conversationId;
    if (!roomName) return Alert.alert('Room required', 'Enter a conversation ID or call room name first.');
    await api.callToken(roomName)
      .then(result => setCallToken(result))
      .catch(error => Alert.alert('Call unavailable', error.message));
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <GlassCard>
          <Text style={styles.cardTitle}>Secure Chat</Text>
          <Field icon="key" placeholder="Conversation ID" value={conversationId} onChangeText={setConversationId} autoCapitalize="none" />
          <PrimaryButton label="Load Messages" icon="search" busy={loading} onPress={load} />
        </GlassCard>
        <GlassCard>
          <Text style={styles.cardTitle}>Voice & Video</Text>
          <Field icon="videocam" placeholder="Call room name" value={callRoom} onChangeText={setCallRoom} autoCapitalize="none" />
          <View style={styles.callActions}>
            <PrimaryButton label="Voice Call" icon="call" onPress={() => startCall(false)} />
            <PrimaryButton label="Video Call" icon="videocam" onPress={() => startCall(true)} />
          </View>
        </GlassCard>
        {callToken && <CallRoom session={callToken} onLeave={() => setCallToken(null)} />}
        {messages.length === 0 ? <EmptyState title="No messages loaded" body="Start or open a conversation to see messages." /> : messages.map(message => <Pressable key={message.id} onLongPress={() => edit(message)} style={[styles.bubble, message.senderId === user.id && styles.ownBubble]}><Text style={styles.body}>{message.body}</Text><Text style={styles.meta}>{message.isEdited ? 'edited · ' : ''}{new Date(message.createdAt).toLocaleTimeString()}</Text>{message.senderId === user.id && <Pressable onPress={() => remove(message)}><Text style={styles.deleteText}>Delete</Text></Pressable>}</Pressable>)}
      </ScrollView>
      <View style={styles.composer}><TextInput style={styles.composerInput} placeholder="Secure message" placeholderTextColor="#6E7888" value={body} onChangeText={setBody} /><IconButton icon="send" onPress={send} /></View>
    </KeyboardAvoidingView>
  );
}

function CallRoom({ session, onLeave }: { session: { url: string; token: string; roomName: string }; onLeave: () => void }) {
  return (
    <GlassCard style={styles.callCard}>
      <Text style={styles.cardTitle}>Calls unavailable</Text>
      <Text style={styles.muted}>Voice and video are disabled in this stability build. Chat and account features are still available.</Text>
      <Pressable style={styles.logout} onPress={onLeave}><Text style={styles.logoutText}>Close</Text></Pressable>
    </GlassCard>
  );
}

function ProfileScreen({ user }: { user: User }) {
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <GlassCard style={styles.profileHero}>
        <Image source={logo} style={styles.profileLogo} />
        <Text style={styles.profileName}>{user.displayName}</Text>
        <Text style={styles.muted}>@{user.username}</Text>
        <Text style={styles.badge}>{user.presence}</Text>
        <PrimaryButton label="Edit Profile" icon="create" onPress={() => Alert.alert('Edit Profile', 'Profile editor connects to PATCH /me/profile.')} />
      </GlassCard>
      <FeatureCard title="Biography" body={user.bio || 'No bio yet.'} icon="document-text" />
      <FeatureCard title="Privacy" body="Control DMs, presence, activity, and read receipts from Settings." icon="lock-closed" />
    </ScrollView>
  );
}

function SettingsScreen({ setTab }: { setTab: (tab: AppTab) => void }) {
  async function logout() {
    await api.logout().catch(() => undefined);
    await clearTokens();
    Alert.alert('Logged out', 'Restart the app to sign in again.');
  }
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.hero}>Settings</Text>
      <FeatureCard title="Account" body="Email, username, password, recovery, and two-factor authentication." icon="person" />
      <FeatureCard title="Privacy & Safety" body="DM privacy, blocked users, read receipts, and media safety." icon="shield" />
      <FeatureCard title="Devices" body="Review active sessions and log out old devices." icon="phone-portrait" />
      <FeatureCard title="Voice & Video" body="Camera, microphone, speaker, and call quality settings." icon="videocam" />
      <PrimaryButton label="Admin Dashboard" icon="shield-checkmark" onPress={() => setTab('admin')} />
      <PrimaryButton label="Staff Dashboard" icon="briefcase" onPress={() => setTab('staff')} />
      <Pressable style={styles.logout} onPress={logout}><Text style={styles.logoutText}>Log Out</Text></Pressable>
    </ScrollView>
  );
}

function AdminScreen({ setAnnouncement, setShowAnnouncement }: { setAnnouncement: (a: Announcement | null) => void; setShowAnnouncement: (v: boolean) => void }) {
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.adminStats().then(setStats).catch(() => undefined); }, []);

  async function broadcast() {
    if (!title.trim() || !body.trim()) return Alert.alert('Announcement required', 'Add a title and message.');
    setBusy(true);
    await api.createAnnouncement({ title, body, isPopup: true, pinToHome: true })
      .then(announcement => { setAnnouncement(announcement); setShowAnnouncement(true); setTitle(''); setBody(''); })
      .catch(error => Alert.alert('Could not broadcast', error.message));
    setBusy(false);
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.hero}>Admin Overview</Text>
      <StatsGrid values={[['Users', String(stats.users)], ['Reports', String(stats.reports)], ['Groups', String(stats.activeGroups)], ['Health', `${stats.systemHealth}%`]]} />
      <GlassCard>
        <Text style={styles.cardTitle}>Create Announcement</Text>
        <Field icon="megaphone" placeholder="Announcement title" value={title} onChangeText={setTitle} />
        <Field icon="document-text" placeholder="Message body" value={body} onChangeText={setBody} />
        <PrimaryButton label="Broadcast Announcement" icon="send" busy={busy} onPress={broadcast} />
      </GlassCard>
      <FeatureCard title="Moderation" body="Search users, ban, mute, unban, warn, and review reports from the backend dashboard." icon="hammer" />
      <FeatureCard title="Security Alerts" body="Audit logs, suspicious login alerts, automod flags, and system health." icon="warning" />
    </ScrollView>
  );
}

function StaffScreen() {
  const [reports, setReports] = useState<Loadable<Report[]>>({ loading: true, data: [] });
  const load = () => api.reports().then(data => setReports({ loading: false, data })).catch(error => setReports({ loading: false, data: [], error: error.message }));
  useEffect(() => { void load(); }, []);
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <SectionTitle title="Staff & Moderation" action="Refresh" onPress={load} />
      {reports.loading ? <LoadingState /> : reports.error ? <ErrorState message={reports.error} onRetry={load} /> : reports.data.map(report => <GlassCard key={report.id}><Text style={styles.cardTitle}>{report.type}</Text><Text style={styles.muted}>{report.reason}</Text><Text style={styles.badge}>{report.status}</Text></GlassCard>)}
      {reports.data.length === 0 && !reports.loading && <EmptyState title="No reports" body="Reports and automod flags will appear here." />}
    </ScrollView>
  );
}

function Header({ user, tab, setTab }: { user: User; tab: AppTab; setTab: (tab: AppTab) => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => setTab('home')} style={styles.headerBrand}><Image source={logo} style={styles.headerLogo} /><Text style={styles.headerTitle}>Zevryl</Text></Pressable>
      <View style={styles.headerActions}><IconButton icon="search" onPress={() => Alert.alert('Search', 'Use screen filters or backend search endpoints.')} /><IconButton icon="person" onPress={() => setTab('profile')} /></View>
    </View>
  );
}

function BottomNav({ tab, setTab, isAdmin, isStaff }: { tab: AppTab; setTab: (tab: AppTab) => void; isAdmin: boolean; isStaff: boolean }) {
  const items: Array<[AppTab, keyof typeof Ionicons.glyphMap]> = [['home', 'home'], ['friends', 'people'], ['chats', 'chatbubble'], ['groups', 'grid'], ['profile', 'person']];
  return (
    <BlurView intensity={55} tint="dark" style={styles.nav}>
      {items.map(([key, icon]) => <Pressable key={key} onPress={() => setTab(key)} style={styles.navItem}><Ionicons name={icon} size={22} color={tab === key ? '#27D8FF' : '#7E8798'} /></Pressable>)}
      {isStaff && <Pressable onPress={() => setTab('staff')} style={styles.navItem}><Ionicons name="briefcase" size={21} color={tab === 'staff' ? '#B94DFF' : '#7E8798'} /></Pressable>}
      {isAdmin && <Pressable onPress={() => setTab('admin')} style={styles.navItem}><Ionicons name="shield-checkmark" size={21} color={tab === 'admin' ? '#B94DFF' : '#7E8798'} /></Pressable>}
    </BlurView>
  );
}

function AnnouncementModal({ announcement, visible, onClose }: { announcement: Announcement | null; visible: boolean; onClose: () => void }) {
  if (!announcement) return null;
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <GlassCard style={styles.modalCard}>
          <Ionicons name="megaphone" size={34} color="#27D8FF" />
          <Text style={styles.heroSmall}>{announcement.title}</Text>
          <Text style={styles.body}>{announcement.body}</Text>
          <PrimaryButton label="Got it" icon="checkmark" onPress={onClose} />
        </GlassCard>
      </View>
    </Modal>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.field}>
      <Ionicons name={props.icon} size={16} color="#7E8798" />
      <TextInput {...props} placeholderTextColor="#657184" style={styles.input} />
    </View>
  );
}

function PrimaryButton({ label, icon, busy, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; busy?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={busy ? undefined : onPress} style={styles.primaryButton}>
      <LinearGradient colors={['#9B24FF', '#27D8FF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryGradient}>
        {busy ? <ActivityIndicator color="#fff" /> : <><Text style={styles.primaryText}>{label}</Text><Ionicons name={icon} size={18} color="#fff" /></>}
      </LinearGradient>
    </Pressable>
  );
}

function IconButton({ icon, onPress }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.iconButton}><Ionicons name={icon} size={19} color="#D8EFE3" /></Pressable>;
}

function GlassCard({ children, style }: { children: React.ReactNode; style?: object }) {
  return <BlurView intensity={28} tint="dark" style={[styles.glassCard, style]}>{children}</BlurView>;
}

function FeatureCard({ title, body, icon }: { title: string; body: string; icon: keyof typeof Ionicons.glyphMap }) {
  return <GlassCard style={styles.featureCard}><Ionicons name={icon} size={24} color="#7CE7B2" /><Text style={styles.cardTitle}>{title}</Text><Text style={styles.muted}>{body}</Text></GlassCard>;
}

function StatsGrid({ values }: { values: Array<[string, string]> }) {
  return <View style={styles.statsGrid}>{values.map(([label, value]) => <GlassCard key={label} style={styles.statCard}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></GlassCard>)}</View>;
}

function SectionTitle({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  return <View style={styles.sectionTitle}><Text style={styles.heroSmall}>{title}</Text>{action && <Pressable onPress={onPress}><Text style={styles.link}>{action}</Text></Pressable>}</View>;
}

function UserList({ title, users, empty, right }: { title: string; users: User[]; empty: string; right?: (user: User) => React.ReactNode }) {
  return <View><Text style={styles.label}>{title}</Text>{users.length === 0 ? <EmptyState title="Empty" body={empty} /> : users.map(user => <GlassCard key={user.id} style={styles.userRow}><View style={styles.avatar}><Text style={styles.avatarText}>{user.displayName.slice(0, 1)}</Text></View><View style={styles.flex}><Text style={styles.body}>{user.displayName}</Text><Text style={styles.muted}>{user.customStatus || user.presence}</Text></View>{right?.(user)}</GlassCard>)}</View>;
}

function RequestList({ title, requests, accept, deny }: { title: string; requests: FriendState['incoming']; accept?: (id: string) => void; deny?: (id: string) => void }) {
  return <View><Text style={styles.label}>{title}</Text>{requests.map(req => <GlassCard key={req.id} style={styles.userRow}><View style={styles.flex}><Text style={styles.body}>{req.fromUser.displayName}</Text><Text style={styles.muted}>{req.status}</Text></View>{accept && <IconButton icon="checkmark" onPress={() => accept(req.id)} />}{deny && <IconButton icon="close" onPress={() => deny(req.id)} />}</GlassCard>)}</View>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <GlassCard style={styles.empty}><Ionicons name="sparkles" size={24} color="#7CE7B2" /><Text style={styles.cardTitle}>{title}</Text><Text style={styles.muted}>{body}</Text></GlassCard>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <GlassCard><Text style={styles.cardTitle}>Could not load</Text><Text style={styles.muted}>{message}</Text><PrimaryButton label="Try Again" icon="refresh" onPress={onRetry} /></GlassCard>;
}

function LoadingState() {
  return <GlassCard style={styles.empty}><ActivityIndicator color="#27D8FF" /><Text style={styles.muted}>Loading...</Text></GlassCard>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#05070B' },
  app: { flex: 1 },
  flex: { flex: 1 },
  glowTop: { position: 'absolute', width: 240, height: 240, borderRadius: 120, backgroundColor: 'rgba(155,36,255,.24)', top: -90, right: -70 },
  glowBottom: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(39,216,255,.16)', bottom: -120, left: -80 },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26 },
  splashLogo: { width: 190, height: 190 },
  brandTitle: { color: '#F2F8F5', fontSize: 27, fontWeight: '800', marginTop: 8 },
  brandSub: { color: '#27D8FF', fontSize: 10, letterSpacing: 3, marginTop: 4 },
  loadingBar: { width: '78%', height: 2, backgroundColor: '#111A22', marginTop: 72 },
  loadingFill: { width: '62%', height: 2, backgroundColor: '#B94DFF' },
  helper: { color: '#6ED9E9', fontSize: 10, letterSpacing: 1.8, marginTop: 10 },
  authWrap: { flex: 1, justifyContent: 'center', padding: 16 },
  authCard: { alignItems: 'center', gap: 12 },
  authLogo: { width: 112, height: 112 },
  authText: { color: '#C9D6D5', textAlign: 'center', marginBottom: 10 },
  field: { flexDirection: 'row', alignItems: 'center', width: '100%', minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(124,231,178,.18)', backgroundColor: 'rgba(4,9,12,.64)', paddingHorizontal: 12, gap: 8, marginTop: 8 },
  input: { flex: 1, color: '#F2F8F5', height: 46 },
  link: { color: '#7CE7B2', fontWeight: '700' },
  formMessage: { color: '#FFD0D5', textAlign: 'center' },
  switchAuth: { padding: 12 },
  muted: { color: '#9DA9B3', lineHeight: 20 },
  body: { color: '#EAF4F0', lineHeight: 22 },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerLogo: { width: 30, height: 30, borderRadius: 8 },
  headerTitle: { color: '#C8FFE9', fontWeight: '800', fontSize: 18 },
  headerActions: { flexDirection: 'row', gap: 8 },
  content: { flex: 1 },
  scroll: { padding: 16, gap: 14, paddingBottom: 110 },
  glassCard: { borderRadius: 22, borderWidth: 1, borderColor: 'rgba(124,231,178,.14)', backgroundColor: 'rgba(13,20,26,.68)', padding: 16, overflow: 'hidden' },
  hero: { color: '#F8FFFC', fontWeight: '900', fontSize: 30, lineHeight: 35 },
  heroSmall: { color: '#F8FFFC', fontWeight: '900', fontSize: 22 },
  heroSub: { color: '#C6D9D3', fontSize: 15, lineHeight: 22 },
  cardTitle: { color: '#F8FFFC', fontWeight: '800', fontSize: 17, marginTop: 4 },
  announcementTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  primaryButton: { width: '100%', borderRadius: 18, overflow: 'hidden', marginTop: 8 },
  primaryGradient: { minHeight: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderRadius: 18 },
  primaryText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '47%', minHeight: 88 },
  statValue: { color: '#7CE7B2', fontWeight: '900', fontSize: 22 },
  statLabel: { color: '#8FA39D', marginTop: 6, textTransform: 'uppercase', fontSize: 11 },
  featureCard: { gap: 6 },
  sectionTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: '#9CEED0', fontWeight: '800', textTransform: 'uppercase', fontSize: 12, marginTop: 8, marginBottom: 6, letterSpacing: 1 },
  listCard: { gap: 5 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#12302C', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#27D8FF' },
  avatarText: { color: '#F8FFFC', fontWeight: '900' },
  rowActions: { flexDirection: 'row', gap: 6 },
  iconButton: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.06)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,.07)' },
  badge: { color: '#7CE7B2', fontSize: 12, marginTop: 8 },
  empty: { alignItems: 'center', gap: 6 },
  memberPick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,.04)', marginTop: 8 },
  bubble: { maxWidth: '88%', borderRadius: 18, padding: 14, backgroundColor: '#101927', marginBottom: 10 },
  ownBubble: { alignSelf: 'flex-end', backgroundColor: '#4B20B5' },
  meta: { color: '#93A0AA', fontSize: 11, marginTop: 6 },
  deleteText: { color: '#FF9BA5', marginTop: 6, fontWeight: '700' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderTopWidth: 1, borderColor: 'rgba(255,255,255,.08)', backgroundColor: 'rgba(5,7,11,.92)' },
  composerInput: { flex: 1, minHeight: 44, color: '#F8FFFC', borderRadius: 16, backgroundColor: '#0D141A', paddingHorizontal: 14 },
  callActions: { gap: 8 },
  callCard: { gap: 12 },
  videoGrid: { minHeight: 220, gap: 10, borderRadius: 18, overflow: 'hidden', backgroundColor: '#05070B', alignItems: 'center', justifyContent: 'center' },
  videoTile: { width: '100%', height: 220, borderRadius: 18 },
  profileHero: { alignItems: 'center' },
  profileLogo: { width: 120, height: 120, borderRadius: 28 },
  profileName: { color: '#fff', fontSize: 24, fontWeight: '900', marginTop: 12 },
  logout: { borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,120,130,.35)', minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  logoutText: { color: '#FF9BA5', fontWeight: '800' },
  nav: { position: 'absolute', left: 16, right: 16, bottom: 14, height: 62, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(124,231,178,.14)' },
  navItem: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.64)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { width: '100%', gap: 12, alignItems: 'center' }
});
