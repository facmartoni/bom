import redisController from "../utils/redis-controller.mjs";

export async function getLatestBrowserInstance() {
  const keys = await redisController.keys("browser_*");
  if (keys.length === 0) {
    return 0;
  }
  const instanceNumbers = keys
    .map((key) => parseInt(key.split("_")[1]))
    .filter((num) => !isNaN(num));
  return Math.max(...instanceNumbers);
}
