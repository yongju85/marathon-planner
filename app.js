// Leaflet + OpenStreetMap 전역 변수
let map;
let currentRoute = null; // Polyline 객체
let currrentRouteData = null; // 현재 생성된 경로 데이터 보관용
let startMarker = null; // 출발지 마커
let endMarker = null; // 도착지 마커
let customMarkers = []; // 커스텀 마커 관리 배열 (숫자 마커)
let routeType = 'circular';
let savedRoutes = []; // 저장된 코스 목록
let activePickTarget = 'start'; // 지도 클릭 시 설정할 대상 ('start' or 'end')

// 지도 선택으로 얻은 정확한 좌표 저장 (주소 재검색 시 오차/오류 방지)
let selectedStartCoords = null;
let selectedEndCoords = null;

let raceRecords = []; // 대회 기록 목록
let certificateBase64 = null; // 업로드용 임시 보관
let editingRecordId = null; // 현재 수정 중인 기록의 ID

// 이벤트 리스너 설정 (인라인 핸들러 대체 - 모바일 호환성 제고)
function setupEventListeners() {
    // 탭 버튼 이벤트
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            const tab = this.getAttribute('data-tab');
            if (tab) showTab(e, tab);
        });
    });

    // 날씨/미세먼지 이벤트
    const weatherLocInput = document.getElementById('weather-location');
    if (weatherLocInput) {
        weatherLocInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') checkWeatherAndDust();
        });
    }
    const weatherSearchBtn = document.getElementById('weather-search-btn');
    if (weatherSearchBtn) weatherSearchBtn.addEventListener('click', checkWeatherAndDust);

    const weatherCheckBtn = document.getElementById('weather-check-btn');
    if (weatherCheckBtn) weatherCheckBtn.addEventListener('click', checkWeatherAndDust);

    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            setQuickTime(this.getAttribute('data-time'));
        });
    });

    // 코스 플래너 이벤트
    const locInput = document.getElementById('location');
    if (locInput) {
        locInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') searchLocation('start');
        });
    }
    const plannerSearchStart = document.getElementById('planner-search-start');
    if (plannerSearchStart) plannerSearchStart.addEventListener('click', () => searchLocation('start'));

    const plannerPickStart = document.getElementById('planner-pick-start');
    if (plannerPickStart) plannerPickStart.addEventListener('click', () => startMapSelection('start'));

    const locEndInput = document.getElementById('location-end');
    if (locEndInput) {
        locEndInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') searchLocation('end');
        });
    }
    const plannerSearchEnd = document.getElementById('planner-search-end');
    if (plannerSearchEnd) plannerSearchEnd.addEventListener('click', () => searchLocation('end'));

    const plannerPickEnd = document.getElementById('planner-pick-end');
    if (plannerPickEnd) plannerPickEnd.addEventListener('click', () => startMapSelection('end'));

    const sameAsStartBtn = document.getElementById('set-same-start-btn');
    if (sameAsStartBtn) sameAsStartBtn.addEventListener('click', setSameAsStart);

    const courseGenBtn = document.getElementById('course-generate-btn');
    if (courseGenBtn) courseGenBtn.addEventListener('click', generateRoute);

    const appResetBtn = document.getElementById('app-reset-btn');
    if (appResetBtn) appResetBtn.addEventListener('click', resetApp);

    // 대회 기록 이벤트
    const racePhotoInput = document.getElementById('race-photo');
    if (racePhotoInput) {
        racePhotoInput.addEventListener('change', function () {
            previewRecordImage(this);
        });
    }
    const saveRaceBtn = document.getElementById('save-race-btn');
    if (saveRaceBtn) saveRaceBtn.addEventListener('click', addRaceRecord);

    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', resetRaceForm);

    // 페이스 계산기 이벤트
    const calcInputs = ['calc-distance', 'calc-hours', 'calc-minutes', 'calc-seconds'];
    calcInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', calculatePace);
    });
    const distUnit = document.getElementById('distance-unit');
    if (distUnit) distUnit.addEventListener('change', calculatePace);

    // 페이스 계산기 프리셋 버튼
    console.log('[디버그] 프리셋 버튼 이벤트 리스너 등록 시작');
    const presetButtons = document.querySelectorAll('.preset-buttons button');
    console.log('[디버그] 찾은 프리셋 버튼 개수:', presetButtons.length);
    presetButtons.forEach((btn, index) => {
        const km = btn.getAttribute('data-km');
        console.log(`[디버그] 프리셋 버튼 ${index + 1}: ${km}km`);
        btn.addEventListener('click', function () {
            console.log('[디버그] 프리셋 버튼 클릭됨:', km);
            setDistance(parseFloat(km));
        });
    });

    const paceMin = document.getElementById('calc-pace-min');
    const paceSec = document.getElementById('calc-pace-sec');
    if (paceMin) paceMin.addEventListener('input', calculateFromPace);
    if (paceSec) paceSec.addEventListener('input', calculateFromPace);

    const calcSpeed = document.getElementById('calc-speed');
    if (calcSpeed) calcSpeed.addEventListener('input', calculateFromSpeed);

    const calcResetBtn = document.getElementById('calc-reset-btn');
    if (calcResetBtn) calcResetBtn.addEventListener('click', resetCalculator);
}

// 지도 초기화
function initMap() {
    const container = document.getElementById('map');
    if (!container) return;

    // Leaflet 지도 초기화 (서울 시청 중심)
    map = L.map('map').setView([37.566826, 126.9786567], 13);

    // OpenStreetMap 타일 레이어 추가
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    // 저장된 데이터 로드
    loadSavedRoutesFromStorage();
    loadRaceRecordsFromStorage();

    // 지도 클릭 시 위치 설정
    map.on('click', function (e) {
        setLocationFromMap(e.latlng, activePickTarget);
    });

    // 입력창 변경 감지
    const locInput = document.getElementById('location');
    if (locInput) {
        locInput.addEventListener('input', function () {
            selectedStartCoords = null;
            updateRouteTypeUI();
        });
    }
    const locEndInput = document.getElementById('location-end');
    if (locEndInput) {
        locEndInput.addEventListener('input', function () {
            selectedEndCoords = null;
            updateRouteTypeUI();
        });
    }

    updateRouteTypeUI();
    updateMapGuidance();
}

// SDK 로드 확인 및 초기화 (통합 버전)
window.onload = function () {
    initMap();
    setupEventListeners();
    setDefaultTime();
};

function startMapSelection(target) {
    activePickTarget = target;
    updateMapGuidance();
}

