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

            // Add weather animation based on description
            const weatherContainer = document.getElementById('weatherAnimation');
            weatherContainer.className = ''; // Clear previous animation
            if (data.weather[0].main === 'Rain') {
                weatherContainer.className = 'rain';
            } else if (data.weather[0].main === 'Clear') {
                weatherContainer.className = 'clear';
            }
        })
        .catch(error => {
            console.error('Error fetching weather data:', error);
        });
}