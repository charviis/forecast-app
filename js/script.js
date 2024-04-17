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
            
            // Add map
            L.tileLayer(`https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${apiKey}`, 
            {maxZoom: 19,} ).addTo(map);
            // Add weather animation based on description
            const weatherContainer = document.getElementById('weatherAnimation');
            weatherContainer.className = ''; // Clear previous animation
            if (data.weather[0].main === 'Rain') {
                weatherContainer.className = 'rain';
            } else if (data.weather[0].main === 'Clear') {
                weatherContainer.className = 'clear';
            }
        });
}

