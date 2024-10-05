import express from "express";
import puppeteer from "puppeteer";
import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const redis = new Redis(process.env.REDIS_URL);
const PORT = process.env.PORT || 3000;
const HEADLESS = process.env.HEADLESS === "false" ? false : true;
app.use(express.json());

let browserInstances = 0;

// Function to get the latest browser instance ID from Redis
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

// Updated launch endpoint
app.post("/launch", async (req, res) => {
  try {
    const browser = await puppeteer.launch({
      headless: process.env.HEADLESS === "false" ? false : true,
    });
    browserInstances++; // Increment after retrieval to avoid duplicating IDs
    const browserId = `browser_${browserInstances}`;

    // Store the browser instance in Redis
    await redis.set(browserId, browser.process().pid);

    res
      .status(200)
      .send({ browserId, message: "Browser launched successfully" });
  } catch (error) {
    console.error("Error launching browser:", error);
    res.status(500).send({ message: "Failed to launch browser" });
  }
});

// Retrieve a browser instance by ID
app.get("/browser/:id", async (req, res) => {
  try {
    const browserId = req.params.id;
    const pid = await redis.get(browserId);

    if (pid) {
      res
        .status(200)
        .send({ browserId, pid, message: "Browser instance found" });
    } else {
      res.status(404).send({ message: "Browser instance not found" });
    }
  } catch (error) {
    console.error("Error retrieving browser:", error);
    res.status(500).send({ message: "Failed to retrieve browser instance" });
  }
});

// Close a browser instance by ID
app.post("/close/:id", async (req, res) => {
  try {
    const browserId = req.params.id;
    const pid = await redis.get(browserId);

    if (!pid) {
      return res.status(404).send({ message: "Browser instance not found" });
    }

    process.kill(pid);
    await redis.del(browserId);

    res.status(200).send({ message: "Browser instance closed successfully" });
  } catch (error) {
    console.error("Error closing browser:", error);
    res.status(500).send({ message: "Failed to close browser instance" });
  }
});

// Endpoint to kill all browser instances
app.post("/close-all", async (req, res) => {
  try {
    const keys = await redis.keys("browser_*");
    for (const key of keys) {
      const pid = await redis.get(key);
      if (pid) {
        try {
          // Check if the process is still running before attempting to kill it
          process.kill(pid, 0);
          process.kill(pid);
        } catch (err) {
          if (err.code === "ESRCH") {
            console.warn(
              `Process with PID ${pid} does not exist, removing from Redis`
            );
          } else {
            console.error(`Error trying to kill PID ${pid}:`, err);
            continue;
          }
        }
      }
      // Remove the key from Redis regardless of whether the process was killed successfully
      await redis.del(key);
    }

    res
      .status(200)
      .send({ message: "All browser instances closed successfully" });
  } catch (error) {
    console.error("Error closing all browsers:", error);
    res.status(500).send({ message: "Failed to close all browser instances" });
  }
});

// Endpoint to retrieve all browser instances
app.get("/browsers", async (req, res) => {
  try {
    const keys = await redis.keys("browser_*");
    const instances = [];
    for (const key of keys) {
      const pid = await redis.get(key);
      instances.push({ browserId: key, pid });
    }
    res.status(200).send({ instances });
  } catch (error) {
    console.error("Error retrieving all browser instances:", error);
    res
      .status(500)
      .send({ message: "Failed to retrieve all browser instances" });
  }
});

app.listen(PORT, () => {
  console.log(`BOM running on port ${PORT}`);
});
