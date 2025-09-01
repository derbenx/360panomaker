// Version: 0.2.0
// Remember to increment on major changes.

// --- Basic Three.js Scene Setup ---
let scene, camera, renderer, sphere, controls;

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
const capturedFaces = new Set();
let alignmentTimer = null;
let currentAlignedFaceIndex = null;
const ALIGNMENT_TIME_MS = 500;

function checkAlignment() {
    if (!sphere) return; // Do not run until the sphere is created

    raycaster.setFromCamera({ x: 0, y: 0 }, camera); // Ray from center of view
    const intersects = raycaster.intersectObject(sphere);

    if (intersects.length > 0) {
        const intersectedFace = intersects[0].face;
        const faceIndex = intersectedFace.a; // Use the first vertex index as a unique ID for the face

        if (!capturedFaces.has(faceIndex)) {
            // Aiming at a new, un-captured face
            if (currentAlignedFaceIndex !== faceIndex) {
                // Pointing at a new face, reset timer
                clearTimeout(alignmentTimer);
                currentAlignedFaceIndex = faceIndex;

                alignmentTimer = setTimeout(() => {
                    captureAndMapTexture(intersectedFace);
                }, ALIGNMENT_TIME_MS);
            }
            // Optional: Add visual feedback here for "locking on"
        } else {
            // Aiming at an already captured face, do nothing.
            clearTimeout(alignmentTimer);
            currentAlignedFaceIndex = null;
        }
    } else {
        // Not aiming at anything, reset timer
        clearTimeout(alignmentTimer);
        currentAlignedFaceIndex = null;
    }
}

function captureAndMapTexture(face) {
    const faceIndex = face.a; // Use the first vertex index as a unique ID
    if (capturedFaces.has(faceIndex)) return;

    console.log("Capturing for face index:", faceIndex);
    capturedFaces.add(faceIndex);

    // Flash the camera border red for feedback
    const cameraContainer = document.getElementById('camera-container');
    cameraContainer.style.borderColor = 'red';
    setTimeout(() => { cameraContainer.style.borderColor = 'white'; }, 200);

    const video = document.getElementById('camera-feed');
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    // Get texture canvas and geometry UVs
    const sphereCanvas = sphere.material.map.image;
    const sphereCtx = sphereCanvas.getContext('2d');
    const uvAttribute = sphere.geometry.attributes.uv;

    // Get UVs for the face's vertices
    const uvA = new THREE.Vector2().fromBufferAttribute(uvAttribute, face.a);
    const uvB = new THREE.Vector2().fromBufferAttribute(uvAttribute, face.b);
    const uvC = new THREE.Vector2().fromBufferAttribute(uvAttribute, face.c);

    // Calculate the centroid of the UV triangle
    const centroidU = (uvA.x + uvB.x + uvC.x) / 3;
    const centroidV = (uvA.y + uvB.y + uvC.y) / 3;

    // Convert UV centroid to pixel coordinates on the canvas
    const destX = centroidU * sphereCanvas.width;
    const destY = (1 - centroidV) * sphereCanvas.height; // Y is inverted

    // Simple approximation for the size of the patch to draw
    const drawSize = 350;

    console.log(`Drawing image at UV_centroid: (${centroidU.toFixed(2)}, ${centroidV.toFixed(2)}) -> Pixel: (${destX.toFixed(0)}, ${destY.toFixed(0)})`);

    sphereCtx.save();
    sphereCtx.translate(destX, destY);
    sphereCtx.drawImage(tempCanvas, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
    sphereCtx.restore();

    sphere.material.map.needsUpdate = true;

    // Check for completion
    const totalFaces = sphere.geometry.index.count / 3;
    if (capturedFaces.size >= totalFaces) {
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
    const canvas = sphere.material.map.image;
    const link = document.createElement('a');
    link.download = 'panorama-360.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
}

// --- Device Orientation Logic ---
// This will now be handled by THREE.DeviceOrientationControls

// --- Camera Feed Logic ---
function createSpheres(video) {
    const aspectRatio = video.videoWidth / video.videoHeight;
    const heightSegments = 20;
    const widthSegments = Math.round(heightSegments * aspectRatio);
    console.log(`Creating sphere with ${widthSegments}x${heightSegments} segments to match aspect ratio ${aspectRatio.toFixed(2)}`);

    const geometry = new THREE.SphereGeometry(500, widthSegments, heightSegments);
    geometry.scale(-1, 1, 1);

    const sphereCanvas = document.createElement('canvas');
    sphereCanvas.width = 8192;
    sphereCanvas.height = 4096;
    const sphereContext = sphereCanvas.getContext('2d');
    sphereContext.fillStyle = 'rgba(40, 40, 40, 1)';
    sphereContext.fillRect(0, 0, sphereCanvas.width, sphereCanvas.height);
    const sphereTexture = new THREE.CanvasTexture(sphereCanvas);

    const material = new THREE.MeshBasicMaterial({ map: sphereTexture });
    sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    const wireframeMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.2
    });
    const wireframeSphere = new THREE.Mesh(geometry, wireframeMaterial);
    scene.add(wireframeSphere);
}

async function startCamera() {
    try {
        const constraints = { video: { facingMode: 'environment' } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const videoElement = document.getElementById('camera-feed');
        videoElement.srcObject = stream;

        videoElement.onloadedmetadata = () => {
            createSpheres(videoElement);
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