function updateMapGuidance() {
    const guidance = document.getElementById('map-guidance');
    if (!guidance) return;

    if (activePickTarget === 'start') {
        guidance.innerText = '📍 출발지를 선택해주세요';
        guidance.classList.remove('success');
    } else if (activePickTarget === 'end') {
        guidance.innerText = '🏁 도착지를 선택해주세요';
        guidance.classList.remove('success');
    } else if (activePickTarget === 'done') {
        guidance.innerText = '✅ 위치 설정 완료';
        guidance.classList.add('success');
    }
}

function setLocationFromMap(latlng, target) {
    // 1. 내부 좌표 변수에 저장 (generateRoute에서 우선 사용)
    if (target === 'start') {
        selectedStartCoords = { lat: latlng.lat, lon: latlng.lng };
        if (startMarker) map.removeLayer(startMarker);
        startMarker = L.marker([latlng.lat, latlng.lng]).addTo(map);

        // 자동으로 다음 단계(도착지)로 전환
        activePickTarget = 'end';
        updateMapGuidance();
    } else {
        selectedEndCoords = { lat: latlng.lat, lon: latlng.lng };
        if (endMarker) map.removeLayer(endMarker);

        // 도착지 마커 (빨간색)
        const redIcon = L.icon({
            iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });
        endMarker = L.marker([latlng.lat, latlng.lng], { icon: redIcon }).addTo(map);

        activePickTarget = 'done';
        updateMapGuidance();
    }

    // 2. 주소 변환 및 입력창 업데이트 (사용자 확인용) - Nominatim API 사용
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}&zoom=18&addressdetails=1`;
    fetch(url, {
        headers: { 'User-Agent': 'MarathonJoggingPlanner/1.0' }
    })
        .then(response => response.json())
        .then(data => {
            let address = '';
            if (data.display_name) {
                address = data.display_name;
            } else {
                // 주소 변환 실패 시 좌표 표시
                address = `지도 선택 위치 (${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)})`;
            }

            const inputId = target === 'start' ? 'location' : 'location-end';
            document.getElementById(inputId).value = address;

            // UI 상태 업데이트
            updateRouteTypeUI();
        })
        .catch(error => {
            console.error('Geocoding error:', error);
            const address = `지도 선택 위치 (${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)})`;
            const inputId = target === 'start' ? 'location' : 'location-end';
            document.getElementById(inputId).value = address;
            updateRouteTypeUI();
        });
}

// 편도/왕복/원형 코스 옵션 UI 자동 제어
function updateRouteTypeUI() {
    const startVal = document.getElementById('location').value.trim();
    const endVal = document.getElementById('location-end').value.trim();
    const isDifferent = startVal && endVal && (startVal !== endVal);

    // 거리 입력창 제어 (기존 로직 포함)
    const distInput = document.getElementById('distance');
    const infoMsg = document.getElementById('distance-info');

    if (isDifferent) {
        // 출발 != 도착: 원형 코스 불가
        document.querySelector('.route-btn[data-type="circular"]').style.display = 'none';

        // 현재 선택된게 원형이면 '편도(직선)'로 강제 변경
        if (document.querySelector('.route-btn.active').dataset.type === 'circular') {
            document.querySelector('.route-btn[data-type="point-to-point"]').click();
        }

        distInput.disabled = true;
        distInput.placeholder = "자동 계산됨";
        infoMsg.style.display = 'block';
    } else {
        // 출발 == 도착 (혹은 도착지 비어있음): 모든 옵션 가능
        document.querySelector('.route-btn[data-type="circular"]').style.display = 'block';

        distInput.disabled = false;
        distInput.placeholder = "예: 5";
        infoMsg.style.display = 'none';
    }
}

function setSameAsStart() {
    const startVal = document.getElementById('location').value;
    document.getElementById('location-end').value = startVal;

    // 좌표도 복사
    if (selectedStartCoords) {
        selectedEndCoords = { ...selectedStartCoords };

        // 도착지 마커 생성
        if (endMarker) map.removeLayer(endMarker);
        const redIcon = L.icon({
            iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });
        endMarker = L.marker([selectedStartCoords.lat, selectedStartCoords.lon], { icon: redIcon }).addTo(map);
    }

    updateRouteTypeUI();
}

function createEndMarkerImage() {
    // 도착지 마커 이미지 (빨간 깃발 등) - 여기서는 기본 마커 색상 변경이 어려우므로 스프라이트 사용하거나 기본 마커 사용
    // 간단히 null 리턴하여 기본 마커 사용하되, 추후 커스텀 가능
    return null;
}

// 현재 시간 기본값 설정
function setDefaultTime() {
    const now = new Date();
    // now.setHours(now.getHours() + 1); // +1시간 제거 요청
    const formatted = toLocalISOString(now);

    // 코스 생성 탭의 시간
    const joggingTime = document.getElementById('jogging-time');
    if (joggingTime) joggingTime.value = formatted;

    // 날씨 탭의 시간
    const weatherTime = document.getElementById('weather-time');
    if (weatherTime) weatherTime.value = formatted;
}

// 시간 포맷 헬퍼 (KST 고려)
function toLocalISOString(date) {
    const offset = date.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(date - offset)).toISOString().slice(0, 16);
    return localISOTime;
}

// 빠른 시간 설정
function setQuickTime(mode) {
    const now = new Date();
    let targetDate = new Date();

    if (mode === 'today_evening') {
        targetDate.setHours(18, 0, 0, 0);
        // 만약 이미 18시가 지났다면 내일 18시로 할지? -> 요청은 "오늘 오후 6시"이므로 그대로 둠.
        // 과거라면 날씨 조회시 과거 데이터가 나오거나 할 것임.
    } else if (mode === 'tomorrow_morning') {
        targetDate.setDate(now.getDate() + 1);
        targetDate.setHours(7, 0, 0, 0);
    } else if (mode === 'now') {
        targetDate = now;
    }

    const formatted = toLocalISOString(targetDate);
    document.getElementById('weather-time').value = formatted;

    // 코스 생성 탭 시간도 같이 동기화
    if (document.getElementById('jogging-time')) {
        document.getElementById('jogging-time').value = formatted;
    }
}

// 코스 타입 선택
document.querySelectorAll('.route-btn').forEach(btn => {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.route-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        routeType = this.dataset.type;
    });
});

// 좌표 검색 (Nominatim API - OpenStreetMap Geocoding)
function runSearch(location) {
    return new Promise((resolve, reject) => {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1&addressdetails=1`;
        fetch(url, {
            headers: { 'User-Agent': 'MarathonJoggingPlanner/1.0' }
        })
            .then(response => response.json())
            .then(data => {
                if (data && data.length > 0) {
                    resolve({
                        lat: parseFloat(data[0].lat),
                        lon: parseFloat(data[0].lon)
                    });
                } else {
                    reject(new Error('주소 또는 장소를 찾을 수 없습니다.'));
                }
            })
            .catch(error => {
                console.error('Search error:', error);
                reject(new Error('검색 중 오류가 발생했습니다.'));
            });
    });
}

