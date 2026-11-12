mapboxgl.accessToken = 'YOUR_MAPBOX_ACCESS_TOKEN';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/pubta/cm1xcjw1000u801r7gqhbfhoi',
  center: [120.981053, 14.657581],
  zoom: 12
});


// === ROUTE LOADING ===
async function loadRoute(routeId) {
  try {
    const res = await fetch(`http://localhost:8000/api/routes/${routeId}`);
    if (!res.ok) throw new Error("Route not found");

    const route = await res.json(); // ✅ only once
    console.log("Loaded route:", route);

    renderRoute(route);
  } catch (err) {
    console.error("Error loading route:", err);
    alert("Failed to load route data.");
  }
}


// === RENDER ROUTE ON MAP ===
let endMarker = null; // global marker variable (makes it easier to remove)
let activePopup = null; // global popup variable

function renderRoute(routeData) {
  clearExistingRoutes();

  // Draw each route segment
  routeData.segments.forEach((seg, i) => {
    const src = `segment-${i}`;
    map.addSource(src, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: seg.coordinates },
          properties: { description: seg.description }
        }]
      }
    });

    // Add black outline layer first (drawn underneath)
    map.addLayer({
      id: `${src}-outline`,
      type: 'line',
      source: src,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#000000',
        'line-width': 9, // slightly wider than the main line
        'line-opacity': 0.9
      }
    });

    // Add main colored route line
    map.addLayer({
      id: src,
      type: 'line',
      source: src,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': seg.color,
        'line-width': 6,
        'line-opacity': 0.9
      }
    });

    map.on('click', src, e => {
      if (activePopup) activePopup.remove(); // close previous popup
      activePopup = new mapboxgl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`<div>${e.features[0].properties.description}</div>`)
        .addTo(map);
    });

  });

  // Get the final coordinate (end of the last segment)
  const allCoords = routeData.segments.flatMap(s => s.coordinates);
  const endCoord = allCoords[allCoords.length - 1];

  // Add the end marker (black pin)
  if (endMarker) endMarker.remove(); // remove old marker if any
  endMarker = new mapboxgl.Marker({ color: 'black', rotation: 45 })
    .setLngLat(endCoord)
    .addTo(map);

  // Zoom to fit the full route
  const bounds = new mapboxgl.LngLatBounds();
  allCoords.forEach(c => bounds.extend(c));
  map.fitBounds(bounds, { padding: 50, duration: 1000 });

  // Show instructions
  showInstructions(routeData.instructions);

  // UI updates
  document.getElementById('exitroute').style.display = 'flex';
  document.getElementById('gobutt').style.display = 'none';
}


// === CLEAR OLD ROUTES ===
function clearExistingRoutes() {
  if (!map || !map.getStyle()) return;

  const style = map.getStyle();

  // Remove route layers
  if (style.layers) {
    style.layers.forEach(layer => {
      if (layer.id.startsWith('segment-')) {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      }
    });
  }

  // Remove route sources
  if (style.sources) {
    Object.keys(style.sources).forEach(src => {
      if (src.startsWith('segment-') && map.getSource(src)) {
        map.removeSource(src);
      }
    });
  }

  // Remove end marker if it exists
  if (endMarker) {
    endMarker.remove();
    endMarker = null;
  }
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }


}



// === INSTRUCTIONS BOX ===
function showInstructions(steps) {
  const old = document.getElementById('instruction-container');
  if (old) old.remove();

  const box = document.createElement('div');
  box.id = 'instruction-container';
  box.style.position = 'absolute';
  box.style.bottom = '10px';
  box.style.left = '50%';
  box.style.transform = 'translateX(-50%)';
  box.style.zIndex = '9999';
  box.style.maxWidth = '400px';
  box.innerHTML = `
    <div id="instruction-box">
      <div id="instruction-header">
        <div id="instruction-box-title">Instructions</div>
        <button id="close-instruction" class="instruction-btn">✖</button>
      </div>
      <div id="instruction-values-info">
        ${steps.map((s, i) => `${i + 1}. ${s}`).join('<br><br>')}
      </div>
    </div>
    <button id="show-instruction" class="instruction-btn">Show Instructions</button>
  `;
  document.body.appendChild(box);

  const close = document.getElementById('close-instruction');
  const show = document.getElementById('show-instruction');
  const instr = document.getElementById('instruction-box');
  close.onclick = () => { instr.style.display = 'none'; show.style.display = 'block'; };
  show.onclick = () => { instr.style.display = 'block'; show.style.display = 'none'; };
}

// === EXIT ROUTE ===
function exitRoute() {
  clearExistingRoutes();
  const oldInstr = document.getElementById('instruction-container');
  if (oldInstr) oldInstr.remove();

  document.getElementById('exitroute').style.display = 'none';
  document.getElementById('gobutt').style.display = 'flex';

  map.flyTo({ center: [120.981053, 14.657581], zoom: 12 });
}

// === AUTOFILL & GO BUTTON ===
const SInput = document.getElementById("startinput");
const EInput = document.getElementById("endinput");

function StartBarFill(v) { SInput.value = v; }
function EndBarFill(v) { EInput.value = v; }
function clearInput(f) { f.value = ''; }

