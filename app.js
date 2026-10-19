// === CONFIGURATION ===
const SUPABASE_URL = "https://quxjukgjwvsuismbfaof.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__8-ZIhx5r9eKFwblICJyNQ_Fexy6WA4";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentWeatherData = null;
let wardrobeData = [];
let personalTempOffset = 0;

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  await fetchPersonalFeedbackOffset();
  await loadWardrobe();
  setupEventListeners();
  
  // Standard ved opstart: Hent automatisk telefonens GPS
  getLocationWeather();
}

function setupEventListeners() {
  document.getElementById('btn-location').addEventListener('click', getLocationWeather);
  document.getElementById('btn-search-city').addEventListener('click', searchCityWeather);
  document.getElementById('btn-generate').addEventListener('click', generateAutomaticOutfit);
  document.getElementById('btn-wishlist').addEventListener('click', generateWishlist);
  document.getElementById('btn-parse-garmin').addEventListener('click', handleGarminUpload);
  document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('wishlist-modal').classList.add('hidden');
  });

  // Skift rute-miljø automatisk ved valg af historisk rute
  document.getElementById('saved-routes').addEventListener('change', (e) => {
    const selectedRoute = e.target.value;
    if (selectedRoute === 'route1') {
      document.getElementById('route-environment').value = 'sheltered';
      alert("Valgt: Skov- og Lætur. Rute-miljø opdateret automatisk til 'Læ / Skov'.");
    } else if (selectedRoute === 'route2') {
      document.getElementById('route-environment').value = 'open';
      alert("Valgt: Kysten. Rute-miljø opdateret automatisk til 'Åbent land / Kyst'.");
    }
  });

  // Filter knapper
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      filterWardrobe(e.target.dataset.filter);
    });
  });

  // Feedback knapper
  document.querySelectorAll('.btn-fb').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.btn-fb').forEach(b => b.style.borderColor = 'var(--border)');
      e.target.style.borderColor = 'var(--secondary)';
      e.target.dataset.selected = "true";
    });
  });

  document.getElementById('btn-send-fb').addEventListener('click', sendFeedback);
}

// 1. Feedback Offset (ML)
async function fetchPersonalFeedbackOffset() {
  try {
    const { data } = await supabase
      .from('outfit_feedback')
      .select('rating')
      .order('created_at', { ascending: false })
      .limit(10);

    if (!data || data.length === 0) return;

    let coldCount = 0;
    let warmCount = 0;
    data.forEach(item => {
      if (item.rating === 'too_cold') coldCount++;
      if (item.rating === 'too_warm') warmCount++;
    });

    if (coldCount >= 3) personalTempOffset = -2;
    if (warmCount >= 3) personalTempOffset = 2;
  } catch (e) {
    console.log("Kunne ikke hente feedback offset", e);
  }
}

// 2. Geolocation & Vejr (GPS + Manuel By-søgning)
function getLocationWeather() {
  if (navigator.geolocation) {
    document.getElementById('city-search').value = "Henter din GPS lokation...";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        document.getElementById('city-search').value = "Nuværende GPS Lokation";
        fetchWeather(position);
      }, 
      () => {
        alert("Kunne ikke hente GPS-lokation. Bruger Fredericia som standard.");
        document.getElementById('city-search').value = "Fredericia";
        searchCityWeatherFallback("Fredericia");
      }
    );
  } else {
    alert("Geolokation understøttes ikke.");
  }
}

async function searchCityWeather() {
  const cityName = document.getElementById('city-search').value.trim();
  if (!cityName || cityName.includes("GPS")) {
    alert("Indtast venligst et gyldigt bynavn.");
    return;
  }
  await searchCityWeatherFallback(cityName);
}

