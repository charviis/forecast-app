// Wind animation state
let windAnim = { particles: [], canvas: null, ctx: null, raf: 0, width: 0, height: 0, speed: 0, dirRad: 0 };

const apiKey = '02f58d74d2014ec45cd93186064f9142';
const WEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather';
const FORECAST_URL = 'https://api.openweathermap.org/data/2.5/forecast'; // 5-day / 3-hour forecast

// DOM
const locationInput = document.getElementById('locationInput');
const searchButton = document.getElementById('searchButton');
const geolocateButton = document.getElementById('geolocateButton');
const unitToggle = document.getElementById('unitToggle');
const clearButton = document.getElementById('clearButton');
const statusEl = document.getElementById('status');
const locationElement = document.getElementById('location');
const temperatureElement = document.getElementById('temperature');
const descriptionElement = document.getElementById('description');
const humidityElement = document.getElementById('humidity');
const windSpeedElement = document.getElementById('windSpeed');
const feelsLikeElement = document.getElementById('feelsLike');
const forecastGrid = document.getElementById('forecastGrid');
// Extras & favorites
const favoritesEl = document.getElementById('favorites');
const addFavoriteButton = document.getElementById('addFavoriteButton');
const shareButton = document.getElementById('shareButton');
const localTimeEl = document.getElementById('localTime');
const sunriseEl = document.getElementById('sunrise');
const sunsetEl = document.getElementById('sunset');
const aqiIndexEl = document.getElementById('aqiIndex');
const aqiDetailsEl = document.getElementById('aqiDetails');
// New UI hooks
const themeToggleBtn = document.getElementById('themeToggle');
const recentListEl = document.getElementById('recentList');
const hourlyChartEl = document.getElementById('hourlyChart');

// State
let units = (localStorage.getItem('units') === 'imperial') ? 'imperial' : 'metric'; // 'metric' | 'imperial'
let markers = [];
let pointerMarker = null;
let pulseMarker = null;
let activeReq = 0; // request token to avoid race conditions
let unitChangeTimer = null;
let lastCoords = { lat: 50.0755, lon: 14.4378, label: 'Prague' };
let theme = localStorage.getItem('theme') || 'dark'; // 'dark' | 'light'
let sunTimer = null;
let playbackTimer = null;
let playbackIndex = 0;

