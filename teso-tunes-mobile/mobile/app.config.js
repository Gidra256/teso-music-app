const appJson = require("./app.json");
const {
  getAndroidStoreUrl,
  getIosStoreUrl,
  getShareBaseUrl,
  getShareHost,
} = require("./shareConfig");

module.exports = ({ config }) => {
  const shareBaseUrl = getShareBaseUrl();
  const shareHost = getShareHost();
  const appConfig = {
    ...config,
    ...appJson.expo,
  };

  appConfig.extra = {
    ...(appConfig.extra || {}),
    androidStoreUrl: getAndroidStoreUrl(),
    iosStoreUrl: getIosStoreUrl(),
    shareBaseUrl,
  };

  appConfig.android = {
    ...(appConfig.android || {}),
    intentFilters: shareHost
      ? [
          {
            action: "VIEW",
            autoVerify: true,
            category: ["BROWSABLE", "DEFAULT"],
            data: [
              {
                scheme: "https",
                host: shareHost,
                pathPrefix: "/song",
              },
            ],
          },
        ]
      : appConfig.android?.intentFilters,
  };

  appConfig.ios = {
    ...(appConfig.ios || {}),
    associatedDomains: shareHost ? [`applinks:${shareHost}`] : appConfig.ios?.associatedDomains,
  };

  return appConfig;
};
