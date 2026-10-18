// === CONFIGURATION ===
const SUPABASE_URL = "https://quxjukgjwvsuismbfaof.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__8-ZIhx5r9eKFwblICJyNQ_Fexy6WA4";

let supabaseClient = null;
if (window.supabase && SUPABASE_URL && !SUPABASE_URL.includes("DIN_PROJECT_URL")) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Globale variabler
let currentRawTemp = null;
let currentWindSpeed = 0;
let currentRain = 0;
let userWardrobeItems = [];
let lastInsertedFeedbackId = null;

// DOM Elements
const btnLocation = document.getElementById('btn-location');
const cameraInput = document.getElementById('camera-input');
const weatherInfo = document.getElementById('weather-info');
const outfitBox = document.getElementById('outfit-recommendation');
const scanStatus = document.getElementById('scan-status');
const wardrobeList = document.getElementById('wardrobe-list');
const userTypeSelect = document.getElementById('user-type');
const routeTypeSelect = document.getElementById('route-type');

if (userTypeSelect) userTypeSelect.addEventListener('change', updateMatch);
if (routeTypeSelect) routeTypeSelect.addEventListener('change', updateMatch);

// === AUTHENTICATION ===
async function ensureAuthenticated() {
  if (!supabaseClient) return null;
  try {
    let { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      const { data, error } = await supabaseClient.auth.signInAnonymously();
      if (error) {
        console.error("Anonym login fejl:", error);
        return null;
      }
      return data.user;
    }
    return session.user;
  } catch (err) {
    console.error("Auth-fejl:", err);
    return null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await ensureAuthenticated();
  loadWardrobe();
});

// === 1. HENT KLÆDESKAB MED DELETE OPTION ===
async function loadWardrobe() {
  if (!wardrobeList || !supabaseClient) return;

  wardrobeList.innerHTML = '<p class="empty-msg">Henter tøj fra dit digitale klædeskab...</p>';

  try {
    const { data, error } = await supabaseClient
      .from('user_wardrobe')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    userWardrobeItems = data || [];

    if (userWardrobeItems.length === 0) {
      wardrobeList.innerHTML = '<p class="empty-msg">Dit klædeskab er tomt. Scan dit første stykke tøj ovenfor! 📸</p>';
      if (currentRawTemp !== null) updateMatch();
      return;
    }

    wardrobeList.innerHTML = '';
    userWardrobeItems.forEach(item => {
      const card = document.createElement('div');
      card.className = 'wardrobe-card';
      
      const warmthStars = '🔥'.repeat(item.warmth_level || 1);
      const windBadge = item.windproof ? '<span class="tag tag-blue">💨 Vindtæt</span>' : '';
      const rainBadge = item.waterproof || (item.sub_category && item.sub_category.toLowerCase().includes('regn')) ? '<span class="tag tag-blue">🌧️ Vandafvisende</span>' : '';

      card.innerHTML = `
        <div class="wardrobe-card-header">
          <strong>${item.brand || 'Ukendt mærke'}</strong>
          <button class="btn-delete" onclick="deleteWardrobeItem('${item.id}')">🗑️</button>
        </div>
        <p class="category-title">${item.sub_category || item.category || 'Tøj'}</p>
        <div class="tags-row">
          <span class="tag tag-orange">${warmthStars}</span>
          ${windBadge}
          ${rainBadge}
        </div>
      `;
      wardrobeList.appendChild(card);
    });

    if (currentRawTemp !== null) updateMatch();

  } catch (err) {
    console.error("Fejl ved hentning af klædeskab:", err);
    wardrobeList.innerHTML = '<p class="empty-msg">❌ Kunne ikke hente klædeskab.</p>';
  }
}

async function deleteWardrobeItem(id) {
  if (!confirm("Vil du slette dette stykke tøj fra dit klædeskab?")) return;
  try {
    const { error } = await supabaseClient.from('user_wardrobe').delete().eq('id', id);
    if (error) throw error;
    loadWardrobe();
  } catch (err) {
    alert("Kunne ikke slette genstanden.");
  }
}

// === 2. AVANCERET VEJR-HENTNING ===
if (btnLocation) {
  btnLocation.addEventListener('click', () => {
    if (navigator.geolocation) {
      btnLocation.innerText = "⏳ Henter GPS og vejrdata...";
      navigator.geolocation.getCurrentPosition(fetchWeather, (err) => {
        alert("Kunne ikke hente din placering.");
        btnLocation.innerText = "📍 Hent lokalt vejr via GPS";
      });
    } else {
      alert("GPS understøttes ikke i denne browser.");
    }
  });
}

