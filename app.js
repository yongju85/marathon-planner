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

    const distEl = document.getElementById('distance') || document.getElementById('target-distance');
    const totalDist = distEl ? parseFloat(distEl.value) : 0;

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
    const targetDistInput = document.getElementById('distance') || document.getElementById('target-distance');
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

    // 대회 기록장 이벤트 및 초기화
    const saveRaceBtn = document.getElementById('save-race-btn');
    if (saveRaceBtn) saveRaceBtn.addEventListener('click', saveRaceRecord);

    const racePhotoInput = document.getElementById('race-photo');
    if (racePhotoInput) racePhotoInput.addEventListener('change', handlePhotoSelect);

    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', cancelEdit);

    loadRaceRecordsFromStorage();
    loadRunningShoes();

    // 일정 관리 초기화
    loadSchedules();

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

function parseTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    if (parts.length === 2) return (parts[0] * 60) + parts[1];
    return 0;
}

function calculatePace() { const d = getDistanceInKm(), s = getTotalSeconds(); if (d > 0 && s > 0) { const p = s / d, sp = d / (s / 3600); updateResults(d, s, p, sp); generateSplits(p, d); } }
function calculateFromPace() { const d = getDistanceInKm(), p = (parseInt(document.getElementById('calc-pace-min').value) || 0) * 60 + (parseInt(document.getElementById('calc-pace-sec').value) || 0); if (d > 0 && p > 0) { updateResults(d, p * d, p, 3600 / p); generateSplits(p, d); } }
function calculateFromSpeed() { const d = getDistanceInKm(), sp = parseFloat(document.getElementById('calc-speed').value) || 0; if (d > 0 && sp > 0) { const p = 3600 / sp; updateResults(d, d / sp * 3600, p, sp); generateSplits(p, d); } }

function updateResults(d, t, p, s) { document.getElementById('result-distance').innerText = d.toFixed(2) + ' km'; document.getElementById('result-time').innerText = formatTime(t); document.getElementById('result-pace').innerText = formatPace(p); document.getElementById('result-speed').innerText = s.toFixed(1) + ' km/h'; }

function generateSplits(p, d) { const g = document.getElementById('splits-grid'); g.innerHTML = ''; document.getElementById('splits-panel').style.display = 'block'; for (let i = 1; i <= Math.ceil(d); i++) { const div = document.createElement('div'); div.className = 'split-item'; div.innerHTML = `<span>${i}km</span><span>${formatTime(i * p)}</span>`; g.appendChild(div); } }
function resetCalculator() { document.querySelectorAll('#pace-section input').forEach(i => i.value = ''); document.getElementById('splits-panel').style.display = 'none'; }

