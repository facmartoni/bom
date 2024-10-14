import { ramUsageGauge } from "./prometheus-metrics.js";
import getAllBrowsers from "../browser-management/get-all-browsers.mjs";
import logger from "./loki-logger.js";

async function updateRamUsage() {
  try {
    const browsers = await getAllBrowsers();
    let totalRamUsage = 0;

    for (const browser of browsers) {
      if (browser.pid) {
        const usage = process.memoryUsage.rss(browser.pid);
        totalRamUsage += usage;
      }
    }

    // Add the RAM usage of the current process (the microservice itself)
    totalRamUsage += process.memoryUsage().rss;

    // Convert to GB
    const totalRamUsageGB = totalRamUsage / (1024 * 1024 * 1024);

    // Update the gauge
    ramUsageGauge.set(totalRamUsageGB);
  } catch (error) {
    logger.error("Error updating RAM usage:", error);
  }
}

export function startRamUsageMonitoring(interval = 30000) {
  setInterval(updateRamUsage, interval);
}

export default updateRamUsage;
