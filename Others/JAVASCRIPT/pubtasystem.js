mapboxgl.accessToken = 'YOUR_MAPBOX_ACCESS_TOKEN';

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/pubta/cm1xcjw1000u801r7gqhbfhoi',
    center: [120.981053, 14.657581],
    zoom: 12
});

      let startCoordinates = null;
      let endCoordinates = null;

      // Function to geocode an address and return coordinates
      async function geocodeAddress(address) {
          const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${mapboxgl.accessToken}`);
          const data = await response.json();
          if (data.features.length > 0) {
              return data.features[0].center;
          } else {
              alert('Location not found. Please try again.');
              return null;
          }
      }

      // Function to draw the route on the map
      async function getRoute(start, end) {
          const query = await fetch(
              `https://api.mapbox.com/directions/v5/mapbox/driving/${start[0]},${start[1]};${end[0]},${end[1]}?geometries=geojson&access_token=${mapboxgl.accessToken}`,
              { method: 'GET' }
          );
          const json = await query.json();
          const route = json.routes[0].geometry.coordinates;
          const geojson = {
              type: 'Feature',
              properties: {},
              geometry: {
                  type: 'LineString',
                  coordinates: route
              }
          };

          // Remove existing route layer if it exists
          if (map.getSource('route')) {
              map.getSource('route').setData(geojson);
          } else {
              map.addLayer({
                  id: 'route',
                  type: 'line',
                  source: {
                      type: 'geojson',
                      data: geojson
                  },
                  layout: {
                      'line-join': 'round',
                      'line-cap': 'round'
                  },
                  paint: {
                      'line-color': '#0',
                      'line-width': 5,
                      'line-opacity': 0.75
                  }
              });
          }

          // Add markers for start and end points
          if (map.getLayer('start-point')) {
              map.getSource('start-point').setData({
                  type: 'FeatureCollection',
                  features: [{
                      type: 'Feature',
                      properties: {},
                      geometry: {
                          type: 'Point',
                          coordinates: start
                      }
                  }]
              });
          } else {
              map.addLayer({
                  id: 'start-point',
                  type: 'circle',
                  source: {
                      type: 'geojson',
                      data: {
                          type: 'FeatureCollection',
                          features: [{
                              type: 'Feature',
                              properties: {},
                              geometry: {
                                  type: 'Point',
                                  coordinates: start
                              }
                          }]
                      }
                  },
                  paint: {
                      'circle-radius': 10,
                      'circle-color': '#3887be'
                  }
              });
          }

          if (map.getLayer('end-point')) {
              map.getSource('end-point').setData({
                  type: 'FeatureCollection',
                  features: [{
                      type: 'Feature',
                      properties: {},
                      geometry: {
                          type: 'Point',
                          coordinates: end
                      }
                  }]
              });
          } else {
              map.addLayer({
                  id: 'end-point',
                  type: 'circle',
                  source: {
                      type: 'geojson',
                      data: {
                          type: 'FeatureCollection',
                          features: [{
                              type: 'Feature',
                              properties: {},
                              geometry: {
                                  type: 'Point',
                                  coordinates: end
                              }
                          }]
                      }
                  },
                  paint: {
                      'circle-radius': 10,
                      'circle-color': '#f30'
                  }
              });
          }
      }

      /*
      const ACCESS_TOKEN = 'YOUR_MAPBOX_ACCESS_TOKEN';
      window.addEventListener('load', () => {
      
          const collection = mapboxsearch.autofill({
              accessToken: ACCESS_TOKEN
          });
      });
    */
      // Function to handle the final routing
      async function routing() {
          const startAddress = document.getElementById('startinput').value;
          const endAddress = document.getElementById('endinput').value;

          if (!startAddress || !endAddress) {
              alert('Please enter both starting and ending locations.');
              return;
          }

          startCoordinates = await geocodeAddress(startAddress);
          endCoordinates = await geocodeAddress(endAddress);

          if (startCoordinates && endCoordinates) {

              getRoute(startCoordinates, endCoordinates);
          }
      }

      // Function to clear input fields
      function clearInput(inputField) {
          inputField.value = '';
      }

      const SInput = document.getElementById("startinput");
      const EInput = document.getElementById("endinput");

      function EndBarFill(input){
          EInput.value = input;
      }
      function StartBarFill(input){
        SInput.value = input;
      }



      function exitRoute() {
        // Hide the exit button and reset the map
        document.getElementById('exitroute').style.display = 'none';
        document.getElementById('gobutt').style.display = 'flex'; // Show the Go button again
    
        // Remove all route layers and sources from the map
        map.removeLayer('layerBlue1');
        map.removeLayer('layerOrange');
        map.removeLayer('layerBlue2');
        map.removeSource('routeBlue1');
        map.removeSource('routeOrange'); 
        map.removeSource('routeBlue2');
    
        // Remove waypoint layers
        map.removeLayer('waypoint-start-layer');
        map.removeLayer('waypoint-end-layer');
    
        // Fully remove instruction container to allow fresh binding later
        const oldInstruction = document.getElementById('instruction-container');
        if (oldInstruction) oldInstruction.remove();

    
        // Optionally, reset the map to its initial position if needed
        map.flyTo({
            center: [120.981053, 14.657581],
            zoom: 12
        });
    }
    

//Choosing your routes

// number of boxes to popup
//switch case para sa pagthrow sa isang function para ilist ung mga routes
function routelist() {
    const start = document.getElementById("startinput").value.trim();
    const end = document.getElementById("endinput").value.trim();
    const routeKey = `${start} to ${end}`;
    if (start !== "" && end !== "") {
        switch (routeKey) {
            case "University of the East Caloocan Campus to SM Grand Central":
                uesmgclist(2);
                break;
    
            case "SM Grand Central to University of the East Caloocan Campus":
                smgcuelist(2);
                break;
    
            case "University of the East Caloocan Campus to Manila Central University":
                uemculist(1);
                break;   
                
            case "Manila Central University to University of the East Caloocan Campus":
                mcuuelist(1);
                break;    
    
            case "University of the East Caloocan Campus to Victory Mall":
                uevictorylist(2);
                break;   
                
            case "Victory Mall to University of the East Caloocan Campus":
                victoryuelist(2);
                break;   
    
            default:
                alert("No route found for the entered addresses.");
                break;
        }

    } else {
        alert("Please fill out both fields.");
    }
}

function closePopup() {
    document.getElementById("popup-overlay").style.display = "none";
    document.getElementById("popup-box").style.display = "none";
}

//functions for showing the list of routes per destination
//numbox yung lalabas na dami ng box
function uesmgclist(numbox) {
    const contentDiv = document.getElementById("popup-content");
    contentDiv.innerHTML = "Possible Routes";//title nung popup pero wag na

    for (let i = 1; i <= numbox; i++) {
        // Dynamic values for each route segment
        const distance = i === 1 ? 2.7 : 3.2;
        const fare = i === 1 ? 14 : 15;
        const time = i === 1 ? 12 : 15;
        const discountedFare = Math.round(fare * 0.8);
        const routeinfo = i === 1 ? "Via Jeep on Samson Rd and Araneta Square" : "Via Jeep on Samson Rd and Epifanio de los Santos Ave"
/* do not edit from here*/
        const box = document.createElement("div");
        box.classList.add("inner-box");
        
        //vehicle icons
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
        // Set inner content 
        //styling nasa css
        box.innerHTML = `
            <div id=popup-values>
                <div id=popup-values-info>
                <div id=popup-values-rd>
                ${routeinfo}
                </div>
                <div id=popup-values-km-min>
                    ${distance.toFixed(1)} KM ${time} Minutes
                </div>
                </div>

                <div id=popup-values-right>
                    P ${fare}.00<br>
                    <span>Discounted Value<br></span>
                    P ${discountedFare}.00
                </div>
            </div>
            ${iconsHTML ? `
            <div class="popup-icons">
                ${iconsHTML}
            </div>` : ""}
            
        <button class="go-button">Go</button>
    `;
/* do not edit from here*/

        // Handle "Go" button inside each box
        const goBtn = box.querySelector(".go-button");
        goBtn.addEventListener("click", () => {
            switch (i) {
                case 1:
                    if (map.loaded()) uesmgc1();
                    else map.on("load", uesmgc1);
                    break;
                case 2:
                    if (map.loaded()) uesmgc2();
                    else map.on("load", uesmgc2);
                    break;
            }
            closePopup();
        });

        contentDiv.appendChild(box);
    }

    document.getElementById("popup-overlay").style.display = "block";
    document.getElementById("popup-box").style.display = "flex";
}
/* TO HERE */