async function searchCityWeatherFallback(cityName) {
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=da&format=json`;

  try {
    const res = await fetch(geoUrl);
    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      alert("Kunne ikke finde byen. Prøv igen.");
      return;
    }

    const location = data.results[0];
    const mockPosition = {
      coords: {
        latitude: location.latitude,
        longitude: location.longitude
      }
    };

    document.getElementById('city-search').value = `${location.name} (${location.country || ''})`;
    fetchWeather(mockPosition);

  } catch (e) {
    alert("Fejl ved søgning efter by.");
  }
}

async function fetchWeather(position) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  const hourOffset = parseInt(document.getElementById('forecast-time').value);

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,apparent_temperature,precipitation_probability,wind_speed_10m,uv_index,is_day&daily=sunrise,sunset&timezone=auto`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    
    const nowIndex = new Date().getHours();
    const targetIndex = Math.min(nowIndex + hourOffset, data.hourly.temperature_2m.length - 1);

    let temp = data.hourly.temperature_2m[targetIndex];
    let wind = data.hourly.wind_speed_10m[targetIndex];
    const routeEnv = document.getElementById('route-environment').value;

    if (routeEnv === 'open' && wind > 5) {
      temp -= 1.5; 
    }

    const rainProb = data.hourly.precipitation_probability[targetIndex];
    const uv = data.hourly.uv_index[targetIndex];
    const isDay = data.hourly.is_day[targetIndex];
    const sunsetTime = data.daily.sunset[0] ? new Date(data.daily.sunset[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    currentWeatherData = {
      temp,
      effectiveTemp: temp + personalTempOffset,
      wind,
      rainProb,
      uv,
      isDay
    };

    document.getElementById('weather-temp').innerText = `${Math.round(temp)}°C`;
    document.getElementById('weather-desc').innerText = `Effektiv temp: ${Math.round(currentWeatherData.effectiveTemp)}°C`;
    document.getElementById('weather-sub').innerText = `Vind: ${wind} m/s | Regn: ${rainProb}%`;

    let badgesHtml = '';
    if (rainProb > 30) badgesHtml += `<span class="badge rain">🌧️ Regnrisiko (${rainProb}%)</span>`;
    if (uv >= 3 && isDay === 1) badgesHtml += `<span class="badge uv">☀️ UV Indeks ${uv}</span>`;
    document.getElementById('weather-badges').innerHTML = badgesHtml;

    if (sunsetTime) {
      document.getElementById('sunset-text').innerText = `Solnedgang i dag kl. ${sunsetTime}`;
      document.getElementById('sunset-box').classList.remove('hidden');
    }

    renderSmartTips(isDay, uv, wind, rainProb);
    document.getElementById('weather-info').classList.remove('hidden');

  } catch (e) {
    alert("Fejl ved hentning af vejrdata.");
  }
}

function renderSmartTips(isDay, uv, wind, rainProb) {
  const tipsBox = document.getElementById('smart-tips');
  let tips = [];

  if (isDay === 0) tips.push("🔦 **Husk reflekser & pandelampe!** Turen foregår i mørke.");
  if (uv >= 3 && isDay === 1) tips.push("☀️ **Husk solcreme & solbriller!**");
  if (rainProb > 40) tips.push("🌧️ **Høj regnrisiko!** Vælg vandafvisende yderlag.");

  if (tips.length > 0) {
    tipsBox.innerHTML = tips.join('<br>');
    tipsBox.classList.remove('hidden');
  } else {
    tipsBox.classList.add('hidden');
  }
}

// 3. Garmin / GPX File Handler
async function handleGarminUpload() {
  const fileInput = document.getElementById('garmin-file-input');
  if (fileInput.files.length === 0) {
    alert("Vælg venligst en .gpx eller .fit fil først.");
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = async function(e) {
    const content = e.target.result;
    
    if (file.name.endsWith('.gpx')) {
      parseGpxContent(content);
    } else {
      alert("Garmin .gpx filer indlæses direkte. .fit filer kan eksporteres til GPX i Garmin Connect.");
    }
  };

  reader.readAsText(file);
}

function parseGpxContent(gpxText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(gpxText, "text/xml");
  const trkpts = xmlDoc.getElementsByTagName('trkpt');
  
  const estDistance = (trkpts.length * 0.015).toFixed(2); // Estimat ud fra punkter
  document.getElementById('g-distance').innerText = estDistance;
  document.getElementById('g-time').innerText = "Garmin GPX Rute";
  document.getElementById('garmin-result').classList.remove('hidden');
  
  alert(`Garmin rute indlæst succesfuldt! Estimeret længde: ${estDistance} km.`);
}

// 4. Automatisk Outfit-Matching & SVG Avatar
function generateAutomaticOutfit() {
  if (!currentWeatherData) {
    alert("Hent venligst vejret først!");
    return;
  }

  const sensitivityMod = document.getElementById('sensitivity').value;
  const routeType = document.getElementById('route-type').value;

  let scoreTemp = currentWeatherData.effectiveTemp;
  if (sensitivityMod === 'frysending') scoreTemp -= 3;
  if (sensitivityMod === 'varm') scoreTemp += 3;
  if (routeType === 'tempo') scoreTemp += 3;
  if (routeType === 'rolig') scoreTemp -= 2;

  const cleanWardrobe = wardrobeData.filter(i => !i.in_wash);

  const baseLayer = findBestItem(cleanWardrobe, 'baselayer', scoreTemp);
  const midLayer = (scoreTemp < 10) ? findBestItem(cleanWardrobe, 'midlayer', scoreTemp) : null;
  const outerLayer = (scoreTemp < 5) ? findBestItem(cleanWardrobe, 'outer', scoreTemp) : null;
  const extraLayer = findBestItem(cleanWardrobe, 'accessory', scoreTemp) || { name: 'Standard løbetights' };

  document.getElementById('layer-base').innerText = baseLayer ? `${baseLayer.name} (Varmegrad: ${baseLayer.warmth}/5)` : 'Ingen tilgængelig i skabet';
  document.getElementById('layer-mid').innerText = midLayer ? `${midLayer.name} (Varmegrad: ${midLayer.warmth}/5)` : 'Ikke nødvendigt i dag';
  document.getElementById('layer-outer').innerText = outerLayer ? `${outerLayer.name} (Varmegrad: ${outerLayer.warmth}/5)` : 'Ikke nødvendigt i dag';
  document.getElementById('layer-extra').innerText = `${extraLayer.name}`;

  updateRunnerAvatar(baseLayer, midLayer, outerLayer);
  document.getElementById('outfit-result').classList.remove('hidden');
}

function updateRunnerAvatar(baseLayer, midLayer, outerLayer) {
  const torso = document.getElementById('svg-torso');
  const hat = document.getElementById('svg-hat');
  const container = document.getElementById('runner-avatar-container');
  const statusText = document.getElementById('avatar-status-text');

  container.classList.remove('hidden');

  if (outerLayer) {
    torso.setAttribute('fill', '#1e3a8a');
    statusText.innerText = `Påklædt med jakke (${outerLayer.name}) og lag-på-lag`;
  } else if (midLayer) {
    torso.setAttribute('fill', '#059669');
    statusText.innerText = `Påklædt med mellemlag (${midLayer.name})`;
  } else if (baseLayer) {
    torso.setAttribute('fill', '#2563eb');
    statusText.innerText = `Påklædt i let inderlag (${baseLayer.name})`;
  }

  if (outerLayer || midLayer) {
    hat.classList.remove('hidden');
  } else {
    hat.classList.add('hidden');
  }
}

function findBestItem(items, category, targetTemp) {
  const filtered = items.filter(i => i.category === category);
  if (filtered.length === 0) return null;

  return filtered.reduce((prev, curr) => {
    return Math.abs(curr.warmth - getIdealWarmth(targetTemp)) < Math.abs(prev.warmth - getIdealWarmth(targetTemp)) ? curr : prev;
  });
}

function getIdealWarmth(temp) {
  if (temp < -5) return 5;
  if (temp < 2) return 4;
  if (temp < 8) return 3;
  if (temp < 15) return 2;
  return 1;
}

// 5. Klædeskab & Vaskestatus
async function loadWardrobe() {
  const { data, error } = await supabase.from('wardrobe').select('*');
  if (!error && data) {
    wardrobeData = data;
    renderWardrobe(wardrobeData);
  }
}

function renderWardrobe(items) {
  const list = document.getElementById('wardrobe-list');
  if (items.length === 0) {
    list.innerHTML = `<p class="empty-msg">Dit klædeskab er tomt.</p>`;
    return;
  }

  list.innerHTML = items.map(item => `
    <div class="item-card ${item.in_wash ? 'in-wash' : ''}">
      <div class="item-info">
        <h4>${item.name} ${item.in_wash ? '🧺 (Til vask)' : ''}</h4>
        <p>${item.category} | Varmegrad: ${item.warmth}/5</p>
      </div>
      <div class="item-actions">
        <button class="btn outline small" onclick="toggleWash('${item.id}', ${!item.in_wash})">
          ${item.in_wash ? '🧺 Rent' : '🧼 Til vask'}
        </button>
      </div>
    </div>
  `).join('');
}

async function toggleWash(id, status) {
  await supabase.from('wardrobe').update({ in_wash: status }).eq('id', id);
  await loadWardrobe();
}

function filterWardrobe(filter) {
  if (filter === 'clean') {
    renderWardrobe(wardrobeData.filter(i => !i.in_wash));
  } else if (filter === 'wash') {
    renderWardrobe(wardrobeData.filter(i => i.in_wash));
  } else {
    renderWardrobe(wardrobeData);
  }
}

// 6. Feedback indsendelse
async function sendFeedback() {
  const selectedBtn = document.querySelector('.btn-fb[data-selected="true"]');
  if (!selectedBtn) {
    alert("Vælg venligst en bedømmelse (f.eks. Perfekt).");
    return;
  }

  const rating = selectedBtn.dataset.rating;
  const comment = document.getElementById('fb-comment').value;

  const { error } = await supabase.from('outfit_feedback').insert([{
    rating,
    feels_like_temp: currentWeatherData ? currentWeatherData.effectiveTemp : null,
    comment
  }]);

  const statusEl = document.getElementById('fb-status');
  if (!error) {
    statusEl.innerText = "Tak! Din feedback er gemt og forbedrer næste tur.";
    statusEl.style.color = "var(--secondary)";
  } else {
    statusEl.innerText = "Fejl ved lagring af feedback.";
    statusEl.style.color = "var(--danger)";
  }
}

// 7. Ønskeseddel Generator
function generateWishlist() {
  const suggestions = [];
  const winterBase = wardrobeData.filter(i => i.category === 'baselayer' && i.warmth >= 4);
  if (winterBase.length === 0) {
    suggestions.push({
      title: "🔥 Varm Merino Uld Baselayer",
      reason: "Du mangler et varmt inderlag til de frostklare vinterdage."
    });
  }

  const windJacket = wardrobeData.filter(i => i.category === 'outer');
  if (windJacket.length === 0) {
    suggestions.push({
      title: "🌬️ Vindtæt Løbejakke",
      reason: "Essentielt yderlag mod blæst og kulde i åbent terræn."
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      title: "🧦 Kvalitets Løbestrømper i Uld",
      reason: "Dit klædeskab er rigtig godt dækket ind! Strømper er altid et stærkt juleønske."
    });
  }

  const container = document.getElementById('wishlist-items');
  container.innerHTML = suggestions.map(s => `
    <div class="wishlist-item">
      <h5>${s.title}</h5>
      <p>${s.reason}</p>
    </div>
  `).join('');

  document.getElementById('wishlist-modal').classList.remove('hidden');
}
