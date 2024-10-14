import logger from "../utils/loki-logger.js";
import redisController from "../utils/redis-controller.mjs";
import {
  browserGauge,
  proxyBrowserGauge,
} from "../utils/prometheus-metrics.js";
import updateRamUsage from "../utils/update-ram-usage.mjs";

async function closeBrowser(browserId) {
  try {
    const browserData = JSON.parse(await redisController.get(browserId));
    if (!browserData) {
      throw new Error("Browser instance not found");
    }

    process.kill(browserData.pid);
    await redisController.del(browserId);

    const proxyCountKey = `proxy_count_${browserData.proxy.ip}:${browserData.proxy.port}`;
    await redisController.decr(proxyCountKey);
    const updatedBrowserCount =
      parseInt(await redisController.get(proxyCountKey)) || 0;

    proxyBrowserGauge.set(
      { proxy: `${browserData.proxy.ip}:${browserData.proxy.port}` },
      updatedBrowserCount
    );
    browserGauge.dec();

    await updateRamUsage();

    logger.info(`Closed browser ${browserId} successfully`);
    return { message: "Browser instance closed successfully" };
  } catch (error) {
    logger.error(`Error closing browser ${browserId}:`, error);
    throw error;
  }
}

export default closeBrowser;
