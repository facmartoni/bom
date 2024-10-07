import express from "express";
import puppeteer from "puppeteer";
import Redis from "ioredis";
import dotenv from "dotenv";
import client from "prom-client";

dotenv.config();

// Load proxies from environment variables
const PROXIES = process.env.PROXIES
  ? process.env.PROXIES.split(",").map((proxy) => {
      const [ip, port, username, password] = proxy.split(":");
      return { ip, port, username, password };
    })
  : [];

const app = express();
const redis = new Redis(process.env.REDIS_URL);
const PORT = process.env.PORT || 3000;
const HEADLESS = process.env.HEADLESS === "false" ? false : true;
app.use(express.json());

let browserInstances = 0;

client.collectDefaultMetrics();

// Add a custom gauge for browser instances
const browserGauge = new client.Gauge({
  name: "bom_active_browser_instances",
  help: "Number of active browser instances",
});

// A metrics endpoint for Prometheus to scrape
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// Get the latest browser instance ID from Redis
async function getLatestBrowserInstance() {
  const keys = await redis.keys("browser_*");
  if (keys.length === 0) {
    return 0;
  }
  const instanceNumbers = keys
    .map((key) => parseInt(key.split("_")[1]))
    .filter((num) => !isNaN(num));
  return Math.max(...instanceNumbers);
}

// Ensure the server starts with the correct value for browserInstances
(async () => {
  browserInstances = await getLatestBrowserInstance();
})();

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).send("Server is running");
});

// Launch a new browser instance
app.post("/launch", async (req, res) => {
  let retryCount = 0;
  const maxRetries = 3;
  let browser = null;

  while (retryCount < maxRetries) {
    try {
      // Select a proxy with no browsers opened or the one with the least browsers
      let selectedProxy = null;
      let minBrowserCount = Infinity;

      for (const proxy of PROXIES) {
        const proxyCountKey = `proxy_count_${proxy.ip}:${proxy.port}`;
        let browserCount = parseInt(await redis.get(proxyCountKey)) || 0;

        if (browserCount < minBrowserCount) {
          selectedProxy = proxy;
          minBrowserCount = browserCount;
        }
      }

      if (!selectedProxy) {
        return res.status(500).send({ message: "No available proxies" });
      }

      // Launch a new browser instance with the selected proxy and authentication
      browser = await puppeteer.launch({
        headless: HEADLESS,
        args: [
          `--proxy-server=http://${selectedProxy.ip}:${selectedProxy.port}`,
        ],
      });

      browserInstances++; // Increment after retrieval to avoid duplicating IDs
      const proxyCountKey = `proxy_count_${selectedProxy.ip}:${selectedProxy.port}`;
      await redis.incr(proxyCountKey);
      const browserId = `browser_${browserInstances}`;

      // Store the browser instance data in Redis, including WebSocket endpoint
      const wsEndpoint = browser.wsEndpoint();
      const browserData = {
        id: browserId,
        proxy: { ip: selectedProxy.ip, port: selectedProxy.port },
        pid: browser.process().pid,
        wsEndpoint,
        numberOfTabs: 0,
        tabs: [],
      };

      await redis.set(browserId, JSON.stringify(browserData));

      browserGauge.inc();

      res.status(200).send({
        browserId,
        proxy: { ip: selectedProxy.ip, port: selectedProxy.port },
        message: "Browser launched successfully",
      });
      return;
    } catch (error) {
      console.error("Error launching browser with proxy:", error);
      retryCount++;
      if (browser) {
        await browser.close();
      }
      if (retryCount >= maxRetries) {
        res.status(500).send({
          message: "Failed to launch browser after multiple attempts",
          lastTriedProxy: { ip: selectedProxy.ip, port: selectedProxy.port },
        });
        return;
      }
    }
  }
});

// Retrieve all browser instances
app.get("/browsers", async (req, res) => {
  try {
    const keys = await redis.keys("browser_*");
    const instances = [];
    for (const key of keys) {
      const browserData = JSON.parse(await redis.get(key));
      instances.push(browserData);
    }
    res.status(200).send({ instances });
  } catch (error) {
    console.error("Error retrieving all browser instances:", error);
    res
      .status(500)
      .send({ message: "Failed to retrieve all browser instances" });
  }
});

// Close a specific browser instance
app.post("/close/:id", async (req, res) => {
  try {
    const browserId = req.params.id;
    const browserData = JSON.parse(await redis.get(browserId));
    if (!browserData) {
      return res.status(404).send({ message: "Browser instance not found" });
    }
    process.kill(browserData.pid);
    await redis.del(browserId);
    const proxyCountKey = `proxy_count_${browserData.proxy.ip}:${browserData.proxy.port}`;
    await redis.decr(proxyCountKey);
    browserGauge.dec(); // Decrease active browser count

    res.status(200).send({ message: "Browser instance closed successfully" });
  } catch (error) {
    console.error("Error closing browser:", error);
    res.status(500).send({ message: "Failed to close browser instance" });
  }
});

