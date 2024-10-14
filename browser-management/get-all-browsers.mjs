import redisController from "../utils/redis-controller.mjs";
import logger from "../utils/loki-logger.js";

async function getAllBrowsers() {
  try {
    const keys = await redisController.keys("browser_*");
    const instances = [];
    for (const key of keys) {
      const browserData = JSON.parse(await redisController.get(key));
      instances.push(browserData);
    }
    return instances;
  } catch (error) {
    logger.error("Error retrieving all browser instances:", error);
    return [];
  }
}

export default getAllBrowsers;
