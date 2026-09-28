import {
  NavigationContainer,
  createNavigationContainerRef,
  useNavigation,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import * as Updates from "expo-updates";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import AppErrorBoundary from "./src/components/AppErrorBoundary";
import CreatePlaylistModal from "./src/components/CreatePlaylistModal";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { EngagementProvider } from "./src/context/EngagementContext";
import { PlayerProvider } from "./src/context/PlayerContext";
import ArtistDetailScreen from "./src/screens/ArtistDetailScreen";
import ArtistApplicationScreen from "./src/screens/ArtistApplicationScreen";
import ArtistStudioScreen from "./src/screens/ArtistStudioScreen";
import ArtistsScreen from "./src/screens/ArtistsScreen";
import HomeScreen from "./src/screens/HomeScreen";
import SearchScreen from "./src/screens/SearchScreen";
import SongsScreen from "./src/screens/SongsScreen";
import PlayerScreen from "./src/screens/PlayerScreen";
import PlaylistDetailScreen from "./src/screens/PlaylistDetailScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import ReleaseUploadScreen from "./src/screens/ReleaseUploadScreen";
import { SHARE_BASE_URL } from "./src/config/api";
import { getPlatformStatus } from "./src/api/musicApi";
import YourLibraryScreen from "./src/screens/YourLibraryScreen";
import { colors } from "./src/theme";
import { logUpdateDiagnostics } from "./src/utils/updateDiagnostics";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const APP_LOGO = require("./assets/images/tesohub-music.png");
const DESKTOP_WEB_BREAKPOINT = 900;
const navigationRef = createNavigationContainerRef();

const linking = {
  prefixes: [Linking.createURL("/"), "tesohubmusic://", SHARE_BASE_URL],
  config: {
    screens: {
      TesoTabs: {
        path: "",
        screens: {
          Home: "",
          Search: "search",
          Library: "library",
          Create: "create",
        },
      },
      Songs: "songs",
      Artists: "artists",
      Profile: "profile",
      ArtistApplication: "artist-application",
      ArtistStudio: "artist-studio",
      ReleaseUpload: "artist-studio/upload",
      Player: "song/:id",
      Release: "release/:id",
      ArtistDetail: "artist/:id",
      PlaylistDetail: "playlist/:id",
    },
  },
};

console.log("Expo Go deep link base:", Linking.createURL("/"));

function navigateRoot(name, params) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}

function navigateTab(screen) {
  navigateRoot("TesoTabs", { screen });
}

function initialsForName(name) {
  return (
    name
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || ""
  );
}

function AutoUpdateGate() {
  useEffect(() => {
    async function applyAvailableUpdate() {
      logUpdateDiagnostics();

      if (!Updates.isEnabled) return;

      try {
        const update = await Updates.checkForUpdateAsync();
        if (!update.isAvailable) return;

        const fetched = await Updates.fetchUpdateAsync();
        if (fetched.isNew || fetched.isRollBackToEmbedded) {
          await Updates.reloadAsync();
        }
      } catch (error) {}
    }

    applyAvailableUpdate();
  }, []);

  return null;
}

function MainTabs() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { isAuthenticated } = useAuth();
  const [createVisible, setCreateVisible] = useState(false);
  const isDesktopWeb = Platform.OS === "web" && width >= DESKTOP_WEB_BREAKPOINT;
  const tabBarStyle = isDesktopWeb
    ? styles.hiddenTabBar
    : {
        backgroundColor: colors.card,
        borderTopColor: colors.border,
        height: 60 + Math.max(insets.bottom, 10),
        paddingBottom: Math.max(insets.bottom, 10),
        paddingTop: 8,
      };

  function openCreate() {
    if (!isAuthenticated) {
      navigation.navigate("Profile", { loginRequired: true });
      return;
    }

    setCreateVisible(true);
  }

  return (
    <>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
          tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
          tabBarIcon: ({ color, size }) => {
            const icons = {
              Home: "home",
              Search: "search",
              Library: "library",
              Create: "add-circle",
            };
            return (
              <Ionicons name={icons[route.name]} color={color} size={size} />
            );
          },
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Search" component={SearchScreen} />
        <Tab.Screen
          name="Library"
          component={YourLibraryScreen}
          options={{ tabBarLabel: "Your Library" }}
        />
        <Tab.Screen
          name="Create"
          component={CreateScreenPlaceholder}
          listeners={{
            tabPress: (event) => {
              event.preventDefault();
              openCreate();
            },
          }}
        />
      </Tab.Navigator>
      <CreatePlaylistModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={(playlist) => {
          setCreateVisible(false);
          navigation.navigate("PlaylistDetail", { id: playlist.id });
        }}
      />
    </>
  );
}