// OSRM 경로 요청
async function getWalkingRoute(start, end, useBikePath = true) {
    const profiles = useBikePath ? ['bike', 'foot'] : ['foot'];

    for (const profile of profiles) {
        const url = `https://router.project-osrm.org/route/v1/${profile}/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson&steps=true`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.code === 'Ok' && data.routes.length > 0) {
                const route = data.routes[0];
                const coords = route.geometry.coordinates.map(c => [c[1], c[0]]); // [lat, lon]
                return { coords: coords, steps: route.legs[0].steps };
            }
        } catch (error) {
            console.error(`경로 생성 오류 (${profile}):`, error);
        }
    }
    return null;
}

// 목적지 계산 (랜덤성 추가)
function calculateDestinations(center, distance) {
    const destinations = [];
    const numPoints = 4;

    // 랜덤 반경 (0.85 ~ 1.15배)
    const radiusVariation = 0.85 + Math.random() * 0.3;
    const radiusInKm = (distance / (2 * Math.PI)) * 0.55 * radiusVariation;
    const radiusInDegrees = radiusInKm / 111;

    // 랜덤 시작 각도
    const startAngle = Math.random() * 2 * Math.PI;

    for (let i = 0; i < numPoints; i++) {
        const angle = startAngle + (i / numPoints) * 2 * Math.PI;
        // 각 포인트 거리 랜덤성
        const pointRadius = radiusInDegrees * (0.9 + Math.random() * 0.2);

        const lat = center.lat + pointRadius * Math.cos(angle);
        const lon = center.lon + pointRadius * Math.sin(angle) / Math.cos(center.lat * Math.PI / 180);
        destinations.push([lon, lat]);
    }
    return destinations;
}

async function findNearbyParks(center, radiusKm) {
    const radiusMeters = radiusKm * 1000;
    const query = `[out:json][timeout:10];(way["leisure"="park"](around:${radiusMeters},${center.lat},${center.lon});relation["leisure"="park"](around:${radiusMeters},${center.lat},${center.lon}););out center;`;

    try {
        const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
        const data = await response.json();
        return data.elements.filter(el => el.center).map(el => ({ name: el.tags?.name || '공원', lat: el.center.lat, lon: el.center.lon })).slice(0, 3);
    } catch { return []; }
}

async function generateCircularRoute(center, targetDistance) {
    const startLatLon = [center.lat, center.lon];
    const radiusKm = (targetDistance / (2 * Math.PI)) * 0.8;
    const parks = await findNearbyParks(center, radiusKm);
    let destinations = calculateDestinations(center, targetDistance);

    if (parks.length > 0) {
        const mixedDestinations = [];
        const parkCoords = parks.map(p => [p.lon, p.lat]);
        for (let i = 0; i < destinations.length; i++) {
            mixedDestinations.push(destinations[i]);
            if (i < parkCoords.length) mixedDestinations.push(parkCoords[i]);
        }
        destinations = mixedDestinations;
    }

    let allPoints = [];
    let allSteps = [];
    let currentStart = startLatLon;

    for (let i = 0; i < destinations.length; i++) {
        const dest = [destinations[i][1], destinations[i][0]];
        const routeData = await getWalkingRoute(currentStart, dest, true);

        if (routeData) {
            allPoints = allPoints.concat(routeData.coords);
            if (routeData.steps) allSteps = allSteps.concat(routeData.steps);
            currentStart = dest;
        }

        if (i === destinations.length - 1) {
            const returnRouteData = await getWalkingRoute(currentStart, startLatLon, true);
            if (returnRouteData) {
                allPoints = allPoints.concat(returnRouteData.coords);
                if (returnRouteData.steps) allSteps = allSteps.concat(returnRouteData.steps);
            }
        }
    }
    return allPoints.length > 0 ? { coords: allPoints, steps: allSteps } : null;
}

async function generatePointToPointRoute(center, distance) {
    const radiusInDegrees = distance / 111;
    const endLat = center.lat + radiusInDegrees * 0.7;
    const endLon = center.lon + radiusInDegrees * 0.5;
    const start = [center.lat, center.lon];
    const end = [endLat, endLon];
    return await getWalkingRoute(start, end, true);
}

async function generateOutAndBackRoute(center, distance) {
    const oneWayDistance = distance / 2;
    const radiusInDegrees = oneWayDistance / 111;
    const endLat = center.lat + radiusInDegrees * 0.7;
    const endLon = center.lon + radiusInDegrees * 0.5;
    const start = [center.lat, center.lon];
    const end = [endLat, endLon];

    const outRouteData = await getWalkingRoute(start, end, true);
    if (!outRouteData) return null;

    const backCoords = [...outRouteData.coords].reverse();
    return {
        coords: outRouteData.coords.concat(backCoords),
        steps: outRouteData.steps
    };
}

async function getWeather(lat, lon, datetime) {
    const date = new Date(datetime);
    const dateStr = getLocalYMD(date);
    const hour = date.getHours();
    try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,weathercode,windspeed_10m,precipitation_probability&timezone=auto&forecast_days=7`);
        const data = await response.json();
        const timeIndex = data.hourly.time.findIndex(t => {
            const apiDate = new Date(t);
            return getLocalYMD(apiDate) === dateStr && apiDate.getHours() === hour;
        });
        if (timeIndex === -1) return null;

        const code = data.hourly.weathercode[timeIndex];
        const conditions = { 0: '맑음 ☀️', 1: '대체로 맑음 🌤️', 2: '흐림 ⛅', 3: '흐림 ☁️', 45: '안개 🌫️', 48: '안개 🌫️', 51: '이슬비 🌧️', 53: '이슬비 🌧️', 55: '이슬비 🌧️', 61: '비 🌧️', 63: '비 🌧️', 65: '비 🌧️', 71: '눈 🌨️', 73: '눈 🌨️', 75: '눈 🌨️', 95: '뇌우 ⛈️' };

        return {
            temperature: Math.round(data.hourly.temperature_2m[timeIndex]),
            condition: conditions[code] || '흐림',
            windSpeed: Math.round(data.hourly.windspeed_10m[timeIndex]),
            precipitation: data.hourly.precipitation_probability[timeIndex],
            humidity: data.hourly.relative_humidity_2m[timeIndex]
        };
    } catch (e) {
        return null;
    }
}

async function getAirQuality(lat, lon, datetime) {
    const date = new Date(datetime);
    const dateStr = getLocalYMD(date);
    const hour = date.getHours();
    try {
        // 유럽 공기질 지수(EAQI) 대신 PM10, PM2.5 원시 데이터 사용
        const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm10,pm2_5&timezone=auto`;
        const response = await fetch(url);
        const data = await response.json();

        const timeIndex = data.hourly.time.findIndex(t => {
            const apiDate = new Date(t);
            return getLocalYMD(apiDate) === dateStr && apiDate.getHours() === hour;
        });

        if (timeIndex === -1) return null;

        return {
            pm10: data.hourly.pm10[timeIndex],
            pm2_5: data.hourly.pm2_5[timeIndex]
        };
    } catch (e) {
        console.error(e);
        return null; // 데이터 없음
    }
}

