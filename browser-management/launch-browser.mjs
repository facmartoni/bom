import { getProxiesInfo } from "./proxy-management.mjs";
import { launchBrowserWithProxy } from "./launch-browser-with-proxy.mjs";
import logger from "../utils/loki-logger.js";
import getAllBrowsers from "./get-all-browsers.mjs";
import redisController from "../utils/redis-controller.mjs";

let isLaunching = false;

export async function launchBrowserIfNeeded(PROXIES) {
  logger.info("launchBrowserIfNeeded called");
  try {
    // Check if a browser launch is already in progress
    if (isLaunching) {
      logger.info("Browser launch already in progress, skipping");
      return false;
    }

    const proxiesInfo = await getProxiesInfo(PROXIES);
    let newBrowserLaunched = false;

    const currentBrowsers = await getAllBrowsers();
    logger.info(
      `Current browser count before check: ${currentBrowsers.length}`
    );
    logger.info(
      `Current browsers: ${currentBrowsers.map((b) => b.id).join(", ")}`
    );

    // If there's a proxy with 0 browsers, launch a new browser
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

      logger.info(
        `Launching new browser with proxy: ${ip}:${port}:${username}:${password}`
      );
      // Pass full proxy details
      launchBrowserWithProxy({
        ip,
        port,
        username,
        password,
      })
        .then(({ browserId, tabId }) => {
          logger.info(`New browser launched: ${browserId}, tab: ${tabId}`);
          isLaunching = false;
        })
        .catch((error) => {
          logger.error("Error launching browser:", error);
          isLaunching = false;
        });
      newBrowserLaunched = true;
    } else {
      logger.info("No new browser needed to be launched");
    }

    return newBrowserLaunched;
  } catch (error) {
    logger.error("Error in launchBrowserIfNeeded:", error);
    isLaunching = false;
    throw error;
  }
}
