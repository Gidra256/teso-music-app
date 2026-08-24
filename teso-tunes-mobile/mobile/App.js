import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as Updates from "expo-updates";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import AppErrorBoundary from "./src/components/AppErrorBoundary";
import { AuthProvider } from "./src/context/AuthContext";
import { EngagementProvider } from "./src/context/EngagementContext";
import { PlayerProvider } from "./src/context/PlayerContext";
import ArtistDetailScreen from "./src/screens/ArtistDetailScreen";
import ArtistsScreen from "./src/screens/ArtistsScreen";
import HomeScreen from "./src/screens/HomeScreen";
import SearchScreen from "./src/screens/SearchScreen";
import SongsScreen from "./src/screens/SongsScreen";
import PlayerScreen from "./src/screens/PlayerScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import { colors } from "./src/theme";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const linking = {
  prefixes: [Linking.createURL("/"), "tesohubmusic://"],
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
      Player: "song/:id",
      ArtistDetail: "artist/:id",
    },
  },
};

console.log("Expo Go deep link base:", Linking.createURL("/"));

function AutoUpdateGate() {
  useEffect(() => {
    async function applyAvailableUpdate() {
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

export default function App() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <EngagementProvider>
          <AuthProvider>
            <PlayerProvider>
              <NavigationContainer linking={linking}>
                <AutoUpdateGate />
                <StatusBar style="light" />
                <Stack.Navigator
                  screenOptions={{
                    headerStyle: { backgroundColor: colors.background },
                    headerTintColor: colors.text,
                    contentStyle: { backgroundColor: colors.background },
                  }}
                >
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
                    name="Player"
                    component={PlayerScreen}
                    options={{ headerShown: false }}
                  />
                </Stack.Navigator>
              </NavigationContainer>
            </PlayerProvider>
          </AuthProvider>
        </EngagementProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