function getDustStatus(value, type) {
    let status = '';
    let colorClass = '';
    let message = '';

    if (type === 'pm10') {
        if (value <= 30) { status = '좋음'; colorClass = 'dust-good'; message = '공기가 맑아요!'; }
        else if (value <= 80) { status = '보통'; colorClass = 'dust-normal'; message = '무난한 날씨입니다.'; }
        else if (value <= 150) { status = '나쁨'; colorClass = 'dust-bad'; message = '마스크 착용 필수!'; }
        else { status = '매우 나쁨'; colorClass = 'dust-very-bad'; message = '외출을 자제하세요.'; }
    } else {
        // PM2.5 기준 (임바표 러너 가이드)
        if (value <= 25) {
            status = '초록불 (축복)';
            colorClass = 'dust-good';
            message = '축복! 맘껏 뛰어도 OK! 🏃‍♂️✨';
        } else if (value <= 45) {
            status = '노란불 (주의)';
            colorClass = 'dust-normal';
            message = '조깅 OK, 빡런 NO. 코로 숨 쉬세요. 👃';
        } else if (value <= 75) {
            status = '주황불 (경고)';
            colorClass = 'dust-bad';
            message = '실내 운동 하세요! 🏠💪';
        } else {
            status = '빨강불 (금지)';
            colorClass = 'dust-very-bad';
            message = '절대 금지. 집에서 쉬세요. 🛌⛔';
        }
    }
    return { status, colorClass, message };
}

async function checkWeatherAndDust() {
    const location = document.getElementById('weather-location').value;
    const timeVal = document.getElementById('weather-time').value;

    if (!location || !timeVal) return alert('지역과 시간을 확인해주세요.');

    const display = document.getElementById('weather-display-panel');
    display.innerHTML = '<div class="spinner" style="border-top-color: #667eea; border-right-color: #ddd; border-bottom-color: #ddd; border-left-color: #ddd;"></div><p>날씨 정보를 불러오는 중...</p>';

    try {
        const coords = await runSearch(location);

        // 날씨와 미세먼지 동시 요청
        const [weather, air] = await Promise.all([
            getWeather(coords.lat, coords.lon, timeVal),
            getAirQuality(coords.lat, coords.lon, timeVal)
        ]);

        if (!weather) throw new Error('날씨 정보를 가져올 수 없습니다.');

        // 렌더링
        let airHtml = '';
        if (air) {
            const pm10Stat = getDustStatus(air.pm10, 'pm10');
            const pm25Stat = getDustStatus(air.pm2_5, 'pm2_5');

            airHtml = `
                <div class="dust-guidance-box ${pm25Stat.colorClass}">
                    <div class="guidance-title">🏃 러너 미세먼지 신호등 (PM2.5 기준)</div>
                    <div class="guidance-message">"${pm25Stat.message}"</div>
                </div>

                <div class="dust-container">
                    <div class="dust-box ${pm10Stat.colorClass}">
                        <div class="dust-label">미세먼지 (PM10)</div>
                        <div class="dust-value">${air.pm10} µg/m³</div>
                        <div class="dust-status">${pm10Stat.status}</div>
                    </div>
                    <div class="dust-box ${pm25Stat.colorClass}">
                        <div class="dust-label">초미세먼지 (PM2.5)</div>
                        <div class="dust-value">${air.pm2_5} µg/m³</div>
                        <div class="dust-status">${pm25Stat.status}</div>
                    </div>
                </div>
            `;
        } else {
            airHtml = '<div class="no-data">미세먼지 정보 없음</div>';
        }

        display.innerHTML = `
            <h2 style="margin-bottom: 20px; color: #333;">🌡️ ${location} 날씨 예보</h2>
            <div class="weather-dashboard">
                <div class="weather-main-card">
                    <div class="weather-icon">${weather.condition.split(' ')[1] || '🌤️'}</div>
                    <div class="weather-temp">${weather.temperature}°C</div>
                    <div class="weather-desc">${weather.condition.split(' ')[0]}</div>
                </div>
                
                <div class="weather-grid">
                    <div class="weather-item">
                        <span class="label">강수 확률</span>
                        <span class="val">${weather.precipitation}%</span>
                    </div>
                    <div class="weather-item">
                        <span class="label">습도</span>
                        <span class="val">${weather.humidity}%</span>
                    </div>
                    <div class="weather-item">
                        <span class="label">풍속</span>
                        <span class="val">${weather.windSpeed} km/h</span>
                    </div>
                </div>
            </div>
            
            <h3 style="margin: 20px 0 10px; color: #667eea; align-self: flex-start;">😷 공기질 정보</h3>
            ${airHtml}
        `;

    } catch (e) {
        display.innerHTML = `<p style="color: red;">오류 발생: ${e.message}</p>`;
    }
}

function generateCourseDescription(steps, routeType) {
    return `<div class="course-summary">
        ${routeType === 'circular' ? '⭕ 원형 코스' : routeType === 'out-and-back' ? '↔️ 왕복 코스' : '➡️ 직선 코스'} 생성 완료!
    </div>`;
}