// Map (Leaflet) init guarded in case CDN fails (background map variant)
let map = null;
let hasMap = false;
let leafletLoading = false;
let bgMapEl = document.getElementById('mapBackground');
function loadLeafletFallback() {
    if (leafletLoading) return; // avoid duplicates
    leafletLoading = true;
    if (bgMapEl) bgMapEl.classList.add('loading');
    // Add CSS if missing
    if (!document.querySelector('link[data-leaflet-fallback]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
        link.setAttribute('data-leaflet-fallback', '');
        document.head.appendChild(link);
    }
    // Add JS if missing
    if (!document.querySelector('script[data-leaflet-fallback]')) {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
        s.defer = true;
        s.setAttribute('data-leaflet-fallback', '');
    s.onload = () => { leafletLoading = false; initMap(); };
    s.onerror = () => { leafletLoading = false; if (bgMapEl) bgMapEl.classList.add('error'); setStatus('Map failed to load.', true); };
        document.head.appendChild(s);
    }
}

function initMap() {
    try {
        if (typeof L === 'undefined') { loadLeafletFallback(); return; }
    // Use background container as map root, fallback to hidden #map
    const containerId = bgMapEl ? 'mapBackground' : 'map';
    // Restore map view if available
    let savedView = null; try { savedView = JSON.parse(localStorage.getItem('mapView') || 'null'); } catch {}
        const startLat = savedView?.lat ?? 50.0755;
        const startLon = savedView?.lon ?? 14.4378;
        const startZoom = savedView?.zoom ?? 11;
    map = L.map(containerId, { zoomControl: false }).setView([startLat, startLon], startZoom);

        // Base layers
        const baseLayers = {
            'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }),
            'Esri WorldImagery': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' }),
            'OpenTopoMap': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Style: &copy; OpenTopoMap' })
        };
        const savedBase = localStorage.getItem('mapBase') || 'OpenStreetMap';
        const base = baseLayers[savedBase] || baseLayers['OpenStreetMap'];
        base.addTo(map);

        // Weather overlays
        const overlayOpacity = parseFloat(localStorage.getItem('mapOverlayOpacity') || '0.5');
        const precipitationLayer = L.tileLayer(`https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${apiKey}`, { maxZoom: 19, attribution: 'OpenWeatherMap', opacity: overlayOpacity });
        const windLayer = L.tileLayer(`https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${apiKey}`, { maxZoom: 19, attribution: 'OpenWeatherMap', opacity: overlayOpacity });
        const cloudsLayer = L.tileLayer(`https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${apiKey}`, { maxZoom: 19, attribution: 'OpenWeatherMap', opacity: overlayOpacity });
        const tempLayer = L.tileLayer(`https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${apiKey}`, { maxZoom: 19, attribution: 'OpenWeatherMap', opacity: overlayOpacity });
        const pressureLayer = L.tileLayer(`https://tile.openweathermap.org/map/pressure_new/{z}/{x}/{y}.png?appid=${apiKey}`, { maxZoom: 19, attribution: 'OpenWeatherMap', opacity: overlayOpacity });

        const overlays = { 'Precipitation': precipitationLayer, 'Wind': windLayer, 'Clouds': cloudsLayer, 'Temperature': tempLayer, 'Pressure': pressureLayer };
        L.control.layers(baseLayers, overlays, { collapsed: true }).addTo(map);
        L.control.scale({ imperial: true }).addTo(map);

        // Restore overlay selections
        try {
            const savedOverlays = JSON.parse(localStorage.getItem('mapOverlays') || '[]');
            savedOverlays.forEach(name => { if (overlays[name]) overlays[name].addTo(map); });
        } catch {}

        // Persist base/overlay selections
        map.on('baselayerchange', (e) => { localStorage.setItem('mapBase', e.name); });
        map.on('overlayadd', () => {
            const list = Object.keys(overlays).filter(n => map.hasLayer(overlays[n]));
            localStorage.setItem('mapOverlays', JSON.stringify(list));
        });
        map.on('overlayremove', () => {
            const list = Object.keys(overlays).filter(n => map.hasLayer(overlays[n]));
            localStorage.setItem('mapOverlays', JSON.stringify(list));
        });

        // Custom controls
        try {
            createOpacityControl(overlays, overlayOpacity).addTo(map);
        } catch {}
        try {
            createActionButtonsControl().addTo(map);
        } catch {}
        try {
            createPlaybackControl().addTo(map);
        } catch {}

        // Map click to get weather
        map.on('click', async (e) => {
            try {
                await fetchWeatherByCoords(e.latlng.lat, e.latlng.lng);
            } catch (err) {
                console.error(err);
            }
        });
        // Save view on moveend
        map.on('moveend', () => {
            const c = map.getCenter();
            localStorage.setItem('mapView', JSON.stringify({ lat: c.lat, lon: c.lng, zoom: map.getZoom() }));
        });

        // Invalidate size after layout & on window resize
        setTimeout(() => { try { map.invalidateSize(false); } catch {} }, 60);
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { try { map.invalidateSize(false); } catch {} }, 180);
        });
        hasMap = true;
        if (bgMapEl) bgMapEl.classList.remove('loading');
        setStatus('');
    } catch (e) {
        console.error('Map init failed', e);
        if (bgMapEl) bgMapEl.classList.add('error');
        setStatus('Map failed to initialize.', true);
    }
}

// Reflect persisted unit state in toggle
if (unitToggle) unitToggle.checked = units === 'imperial';

function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#ffb4b4' : '#cfcfcf';
}

// Theme
function applyTheme(next) {
    theme = next;
    if (theme === 'light') document.body.classList.add('theme-light');
    else document.body.classList.remove('theme-light');
    localStorage.setItem('theme', theme);
}
applyTheme(theme);

function clearMarkers() {
    if (!hasMap) { markers = []; return; }
    markers.forEach(m => map.removeLayer(m));
    markers = [];
}

