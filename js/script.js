const apiKey = '02f58d74d2014ec45cd93186064f9142';
const apiUrl = 'https://api.openweathermap.org/data/2.5/weather';

const locationInput = document.getElementById('locationInput');
const searchButton = document.getElementById('searchButton');
const locationElement = document.getElementById('location');
const temperatureElement = document.getElementById('temperature');
const descriptionElement = document.getElementById('description');

searchButton.addEventListener('click', () => {
    const location = locationInput.value;
    if (location) {
        fetchWeather(location);
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

            // Add more details
            const humidityElement = document.getElementById('humidity');
            const windSpeedElement = document.getElementById('windSpeed');
            const feelsLikeElement = document.getElementById('feelsLike');

            humidityElement.textContent = `Okolní vlhkost: ${data.main.humidity}%`;
            windSpeedElement.textContent = `Rychlost větru: ${data.wind.speed} m/s`;
            feelsLikeElement.textContent = `Pocitová teplota: ${Math.round(data.main.feels_like)}°C`;
            
            // Inicializace mapy s výchozím středem
        var map = L.map('map').setView([50.0755, 14.4378], 13); // Výchozí střed: Praha

        // Přidání OpenStreetMap vrstev
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        // Přidání vrstev OpenWeatherMap
        var precipitationLayer = L.tileLayer(`https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${apiKey}`, {
            maxZoom: 19,
            attribution: 'Map data &copy; <a href="https://openweathermap.org/">OpenWeatherMap</a>',
            opacity: 0.5
        }).addTo(map);

        var windLayer = L.tileLayer(`https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${apiKey}`, {
            maxZoom: 19,
            attribution: 'Map data &copy; <a href="https://openweathermap.org/">OpenWeatherMap</a>',
            opacity: 0.5
        }).addTo(map);

        var precipitationLayer = L.tileLayer(`https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${apiKey}`, {
    maxZoom: 19,
    attribution: 'Map data &copy; <a href="https://openweathermap.org/">OpenWeatherMap</a>',
    opacity: 0.5
}).addTo(map);

var windLayer = L.tileLayer(`https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${apiKey}`, {
    maxZoom: 19,
    attribution: 'Map data &copy; <a href="https://openweathermap.org/">OpenWeatherMap</a>',
    opacity: 0.5
}).addTo(map);

// Funkce pro vyhledání lokace
function searchLocation() {
    var searchInput = document.getElementById('searchInput').value;

    // Volání OpenStreetMap Nominatim API pro geokódování
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchInput)}`)
        .then(response => response.json())
        .then(data => {
            if (data.length > 0) {
                var lat = parseFloat(data[0].lat);
                var lon = parseFloat(data[0].lon);

                // Nastavení nové pozice mapy
                map.setView([lat, lon], 13);

                // Přidání markeru na zadané místo
                L.marker([lat, lon]).addTo(map).bindPopup(`Hledaná lokalita: ${searchInput}`).openPopup();
            } else {
                alert('Lokalita nebyla nalezena.');
            }
        })
        .catch(error => console.error('Chyba při načítání dat:', error));
}

// Přidání posluchače na tlačítko
document.getElementById('searchButton').addEventListener('click', searchLocation);

        });
}