// 메인 코스 생성 함수
async function generateRoute() {
    const startLoc = document.getElementById('location').value;
    const endLoc = document.getElementById('location-end').value;

    // 도착지가 비어있으면 출발지와 동일한 것으로 간주
    const finalEndLoc = endLoc ? endLoc : startLoc;
    const isRoundTrip = startLoc === finalEndLoc;

    const distanceString = document.getElementById('distance').value;
    let distance = parseFloat(distanceString);
    const joggingTime = document.getElementById('jogging-time').value;

    if (!startLoc) return alert('출발지를 입력해주세요');
    if (isRoundTrip && !distance) return alert('원점 회귀 코스는 목표 거리가 필요합니다.');
    if (!joggingTime) return alert('시간을 설정해주세요');

    document.querySelector('.loading').classList.add('show');
    document.querySelector('.weather-panel').classList.remove('show');
    document.querySelector('.route-info').classList.remove('show');
    const saveBtn = document.getElementById('save-btn-container');
    if (saveBtn) saveBtn.style.display = 'none';

    try {
        // 출발지 좌표 확보 (지도 선택 우선, 없으면 검색)
        let startCoords;
        if (selectedStartCoords) {
            startCoords = selectedStartCoords;
        } else {
            startCoords = await runSearch(startLoc);
        }

        // 지도 중심 이동
        map.setView([startCoords.lat, startCoords.lon], 13);
        if (!startMarker) {
            startMarker = L.marker([startCoords.lat, startCoords.lon]).addTo(map);
        }


        // 초기화
        if (currentRoute) map.removeLayer(currentRoute);
        customMarkers.forEach(m => map.removeLayer(m));
        customMarkers = [];

        let routeData;

        // UI에서 현재 선택된 코스 타입 확인
        const activeBtn = document.querySelector('.route-btn.active');
        let selectedType = activeBtn ? activeBtn.dataset.type : 'circular';

        if (isRoundTrip) {
            // [Case 1] 출발지 == 도착지 (원형 또는 왕복)
            if (selectedType === 'point-to-point') selectedType = 'circular'; // 방어 코드

            if (selectedType === 'circular') {
                routeData = await generateCircularRoute(startCoords, distance);
                if (routeData) routeData.type = 'circular';
            } else {
                // out-and-back (랜덤 반환점 찍고 돌아오기)
                routeData = await generateOutAndBackRoute(startCoords, distance);
                if (routeData) routeData.type = 'out-and-back';
            }
        } else {
            // [Case 2] 출발지 != 도착지 (편도 또는 왕복)
            let endCoords;
            if (selectedEndCoords) {
                endCoords = selectedEndCoords;
            } else {
                endCoords = await runSearch(finalEndLoc);
            }

            if (selectedType === 'out-and-back') {
                // A -> B -> A (왕복)
                const pathOut = await getWalkingRoute([startCoords.lat, startCoords.lon], [endCoords.lat, endCoords.lon], true);
                if (pathOut) {
                    const pathBackCoords = [...pathOut.coords].reverse();
                    routeData = {
                        coords: [...pathOut.coords, ...pathBackCoords],
                        steps: pathOut.steps,
                        type: 'out-and-back'
                    };
                }
            } else {
                // A -> B (편도)
                routeData = await getWalkingRoute([startCoords.lat, startCoords.lon], [endCoords.lat, endCoords.lon], true);
                if (routeData) routeData.type = 'point-to-point';
            }
        }

        if (!routeData || !routeData.coords || routeData.coords.length === 0) throw new Error('안전한 보행 경로를 찾을 수 없습니다.');

        drawRouteOnMap(routeData.coords, routeData.type);

        const actualDistance = calculateTotalDistance(routeData.coords);
        const estimatedMinutes = Math.round((actualDistance / 8) * 60);
        const weather = await getWeather(startCoords.lat, startCoords.lon, joggingTime); // 출발지 날씨 기준

        // 현재 경로 데이터 저장
        currrentRouteData = {
            coords: routeData.coords,
            distance: actualDistance,
            location: `${startLoc} → ${isRoundTrip ? '도착' : finalEndLoc}`,
            type: routeData.type || 'circular',
            createdAt: new Date().toLocaleString()
        };

        // UI 업데이트
        document.getElementById('weather-info').innerHTML = `
            <div class="weather-card"><h3>🌡️ 온도</h3><div class="value">${weather.temperature}</div></div>
            <div class="weather-card"><h3>☁️ 날씨</h3><div class="value">${weather.condition}</div></div>
            <div class="weather-card"><h3>💨 풍속</h3><div class="value">${weather.windSpeed}</div></div>
            <div class="weather-card"><h3>🌧️ 강수</h3><div class="value">${weather.precipitation}</div></div>
        `;
        document.querySelector('.weather-panel').classList.add('show');

        // 통계 UI 업데이트
        let typeKor = '원형';
        if (currrentRouteData.type === 'out-and-back') typeKor = '왕복';
        else if (currrentRouteData.type === 'point-to-point') typeKor = '편도';

        const courseDesc = generateCourseDescription(routeData.steps, currrentRouteData.type);

        document.getElementById('route-stats').innerHTML = `
            <div class="stat-card"><div class="label">목표 거리</div><div class="value">${isRoundTrip ? distance : '-'} km</div></div>
            <div class="stat-card"><div class="label">실제 거리</div><div class="value">${actualDistance} km</div></div>
            <div class="stat-card"><div class="label">예상 시간</div><div class="value">${estimatedMinutes}분</div></div>
            <div class="stat-card"><div class="label">타입</div><div class="value">${typeKor}</div></div>
            <div class="stat-card"><div class="label">평균 속도</div><div class="value">8 km/h</div></div>
            <div class="stat-card"><div class="label">칼로리</div><div class="value">${Math.round(actualDistance * 60)} kcal</div></div>
            <div style="grid-column: 1 / -1;">
                 <div class="course-description-box">
                    <h3>📝 코스 요약</h3>
                    ${courseDesc}
                 </div>
            </div>
        `;
        document.querySelector('.route-info').classList.add('show');

        if (saveBtn) saveBtn.style.display = 'block';

    } catch (e) {
        console.error(e);
        alert('오류 발생: ' + e.message);
    } finally {
        document.querySelector('.loading').classList.remove('show');
    }
}

// 경로 그리기
function drawRouteOnMap(routePoints, routeType) {
    const path = routePoints.map(p => [p[0], p[1]]);

    if (currentRoute) map.removeLayer(currentRoute);

    currentRoute = L.polyline(path, {
        color: '#667eea',
        weight: 5,
        opacity: 0.8
    }).addTo(map);

    addDirectionMarkers(routePoints, routeType);

    if (startMarker) map.removeLayer(startMarker);
    startMarker = L.marker(path[0]).addTo(map);

    // 경로 전체가 보이도록 지도 범위 조정
    const bounds = L.latLngBounds(path);
    map.fitBounds(bounds);
}

