import redisController from "../utils/redis-controller.mjs";
import { browserGauge } from "../utils/prometheus-metrics.js";
import puppeteer from "puppeteer";
import logger from "../utils/loki-logger.js";
import updateRamUsage from "../utils/update-ram-usage.mjs";
import {
  resetBrowserInstances,
  resetAllProxyCounts,
} from "./browser-state.mjs";

export async function closeAllBrowsers(PROXIES) {
  try {
    const keys = await redisController.keys("browser_*");
    for (const key of keys) {
      try {
        const browserData = JSON.parse(await redisController.get(key));
        if (browserData.wsEndpoint) {
          const browser = await puppeteer
            .connect({
              browserWSEndpoint: browserData.wsEndpoint,
              ignoreHTTPSErrors: true,
            })
            .catch(() => null);
          if (browser) await browser.close();
        }
      } catch (err) {
        logger.warn(`Failed to close browser ${key}: ${err.message}`);
      } finally {
        await redisController.del(key);
      }
    }

    resetBrowserInstances();
    await resetAllProxyCounts(PROXIES);
    browserGauge.reset();
    await updateRamUsage();

    logger.info("All browsers processed");
  } catch (error) {
    logger.error("Error in closeAllBrowsers:", error);
  }
}
