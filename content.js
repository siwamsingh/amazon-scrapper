function scrapeAmazonProduct() {
  const titleEl = document.querySelector("#productTitle");

  if (!titleEl) return null;

  const title = titleEl.innerText.trim();

  const price =
    document.querySelector(".a-price .a-offscreen")?.innerText || "";

  const rating =
    document.querySelector("#acrPopover")?.getAttribute("title") || "";

  const reviewCount =
    document.querySelector("#acrCustomerReviewText")?.innerText || "";

  const asin =
    document.querySelector("#ASIN")?.value ||
    location.href.split("/dp/")[1]?.split("/")[0] ||
    "";

  const images = [];
  document.querySelectorAll("#altImages img").forEach(img => {
    if (img.src) images.push(img.src);
  });

  return {
    title,
    price,
    rating,
    reviewCount,
    asin,
    images: images.join("|"),
    url: location.href
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "GET_PRODUCT") {
    const product = scrapeAmazonProduct();
    sendResponse(product);
  }
});