function calculateTotalDistance(routePoints) {
    let d = 0;
    for (let i = 0; i < routePoints.length - 1; i++) {
        d += getDistanceFromLatLonInKm(routePoints[i][0], routePoints[i][1], routePoints[i + 1][0], routePoints[i + 1][1]);
    }
    return d.toFixed(2);
}

function addDirectionMarkers(coords, routeType) {
    customMarkers.forEach(m => map.removeLayer(m));
    customMarkers = [];

    if (!coords || coords.length < 2) return;

    let totalDist = 0;
    const dists = [0];
    for (let i = 0; i < coords.length - 1; i++) {
        const d = getDistanceFromLatLonInKm(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
        totalDist += d;
        dists.push(totalDist);
    }

    const numMarkers = 10;
    const isOutAndBack = routeType === 'out-and-back';

    for (let i = 1; i <= numMarkers; i++) {
        let targetDist;
        if (i === 1) targetDist = 0;
        else if (i === numMarkers) targetDist = totalDist;
        else targetDist = (totalDist / (numMarkers - 1)) * (i - 1);

        let targetCoord;
        for (let j = 0; j < dists.length - 1; j++) {
            if (targetDist >= dists[j] && targetDist <= dists[j + 1]) {
                const startNode = coords[j];
                const endNode = coords[j + 1];
                const segmentDist = dists[j + 1] - dists[j];

                if (segmentDist === 0) targetCoord = startNode;
                else {
                    const ratio = (targetDist - dists[j]) / segmentDist;
                    const lat = startNode[0] + (endNode[0] - startNode[0]) * ratio;
                    const lon = startNode[1] + (endNode[1] - startNode[1]) * ratio;
                    targetCoord = [lat, lon];
                }
                break;
            }
        }

        if (!targetCoord && i === numMarkers) targetCoord = coords[coords.length - 1];

        if (targetCoord) {
            let bgColor = '#ff4757'; // 기본 빨강
            let offsetX = 0, offsetY = 0;

            if (isOutAndBack) {
                if (i <= 5) {
                    offsetX = -14;
                    offsetY = -14;
                    bgColor = '#1e90ff'; // 블루
                } else {
                    offsetX = 14;
                    offsetY = 14;
                    bgColor = '#ff6b81'; // 로즈
                }
            }

            const divIcon = L.divIcon({
                className: 'custom-number-marker',
                html: `<div style="background: ${bgColor}; color: white; border: 2px solid white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 13px; box-shadow: 0 2px 4px rgba(0,0,0,0.3); transform: translate(${offsetX}px, ${offsetY}px);">${i}</div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });

            const marker = L.marker([targetCoord[0], targetCoord[1]], { icon: divIcon }).addTo(map);
            customMarkers.push(marker);
        }
    }
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
function deg2rad(deg) { return deg * (Math.PI / 180) }

// ==================== 코스 저장/불러오기 기능 ====================

function saveCurrentRoute() {
    if (!currrentRouteData) return alert('저장할 코스가 없습니다.');
    const savedItem = { id: Date.now(), ...currrentRouteData };
    savedRoutes.push(savedItem);
    saveStorage();
    renderSavedRoutes();
    alert('코스가 저장되었습니다!');
}

function deleteSavedRoute(id) {
    if (confirm('삭제하시겠습니까?')) {
        savedRoutes = savedRoutes.filter(item => item.id !== id);
        saveStorage();
        renderSavedRoutes();
    }
}

function loadSavedRoute(id) {
    const item = savedRoutes.find(r => r.id === id);
    if (!item) return;
    drawRouteOnMap(item.coords);
    alert(`[${item.location}] 코스를 불러왔습니다.`);
    document.querySelector('.main-grid').scrollIntoView({ behavior: 'smooth' });
}

function renderSavedRoutes() {
    const listContainer = document.getElementById('saved-routes-list');
    if (!listContainer) return;

    if (savedRoutes.length === 0) {
        listContainer.innerHTML = '<div class="empty-message">저장된 코스가 없습니다.</div>';
        return;
    }

    listContainer.innerHTML = '';
    [...savedRoutes].reverse().forEach(item => {
        let typeText = '원형';
        if (item.type === 'out-and-back') typeText = '왕복';
        else if (item.type === 'point-to-point') typeText = '편도';

        const div = document.createElement('div');
        div.className = 'saved-route-card';
        div.innerHTML = `
            <div class="saved-route-info" onclick="loadSavedRoute(${item.id})">
                <div class="saved-route-title">🏃 ${item.distance}km ${typeText} 코스</div>
                <div class="saved-route-details">📍 ${item.location} | 📅 ${item.createdAt}</div>
            </div>
            <button class="delete-btn" onclick="deleteSavedRoute(${item.id})">삭제</button>
        `;
        listContainer.appendChild(div);
    });
}

function saveStorage() {
    localStorage.setItem('marathon_saved_routes', JSON.stringify(savedRoutes));
}

function loadSavedRoutesFromStorage() {
    const data = localStorage.getItem('marathon_saved_routes');
    if (data) {
        try {
            savedRoutes = JSON.parse(data);
            renderSavedRoutes();
        } catch (e) {
            console.error('저장된 데이터 로드 실패', e);
        }
    }
}

// 주소 검색 함수 연결 (HTML에서 호출)
async function searchLocation(type) {
    let inputId = 'location';
    if (type === 'end') inputId = 'location-end';
    else inputId = 'location'; // 기본값 start

    const locationInput = document.getElementById(inputId);
    const query = locationInput.value;
    if (!query) return;

    try {
        const coords = await runSearch(query);
        map.setView([coords.lat, coords.lon], 13);

        if (type === 'start') {
            setLocationFromMap({ lat: coords.lat, lng: coords.lon }, 'start');
        } else {
            setLocationFromMap({ lat: coords.lat, lng: coords.lon }, 'end');
        }
    } catch (e) {
        alert(e.message);
    }
}

// 초기화 함수
function resetApp() {
    // 1. 입력창 초기화
    document.getElementById('location').value = '';
    document.getElementById('location-end').value = '';
    document.getElementById('distance').value = '';

    // 2. 내부 변수 초기화
    selectedStartCoords = null;
    selectedEndCoords = null;
    currrentRouteData = null;

    // 3. 지도 요소 제거
    if (startMarker) {
        map.removeLayer(startMarker);
        startMarker = null;
    }
    if (endMarker) {
        map.removeLayer(endMarker);
        endMarker = null;
    }
    if (currentRoute) {
        map.removeLayer(currentRoute);
        currentRoute = null;
    }
    customMarkers.forEach(m => map.removeLayer(m));
    customMarkers = [];

    // 4. UI 상태 초기화
    updateRouteTypeUI(); // 버튼 상태 및 거리 입력창 리셋
    document.getElementById('route-stats').innerHTML = ''; // 결과 초기화

    // 코스 선택 상태 초기화
    activePickTarget = 'start';
    updateMapGuidance();

    // 기본값인 원형 코스로 버튼 복귀
    document.querySelectorAll('.route-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.route-btn[data-type="circular"]').classList.add('active');

    // '직선' 선택 시 숨겨졌던 원형 버튼 다시 보이기
    document.querySelector('.route-btn[data-type="circular"]').style.display = 'block';

    alert('초기화되었습니다.');
}



// 헬퍼: 로컬 YYYY-MM-DD 반환
function getLocalYMD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function showTab(e, tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    // 명시적으로 전달받은 event(e) 사용
    if (e && e.currentTarget) {
        e.currentTarget.classList.add('active');
    } else if (e && e.target) {
        e.target.classList.add('active');
    }

    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(tabName + '-section').classList.add('active');

    // 지도 탭으로 전환 시, 지도가 깨지는 문제 해결 (relayout)
    if (tabName === 'planner' && map) {
        setTimeout(() => {
            map.invalidateSize();
        }, 100);
    }
}

// 페이스 계산기
function setDistance(km) {
    document.getElementById('calc-distance').value = km;
    document.getElementById('distance-unit').value = 'km';
    calculatePace();
}
function getDistanceInKm() { const d = parseFloat(document.getElementById('calc-distance').value) || 0; const u = document.getElementById('distance-unit').value; return u === 'm' ? d / 1000 : u === 'mile' ? d * 1.60934 : d; }
function getTotalSeconds() { return (parseInt(document.getElementById('calc-hours').value) || 0) * 3600 + (parseInt(document.getElementById('calc-minutes').value) || 0) * 60 + (parseInt(document.getElementById('calc-seconds').value) || 0); }
function formatTime(s) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60); return h ? `${h}시간 ${m}분 ${sec}초` : m ? `${m}분 ${sec}초` : `${sec}초`; }
function formatPace(s) { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}'${sec.toString().padStart(2, '0')}"/km`; }
function calculatePace() { const d = getDistanceInKm(), s = getTotalSeconds(); if (d > 0 && s > 0) { const p = s / d, sp = d / (s / 3600); updateResults(d, s, p, sp); generateSplits(p, d); } }
function calculateFromPace() { const d = getDistanceInKm(), p = (parseInt(document.getElementById('calc-pace-min').value) || 0) * 60 + (parseInt(document.getElementById('calc-pace-sec').value) || 0); if (d > 0 && p > 0) { updateResults(d, p * d, p, 3600 / p); generateSplits(p, d); } }
function calculateFromSpeed() { const d = getDistanceInKm(), sp = parseFloat(document.getElementById('calc-speed').value) || 0; if (d > 0 && sp > 0) { const p = 3600 / sp; updateResults(d, d / sp * 3600, p, sp); generateSplits(p, d); } }
function updateResults(d, t, p, s) { document.getElementById('result-distance').innerText = d.toFixed(2) + ' km'; document.getElementById('result-time').innerText = formatTime(t); document.getElementById('result-pace').innerText = formatPace(p); document.getElementById('result-speed').innerText = s.toFixed(1) + ' km/h'; }
function generateSplits(p, d) { const g = document.getElementById('splits-grid'); g.innerHTML = ''; document.getElementById('splits-panel').style.display = 'block'; for (let i = 1; i <= Math.ceil(d); i++) { const div = document.createElement('div'); div.className = 'split-item'; div.innerHTML = `<span>${i}km</span><span>${formatTime(i * p)}</span>`; g.appendChild(div); } }
function resetCalculator() { document.querySelectorAll('#pace-section input').forEach(i => i.value = ''); document.getElementById('splits-panel').style.display = 'none'; }

// ==================== 대회 기록 기능 ====================

function loadRaceRecordsFromStorage() {
    const data = localStorage.getItem('marathon_race_records');
    if (data) {
        raceRecords = JSON.parse(data);
        renderRaceRecords();
    }
}

function saveRaceRecordsToStorage() {
    localStorage.setItem('marathon_race_records', JSON.stringify(raceRecords));
}

function previewRecordImage(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            certificateBase64 = e.target.result;
            document.getElementById('photo-preview').src = certificateBase64;
            document.getElementById('photo-preview-container').style.display = 'block';
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function addRaceRecord() {
    const name = document.getElementById('race-name').value;
    const date = document.getElementById('race-date').value;
    const location = document.getElementById('race-location').value;
    const dist = parseFloat(document.getElementById('race-type').value);
    const h = parseInt(document.getElementById('race-h').value) || 0;
    const m = parseInt(document.getElementById('race-m').value) || 0;
    const s = parseInt(document.getElementById('race-s').value) || 0;

    if (!name || !date || !location || (h === 0 && m === 0 && s === 0)) {
        return alert('대회 정보를 모두 입력해주세요.');
    }

    const totalSeconds = h * 3600 + m * 60 + s;
    const paceSeconds = totalSeconds / dist;
    const paceMin = Math.floor(paceSeconds / 60);
    const paceSec = Math.round(paceSeconds % 60);
    const paceStr = `${paceMin}'${paceSec.toString().padStart(2, '0')}"`;

    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    const memo = document.getElementById('race-memo').value;
    const shoes = document.getElementById('race-shoes').value;

    // 날씨 정보 가져오기 (비동기)
    let weatherInfo = "날씨 정보 없음";
    try {
        const coords = await runSearch(location);
        const histWeather = await getHistoricalWeather(coords.lat, coords.lon, date);
        if (histWeather) {
            weatherInfo = `${histWeather.condition} (${histWeather.temperature}℃)`;
        }
    } catch (e) {
        console.error("날씨 정보 조회 실패", e);
    }

    if (editingRecordId) {
        // 기존 기록 수정
        const index = raceRecords.findIndex(r => r.id === editingRecordId);
        if (index !== -1) {
            raceRecords[index] = {
                ...raceRecords[index],
                name, date, location, distance: dist,
                time: timeStr, pace: paceStr, weather: weatherInfo,
                photo: certificateBase64,
                memo: memo,
                shoes: shoes
            };
            alert('기록이 수정되었습니다!');
        }
    } else {
        // 신규 기록 등록
        const newRecord = {
            id: Date.now(),
            name, date, location, distance: dist,
            time: timeStr, pace: paceStr, weather: weatherInfo,
            photo: certificateBase64,
            memo: memo,
            shoes: shoes
        };
        raceRecords.push(newRecord);
        alert('기록이 저장되었습니다!');
    }

    saveRaceRecordsToStorage();
    renderRaceRecords();
    resetRaceForm();
}

async function getHistoricalWeather(lat, lon, dateStr) {
    try {
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,weathercode&timezone=auto`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.hourly && data.hourly.temperature_2m.length > 0) {
            const idx = 8; // 대회 출발 시간인 오전 8시 데이터 기준
            const code = data.hourly.weathercode[idx];
            const conditions = { 0: '맑음 ☀️', 1: '대체로 맑음 🌤️', 2: '흐림 ⛅', 3: '흐림 ☁️', 45: '안개 🌫️', 51: '이슬비 🌧️', 61: '비 🌧️', 71: '눈 🌨️' };

            return {
                temperature: Math.round(data.hourly.temperature_2m[idx]),
                condition: conditions[code] || '흐림'
            };
        }
        return null;
    } catch (e) {
        return null;
    }
}

function renderRaceRecords() {
    const list = document.getElementById('race-records-list');
    if (!list) return;

    if (raceRecords.length === 0) {
        list.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #999; padding: 40px;">등록된 대회 기록이 없습니다.</p>';
        return;
    }

    list.innerHTML = '';
    [...raceRecords].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(record => {
        const typeLabel = record.distance === 42.195 ? 'FULL' : record.distance === 21.0975 ? 'HALF' : `${record.distance}km`;

        const card = document.createElement('div');
        card.className = 'race-card';
        card.innerHTML = `
            <div class="race-card-img-wrap">
                ${record.photo ? `<img src="${record.photo}" class="race-card-img">` : '<div class="no-img">기록증 없음</div>'}
            </div>
            <div class="race-card-content">
                <div class="race-card-header">
                    <div class="race-card-title">${record.name}</div>
                    <div class="race-card-type">${typeLabel}</div>
                </div>
                <div class="race-card-stats">
                    <div class="race-stat-item">
                        <span class="race-stat-label">⏱️ 기록</span>
                        <span class="race-stat-value">${record.time}</span>
                    </div>
                    <div class="race-stat-item">
                        <span class="race-stat-label">⚡ 페이스</span>
                        <span class="race-stat-value">${record.pace}</span>
                    </div>
                </div>
                <div class="race-stat-item" style="width: 100%; margin-bottom: 5px;">
                    <span class="race-stat-label">📍 장소</span>
                    <span class="race-stat-value" style="font-size: 14px;">${record.location}</span>
                </div>
                <div class="race-stat-item" style="width: 100%; margin-bottom: 10px;">
                    <span class="race-stat-label">👟 러닝화</span>
                    <span class="race-stat-value" style="font-size: 14px; color: #4b6cb7;">${record.shoes || '정보 없음'}</span>
                </div>
                ${record.memo ? `
                <div class="race-card-memo">
                    ${record.memo.replace(/\n/g, '<br>')}
                </div>
                ` : ''}
            </div>
            <div class="race-card-footer">
                <div class="race-weather">🌡️ ${record.weather}</div>
                <div style="display: flex; gap: 5px;">
                    ${record.photo ? `<button class="race-delete-btn" style="background: #20bf6b;" onclick="downloadCertificate(${record.id})">받기</button>` : ''}
                    <button class="race-delete-btn" style="background: #667eea;" onclick="editRaceRecord(${record.id})">수정</button>
                    <button class="race-delete-btn" onclick="deleteRaceRecord(${record.id})">삭제</button>
                </div>
            </div>
        `;
        list.appendChild(card);
    });
}

function downloadCertificate(id) {
    const record = raceRecords.find(r => r.id === id);
    if (!record || !record.photo) return;

    const link = document.createElement('a');
    link.href = record.photo;
    // 파일명 형식: 대회명_날짜_기록증
    const fileName = `certificate_${record.name.replace(/\s+/g, '_')}_${record.date}.png`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function deleteRaceRecord(id) {
    if (confirm('이 기록을 삭제하시겠습니까?')) {
        raceRecords = raceRecords.filter(r => r.id !== id);
        saveRaceRecordsToStorage();
        renderRaceRecords();
        if (editingRecordId === id) resetRaceForm();
    }
}

function editRaceRecord(id) {
    const record = raceRecords.find(r => r.id === id);
    if (!record) return;

    editingRecordId = id;

    // 폼에 데이터 채우기
    document.getElementById('race-name').value = record.name;
    document.getElementById('race-date').value = record.date;
    document.getElementById('race-location').value = record.location;
    document.getElementById('race-type').value = record.distance;
    document.getElementById('race-memo').value = record.memo || '';
    document.getElementById('race-shoes').value = record.shoes || '';

    const timeParts = record.time.split(':');
    document.getElementById('race-h').value = parseInt(timeParts[0]);
    document.getElementById('race-m').value = parseInt(timeParts[1]);
    document.getElementById('race-s').value = parseInt(timeParts[2]);

    if (record.photo) {
        certificateBase64 = record.photo;
        document.getElementById('photo-preview').src = record.photo;
        document.getElementById('photo-preview-container').style.display = 'block';
    } else {
        certificateBase64 = null;
        document.getElementById('photo-preview-container').style.display = 'none';
    }

    // 버튼 상태 변경
    document.getElementById('save-race-btn').innerHTML = '🔄 기록 수정하기';
    document.getElementById('cancel-edit-btn').style.display = 'block';

    // 폼으로 스크롤
    document.querySelector('.record-form-card').scrollIntoView({ behavior: 'smooth' });
}

function resetRaceForm() {
    document.getElementById('race-name').value = '';
    document.getElementById('race-date').value = '';
    document.getElementById('race-location').value = '';
    document.getElementById('race-h').value = '';
    document.getElementById('race-m').value = '';
    document.getElementById('race-s').value = '';
    document.getElementById('race-photo').value = '';
    document.getElementById('race-memo').value = '';
    document.getElementById('race-shoes').value = '';
    document.getElementById('photo-preview-container').style.display = 'none';
    certificateBase64 = null;
    editingRecordId = null;

    document.getElementById('save-race-btn').innerHTML = '💾 기록 저장하기';
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';
}
