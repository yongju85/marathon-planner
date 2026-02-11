// 디버그 로깅 함수
function logToScreen(msg) {
    const consoleDiv = document.getElementById('debug-console');
    if (consoleDiv) {
        consoleDiv.innerHTML += `<div>${msg}</div>`;
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    }
    console.log(msg); // 원래 콘솔에도 출력
}

// 에러 로깅
window.onerror = function (msg, url, line) {
    logToScreen(`❌ ERROR: ${msg} (${line})`);
    return false;
};

// Kakao Maps 전역 변수
let map;
let ps; // 장소 검색 객체
let geocoder; // 주소-좌표 변환 객체
let infoWindow; // 검색 결과 마커 클릭 시 정보창
let currentRoute = null; // 현재 그려진 경로 (Polyline)
let startMarker = null; // 출발지 마커
let endMarker = null; // 도착지 마커
let customMarkers = []; // 거리 표시 마커들 (1km, 2km...)
let activePickTarget = null; // '출발지' 또는 '도착지' 선택 모드

// 전역 변수 (페이스 계산기 및 기타)
let raceRecords = [];
let selectedStartCoords = null; // {lat, lon}
let selectedEndCoords = null;   // {lat, lon}

window.onload = function () {
    // 1. UI 이벤트 리스너 먼저 등록 (지도 로딩 실패해도 버튼은 작동하게)
    try {
        setupEventListeners();
        setDefaultTime();
    } catch (e) {
        console.error('초기화 중 오류 발생:', e);
    }

    // 3. 초기 탭 설정 (빈 화면 방지 - 지도 로드 여부와 무관하게 실행)
    showTab('weather');

    // 2. 지도 API 로드 시도
    if (typeof kakao === 'undefined' || !kakao.maps) {
        console.error('Kakao Maps API 로드 실패');
        logToScreen('❌ Kakao Maps API 로드 실패 (kakao 객체 없음)');
        document.getElementById('map').innerHTML = '<div style="padding:20px; text-align:center; color:red;">지도를 불러올 수 없습니다.<br>(도메인 등록을 확인해주세요)</div>';
        return;
    }

    logToScreen('📡 Kakao Maps 로드 시도...');
    kakao.maps.load(function () {
        logToScreen('✅ Kakao Maps 로드 성공! initMap 실행');
        initMap();
    });
};

function startMapSelection(target) {
    activePickTarget = target;
    const guideText = document.getElementById('map-guide-text');
    if (guideText) {
        guideText.innerText = target === 'start' ? '지도에서 출발지를 클릭하세요' : '지도에서 도착지를 클릭하세요';
        document.getElementById('map-guidance').style.display = 'flex';
        guideText.parentElement.classList.remove('success');
    }

    // 모바일에서 지도 탭으로 자동 이동
    showTab('planner');
}

function updateMapGuidance() {
    const guidePanel = document.getElementById('map-guidance');
    const guideText = document.getElementById('map-guide-text');

    if (guidePanel && guideText) {
        if (selectedStartCoords && selectedEndCoords) {
            guideText.innerText = "✅ 위치 설정 완료! 코스를 생성해보세요";
            guidePanel.style.display = 'flex';
            guidePanel.classList.add('success');
        } else if (!activePickTarget) {
            guidePanel.style.display = 'none';
            guidePanel.classList.remove('success');
        }
    }
}

