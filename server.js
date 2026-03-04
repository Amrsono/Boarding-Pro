require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const NEWS_API_KEY = process.env.NEWS_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_WEBHOOK_AUTH = process.env.ALERT_WEBHOOK_AUTH || '';

// Initialize MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'golden_boarding';
let db = null;

async function connectToMongo() {
    if (db) return db;
    if (!MONGODB_URI) {
        console.warn('⚠️ MONGODB_URI missing. Using in-memory fallback for this session.');
        return null;
    }
    try {
        const client = await MongoClient.connect(MONGODB_URI);
        db = client.db(DB_NAME);
        console.log('✅ Connected to MongoDB Atlas');
        return db;
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
        return null;
    }
}


const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'golden2024';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ═══════════════════════════════════════════════════════════════════════════
// INTENT SIGNALS (Privacy-first, first-party)
// ═══════════════════════════════════════════════════════════════════════════
const INTENT_EVENT_POINTS = {
    page_view: 1,
    section_view: 3,
    modal_open: 6,
    brochure_click: 10,
    schedule_open: 12,
    booking_submit: 25,
    chat_message: 4,
    time_on_page: 1,
    content_view: 4,
    content_depth: 6,
    content_dwell: 0,
    content_cta: 8
};

const INTENT_HOT_THRESHOLD = parseInt(process.env.INTENT_HOT_THRESHOLD || '35', 10);

const intentMemory = {
    profiles: new Map(), // visitorId -> profile
    events: [], // recent events only (bounded)
    alerts: [] // recent alerts only (bounded)
};

function safeId(input = '') {
    const s = String(input || '').trim();
    if (!s) return '';
    // Keep URL-safe, short-ish identifiers only
    return s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function getVisitorIdFromReq(req) {
    const headerVid = req.headers['x-visitor-id'];
    const bodyVid = req.body?.visitorId;
    const vid = safeId(headerVid || bodyVid || '');
    return vid || '';
}

function nowIso() {
    return new Date().toISOString();
}

function clamp(num, min, max) {
    return Math.max(min, Math.min(max, num));
}

async function sendAlert(triggerType, payload) {
    const timestamp = nowIso();
    const baseAlert = {
        triggerType,
        timestamp,
        payload
    };

    // Persist to in-memory buffer
    intentMemory.alerts.push(baseAlert);
    if (intentMemory.alerts.length > 500) {
        intentMemory.alerts.splice(0, intentMemory.alerts.length - 500);
    }

    const database = await getDatabaseOrNull();
    if (database) {
        try {
            await database.collection('alerts').insertOne({
                ...baseAlert,
                created_at: new Date()
            });
        } catch (e) {
            console.error('[ALERT DB ERROR]', e.message);
        }
    }

    if (!ALERT_WEBHOOK_URL) return;

    try {
        await fetch(ALERT_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(ALERT_WEBHOOK_AUTH ? { 'Authorization': ALERT_WEBHOOK_AUTH } : {})
            },
            body: JSON.stringify(baseAlert)
        });
    } catch (e) {
        console.error('[ALERT WEBHOOK ERROR]', e.message);
    }
}

function computeEventPoints(eventType, meta) {
    const base = INTENT_EVENT_POINTS[eventType] || 0;
    if (eventType === 'time_on_page') {
        const durationMs = Number(meta?.durationMs || 0);
        // Reward up to +10 for dwell time (30s steps)
        return clamp(Math.floor(durationMs / 30000), 0, 10);
    }
    if (eventType === 'content_dwell') {
        const durationMs = Number(meta?.durationMs || 0);
        // Reward up to +12 for long-form engagement (~45s steps)
        return clamp(Math.floor(durationMs / 45000), 0, 12);
    }
    if (eventType === 'section_view') {
        const section = String(meta?.section || '').toLowerCase();
        if (section.includes('featured')) return 5;
        if (section.includes('news')) return 3;
        if (section.includes('stats')) return 2;
        return base;
    }
    return base;
}

async function getDatabaseOrNull() {
    try {
        return await connectToMongo();
    } catch (e) {
        return null;
    }
}

