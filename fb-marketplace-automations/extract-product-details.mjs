import logger from "../utils/loki-logger.js";

async function extractProductDetails(page, FREE_WORDS, PRODUCT_LIMIT) {
  try {
    await page.waitForSelector('a[href*="/marketplace/item/"]', {
      timeout: 10000,
    });

    const productDetails = await page.evaluate(
      (FREE_WORDS, PRODUCT_LIMIT) => {
        const products = Array.from(
          document.querySelectorAll('a[href*="/marketplace/item/"]')
        ).slice(0, PRODUCT_LIMIT);

        if (products.length === 0) {
          console.warn("There are no products!");
          return [];
        }

        return products.map((product) => {
          // Product Cover Image URL
          const imgElement = product.querySelector("img");
          const imgUrl = imgElement ? imgElement.src : null;

          // Price, Title and City
          const spans = product.querySelectorAll('span[dir="auto"]');

          let price = null;
          let title = null;
          let city = null;

          for (const span of spans) {
            const text = span.textContent.trim();

            if (!price) {
              const pricePattern = /^([^\d]*)([\d\s.,]+)([^\d]*)$/;
              const isPrice = pricePattern.test(text);

              const isFree = FREE_WORDS.some(
                (word) => text.toLowerCase() === word.toLowerCase()
              );

              if (isPrice || isFree) {
                price = text;
                continue;
              }
            }

            if (price && !title && spans[spans.length - 1].textContent.trim()) {
              if (price && title && !city) {
                city = text;
                continue;
              }
              title = text;
              continue;
            }

            if (price && !city) {
              city = text;
              break;
            }
          }

          // Product ID
          const href = product.getAttribute("href");
          const idMatch = href
            ? href.match(/\/marketplace\/item\/(\d+)/)
            : null;
          const id = idMatch ? idMatch[1] : null;

          return { imgUrl, title, price, city, id };
        });
      },
      FREE_WORDS,
      PRODUCT_LIMIT
    );

    return productDetails;
  } catch (error) {
    logger.error("Error extracting product details:", error.message);
    return [];
  }
}

export default extractProductDetails;