function smgcuelist(numbox) {
    const contentDiv = document.getElementById("popup-content");
    contentDiv.innerHTML = "Possible Routes";//title nung popup pero wag na

    for (let i = 1; i <= numbox; i++) { //fare values
        // Dynamic values for each route segment
        const distance = i === 1 ? 2.0 : 1.1;
        const fare = i === 1 ? 13 : 13;
        const time = i === 1 ? 14 : 10;
        const discountedFare = Math.round(fare * 0.8);
        const routeinfo = i === 1 ? "Via Jeep at Monumento Circle and Samson Rd" : "Via Jeep on Monumento Circle and Samson Rd"
/* do not edit from here*/
        const box = document.createElement("div");
        box.classList.add("inner-box");

        //vehicle icons
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
        // Set inner content 
        //styling nasa css
        box.innerHTML = `
            <div id=popup-values>
                <div id=popup-values-info>
                <div id=popup-values-rd>
                ${routeinfo}
                </div>
                <div id=popup-values-km-min>
                    ${distance.toFixed(1)} KM ${time} Minutes
                </div>
                </div>

                <div id=popup-values-right>
                    P ${fare}.00<br>
                    <span>Discounted Value<br></span>
                    P ${discountedFare}.00
                </div>
            </div>
            ${iconsHTML ? `
            <div class="popup-icons">
                ${iconsHTML}
            </div>` : ""}
            
        <button class="go-button">Go</button>
    `;
/* do not edit from here*/

        // Handle "Go" button inside each box
        const goBtn = box.querySelector(".go-button");
        goBtn.addEventListener("click", () => {
            switch (i) {
                case 1:
                    if (map.loaded()) smgcue1();
                    else map.on("load", smgcue1);
                    break;
                case 2:
                    if (map.loaded()) smgcue2();
                    else map.on("load", smgcue2);
                    break;
            }
            closePopup();
        });

        contentDiv.appendChild(box);
    }

    document.getElementById("popup-overlay").style.display = "block";
    document.getElementById("popup-box").style.display = "flex";
}

function uemculist(numbox) {
    const contentDiv = document.getElementById("popup-content");
    contentDiv.innerHTML = "Possible Routes";//title nung popup pero wag na

    for (let i = 1; i <= numbox; i++) { //fare values
        // Dynamic values for each route segment
        const distance = i === 1 ? 1.8 : 0;
        const fare = i === 1 ? 13 : 0;
        const time = i === 1 ? 14 : 0;
        const discountedFare = Math.round(fare * 0.8);
        const routeinfo = i === 1 ? "Via Jeep on Samson Rd and EDSA" : "";
/* do not edit from here*/
        const box = document.createElement("div");
        box.classList.add("inner-box");

        //vehicle icons
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
        // Set inner content 
        //styling nasa css
        box.innerHTML = `
            <div id=popup-values>
                <div id=popup-values-info>
                <div id=popup-values-rd>
                ${routeinfo}
                </div>
                <div id=popup-values-km-min>
                    ${distance.toFixed(1)} KM ${time} Minutes
                </div>
                </div>

                <div id=popup-values-right>
                    P ${fare}.00<br>
                    <span>Discounted Value<br></span>
                    P ${discountedFare}.00
                </div>
            </div>
            ${iconsHTML ? `
            <div class="popup-icons">
                ${iconsHTML}
            </div>` : ""}
            
        <button class="go-button">Go</button>
    `;
/* do not edit from here*/

        // Handle "Go" button inside each box
        const goBtn = box.querySelector(".go-button");
        goBtn.addEventListener("click", () => {
            switch (i) {
                case 1:
                    if (map.loaded()) uemcu1();
                    else map.on("load", uemcu1);
                    break;
                case 2:
                    if (map.loaded()) uemcu1();
                    else map.on("load", uemcu1);
                    break;
            }
            closePopup();
        });

        contentDiv.appendChild(box);
    }

    document.getElementById("popup-overlay").style.display = "block";
    document.getElementById("popup-box").style.display = "flex";
}

function mcuuelist(numbox) {
    const contentDiv = document.getElementById("popup-content");
    contentDiv.innerHTML = "Possible Routes";//title nung popup pero wag na

    for (let i = 1; i <= numbox; i++) { //fare values
        // Dynamic values for each route segment
        const distance = i === 1 ? 2.7 : 0;
        const fare = i === 1 ? 14 : 0;
        const time = i === 1 ? 9 : 0;
        const discountedFare = Math.round(fare * 0.8);
        const routeinfo = i === 1 ? "Via Jeep on Samson Rd and EDSA" : "";
/* do not edit from here*/
        const box = document.createElement("div");
        box.classList.add("inner-box");

        //vehicle icons
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
        // Set inner content 
        //styling nasa css
        box.innerHTML = `
            <div id=popup-values>
                <div id=popup-values-info>
                <div id=popup-values-rd>
                ${routeinfo}
                </div>
                <div id=popup-values-km-min>
                    ${distance.toFixed(1)} KM ${time} Minutes
                </div>
                </div>

                <div id=popup-values-right>
                    P ${fare}.00<br>
                    <span>Discounted Value<br></span>
                    P ${discountedFare}.00
                </div>
            </div>
            ${iconsHTML ? `
            <div class="popup-icons">
                ${iconsHTML}
            </div>` : ""}
            
        <button class="go-button">Go</button>
    `;
/* do not edit from here*/

        // Handle "Go" button inside each box
        const goBtn = box.querySelector(".go-button");
        goBtn.addEventListener("click", () => {
            switch (i) {
                case 1:
                    if (map.loaded()) mcuue1();
                    else map.on("load", mcuue1);
                    break;
                case 2:
                    if (map.loaded()) mcuue1();
                    else map.on("load", uemcu1);
                    break;
            }
            closePopup();
        });

        contentDiv.appendChild(box);
    }

    document.getElementById("popup-overlay").style.display = "block";
    document.getElementById("popup-box").style.display = "flex";
}

function uevictorylist(numbox) {
    const contentDiv = document.getElementById("popup-content");
    contentDiv.innerHTML = "Possible Routes";//title nung popup pero wag na

    for (let i = 1; i <= numbox; i++) { //fare values
        // Dynamic values for each route segment
        const distance = i === 1 ? 1.3 : 1.5;
        const fare = i === 1 ? 13 : 13;
        const time = i === 1 ? 11 : 8;
        const discountedFare = Math.round(fare * 0.8);
        const routeinfo = i === 1 ? "Via Jeep on Samson Rd" : "Via Jeep on Samson Rd";
/* do not edit from here*/
        const box = document.createElement("div");
        box.classList.add("inner-box");

        //vehicle icons
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
        // Set inner content 
        //styling nasa css
        box.innerHTML = `
            <div id=popup-values>
                <div id=popup-values-info>
                <div id=popup-values-rd>
                ${routeinfo}
                </div>
                <div id=popup-values-km-min>
                    ${distance.toFixed(1)} KM ${time} Minutes
                </div>
                </div>

                <div id=popup-values-right>
                    P ${fare}.00<br>
                    <span>Discounted Value<br></span>
                    P ${discountedFare}.00
                </div>
            </div>
            ${iconsHTML ? `
            <div class="popup-icons">
                ${iconsHTML}
            </div>` : ""}
            
        <button class="go-button">Go</button>
    `;
/* do not edit from here*/

        // Handle "Go" button inside each box
        const goBtn = box.querySelector(".go-button");
        goBtn.addEventListener("click", () => {
            switch (i) {
                case 1:
                    if (map.loaded()) uevictory1();
                    else map.on("load", uevictory1);
                    break;
                case 2:
                    if (map.loaded()) uevictory2();
                    else map.on("load", uevictory2);
                    break;
            }
            closePopup();
        });

        contentDiv.appendChild(box);
    }

    document.getElementById("popup-overlay").style.display = "block";
    document.getElementById("popup-box").style.display = "flex";
}

function victoryuelist(numbox) {
    const contentDiv = document.getElementById("popup-content");
    contentDiv.innerHTML = "Possible Routes";//title nung popup pero wag na

    for (let i = 1; i <= numbox; i++) { //fare values
        // Dynamic values for each route segment
        const distance = i === 1 ? 1.1 : 1.3;
        const fare = i === 1 ? 13 : 13;
        const time = i === 1 ? 10 : 11;
        const discountedFare = Math.round(fare * 0.8);
        const routeinfo = i === 1 ? "Via Jeep on Monumento Circle and Samson Rd" : "Via Jeep on Samson Rd side road and Monumento Circle";
/* do not edit from here*/
        const box = document.createElement("div");
        box.classList.add("inner-box");

        //vehicle icons
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
        // Set inner content 
        //styling nasa css
        box.innerHTML = `
            <div id=popup-values>
                <div id=popup-values-info>
                <div id=popup-values-rd>
                ${routeinfo}
                </div>
                <div id=popup-values-km-min>
                    ${distance.toFixed(1)} KM ${time} Minutes
                </div>
                </div>

                <div id=popup-values-right>
                    P ${fare}.00<br>
                    <span>Discounted Value<br></span>
                    P ${discountedFare}.00
                </div>
            </div>
            ${iconsHTML ? `
            <div class="popup-icons">
                ${iconsHTML}
            </div>` : ""}
            
        <button class="go-button">Go</button>
    `;
/* do not edit from here*/

        // Handle "Go" button inside each box
        const goBtn = box.querySelector(".go-button");
        goBtn.addEventListener("click", () => {
            switch (i) {
                case 1:
                    if (map.loaded()) victoryue1();
                    else map.on("load", victoryue1);
                    break;
                case 2:
                    if (map.loaded()) victoryue2();
                    else map.on("load", victoryue2);
                    break;
            }
            closePopup();
        });

        contentDiv.appendChild(box);
    }

    document.getElementById("popup-overlay").style.display = "block";
    document.getElementById("popup-box").style.display = "flex";
}


//close button
document.getElementById("close-btn").addEventListener("click", closePopup);
    

