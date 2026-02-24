let currentProduct = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await fetchCurrentProduct();
  loadProducts();
}

/* ===============================
   SCRAPER – inject into page
================================ */
async function fetchCurrentProduct() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const clean = (txt) =>
        txt ? txt.replace(/[^\x00-\x7F]/g, "").trim() : "";

      const digitsOnly = (txt) => (txt ? txt.replace(/[^0-9X]/gi, "") : "");

      const safeText = (sel) =>
        clean(document.querySelector(sel)?.innerText || "");

      const safeAttr = (sel, attr) =>
        clean(document.querySelector(sel)?.getAttribute(attr) || "");

      // TITLE
      const title = safeText("#productTitle").replace(/\s+/g, " ");

      if (!title) return null;

      // PRICE (expanded selectors)
      const price =
        safeText(".a-price .a-offscreen") ||
        safeText("#priceblock_ourprice") ||
        safeText("#priceblock_dealprice") ||
        safeText("#price_inside_buybox") ||
        safeText(".a-price.aok-align-center .a-offscreen") ||
        "";

      // MRP
      const mrp =
        safeText(".priceBlockStrikePriceString") ||
        safeText(".a-text-price .a-offscreen") ||
        "";

      // ASIN
      const asin =
        document.querySelector("#ASIN")?.value ||
        location.href.split("/dp/")[1]?.split("/")[0] ||
        "";

      // AMAZON URL
      const amazon_url = location.href;

      // RATING
      const rating =
        safeAttr("#acrPopover", "title") || safeText(".a-icon-alt");

      // DESCRIPTION (book specific)
      let description =
        safeText("#bookDescription_feature_div") ||
        safeText("#productDescription") ||
        safeText("#feature-bullets");

      // Handle iframe description (common in books)
      const iframe = document.querySelector(
        "#bookDescription_feature_div iframe",
      );
      if (iframe) {
        try {
          description = clean(iframe.contentDocument.body.innerText);
        } catch {}
      }

      // IMAGES
      let images = [];
      const imgBlock = document.querySelector("#imgTagWrapperId img");

      if (imgBlock) {
        try {
          const json = imgBlock.getAttribute("data-a-dynamic-image");
          if (json) images = Object.keys(JSON.parse(json));
        } catch {}
      }

      if (!images.length) {
        document.querySelectorAll("#altImages img").forEach((img) => {
          if (img.src) images.push(img.src);
        });
      }

      // ISBN EXTRACTION — precise + safe
      let isbn10 = "";
      let isbn13 = "";
      let isbn = "";

      function findISBN(text) {
        if (!text) return;

        // match ISBN-10 pattern
        const match10 = text.match(/ISBN-10[^0-9X]*([0-9X\-]{10,})/i);
        if (match10 && !isbn10) {
          isbn10 = match10[1].replace(/[^0-9X]/gi, "");
        }

        // match ISBN-13 pattern
        const match13 = text.match(/ISBN-13[^0-9]*([0-9\-]{13,})/i);
        if (match13 && !isbn13) {
          isbn13 = match13[1].replace(/[^0-9]/g, "");
        }
      }

      // scan all known sections
      document
        .querySelectorAll("#detailBullets_feature_div li")
        .forEach((li) => findISBN(li.innerText));
      document
        .querySelectorAll("#productDetails_detailBullets_sections1 tr")
        .forEach((tr) => findISBN(tr.innerText));
      document
        .querySelectorAll(".prodDetTable tr")
        .forEach((tr) => findISBN(tr.innerText));
      document
        .querySelectorAll("#detailBulletsWrapper_feature_div")
        .forEach((div) => findISBN(div.innerText));

      isbn = isbn13 || isbn10 || "";

      return {
        title,
        images: images.join("|"),
        price,
        mrp,
        asin,
        "isbn-10": isbn10,
        "isbn-13": isbn13,
        isbn,
        amazon_url,
        rating,
        description,
      };
    },
  });

  currentProduct = results?.[0]?.result || null;
}

/* ===============================
   ADD PRODUCT
================================ */
async function addProduct() {
  if (!currentProduct) {
    setStatus("Open a valid Amazon product page");
    return;
  }

  const data = await chrome.storage.local.get("products");
  const products = data.products || [];

  if (!products.find((p) => p.amazon_url === currentProduct.amazon_url)) {
    products.push(currentProduct);
    await chrome.storage.local.set({ products });
    setStatus("Product added");
  } else {
    setStatus("Already added");
  }

  loadProducts();
}

/* ===============================
   REMOVE PRODUCT
================================ */
async function removeProduct() {
  if (!currentProduct) return;

  const data = await chrome.storage.local.get("products");
  let products = data.products || [];

  products = products.filter((p) => p.amazon_url !== currentProduct.amazon_url);

  await chrome.storage.local.set({ products });

  setStatus("Removed");
  loadProducts();
}

/* ===============================
   EXPORT CSV
================================ */
async function exportCSV() {
  const data = await chrome.storage.local.get("products");
  const products = data.products || [];

  if (!products.length) {
    setStatus("No products");
    return;
  }

  const csv = convertProductsToCSV(products);
  downloadCSV(csv);
}

/* ===============================
   CLEAR EXTENSION
================================ */
async function clearExtension() {
  await chrome.storage.local.clear();
  loadProducts();
  setStatus("Cleared");
}

/* ===============================
   CSV BUILDER
================================ */
function convertProductsToCSV(products) {
  const headers = [
    "title",
    "images",
    "price",
    "mrp",
    "asin",
    "isbn-10",
    "isbn-13",
    "isbn",
    "amazon_url",
    "rating",
    "description",
  ];

  const escapeCSV = (value, key) => {
    if (!value) return "";

    let v = String(value).replace(/"/g, '""').replace(/\n/g, " ").trim();

    // IMPORTANT: force Excel to treat ISBN as TEXT
    if (key.includes("isbn")) {
      return `"${v}\t"`;   // tab character forces text format
    }

    return `"${v}"`;
  };

  const rows = products.map((p) =>
    headers.map((h) => escapeCSV(p[h], h)).join(",")
  );

  return headers.join(",") + "\n" + rows.join("\n");
}


function downloadCSV(csv) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url,
    filename: "amazon-books.csv",
  });
}

/* ===============================
   UI HELPERS
================================ */
function setStatus(msg) {
  document.getElementById("status").innerText = msg;
}

async function loadProducts() {
  const data = await chrome.storage.local.get("products");
  const products = data.products || [];

  const list = document.getElementById("productList");
  list.innerHTML = "";

  products.forEach((p) => {
    const li = document.createElement("li");
    li.innerText = p.title;
    list.appendChild(li);
  });
}

/* ===============================
   BUTTON BINDINGS
================================ */
document.getElementById("addBtn").onclick = addProduct;
document.getElementById("removeBtn").onclick = removeProduct;
document.getElementById("exportBtn").onclick = exportCSV;
document.getElementById("clearBtn").onclick = clearExtension;
