import * as Updates from "expo-updates";

import appConfigJson from "../../app.json";

export function getUpdateDiagnostics() {
  const expoConfig = appConfigJson.expo || {};
  const androidConfig = expoConfig.android || {};
  const runtimeVersion =
    Updates.runtimeVersion ||
    androidConfig.runtimeVersion?.policy ||
    expoConfig.runtimeVersion?.policy ||
    "unknown";

  return {
    androidVersionCode: androidConfig.versionCode || "unknown",
    appVersion: expoConfig.version || "unknown",
    channel: Updates.channel || "unknown",
    emergencyLaunchReason: Updates.emergencyLaunchReason || "",
    isEmbeddedLaunch: Boolean(Updates.isEmbeddedLaunch),
    isEmergencyLaunch: Boolean(Updates.isEmergencyLaunch),
    isUpdateEnabled: Boolean(Updates.isEnabled),
    launchSource: Updates.isEmbeddedLaunch ? "embedded" : "ota",
    runtimeVersion,
    updateId: Updates.updateId || "embedded",
  };
}

export function logUpdateDiagnostics() {
  console.log("[TesoHub Music Updates]", getUpdateDiagnostics());
}