//custom routes from ue to sm gc (COPY PASTE NYO LANG ITONG FUNCTION TAPOS IBAHIN ANG COORDINATES PER POINT GAMIT UNG SINEND KONG LINK FOR FINDING THE COORDINATES PER POINT)
function uesmgc1() {
    if (map.getSource('routeBlue1')) return;

    // Define your segments
    const blueSegment1 = [
        [120.97615851414673, 14.657812456541961],
        [120.97628977833864, 14.657768752157295],
        [120.97627621059314, 14.657699318075856]
    ];

    const orangeSegment = [
        [120.97627621059314, 14.657699318075856],
        [120.97683808912097, 14.657560256948202],
        [120.97951479848126, 14.6571839053194],
        [120.98278000244022, 14.657075162139805]
    ];

    const blueSegment2 = [
        [120.98278000244022, 14.657075162139805],
        [120.98277047290611, 14.657042544109174],
        [120.98339107627174, 14.657026599460622],
        [120.98348251024447, 14.656973020518748],
        [120.9835411891379, 14.656930848984757],
        [120.98361940222475, 14.656857229179778],
        [120.98368811411888, 14.65678911888142],
        [120.98374511648336, 14.656695004441943],
        [120.9837802988319, 14.656632912598056],
        [120.98381078186145, 14.656561043068834],
        [120.98381640331343, 14.656538414802824],
        [120.98382466955866, 14.656496066178292],
        [120.98381802466452, 14.656078041311787],
        [120.98381419267031, 14.655712204340617],
        [120.98407133469095, 14.65569720891078],
        [120.98406921320714, 14.65559270480425],
        [120.98404663548837, 14.655080658081957]
    ];

    // Add a reusable function to create segments with popup text (DO NOT EDIT)
    function addRouteSegmentWithPopup(sourceId, layerId, coordinates, color, description) {
        map.addSource(sourceId, {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: coordinates
                    },
                    properties: {
                        description: description
                    }
                }]
            }
        });
        //(DO NOT EDIT)
        map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': color,
                'line-width': 10
            }
        });

        // Add popup behavior (DO NOT EDIT)
        map.on('click', layerId, function (e) {
            new mapboxgl.Popup({
                closeButton: true,
                closeOnClick: true,
                offset: 12,
                anchor: 'top'
            })
            .setLngLat(e.lngLat)
            .setHTML(`<div>${e.features[0].properties.description}</div>`)
            .addTo(map);
        });

        // Optional: change cursor on hover (DO NOT EDIT)
        map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
        });
    }

    // Add all 3 with different descriptions
    addRouteSegmentWithPopup('routeBlue1', 'layerBlue1', blueSegment1, '#1E90FF', 'Walk from UE Entrance to the Jeepney Stop');
    addRouteSegmentWithPopup('routeOrange', 'layerOrange', orangeSegment, '#ff6600', 'Ride a Sangandaan-MCU or Malabon-Monumento Jeepney');
    addRouteSegmentWithPopup('routeBlue2', 'layerBlue2', blueSegment2, '#1E90FF', 'Walk around Monumento circle to Victory Mall and cross the Pedestrian to SM Grand Central');

    // Show exit button and hide go button after route is loaded (DO NOT EDIT)
    document.getElementById('gobutt').style.display = 'none'; // Hide the Go button
    document.getElementById('exitroute').style.display = 'flex'; // Show the Exit button

    // Waypoint START (DO NOT EDIT)
    map.loadImage('Others/IMAGES/csslgo.png', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-start')) map.addImage('waypoints-logo-start', image);
        map.addLayer({
            id: 'waypoint-start-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment1[0]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-start',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Waypoint END (DO NOT EDIT)
    map.loadImage('Others/IMAGES/csslgoend.PNG', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-end')) map.addImage('waypoints-logo-end', image);
        map.addLayer({
            id: 'waypoint-end-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment2[blueSegment2.length - 1]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-end',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });
    
    // Auto fit to all segments (DO NOT EDIT)
    const bounds = new mapboxgl.LngLatBounds();
    [...blueSegment1, ...orangeSegment, ...blueSegment2].forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, {
        padding: 50,
        animate: true,
        duration: 1000
    });

    uesmgc1Instruction();  // calls the instruction box

}

//Each route should have its own instruction function
//Instruction function of ue to smgc route 1
function uesmgc1Instruction() {
    // Remove if already present
    const oldContainer = document.getElementById("instruction-container");
    if (oldContainer) oldContainer.remove();

    const instructionContainer = document.createElement("div");
    instructionContainer.id = "instruction-container";
    instructionContainer.style.position = "absolute";
    instructionContainer.style.bottom = "10px";
    instructionContainer.style.left = "50%";
    instructionContainer.style.transform = "translateX(-50%)";
    instructionContainer.style.zIndex = "9999";
    instructionContainer.style.maxWidth = "400px";

    instructionContainer.innerHTML = `
        <div id="instruction-box">
            <div id="instruction-header">
                <div id="instruction-box-title">Instructions</div>
                <button id="close-instruction" class="instruction-btn">✖</button>
            </div>
            <div id="instruction-values-info">
                1. Walk to the Jeepstop by the other side of the Pedestrian Lane

                2. Wait for a Jeepney that has the following route:
                   Monumento-Malabon
                   MCU-Sangandaan

                3. Fee Price:
                   Regular Php 14.00
                   Student/PWD/Seniors Php 11.00

                4. Ask for a stop on Puregold Monumento or the Foot Bridge

                5. Walk around the Araneta Square until you reach the Pedestrian Lane to SM Grand Central 
            </div>
        </div>
        <button id="show-instruction" class="instruction-btn">Show Instructions</button>
    `;

    document.body.appendChild(instructionContainer);

    // Always re-bind after adding to DOM
    const closeBtn = document.getElementById("close-instruction");
    const showBtn = document.getElementById("show-instruction");
    const box = document.getElementById("instruction-box");

    closeBtn.onclick = () => {
        box.style.display = "none";
        showBtn.style.display = "block";
    };
    showBtn.onclick = () => {
        box.style.display = "block";
        showBtn.style.display = "none";
    };
}

function uesmgc2() {
    if (map.getSource('routeBlue1')) return;

    // Define your segments
    const blueSegment1 = [
        [120.97615851414673, 14.657812456541961], // POINT A (START OF WALK)
        [120.97628977833864, 14.657768752157295], // WALKING
        [120.97627621059314, 14.657699318075856] // END OF WALK
    ];

    const orangeSegment = [
        [120.97627621059314, 14.657699318075856], // JEEP START
        [120.97683808912097, 14.657560256948202],
        [120.97951479848126, 14.6571839053194],
        [120.98342179204394, 14.65707472030472],
        [120.98350517068735, 14.657043040836768],
        [120.98360914812883, 14.656989917413824],
        [120.9836526092904, 14.656933257059777],
        [120.98373729608574, 14.656837522522096],
        [120.98387034153012, 14.65678044542237],
        [120.9839830157498, 14.656768609436256],
        [120.98411851189627, 14.65680227959345],
        [120.98421715725073, 14.65685130691513],
        [120.98431447672453, 14.656952010480808],
        [120.98450553562964, 14.656994121281699],
        [120.98548714844185, 14.657016851176863] // JEEP STOP
    ];

    const blueSegment2 = [
        [120.98548714844185, 14.657016851176863], // START OF WALK
        [120.98549091572556, 14.656024260795945], // WALKING
        [120.98543914974306, 14.655998188262345] // POINT B (END OF WALK)
    ];

    // Reusable function to add segments with popups
    function addRouteSegmentWithPopup(sourceId, layerId, coordinates, color, description) {
        map.addSource(sourceId, {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: coordinates
                    },
                    properties: {
                        description: description
                    }
                }]
            }
        });

        map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': color,
                'line-width': 10
            }
        });

        // Add popup behavior
        map.on('click', layerId, function (e) {
            new mapboxgl.Popup({
                closeButton: true,
                closeOnClick: true,
                offset: 12,
                anchor: 'top'
            })
            .setLngLat(e.lngLat)
            .setHTML(`<div>${e.features[0].properties.description}</div>`)
            .addTo(map);
        });

        // Optional: change cursor on hover
        map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
        });
    }

    // Add all 3 segments with descriptions
    addRouteSegmentWithPopup('routeBlue1', 'layerBlue1', blueSegment1, '#1E90FF', 'Walk from UE Entrance to the Jeepney Stop');
    addRouteSegmentWithPopup('routeOrange', 'layerOrange', orangeSegment, '#ff6600', 'Ride a Sangandaan-MCU Jeepney');
    addRouteSegmentWithPopup('routeBlue2', 'layerBlue2', blueSegment2, '#1E90FF', 'Walk around Monumento Circle to Victory Mall and cross the Pedestrian to SM Grand Central');

    // Show exit button and hide go button after route is loaded
    document.getElementById('gobutt').style.display = 'none'; // Hide the Go button
    document.getElementById('exitroute').style.display = 'flex'; // Show the Exit button

    // Waypoint START
    map.loadImage('Others/IMAGES/csslgo.png', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-start')) map.addImage('waypoints-logo-start', image);
        map.addLayer({
            id: 'waypoint-start-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment1[0]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-start',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Waypoint END
    map.loadImage('Others/IMAGES/csslgoend.PNG', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-end')) map.addImage('waypoints-logo-end', image);
        map.addLayer({
            id: 'waypoint-end-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment2[blueSegment2.length - 1]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-end',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Auto fit to all segments
    const bounds = new mapboxgl.LngLatBounds();
    [...blueSegment1, ...orangeSegment, ...blueSegment2].forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, {
        padding: 50,
        animate: true,
        duration: 1000
    });

    uesmgc2Instruction();  // calls the instruction box
}

function uesmgc2Instruction() {
    // Remove if already present
    const oldContainer = document.getElementById("instruction-container");
    if (oldContainer) oldContainer.remove();

    const instructionContainer = document.createElement("div");
    instructionContainer.id = "instruction-container";
    instructionContainer.style.position = "absolute";
    instructionContainer.style.bottom = "10px";
    instructionContainer.style.left = "50%";
    instructionContainer.style.transform = "translateX(-50%)";
    instructionContainer.style.zIndex = "9999";
    instructionContainer.style.maxWidth = "400px";

    instructionContainer.innerHTML = `
        <div id="instruction-box">
            <div id="instruction-header">
                <div id="instruction-box-title">Instructions</div>
                <button id="close-instruction" class="instruction-btn">✖</button>
            </div>
            <div id="instruction-values-info">
                1. Walk to the Jeepstop by the other side of the Pedestrian Lane

                2. Wait for a Jeepney that has the following route:
                   MCU-Sangandaan

                3. Fee Price:
                   Regular Php 14.00
                   Student/PWD/Seniors Php 11.00

                4. Ask for a stop on Carousel FootBridge beside Starbucks 

                5. Walk through the Maximo Street and Benin Street to behind the SM Grand Central 
            </div>
        </div>
        <button id="show-instruction" class="instruction-btn">Show Instructions</button>
    `;

    document.body.appendChild(instructionContainer);

    // Always re-bind after adding to DOM
    const closeBtn = document.getElementById("close-instruction");
    const showBtn = document.getElementById("show-instruction");
    const box = document.getElementById("instruction-box");

    closeBtn.onclick = () => {
        box.style.display = "none";
        showBtn.style.display = "block";
    };
    showBtn.onclick = () => {
        box.style.display = "block";
        showBtn.style.display = "none";
    };
}


function smgcue1() {
    if (map.getSource('routeBlue1')) return;

    const blueSegment1 = [
        [120.98543914974306,14.655998188262345], //POINT A (START OF WALK)
        [120.98549091572556,14.656024260795945], //WALKING
        [120.98548714844185,14.657016851176863] // END OF WALK (JEEP START)
    ];

    const orangeSegment = [
        [120.98548714844185,14.657016851176863],
        [120.98589314250233,14.657027558395527],
        [120.99029922855578,14.65709894761271],
        [120.99037814353721,14.657114596813116],
        [120.99039704761856,14.657143474009573],
        [120.99040998198785,14.657189677516428],
        [120.99041599820197,14.657239036898972],
        [120.9904030641485,14.657276576977438],
        [120.9903517618074,14.657297341839424],
        [120.99007050356528,14.657313195429253],
        [120.98974701741736,14.657344965144347],
        [120.9892967255496,14.657343439612092],
        [120.98689533117266,14.657319553018667], //mcu
        [120.98431340026195,14.657217581863947],
        [120.98424581932625,14.657350161272959],
        [120.98413867014375,14.657433359280972],
        [120.98397159505492,14.657480579307233],
        [120.98380234243018,14.65742730671245],
        [120.98370284827718,14.65737282205312],
        [120.98364840838235,14.657300207695442],
        [120.98360335442567,14.657236642220965],
        [120.9835273710251,14.657203415237873],
        [120.98342036787898,14.65716527593871],
        [120.98171824593294,14.657184917777087],
        [120.98160992996452,14.657169088720266],
        [120.97949175331564,14.657230022329031],
        [120.9768385767776,14.657590928818806],
        [120.97651989843854,14.657698822261423] //JEEP END
    ];

    const blueSegment2 = [
        [120.97651989843854,14.657698822261423], //START OF WALK
        [120.976525,14.657718],
        [120.97628977833864,14.657768752157295] //POINT B (END OF WALK)
    ];

    // Reusable function to add segments with popups
    function addRouteSegmentWithPopup(sourceId, layerId, coordinates, color, description) {
        map.addSource(sourceId, {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: coordinates
                    },
                    properties: {
                        description: description
                    }
                }]
            }
        });

        map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': color,
                'line-width': 10
            }
        });

        // Add popup behavior
        map.on('click', layerId, function (e) {
            new mapboxgl.Popup({
                closeButton: true,
                closeOnClick: true,
                offset: 12,
                anchor: 'top'
            })
            .setLngLat(e.lngLat)
            .setHTML(`<div>${e.features[0].properties.description}</div>`)
            .addTo(map);
        });

        // Optional: change cursor on hover
        map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
        });
    }

    // Add all 3 segments with descriptions
    addRouteSegmentWithPopup('routeBlue1', 'layerBlue1', blueSegment1, '#1E90FF', 'Walk from back entrance to the highway');
    addRouteSegmentWithPopup('routeOrange', 'layerOrange', orangeSegment, '#ff6600', 'Ride a Sangandaan-MCU Jeepney');
    addRouteSegmentWithPopup('routeBlue2', 'layerBlue2', blueSegment2, '#1E90FF', 'Get down from the jeep by STI or UE and walk into UE');

    // Show exit button and hide go button after route is loaded
    document.getElementById('gobutt').style.display = 'none'; // Hide the Go button
    document.getElementById('exitroute').style.display = 'flex'; // Show the Exit button

    // Waypoint START
    map.loadImage('Others/IMAGES/csslgo.png', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-start')) map.addImage('waypoints-logo-start', image);
        map.addLayer({
            id: 'waypoint-start-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment1[0]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-start',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Waypoint END
    map.loadImage('Others/IMAGES/csslgoend.PNG', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-end')) map.addImage('waypoints-logo-end', image);
        map.addLayer({
            id: 'waypoint-end-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment2[blueSegment2.length - 1]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-end',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Auto fit to all segments
    const bounds = new mapboxgl.LngLatBounds();
    [...blueSegment1, ...orangeSegment, ...blueSegment2].forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, {
        padding: 50,
        animate: true,
        duration: 1000
    });
    smgcue1Instruction();
}

function smgcue1Instruction() {
    // Remove if already present
    const oldContainer = document.getElementById("instruction-container");
    if (oldContainer) oldContainer.remove();

    const instructionContainer = document.createElement("div");
    instructionContainer.id = "instruction-container";
    instructionContainer.style.position = "absolute";
    instructionContainer.style.bottom = "10px";
    instructionContainer.style.left = "50%";
    instructionContainer.style.transform = "translateX(-50%)";
    instructionContainer.style.zIndex = "9999";
    instructionContainer.style.maxWidth = "400px";

    instructionContainer.innerHTML = `
        <div id="instruction-box">
            <div id="instruction-header">
                <div id="instruction-box-title">Instructions</div>
                <button id="close-instruction" class="instruction-btn">✖</button>
            </div>
            <div id="instruction-values-info">
                1. Walk from the back entrance all the way to EDSA Highway.

                2. Wait for a Jeepney that has the following route:
                   MCU-Sangandaan.

                3. Fee Price:
                   Regular Php 13.00
                   Student/PWD/Seniors Php 11.00

                4. Ask for a stop by STI or UE.

                5. Walk into the University of the East.
            </div>
        </div>
        <button id="show-instruction" class="instruction-btn">Show Instructions</button>
    `;

    document.body.appendChild(instructionContainer);

    // Always re-bind after adding to DOM
    const closeBtn = document.getElementById("close-instruction");
    const showBtn = document.getElementById("show-instruction");
    const box = document.getElementById("instruction-box");

    closeBtn.onclick = () => {
        box.style.display = "none";
        showBtn.style.display = "block";
    };
    showBtn.onclick = () => {
        box.style.display = "block";
        showBtn.style.display = "none";
    };
}

function smgcue2() {
    if (map.getSource('routeBlue1')) return;

    const blueSegment1 = [
        [120.98404663548837,14.655080658081957],
        [120.98406921320714,14.65559270480425],
        [120.98407133469095,14.65569720891078],
        [120.98381419267031,14.655712204340617],
        [120.98381802466452,14.656078041311787],
        [120.98382466955866,14.656496066178292],
        [120.98381640331343,14.656538414802824],
        [120.98381078186145,14.656561043068834],
        [120.9837802988319,14.656632912598056],
        [120.98374511648336,14.656695004441943],
        [120.98368811411888,14.65678911888142],
        [120.98361940222475,14.656857229179778],
        [120.9835411891379,14.656930848984757],
        [120.98348251024447,14.656973020518748],
        [120.98339107627174,14.657026599460622],
        [120.98277047290611,14.657042544109174],
        [120.98278000244022,14.657075162139805] 
    ];

    const orangeSegment = [
        [120.98278000244022,14.657075162139805], //puregold
        [120.9834364877961,14.657062548896889],
        [120.9836006457927,14.657022953700462],
        [120.9836501180655,14.656959862428039],
        [120.98368855948422,14.656900914242243],
        [120.98375263745771,14.656845410710147],
        [120.98384255021148,14.656789835760748],
        [120.98395494115215,14.656765672735006],
        [120.98404984905693,14.656785003155605],
        [120.98413853266692,14.656810788605256],
        [120.98423075957078,14.656868289621599],
        [120.98430589103941,14.656948415254092],
        [120.9843190317772,14.657066465561243],
        [120.98431340026195,14.657217581863947],
        [120.98424581932625,14.657350161272959],
        [120.98413867014375,14.657433359280972],
        [120.98397159505492,14.657480579307233],
        [120.98380234243018,14.65742730671245],
        [120.98370284827718,14.65737282205312],
        [120.98364840838235,14.657300207695442],
        [120.98360335442567,14.657236642220965],
        [120.9835273710251,14.657203415237873],
        [120.98342036787898,14.65716527593871],
        [120.98171824593294,14.657184917777087],
        [120.98160992996452,14.657169088720266],
        [120.97949175331564,14.657230022329031],
        [120.9768385767776,14.657590928818806],
        [120.97651989843854,14.657698822261423] //JEEP END
    ];

    const blueSegment2 = [
        [120.97651989843854,14.657698822261423], 
        [120.9763005360121,14.657770842271702], 
        [120.97633900521515,14.657857029461411] 
    ];

    function addRouteSegmentWithPopup(sourceId, layerId, coordinates, color, description) {
        map.addSource(sourceId, {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: coordinates
                    },
                    properties: {
                        description: description
                    }
                }]
            }
        });

        map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': color,
                'line-width': 10
            }
        });

        // Add popup behavior
        map.on('click', layerId, function (e) {
            new mapboxgl.Popup({
                closeButton: true,
                closeOnClick: true,
                offset: 12,
                anchor: 'top'
            })
            .setLngLat(e.lngLat)
            .setHTML(`<div>${e.features[0].properties.description}</div>`)
            .addTo(map);
        });

        // Optional: change cursor on hover
        map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
        });
    }

    // Add all 3 segments with descriptions
    addRouteSegmentWithPopup('routeBlue1', 'layerBlue1', blueSegment1, '#1E90FF', 'Cross the street from the Main Entrance using the crosswalk and walk through Monumento');
    addRouteSegmentWithPopup('routeOrange', 'layerOrange', orangeSegment, '#ff6600', 'Ride one of the Jeeps lined up in front of the Puregold Warehouse');
    addRouteSegmentWithPopup('routeBlue2', 'layerBlue2', blueSegment2, '#1E90FF', 'Get down from the Jeep in front of STI and walk to UE');

    // Show exit button and hide go button after route is loaded
    document.getElementById('gobutt').style.display = 'none'; // Hide the Go button
    document.getElementById('exitroute').style.display = 'flex'; // Show the Exit button

    // Waypoint START
    map.loadImage('Others/IMAGES/csslgo.png', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-start')) map.addImage('waypoints-logo-start', image);
        map.addLayer({
            id: 'waypoint-start-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment1[0]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-start',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Waypoint END
    map.loadImage('Others/IMAGES/csslgoend.PNG', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-end')) map.addImage('waypoints-logo-end', image);
        map.addLayer({
            id: 'waypoint-end-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment2[blueSegment2.length - 1]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-end',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Auto fit to all segments
    const bounds = new mapboxgl.LngLatBounds();
    [...blueSegment1, ...orangeSegment, ...blueSegment2].forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, {
        padding: 50,
        animate: true,
        duration: 1000
    });
    smgcue2Instruction();
}

function smgcue2Instruction() {
    // Remove if already present
    const oldContainer = document.getElementById("instruction-container");
    if (oldContainer) oldContainer.remove();

    const instructionContainer = document.createElement("div");
    instructionContainer.id = "instruction-container";
    instructionContainer.style.position = "absolute";
    instructionContainer.style.bottom = "10px";
    instructionContainer.style.left = "50%";
    instructionContainer.style.transform = "translateX(-50%)";
    instructionContainer.style.zIndex = "9999";
    instructionContainer.style.maxWidth = "400px";

    instructionContainer.innerHTML = `
        <div id="instruction-box">
            <div id="instruction-header">
                <div id="instruction-box-title">Instructions</div>
                <button id="close-instruction" class="instruction-btn">✖</button>
            </div>
            <div id="instruction-values-info">
                1. Walk from the front entrance, cross the street, and walk until you reach the Jeepney Stop by the overpass.

                2. Wait for a Jeepney that has the following route:
                   Malabon-Monumento
                   MCU-Sangandaan.

                3. Fee Price:
                   Regular Php 13.00
                   Student/PWD/Seniors Php 11.00

                4. Ask for a stop by STI or UE.

                5. Walk into the University of the East.
            </div>
        </div>
        <button id="show-instruction" class="instruction-btn">Show Instructions</button>
    `;

    document.body.appendChild(instructionContainer);

    // Always re-bind after adding to DOM
    const closeBtn = document.getElementById("close-instruction");
    const showBtn = document.getElementById("show-instruction");
    const box = document.getElementById("instruction-box");

    closeBtn.onclick = () => {
        box.style.display = "none";
        showBtn.style.display = "block";
    };
    showBtn.onclick = () => {
        box.style.display = "block";
        showBtn.style.display = "none";
    };
}
//A5 = uemcu A6 = mcuue A7, A9 = uevictory, A8,A0 = victoryue
//ue to mcu
function uemcu1() {
    if (map.getSource('routeBlue1')) return;

    const blueSegment1 = [
        [120.97615851414673,14.657812456541961], //POINT A (START OF WALK)
        [120.97628977833864,14.657768752157295], //WALKING
        [120.97627621059314,14.657699318075856] // END OF WALK
    ];

    const orangeSegment = [
        [120.97627621059314,14.657699318075856], //JEEP START
        [120.97683808912097,14.657560256948202],
        [120.97951479848126,14.6571839053194],
        [120.98342179204394,14.65707472030472],
        [120.98350517068735,14.657043040836768],
        [120.98360914812883,14.656989917413824],
        [120.9836526092904,14.656933257059777],
        [120.98373729608574,14.656837522522096],
        [120.98387034153012,14.65678044542237],
        [120.9839830157498,14.656768609436256],
        [120.98411851189627,14.65680227959345],
        [120.98421715725073,14.65685130691513],
        [120.98431447672453,14.656952010480808],
        [120.98450553562964,14.656994121281699],
        [120.98589314250233,14.657027558395527],
        [120.99029922855578,14.65709894761271],
        [120.99037814353721,14.657114596813116],
        [120.99039704761856,14.657143474009573],
        [120.99040998198785,14.657189677516428],
        [120.99041599820197,14.657239036898972],
        [120.9904030641485,14.657276576977438],
        [120.9903517618074,14.657297341839424],
        [120.99007050356528,14.657313195429253],
        [120.98974701741736,14.657344965144347],
        [120.9892967255496,14.657343439612092],
        [120.98689533117266,14.657319553018667] //mcu
    ];

    const blueSegment2 = [
        [120.98689533117266,14.657319553018667], //START OF WALK
        [120.9868967942578,14.657413714333458] //POINT B (END OF WALK)
    ];

    function addRouteSegmentWithPopup(sourceId, layerId, coordinates, color, description) {
        map.addSource(sourceId, {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: coordinates
                    },
                    properties: {
                        description: description
                    }
                }]
            }
        });

        map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': color,
                'line-width': 10
            }
        });

        // Add popup behavior
        map.on('click', layerId, function (e) {
            new mapboxgl.Popup({
                closeButton: true,
                closeOnClick: true,
                offset: 12,
                anchor: 'top'
            })
            .setLngLat(e.lngLat)
            .setHTML(`<div>${e.features[0].properties.description}</div>`)
            .addTo(map);
        });

        // Optional: change cursor on hover
        map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
        });
    }

    // Add all 3 segments with descriptions
    addRouteSegmentWithPopup('routeBlue1', 'layerBlue1', blueSegment1, '#1E90FF', 'Get on an MCU-Sangandaan Jeep');
    addRouteSegmentWithPopup('routeOrange', 'layerOrange', orangeSegment, '#ff6600', 'Ride the Jeep from UE around the Monumento Circle and past the EDSA Carousel until the jeep makes a U-Turn towards MCU');
    addRouteSegmentWithPopup('routeBlue2', 'layerBlue2', blueSegment2, '#1E90FF', 'Get down from the Jeep and walk to MCU');

    // Show exit button and hide go button after route is loaded
    document.getElementById('gobutt').style.display = 'none'; // Hide the Go button
    document.getElementById('exitroute').style.display = 'flex'; // Show the Exit button

    // Waypoint START
    map.loadImage('Others/IMAGES/csslgo.png', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-start')) map.addImage('waypoints-logo-start', image);
        map.addLayer({
            id: 'waypoint-start-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment1[0]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-start',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Waypoint END
    map.loadImage('Others/IMAGES/csslgoend.PNG', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-end')) map.addImage('waypoints-logo-end', image);
        map.addLayer({
            id: 'waypoint-end-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment2[blueSegment2.length - 1]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-end',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Auto fit to all segments
    const bounds = new mapboxgl.LngLatBounds();
    [...blueSegment1, ...orangeSegment, ...blueSegment2].forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, {
        padding: 50,
        animate: true,
        duration: 1000
    });
    uemcu1Instruction();
}

function uemcu1Instruction() {
    // Remove if already present
    const oldContainer = document.getElementById("instruction-container");
    if (oldContainer) oldContainer.remove();

    const instructionContainer = document.createElement("div");
    instructionContainer.id = "instruction-container";
    instructionContainer.style.position = "absolute";
    instructionContainer.style.bottom = "10px";
    instructionContainer.style.left = "50%";
    instructionContainer.style.transform = "translateX(-50%)";
    instructionContainer.style.zIndex = "9999";
    instructionContainer.style.maxWidth = "400px";

    instructionContainer.innerHTML = `
        <div id="instruction-box">
            <div id="instruction-header">
                <div id="instruction-box-title">Instructions</div>
                <button id="close-instruction" class="instruction-btn">✖</button>
            </div>
            <div id="instruction-values-info">
                1. Walk towards Samson Rd. and wait for a Jeep.

                2. Wait for a Jeepney that has the following route:
                   MCU-Sangandaan

                3. Fee Price:
                   Regular Php 13.00
                   Student/PWD/Seniors Php 11.00

                4. Ask to stop by MCU and walk in.
            </div>
        </div>
        <button id="show-instruction" class="instruction-btn">Show Instructions</button>
    `;

    document.body.appendChild(instructionContainer);

    // Always re-bind after adding to DOM
    const closeBtn = document.getElementById("close-instruction");
    const showBtn = document.getElementById("show-instruction");
    const box = document.getElementById("instruction-box");

    closeBtn.onclick = () => {
        box.style.display = "none";
        showBtn.style.display = "block";
    };
    showBtn.onclick = () => {
        box.style.display = "block";
        showBtn.style.display = "none";
    };
}

//A5 = uemcu A6 = mcuue A7, A9 = uevictory, A8,A0 = victoryue
function mcuue1() {
    if (map.getSource('routeBlue1')) return;

    const blueSegment1 = [
        [120.9868967942578,14.657413714333458], //POINT B (END OF WALK)
        [120.98689533117266,14.657319553018667] //START OF WALK
    ];

    const orangeSegment = [
        [120.98689533117266,14.657319553018667], //mcu
        [120.98431340026195,14.657217581863947],
        [120.98424581932625,14.657350161272959],
        [120.98413867014375,14.657433359280972],
        [120.98397159505492,14.657480579307233],
        [120.98380234243018,14.65742730671245],
        [120.98370284827718,14.65737282205312],
        [120.98364840838235,14.657300207695442],
        [120.98360335442567,14.657236642220965],
        [120.9835273710251,14.657203415237873],
        [120.98342036787898,14.65716527593871],
        [120.98171824593294,14.657184917777087],
        [120.98160992996452,14.657169088720266],
        [120.97949175331564,14.657230022329031],
        [120.9768385767776,14.657590928818806],
        [120.97651989843854,14.657698822261423] //JEEP END
    ];

    const blueSegment2 = [
        [120.97651989843854,14.657698822261423], 
        [120.9763005360121,14.657770842271702], 
        [120.97633900521515,14.657857029461411] 
    ];

    function addRouteSegmentWithPopup(sourceId, layerId, coordinates, color, description) {
        map.addSource(sourceId, {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: coordinates
                    },
                    properties: {
                        description: description
                    }
                }]
            }
        });

        map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': color,
                'line-width': 10
            }
        });

        // Add popup behavior
        map.on('click', layerId, function (e) {
            new mapboxgl.Popup({
                closeButton: true,
                closeOnClick: true,
                offset: 12,
                anchor: 'top'
            })
            .setLngLat(e.lngLat)
            .setHTML(`<div>${e.features[0].properties.description}</div>`)
            .addTo(map);
        });

        // Optional: change cursor on hover
        map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
        });
    }

    // Add all 3 segments with descriptions
    addRouteSegmentWithPopup('routeBlue1', 'layerBlue1', blueSegment1, '#1E90FF', 'Get on an MCU-Sangandaan Jeep');
    addRouteSegmentWithPopup('routeOrange', 'layerOrange', orangeSegment, '#ff6600', 'Ride the Jeep from MCU, around the Monumento Circle, and stop by STI');
    addRouteSegmentWithPopup('routeBlue2', 'layerBlue2', blueSegment2, '#1E90FF', 'Get down from the Jeep and walk to UE');

    // Show exit button and hide go button after route is loaded
    document.getElementById('gobutt').style.display = 'none'; // Hide the Go button
    document.getElementById('exitroute').style.display = 'flex'; // Show the Exit button

    // Waypoint START
    map.loadImage('Others/IMAGES/csslgo.png', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-start')) map.addImage('waypoints-logo-start', image);
        map.addLayer({
            id: 'waypoint-start-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment1[0]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-start',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Waypoint END
    map.loadImage('Others/IMAGES/csslgoend.PNG', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-end')) map.addImage('waypoints-logo-end', image);
        map.addLayer({
            id: 'waypoint-end-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment2[blueSegment2.length - 1]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-end',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Auto fit to all segments
    const bounds = new mapboxgl.LngLatBounds();
    [...blueSegment1, ...orangeSegment, ...blueSegment2].forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, {
        padding: 50,
        animate: true,
        duration: 1000
    });
    mcuue1Instruction();
}

function mcuue1Instruction() {
    // Remove if already present
    const oldContainer = document.getElementById("instruction-container");
    if (oldContainer) oldContainer.remove();

    const instructionContainer = document.createElement("div");
    instructionContainer.id = "instruction-container";
    instructionContainer.style.position = "absolute";
    instructionContainer.style.bottom = "10px";
    instructionContainer.style.left = "50%";
    instructionContainer.style.transform = "translateX(-50%)";
    instructionContainer.style.zIndex = "9999";
    instructionContainer.style.maxWidth = "400px";

    instructionContainer.innerHTML = `
        <div id="instruction-box">
            <div id="instruction-header">
                <div id="instruction-box-title">Instructions</div>
                <button id="close-instruction" class="instruction-btn">✖</button>
            </div>
            <div id="instruction-values-info">
                1. Walk towards the open market and Monumento until you find the Jeep stop.

                2. Wait for a Jeepney that has the following route:
                   MCU-Sangandaan

                3. Fee Price:
                   Regular Php 14.00
                   Student/PWD/Seniors Php 11.00

                4. Ask to stop by STI/UE and walk into UE.
            </div>
        </div>
        <button id="show-instruction" class="instruction-btn">Show Instructions</button>
    `;

    document.body.appendChild(instructionContainer);

    // Always re-bind after adding to DOM
    const closeBtn = document.getElementById("close-instruction");
    const showBtn = document.getElementById("show-instruction");
    const box = document.getElementById("instruction-box");

    closeBtn.onclick = () => {
        box.style.display = "none";
        showBtn.style.display = "block";
    };
    showBtn.onclick = () => {
        box.style.display = "block";
        showBtn.style.display = "none";
    };
}
//A5 = uemcu A6 = mcuue A7, A9 = uevictory, A8,A0 = victoryue
//ue to victory mall front
function uevictory1() {
    if (map.getSource('routeBlue1')) return;

    const blueSegment1 = [
        [120.97615851414673,14.657812456541961], //POINT A (START OF WALK)
        [120.97628977833864,14.657768752157295], //WALKING
        [120.97627621059314,14.657699318075856] // END OF WALK
    ];

    const orangeSegment = [
        [120.97627621059314,14.657699318075856], //JEEP START
        [120.97683808912097,14.657560256948202],
        [120.97951479848126,14.6571839053194],
        [120.98278000244022,14.657075162139805] //puregold  
    ];

    const blueSegment2 = [
        [120.98278000244022,14.657075162139805], //START OF WALK
        [120.98277047290611,14.657042544109174],
        [120.98339107627174,14.657026599460622],
        [120.98348251024447,14.656973020518748],
        [120.9835411891379,14.656930848984757],
        [120.98361940222475,14.656857229179778],
        [120.98368811411888,14.65678911888142],
        [120.98374511648336,14.656695004441943],
        [120.9837802988319,14.656632912598056],
        [120.98381078186145,14.656561043068834],
        [120.98381640331343,14.656538414802824],
        [120.98382466955866,14.656496066178292],
        [120.98381802466452,14.656078041311787],
        [120.98381419267031,14.655712204340617],
        [120.98369992957038,14.65569464468436]//POINT B (END OF WALK)
    ];

    function addRouteSegmentWithPopup(sourceId, layerId, coordinates, color, description) {
        map.addSource(sourceId, {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: coordinates
                    },
                    properties: {
                        description: description
                    }
                }]
            }
        });

        map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': color,
                'line-width': 10
            }
        });

        // Add popup behavior
        map.on('click', layerId, function (e) {
            new mapboxgl.Popup({
                closeButton: true,
                closeOnClick: true,
                offset: 12,
                anchor: 'top'
            })
            .setLngLat(e.lngLat)
            .setHTML(`<div>${e.features[0].properties.description}</div>`)
            .addTo(map);
        });

        // Optional: change cursor on hover
        map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
        });
    }

    // Add all 3 segments with descriptions
    addRouteSegmentWithPopup('routeBlue1', 'layerBlue1', blueSegment1, '#1E90FF', 'Get on an MCU-Sangandaan Jeep');
    addRouteSegmentWithPopup('routeOrange', 'layerOrange', orangeSegment, '#ff6600', 'Ride until you reach Puregold');
    addRouteSegmentWithPopup('routeBlue2', 'layerBlue2', blueSegment2, '#1E90FF', 'Get down from the Jeep and walk past Monumento until you reach Victory Mall');

    // Show exit button and hide go button after route is loaded
    document.getElementById('gobutt').style.display = 'none'; // Hide the Go button
    document.getElementById('exitroute').style.display = 'flex'; // Show the Exit button

    // Waypoint START
    map.loadImage('Others/IMAGES/csslgo.png', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-start')) map.addImage('waypoints-logo-start', image);
        map.addLayer({
            id: 'waypoint-start-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment1[0]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-start',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Waypoint END
    map.loadImage('Others/IMAGES/csslgoend.PNG', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-end')) map.addImage('waypoints-logo-end', image);
        map.addLayer({
            id: 'waypoint-end-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment2[blueSegment2.length - 1]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-end',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Auto fit to all segments
    const bounds = new mapboxgl.LngLatBounds();
    [...blueSegment1, ...orangeSegment, ...blueSegment2].forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, {
        padding: 50,
        animate: true,
        duration: 1000
    });
    uevictory1Instruction();
}

function uevictory1Instruction() {
    // Remove if already present
    const oldContainer = document.getElementById("instruction-container");
    if (oldContainer) oldContainer.remove();

    const instructionContainer = document.createElement("div");
    instructionContainer.id = "instruction-container";
    instructionContainer.style.position = "absolute";
    instructionContainer.style.bottom = "10px";
    instructionContainer.style.left = "50%";
    instructionContainer.style.transform = "translateX(-50%)";
    instructionContainer.style.zIndex = "9999";
    instructionContainer.style.maxWidth = "400px";

    instructionContainer.innerHTML = `
        <div id="instruction-box">
            <div id="instruction-header">
                <div id="instruction-box-title">Instructions</div>
                <button id="close-instruction" class="instruction-btn">✖</button>
            </div>
            <div id="instruction-values-info">
                1. Walk towards the Jeep stop in front of UE.

                2. Wait for a Jeepney that has the following route:
                   Malabon-Monumento
                   MCU-Sangandaan

                3. Fee Price:
                   Regular Php 13.00
                   Student/PWD/Seniors Php 10.00

                4. Ask to stop by Puregold near the overpass.

                5. Walk around Monumento Circle until you see Victory Mall.
            </div>
        </div>
        <button id="show-instruction" class="instruction-btn">Show Instructions</button>
    `;

    document.body.appendChild(instructionContainer);

    // Always re-bind after adding to DOM
    const closeBtn = document.getElementById("close-instruction");
    const showBtn = document.getElementById("show-instruction");
    const box = document.getElementById("instruction-box");

    closeBtn.onclick = () => {
        box.style.display = "none";
        showBtn.style.display = "block";
    };
    showBtn.onclick = () => {
        box.style.display = "block";
        showBtn.style.display = "none";
    };
}
//A5 = uemcu A6 = mcuue A7, A9 = uevictory, A8,A0 = victoryue
function victoryue1() {
    if (map.getSource('routeBlue1')) return;

    const blueSegment1 = [
        [120.98369992957038,14.65569464468436], //POINT B (END OF WALK)
        [120.98381419267031,14.655712204340617],
        [120.98381802466452,14.656078041311787],
        [120.98382466955866,14.656496066178292],
        [120.98381640331343,14.656538414802824],
        [120.98381078186145,14.656561043068834],
        [120.9837802988319,14.656632912598056],
        [120.98374511648336,14.656695004441943],
        [120.98368811411888,14.65678911888142],
        [120.98361940222475,14.656857229179778],
        [120.9835411891379,14.656930848984757],
        [120.98348251024447,14.656973020518748],
        [120.98339107627174,14.657026599460622],
        [120.98277047290611,14.657042544109174],
        [120.98278000244022,14.657075162139805] //START OF WALK
    ];

    const orangeSegment = [
        [120.98278000244022,14.657075162139805], //puregold
        [120.9834364877961,14.657062548896889],
        [120.9836006457927,14.657022953700462],
        [120.9836501180655,14.656959862428039],
        [120.98368855948422,14.656900914242243],
        [120.98375263745771,14.656845410710147],
        [120.98384255021148,14.656789835760748],
        [120.98395494115215,14.656765672735006],
        [120.98404984905693,14.656785003155605],
        [120.98413853266692,14.656810788605256],
        [120.98423075957078,14.656868289621599],
        [120.98430589103941,14.656948415254092],
        [120.9843190317772,14.657066465561243],
        [120.98431340026195,14.657217581863947],
        [120.98424581932625,14.657350161272959],
        [120.98413867014375,14.657433359280972],
        [120.98397159505492,14.657480579307233],
        [120.98380234243018,14.65742730671245],
        [120.98370284827718,14.65737282205312],
        [120.98364840838235,14.657300207695442],
        [120.98360335442567,14.657236642220965],
        [120.9835273710251,14.657203415237873],
        [120.98342036787898,14.65716527593871],
        [120.98171824593294,14.657184917777087],
        [120.98160992996452,14.657169088720266],
        [120.97949175331564,14.657230022329031],
        [120.9768385767776,14.657590928818806],
        [120.97651989843854,14.657698822261423] //JEEP END
    ];

    const blueSegment2 = [
        [120.97651989843854,14.657698822261423], 
        [120.9763005360121,14.657770842271702], 
        [120.97633900521515,14.657857029461411] 
    ];

    function addRouteSegmentWithPopup(sourceId, layerId, coordinates, color, description) {
        map.addSource(sourceId, {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: coordinates
                    },
                    properties: {
                        description: description
                    }
                }]
            }
        });

        map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': color,
                'line-width': 10
            }
        });

        // Add popup behavior
        map.on('click', layerId, function (e) {
            new mapboxgl.Popup({
                closeButton: true,
                closeOnClick: true,
                offset: 12,
                anchor: 'top'
            })
            .setLngLat(e.lngLat)
            .setHTML(`<div>${e.features[0].properties.description}</div>`)
            .addTo(map);
        });

        // Optional: change cursor on hover
        map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
        });
    }

    // Add all 3 segments with descriptions
    addRouteSegmentWithPopup('routeBlue1', 'layerBlue1', blueSegment1, '#1E90FF', 'Step out of the mall and walk towards the Puregold Warehouse entrance');
    addRouteSegmentWithPopup('routeOrange', 'layerOrange', orangeSegment, '#ff6600', 'Ride the Jeep in front of Puregold around Monumento Circle and down Samson Rd');
    addRouteSegmentWithPopup('routeBlue2', 'layerBlue2', blueSegment2, '#1E90FF', 'Get down from the Jeep and walk to UE');

    // Show exit button and hide go button after route is loaded
    document.getElementById('gobutt').style.display = 'none'; // Hide the Go button
    document.getElementById('exitroute').style.display = 'flex'; // Show the Exit button

    // Waypoint START
    map.loadImage('Others/IMAGES/csslgo.png', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-start')) map.addImage('waypoints-logo-start', image);
        map.addLayer({
            id: 'waypoint-start-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment1[0]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-start',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Waypoint END
    map.loadImage('Others/IMAGES/csslgoend.PNG', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-end')) map.addImage('waypoints-logo-end', image);
        map.addLayer({
            id: 'waypoint-end-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment2[blueSegment2.length - 1]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-end',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Auto fit to all segments
    const bounds = new mapboxgl.LngLatBounds();
    [...blueSegment1, ...orangeSegment, ...blueSegment2].forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, {
        padding: 50,
        animate: true,
        duration: 1000
    });
    victoryue1Instruction();
}

function victoryue1Instruction() {
    // Remove if already present
    const oldContainer = document.getElementById("instruction-container");
    if (oldContainer) oldContainer.remove();

    const instructionContainer = document.createElement("div");
    instructionContainer.id = "instruction-container";
    instructionContainer.style.position = "absolute";
    instructionContainer.style.bottom = "10px";
    instructionContainer.style.left = "50%";
    instructionContainer.style.transform = "translateX(-50%)";
    instructionContainer.style.zIndex = "9999";
    instructionContainer.style.maxWidth = "400px";

    instructionContainer.innerHTML = `
        <div id="instruction-box">
            <div id="instruction-header">
                <div id="instruction-box-title">Instructions</div>
                <button id="close-instruction" class="instruction-btn">✖</button>
            </div>
            <div id="instruction-values-info">
                1. Walk out the front of Victory Mall and walk towards monumento circle until you find the Jeepney stop by the footbridge.

                2. Wait for a Jeepney that has the following route:
                   Malabon-Monumento

                3. Fee Price:
                   Regular Php 13.00
                   Student/PWD/Seniors Php 10.00

                4. Ask to stop by UE/STU and walk towards UE when you get down.
            </div>
        </div>
        <button id="show-instruction" class="instruction-btn">Show Instructions</button>
    `;

    document.body.appendChild(instructionContainer);

    // Always re-bind after adding to DOM
    const closeBtn = document.getElementById("close-instruction");
    const showBtn = document.getElementById("show-instruction");
    const box = document.getElementById("instruction-box");

    closeBtn.onclick = () => {
        box.style.display = "none";
        showBtn.style.display = "block";
    };
    showBtn.onclick = () => {
        box.style.display = "block";
        showBtn.style.display = "none";
    };
}

//A5 = uemcu A6 = mcuue A7, A9 = uevictory, A8,A0 = victoryue
//ue to victory mall back
function uevictory2() {
    if (map.getSource('routeBlue1')) return;

    const blueSegment1 = [
        [120.97615851414673, 14.657812456541961], // POINT A (START OF WALK)
        [120.97628977833864, 14.657768752157295], // WALKING
        [120.97627621059314, 14.657699318075856]  // END OF WALK
    ];
    
    const orangeSegment = [
        [120.97627621059314, 14.657699318075856], // JEEP START
        [120.97683808912097, 14.657560256948202],
        [120.97951479848126, 14.6571839053194],
        [120.98208581651141, 14.657095439067945]  // Puregold
    ];
    
    const blueSegment2 = [
        [120.98205111021514, 14.657073136976038],
        [120.98204591587898, 14.657021627647254],
        [120.98209656065421, 14.657021627647254],
        [120.98206777618941, 14.656796437936393],
        [120.98206907478357, 14.656673823949347],
        [120.98205752310315, 14.65590106938275],
        [120.98248809649681, 14.655520845848457],
        [120.98261639947191, 14.655592457598487]
    ];

    function addRouteSegmentWithPopup(sourceId, layerId, coordinates, color, description) {
        map.addSource(sourceId, {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: coordinates
                    },
                    properties: {
                        description: description
                    }
                }]
            }
        });

        map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': color,
                'line-width': 10
            }
        });

        // Add popup behavior
        map.on('click', layerId, function (e) {
            new mapboxgl.Popup({
                closeButton: true,
                closeOnClick: true,
                offset: 12,
                anchor: 'top'
            })
            .setLngLat(e.lngLat)
            .setHTML(`<div>${e.features[0].properties.description}</div>`)
            .addTo(map);
        });

        // Optional: change cursor on hover
        map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
        });
    }

    // Add all 3 segments with descriptions
    addRouteSegmentWithPopup('routeBlue1', 'layerBlue1', blueSegment1, '#1E90FF', 'Get on an MCU-Sangandaan Jeep');
    addRouteSegmentWithPopup('routeOrange', 'layerOrange', orangeSegment, '#ff6600', 'Ride the Jeep from UE to the side street near the Puregold stop');
    addRouteSegmentWithPopup('routeBlue2', 'layerBlue2', blueSegment2, '#1E90FF', 'Walk down the street and towards the building at the end of the street where Jeepneys line up');

    // Show exit button and hide go button after route is loaded
    document.getElementById('gobutt').style.display = 'none'; // Hide the Go button
    document.getElementById('exitroute').style.display = 'flex'; // Show the Exit button

    // Waypoint START
    map.loadImage('Others/IMAGES/csslgo.png', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-start')) map.addImage('waypoints-logo-start', image);
        map.addLayer({
            id: 'waypoint-start-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment1[0]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-start',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Waypoint END
    map.loadImage('Others/IMAGES/csslgoend.PNG', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-end')) map.addImage('waypoints-logo-end', image);
        map.addLayer({
            id: 'waypoint-end-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment2[blueSegment2.length - 1]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-end',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Auto fit to all segments
    const bounds = new mapboxgl.LngLatBounds();
    [...blueSegment1, ...orangeSegment, ...blueSegment2].forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, {
        padding: 50,
        animate: true,
        duration: 1000
    });
    uevictory2Instruction();
}

function uevictory2Instruction() {
    // Remove if already present
    const oldContainer = document.getElementById("instruction-container");
    if (oldContainer) oldContainer.remove();

    const instructionContainer = document.createElement("div");
    instructionContainer.id = "instruction-container";
    instructionContainer.style.position = "absolute";
    instructionContainer.style.bottom = "10px";
    instructionContainer.style.left = "50%";
    instructionContainer.style.transform = "translateX(-50%)";
    instructionContainer.style.zIndex = "9999";
    instructionContainer.style.maxWidth = "400px";

    instructionContainer.innerHTML = `
        <div id="instruction-box">
            <div id="instruction-header">
                <div id="instruction-box-title">Instructions</div>
                <button id="close-instruction" class="instruction-btn">✖</button>
            </div>
            <div id="instruction-values-info">
                1. Walk towards the Jeep stop in front of UE.

                2. Wait for a Jeepney that has the following route:
                   Malabon-Monumento
                   MCU-Sangandaan

                3. Fee Price:
                   Regular Php 13.00
                   Student/PWD/Seniors Php 10.00

                4. Ask to stop by the Andok's .

                5. Walk down the road until you reach the end, which is Victory Mall.
            </div>
        </div>
        <button id="show-instruction" class="instruction-btn">Show Instructions</button>
    `;

    document.body.appendChild(instructionContainer);

    // Always re-bind after adding to DOM
    const closeBtn = document.getElementById("close-instruction");
    const showBtn = document.getElementById("show-instruction");
    const box = document.getElementById("instruction-box");

    closeBtn.onclick = () => {
        box.style.display = "none";
        showBtn.style.display = "block";
    };
    showBtn.onclick = () => {
        box.style.display = "block";
        showBtn.style.display = "none";
    };
}

function victoryue2() {
    if (map.getSource('routeBlue1')) return;

    const blueSegment1 = [
        [120.98261639947191,14.655592457598487],
        [120.98248809649681,14.655520845848457],
        [120.98205752310315,14.65590106938275],
        [120.98206907478357,14.656673823949347],
        [120.98206777618941,14.656796437936393],
        [120.98211007682625,14.65703463658555],
        [120.98278520158271,14.657058137079773]
    ];

    const orangeSegment = [
        [120.98278000244022,14.657075162139805], //puregold
        [120.9834364877961,14.657062548896889],
        [120.9836006457927,14.657022953700462],
        [120.9836501180655,14.656959862428039],
        [120.98368855948422,14.656900914242243],
        [120.98375263745771,14.656845410710147],
        [120.98384255021148,14.656789835760748],
        [120.98395494115215,14.656765672735006],
        [120.98404984905693,14.656785003155605],
        [120.98413853266692,14.656810788605256],
        [120.98423075957078,14.656868289621599],
        [120.98430589103941,14.656948415254092],
        [120.9843190317772,14.657066465561243],
        [120.98431340026195,14.657217581863947],
        [120.98424581932625,14.657350161272959],
        [120.98413867014375,14.657433359280972],
        [120.98397159505492,14.657480579307233],
        [120.98380234243018,14.65742730671245],
        [120.98370284827718,14.65737282205312],
        [120.98364840838235,14.657300207695442],
        [120.98360335442567,14.657236642220965],
        [120.9835273710251,14.657203415237873],
        [120.98342036787898,14.65716527593871],
        [120.98171824593294,14.657184917777087],
        [120.98160992996452,14.657169088720266],
        [120.97949175331564,14.657230022329031],
        [120.9768385767776,14.657590928818806],
        [120.97651989843854,14.657698822261423] //JEEP END
    ];

    const blueSegment2 = [
        [120.97651989843854,14.657698822261423], 
        [120.9763005360121,14.657770842271702], 
        [120.97633900521515,14.657857029461411] 
    ];

    function addRouteSegmentWithPopup(sourceId, layerId, coordinates, color, description) {
        map.addSource(sourceId, {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: coordinates
                    },
                    properties: {
                        description: description
                    }
                }]
            }
        });

        map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': color,
                'line-width': 10
            }
        });

        // Add popup behavior
        map.on('click', layerId, function (e) {
            new mapboxgl.Popup({
                closeButton: true,
                closeOnClick: true,
                offset: 12,
                anchor: 'top'
            })
            .setLngLat(e.lngLat)
            .setHTML(`<div>${e.features[0].properties.description}</div>`)
            .addTo(map);
        });

        // Optional: change cursor on hover
        map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
        });
    }

    // Add all 3 segments with descriptions
    addRouteSegmentWithPopup('routeBlue1', 'layerBlue1', blueSegment1, '#1E90FF', 'Step out of the mall and walk down the street towards Samson Rd');
    addRouteSegmentWithPopup('routeOrange', 'layerOrange', orangeSegment, '#ff6600', 'Ride the Jeep in front of Puregold around Monumento Circle and down Samson Rd');
    addRouteSegmentWithPopup('routeBlue2', 'layerBlue2', blueSegment2, '#1E90FF', 'Get down from the Jeep and walk to UE');

    // Show exit button and hide go button after route is loaded
    document.getElementById('gobutt').style.display = 'none'; // Hide the Go button
    document.getElementById('exitroute').style.display = 'flex'; // Show the Exit button

    // Waypoint START
    map.loadImage('Others/IMAGES/csslgo.png', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-start')) map.addImage('waypoints-logo-start', image);
        map.addLayer({
            id: 'waypoint-start-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment1[0]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-start',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Waypoint END
    map.loadImage('Others/IMAGES/csslgoend.PNG', function (error, image) {
        if (error) throw error;
        if (!map.hasImage('waypoints-logo-end')) map.addImage('waypoints-logo-end', image);
        map.addLayer({
            id: 'waypoint-end-layer',
            type: 'symbol',
            source: {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: blueSegment2[blueSegment2.length - 1]
                        }
                    }]
                }
            },
            layout: {
                'icon-image': 'waypoints-logo-end',
                'icon-size': 0.08,
                'icon-allow-overlap': true,
                'icon-offset': [0, -150]
            }
        });
    });

    // Auto fit to all segments
    const bounds = new mapboxgl.LngLatBounds();
    [...blueSegment1, ...orangeSegment, ...blueSegment2].forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, {
        padding: 50,
        animate: true,
        duration: 1000
    });
    victoryue2Instruction();
}

