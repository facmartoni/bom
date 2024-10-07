import puppeteer from "puppeteer";
import { execSync } from "child_process";

(async () => {
  // Launch a bare browser
  const browser = await puppeteer.launch();
  const browserPID = browser.process().pid;

  // Measure memory usage after launch (bare browser)
  console.log("Measuring bare browser memory...");
  const bareBrowserMemory = execSync(`ps -p ${browserPID} -o rss=`)
    .toString()
    .trim();
  const bareBrowserMemoryMB = (parseInt(bareBrowserMemory) / 1024).toFixed(2);
  console.log(`Bare browser memory: ${bareBrowserMemoryMB} MB`);

  // Open a page and load the required URL
  const page = await browser.newPage();
  await page.goto("https://facebook.com/marketplace"); // Replace with your actual page URL

  // Measure memory usage after page load
  console.log("Measuring browser memory after loading page...");
  const loadedPageMemory = execSync(`ps -p ${browserPID} -o rss=`)
    .toString()
    .trim();
  const loadedPageMemoryMB = (parseInt(loadedPageMemory) / 1024).toFixed(2);
  console.log(`Browser with loaded page memory: ${loadedPageMemoryMB} MB`);

  // Close the browser
  await browser.close();

  // Calculate the difference
  const memoryDifference = loadedPageMemory - bareBrowserMemory;
  const memoryDifferenceMB = (parseInt(memoryDifference) / 1024).toFixed(2);
  console.log(`Memory consumed by loaded page: ${memoryDifferenceMB} MB`);
})();