// Close all browser instances
app.post("/close-all", async (req, res) => {
  try {
    const keys = await redis.keys("browser_*");
    for (const key of keys) {
      const browserData = JSON.parse(await redis.get(key));
      if (browserData && browserData.pid) {
        try {
          // Attempt to kill the process directly
          process.kill(browserData.pid);
        } catch (err) {
          if (err.code !== "ESRCH") {
            console.error(`Error trying to kill PID ${browserData.pid}:`, err);
          }
        }
      }
      // Remove the key from Redis regardless of whether the process was killed successfully
      await redis.del(key);
    }

    // Reset browserInstances to zero after closing all browsers
    browserInstances = 0;
    browserGauge.set(0);
    for (const proxy of PROXIES) {
      const proxyCountKey = `proxy_count_${proxy.ip}:${proxy.port}`;
      await redis.set(proxyCountKey, 0);
    }

    res
      .status(200)
      .send({ message: "All browser instances closed successfully" });
  } catch (error) {
    console.error("Error closing all browsers:", error);
    res.status(500).send({ message: "Failed to close all browser instances" });
  }
});

async function closeAllBrowsers() {
  try {
    const response = await fetch(`http://localhost:${PORT}/close-all`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const result = await response.json();
    console.log("Successfully called /close-all:", result);
  } catch (error) {
    console.error("Error calling /close-all:", error);
  }
}

// Endpoint to retrieve proxy usage information
app.get("/proxies", async (req, res) => {
  try {
    const proxiesInfo = [];
    for (const proxy of PROXIES) {
      const proxyCountKey = `proxy_count_${proxy.ip}:${proxy.port}`;
      const browserCount = parseInt(await redis.get(proxyCountKey)) || 0;
      proxiesInfo.push({
        proxy: `${proxy.ip}:${proxy.port}`,
        browserCount,
      });
    }
    res.status(200).send({ proxies: proxiesInfo });
  } catch (error) {
    console.error("Error retrieving proxy information:", error);
    res.status(500).send({ message: "Failed to retrieve proxy information" });
  }
});

// Update a specific browser instance with a new tab
app.post("/browser/:id/tab", async (req, res) => {
  try {
    const browserId = req.params.id;
    const url = req.body.url || "about:blank";
    const browserData = JSON.parse(await redis.get(browserId));

    if (!browserData || !browserData.wsEndpoint) {
      return res.status(404).send({ message: "Browser instance not found" });
    }

    // Reconnect to the existing browser using the WebSocket endpoint
    const browser = await puppeteer.connect({
      browserWSEndpoint: browserData.wsEndpoint,
    });
    const page = await browser.newPage();
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
      })(), // Store target ID for unique identification
    };

    browserData.numberOfTabs += 1;
    browserData.tabs.push(tabData);

    await redis.set(browserId, JSON.stringify(browserData));

    res.status(200).send({ tabId, message: "Tab opened successfully" });
  } catch (error) {
    console.error("Error opening new tab:", error);
    res.status(500).send({ message: "Failed to open new tab" });
  }
});

// Navigate to a specific URL in a given tab
app.post("/browser/:browserId/tab/:tabId/navigate", async (req, res) => {
  try {
    const browserId = req.params.browserId;
    const tabId = req.params.tabId;
    const newUrl = req.body.url;

    if (!newUrl) {
      return res.status(400).send({ message: "URL is required" });
    }

    const browserData = JSON.parse(await redis.get(browserId));

    if (!browserData || !browserData.wsEndpoint) {
      return res.status(404).send({ message: "Browser instance not found" });
    }

    const tabData = browserData.tabs.find((tab) => tab.id === tabId);
    if (!tabData) {
      return res.status(404).send({ message: "Tab not found" });
    }

    // Reconnect to the existing browser using the WebSocket endpoint
    const browser = await puppeteer.connect({
      browserWSEndpoint: browserData.wsEndpoint,
      defaultViewport: { width: 1280, height: 800 }, // Ensure consistent viewport
    });
    const pages = await browser.pages();
    let page = pages.find((p) => p.url() === tabData.url);

    if (!page) {
      console.log("Tab not found by URL. Checking by target ID...");
      for (const p of pages) {
        const session = await p.createCDPSession();
        const info = await session.send("Target.getTargetInfo");
        if (info.targetInfo.targetId === tabData.targetId) {
          page = p;
          break;
        }
      }
    }

    if (!page) {
      return res.status(404).send({ message: "Tab page not found" });
    }

    await page.setViewport({ width: 1280, height: 800 }); // Set consistent viewport size
    await page.goto(newUrl);

    // Update tab data with the new URL
    tabData.url = newUrl;
    await redis.set(browserId, JSON.stringify(browserData));

    res.status(200).send({ message: "Navigation successful" });
  } catch (error) {
    console.error("Error navigating to URL:", error);
    res.status(500).send({ message: "Failed to navigate to URL" });
  }
});