// 지도 초기화
function initMap() {
    const container = document.getElementById('map');
    if (!container) return;

    // 1. 지도 생성
    const options = {
        center: new kakao.maps.LatLng(37.566826, 126.9786567), // 서울 시청
        level: 5 // 확대 레벨
    };
    map = new kakao.maps.Map(container, options);

    // 2. 서비스 객체 생성
    ps = new kakao.maps.services.Places();
    geocoder = new kakao.maps.services.Geocoder();
    infoWindow = new kakao.maps.InfoWindow({ zIndex: 1 });

    // 3. 지도 컨트롤 추가 (줌 컨트롤 등)
    const zoomControl = new kakao.maps.ZoomControl();
    map.addControl(zoomControl, kakao.maps.ControlPosition.RIGHT);

    // 저장된 데이터 로드
    loadSavedRoutesFromStorage();
    loadRaceRecordsFromStorage();

    // 4. 지도 클릭 이벤트
    kakao.maps.event.addListener(map, 'click', function (mouseEvent) {
        if (activePickTarget) {
            const latlng = mouseEvent.latLng;
            setLocationFromMap(latlng, activePickTarget);
            activePickTarget = null; // 선택 후 모드 해제
            updateMapGuidance();
        }
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

// 지도 클릭 시 위치 설정 (좌표 -> 주소 변환)
function setLocationFromMap(latlng, target) {
    if (!geocoder) return;

    // 마커 표시
    if (target === 'start') {
        if (startMarker) startMarker.setMap(null);
        startMarker = new kakao.maps.Marker({ position: latlng });
        startMarker.setMap(map);
        selectedStartCoords = { lat: latlng.getLat(), lon: latlng.getLng() };
    } else {
        if (endMarker) endMarker.setMap(null);
        // 도착지 마커는 다른 이미지로 (선택 사항)
        const imageSrc = 'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_red.png';
        const imageSize = new kakao.maps.Size(64, 69);
        const imageOption = { offset: new kakao.maps.Point(27, 69) };
        const markerImage = new kakao.maps.MarkerImage(imageSrc, imageSize, imageOption);

        endMarker = new kakao.maps.Marker({
            position: latlng,
            image: markerImage
        });
        endMarker.setMap(map);
        selectedEndCoords = { lat: latlng.getLat(), lon: latlng.getLng() };
    }

    // 좌표 -> 주소 변환
    geocoder.coord2Address(latlng.getLng(), latlng.getLat(), function (result, status) {
        if (status === kakao.maps.services.Status.OK) {
            const addr = result[0].road_address ? result[0].road_address.address_name : result[0].address.address_name;
            const inputId = target === 'start' ? 'location' : 'location-end';
            const input = document.getElementById(inputId);
            if (input) {
                input.value = addr;
                // 체크 이모지 추가 효과 등
                const parent = input.parentElement;
                parent.style.borderColor = '#667eea';
                setTimeout(() => parent.style.borderColor = '#e0e0e0', 1000);
            }
        }
    });

    updateRouteTypeUI();
}

// 장소 검색 (키워드 -> 좌표)
function runSearch(location) {
    return new Promise((resolve, reject) => {
        if (!ps) {
            reject(new Error('Kakao Maps API가 초기화되지 않았습니다.'));
            return;
        }

        ps.keywordSearch(location, function (data, status, pagination) {
            if (status === kakao.maps.services.Status.OK) {
                // 첫 번째 검색 결과 사용
                const place = data[0];
                const lat = parseFloat(place.y);
                const lng = parseFloat(place.x);
                resolve({ lat: lat, lon: lng });
            } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
                reject(new Error('검색 결과가 존재하지 않습니다.'));
            } else {
                reject(new Error('검색 중 오류가 발생했습니다.'));
            }
        });
    });
}

function searchLocation(target) {
    const inputId = target === 'start' ? 'location' : 'location-end';
    const loc = document.getElementById(inputId).value;
    if (!loc) {
        alert('장소를 입력해주세요.');
        return;
    }

    runSearch(loc)
        .then(coord => {
            const latlng = new kakao.maps.LatLng(coord.lat, coord.lon);
            map.setCenter(latlng);
            setLocationFromMap(latlng, target);
        })
        .catch(err => {
            alert(err.message);
        });
}

// 경로 그리기 (직선 경로 시뮬레이션 + 마커)
function drawRouteOnMap(routePoints, routeType) {
    // 기존 경로 제거 (Polyline)
    if (currentRoute) {
        currentRoute.setMap(null);
        currentRoute = null;
    }

    // 경로 생성
    const path = routePoints.map(p => new kakao.maps.LatLng(p[0], p[1]));

    currentRoute = new kakao.maps.Polyline({
        path: path,
        strokeWeight: 5,
        strokeColor: '#667eea',
        strokeOpacity: 0.8,
        strokeStyle: 'solid'
    });
    currentRoute.setMap(map);

    // 거리 표시 마커 추가
    addDirectionMarkers(routePoints, routeType);

    // 지도 범위 조정
    const bounds = new kakao.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    map.setBounds(bounds);

    // 출발지 마커 최상위로
    if (startMarker) startMarker.setZIndex(10);
}

// 거리 마커 추가 (CustomOverlay 사용)
function addDirectionMarkers(coords, routeType) {
    // 기존 마커 제거
    customMarkers.forEach(m => m.setMap(null));
    customMarkers = [];

    const totalDist = parseFloat(document.getElementById('target-distance').value);

    // 왕복/회귀 코스는 반환점 표시
    if (routeType === 'round' || routeType === 'return') {
        const midIdx = Math.floor(coords.length / 2);
        const midPoint = coords[midIdx];

        const content = `<div style="padding:5px; background:white; border:1px solid #667eea; border-radius:5px; font-size:12px; color:#667eea; font-weight:bold;">반환점</div>`;
        const position = new kakao.maps.LatLng(midPoint[0], midPoint[1]);

        const customOverlay = new kakao.maps.CustomOverlay({
            position: position,
            content: content,
            yAnchor: 1.5
        });
        customOverlay.setMap(map);
        customMarkers.push(customOverlay);
    }

    // 1km 단위 마커 (단순화: 전체 경로 균등 분할)
    const kmCount = Math.floor(totalDist);
    if (kmCount > 0) {
        for (let i = 1; i <= kmCount; i++) {
            // 대략적인 위치 계산 (정확한 거리는 복잡하므로 인덱스 비례)
            const idx = Math.floor((coords.length - 1) * (i / totalDist));
            const point = coords[idx];

            const content = `<div class="custom-number-marker" style="background: #667eea; color: white; border: 2px solid white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 13px; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${i}</div>`;
            const position = new kakao.maps.LatLng(point[0], point[1]);

            const customOverlay = new kakao.maps.CustomOverlay({
                position: position,
                content: content,
                yAnchor: 0.5,
                xAnchor: 0.5
            });
            customOverlay.setMap(map);
            customMarkers.push(customOverlay);
        }
    }
}

// ==================== 이벤트 리스너 및 UI ====================

function setupEventListeners() {
    console.log('[디버그] setupEventListeners 시작');

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            showTab(this.getAttribute('data-tab'));
        });
    });

    const searchStartBtn = document.getElementById('planner-search-start');
    if (searchStartBtn) {
        searchStartBtn.addEventListener('click', () => searchLocation('start'));
    }
    const searchEndBtn = document.getElementById('planner-search-end');
    if (searchEndBtn) {
        searchEndBtn.addEventListener('click', () => searchLocation('end'));
    }

    // 지도에서 선택 버튼
    const pickStartBtn = document.getElementById('planner-pick-start');
    if (pickStartBtn) pickStartBtn.addEventListener('click', () => startMapSelection('start'));

    const pickEndBtn = document.getElementById('planner-pick-end');
    if (pickEndBtn) pickEndBtn.addEventListener('click', () => startMapSelection('end'));

    // 날씨 시간 단축 버튼 (현재, 오늘 18시, 내일 7시)
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            // 버튼 스타일 초기화
            document.querySelectorAll('.time-btn').forEach(b => {
                b.style.borderColor = '#e0e0e0';
                b.style.color = '#555';
                b.style.background = 'white';
            });
            // 선택된 버튼 활성화
            this.style.borderColor = '#667eea';
            this.style.color = '#667eea';
            this.style.background = '#f0f4ff';

            const type = this.getAttribute('data-time');
            const timeInput = document.getElementById('weather-time');
            const now = new Date();

            if (type === 'today_evening') {
                now.setHours(18, 0, 0, 0);
            } else if (type === 'tomorrow_morning') {
                now.setDate(now.getDate() + 1);
                now.setHours(7, 0, 0, 0);
            }
            // type === 'now'는 그냥 현재 시간 그대로 사용

            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');

            timeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
        });
    });

    // 날씨 조회 버튼 (메인 조회 버튼)
    const checkWeatherBtn = document.getElementById('weather-check-btn');
    if (checkWeatherBtn) checkWeatherBtn.addEventListener('click', checkWeatherAndDust);

    // 날씨 검색 돋보기 버튼
    const weatherSearchBtn = document.getElementById('weather-search-btn');
    if (weatherSearchBtn) weatherSearchBtn.addEventListener('click', checkWeatherAndDust);

    // 거리 입력 시 시간/페이스 자동 업데이트 (기존 로직)
    const targetDistInput = document.getElementById('target-distance');
    if (targetDistInput) {
        targetDistInput.addEventListener('input', updateEstimatedTime);
    }

    // 페이스 계산기
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

    // 도착지 동일 설정 버튼
    const sameAsStartBtn = document.getElementById('set-same-start-btn');
    if (sameAsStartBtn) sameAsStartBtn.addEventListener('click', setSameAsStart);

    const courseGenBtn = document.getElementById('course-generate-btn');
    if (courseGenBtn) courseGenBtn.addEventListener('click', generateRoute);

    const appResetBtn = document.getElementById('app-reset-btn');
    if (appResetBtn) appResetBtn.addEventListener('click', resetApp);

    // 경로 유형 버튼
    document.querySelectorAll('.route-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.route-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            // UI 업데이트
            const type = this.getAttribute('data-type');
            const endGroup = document.getElementById('end-location-group');
            if (type === 'one-way') {
                endGroup.style.display = 'block';
            } else {
                endGroup.style.display = 'none';
                // 편도 외에는 도착지를 출발지와 동일하게 설정
                setSameAsStart();
            }
        });
    });
}

