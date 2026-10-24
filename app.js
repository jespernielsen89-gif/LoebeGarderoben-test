// === CONFIGURATION (LøbeGarderoben v4.1) ===
const SUPABASE_URL = "https://quxjukgjwvsuismbfaof.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1eGp1a2dqd3ZzdWlzbWJmYW9mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMDA1ODQsImV4cCI6MjEwNzg3NjU4NH0.4gApKVJAKmsk5OUEOiob9iV0y6T_aU84HJMLcWkoM9M";

// Opret Supabase-klient
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  getLocationWeather();
}

// Toast Notifikationssystem
function showToast(message, duration = 2500) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  
  toast.innerText = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
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

  document.getElementById('camera-input').addEventListener('change', handleImageUpload);
  document.getElementById('gallery-input').addEventListener('change', handleImageUpload);
  document.getElementById('btn-save-new-item').addEventListener('click', saveNewItemToSupabase);

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      filterWardrobe(e.target.dataset.filter);
    });
  });

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
    const { data } = await db
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

// 2. Geolocation & Vejr (Understøtter op til 24t frem)
function getLocationWeather() {
  const cityInput = document.getElementById('city-search');
  if (navigator.geolocation) {
    cityInput.value = "Henter din GPS lokation...";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        if (lat < 0) {
          cityInput.value = "Fredericia";
          fetchWeather(55.5657, 9.7583);
        } else {
          cityInput.value = "Nuværende GPS Lokation";
          fetchWeather(lat, lon);
        }
      }, 
      () => {
        cityInput.value = "Fredericia";
        fetchWeather(55.5657, 9.7583);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  } else {
    cityInput.value = "Fredericia";
    fetchWeather(55.5657, 9.7583);
  }
}

async function searchCityWeather() {
  const cityName = document.getElementById('city-search').value.trim();
  if (!cityName || cityName.includes("GPS")) {
    showToast("Indtast venligst et gyldigt bynavn.");
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
      showToast("Kunne ikke finde byen.");
      return;
    }

    const location = data.results[0];
    document.getElementById('city-search').value = `${location.name} (${location.country || ''})`;
    fetchWeather(location.latitude, location.longitude);
  } catch (e) {
    showToast("Fejl ved søgning efter by.");
  }
}