async function recordIntentEvent(req, event) {
    const visitorId = safeId(event.visitorId || '');
    if (!visitorId) return null;

    const eventType = String(event.eventType || '').trim();
    if (!eventType) return null;

    const page = String(event.page || '').slice(0, 200);
    const section = String(event.section || '').slice(0, 120);
    const developer = String(event.developer || '').slice(0, 80);
    const project = String(event.project || '').slice(0, 160);
    const contentId = String(event.contentId || '').slice(0, 160);
    const meta = event.meta && typeof event.meta === 'object' ? event.meta : {};

    const points = computeEventPoints(eventType, { section, ...meta });

    const doc = {
        visitorId,
        eventType,
        page,
        section,
        developer,
        project,
        contentId,
        meta: {
            ...meta,
            points
        },
        ua: String(req.headers['user-agent'] || '').slice(0, 240),
        ref: String(req.headers['referer'] || '').slice(0, 300),
        ipHint: String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').slice(0, 80),
        created_at: new Date(),
        timestamp: nowIso()
    };

    const database = await getDatabaseOrNull();
    if (!database) {
        // In-memory fallback
        const existing = intentMemory.profiles.get(visitorId) || {
            visitorId,
            score: 0,
            firstSeen: nowIso(),
            lastSeen: nowIso(),
            lastPage: '',
            lastSection: '',
            lastDeveloper: '',
            lastProject: '',
            interestTags: [],
            eventCounts: {},
            hot: false
        };

        existing.score = (existing.score || 0) + points;
        existing.lastSeen = nowIso();
        existing.lastPage = page || existing.lastPage;
        existing.lastSection = section || existing.lastSection;
        existing.lastDeveloper = developer || existing.lastDeveloper;
        existing.lastProject = project || existing.lastProject;
        existing.eventCounts[eventType] = (existing.eventCounts[eventType] || 0) + 1;

        if (developer) existing.interestTags = Array.from(new Set([...existing.interestTags, `dev:${developer}`])).slice(-30);
        if (project) existing.interestTags = Array.from(new Set([...existing.interestTags, `proj:${project}`])).slice(-30);
        if (contentId) existing.interestTags = Array.from(new Set([...existing.interestTags, `content:${contentId}`])).slice(-30);

        const wasHot = !!existing.hot;
        existing.hot = existing.score >= INTENT_HOT_THRESHOLD;
        intentMemory.profiles.set(visitorId, existing);

        intentMemory.events.push(doc);
        if (intentMemory.events.length > 5000) intentMemory.events.splice(0, intentMemory.events.length - 5000);

        if (!wasHot && existing.hot) {
            sendAlert('intent_hot', {
                visitorId,
                score: existing.score,
                lastPage: existing.lastPage,
                lastDeveloper: existing.lastDeveloper,
                lastProject: existing.lastProject
            });
        }

        return { profile: existing, event: doc };
    }

    const profilesCol = database.collection('intent_profiles');
    const eventsCol = database.collection('intent_events');

    await eventsCol.insertOne(doc);

    const update = {
        $set: {
            lastSeen: doc.timestamp,
            lastPage: page || '',
            lastSection: section || '',
            lastDeveloper: developer || '',
            lastProject: project || '',
            ua: doc.ua
        },
        $setOnInsert: {
            visitorId,
            firstSeen: doc.timestamp,
            created_at: new Date()
        },
        $inc: {
            score: points,
            [`eventCounts.${eventType}`]: 1
        }
    };

    if (developer || project || contentId) {
        update.$addToSet = {
            interestTags: {
                $each: [
                    ...(developer ? [`dev:${developer}`] : []),
                    ...(project ? [`proj:${project}`] : []),
                    ...(contentId ? [`content:${contentId}`] : [])
                ]
            }
        };
    }

    const before = await profilesCol.findOne({ visitorId }) || null;
    await profilesCol.findOneAndUpdate(
        { visitorId },
        update,
        { upsert: true, returnDocument: 'after' }
    );

    // Read back profile (avoids driver return-shape differences)
    let profile = await profilesCol.findOne({ visitorId });
    if (profile) {
        const previousScore = typeof before?.score === 'number' ? before.score : Number(before?.score || 0);
        const scoreVal = typeof profile.score === 'number' ? profile.score : Number(profile.score || 0);
        const hot = scoreVal >= INTENT_HOT_THRESHOLD;
        const wasHot = !!before?.hot;

        if (profile.hot !== hot) {
            await profilesCol.updateOne({ visitorId }, { $set: { hot } });
            profile.hot = hot;
        }
        profile.score = scoreVal;

        if (!wasHot && hot) {
            sendAlert('intent_hot', {
                visitorId,
                score: scoreVal,
                previousScore,
                lastPage: profile.lastPage,
                lastDeveloper: profile.lastDeveloper,
                lastProject: profile.lastProject
            });
        }
    }

    return { profile, event: doc };
}

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
    { name: 'TMG', fullName: 'Talaat Moustafa Group', url: 'https://talaatmoustafa.com/news-events/', logo: '🏛️' },
    { name: 'Emaar Misr', fullName: 'Emaar Misr', url: 'https://www.emaarmisr.com/press-releases/', logo: '🌟' },
    { name: 'Palm Hills', fullName: 'Palm Hills Developments', url: 'https://www.palmhillsdevelopments.com/investor-relations/news', logo: '🌴' },
    { name: 'Mountain View', fullName: 'Mountain View Egypt', url: 'https://www.mountainviewegypt.com/media-room', logo: '⛰️' }
];

