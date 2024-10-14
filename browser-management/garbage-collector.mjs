import os from "os";
import logger from "../utils/loki-logger.js";

const MEMORY_THRESHOLD = 4 * 1024 * 1024 * 1024; // 4GB in bytes
const MIN_BROWSERS = 3; // Minimum number of browsers to keep in the pool

// Function to get system memory usage
function getSystemMemoryUsage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  return totalMemory - freeMemory;
}

// Garbage Collector function
async function garbageCollectBrowsers(getAllBrowsers, closeBrowser) {
  try {
    const memoryUsage = getSystemMemoryUsage();
    if (memoryUsage < MEMORY_THRESHOLD) {
      logger.info("Memory usage below threshold. Skipping garbage collection.");
      return;
    }

    const browsers = await getAllBrowsers();
    if (browsers.length <= MIN_BROWSERS) {
      logger.info(
        `Only ${MIN_BROWSERS} browsers left. Skipping garbage collection.`
      );
      return;
    }

    // Sort browsers by age (oldest first)
    browsers.sort((a, b) => new Date(a.launchTime) - new Date(b.launchTime));

    let closedCount = 0;
    for (const browser of browsers) {
      if (browsers.length - closedCount <= MIN_BROWSERS) break;

      if (browser.tabs.length === 2) {
        const bareTabs = browser.tabs.filter(
          (tab) => tab.state === "bare" || tab.url === "about:blank"
        );
        const citySearchReadyTabs = browser.tabs.filter(
          (tab) => tab.state === "city_search_ready"
        );

        if (bareTabs.length === 1 && citySearchReadyTabs.length === 1) {
          await closeBrowser(browser.id);
          closedCount++;
        }
      }
    }

    logger.info(`Garbage collection complete. Closed ${closedCount} browsers.`);
  } catch (error) {
    logger.error("Error during garbage collection:", error);
  }
}

export { garbageCollectBrowsers };