function CreateScreenPlaceholder() {
  return <View style={styles.placeholderScreen} />;
}

function ReleaseRedirectScreen({ route, navigation }) {
  useEffect(() => {
    navigation.replace("Player", { id: route?.params?.id });
  }, [navigation, route?.params?.id]);

  return <LoadingScreen />;
}

function DesktopSidebar({ isAuthenticated, onCreate }) {
  function openProtectedRoute(name, params) {
    if (!isAuthenticated) {
      navigateRoot("Profile", { loginRequired: true });
      return;
    }

    navigateRoot(name, params);
  }

  return (
    <View style={styles.desktopSidebar}>
      <View style={styles.desktopBrand}>
        <Image source={APP_LOGO} style={styles.desktopLogo} />
        <View style={styles.desktopBrandCopy}>
          <Text style={styles.desktopBrandTitle}>TesoHub</Text>
          <Text style={styles.desktopBrandText}>Music</Text>
        </View>
      </View>
      <View style={styles.desktopNav}>
        <DesktopNavButton icon="home" label="Home" onPress={() => navigateTab("Home")} />
        <DesktopNavButton icon="search" label="Search" onPress={() => navigateTab("Search")} />
        <DesktopNavButton
          icon="library"
          label="Your Library"
          onPress={() => navigateTab("Library")}
        />
        <DesktopNavButton icon="add-circle" label="Create" onPress={onCreate} />
        <DesktopNavButton
          icon="mic"
          label="Artist Studio"
          onPress={() => openProtectedRoute("ArtistStudio")}
        />
      </View>
    </View>
  );
}

function DesktopNavButton({ icon, label, onPress }) {
  return (
    <TouchableOpacity activeOpacity={0.82} style={styles.desktopNavButton} onPress={onPress}>
      <Ionicons name={icon} color={colors.softText} size={21} />
      <Text style={styles.desktopNavText}>{label}</Text>
    </TouchableOpacity>
  );
}

function DesktopAccountButton() {
  const { isAuthenticated, listener } = useAuth();
  const initials = initialsForName(listener?.name);

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      accessibilityLabel="Open profile"
      style={[styles.desktopAccountButton, isAuthenticated && styles.desktopAccountButtonActive]}
      onPress={() => navigateRoot("Profile")}
    >
      {initials ? (
        <Text style={styles.desktopAccountInitials}>{initials}</Text>
      ) : (
        <Ionicons name="person" color={colors.text} size={18} />
      )}
    </TouchableOpacity>
  );
}

function DesktopTopbar() {
  return (
    <View style={styles.desktopTopbar}>
      <View>
        <Text style={styles.desktopTopbarKicker}>TesoHub Music</Text>
        <Text style={styles.desktopTopbarTitle}>Listen, manage, discover</Text>
      </View>
      <DesktopAccountButton />
    </View>
  );
}

function WebPwaRuntime() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    document.documentElement.style.backgroundColor = colors.background;
    document.body.style.backgroundColor = colors.background;

    function ensureLink(rel, href, attributes = {}) {
      const selector = `link[rel="${rel}"][href="${href}"]`;
      if (document.querySelector(selector)) return;
      const link = document.createElement("link");
      link.rel = rel;
      link.href = href;
      Object.entries(attributes).forEach(([key, value]) => link.setAttribute(key, value));
      document.head.appendChild(link);
    }

    function ensureMeta(name, content) {
      let meta = document.querySelector(`meta[name="${name}"]`);
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = name;
        document.head.appendChild(meta);
      }
      meta.content = content;
    }

    ensureLink("manifest", "/manifest.webmanifest");
    ensureLink("apple-touch-icon", "/icons/tesohub-music.png");
    ensureMeta("theme-color", colors.background);
    ensureMeta("apple-mobile-web-app-capable", "yes");
    ensureMeta("apple-mobile-web-app-title", "TesoHub Music");

    const canRegisterServiceWorker =
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      typeof window !== "undefined" &&
      (window.location.protocol === "https:" || window.location.hostname === "localhost") &&
      process.env.NODE_ENV === "production";

    if (canRegisterServiceWorker) {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    }
  }, []);

  return null;
}

function WebOfflineBanner() {
  const [online, setOnline] = useState(() => {
    if (Platform.OS !== "web" || typeof navigator === "undefined") return true;
    return navigator.onLine !== false;
  });

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return undefined;

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (Platform.OS !== "web" || online) return null;

  return (
    <View style={styles.offlineBanner}>
      <Ionicons name="cloud-offline" color={colors.background} size={17} />
      <Text style={styles.offlineText}>Offline. Streaming and account actions need internet.</Text>
    </View>
  );
}