// 시간 포맷 헬퍼 (YYYY-MM-DD)
function getLocalYMD(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 날씨 API (Open-Meteo - 시간별 예보 지원)
function checkWeatherAndDust() {
    const loc = document.getElementById('weather-location').value;
    const timeVal = document.getElementById('weather-time').value;

    if (!loc || !timeVal) {
        alert('지역과 시간을 선택해주세요.');
        return;
    }

    logToScreen(`🌤️ ${loc} (${timeVal}) 정보 조회 중...`);

    // 카카오 맵 서비스를 사용하여 좌표 검색
    if (typeof kakao !== 'undefined' && kakao.maps && kakao.maps.services) {
        const ps = new kakao.maps.services.Places();
        ps.keywordSearch(loc, function (data, status) {
            if (status === kakao.maps.services.Status.OK) {
                const lat = data[0].y;
                const lon = data[0].x;
                const regionName = data[0].address_name || data[0].place_name;
                fetchTimeBasedWeather(lat, lon, regionName, timeVal);
            } else {
                const geocoder = new kakao.maps.services.Geocoder();
                geocoder.addressSearch(loc, function (results, status) {
                    if (status === kakao.maps.services.Status.OK) {
                        const lat = results[0].y;
                        const lon = results[0].x;
                        fetchTimeBasedWeather(lat, lon, results[0].address_name, timeVal);
                    } else {
                        logToScreen(`⚠️ 위치 검색 실패. 현재 위치 날씨를 시도하거나 정확한 지명을 입력하세요.`);
                        alert('위치를 찾을 수 없습니다. 정확한 지역명을 입력해주세요.');
                    }
                });
            }
        });
    } else {
        alert('위치 검색 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.');
    }
}

async function fetchTimeBasedWeather(lat, lon, displayName, datetime) {
    try {
        logToScreen(`🌐 기상 예보 데이터 수신 중... (${displayName})`);

        const weather = await getWeatherForecast(lat, lon, datetime);
        const air = await getAirQualityForecast(lat, lon, datetime);

        if (!weather) throw new Error('날씨 예보 정보를 가져올 수 없습니다.');

        updateWeatherUI(weather, displayName);
        renderDustUI(air);

        document.getElementById('weather-results').style.display = 'block';
        document.getElementById('weather-placeholder').style.display = 'none';

        logToScreen(`✅ [${displayName}] ${datetime} 날씨 정보 업데이트 완료`);
    } catch (err) {
        logToScreen(`❌ 조회 오류: ${err.message}`);
        console.error(err);
        alert(`정보를 가져오는데 실패했습니다: ${err.message}`);
    }
}

async function getWeatherForecast(lat, lon, datetime) {
    const date = new Date(datetime);
    const dateStr = getLocalYMD(date);
    const hour = date.getHours();

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,weathercode,windspeed_10m,precipitation_probability&timezone=auto&forecast_days=7`;

    const response = await fetch(url);
    const data = await response.json();

    const timeIndex = data.hourly.time.findIndex(t => {
        const d = new Date(t);
        return getLocalYMD(d) === dateStr && d.getHours() === hour;
    });

    if (timeIndex === -1) return null;

    const code = data.hourly.weathercode[timeIndex];
    const conditions = {
        0: '맑음 ☀️', 1: '대체로 맑음 🌤️', 2: '흐림 ⛅', 3: '흐림 ☁️',
        45: '안개 🌫️', 48: '안개 🌫️',
        51: '이슬비 🌧️', 53: '이슬비 🌧️', 55: '이슬비 🌧️',
        61: '비 🌧️', 63: '비 🌧️', 65: '비 🌧️',
        71: '눈 🌨️', 73: '눈 🌨️', 75: '눈 🌨️',
        95: '뇌우 ⛈️'
    };

    return {
        temp: Math.round(data.hourly.temperature_2m[timeIndex]),
        desc: conditions[code] || '흐림',
        humidity: data.hourly.relative_humidity_2m[timeIndex],
        wind: data.hourly.windspeed_10m[timeIndex],
        precip: data.hourly.precipitation_probability[timeIndex]
    };
}

async function getAirQualityForecast(lat, lon, datetime) {
    const date = new Date(datetime);
    const dateStr = getLocalYMD(date);
    const hour = date.getHours();

    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm10,pm2_5&timezone=auto`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        const timeIndex = data.hourly.time.findIndex(t => {
            const d = new Date(t);
            return getLocalYMD(d) === dateStr && d.getHours() === hour;
        });

        if (timeIndex === -1) return null;

        return {
            pm10: data.hourly.pm10[timeIndex],
            pm25: data.hourly.pm2_5[timeIndex]
        };
    } catch (e) {
        return null;
    }
}

function updateWeatherUI(data, displayName) {
    document.getElementById('temp-val').innerText = data.temp + '°C';
    document.getElementById('weather-desc').innerText = data.desc;
    document.getElementById('humidity-val').innerText = data.humidity + '%';
    document.getElementById('wind-val').innerText = data.wind.toFixed(1) + 'km/h';
}