function updateRouteTypeUI() {
    const activeBtn = document.querySelector('.route-btn.active');
    if (!activeBtn) return;

    const type = activeBtn.getAttribute('data-type');
    const endGroup = document.getElementById('end-location-group');

    if (type === 'one-way') {
        endGroup.style.display = 'block';
    } else {
        endGroup.style.display = 'none';
    }
}

function setSameAsStart() {
    const startVal = document.getElementById('location').value;
    document.getElementById('location-end').value = startVal;

    // 좌표도 복사 (도착지 마커 생성)
    if (selectedStartCoords) {
        selectedEndCoords = { ...selectedStartCoords };
        const latlng = new kakao.maps.LatLng(selectedStartCoords.lat, selectedStartCoords.lon);

        if (endMarker) endMarker.setMap(null);
        const imageSrc = 'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_red.png';
        const imageSize = new kakao.maps.Size(64, 69);
        const imageOption = { offset: new kakao.maps.Point(27, 69) };
        const markerImage = new kakao.maps.MarkerImage(imageSrc, imageSize, imageOption);

        endMarker = new kakao.maps.Marker({
            position: latlng,
            image: markerImage
        });
        endMarker.setMap(map);
    }

    updateRouteTypeUI();
}

function showTab(tabName) {
    // 1. 모든 탭 컨텐츠와 버튼 비활성화
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

    // 2. 선택된 탭 활성화 (ID에 -section이 붙어있음)
    const contentId = tabName.endsWith('-section') ? tabName : tabName + '-section';
    const content = document.getElementById(contentId);

    if (content) {
        content.classList.add('active');
    } else {
        console.error(`Tab content not found: ${contentId}`);
    }

    // 3. 버튼 활성화
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) {
        btn.classList.add('active');
    }

    // 4. 지도 탭으로 전환 시 리사이즈
    if (tabName === 'planner' && map) {
        setTimeout(() => {
            map.relayout();
            if (selectedStartCoords) {
                map.setCenter(new kakao.maps.LatLng(selectedStartCoords.lat, selectedStartCoords.lon));
            } else {
                map.setCenter(new kakao.maps.LatLng(37.566826, 126.9786567));
            }
        }, 100);
    }
}