function victoryue1Instruction() {
    // Remove if already present
    const oldContainer = document.getElementById("instruction-container");
    if (oldContainer) oldContainer.remove();

    const instructionContainer = document.createElement("div");
    instructionContainer.id = "instruction-container";
    instructionContainer.style.position = "absolute";
    instructionContainer.style.bottom = "10px";
    instructionContainer.style.left = "50%";
    instructionContainer.style.transform = "translateX(-50%)";
    instructionContainer.style.zIndex = "9999";
    instructionContainer.style.maxWidth = "400px";

    instructionContainer.innerHTML = `
        <div id="instruction-box">
            <div id="instruction-header">
                <div id="instruction-box-title">Instructions</div>
                <button id="close-instruction" class="instruction-btn">✖</button>
            </div>
            <div id="instruction-values-info">
                1. Walk out the back of Victory Mall and walk down the street until you reach Samson Rd.

                2. Wait for a Jeepney that has the following route:
                   Malabon-Monumento

                3. Fee Price:
                   Regular Php 13.00
                   Student/PWD/Seniors Php 10.00

                4. Ask to stop by UE/STU and walk towards UE when you get down.
            </div>
        </div>
        <button id="show-instruction" class="instruction-btn">Show Instructions</button>
    `;

    document.body.appendChild(instructionContainer);

    
    const closeBtn = document.getElementById("close-instruction");
    const showBtn = document.getElementById("show-instruction");
    const box = document.getElementById("instruction-box");

    closeBtn.onclick = () => {
        box.style.display = "none";
        showBtn.style.display = "block";
    };
    showBtn.onclick = () => {
        box.style.display = "block";
        showBtn.style.display = "none";
    };
}