function addMarker(lat, lon, label) {
    if (!hasMap) return;
    if (!pointerMarker) {
        pointerMarker = L.marker([lat, lon], { draggable: true }).addTo(map);
        pointerMarker.on('dragend', () => {
            const p = pointerMarker.getLatLng();
            fetchWeatherByCoords(p.lat, p.lng).catch(()=>{});
        });
        pointerMarker.on('drag', () => {
            if (pulseMarker) pulseMarker.setLatLng(pointerMarker.getLatLng());
        });
        markers.push(pointerMarker);
    } else {
        pointerMarker.setLatLng([lat, lon]);
    }
    // Pulse decoration marker
    try {
        const pulseIcon = L.divIcon({
            className: 'pulse-wrapper',
            html: '<div class="pulse-marker"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        if (!pulseMarker) {
            pulseMarker = L.marker([lat, lon], { icon: pulseIcon, interactive: false, keyboard: false, zIndexOffset: -1000 });
            pulseMarker.addTo(map);
            markers.push(pulseMarker);
        } else {
            pulseMarker.setLatLng([lat, lon]);
        }
    } catch {}
    if (label) pointerMarker.bindPopup(label).openPopup();
}

function formatWind(speed) {
    return units === 'metric' ? `${speed} m/s` : `${speed} mph`;
}

function updateWeatherUI(data) {
    const tempUnit = units === 'metric' ? '°C' : '°F';
    locationElement.textContent = data.name || `${data.coord.lat.toFixed(2)}, ${data.coord.lon.toFixed(2)}`;
    // Animate temp change
    temperatureElement.classList.add('temp-fade');
    const newTemp = `${Math.round(data.main.temp)}${tempUnit}`;
    // Allow CSS to animate, then swap text
    setTimeout(() => { temperatureElement.textContent = newTemp; temperatureElement.classList.remove('temp-fade'); }, 120);
    const desc = data.weather?.[0]?.description || '';
    descriptionElement.textContent = desc.charAt(0).toUpperCase() + desc.slice(1);
    humidityElement.textContent = `Humidity: ${data.main.humidity}%`;
    const deg = data.wind?.deg ?? 0;
    windSpeedElement.innerHTML = `Wind: <span class="wind"><span class="arrow" style="transform: rotate(${deg}deg);">➤</span> ${formatWind(data.wind.speed)}</span>`;
    // Animated wind particles
    try { initWindFlow(data.wind.speed, deg); } catch {}


// Wind animation (simple particle flow indicating speed & direction)
function initWindFlow(speed, deg) {
    if (!windSpeedElement) return;
    let flow = windSpeedElement.querySelector('.wind-flow');
    if (!flow) {
        flow = document.createElement('div');
        flow.className = 'wind-flow';
        flow.innerHTML = '<canvas aria-hidden="true"></canvas>';
        windSpeedElement.appendChild(flow);
    }
    const canvas = flow.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    // Resize
    const desiredW = 140; const desiredH = 34;
    if (canvas.width !== desiredW) { canvas.width = desiredW; canvas.style.width = desiredW+'px'; }
    if (canvas.height !== desiredH) { canvas.height = desiredH; canvas.style.height = desiredH+'px'; }
    windAnim.width = desiredW; windAnim.height = desiredH; windAnim.canvas = canvas; windAnim.ctx = ctx;
    windAnim.speed = Math.max(0, speed || 0);
    // Convert meteorological deg (from which it blows) to direction of particle motion (to where it goes)
    windAnim.dirRad = ((deg + 180) % 360) * Math.PI / 180;
    const particleCount = 22;
    if (!windAnim.particles.length) {
        for (let i = 0; i < particleCount; i++) windAnim.particles.push(makeWindParticle());
    } else if (windAnim.particles.length !== particleCount) {
        windAnim.particles = [];
        for (let i = 0; i < particleCount; i++) windAnim.particles.push(makeWindParticle());
    }
    if (!windAnim.raf) animateWind();
}
function makeWindParticle() {
    const t = Math.random();
    return {
        x: Math.random() * windAnim.width,
        y: Math.random() * windAnim.height,
        life: t * 1,
        len: 8 + Math.random() * 12,
        drift: (Math.random() - 0.5) * 0.4
    };
}
function animateWind(ts) {
    const { ctx, width:w, height:h, particles, speed, dirRad } = windAnim;
    if (!ctx) return;
    ctx.clearRect(0,0,w,h);
    const vx = Math.cos(dirRad);
    const vy = Math.sin(dirRad);
    // Base velocity scale: px/sec ~ 18 * speed(m/s); convert to frame delta using fixed dt assumption
    const vScale = (speed || 0) * 18 / 60; // per frame (~60fps)
    particles.forEach(p => {
        p.x += vx * vScale + p.drift;
        p.y += vy * vScale + p.drift * 0.3;
        p.life += 0.015 + (speed/300);
        // Wrap
        if (p.x < -20) p.x = w + 10;
        if (p.x > w + 20) p.x = -10;
        if (p.y < -20) p.y = h + 10;
        if (p.y > h + 20) p.y = -10;
        // Draw trail
        const fade = 0.2 + 0.8 * (1 - (p.life % 1));
        ctx.strokeStyle = `rgba(59,130,246,${fade})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - vx * p.len, p.y - vy * p.len);
        ctx.stroke();
    });
    windAnim.raf = requestAnimationFrame(animateWind);
}
    feelsLikeElement.textContent = `Feels like: ${Math.round(data.main.feels_like)}${tempUnit}`;
    // Local time & sun
    try {
        if (typeof data.timezone === 'number' && localTimeEl) {
            const localMs = getLocalTimeMs(data.timezone);
            localTimeEl.textContent = `Local time: ${new Date(localMs).toLocaleString([], { hour: '2-digit', minute: '2-digit', weekday: 'short' })}`;
        }
        if (sunriseEl && data.sys?.sunrise) sunriseEl.textContent = `Sunrise: ${new Date(data.sys.sunrise * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        if (sunsetEl && data.sys?.sunset) sunsetEl.textContent = `Sunset: ${new Date(data.sys.sunset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        setupOrUpdateSunTrack(data);
    } catch {}
}

// Compute local time ms given OWM timezone (seconds from UTC)
function getLocalTimeMs(owmTzSeconds) {
    const now = Date.now();
    const utcNow = now + (new Date().getTimezoneOffset() * -60000);
    return utcNow + (owmTzSeconds * 1000);
}

function renderForecast(list) {
    // Group entries by date, pick around 12:00, fallback to first of day
    const byDay = {};
    list.forEach(item => {
        const dt = new Date(item.dt * 1000);
        const dayKey = dt.toISOString().slice(0, 10);
        if (!byDay[dayKey]) byDay[dayKey] = [];
        byDay[dayKey].push(item);
    });
    const days = Object.keys(byDay).sort().slice(0, 5);
    const tempUnit = units === 'metric' ? '°C' : '°F';
    forecastGrid.innerHTML = days.map(day => {
        const items = byDay[day];
        let pick = items.find(i => new Date(i.dt * 1000).getHours() === 12) || items[Math.floor(items.length / 2)];
        const d = new Date(pick.dt * 1000);
        const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
        const icon = pick.weather?.[0]?.icon;
        const desc = pick.weather?.[0]?.description || '';
        const temp = Math.round(pick.main.temp);
        const min = Math.round(Math.min(...items.map(i => i.main.temp_min)));
        const max = Math.round(Math.max(...items.map(i => i.main.temp_max)));
        const pop = Math.round(100 * Math.max(...items.map(i => i.pop ?? 0)));
        const iconUrl = icon ? `https://openweathermap.org/img/wn/${icon}@2x.png` : '';
        return `
            <div class="forecast-card" role="group" aria-label="${weekday} forecast">
                <div class="day">${weekday}</div>
                ${iconUrl ? `<img src="${iconUrl}" alt="${desc}" width="60" height="60" loading="lazy">` : ''}
                <div class="temp">${temp}${tempUnit}</div>
                <div class="desc">${desc}</div>
                <div class="minmax">${min}${tempUnit} / ${max}${tempUnit}${pop ? ` · ${pop}%` : ''}</div>
            </div>
        `;
    }).join('');
}

async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
    }
    return res.json();
}

async function fetchWeatherByCoords(lat, lon) {
    const url = `${WEATHER_URL}?lat=${lat}&lon=${lon}&appid=${apiKey}&units=${units}`;
    const reqId = ++activeReq;
    setStatus('Loading current weather…');
    try {
        const data = await fetchJSON(url);
        if (reqId !== activeReq) return; // stale response ignored
        if (hasMap) map.setView([lat, lon], 12);
        clearMarkers();
    addMarker(lat, lon, `Location: ${data.name || lat.toFixed(3)+', '+lon.toFixed(3)}`);
    updateWeatherUI(data);
    // Persist last coords
    lastCoords = { lat, lon, label: data.name || '' };
    localStorage.setItem('lastLocation', JSON.stringify(lastCoords));
    // Forecast
    await fetchForecast(lat, lon);
    // AQI
    fetchAQI(lat, lon).catch(() => {});
        if (reqId !== activeReq) return;
        setStatus('');
    } catch (e) {
        if (reqId !== activeReq) return;
        console.error(e);
        setStatus('Failed to load weather.', true);
        throw e;
    }
}

async function fetchWeatherByQuery(query) {
    // Use Nominatim to get coords, then fetch by coords for consistency
    setStatus('Searching…');
    const geocode = await fetchJSON(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
    if (!geocode.length) throw new Error('Location not found');
    const lat = parseFloat(geocode[0].lat);
    const lon = parseFloat(geocode[0].lon);
    await fetchWeatherByCoords(lat, lon);
    // Show search text explicitly if OWM city name differs/missing
    if (locationElement.textContent && query && !locationElement.textContent.toLowerCase().includes(query.toLowerCase())) {
        locationElement.textContent = `${locationElement.textContent} (${query})`;
    }
    // Persist last search for convenience
    lastCoords = { lat, lon, label: query };
    localStorage.setItem('lastLocation', JSON.stringify(lastCoords));
}

async function fetchForecast(lat, lon) {
    const url = `${FORECAST_URL}?lat=${lat}&lon=${lon}&appid=${apiKey}&units=${units}`;
    try {
        const data = await fetchJSON(url);
        renderForecast(data.list || []);
    renderHourlyChart(data.list || []);
    } catch (e) {
        console.warn('Forecast failed', e);
    }
}

// Events
searchButton.addEventListener('click', () => {
    const value = locationInput.value.trim();
    if (value) handleSearch(value);
});

locationInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const value = locationInput.value.trim();
        if (value) handleSearch(value);
    }
});