function resetApp() {
    if (!confirm('모든 입력 내용을 초기화하시겠습니까?')) return;
    location.reload();
}

// ==================== 페이스 계산기 및 기타 유틸리티 (유지) ====================

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

// 날씨 API (OpenWeatherMap) - 기존 유지
function checkWeatherAndDust() {
    const loc = document.getElementById('weather-location').value;
    const apiKey = '930d6742588c22736427d142167c1301';

    // 날씨 (섭씨: units=metric)
    fetch(`https://api.openweathermap.org/data/2.5/weather?q=${loc}&appid=${apiKey}&units=metric&lang=kr`)
        .then(res => res.json())
        .then(data => {
            if (data.cod !== 200) {
                alert('지역을 찾을 수 없습니다.');
                return;
            }
            document.getElementById('temp-val').innerText = data.main.temp + '°C';
            document.getElementById('weather-desc').innerText = data.weather[0].description;
            document.getElementById('humidity-val').innerText = data.main.humidity + '%';
            document.getElementById('wind-val').innerText = data.wind.speed + 'm/s';

            document.querySelector('.weather-panel').classList.add('show');

            // 미세먼지 (좌표 기반)
            checkDust(data.coord.lat, data.coord.lon, apiKey);
        })
        .catch(err => {
            console.error(err);
            alert('날씨 정보를 가져오는데 실패했습니다.');
        });
}

