import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import * as Updates from "expo-updates";
import { useEffect, useRef } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import AppErrorBoundary from "./src/components/AppErrorBoundary";
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
import ProfileScreen from "./src/screens/ProfileScreen";
import ReleaseUploadScreen from "./src/screens/ReleaseUploadScreen";
import { SHARE_BASE_URL } from "./src/config/api";
import { colors } from "./src/theme";
import { logUpdateDiagnostics } from "./src/utils/updateDiagnostics";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const APP_LOGO = require("./assets/images/tesohub-music.png");

const linking = {
  prefixes: [Linking.createURL("/"), "tesohubmusic://", SHARE_BASE_URL],
  config: {
    screens: {
      TesoTabs: {
        path: "",
        screens: {
          Home: "home",
          Songs: "songs",
          Artists: "artists",
          Search: "search",
        },
      },
      Profile: "profile",
      ArtistApplication: "artist-application",
      ArtistStudio: "artist-studio",
      ReleaseUpload: "artist-studio/upload",
      Player: "song/:id",
      ArtistDetail: "artist/:id",
    },
  },
};

console.log("Expo Go deep link base:", Linking.createURL("/"));

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
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: 68,
          paddingBottom: 10,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
        tabBarIcon: ({ color, size }) => {
          const icons = {
            Home: "home",
            Songs: "musical-notes",
            Artists: "people",
            Search: "search",
          };
          return (
            <Ionicons name={icons[route.name]} color={color} size={size} />
          );
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Songs" component={SongsScreen} />
      <Tab.Screen name="Artists" component={ArtistsScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
    </Tab.Navigator>
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

function AppNavigator() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <>
        <StatusBar style="light" />
        <LoadingScreen />
      </>
    );
  }

  return (
    <NavigationContainer linking={linking}>
      <AutoUpdateGate />
      <StatusBar style="light" />
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
              name="Player"
              component={PlayerScreen}
              options={{ headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
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
});
