import { getProxiesInfo } from "./proxy-management.mjs";
import { launchBrowserWithProxy } from "./launch-browser-with-proxy.mjs";
import logger from "../utils/loki-logger.js";
import getAllBrowsers from "./get-all-browsers.mjs";

const LAUNCH_INTERVAL = 10000; // 10 seconds
const MAX_BROWSERS = 5; // Maximum number of browsers to launch

export async function backgroundBrowserLauncher(PROXIES) {
  while (true) {
    try {
      const proxiesInfo = await getProxiesInfo(PROXIES);
      const currentBrowsers = await getAllBrowsers();

      if (
        proxiesInfo.some((proxy) => proxy.browserCount === 0) &&
        currentBrowsers.length < Math.min(PROXIES.length, MAX_BROWSERS)
      ) {
        const availableProxies = proxiesInfo.filter(
          (proxy) => proxy.browserCount === 0
        );
        const randomProxy =
          availableProxies[Math.floor(Math.random() * availableProxies.length)];

        const [ip, port, username, password] = randomProxy.proxy.split(":");

        logger.info(
          `Background launching new browser with proxy: ${ip}:${port}`
        );
        try {
          const { browserId, tabId } = await launchBrowserWithProxy({
            ip,
            port,
            username,
            password,
          });
          logger.info(
            `Background launched new browser: ${browserId}, tab: ${tabId}`
          );
        } catch (error) {
          logger.error("Error launching browser in background:", error);
        }

        // Wait for the specified interval before the next launch
        await new Promise((resolve) => setTimeout(resolve, LAUNCH_INTERVAL));
      } else {
        // If no new browser is needed, wait for a shorter period before checking again
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } catch (error) {
      logger.error("Error in backgroundBrowserLauncher:", error);
      // Wait for a short period before retrying after an error
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}