async function fetchWeather(lat, lon) {
  const hourOffset = parseInt(document.getElementById('forecast-time').value) || 0;
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
    const sunsetTime = (data.daily && data.daily.sunset && data.daily.sunset[0]) 
      ? new Date(data.daily.sunset[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      : '';

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
    showToast("Fejl ved hentning af vejrdata.");
  }
}

function renderSmartTips(isDay, uv, wind, rainProb) {
  const tipsBox = document.getElementById('smart-tips');
  let tips = [];

  if (isDay === 0) tips.push("🔦 **Husk reflekser & pandelampe!** Turen foregår i mørke.");
  if (uv >= 3 && isDay === 1) tips.push("☀️ **Husk solcreme & solbriller!**");
  if (rainProb > 30) tips.push("🌧️ **Regn i farvandet!** Sørg for vandafvisende yderlag.");

  if (tips.length > 0) {
    tipsBox.innerHTML = tips.join('<br>');
    tipsBox.classList.remove('hidden');
  } else {
    tipsBox.classList.add('hidden');
  }
}

// 3. Garmin / GPX Integration
function handleGarminUpload() {
  const fileInput = document.getElementById('garmin-file-input');
  if (!fileInput || fileInput.files.length === 0) {
    showToast("Vælg venligst en .gpx fil først.");
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = function(e) {
    const content = e.target.result;
    if (file.name.toLowerCase().endsWith('.gpx')) {
      parseGpxContent(content, file.name);
    } else {
      showToast("Upload venligst en .gpx fil.");
    }
  };
  reader.readAsText(file);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseGpxContent(gpxText, fileName) {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxText, "text/xml");
    
    let trackPoints = xmlDoc.getElementsByTagNameNS('*', 'trkpt');
    if (trackPoints.length === 0) trackPoints = xmlDoc.getElementsByTagName('trkpt');

    if (trackPoints.length === 0) {
      showToast("Ingen punkter fundet i GPX-filen.");
      return;
    }

    let totalDistanceKm = 0;
    let totalElevationGain = 0;
    let coords = [];
    let times = [];
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;

    for (let i = 0; i < trackPoints.length; i++) {
      const lat = parseFloat(trackPoints[i].getAttribute('lat'));
      const lon = parseFloat(trackPoints[i].getAttribute('lon'));
      
      if (isNaN(lat) || isNaN(lon)) continue;

      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;

      coords.push({ lat, lon });

      let eleNode = trackPoints[i].getElementsByTagNameNS('*', 'ele')[0] || trackPoints[i].getElementsByTagName('ele')[0];
      if (eleNode && i > 0) {
        let prevEleNode = trackPoints[i-1].getElementsByTagNameNS('*', 'ele')[0] || trackPoints[i-1].getElementsByTagName('ele')[0];
        if (prevEleNode) {
          const diff = parseFloat(eleNode.textContent) - parseFloat(prevEleNode.textContent);
          if (!isNaN(diff) && diff > 0) totalElevationGain += diff;
        }
      }

      let timeNode = trackPoints[i].getElementsByTagNameNS('*', 'time')[0] || trackPoints[i].getElementsByTagName('time')[0];
      if (timeNode && timeNode.textContent) {
        const timeVal = new Date(timeNode.textContent).getTime();
        if (!isNaN(timeVal)) times.push(timeVal);
      }

      if (i > 0) {
        totalDistanceKm += calculateDistance(coords[i-1].lat, coords[i-1].lon, lat, lon);
      }
    }

    const isCoastalRute = coords.some(pt => pt.lon > 9.7550 || pt.lat > 55.5800);
    const envSelect = document.getElementById('route-environment');
    envSelect.value = isCoastalRute ? 'open' : 'sheltered';

    const routeTypeSelect = document.getElementById('route-type');
    let paceMinPerKm = null;

    if (times.length >= 2 && totalDistanceKm > 0) {
      const totalSeconds = (times[times.length - 1] - times[0]) / 1000;
      const totalMinutes = totalSeconds / 60;
      paceMinPerKm = totalMinutes / totalDistanceKm;

      if (!isNaN(paceMinPerKm) && paceMinPerKm > 0 && paceMinPerKm < 20) {
        if (paceMinPerKm < 4.5) {
          routeTypeSelect.value = 'tempo';
        } else if (paceMinPerKm > 5.75) {
          routeTypeSelect.value = 'rolig';
        } else {
          routeTypeSelect.value = 'almindelig';
        }
      }
    }

    renderRouteSvg(coords, minLat, maxLat, minLon, maxLon);

    document.getElementById('g-distance').innerText = totalDistanceKm.toFixed(2);
    document.getElementById('g-time').innerText = `${fileName} (+${Math.round(totalElevationGain)}m stigning)`;
    document.getElementById('garmin-result').classList.remove('hidden');

    if (coords.length > 0) {
      document.getElementById('city-search').value = `Rute start (${totalDistanceKm.toFixed(1)} km)`;
      fetchWeather(coords[0].lat, coords[0].lon);
    }

    showToast(`📍 GPX Indlæst: ${totalDistanceKm.toFixed(2)} km`);

  } catch (err) {
    console.error(err);
    showToast("Fejl ved læsning af GPX-fil.");
  }
}

function renderRouteSvg(coords, minLat, maxLat, minLon, maxLon) {
  const svgPath = document.getElementById('route-path');
  const summaryText = document.getElementById('route-summary-text');
  const mapContainer = document.getElementById('route-map-container');

  if (!svgPath || coords.length === 0) return;

  const width = 300;
  const height = 150;
  const padding = 20;

  const latRange = maxLat - minLat || 0.0001;
  const lonRange = maxLon - minLon || 0.0001;

  let pathString = "";
  coords.forEach((pt, index) => {
    const x = padding + ((pt.lon - minLon) / lonRange) * (width - 2 * padding);
    const y = height - (padding + ((pt.lat - minLat) / latRange) * (height - 2 * padding));

    if (index === 0) {
      pathString += `M ${x} ${y} `;
    } else {
      pathString += `L ${x} ${y} `;
    }
  });

  svgPath.setAttribute('d', pathString);
  if (summaryText) summaryText.innerText = `Viser rute med ${coords.length} punkter`;
  if (mapContainer) mapContainer.classList.remove('hidden');
}

// Hjælpefunktion: Identificer tilbehør
function isAccessory(item) {
  const text = `${item.category || ''} ${item.sub_category || ''}`.toLowerCase();
  return item.category === 'tilbehoer' || 
         text.includes('halsedisse') || 
         text.includes('buff') || 
         text.includes('hue') || 
         text.includes('handsker') || 
         text.includes('vanter') || 
         text.includes('pandelampe');
}

function getIdealWarmth(temp) {
  if (temp < -5) return 5;
  if (temp < 2) return 4;
  if (temp < 8) return 3;   
  if (temp < 15) return 2;  
  return 1;                 
}

// 4. Automatisk Outfit-Matching
function generateAutomaticOutfit() {
  if (!currentWeatherData) {
    showToast("Hent venligst vejret først!");
    return;
  }

  if (!wardrobeData || wardrobeData.length === 0) {
    showToast("Henter klædeskab...");
    loadWardrobe();
    return;
  }

  const sensitivityMod = document.getElementById('sensitivity').value;
  const routeType = document.getElementById('route-type').value;

  let scoreTemp = currentWeatherData.effectiveTemp;

  if (sensitivityMod === 'frysende') scoreTemp -= 3;
  if (sensitivityMod === 'varm') scoreTemp += 3;
  if (routeType === 'tempo') scoreTemp += 3;
  if (routeType === 'rolig') scoreTemp -= 2;

  const cleanWardrobe = wardrobeData.filter(i => !i.in_wash);
  const isRaining = currentWeatherData.rainProb > 30;

  let outerLayer = null;
  if (isRaining || scoreTemp < 5) {
    const outerCandidateItems = cleanWardrobe.filter(i => (i.category === 'overdel' || i.category === 'yderlag') && !isAccessory(i));
    const searchKeywords = isRaining ? ['jakke', 'regn', 'skaljakke', 'wind', 'outer', 'vest'] : ['outer', 'jakke', 'wind', 'vest'];
    outerLayer = findBestItemAny(outerCandidateItems, searchKeywords, scoreTemp);
  }

  let baseScoreTemp = scoreTemp;
  if (outerLayer) {
    baseScoreTemp += 2.5; 
  }

  const baseCandidateItems = cleanWardrobe.filter(i => i.category === 'overdel' && !isAccessory(i));
  const baseLayer = findBestItemAny(baseCandidateItems, ['base', 'inder', 'trøje', 'langærmet', 't-shirt', 'kortærmet'], baseScoreTemp);

  const midCandidateItems = cleanWardrobe.filter(i => i.category === 'overdel' && !isAccessory(i));
  const midLayer = (scoreTemp < 8 && !outerLayer) ? findBestItemAny(midCandidateItems, ['mid', 'mellem', 'fleece', 'trøje'], scoreTemp) : null;

  const legCandidateItems = cleanWardrobe.filter(i => i.category === 'underdel' && !isAccessory(i));
  const legLayer = findBestItemAny(legCandidateItems, ['tights', 'bukser', 'shorts'], scoreTemp) || { sub_category: 'Standard løbetights', warmth_level: 3 };

  let selectedAccessories = [];
  if (scoreTemp < 10) {
    const accessories = cleanWardrobe.filter(i => isAccessory(i));
    if (accessories.length > 0) {
      const bestAcc = findBestItemAny(accessories, ['halsedisse', 'buff', 'hue', 'handsker'], scoreTemp);
      if (bestAcc) {
        selectedAccessories.push(`${bestAcc.brand || ''} ${bestAcc.sub_category}`);
      }
    }
  }

  let outerText = 'Ikke nødvendigt i dag';
  if (outerLayer) {
    outerText = `${outerLayer.brand || ''} ${outerLayer.sub_category} (Varmegrad: ${outerLayer.warmth_level}/5)${isRaining ? ' 🌧️ (Regnbeskyttelse)' : ''}`;
  } else if (isRaining) {
    outerText = '🌧️ Regnvejr: Tilføj en regnjakke til dit klædeskab!';
  }

  document.getElementById('layer-base').innerText = baseLayer ? `${baseLayer.brand || ''} ${baseLayer.sub_category} (Varmegrad: ${baseLayer.warmth_level}/5)` : 'Ingen fundet i skabet';
  document.getElementById('layer-mid').innerText = midLayer ? `${midLayer.brand || ''} ${midLayer.sub_category} (Varmegrad: ${midLayer.warmth_level}/5)` : 'Ikke nødvendigt i dag';
  document.getElementById('layer-outer').innerText = outerText;
  
  if (document.getElementById('layer-legs')) {
    document.getElementById('layer-legs').innerText = `${legLayer.brand || ''} ${legLayer.sub_category} (Varmegrad: ${legLayer.warmth_level || 3}/5)`;
  }
  if (document.getElementById('layer-accessories')) {
    document.getElementById('layer-accessories').innerText = selectedAccessories.length > 0 ? selectedAccessories.join(', ') : 'Ikke nødvendigt i dag';
  }

  updateRunnerAvatar(baseLayer, midLayer, outerLayer);
  
  const outfitBox = document.getElementById('outfit-result');
  outfitBox.classList.remove('hidden');
  outfitBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function findBestItemAny(items, keywords, targetTemp) {
  let filtered = items.filter(i => {
    const text = `${i.category || ''} ${i.sub_category || ''} ${i.brand || ''}`.toLowerCase();
    return keywords.some(kw => text.includes(kw));
  });

  if (filtered.length === 0) filtered = items;
  if (filtered.length === 0) return null;

  const idealWarmth = getIdealWarmth(targetTemp);

  return filtered.reduce((prev, curr) => {
    return Math.abs((curr.warmth_level || 3) - idealWarmth) < Math.abs((prev.warmth_level || 3) - idealWarmth) ? curr : prev;
  });
}

function updateRunnerAvatar(baseLayer, midLayer, outerLayer) {
  const torso = document.getElementById('svg-torso');
  const hat = document.getElementById('svg-hat');
  const container = document.getElementById('runner-avatar-container');
  const statusText = document.getElementById('avatar-status-text');

  container.classList.remove('hidden');

  if (outerLayer) {
    torso.setAttribute('fill', '#1e3a8a');
    statusText.innerText = `Påklædt med jakke (${outerLayer.sub_category})`;
  } else if (midLayer) {
    torso.setAttribute('fill', '#059669');
    statusText.innerText = `Påklædt med mellemlag (${midLayer.sub_category})`;
  } else if (baseLayer) {
    torso.setAttribute('fill', '#2563eb');
    statusText.innerText = `Påklædt i let inderlag (${baseLayer.sub_category})`;
  }

  if (outerLayer || midLayer) {
    hat.classList.remove('hidden');
  } else {
    hat.classList.add('hidden');
  }
}

// 5. Klædeskab
async function loadWardrobe() {
  const { data, error } = await db.from('user_wardrobe').select('*');
  if (!error && data) {
    wardrobeData = data;
    renderWardrobe(wardrobeData);
  } else {
    console.error("Fejl ved hentning af tøj:", error);
  }
}

function renderWardrobe(items) {
  const list = document.getElementById('wardrobe-list');
  if (!list) return;

  if (items.length === 0) {
    list.innerHTML = `<p class="empty-msg">Dit klædeskab er tomt eller kunne ikke hentes.</p>`;
    return;
  }

  list.innerHTML = items.map(item => `
    <div class="item-card ${item.in_wash ? 'in-wash' : ''}">
      <div class="item-info">
        <h4>${item.brand || ''} ${item.sub_category || 'Løbetøj'} ${item.in_wash ? '🧺 (Til vask)' : ''}</h4>
        <p>Kategori: ${item.category || 'Tøj'} | Varmegrad: ${item.warmth_level || 3}/5</p>
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
  await db.from('user_wardrobe').update({ in_wash: status }).eq('id', id);
  await loadWardrobe();
  showToast(status ? "🧺 Markeret som til vask" : "✅ Markeret som rent");
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

// 5b. Foto & Billede Upload via Supabase Edge Function
async function handleImageUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const previewImg = document.getElementById('image-preview');
  const reader = new FileReader();

  reader.onload = async function(e) {
    previewImg.src = e.target.result;
    document.getElementById('image-upload-preview-container').classList.remove('hidden');
    
    showToast("🤖 AI analyserer tøjet...");

    try {
      const base64Data = e.target.result.split(',')[1];
      const mimeType = file.type || 'image/jpeg';

      const aiResult = await analyzeImageWithEdgeFunction(base64Data, mimeType);

      if (aiResult) {
        if (aiResult.brand) document.getElementById('new-item-brand').value = aiResult.brand;
        if (aiResult.category) document.getElementById('new-item-category').value = aiResult.category;
        if (aiResult.sub_category) document.getElementById('new-item-sub-category').value = aiResult.sub_category;
        if (aiResult.warmth_level) document.getElementById('new-item-warmth').value = aiResult.warmth_level;

        showToast("✨ AI har udfyldt felterne!");
      } else {
        showToast("⚠️ AI kunne ikke tyde tøjet helt.");
      }
    } catch (err) {
      console.error("AI-analyse fejl:", err);
      showToast("⚠️ AI-analyse mislykkedes.");
    }
  };

  reader.readAsDataURL(file);
}

// Kald Supabase Edge Function
async function analyzeImageWithEdgeFunction(base64Image, mimeType) {
  const functionUrl = `${SUPABASE_URL}/functions/v1/analyze-clothing`;

  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({
      base64Image: base64Image,
      mimeType: mimeType
    })
  });

  if (!response.ok) {
    throw new Error(`Edge Function HTTP fejl! Status: ${response.status}`);
  }

  return await response.json();
}

async function saveNewItemToSupabase() {
  const brand = document.getElementById('new-item-brand').value.trim() || 'Ukendt brand';
  const category = document.getElementById('new-item-category').value;
  const subCategory = document.getElementById('new-item-sub-category').value.trim() || 'Løbetøj';
  const warmthLevel = parseInt(document.getElementById('new-item-warmth').value) || 3;

  showToast("Gemmer i Supabase...");

  try {
    const { data, error } = await db
      .from('user_wardrobe')
      .insert([
        {
          brand: brand,
          category: category,
          sub_category: subCategory,
          warmth_level: warmthLevel,
          in_wash: false
        }
      ]);

    if (error) {
      console.error("Fejl ved gem af tøj:", error);
      showToast("❌ Fejl: Kunne ikke gemme.");
    } else {
      showToast("✅ Tøj gemt i klædeskabet!");

      setTimeout(() => {
        document.getElementById('image-upload-preview-container').classList.add('hidden');
        document.getElementById('camera-input').value = '';
        document.getElementById('gallery-input').value = '';
      }, 1000);

      await loadWardrobe();
    }
  } catch (e) {
    console.error("Exception:", e);
    showToast("❌ Systemfejl ved gem.");
  }
}

// 6. Feedback Indsendelse
async function sendFeedback() {
  const selectedBtn = document.querySelector('.btn-fb[data-selected="true"]');
  if (!selectedBtn) {
    showToast("Vælg venligst en bedømmelse.");
    return;
  }

  const rating = selectedBtn.dataset.rating;
  const comment = document.getElementById('fb-comment').value;

  const { error } = await db.from('outfit_feedback').insert([{
    rating,
    feels_like_temp: currentWeatherData ? currentWeatherData.effectiveTemp : null,
    comment
  }]);

  if (!error) {
    showToast("Tak! Din feedback er gemt. 🎯");
  } else {
    showToast("Fejl ved gem af feedback.");
  }
}

// 7. Ønskeseddel
function generateWishlist() {
  const suggestions = [
    { title: "🔥 Varm Merino Uld Baselayer", reason: "Godt supplement til de koldeste måneder." },
    { title: "🌬️ Vindtæt Løbejakke", reason: "Essentielt mod vind og kølig kystluft." }
  ];

  const container = document.getElementById('wishlist-items');
  if (container) {
    container.innerHTML = suggestions.map(s => `
      <div class="wishlist-item">
        <h5>${s.title}</h5>
        <p>${s.reason}</p>
      </div>
    `).join('');
  }

  const modal = document.getElementById('wishlist-modal');
  if (modal) modal.classList.remove('hidden');
}