// Define the function to transform a tab into a ready-to-search city tab
async function prepareTabForCitySearch(page) {
  const url = process.env.MARKETPLACE_URL;
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Handle Cookies Modal
  const allowCookiesSelector = 'div[aria-label="Allow all cookies"]';
  if ((await page.$(allowCookiesSelector)) !== null) {
    await page.click(allowCookiesSelector);
  } else {
    console.log("No cookie consent popup found.");
  }

  // Handle Login Modal
  try {
    await page.waitForSelector('div[role="button"][aria-label="Close"]', {
      timeout: 5000,
    });
    await page.click('div[role="button"][aria-label="Close"]');
  } catch (error) {
    console.log("No login modal found.");
  }

  await page.waitForSelector("#seo_filters", { timeout: 5000 });
  await page.click("#seo_filters");

  const inputSelector = 'input[aria-label="Location"]';
  await page.waitForSelector(inputSelector, { timeout: 5000 });
  await page.focus(inputSelector);
  await new Promise((r) => setTimeout(r, 200)); // Adding a small delay for stability
  await page.evaluate((selector) => {
    document.querySelector(selector).value = "";
  }, inputSelector);
}

// Launch a new browser instance from a given proxy
app.post("/launch-from-proxy", async (req, res) => {
  const { proxy } = req.body;
  if (!proxy || !proxy.ip || !proxy.port) {
    return res.status(400).send({ message: "Proxy IP and port are required" });
  }

  try {
    // Launch a new browser instance with the provided proxy
    const browser = await puppeteer.launch({
      headless: HEADLESS,
      args: [`--proxy-server=http://${proxy.ip}:${proxy.port}`],
      defaultViewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36",
    });

    browserInstances++;
    const proxyCountKey = `proxy_count_${proxy.ip}:${proxy.port}`;
    await redis.incr(proxyCountKey);
    const browserId = `browser_${browserInstances}`;

    // Create a new tab with state "pending"
    const page = await browser.newPage();
    const tabId = `tab_1`;
    const tabData = {
      id: tabId,
      url: "about:blank",
      state: "pending",
      targetId: await (async () => {
        const session = await page.createCDPSession();
        const info = await session.send("Target.getTargetInfo");
        return info.targetInfo.targetId;
      })(), // Store target ID for unique identification
    };

    // Store the browser instance data in Redis, including WebSocket endpoint
    const wsEndpoint = browser.wsEndpoint();
    const browserData = {
      id: browserId,
      proxy: { ip: proxy.ip, port: proxy.port },
      pid: browser.process().pid,
      wsEndpoint,
      numberOfTabs: 1,
      tabs: [tabData],
    };

    await redis.set(browserId, JSON.stringify(browserData));

    browserGauge.inc();

    // Call the function to prepare the tab for city search
    await prepareTabForCitySearch(page);

    // Update tab state to "completed"
    tabData.state = "city_search_ready";
    await redis.set(browserId, JSON.stringify(browserData));

    res.status(200).send({
      browserId,
      tabId,
      message: "Browser launched and City Search Tab opened successfully",
    });
  } catch (error) {
    console.error("Error launching browser with provided proxy:", error);
    res
      .status(500)
      .send({ message: "Failed to launch browser with provided proxy" });
  }
});