async function fetchWeather(position) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,wind_speed_10m,rain&timezone=auto`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const current = data.current;

    currentRawTemp = current.apparent_temperature;
    currentWindSpeed = current.wind_speed_10m;
    currentRain = current.rain || 0;

    const tempEl = document.getElementById('temp');
    const feelsEl = document.getElementById('feels-like');
    const windEl = document.getElementById('wind');
    const rainEl = document.getElementById('rain');

    if (tempEl) tempEl.innerText = Math.round(current.temperature_2m);
    if (feelsEl) feelsEl.innerText = Math.round(current.apparent_temperature);
    if (windEl) windEl.innerText = Math.round(currentWindSpeed);
    if (rainEl) rainEl.innerText = currentRain;

    if (weatherInfo) weatherInfo.classList.remove('hidden');
    btnLocation.innerText = "🔄 Opdater vejr";

    updateMatch();
  } catch (err) {
    console.error("Vejrfejl:", err);
    alert("Kunne ikke hente vejrdata.");
  }
}

// === 3. INTELLIGENT LAG-PÅ-LAG ALGORITME MED UNIQUES (Undgår dubletter) ===
function updateMatch() {
  if (currentRawTemp === null) return;

  let effectiveTemp = currentRawTemp;
  const userType = userTypeSelect ? userTypeSelect.value : 'normal';
  const routeType = routeTypeSelect ? routeTypeSelect.value : 'standard';

  if (userType === 'cold') effectiveTemp -= 3;
  else if (userType === 'warm') effectiveTemp += 3;

  let needWindproof = currentWindSpeed > 7.0 || routeType === 'windy';
  let needRainproof = currentRain > 0.1;

  if (routeType === 'intense') effectiveTemp += 2;
  else if (routeType === 'sheltered') effectiveTemp += 1;

  generateOutfitMatch(effectiveTemp, needWindproof, needRainproof);
}

function generateOutfitMatch(adjustedTemp, needWindproof, needRainproof) {
  const outfitList = document.getElementById('outfit-list');
  if (!outfitList) return;
  outfitList.innerHTML = '';

  let targetWarmth = 3;
  if (adjustedTemp < 0) targetWarmth = 5;
  else if (adjustedTemp < 6) targetWarmth = 4;
  else if (adjustedTemp < 12) targetWarmth = 3;
  else if (adjustedTemp < 18) targetWarmth = 2;
  else targetWarmth = 1;

  // Hold styr på hvilke tøj-ID'er der allerede er brugt i outfit'et
  let usedItemIds = new Set();

  const layers = [];
  layers.push({ layerName: 'Inderlag (Baselayer)', category: 'overdel', warmth: Math.min(targetWarmth, 3) });

  if (adjustedTemp < 6) {
    layers.push({ layerName: 'Mellemlag (Isolerende)', category: 'overdel', warmth: 4 });
  }

  if (needWindproof || needRainproof || adjustedTemp < 10) {
    layers.push({ layerName: 'Yderlag (Beskyttelse)', category: 'overdel', needWind: needWindproof, needRain: needRainproof });
  }

  layers.push({ layerName: 'Ben / Underdel', category: 'underdel', warmth: targetWarmth });

  if (adjustedTemp < 8) {
    layers.push({ layerName: 'Tilbehør', category: 'tilbehør', warmth: targetWarmth });
  }

  layers.forEach(layer => {
    // Sender usedItemIds med ind, så vi ikke genbruger det samme stykke tøj
    const matchedItem = findBestMatch(layer.category, layer.warmth || targetWarmth, layer.needWind, layer.needRain, usedItemIds);
    
    if (matchedItem) {
      usedItemIds.add(matchedItem.id); // Lås stykke tøj så det ikke bruges igen
    }

    const card = document.createElement('div');
    card.className = 'outfit-card';

    if (matchedItem) {
      card.innerHTML = `
        <div class="outfit-card-header">
          <span class="layer-badge">${layer.layerName}</span>
          <span class="match-badge">⭐ Dit tøj</span>
        </div>
        <h4>${matchedItem.brand} - ${matchedItem.sub_category || matchedItem.category}</h4>
        <div class="tags-row">
          <span class="tag tag-orange">🔥 Varme ${matchedItem.warmth_level}/5</span>
          ${matchedItem.windproof ? '<span class="tag tag-blue">💨 Vindtæt</span>' : ''}
        </div>
      `;
    } else {
      card.innerHTML = `
        <div class="outfit-card-header">
          <span class="layer-badge">${layer.layerName}</span>
          <span class="match-badge fallback">💡 Forslag</span>
        </div>
        <h4>${getGenericFallback(layer.layerName, targetWarmth, needWindproof, needRainproof)}</h4>
      `;
    }

    outfitList.appendChild(card);
  });

  outfitBox.classList.remove('hidden');
}

function findBestMatch(category, targetWarmth, needWind, needRain, usedItemIds) {
  if (!userWardrobeItems || userWardrobeItems.length === 0) return null;

  let candidates = userWardrobeItems.filter(item => 
    item.category && item.category.toLowerCase().includes(category) && !usedItemIds.has(item.id)
  );

  if (candidates.length === 0) return null;

  if (needWind) {
    const windCandidates = candidates.filter(i => i.windproof);
    if (windCandidates.length > 0) candidates = windCandidates;
  }

  candidates.sort((a, b) => {
    const diffA = Math.abs((a.warmth_level || 3) - targetWarmth);
    const diffB = Math.abs((b.warmth_level || 3) - targetWarmth);
    return diffA - diffB;
  });

  return candidates[0];
}

function getGenericFallback(layerName, warmth, wind, rain) {
  if (rain) return "Vandtæt løbejakke / Regnjakke";
  if (wind && layerName.includes('Yderlag')) return "Vindtæt løbejakke / Vindvest";
  if (layerName.includes('Baselayer')) {
    return warmth >= 3 ? "Langærmet svedtransporterende undertrøje" : "Kortærmet T-shirt / Løbesinglet";
  }
  if (layerName.includes('Mellemlag')) return "Løbetrøje med fleece eller zip-neck";
  if (layerName.includes('Underdel')) return warmth >= 4 ? "Vintertights med vindfront" : (warmth >= 3 ? "Lange Løbetights" : "Korte Tights / Shorts");
  return "Løbehandsker / Pandebånd";
}

// === 4. AI CAMERA SCANNER MED BILLED-KOMPRIMERING (IPHONE FIX) ===
if (cameraInput) {
  cameraInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    scanStatus.innerText = "⏳ Behandler og komprimerer billede...";

    try {
      const currentUser = await ensureAuthenticated();
      if (!currentUser) throw new Error("Kunne ikke godkende bruger til scanning.");

      // Komprimerer og konverterer billedet, så det ikke fejler på store iPhone-filer
      const base64Image = await resizeAndConvertImage(file);

      scanStatus.innerText = "⏳ AI scanner tøjet...";

      const response = await fetch(`${SUPABASE_URL}/functions/v1/bright-endpoint`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ imageBase64: base64Image })
      });

      const aiData = await response.json();
      if (aiData.error) throw new Error(aiData.error.message || aiData.error);

      let messageContent = aiData.choices && aiData.choices[0] ? aiData.choices[0].message.content : null;
      if (!messageContent) throw new Error("Intet svar fra AI.");

      const rawContent = messageContent.trim().replace(/```json|```/g, "");
      const parsedItem = JSON.parse(rawContent);

      scanStatus.innerText = `✅ Gemmer ${parsedItem.brand || 'tøj'} i klædeskabet...`;

      if (supabaseClient) {
        const { error } = await supabaseClient.from('user_wardrobe').insert([{
          user_id: currentUser.id,
          brand: parsedItem.brand || "Ukendt",
          category: parsedItem.category || "overdel",
          sub_category: parsedItem.subCategory || "Løbetøj",
          warmth_level: parsedItem.warmthLevel || 3,
          windproof: parsedItem.windproof || false,
          visibility_reflective: parsedItem.visibilityReflective || false
        }]);

        if (error) throw error;
        scanStatus.innerText = `🎉 Tilføjet: ${parsedItem.brand || 'Tøjet'} ligger nu i klædeskabet!`;
        loadWardrobe();
      }

    } catch (err) {
      console.error("Scan fejl:", err);
      scanStatus.innerText = "❌ Fejl: " + err.message;
    }
  });
}

// Hjælpefunktion der skalerer store mobilbilleder ned før upload
function resizeAndConvertImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1000;
        const MAX_HEIGHT = 1000;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Returnerer komprimeret JPEG i base64
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
}

// === 5. QUICK FEEDBACK MED SIKRET USER_ID ===
document.querySelectorAll('.btn-fb').forEach(button => {
  button.addEventListener('click', async (e) => {
    const rating = e.target.getAttribute('data-rating');
    const statusEl = document.getElementById('fb-status');
    const extraBox = document.getElementById('feedback-extra');

    statusEl.innerText = "⏳ Gemmer din vurdering...";

    try {
      const currentUser = await ensureAuthenticated();
      const userType = userTypeSelect ? userTypeSelect.value : 'normal';
      const routeType = routeTypeSelect ? routeTypeSelect.value : 'standard';

      const insertData = {
        rating: rating,
        feels_like_temp: currentRawTemp,
        user_type: userType,
        route_type: routeType
      };

      if (currentUser) {
        insertData.user_id = currentUser.id;
      }

      const { data, error } = await supabaseClient
        .from('outfit_feedback')
        .insert([insertData])
        .select();

      if (error) throw error;
      if (data && data[0]) lastInsertedFeedbackId = data[0].id;

      statusEl.innerText = "🎉 Mange tak for din feedback!";
      if (extraBox) extraBox.classList.remove('hidden');

    } catch (err) {
      console.error("Feedback-fejl:", err);
      statusEl.innerText = "❌ Kunne ikke gemme feedback (tjek RLS politikker).";
    }
  });
});

const btnSendComment = document.getElementById('btn-send-comment');
if (btnSendComment) {
  btnSendComment.addEventListener('click', async () => {
    const commentInput = document.getElementById('fb-comment');
    const statusEl = document.getElementById('fb-status');
    const commentText = commentInput.value.trim();

    if (!commentText || !lastInsertedFeedbackId) return;

    try {
      const { error } = await supabaseClient
        .from('outfit_feedback')
        .update({ comment: commentText })
        .eq('id', lastInsertedFeedbackId);

      if (error) throw error;
      statusEl.innerText = "🎉 Notat gemt!";
      commentInput.value = "";
    } catch (err) {
      console.error("Notat-fejl:", err);
    }
  });
}
