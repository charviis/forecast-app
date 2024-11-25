const apiKey = '02f58d74d2014ec45cd93186064f9142';
const apiUrl = 'https://api.openweathermap.org/data/2.5/weather';

const locationInput = document.getElementById('locationInput');
const searchButton = document.getElementById('searchButton');
const clearButton = document.getElementById('clearButton');
const locationElement = document.getElementById('location');
const temperatureElement = document.getElementById('temperature');
const descriptionElement = document.getElementById('description');
const humidityElement = document.getElementById('humidity');
const windSpeedElement = document.getElementById('windSpeed');
const feelsLikeElement = document.getElementById('feelsLike');

// Inicializace mapy s výchozím středem
const map = L.map('map').setView([50.0755, 14.4378], 13); // Výchozí střed: Praha

// Přidání OpenStreetMap vrstev
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Přidání vrstev OpenWeatherMap
const precipitationLayer = L.tileLayer(`https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${apiKey}`, {
    maxZoom: 19,
    attribution: 'Map data &copy; <a href="https://openweathermap.org/">OpenWeatherMap</a>',
    opacity: 0.5
}).addTo(map);

const windLayer = L.tileLayer(`https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${apiKey}`, {
    maxZoom: 19,
    attribution: 'Map data &copy; <a href="https://openweathermap.org/">OpenWeatherMap</a>',
    opacity: 0.5
}).addTo(map);

const cloudsLayer = L.tileLayer(`https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${apiKey}`, {
    maxZoom: 19,
    attribution: 'Map data &copy; <a href="https://openweathermap.org/">OpenWeatherMap</a>',
    opacity: 0.5
}).addTo(map);

let markers = [];

searchButton.addEventListener('click', () => {
    const location = locationInput.value;
    if (location) {
        searchLocation();
    }
});

clearButton.addEventListener('click', () => {
    locationInput.value = '';
    clearButton.style.display = 'none';
});

locationInput.addEventListener('input', () => {
    if (locationInput.value) {
        clearButton.style.display = 'block';
    } else {
        clearButton.style.display = 'none';
    }
});

locationInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        searchLocation();
    }
});

function fetchWeather(location) {
    const url = `${apiUrl}?q=${location}&appid=${apiKey}&units=metric`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            locationElement.textContent = data.name;
            temperatureElement.textContent = `${Math.round(data.main.temp)}°C`;
            descriptionElement.textContent = data.weather[0].description;
            humidityElement.textContent = `Okolní vlhkost: ${data.main.humidity}%`;
            windSpeedElement.textContent = `Rychlost větru: ${data.wind.speed} m/s`;
            feelsLikeElement.textContent = `Pocitová teplota: ${Math.round(data.main.feels_like)}°C`;

            // Aktualizace pozice mapy
            const lat = data.coord.lat;
            const lon = data.coord.lon;
            map.setView([lat, lon], 13);

            // Odstranění starých markerů
            markers.forEach(marker => map.removeLayer(marker));
            markers = [];

            // Přidání markeru na zadané místo
            const marker = L.marker([lat, lon]).addTo(map).bindPopup(`Lokalita: ${data.name}`).openPopup();
            markers.push(marker);
        })
        .catch(error => console.error('Chyba při načítání dat:', error));
}

// Funkce pro vyhledání lokace
function searchLocation() {
    var searchInput = locationInput.value;

    // Volání OpenStreetMap Nominatim API pro geokódování
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchInput)}`)
        .then(response => response.json())
        .then(data => {
            if (data.length > 0) {
                var lat = parseFloat(data[0].lat);
                var lon = parseFloat(data[0].lon);

                // Nastavení nové pozice mapy
                map.setView([lat, lon], 13);

                // Odstranění starých markerů
                markers.forEach(marker => map.removeLayer(marker));
                markers = [];

                // Přidání markeru na zadané místo
                const marker = L.marker([lat, lon]).addTo(map).bindPopup(`Hledaná lokalita: ${searchInput}`).openPopup();
                markers.push(marker);

                // Zavolání funkce fetchWeather pro získání počasí
                fetchWeather(searchInput);
            } else {
                alert('Lokalita nebyla nalezena.');
            }
        })
        .catch(error => console.error('Chyba při načítání dat:', error));
}

// Přidání posluchače na tlačítko
document.getElementById('searchButton').addEventListener('click', searchLocation);