async function launchBrowserWithRandomProxy() {
  const proxies = process.env.PROXIES.split(",").map((proxy) => {
    const [ip, port] = proxy.split(":");
    return { ip, port };
  });
  const randomProxy = proxies[Math.floor(Math.random() * proxies.length)];

  try {
    const response = await fetch(`http://localhost:${PORT}/launch-from-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        proxy: {
          ip: randomProxy.ip,
          port: randomProxy.port,
        },
      }),
    });
    const data = await response.text();
    console.log("Successfully called /launch-from-proxy:", data);
  } catch (error) {
    console.error("Error calling /launch-from-proxy:", error);
  }
}

// Endpoint to search for a city in the available tabs
app.post("/search-city", async (req, res) => {
  const { city, sure } = req.body;
  if (!city) {
    return res.status(400).send({ message: "City is required" });
  }

  try {
    const keys = await redis.keys("browser_*");
    let selectedBrowser = null;
    let minTabsCount = Infinity;

    for (const key of keys) {
      const browserData = JSON.parse(await redis.get(key));
      const readyTab = browserData.tabs.find(
        (tab) => tab.state === "city_search_ready"
      );
      if (readyTab && browserData.numberOfTabs < minTabsCount) {
        selectedBrowser = { browserData, readyTab };
        minTabsCount = browserData.numberOfTabs;
      }
    }

    if (!selectedBrowser) {
      return res
        .status(404)
        .send({ message: "No browser with a ready tab found" });
    }

    const { browserData, readyTab } = selectedBrowser;

    // Reconnect to the existing browser using the WebSocket endpoint
    const browser = await puppeteer.connect({
      browserWSEndpoint: browserData.wsEndpoint,
      defaultViewport: { width: 1280, height: 800 },
    });
    const pages = await browser.pages();
    let page = null;

    // Check for the page using the targetId directly
    for (const p of pages) {
      const session = await p.createCDPSession();
      const info = await session.send("Target.getTargetInfo");
      if (info.targetInfo.targetId === readyTab.targetId) {
        page = p;
        break;
      }
    }

    // If page is still not found, log the available pages for debugging
    if (!page) {
      console.log("Available pages:");
      for (const p of pages) {
        const session = await p.createCDPSession();
        const info = await session.send("Target.getTargetInfo");
        console.log(
          `Page URL: ${await p.url()}, Target ID: ${info.targetInfo.targetId}`
        );
      }
      return res.status(404).send({ message: "Tab page not found" });
    }

    const inputSelector = 'input[aria-label="Location"]';

    await page.waitForSelector(inputSelector, { timeout: 5000 });
    await page.focus(inputSelector);
    await clearAndType(page, inputSelector, city);

    await page.waitForSelector('ul[role="listbox"]', { timeout: 5000 });
    await page.waitForSelector('ul[role="listbox"] li', { timeout: 10000 });

    let jsonData = null;
    if (sure === "true") {
      // Click on the first suggestion
      await page.click('ul[role="listbox"] li:first-child');

      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Tab");
        await new Promise((r) => setTimeout(r, 100));
      }

      await page.keyboard.press("Enter");

      // Wait for the URL to change without waiting for all resources to load
      await page.waitForNavigation({ waitUntil: "domcontentloaded" });

      const currentUrl = page.url();
      const cityMatch = currentUrl.match(/\/marketplace\/([^/]+)/);
      const city = cityMatch ? cityMatch[1] : "unknown";

      jsonData = city;

      // Update browser data in Redis
      browserData.tabs = browserData.tabs.filter(
        (tab) => tab.targetId !== readyTab.targetId
      );
      browserData.numberOfTabs--;
      await redis.set(browserData.id, JSON.stringify(browserData));

      // Close the tab
      await page.close();

      try {
        res.status(200).send({ data: jsonData });
      } finally {
        const newTab = await browser.newPage();
        await prepareTabForCitySearch(newTab); // Use the prepareTabForCitySearch function

        // Update browser data in Redis with the new tab information
        browserData.tabs.push({
          targetId: await (async () => {
            const session = await newTab.createCDPSession();
            const info = await session.send("Target.getTargetInfo");
            return info.targetInfo.targetId;
          })(),
          url: newTab.url(),
          state: "city_search_ready",
        });
        await redis.set(browserData.id, JSON.stringify(browserData));
      }
    } else {
      // Extract values from each li element
      jsonData = await page.evaluate(() => {
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
      try {
        res.status(200).send({ data: jsonData });
      } finally {
        await clearAndType(page, inputSelector, "asdasdasd");
      }
    }
  } catch (error) {
    console.error("Error searching city:", error);
    res.status(500).send({ message: "Failed to search city" });
  }
});

async function clearAndType(page, selector, value) {
  await page.evaluate((selector) => {
    const inputElement = document.querySelector(selector);
    inputElement.value = ""; // Clear the input value
    inputElement.dispatchEvent(new Event("input", { bubbles: true })); // Trigger input event
    inputElement.dispatchEvent(new Event("change", { bubbles: true })); // Trigger change event
  }, selector);
  await page.keyboard.press("End"); // Move cursor to the end
  await page.keyboard.down("Control");
  await page.keyboard.press("A"); // Select all text
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace"); // Delete selected text
  await new Promise((resolve) => setTimeout(resolve, 100));
  await page.type(selector, value, { delay: 50 }); // Type with a slight delay between keystrokes
  await page.evaluate(
    (selector, value) => {
      const inputElement = document.querySelector(selector);
      inputElement.value = value; // Ensure the value is set
      inputElement.dispatchEvent(new Event("input", { bubbles: true }));
      inputElement.dispatchEvent(new Event("change", { bubbles: true }));
    },
    selector,
    value
  );
}

app.listen(PORT, (err) => {
  if (err) {
    console.error(`Error starting server on port ${PORT}:`, err);
    process.exit(1);
  } else {
    console.log(`BOM running on port ${PORT}`);
    closeAllBrowsers();
    launchBrowserWithRandomProxy();
  }
});
