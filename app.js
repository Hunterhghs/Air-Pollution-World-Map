(function () {
    'use strict';

    const WAQI_TOKEN = 'demo';
    const WAQI_API = 'https://api.waqi.info';
    const TILE_BASE = 'https://tiles.waqi.info/tiles';

    const AQI_LEVELS = [
        { min: 0, max: 50, label: 'Good', color: '#009966', desc: 'Air quality is satisfactory with little or no risk.' },
        { min: 51, max: 100, label: 'Moderate', color: '#ffde33', desc: 'Acceptable; moderate health concern for sensitive individuals.' },
        { min: 101, max: 150, label: 'Unhealthy for Sensitive Groups', color: '#ff9933', desc: 'Sensitive groups may experience health effects.' },
        { min: 151, max: 200, label: 'Unhealthy', color: '#cc0033', desc: 'Everyone may begin to experience health effects.' },
        { min: 201, max: 300, label: 'Very Unhealthy', color: '#660099', desc: 'Health alert: everyone may experience serious effects.' },
        { min: 301, max: 999, label: 'Hazardous', color: '#7e0023', desc: 'Emergency conditions. The entire population is affected.' }
    ];

    function getAqiLevel(aqi) {
        if (aqi < 0) return AQI_LEVELS[0];
        for (const level of AQI_LEVELS) {
            if (aqi <= level.max) return level;
        }
        return AQI_LEVELS[AQI_LEVELS.length - 1];
    }

    function getMarkerSize(zoom) {
        if (zoom <= 3) return 22;
        if (zoom <= 5) return 26;
        if (zoom <= 7) return 30;
        return 34;
    }

    // --- Loading screen ---
    const loadingEl = document.createElement('div');
    loadingEl.className = 'loading-overlay';
    loadingEl.innerHTML = '<div class="loading-spinner"></div><div class="loading-text">Loading air quality data...</div>';
    document.body.appendChild(loadingEl);

    // --- Map setup ---
    const map = L.map('map', {
        center: [25, 10],
        zoom: 3,
        minZoom: 2,
        maxZoom: 14,
        zoomControl: true,
        attributionControl: true
    });

    const darkBase = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://osm.org/copyright">OSM</a>',
        subdomains: 'abcd',
        maxZoom: 19
    });
    darkBase.addTo(map);

    let currentLayer = 'usepa-aqi';
    let waqiOverlay = createWaqiLayer(currentLayer);
    waqiOverlay.addTo(map);

    function createWaqiLayer(layerId) {
        return L.tileLayer(`${TILE_BASE}/${layerId}/{z}/{x}/{y}.png?token=${WAQI_TOKEN}`, {
            attribution: 'Air Quality &copy; <a href="https://waqi.info">WAQI</a>',
            opacity: 0.6,
            maxZoom: 14
        });
    }

    document.getElementById('layerSelect').addEventListener('change', function () {
        const selected = this.value;
        map.removeLayer(waqiOverlay);
        currentLayer = selected;
        waqiOverlay = createWaqiLayer(selected);
        waqiOverlay.addTo(map);
    });

    // --- Station markers ---
    let markersLayer = L.layerGroup().addTo(map);
    let stationsCache = [];
    let fetchController = null;
    let fetchTimeout = null;

    async function fetchStations() {
        const bounds = map.getBounds();
        const lat1 = bounds.getSouth();
        const lng1 = bounds.getWest();
        const lat2 = bounds.getNorth();
        const lng2 = bounds.getEast();

        if (fetchController) fetchController.abort();
        fetchController = new AbortController();

        try {
            const url = `${WAQI_API}/v2/map/bounds/?latlng=${lat1},${lng1},${lat2},${lng2}&networks=all&token=${WAQI_TOKEN}`;
            const resp = await fetch(url, { signal: fetchController.signal });
            const data = await resp.json();

            if (data.status === 'ok' && Array.isArray(data.data)) {
                stationsCache = data.data;
                renderMarkers(data.data);
                updateStats(data.data);
                updateTimestamp();
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.warn('Station fetch failed:', e);
            }
        }
    }

    function renderMarkers(stations) {
        markersLayer.clearLayers();
        const zoom = map.getZoom();
        const size = getMarkerSize(zoom);

        let maxStations = 300;
        if (zoom <= 3) maxStations = 150;
        if (zoom >= 7) maxStations = 500;

        const sorted = [...stations].sort((a, b) => (b.aqi === '-' ? -1 : b.aqi) - (a.aqi === '-' ? -1 : a.aqi));
        const display = sorted.slice(0, maxStations);

        for (const station of display) {
            const aqi = parseInt(station.aqi);
            if (isNaN(aqi) || aqi < 0) continue;

            const level = getAqiLevel(aqi);
            const icon = L.divIcon({
                className: '',
                html: `<div class="aqi-marker" style="width:${size}px;height:${size}px;background:${level.color}">${aqi}</div>`,
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2]
            });

            const marker = L.marker([station.lat, station.lon], { icon: icon });
            marker.on('click', () => showStationDetail(station));
            markersLayer.addLayer(marker);
        }
    }

    function updateStats(stations) {
        const valid = stations.filter(s => !isNaN(parseInt(s.aqi)) && parseInt(s.aqi) >= 0);
        const count = valid.length;
        const avg = count > 0 ? Math.round(valid.reduce((sum, s) => sum + parseInt(s.aqi), 0) / count) : 0;

        let worst = null;
        let worstAqi = -1;
        for (const s of valid) {
            const a = parseInt(s.aqi);
            if (a > worstAqi) {
                worstAqi = a;
                worst = s;
            }
        }

        document.querySelector('#stationsCount .stat-value').textContent = count.toLocaleString();

        const avgEl = document.querySelector('#avgAqi .stat-value');
        avgEl.textContent = avg;
        avgEl.style.color = getAqiLevel(avg).color;

        const worstEl = document.querySelector('#worstStation .stat-value');
        if (worst) {
            worstEl.textContent = worstAqi;
            worstEl.style.color = getAqiLevel(worstAqi).color;
        } else {
            worstEl.textContent = '—';
        }
    }

    function updateTimestamp() {
        const now = new Date();
        document.getElementById('lastUpdated').textContent =
            `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    // --- Station detail ---
    async function showStationDetail(station) {
        const panel = document.getElementById('stationDetail');
        const content = document.getElementById('detailContent');
        const aqi = parseInt(station.aqi);
        const level = getAqiLevel(aqi);

        content.innerHTML = `
            <div class="detail-header">
                <div class="detail-station-name">${station.station?.name || 'Unknown Station'}</div>
                <div class="detail-time">Loading detailed data...</div>
            </div>
            <div class="detail-aqi-display">
                <div class="detail-aqi-number" style="color:${level.color}">${aqi}</div>
                <div class="detail-aqi-info">
                    <div class="detail-aqi-label" style="color:${level.color}">${level.label}</div>
                    <div class="detail-aqi-desc">${level.desc}</div>
                </div>
            </div>
        `;
        panel.classList.remove('hidden');

        try {
            const resp = await fetch(`${WAQI_API}/feed/@${station.uid}/?token=${WAQI_TOKEN}`);
            const data = await resp.json();

            if (data.status === 'ok') {
                const d = data.data;
                const iaqi = d.iaqi || {};
                const time = d.time?.s || '';

                let pollutantsHtml = '<div class="detail-pollutants">';
                const pollutants = [
                    { key: 'pm25', label: 'PM2.5', unit: 'μg/m³' },
                    { key: 'pm10', label: 'PM10', unit: 'μg/m³' },
                    { key: 'o3', label: 'O₃', unit: 'ppb' },
                    { key: 'no2', label: 'NO₂', unit: 'ppb' },
                    { key: 'so2', label: 'SO₂', unit: 'ppb' },
                    { key: 'co', label: 'CO', unit: 'ppm' },
                    { key: 't', label: 'Temp', unit: '°C' },
                    { key: 'h', label: 'Humidity', unit: '%' },
                    { key: 'w', label: 'Wind', unit: 'm/s' },
                    { key: 'p', label: 'Pressure', unit: 'hPa' }
                ];

                for (const p of pollutants) {
                    if (iaqi[p.key]) {
                        pollutantsHtml += `
                            <div class="pollutant-card">
                                <div class="pollutant-name">${p.label}</div>
                                <div class="pollutant-value">${iaqi[p.key].v}<span class="pollutant-unit"> ${p.unit}</span></div>
                            </div>
                        `;
                    }
                }
                pollutantsHtml += '</div>';

                content.innerHTML = `
                    <div class="detail-header">
                        <div class="detail-station-name">${d.city?.name || station.station?.name || 'Unknown'}</div>
                        <div class="detail-time">${time ? `Measured: ${time}` : ''}</div>
                    </div>
                    <div class="detail-aqi-display">
                        <div class="detail-aqi-number" style="color:${level.color}">${d.aqi}</div>
                        <div class="detail-aqi-info">
                            <div class="detail-aqi-label" style="color:${level.color}">${level.label}</div>
                            <div class="detail-aqi-desc">${level.desc}</div>
                        </div>
                    </div>
                    ${pollutantsHtml}
                `;
            }
        } catch (e) {
            console.warn('Detail fetch failed:', e);
        }
    }

    document.getElementById('closeDetail').addEventListener('click', () => {
        document.getElementById('stationDetail').classList.add('hidden');
    });

    // --- Search ---
    let searchTimeout = null;

    document.getElementById('searchInput').addEventListener('input', function () {
        clearTimeout(searchTimeout);
        const query = this.value.trim();
        const results = document.getElementById('searchResults');

        if (query.length < 2) {
            results.classList.add('hidden');
            return;
        }

        searchTimeout = setTimeout(async () => {
            try {
                const resp = await fetch(`${WAQI_API}/search/?keyword=${encodeURIComponent(query)}&token=${WAQI_TOKEN}`);
                const data = await resp.json();

                if (data.status === 'ok' && data.data.length > 0) {
                    results.innerHTML = data.data.slice(0, 8).map(item => {
                        const aqi = parseInt(item.aqi);
                        const level = getAqiLevel(isNaN(aqi) ? 0 : aqi);
                        return `
                            <div class="search-result-item" data-uid="${item.uid}" data-lat="${item.station?.geo?.[0]}" data-lng="${item.station?.geo?.[1]}">
                                <span class="search-result-name">${item.station?.name || 'Unknown'}</span>
                                <span class="search-result-aqi" style="background:${level.color};color:white">${isNaN(aqi) ? '—' : aqi}</span>
                            </div>
                        `;
                    }).join('');
                    results.classList.remove('hidden');

                    results.querySelectorAll('.search-result-item').forEach(el => {
                        el.addEventListener('click', () => {
                            const lat = parseFloat(el.dataset.lat);
                            const lng = parseFloat(el.dataset.lng);
                            if (!isNaN(lat) && !isNaN(lng)) {
                                map.setView([lat, lng], 10);
                                results.classList.add('hidden');
                                document.getElementById('searchInput').value = '';
                            }
                        });
                    });
                } else {
                    results.innerHTML = '<div class="search-result-item"><span class="search-result-name" style="color:#64748b">No results found</span></div>';
                    results.classList.remove('hidden');
                }
            } catch (e) {
                console.warn('Search failed:', e);
            }
        }, 350);
    });

    document.addEventListener('click', (e) => {
        if (!document.getElementById('searchBox').contains(e.target)) {
            document.getElementById('searchResults').classList.add('hidden');
        }
    });

    // --- Map events ---
    function debouncedFetch() {
        clearTimeout(fetchTimeout);
        fetchTimeout = setTimeout(fetchStations, 400);
    }

    map.on('moveend', debouncedFetch);
    map.on('zoomend', debouncedFetch);

    // --- Initial load ---
    fetchStations().then(() => {
        setTimeout(() => {
            loadingEl.classList.add('fade-out');
            setTimeout(() => loadingEl.remove(), 500);
        }, 300);
    });

    // Auto-refresh every 5 minutes
    setInterval(fetchStations, 5 * 60 * 1000);

})();
