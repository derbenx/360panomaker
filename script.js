// --- Basic Three.js Scene Setup ---
let scene, camera, renderer, controls;
const targetPlanes = [];
let hasCaptureEnded = false;
let stitchedImageCanvas = null;

// Preview scene variables
let previewScene, previewCamera, previewRenderer, previewControls, previewSphere;
let previewAnimationId;

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

    // Set up results buttons
    const saveButton = document.getElementById('saveButton');
    saveButton.addEventListener('click', downloadStitchedImage);

    const showButton = document.getElementById('showButton');
    showButton.addEventListener('click', showPreview);

    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    if (previewRenderer) {
        previewCamera.aspect = window.innerWidth / window.innerHeight;
        previewCamera.updateProjectionMatrix();
        previewRenderer.setSize(window.innerWidth, window.innerHeight);
    }
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

function endCaptureSequence() {
    if (hasCaptureEnded) return;
    hasCaptureEnded = true;

    console.log("Capture sequence ended.");

    // Stop camera and controls
    const cameraContainer = document.getElementById('camera-container');
    cameraContainer.style.display = 'none';
    const videoElement = document.getElementById('camera-feed');
    if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
    }
    controls.disconnect();

    // Hide the main scene
    const container = document.getElementById('container');
    container.style.display = 'none';

    // Remove the click listener
    container.removeEventListener('click', endCaptureSequence);

    // Stitch the image and show the results screen
    stitchImage();
    document.getElementById('results-container').style.display = 'flex';
}

function onCompletion() {
    console.log("All targets captured! Composition complete.");
    endCaptureSequence();
}

function stitchImage() {
    console.log("Stitching final image to memory...");
    const rows = 16;
    const cols = 16;
    const finalWidth = 8192;
    const finalHeight = 4096;

    stitchedImageCanvas = document.createElement('canvas');
    stitchedImageCanvas.width = finalWidth;
    stitchedImageCanvas.height = finalHeight;
    const finalCtx = stitchedImageCanvas.getContext('2d');

    // Fill with black initially
    finalCtx.fillStyle = 'black';
    finalCtx.fillRect(0, 0, finalWidth, finalHeight);

    const tileWidth = finalWidth / cols;
    const tileHeight = finalHeight / rows;

    for (const plane of targetPlanes) {
        if (plane.captured && plane.material.map) {
            const colIndex = plane.gridIndex.col;
            const rowIndex = plane.gridIndex.row;
            const dx = colIndex * tileWidth;
            const dy = rowIndex * tileHeight;
            finalCtx.drawImage(plane.material.map.image, dx, dy, tileWidth, tileHeight);
        }
    }
    console.log("Image stitched.");
}

function downloadStitchedImage() {
    if (!stitchedImageCanvas) {
        console.error("No stitched image to save.");
        return;
    }
    const link = document.createElement('a');
    link.download = 'panorama_8k.png';
    link.href = stitchedImageCanvas.toDataURL('image/png');
    link.click();
}

function initPreviewScene() {
    const previewContainer = document.getElementById('preview-container');

    // Scene
    previewScene = new THREE.Scene();

    // Camera
    previewCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    previewCamera.position.z = 0.01;

    // Renderer
    previewRenderer = new THREE.WebGLRenderer();
    previewRenderer.setSize(window.innerWidth, window.innerHeight);
    previewContainer.appendChild(previewRenderer.domElement);

    // Sphere
    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1); // Invert the sphere normals to see the texture from the inside
    const texture = new THREE.CanvasTexture(stitchedImageCanvas);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    previewSphere = new THREE.Mesh(geometry, material);
    previewScene.add(previewSphere);

    // Controls
    previewControls = new THREE.DeviceOrientationControls(previewCamera);

    // Listener to close preview
    previewContainer.addEventListener('click', hidePreview, false);
}

function animatePreview() {
    previewAnimationId = requestAnimationFrame(animatePreview);
    previewControls.update();
    previewRenderer.render(previewScene, previewCamera);
}

function showPreview() {
    if (!stitchedImageCanvas) {
        alert("No image has been stitched yet.");
        return;
    }

    const resultsContainer = document.getElementById('results-container');
    const previewContainer = document.getElementById('preview-container');

    resultsContainer.style.display = 'none';
    previewContainer.style.display = 'block';

    if (!previewScene) {
        initPreviewScene();
    } else {
        // Update texture if it already exists
        previewSphere.material.map.needsUpdate = true;
    }

    previewControls.connect();
    animatePreview();
}

function hidePreview() {
    const resultsContainer = document.getElementById('results-container');
    const previewContainer = document.getElementById('preview-container');

    previewContainer.style.display = 'none';
    resultsContainer.style.display = 'flex';

    previewControls.disconnect();
    cancelAnimationFrame(previewAnimationId);
}

// --- Device Orientation Logic ---
// This is handled by THREE.DeviceOrientationControls

// --- Camera Feed Logic ---
function createTiledSphere() {
    const rows = 16;
    const cols = 16;
    const radius = 400;

    const planeSize = ((2 * Math.PI * radius) / cols) * 0.95;

    for (let i = 0; i < rows; i++) {
        const phi = (i / (rows - 1)) * Math.PI;
        for (let j = 0; j < cols; j++) {
            const theta = (j / cols) * 2 * Math.PI;

            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.cos(phi);
            const z = radius * Math.sin(phi) * Math.sin(theta);

            const planeGeom = new THREE.PlaneGeometry(planeSize, planeSize);
            const planeMat = new THREE.MeshBasicMaterial({
                color: 0x555555,
                side: THREE.DoubleSide,
                wireframe: true
            });
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

async function startCamera() {
    try {
        const constraints = { video: { facingMode: 'environment' } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const videoElement = document.getElementById('camera-feed');
        videoElement.srcObject = stream;

        videoElement.onloadedmetadata = () => {
            createTiledSphere();
            document.getElementById('camera-container').style.display = 'block';
            // Add listener to end capture via click
            document.getElementById('container').addEventListener('click', endCaptureSequence, false);
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
