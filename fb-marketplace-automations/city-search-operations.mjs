import redisController from "../utils/redis-controller.mjs";
import logger from "../utils/loki-logger.js";
import { clearCityInputAndTypeDesiredCity } from "./input-operations.mjs";
import revealCityInput from "./reveal-city-input.mjs";

export async function performCitySearch(
  page,
  browserData,
  readyTab,
  city,
  sure,
  nSelection,
  attempts = 0
) {
  readyTab.state = "pending";
  await redisController.set(browserData.id, JSON.stringify(browserData));
  logger.info(`Tab ${readyTab.id} set to pending state`);

  const inputSelector = 'input[aria-label="Location"]';

  try {
    await page.waitForSelector(inputSelector, { timeout: 5000 });
    await page.focus(inputSelector);
    await clearCityInputAndTypeDesiredCity(page, inputSelector, city);
    await page.waitForSelector('ul[role="listbox"]', { timeout: 5000 });
    await page.waitForSelector('ul[role="listbox"] li', { timeout: 5000 });
  } catch (error) {
    logger.error("Error in city input and suggestion handling:", error);
    if (attempts < 1) {
      await revealCityInput(page, browserData, readyTab);
      return performCitySearch(
        page,
        browserData,
        readyTab,
        city,
        sure,
        nSelection,
        attempts + 1
      );
    } else {
      logger.info("No cities found after multiple attempts");

      readyTab.state = "city_search_ready";
      await redisController.set(browserData.id, JSON.stringify(browserData));
      logger.info(`Tab ${readyTab.id} set to ready state`);

      return { status: 404, message: "No cities found" };
    }
  }

  const items = await page.$$('ul[role="listbox"] li');

  let jsonData = null;

  if (sure === "true") {
    jsonData = await getFinalCityId(
      page,
      items,
      nSelection,
      browserData,
      readyTab
    );
  } else {
    jsonData = await getAllCitySuggestions(page);
  }

  readyTab.state = "city_search_ready";
  await redisController.set(browserData.id, JSON.stringify(browserData));
  logger.info(`Tab ${readyTab.id} set to ready state`);

  return jsonData;
}

async function getFinalCityId(page, items, nSelection, browserData, readyTab) {
  try {
    const validSelection = Math.min(Math.max(parseInt(nSelection) || 0, 0), 4);
    if (items.length > validSelection) {
      await items[validSelection].click();
    } else {
      await items[0].click();
    }
  } catch (error) {
    logger.error("Error clicking on city suggestion:", error);
    throw new Error("Error selecting city: " + error.message);
  }

  try {
    await page.click('div[aria-label="Apply"]');
  } catch (error) {
    logger.error("Error applying city selection:", error);
    throw new Error("Error applying city selection: " + error.message);
  }

  try {
    // Wait for the URL with the city ID to load
    await page.waitForNavigation({ waitUntil: "domcontentloaded" });

    const currentUrl = page.url();
    const cityMatch = currentUrl.match(/\/marketplace\/([^/]+)/);
    const city = cityMatch ? cityMatch[1] : "unknown";

    setTimeout(() => {
      revealCityInput(page, browserData, readyTab);
    }, 0);

    return city;
  } catch (error) {
    logger.error("Error extracting city ID from URL:", error);
    throw new Error("Error extracting city ID: " + error.message);
  }
}

async function getAllCitySuggestions(page) {
  try {
    // Extract values from each li element
    return await page.evaluate(() => {
      const items = Array.from(
        document.querySelectorAll('ul[role="listbox"] li')
      );
      return items.map((item) => {
        const spans = item.querySelectorAll("span");
        return {
          firstValue: spans[0] ? spans[0].innerText : null,
          secondValue: spans[1] ? spans[1].innerText : null,
        };
      });
    });
  } catch (error) {
    logger.error("Error extracting city suggestions:", error);
    throw new Error("Error extracting city suggestions: " + error.message);
  }
}
