import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { AudioSession, isTrackReference, LiveKitRoom, registerGlobals, useTracks, VideoTrack } from '@livekit/react-native';
import * as Device from 'expo-device';
import * as DocumentPicker from 'expo-document-picker';
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
  AppState,
  BackHandler,
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
  Vibration,
  View
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Track } from 'livekit-client';
import { api, clearTokens, setTokens } from './api';
import type {
  Announcement,
  AdminAnalytics,
  AlertFlag,
  AppTab,
  AppUpdate,
  AuditLog,
  BadgeDefinition,
  BlogPost,
  Conversation,
  DashboardStats,
  DeviceSession,
  FriendState,
  GifResult,
  Group,
  Message,
  Report,
  RoleDefinition,
  StaffAnalytics,
  Ticket,
  User,
  UserPage
} from './types';

const logo = require('../assets/zevryl-logo.png');
const wordmark = require('../assets/zevryl-wordmark.png');
const bootCacheKey = 'zevryl.boot.cache.v1';
const bootCacheFile = `${FileSystem.documentDirectory || ''}zevryl-boot-cache.json`;
const bootCacheMaxAgeMs = 1000 * 60 * 60 * 24 * 7;
const autoLoginKey = 'zevryl.security.autoLogin';
const biometricLoginKey = 'zevryl.security.biometricLogin';
const maxDocumentBytes = 500 * 1024 * 1024;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

try {
  registerGlobals();
} catch {
  // LiveKit globals can already be registered during fast refresh.
}

type Loadable<T> = { loading: boolean; data: T; error?: string };
type NoticeTone = 'error' | 'success' | 'info';
type Notice = { tone: NoticeTone; text: string } | null;
type BootCache = { user: User | null; announcement: Announcement | null; savedAt: number };
type CallState = { kind: 'voice' | 'video'; roomName: string; url?: string; token?: string; joined: boolean; muted: boolean; deafened: boolean; videoEnabled: boolean; cameraFacing: 'front' | 'back' };

function recoveryDeliveryMessage(result: unknown) {
  const delivery = typeof result === 'object' && result ? (result as { delivery?: string }).delivery : undefined;
  return delivery === 'ticket'
    ? 'Recovery request created for staff review.'
    : 'Recovery email sent to your inbox.';
}

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
  Partner: 'people'
};
const presenceMeta: Record<User['presence'], { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  online: { label: 'Online', icon: 'ellipse', color: '#4FCC7A' },
  dnd: { label: 'Do Not Disturb', icon: 'remove-circle', color: '#E15E55' },
  idle: { label: 'Idle', icon: 'moon', color: '#D9A441' },
  invisible: { label: 'Invisible', icon: 'ellipse-outline', color: '#8D9688' },
  offline: { label: 'Offline', icon: 'ellipse-outline', color: '#8D9688' }
};
const badgePriority = ['Founder', 'Admin', 'Mod', 'Staff', 'Vip', 'Partner', 'Member'];
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

async function readBootCache() {
  const raw = await FileSystem.readAsStringAsync(bootCacheFile).catch(() => SecureStore.getItemAsync(bootCacheKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BootCache;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > bootCacheMaxAgeMs) return null;
    return parsed;
  } catch {
    await SecureStore.deleteItemAsync(bootCacheKey).catch(() => undefined);
    return null;
  }
}

async function writeBootCache(user: User | null, announcement: Announcement | null) {
  if (!user) {
    await FileSystem.deleteAsync(bootCacheFile, { idempotent: true }).catch(() => undefined);
    await SecureStore.deleteItemAsync(bootCacheKey).catch(() => undefined);
    return;
  }
  const cache: BootCache = { user, announcement, savedAt: Date.now() };
  await FileSystem.writeAsStringAsync(bootCacheFile, JSON.stringify(cache)).catch(() => undefined);
  await SecureStore.deleteItemAsync(bootCacheKey).catch(() => undefined);
}

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
const languages = [
  ['en', 'English'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['te', 'Telugu'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'],
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['ar', 'Arabic'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['id', 'Indonesian'], ['tr', 'Turkish'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['nl', 'Dutch'], ['pl', 'Polish'], ['uk', 'Ukrainian'], ['ur', 'Urdu'], ['fa', 'Persian'], ['sw', 'Swahili']
] as const;

const copy = {
  en: {
    welcome: 'Welcome back',
    homeSub: 'Messages, groups, tickets, and official updates in one clean workspace.',
    updates: 'Updates',
    support: 'Support',
    supportCenter: 'Support Center',
    openTickets: 'Open Tickets',
    reportBug: 'Report a Bug',
    sendTicket: 'Send Support Ticket',
    announcements: 'Announcements',
    posts: 'Posts',
    noAnnouncements: 'No announcements',
    noPosts: 'No posts yet',
    settings: 'Settings',
    languages: 'Languages',
    appearance: 'Appearance',
    staffDashboard: 'Staff Dashboard',
    adminDashboard: 'Admin Dashboard',
    ticketCenter: 'Ticket Center',
    refresh: 'Refresh',
    save: 'Save',
    cancel: 'Cancel',
    search: 'Search',
    users: 'Users',
    badges: 'Badges',
    roles: 'Roles',
    moderation: 'Moderation',
    analytics: 'Analytics',
    logs: 'Logs'
  },
  hi: {
    welcome: 'वापस स्वागत है',
    updates: 'अपडेट',
    support: 'सहायता',
    supportCenter: 'सहायता केंद्र',
    openTickets: 'टिकट खोलें',
    reportBug: 'बग रिपोर्ट करें',
    sendTicket: 'सहायता टिकट भेजें',
    announcements: 'घोषणाएं',
    posts: 'पोस्ट',
    settings: 'सेटिंग्स',
    languages: 'भाषाएं',
    appearance: 'दिखावट',
    staffDashboard: 'स्टाफ डैशबोर्ड',
    adminDashboard: 'एडमिन डैशबोर्ड',
    ticketCenter: 'टिकट केंद्र',
    refresh: 'रीफ्रेश',
    save: 'सेव',
    cancel: 'रद्द करें',
    search: 'खोजें',
    users: 'यूजर',
    badges: 'बैज',
    roles: 'रोल',
    moderation: 'मॉडरेशन',
    analytics: 'एनालिटिक्स',
    logs: 'लॉग'
  },
  es: {
    welcome: 'Bienvenido de nuevo',
    updates: 'Actualizaciones',
    support: 'Soporte',
    supportCenter: 'Centro de soporte',
    openTickets: 'Abrir tickets',
    reportBug: 'Reportar error',
    sendTicket: 'Enviar ticket',
    announcements: 'Anuncios',
    posts: 'Publicaciones',
    settings: 'Ajustes',
    languages: 'Idiomas',
    appearance: 'Apariencia',
    staffDashboard: 'Panel de staff',
    adminDashboard: 'Panel admin',
    ticketCenter: 'Centro de tickets',
    refresh: 'Actualizar',
    save: 'Guardar',
    cancel: 'Cancelar',
    search: 'Buscar',
    users: 'Usuarios',
    badges: 'Insignias',
    roles: 'Roles',
    moderation: 'Moderación',
    analytics: 'Analíticas',
    logs: 'Registros'
  }
} as const;

function t(language: string | undefined, key: keyof typeof copy.en) {
  const short = (language || 'en').split('-')[0] as keyof typeof copy;
  const catalog = short === 'es' ? copy.es : copy.en;
  return (catalog as Partial<typeof copy.en>)[key] || copy.en[key];
}

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
  const [pendingCallRoomName, setPendingCallRoomName] = useState<string | undefined>();
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const insets = useSafeAreaInsets();

  const showNotice = (tone: NoticeTone, text: string) => {
    setNotice({ tone, text });
    setTimeout(() => setNotice(current => (current?.text === text ? null : current)), 5200);
  };

  useEffect(() => {
    let mounted = true;
    async function boot() {
      const autoLogin = await SecureStore.getItemAsync(autoLoginKey).catch(() => null);
      if (autoLogin === '0') {
        if (mounted) {
          setUser(null);
          setBooting(false);
        }
        return;
      }
      const hasToken = await SecureStore.getItemAsync('zevryl.accessToken').catch(() => null);
      const biometricLogin = await SecureStore.getItemAsync(biometricLoginKey).catch(() => null);
      if (hasToken && biometricLogin === '1') {
        const compatible = await LocalAuthentication.hasHardwareAsync().catch(() => false);
        const enrolled = await LocalAuthentication.isEnrolledAsync().catch(() => false);
        if (!compatible || !enrolled) {
          await SecureStore.deleteItemAsync(biometricLoginKey).catch(() => undefined);
        } else {
          const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Zevryl' }).catch(() => ({ success: false }));
          if (!result.success) {
            if (mounted) {
              setUser(null);
              setBooting(false);
            }
            return;
          }
        }
      }
      if (hasToken) {
        const cached = await readBootCache();
        if (mounted && cached?.user) {
          setUser(cached.user);
          setAnnouncement(cached.announcement);
          setShowAnnouncement(Boolean(cached.announcement?.isPopup && !cached.announcement.readAt));
          setBooting(false);
        }
      }

      try {
        const [me, latest] = await Promise.all([api.me(), api.latestAnnouncement()]);
        if (!mounted) return;
        setUser(me);
        setAnnouncement(latest);
        setShowAnnouncement(Boolean(latest?.isPopup && !latest.readAt));
      } catch {
        if (!hasToken && mounted) setUser(null);
      } finally {
        if (mounted) setTimeout(() => setBooting(false), 350);
      }
    }
    boot();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    writeBootCache(user, announcement);
  }, [user, announcement]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (chatFullscreen) return false;
      if (tab !== 'home') {
        setTab('home');
        return true;
      }
      return true;
    });
    return () => subscription.remove();
  }, [tab, chatFullscreen]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' || !user) return;
      api.me().then(setUser).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [user?.id]);

  useEffect(() => {
    Notifications.setNotificationCategoryAsync('active-call', [
      { identifier: 'mute-call', buttonTitle: 'Mute', options: { opensAppToForeground: false } },
      { identifier: 'deafen-call', buttonTitle: 'Deafen', options: { opensAppToForeground: false } },
      { identifier: 'leave-call', buttonTitle: 'Leave', options: { opensAppToForeground: false, isDestructive: true } }
    ]).catch(() => undefined);
    Notifications.setNotificationCategoryAsync('incoming-call', [
      { identifier: 'join-incoming-call', buttonTitle: 'Join Call', options: { opensAppToForeground: true } },
      { identifier: 'mute-incoming-call', buttonTitle: 'Mute Call', options: { opensAppToForeground: false } }
    ]).catch(() => undefined);
  }, []);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(notification => {
      if (notification.request.content.data?.kind === 'incoming-call') {
        Vibration.vibrate([0, 900, 350, 900, 350], true);
        setTimeout(() => Vibration.cancel(), 30000);
      }
    });
    return () => received.remove();
  }, []);

  useEffect(() => {
    api.latestUpdate()
      .then(update => {
        if (!update?.version || update.version === '1.0.0') return;
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
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('default', {
        name: 'Zevryl',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#E6C07A'
      }).catch(() => undefined);
      Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 180, 120, 180],
        lightColor: '#E6C07A'
      }).catch(() => undefined);
    }
    const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
    Notifications.requestPermissionsAsync()
      .then((result: any) => result.granted || result.status === 'granted' ? Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined) : null)
      .then(tokenResult => tokenResult?.data ? api.registerPushToken(tokenResult.data, Platform.OS) : null)
      .catch(() => undefined);
  }, [user?.id]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      if (response.actionIdentifier === 'mute-incoming-call') {
        Vibration.cancel();
        return;
      }
      const conversationId = response.notification.request.content.data?.conversationId;
      const roomName = response.notification.request.content.data?.roomName;
      if (typeof conversationId === 'string') {
        Vibration.cancel();
        setPendingConversationId(conversationId);
        if (response.actionIdentifier === 'join-incoming-call' && typeof roomName === 'string') setPendingCallRoomName(roomName);
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
    <TerraShell theme={user.profileTheme} accent={user.profileColor}>
      <SafeAreaView style={styles.app}>
        {!chatFullscreen ? <Header user={user} setTab={setTab} /> : null}
        <View style={styles.content}>
          {renderTab(tab, user, {
            setUser,
            setAnnouncement,
            setShowAnnouncement,
            setTab,
            notify: showNotice,
            setPendingConversationId,
            pendingConversationId,
            pendingCallRoomName,
            setPendingCallRoomName,
            setChatFullscreen
          })}
        </View>
        <NoticeFooter notice={notice} bottom={insets.bottom + 94} />
        {!chatFullscreen ? <BottomNav tab={tab} setTab={setTab} bottom={Math.max(insets.bottom + 18, 34)} /> : null}
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
    setPendingConversationId: (id: string | undefined) => void;
    pendingConversationId?: string;
    pendingCallRoomName?: string;
    setPendingCallRoomName: (roomName: string | undefined) => void;
    setChatFullscreen: (value: boolean) => void;
  }
) {
  if (tab === 'admin' && user.role !== 'admin') return <LockedScreen title="Admin only" />;
  if (tab === 'staff' && user.role !== 'staff' && user.role !== 'admin') return <LockedScreen title="Staff only" />;
  if (tab === 'home') return <HomeScreen user={user} notify={tools.notify} setTab={tools.setTab} />;
  if (tab === 'friends') return <FriendsScreen notify={tools.notify} setTab={tools.setTab} />;
  if (tab === 'groups') return <GroupsScreen user={user} notify={tools.notify} setTab={tools.setTab} openConversation={tools.setPendingConversationId} />;
  if (tab === 'chats') return <ChatScreen user={user} notify={tools.notify} initialConversationId={tools.pendingConversationId} initialCallRoomName={tools.pendingCallRoomName} clearPendingCallRoomName={() => tools.setPendingCallRoomName(undefined)} setFullscreen={tools.setChatFullscreen} />;
  if (tab === 'profile') return <ProfileScreen user={user} setUser={tools.setUser} notify={tools.notify} />;
  if (tab === 'settings') return <SettingsScreen user={user} setTab={tools.setTab} setUser={tools.setUser} notify={tools.notify} />;
  if (tab === 'tickets') return <TicketCenterScreen user={user} notify={tools.notify} />;
  if (tab === 'admin') return <AdminScreen setAnnouncement={tools.setAnnouncement} setShowAnnouncement={tools.setShowAnnouncement} setTab={tools.setTab} notify={tools.notify} />;
  if (tab === 'staff') return <StaffScreen user={user} notify={tools.notify} />;
  return null;
}

function TerraShell({ children, theme = 'terria', accent }: { children: React.ReactNode; theme?: User['profileTheme']; accent?: string }) {
  const colors = profileThemes[theme || 'terria'].colors;
  return (
    <LinearGradient colors={colors} style={styles.shell}>
      <View style={[styles.terraBandTop, accent ? { backgroundColor: `${accent}24` } : null]} />
      <View style={[styles.terraBandBottom, accent ? { backgroundColor: `${accent}18` } : null]} />
      {children}
    </LinearGradient>
  );
}

