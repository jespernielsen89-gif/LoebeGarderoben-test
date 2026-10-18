// === CONFIGURATION ===
const SUPABASE_URL = "https://quxjukgjwvsuismbfaof.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__8-ZIhx5r9eKFwblICJyNQ_Fexy6WA4";

let supabaseClient = null;
if (window.supabase && SUPABASE_URL && !SUPABASE_URL.includes("DIN_PROJECT_URL")) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Global variabel til opbevaring af seneste vejrdata
let currentRawTemp = null;

// === ELEMENTS ===
const btnLocation = document.getElementById('btn-location');
const cameraInput = document.getElementById('camera-input');
const weatherInfo = document.getElementById('weather-info');
const outfitBox = document.getElementById('outfit-recommendation');
const scanStatus = document.getElementById('scan-status');
const wardrobeList = document.getElementById('wardrobe-list');
const userTypeSelect = document.getElementById('user-type');
const routeTypeSelect = document.getElementById('route-type');

// Event listeners til parametre
if (userTypeSelect) userTypeSelect.addEventListener('change', updateMatch);
if (routeTypeSelect) routeTypeSelect.addEventListener('change', updateMatch);

// === AUTOMATISK ANONYM LOGIN ===
async function ensureAuthenticated() {
  if (!supabaseClient) return null;
  
  try {
    let { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      console.log("Ingen eksisterende session. Opretter anonym bruger...");
      const { data, error } = await supabaseClient.auth.signInAnonymously();
      if (error) {
        console.error("Anonym login fejl:", error);
        return null;
      }
      console.log("Anonym bruger oprettet succesfuldt:", data.user?.id);
      return data.user;
    } else {
      console.log("Eksisterende session fundet for bruger:", session.user.id);
      return session.user;
    }
  } catch (err) {
    console.error("Autentificeringsfejl:", err);
    return null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await ensureAuthenticated();
  loadWardrobe();
});

// === 1. HENT KLÆDESKAB FRA SUPABASE ===
async function loadWardrobe() {
  if (!wardrobeList) return;

  if (!supabaseClient) {
    wardrobeList.innerHTML = '<p class="empty-msg">⚠️ Indsæt dine Supabase-nøgler i app.js for at hente dit klædeskab.</p>';
    return;
  }

  wardrobeList.innerHTML = '<p class="empty-msg">Henter tøj fra databasen...</p>';

  try {
    const { data, error } = await supabaseClient
      .from('user_wardrobe')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      wardrobeList.innerHTML = '<p class="empty-msg">Dit klædeskab er tomt. Scan dit første stykke tøj!</p>';
      return;
    }

    wardrobeList.innerHTML = '';
    data.forEach(item => {
      const card = document.createElement('div');
      card.className = 'wardrobe-item';
      const warmth = item.warmth_level ? '🔥'.repeat(item.warmth_level) : '🔥';
      card.innerHTML = `
        <strong>${item.brand || 'Ukendt mærke'}</strong><br>
        <small>${item.sub_category || item.category || 'Tøj'}</small><br>
        <span>Varme: ${warmth}</span>
      `;
      wardrobeList.appendChild(card);
    });
  } catch (err) {
    console.error("Fejl ved hentning af klædeskab:", err);
    wardrobeList.innerHTML = '<p class="empty-msg">❌ Kunne ikke hente tøj. Tjek dine Supabase-nøgler.</p>';
  }
}

// === 2. LOKALT VEJR VIA OPEN-METEO API ===
if (btnLocation) {
  btnLocation.addEventListener('click', () => {
    if (navigator.geolocation) {
      btnLocation.innerText = "Søger placering...";
      navigator.geolocation.getCurrentPosition(fetchWeather, (err) => {
        alert("Kunne ikke hente placering. Tjek at GPS/placering er tilladt i din browser.");
        btnLocation.innerText = "📍 Brug min GPS til vejr";
      });
    } else {
      alert("GPS understøttes ikke af din browser.");
    }
  });
}