function renderDustUI(air) {
    const area = document.getElementById('dust-traffic-light-area');
    if (!area) return;

    if (!air) {
        area.innerHTML = '<div class="weather-card" style="width: 100%; min-height: 150px; background: #f0f0f0; color: #ccc; display: flex; align-items: center; justify-content: center;">미세먼지 예보 정보가 없습니다.</div>';
        return;
    }

    const pm10Stat = getDustStatus(air.pm10, 'pm10');
    const pm25Stat = getDustStatus(air.pm25, 'pm25');

    area.innerHTML = `
        <div class="dust-guidance-box ${pm25Stat.colorClass}">
            <div class="guidance-title">🏃 러너 미세먼지 신호등 (PM2.5 기준)</div>
            <div class="guidance-message">"${pm25Stat.message}"</div>
        </div>

        <div class="dust-container">
            <div class="dust-box ${pm10Stat.colorClass}">
                <div class="dust-label">미세먼지 (PM10)</div>
                <div class="dust-value">${Math.round(air.pm10)} µg/m³</div>
                <div class="dust-status">${pm10Stat.status}</div>
            </div>
            <div class="dust-box ${pm25Stat.colorClass}">
                <div class="dust-label">초미세먼지 (PM2.5)</div>
                <div class="dust-value">${Math.round(air.pm25)} µg/m³</div>
                <div class="dust-status">${pm25Stat.status}</div>
            </div>
        </div>
    `;
}