clearButton.addEventListener('click', () => {
    locationInput.value = '';
    clearButton.style.display = 'none';
    locationInput.focus();
});

locationInput.addEventListener('input', () => {
    clearButton.style.display = locationInput.value ? 'block' : 'none';
});

unitToggle?.addEventListener('change', () => {
    // debounce rapid toggles
    if (unitChangeTimer) clearTimeout(unitChangeTimer);
    unitChangeTimer = setTimeout(async () => {
        units = unitToggle.checked ? 'imperial' : 'metric';
        localStorage.setItem('units', units);
        let center = { lat: 50.0755, lng: 14.4378 };
        if (hasMap) center = map.getCenter();
        else {
            const last = localStorage.getItem('lastLocation');
            if (last) {
                try { const j = JSON.parse(last); center = { lat: j.lat, lng: j.lon }; } catch {}
            }
        }
        try {
            await fetchWeatherByCoords(center.lat, center.lng);
        } catch (e) {
            console.warn(e);
        }
    }, 120);
});

geolocateButton?.addEventListener('click', () => {
    geolocateAndFetch();
});

async function handleSearch(value) {
    try {
        await fetchWeatherByQuery(value);
    addRecentSearch(value);
    populateRecentDatalist();
    } catch (e) {
        alert('Location not found.');
        console.error(e);
    }
}

