import puppeteer from "puppeteer";
import redisController from "../utils/redis-controller.mjs";
import logger from "../utils/loki-logger.js";

/**
 * Reveals the city input field from a not-touched-yet marketplace page
 * @param {puppeteer.Page} page
 * @param {object} browserData
 * @param {object} tabData
 * @returns
 */
export default async function revealCityInput(page, browserData, tabData) {
  tabData.state = "pending";
  await redisController.set(browserData.id, JSON.stringify(browserData));

  // Handle Cookies Modal
  const allowCookiesSelector = 'div[aria-label="Allow all cookies"]';
  try {
    if ((await page.$(allowCookiesSelector)) !== null) {
      await page.waitForSelector(allowCookiesSelector, { timeout: 5000 });
      await page.click(allowCookiesSelector);
    }
  } catch (error) {
    logger.info("No cookie consent popup found or error handling it");
  }

  // Handle Login Modal
  try {
    await page.waitForSelector('div[role="button"][aria-label="Close"]', {
      timeout: 5000,
    });
    await page.click('div[role="button"][aria-label="Close"]');
  } catch (error) {
    logger.info("No login modal found or error closing it.");
  }

  // Click on the seo_filters button
  try {
    await page.waitForSelector("#seo_filters", { timeout: 5000 });
    await page.click("#seo_filters");
  } catch (error) {
    logger.error("Error clicking seo_filters:", error);
    throw error;
  }

  // Focus on the location input field and clear it
  const inputSelector = 'input[aria-label="Location"]';
  try {
    await page.waitForSelector(inputSelector, { timeout: 5000 });
    await page.focus(inputSelector);
    await new Promise((r) => setTimeout(r, 100)); // Adding a small delay for stability
    await page.evaluate((selector) => {
      document.querySelector(selector).value = "";
    }, inputSelector);
  } catch (error) {
    logger.error("Error interacting with location input:", error);
    throw error;
  }

  // Update tab state to "city_search_ready" and set the correct URL
  tabData.state = "city_search_ready";
  tabData.url = page.url();
  await redisController.set(browserData.id, JSON.stringify(browserData));
}