// ═══════════════════════════════════════════════════════════════════════════
// RELEVANCE FILTERING
// ═══════════════════════════════════════════════════════════════════════════
const RELEVANT_STRONG = [
    'southmed', 'tmg', 'talaat moustafa', 'emaar', 'palm hills', 'mountain view',
    'north coast', 'new capital', 'mostakbal city', 'madinaty', 'ras el hekma',
    'cairo gate', 'marassi', 'hacienda', 'south med'
];

const RELEVANT_WEAK = [
    'egypt', '2026', 'real estate', 'property', 'investment', 'development',
    'residential', 'commercial', 'housing', 'villa', 'apartment', 'launch',
    'project', 'sales', 'revenue', 'profit', 'market', 'growth', 'construction',
    'urban', 'infrastructure', 'accommodation'
];

const NOISE_KEYWORDS = [
    'internship', 'football', 'sport', 'ceremony', 'celebration', 'award',
    'partnership with', 'internship programme', 'summer internship', 'training',
    'cloud infrastructure', 'stock market', 'global market', 'market research',
    'reach usd', 'billion by 20', 'ambassador', 'israel', 'huckabee', 'detonated',
    'geopolitical', 'agenda of', 'supremacism', 'tucker carlson'
];

function isRelevant(text = '') {
    const lowerText = text.toLowerCase();

    // 1. Strict Noise Filter
    for (const word of NOISE_KEYWORDS) {
        if (lowerText.includes(word)) return false;
    }

    // 2. Count matches
    let strongCount = 0;
    for (const word of RELEVANT_STRONG) {
        if (lowerText.includes(word)) strongCount++;
    }

    let weakCount = 0;
    for (const word of RELEVANT_WEAK) {
        if (lowerText.includes(word)) weakCount++;
    }

    // 3. Logic:
    // - Always relevant if it mentions a specific developer/project (STRONG)
    if (strongCount >= 1) return true;

    // - Relevant if it mentions Egypt + 2026 + (Real Estate terms)
    const mentionsEgypt = lowerText.includes('egypt');
    const mentions2026 = lowerText.includes('2026');
    const mentionsRealEstate = lowerText.includes('real estate') || lowerText.includes('property') || lowerText.includes('housing') || lowerText.includes('investment');

    if (mentionsEgypt && mentions2026 && mentionsRealEstate) return true;

    // - Relevant if it has many real estate terms (WEAK) regardless of country
    if (weakCount >= 3 && mentionsRealEstate) return true;

    return false;
}