// Geolocation helper used by button and map control
function geolocateAndFetch() {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
            await fetchWeatherByCoords(latitude, longitude);
        } catch (e) {
            alert('Failed to fetch weather for your location.');
        }
    }, (err) => {
        alert('Unable to retrieve your location.');
        console.error(err);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

// Leaflet controls: overlay opacity slider
function createOpacityControl(overlays, initialValue) {
    const control = L.control({ position: 'topright' });
    control.onAdd = function () {
        const div = L.DomUtil.create('div', 'leaflet-control opacity-control');
        div.innerHTML = `
            <label style="display:block; font-size:12px; margin-bottom:4px;">Overlay opacity</label>
            <input type="range" min="0" max="1" step="0.05" value="${initialValue}" aria-label="Overlay opacity" style="width:120px;">
        `;
        const range = div.querySelector('input');
        const setOpacity = (val) => {
            Object.values(overlays).forEach(layer => {
                try { layer.setOpacity(val); } catch {}
            });
            localStorage.setItem('mapOverlayOpacity', String(val));
        };
        // Stop map interactions when using slider
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.on(range, 'input', (e) => setOpacity(parseFloat(e.target.value)));
        return div;
    };
    return control;
}

// Leaflet controls: quick action buttons (geolocate, fetch at center)
function createActionButtonsControl() {
    const control = L.control({ position: 'topleft' });
    control.onAdd = function () {
        const container = L.DomUtil.create('div', 'leaflet-bar action-buttons');
        const btnGeo = L.DomUtil.create('a', '', container);
        btnGeo.href = '#';
        btnGeo.title = 'Use my location';
        btnGeo.setAttribute('role', 'button');
        btnGeo.setAttribute('aria-label', 'Use my location');
        btnGeo.textContent = '📍';
        const btnCenter = L.DomUtil.create('a', '', container);
        btnCenter.href = '#';
        btnCenter.title = 'Fetch weather at map center';
        btnCenter.setAttribute('role', 'button');
        btnCenter.setAttribute('aria-label', 'Fetch weather at map center');
        btnCenter.textContent = '🎯';
        // Prevent map drag/zoom when clicking
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(btnGeo, 'click', (e) => { e.preventDefault(); geolocateAndFetch(); });
        L.DomEvent.on(btnCenter, 'click', (e) => {
            e.preventDefault();
            if (!map) return;
            const c = map.getCenter();
            fetchWeatherByCoords(c.lat, c.lng).catch(() => {});
        });
        return container;
    };
    return control;
}

// Initialize map if Leaflet loaded
initMap();

// Default flow: support share params first, then last location, else Prague
const savedUnits = localStorage.getItem('units');
if (savedUnits) units = savedUnits;
if (unitToggle) unitToggle.checked = units === 'imperial';
let initialized = false;
try {
    const params = new URLSearchParams(window.location.search);
    const plat = parseFloat(params.get('lat'));
    const plon = parseFloat(params.get('lon'));
    const pu = params.get('u');
    if (pu === 'i' || pu === 'm') {
        units = pu === 'i' ? 'imperial' : 'metric';
        localStorage.setItem('units', units);
        if (unitToggle) unitToggle.checked = units === 'imperial';
    }
    if (!Number.isNaN(plat) && !Number.isNaN(plon)) {
        fetchWeatherByCoords(plat, plon).catch(() => {});
        initialized = true;
    }
} catch {}
if (!initialized) {
    const last = localStorage.getItem('lastLocation');
    if (last) {
        try {
            const { lat, lon } = JSON.parse(last);
            fetchWeatherByCoords(lat, lon).catch(() => fetchWeatherByCoords(50.0755, 14.4378));
            initialized = true;
        } catch {}
    }
}
if (!initialized) fetchWeatherByCoords(50.0755, 14.4378).catch(() => {});

// Favorites helpers
function getFavorites() {
    try { return JSON.parse(localStorage.getItem('favorites') || '[]'); } catch { return []; }
}
function saveFavorites(list) { localStorage.setItem('favorites', JSON.stringify(list)); }
function renderFavorites() {
    if (!favoritesEl) return;
    const favs = getFavorites();
    favoritesEl.innerHTML = favs.map(f => `<button class="chip" data-lat="${f.lat}" data-lon="${f.lon}" title="${f.label}">${f.label}<span class="x" data-remove="${f.lat},${f.lon}">×</span></button>`).join('');
}
favoritesEl?.addEventListener('click', (e) => {
    const removeAttr = e.target.getAttribute?.('data-remove');
    if (removeAttr) {
        const [lat, lon] = removeAttr.split(',').map(Number);
        const filtered = getFavorites().filter(f => !(f.lat === lat && f.lon === lon));
        saveFavorites(filtered); renderFavorites();
        return;
    }
    const btn = e.target.closest?.('.chip');
    if (!btn) return;
    const lat = parseFloat(btn.getAttribute('data-lat'));
    const lon = parseFloat(btn.getAttribute('data-lon'));
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) fetchWeatherByCoords(lat, lon).catch(()=>{});
});
addFavoriteButton?.addEventListener('click', () => {
    if (!lastCoords) return;
    const favs = getFavorites();
    if (!favs.some(f => f.lat === lastCoords.lat && f.lon === lastCoords.lon)) {
        favs.push(lastCoords);
        saveFavorites(favs);
        renderFavorites();
        setStatus('Added to favorites');
        setTimeout(() => setStatus(''), 1000);
    }
});
renderFavorites();

