import redisController from "../utils/redis-controller.mjs";
import { proxyBrowserGauge } from "../utils/prometheus-metrics.js";

export async function getProxiesInfo(PROXIES) {
  const proxiesInfo = [];
  for (const proxy of PROXIES) {
    const proxyCountKey = `proxy_count_${proxy.ip}:${proxy.port}`;
    const browserCount =
      parseInt(await redisController.get(proxyCountKey)) || 0;
    const proxyString = `${proxy.ip}:${proxy.port}`;
    proxiesInfo.push({
      proxy: proxyString,
      browserCount,
    });

    // Update the Prometheus metric
    proxyBrowserGauge.set({ proxy: proxyString }, browserCount);
  }
  return proxiesInfo;
}

export async function updateProxyCount(proxy) {
  const proxyCountKey = `proxy_count_${proxy.ip}:${proxy.port}`;
  const count = await redisController.incr(proxyCountKey);
  const proxyString = `${proxy.ip}:${proxy.port}`;
  proxyBrowserGauge.set({ proxy: proxyString }, count);
  return count;
}
