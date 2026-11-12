mapboxgl.accessToken = 'YOUR_MAPBOX_ACCESS_TOKEN';
navigator.geolocation.getCurrentPosition(GPSaccept, GPSdenied, { enableHighAccuracy: true})

function GPSaccept(locate){
 PUBTAlocating([locate.coords.longitude, locate.coords.latitude])
}

function GPSdenied(){
    PUBTAlocating([120.977673, 14.657598])
}


function PUBTAlocating(center){
const map = new mapboxgl.Map({
	container: 'map',
	style: 'mapbox://styles/pubta/cm1xcjw1000u801r7gqhbfhoi',
    center: center,
    zoom: 15
})

//plugin for zoom in out and view
const nav = new mapboxgl.NavigationControl();
map.addControl(nav, 'bottom-right');

//plugins for directions (need ng paglalagyan ng input)
const directions = new MapboxDirections({
    accessToken: 'YOUR_MAPBOX_ACCESS_TOKEN',
  });
  

  map.addControl(
    new MapboxDirections({
        accessToken: mapboxgl.accessToken
    }),
    'top' );

}