function SplashScreen() {
  return (
    <TerraShell>
      <SafeAreaView style={styles.splash}>
        <View style={styles.splashContent}>
          <View style={styles.splashLogoFrame}>
            <Image source={logo} style={styles.splashLogo} resizeMode="contain" />
          </View>
          <Image source={wordmark} style={styles.splashWordmark} resizeMode="contain" />
          <Text style={styles.brandTitle}>Zevryl</Text>
          <Text style={styles.brandSub}>PRIVATE CHAT NETWORK</Text>
          <Text style={styles.splashTagline}>Connect privately, chat freely</Text>
        </View>
        <View style={styles.splashFooter}>
          <View style={styles.loadingBar}>
            <View style={styles.loadingFill} />
          </View>
          <Text style={styles.loadingText}>Opening your session...</Text>
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
      .then(result => notify('success', recoveryDeliveryMessage(result)))
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
          <Text style={styles.hero}>{t(user.language, 'welcome')}</Text>
          <Text style={styles.heroSub}>{t(user.language, 'homeSub')}</Text>
        </View>
        <StatusPill presence={user.presence} />
      </View>
      <View style={styles.segment}>
        <Pressable style={[styles.segmentItem, view === 'updates' && styles.segmentActive]} onPress={() => setView('updates')}><Text style={styles.segmentText}>{t(user.language, 'updates')}</Text></Pressable>
        <Pressable style={[styles.segmentItem, view === 'support' && styles.segmentActive]} onPress={() => setView('support')}><Text style={styles.segmentText}>{t(user.language, 'support')}</Text></Pressable>
      </View>
      {view === 'support' ? (
        <>
          <GlassCard>
            <Text style={styles.cardTitle}>{t(user.language, 'supportCenter')}</Text>
            <Text style={styles.muted}>Get help with your account, messages, groups, calls, reports, or app bugs.</Text>
            <View style={styles.ticketActions}>
              <SecondaryButton label={t(user.language, 'openTickets')} icon="ticket" onPress={() => setTab('tickets')} />
              <SecondaryButton label={t(user.language, 'reportBug')} icon="bug" onPress={() => setSupportMessage('I found a bug: ')} />
            </View>
          </GlassCard>
          <GlassCard>
            <Text style={styles.cardTitle}>Quick Help</Text>
            <Field icon="chatbubble" placeholder="Tell support what happened" value={supportMessage} onChangeText={setSupportMessage} multiline />
            <PrimaryButton label={t(user.language, 'sendTicket')} icon="send" onPress={() => {
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
          <SectionTitle title={t(user.language, 'announcements')} action={t(user.language, 'refresh')} onPress={load} />
          {announcements.loading ? <LoadingState /> : announcements.error ? <ErrorState message={announcements.error} onRetry={load} /> : announcements.data.length === 0 ? <EmptyState title="No announcements" body="Official updates will appear here." /> : announcements.data.map(item => (
            <AnnouncementCard key={item.id} item={item} />
          ))}
          <SectionTitle title={t(user.language, 'posts')} />
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
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [profileCanUnfriend, setProfileCanUnfriend] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportProof, setReportProof] = useState('');

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

  async function friendControl(friend: User, control: 'mute' | 'unmute' | 'block', hours?: number) {
    await api.friendAction(friend.id, control, { hours })
      .then(() => notify('success', control === 'block' ? 'Friend blocked.' : control === 'mute' ? 'Friend muted.' : 'Friend unmuted.'))
      .catch(error => notify('error', error.message));
    load();
  }

  async function messageUser(target: User) {
    await api.createDm(target.id)
      .then(() => { setProfileUser(null); notify('success', `DM ready with ${target.displayName}.`); setTab('chats'); })
      .catch(error => notify('error', error.message));
  }

  async function reportUser() {
    if (!profileUser) return;
    if (!reportReason.trim()) return notify('error', 'Add a report reason.');
    await api.createTicket({ type: 'report', subject: `Report ${profileUser.tag || profileUser.username}`, body: reportReason, proofUrl: reportProof || undefined, targetUserId: profileUser.id })
      .then(() => { notify('success', 'Report ticket created.'); setReportReason(''); setReportProof(''); setProfileUser(null); })
      .catch(error => notify('error', error.message));
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
          <IconButton icon="person-circle" onPress={() => { setProfileCanUnfriend(true); setProfileUser(friend); }} />
          <IconButton icon="chatbubble" onPress={() => messageUser(friend)} />
          <IconButton icon="notifications-off" onPress={() => friendControl(friend, 'mute')} />
          <IconButton icon="volume-high" onPress={() => friendControl(friend, 'unmute')} />
          <IconButton icon="ban" onPress={() => friendControl(friend, 'block')} />
          <IconButton icon="close" onPress={() => confirmRemove(friend)} />
        </View>
      )} />
      <RequestList title="Incoming Requests" requests={state.data.incoming} person="from" onProfile={(target) => { setProfileCanUnfriend(false); setProfileUser(target); }} accept={id => action(api.acceptFriend(id), 'Request accepted.')} deny={id => action(api.denyFriend(id), 'Request denied.')} />
      <RequestList title="Outgoing Requests" requests={state.data.outgoing} person="to" onProfile={(target) => { setProfileCanUnfriend(false); setProfileUser(target); }} cancel={id => action(api.cancelFriendRequest(id), 'Request canceled.')} />
      <UserList title="Blocked Users" users={state.data.blocked} empty="Blocked users will appear here." right={(blocked) => (
        <View style={styles.rowActions}>
          <IconButton icon="person-circle" onPress={() => { setProfileCanUnfriend(false); setProfileUser(blocked); }} />
          <IconButton icon="lock-open" onPress={() => action(api.unblockFriend(blocked.id), 'User unblocked.')} />
        </View>
      )} />
      <ProfileSheet
        user={profileUser}
        reportReason={reportReason}
        reportProof={reportProof}
        setReportReason={setReportReason}
        setReportProof={setReportProof}
        onClose={() => setProfileUser(null)}
        onMessage={messageUser}
        canUnfriend={profileCanUnfriend}
        onMute={(control, hours) => {
          if (!profileUser) return;
          if (control === 'block') void friendControl(profileUser, 'block');
          else if (control === 'unfriend') void action(api.removeFriend(profileUser.id), 'Friend removed.');
          else void friendControl(profileUser, 'mute', hours);
        }}
        onReport={reportUser}
      />
    </ScrollView>
  );
}

function GroupsScreen({ user, notify, setTab, openConversation }: { user: User; notify: (tone: 'error' | 'success' | 'info', text: string) => void; setTab: (tab: AppTab) => void; openConversation: (id: string | undefined) => void }) {
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
  const [memberGroup, setMemberGroup] = useState<Group | null>(null);

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

  function openGroupChat(group: Group) {
    if (!group.conversationId) return notify('error', 'Group chat is still being prepared. Refresh and try again.');
    openConversation(group.conversationId);
    setTab('chats');
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
        <GlassCard key={group.id} style={styles.listCard}><Text style={styles.cardTitle}>{group.name}</Text><Text style={styles.muted}>{group.description || 'No description yet.'}</Text><Text style={styles.badge}>{group.visibility === 'public' ? 'Public' : 'Private'} - {group.memberCount} members - voice {group.voiceLimit ?? 25} - video {group.videoLimit ?? 10}</Text><View style={styles.ticketActions}><SecondaryButton label="Open Chat" icon="chatbubbles" onPress={() => openGroupChat(group)} /><SecondaryButton label="Members" icon="people" onPress={() => setMemberGroup(group)} /><SecondaryButton label="Invite" icon="link" onPress={() => api.groupInvite(group.id).then(invite => Clipboard.setStringAsync(invite.inviteUrl).then(() => notify('success', 'Invite link copied.'))).catch(error => notify('error', error.message))} />{group.ownerId === user.id ? <SecondaryButton label="Delete" icon="trash" onPress={() => setDeleteTarget(group)} /> : null}</View></GlassCard>
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
      <Modal visible={Boolean(memberGroup)} transparent animationType="slide">
        <View style={styles.sheetBackdrop}>
          <View style={styles.editorPanel}>
            <View style={styles.editorHeader}><Text style={[styles.cardTitle, { flex: 1 }]}>{memberGroup?.name} Members</Text><IconButton icon="close" onPress={() => setMemberGroup(null)} /></View>
            <Text style={styles.muted}>{memberGroup?.memberCount ?? 0} members are in this group.</Text>
            <View style={styles.memberPick}><UserAvatar user={user} size={34} /><View style={styles.flex}><Text style={styles.body}>{user.displayName}</Text><Text style={styles.meta}>{memberGroup?.ownerId === user.id ? 'Owner' : 'Member'}</Text></View><StatusPill presence={user.presence} /></View>
            <Text style={styles.muted}>Open the group chat to see active members in the conversation header.</Text>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function ChatScreen({ user, notify, initialConversationId, initialCallRoomName, clearPendingCallRoomName, setFullscreen }: { user: User; notify: (tone: 'error' | 'success' | 'info', text: string) => void; initialConversationId?: string; initialCallRoomName?: string; clearPendingCallRoomName?: () => void; setFullscreen: (value: boolean) => void }) {
  const insets = useSafeAreaInsets();
  const [conversations, setConversations] = useState<Loadable<Conversation[]>>({ loading: true, data: [] });
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [gifSearch, setGifSearch] = useState('');
  const [gifResults, setGifResults] = useState<GifResult[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [revealedBlockedMessages, setRevealedBlockedMessages] = useState<Record<string, boolean>>({});
  const [reportReason, setReportReason] = useState('');
  const [reportProof, setReportProof] = useState('');
  const [activeCall, setActiveCall] = useState<CallState | null>(null);
  const [callNotificationId, setCallNotificationId] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Array<{ id: string; displayName: string }>>([]);
  const [showMembers, setShowMembers] = useState(false);
  const messageScrollRef = useRef<ScrollView | null>(null);
  const callVibrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joinedNotificationRoom = useRef<string | null>(null);
  const lastTypingSent = useRef(0);

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
    setFullscreen(Boolean(selected));
    return () => setFullscreen(false);
  }, [selected?.id]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editingMessage) {
        setEditingMessage(null);
        return true;
      }
      if (profileUser) {
        setProfileUser(null);
        return true;
      }
      if (selected) {
        setSelected(null);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [selected?.id, profileUser?.id, editingMessage?.id]);

  useEffect(() => {
    if (!selected) return;
    api.messages(selected.id, { q: search, pinned: pinnedOnly }).then(setMessages).catch(error => notify('error', error.message));
  }, [selected?.id, pinnedOnly]);

  useEffect(() => {
    if (!selected || !initialCallRoomName || joinedNotificationRoom.current === initialCallRoomName) return;
    const conversationId = initialCallRoomName.replace(/^(voice|video)-/, '');
    if (conversationId !== selected.id) return;
    joinedNotificationRoom.current = initialCallRoomName;
    const kind = initialCallRoomName.startsWith('video-') ? 'video' : 'voice';
    api.callToken(initialCallRoomName, false)
      .then(result => {
        const next: CallState = { kind, roomName: result.roomName, url: result.url, token: result.token, joined: true, muted: false, deafened: false, videoEnabled: kind === 'video', cameraFacing: 'front' };
        setActiveCall(next);
        clearPendingCallRoomName?.();
        AudioSession.startAudioSession().catch(error => notify('error', error instanceof Error ? error.message : 'Could not start call audio.'));
        showCallNotification(next).catch(() => undefined);
      })
      .catch(error => notify('error', error.message));
  }, [selected?.id, initialCallRoomName]);

  useEffect(() => {
    if (!selected) {
      setTypingUsers([]);
      return;
    }
    const loadTyping = () => api.typingUsers(selected.id).then(setTypingUsers).catch(() => undefined);
    loadTyping();
    const interval = setInterval(loadTyping, 1800);
    return () => clearInterval(interval);
  }, [selected?.id]);

  useEffect(() => {
    requestAnimationFrame(() => messageScrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length, selected?.id]);

  const refreshMessages = () => selected && api.messages(selected.id, { q: search, pinned: pinnedOnly }).then(setMessages).catch(error => notify('error', error.message));
  const pinnedMessage = messages.find(message => message.pinned);
  const selectedOther = selected?.participants.find(participant => participant.id !== user.id) || null;
  const typingText = typingUsers.length === 0
    ? ''
    : typingUsers.length === 1
      ? `${typingUsers[0].displayName} is typing...`
      : `${typingUsers.slice(0, 2).map(item => item.displayName).join(', ')} are typing...`;
  function openTray(tray: 'emoji' | 'gif') {
    setShowEmoji(tray === 'emoji' ? value => !value : false);
    setShowGif(tray === 'gif' ? value => !value : false);
  }

  useEffect(() => {
    if (!showGif) return;
    const query = gifSearch.trim() || 'hello';
    let canceled = false;
    setGifLoading(true);
    const timer = setTimeout(() => {
      api.searchGifs(query, 48)
        .then(results => { if (!canceled) setGifResults(results); })
        .catch(error => { if (!canceled) notify('error', error.message); })
        .finally(() => { if (!canceled) setGifLoading(false); });
    }, 280);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [showGif, gifSearch]);

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

  function updateBody(value: string) {
    setBody(value);
    if (!selected || !value.trim()) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 2200) return;
    lastTypingSent.current = now;
    api.sendTyping(selected.id).catch(() => undefined);
  }

  async function pickChatImage(camera = false) {
    if (!selected) return notify('error', 'Open a DM first.');
    setShowEmoji(false);
    setShowGif(false);
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return notify('error', camera ? 'Camera permission is required.' : 'Gallery permission is required.');
    const result = camera
      ? await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.74 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.74 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const upload = await api.uploadFile({
      uri: asset.uri,
      name: asset.fileName || `image-${Date.now()}.jpg`,
      mimeType: asset.mimeType || 'image/jpeg'
    });
    await send({ type: 'image', attachmentUrl: upload.url, body: upload.filename || 'Image' });
  }

  async function pickChatDocument() {
    if (!selected) return notify('error', 'Open a DM first.');
    setShowEmoji(false);
    setShowGif(false);
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (typeof asset.size === 'number' && asset.size > maxDocumentBytes) {
      return notify('error', 'File is too large. Maximum size is 500 MB.');
    }
    const upload = await api.uploadFile({
      uri: asset.uri,
      name: asset.name || `document-${Date.now()}`,
      mimeType: asset.mimeType || 'application/octet-stream'
    });
    await send({ type: 'file', attachmentUrl: upload.url, body: upload.filename || asset.name || 'Document' });
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
    setEditingMessage(message);
    setEditingBody(message.body);
  }

  async function saveEditedMessage() {
    if (!editingMessage) return;
    const text = editingBody.trim();
    if (!text) return notify('error', 'Message cannot be empty.');
    await api.editMessage(editingMessage.id, text)
      .then(next => {
        setMessages(prev => prev.map(item => item.id === next.id ? next : item));
        setEditingMessage(null);
        setEditingBody('');
      })
      .catch(error => notify('error', error.message));
  }

  async function downloadAttachment(message: Message) {
    if (!message.attachmentUrl) return;
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(message.attachmentUrl).catch(() => Linking.openURL(message.attachmentUrl!).catch(() => notify('error', 'Could not download file.')));
      return;
    }
    await Linking.openURL(message.attachmentUrl).catch(() => notify('error', 'Could not download file.'));
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
      .then(result => {
        setActiveCall({ kind, roomName: result.roomName, url: result.url, token: result.token, joined: false, muted: false, deafened: false, videoEnabled: kind === 'video', cameraFacing: 'front' });
        notify('success', `${kind === 'voice' ? 'Voice' : 'Video'} invite sent.`);
      })
      .catch(error => notify('error', error.message));
  }

  async function showCallNotification(call: CallState) {
    if (!selected) return;
    if (callNotificationId) await Notifications.dismissNotificationAsync(callNotificationId).catch(() => undefined);
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: call.kind === 'voice' ? 'Voice call connected' : 'Video call connected',
        body: `${selected.title} - ${selected.participants.length} member${selected.participants.length === 1 ? '' : 's'} in this chat`,
        categoryIdentifier: 'active-call',
        data: { conversationId: selected.id, roomName: call.roomName, kind: 'active-call' },
        sound: false
      },
      trigger: null
    });
    setCallNotificationId(id);
  }

  async function joinActiveCall() {
    Vibration.cancel();
    if (callVibrationTimer.current) clearTimeout(callVibrationTimer.current);
    const call = activeCall;
    if (call?.url && call.token) {
      await AudioSession.startAudioSession().catch(error => notify('error', error instanceof Error ? error.message : 'Could not start call audio.'));
    }
    setActiveCall(call => {
      if (!call) return call;
      const next = { ...call, joined: true };
      showCallNotification(next).catch(() => undefined);
      return next;
    });
  }

  async function leaveActiveCall() {
    Vibration.cancel();
    if (callVibrationTimer.current) clearTimeout(callVibrationTimer.current);
    if (callNotificationId) await Notifications.dismissNotificationAsync(callNotificationId).catch(() => undefined);
    await AudioSession.stopAudioSession().catch(() => undefined);
    setCallNotificationId(null);
    setActiveCall(null);
  }

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const action = response.actionIdentifier;
      const roomName = response.notification.request.content.data?.roomName;
      if (!roomName || typeof roomName !== 'string') return;
      if (action === 'mute-call') setActiveCall(call => call?.roomName === roomName ? { ...call, muted: !call.muted } : call);
      if (action === 'deafen-call') setActiveCall(call => call?.roomName === roomName ? { ...call, deafened: !call.deafened, muted: true } : call);
      if (action === 'leave-call') leaveActiveCall();
    });
    return () => subscription.remove();
  }, [callNotificationId]);

  useEffect(() => () => {
    Vibration.cancel();
    if (callVibrationTimer.current) clearTimeout(callVibrationTimer.current);
  }, []);

  const emojiChoices = emojis.filter(item => !emojiSearch.trim() || item.includes(emojiSearch.trim()));
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 84 : 0} style={styles.flex}>
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
            <Pressable style={styles.flex} onPress={() => selected?.kind === 'dm' && selectedOther ? setProfileUser(selectedOther) : undefined}>
              <Text style={styles.cardTitle}>{selected.title}</Text>
              <Text style={styles.meta}>{selected.kind === 'group' ? `${selected.participants.length} members` : 'Private DM'}</Text>
            </Pressable>
            {selected.kind === 'group' ? <IconButton icon="people" onPress={() => setShowMembers(true)} /> : null}
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
          <ScrollView ref={messageScrollRef} style={styles.flex} contentContainerStyle={styles.messageList} keyboardShouldPersistTaps="handled" onContentSizeChange={() => messageScrollRef.current?.scrollToEnd({ animated: true })}>
            {messages.length === 0 ? <EmptyState title="No messages" body="Send the first message, emoji, sticker, GIF, or image." /> : messages.map(message => {
              const author = selected.participants.find(p => p.id === message.senderId) || user;
              const topBadge = topPriorityBadge(author.badges);
              if (message.blocked && !revealedBlockedMessages[message.id]) {
                return (
                  <Pressable key={message.id} style={styles.blockedMessage} onPress={() => setRevealedBlockedMessages(prev => ({ ...prev, [message.id]: true }))}>
                    <Ionicons name="eye-off" size={15} color="#E6C07A" />
                    <Text style={styles.blockedMessageText}>Blocked message from {message.blockedAuthorName || author.displayName}. Tap to view.</Text>
                  </Pressable>
                );
              }
              return (
              <Pressable key={message.id} onLongPress={() => Alert.alert('Message', 'Choose an action', [{ text: message.pinned ? 'Unpin' : 'Pin', onPress: () => pin(message) }, ...(message.senderId === user.id ? [{ text: 'Delete', style: 'destructive' as const, onPress: () => remove(message) }] : []), { text: 'Cancel', style: 'cancel' }])} style={[styles.messageRow, message.senderId === user.id && styles.messageOwn]}>
                <Pressable style={styles.messageAuthor} onPress={() => setProfileUser(author)} onLongPress={() => setProfileUser(author)}><UserAvatar user={author} size={28} /><Text style={styles.messageName}>{author.displayName}</Text>{topBadge ? <BadgeIcon badge={topBadge} /> : null}<Text style={styles.messageTimeInline}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>{message.pinned ? <Ionicons name="pin" size={11} color="#E6C07A" /> : null}{message.isEdited ? <Text style={styles.editedTag}>edited</Text> : null}</Pressable>
                <View style={[styles.messageBubble, message.senderId === user.id && styles.messageBubbleOwn]}>
                  {(message.type === 'gif' || message.type === 'image') && message.attachmentUrl ? <Image source={{ uri: message.attachmentUrl }} style={styles.chatImage} resizeMode="cover" /> : null}
                  {message.type === 'file' && message.attachmentUrl ? <Pressable style={styles.fileAttachment} onPress={() => downloadAttachment(message)}><Ionicons name="download" size={18} color="#E6C07A" /><Text style={styles.fileAttachmentText} numberOfLines={1}>{message.body || 'Document'}</Text></Pressable> : null}
                  {message.body ? <RichText text={message.body} /> : null}
                </View>
                <View style={styles.messageActions}><Pressable onPress={() => copyMessage(message)}><Ionicons name="copy" size={14} color="#AEB8A5" /></Pressable>{message.senderId === user.id && <Pressable onPress={() => editMessage(message)}><Ionicons name="pencil" size={14} color="#AEB8A5" /></Pressable>}</View>
              </Pressable>
            );})}
          </ScrollView>
          {typingText ? <Text style={styles.typingText}>{typingText}</Text> : null}
          {showEmoji && <View style={styles.pickerPanel}><TextInput style={styles.searchInput} placeholder="Search emoji or use your keyboard for all emoji" placeholderTextColor="#899486" value={emojiSearch} onChangeText={setEmojiSearch} /> <View style={styles.pickerRow}>{emojiChoices.map(item => <Pressable key={item} style={styles.pickerButton} onPress={() => setBody(prev => `${prev}${item}`)}><Text style={styles.emojiText}>{item}</Text></Pressable>)}</View></View>}
          {showGif && <View style={styles.pickerPanel}><TextInput style={styles.searchInput} placeholder="Search GIFs" placeholderTextColor="#899486" value={gifSearch} onChangeText={setGifSearch} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gifPicker}>{gifLoading ? <ActivityIndicator color="#E6C07A" /> : gifResults.length ? gifResults.map(item => <Pressable key={item.id} onPress={() => send({ type: 'gif', attachmentUrl: item.url, body: item.title || 'GIF' })}><Image source={{ uri: item.previewUrl || item.url }} style={styles.gifThumb} /></Pressable>) : <Text style={styles.muted}>No GIF found. Try another search.</Text>}</ScrollView></View>}
          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom + 6, 10) }]}>
            <IconButton icon="happy" onPress={() => openTray('emoji')} />
            <IconButton icon="film" onPress={() => openTray('gif')} />
            <IconButton icon="attach" onPress={() => Alert.alert('Upload', 'Choose a source', [{ text: 'Document', onPress: pickChatDocument }, { text: 'Photo Library', onPress: () => pickChatImage(false) }, { text: 'Camera', onPress: () => pickChatImage(true) }, { text: 'Cancel', style: 'cancel' }])} />
            <TextInput style={styles.composerInput} placeholder="Message" placeholderTextColor="#899486" value={body} onChangeText={updateBody} multiline />
            <IconButton icon="send" onPress={() => send()} />
          </View>
          <ProfileSheet user={profileUser} currentUser={user} reportReason={reportReason} reportProof={reportProof} setReportReason={setReportReason} setReportProof={setReportProof} onClose={() => setProfileUser(null)} canUnfriend={selected.kind === 'dm'} onMute={dmAction} onReport={submitReport} />
          <Modal visible={Boolean(editingMessage)} transparent animationType="fade">
            <View style={styles.modalBackdrop}>
              <View style={styles.announcementModal}>
                <View style={styles.editorHeader}><Text style={[styles.cardTitle, { flex: 1 }]}>Edit Message</Text><IconButton icon="close" onPress={() => setEditingMessage(null)} /></View>
                <TextInput style={[styles.composerInput, { minHeight: 96 }]} placeholder="Message" placeholderTextColor="#899486" value={editingBody} onChangeText={setEditingBody} multiline autoFocus />
                <View style={styles.ticketActions}>
                  <SecondaryButton label="Cancel" icon="close" onPress={() => setEditingMessage(null)} />
                  <PrimaryButton label="Save" icon="save" onPress={saveEditedMessage} />
                </View>
              </View>
            </View>
          </Modal>
          <CallSheet
            call={activeCall}
            conversation={selected}
            currentUser={user}
            onJoin={joinActiveCall}
            onLeave={leaveActiveCall}
            onToggleMute={() => setActiveCall(call => call ? { ...call, muted: !call.muted } : call)}
            onToggleDeafen={() => setActiveCall(call => call ? { ...call, deafened: !call.deafened, muted: !call.deafened ? true : call.muted } : call)}
            onToggleVideo={() => setActiveCall(call => call ? { ...call, videoEnabled: !call.videoEnabled } : call)}
            onFlipCamera={() => setActiveCall(call => call ? { ...call, cameraFacing: call.cameraFacing === 'front' ? 'back' : 'front' } : call)}
          />
          <MemberSheet visible={showMembers} conversation={selected} onClose={() => setShowMembers(false)} />
        </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function ProfileScreen({ user, setUser, notify }: { user: User; setUser: (user: User) => void; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const theme = profileThemes[user.profileTheme || 'terria'];
  const accent = user.profileColor || theme.color;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <GlassCard style={[styles.profileHero, { borderColor: accent, backgroundColor: `${accent}22` }]}>
        {user.bannerUrl ? <Image source={{ uri: user.bannerUrl }} style={styles.profileBannerImage} resizeMode="cover" /> : <View style={[styles.profileBanner, { backgroundColor: accent }]} />}
        <View>
          <Image source={user.avatarUrl ? { uri: user.avatarUrl } : logo} style={[styles.profileLogo, { borderColor: accent }]} />
          <View style={[styles.statusDot, { backgroundColor: presenceMeta[user.presence].color }]} />
          {user.customStatus ? <View style={styles.profileStatusBubble}><Text style={styles.profileStatusText}>{user.customStatus}</Text></View> : null}
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
      const profileUpdated = await api.updateProfile({ 
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
      const accountUpdated = await api.updateAccount({
        username: username.trim(),
        discriminator: discriminator.trim() || undefined,
        mobile: mobile.trim() || undefined,
        alternateEmail: alternateEmail.trim() || undefined
      });
      
      notify('success', 'Profile updated successfully!');
      onSaved({ ...profileUpdated, ...accountUpdated, profileColor: profileUpdated.profileColor, profileTheme: profileUpdated.profileTheme });
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
              <ThemePicker value={profileTheme} onChange={setProfileTheme} />
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
  const [autoLoginEnabled, setAutoLoginEnabled] = useState(true);
  const [sessions, setSessions] = useState<Loadable<DeviceSession[]>>({ loading: false, data: [] });

  useEffect(() => {
    SecureStore.getItemAsync(biometricLoginKey).then(value => setBiometricEnabled(value === '1')).catch(() => undefined);
    SecureStore.getItemAsync(autoLoginKey).then(value => setAutoLoginEnabled(value !== '0')).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (panel !== 'devices') return;
    setSessions(current => ({ ...current, loading: true, error: undefined }));
    api.sessions()
      .then(data => setSessions({ loading: false, data }))
      .catch(error => setSessions({ loading: false, data: [], error: error.message }));
  }, [panel]);
  
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
    await SecureStore.setItemAsync(biometricLoginKey, biometricEnabled ? '0' : '1');
    setBiometricEnabled(prev => !prev);
    notify('success', biometricEnabled ? 'Biometric login disabled.' : 'Biometric login enabled on this device.');
  }

  async function toggleAutoLogin() {
    const next = !autoLoginEnabled;
    await SecureStore.setItemAsync(autoLoginKey, next ? '1' : '0');
    setAutoLoginEnabled(next);
    notify('success', next ? 'Auto login enabled.' : 'Auto login disabled for future app starts.');
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
                  .then(result => notify('success', recoveryDeliveryMessage(result)))
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
            <GlassCard style={styles.securityToggleCard}>
              <View style={styles.securityToggleRow}>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>Auto Login</Text>
                  <Text style={styles.meta}>{autoLoginEnabled ? 'Opens into your account on this device.' : 'Ask for sign-in after restart.'}</Text>
                </View>
                <Pressable onPress={toggleAutoLogin} style={[styles.inlineSwitch, autoLoginEnabled && styles.inlineSwitchOn]}>
                  <View style={[styles.inlineSwitchKnob, autoLoginEnabled && styles.inlineSwitchKnobOn]} />
                </Pressable>
              </View>
            </GlassCard>
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
            {sessions.loading ? <LoadingState /> : sessions.error ? <ErrorState message={sessions.error} onRetry={() => {
              setSessions(current => ({ ...current, loading: true, error: undefined }));
              api.sessions().then(data => setSessions({ loading: false, data })).catch(error => setSessions({ loading: false, data: [], error: error.message }));
            }} /> : sessions.data.filter(session => !session.revokedAt).length === 0 ? <EmptyState title="No active devices" body="Your current session will appear after the next authenticated request." /> : sessions.data.filter(session => !session.revokedAt).map(session => (
              <GlassCard key={session.id}>
                <View style={styles.deviceRow}>
                  <View style={styles.deviceIcon}>
                    <Ionicons name={session.current ? 'phone-portrait' : 'desktop'} size={20} color="#E6C07A" />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.cardTitle}>{session.deviceName || session.userAgent || 'Unknown device'}</Text>
                    <Text style={styles.muted}>IP {session.ipAddress || 'Unavailable'}</Text>
                    <Text style={styles.muted}>First login {new Date(session.createdAt).toLocaleString()}</Text>
                    <Text style={styles.muted}>Last seen {new Date(session.lastSeenAt).toLocaleString()}</Text>
                  </View>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusText}>{session.current ? 'Active' : 'Signed in'}</Text>
                  </View>
                </View>
              </GlassCard>
            ))}
            <GlassCard>
              <Text style={styles.cardTitle}>Session Management</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>New logins send an email with device, IP, approximate location, model, and time.</Text>
              <PrimaryButton label="Log Out All Devices" icon="power" onPress={() => {
                Alert.alert('Log Out All Devices', 'This will sign you out on all devices. Continue?', [
                  { text: 'Cancel', onPress: () => {}, style: 'cancel' },
                  { text: 'Log Out', onPress: () => api.logoutAll().finally(logout), style: 'destructive' }
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
              <ThemePicker value={user.profileTheme || 'terria'} onChange={(item) => {
                const previous = user;
                setUser({ ...user, profileTheme: item });
                api.updateProfile({ profileTheme: item }).then(next => { setUser(next); notify('success', 'Appearance updated.'); }).catch(error => { setUser(previous); notify('error', error.message); });
              }} />
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Accent Color</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Pick your app/profile color from the RGB grid.</Text>
              <ColorPicker value={user.profileColor} onChange={(color) => {
                const previous = user;
                setUser({ ...user, profileColor: color });
                api.updateProfile({ profileColor: color }).then(next => { setUser(next); notify('success', 'Color updated.'); }).catch(error => { setUser(previous); notify('error', error.message); });
              }} />
            </GlassCard>
            <GlassCard>
              <Text style={styles.cardTitle}>Density</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Tune spacing for compact lists, regular use, or larger touch targets.</Text>
              <DensityPreview value={user.density || 'comfortable'} onChange={(density) => {
                const previous = user;
                setUser({ ...user, density });
                api.updateProfile({ density }).then(next => { setUser(next); notify('success', 'Density updated.'); }).catch(error => { setUser(previous); notify('error', error.message); });
              }} />
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
              <Text style={[styles.muted, { marginTop: 8 }]}>Voice and video calls are ready. You can join from DMs and group chats.</Text>
              <Text style={[styles.badge, { marginTop: 12 }]}>Call service online</Text>
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

function DensityPreview({ value, onChange }: { value: keyof typeof densityChoices; onChange: (density: keyof typeof densityChoices) => void }) {
  const scale = densityChoices[value].scale;
  return (
    <View style={{ gap: 10, marginTop: 12 }}>
      <View style={styles.segment}>
        {(Object.keys(densityChoices) as Array<keyof typeof densityChoices>).map(item => (
          <Pressable key={item} style={[styles.segmentItem, value === item && styles.segmentActive]} onPress={() => onChange(item)}>
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
  const [page, setPage] = useState<'overview' | 'users' | 'alerts' | 'moderation' | 'content' | 'badges' | 'logs' | 'analytics'>('overview');
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
  const [adminPassword, setAdminPassword] = useState('');
  const [badgeCatalog, setBadgeCatalog] = useState<BadgeDefinition[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [newBadgeName, setNewBadgeName] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState<User[]>([]);
  const [adminUsers, setAdminUsers] = useState<UserPage>({ items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 });
  const [adminUserSearch, setAdminUserSearch] = useState('');
  const [adminUserPage, setAdminUserPage] = useState(1);
  const [alerts, setAlerts] = useState<AlertFlag[]>([]);
  const [alertSearch, setAlertSearch] = useState('');
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [moderationTarget, setModerationTarget] = useState<User | null>(null);
  const [moderationAction, setModerationAction] = useState<'mute' | 'ban' | 'unban'>('mute');
  const [moderationHours, setModerationHours] = useState('8');
  const [moderationReason, setModerationReason] = useState('');
  const [badgeMenuOpen, setBadgeMenuOpen] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);

  const load = async () => {
    const [nextStats, nextAnnouncements, nextBlogs, nextBadges, nextRoles, nextUsers, nextLogs, nextAnalytics, nextAlerts] = await Promise.allSettled([api.adminStats(), api.adminAnnouncements(), api.blogs(), api.badgeCatalog(), api.roles(), api.adminUsers({ q: adminUserSearch, page: adminUserPage, limit: 10 }), api.auditLogs(), api.adminAnalytics(), api.adminAlerts(alertSearch)]);
    if (nextStats.status === 'fulfilled') setStats(nextStats.value);
    if (nextAnnouncements.status === 'fulfilled') setAdminAnnouncements(nextAnnouncements.value);
    if (nextBlogs.status === 'fulfilled') setAdminBlogs(nextBlogs.value);
    if (nextBadges.status === 'fulfilled') {
      setBadgeCatalog(nextBadges.value);
      if (!nextBadges.value.some(item => item.name === badge) && nextBadges.value[0]) setBadge(nextBadges.value[0].name);
    }
    if (nextRoles.status === 'fulfilled') setRoles(nextRoles.value);
    if (nextUsers.status === 'fulfilled') setAdminUsers(nextUsers.value);
    if (nextLogs.status === 'fulfilled') setAuditLogs(nextLogs.value);
    if (nextAnalytics.status === 'fulfilled') setAnalytics(nextAnalytics.value);
    if (nextAlerts.status === 'fulfilled') setAlerts(nextAlerts.value);
    const failures = [nextStats, nextAnnouncements, nextBlogs, nextBadges, nextRoles, nextUsers, nextLogs, nextAnalytics, nextAlerts].filter(result => result.status === 'rejected') as PromiseRejectedResult[];
    if (failures[0]) notify('error', failures[0].reason?.message || 'Some admin tools could not load.');
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    api.adminUsers({ q: adminUserSearch, page: adminUserPage, limit: 10 })
      .then(setAdminUsers)
      .catch(error => notify('error', error.message));
  }, [adminUserPage]);

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

  async function searchAdminUsers() {
    await api.adminUsers({ q: adminUserSearch, page: 1, limit: 10 })
      .then(result => {
        setAdminUsers(result);
        setAdminUserPage(1);
      })
      .catch(error => notify('error', error.message));
  }

  async function searchAlerts() {
    await api.adminAlerts(alertSearch)
      .then(setAlerts)
      .catch(error => notify('error', error.message));
  }

  async function updateAdminUser(resetUsernameLimit = false) {
    if (!adminUser.trim()) return notify('error', 'Enter a user tag or email.');
    await api.updateUser({ username: adminUser, newUsername: adminNewUsername || undefined, discriminator: adminDisc || undefined, mobile: adminMobile || undefined, alternateEmail: adminAltEmail || undefined, newPassword: adminPassword || undefined, resetUsernameLimit })
      .then(() => { setAdminPassword(''); notify('success', 'User updated.'); })
      .catch(error => notify('error', error.message));
  }

  function editAdminUser(user: User) {
    setAdminUser(user.email);
    setAdminNewUsername(user.username);
    setAdminDisc(user.discriminator || '');
    setAdminMobile(user.mobile || '');
    setAdminAltEmail(user.alternateEmail || '');
    setAdminPassword('');
    setPage('users');
  }

  async function searchModerationUsers() {
    if (!userSearch.trim()) return setUserResults([]);
    await api.searchUsers(userSearch)
      .then(setUserResults)
      .catch(error => notify('error', error.message));
  }

  async function runModeration() {
    if (!moderationTarget) return notify('error', 'Select a user first.');
    if (!moderationReason.trim()) return notify('error', 'Add a reason for the punishment log.');
    const hours = Math.max(1, Number(moderationHours) || 8);
    await api.moderateUser({ userId: moderationTarget.id, action: moderationAction, hours, reason: moderationReason.trim() })
      .then(() => { notify('success', `${moderationAction} applied to ${moderationTarget.displayName}.`); setModerationReason(''); load(); })
      .catch(error => notify('error', error.message));
  }

  const adminPages: Array<[typeof page, string, keyof typeof Ionicons.glyphMap]> = [
    ['overview', 'Overview', 'speedometer'],
    ['users', 'Users', 'people'],
    ['alerts', 'Alerts', 'warning'],
    ['moderation', 'Moderation', 'hammer'],
    ['content', 'Content', 'newspaper'],
    ['badges', 'Badges/Roles', 'ribbon'],
    ['logs', 'Logs', 'list'],
    ['analytics', 'Analytics', 'analytics']
  ];

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.dashboardHeader}>
        <IconButton icon="menu" onPress={() => setAdminMenuOpen(true)} />
        <View style={styles.flex}>
          <Text style={styles.heroSmall}>Admin Dashboard</Text>
          <Text style={styles.muted}>{adminPages.find(([key]) => key === page)?.[1]}</Text>
        </View>
      </View>
      {page === 'overview' && <><StatsGrid values={[['Users', String(stats.users)], ['Active', String(stats.activeUsers ?? 0)], ['Reports', String(stats.reports)], ['Invites', String(stats.invites ?? 0)]]} /><GlassCard><Text style={styles.cardTitle}>Control Center</Text><Text style={styles.muted}>Jump into moderation tickets, export data, and manage user access from one place.</Text><View style={styles.ticketActions}><SecondaryButton label="Tickets" icon="ticket" onPress={() => setTab('tickets')} /><SecondaryButton label="Staff Queue" icon="briefcase" onPress={() => setTab('staff')} /><SecondaryButton label="Export Users" icon="download" onPress={exportUsers} /></View></GlassCard></>}
      {page === 'content' && <><GlassCard><Text style={styles.cardTitle}>Announcement</Text><Field icon="megaphone" placeholder="Title" value={title} onChangeText={setTitle} /><Field icon="document-text" placeholder="Message with links" value={body} onChangeText={setBody} multiline /><Field icon="image" placeholder="Image URL" value={imageUrl} onChangeText={setImageUrl} autoCapitalize="none" /><Field icon="link" placeholder="Clickable link URL" value={linkUrl} onChangeText={setLinkUrl} autoCapitalize="none" /><PrimaryButton label="Publish Announcement" icon="send" onPress={broadcast} /></GlassCard><GlassCard><Text style={styles.cardTitle}>Announcement Logs</Text><PrimaryButton label="Refresh" icon="refresh" onPress={load} />{adminAnnouncements.length === 0 ? <Text style={styles.muted}>No announcements published.</Text> : adminAnnouncements.map(item => <View key={item.id} style={styles.manageRow}><View style={styles.flex}><Text style={styles.body}>{item.title}</Text><Text style={styles.meta}>Published {new Date(item.createdAt).toLocaleString()}</Text></View><IconButton icon="trash" onPress={() => removeAnnouncement(item.id)} /></View>)}</GlassCard><GlassCard><Text style={styles.cardTitle}>Blog Post</Text><Field icon="newspaper" placeholder="Title" value={blogTitle} onChangeText={setBlogTitle} /><Field icon="document-text" placeholder="Body with links" value={blogBody} onChangeText={setBlogBody} multiline /><Field icon="image" placeholder="Image URL" value={blogImageUrl} onChangeText={setBlogImageUrl} autoCapitalize="none" /><Field icon="link" placeholder="Clickable link URL" value={blogLinkUrl} onChangeText={setBlogLinkUrl} autoCapitalize="none" /><PrimaryButton label="Publish Blog" icon="cloud-upload" onPress={createBlog} /></GlassCard><GlassCard><Text style={styles.cardTitle}>Blog Logs</Text>{adminBlogs.length === 0 ? <Text style={styles.muted}>No blog posts published.</Text> : adminBlogs.map(item => <View key={item.id} style={styles.manageRow}><View style={styles.flex}><Text style={styles.body}>{item.title}</Text><Text style={styles.meta}>{item.category || 'Update'} - {new Date(item.createdAt).toLocaleString()}</Text></View><IconButton icon="trash" onPress={() => removeBlog(item.id)} /></View>)}</GlassCard></>}
      {page === 'badges' && <><GlassCard><Text style={styles.cardTitle}>Badges</Text><Field icon="at" placeholder="Username, email, or tag" value={badgeUser} onChangeText={setBadgeUser} autoCapitalize="none" /><DropdownButton label="Selected badge" value={badge || 'Choose badge'} icon="ribbon" onPress={() => setBadgeMenuOpen(true)} /><PrimaryButton label="Grant Badge" icon="ribbon" onPress={() => api.grantBadge({ username: badgeUser, badge }).then(() => notify('success', 'Badge granted.')).catch(error => notify('error', error.message))} /><Field icon="add" placeholder="Create/edit badge name" value={newBadgeName} onChangeText={setNewBadgeName} /><View style={styles.ticketActions}><SecondaryButton label="Save Badge" icon="save" onPress={() => api.createBadge({ name: newBadgeName, icon: 'ribbon', color: '#E6C07A' }).then(() => { setNewBadgeName(''); load(); }).catch(error => notify('error', error.message))} />{badgeCatalog.find(item => item.name === badge) ? <SecondaryButton label="Delete Selected" icon="trash" onPress={() => api.deleteBadge(badgeCatalog.find(item => item.name === badge)!.id).then(load).catch(error => notify('error', error.message))} /> : null}</View></GlassCard><GlassCard><Text style={styles.cardTitle}>Roles</Text><Field icon="at" placeholder="Username, email, or tag" value={roleUser} onChangeText={setRoleUser} autoCapitalize="none" /><DropdownButton label="Selected role" value={roles.find(item => item.id === role)?.name || 'Choose role'} icon="key" onPress={() => setRoleMenuOpen(true)} /><Text style={styles.muted}>{roles.find(item => item.id === role)?.permissions.join(', ')}</Text><PrimaryButton label="Update Role" icon="key" onPress={() => api.setRole({ username: roleUser, role }).then(() => notify('success', 'Role updated.')).catch(error => notify('error', error.message))} /></GlassCard></>}
      {page === 'moderation' && <GlassCard><Text style={styles.cardTitle}>Punishment Center</Text><Field icon="search" placeholder="Search users" value={userSearch} onChangeText={setUserSearch} autoCapitalize="none" /><PrimaryButton label="Search Users" icon="search" onPress={searchModerationUsers} />{userResults.map(item => <Pressable key={item.id} style={styles.memberPick} onPress={() => setModerationTarget(item)}><Text style={styles.body}>{item.displayName} @{item.tag || item.username}</Text><Ionicons name={moderationTarget?.id === item.id ? 'radio-button-on' : 'radio-button-off'} size={22} color="#CDA16A" /></Pressable>)}<View style={styles.segment}>{(['mute', 'ban', 'unban'] as const).map(item => <Pressable key={item} style={[styles.segmentItem, moderationAction === item && styles.segmentActive]} onPress={() => setModerationAction(item)}><Text style={styles.segmentText}>{item}</Text></Pressable>)}</View><Field icon="timer" placeholder="Duration hours" value={moderationHours} onChangeText={setModerationHours} keyboardType="number-pad" /><Field icon="document-text" placeholder="Reason shown in punishment log" value={moderationReason} onChangeText={setModerationReason} multiline /><PrimaryButton label="Apply Punishment" icon="hammer" onPress={runModeration} /></GlassCard>}
      {page === 'users' && <><GlassCard><Text style={styles.cardTitle}>Users</Text><Field icon="search" placeholder="Search name, username, email, or #" value={adminUserSearch} onChangeText={setAdminUserSearch} autoCapitalize="none" /><PrimaryButton label="Search Users" icon="search" onPress={searchAdminUsers} /><Text style={styles.muted}>Page {adminUsers.page} of {adminUsers.totalPages} - {adminUsers.total} users. Showing max 10.</Text>{adminUsers.items.length === 0 ? <Text style={styles.muted}>No users found.</Text> : adminUsers.items.map(item => <View key={item.id} style={styles.manageRow}><View style={styles.flex}><Text style={styles.body}>{item.displayName}</Text><Text style={styles.meta}>@{item.tag || item.username} - {item.role}</Text></View><IconButton icon="create" onPress={() => editAdminUser(item)} /></View>)}<View style={styles.ticketActions}><SecondaryButton label="Previous" icon="chevron-back" onPress={() => setAdminUserPage(page => Math.max(1, page - 1))} /><SecondaryButton label="Next" icon="chevron-forward" onPress={() => setAdminUserPage(page => Math.min(adminUsers.totalPages, page + 1))} /></View></GlassCard><GlassCard><Text style={styles.cardTitle}>User Control</Text><Field icon="at" placeholder="Username, email, or tag" value={adminUser} onChangeText={setAdminUser} autoCapitalize="none" /><Field icon="person" placeholder="New username" value={adminNewUsername} onChangeText={setAdminNewUsername} autoCapitalize="none" /><Field icon="keypad" placeholder="New 5-digit #" value={adminDisc} onChangeText={setAdminDisc} keyboardType="number-pad" maxLength={5} /><Field icon="call" placeholder="Mobile" value={adminMobile} onChangeText={setAdminMobile} keyboardType="phone-pad" /><Field icon="mail" placeholder="Alternate email" value={adminAltEmail} onChangeText={setAdminAltEmail} autoCapitalize="none" /><Field icon="lock-closed" placeholder="New password" value={adminPassword} onChangeText={setAdminPassword} secureTextEntry /><PrimaryButton label="Update User" icon="save" onPress={() => updateAdminUser(false)} /><SecondaryButton label="Reset Username Limit" icon="refresh" onPress={() => updateAdminUser(true)} /><SecondaryButton label="Download Users CSV" icon="download" onPress={exportUsers} /></GlassCard></>}
      {page === 'alerts' && <GlassCard><Text style={styles.cardTitle}>Alerts</Text><Text style={styles.muted}>Read-only AI-assisted keyword flags. No automatic action is performed.</Text><Field icon="search" placeholder="Search alerts, flags, users, or filenames" value={alertSearch} onChangeText={setAlertSearch} autoCapitalize="none" /><PrimaryButton label="Search Alerts" icon="search" onPress={searchAlerts} />{alerts.length === 0 ? <Text style={styles.muted}>No alert flags found.</Text> : alerts.map(item => <View key={item.id} style={styles.manageRow}><View style={styles.flex}><Text style={styles.body}>{item.matches.join(', ')}</Text><Text style={styles.meta}>{item.label} - {item.actor} - {new Date(item.createdAt).toLocaleString()}</Text><Text style={styles.muted}>{item.preview}</Text></View><Ionicons name="warning" size={20} color="#E6C07A" /></View>)}</GlassCard>}
      {page === 'logs' && <><GlassCard><Text style={styles.cardTitle}>Audit Logs</Text>{auditLogs.map(item => <AuditLogRow key={item.id} item={item} />)}</GlassCard><GlassCard><Text style={styles.cardTitle}>Punishment Logs</Text>{auditLogs.filter(item => item.targetType === 'punishment' || item.action.startsWith('punishment.')).map(item => <AuditLogRow key={item.id} item={item} compactAction={item.action.replace('punishment.', '')} />)}</GlassCard></>}
      {page === 'analytics' && <><StatsGrid values={[['Crash Logs', String(analytics?.crashLogs.length ?? 0)], ['Daily Users', String(analytics?.dailyUsers.at(-1)?.count ?? 0)], ['New Users', String(analytics?.newUsers.at(-1)?.count ?? 0)], ['Tickets', String(analytics?.tickets.at(-1)?.count ?? 0)]]} /><GraphCard title="Daily Users" data={analytics?.dailyUsers ?? []} /><GraphCard title="New Users" data={analytics?.newUsers ?? []} /><GraphCard title="Tickets Created" data={analytics?.tickets ?? []} /><GraphCard title="Reports Created" data={analytics?.reports ?? []} /><GlassCard><Text style={styles.cardTitle}>Crash Logs</Text>{(analytics?.crashLogs ?? []).length === 0 ? <Text style={styles.muted}>No app crash logs reported.</Text> : analytics!.crashLogs.map(item => <View key={item.id} style={styles.manageRow}><View style={styles.flex}><Text style={styles.body}>{item.reason}</Text><Text style={styles.meta}>{item.device || 'Unknown device'} - {new Date(item.createdAt).toLocaleString()}</Text></View></View>)}</GlassCard></>}
      <ChoiceModal visible={badgeMenuOpen} title="Choose Badge" items={badgeCatalog.map(item => ({ key: item.name, label: item.name, icon: item.icon as keyof typeof Ionicons.glyphMap }))} selected={badge} onChoose={(key) => { setBadge(key); setBadgeMenuOpen(false); }} onClose={() => setBadgeMenuOpen(false)} />
      <ChoiceModal visible={roleMenuOpen} title="Choose Role" items={roles.map(item => ({ key: item.id, label: item.name, body: item.permissions.join(', ') }))} selected={role} onChoose={(key) => { setRole(key as User['role']); setRoleMenuOpen(false); }} onClose={() => setRoleMenuOpen(false)} />
      <ChoiceModal visible={adminMenuOpen} title="Admin Menu" items={adminPages.map(([key, label, icon]) => ({ key, label, icon }))} selected={page} onChoose={(key) => { setPage(key as typeof page); setAdminMenuOpen(false); }} onClose={() => setAdminMenuOpen(false)} />
    </ScrollView>
  );
}

function GraphCard({ title, data }: { title: string; data: Array<{ date: string; count: number }> }) {
  const max = Math.max(1, ...data.map(item => item.count));
  return (
    <GlassCard>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.graphRow}>
        {data.map(item => (
          <View key={item.date} style={styles.graphColumn}>
            <View style={[styles.graphBar, { height: 16 + (item.count / max) * 86 }]} />
            <Text style={styles.graphValue}>{item.count}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.meta}>{data[0]?.date || 'No data'} to {data.at(-1)?.date || 'today'}</Text>
    </GlassCard>
  );
}

function TicketCenterScreen({ user, notify }: { user: User; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [tickets, setTickets] = useState<Loadable<Ticket[]>>({ loading: true, data: [] });
  const [teamQueue, setTeamQueue] = useState<Loadable<{ reports: Report[]; tickets: Ticket[] }>>({ loading: false, data: { reports: [], tickets: [] } });
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [replyText, setReplyText] = useState('');
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [type, setType] = useState<Ticket['type']>('support');
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [mode, setMode] = useState<'mine' | 'team'>('mine');
  const [menuOpen, setMenuOpen] = useState(false);
  const elevated = user.role === 'staff' || user.role === 'admin';
  const load = () => {
    api.tickets()
      .then(data => {
        setTickets({ loading: false, data });
        if (selected && selected.userId === user.id) setSelected(data.find(item => item.id === selected.id) || null);
      })
      .catch(error => { setTickets({ loading: false, data: [], error: error.message }); notify('error', error.message); });
    if (elevated) {
      setTeamQueue(prev => ({ ...prev, loading: true }));
      api.reports()
        .then(data => {
          setTeamQueue({ loading: false, data });
          if (selected && selected.userId !== user.id) setSelected(data.tickets.find(item => item.id === selected.id) || null);
        })
        .catch(error => { setTeamQueue({ loading: false, data: { reports: [], tickets: [] }, error: error.message }); notify('error', error.message); });
    }
  };
  useEffect(() => { load(); }, []);
  async function create() {
    if (!subject.trim() || !body.trim()) return notify('error', 'Add a subject and message.');
    await api.createTicket({ type, subject, body }).then(() => { setSubject(''); setBody(''); notify('success', 'Ticket created.'); load(); }).catch(error => notify('error', error.message));
  }
  async function reply(ticket: Ticket) {
    if (!replyText.trim()) return;
    await api.updateTicket(ticket.id, { note: replyText }).then(() => { setReplyText(''); load(); }).catch(error => notify('error', error.message));
  }
  async function ticketAction(ticket: Ticket, action: 'close' | 'reopen') {
    await api.updateTicket(ticket.id, { action }).then(load).catch(error => notify('error', error.message));
  }
  async function staffAction(ticket: Ticket, action: 'claim' | 'close' | 'reopen' | 'delete' | 'ban') {
    const task = action === 'delete' ? api.deleteTicket(ticket.id) : api.updateTicket(ticket.id, { action });
    await task.then(() => { notify('success', `Ticket ${action} complete.`); if (action === 'delete') setSelected(null); load(); }).catch(error => notify('error', error.message));
  }
  async function download(ticket: Ticket) {
    await api.downloadTicket(ticket.id).then(text => shareTextFile(`zevryl-ticket-${ticket.id}.txt`, text, notify)).catch(error => notify('error', error.message));
  }
  if (selected) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.panelHeader}>
          <Pressable style={styles.backButton} onPress={() => setSelected(null)}><Ionicons name="chevron-back" size={24} color="#E6C07A" /></Pressable>
          <View style={styles.flex}><Text style={styles.heroSmall}>Ticket #{selected.id.slice(0, 8)}</Text><Text style={styles.muted}>{selected.subject}</Text></View>
          <TicketStatusPill status={selected.status} />
        </View>
        <GlassCard>
          <Text style={styles.cardTitle}>Ticket Chat</Text>
          <Text style={styles.meta}>{selected.type} - Created {new Date(selected.createdAt).toLocaleString()}</Text>
          <View style={styles.ticketChat}>
            <View style={styles.ticketReply}><Text style={styles.messageName}>{user.displayName}</Text><Text style={styles.body}>{selected.body}</Text></View>
            {(selected.updates || []).map(update => <View key={`${update.at}-${update.by}`} style={styles.ticketReply}><Text style={styles.messageName}>{update.by}</Text><Text style={styles.body}>{update.note}</Text><Text style={styles.meta}>{new Date(update.at).toLocaleString()}</Text></View>)}
          </View>
          {selected.status !== 'closed' ? <Field icon="chatbubble" placeholder="Reply in ticket" value={replyText} onChangeText={setReplyText} multiline /> : <Text style={styles.muted}>This ticket is closed. Reopen it to send another reply.</Text>}
          <View style={styles.mediaActions}>
            {selected.status !== 'closed' ? <SecondaryButton label="Reply" icon="send" onPress={() => reply(selected)} /> : null}
            {elevated && mode === 'team' ? <SecondaryButton label="Claim" icon="hand-left" onPress={() => staffAction(selected, 'claim')} /> : null}
            <SecondaryButton label="Download Chat" icon="download" onPress={() => download(selected)} />
            {selected.status !== 'closed' ? <SecondaryButton label="Close" icon="checkmark" onPress={() => ticketAction(selected, 'close')} /> : <SecondaryButton label="Reopen" icon="refresh" onPress={() => ticketAction(selected, 'reopen')} />}
            {elevated && mode === 'team' && selected.targetUserId ? <SecondaryButton label="Ban" icon="ban" onPress={() => staffAction(selected, 'ban')} /> : null}
            {elevated && mode === 'team' ? <SecondaryButton label="Delete" icon="trash" onPress={() => staffAction(selected, 'delete')} /> : null}
          </View>
        </GlassCard>
      </ScrollView>
    );
  }
  const orderedTickets = [...tickets.data.filter(ticket => ticket.status !== 'closed'), ...tickets.data.filter(ticket => ticket.status === 'closed')];
  const orderedTeamTickets = [...teamQueue.data.tickets.filter(ticket => ticket.status !== 'closed'), ...teamQueue.data.tickets.filter(ticket => ticket.status === 'closed')];
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.dashboardHeader}>
        {elevated ? <IconButton icon="menu" onPress={() => setMenuOpen(true)} /> : <View style={styles.spacer} />}
        <View style={styles.flex}>
          <Text style={styles.heroSmall}>Ticket Center</Text>
          <Text style={styles.muted}>{mode === 'team' ? 'Team queue' : `Tickets for ${user.displayName}`}</Text>
        </View>
        <IconButton icon="refresh" onPress={load} />
      </View>
      {mode === 'mine' ? (
        <>
          <GlassCard>
            <Text style={styles.cardTitle}>New Ticket</Text>
            <DropdownButton label="Ticket type" value={type[0].toUpperCase() + type.slice(1)} icon="ticket" onPress={() => setTypeMenuOpen(true)} />
            <Field icon="bookmark" placeholder="Subject" value={subject} onChangeText={setSubject} />
            <Field icon="document-text" placeholder="Describe what happened" value={body} onChangeText={setBody} multiline />
            <PrimaryButton label="Create Ticket" icon="send" onPress={create} />
          </GlassCard>
          {tickets.loading ? <LoadingState /> : tickets.error ? <ErrorState message={tickets.error} onRetry={load} /> : orderedTickets.map(ticket => (
            <Pressable key={ticket.id} onPress={() => setSelected(ticket)}>
              <GlassCard>
                <View style={styles.postTop}><Text style={styles.cardTitle}>Ticket #{ticket.id.slice(0, 8)}</Text><TicketStatusPill status={ticket.status} /></View>
                <Text style={styles.body}>{ticket.subject}</Text>
                <Text style={styles.muted}>{ticket.type} - {new Date(ticket.createdAt).toLocaleDateString()}</Text>
                <View style={styles.ticketIconRow}><Ionicons name="chatbubbles" size={16} color="#E6C07A" /><Text style={styles.meta}>{ticket.updates?.length || 0} update(s)</Text></View>
              </GlassCard>
            </Pressable>
          ))}
          {tickets.data.length === 0 && !tickets.loading && <EmptyState title="No tickets" body={`No tickets for ${user.displayName}.`} />}
        </>
      ) : (
        <>
          <StatsGrid values={[['Tickets', String(teamQueue.data.tickets.length)], ['Reports', String(teamQueue.data.reports.length)], ['Open', String(teamQueue.data.tickets.filter(ticket => ticket.status === 'open').length)], ['Reviewing', String(teamQueue.data.tickets.filter(ticket => ticket.status === 'reviewing').length)]]} />
          {teamQueue.loading ? <LoadingState /> : teamQueue.error ? <ErrorState message={teamQueue.error} onRetry={load} /> : orderedTeamTickets.map(ticket => (
            <Pressable key={ticket.id} onPress={() => setSelected(ticket)}>
              <GlassCard>
                <View style={styles.postTop}><Text style={styles.cardTitle}>Ticket #{ticket.id.slice(0, 8)}</Text><TicketStatusPill status={ticket.status} /></View>
                <Text style={styles.body}>{ticket.subject}</Text>
                <Text style={styles.muted}>{ticket.type} - {new Date(ticket.createdAt).toLocaleDateString()}</Text>
                <View style={styles.ticketIconRow}><Ionicons name="person" size={16} color="#E6C07A" /><Text style={styles.meta}>{ticket.claimedBy ? 'Claimed' : 'Unclaimed'}</Text></View>
                <View style={styles.ticketActions}>
                  <SecondaryButton label="Claim" icon="hand-left" onPress={() => staffAction(ticket, 'claim')} />
                  <SecondaryButton label="Reply" icon="chatbubble" onPress={() => setSelected(ticket)} />
                  <SecondaryButton label="Download" icon="download" onPress={() => download(ticket)} />
                  {ticket.status !== 'closed' ? <SecondaryButton label="Close" icon="checkmark" onPress={() => staffAction(ticket, 'close')} /> : <SecondaryButton label="Reopen" icon="refresh" onPress={() => staffAction(ticket, 'reopen')} />}
                  {ticket.targetUserId ? <SecondaryButton label="Ban" icon="ban" onPress={() => staffAction(ticket, 'ban')} /> : null}
                  <SecondaryButton label="Delete" icon="trash" onPress={() => staffAction(ticket, 'delete')} />
                </View>
              </GlassCard>
            </Pressable>
          ))}
          {teamQueue.data.reports.map(report => <GlassCard key={report.id}><View style={styles.postTop}><Text style={styles.cardTitle}>Report #{report.id.slice(0, 8)}</Text><Text style={styles.badge}>{report.status}</Text></View><Text style={styles.body}>{report.reason}</Text><Text style={styles.muted}>{report.type} - {new Date(report.createdAt).toLocaleString()}</Text>{report.proofUrl ? <Pressable onPress={() => openLink(report.proofUrl)}><Text style={styles.link}>Open proof</Text></Pressable> : null}</GlassCard>)}
          {teamQueue.data.tickets.length === 0 && teamQueue.data.reports.length === 0 && !teamQueue.loading && <EmptyState title="No team tickets" body="The ticket queue is clear." />}
        </>
      )}
      <ChoiceModal visible={typeMenuOpen} title="Choose Ticket Type" items={(['support', 'report', 'recovery', 'bug'] as const).map(item => ({ key: item, label: item[0].toUpperCase() + item.slice(1) }))} selected={type} onChoose={(key) => { setType(key as Ticket['type']); setTypeMenuOpen(false); }} onClose={() => setTypeMenuOpen(false)} />
      <ChoiceModal visible={menuOpen} title="Ticket Menu" items={[{ key: 'mine', label: 'My Tickets', icon: 'ticket' }, { key: 'team', label: 'Team Queue', icon: 'briefcase' }]} selected={mode} onChoose={(key) => { setMode(key as typeof mode); setSelected(null); setMenuOpen(false); }} onClose={() => setMenuOpen(false)} />
    </ScrollView>
  );
}

function TicketStatusPill({ status }: { status: Ticket['status'] }) {
  const closed = status === 'closed' || status === 'resolved';
  return <View style={[styles.ticketStatusPill, closed ? styles.ticketStatusClosed : styles.ticketStatusOpen]}><Text style={styles.ticketStatusText}>{closed ? 'Closed' : status === 'reviewing' ? 'Reviewing' : 'Open'}</Text></View>;
}

function AuditLogRow({ item, compactAction }: { item: AuditLog; compactAction?: string }) {
  const actor = item.actorEmail || item.actorName || item.actorId || 'system';
  const metadata = item.metadata && Object.keys(item.metadata).length > 0 ? JSON.stringify(item.metadata) : 'No extra data';
  return (
    <View style={styles.manageRow}>
      <View style={styles.logIcon}><Ionicons name="receipt" size={18} color="#E6C07A" /></View>
      <View style={styles.flex}>
        <Text style={styles.body}>{actor}</Text>
        <Text style={styles.meta}>{compactAction || item.action} - {item.targetType} - {new Date(item.createdAt).toLocaleString()}</Text>
        <Text style={styles.meta}>Data: {metadata}</Text>
      </View>
    </View>
  );
}

function TicketScreen({ user, notify }: { user: User; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [tickets, setTickets] = useState<Loadable<Ticket[]>>({ loading: true, data: [] });
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [ticketReplies, setTicketReplies] = useState<Record<string, string>>({});
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [type, setType] = useState<Ticket['type']>('support');
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
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
    const note = ticketReplies[ticket.id] || '';
    if (!note.trim()) return;
    await api.updateTicket(ticket.id, { note })
      .then(() => { setTicketReplies(prev => ({ ...prev, [ticket.id]: '' })); load(); })
      .catch(error => notify('error', error.message));
  }
  const openTickets = tickets.data.filter(ticket => ticket.status !== 'closed');
  const closedTickets = tickets.data.filter(ticket => ticket.status === 'closed');
  const orderedTickets = [...openTickets, ...closedTickets];
  const selectedTicket = orderedTickets.find(ticket => ticket.id === selectedTicketId);
  if (selectedTicket) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.panelHeader}>
          <Pressable style={styles.backButton} onPress={() => setSelectedTicketId(null)}><Ionicons name="chevron-back" size={24} color="#E6C07A" /></Pressable>
          <View style={styles.flex}><Text style={styles.heroSmall}>Ticket #{selectedTicket.id.slice(0, 8)}</Text><Text style={styles.muted}>{selectedTicket.subject}</Text></View>
          <TicketStatusPill status={selectedTicket.status} />
        </View>
        <GlassCard>
          <Text style={styles.cardTitle}>Ticket Chat</Text>
          <Text style={styles.meta}>{selectedTicket.type} - Created {new Date(selectedTicket.createdAt).toLocaleString()}</Text>
          <View style={styles.ticketChat}>
            <View style={styles.ticketReply}><Text style={styles.messageName}>{user.displayName}</Text><Text style={styles.body}>{selectedTicket.body}</Text></View>
            {(selectedTicket.updates || []).map(update => <View key={`${update.at}-${update.by}`} style={styles.ticketReply}><Text style={styles.messageName}>{update.by}</Text><Text style={styles.body}>{update.note}</Text><Text style={styles.meta}>{new Date(update.at).toLocaleString()}</Text></View>)}
          </View>
          {selectedTicket.status !== 'closed' ? <Field icon="chatbubble" placeholder="Reply in ticket" value={ticketReplies[selectedTicket.id] || ''} onChangeText={value => setTicketReplies(prev => ({ ...prev, [selectedTicket.id]: value }))} multiline /> : <Text style={styles.muted}>This ticket is closed. Reopen it to send another reply.</Text>}
          <View style={styles.mediaActions}>
            {selectedTicket.status !== 'closed' ? <SecondaryButton label="Reply" icon="send" onPress={() => reply(selectedTicket)} /> : null}
            <SecondaryButton label="Download Chat" icon="download" onPress={() => download(selectedTicket)} />
            {selectedTicket.status !== 'closed' ? <SecondaryButton label="Close" icon="checkmark" onPress={() => ticketAction(selectedTicket, 'close')} /> : <SecondaryButton label="Reopen" icon="refresh" onPress={() => ticketAction(selectedTicket, 'reopen')} />}
          </View>
        </GlassCard>
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <SectionTitle title="Tickets & Reports" action="Refresh" onPress={load} />
      <GlassCard>
        <Text style={styles.cardTitle}>New Ticket</Text>
        <DropdownButton label="Ticket type" value={type[0].toUpperCase() + type.slice(1)} icon="ticket" onPress={() => setTypeMenuOpen(true)} />
        <Field icon="bookmark" placeholder="Subject" value={subject} onChangeText={setSubject} />
        <Field icon="document-text" placeholder="Describe what happened" value={body} onChangeText={setBody} multiline />
        <PrimaryButton label="Create Ticket" icon="send" onPress={create} />
      </GlassCard>
      {tickets.loading ? <LoadingState /> : tickets.error ? <ErrorState message={tickets.error} onRetry={load} /> : orderedTickets.map(ticket => (
        <GlassCard key={ticket.id}>
          <View style={styles.postTop}><Text style={styles.cardTitle}>{ticket.subject}</Text><Text style={styles.badge}>{ticket.status}</Text></View>
          <Text style={styles.muted}>{ticket.type} · {new Date(ticket.createdAt).toLocaleDateString()}</Text>
          <View style={styles.ticketChat}><Text style={styles.messageName}>{user.displayName}</Text><Text style={styles.body}>{ticket.body}</Text>{(ticket.updates || []).map(update => <View key={`${update.at}-${update.by}`} style={styles.ticketReply}><Text style={styles.messageName}>Staff/User</Text><Text style={styles.body}>{update.note}</Text><Text style={styles.meta}>{new Date(update.at).toLocaleString()}</Text></View>)}</View>
          {ticket.status !== 'closed' ? <Field icon="chatbubble" placeholder="Reply in ticket" value={ticketReplies[ticket.id] || ''} onChangeText={value => setTicketReplies(prev => ({ ...prev, [ticket.id]: value }))} multiline /> : <Text style={styles.muted}>This ticket is closed. Reopen it to send another reply.</Text>}
          {ticket.proofUrl ? <Pressable onPress={() => openLink(ticket.proofUrl)}><Text style={styles.link}>Open proof</Text></Pressable> : null}
          <View style={styles.mediaActions}>
            {ticket.status !== 'closed' ? <SecondaryButton label="Reply" icon="send" onPress={() => reply(ticket)} /> : null}
            <SecondaryButton label="Download" icon="download" onPress={() => download(ticket)} />
            {ticket.status !== 'closed' ? <SecondaryButton label="Close" icon="checkmark" onPress={() => ticketAction(ticket, 'close')} /> : <SecondaryButton label="Reopen" icon="refresh" onPress={() => ticketAction(ticket, 'reopen')} />}
          </View>
        </GlassCard>
      ))}
      {tickets.data.length === 0 && !tickets.loading && <EmptyState title="No tickets" body={`No tickets for ${user.displayName}.`} />}
    </ScrollView>
  );
}

function StaffScreen({ user, notify }: { user: User; notify: (tone: 'error' | 'success' | 'info', text: string) => void }) {
  const [queue, setQueue] = useState<Loadable<{ reports: Report[]; tickets: Ticket[] }>>({ loading: true, data: { reports: [], tickets: [] } });
  const [page, setPage] = useState<'reports' | 'logs' | 'mod' | 'analytics'>('reports');
  const [menuOpen, setMenuOpen] = useState(false);
  const [staffNote, setStaffNote] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [logs, setLogs] = useState<Loadable<AuditLog[]>>({ loading: true, data: [] });
  const [analytics, setAnalytics] = useState<StaffAnalytics | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState<User[]>([]);
  const [moderationTarget, setModerationTarget] = useState<User | null>(null);
  const [moderationAction, setModerationAction] = useState<'mute' | 'ban' | 'unban'>('mute');
  const [moderationHours, setModerationHours] = useState('8');
  const [moderationReason, setModerationReason] = useState('');
  const load = () => {
    api.reports().then(data => setQueue({ loading: false, data })).catch(error => { setQueue({ loading: false, data: { reports: [], tickets: [] }, error: error.message }); notify('error', error.message); });
    api.staffLogs().then(data => setLogs({ loading: false, data })).catch(error => setLogs({ loading: false, data: [], error: error.message }));
    api.staffAnalytics().then(setAnalytics).catch(() => undefined);
  };
  useEffect(() => { load(); }, []);
  const reports = queue.data.reports;
  const tickets = queue.data.tickets;
  const staffPages: Array<[typeof page, string, keyof typeof Ionicons.glyphMap]> = [
    ['reports', 'Reports', 'flag'],
    ['logs', 'Logs', 'list'],
    ['mod', 'Mod', 'hammer'],
    ['analytics', 'Analytics', 'analytics']
  ];
  async function staffAction(ticket: Ticket, action: 'claim' | 'close' | 'reopen' | 'delete' | 'ban') {
    const task = action === 'delete' ? api.deleteTicket(ticket.id) : api.updateTicket(ticket.id, { action });
    await task.then(() => { notify('success', `Ticket ${action} complete.`); load(); }).catch(error => notify('error', error.message));
  }
  async function searchModerationUsers() {
    if (!userSearch.trim()) return setUserResults([]);
    await api.searchUsers(userSearch).then(setUserResults).catch(error => notify('error', error.message));
  }
  async function runModeration() {
    if (!moderationTarget) return notify('error', 'Select a user first.');
    if (!moderationReason.trim()) return notify('error', 'Add a reason for the moderation log.');
    await api.moderateUser({
      userId: moderationTarget.id,
      action: moderationAction,
      hours: Math.max(1, Number(moderationHours) || 8),
      reason: moderationReason.trim()
    }).then(() => {
      notify('success', `${moderationAction} applied to ${moderationTarget.displayName}.`);
      setModerationReason('');
      load();
    }).catch(error => notify('error', error.message));
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
  if (user.role !== 'staff' && user.role !== 'admin') return <LockedScreen title="Staff only" />;
  const activeStaffTicket = selectedTicket ? tickets.find(ticket => ticket.id === selectedTicket.id) || selectedTicket : null;
  if (activeStaffTicket) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.panelHeader}>
          <Pressable style={styles.backButton} onPress={() => setSelectedTicket(null)}><Ionicons name="chevron-back" size={24} color="#E6C07A" /></Pressable>
          <View style={styles.flex}><Text style={styles.heroSmall}>Ticket #{activeStaffTicket.id.slice(0, 8)}</Text><Text style={styles.muted}>{activeStaffTicket.subject}</Text></View>
          <TicketStatusPill status={activeStaffTicket.status} />
        </View>
        <GlassCard>
          <Text style={styles.cardTitle}>Staff Ticket Chat</Text>
          <Text style={styles.meta}>{activeStaffTicket.type} - Created {new Date(activeStaffTicket.createdAt).toLocaleString()}</Text>
          <View style={styles.ticketChat}>
            <View style={styles.ticketReply}><Text style={styles.messageName}>User</Text><Text style={styles.body}>{activeStaffTicket.body}</Text></View>
            {(activeStaffTicket.updates || []).map(update => <View key={`${update.at}-${update.by}`} style={styles.ticketReply}><Text style={styles.messageName}>{update.by}</Text><Text style={styles.body}>{update.note}</Text><Text style={styles.meta}>{new Date(update.at).toLocaleString()}</Text></View>)}
          </View>
          <Field icon="chatbubble" placeholder="Reply as staff" value={staffNote} onChangeText={setStaffNote} multiline />
          <View style={styles.ticketActions}>
            <SecondaryButton label="Reply" icon="send" onPress={() => sendStaffNote(activeStaffTicket)} />
            <SecondaryButton label="Claim" icon="hand-left" onPress={() => staffAction(activeStaffTicket, 'claim')} />
            <SecondaryButton label="Close" icon="checkmark" onPress={() => staffAction(activeStaffTicket, 'close')} />
            <SecondaryButton label="Reopen" icon="refresh" onPress={() => staffAction(activeStaffTicket, 'reopen')} />
            <SecondaryButton label="Download Chat" icon="download" onPress={() => download(activeStaffTicket)} />
            <SecondaryButton label="Delete" icon="trash" onPress={() => staffAction(activeStaffTicket, 'delete')} />
          </View>
        </GlassCard>
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.dashboardHeader}>
        <IconButton icon="menu" onPress={() => setMenuOpen(true)} />
        <View style={styles.flex}>
          <Text style={styles.heroSmall}>Staff Dashboard</Text>
          <Text style={styles.muted}>{staffPages.find(([key]) => key === page)?.[1]}</Text>
        </View>
        <IconButton icon="refresh" onPress={load} />
      </View>
      {page === 'reports' && <>
        <StatsGrid values={[['Tickets', String(tickets.length)], ['Reports', String(reports.length)], ['Open', String(tickets.filter(r => r.status === 'open').length)], ['Reviewing', String(tickets.filter(r => r.status === 'reviewing').length)]]} />
        {queue.loading ? <LoadingState /> : queue.error ? <ErrorState message={queue.error} onRetry={load} /> : tickets.map(ticket => <Pressable key={ticket.id} onPress={() => setSelectedTicket(ticket)}><GlassCard><View style={styles.postTop}><Text style={styles.cardTitle}>Ticket #{ticket.id.slice(0, 8)}</Text><TicketStatusPill status={ticket.status} /></View><Text style={styles.body}>{ticket.subject}</Text><Text style={styles.muted}>{ticket.type} - {new Date(ticket.createdAt).toLocaleDateString()}</Text></GlassCard></Pressable>)}
        {reports.map(report => <GlassCard key={report.id}><View style={styles.postTop}><Text style={styles.cardTitle}>Report #{report.id.slice(0, 8)}</Text><Text style={styles.badge}>{report.status}</Text></View><Text style={styles.body}>{report.reason}</Text><Text style={styles.muted}>{report.type} - {new Date(report.createdAt).toLocaleString()}</Text>{report.proofUrl ? <Pressable onPress={() => openLink(report.proofUrl)}><Text style={styles.link}>Open proof</Text></Pressable> : null}</GlassCard>)}
        {tickets.length === 0 && reports.length === 0 && !queue.loading && <EmptyState title="No reports" body="The moderation queue is clear." />}
      </>}
      {page === 'logs' && <GlassCard><Text style={styles.cardTitle}>Staff Logs</Text><Text style={styles.muted}>Admin account activity is hidden here.</Text>{logs.loading ? <LoadingState /> : logs.error ? <ErrorState message={logs.error} onRetry={load} /> : logs.data.map(item => <AuditLogRow key={item.id} item={item} />)}{!logs.loading && logs.data.length === 0 ? <Text style={styles.muted}>No staff logs yet.</Text> : null}</GlassCard>}
      {page === 'mod' && <GlassCard><Text style={styles.cardTitle}>Ban / Mute</Text><Field icon="search" placeholder="Search users" value={userSearch} onChangeText={setUserSearch} autoCapitalize="none" /><PrimaryButton label="Search Users" icon="search" onPress={searchModerationUsers} />{userResults.map(item => <Pressable key={item.id} style={styles.memberPick} onPress={() => setModerationTarget(item)}><View style={styles.flex}><Text style={styles.body}>{item.displayName}</Text><Text style={styles.meta}>@{item.tag || item.username}{item.mutedUntil ? ` - muted until ${new Date(item.mutedUntil).toLocaleString()}` : ''}</Text></View><Ionicons name={moderationTarget?.id === item.id ? 'radio-button-on' : 'radio-button-off'} size={22} color="#CDA16A" /></Pressable>)}<View style={styles.segment}>{(['mute', 'ban', 'unban'] as const).map(item => <Pressable key={item} style={[styles.segmentItem, moderationAction === item && styles.segmentActive]} onPress={() => setModerationAction(item)}><Text style={styles.segmentText}>{item}</Text></Pressable>)}</View>{moderationAction === 'mute' ? <Field icon="timer" placeholder="Duration hours" value={moderationHours} onChangeText={setModerationHours} keyboardType="number-pad" /> : null}<Field icon="document-text" placeholder="Reason" value={moderationReason} onChangeText={setModerationReason} multiline /><PrimaryButton label="Apply" icon="hammer" onPress={runModeration} /></GlassCard>}
      {page === 'analytics' && <><StatsGrid values={[['Daily Reports', String(analytics?.dailyReports.at(-1)?.count ?? 0)], ['Daily Bans/Mutes', String(analytics?.dailyBansMutes.at(-1)?.count ?? 0)], ['Reports Total', String(reports.length)], ['Tickets Total', String(tickets.length)]]} /><GraphCard title="Daily Reports" data={analytics?.dailyReports ?? []} /><GraphCard title="Daily Bans/Mutes" data={analytics?.dailyBansMutes ?? []} /></>}
      <ChoiceModal visible={menuOpen} title="Staff Menu" items={staffPages.map(([key, label, icon]) => ({ key, label, icon }))} selected={page} onChoose={(key) => { setPage(key as typeof page); setMenuOpen(false); }} onClose={() => setMenuOpen(false)} />
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

function BottomNav({ tab, setTab, bottom }: { tab: AppTab; setTab: (tab: AppTab) => void; bottom: number }) {
  const items: Array<[AppTab, keyof typeof Ionicons.glyphMap]> = [['home', 'home'], ['friends', 'people'], ['chats', 'chatbubbles'], ['groups', 'grid'], ['tickets', 'ticket'], ['settings', 'settings']];
  return (
    <BlurView intensity={70} tint="dark" style={[styles.nav, { bottom }]}>
      {items.map(([key, icon]) => <Pressable key={key} onPress={() => setTab(key)} style={styles.navItem}><Ionicons name={icon} size={21} color={tab === key ? '#E6C07A' : '#9AA391'} /></Pressable>)}
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
    voice: 'Call and video controls are available in DMs and groups. Secure room access is handled automatically.',
    security: '2FA, login cooldowns, and recovery controls help protect your account.'
  })[panel];
}

function StatusPill({ presence }: { presence: User['presence'] }) {
  const meta = presenceMeta[presence];
  return <View style={styles.rolePill}><Ionicons name={meta.icon} size={11} color={meta.color} /><Text style={styles.roleText}>{meta.label}</Text></View>;
}

function BadgeChip({ badge }: { badge: string }) {
  const [visible, setVisible] = useState(false);
  return <><Pressable onPress={() => setVisible(true)} style={styles.badgeChip}><Ionicons name={badgeIcons[badge] || 'ribbon'} size={14} color="#E6C07A" /></Pressable><BadgeToast badge={badge} visible={visible} onClose={() => setVisible(false)} /></>;
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
  const accent = user.profileColor || '#7D8B58';
  return user.avatarUrl
    ? <Image source={{ uri: user.avatarUrl }} style={[styles.avatarImage, { width: size, height: size, borderRadius: radius, borderColor: accent }]} />
    : <View style={[styles.avatar, { width: size, height: size, borderRadius: radius, borderColor: accent, backgroundColor: `${accent}44` }]}><Text style={styles.avatarText}>{user.displayName.slice(0, 1).toUpperCase()}</Text></View>;
}

function topPriorityBadge(badges: string[]) {
  return badgePriority.find(badge => badges.includes(badge)) || badges[0];
}

function normalizeBadges(badges: string[]) {
  return badges.length ? badges : ['Member'];
}

function CallSheet({
  call,
  conversation,
  currentUser,
  onJoin,
  onLeave,
  onToggleMute,
  onToggleDeafen,
  onToggleVideo,
  onFlipCamera
}: {
  call: CallState | null;
  conversation: Conversation | null;
  currentUser: User;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleVideo: () => void;
  onFlipCamera: () => void;
}) {
  if (!call || !conversation) return null;
  const title = call.kind === 'voice' ? 'Voice Call' : 'Video Call';
  const possibleMembers = conversation.participants.length;
  const connectedCount = call.joined ? 1 : 0;
  return (
    <Modal visible transparent animationType="slide">
      <View style={styles.sheetBackdrop}>
        <View style={styles.callSheet}>
          <View style={styles.editorHeader}>
            <Text style={[styles.cardTitle, { flex: 1 }]}>{title}</Text>
            <IconButton icon="close" onPress={onLeave} />
          </View>
          <Text style={styles.muted}>{conversation.title}</Text>
          <View style={styles.callStatusPanel}>
            <Ionicons name={call.kind === 'voice' ? 'call' : 'videocam'} size={30} color="#E6C07A" />
            <Text style={styles.heroSmall}>{call.joined ? 'In VC' : 'Invite Sent'}</Text>
            <Text style={styles.muted}>{connectedCount} connected - {possibleMembers} member{possibleMembers === 1 ? '' : 's'} can join</Text>
            {call.joined ? <Text style={styles.meta}>{call.muted ? 'Muted' : 'Mic on'} - {call.deafened ? 'Deafened' : 'Audio on'}</Text> : null}
          </View>
          {call.joined && call.url && call.token ? <CallMediaRoom call={call} onLeave={onLeave} /> : null}
          <View style={styles.memberListCompact}>
            {conversation.participants.map(member => (
              <View key={member.id} style={styles.callMemberRow}>
                <UserAvatar user={member} size={34} />
                <View style={styles.flex}>
                  <View style={styles.callMemberNameRow}>
                    <Text style={styles.body}>{member.displayName}</Text>
                    {call.joined && member.id === currentUser.id && call.muted ? <Ionicons name="mic-off" size={15} color="#FFAAA8" /> : null}
                    {call.joined && member.id === currentUser.id && call.deafened ? <Ionicons name="volume-mute" size={15} color="#FFAAA8" /> : null}
                  </View>
                  <Text style={styles.meta}>{call.joined && member.id === currentUser.id ? 'In VC' : 'Invited'}</Text>
                </View>
                <StatusPill presence={member.presence} />
              </View>
            ))}
          </View>
          {call.joined ? (
            <View style={styles.callControls}>
              <Pressable style={[styles.callControlButton, call.muted && styles.callControlActive]} onPress={onToggleMute}>
                <Ionicons name={call.muted ? 'mic-off' : 'mic'} size={20} color="#F4F0E6" />
                <Text style={styles.callControlText}>{call.muted ? 'Muted' : 'Mute'}</Text>
              </Pressable>
              <Pressable style={[styles.callControlButton, call.deafened && styles.callControlActive]} onPress={onToggleDeafen}>
                <Ionicons name={call.deafened ? 'volume-mute' : 'volume-high'} size={20} color="#F4F0E6" />
                <Text style={styles.callControlText}>{call.deafened ? 'Deafened' : 'Deafen'}</Text>
              </Pressable>
              {call.kind === 'video' ? (
                <Pressable style={[styles.callControlButton, !call.videoEnabled && styles.callControlActive]} onPress={onToggleVideo}>
                  <Ionicons name={call.videoEnabled ? 'videocam' : 'videocam-off'} size={20} color="#F4F0E6" />
                  <Text style={styles.callControlText}>{call.videoEnabled ? 'Video On' : 'Video Off'}</Text>
                </Pressable>
              ) : null}
              {call.kind === 'video' ? (
                <Pressable style={styles.callControlButton} onPress={onFlipCamera}>
                  <Ionicons name="camera-reverse" size={20} color="#F4F0E6" />
                  <Text style={styles.callControlText}>{call.cameraFacing === 'front' ? 'Front' : 'Back'}</Text>
                </Pressable>
              ) : null}
              <Pressable style={[styles.callControlButton, styles.callLeaveButton]} onPress={onLeave}>
                <Ionicons name="call" size={20} color="#fff" />
                <Text style={styles.callControlText}>Leave</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.mediaActions}>
            {!call.joined ? <PrimaryButton label="Join Call" icon={call.kind === 'voice' ? 'call' : 'videocam'} onPress={onJoin} /> : null}
            <SecondaryButton label={call.joined ? 'Leave Call' : 'Cancel'} icon="close" onPress={onLeave} />
          </View>
          {!call.url || !call.token ? <Text style={styles.errorText}>LiveKit is missing on the backend. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET on the API server.</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

function CallMediaRoom({ call, onLeave }: { call: CallState; onLeave: () => void }) {
  return (
    <LiveKitRoom
      serverUrl={call.url}
      token={call.token}
      connect={call.joined}
      audio={!call.muted && !call.deafened}
      video={call.kind === 'video' && call.videoEnabled}
      options={{ adaptiveStream: { pixelDensity: 'screen' } }}
      onDisconnected={onLeave}
    >
      <LiveKitVideoGrid video={call.kind === 'video'} />
    </LiveKitRoom>
  );
}

function LiveKitVideoGrid({ video }: { video: boolean }) {
  const tracks = useTracks([Track.Source.Camera]);
  if (!video) {
    return (
      <View style={styles.audioOnlyPanel}>
        <Ionicons name="volume-high" size={22} color="#E6C07A" />
        <Text style={styles.body}>Voice channel connected</Text>
      </View>
    );
  }
  return (
    <View style={styles.liveKitGrid}>
      {tracks.length === 0 ? <Text style={styles.muted}>Waiting for video...</Text> : tracks.map((track, index) => (
        isTrackReference(track)
          ? <VideoTrack key={track.publication.trackSid || `${track.participant.identity}-${index}`} trackRef={track} style={styles.liveKitVideoTile} />
          : <View key={`placeholder-${index}`} style={styles.liveKitVideoTile}><Text style={styles.muted}>Camera off</Text></View>
      ))}
    </View>
  );
}

function MemberSheet({ visible, conversation, onClose }: { visible: boolean; conversation: Conversation | null; onClose: () => void }) {
  if (!conversation) return null;
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.sheetBackdrop}>
        <View style={styles.editorPanel}>
          <View style={styles.editorHeader}><Text style={[styles.cardTitle, { flex: 1 }]}>Members</Text><IconButton icon="close" onPress={onClose} /></View>
          <Text style={styles.muted}>{conversation.title} - {conversation.participants.length} members</Text>
          <ScrollView style={styles.memberListCompact}>
            {conversation.participants.map(member => (
              <View key={member.id} style={styles.memberPick}>
                <UserAvatar user={member} size={36} />
                <View style={styles.flex}>
                  <Text style={styles.body}>{member.displayName}</Text>
                  <Text style={styles.meta}>@{member.tag || member.username}</Text>
                </View>
                <StatusPill presence={member.presence} />
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ProfileSheet({
  user,
  currentUser,
  reportReason,
  reportProof,
  setReportReason,
  setReportProof,
  onClose,
  onMessage,
  canUnfriend = false,
  onMute,
  onReport
}: {
  user: User | null;
  currentUser?: User;
  reportReason: string;
  reportProof: string;
  setReportReason: (value: string) => void;
  setReportProof: (value: string) => void;
  onClose: () => void;
  onMessage?: (user: User) => void;
  canUnfriend?: boolean;
  onMute: (action: 'mute' | 'block' | 'unfriend', hours?: number) => void;
  onReport: () => void;
}) {
  const [showReport, setShowReport] = useState(false);
  const [muteMenuOpen, setMuteMenuOpen] = useState(false);
  if (!user) return null;
  const own = currentUser ? user.id === currentUser.id : false;
  const theme = profileThemes[user.profileTheme || 'terria'];
  async function pickReportProof() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.74, base64: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setReportProof(asset.base64 ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}` : asset.uri);
  }
  return (
    <Modal visible transparent animationType="slide">
      <View style={styles.sheetBackdrop}>
        <View style={[styles.profileSheet, { borderColor: theme.color }]}>
          <ScrollView contentContainerStyle={styles.profileSheetContent} keyboardShouldPersistTaps="handled">
            {user.bannerUrl ? <Image source={{ uri: user.bannerUrl }} style={styles.sheetBanner} resizeMode="cover" /> : <View style={[styles.sheetBanner, { backgroundColor: user.profileColor || theme.color }]} />}
            <View style={styles.sheetHeader}>
              <View>
                <Image source={user.avatarUrl ? { uri: user.avatarUrl } : logo} style={styles.sheetAvatar} />
                {user.customStatus ? <View style={styles.sheetStatusBubble}><Text style={styles.profileStatusText}>{user.customStatus}</Text></View> : null}
              </View>
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
                <View style={styles.profileActionGrid}>
                  {onMessage ? <SecondaryButton label="Message" icon="chatbubble" onPress={() => onMessage(user)} /> : null}
                  <SecondaryButton label="Report" icon="flag" onPress={() => setShowReport(true)} />
                  <SecondaryButton label="Block" icon="ban" onPress={() => onMute('block')} />
                  <SecondaryButton label="Mute" icon="notifications-off" onPress={() => setMuteMenuOpen(true)} />
                  {canUnfriend ? <SecondaryButton label="Unfriend" icon="person-remove" onPress={() => onMute('unfriend')} /> : null}
                </View>
                <ChoiceModal visible={muteMenuOpen} title="Mute Duration" items={[{ key: '1', label: '1 hour', icon: 'time' }, { key: '8', label: '8 hours', icon: 'moon' }, { key: '24', label: '1 day', icon: 'calendar' }, { key: '168', label: '7 days', icon: 'calendar-number' }]} selected="" onChoose={(key) => { setMuteMenuOpen(false); onMute('mute', Number(key)); }} onClose={() => setMuteMenuOpen(false)} />
                <Modal visible={showReport} transparent animationType="fade">
                  <View style={styles.modalBackdrop}>
                    <View style={styles.announcementModal}>
                      <View style={styles.editorHeader}><Text style={[styles.cardTitle, { flex: 1 }]}>Report {user.displayName}</Text><IconButton icon="close" onPress={() => setShowReport(false)} /></View>
                      <Field icon="warning" placeholder="Report reason" value={reportReason} onChangeText={setReportReason} multiline />
                      <Pressable style={styles.proofUpload} onPress={pickReportProof}>
                        <Ionicons name={reportProof ? 'image' : 'cloud-upload'} size={20} color="#E6C07A" />
                        <Text style={styles.body}>{reportProof ? 'Proof image selected' : 'Upload proof image'}</Text>
                      </Pressable>
                      <PrimaryButton label="Create Report Ticket" icon="flag" onPress={() => { setShowReport(false); onReport(); }} />
                    </View>
                  </View>
                </Modal>
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

function ThemePicker({ value, onChange }: { value: NonNullable<User['profileTheme']>; onChange: (theme: NonNullable<User['profileTheme']>) => void }) {
  return (
    <View style={styles.themePicker}>
      {(Object.keys(profileThemes) as Array<NonNullable<User['profileTheme']>>).map(item => {
        const theme = profileThemes[item];
        return (
          <Pressable key={item} onPress={() => onChange(item)} style={[styles.themeSwatch, value === item && styles.themeSwatchActive]}>
            <LinearGradient colors={theme.colors} style={styles.themeSwatchGradient}>
              <View style={[styles.themeSwatchDot, { backgroundColor: theme.color }]} />
            </LinearGradient>
            <Text style={styles.meta}>{theme.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
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

function DropdownButton({ label, value, icon, onPress }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.dropdownButton}>
      <Ionicons name={icon} size={18} color="#E6C07A" />
      <View style={styles.flex}>
        <Text style={styles.meta}>{label}</Text>
        <Text style={styles.body}>{value}</Text>
      </View>
      <Ionicons name="chevron-down" size={18} color="#AEB8A5" />
    </Pressable>
  );
}

function ChoiceModal({
  visible,
  title,
  items,
  selected,
  onChoose,
  onClose
}: {
  visible: boolean;
  title: string;
  items: Array<{ key: string; label: string; body?: string; icon?: keyof typeof Ionicons.glyphMap }>;
  selected: string;
  onChoose: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.choiceModal}>
          <View style={styles.editorHeader}><Text style={[styles.cardTitle, { flex: 1 }]}>{title}</Text><IconButton icon="close" onPress={onClose} /></View>
          <ScrollView style={{ maxHeight: 320 }}>
            {items.map(item => (
              <Pressable key={item.key} onPress={() => onChoose(item.key)} style={[styles.choiceRow, selected === item.key && styles.choiceRowActive]}>
                <Ionicons name={item.icon || 'ellipse'} size={18} color="#E6C07A" />
                <View style={styles.flex}>
                  <Text style={styles.body}>{item.label}</Text>
                  {item.body ? <Text style={styles.meta}>{item.body}</Text> : null}
                </View>
                {selected === item.key ? <Ionicons name="checkmark" size={18} color="#98D6A1" /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
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
  return <View><Text style={styles.label}>{title}</Text>{users.length === 0 ? <EmptyState title="Empty" body={empty} /> : users.map(user => <GlassCard key={user.id} style={styles.userRowCard}><View style={styles.userRowTop}><UserAvatar user={user} /><View style={styles.flex}><Text style={styles.body}>{user.displayName}</Text><Text style={styles.muted}>@{user.tag || user.username}</Text><StatusPill presence={user.presence} /><View style={styles.badgeRowMini}>{user.badges.slice(0, 3).map(b => <Text key={b} style={styles.badgeMini}>{b}</Text>)}</View></View></View>{right ? <View style={styles.userActionWrap}>{right(user)}</View> : null}</GlassCard>)}</View>;
}

function RequestList({
  title,
  requests,
  person = 'from',
  onProfile,
  accept,
  deny,
  cancel
}: {
  title: string;
  requests: FriendState['incoming'];
  person?: 'from' | 'to';
  onProfile?: (user: User) => void;
  accept?: (id: string) => void;
  deny?: (id: string) => void;
  cancel?: (id: string) => void;
}) {
  return (
    <View>
      <Text style={styles.label}>{title}</Text>
      {requests.length === 0 ? <Text style={styles.muted}>None</Text> : requests.map(req => {
        const visibleUser = person === 'to' ? req.toUser : req.fromUser;
        return (
          <GlassCard key={req.id} style={styles.requestCard}>
            <Pressable onPress={() => onProfile?.(visibleUser)} style={styles.userRowTop}>
              <UserAvatar user={visibleUser} />
              <View style={styles.flex}>
                <Text style={styles.body}>{visibleUser.displayName}</Text>
                <Text style={styles.muted}>@{visibleUser.tag || visibleUser.username}</Text>
                <Text style={styles.muted}>{req.status}</Text>
              </View>
              <Ionicons name="person-circle" size={22} color="#E6C07A" />
            </Pressable>
            <View style={styles.requestActions}>
              {accept && <SecondaryButton label="Accept" icon="checkmark" onPress={() => accept(req.id)} />}
              {deny && <SecondaryButton label="Deny" icon="close" onPress={() => deny(req.id)} />}
              {cancel && <SecondaryButton label="Cancel" icon="trash" onPress={() => cancel(req.id)} />}
            </View>
          </GlassCard>
        );
      })}
    </View>
  );
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
  splash: { flex: 1, alignItems: 'center', justifyContent: 'space-between', padding: 28 },
  splashContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%' },
  splashLogoFrame: { width: 138, height: 138, borderRadius: 34, borderWidth: 1, borderColor: 'rgba(230,192,122,.34)', backgroundColor: 'rgba(11,16,12,.58)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  splashLogo: { width: 104, height: 104 },
  splashWordmark: { width: '78%', maxWidth: 300, height: 76 },
  brandTitle: { color: '#F4F0E6', fontSize: 30, fontWeight: '900', marginTop: 4, letterSpacing: 0 },
  brandSub: { color: '#E6C07A', fontSize: 12, letterSpacing: 2.4, marginTop: 6, fontWeight: '800' },
  splashTagline: { color: '#C9D1BE', fontSize: 15, marginTop: 6, letterSpacing: 0, fontWeight: '600' },
  splashFooter: { gap: 12, paddingBottom: 16, alignItems: 'center' },
  loadingBar: { width: 220, height: 5, backgroundColor: '#20291E', borderRadius: 4, overflow: 'hidden' },
  loadingFill: { width: '68%', height: 5, backgroundColor: 'rgba(230,192,122,.9)', borderRadius: 4 },
  loadingText: { color: '#C4B58E', fontSize: 12, textAlign: 'center', fontWeight: '700', letterSpacing: 0 },
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
  
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  requestActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(218,226,202,.08)', paddingTop: 12 },
  requestCard: { gap: 2 },
  userRowCard: { gap: 12 },
  userRowTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  userActionWrap: { borderTopWidth: 1, borderTopColor: 'rgba(218,226,202,.08)', paddingTop: 10 },
  logIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(230,192,122,.12)', alignItems: 'center', justifyContent: 'center' },
  
  // Icon Button
  iconButton: { width: 40, height: 40, borderRadius: 9, backgroundColor: 'rgba(255,255,255,.06)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,.08)' },
  iconButtonPressed: { backgroundColor: 'rgba(255,255,255,.12)' },
  iconContainer: { width: 42, height: 42, borderRadius: 10, backgroundColor: 'rgba(230,192,122,.12)', alignItems: 'center', justifyContent: 'center' },
  
  badge: { color: '#E6C07A', fontSize: 12, fontWeight: '800', backgroundColor: 'rgba(230,192,122,.12)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, alignSelf: 'flex-start' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  badgeRowMini: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badgeChip: { width: 30, height: 30, backgroundColor: 'rgba(230,192,122,.14)', borderColor: 'rgba(230,192,122,.28)', borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  badgeChipText: { color: '#F4F0E6', fontSize: 12, fontWeight: '800' },
  badgeIcon: { width: 18, height: 18, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(230,192,122,.14)' },
  badgeMini: { color: '#E6C07A', fontSize: 11, fontWeight: '800' },
  
  // Empty & Error States
  empty: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  errorContent: { alignItems: 'center', gap: 12, marginBottom: 12 },
  
  // Member Selection
  memberPick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, paddingHorizontal: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.04)', marginTop: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,.06)' },
  memberListCompact: { maxHeight: 300, marginTop: 10 },
  friendsSelector: { gap: 10, marginTop: 12 },
  friendOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, paddingHorizontal: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,.06)', paddingVertical: 12 },
  friendOptionSelected: { backgroundColor: 'rgba(230,192,122,.12)', borderColor: 'rgba(230,192,122,.3)' },
  friendOptionText: { color: '#E7EBDD', fontSize: 15, fontWeight: '500', flex: 1 },
  
  // Chat & Messages
  chatLayout: { flex: 1, paddingHorizontal: 10, paddingBottom: 0, gap: 8 },
  dmListFull: { padding: 6, gap: 10, paddingBottom: 118 },
  dmCard: { minHeight: 66, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(218,226,202,.13)', backgroundColor: 'rgba(22,30,23,.82)', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dmRail: { width: 122, borderRightWidth: 1, borderColor: 'rgba(218,226,202,.1)', paddingTop: 8, gap: 8 },
  dmItem: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10 },
  dmItemActive: { backgroundColor: 'rgba(230,192,122,.14)' },
  dmTitle: { color: '#F4F0E6', fontWeight: '800', fontSize: 14 },
  emptyRail: { color: '#899486', fontSize: 12 },
  thread: { flex: 1, justifyContent: 'flex-end' },
  threadHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: 'rgba(218,226,202,.1)' },
  threadHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatTools: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  searchInput: { flex: 1, minHeight: 42, color: '#F4F0E6', borderRadius: 10, backgroundColor: '#151D16', paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(218,226,202,.12)' },
  
  messagesContainer: { gap: 10, marginVertical: 14 },
  messageList: { paddingTop: 12, gap: 10, paddingBottom: 12 },
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
  blockedMessage: { minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(230,192,122,.22)', backgroundColor: 'rgba(230,192,122,.08)', paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  blockedMessageText: { color: '#EDE4C8', fontSize: 13, fontWeight: '800', flex: 1 },
  typingText: { color: '#AEB8A5', fontSize: 12, fontWeight: '700', minHeight: 20, paddingHorizontal: 8 },
  messageFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  messageTime: { color: '#899486', fontSize: 12, fontWeight: '600' },
  messageEdited: { color: '#B8A47D', fontSize: 11, fontWeight: '700' },
  messageDelete: { marginTop: 8 },
  messageDeleteText: { color: '#FFAAA8', fontWeight: '700', fontSize: 12 },
  
  gifImage: { width: 190, height: 130, borderRadius: 10, backgroundColor: '#111712' },
  chatImage: { width: 214, height: 150, borderRadius: 10, backgroundColor: '#111712' },
  pickerRow: { flexDirection: 'row', gap: 6, paddingVertical: 8, flexWrap: 'wrap' },
  pickerPanel: { gap: 8, paddingVertical: 7, borderTopWidth: 1, borderColor: 'rgba(218,226,202,.08)', backgroundColor: 'rgba(17,23,18,.96)' },
  pickerButton: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#202A21', alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 22 },
  gifPicker: { flexDirection: 'row', gap: 8, paddingVertical: 10 },
  gifThumb: { width: 80, height: 60, borderRadius: 10, backgroundColor: '#111712' },
  
  chatCard: { gap: 12 },
  composerContainer: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, padding: 14, borderTopWidth: 1, borderColor: 'rgba(255,255,255,.08)', backgroundColor: 'rgba(5,7,11,.92)' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, paddingTop: 6, paddingHorizontal: 2, backgroundColor: 'rgba(17,23,18,.94)', borderTopWidth: 1, borderColor: 'rgba(218,226,202,.08)' },
  composerInput: { flex: 1, minHeight: 44, maxHeight: 104, color: '#F4F0E6', borderRadius: 10, backgroundColor: '#151D16', paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: 'rgba(218,226,202,.12)' },
  fileAttachment: { minHeight: 42, maxWidth: 220, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(230,192,122,.24)', backgroundColor: 'rgba(230,192,122,.08)', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  fileAttachmentText: { color: '#EDE4C8', fontSize: 13, fontWeight: '800', flex: 1 },
  pinnedBar: { minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(230,192,122,.28)', backgroundColor: 'rgba(230,192,122,.10)', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pinnedText: { color: '#EDE4C8', fontWeight: '800', flex: 1, fontSize: 12 },
  callActions: { flexDirection: 'row', gap: 10 },
  callCard: { gap: 12, borderColor: 'rgba(255,170,168,.15)', borderWidth: 1 },
  callSheet: { width: '100%', borderRadius: 12, backgroundColor: '#182019', borderWidth: 1, borderColor: 'rgba(230,192,122,.28)', padding: 18, gap: 12 },
  callStatusPanel: { minHeight: 128, borderRadius: 12, backgroundColor: 'rgba(230,192,122,.09)', borderWidth: 1, borderColor: 'rgba(230,192,122,.18)', alignItems: 'center', justifyContent: 'center', gap: 8 },
  callControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  callControlButton: { flexGrow: 1, minWidth: 96, minHeight: 58, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(218,226,202,.14)', backgroundColor: 'rgba(255,255,255,.06)', alignItems: 'center', justifyContent: 'center', gap: 5 },
  callControlActive: { backgroundColor: 'rgba(230,192,122,.18)', borderColor: 'rgba(230,192,122,.42)' },
  callLeaveButton: { backgroundColor: 'rgba(210,64,72,.72)', borderColor: 'rgba(255,170,168,.45)' },
  callControlText: { color: '#F4F0E6', fontSize: 12, fontWeight: '800' },
  audioOnlyPanel: { minHeight: 72, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(230,192,122,.22)', backgroundColor: 'rgba(230,192,122,.08)', alignItems: 'center', justifyContent: 'center', gap: 6 },
  liveKitGrid: { minHeight: 220, borderRadius: 12, overflow: 'hidden', backgroundColor: '#05070B', alignItems: 'stretch', justifyContent: 'center', gap: 8 },
  liveKitVideoTile: { width: '100%', minHeight: 220, backgroundColor: '#05070B', alignItems: 'center', justifyContent: 'center' },
  callMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.04)', marginTop: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,.06)' },
  callMemberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  
  // Profile
  profileHero: { alignItems: 'center', gap: 14, paddingTop: 8, paddingVertical: 20 },
  profileBanner: { height: 132, alignSelf: 'stretch', marginHorizontal: -18, marginTop: -18, marginBottom: 12 },
  profileBannerImage: { height: 132, alignSelf: 'stretch', marginHorizontal: -18, marginTop: -18, marginBottom: 12, backgroundColor: '#111712' },
  profileAvatarLarge: { width: 96, height: 96, borderRadius: 24, backgroundColor: '#33412E', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#7D8B58' },
  profileAvatarText: { color: '#F4F0E6', fontWeight: '900', fontSize: 36 },
  profileLogo: { width: 96, height: 96, borderRadius: 20, borderWidth: 3, borderColor: '#1B241C' },
  statusDot: { position: 'absolute', width: 18, height: 18, borderRadius: 9, right: 1, bottom: 5, borderWidth: 3, borderColor: '#1B241C' },
  profileStatusBubble: { position: 'absolute', left: 82, top: 28, minHeight: 28, maxWidth: 176, borderRadius: 14, backgroundColor: 'rgba(63,63,70,.94)', borderWidth: 1, borderColor: 'rgba(255,255,255,.08)', paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center', justifyContent: 'center', zIndex: 4 },
  sheetStatusBubble: { position: 'absolute', left: 58, top: 20, minHeight: 26, maxWidth: 162, borderRadius: 13, backgroundColor: 'rgba(63,63,70,.94)', borderWidth: 1, borderColor: 'rgba(255,255,255,.08)', paddingHorizontal: 9, paddingVertical: 4, alignItems: 'center', justifyContent: 'center', zIndex: 4 },
  profileStatusText: { color: '#F4F0E6', fontSize: 12, fontWeight: '800' },
  profileName: { color: '#F4F0E6', fontSize: 28, fontWeight: '900', letterSpacing: -0.3 },
  profileBadgeContainer: { flexDirection: 'row', gap: 10, marginTop: 8 },
  colorRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  mediaActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  profileActionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  proofUpload: { minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(230,192,122,.24)', backgroundColor: 'rgba(230,192,122,.08)', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, marginTop: 10 },
  ticketActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  ticketChat: { gap: 10, borderLeftWidth: 2, borderLeftColor: 'rgba(230,192,122,.24)', paddingLeft: 12, marginTop: 10 },
  ticketReply: { backgroundColor: 'rgba(255,255,255,.04)', borderRadius: 10, padding: 10, gap: 4 },
  ticketIconRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8 },
  ticketStatusPill: { minHeight: 30, borderRadius: 8, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  ticketStatusOpen: { backgroundColor: 'rgba(79,204,122,.14)', borderColor: 'rgba(79,204,122,.42)' },
  ticketStatusClosed: { backgroundColor: 'rgba(225,94,85,.16)', borderColor: 'rgba(225,94,85,.44)' },
  ticketStatusText: { color: '#F4F0E6', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
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
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.58)', justifyContent: 'flex-end', zIndex: 80, elevation: 80 },
  profileSheet: { maxHeight: '86%', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, backgroundColor: '#182019', overflow: 'hidden', zIndex: 90, elevation: 90 },
  profileSheetContent: { padding: 16, paddingBottom: 108, gap: 12 },
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
  dashboardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12, minHeight: 56 },
  backButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(230,192,122,.12)', alignItems: 'center', justifyContent: 'center' },
  spacer: { width: 44 },
  panelFooter: { paddingTop: 20, paddingBottom: 10, gap: 10 },
  closePanelButton: { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(218,226,202,.18)', minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  closePanelText: { color: '#D9E2CC', fontWeight: '800', fontSize: 15 },
  
  // Settings Rows
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  settingsRowContent: { flex: 1 },
  securityToggleCard: { paddingVertical: 12 },
  securityToggleRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 14 },
  inlineSwitch: { width: 54, height: 30, borderRadius: 15, padding: 3, backgroundColor: 'rgba(174,184,165,.18)', borderWidth: 1, borderColor: 'rgba(218,226,202,.16)', justifyContent: 'center' },
  inlineSwitchOn: { backgroundColor: 'rgba(79,204,122,.28)', borderColor: 'rgba(79,204,122,.42)' },
  inlineSwitchKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#AEB8A5' },
  inlineSwitchKnobOn: { alignSelf: 'flex-end', backgroundColor: '#4FCC7A' },
  // Info Display
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 12 },
  deviceIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(230,192,122,.14)', alignItems: 'center', justifyContent: 'center' },
  statusBadge: { backgroundColor: 'rgba(79,204,122,.14)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  statusBadgeMuted: { backgroundColor: 'rgba(174,184,165,.12)' },
  statusText: { color: '#4FCC7A', fontWeight: '800', fontSize: 11 },
  permissionItem: { paddingVertical: 12 },
  colorGrid: { flexDirection: 'row', gap: 12, marginTop: 12 },
  colorSwatch: { width: 48, height: 48, borderRadius: 10 },
  colorPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  languageChip: { minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(218,226,202,.14)', paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.04)' },
  colorSwatchButton: { width: 38, height: 38, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,.18)' },
  colorSwatchSelected: { borderColor: '#F4F0E6', borderWidth: 4 },
  themePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  themeSwatch: { width: 86, gap: 6, alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: 'transparent', paddingVertical: 8 },
  themeSwatchActive: { backgroundColor: 'rgba(230,192,122,.12)', borderColor: 'rgba(230,192,122,.5)' },
  themeSwatchGradient: { width: 56, height: 44, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,.16)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  themeSwatchDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#F4F0E6' },
  dropdownButton: { minHeight: 58, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(218,226,202,.16)', backgroundColor: 'rgba(11,16,12,.72)', paddingHorizontal: 14, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  choiceModal: { width: '92%', maxHeight: '70%', borderRadius: 12, backgroundColor: '#182019', borderWidth: 1, borderColor: 'rgba(230,192,122,.28)', padding: 16, gap: 10 },
  choiceRow: { minHeight: 54, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(218,226,202,.1)', backgroundColor: 'rgba(255,255,255,.04)', paddingHorizontal: 12, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  choiceRowActive: { backgroundColor: 'rgba(230,192,122,.14)', borderColor: 'rgba(230,192,122,.34)' },
  graphRow: { minHeight: 136, flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(218,226,202,.12)', paddingBottom: 8 },
  graphColumn: { flex: 1, minWidth: 10, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  graphBar: { width: '82%', borderRadius: 6, backgroundColor: 'rgba(230,192,122,.74)' },
  graphValue: { color: '#AEB8A5', fontSize: 10, fontWeight: '800' },
  
  videoGrid: { minHeight: 240, gap: 10, borderRadius: 18, overflow: 'hidden', backgroundColor: '#05070B', alignItems: 'center', justifyContent: 'center' },
  videoTile: { width: '100%', height: 240, borderRadius: 18 }
});