function checkDust(lat, lon, apiKey) {
    // OpenWeatherMap Air Pollution API
    fetch(`https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`)
        .then(res => res.json())
        .then(data => {
            const aqi = data.list[0].main.aqi; // 1(좋음) ~ 5(매우 나쁨)
            const aqiText = ['좋음', '보통', '보통', '나쁨', '매우 나쁨'];
            const pm25 = data.list[0].components.pm2_5;

            document.getElementById('dust-val').innerText = `${aqiText[aqi - 1]} (${pm25}µg/m³)`;
        });
}

// 거리 입력 시 페이스/시간 자동 계산 (단순 추정)
// 평균 페이스 6:00/km 기준
function updateEstimatedTime() {
    const dist = parseFloat(document.getElementById('target-distance').value) || 0;
    if (dist > 0) {
        // 6분/km = 360초/km
        const totalSec = dist * 360;
        document.getElementById('estimated-time').innerText = formatTime(totalSec);
        document.getElementById('estimated-pace').innerText = "6'00\"/km";
    }
}

function setDefaultTime() {
    const now = new Date();
    // 현재는 사용하지 않음 (대회 날짜 등은 사용자 입력)
}

// 코스 생성 (시뮬레이션)
function generateRoute() {
    const dist = parseFloat(document.getElementById('target-distance').value);
    if (!dist || !selectedStartCoords) {
        alert('출발지와 목표 거리를 설정해주세요.');
        return;
    }

    document.querySelector('.loading').classList.add('show');

    setTimeout(() => {
        // 가상의 경로 포인트 생성 (출발지 기준으로 랜덤하게)
        // 실제로는 도로 네트워크 데이터가 필요하므로 여기서는 시각적 효과만 제공
        const points = [];
        const startLat = selectedStartCoords.lat;
        const startLng = selectedStartCoords.lon;
        const type = document.querySelector('.route-btn.active').getAttribute('data-type');

        // 간단한 원형/직선 코스 생성 알고리즘
        const steps = 20;
        const r = dist / (2 * Math.PI) * 0.01; // 대략적인 도 단위 변환

        for (let i = 0; i <= steps; i++) {
            if (type === 'round') {
                const theta = (i / steps) * 2 * Math.PI;
                points.push([
                    startLat + r * Math.sin(theta),
                    startLng + r * (1 - Math.cos(theta))
                ]);
            } else if (type === 'one-way') {
                if (!selectedEndCoords) {
                    // 도착지 없으면 그냥 직선
                    points.push([
                        startLat + (i / steps) * r * 5,
                        startLng + (i / steps) * r * 5
                    ]);
                } else {
                    // 출발 -> 도착 직선 보간
                    points.push([
                        startLat + (selectedEndCoords.lat - startLat) * (i / steps),
                        startLng + (selectedEndCoords.lon - startLng) * (i / steps)
                    ]);
                }
            } else {
                // 반환 코스 (갔다 오기)
                const progress = i <= steps / 2 ? i / (steps / 2) : (steps - i) / (steps / 2);
                points.push([
                    startLat + progress * r * 2,
                    startLng + progress * r * 2
                ]);
            }
        }

        drawRouteOnMap(points, type);

        document.querySelector('.loading').classList.remove('show');
        document.querySelector('.route-info').classList.add('show');

        document.getElementById('info-dist').innerText = dist + 'km';
        // 고도 정보는 가상
        document.getElementById('info-elev').innerText = '45m';

        // 현재 날씨 가져오기 (출발지 기준)
        checkWeatherForRoute(startLat, startLng);

    }, 1500);
}

