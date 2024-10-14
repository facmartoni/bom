import {
  browserGauge,
  proxyBrowserGauge,
} from "../utils/prometheus-metrics.js";
import redisController from "../utils/redis-controller.mjs";
import { getLatestBrowserInstance } from "./get-latest-browser-instance.mjs";

let browserInstances = 0;

export function getBrowserInstances() {
  return browserInstances;
}

export function incrementBrowserInstances() {
  browserInstances++;
  browserGauge.inc();
}

export function decrementBrowserInstances() {
  if (browserInstances > 0) {
    browserInstances--;
    browserGauge.dec();
  }
}

export function resetBrowserInstances() {
  browserInstances = 0;
  browserGauge.set(0);
}

export async function updateProxyCount(proxy, increment = true) {
  const proxyCountKey = `proxy_count_${proxy.ip}:${proxy.port}`;
  if (increment) {
    await redisController.incr(proxyCountKey);
  } else {
    await redisController.decr(proxyCountKey);
  }
  const count = parseInt(await redisController.get(proxyCountKey)) || 0;
  proxyBrowserGauge.set({ proxy: `${proxy.ip}:${proxy.port}` }, count);
}

export async function resetAllProxyCounts(proxies) {
  for (const proxy of proxies) {
    const proxyCountKey = `proxy_count_${proxy.ip}:${proxy.port}`;
    await redisController.set(proxyCountKey, 0);
    proxyBrowserGauge.set({ proxy: `${proxy.ip}:${proxy.port}` }, 0);
  }
}

export async function initializeBrowserState() {
  browserInstances = await getLatestBrowserInstance();
}
