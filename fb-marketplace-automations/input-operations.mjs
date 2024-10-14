import logger from "../utils/loki-logger.js";

export async function clearCityInputAndTypeDesiredCity(page, selector, value) {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await page.evaluate((selector) => {
        const inputElement = document.querySelector(selector);
        inputElement.value = "";
        inputElement.dispatchEvent(new Event("input", { bubbles: true }));
        inputElement.dispatchEvent(new Event("change", { bubbles: true }));
      }, selector);

      await page.focus(selector);
      await page.keyboard.down("Control");
      await page.keyboard.press("A");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");

      await new Promise((resolve) => setTimeout(resolve, 100));

      await page.type(selector, value, { delay: 50 });

      const inputValue = await page.$eval(selector, (el) => el.value);
      if (inputValue === value) {
        return; // Success, exit the function
      }
    } catch (error) {
      logger.error(`Attempt ${attempt + 1} failed:`, error);
      if (attempt === maxAttempts - 1) throw error;
    }
  }
}