function checkWeatherForRoute(lat, lon) {
    // 날씨 패널 업데이트와 동일한 로직 사용
    const apiKey = '930d6742588c22736427d142167c1301';
    fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=kr`)
        .then(res => res.json())
        .then(data => {
            document.getElementById('info-temp').innerText = Math.round(data.main.temp) + '°C';
            document.getElementById('info-weather').innerText = data.weather[0].description;
        });
}

// 기록 저장 관련 함수 (localStorage)
function saveRoute() {
    if (!currentRoute) {
        alert('저장할 코스가 없습니다.');
        return;
    }
    const name = prompt('코스 이름을 입력하세요:', '나의 러닝 코스');
    if (!name) return;

    // HTML2Canvas로 지도 캡처 (Kakao Maps는 보안 문제로 캡처가 안될 수 있어 대체 이미지 사용 필요할 수 있음)
    // 여기서는 기본 정보만 저장
    const routeData = {
        id: Date.now(),
        name: name,
        distance: document.getElementById('info-dist').innerText,
        date: new Date().toLocaleDateString(),
        startAddr: document.getElementById('location').value
    };

    let routes = JSON.parse(localStorage.getItem('marathon_routes')) || [];
    routes.push(routeData);
    localStorage.setItem('marathon_routes', JSON.stringify(routes));

    loadSavedRoutesFromStorage();
    alert('코스가 저장되었습니다!');
}

function loadSavedRoutesFromStorage() {
    const list = document.getElementById('saved-routes-list');
    if (!list) return;

    const routes = JSON.parse(localStorage.getItem('marathon_routes')) || [];
    list.innerHTML = '';

    routes.forEach(route => {
        const div = document.createElement('div');
        div.className = 'saved-route-card';
        div.innerHTML = `
            <div class="saved-route-left">
                <div class="no-img">지도 이미지</div>
            </div>
            <div class="saved-route-info" onclick="loadRoute(${route.id})">
                <div class="saved-route-title">${route.name}</div>
                <div class="saved-route-details">
                    거리: ${route.distance}<br>
                    출발: ${route.startAddr || '위치 정보 없음'}
                </div>
            </div>
            <button class="delete-btn" onclick="deleteRoute(${route.id})">삭제</button>
        `;
        list.appendChild(div);
    });
}

function deleteRoute(id) {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    let routes = JSON.parse(localStorage.getItem('marathon_routes')) || [];
    routes = routes.filter(r => r.id !== id);
    localStorage.setItem('marathon_routes', JSON.stringify(routes));
    loadSavedRoutesFromStorage();
}

function loadRaceRecordsFromStorage() {
    // 대회 기록 로드 구현
}
