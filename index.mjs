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
  9;
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

app.listen(PORT, (err) => {
  if (err) {
    console.error(`Error starting server on port ${PORT}:`, err);
    process.exit(1);
  } else {
    console.log(`BOM running on port ${PORT}`);
  }
});
