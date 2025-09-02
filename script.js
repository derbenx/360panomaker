// --- Basic Three.js Scene Setup ---
let scene, camera, renderer, controls;
const targetPlanes = [];

function init() {
    // Container
    const container = document.getElementById('container');

    // Scene
    scene = new THREE.Scene();

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 0.01; // Start inside the sphere

    // Renderer
    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    // Sphere and wireframe will be created dynamically once camera starts

    // Handle window resizing
    window.addEventListener('resize', onWindowResize, false);

    // Init controls
    controls = new THREE.DeviceOrientationControls(camera);

    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    controls.update(); // Update controls each frame

    renderer.render(scene, camera);

    checkAlignment();
}

// --- Alignment and Capture Logic ---
const raycaster = new THREE.Raycaster();
let alignmentTimer = null;
let currentAlignedTarget = null;
const ALIGNMENT_TIME_MS = 500;

function checkAlignment() {
    if (targetPlanes.length === 0) return;

    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const intersects = raycaster.intersectObjects(targetPlanes);

    let alignedTargetThisFrame = null;

    if (intersects.length > 0) {
        const intersectedPlane = intersects[0].object;
        if (!intersectedPlane.captured) {
            alignedTargetThisFrame = intersectedPlane;
        }
    }

    // Handle visual feedback and timer logic
    if (alignedTargetThisFrame) {
        if (currentAlignedTarget !== alignedTargetThisFrame) {
            if (currentAlignedTarget) {
                currentAlignedTarget.material.color.set(0x555555); // Reset old target
            }
            clearTimeout(alignmentTimer);
            currentAlignedTarget = alignedTargetThisFrame;
            currentAlignedTarget.material.color.set(0x00ff00); // Highlight new target

            alignmentTimer = setTimeout(() => {
                captureAndMapTexture(currentAlignedTarget);
            }, ALIGNMENT_TIME_MS);
        }
    } else {
        if (currentAlignedTarget) {
            currentAlignedTarget.material.color.set(0x555555); // Reset old target
        }
        clearTimeout(alignmentTimer);
        currentAlignedTarget = null;
    }
}

function captureAndMapTexture(targetPlane) {
    if (targetPlane.captured) return;
    console.log("Capturing for plane:", targetPlane.uuid);
    targetPlane.captured = true;
    targetPlane.material.color.set(0xffffff); // Set to white to show texture clearly

    const cameraContainer = document.getElementById('camera-container');
    cameraContainer.style.borderColor = 'red';
    setTimeout(() => { cameraContainer.style.borderColor = 'white'; }, 200);

    const video = document.getElementById('camera-feed');
    const tempCanvas = document.createElement('canvas');

    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const size = Math.min(videoWidth, videoHeight);
    const sx = (videoWidth - size) / 2;
    const sy = (videoHeight - size) / 2;
    tempCanvas.width = size;
    tempCanvas.height = size;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(video, sx, sy, size, size, 0, 0, size, size);

    targetPlane.material.map = new THREE.CanvasTexture(tempCanvas);
    targetPlane.material.wireframe = false;
    targetPlane.material.needsUpdate = true;

    const allCaptured = targetPlanes.every(p => p.captured);
    if (allCaptured) {
        onCompletion();
    }
}

function onCompletion() {
    console.log("All targets captured! Composition complete.");
    document.getElementById('camera-container').style.display = 'none';
    document.getElementById('save-container').style.display = 'flex';

    const saveButton = document.getElementById('saveButton');
    saveButton.addEventListener('click', saveImage);
}

function saveImage() {
    console.log("Stitching final image...");
    const rows = 6;
    const cols = 10;

    const firstPlaneWithTexture = targetPlanes.find(p => p.captured && p.material.map);
    if (!firstPlaneWithTexture) {
        console.error("No captured textures to save.");
        alert("Error: No images were captured.");
        return;
    }
    const tileRes = firstPlaneWithTexture.material.map.image.width;

    const finalWidth = cols * tileRes;
    const finalHeight = rows * tileRes;

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = finalWidth;
    finalCanvas.height = finalHeight;
    const finalCtx = finalCanvas.getContext('2d');

    for (const plane of targetPlanes) {
        if (plane.captured && plane.material.map) {
            const colIndex = plane.gridIndex.col;
            const rowIndex = plane.gridIndex.row;

            if (rowIndex === 0 || rowIndex === rows - 1) {
                // This is a polar plane, stretch the image across the row
                const dy = rowIndex * tileRes;
                finalCtx.drawImage(plane.material.map.image, 0, dy, finalWidth, tileRes);
            } else {
                // This is a regular plane in one of the middle rows
                const dx = colIndex * tileRes;
                const dy = rowIndex * tileRes;
                finalCtx.drawImage(plane.material.map.image, dx, dy, tileRes, tileRes);
            }
        }
    }

    const link = document.createElement('a');
    link.download = 'panorama_tiled.png';
    link.href = finalCanvas.toDataURL('image/png');
    link.click();
}