async function fetchWeather(position) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,wind_speed_10m&timezone=auto`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const current = data.current;

    currentRawTemp = current.apparent_temperature;

    document.getElementById('temp').innerText = Math.round(current.temperature_2m);
    document.getElementById('feels-like').innerText = Math.round(current.apparent_temperature);
    document.getElementById('wind').innerText = Math.round(current.wind_speed_10m);

    weatherInfo.classList.remove('hidden');
    btnLocation.innerText = "🔄 Opdater vejr";

    updateMatch();
  } catch (err) {
    console.error("Fejl ved hentning af vejr:", err);
    alert("Der opstod en fejl under hentning af vejrdata.");
  }
}

// === 3. DE 3 PARAMETRE: VEJR + PERSON + RUTE ALGORITME ===
function updateMatch() {
  if (currentRawTemp === null) return;

  let effectiveTemp = currentRawTemp;
  const userType = userTypeSelect ? userTypeSelect.value : 'normal';
  const routeType = routeTypeSelect ? routeTypeSelect.value : 'standard';

  // 1. Juster for Persontype
  if (userType === 'cold') {
    effectiveTemp -= 3;
  } else if (userType === 'warm') {
    effectiveTemp += 3;
  }

  // 2. Juster for Rutens Karakter & Intensitet
  let needWindproof = false;
  if (routeType === 'intense') {
    effectiveTemp += 2;
  } else if (routeType === 'windy') {
    needWindproof = true;
    effectiveTemp -= 1;
  } else if (routeType === 'sheltered') {
    effectiveTemp += 1;
  }

  generateOutfitMatch(effectiveTemp, needWindproof);
}

function generateOutfitMatch(adjustedTemp, needWindproof) {
  const outfitList = document.getElementById('outfit-list');
  if (!outfitList) return;
  
  outfitList.innerHTML = '';

  let items = [];
  if (adjustedTemp < 3) {
    items = ["Lange Vintertights", "Langærmet Uldtrøje", "Vindtæt Løbejakke", "Handsker & Hue"];
  } else if (adjustedTemp < 10) {
    items = ["Lange Tights", "Langærmet Løbetrøje", needWindproof ? "Vindvest (Obligatorisk på åben rute)" : "Lethovedet Løbevest/Jakke"];
  } else if (adjustedTemp < 16) {
    items = ["Korte Tights / Shorts", "Langærmet tynd trøje eller T-shirt med ærmevarmere"];
  } else {
    items = ["Shorts", "Kortærmet Singlet / T-shirt"];
  }

  items.forEach(item => {
    const li = document.createElement('li');
    li.innerText = item;
    outfitList.appendChild(li);
  });

  outfitBox.classList.remove('hidden');
}

// === 4. AI CAMERA SCANNER (VIA SUPABASE EDGE FUNCTION: bright-endpoint) ===
if (cameraInput) {
  cameraInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    scanStatus.innerText = "⏳ Analyserer tøj med AI...";

    try {
      // Sikr at vi har en aktiv anonym bruger og hents bruger-ID
      const currentUser = await ensureAuthenticated();
      if (!currentUser) {
        throw new Error("Kunne ikke verificere den anonyme session.");
      }

      const base64Image = await convertToBase64(file);

      // Kalder din sikre Supabase Edge Function
      const response = await fetch(`${SUPABASE_URL}/functions/v1/bright-endpoint`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ imageBase64: base64Image })
      });

      const aiData = await response.json();
      
      if (aiData.error) {
        throw new Error(aiData.error.message || aiData.error);
      }

      let messageContent = aiData.choices && aiData.choices[0] ? aiData.choices[0].message.content : null;
      if (!messageContent) {
        throw new Error("Ugyldigt svar fra AI-tjenesten.");
      }

      const rawContent = messageContent.trim().replace(/```json|```/g, "");
      const parsedItem = JSON.parse(rawContent);

      scanStatus.innerText = `✅ AI fandt: ${parsedItem.brand || 'Tøj'} (${parsedItem.subCategory || 'Løbetøj'}). Gemmer...`;

      if (supabaseClient) {
        // Eksplicit inkludering af user_id
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
        scanStatus.innerText = `🎉 Gemt! ${parsedItem.brand || 'Tøjet'} ligger nu i dit klædeskab.`;
        loadWardrobe();
      }

    } catch (err) {
      console.error("AI Scan fejl:", err);
      scanStatus.innerText = "❌ Fejl under scanning: " + err.message;
    }
  });
}

function convertToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}
