import requests
from bs4 import BeautifulSoup
import json
import time
import logging

# Configure basic logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Developer IR / News endpoints
DEVELOPERS = {
    "TMG": "https://talaatmoustafa.com/news-events/",
    "Emaar Misr": "https://www.emaarmisr.com/press-releases/",
    "Palm Hills": "https://www.palmhillsdevelopments.com/investor-relations/news",
    "Mountain View": "https://www.mountainviewegypt.com/media-room"
}

# Real estate portals could also be included here
AGGREGATORS = {
    "Property Finder (TMG Search)": "https://www.propertyfinder.eg/en/search?c=1&t=1&pt=3000000&pf=TMG",
    # Note: Modern SPA aggregators might require Selenium or Playwright instead of requests
}

def fetch_page_content(url):
    """Fetch HTML content with a generic User-Agent to avoid simple blocks."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
    }
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        return response.text
    except requests.RequestException as e:
        logging.error(f"Failed to fetch {url}: {e}")
        return None

def scrape_tmg_news(html_content):
    soup = BeautifulSoup(html_content, 'html.parser')
    headlines = []
    # TMG specific selectors (adjust based on live site changes)
    news_items = soup.find_all('div', class_='news-item') # Placeholder class
    for item in news_items[:5]: 
        title = item.find('h3').text.strip() if item.find('h3') else "No Title"
        link = item.find('a')['href'] if item.find('a') else "#"
        headlines.append({"title": title, "link": link})
    return headlines

def scrape_palm_hills_news(html_content):
    soup = BeautifulSoup(html_content, 'html.parser')
    headlines = []
    # Palm Hills specific selectors
    news_items = soup.find_all('article', class_='news-card')
    for item in news_items[:5]:
        title = item.find('h2').text.strip() if item.find('h2') else "No Title"
        headlines.append({"title": title})
    return headlines

def main():
    logging.info("Starting IR News Scraper for Egypt Top Developers...")
    results = {}

    for name, url in DEVELOPERS.items():
        logging.info(f"Scraping -> {name} ({url})")
        html = fetch_page_content(url)
        
        if not html:
            results[name] = {"status": "failed", "news": []}
            continue
            
        # Due to SPA/React usage on some sites, static HTML scraping might return empty
        # We simulate the parsing logic here as a robust boilerplate
        if name == "TMG":
            news = scrape_tmg_news(html)
        elif name == "Palm Hills":
            news = scrape_palm_hills_news(html)
        else:
            soup = BeautifulSoup(html, 'html.parser')
            # Generic fallback: Grab the first 5 header tags that likely contain titles
            titles = [h.text.strip() for h in soup.find_all(['h2', 'h3']) if len(h.text.strip()) > 15][:5]
            news = [{"title": t} for t in titles]

        results[name] = {"status": "success", "news": news}
        
        # Be polite to the servers
        time.sleep(2)

    # Output JSON that the dashboard could potentially consume
    with open("scraped_headlines.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=4, ensure_ascii=False)
        
    logging.info("Scraping completed. Results saved to scraped_headlines.json")

if __name__ == "__main__":
    main()
