import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  AppUpdate,
  BadgeDefinition,
  BlogPost,
  Conversation,
  DashboardStats,
  FriendState,
  Group,
  Message,
  Report,
  RoleDefinition,
  Ticket,
  User
} from './types';

const logo = require('../assets/zevryl-logo.png');
const wordmark = require('../assets/zevryl-wordmark.png');

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

type Loadable<T> = { loading: boolean; data: T; error?: string };
type NoticeTone = 'error' | 'success' | 'info';
type Notice = { tone: NoticeTone; text: string } | null;

const emptyFriends: FriendState = { friends: [], incoming: [], outgoing: [], blocked: [] };
const emptyStats: DashboardStats = { users: 0, reports: 0, activeGroups: 0, systemHealth: 0, announcements: 0, blogs: 0 };
const emojis = ['😀', '😁', '😂', '🤣', '😊', '😍', '😎', '😢', '😡', '👍', '🙏', '👏', '🔥', '✅', '💬', '⭐', '🛡️', '🌿', '⚒️', '🎉', '❤️', '💯', '👀', '📌', '🚀', '🎮', '🏆', '⚡'];
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
const badgePriority = ['Founder', 'Admin', 'Mod', 'Staff', 'Vip', 'Partner', 'Demo', 'Member'];
const profileThemes: Record<NonNullable<User['profileTheme']>, { label: string; color: string; colors: [string, string, string] }> = {
  terria: { label: 'Terria', color: '#7D8B58', colors: ['#111712', '#19221A', '#2A2118'] },
  ember: { label: 'Ember', color: '#B86B4A', colors: ['#171111', '#261917', '#342018'] },
  ocean: { label: 'Ocean', color: '#4B7C8C', colors: ['#101518', '#15232A', '#172D34'] },
  mono: { label: 'Mono', color: '#AEB8A5', colors: ['#111111', '#1C1C1C', '#282828'] },
  midnight: { label: 'Midnight', color: '#5870A8', colors: ['#080B10', '#121827', '#1A2234'] },
  forest: { label: 'Forest', color: '#4E7D5A', colors: ['#0B120D', '#142219', '#1D3023'] },
  rose: { label: 'Rose', color: '#B66A7A', colors: ['#160D11', '#24151B', '#301C24'] },
  graphite: { label: 'Graphite', color: '#8B9188', colors: ['#0E0F0E', '#191B19', '#242824'] }
};
const colorChoices = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E',
  '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1', '#8B5CF6',
  '#A855F7', '#D946EF', '#EC4899', '#F43F5E', '#58764A', '#7B6F45',
  '#8C5E3C', '#4B6D78', '#AEB8A5', '#F4F0E6', '#111712', '#000000'
];
const densityChoices = {
  compact: { label: 'Compact', scale: 0.82 },
  comfortable: { label: 'Comfortable', scale: 1 },
  spacious: { label: 'Spacious', scale: 1.18 }
};
const gifs = [
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExb2d4MzgzdTBqOWc3eGxxZGNzYnRydjF0dDhtczlmbzhmOWUwajU2MiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/111ebonMs90YLu/giphy.gif',
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExZmRnOWlzZ2l3enV4Mmpyc2t6Zm82dzV5N2Vzd3NlNXQ2Ynpmb3pyNCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/l0HlNaQ6gWfllcjDO/giphy.gif',
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExYnV3d2VudnV3enVscnE2djZxa2U5bXF0OWM1eXo0d3hnMHU3bHVqNCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/26ufdipQqU2lhNA4g/giphy.gif',
  'https://media.giphy.com/media/3o7TKtnuHOHHUjR38Y/giphy.gif',
  'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif',
  'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif',
  'https://media.giphy.com/media/ely3apij36BJhoZ234/giphy.gif',
  'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
  'https://media.giphy.com/media/3oz8xIsloV7zOmt81G/giphy.gif',
  'https://media.giphy.com/media/26tOZ42Mg6pbTUPHW/giphy.gif'
];
const languages = [
  ['en', 'English'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['te', 'Telugu'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'],
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['ar', 'Arabic'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['id', 'Indonesian'], ['tr', 'Turkish'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['nl', 'Dutch'], ['pl', 'Polish'], ['uk', 'Ukrainian'], ['ur', 'Urdu'], ['fa', 'Persian'], ['sw', 'Swahili']
] as const;

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
  const [updateInfo, setUpdateInfo] = useState<AppUpdate | null>(null);
  const [showUpdate, setShowUpdate] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [pendingConversationId, setPendingConversationId] = useState<string | undefined>();
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

  useEffect(() => {
    api.latestUpdate()
      .then(update => {
        if (!update?.version || update.version === '0.1.18') return;
        const key = `zevryl.update.seen.${update.version}`;
        SecureStore.getItemAsync(key).then(seen => {
          if (!seen) {
            setUpdateInfo(update);
            setShowUpdate(true);
          }
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!user || !Device.isDevice) return;
    Notifications.requestPermissionsAsync()
      .then((result: any) => result.granted || result.status === 'granted' ? Notifications.getExpoPushTokenAsync() : null)
      .then(tokenResult => tokenResult?.data ? api.registerPushToken(tokenResult.data, Platform.OS) : null)
      .catch(() => undefined);
  }, [user?.id]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const conversationId = response.notification.request.content.data?.conversationId;
      if (typeof conversationId === 'string') {
        setPendingConversationId(conversationId);
        setTab('chats');
      }
    });
    return () => subscription.remove();
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
    <TerraShell theme={user.profileTheme}>
      <SafeAreaView style={styles.app}>
        <Header user={user} setTab={setTab} />
        <View style={styles.content}>
          {renderTab(tab, user, {
            setUser,
            setAnnouncement,
            setShowAnnouncement,
            setTab,
            notify: showNotice,
            pendingConversationId
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
        <UpdateModal update={updateInfo} visible={showUpdate} onClose={async () => {
          if (updateInfo?.version) await SecureStore.setItemAsync(`zevryl.update.seen.${updateInfo.version}`, '1');
          setShowUpdate(false);
        }} />
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
    pendingConversationId?: string;
  }
) {
  if (tab === 'admin' && user.role !== 'admin') return <LockedScreen title="Admin only" />;
  if (tab === 'staff' && user.role !== 'staff' && user.role !== 'admin') return <LockedScreen title="Staff only" />;
  if (tab === 'home') return <HomeScreen user={user} notify={tools.notify} setTab={tools.setTab} />;
  if (tab === 'friends') return <FriendsScreen notify={tools.notify} setTab={tools.setTab} />;
  if (tab === 'groups') return <GroupsScreen user={user} notify={tools.notify} />;
  if (tab === 'chats') return <ChatScreen user={user} notify={tools.notify} initialConversationId={tools.pendingConversationId} />;
  if (tab === 'profile') return <ProfileScreen user={user} setUser={tools.setUser} notify={tools.notify} />;
  if (tab === 'settings') return <SettingsScreen user={user} setTab={tools.setTab} setUser={tools.setUser} notify={tools.notify} />;
  if (tab === 'tickets') return <TicketScreen user={user} notify={tools.notify} />;
  if (tab === 'admin') return <AdminScreen setAnnouncement={tools.setAnnouncement} setShowAnnouncement={tools.setShowAnnouncement} setTab={tools.setTab} notify={tools.notify} />;
  if (tab === 'staff') return <StaffScreen notify={tools.notify} />;
  return null;
}

function TerraShell({ children, theme = 'terria' }: { children: React.ReactNode; theme?: User['profileTheme'] }) {
  const colors = profileThemes[theme || 'terria'].colors;
  return (
    <LinearGradient colors={colors} style={styles.shell}>
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
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email || !password) return notify('error', 'Enter your email and password.');
    if (mode === 'register' && (!fullName || !username)) return notify('error', 'Fill in all account details.');
    if (mode === 'register' && password !== confirm) return notify('error', 'Passwords do not match.');
    setBusy(true);
    try {
      const result = mode === 'login'
        ? await api.login(email, password, twoFactorCode || undefined)
        : await api.register({ fullName, email, username, password });
      await onDone(result.user, result.accessToken, result.refreshToken);
      notify('success', 'Signed in.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not sign in.';
      if (/2FA|authenticator/i.test(message)) setNeeds2fa(true);
      notify('error', message);
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
          {mode === 'login' && needs2fa && <Field icon="keypad" placeholder="Authenticator code" value={twoFactorCode} onChangeText={setTwoFactorCode} keyboardType="number-pad" />}
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

function HomeScreen({ user, notify, setTab }: { user: User; notify: (tone: 'error' | 'success' | 'info', text: string) => void; setTab: (tab: AppTab) => void }) {
  const [announcements, setAnnouncements] = useState<Loadable<Announcement[]>>({ loading: true, data: [] });
  const [blogs, setBlogs] = useState<Loadable<BlogPost[]>>({ loading: true, data: [] });
  const [view, setView] = useState<'updates' | 'support'>('updates');
  const [supportMessage, setSupportMessage] = useState('');

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
          <Text style={styles.hero}>Welcome back</Text>
          <Text style={styles.heroSub}>Messages, groups, tickets, and official updates in one clean workspace.</Text>
        </View>
        <StatusPill presence={user.presence} />
      </View>
      <View style={styles.segment}>
        <Pressable style={[styles.segmentItem, view === 'updates' && styles.segmentActive]} onPress={() => setView('updates')}><Text style={styles.segmentText}>Updates</Text></Pressable>
        <Pressable style={[styles.segmentItem, view === 'support' && styles.segmentActive]} onPress={() => setView('support')}><Text style={styles.segmentText}>Support</Text></Pressable>
      </View>
      {view === 'support' ? (
        <>
          <GlassCard>
            <Text style={styles.cardTitle}>Support Center</Text>
            <Text style={styles.muted}>Get help with your account, messages, groups, calls, reports, or app bugs.</Text>
            <View style={styles.ticketActions}>
              <SecondaryButton label="Open Tickets" icon="ticket" onPress={() => setTab('tickets')} />
              <SecondaryButton label="Report a Bug" icon="bug" onPress={() => setSupportMessage('I found a bug: ')} />
            </View>
          </GlassCard>
          <GlassCard>
            <Text style={styles.cardTitle}>Quick Help</Text>
            <Field icon="chatbubble" placeholder="Tell support what happened" value={supportMessage} onChangeText={setSupportMessage} multiline />
            <PrimaryButton label="Send Support Ticket" icon="send" onPress={() => {
              if (!supportMessage.trim()) return notify('error', 'Write a short message first.');
              api.createTicket({ type: 'support', subject: 'Support request', body: supportMessage })
                .then(() => { setSupportMessage(''); notify('success', 'Support ticket sent.'); })
                .catch(error => notify('error', error.message));
            }} />
          </GlassCard>
          <FeatureCard title="Account help" body="Use password recovery if you cannot sign in. Support can review recovery tickets from the ticket center." icon="key" />
          <FeatureCard title="Safety help" body="Report users, messages, groups, or media. Staff can reply in the same ticket." icon="shield-checkmark" />
          <FeatureCard title="Calls and notifications" body="Allow microphone, camera, and notification permissions when Android asks. You can change these in phone settings." icon="notifications" />
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

  function confirmRemove(friend: User) {
    Alert.alert('Remove friend?', `${friend.displayName} will be removed from your friends list.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void action(api.removeFriend(friend.id), 'Friend removed.') }
    ]);
  }

  async function friendControl(friend: User, control: 'mute' | 'unmute' | 'block') {
    await api.friendAction(friend.id, control)
      .then(() => notify('success', control === 'block' ? 'Friend blocked.' : control === 'mute' ? 'Friend muted.' : 'Friend unmuted.'))
      .catch(error => notify('error', error.message));
    load();
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <SectionTitle title="Friends" action="Refresh" onPress={load} />
      <GlassCard>
        <Text style={styles.cardTitle}>Add Friend</Text>
        <Field icon="person-add" placeholder="username#12345" value={username} onChangeText={setUsername} autoCapitalize="none" />
        <PrimaryButton label="Send Request" icon="send" onPress={() => username ? action(api.requestFriend(username), 'Friend request sent.') : notify('error', 'Enter a username tag first.')} />
      </GlassCard>
      {state.loading ? <LoadingState /> : state.error ? <ErrorState message={state.error} onRetry={load} /> : null}
      <UserList title="Friends" users={state.data.friends} empty="Add a friend to start a DM." right={(friend) => (
        <View style={styles.rowActions}>
          <IconButton icon="chatbubble" onPress={async () => {
            await api.createDm(friend.id).then(() => { notify('success', `DM ready with ${friend.displayName}.`); setTab('chats'); }).catch(error => notify('error', error.message));
          }} />
          <IconButton icon="notifications-off" onPress={() => friendControl(friend, 'mute')} />
          <IconButton icon="volume-high" onPress={() => friendControl(friend, 'unmute')} />
          <IconButton icon="ban" onPress={() => friendControl(friend, 'block')} />
          <IconButton icon="close" onPress={() => confirmRemove(friend)} />
        </View>
      )} />
      <RequestList title="Incoming Requests" requests={state.data.incoming} accept={id => action(api.acceptFriend(id), 'Request accepted.')} deny={id => action(api.denyFriend(id), 'Request denied.')} />
      <RequestList title="Outgoing Requests" requests={state.data.outgoing} />
    </ScrollView>
  );
}

function GroupsScreen({ user, notify }: { user: User; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [groups, setGroups] = useState<Loadable<Group[]>>({ loading: true, data: [] });
  const [friends, setFriends] = useState<FriendState>(emptyFriends);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [showCreate, setShowCreate] = useState(false);
  const [voiceLimit, setVoiceLimit] = useState('25');
  const [videoLimit, setVideoLimit] = useState('10');
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const load = () => Promise.all([api.groups(), api.friends()])
    .then(([groupData, friendData]) => { setGroups({ loading: false, data: groupData }); setFriends(friendData); })
    .catch(error => { setGroups({ loading: false, data: [], error: error.message }); notify('error', error.message); });
  useEffect(() => { load(); }, []);

  async function create() {
    if (!name.trim()) return notify('error', 'Group name required.');
    if (selected.length < 1) return notify('error', 'Select at least one friend.');
    await api.createGroup({ name, description, friendIds: selected, visibility, voiceLimit: Number(voiceLimit) || 25, videoLimit: Number(videoLimit) || 10 })
      .then(() => { setName(''); setDescription(''); setSelected([]); setShowCreate(false); notify('success', 'Group created.'); load(); })
      .catch(error => notify('error', error.message));
  }

  async function deleteGroup() {
    if (!deleteTarget) return;
    if (deleteConfirm !== deleteTarget.name) return notify('error', 'Type the group name exactly to delete it.');
    await api.deleteGroup(deleteTarget.id, deleteConfirm)
      .then(() => { setDeleteTarget(null); setDeleteConfirm(''); notify('success', 'Group deleted.'); load(); })
      .catch(error => notify('error', error.message));
  }
  async function ticketAction(ticket: Ticket, action: 'close' | 'reopen') {
    await api.updateTicket(ticket.id, { action })
      .then(load)
      .catch(error => notify('error', error.message));
  }
  async function download(ticket: Ticket) {
    await api.downloadTicket(ticket.id)
      .then(text => shareTextFile(`zevryl-ticket-${ticket.id}.txt`, text, notify))
      .catch(error => notify('error', error.message));
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.sectionTitle}>
        <Text style={styles.heroSmall}>Groups</Text>
        <View style={styles.rowActions}>
          <IconButton icon="refresh" onPress={load} />
          <IconButton icon="add" onPress={() => setShowCreate(true)} />
        </View>
      </View>
      {groups.loading ? <LoadingState /> : groups.error ? <ErrorState message={groups.error} onRetry={load} /> : groups.data.map(group => (
        <GlassCard key={group.id} style={styles.listCard}><Text style={styles.cardTitle}>{group.name}</Text><Text style={styles.muted}>{group.description || 'No description yet.'}</Text><Text style={styles.badge}>{group.visibility === 'public' ? 'Public' : 'Private'} - {group.memberCount} members - voice {group.voiceLimit ?? 25} - video {group.videoLimit ?? 10}</Text><View style={styles.ticketActions}><SecondaryButton label="Open Chat" icon="chatbubbles" onPress={() => notify('info', 'Open Messages and choose this group conversation.')} /><SecondaryButton label="Invite" icon="link" onPress={() => api.groupInvite(group.id).then(invite => Clipboard.setStringAsync(invite.inviteUrl).then(() => notify('success', 'Invite link copied.'))).catch(error => notify('error', error.message))} />{group.ownerId === user.id ? <SecondaryButton label="Delete" icon="trash" onPress={() => setDeleteTarget(group)} /> : null}</View></GlassCard>
      ))}
      {groups.data.length === 0 && !groups.loading && <EmptyState title="No groups yet" body="Create a group after adding at least one friend." />}
      <Modal visible={showCreate} transparent animationType="slide">
        <View style={styles.sheetBackdrop}>
          <View style={styles.editorPanel}>
            <View style={styles.editorHeader}><Text style={[styles.cardTitle, { flex: 1 }]}>Create Group</Text><IconButton icon="close" onPress={() => setShowCreate(false)} /></View>
            <Field icon="people" placeholder="Group name" value={name} onChangeText={setName} />
            <Field icon="document-text" placeholder="Description" value={description} onChangeText={setDescription} />
            <View style={styles.segment}>{(['private', 'public'] as const).map(item => <Pressable key={item} style={[styles.segmentItem, visibility === item && styles.segmentActive]} onPress={() => setVisibility(item)}><Text style={styles.segmentText}>{item === 'private' ? 'Private' : 'Public'}</Text></Pressable>)}</View>
            <Text style={styles.muted}>{visibility === 'private' ? 'Only owner-approved members and invite links can enter.' : 'Anyone with the invite link can join.'}</Text>
            <View style={styles.statsGrid}>
              <Field icon="call" placeholder="Voice limit" value={voiceLimit} onChangeText={setVoiceLimit} keyboardType="number-pad" />
              <Field icon="videocam" placeholder="Video limit" value={videoLimit} onChangeText={setVideoLimit} keyboardType="number-pad" />
            </View>
            <Text style={styles.label}>Select Friends</Text>
            <ScrollView style={{ maxHeight: 220 }}>{friends.friends.map(friend => <Pressable key={friend.id} style={styles.memberPick} onPress={() => setSelected(prev => prev.includes(friend.id) ? prev.filter(id => id !== friend.id) : [...prev, friend.id])}><Text style={styles.body}>{friend.displayName}</Text><Ionicons name={selected.includes(friend.id) ? 'radio-button-on' : 'radio-button-off'} size={22} color="#CDA16A" /></Pressable>)}</ScrollView>
            {friends.friends.length === 0 && <Text style={styles.muted}>Add at least one friend before creating a group.</Text>}
            <PrimaryButton label="Create Group" icon="add" onPress={create} />
          </View>
        </View>
      </Modal>
      <Modal visible={Boolean(deleteTarget)} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.announcementModal}>
            <Text style={styles.cardTitle}>Delete group</Text>
            <Text style={styles.muted}>Only the owner can delete this group. Type {deleteTarget?.name} to confirm.</Text>
            <Field icon="trash" placeholder="Group name" value={deleteConfirm} onChangeText={setDeleteConfirm} />
            <PrimaryButton label="Delete Group" icon="trash" onPress={deleteGroup} />
            <SecondaryButton label="Cancel" icon="close" onPress={() => { setDeleteTarget(null); setDeleteConfirm(''); }} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function ChatScreen({ user, notify, initialConversationId }: { user: User; notify: (tone: 'error' | 'success' | 'info', text: string) => void; initialConversationId?: string }) {
  const [conversations, setConversations] = useState<Loadable<Conversation[]>>({ loading: true, data: [] });
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [gifSearch, setGifSearch] = useState('');
  const [search, setSearch] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportProof, setReportProof] = useState('');
  const messageScrollRef = useRef<ScrollView | null>(null);

  const loadConversations = () => api.conversations()
    .then(data => {
      setConversations({ loading: false, data });
      if (initialConversationId) {
        const next = data.find(item => item.id === initialConversationId);
        if (next) setSelected(next);
      }
    })
    .catch(error => { setConversations({ loading: false, data: [], error: error.message }); notify('error', error.message); });
  useEffect(() => { loadConversations(); }, []);

  useEffect(() => {
    if (!selected) return;
    api.messages(selected.id, { q: search, pinned: pinnedOnly }).then(setMessages).catch(error => notify('error', error.message));
  }, [selected?.id, pinnedOnly]);

  useEffect(() => {
    requestAnimationFrame(() => messageScrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length, selected?.id]);

  const refreshMessages = () => selected && api.messages(selected.id, { q: search, pinned: pinnedOnly }).then(setMessages).catch(error => notify('error', error.message));
  const pinnedMessage = messages.find(message => message.pinned);
  function openTray(tray: 'emoji' | 'gif') {
    setShowEmoji(tray === 'emoji' ? value => !value : false);
    setShowGif(tray === 'gif' ? value => !value : false);
  }

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
    setShowEmoji(false);
    setShowGif(false);
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

  async function pin(message: Message) {
    await api.pinMessage(message.id)
      .then(next => setMessages(prev => prev.map(item => item.id === next.id ? next : item)))
      .catch(error => notify('error', error.message));
  }

  async function copyMessage(message: Message) {
    await Clipboard.setStringAsync(message.body || message.attachmentUrl || '');
    notify('success', 'Message copied.');
  }

  async function editMessage(message: Message) {
    if (message.senderId !== user.id) return;
    Alert.prompt?.('Edit message', undefined, text => {
      if (text?.trim()) api.editMessage(message.id, text).then(next => setMessages(prev => prev.map(item => item.id === next.id ? next : item))).catch(error => notify('error', error.message));
    }, 'plain-text', message.body);
  }

  async function dmAction(action: 'mute' | 'block' | 'unfriend', hours?: number) {
    if (!selected) return;
    await api.conversationAction(selected.id, action, { hours })
      .then(() => { notify('success', action === 'mute' ? 'Conversation muted.' : action === 'block' ? 'User blocked.' : 'Friend removed.'); setProfileUser(null); loadConversations(); })
      .catch(error => notify('error', error.message));
  }

  async function submitReport() {
    if (!profileUser) return;
    if (!reportReason.trim()) return notify('error', 'Add a report reason.');
    await api.createTicket({ type: 'report', subject: `Report ${profileUser.tag || profileUser.username}`, body: reportReason, proofUrl: reportProof || undefined, targetUserId: profileUser.id })
      .then(() => { notify('success', 'Report ticket created.'); setReportReason(''); setReportProof(''); setProfileUser(null); })
      .catch(error => notify('error', error.message));
  }

  async function downloadChat() {
    if (!selected) return;
    await api.downloadConversation(selected.id)
      .then(text => shareTextFile(`zevryl-chat-${selected.id}.csv`, text, notify))
      .catch(error => notify('error', error.message));
  }

  async function startCall(kind: 'voice' | 'video') {
    if (!selected) return;
    await api.callToken(`${kind}-${selected.id}`)
      .then(result => notify('success', `${kind === 'voice' ? 'Voice' : 'Video'} room ready: ${result.roomName}. ${selected.participants.length} member${selected.participants.length === 1 ? '' : 's'} in this conversation.`))
      .catch(error => notify('error', error.message));
  }

  const emojiChoices = emojis.filter(item => !emojiSearch.trim() || item.includes(emojiSearch.trim()));
  const gifChoices = gifs.filter(item => !gifSearch.trim() || item.toLowerCase().includes(gifSearch.trim().toLowerCase()));

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 84 : 22} style={styles.flex}>
      <View style={styles.chatLayout}>
        {!selected ? (
          <ScrollView contentContainerStyle={styles.dmListFull}>
            <SectionTitle title="Direct Messages" action="Refresh" onPress={loadConversations} />
            {conversations.loading ? <LoadingState /> : conversations.data.length === 0 ? <EmptyState title="No DMs" body="Open Friends and start a DM." /> : conversations.data.map(item => (
              <Pressable key={item.id} style={styles.dmCard} onPress={() => setSelected(item)}>
                {item.participants.find(p => p.id !== user.id) ? <UserAvatar user={item.participants.find(p => p.id !== user.id)!} /> : <View style={styles.avatar}><Text style={styles.avatarText}>{item.title.slice(0, 1)}</Text></View>}
                <View style={styles.flex}>
                  <Text style={styles.dmTitle}>{item.title}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{item.mutedUntil ? 'Muted · ' : ''}{item.lastMessage?.body || item.subtitle || 'No messages yet'}</Text>
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
              <Text style={styles.meta}>{selected.kind === 'group' ? `${selected.participants.length} members` : 'Private DM'}</Text>
            </View>
            <IconButton icon="call" onPress={() => startCall('voice')} />
            <IconButton icon="videocam" onPress={() => startCall('video')} />
            <IconButton icon="download" onPress={downloadChat} />
          </View>
          <View style={styles.chatTools}>
            <TextInput style={styles.searchInput} placeholder="Search messages" placeholderTextColor="#899486" value={search} onChangeText={setSearch} onSubmitEditing={refreshMessages} />
            <IconButton icon="search" onPress={refreshMessages} />
            <IconButton icon={pinnedOnly ? 'pin' : 'pin-outline'} onPress={() => setPinnedOnly(prev => !prev)} />
          </View>
          {pinnedMessage ? <Pressable style={styles.pinnedBar} onPress={() => setPinnedOnly(true)}><Ionicons name="pin" size={15} color="#E6C07A" /><Text style={styles.pinnedText} numberOfLines={1}>Pinned message: {pinnedMessage.body || pinnedMessage.attachmentUrl}</Text></Pressable> : null}
          <ScrollView ref={messageScrollRef} contentContainerStyle={styles.messageList} keyboardShouldPersistTaps="handled" onContentSizeChange={() => messageScrollRef.current?.scrollToEnd({ animated: true })}>
            {messages.length === 0 ? <EmptyState title="No messages" body="Send the first message, emoji, sticker, GIF, or image." /> : messages.map(message => {
              const author = selected.participants.find(p => p.id === message.senderId) || user;
              const topBadge = topPriorityBadge(author.badges);
              return (
              <Pressable key={message.id} onLongPress={() => Alert.alert('Message', 'Choose an action', [{ text: message.pinned ? 'Unpin' : 'Pin', onPress: () => pin(message) }, ...(message.senderId === user.id ? [{ text: 'Delete', style: 'destructive' as const, onPress: () => remove(message) }] : []), { text: 'Cancel', style: 'cancel' }])} style={[styles.messageRow, message.senderId === user.id && styles.messageOwn]}>
                <Pressable style={styles.messageAuthor} onPress={() => setProfileUser(author)}><UserAvatar user={author} size={28} /><Text style={styles.messageName}>{author.displayName}</Text>{topBadge ? <BadgeIcon badge={topBadge} /> : null}<Text style={styles.messageTimeInline}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>{message.pinned ? <Ionicons name="pin" size={11} color="#E6C07A" /> : null}{message.isEdited ? <Text style={styles.editedTag}>edited</Text> : null}</Pressable>
                <View style={[styles.messageBubble, message.senderId === user.id && styles.messageBubbleOwn]}>
                  {(message.type === 'gif' || message.type === 'image') && message.attachmentUrl ? <Image source={{ uri: message.attachmentUrl }} style={styles.chatImage} resizeMode="cover" /> : null}
                  {message.body ? <RichText text={message.body} /> : null}
                </View>
                <View style={styles.messageActions}><Pressable onPress={() => copyMessage(message)}><Ionicons name="copy" size={14} color="#AEB8A5" /></Pressable>{message.senderId === user.id && <Pressable onPress={() => editMessage(message)}><Ionicons name="pencil" size={14} color="#AEB8A5" /></Pressable>}</View>
              </Pressable>
            );})}
          </ScrollView>
          {showEmoji && <View style={styles.pickerPanel}><TextInput style={styles.searchInput} placeholder="Search emoji or use your keyboard for all emoji" placeholderTextColor="#899486" value={emojiSearch} onChangeText={setEmojiSearch} /> <View style={styles.pickerRow}>{emojiChoices.map(item => <Pressable key={item} style={styles.pickerButton} onPress={() => setBody(prev => `${prev}${item}`)}><Text style={styles.emojiText}>{item}</Text></Pressable>)}</View></View>}
          {showGif && <View style={styles.pickerPanel}><TextInput style={styles.searchInput} placeholder="Search GIFs" placeholderTextColor="#899486" value={gifSearch} onChangeText={setGifSearch} /><View style={styles.gifPicker}>{gifChoices.map(item => <Pressable key={item} onPress={() => send({ type: 'gif', attachmentUrl: item, body: 'GIF' })}><Image source={{ uri: item }} style={styles.gifThumb} /></Pressable>)}</View></View>}
          <View style={styles.composer}>
            <IconButton icon="happy" onPress={() => openTray('emoji')} />
            <IconButton icon="film" onPress={() => openTray('gif')} />
            <IconButton icon="attach" onPress={() => Alert.alert('Upload', 'Choose media source', [{ text: 'Photo Library', onPress: () => pickChatImage(false) }, { text: 'Camera', onPress: () => pickChatImage(true) }, { text: 'Cancel', style: 'cancel' }])} />
            <TextInput style={styles.composerInput} placeholder="Message" placeholderTextColor="#899486" value={body} onChangeText={setBody} multiline />
            <IconButton icon="send" onPress={() => send()} />
          </View>
          <ProfileSheet user={profileUser} currentUser={user} reportReason={reportReason} reportProof={reportProof} setReportReason={setReportReason} setReportProof={setReportProof} onClose={() => setProfileUser(null)} onMute={dmAction} onReport={submitReport} />
        </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function ProfileScreen({ user, setUser, notify }: { user: User; setUser: (user: User) => void; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const theme = profileThemes[user.profileTheme || 'terria'];

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <GlassCard style={[styles.profileHero, { borderColor: theme.color, backgroundColor: `${theme.color}22` }]}>
        {user.bannerUrl ? <Image source={{ uri: user.bannerUrl }} style={styles.profileBannerImage} resizeMode="cover" /> : <View style={[styles.profileBanner, { backgroundColor: user.profileColor || theme.color }]} />}
        <View>
          <Image source={user.avatarUrl ? { uri: user.avatarUrl } : logo} style={styles.profileLogo} />
          <View style={[styles.statusDot, { backgroundColor: presenceMeta[user.presence].color }]} />
        </View>
        <Text style={styles.profileName}>{user.displayName}</Text>
        <Text style={styles.muted}>@{user.tag || user.username}</Text>
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
  const [username, setUsername] = useState(user.username);
  const [discriminator, setDiscriminator] = useState(user.discriminator);
  const [mobile, setMobile] = useState(user.mobile || '');
  const [alternateEmail, setAlternateEmail] = useState(user.alternateEmail || '');
  const [bio, setBio] = useState(user.bio);
  const [pronouns, setPronouns] = useState(user.pronouns || '');
  const [customStatus, setCustomStatus] = useState(user.customStatus || '');
  const [profileColor, setProfileColor] = useState(user.profileColor || '#58764A');
  const [profileTheme, setProfileTheme] = useState<NonNullable<User['profileTheme']>>(user.profileTheme || 'terria');
  const [presence, setPresence] = useState<User['presence']>(user.presence);
  const [avatarUri, setAvatarUri] = useState(user.avatarUrl || '');
  const [bannerUri, setBannerUri] = useState(user.bannerUrl || '');
  const [busy, setBusy] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  useEffect(() => {
    if (visible) {
      setDisplayName(user.displayName);
      setUsername(user.username);
      setDiscriminator(user.discriminator);
      setMobile(user.mobile || '');
      setAlternateEmail(user.alternateEmail || '');
      setBio(user.bio);
      setPronouns(user.pronouns || '');
      setCustomStatus(user.customStatus || '');
      setProfileColor(user.profileColor || '#58764A');
      setProfileTheme(user.profileTheme || 'terria');
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
      await api.updateProfile({ 
        displayName: displayName.trim(), 
        bio: bio || undefined, 
        pronouns: pronouns || undefined, 
        customStatus: customStatus || undefined, 
        profileColor, 
        profileTheme,
        presence, 
        avatarUrl: avatarUri || undefined, 
        bannerUrl: bannerUri || undefined 
      });
      const updated = await api.updateAccount({
        username: username.trim(),
        discriminator: discriminator.trim(),
        mobile,
        alternateEmail
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
            <Text style={styles.muted}>GIF avatars and banners can be saved by VIP accounts.</Text>
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
            <Field icon="at" placeholder="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
            <Field icon="keypad" placeholder="5-digit # (VIP required)" value={discriminator} onChangeText={setDiscriminator} keyboardType="number-pad" maxLength={5} />
            <Field icon="call" placeholder="Mobile number" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
            <Field icon="mail" placeholder="Alternate email" value={alternateEmail} onChangeText={setAlternateEmail} autoCapitalize="none" keyboardType="email-address" />
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
            <Text style={styles.label}>Profile Theme</Text>
            <View style={styles.segment}>
              {(Object.keys(profileThemes) as Array<NonNullable<User['profileTheme']>>).map(item => (
                <Pressable key={item} style={[styles.segmentItem, profileTheme === item && styles.segmentActive]} onPress={() => setProfileTheme(item)}>
                  <Text style={styles.segmentText}>{profileThemes[item].label}</Text>
                </Pressable>
              ))}
            </View>
          </GlassCard>
          
          <GlassCard>
            <Text style={styles.label}>Profile Color</Text>
            <Text style={styles.muted}>Choose a color theme for your profile.</Text>
            <ColorPicker value={profileColor} onChange={setProfileColor} />
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
  const [panel, setPanel] = useState<'account' | 'privacy' | 'devices' | 'appearance' | 'language' | 'voice' | 'security' | null>(null);
  const [twoFactor, setTwoFactor] = useState<{ secret: string; qrUrl: string } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  
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

  async function toggleBiometrics() {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!compatible || !enrolled) return notify('error', 'No enrolled biometric method found on this device.');
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: biometricEnabled ? 'Disable biometric login' : 'Enable biometric login' });
    if (!result.success) return notify('error', 'Biometric check failed.');
    setBiometricEnabled(prev => !prev);
    notify('success', biometricEnabled ? 'Biometric login disabled.' : 'Biometric login enabled on this device.');
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
              <Text style={[styles.muted, { marginTop: 8 }]}>Choose who can start DMs with you.</Text>
              <View style={styles.segment}>{(['everyone', 'friends', 'none'] as const).map(item => <Pressable key={item} style={[styles.segmentItem, (user.privacy?.dmPolicy || 'friends') === item && styles.segmentActive]} onPress={() => api.updatePrivacy({ dmPolicy: item, profileLinks: user.privacy?.profileLinks !== false }).then(next => { setUser(next); notify('success', 'Privacy updated.'); }).catch(error => notify('error', error.message))}><Text style={styles.segmentText}>{item}</Text></Pressable>)}</View>
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Profile Links</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Allow clickable links in your bio.</Text>
              <PrimaryButton label={user.privacy?.profileLinks === false ? 'Enable Links' : 'Disable Links'} icon="link" onPress={() => api.updatePrivacy({ dmPolicy: user.privacy?.dmPolicy || 'friends', profileLinks: user.privacy?.profileLinks === false }).then(next => { setUser(next); notify('success', 'Profile links updated.'); }).catch(error => notify('error', error.message))} />
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Tickets & Reports</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Track support tickets, reports, and account recovery requests.</Text>
              <PrimaryButton label="Open Ticket Center" icon="ticket" onPress={() => setTab('tickets')} />
            </GlassCard>
          </>
        )}

        {panel === 'security' && (
          <>
            <GlassCard>
              <Text style={styles.cardTitle}>Two-Factor Authentication</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>{user.twoFactorEnabled ? 'Authenticator login protection is enabled.' : 'Add authenticator protection to your account.'}</Text>
              {!user.twoFactorEnabled && !twoFactor && <PrimaryButton label="Setup 2FA" icon="qr-code" onPress={() => api.setup2fa().then(setTwoFactor).catch(error => notify('error', error.message))} />}
              {twoFactor && <><Image source={{ uri: twoFactor.qrUrl }} style={styles.qrImage} /><Text style={styles.muted}>Secret: {twoFactor.secret}</Text><Field icon="keypad" placeholder="6-digit code" value={twoFactorCode} onChangeText={setTwoFactorCode} keyboardType="number-pad" /><PrimaryButton label="Verify 2FA" icon="shield-checkmark" onPress={() => api.verify2fa(twoFactorCode).then(next => { setUser(next); setTwoFactor(null); setTwoFactorCode(''); notify('success', '2FA enabled.'); }).catch(error => notify('error', error.message))} /></>}
              {user.twoFactorEnabled && <><Field icon="keypad" placeholder="Authenticator code" value={twoFactorCode} onChangeText={setTwoFactorCode} keyboardType="number-pad" /><PrimaryButton label="Disable 2FA" icon="shield" onPress={() => api.disable2fa(twoFactorCode).then(next => { setUser(next); setTwoFactorCode(''); notify('success', '2FA disabled.'); }).catch(error => notify('error', error.message))} /></>}
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Biometric Login</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Use your phone's face or fingerprint lock for faster sign in.</Text>
              <PrimaryButton label={biometricEnabled ? 'Disable Biometrics' : 'Enable Biometrics'} icon="finger-print" onPress={toggleBiometrics} />
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
                  <Text style={styles.cardTitle}>{Device.deviceName || 'This Device'}</Text>
                  <Text style={styles.muted}>{Device.modelName || 'Mobile'} · {Platform.OS}</Text>
                  <Text style={styles.muted}>IP {user.lastIp || 'Unavailable'}</Text>
                  <Text style={styles.muted}>Last login {user.activeAt ? new Date(user.activeAt).toLocaleString() : 'Active now'}</Text>
                </View>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>Active</Text>
                </View>
              </View>
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Session Management</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Review this phone, login time, and session safety from your account.</Text>
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
              <Text style={[styles.muted, { marginTop: 8 }]}>{profileThemes[user.profileTheme || 'terria'].label}</Text>
              <View style={styles.segment}>{(Object.keys(profileThemes) as Array<NonNullable<User['profileTheme']>>).map(item => <Pressable key={item} style={[styles.segmentItem, (user.profileTheme || 'terria') === item && styles.segmentActive]} onPress={() => api.updateProfile({ profileTheme: item }).then(next => { setUser(next); notify('success', 'Appearance updated.'); }).catch(error => notify('error', error.message))}><Text style={styles.segmentText}>{profileThemes[item].label}</Text></Pressable>)}</View>
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Accent Color</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Pick your app/profile color from the RGB grid.</Text>
              <ColorPicker value={user.profileColor} onChange={(color) => api.updateProfile({ profileColor: color }).then(next => { setUser(next); notify('success', 'Color updated.'); }).catch(error => notify('error', error.message))} />
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Density</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Tune spacing for compact lists, regular use, or larger touch targets.</Text>
              <DensityPreview />
            </GlassCard>
          </>
        )}

        {panel === 'language' && (
          <GlassCard>
            <Text style={styles.cardTitle}>Languages</Text>
            <Text style={[styles.muted, { marginTop: 8 }]}>Choose your language preference. The app stores this now so translated copy can roll out cleanly across every screen.</Text>
            <View style={styles.colorPicker}>
              {languages.map(([code, label]) => (
                <Pressable key={code} style={[styles.languageChip, (user.language || 'en') === code && styles.segmentActive]} onPress={() => api.updateProfile({ language: code }).then(next => { setUser(next); notify('success', `Language set to ${label}.`); }).catch(error => notify('error', error.message))}>
                  <Text style={styles.segmentText}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </GlassCard>
        )}
        
        {panel === 'voice' && (
          <>
            <GlassCard>
              <Text style={styles.cardTitle}>Call Readiness</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Voice and video calls are ready to configure.</Text>
              <Text style={[styles.badge, { marginTop: 12 }]}>VPS call service ready</Text>
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
      <SettingsRow icon="lock-closed" title="Security" body="2FA, login protection, recovery" onPress={() => setPanel('security')} />
      <SettingsRow icon="phone-portrait" title="Devices" body="Active sessions and device management" onPress={() => setPanel('devices')} />
      <SettingsRow icon="color-palette" title="Appearance" body="Theme, colors, and display settings" onPress={() => setPanel('appearance')} />
      <SettingsRow icon="language" title="Languages" body="Change app language preference" onPress={() => setPanel('language')} />
      <SettingsRow icon="videocam" title="Voice & Video" body="Call settings and media permissions" onPress={() => setPanel('voice')} />
      
      {user.role === 'admin' && (
        <>
          <Text style={[styles.label, { marginTop: 20 }]}>Administration</Text>
          <PrimaryButton label="Admin Dashboard" icon="shield-checkmark" onPress={() => setTab('admin')} />
        </>
      )}
      <PrimaryButton label="Ticket Center" icon="ticket" onPress={() => setTab('tickets')} />
      {(user.role === 'staff' || user.role === 'admin') && <PrimaryButton label="Staff Dashboard" icon="briefcase" onPress={() => setTab('staff')} />}
      
      <Pressable style={styles.logout} onPress={logout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </Pressable>
    </ScrollView>
  );
}

function DensityPreview() {
  const [density, setDensity] = useState<keyof typeof densityChoices>('comfortable');
  const scale = densityChoices[density].scale;
  return (
    <View style={{ gap: 10, marginTop: 12 }}>
      <View style={styles.segment}>
        {(Object.keys(densityChoices) as Array<keyof typeof densityChoices>).map(item => (
          <Pressable key={item} style={[styles.segmentItem, density === item && styles.segmentActive]} onPress={() => setDensity(item)}>
            <Text style={styles.segmentText}>{densityChoices[item].label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={[styles.densityPreview, { padding: 12 * scale, gap: 8 * scale }]}>
        <View style={[styles.densityLine, { height: 12 * scale, width: '72%' }]} />
        <View style={[styles.densityLine, { height: 12 * scale, width: '54%' }]} />
        <View style={[styles.densityButton, { height: 34 * scale }]} />
      </View>
    </View>
  );
}

function AdminScreen({ setAnnouncement, setShowAnnouncement, setTab, notify }: { setAnnouncement: (a: Announcement | null) => void; setShowAnnouncement: (v: boolean) => void; setTab: (tab: AppTab) => void; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
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
  const [adminUser, setAdminUser] = useState('');
  const [adminNewUsername, setAdminNewUsername] = useState('');
  const [adminDisc, setAdminDisc] = useState('');
  const [adminMobile, setAdminMobile] = useState('');
  const [adminAltEmail, setAdminAltEmail] = useState('');
  const [badgeCatalog, setBadgeCatalog] = useState<BadgeDefinition[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [newBadgeName, setNewBadgeName] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState<User[]>([]);
  const [moderationTarget, setModerationTarget] = useState<User | null>(null);
  const [moderationAction, setModerationAction] = useState<'mute' | 'ban' | 'unban'>('mute');

  const load = () => Promise.all([api.adminStats(), api.adminAnnouncements(), api.blogs(), api.badgeCatalog(), api.roles()])
    .then(([nextStats, nextAnnouncements, nextBlogs, nextBadges, nextRoles]) => {
      setStats(nextStats);
      setAdminAnnouncements(nextAnnouncements);
      setAdminBlogs(nextBlogs);
      setBadgeCatalog(nextBadges);
      setRoles(nextRoles);
      if (!nextBadges.some(item => item.name === badge) && nextBadges[0]) setBadge(nextBadges[0].name);
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

  async function exportUsers() {
    await api.exportUsers()
      .then(text => shareTextFile('zevryl-users.csv', text, notify))
      .catch(error => notify('error', error.message));
  }

  async function updateAdminUser(resetUsernameLimit = false) {
    if (!adminUser.trim()) return notify('error', 'Enter a user tag or email.');
    await api.updateUser({ username: adminUser, newUsername: adminNewUsername || undefined, discriminator: adminDisc || undefined, mobile: adminMobile || undefined, alternateEmail: adminAltEmail || undefined, resetUsernameLimit })
      .then(() => notify('success', 'User updated.'))
      .catch(error => notify('error', error.message));
  }

  async function searchModerationUsers() {
    if (!userSearch.trim()) return setUserResults([]);
    await api.searchUsers(userSearch)
      .then(setUserResults)
      .catch(error => notify('error', error.message));
  }

  async function runModeration() {
    if (!moderationTarget) return notify('error', 'Select a user first.');
    await api.moderateUser({ userId: moderationTarget.id, action: moderationAction, hours: 8 })
      .then(() => notify('success', `${moderationAction} applied to ${moderationTarget.displayName}.`))
      .catch(error => notify('error', error.message));
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.heroSmall}>Admin Dashboard</Text>
      <StatsGrid values={[['Users', String(stats.users)], ['Active', String(stats.activeUsers ?? 0)], ['Reports', String(stats.reports)], ['Invites', String(stats.invites ?? 0)]]} />
      <GlassCard><Text style={styles.cardTitle}>Control Center</Text><Text style={styles.muted}>Jump into moderation tickets, export data, and manage user access from one place.</Text><View style={styles.ticketActions}><SecondaryButton label="Tickets" icon="ticket" onPress={() => setTab('tickets')} /><SecondaryButton label="Staff Queue" icon="briefcase" onPress={() => setTab('staff')} /><SecondaryButton label="Export Users" icon="download" onPress={exportUsers} /></View></GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Announcement</Text><Field icon="megaphone" placeholder="Title" value={title} onChangeText={setTitle} /><Field icon="document-text" placeholder="Message with links" value={body} onChangeText={setBody} multiline /><Field icon="image" placeholder="Image URL" value={imageUrl} onChangeText={setImageUrl} autoCapitalize="none" /><Field icon="link" placeholder="Clickable link URL" value={linkUrl} onChangeText={setLinkUrl} autoCapitalize="none" /><PrimaryButton label="Publish Announcement" icon="send" onPress={broadcast} /></GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Manage Announcements</Text><PrimaryButton label="Refresh" icon="refresh" onPress={load} /><Text style={styles.muted}>Announcements remain visible until deleted manually from this dashboard.</Text>{adminAnnouncements.length === 0 ? <Text style={styles.muted}>No announcements published.</Text> : adminAnnouncements.map(item => <View key={item.id} style={styles.manageRow}><View style={styles.flex}><Text style={styles.body}>{item.title}</Text><Text style={styles.meta}>{new Date(item.createdAt).toLocaleDateString()}</Text></View><IconButton icon="trash" onPress={() => removeAnnouncement(item.id)} /></View>)}</GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Blog Post</Text><Field icon="newspaper" placeholder="Title" value={blogTitle} onChangeText={setBlogTitle} /><Field icon="document-text" placeholder="Body with links" value={blogBody} onChangeText={setBlogBody} multiline /><Field icon="image" placeholder="Image URL" value={blogImageUrl} onChangeText={setBlogImageUrl} autoCapitalize="none" /><Field icon="link" placeholder="Clickable link URL" value={blogLinkUrl} onChangeText={setBlogLinkUrl} autoCapitalize="none" /><PrimaryButton label="Publish Blog" icon="cloud-upload" onPress={createBlog} /></GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Manage Blog Posts</Text>{adminBlogs.length === 0 ? <Text style={styles.muted}>No blog posts published.</Text> : adminBlogs.map(item => <View key={item.id} style={styles.manageRow}><View style={styles.flex}><Text style={styles.body}>{item.title}</Text><Text style={styles.meta}>{item.category || 'Update'}</Text></View><IconButton icon="trash" onPress={() => removeBlog(item.id)} /></View>)}</GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Badges</Text><Field icon="at" placeholder="Username" value={badgeUser} onChangeText={setBadgeUser} autoCapitalize="none" /><View style={styles.segment}>{badgeCatalog.map(item => <Pressable key={item.id} style={[styles.segmentItem, badge === item.name && styles.segmentActive]} onPress={() => setBadge(item.name)}><Text style={styles.segmentText}>{item.name}</Text></Pressable>)}</View><PrimaryButton label="Grant Badge" icon="ribbon" onPress={() => api.grantBadge({ username: badgeUser, badge }).then(() => notify('success', 'Badge granted.')).catch(error => notify('error', error.message))} /><Field icon="add" placeholder="Create/edit badge name" value={newBadgeName} onChangeText={setNewBadgeName} /><View style={styles.ticketActions}><SecondaryButton label="Save Badge" icon="save" onPress={() => api.createBadge({ name: newBadgeName, icon: 'ribbon', color: '#E6C07A' }).then(() => { setNewBadgeName(''); load(); }).catch(error => notify('error', error.message))} />{badgeCatalog.find(item => item.name === badge) ? <SecondaryButton label="Delete Selected" icon="trash" onPress={() => api.deleteBadge(badgeCatalog.find(item => item.name === badge)!.id).then(load).catch(error => notify('error', error.message))} /> : null}</View></GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Roles</Text><Field icon="at" placeholder="Username" value={roleUser} onChangeText={setRoleUser} autoCapitalize="none" /><View style={styles.segment}>{roles.map(item => <Pressable key={item.id} style={[styles.segmentItem, role === item.id && styles.segmentActive]} onPress={() => setRole(item.id)}><Text style={styles.segmentText}>{item.name}</Text></Pressable>)}</View><Text style={styles.muted}>{roles.find(item => item.id === role)?.permissions.join(', ')}</Text><PrimaryButton label="Update Role" icon="key" onPress={() => api.setRole({ username: roleUser, role }).then(() => notify('success', 'Role updated.')).catch(error => notify('error', error.message))} /></GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Mute / Ban Users</Text><Field icon="search" placeholder="Search users" value={userSearch} onChangeText={setUserSearch} autoCapitalize="none" /><PrimaryButton label="Search Users" icon="search" onPress={searchModerationUsers} />{userResults.map(item => <Pressable key={item.id} style={styles.memberPick} onPress={() => setModerationTarget(item)}><Text style={styles.body}>{item.displayName} @{item.tag || item.username}</Text><Ionicons name={moderationTarget?.id === item.id ? 'radio-button-on' : 'radio-button-off'} size={22} color="#CDA16A" /></Pressable>)}<View style={styles.segment}>{(['mute', 'ban', 'unban'] as const).map(item => <Pressable key={item} style={[styles.segmentItem, moderationAction === item && styles.segmentActive]} onPress={() => setModerationAction(item)}><Text style={styles.segmentText}>{item}</Text></Pressable>)}</View><PrimaryButton label="Apply Moderation" icon="hammer" onPress={runModeration} /></GlassCard>
      <GlassCard><Text style={styles.cardTitle}>User Control</Text><Field icon="at" placeholder="User tag/email" value={adminUser} onChangeText={setAdminUser} autoCapitalize="none" /><Field icon="person" placeholder="New username" value={adminNewUsername} onChangeText={setAdminNewUsername} autoCapitalize="none" /><Field icon="keypad" placeholder="New 5-digit #" value={adminDisc} onChangeText={setAdminDisc} keyboardType="number-pad" maxLength={5} /><Field icon="call" placeholder="Mobile" value={adminMobile} onChangeText={setAdminMobile} keyboardType="phone-pad" /><Field icon="mail" placeholder="Alternate email" value={adminAltEmail} onChangeText={setAdminAltEmail} autoCapitalize="none" /><PrimaryButton label="Update User" icon="save" onPress={() => updateAdminUser(false)} /><SecondaryButton label="Reset Username Limit" icon="refresh" onPress={() => updateAdminUser(true)} /></GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Exports</Text><Text style={styles.muted}>Download users as a CSV spreadsheet with profile, contact, history, and activity fields.</Text><PrimaryButton label="Download Users CSV" icon="download" onPress={exportUsers} /></GlassCard>
    </ScrollView>
  );
}

function TicketScreen({ user, notify }: { user: User; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [tickets, setTickets] = useState<Loadable<Ticket[]>>({ loading: true, data: [] });
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [ticketReply, setTicketReply] = useState('');
  const [type, setType] = useState<Ticket['type']>('support');
  const load = () => api.tickets().then(data => setTickets({ loading: false, data })).catch(error => { setTickets({ loading: false, data: [], error: error.message }); notify('error', error.message); });
  useEffect(() => { load(); }, []);
  async function create() {
    if (!subject.trim() || !body.trim()) return notify('error', 'Add a subject and message.');
    await api.createTicket({ type, subject, body })
      .then(() => { setSubject(''); setBody(''); notify('success', 'Ticket created.'); load(); })
      .catch(error => notify('error', error.message));
  }
  async function ticketAction(ticket: Ticket, action: 'close' | 'reopen') {
    await api.updateTicket(ticket.id, { action })
      .then(load)
      .catch(error => notify('error', error.message));
  }
  async function download(ticket: Ticket) {
    await api.downloadTicket(ticket.id)
      .then(text => shareTextFile(`zevryl-ticket-${ticket.id}.txt`, text, notify))
      .catch(error => notify('error', error.message));
  }
  async function reply(ticket: Ticket) {
    if (!ticketReply.trim()) return;
    await api.updateTicket(ticket.id, { note: ticketReply })
      .then(() => { setTicketReply(''); load(); })
      .catch(error => notify('error', error.message));
  }
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <SectionTitle title="Tickets & Reports" action="Refresh" onPress={load} />
      <GlassCard>
        <Text style={styles.cardTitle}>New Ticket</Text>
        <View style={styles.segment}>{(['support', 'report', 'recovery', 'bug'] as const).map(item => <Pressable key={item} style={[styles.segmentItem, type === item && styles.segmentActive]} onPress={() => setType(item)}><Text style={styles.segmentText}>{item}</Text></Pressable>)}</View>
        <Field icon="bookmark" placeholder="Subject" value={subject} onChangeText={setSubject} />
        <Field icon="document-text" placeholder="Describe what happened" value={body} onChangeText={setBody} multiline />
        <PrimaryButton label="Create Ticket" icon="send" onPress={create} />
      </GlassCard>
      {tickets.loading ? <LoadingState /> : tickets.error ? <ErrorState message={tickets.error} onRetry={load} /> : tickets.data.map(ticket => (
        <GlassCard key={ticket.id}>
          <View style={styles.postTop}><Text style={styles.cardTitle}>{ticket.subject}</Text><Text style={styles.badge}>{ticket.status}</Text></View>
          <Text style={styles.muted}>{ticket.type} · {new Date(ticket.createdAt).toLocaleDateString()}</Text>
          <View style={styles.ticketChat}><Text style={styles.messageName}>{user.displayName}</Text><Text style={styles.body}>{ticket.body}</Text>{(ticket.updates || []).map(update => <View key={`${update.at}-${update.by}`} style={styles.ticketReply}><Text style={styles.messageName}>Staff/User</Text><Text style={styles.body}>{update.note}</Text><Text style={styles.meta}>{new Date(update.at).toLocaleString()}</Text></View>)}</View>
          <Field icon="chatbubble" placeholder="Reply in ticket" value={ticketReply} onChangeText={setTicketReply} multiline />
          {ticket.proofUrl ? <Pressable onPress={() => openLink(ticket.proofUrl)}><Text style={styles.link}>Open proof</Text></Pressable> : null}
          <View style={styles.mediaActions}>
            <SecondaryButton label="Reply" icon="send" onPress={() => reply(ticket)} />
            <SecondaryButton label="Download" icon="download" onPress={() => download(ticket)} />
            {ticket.status !== 'closed' ? <SecondaryButton label="Close" icon="checkmark" onPress={() => ticketAction(ticket, 'close')} /> : <SecondaryButton label="Reopen" icon="refresh" onPress={() => ticketAction(ticket, 'reopen')} />}
          </View>
        </GlassCard>
      ))}
      {tickets.data.length === 0 && !tickets.loading && <EmptyState title="No tickets" body={`No tickets for ${user.displayName}.`} />}
    </ScrollView>
  );
}

function StaffScreen({ notify }: { notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [queue, setQueue] = useState<Loadable<{ reports: Report[]; tickets: Ticket[] }>>({ loading: true, data: { reports: [], tickets: [] } });
  const [staffNote, setStaffNote] = useState('');
  const load = () => api.reports().then(data => setQueue({ loading: false, data })).catch(error => { setQueue({ loading: false, data: { reports: [], tickets: [] }, error: error.message }); notify('error', error.message); });
  useEffect(() => { load(); }, []);
  const reports = queue.data.reports;
  const tickets = queue.data.tickets;
  async function staffAction(ticket: Ticket, action: 'claim' | 'close' | 'reopen' | 'delete' | 'ban') {
    const task = action === 'delete' ? api.deleteTicket(ticket.id) : api.updateTicket(ticket.id, { action });
    await task.then(() => { notify('success', `Ticket ${action} complete.`); load(); }).catch(error => notify('error', error.message));
  }
  async function download(ticket: Ticket) {
    await api.downloadTicket(ticket.id)
      .then(text => shareTextFile(`zevryl-ticket-${ticket.id}.txt`, text, notify))
      .catch(error => notify('error', error.message));
  }
  async function sendStaffNote(ticket: Ticket) {
    if (!staffNote.trim()) return;
    await api.updateTicket(ticket.id, { note: staffNote })
      .then(() => { setStaffNote(''); load(); })
      .catch(error => notify('error', error.message));
  }
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <SectionTitle title="Staff Dashboard" action="Refresh" onPress={load} />
      <StatsGrid values={[['Tickets', String(tickets.length)], ['Reports', String(reports.length)], ['Open', String(tickets.filter(r => r.status === 'open').length)], ['Reviewing', String(tickets.filter(r => r.status === 'reviewing').length)]]} />
      <FeatureCard title="Moderation Tools" body="Review reports, check user context, and escalate incidents to admins." icon="hammer" />
      <FeatureCard title="Safety Watch" body="Track flagged DMs, suspicious groups, and account recovery requests." icon="warning" />
      {queue.loading ? <LoadingState /> : queue.error ? <ErrorState message={queue.error} onRetry={load} /> : tickets.map(ticket => <GlassCard key={ticket.id}><View style={styles.postTop}><Text style={styles.cardTitle}>{ticket.subject}</Text><Text style={styles.badge}>{ticket.status}</Text></View><Text style={styles.muted}>{ticket.type}</Text><View style={styles.ticketChat}><Text style={styles.body}>{ticket.body}</Text>{(ticket.updates || []).map(update => <View key={`${update.at}-${update.by}`} style={styles.ticketReply}><Text style={styles.body}>{update.note}</Text><Text style={styles.meta}>{new Date(update.at).toLocaleString()}</Text></View>)}</View><Field icon="chatbubble" placeholder="Reply as staff" value={staffNote} onChangeText={setStaffNote} multiline /><View style={styles.ticketActions}><SecondaryButton label="Reply" icon="send" onPress={() => sendStaffNote(ticket)} /><SecondaryButton label="Claim" icon="hand-left" onPress={() => staffAction(ticket, 'claim')} /><SecondaryButton label="Close" icon="checkmark" onPress={() => staffAction(ticket, 'close')} /><SecondaryButton label="Reopen" icon="refresh" onPress={() => staffAction(ticket, 'reopen')} /><SecondaryButton label="Download" icon="download" onPress={() => download(ticket)} /><SecondaryButton label="Ban" icon="ban" onPress={() => staffAction(ticket, 'ban')} /><SecondaryButton label="Delete" icon="trash" onPress={() => staffAction(ticket, 'delete')} /></View></GlassCard>)}
      {tickets.length === 0 && !queue.loading && <EmptyState title="No tickets" body="The moderation queue is clear." />}
    </ScrollView>
  );
}

function Header({ user, setTab }: { user: User; setTab: (tab: AppTab) => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => setTab('home')} style={styles.headerBrand}><Image source={logo} style={styles.headerLogo} /><Text style={styles.headerTitle}>Zevryl</Text></Pressable>
      <View style={styles.headerActions}><Text style={styles.headerUser}>{user.displayName}</Text><Pressable onPress={() => setTab('profile')}><UserAvatar user={user} size={38} /></Pressable></View>
    </View>
  );
}

function BottomNav({ tab, setTab, user, bottom }: { tab: AppTab; setTab: (tab: AppTab) => void; user: User; bottom: number }) {
  const items: Array<[AppTab, keyof typeof Ionicons.glyphMap]> = [['home', 'home'], ['friends', 'people'], ['chats', 'chatbubbles'], ['groups', 'grid'], ['tickets', 'ticket'], ['settings', 'settings']];
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

function UpdateModal({ update, visible, onClose }: { update: AppUpdate | null; visible: boolean; onClose: () => void }) {
  if (!update) return null;
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.announcementModal}>
          <Text style={styles.kicker}>App Update</Text>
          <Text style={styles.heroSmall}>New Update {update.version}</Text>
          <Text style={styles.body}>{update.notes || 'Performance, UI, messaging, and stability improvements are ready.'}</Text>
          <View style={styles.modalActions}>
            {update.apkUrl ? <PrimaryButton label="Update App" icon="download" onPress={() => { openLink(update.apkUrl); void onClose(); }} /> : null}
            <SecondaryButton label={update.required ? 'Close' : 'Later'} icon="close" onPress={onClose} />
          </View>
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

function settingsPanelTitle(panel: 'account' | 'privacy' | 'devices' | 'appearance' | 'language' | 'voice' | 'security') {
  return ({ account: 'Account', privacy: 'Privacy', devices: 'Logged In Devices', appearance: 'Appearance', language: 'Languages', voice: 'Voice & Video', security: 'Security' })[panel];
}

function settingsPanelBody(panel: 'account' | 'privacy' | 'devices' | 'appearance' | 'language' | 'voice' | 'security') {
  return ({
    account: 'Manage profile details and send a recovery request for your account.',
    privacy: 'DM privacy, block controls, and report management are active. More granular toggles can be added without changing account data.',
    devices: 'Current device is signed in. Full device history will appear here once persistent sessions are enabled.',
    appearance: 'Terria is the active theme. The layout is tuned for mobile readability and raised system navigation.',
    language: 'Your language choice is saved to your account.',
    voice: 'Call and video controls are available in DMs and groups. The VPS returns secure room tokens for supported call rooms.',
    security: '2FA, login cooldowns, and recovery controls help protect your account.'
  })[panel];
}

function StatusPill({ presence }: { presence: User['presence'] }) {
  const meta = presenceMeta[presence];
  return <View style={styles.rolePill}><Ionicons name={meta.icon} size={11} color={meta.color} /><Text style={styles.roleText}>{meta.label}</Text></View>;
}

function BadgeChip({ badge }: { badge: string }) {
  const [visible, setVisible] = useState(false);
  return <><Pressable onPress={() => setVisible(true)} style={styles.badgeChip}><Ionicons name={badgeIcons[badge] || 'ribbon'} size={12} color="#E6C07A" /><Text style={styles.badgeChipText}>{badge}</Text></Pressable><BadgeToast badge={badge} visible={visible} onClose={() => setVisible(false)} /></>;
}

function BadgeIcon({ badge }: { badge: string }) {
  const [visible, setVisible] = useState(false);
  return <><Pressable onPress={() => setVisible(true)} style={styles.badgeIcon}><Ionicons name={badgeIcons[badge] || 'ribbon'} size={11} color="#E6C07A" /></Pressable><BadgeToast badge={badge} visible={visible} onClose={() => setVisible(false)} /></>;
}

function BadgeToast({ badge, visible, onClose }: { badge: string; visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return <Modal visible transparent animationType="fade"><Pressable style={styles.badgeToastBackdrop} onPress={onClose}><View style={styles.badgeToast}><Ionicons name={badgeIcons[badge] || 'ribbon'} size={24} color="#E6C07A" /><Text style={styles.cardTitle}>{badge}</Text><Text style={styles.muted}>{badge} badge</Text></View></Pressable></Modal>;
}

function UserAvatar({ user, size = 50 }: { user: User; size?: number }) {
  const radius = Math.max(9, Math.round(size * 0.24));
  return user.avatarUrl
    ? <Image source={{ uri: user.avatarUrl }} style={[styles.avatarImage, { width: size, height: size, borderRadius: radius }]} />
    : <View style={[styles.avatar, { width: size, height: size, borderRadius: radius }]}><Text style={styles.avatarText}>{user.displayName.slice(0, 1).toUpperCase()}</Text></View>;
}

function topPriorityBadge(badges: string[]) {
  return badgePriority.find(badge => badges.includes(badge)) || badges[0];
}

function normalizeBadges(badges: string[]) {
  return badges.length ? badges : ['Member'];
}

function ProfileSheet({
  user,
  currentUser,
  reportReason,
  reportProof,
  setReportReason,
  setReportProof,
  onClose,
  onMute,
  onReport
}: {
  user: User | null;
  currentUser: User;
  reportReason: string;
  reportProof: string;
  setReportReason: (value: string) => void;
  setReportProof: (value: string) => void;
  onClose: () => void;
  onMute: (action: 'mute' | 'block' | 'unfriend', hours?: number) => void;
  onReport: () => void;
}) {
  const [showReport, setShowReport] = useState(false);
  if (!user) return null;
  const own = user.id === currentUser.id;
  const theme = profileThemes[user.profileTheme || 'terria'];
  return (
    <Modal visible transparent animationType="slide">
      <View style={styles.sheetBackdrop}>
        <View style={[styles.profileSheet, { borderColor: theme.color }]}>
          <ScrollView contentContainerStyle={styles.profileSheetContent} keyboardShouldPersistTaps="handled">
            {user.bannerUrl ? <Image source={{ uri: user.bannerUrl }} style={styles.sheetBanner} resizeMode="cover" /> : <View style={[styles.sheetBanner, { backgroundColor: user.profileColor || theme.color }]} />}
            <View style={styles.sheetHeader}>
              <Image source={user.avatarUrl ? { uri: user.avatarUrl } : logo} style={styles.sheetAvatar} />
              <View style={styles.flex}>
                <Text style={styles.profileName}>{user.displayName}</Text>
                <Text style={styles.muted}>@{user.tag || user.username}</Text>
                <View style={styles.badgeRow}>{normalizeBadges(user.badges).map(badge => <BadgeChip key={badge} badge={badge} />)}</View>
              </View>
              <IconButton icon="close" onPress={onClose} />
            </View>
            <RichText text={user.bio || 'No bio yet.'} />
            {!own && (
              <>
                <View style={styles.segment}>
                  <Pressable style={styles.segmentItem} onPress={() => onMute('mute', 1)}><Text style={styles.segmentText}>Mute 1h</Text></Pressable>
                  <Pressable style={styles.segmentItem} onPress={() => onMute('mute', 24)}><Text style={styles.segmentText}>Mute 1d</Text></Pressable>
                  <Pressable style={styles.segmentItem} onPress={() => onMute('mute', 168)}><Text style={styles.segmentText}>Mute 7d</Text></Pressable>
                </View>
                <View style={styles.mediaActions}>
                  <SecondaryButton label="Unfriend" icon="person-remove" onPress={() => onMute('unfriend')} />
                  <SecondaryButton label="Block" icon="ban" onPress={() => onMute('block')} />
                </View>
                {!showReport ? <PrimaryButton label="Report User" icon="flag" onPress={() => setShowReport(true)} /> : <><Field icon="warning" placeholder="Report reason" value={reportReason} onChangeText={setReportReason} multiline /><Field icon="image" placeholder="Optional proof image URL/base64" value={reportProof} onChangeText={setReportProof} autoCapitalize="none" /><PrimaryButton label="Create Report Ticket" icon="flag" onPress={onReport} /></>}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function openLink(url?: string) {
  if (!url) return;
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  Linking.openURL(normalized).catch(() => undefined);
}

async function shareTextFile(filename: string, contents: string, notify: (tone: NoticeTone, text: string) => void) {
  const safeName = filename.replace(/[^a-z0-9_.-]/gi, '_');
  const uri = `${FileSystem.documentDirectory}${safeName}`;
  await FileSystem.writeAsStringAsync(uri, contents, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
  else notify('info', contents.slice(0, 800));
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+|www\.[^\s]+)/g);
  return <Text style={styles.body}>{parts.map((part, index) => /^(https?:\/\/|www\.)/i.test(part) ? <Text key={`${part}-${index}`} style={styles.inlineLink} onPress={() => openLink(part)}>{part}</Text> : <Text key={`${part}-${index}`}>{part}</Text>)}</Text>;
}

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return <View style={styles.colorPicker}>{colorChoices.map(color => <Pressable key={color} onPress={() => onChange(color)} style={[styles.colorSwatchButton, { backgroundColor: color }, value === color && styles.colorSwatchSelected]} />)}</View>;
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
  return <View><Text style={styles.label}>{title}</Text>{users.length === 0 ? <EmptyState title="Empty" body={empty} /> : users.map(user => <GlassCard key={user.id} style={styles.userRow}><UserAvatar user={user} /><View style={styles.flex}><Text style={styles.body}>{user.displayName}</Text><Text style={styles.muted}>@{user.tag || user.username}</Text><Text style={styles.muted}>{user.customStatus || user.presence}</Text><View style={styles.badgeRowMini}>{user.badges.slice(0, 3).map(b => <Text key={b} style={styles.badgeMini}>{b}</Text>)}</View></View>{right?.(user)}</GlassCard>)}</View>;
}

function RequestList({ title, requests, accept, deny }: { title: string; requests: FriendState['incoming']; accept?: (id: string) => void; deny?: (id: string) => void }) {
  return <View><Text style={styles.label}>{title}</Text>{requests.length === 0 ? <Text style={styles.muted}>None</Text> : requests.map(req => <GlassCard key={req.id} style={styles.userRow}><UserAvatar user={req.fromUser} /><View style={styles.flex}><Text style={styles.body}>{req.fromUser.displayName}</Text><Text style={styles.muted}>@{req.fromUser.tag || req.fromUser.username}</Text><Text style={styles.muted}>{req.status}</Text></View>{accept && <IconButton icon="checkmark" onPress={() => accept(req.id)} />}{deny && <IconButton icon="close" onPress={() => deny(req.id)} />}</GlassCard>)}</View>;
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
  avatarImage: { backgroundColor: '#33412E', borderWidth: 2, borderColor: '#7D8B58' },
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
  chatLayout: { flex: 1, paddingHorizontal: 10, paddingBottom: 96, gap: 8 },
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
  chatTools: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  searchInput: { flex: 1, minHeight: 42, color: '#F4F0E6', borderRadius: 10, backgroundColor: '#151D16', paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(218,226,202,.12)' },
  
  messagesContainer: { gap: 10, marginVertical: 14 },
  messageList: { paddingVertical: 12, gap: 10, paddingBottom: 28 },
  messageRow: { alignItems: 'flex-start' },
  messageOwn: { alignItems: 'flex-end' },
  messageBubble: { maxWidth: '92%', borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: 'rgba(30,42,33,.8)' },
  messageAuthor: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  messageName: { color: '#E6C07A', fontSize: 12, fontWeight: '800' },
  messageTimeInline: { color: '#899486', fontSize: 11, fontWeight: '700', marginLeft: 6 },
  editedTag: { color: '#899486', fontSize: 11, fontStyle: 'italic' },
  messageActions: { flexDirection: 'row', gap: 10, marginTop: -4, marginBottom: 8, paddingHorizontal: 8 },
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
  pickerPanel: { gap: 8, paddingVertical: 8 },
  pickerButton: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#202A21', alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 22 },
  gifPicker: { flexDirection: 'row', gap: 8, paddingVertical: 10 },
  gifThumb: { width: 80, height: 60, borderRadius: 10, backgroundColor: '#111712' },
  
  chatCard: { gap: 12 },
  composerContainer: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, padding: 14, borderTopWidth: 1, borderColor: 'rgba(255,255,255,.08)', backgroundColor: 'rgba(5,7,11,.92)' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingVertical: 8, paddingBottom: 10, backgroundColor: 'rgba(17,23,18,.96)' },
  composerInput: { flex: 1, minHeight: 58, maxHeight: 132, color: '#F4F0E6', borderRadius: 12, backgroundColor: '#151D16', paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, borderWidth: 1, borderColor: 'rgba(218,226,202,.12)' },
  pinnedBar: { minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(230,192,122,.28)', backgroundColor: 'rgba(230,192,122,.10)', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pinnedText: { color: '#EDE4C8', fontWeight: '800', flex: 1, fontSize: 12 },
  callActions: { flexDirection: 'row', gap: 10 },
  callCard: { gap: 12, borderColor: 'rgba(255,170,168,.15)', borderWidth: 1 },
  
  // Profile
  profileHero: { alignItems: 'center', gap: 14, paddingTop: 8, paddingVertical: 20 },
  profileBanner: { height: 132, alignSelf: 'stretch', marginHorizontal: -18, marginTop: -18, marginBottom: 12 },
  profileBannerImage: { height: 132, alignSelf: 'stretch', marginHorizontal: -18, marginTop: -18, marginBottom: 12, backgroundColor: '#111712' },
  profileAvatarLarge: { width: 96, height: 96, borderRadius: 24, backgroundColor: '#33412E', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#7D8B58' },
  profileAvatarText: { color: '#F4F0E6', fontWeight: '900', fontSize: 36 },
  profileLogo: { width: 96, height: 96, borderRadius: 20, borderWidth: 3, borderColor: '#1B241C' },
  statusDot: { position: 'absolute', width: 18, height: 18, borderRadius: 9, right: 1, bottom: 5, borderWidth: 3, borderColor: '#1B241C' },
  profileName: { color: '#F4F0E6', fontSize: 28, fontWeight: '900', letterSpacing: -0.3 },
  profileBadgeContainer: { flexDirection: 'row', gap: 10, marginTop: 8 },
  colorRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  mediaActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  ticketActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  ticketChat: { gap: 10, borderLeftWidth: 2, borderLeftColor: 'rgba(230,192,122,.24)', paddingLeft: 12, marginTop: 10 },
  ticketReply: { backgroundColor: 'rgba(255,255,255,.04)', borderRadius: 10, padding: 10, gap: 4 },
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
  badgeToastBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,.34)', padding: 24 },
  badgeToast: { minWidth: 190, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(230,192,122,.34)', backgroundColor: '#182019', padding: 20, alignItems: 'center', gap: 8 },
  
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.68)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.58)', justifyContent: 'flex-end' },
  profileSheet: { maxHeight: '82%', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, backgroundColor: '#182019', overflow: 'hidden' },
  profileSheetContent: { padding: 16, paddingBottom: 34, gap: 12 },
  sheetBanner: { height: 96, borderRadius: 12, backgroundColor: '#33412E' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetAvatar: { width: 72, height: 72, borderRadius: 18, borderWidth: 2, borderColor: '#1B241C', backgroundColor: '#111712' },
  qrImage: { width: 220, height: 220, alignSelf: 'center', borderRadius: 12, backgroundColor: '#fff', marginTop: 12 },
  announcementModal: { width: '100%', borderRadius: 12, backgroundColor: '#182019', borderWidth: 1, borderColor: 'rgba(230,192,122,.3)', padding: 20, gap: 14 },
  modalCard: { width: '100%', gap: 14, alignItems: 'center', padding: 24 },
  editorPanel: { width: '100%', borderRadius: 12, backgroundColor: '#182019', borderWidth: 1, borderColor: 'rgba(230,192,122,.28)', padding: 18, gap: 8 },
  editorPanelScroll: { paddingVertical: 12, paddingHorizontal: 16, gap: 16 },
  editorHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, height: 56 },
  editorCloseButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(230,192,122,.12)', alignItems: 'center', justifyContent: 'center' },
  bannerPreview: { width: '100%', height: 150, borderRadius: 12, marginTop: 8 },
  avatarPreview: { width: 100, height: 100, borderRadius: 50, marginTop: 8 },
  modalActions: { gap: 10 },
  
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(218,226,202,.14)', alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: 'rgba(230,192,122,.18)', borderColor: 'rgba(230,192,122,.4)' },
  segmentText: { color: '#D9E2CC', fontWeight: '800' },
  densityPreview: { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(218,226,202,.14)', backgroundColor: 'rgba(11,16,12,.55)' },
  densityLine: { borderRadius: 999, backgroundColor: 'rgba(230,192,122,.34)' },
  densityButton: { width: 120, borderRadius: 10, backgroundColor: 'rgba(230,192,122,.18)', borderWidth: 1, borderColor: 'rgba(230,192,122,.34)' },
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
  colorPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  languageChip: { minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(218,226,202,.14)', paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.04)' },
  colorSwatchButton: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,.18)' },
  colorSwatchSelected: { borderColor: '#F4F0E6', borderWidth: 3 },
  
  videoGrid: { minHeight: 240, gap: 10, borderRadius: 18, overflow: 'hidden', backgroundColor: '#05070B', alignItems: 'center', justifyContent: 'center' },
  videoTile: { width: '100%', height: 240, borderRadius: 18 }
});
