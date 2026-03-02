require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const NEWS_API_KEY = process.env.NEWS_API_KEY || '';

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'golden2024';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION MIDDLEWARE (Admin only)
// ═══════════════════════════════════════════════════════════════════════════
const activeSessions = new Set();
function isAdmin(req, res, next) {
    const token = req.headers['authorization'];
    if (activeSessions.has(token)) return next();
    res.status(401).json({ error: 'Unauthorized' });
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHING LAYER (per-endpoint, configurable TTL)
// ═══════════════════════════════════════════════════════════════════════════
const cache = {};
function getCached(key, ttlMs) {
    const entry = cache[key];
    if (entry && (Date.now() - entry.timestamp) < ttlMs) return entry.data;
    return null;
}
function setCache(key, data) {
    cache[key] = { data, timestamp: Date.now() };
}

const FIVE_MIN = 5 * 60 * 1000;
const THIRTY_MIN = 30 * 60 * 1000;

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. STOCK PRICES — Yahoo Finance (EGX: TMGH.CA, EMFD.CA, PHDC.CA)
// ═══════════════════════════════════════════════════════════════════════════
const STOCK_TICKERS = {
    'TMGH.CA': { name: 'TMG', fullName: 'Talaat Moustafa Group' },
    'EMFD.CA': { name: 'Emaar Misr', fullName: 'Emaar Misr for Development' },
    'PHDC.CA': { name: 'Palm Hills', fullName: 'Palm Hills Developments' }
};

async function fetchStockPrices() {
    const cached = getCached('stocks', FIVE_MIN);
    if (cached) return { ...cached, cached: true };

    const symbols = Object.keys(STOCK_TICKERS).join(',');

    try {
        // Yahoo Finance v8 quote endpoint
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${Object.keys(STOCK_TICKERS)[0]}?interval=1d&range=5d`;

        // Fetch all tickers individually for reliability
        const results = await Promise.allSettled(
            Object.keys(STOCK_TICKERS).map(async (ticker) => {
                const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
                const { data } = await axios.get(chartUrl, {
                    headers: { ...HEADERS, 'Accept': 'application/json' },
                    timeout: 8000
                });

                const result = data?.chart?.result?.[0];
                if (!result) throw new Error('No data returned');

                const meta = result.meta;
                const closes = result.indicators?.quote?.[0]?.close || [];
                const currentPrice = meta.regularMarketPrice;
                const previousClose = meta.chartPreviousClose || closes[closes.length - 2];
                const change = currentPrice - previousClose;
                const changePercent = previousClose ? ((change / previousClose) * 100) : 0;

                return {
                    ticker,
                    ...STOCK_TICKERS[ticker],
                    currency: meta.currency || 'EGP',
                    price: currentPrice,
                    previousClose,
                    change: parseFloat(change.toFixed(2)),
                    changePercent: parseFloat(changePercent.toFixed(2)),
                    volume: meta.regularMarketVolume || 0,
                    marketState: meta.marketState || 'UNKNOWN',
                    exchange: meta.exchangeName || 'EGX',
                    fetchedAt: new Date().toISOString()
                };
            })
        );

        const stocks = results
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);

        const errors = results
            .filter(r => r.status === 'rejected')
            .map((r, i) => ({
                ticker: Object.keys(STOCK_TICKERS)[i],
                error: r.reason?.message
            }));

        const responseData = { stocks, errors, fetchedAt: new Date().toISOString() };
        setCache('stocks', responseData);
        return { ...responseData, cached: false };

    } catch (err) {
        console.error('[STOCKS ERROR]', err.message);
        throw err;
    }
}

app.get('/api/stocks', async (req, res) => {
    try {
        const data = await fetchStockPrices();
        res.json(data);
    } catch (err) {
        res.status(500).json({
            error: 'Failed to fetch stock data',
            message: err.message,
            fallback: Object.entries(STOCK_TICKERS).map(([ticker, info]) => ({
                ticker,
                ...info,
                price: null,
                note: 'Unavailable — Yahoo Finance may be blocking requests'
            }))
        });
    }
});


// ═══════════════════════════════════════════════════════════════════════════
// 2. CURRENCY — Frankfurter API (no key needed)
// ═══════════════════════════════════════════════════════════════════════════
async function fetchCurrencyRates() {
    const cached = getCached('currency', THIRTY_MIN);
    if (cached) return { ...cached, cached: true };

    try {
        // ExchangeRate-API (Open) — free, no key, very broad coverage (EGP, SAR, AED available)
        const { data } = await axios.get(
            'https://open.er-api.com/v6/latest/USD',
            { timeout: 5000 }
        );

        if (!data || !data.rates) throw new Error('Invalid rate data');

        const responseData = {
            base: data.base_code || 'USD',
            date: data.time_last_update_utc,
            rates: data.rates,
            egpPerUsd: data.rates.EGP,
            fetchedAt: new Date().toISOString()
        };

        setCache('currency', responseData);
        return { ...responseData, cached: false };

    } catch (err) {
        console.error('[CURRENCY ERROR]', err.message);
        throw err;
    }
}

app.get('/api/currency', async (req, res) => {
    try {
        const data = await fetchCurrencyRates();
        res.json(data);
    } catch (err) {
        res.status(500).json({
            error: 'Failed to fetch currency rates',
            message: err.message,
            fallback: { egpPerUsd: 50.5, note: 'Approximate rate — API unavailable' }
        });
    }
});


// ═══════════════════════════════════════════════════════════════════════════
// 3. NEWS — NewsAPI.org + Developer Website Scraper (hybrid)
// ═══════════════════════════════════════════════════════════════════════════

const DEVELOPERS = [
    { name: 'TMG', fullName: 'Talaat Moustafa Group', url: 'https://www.talaatmoustafa.com/News.aspx', logo: '🏛️' },
    { name: 'Emaar Misr', fullName: 'Emaar Misr', url: 'https://emaarmisr.com/en/news/', logo: '🌟' },
    { name: 'Palm Hills', fullName: 'Palm Hills Developments', url: 'https://www.palmhillsdevelopments.com/investor-relations/news', logo: '🌴' },
    { name: 'Mountain View', fullName: 'Mountain View Egypt', url: 'https://mountainviewegypt.com/news', logo: '⛰️' }
];

// NewsAPI.org — real news articles about Egypt real estate
async function fetchNewsAPIHeadlines() {
    if (!NEWS_API_KEY || NEWS_API_KEY === 'demo') {
        console.log('[NEWS API] No valid key — skipping NewsAPI.org');
        return [];
    }

    try {
        const { data } = await axios.get('https://newsapi.org/v2/everything', {
            params: {
                q: '(Egypt real estate) OR (TMG SouthMED) OR (Emaar Misr) OR (Palm Hills) OR (Mountain View Egypt)',
                language: 'en',
                sortBy: 'publishedAt',
                pageSize: 10,
                apiKey: NEWS_API_KEY
            },
            timeout: 8000
        });

        return (data.articles || []).map(article => ({
            title: article.title,
            source: article.source?.name || 'News',
            link: article.url,
            publishedAt: article.publishedAt,
            description: article.description,
            imageUrl: article.urlToImage,
            logo: '📰',
            via: 'NewsAPI'
        }));

    } catch (err) {
        console.error('[NEWS API ERROR]', err.message);
        return [];
    }
}

// Scraper — developer IR pages
async function scrapeDevNews(dev) {
    try {
        const { data: html } = await axios.get(dev.url, {
            headers: HEADERS,
            timeout: 10000
        });

        const $ = cheerio.load(html);
        const headlines = [];

        $('h2, h3, h4').each((i, el) => {
            const text = $(el).text().trim();
            if (text.length > 15 && text.length < 200 && headlines.length < 5) {
                const link = $(el).closest('a').attr('href') || $(el).find('a').attr('href') || '#';
                const fullLink = link.startsWith('http') ? link : (dev.url + link);
                headlines.push({
                    title: text,
                    link: fullLink,
                    source: dev.name,
                    logo: dev.logo,
                    via: 'Scraper'
                });
            }
        });

        if (headlines.length === 0) {
            $('article, .news-item, .news-card, .post-item, [class*="news"], [class*="article"]').each((i, el) => {
                const text = $(el).find('h2, h3, h4, a, p').first().text().trim();
                if (text.length > 15 && text.length < 200 && headlines.length < 5) {
                    headlines.push({
                        title: text,
                        link: dev.url,
                        source: dev.name,
                        logo: dev.logo,
                        via: 'Scraper'
                    });
                }
            });
        }

        return {
            developer: dev.name,
            fullName: dev.fullName,
            logo: dev.logo,
            status: headlines.length > 0 ? 'live' : 'no-content',
            headlines,
            scrapedAt: new Date().toISOString()
        };
    } catch (err) {
        console.error(`[SCRAPE ERROR] ${dev.name}: ${err.message}`);
        return {
            developer: dev.name,
            fullName: dev.fullName,
            logo: dev.logo,
            status: 'error',
            error: err.message,
            headlines: [],
            scrapedAt: new Date().toISOString()
        };
    }
}

app.get('/api/news', async (req, res) => {
    const cached = getCached('news', FIVE_MIN);
    if (cached) {
        console.log('[CACHE HIT] News');
        return res.json({ ...cached, cached: true });
    }

    console.log('[SCRAPING] Fetching live news...');

    try {
        // Run NewsAPI + scraper in parallel
        const [newsApiResults, ...scrapeResults] = await Promise.allSettled([
            fetchNewsAPIHeadlines(),
            ...DEVELOPERS.map(dev => scrapeDevNews(dev))
        ]);

        const newsApiHeadlines = newsApiResults.status === 'fulfilled' ? newsApiResults.value : [];

        const developers = scrapeResults.map(r =>
            r.status === 'fulfilled' ? r.value : {
                developer: 'Unknown', status: 'error', headlines: [], logo: '❓'
            }
        );

        const scraperHeadlines = developers.flatMap(d => d.headlines);

        const responseData = {
            newsApi: {
                count: newsApiHeadlines.length,
                headlines: newsApiHeadlines,
                available: NEWS_API_KEY && NEWS_API_KEY !== 'demo'
            },
            developers,
            scraperHeadlines,
            totalHeadlines: newsApiHeadlines.length + scraperHeadlines.length,
            scrapedAt: new Date().toISOString()
        };

        setCache('news', responseData);
        res.json({ ...responseData, cached: false });

    } catch (err) {
        console.error('[NEWS ERROR]', err.message);
        res.status(500).json({ error: 'News fetch failed', message: err.message });
    }
});


// ═══════════════════════════════════════════════════════════════════════════
// 5. BOOKINGS & ADMIN
// ═══════════════════════════════════════════════════════════════════════════

// Save a new booking
app.post('/api/bookings', (req, res) => {
    const { name, email, phone, date, project, developer, type } = req.body;

    if (!name || !email || !phone || !project) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const bookingPath = path.join(__dirname, 'bookings.json');
    let bookings = [];

    try {
        if (fs.existsSync(bookingPath)) {
            bookings = JSON.parse(fs.readFileSync(bookingPath, 'utf8'));
        }

        const newBooking = {
            id: Date.now(),
            name, email, phone, date, project, developer, type,
            timestamp: new Date().toISOString()
        };

        bookings.push(newBooking);
        fs.writeFileSync(bookingPath, JSON.stringify(bookings, null, 2));

        res.status(201).json({ message: 'Booking successful', booking: newBooking });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save booking', message: err.message });
    }
});

// Admin Login
app.post('/api/admin/login', (req, res) => {
    const { user, pass } = req.body;
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
        const token = 'sess_' + Math.random().toString(36).substr(2, 9);
        activeSessions.add(token);
        return res.json({ success: true, token });
    }
    res.status(401).json({ error: 'Invalid credentials' });
});

// Get all bookings
app.get('/api/admin/bookings', isAdmin, (req, res) => {
    const bookingPath = path.join(__dirname, 'bookings.json');
    try {
        const bookings = fs.existsSync(bookingPath) ? JSON.parse(fs.readFileSync(bookingPath, 'utf8')) : [];
        res.json(bookings);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read bookings' });
    }
});

// Export bookings as CSV
app.get('/api/admin/export', isAdmin, (req, res) => {
    const bookingPath = path.join(__dirname, 'bookings.json');
    try {
        const bookings = fs.existsSync(bookingPath) ? JSON.parse(fs.readFileSync(bookingPath, 'utf8')) : [];
        if (bookings.length === 0) return res.status(404).send('No bookings to export');

        const headers = ['ID', 'Date', 'Project', 'Developer', 'Name', 'Email', 'Phone', 'Visit Date'];
        const rows = bookings.map(b => [
            b.id, b.timestamp, b.project, b.developer, b.name, b.email, b.phone, b.date || 'N/A'
        ]);

        const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=golden_leads_export.csv');
        res.send(csvContent);
    } catch (err) {
        res.status(500).json({ error: 'Export failed' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. MARKET — Aggregated stats + live data
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/market', async (req, res) => {
    // Try to include live stock + currency data
    let stockData = null;
    let currencyData = null;

    try { stockData = await fetchStockPrices(); } catch (e) { /* non-fatal */ }
    try { currencyData = await fetchCurrencyRates(); } catch (e) { /* non-fatal */ }

    res.json({
        stats: {
            totalProjects: 42,
            unitsSold: 18500,
            totalAreaFeddan: 25000,
            activeDevs: 4,
            avgPricePerSqm: 45000
        },
        currency: currencyData ? {
            egpPerUsd: currencyData.egpPerUsd,
            rates: currencyData.rates,
            date: currencyData.date
        } : null,
        stocks: stockData ? stockData.stocks : null,
        developers: [
            {
                name: 'TMG',
                fullName: 'Talaat Moustafa Group',
                ticker: 'TMGH.CA',
                projects: ['SouthMED', 'Noor City', 'Madinaty', 'Al Rehab'],
                highlight: 'Largest urban developer in the Middle East',
                marketCap: 'EGP 120B+',
                irUrl: 'https://www.talaatmoustafa.com/News.aspx'
            },
            {
                name: 'Emaar Misr',
                fullName: 'Emaar Misr',
                ticker: 'EMFD.CA',
                projects: ['Marassi', 'Mivida', 'MADA', 'Cairo Gate'],
                highlight: 'Part of the global Emaar Properties group',
                marketCap: 'EGP 95B+',
                irUrl: 'https://emaarmisr.com/en/news/'
            },
            {
                name: 'Palm Hills',
                fullName: 'Palm Hills Developments',
                ticker: 'PHDC.CA',
                projects: ['Badya', 'Hacienda Bay', 'Hacienda Waters', 'Palm Parks'],
                highlight: 'Pioneer in resort & residential developments',
                marketCap: 'EGP 50B+',
                irUrl: 'https://www.palmhillsdevelopments.com/investor-relations/news'
            },
            {
                name: 'Mountain View',
                fullName: 'Mountain View Egypt',
                ticker: null,
                projects: ['iCity', 'Plage', 'LVLS', 'Ras El Hekma'],
                highlight: 'Innovative lifestyle community creator',
                marketCap: 'EGP 40B+',
                irUrl: 'https://mountainviewegypt.com/news'
            }
        ],
        updatedAt: new Date().toISOString()
    });
});


// ═══════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        apis: {
            newsApi: NEWS_API_KEY && NEWS_API_KEY !== 'demo' ? 'configured' : 'not configured (using scraper only)',
            yahooFinance: 'enabled',
            frankfurter: 'enabled (no key needed)',
            scraper: 'enabled'
        },
        timestamp: new Date().toISOString()
    });
});


// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
    console.log(`\n🏠 Golden Boarding Dashboard Server`);
    console.log(`   ➜ Dashboard:  http://localhost:${PORT}`);
    console.log(`   ➜ News API:   http://localhost:${PORT}/api/news`);
    console.log(`   ➜ Stocks API: http://localhost:${PORT}/api/stocks`);
    console.log(`   ➜ Currency:   http://localhost:${PORT}/api/currency`);
    console.log(`   ➜ Market:     http://localhost:${PORT}/api/market`);
    console.log(`   ➜ Health:     http://localhost:${PORT}/api/health`);
    console.log(`   ➜ NewsAPI:    ${NEWS_API_KEY && NEWS_API_KEY !== 'demo' ? '✅ Key configured' : '⚠️ No key — run with NEWS_API_KEY=your_key'}\n`);
});