function LoadingScreen() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 850,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 850,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const glowOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.8],
  });
  const logoScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.04],
  });
  const barScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 1],
  });

  return (
    <LinearGradient
      colors={[colors.background, "#071C20", "#170819", colors.background]}
      style={styles.loadingScreen}
    >
      <View style={styles.loadingLogoWrap}>
        <Animated.View style={[styles.loadingGlow, { opacity: glowOpacity }]} />
        <Animated.View style={{ transform: [{ scale: logoScale }] }}>
          <Image source={APP_LOGO} style={styles.loadingLogo} />
        </Animated.View>
      </View>

      <Text style={styles.loadingTitle}>TesoHub Music</Text>
      <View style={styles.loadingBars}>
        {[0, 1, 2, 3, 4].map((item) => (
          <Animated.View
            key={item}
            style={[
              styles.loadingBar,
              item % 2 === 0 && styles.loadingBarAccent,
              {
                transform: [
                  {
                    scaleY: item === 2 ? logoScale : barScale,
                  },
                ],
              },
            ]}
          />
        ))}
      </View>
    </LinearGradient>
  );
}

function MaintenanceScreen({ message, announcement }) {
  return (
    <LinearGradient
      colors={[colors.background, "#071C20", "#170819", colors.background]}
      style={styles.maintenanceScreen}
    >
      <Image source={APP_LOGO} style={styles.maintenanceLogo} />
      <Text style={styles.maintenanceEyebrow}>TesoHub Music</Text>
      <Text style={styles.maintenanceTitle}>We will be back soon</Text>
      <Text style={styles.maintenanceMessage}>
        {message || "TesoHub Music is temporarily under maintenance."}
      </Text>
      {announcement ? (
        <View style={styles.maintenanceNotice}>
          <Text style={styles.maintenanceNoticeText}>{announcement}</Text>
        </View>
      ) : null}
    </LinearGradient>
  );
}

