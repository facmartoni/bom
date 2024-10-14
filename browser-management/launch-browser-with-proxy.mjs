import puppeteer from "puppeteer";
import redisController from "../utils/redis-controller.mjs";
import {
  getBrowserInstances,
  incrementBrowserInstances,
} from "./browser-state.mjs";
import { updateProxyCount } from "./proxy-management.mjs";
import { browserGauge } from "../utils/prometheus-metrics.js";
import updateRamUsage from "../utils/update-ram-usage.mjs";
import startsFbMarketplace from "../fb-marketplace-automations/starts-fb-marketplace.mjs";
import revealCityInput from "../fb-marketplace-automations/reveal-city-input.mjs";

const DEBUG_MODE = process.env.DEBUG_MODE === "true";
const DEBUG_DELAY = parseInt(process.env.DEBUG_DELAY) || 0;

export async function launchBrowserWithProxy(proxy) {
  const browser = await puppeteer.launch({
    headless: !DEBUG_MODE,
    args: [
      `--proxy-server=http://${proxy.ip}:${proxy.port}`,
      "--window-size=1920,1080",
      "--start-maximized",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-infobars",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--force-device-scale-factor=1",
    ],
    defaultViewport: null,
    slowMo: DEBUG_MODE ? DEBUG_DELAY : 0,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36",
  });

  const pages = await browser.pages();
  const page = pages[0]; // Use the initial tab

  // Set up proxy authentication
  await page.authenticate({
    username: proxy.username,
    password: proxy.password,
  });

  const tabId = `tab_1`;
  const tabData = {
    id: tabId,
    url: await page.url(),
    state: "pending",
    targetId: await (async () => {
      const session = await page.createCDPSession();
      const info = await session.send("Target.getTargetInfo");
      return info.targetInfo.targetId;
    })(),
  };

  const browserId = `browser_${getBrowserInstances()}`;
  const wsEndpoint = browser.wsEndpoint();
  const browserData = {
    id: browserId,
    proxy: {
      ip: proxy.ip,
      port: proxy.port,
      username: proxy.username,
      password: proxy.password,
    },
    pid: browser.process().pid,
    wsEndpoint,
    numberOfTabs: 1,
    tabs: [tabData],
    launchTime: new Date().toISOString(),
  };

  await redisController.set(browserId, JSON.stringify(browserData));
  incrementBrowserInstances();
  await updateProxyCount(proxy);
  browserGauge.inc();
  await updateRamUsage();

  // Instead of calling prepareCitySearchTab, prepare the initial tab
  await startsFbMarketplace(page);
  await revealCityInput(page, browserData, tabData);

  tabData.state = "city_search_ready";
  tabData.url = await page.url();

  await redisController.set(browserId, JSON.stringify(browserData));

  return { browserId, tabId };
}
