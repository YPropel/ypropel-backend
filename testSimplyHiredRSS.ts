import axios from "axios";

async function testSimplyHiredRSS() {
  const rssUrl = "https://www.simplyhired.com/search/rss?q=software+engineer&l=United+States";

  try {
    const response = await axios.get(rssUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Connection: "keep-alive",
      },
    });
    console.log("RSS fetched successfully, status:", response.status);
    console.log("First 500 chars of feed:", response.data.slice(0, 500));
  } catch (error) {
    console.error("Failed to fetch RSS:", error);
  }
}

testSimplyHiredRSS();