// === MAIN ROUTELIST FUNCTION ===
async function routelist() {
  const start = SInput.value.trim();
  const end = EInput.value.trim();
  if (!start || !end) {
    alert("Please fill out both fields.");
    return;
  }

  try {
    const res = await fetch('http://localhost:8000/api/routes');
    if (!res.ok) throw new Error("Failed to fetch routes from API");

    const data = await res.json();
    console.log("Routes from API:", data);

    // ✅ SAFETY CHECK
    if (!Array.isArray(data)) {
      console.error("API did not return an array:", data);
      alert("Invalid route data format");
      return;
    }

    const key = `${start} to ${end}`;

    // ✅ FILTER ROUTES
    const matchingRoutes = data.filter(r => r.name === key);

    if (matchingRoutes.length === 0) {
      alert("No routes found for these addresses.");
      return;
    }

    showRouteListPopup(matchingRoutes);

  } catch (err) {
    console.error("Error loading routes:", err);
    alert("Failed to load route list.");
  }
}



// === POPUP: SHOW ROUTE LIST WITH YOUR DESIGN + AUTO CALCULATIONS ===
function showRouteListPopup(routes) {
  const popup = document.getElementById("popup-box");
  const overlay = document.getElementById("popup-overlay");
  const content = document.getElementById("popup-content");
  content.innerHTML = ""; // Clear previous

  // Helper: compute distance between two lat/lng points using Haversine formula
  function haversine(coord1, coord2) {
    const R = 6371; // km
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(coord2[1] - coord1[1]);
    const dLon = toRad(coord2[0] - coord1[0]);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(coord1[1])) *
      Math.cos(toRad(coord2[1])) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Compute total route distance
function computeTotalDistance(route) {
  if (!Array.isArray(route.segments)) return 0; // ✅ safety

  let total = 0;
  route.segments.forEach(seg => {
    if (!Array.isArray(seg.coordinates)) return;

    for (let i = 0; i < seg.coordinates.length - 1; i++) {
      total += haversine(seg.coordinates[i], seg.coordinates[i + 1]);
    }
  });
  return total;
}



  routes.forEach((r, i) => {
    const distance = computeTotalDistance(r).toFixed(1);
    const avgSpeedKmHr = 15; // assume 15 km/h average speed
    const time = Math.round((distance / avgSpeedKmHr) * 60); // minutes

    // Simple fare rule: base ₱13 + ₱2/km after 4 km
    let fare = 13;
    if (distance > 4) fare += Math.round((distance - 4) * 2);
    const discountedFare = Math.round(fare * 0.8);

    const routeinfo = r.routeinfo || r.instructions?.[0] || r.segments?.[0]?.description || "Route Option";
    const routevia = r.via;
    // === ICON DETECTION ===
    let iconsHTML = "";
    if (routeinfo.toLowerCase().includes("jeep")) {
      iconsHTML += `<img src="Others/IMAGES/Jeep.png" alt="Jeep" title="Jeepney" />`;
    }
    if (routeinfo.toLowerCase().includes("bus")) {
      iconsHTML += `<img src="Others/IMAGES/Bus.png" alt="Bus" title="Bus" />`;
    }
    if (routeinfo.toLowerCase().includes("train") || routeinfo.toLowerCase().includes("lrt") || routeinfo.toLowerCase().includes("mrt")) {
      iconsHTML += `<img src="Others/IMAGES/Train.png" alt="Train" title="Train" />`;
    }
    if (routeinfo.toLowerCase().includes("tricycle")) {
      iconsHTML += `<img src="Others/IMAGES/Tricycle.png" alt="Tricycle" title="Tricycle" />`;
    }

    // === POPUP BOX (YOUR DESIGN) ===
    const box = document.createElement("div");
    box.classList.add("inner-box");
    box.innerHTML = `
      <div id="popup-values">
        <div id="popup-values-info">
          <div id="popup-values-rd">${routevia}</div>
          <div id="popup-values-km-min">${distance} KM • ${time} Minutes</div>
        </div>
        <div id="popup-values-right">
          P ${fare}.00<br>
          <span>Discounted Value<br></span>
          P ${discountedFare}.00
        </div>
      </div>
      ${iconsHTML ? `<div class="popup-icons">${iconsHTML}</div>` : ""}
      <button class="go-button">Go</button>
    `;

    // === GO BUTTON ===
    const goBtn = box.querySelector(".go-button");
    goBtn.addEventListener("click", () => {
      loadRoute(r.id);
      closePopup();
    });

    content.appendChild(box);
  });

  overlay.style.display = "block";
  popup.style.display = "flex";
}


// === CLOSE POPUP ===
function closePopup() {
  document.getElementById("popup-overlay").style.display = "none";
  document.getElementById("popup-box").style.display = "none";
}

document.getElementById("close-btn").addEventListener("click", closePopup);



async function getRoute(start, end) {
    const url = `http://localhost:8000/route?start=${start.lat},${start.lng}&end=${end.lat},${end.lng}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.route) {
        alert("No route found");
        return;
    }

    drawRoute(data.route);
}

function drawRoute(coords) {
    if (map.getSource("route-line")) {
        map.getSource("route-line").setData({
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: coords
            }
        });
    } else {
        map.addSource("route-line", {
            type: "geojson",
            data: {
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: coords
                }
            }
        });

        map.addLayer({
            id: "route-line-layer",
            type: "line",
            source: "route-line",
            paint: {
                "line-width": 4,
                "line-color": "#00aaff"
            }
        });
    }
}