function RootStack({ isAuthenticated }) {
  return (
    <Stack.Navigator
      key={isAuthenticated ? "signed-in" : "signed-out"}
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {isAuthenticated ? (
        <>
          <Stack.Screen
            name="TesoTabs"
            component={MainTabs}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ArtistDetail"
            component={ArtistDetailScreen}
            options={{ title: "Artist" }}
          />
          <Stack.Screen
            name="Songs"
            component={SongsScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Artists"
            component={ArtistsScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="PlaylistDetail"
            component={PlaylistDetailScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Profile"
            component={ProfileScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ArtistApplication"
            component={ArtistApplicationScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ArtistStudio"
            component={ArtistStudioScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ReleaseUpload"
            component={ReleaseUploadScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Release"
            component={ReleaseRedirectScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Player"
            component={PlayerScreen}
            options={{ headerShown: false }}
          />
        </>
      ) : (
        <>
          <Stack.Screen
            name="Profile"
            component={ProfileScreen}
            initialParams={{ loginRequired: true }}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="TesoTabs"
            component={MainTabs}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ArtistDetail"
            component={ArtistDetailScreen}
            options={{ title: "Artist" }}
          />
          <Stack.Screen
            name="Songs"
            component={SongsScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Artists"
            component={ArtistsScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="PlaylistDetail"
            component={PlaylistDetailScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Release"
            component={ReleaseRedirectScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Player"
            component={PlayerScreen}
            options={{ headerShown: false }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

function AppNavigator() {
  const { isAuthenticated, loading } = useAuth();
  const { width } = useWindowDimensions();
  const [platformStatus, setPlatformStatus] = useState(null);
  const [platformChecked, setPlatformChecked] = useState(false);
  const [desktopCreateVisible, setDesktopCreateVisible] = useState(false);
  const isDesktopWeb = Platform.OS === "web" && width >= DESKTOP_WEB_BREAKPOINT;

  useEffect(() => {
    let mounted = true;

    getPlatformStatus()
      .then((status) => {
        if (mounted) setPlatformStatus(status);
      })
      .catch(() => {
        if (mounted) setPlatformStatus(null);
      })
      .finally(() => {
        if (mounted) setPlatformChecked(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (loading || !platformChecked) {
    return (
      <>
        <StatusBar style="light" />
        <LoadingScreen />
      </>
    );
  }

  if (platformStatus?.maintenance_mode) {
    return (
      <>
        <StatusBar style="light" />
        <MaintenanceScreen
          announcement={platformStatus.app_announcement}
          message={platformStatus.maintenance_message}
        />
      </>
    );
  }

  function openDesktopCreate() {
    if (!isAuthenticated) {
      navigateRoot("Profile", { loginRequired: true });
      return;
    }

    setDesktopCreateVisible(true);
  }

  return (
    <NavigationContainer ref={navigationRef} linking={linking}>
      <AutoUpdateGate />
      <WebPwaRuntime />
      <StatusBar style="light" />
      {isDesktopWeb ? (
        <View style={styles.desktopShell}>
          <DesktopSidebar
            isAuthenticated={isAuthenticated}
            onCreate={openDesktopCreate}
          />
          <View style={styles.desktopMain}>
            <DesktopTopbar />
            <View style={styles.desktopNavigator}>
              <RootStack isAuthenticated={isAuthenticated} />
            </View>
          </View>
        </View>
      ) : (
        <RootStack isAuthenticated={isAuthenticated} />
      )}
      <CreatePlaylistModal
        visible={desktopCreateVisible}
        onClose={() => setDesktopCreateVisible(false)}
        onCreated={(playlist) => {
          setDesktopCreateVisible(false);
          navigateRoot("PlaylistDetail", { id: playlist.id });
        }}
      />
      <WebOfflineBanner />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <EngagementProvider>
          <AuthProvider>
            <PlayerProvider>
              <AppNavigator />
            </PlayerProvider>
          </AuthProvider>
        </EngagementProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    gap: 18,
    justifyContent: "center",
  },
  loadingLogoWrap: {
    alignItems: "center",
    height: 190,
    justifyContent: "center",
    width: 190,
  },
  loadingGlow: {
    backgroundColor: colors.primary,
    borderRadius: 80,
    height: 160,
    position: "absolute",
    shadowColor: colors.accent,
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    width: 160,
  },
  loadingLogo: {
    borderRadius: 8,
    height: 168,
    width: 168,
  },
  loadingTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "950",
  },
  loadingBars: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    height: 38,
  },
  loadingBar: {
    backgroundColor: colors.primary,
    borderRadius: 4,
    height: 30,
    width: 6,
  },
  loadingBarAccent: {
    backgroundColor: colors.accent,
  },
  maintenanceScreen: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: "center",
    padding: 28,
  },
  maintenanceLogo: {
    borderRadius: 8,
    height: 136,
    marginBottom: 24,
    width: 136,
  },
  maintenanceEyebrow: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 10,
    textTransform: "uppercase",
  },
  maintenanceTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "950",
    marginBottom: 10,
    textAlign: "center",
  },
  maintenanceMessage: {
    color: colors.softText,
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 360,
    textAlign: "center",
  },
  maintenanceNotice: {
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 20,
    maxWidth: 360,
    padding: 14,
  },
  maintenanceNoticeText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
    textAlign: "center",
  },
  placeholderScreen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  hiddenTabBar: {
    display: "none",
  },
  desktopShell: {
    backgroundColor: colors.background,
    flex: 1,
    flexDirection: "row",
  },
  desktopSidebar: {
    backgroundColor: "#08080B",
    borderRightColor: colors.border,
    borderRightWidth: 1,
    gap: 26,
    paddingHorizontal: 18,
    paddingTop: 24,
    width: 236,
  },
  desktopBrand: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  desktopLogo: {
    borderRadius: 8,
    height: 44,
    width: 44,
  },
  desktopBrandCopy: {
    gap: 1,
  },
  desktopBrandTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "950",
  },
  desktopBrandText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  desktopNav: {
    gap: 8,
  },
  desktopNavButton: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 12,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  desktopNavText: {
    color: colors.softText,
    fontSize: 15,
    fontWeight: "850",
  },
  desktopMain: {
    flex: 1,
    minWidth: 0,
  },
  desktopTopbar: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderBottomColor: "rgba(255, 255, 255, 0.05)",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 72,
    paddingHorizontal: 28,
  },
  desktopTopbarKicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  desktopTopbarTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "950",
    marginTop: 3,
  },
  desktopAccountButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderColor: "rgba(244, 39, 200, 0.28)",
    borderRadius: 21,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  desktopAccountButtonActive: {
    backgroundColor: colors.primary,
    borderColor: "rgba(244, 39, 200, 0.5)",
  },
  desktopAccountInitials: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "950",
  },
  desktopNavigator: {
    flex: 1,
  },
  offlineBanner: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    bottom: 18,
    flexDirection: "row",
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 14,
    position: "absolute",
  },
  offlineText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: "900",
  },
});