// Share link
shareButton?.addEventListener('click', async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('lat', String(lastCoords.lat));
    url.searchParams.set('lon', String(lastCoords.lon));
    url.searchParams.set('u', units === 'imperial' ? 'i' : 'm');
    try {
        await navigator.clipboard.writeText(url.toString());
        setStatus('Link copied to clipboard');
        setTimeout(() => setStatus(''), 1200);
    } catch {
        setStatus(url.toString());
    }
});

// Air Quality (OpenWeather Air Pollution API)
async function fetchAQI(lat, lon) {
    try {
        const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;
        const data = await fetchJSON(url);
        const aqi = data?.list?.[0]?.main?.aqi;
        const comps = data?.list?.[0]?.components || {};
        let cls = 'aqi-mod', label = 'Moderate';
        if (aqi === 1) { cls = 'aqi-good'; label = 'Good'; }
        if (aqi >= 4) { cls = 'aqi-bad'; label = 'Poor'; }
        if (aqiIndexEl) aqiIndexEl.className = `aqi-badge ${cls}`;
        if (aqiIndexEl) aqiIndexEl.textContent = `AQI ${aqi}: ${label}`;
        if (aqiDetailsEl) aqiDetailsEl.innerHTML = `PM2.5: ${comps.pm2_5 ?? '-'} · PM10: ${comps.pm10 ?? '-'} · O₃: ${comps.o3 ?? '-'}`;
    } catch (e) {
        if (aqiIndexEl) aqiIndexEl.textContent = '';
        if (aqiDetailsEl) aqiDetailsEl.textContent = '';
    }
}