// NewsAPI.org — real news articles about Egypt real estate
async function fetchNewsAPIHeadlines() {
    if (!NEWS_API_KEY || NEWS_API_KEY === 'demo') {
        console.log('[NEWS API] No valid key — skipping NewsAPI.org');
        return [];
    }

    try {
        const { data } = await axios.get('https://newsapi.org/v2/everything', {
            params: {
                q: '(Egypt 2026 real estate) OR (SouthMED 2026) OR (TMG Egypt) OR (Emaar Misr 2026) OR (Palm Hills 2026) OR (Mountain View Egypt 2026)',
                language: 'en',
                sortBy: 'publishedAt',
                pageSize: 15,
                apiKey: NEWS_API_KEY
            },
            timeout: 8000
        });

        return (data.articles || [])
            .filter(article => isRelevant(article.title + ' ' + (article.description || '')))
            .map(article => ({
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
            if (text.length > 15 && text.length < 200 && headlines.length < 5 && isRelevant(text)) {
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
// 4. INTENT TRACKING API (first-party)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/intent/event', async (req, res) => {
    try {
        const visitorId = getVisitorIdFromReq(req);
        const { eventType, page, section, developer, project, meta } = req.body || {};
        if (!visitorId || !eventType) {
            return res.status(400).json({ error: 'Missing visitorId or eventType' });
        }

        const result = await recordIntentEvent(req, {
            visitorId,
            eventType,
            page,
            section,
            developer,
            project,
            meta
        });

        res.json({ ok: true, visitorId, score: result?.profile?.score ?? null, hot: result?.profile?.hot ?? false });
    } catch (err) {
        res.status(500).json({ ok: false, error: 'Intent event failed', message: err.message });
    }
});

app.get('/api/intent/profile', async (req, res) => {
    try {
        const visitorId = safeId(req.query.visitorId || '');
        if (!visitorId) return res.status(400).json({ error: 'Missing visitorId' });

        const database = await getDatabaseOrNull();
        if (!database) {
            return res.json(intentMemory.profiles.get(visitorId) || null);
        }

        const profile = await database.collection('intent_profiles').findOne({ visitorId });
        res.json(profile || null);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read profile', message: err.message });
    }
});

// Simple conversational endpoint (optional AI, safe fallback)
app.post('/api/chat', async (req, res) => {
    try {
        const visitorId = getVisitorIdFromReq(req) || 'anonymous';
        const message = String(req.body?.message || '').trim();
        if (!message) return res.status(400).json({ error: 'Missing message' });

        // Track chat signal (no PII stored unless user types it)
        if (visitorId !== 'anonymous') {
            await recordIntentEvent(req, {
                visitorId,
                eventType: 'chat_message',
                page: String(req.body?.page || ''),
                meta: { length: message.length }
            });
        }

        if (!OPENAI_API_KEY) {
            console.warn('⚠️ OPENAI_API_KEY missing. Chat assistant is running in fallback mode.');
        }

        // Fallback responder (no external calls)
        let reply = `I'm currently in "Safety Mode" (AI offline). Tell me what you're looking for (e.g., North Coast villas, New Capital offices, or TMG projects) and I'll help you navigate.`;

        if (OPENAI_API_KEY) {
            const prompt = [
                { role: 'system', content: 'You are a helpful real-estate assistant for the GoldenBoarding Egypt dashboard. Keep replies short, specific, and ask 1 clarifying question if needed.' },
                { role: 'user', content: message }
            ];

            try {
                const aiResp = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${OPENAI_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                        messages: prompt,
                        temperature: 0.4,
                        max_tokens: 220
                    })
                });

                if (aiResp.ok) {
                    const data = await aiResp.json();
                    const text = data?.choices?.[0]?.message?.content?.trim();
                    if (text) reply = text;
                } else {
                    const errorData = await aiResp.json().catch(() => ({}));
                    console.error('[OPENAI ERROR]', JSON.stringify(errorData));

                    if (aiResp.status === 429 || errorData?.error?.code === 'insufficient_quota') {
                        reply = "I'm currently in Safety Mode because my AI quota has been exceeded. You can still ask me about prices, TMG, or booking info, or check back once the limit is reset.";
                    }
                }
            } catch (e) {
                console.error('[CHAT ERROR]', e.message);
            }
        } else {
            // Contextual Fallbacks
            const low = message.toLowerCase();
            if (low.includes('price') || low.includes('cost') || low.includes('budget')) {
                reply = "Prices vary significantly by area. Most new launches start around EGP 3-5M for apartments, while North Coast villas can range from EGP 15M to 100M+. Which developer or area should I check specific price ranges for?";
            } else if (low.includes('tmg') || low.includes('moustafa') || low.includes('southmed')) {
                reply = "TMG is one of Egypt's largest developers. Their flagship coastal project is SouthMED (North Coast), and they also have Noor City and Madinaty. Are you interested in coastal resorts or smart urban living?";
            } else if (low.includes('contact') || low.includes('book') || low.includes('call')) {
                reply = "The best way to get details is to click 'View Details' on any project card and use the 'Confirm Appointment' or 'Request Brochure' buttons. Would you like me to point you to a specific developer's project?";
            } else if (low.includes('north coast') || low.includes('sahel')) {
                reply = "The North Coast (Sahel) is currently the hottest investment zone, especially around Ras El Hekma. We feature SouthMED (TMG), Hacienda Waters (Palm Hills), and LVLS (Mountain View). Which of these peaks your interest?";
            }
        }

        res.json({ reply });
    } catch (err) {
        res.status(500).json({ error: 'Chat failed', message: err.message });
    }
});


// ═══════════════════════════════════════════════════════════════════════════
// 5. BOOKINGS & ADMIN
// ═══════════════════════════════════════════════════════════════════════════

// Save a new booking
app.post('/api/bookings', async (req, res) => {
    console.log('[BOOKING REQUEST]', req.body);
    const { name, email, phone, date, project, developer, type, visitorId } = req.body;

    if (!name || !email || !phone || !project) {
        console.warn('[BOOKING VALIDATION FAILED] Missing fields:', { name, email, phone, project });
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const database = await connectToMongo();
        if (!database) {
            console.error('[BOOKING ERROR] Database not connected');
            throw new Error('Database not connected');
        }

        const result = await database.collection('bookings').insertOne({
            name, email, phone, date, project, developer, type,
            visitorId: safeId(visitorId || ''),
            timestamp: new Date().toISOString(),
            created_at: new Date()
        });

        console.log('[BOOKING SUCCESS] ID:', result.insertedId);
        // Boost intent score when a booking is submitted (if visitorId exists)
        if (visitorId) {
            try {
                const intentResult = await recordIntentEvent(req, {
                    visitorId,
                    eventType: 'booking_submit',
                    page: '/index.html',
                    developer,
                    project,
                    meta: { type }
                });
                sendAlert('booking_created', {
                    bookingId: String(result.insertedId),
                    visitorId: safeId(visitorId || ''),
                    developer,
                    project,
                    type,
                    name,
                    email,
                    phone,
                    score: intentResult?.profile?.score ?? null
                });
            } catch (e) { /* non-fatal */ }
        }
        res.status(201).json({ message: 'Booking successful', id: result.insertedId });
    } catch (err) {
        console.error('[BOOKING ERROR]', err.message);
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
app.get('/api/admin/bookings', isAdmin, async (req, res) => {
    try {
        const database = await connectToMongo();
        if (!database) throw new Error('Database not connected');

        const bookings = await database.collection('bookings')
            .find({})
            .sort({ created_at: -1 })
            .toArray();

        res.json(bookings);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read bookings', message: err.message });
    }
});

// Export bookings as CSV
app.get('/api/admin/export', isAdmin, async (req, res) => {
    try {
        const database = await connectToMongo();
        if (!database) throw new Error('Database not connected');

        const bookings = await database.collection('bookings')
            .find({})
            .sort({ created_at: -1 })
            .toArray();

        if (!bookings || bookings.length === 0) return res.status(404).send('No bookings to export');

        const headers = ['ID', 'Timestamp', 'Project', 'Developer', 'Name', 'Email', 'Phone', 'Visit Date'];
        const rows = bookings.map(b => [
            b._id, b.timestamp, b.project, b.developer, b.name, b.email, b.phone, b.date || 'N/A'
        ]);

        const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=golden_leads_export.csv');
        res.send(csvContent);
    } catch (err) {
        res.status(500).json({ error: 'Export failed', message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN: INTENT (Hot visitors + event trail + AI drafts)
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/admin/intent/hot', isAdmin, async (req, res) => {
    try {
        const limit = clamp(parseInt(req.query.limit || '100', 10), 1, 500);
        const database = await getDatabaseOrNull();

        if (!database) {
            const rows = Array.from(intentMemory.profiles.values())
                .sort((a, b) => (b.score || 0) - (a.score || 0))
                .slice(0, limit);
            return res.json(rows);
        }

        const rows = await database.collection('intent_profiles')
            .find({})
            .sort({ score: -1, lastSeen: -1 })
            .limit(limit)
            .toArray();

        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read hot intent', message: err.message });
    }
});

app.get('/api/admin/intent/events/:visitorId', isAdmin, async (req, res) => {
    try {
        const visitorId = safeId(req.params.visitorId || '');
        if (!visitorId) return res.status(400).json({ error: 'Missing visitorId' });

        const limit = clamp(parseInt(req.query.limit || '50', 10), 1, 200);
        const database = await getDatabaseOrNull();

        if (!database) {
            const events = intentMemory.events
                .filter(e => e.visitorId === visitorId)
                .slice(-limit)
                .reverse();
            return res.json(events);
        }

        const events = await database.collection('intent_events')
            .find({ visitorId })
            .sort({ created_at: -1 })
            .limit(limit)
            .toArray();

        res.json(events);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read intent events', message: err.message });
    }
});

app.get('/api/admin/alerts', isAdmin, async (req, res) => {
    try {
        const limit = clamp(parseInt(req.query.limit || '100', 10), 1, 500);
        const database = await getDatabaseOrNull();

        if (!database) {
            const latest = intentMemory.alerts.slice(-limit).reverse();
            return res.json(latest);
        }

        const alerts = await database.collection('alerts')
            .find({})
            .sort({ created_at: -1 })
            .limit(limit)
            .toArray();

        res.json(alerts);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read alerts', message: err.message });
    }
});

function draftOutreachFallback({ channel, profile, booking }) {
    const dev = booking?.developer || profile?.lastDeveloper || 'a top developer';
    const proj = booking?.project || profile?.lastProject || 'a premium opportunity';
    const name = booking?.name && !String(booking.name).toLowerCase().includes('anonymous') ? booking.name : 'there';
    const goal = 'book a quick call';

    if (channel === 'linkedin') {
        return {
            subject: null,
            body: `Hi ${name} — saw you exploring ${dev} / ${proj}. If helpful, I can share the latest availability, payment plans, and the best-value unit types. Open to a 10‑minute call today or tomorrow?`
        };
    }

    return {
        subject: `Quick question about ${dev} / ${proj}`,
        body: `Hi ${name},\n\nI noticed interest in ${dev} and the ${proj} opportunity. If you share your target budget and unit type (villa / apartment / coastal), I can shortlist 2–3 best matches and send the brochure + payment plans.\n\nWould you like a quick 10‑minute call today or tomorrow?\n\nRegards,\nGoldenBoarding Team`
    };
}

app.post('/api/admin/ai/draft', isAdmin, async (req, res) => {
    try {
        const visitorId = safeId(req.body?.visitorId || '');
        const channel = String(req.body?.channel || 'email').toLowerCase();
        if (!visitorId) return res.status(400).json({ error: 'Missing visitorId' });

        const database = await getDatabaseOrNull();
        let profile = null;
        let booking = null;

        if (!database) {
            profile = intentMemory.profiles.get(visitorId) || null;
        } else {
            profile = await database.collection('intent_profiles').findOne({ visitorId });
            booking = await database.collection('bookings').findOne({ visitorId }, { sort: { created_at: -1 } });
        }

        const fallback = draftOutreachFallback({ channel, profile, booking });
        if (!OPENAI_API_KEY) return res.json({ ...fallback, usedAI: false });

        const context = {
            visitorId,
            score: profile?.score || 0,
            lastSeen: profile?.lastSeen,
            lastDeveloper: profile?.lastDeveloper,
            lastProject: profile?.lastProject,
            interestTags: profile?.interestTags || [],
            booking: booking ? {
                name: booking.name,
                email: booking.email,
                phone: booking.phone,
                developer: booking.developer,
                project: booking.project,
                type: booking.type,
                date: booking.date
            } : null
        };

        const messages = [
            {
                role: 'system',
                content: 'You are an AI SDR for a real-estate investment dashboard in Egypt. Write short, hyper-personalized outreach. No hype. One clear CTA to book a call. Return JSON with keys: subject (string|null), body (string).'
            },
            {
                role: 'user',
                content: `Channel: ${channel}\nContext:\n${JSON.stringify(context, null, 2)}`
            }
        ];

        const aiResp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                messages,
                temperature: 0.35,
                max_tokens: 260
            })
        });

        if (!aiResp.ok) {
            return res.json({ ...fallback, usedAI: false, aiError: `status_${aiResp.status}` });
        }

        const data = await aiResp.json();
        const raw = data?.choices?.[0]?.message?.content?.trim() || '';

        // Try parse JSON; fallback to plain body
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }

        const subject = parsed?.subject ?? fallback.subject;
        const body = parsed?.body ?? raw ?? fallback.body;

        res.json({ subject, body, usedAI: true });
    } catch (err) {
        res.status(500).json({ error: 'AI draft failed', message: err.message });
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
app.get('/api/health', async (req, res) => {
    let dbStatus = 'disconnected';
    try {
        const database = await connectToMongo();
        if (database) {
            await database.command({ ping: 1 });
            dbStatus = 'connected';
        }
    } catch (e) {
        dbStatus = `error: ${e.message}`;
    }

    res.json({
        status: dbStatus === 'connected' ? 'ok' : 'degraded',
        uptime: process.uptime(),
        database: dbStatus,
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
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🏠 Golden Boarding Dashboard Server`);
        console.log(`   ➜ Dashboard:  http://localhost:${PORT}`);
        console.log(`   ➜ API Status: http://localhost:${PORT}/api/health\n`);
    });
}

module.exports = app;
