import redisController from "../utils/redis-controller.mjs";
import logger from "../utils/loki-logger.js";

export async function findCitySearchReadyTab() {
  const keys = await redisController.keys("browser_*");
  let selectedBrowser = null;
  let attempts = 0;

  while (!selectedBrowser && attempts < 10) {
    let minTabsCount = Infinity;
    for (const key of keys) {
      const browserData = JSON.parse(await redisController.get(key));
      const readyTab = browserData.tabs.find(
        (tab) => tab.state === "city_search_ready"
      );
      if (readyTab && browserData.numberOfTabs < minTabsCount) {
        selectedBrowser = { browserData, readyTab };
        minTabsCount = browserData.numberOfTabs;
      }
    }
    if (!selectedBrowser) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      logger.info("Waiting for a ready tab...");
      attempts++;
    }
  }

  if (!selectedBrowser) {
    logger.warn("Probably ran out of attempts to find a ready tab");
  }

  return selectedBrowser;
}
