import puppeteer from "puppeteer";
import redisController from "../utils/redis-controller.mjs";
import startsFbMarketplace from "../fb-marketplace-automations/starts-fb-marketplace.mjs";
import revealCityInput from "../fb-marketplace-automations/reveal-city-input.mjs";

export async function prepareCitySearchTab(browserId) {
  const browserData = JSON.parse(await redisController.get(browserId));

  if (!browserData || !browserData.wsEndpoint) {
    throw new Error("Browser instance not found");
  }

  const browser = await puppeteer.connect({
    browserWSEndpoint: browserData.wsEndpoint,
  });

  const page = await browser.newPage();
  await page.authenticate({
    username: browserData.proxy.username,
    password: browserData.proxy.password,
  });

  // Create the tab data with initial state as "pending"
  const tabData = {
    id: `tab_${browserData.numberOfTabs + 1}`,
    url: "about:blank",
    state: "pending",
    targetId: await (async () => {
      const session = await page.createCDPSession();
      const info = await session.send("Target.getTargetInfo");
      return info.targetInfo.targetId;
    })(),
  };

  // Add the new tab to the browser data
  browserData.numberOfTabs += 1;
  browserData.tabs.push(tabData);

  // Save the updated browser data
  await redisController.set(browserId, JSON.stringify(browserData));

  try {
    // Prepare the tab for city search
    await startsFbMarketplace(page);
    await revealCityInput(page, browserData, tabData);

    // Update the tab state to "city_search_ready"
    tabData.state = "city_search_ready";
    tabData.url = await page.url();

    // Save the updated browser data again
    await redisController.set(browserId, JSON.stringify(browserData));

    return { tabId: tabData.id, page };
  } catch (error) {
    // If there's an error, update the tab state to "error"
    tabData.state = "error";
    await redisController.set(browserId, JSON.stringify(browserData));
    throw error;
  }
}