// --- Device Orientation Logic ---
// This is handled by THREE.DeviceOrientationControls

// --- Camera Feed Logic ---
function createTiledSphere() {
    const rows = 6;
    const cols = 10;
    const radius = 400;

    // Calculate a consistent height for planes based on row separation
    const planeHeight = ((Math.PI * radius) / (rows - 1)) * 0.9; // 0.9 scale factor to leave gaps

    for (let i = 0; i < rows; i++) {
        const phi = (i / (rows - 1)) * Math.PI; // From 0 (top) to PI (bottom)

        if (i === 0 || i === rows - 1) { // Top and bottom polar planes
            const y = radius * Math.cos(phi);

            // For the polar plane, let's base its size on the adjacent row for better visual consistency
            const adjacentPhi = (i === 0) ? (1 / (rows - 1)) * Math.PI : ((rows - 2) / (rows - 1)) * Math.PI;
            const planeWidth = ((2 * Math.PI * radius * Math.sin(adjacentPhi)) / cols) * 0.95;

            const planeGeom = new THREE.PlaneGeometry(planeWidth, planeHeight);
            const planeMat = new THREE.MeshBasicMaterial({ color: 0x555555, side: THREE.DoubleSide, wireframe: true });
            const plane = new THREE.Mesh(planeGeom, planeMat);
            plane.position.set(0, y, 0);
            plane.lookAt(0, 0, 0);

            plane.captured = false;
            plane.gridIndex = { row: i, col: 0 };
            targetPlanes.push(plane);
            scene.add(plane);

        } else { // Middle rows
            const numColsInRow = cols;
            // Taper the width of the planes based on their latitude
            const planeWidth = ((2 * Math.PI * radius * Math.sin(phi)) / numColsInRow) * 0.95;

            for (let j = 0; j < numColsInRow; j++) {
                const theta = (j / numColsInRow) * 2 * Math.PI;

                const x = radius * Math.sin(phi) * Math.cos(theta);
                const y = radius * Math.cos(phi);
                const z = radius * Math.sin(phi) * Math.sin(theta);

                const planeGeom = new THREE.PlaneGeometry(planeWidth, planeHeight);
                const planeMat = new THREE.MeshBasicMaterial({ color: 0x555555, side: THREE.DoubleSide, wireframe: true });
                const plane = new THREE.Mesh(planeGeom, planeMat);
                plane.position.set(x, y, z);
                plane.lookAt(0, 0, 0);

                plane.captured = false;
                plane.gridIndex = { row: i, col: j };
                targetPlanes.push(plane);
                scene.add(plane);
            }
        }
    }
}

async function startCamera() {
    try {
        const constraints = { video: { facingMode: 'environment' } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const videoElement = document.getElementById('camera-feed');
        videoElement.srcObject = stream;

        videoElement.onloadedmetadata = () => {
            createTiledSphere();
            document.getElementById('camera-container').style.display = 'block';
        };

    } catch (err) {
        console.error("Error accessing the camera: ", err);
        alert("Could not access the camera. Please ensure you have granted permission.");
    }
}

function startExperience() {
    // Lock screen orientation
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape-primary').catch(err => {
            console.warn("Could not lock screen orientation:", err);
        });
    }

    // First, request orientation permission
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    controls.connect();
                    startCamera();
                } else {
                    alert('Permission for device orientation not granted.');
                }
                document.getElementById('overlay').style.display = 'none';
            })
            .catch(console.error);
    } else {
        // Handle non-iOS 13+ devices
        controls.connect();
        startCamera();
        document.getElementById('overlay').style.display = 'none';
    }
}

function setupStartButton() {
    const startButton = document.getElementById('startButton');
    startButton.addEventListener('click', () => {
        startExperience();
    });
}

init();
setupStartButton();
