import puppeteer from "puppeteer";
import redisController from "../utils/redis-controller.mjs";
import logger from "../utils/loki-logger.js";

export async function createNewTab(browserId, url = "about:blank") {
  logger.info(`Creating new tab for browser: ${browserId}`);
  const browserData = JSON.parse(await redisController.get(browserId));

  if (!browserData || !browserData.wsEndpoint) {
    logger.error(`Browser instance not found: ${browserId}`);
    throw new Error("Browser instance not found");
  }

  logger.info(`Connecting to browser: ${browserId}`);
  const browser = await puppeteer.connect({
    browserWSEndpoint: browserData.wsEndpoint,
    defaultViewport: null, // Set to null to use the window size
  });

  logger.info(`Creating new page in browser: ${browserId}`);
  const page = await browser.newPage();
  await page.authenticate({
    username: browserData.proxy.username,
    password: browserData.proxy.password,
  });

  await page.setViewport({ width: 1920, height: 1080 });

  await page.evaluate(() => {
    document.body.style.zoom = "100%";
    document.body.style.width = "1920px";
    document.body.style.height = "1080px";
    window.resizeTo(1920, 1080);
  });

  logger.info(`Navigating to URL: ${url}`);
  await page.goto(url);

  const tabId = `tab_${browserData.numberOfTabs + 1}`;
  const tabData = {
    id: tabId,
    url,
    state: "bare",
    targetId: await (async () => {
      const session = await page.createCDPSession();
      const info = await session.send("Target.getTargetInfo");
      return info.targetInfo.targetId;
    })(),
  };

  browserData.numberOfTabs += 1;
  browserData.tabs.push(tabData);

  logger.info(`Updating browser data for ${browserId}`);
  await redisController.set(browserId, JSON.stringify(browserData));

  logger.info(`New tab created: ${tabId} for browser: ${browserId}`);
  return { tabId, page };
}