function getDustStatus(value, type) {
    let status = '';
    let colorClass = '';
    let message = '';

    if (type === 'pm10') {
        if (value <= 30) { status = '좋음'; colorClass = 'dust-good'; }
        else if (value <= 80) { status = '보통'; colorClass = 'dust-normal'; }
        else if (value <= 150) { status = '나쁨'; colorClass = 'dust-bad'; }
        else { status = '매우 나쁨'; colorClass = 'dust-very-bad'; }
    } else {
        // PM2.5 기준 (임바표 러너 가이드 - 강화된 기준)
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
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');

    const timeInput = document.getElementById('weather-time');
    if (timeInput) {
        timeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
        logToScreen(`⏰ 기본 시간 설정 완료: ${timeInput.value}`);
    }
}

// 코스 생성 (시뮬레이션)
function generateRoute() {
    const distEl = document.getElementById('distance') || document.getElementById('target-distance');
    const dist = distEl ? parseFloat(distEl.value) : 0;
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

// --- 대회 기록장 관련 로직 ---
let raceRecords = [];
let selectedRacePhoto = null;

function handlePhotoSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (event) {
        selectedRacePhoto = event.target.result; // Base64
        const preview = document.getElementById('photo-preview');
        const container = document.getElementById('photo-preview-container');
        if (preview && container) {
            preview.src = selectedRacePhoto;
            container.style.display = 'block';
        }
    };
    reader.readAsDataURL(file);
}

function saveRaceRecord() {
    const editingId = document.getElementById('editing-record-id').value;
    const name = document.getElementById('race-name').value;
    const date = document.getElementById('race-date').value;
    const location = document.getElementById('race-location').value;
    const type = document.getElementById('race-type').value;
    // 착용 러닝화: 드롭다운에서 선택하거나 직접 입력
    const shoesSelect = document.getElementById('race-shoes-select');
    const shoesInput = document.getElementById('race-shoes');
    let shoes = '';
    if (shoesSelect.value === '__direct__') {
        shoes = shoesInput.value.trim();
    } else {
        shoes = shoesSelect.value;
    }
    const h = document.getElementById('race-h').value || '0';
    const m = document.getElementById('race-m').value || '0';
    const s = document.getElementById('race-s').value || '0';
    const memo = document.getElementById('race-memo').value;

    if (!name || !date) {
        alert('대회명과 일자를 입력해주세요.');
        return;
    }

    const timeStr = `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;

    if (editingId) {
        // 수정 모드
        const index = raceRecords.findIndex(r => r.id === parseInt(editingId));
        if (index !== -1) {
            raceRecords[index] = {
                ...raceRecords[index],
                name, date, location, type, shoes,
                time: timeStr,
                memo,
                photo: selectedRacePhoto || raceRecords[index].photo
            };
            logToScreen(`🏅 대회 기록 수정 완료: ${name}`);
        }
    } else {
        // 신규모드
        const record = {
            id: Date.now(),
            name, date, location, type, shoes,
            time: timeStr,
            memo,
            photo: selectedRacePhoto
        };
        raceRecords.push(record);
        logToScreen(`🏅 새로운 대회 기록 저장: ${name}`);
    }

    localStorage.setItem('marathon_race_records', JSON.stringify(raceRecords));

    renderRaceRecords();
    cancelEdit(); // 폼 초기화 및 상태 해제
    alert(editingId ? '기록이 수정되었습니다!' : '기록이 저장되었습니다!');
}

function editRaceRecord(id) {
    const record = raceRecords.find(r => r.id === id);
    if (!record) return;

    // 폼에 데이터 채우기
    document.getElementById('editing-record-id').value = record.id;
    document.getElementById('race-name').value = record.name;
    document.getElementById('race-date').value = record.date;
    document.getElementById('race-location').value = record.location;
    document.getElementById('race-type').value = record.type;

    // 착용 러닝화 선택 복원
    populateShoesDropdown();
    const shoesSelect = document.getElementById('race-shoes-select');
    const shoesInput = document.getElementById('race-shoes');
    const savedShoes = record.shoes || '';
    // 현재 드롭다운에 존재하는지 확인
    const optionExists = Array.from(shoesSelect.options).some(o => o.value === savedShoes && o.value !== '' && o.value !== '__direct__');
    if (optionExists) {
        shoesSelect.value = savedShoes;
        shoesInput.style.display = 'none';
        shoesInput.value = '';
    } else if (savedShoes) {
        shoesSelect.value = '__direct__';
        shoesInput.style.display = 'block';
        shoesInput.value = savedShoes;
    } else {
        shoesSelect.value = '';
        shoesInput.style.display = 'none';
    }

    const timeParts = record.time.split(':');
    document.getElementById('race-h').value = parseInt(timeParts[0]);
    document.getElementById('race-m').value = parseInt(timeParts[1]);
    document.getElementById('race-s').value = parseInt(timeParts[2]);
    document.getElementById('race-memo').value = record.memo;

    // 사진 미리보기
    if (record.photo) {
        const preview = document.getElementById('photo-preview');
        const container = document.getElementById('photo-preview-container');
        preview.src = record.photo;
        container.style.display = 'block';
    } else {
        document.getElementById('photo-preview-container').style.display = 'none';
    }

    // UI 변경
    const saveBtn = document.getElementById('save-race-btn');
    saveBtn.innerHTML = '💾 기록 수정하기';
    saveBtn.style.background = '#667eea';
    document.getElementById('cancel-edit-btn').style.display = 'block';
    document.querySelector('#records-section h2').innerText = '🏅 대회 기록 수정';

    // 상단으로 스크롤
    document.querySelector('.records-container').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
    resetRaceForm();
    document.getElementById('editing-record-id').value = '';
    const saveBtn = document.getElementById('save-race-btn');
    saveBtn.innerHTML = '💾 기록 저장하기';
    saveBtn.style.background = '#20bf6b';
    document.getElementById('cancel-edit-btn').style.display = 'none';
    document.querySelector('#records-section h2').innerText = '🏅 새로운 대회 기록 등록';
}

function resetRaceForm() {
    document.getElementById('race-name').value = '';
    document.getElementById('race-date').value = '';
    document.getElementById('race-location').value = '';
    const shoesSelect = document.getElementById('race-shoes-select');
    if (shoesSelect) shoesSelect.value = '';
    const raceShoes = document.getElementById('race-shoes');
    if (raceShoes) { raceShoes.value = ''; raceShoes.style.display = 'none'; }
    document.getElementById('race-h').value = '';
    document.getElementById('race-m').value = '';
    document.getElementById('race-s').value = '';
    document.getElementById('race-memo').value = '';
    document.getElementById('race-photo').value = '';
    document.getElementById('photo-preview-container').style.display = 'none';
    selectedRacePhoto = null;
}

function loadRaceRecordsFromStorage() {
    const saved = localStorage.getItem('marathon_race_records');
    if (saved) {
        raceRecords = JSON.parse(saved);
        renderRaceRecords();
    }
}

function deleteRaceRecord(id) {
    if (confirm('이 기록을 삭제하시겠습니까?')) {
        raceRecords = raceRecords.filter(r => r.id !== id);
        localStorage.setItem('marathon_race_records', JSON.stringify(raceRecords));
        renderRaceRecords();
    }
}

function renderRaceRecords() {
    const grid = document.getElementById('race-records-list');
    if (!grid) return;
    grid.innerHTML = '';

    if (raceRecords.length === 0) {
        grid.innerHTML = '<p style="text-align:center; grid-column: 1/-1; color: #999; padding: 40px;">저장된 대회 기록이 없습니다. 완주 기록을 등록해보세요!</p>';
        return;
    }

    // 최신순 정렬
    const sorted = [...raceRecords].sort((a, b) => new Date(b.date) - new Date(a.date));

    sorted.forEach(r => {
        const card = document.createElement('div');
        card.className = 'record-card';
        card.style.animation = 'fadeIn 0.5s ease forwards';
        card.style.position = 'relative';
        card.style.cursor = 'pointer';
        card.title = '클릭하여 수정';
        card.onclick = (e) => {
            // 삭제 버튼 클릭 시에는 수정 모드로 진입하지 않음
            if (e.target.tagName !== 'BUTTON') {
                editRaceRecord(r.id);
            }
        };

        const displayType = r.type === '42.195' ? 'Full' : (r.type === '21.0975' ? 'Half' : (r.type ? r.type + 'km' : '기타'));

        card.innerHTML = `
            ${r.photo ? `<img src="${r.photo}" style="width: 100%; height: 150px; object-fit: cover; border-radius: 10px; margin-bottom: 10px;">` :
                `<div style="width: 100%; height: 100px; background: #f0f0f0; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #ccc; margin-bottom: 10px;">No Photo</div>`}
            <div style="font-size: 0.8rem; color: #666; margin-bottom: 5px;">${r.date}</div>
            <div style="font-weight: bold; font-size: 1.1rem; margin-bottom: 5px;">${r.name}</div>
            <div style="color: #667eea; font-weight: bold; margin-bottom: 10px;">${r.time} (${displayType})</div>
            ${r.shoes ? `<div style="font-size: 0.85rem; color: #555; margin-bottom: 5px;">👟 ${r.shoes}</div>` : ''}
            ${r.memo ? `<div style="font-size: 0.85rem; color: #777; font-style: italic; border-top: 1px dashed #eee; padding-top: 5px;">${r.memo}</div>` : ''}
            <button onclick="deleteRaceRecord(${r.id})" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.5); border: none; font-size: 1.2rem; cursor: pointer; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">&times;</button>
        `;
        grid.appendChild(card);
    });
}

// --- 대회 일정 (D-Day) 관련 로직 ---
let schedules = [];

function loadSchedules() {
    const saved = localStorage.getItem('marathon_schedules');
    if (saved) {
        schedules = JSON.parse(saved);
        renderSchedules();
    }
}

function saveSchedules() {
    localStorage.setItem('marathon_schedules', JSON.stringify(schedules));
}

function addSchedule() {
    const editingId = document.getElementById('editing-schedule-id').value;
    const name = document.getElementById('schedule-name').value;
    const type = document.getElementById('schedule-type').value;
    const target = document.getElementById('schedule-target').value;
    const date = document.getElementById('schedule-date').value;

    if (!name || !date) {
        alert('대회명과 날짜/시간을 입력해주세요.');
        return;
    }

    // 페이스 계산
    const pace = calculatePaceValue(type, target);

    if (editingId) {
        // 수정 모드
        const index = schedules.findIndex(s => s.id === parseInt(editingId));
        if (index !== -1) {
            schedules[index] = {
                ...schedules[index],
                name, type, target, pace, date
            };
            logToScreen(`📅 대회 일정 수정 완료: ${name}`);
        }
    } else {
        // 신규 모드
        const newSchedule = {
            id: Date.now(),
            name, type, target, pace, date
        };
        schedules.push(newSchedule);
        logToScreen(`📅 새 대회 일정 추가됨: ${name}`);
    }

    saveSchedules();
    renderSchedules();
    cancelScheduleEdit();

    alert(editingId ? '일정이 수정되었습니다!' : '새 일정이 추가되었습니다!');
}

function editSchedule(id) {
    const s = schedules.find(item => item.id === id);
    if (!s) return;

    // 폼 채우기
    document.getElementById('editing-schedule-id').value = s.id;
    document.getElementById('schedule-name').value = s.name;
    document.getElementById('schedule-type').value = s.type;
    document.getElementById('schedule-target').value = s.target || '';
    document.getElementById('schedule-date').value = s.date;

    // 페이스 미리보기 업데이트
    previewPace();

    // UI 변경
    const addBtn = document.getElementById('add-schedule-btn');
    addBtn.innerHTML = '💾 일정 수정하기';
    addBtn.style.background = '#667eea';
    document.getElementById('cancel-schedule-edit-btn').style.display = 'block';

    // 상단으로 스크롤
    document.querySelector('#schedule-section .control-panel').scrollIntoView({ behavior: 'smooth' });
}

function cancelScheduleEdit() {
    document.getElementById('editing-schedule-id').value = '';
    document.getElementById('schedule-name').value = '';
    document.getElementById('schedule-target').value = '';
    document.getElementById('schedule-date').value = '';
    document.getElementById('pace-preview').innerText = '';

    const addBtn = document.getElementById('add-schedule-btn');
    addBtn.innerHTML = '➕ 일정 추가하기';
    addBtn.style.background = '#667eea';
    document.getElementById('cancel-schedule-edit-btn').style.display = 'none';
}

function calculatePaceValue(type, target) {
    const sec = parseTimeToSeconds(target);
    if (sec <= 0) return null;

    let dist = 10; // Default for 10km if type is not matched
    if (type === 'Full') dist = 42.195;
    else if (type === 'Half') dist = 21.0975;
    else if (type === '10km') dist = 10;
    else if (type === '5km') dist = 5;

    return formatPace(sec / dist);
}

function previewPace() {
    const type = document.getElementById('schedule-type').value;
    const target = document.getElementById('schedule-target').value;
    const pace = calculatePaceValue(type, target);
    const preview = document.getElementById('pace-preview');
    if (pace) {
        preview.innerText = `💡 예상 페이스: ${pace}/km`;
    } else {
        preview.innerText = '';
    }
}

function deleteSchedule(id) {
    if (confirm('이 일정을 삭제하시겠습니까?')) {
        schedules = schedules.filter(s => s.id !== id);
        saveSchedules();
        renderSchedules();
    }
}

function calculateDDay(raceDateTime) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(raceDateTime); // This now correctly parses datetime string
    const raceDay = new Date(raceDateTime);
    raceDay.setHours(0, 0, 0, 0);

    const diffTime = raceDay - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'D-Day';
    if (diffDays > 0) return `D-${diffDays}`;
    return `D+${Math.abs(diffDays)}`;
}

// ==================== 러닝화 관리 ====================
let runningShoes = [];

function loadRunningShoes() {
    const saved = localStorage.getItem('marathon_running_shoes');
    if (saved) {
        runningShoes = JSON.parse(saved);
    }
    renderRunningShoes();
    populateShoesDropdown();
}

function saveRunningShoe() {
    const brand = document.getElementById('shoe-brand').value.trim();
    const model = document.getElementById('shoe-model').value.trim();
    const buyDate = document.getElementById('shoe-buy-date').value;
    const km = parseFloat(document.getElementById('shoe-km').value) || 0;
    const status = document.getElementById('shoe-status').value;
    const memo = document.getElementById('shoe-memo').value.trim();

    if (!brand || !model) {
        alert('브랜드와 모델명을 입력해주세요.');
        return;
    }

    const editingId = document.getElementById('editing-shoe-id').value;
    const fullName = `${brand} ${model}`;

    if (editingId) {
        const index = runningShoes.findIndex(s => s.id === parseInt(editingId));
        if (index !== -1) {
            runningShoes[index] = { ...runningShoes[index], brand, model, fullName, buyDate, km, status, memo };
        }
    } else {
        runningShoes.push({ id: Date.now(), brand, model, fullName, buyDate, km, status, memo });
    }

    localStorage.setItem('marathon_running_shoes', JSON.stringify(runningShoes));
    renderRunningShoes();
    populateShoesDropdown();
    cancelShoeEdit();
    alert(editingId ? '러닝화 정보가 수정되었습니다!' : '러닝화가 저장되었습니다!');
}

function deleteRunningShoe(id) {
    if (!confirm('이 러닝화를 삭제하시겠습니까?')) return;
    runningShoes = runningShoes.filter(s => s.id !== id);
    localStorage.setItem('marathon_running_shoes', JSON.stringify(runningShoes));
    renderRunningShoes();
    populateShoesDropdown();
}

function editRunningShoe(id) {
    const shoe = runningShoes.find(s => s.id === id);
    if (!shoe) return;

    document.getElementById('editing-shoe-id').value = shoe.id;
    document.getElementById('shoe-brand').value = shoe.brand;
    document.getElementById('shoe-model').value = shoe.model;
    document.getElementById('shoe-buy-date').value = shoe.buyDate || '';
    document.getElementById('shoe-km').value = shoe.km || 0;
    document.getElementById('shoe-status').value = shoe.status || '사용중';
    document.getElementById('shoe-memo').value = shoe.memo || '';

    const saveBtn = document.getElementById('save-shoe-btn');
    saveBtn.innerHTML = '💾 러닝화 수정하기';
    saveBtn.style.background = '#667eea';
    document.getElementById('cancel-shoe-edit-btn').style.display = 'block';

    document.querySelector('#shoes-section .record-form-card').scrollIntoView({ behavior: 'smooth' });
}

function cancelShoeEdit() {
    document.getElementById('editing-shoe-id').value = '';
    document.getElementById('shoe-brand').value = '';
    document.getElementById('shoe-model').value = '';
    document.getElementById('shoe-buy-date').value = '';
    document.getElementById('shoe-km').value = '';
    document.getElementById('shoe-status').value = '사용중';
    document.getElementById('shoe-memo').value = '';

    const saveBtn = document.getElementById('save-shoe-btn');
    saveBtn.innerHTML = '💾 러닝화 저장';
    saveBtn.style.background = '#20bf6b';
    document.getElementById('cancel-shoe-edit-btn').style.display = 'none';
}

function renderRunningShoes() {
    const list = document.getElementById('shoes-list');
    if (!list) return;
    list.innerHTML = '';

    if (runningShoes.length === 0) {
        list.innerHTML = '<p style="text-align:center; grid-column: 1/-1; color: #999; padding: 40px;">등록된 러닝화가 없습니다. 새 러닝화를 추가해보세요!</p>';
        return;
    }

    const statusEmoji = { '사용중': '🟢', '보관중': '🟡', '은퇴': '🔴' };
    const statusClass = { '사용중': 'shoe-active', '보관중': 'shoe-stored', '은퇴': 'shoe-retired' };

    runningShoes.forEach(shoe => {
        const card = document.createElement('div');
        card.className = 'shoe-card';
        card.onclick = (e) => { if (e.target.tagName !== 'BUTTON') editRunningShoe(shoe.id); };
        card.title = '클릭하여 수정';

        const kmBar = Math.min((shoe.km / 800) * 100, 100);
        const kmColor = shoe.km < 400 ? '#20bf6b' : shoe.km < 700 ? '#f7b731' : '#eb3b5a';

        card.innerHTML = `
            <div class="shoe-card-header">
                <div class="shoe-icon">👟</div>
                <span class="shoe-status-badge ${statusClass[shoe.status] || 'shoe-active'}">
                    ${statusEmoji[shoe.status] || '🟢'} ${shoe.status}
                </span>
            </div>
            <div class="shoe-brand-name">${shoe.brand}</div>
            <div class="shoe-model-name">${shoe.model}</div>
            ${shoe.buyDate ? `<div class="shoe-meta">📅 ${shoe.buyDate}</div>` : ''}
            <div class="shoe-km-section">
                <div class="shoe-km-label">
                    <span>누적 거리</span>
                    <span style="color:${kmColor}; font-weight:700;">${shoe.km.toFixed(0)} km</span>
                </div>
                <div class="shoe-km-bar-bg">
                    <div class="shoe-km-bar-fill" style="width:${kmBar}%; background:${kmColor};"></div>
                </div>
                <div class="shoe-km-hint">800km 기준</div>
            </div>
            ${shoe.memo ? `<div class="shoe-memo">${shoe.memo}</div>` : ''}
            <button onclick="deleteRunningShoe(${shoe.id})" class="shoe-delete-btn">✕</button>
        `;
        list.appendChild(card);
    });
}

function populateShoesDropdown() {
    const select = document.getElementById('race-shoes-select');
    if (!select) return;

    const currentVal = select.value;

    select.innerHTML = `
        <option value="">-- 러닝화 선택 --</option>
        ${runningShoes.filter(s => s.status !== '은퇴').map(s =>
            `<option value="${s.fullName}">${s.brand} ${s.model}</option>`
        ).join('')}
        <option value="__direct__">✏️ 직접 입력</option>
    `;

    if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
        select.value = currentVal;
    }
}

function handleShoesSelectChange() {
    const select = document.getElementById('race-shoes-select');
    const input = document.getElementById('race-shoes');
    if (select.value === '__direct__') {
        input.style.display = 'block';
        input.focus();
    } else {
        input.style.display = 'none';
        input.value = '';
    }
}

function renderSchedules() {
    const grid = document.getElementById('schedule-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (schedules.length === 0) {
        grid.innerHTML = '<p style="text-align:center; grid-column: 1/-1; color: #999; padding: 40px;">등록된 대회가 없습니다. 일정을 추가해보세요!</p>';
        return;
    }

    // 날짜 순으로 정렬
    const sorted = [...schedules].sort((a, b) => new Date(a.date) - new Date(b.date));

    sorted.forEach(s => {
        const dday = calculateDDay(s.date);
        const card = document.createElement('div');
        card.className = 'record-card'; // 기존 레코드 카드 스타일 재활용
        card.style.animation = 'fadeIn 0.5s ease forwards';
        card.style.position = 'relative';
        card.style.cursor = 'pointer';
        card.title = '클릭하여 수정';
        card.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON') {
                editSchedule(s.id);
            }
        };

        // D-Day 색상 구분
        let ddayColor = '#667eea';
        if (dday === 'D-Day') ddayColor = '#eb4d4b';
        else if (dday.startsWith('D+')) ddayColor = '#999';

        // 날짜/시간 포맷팅
        const d = new Date(s.date);
        const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

        card.innerHTML = `
            <div style="font-size: 0.8rem; color: #666; margin-bottom: 5px;">${dayStr} <span style="color: #667eea; font-weight: bold;">${timeStr} 출발</span></div>
            <div style="font-weight: bold; font-size: 1.1rem; margin-bottom: 10px;">${s.name}</div>
            <div style="background: #f0f4ff; border-radius: 5px; padding: 8px 12px; font-size: 0.9rem; display: block; margin-bottom: 10px; border-left: 3px solid #667eea;">
                <div style="font-weight: bold; color: #333;">${s.type}</div>
                ${s.target ? `<div style="color: #666; margin-top: 4px;">목표: <span style="color: #333; font-weight: bold;">${s.target}</span></div>` : ''}
                ${s.pace ? `<div style="color: #667eea; font-size: 0.8rem; margin-top: 2px;">(예상 페이스: ${s.pace})</div>` : ''}
            </div>
            <div style="font-size: 1.8rem; font-weight: 900; color: ${ddayColor}; margin-top: 5px;">${dday}</div>
            <button onclick="deleteSchedule(${s.id})" style="position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #ddd;">&times;</button>
        `;
        grid.appendChild(card);
    });
}