// Recent searches (datalist)
function getRecentSearches() {
    try { return JSON.parse(localStorage.getItem('recentSearches') || '[]'); } catch { return []; }
}
function saveRecentSearches(list) { localStorage.setItem('recentSearches', JSON.stringify(list.slice(0, 10))); }
function addRecentSearch(q) {
    if (!q) return;
    const list = getRecentSearches();
    const existsIdx = list.findIndex(x => x.toLowerCase() === q.toLowerCase());
    if (existsIdx >= 0) list.splice(existsIdx, 1);
    list.unshift(q);
    saveRecentSearches(list);
}
function populateRecentDatalist() {
    if (!recentListEl) return;
    const list = getRecentSearches();
    recentListEl.innerHTML = list.map(v => `<option value="${v}"></option>`).join('');
}
populateRecentDatalist();

// Theme toggle button
themeToggleBtn?.addEventListener('click', () => {
    applyTheme(theme === 'dark' ? 'light' : 'dark');
});

// Hourly chart (next ~24h)
function renderHourlyChart(list) {
    if (!hourlyChartEl) return;
    hourlyChartEl.innerHTML = '';
    if (!Array.isArray(list) || list.length === 0) return;
    // take first 8 entries (~24h)
    const items = list.slice(0, 8);
    const temps = items.map(i => i.main?.temp).filter(t => typeof t === 'number');
    if (!temps.length) return;
    const labels = items.map(i => new Date(i.dt * 1000).toLocaleTimeString([], { hour: '2-digit' }));
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const width = hourlyChartEl.clientWidth || 520;
    const height = 160;
    const padding = { l: 28, r: 12, t: 16, b: 24 };
    const cw = width;
    const ch = height;
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    canvas.style.width = '100%';
    canvas.style.height = `${ch}px`;
    hourlyChartEl.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    // helpers
    const xFor = (i) => padding.l + (i * (cw - padding.l - padding.r) / (temps.length - 1));
    const yFor = (t) => {
        if (max === min) return ch / 2;
        const norm = (t - min) / (max - min);
        return padding.t + (1 - norm) * (ch - padding.t - padding.b);
    };
    // background grid lines
    ctx.strokeStyle = theme === 'light' ? '#e5e5e5' : '#2a2a2a';
    ctx.lineWidth = 1;
    [0, 0.5, 1].forEach((p) => {
        const y = padding.t + p * (ch - padding.t - padding.b);
        ctx.beginPath(); ctx.moveTo(padding.l, y); ctx.lineTo(cw - padding.r, y); ctx.stroke();
    });
    // area gradient
    const grad = ctx.createLinearGradient(0, padding.t, 0, ch - padding.b);
    grad.addColorStop(0, theme === 'light' ? 'rgba(37,99,235,0.35)' : 'rgba(37,99,235,0.25)');
    grad.addColorStop(1, theme === 'light' ? 'rgba(37,99,235,0.05)' : 'rgba(37,99,235,0.02)');
    // path
    ctx.beginPath();
    temps.forEach((t, i) => {
        const x = xFor(i), y = yFor(t);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    // stroke
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.stroke();
    // fill
    ctx.lineTo(cw - padding.r, ch - padding.b);
    ctx.lineTo(padding.l, ch - padding.b);
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    // points + labels
    ctx.fillStyle = theme === 'light' ? '#111' : '#eaeaea';
    ctx.font = '12px Montserrat, sans-serif';
    temps.forEach((t, i) => {
        const x = xFor(i), y = yFor(t);
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = '#1d4ed8'; ctx.fill();
        ctx.fillStyle = theme === 'light' ? '#111' : '#eaeaea';
        const label = `${Math.round(t)}${units === 'metric' ? '°C' : '°F'}`;
        ctx.fillText(label, x - ctx.measureText(label).width / 2, y - 8);
        // x-axis time
        const time = labels[i];
        ctx.fillText(time, x - ctx.measureText(time).width / 2, ch - 6);
    });
}

// Leaflet controls: playback through favorites (map animation)
function createPlaybackControl() {
    const control = L.control({ position: 'topleft' });
    control.onAdd = function () {
        const container = L.DomUtil.create('div', 'leaflet-bar playback');
        const btnPlay = L.DomUtil.create('a', '', container);
        btnPlay.href = '#';
        btnPlay.title = 'Play favorites slideshow';
        btnPlay.setAttribute('role', 'button');
        btnPlay.setAttribute('aria-label', 'Play favorites slideshow');
        btnPlay.textContent = '▶';
        const btnPause = L.DomUtil.create('a', '', container);
        btnPause.href = '#';
        btnPause.title = 'Pause slideshow';
        btnPause.setAttribute('role', 'button');
        btnPause.setAttribute('aria-label', 'Pause slideshow');
        btnPause.textContent = '⏸';
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(btnPlay, 'click', (e) => { e.preventDefault(); startFavoritesPlayback(); });
        L.DomEvent.on(btnPause, 'click', (e) => { e.preventDefault(); stopFavoritesPlayback(); });
        return container;
    };
    return control;
}

function startFavoritesPlayback() {
    stopFavoritesPlayback();
    const favs = getFavorites();
    if (!favs.length) { setStatus('Add favorites to use slideshow'); return; }
    playbackIndex = 0;
    const step = async () => {
        const f = favs[playbackIndex % favs.length];
        playbackIndex++;
        try {
            if (hasMap) map.flyTo([f.lat, f.lon], Math.max(map.getZoom(), 10), { animate: true, duration: 1.2 });
            await fetchWeatherByCoords(f.lat, f.lon);
        } catch {}
    };
    step();
    playbackTimer = setInterval(step, 6500);
}
function stopFavoritesPlayback() {
    if (playbackTimer) { clearInterval(playbackTimer); playbackTimer = null; }
}

// Sunrise/Sunset animated progress
function setupOrUpdateSunTrack(data) {
    try {
        const container = document.querySelector('.time-sun');
        if (!container || !data?.sys) return;
        let rail = container.querySelector('.sun-rail');
        let fill = container.querySelector('.sun-fill');
        let sun = container.querySelector('.sun-dot');
        if (!rail) {
            const wrap = document.createElement('div');
            wrap.className = 'sun-track';
            wrap.innerHTML = '<div class="sun-rail"><div class="sun-fill"></div><div class="sun-dot">☀</div></div>';
            container.appendChild(wrap);
            rail = wrap.querySelector('.sun-rail');
            fill = wrap.querySelector('.sun-fill');
            sun = wrap.querySelector('.sun-dot');
        }
        const tz = data.timezone; // seconds
        const sunriseMs = data.sys.sunrise * 1000;
        const sunsetMs = data.sys.sunset * 1000;
        const update = () => {
            const nowMs = getLocalTimeMs(tz);
            let pct = 0;
            if (nowMs <= sunriseMs) pct = 0;
            else if (nowMs >= sunsetMs) pct = 1;
            else pct = (nowMs - sunriseMs) / (sunsetMs - sunriseMs);
            pct = Math.max(0, Math.min(1, pct));
            const percStr = (pct * 100).toFixed(2) + '%';
            if (fill) fill.style.width = percStr;
            if (sun) sun.style.left = percStr;
        };
        update();
        if (sunTimer) clearInterval(sunTimer);
        sunTimer = setInterval(update, 30000);
    } catch {}
}