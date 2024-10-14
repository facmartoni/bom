// Environment variables
import dotenv from "dotenv";
dotenv.config();

// API Management
import express from "express";
import cors from "cors";

// Redis
import redisController from "./utils/redis-controller.mjs";

// Prometheus metrics
import { getMetrics, getContentType } from "./utils/prometheus-metrics.js";

// Logging with Loki
import logger from "./utils/loki-logger.js";

// Facebook Marketplace Automation
import { FREE_WORDS } from "./fb-marketplace-automations/config.mjs";
import extractProductDetails from "./fb-marketplace-automations/extract-product-details.mjs";
import { performCitySearch } from "./fb-marketplace-automations/city-search-operations.mjs";

// Browser Management
import { garbageCollectBrowsers } from "./browser-management/garbage-collector.mjs";
import getAllBrowsers from "./browser-management/get-all-browsers.mjs";
import closeBrowser from "./browser-management/close-browser.mjs";
import {
  decrementBrowserInstances,
  updateProxyCount,
  initializeBrowserState,
} from "./browser-management/browser-state.mjs";
import { createNewTab } from "./browser-management/create-new-tab.mjs";
import { findCitySearchReadyTab } from "./browser-management/find-city-search-ready-tab.mjs";
import { connectToBrowserAndGetCitySearchReadyPage } from "./browser-management/connect-to-browser.mjs";
import { constructSearchUrl } from "./browser-management/construct-search-url.mjs";
import { launchBrowserWithProxy } from "./browser-management/launch-browser-with-proxy.mjs";
import { launchBrowserIfNeeded } from "./browser-management/launch-browser.mjs";
import { closeAllBrowsers } from "./browser-management/close-all-browsers.mjs";

// Proxy Management
import { getProxiesInfo } from "./browser-management/proxy-management.mjs";

// Utils
import updateRamUsage from "./utils/update-ram-usage.mjs";

// Configuration
const PROXIES = process.env.PROXIES
  ? process.env.PROXIES.split(",").map((proxy) => {
      const [ip, port, username, password] = proxy.split(":");
      return { ip, port, username, password };
    })
  : [];
const PORT = process.env.PORT || 3001;
const GARBAGE_COLLECTOR_INTERVAL =
  parseInt(process.env.GARBAGE_COLLECTOR_INTERVAL) || 600000;
const RAM_USAGE_INTERVAL = parseInt(process.env.RAM_USAGE_INTERVAL) || 60000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";

// ******************************
// *** EXPRESS INITIALIZATION ***
// ******************************

const app = express();

// CORS
app.use(
  cors({
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body parser
app.use(express.json());

// ***********************
// *** BASIC ENDPOINTS ***
// ***********************

// Metrics endpoint
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", getContentType());
  res.end(await getMetrics());
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).send("Server is running");
});

// **************************
// *** BROWSER MANAGEMENT ***
// **************************

// Retrieve all browser instances
app.get("/browsers", async (req, res) => {
  try {
    const instances = await getAllBrowsers();
    res.status(200).send({ instances });
  } catch (error) {
    logger.error("Error retrieving all browser instances:", error);
    res
      .status(500)
      .send({ message: "Failed to retrieve all browser instances" });
  }
});

// Close a specific browser instance
app.post("/close/:id", async (req, res) => {
  try {
    const browserId = req.params.id;
    const result = await closeBrowser(browserId);
    decrementBrowserInstances();
    const browserData = JSON.parse(await redisController.get(browserId));
    if (browserData && browserData.proxy) {
      await updateProxyCount(browserData.proxy, false);
    }
    await updateRamUsage();
    res.status(200).send(result);
  } catch (error) {
    logger.error("Error closing browser:", error);
    res
      .status(error.message === "Browser instance not found" ? 404 : 500)
      .send({ message: error.message || "Failed to close browser instance" });
  }
});

