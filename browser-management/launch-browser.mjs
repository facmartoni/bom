import { getProxiesInfo } from "./proxy-management.mjs";
import { launchBrowserWithProxy } from "./launch-browser-with-proxy.mjs";
import logger from "../utils/loki-logger.js";

let isLaunching = false;

export async function launchBrowserIfNeeded(PROXIES) {
  try {
    if (isLaunching) {
      return false;
    }

    const proxiesInfo = await getProxiesInfo(PROXIES);
    let newBrowserLaunched = false;

    if (proxiesInfo.some((proxy) => proxy.browserCount === 0)) {
      isLaunching = true;
      const availableProxies = proxiesInfo.filter(
        (proxy) => proxy.browserCount === 0
      );
      const randomProxy =
        availableProxies[Math.floor(Math.random() * availableProxies.length)];

      const [ip, port] = randomProxy.proxy.split(":");
      const username = process.env.PROXIES_USERNAME;
      const password = process.env.PROXIES_PASSWORD;

      launchBrowserWithProxy({
        ip,
        port,
        username,
        password,
      })
        .then(({ browserId, tabId }) => {
          isLaunching = false;
        })
        .catch((error) => {
          logger.error("Error launching browser:", error);
          isLaunching = false;
        });
      newBrowserLaunched = true;
    }

    return newBrowserLaunched;
  } catch (error) {
    logger.error("Error in launchBrowserIfNeeded:", error);
    isLaunching = false;
    throw error;
  }
}
