import puppeteer from "puppeteer";
import logger from "../utils/loki-logger.js";

export async function connectToBrowserAndGetCitySearchReadyPage(
  browserData,
  readyTab
) {
  const browser = await puppeteer.connect({
    browserWSEndpoint: browserData.wsEndpoint,
    defaultViewport: null, // Set to null to use the window size
    protocolTimeout: 5000,
  });

  const pages = await browser.pages();
  let page = null;

  // Check for the page using the targetId directly
  for (const p of pages) {
    try {
      const session = await p.createCDPSession();
      const info = await session.send("Target.getTargetInfo");
      if (info.targetInfo.targetId === readyTab.targetId) {
        page = p;
        break;
      }
    } catch (error) {
      logger.error("Error checking page target:", error);
    }
  }

  // If page is still not found, log the available pages for debugging
  if (!page) {
    logger.info("Available pages:");
    for (const p of pages) {
      try {
        const session = await p.createCDPSession();
        const info = await session.send("Target.getTargetInfo");
        logger.info(
          `Page URL: ${await p.url()}, Target ID: ${info.targetInfo.targetId}`
        );
      } catch (error) {
        logger.error("Error logging page info:", error);
      }
    }
    throw new Error("Tab page not found");
  }

  if (page) {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluate(() => {
      document.body.style.zoom = "100%";
      document.body.style.width = "1920px";
      document.body.style.height = "1080px";
      window.resizeTo(1920, 1080);
    });
  }

  return { browser, page };
}