// Retrieve proxy usage information
app.get("/proxies", async (req, res) => {
  try {
    const proxiesInfo = await getProxiesInfo(PROXIES);
    res.status(200).send({ proxies: proxiesInfo });
  } catch (error) {
    logger.error("Error retrieving proxy information:", error);
    res.status(500).send({ message: "Failed to retrieve proxy information" });
  }
});

// ********************************
// *** FB MARKETPLACE ENDPOINTS ***
// ********************************

// Retrieve all the cities from the dropdown or the final city ID
app.post("/search-city", async (req, res) => {
  const { city, sure, nSelection } = req.body;
  if (!city) return res.status(400).send({ message: "City is required" });

  try {
    const { browserData, readyTab } = await findCitySearchReadyTab();
    if (!browserData)
      return res.status(404).send({ message: "No ready tab found" });

    const { page } = await connectToBrowserAndGetCitySearchReadyPage(
      browserData,
      readyTab
    );

    const jsonData = await performCitySearch(
      page,
      browserData,
      readyTab,
      city,
      sure,
      nSelection
    );

    res.status(200).send({ data: jsonData });
  } catch (error) {
    logger.error("Error in /search-city:", error);
    if (!res.headersSent) res.status(500).send({ message: error.message });
  }
});

// Retrieve product details after search
app.post("/search-products", async (req, res) => {
  const {
    city,
    searchTerm,
    minPrice,
    maxPrice,
    productLimit = 9,
    daysSinceListed = 7,
  } = req.body;

  if (!city || !searchTerm) {
    return res
      .status(400)
      .send({ message: "City and search term are required" });
  }

  try {
    // Start the browser launch process without awaiting it
    launchBrowserIfNeeded(PROXIES);

    // Choose the browser with the least tabs
    const browsers = await getAllBrowsers();
    const selectedBrowser = browsers.reduce((min, browser) =>
      browser.numberOfTabs < min.numberOfTabs ? browser : min
    );

    // Create a new tab in the selected browser
    const { tabId, page } = await createNewTab(selectedBrowser.id);

    // Construct the search URL
    const url = constructSearchUrl(
      city,
      searchTerm,
      daysSinceListed,
      minPrice,
      maxPrice
    );

    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Extract product details
    const productDetails = await extractProductDetails(
      page,
      FREE_WORDS,
      productLimit
    );

    // Close the tab
    await page.close();
    await updateRamUsage();

    // Send the response with product details
    res.status(200).send({
      data: productDetails,
    });
  } catch (error) {
    logger.error("Error searching products:", error);
    res
      .status(500)
      .send({ message: "Failed to search products", error: error.message });
  }
});

// ****************************************
// *** GARBAGE COLLECTOR INITIALIZATION ***
// ****************************************

setInterval(
  () =>
    garbageCollectBrowsers(
      () => getAllBrowsers(),
      (browserId) => closeBrowser(browserId)
    ),
  GARBAGE_COLLECTOR_INTERVAL
);

// *****************************
// *** SERVER INITIALIZATION ***
// ****************************

function startRamUsageMonitoring() {
  setInterval(updateRamUsage, RAM_USAGE_INTERVAL);
}

app.listen(PORT, async (err) => {
  if (err) {
    logger.error(`Error starting server on port ${PORT}:`, err);
    process.exit(1);
  } else {
    try {
      await closeAllBrowsers(PROXIES);
      await initializeBrowserState();
      startRamUsageMonitoring();
      logger.info(`BOM running on port ${PORT}`);

      // Launch a browser only if there are no existing browsers
      const existingBrowsers = await getAllBrowsers();
      if (existingBrowsers.length === 0) {
        const randomProxy = PROXIES[Math.floor(Math.random() * PROXIES.length)];
        const { browserId, tabId } = await launchBrowserWithProxy(randomProxy);
        logger.info(`Initial browser launched: ${browserId}, tab: ${tabId}`);
      } else {
        logger.info(
          `Using existing browser. Total browsers: ${existingBrowsers.length}`
        );
      }
    } catch (error) {
      logger.error("Error during server initialization:", error);
      process.exit(1);
    }
  }
});
