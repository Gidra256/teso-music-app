const DISMISS_KEY = "tesohub_install_dismissed_until";
const INSTALLED_KEY = "tesohub_pwa_installed";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

function safeDownloadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function contentPath(path) {
  return /^\/(song|artist|playlist|release)\/[1-9]\d*$/.test(path) ? path : "/";
}

function openAndroidDownload(win, value) {
  const url = safeDownloadUrl(value);
  if (!url) return false;
  const target = new URL(url);
  const playStore = target.hostname === "play.google.com" && target.pathname === "/store/apps/details";
  const message = playStore ? "Open TesoHub Music on Google Play?" :
    "Download the TesoHub Music Android Early Access APK? This is a direct APK download, not Google Play. Android may ask you to allow installation from your browser or files app.";
  if (!win.confirm(message)) return false;
  win.location.assign(url);
  return true;
}

function appActions({ navigator, state, downloadUrl, persistent = false, compact = false, path = "/" }) {
  const android = /Android/.test(navigator.userAgent || "");
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent || "") || (/Macintosh/.test(navigator.userAgent || "") && navigator.maxTouchPoints > 1);
  const promoteInstall = !state.installed && (!state.dismissed || persistent);
  const actions = [];
  const hasDownload = Boolean(safeDownloadUrl(downloadUrl));
  if (android && (promoteInstall || persistent || path !== "/")) {
    if (hasDownload) actions.push({ id: "download", label: "Get Android App", icon: "download-outline" });
    if (!compact || !hasDownload) actions.push({ id: "open", label: "Open App", icon: "open-outline" });
  }
  if (promoteInstall && (!compact || !android || state.installable || state.pending)) {
    actions.push({ id: state.installable || state.pending ? "install" : "help", label: ios ? "Add to Home Screen" : "Install Web App", icon: "add-circle-outline" });
  }
  return { actions, promoteInstall };
}

function androidIntent(path, webBase) {
  const route = contentPath(path);
  const fallback = new URL(route, webBase);
  fallback.searchParams.set("app_fallback", "1");
  return `intent://${route.slice(1)}#Intent;scheme=tesohubmusic;package=com.tesotunes.app;S.browser_fallback_url=${encodeURIComponent(fallback.href)};end`;
}

function manualInstallHelp(navigator) {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return "In Safari, open Share, then Add to Home Screen. You can also keep listening here.";
  }
  if (/Android/.test(ua)) return "Open your browser menu and choose Install app or Add to Home Screen, if available. You can also keep listening here.";
  return "Look for Install in your browser address bar or menu. In Safari, use File > Add to Dock. If unavailable, keep listening on the web.";
}

function createInstallController(win) {
  const listeners = new Set();
  let event = null;
  let pending = false;
  const read = key => { try { return win.localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { win.localStorage.setItem(key, value); } catch {} };
  const standalone = win.matchMedia("(display-mode: standalone)");
  let state = { installable: false, installed: standalone.matches || win.navigator.standalone === true || read(INSTALLED_KEY) === "yes", dismissed: Number(read(DISMISS_KEY)) > Date.now(), pending: false, error: "" };
  const emit = patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  function dismiss() { write(DISMISS_KEY, String(Date.now() + DISMISS_MS)); emit({ dismissed: true }); }
  function beforeInstall(e) {
    e.preventDefault();
    event = e;
    // A fresh browser event is authoritative after a previous installation was removed.
    write(INSTALLED_KEY, "no");
    emit({ installable: true, installed: standalone.matches || win.navigator.standalone === true });
  }
  function installed() { event = null; write(INSTALLED_KEY, "yes"); emit({ installed: true, installable: false }); }
  function displayChanged() { if (standalone.matches || win.navigator.standalone) installed(); }
  function storageChanged() { emit({ dismissed: Number(read(DISMISS_KEY)) > Date.now(), installed: standalone.matches || win.navigator.standalone === true || read(INSTALLED_KEY) === "yes" }); }
  win.addEventListener("beforeinstallprompt", beforeInstall);
  win.addEventListener("appinstalled", installed);
  win.addEventListener("storage", storageChanged);
  standalone.addEventListener?.("change", displayChanged);
  return {
    getSnapshot: () => state,
    subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    dismiss,
    async install() {
      if (!event || pending || state.installed) return;
      pending = true;
      const prompt = event;
      event = null;
      emit({ pending: true, error: "", installable: false });
      try {
        await prompt.prompt();
        const result = await prompt.userChoice;
        if (result.outcome === "accepted") installed();
        else dismiss();
      } catch { emit({ error: "Installation could not start. Use your browser menu or keep listening here." }); }
      finally { pending = false; emit({ pending: false }); }
    },
    dispose() {
      win.removeEventListener("beforeinstallprompt", beforeInstall);
      win.removeEventListener("appinstalled", installed);
      win.removeEventListener("storage", storageChanged);
      standalone.removeEventListener?.("change", displayChanged);
    },
  };
}

module.exports = { appActions, androidIntent, contentPath, createInstallController, manualInstallHelp, openAndroidDownload, safeDownloadUrl, DISMISS_KEY, INSTALLED_KEY, DISMISS_MS };
