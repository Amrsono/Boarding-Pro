document.addEventListener('DOMContentLoaded', () => {

    // ─── Configuration ─────────────────────────────────────────────────────
    const API_BASE = window.location.origin; // works when served by Node
    const FALLBACK_MODE = !window.location.origin.includes('localhost:3000');

    // ─── Particle Canvas System ────────────────────────────────────────────
    const canvas = document.getElementById('particle-canvas');
    const ctx = canvas.getContext('2d');
    let particles = [];
    let mouse = { x: null, y: null };

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    document.addEventListener('mousemove', (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    });

    class Particle {
        constructor() {
            this.reset();
        }

        reset() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 2 + 0.5;
            this.speedX = (Math.random() - 0.5) * 0.6;
            this.speedY = (Math.random() - 0.5) * 0.6;
            this.opacity = Math.random() * 0.5 + 0.1;
            this.golden = Math.random() > 0.7; // 30% gold particles
        }

        update() {
            this.x += this.speedX;
            this.y += this.speedY;

            // Mouse repulsion
            if (mouse.x !== null) {
                const dx = this.x - mouse.x;
                const dy = this.y - mouse.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 120) {
                    const force = (120 - dist) / 120;
                    this.x += (dx / dist) * force * 1.5;
                    this.y += (dy / dist) * force * 1.5;
                }
            }

            // Wrap around screen
            if (this.x < 0) this.x = canvas.width;
            if (this.x > canvas.width) this.x = 0;
            if (this.y < 0) this.y = canvas.height;
            if (this.y > canvas.height) this.y = 0;
        }

        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            if (this.golden) {
                ctx.fillStyle = `rgba(251, 191, 36, ${this.opacity})`;
            } else {
                ctx.fillStyle = `rgba(148, 163, 184, ${this.opacity * 0.5})`;
            }
            ctx.fill();
        }
    }

    function initParticles() {
        const count = Math.min(80, Math.floor((canvas.width * canvas.height) / 15000));
        particles = [];
        for (let i = 0; i < count; i++) {
            particles.push(new Particle());
        }
    }
    initParticles();

    function drawConnections() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 140) {
                    const opacity = (1 - dist / 140) * 0.15;
                    const isGold = particles[i].golden || particles[j].golden;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = isGold
                        ? `rgba(251, 191, 36, ${opacity})`
                        : `rgba(148, 163, 184, ${opacity * 0.5})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }
    }

    function animateParticles() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.update();
            p.draw();
        });
        drawConnections();
        requestAnimationFrame(animateParticles);
    }
    animateParticles();

    // ─── Scroll Reveal (IntersectionObserver) ──────────────────────────────
    const revealEls = document.querySelectorAll('.reveal, .reveal-up');
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    revealEls.forEach(el => revealObserver.observe(el));

    // Mark hero as visible immediately
    document.querySelector('.hero')?.classList.add('visible');

    // ─── Animated Counters ─────────────────────────────────────────────────
    let countersAnimated = false;

    function animateCounters() {
        if (countersAnimated) return;
        countersAnimated = true;

        document.querySelectorAll('.counter-value').forEach(counter => {
            const target = parseInt(counter.getAttribute('data-target'));
            const suffix = counter.getAttribute('data-suffix') || '';
            const duration = 2000;
            const startTime = performance.now();

            function easeOutQuart(t) {
                return 1 - Math.pow(1 - t, 4);
            }

            function updateCounter(currentTime) {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const easedProgress = easeOutQuart(progress);
                const current = Math.floor(easedProgress * target);

                counter.textContent = current.toLocaleString() + suffix;

                if (progress < 1) {
                    requestAnimationFrame(updateCounter);
                } else {
                    counter.textContent = target.toLocaleString() + suffix;
                }
            }

            requestAnimationFrame(updateCounter);
        });
    }

    // Trigger counters when stats section is in view
    const statsSection = document.getElementById('stats');
    if (statsSection) {
        const counterObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    animateCounters();
                }
            });
        }, { threshold: 0.3 });
        counterObserver.observe(statsSection);
    }

    // ─── Opportunities Data (Enriched) ────────────────────────────────────
    const opportunities = [
        {
            developer: "TMG",
            title: "SouthMED Mega Project",
            location: "North Coast (Kilo 165)",
            image: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
            description: "SouthMED is TMG's largest coastal mega-project, spanning over 20 million square meters on the North Coast. It features fully integrated resort living with hotels, golf courses, marinas, commercial districts, and residential neighborhoods — designed to rival Mediterranean destinations.",
            specs: { type: "Mixed-Use Resort", area: "4,800 Feddan", priceRange: "EGP 3.5M – 25M", delivery: "2027 – 2031" },
            highlights: ["Beachfront Villas", "18-Hole Golf Course", "5-Star Hotels", "Private Marina", "Smart City Tech"]
        },
        {
            developer: "Emaar Misr",
            title: "MADA Integrated Project",
            location: "East Cairo (Mostakbal City)",
            image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
            description: "MADA is Emaar Misr's EGP 100 billion modern integrated city spanning 780 feddans in Mostakbal City. It brings together residential quarters, business hubs, retail precincts, schools, and green spaces into a vibrant urban ecosystem inspired by Dubai's community planning.",
            specs: { type: "Integrated City", area: "780 Feddan", priceRange: "EGP 4M – 30M", delivery: "2028 – 2032" },
            highlights: ["Mixed-Use Districts", "International Schools", "Central Business Hub", "Landscaped Parks", "Transit Links"]
        },
        {
            developer: "Palm Hills",
            title: "New Capital Plot (315 Feddan)",
            location: "New Administrative Capital",
            image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
            description: "Palm Hills secured a prime 315-feddan land plot in Egypt's New Administrative Capital. Positioned near the government district and Green River, this upcoming development will feature luxury villas, apartments, and retail — setting a new benchmark for premium capital living.",
            specs: { type: "Residential + Retail", area: "315 Feddan", priceRange: "EGP 3M – 18M", delivery: "2028 – 2030" },
            highlights: ["Near Green River", "Government District Access", "Premium Finishing", "Gated Community", "Smart Infrastructure"]
        },
        {
            developer: "Mountain View",
            title: "LVLS & Plage",
            location: "North Coast / New Cairo",
            image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
            description: "Two flagship Mountain View projects redefining lifestyle communities. Plage offers a stunning North Coast beachfront experience, while LVLS in New Cairo introduces multi-level living with sky gardens, rooftop parks, and innovative vertical design — both sold out Phase 1 in record time.",
            specs: { type: "Lifestyle Community", area: "500+ Feddan", priceRange: "EGP 2.5M – 15M", delivery: "2027 – 2029" },
            highlights: ["Sky Gardens", "Beachfront Living", "Rooftop Parks", "Phase 1 Sold Out", "Innovative Design"]
        },
        {
            developer: "TMG",
            title: "Noor City Smart Living",
            location: "Capital Gardens City",
            image: "https://images.unsplash.com/photo-1600607686527-6fb886090705?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
            description: "Noor City is TMG's next-generation smart city within Capital Gardens. With IoT-enabled homes, AI-managed community services, and sustainable energy systems, it represents the future of urban living in Egypt. Residents enjoy smart transportation, digital security, and eco-friendly architecture.",
            specs: { type: "Smart City", area: "5,000 Feddan", priceRange: "EGP 1.8M – 12M", delivery: "2026 – 2030" },
            highlights: ["IoT Smart Homes", "AI Community Services", "Solar Energy", "EV Charging", "Digital Security"]
        },
        {
            developer: "Palm Hills",
            title: "Hacienda Waters",
            location: "Ras El Hekma",
            image: "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
            description: "Hacienda Waters is Palm Hills' premium North Coast destination in the highly coveted Ras El Hekma bay. With crystal lagoons, a private beach club, infinity pools, and Mediterranean-inspired architecture, it offers an unparalleled coastal lifestyle for discerning investors.",
            specs: { type: "Coastal Resort", area: "350 Feddan", priceRange: "EGP 4M – 22M", delivery: "2027 – 2029" },
            highlights: ["Crystal Lagoons", "Private Beach Club", "Infinity Pools", "Mediterranean Design", "VIP Services"]
        }
    ];

    // ─── Modal Logic ───────────────────────────────────────────────────────
    const modal = document.getElementById('detail-modal');
    const modalClose = document.getElementById('modal-close');
    let currentOpp = null;

    const brochureLinks = {
        "TMG": "https://talaatmoustafa.com/communities/southmed/",
        "Emaar Misr": "https://www.emaarmisr.com/en/our-communities/soul/",
        "Palm Hills": "https://www.palmhillsdevelopments.com/en-us/properties/search",
        "Mountain View": "https://www.mountainviewegypt.com/projects"
    };

    function openModal(opp) {
        currentOpp = opp;
        document.getElementById('modal-image').src = opp.image;
        document.getElementById('modal-image').alt = opp.title;
        document.getElementById('modal-developer').textContent = opp.developer;
        document.getElementById('modal-title').textContent = opp.title;
        document.getElementById('modal-location').textContent = '📍 ' + opp.location;
        document.getElementById('modal-description').textContent = opp.description;

        // Specs
        const specsEl = document.getElementById('modal-specs');
        specsEl.innerHTML = Object.entries(opp.specs).map(([key, val]) => {
            const labels = { type: 'Type', area: 'Total Area', priceRange: 'Price Range', delivery: 'Delivery' };
            return `<div class="spec-item">
                <span class="spec-value">${val}</span>
                <span class="spec-label">${labels[key] || key}</span>
            </div>`;
        }).join('');

        // Highlights
        const highlightsEl = document.getElementById('modal-highlights');
        highlightsEl.innerHTML = opp.highlights
            .map(h => `<span class="modal-highlight-tag">✓ ${h}</span>`)
            .join('');

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        currentOpp = null;
    }

    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // ─── Lead Generation Logic ───────────────────────────────────────────
    const btnBrochure = document.getElementById('btn-brochure');
    const btnSchedule = document.getElementById('btn-schedule');
    const bookingModal = document.getElementById('booking-modal');
    const bookingClose = document.getElementById('booking-close');
    const bookingForm = document.getElementById('booking-form');
    const bookingSuccess = document.getElementById('booking-success');
    const btnSuccessClose = document.getElementById('btn-success-close');

    btnBrochure.addEventListener('click', () => {
        if (!currentOpp) return;
        const link = brochureLinks[currentOpp.developer] || '#';
        window.open(link, '_blank');

        // Silent log
        fetch('/api/bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Anonymous (Brochure Click)',
                email: 'n/a', phone: 'n/a',
                project: currentOpp.title,
                developer: currentOpp.developer,
                type: 'Brochure Request'
            })
        });
    });

    btnSchedule.addEventListener('click', () => {
        if (!currentOpp) return;
        document.getElementById('booking-project-name').textContent = `${currentOpp.developer} - ${currentOpp.title}`;
        bookingModal.classList.add('active');
        bookingForm.style.display = 'flex';
        bookingSuccess.style.display = 'none';
    });

    function closeBooking() {
        bookingModal.classList.remove('active');
    }

    bookingClose.addEventListener('click', closeBooking);
    btnSuccessClose.addEventListener('click', closeBooking);

    bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = bookingForm.querySelector('button');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';

        const bookingData = {
            name: document.getElementById('booking-name').value,
            email: document.getElementById('booking-email').value,
            phone: document.getElementById('booking-phone').value,
            date: document.getElementById('booking-date').value,
            project: currentOpp.title,
            developer: currentOpp.developer,
            type: 'Scheduled Visit'
        };

        try {
            const resp = await fetch('/api/bookings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bookingData)
            });

            if (resp.ok) {
                bookingForm.style.display = 'none';
                bookingSuccess.style.display = 'block';
                bookingForm.reset();
            } else {
                alert('Something went wrong. Please try again.');
            }
        } catch (err) {
            alert('Connection error. Please check your internet.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Confirm Appointment';
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeBooking();
        }
    });

    // ─── Render Opportunities Grid ─────────────────────────────────────────
    const oppGrid = document.getElementById('opportunities-grid');
    opportunities.forEach((opp, index) => {
        const card = document.createElement('div');
        card.className = 'opp-card reveal-up';
        card.style.transitionDelay = `${index * 0.1}s`;

        card.innerHTML = `
            <img src="${opp.image}" alt="${opp.title}" class="opp-image" loading="lazy">
            <div class="opp-content">
                <div class="opp-developer">${opp.developer}</div>
                <h3 class="opp-title">${opp.title}</h3>
                <p class="opp-location">📍 ${opp.location}</p>
                <button class="cta-button opp-details-btn" style="padding: 0.5rem 1.2rem; font-size: 0.9rem;">View Details</button>
            </div>
        `;

        // Wire up the View Details button
        card.querySelector('.opp-details-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openModal(opp);
        });

        oppGrid.appendChild(card);

        // Observe for scroll reveal
        revealObserver.observe(card);
    });

    // ─── Fetch Live Stock Data ──────────────────────────────────────────────
    async function fetchStockData() {
        const container = document.getElementById('stock-ticker');
        try {
            const res = await fetch(`${API_BASE}/api/stocks`);
            const data = await res.json();

            if (data.stocks && data.stocks.length > 0) {
                container.innerHTML = data.stocks.map(stock => {
                    const isUp = stock.change >= 0;
                    const arrow = isUp ? '▲' : '▼';
                    const cls = isUp ? 'up' : 'down';

                    return `
                        <div class="ticker-item">
                            <span class="ticker-name">${stock.name} (${stock.ticker})</span>
                            <span class="ticker-price">${stock.price?.toFixed(2) || '—'} ${stock.currency}</span>
                            <span class="ticker-change ${cls}">
                                ${arrow} ${Math.abs(stock.change).toFixed(2)} (${Math.abs(stock.changePercent).toFixed(2)}%)
                            </span>
                        </div>
                    `;
                }).join('');
            } else if (data.fallback) {
                container.innerHTML = data.fallback.map(s =>
                    `<div class="ticker-item">
                        <span class="ticker-name">${s.name} (${s.ticker})</span>
                        <span class="ticker-price" style="color:var(--text-muted)">—</span>
                        <span class="ticker-change neutral">${s.note}</span>
                    </div>`
                ).join('');
            } else {
                container.innerHTML = '<span class="ticker-loading">No stock data available</span>';
            }

            return data;
        } catch (err) {
            console.warn('Stock API error:', err.message);
            container.innerHTML = '<span class="ticker-loading">Stock data unavailable</span>';
            return null;
        }
    }

    // ─── Fetch Currency Rates ──────────────────────────────────────────────
    async function fetchCurrencyData() {
        const container = document.getElementById('currency-display');
        try {
            const res = await fetch(`${API_BASE}/api/currency`);
            const data = await res.json();

            if (data.rates && data.rates.EGP) {
                const egp = data.rates.EGP;
                const pairs = [];

                pairs.push({ pair: 'USD/EGP', rate: egp.toFixed(2) });

                if (data.rates.EUR) pairs.push({ pair: 'EUR/EGP', rate: (egp / data.rates.EUR).toFixed(2) });
                if (data.rates.GBP) pairs.push({ pair: 'GBP/EGP', rate: (egp / data.rates.GBP).toFixed(2) });
                if (data.rates.SAR) pairs.push({ pair: 'SAR/EGP', rate: (egp / data.rates.SAR).toFixed(2) });
                if (data.rates.AED) pairs.push({ pair: 'AED/EGP', rate: (egp / data.rates.AED).toFixed(2) });

                container.innerHTML = pairs.map(p => `
                    <div class="currency-badge">
                        <span class="currency-pair">${p.pair}</span>
                        <span class="currency-rate">${p.rate}</span>
                    </div>
                `).join('');
            } else if (data.fallback) {
                container.innerHTML = `
                    <div class="currency-badge">
                        <span class="currency-pair">USD/EGP</span>
                        <span class="currency-rate">~${data.fallback.egpPerUsd}</span>
                    </div>
                `;
            }

            return data;
        } catch (err) {
            console.warn('Currency API error:', err.message);
            container.innerHTML = '<span class="currency-loading">Rates unavailable</span>';
            return null;
        }
    }

    // ─── Fetch Live Developer Data ─────────────────────────────────────────
    async function fetchMarketData() {
        const grid = document.getElementById('developers-grid');

        try {
            const res = await fetch(`${API_BASE}/api/market`);
            const data = await res.json();

            // Update counters with live data
            if (data.stats) {
                const counters = document.querySelectorAll('.counter-value');
                const statsMap = [
                    data.stats.totalProjects,
                    data.stats.unitsSold,
                    data.stats.totalAreaFeddan,
                    data.stats.avgPricePerSqm / 1000
                ];
                counters.forEach((c, i) => {
                    if (statsMap[i]) c.setAttribute('data-target', statsMap[i]);
                });
            }

            // Build stock price map if available
            const stockMap = {};
            if (data.stocks) {
                data.stocks.forEach(s => {
                    stockMap[s.ticker] = s;
                });
            }

            // Render developer cards
            grid.innerHTML = '';
            data.developers.forEach((dev, i) => {
                const card = document.createElement('div');
                card.className = 'stat-card glass-panel reveal-up';
                card.style.transitionDelay = `${i * 0.1}s`;

                const projectTags = dev.projects
                    .map(p => `<span class="highlight-tag">${p}</span>`)
                    .join(' ');

                // Include live stock price if available
                const stock = dev.ticker ? stockMap[dev.ticker] : null;
                let stockHtml = '';
                if (stock && stock.price) {
                    const isUp = stock.change >= 0;
                    stockHtml = `
                        <div style="margin: 0.5rem 0; font-size: 0.85rem;">
                            <span style="color:var(--text-muted);">${stock.ticker}:</span>
                            <span style="font-weight:700; color:var(--gold);">${stock.price.toFixed(2)} EGP</span>
                            <span style="color:${isUp ? '#22c55e' : '#ef4444'}; font-size:0.8rem;">
                                ${isUp ? '▲' : '▼'} ${Math.abs(stock.changePercent).toFixed(2)}%
                            </span>
                        </div>
                    `;
                }

                card.innerHTML = `
                    <h3>${dev.name}</h3>
                    <p>${dev.highlight}</p>
                    <span class="market-cap">${dev.marketCap}</span>
                    ${stockHtml}
                    <div>${projectTags}</div>
                `;
                grid.appendChild(card);
                revealObserver.observe(card);
            });

        } catch (err) {
            console.warn('Market API unavailable, using fallback data:', err.message);
            renderFallbackDevelopers(grid);
        }
    }

    function renderFallbackDevelopers(grid) {
        const fallbackDevs = [
            { name: 'TMG', sub: 'Talaat Moustafa Group', tags: 'SouthMED, Noor City', cap: 'EGP 120B+', highlight: 'Largest urban developer in the Middle East' },
            { name: 'Emaar Misr', sub: 'Luxury Living', tags: 'Marassi, Mivida', cap: 'EGP 95B+', highlight: 'Part of global Emaar Properties group' },
            { name: 'Palm Hills', sub: 'Premium Developments', tags: 'Badya, Hacienda Waters', cap: 'EGP 50B+', highlight: 'Pioneer in resort & residential' },
            { name: 'Mountain View', sub: 'Innovative Communities', tags: 'iCity, Plage', cap: 'EGP 40B+', highlight: 'Innovative lifestyle communities' }
        ];

        grid.innerHTML = '';
        fallbackDevs.forEach((dev, i) => {
            const card = document.createElement('div');
            card.className = 'stat-card glass-panel reveal-up';
            card.style.transitionDelay = `${i * 0.1}s`;
            card.innerHTML = `
                <h3>${dev.name}</h3>
                <p>${dev.highlight}</p>
                <span class="market-cap">${dev.cap}</span>
                <div>
                    ${dev.tags.split(', ').map(t => `<span class="highlight-tag">${t}</span>`).join(' ')}
                </div>
            `;
            grid.appendChild(card);
            revealObserver.observe(card);
        });
    }

    // ─── Fetch Live News (NewsAPI + Scraper) ───────────────────────────────
    async function fetchLiveNews() {
        const container = document.getElementById('news-container');
        const skeleton = document.getElementById('news-skeleton');
        const meta = document.getElementById('news-meta');

        try {
            const res = await fetch(`${API_BASE}/api/news`);
            const data = await res.json();

            if (skeleton) skeleton.remove();
            container.innerHTML = '';

            let itemCount = 0;

            // 1) Render NewsAPI headlines first (if available)
            if (data.newsApi && data.newsApi.headlines.length > 0) {
                data.newsApi.headlines.forEach((h, i) => {
                    const item = document.createElement('div');
                    item.className = 'news-item';
                    item.style.animationDelay = `${itemCount * 0.08}s`;

                    item.innerHTML = `
                        <div>
                            <span class="news-source">
                                <span class="news-source-logo">📰</span>
                                ${h.source}
                                <span class="news-status-badge badge-live">NEWS API</span>
                            </span>
                            <h4 class="news-title">${h.title}</h4>
                        </div>
                        <div class="news-date">
                            ${h.publishedAt ? formatTimeAgo(h.publishedAt) : ''}
                        </div>
                    `;

                    if (h.link) {
                        item.style.cursor = 'pointer';
                        item.addEventListener('click', () => window.open(h.link, '_blank'));
                    }

                    container.appendChild(item);
                    itemCount++;
                });
            }

            // 2) Render scraped developer headlines
            if (data.developers) {
                data.developers.forEach(dev => {
                    if (dev.headlines.length > 0) {
                        dev.headlines.forEach((h, i) => {
                            const item = document.createElement('div');
                            item.className = 'news-item';
                            item.style.animationDelay = `${itemCount * 0.08}s`;

                            item.innerHTML = `
                                <div>
                                    <span class="news-source">
                                        <span class="news-source-logo">${h.logo || dev.logo}</span>
                                        ${h.source || dev.developer}
                                        <span class="news-status-badge badge-live">SCRAPER</span>
                                    </span>
                                    <h4 class="news-title">${h.title}</h4>
                                </div>
                                <div class="news-date">
                                    ${dev.scrapedAt ? formatTimeAgo(dev.scrapedAt) : ''}
                                </div>
                            `;

                            if (h.link && h.link !== '#') {
                                item.style.cursor = 'pointer';
                                item.addEventListener('click', () => window.open(h.link, '_blank'));
                            }

                            container.appendChild(item);
                            itemCount++;
                        });
                    } else {
                        const statusItem = document.createElement('div');
                        statusItem.className = 'news-item';
                        statusItem.style.borderLeftColor = dev.status === 'error' ? '#ef4444' : '#94a3b8';
                        statusItem.style.animationDelay = `${itemCount * 0.08}s`;
                        statusItem.innerHTML = `
                            <div>
                                <span class="news-source">
                                    <span class="news-source-logo">${dev.logo}</span>
                                    ${dev.developer}
                                    <span class="news-status-badge ${dev.status === 'error' ? 'badge-error' : 'badge-empty'}">
                                        ${dev.status === 'error' ? 'OFFLINE' : 'SPA'}
                                    </span>
                                </span>
                                <h4 class="news-title" style="color: var(--text-muted); font-style: italic;">
                                    ${dev.status === 'error' ? 'Could not reach server' : 'Requires headless browser'}
                                </h4>
                            </div>
                        `;
                        container.appendChild(statusItem);
                        itemCount++;
                    }
                });
            }

            // Meta info
            if (meta) {
                const newsApiStatus = data.newsApi?.available
                    ? `✅ NewsAPI (${data.newsApi.count} articles)`
                    : '⚠️ NewsAPI not configured';

                meta.innerHTML = `
                    📡 ${data.totalHeadlines} total headlines
                    · ${newsApiStatus}
                    · ${data.cached ? 'Cached' : 'Fresh'}
                    — ${new Date(data.scrapedAt).toLocaleTimeString()}
                `;
            }

        } catch (err) {
            console.warn('News API unavailable, using fallback data:', err.message);
            if (skeleton) skeleton.remove();
            renderFallbackNews(container, meta);
        }
    }

    function renderFallbackNews(container, meta) {
        const fallbackNews = [
            { source: 'TMG Investor Relations', logo: '🏛️', headline: 'TMG Announces Record Sales for SouthMED Launch', date: 'Just Now' },
            { source: 'Palm Hills IR', logo: '🌴', headline: 'Acquisition of 315-Feddan Plot in New Capital Finalized', date: '2 Hours Ago' },
            { source: 'Emaar Misr News', logo: '🌟', headline: 'EGP 100 Billion Investment in Modern "MADA" East Cairo', date: '5 Hours Ago' },
            { source: 'Mountain View PR', logo: '⛰️', headline: 'Plage North Coast Phase 1 Sells Out in 48 Hours', date: '1 Day Ago' }
        ];

        container.innerHTML = '';
        fallbackNews.forEach((news, i) => {
            const item = document.createElement('div');
            item.className = 'news-item';
            item.style.animationDelay = `${i * 0.1}s`;
            item.innerHTML = `
                <div>
                    <span class="news-source">
                        <span class="news-source-logo">${news.logo}</span>
                        ${news.source}
                        <span class="news-status-badge badge-empty">SAMPLE</span>
                    </span>
                    <h4 class="news-title">${news.headline}</h4>
                </div>
                <div class="news-date">${news.date}</div>
            `;
            container.appendChild(item);
        });

        if (meta) {
            meta.innerHTML = '⚠️ Server offline — showing sample data. Run <code>npm start</code> for live data.';
        }
    }

    function formatTimeAgo(isoString) {
        const now = new Date();
        const then = new Date(isoString);
        const diffMs = now - then;
        const diffMin = Math.floor(diffMs / 60000);

        if (diffMin < 1) return 'Just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        const hours = Math.floor(diffMin / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    }

    // ─── Initialize All Live Data ──────────────────────────────────────────
    fetchStockData();
    fetchCurrencyData();
    fetchMarketData();
    fetchLiveNews();

    // Auto-refresh every 5 minutes
    setInterval(() => {
        fetchStockData();
        fetchCurrencyData();
        fetchLiveNews();
    }, 5 * 60 * 1000);

    // ─── Navbar scroll effect ──────────────────────────────────────────────
    let lastScroll = 0;
    window.addEventListener('scroll', () => {
        const navbar = document.querySelector('.navbar');
        const currentScroll = window.pageYOffset;

        if (currentScroll > 100) {
            navbar.style.background = 'rgba(15, 23, 42, 0.95)';
            navbar.style.boxShadow = '0 4px 30px rgba(0, 0, 0, 0.3)';
        } else {
            navbar.style.background = 'rgba(15, 23, 42, 0.85)';
            navbar.style.boxShadow = 'none';
        }
        lastScroll = currentScroll;
    });
});

