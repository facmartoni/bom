import logger from "../utils/loki-logger.js";

/**
 * Navigates to the Facebook Marketplace URL
 * @param {puppeteer.Page} page
 * @returns
 */
export default async function startsFbMarketplace(page) {
  const url = process.env.MARKETPLACE_URL;

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
    });
  } catch (error) {
    logger.error("Error navigating to marketplace URL:", error);
    throw error;
  }
}
