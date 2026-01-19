import 'https://maps.googleapis.com/maps/api/js?key=AIzaSyAx7YrWFehCJR6T_ko2EhO_kpwfUzviVIs&callback=console.debug&libraries=maps,marker&v=beta'

const getMap = async (id) => {
    const mapElement = document.getElementById(id || 'map');
    await customElements.whenDefined('gmp-map');
    return mapElement.innerMap;
}

const addMarkers = async (map, geoJsonUrl, filters) => {
    const response = await fetch(geoJsonUrl);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const geoJsonData = await response.json();
    Array.from(geoJsonData.features)
        .filter(feature => !filters || Object.entries(filters).every(([key, value]) => feature.properties[key] === value))
        .forEach(feature => {
            let position = { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] };
            const advancedMarkerElement = new google.maps.marker.AdvancedMarkerElement({
                map,
                content: buildContent(feature.properties),
                position,
                title: feature.properties.name,
            });
            advancedMarkerElement.addListener("click", () => {
                toggleHighlight(advancedMarkerElement, feature.properties);
            });
        })
}

const loadGeoJSON = async (map, geoJsonUrl, style) => {
    const response = await fetch(geoJsonUrl);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const geoJsonData = await response.json();
    const layer = new google.maps.Data();
    layer.addGeoJson(geoJsonData);
    layer.setMap(map);

    layer.setStyle((feature) => {
        return {
            fillColor: style?.fillColor ?? feature.getProperty('fillColor') ?? '#000000',
            fillOpacity: style?.fillOpacity ?? feature.getProperty('fillOpacity') ?? 0.2,
            strokeColor: style?.strokeColor ?? feature.getProperty('strokeColor') ?? '#000000',
            strokeWeight: style?.strokeWeight ?? feature.getProperty('strokeWeight') ?? 1,
            strokeOpacity: style?.strokeOpacity ?? feature.getProperty('strokeOpacity') ?? 0.9,
            zIndex: style?.zIndex ?? feature.getProperty('zIndex') ?? 1
        };
    });
}

const fitBounds = (map) => {
    const bounds = new google.maps.LatLngBounds();
    map.data.forEach(function (feature) {
        const geometry = feature.getGeometry();
        geometry.forEachLatLng(function (latLng) {
            bounds.extend(latLng);
        });
    });
    map.fitBounds(bounds);
}

function toggleHighlight(markerView, property) {
    if (markerView.content.classList.contains("highlight")) {
        markerView.content.classList.remove("highlight");
        markerView.zIndex = null;
    }
    else {
        markerView.content.classList.add("highlight");
        markerView.zIndex = 1;
    }
}
function buildContent(feature) {
    const content = document.createElement("div");
    content.classList.add("property");
    content.style.setProperty('--accent', feature['marker-color'] || 'red');
    content.innerHTML = `
    <div class="icon">
        <i aria-hidden="true" class="fa fa-icon fa-${feature['marker-symbol'] || 'house'}" title="${feature.title || feature.name}"></i>
        <span class="fa-sr-only">${feature['marker-symbol'] || 'house'}</span>
    </div>
    <div class="details">
        <div class="title">${feature.title || feature.name}</div>
        <div class="address">${feature.address}</div>
        <div class="description">${feature.description || ''}</div>`;
    return content;
}

export { getMap, loadGeoJSON, addMarkers, fitBounds };