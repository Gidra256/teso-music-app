import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import {
  getListenerAccount,
  loginListenerAccount,
  logoutListenerAccount,
  registerListenerAccount,
  setAuthToken,
  updateListenerAccount,
} from "../api/musicApi";
import { useEngagement } from "./EngagementContext";

const AUTH_TOKEN_KEY = "teso_tunes_auth_token";
const AUTH_LISTENER_KEY = "teso_tunes_auth_listener";
const DEVICE_NAME = `TesoHub ${Platform.OS}`;

const AuthContext = createContext(null);

function parseSavedListener(value) {
  try {
    const parsed = JSON.parse(value || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

export function AuthProvider({ children }) {
  const { deviceId } = useEngagement();
  const [token, setToken] = useState("");
  const [listener, setListener] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    async function loadSession() {
      try {
        const [savedToken, savedListener] = await Promise.all([
          AsyncStorage.getItem(AUTH_TOKEN_KEY),
          AsyncStorage.getItem(AUTH_LISTENER_KEY),
        ]);

        if (savedToken) {
          setToken(savedToken);
          setAuthToken(savedToken);
          setListener(parseSavedListener(savedListener));
          await refreshAccount(savedToken);
        }
      } catch (error) {
        await clearSession();
      } finally {
        setLoading(false);
      }
    }

    loadSession();
  }, []);

  async function saveSession(nextToken, nextListener) {
    setToken(nextToken);
    setListener(nextListener);
    setAuthToken(nextToken);
    await Promise.all([
      AsyncStorage.setItem(AUTH_TOKEN_KEY, nextToken),
      AsyncStorage.setItem(AUTH_LISTENER_KEY, JSON.stringify(nextListener)),
    ]);
  }

  async function clearSession() {
    setToken("");
    setListener(null);
    setAuthToken("");
    await Promise.all([
      AsyncStorage.removeItem(AUTH_TOKEN_KEY),
      AsyncStorage.removeItem(AUTH_LISTENER_KEY),
    ]);
  }

  async function refreshAccount(existingToken = token) {
    if (existingToken) {
      setAuthToken(existingToken);
    }
    const result = await getListenerAccount();
    setListener(result.listener);
    await AsyncStorage.setItem(AUTH_LISTENER_KEY, JSON.stringify(result.listener));
    return result.listener;
  }

  async function registerAccount(payload) {
    setAuthError("");
    const result = await registerListenerAccount({
      ...payload,
      device_id: deviceId,
      device_name: DEVICE_NAME,
    });
    await saveSession(result.token, result.listener);
    return result.listener;
  }

  async function loginAccount(payload) {
    setAuthError("");
    const result = await loginListenerAccount({
      ...payload,
      device_id: deviceId,
      device_name: DEVICE_NAME,
    });
    await saveSession(result.token, result.listener);
    return result.listener;
  }

  async function updateAccount(payload) {
    setAuthError("");
    const result = await updateListenerAccount(payload);
    setListener(result.listener);
    await AsyncStorage.setItem(AUTH_LISTENER_KEY, JSON.stringify(result.listener));
    return result.listener;
  }

  async function logout() {
    try {
      await logoutListenerAccount();
    } catch (error) {}
    await clearSession();
  }

  const value = useMemo(
    () => ({
      authError,
      isAuthenticated: Boolean(token && listener),
      listener,
      loading,
      loginAccount,
      logout,
      refreshAccount,
      registerAccount,
      setAuthError,
      token,
      updateAccount,
    }),
    [authError, listener, loading, token, deviceId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
