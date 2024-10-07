import express from "express";
import puppeteer from "puppeteer";
import Redis from "ioredis";
import dotenv from "dotenv";
import client from "prom-client";

dotenv.config();

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
  try {
    const browser = await puppeteer.launch({
      headless: HEADLESS,
    });

    browserInstances++; // Increment after retrieval to avoid duplicating IDs
    const browserId = `browser_${browserInstances}`;

    // Store the browser instance data in Redis, including WebSocket endpoint
    const wsEndpoint = browser.wsEndpoint();
    const browserData = {
      id: browserId,
      pid: browser.process().pid,
      wsEndpoint,
      numberOfTabs: 0,
      tabs: [],
    };

    await redis.set(browserId, JSON.stringify(browserData));

    browserGauge.inc();

    res
      .status(200)
      .send({ browserId, message: "Browser launched successfully" });
  } catch (error) {
    console.error("Error launching browser:", error);
    res.status(500).send({ message: "Failed to launch browser" });
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

    res
      .status(200)
      .send({ message: "All browser instances closed successfully" });
  } catch (error) {
    console.error("Error closing all browsers:", error);
    res.status(500).send({ message: "Failed to close all browser instances" });
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
    });
    const pages = await browser.pages();
    const page = await (async () => {
      for (const p of pages) {
        const session = await p.createCDPSession();
        const info = await session.send("Target.getTargetInfo");
        if (info.targetInfo.targetId === tabData.targetId) {
          return p;
        }
      }
      return null;
    })();

    if (!page) {
      return res.status(404).send({ message: "Tab page not found" });
    }

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

app.listen(PORT, (err) => {
  if (err) {
    console.error(`Error starting server on port ${PORT}:`, err);
    process.exit(1);
  } else {
    console.log(`BOM running on port ${PORT}`);
  }
});
