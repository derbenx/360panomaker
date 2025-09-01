// --- Basic Three.js Scene Setup ---
let scene, camera, renderer, sphere;
const targets = [];

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

    // Sphere (our 360 canvas)
    const geometry = new THREE.SphereGeometry(500, 60, 40);
    // Invert the geometry on the x-axis so we see the inside
    geometry.scale(-1, 1, 1);

    // Create a canvas texture for the sphere
    const sphereCanvas = document.createElement('canvas');
    sphereCanvas.width = 4096; // High resolution for the texture
    sphereCanvas.height = 2048;
    const sphereContext = sphereCanvas.getContext('2d');
    sphereContext.fillStyle = 'rgba(40, 40, 40, 1)';
    sphereContext.fillRect(0, 0, sphereCanvas.width, sphereCanvas.height);
    const sphereTexture = new THREE.CanvasTexture(sphereCanvas);

    const material = new THREE.MeshBasicMaterial({ map: sphereTexture });
    sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    createTargetSlots();

    // Handle window resizing
    window.addEventListener('resize', onWindowResize, false);

    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    // Smoothly update the camera's rotation
    if (deviceOrientation) {
        const euler = new THREE.Euler(
            THREE.MathUtils.degToRad(deviceOrientation.beta),
            THREE.MathUtils.degToRad(deviceOrientation.alpha),
            -THREE.MathUtils.degToRad(deviceOrientation.gamma),
            'YXZ' // This order is often recommended for device orientation
        );
        const quaternion = new THREE.Quaternion().setFromEuler(euler);
        camera.quaternion.slerp(quaternion, 0.1); // slerp for smooth transition
    }

    renderer.render(scene, camera);

    checkAlignment();
}

// --- Alignment and Capture Logic ---
let alignmentTimer = null;
let currentAlignedTarget = null;
const ALIGNMENT_TIME_MS = 500; // 0.5 seconds to lock on

function checkAlignment() {
    if (!targets.length) return;

    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    let alignedTargetThisFrame = null;

    // Find the first target we are aimed at
    for (const target of targets) {
        if (target.captured) continue;
        const targetDirection = new THREE.Vector3().subVectors(target.position, camera.position).normalize();
        const angle = cameraDirection.angleTo(targetDirection);
        if (angle < 0.1) {
            alignedTargetThisFrame = target;
            break;
        }
    }

    if (alignedTargetThisFrame) {
        if (currentAlignedTarget !== alignedTargetThisFrame) {
            // Aiming at a new target, reset timer and visual feedback
            if (currentAlignedTarget) {
                currentAlignedTarget.mesh.material.opacity = 0.5;
            }
            clearTimeout(alignmentTimer);
            currentAlignedTarget = alignedTargetThisFrame;
            currentAlignedTarget.mesh.material.opacity = 1.0; // "selected" visual

            alignmentTimer = setTimeout(() => {
                captureAndMapTexture(currentAlignedTarget);
            }, ALIGNMENT_TIME_MS);
        }
    } else {
        // Not aiming at any target, reset everything
        if (currentAlignedTarget) {
            currentAlignedTarget.mesh.material.opacity = 0.5;
        }
        clearTimeout(alignmentTimer);
        currentAlignedTarget = null;
    }
}

function captureAndMapTexture(target) {
    if (target.captured) return; // Don't capture twice
    console.log("Capturing for target at position:", target.position);

    target.captured = true;
    target.mesh.visible = false;

    const video = document.getElementById('camera-feed');
    const tempCanvas = document.createElement('canvas');
    // Use the video's intrinsic dimensions for the temp canvas
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const tempCtx = tempCanvas.getContext('2d');
    // Draw the current video frame to the temp canvas
    tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    // Get the main sphere's texture canvas
    const sphereCanvas = sphere.material.map.image;
    const sphereCtx = sphereCanvas.getContext('2d');

    // Convert the 3D target position to 2D UV coordinates
    const normalizedPosition = target.position.clone().normalize();
    const u = 0.5 + Math.atan2(normalizedPosition.z, normalizedPosition.x) / (2 * Math.PI);
    const v = 0.5 - Math.asin(normalizedPosition.y) / Math.PI;

    // Calculate destination on the texture canvas
    const destX = u * sphereCanvas.width;
    const destY = v * sphereCanvas.height;

    // This is a simplified projection; a more advanced solution would
    // warp the image. For now, we draw it as a rotated rectangle.
    const drawWidth = 300; // The size of the patch on the texture
    const drawHeight = 300;

    sphereCtx.save();
    sphereCtx.translate(destX, destY);
    // We need to figure out the rotation to match the view
    // This is complex. For now, we draw un-rotated.
    sphereCtx.drawImage(tempCanvas, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    sphereCtx.restore();

    // Tell Three.js to update the texture
    sphere.material.map.needsUpdate = true;

    // Check for completion
    const allCaptured = targets.every(t => t.captured);
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
    const canvas = sphere.material.map.image;
    const link = document.createElement('a');
    link.download = 'panorama-360.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
}

function createTargetSlots() {
    const numTargets = 8; // 8 targets around the equator
    const radius = 490; // Slightly inside the sphere's radius of 500

    const targetGeometry = new THREE.PlaneGeometry(30, 30);
    // TODO: Use a texture for the target, like a camera icon
    const targetMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5
    });

    for (let i = 0; i < numTargets; i++) {
        const angle = (i / numTargets) * Math.PI * 2; // Angle in radians

        const x = radius * Math.cos(angle);
        const z = radius * Math.sin(angle);
        const y = 0;

        const position = new THREE.Vector3(x, y, z);

        const target = new THREE.Mesh(targetGeometry, targetMaterial);
        target.position.copy(position);
        target.lookAt(0, 0, 0);

        const targetData = {
            mesh: target,
            position: position,
            captured: false
        };
        targets.push(targetData);
        scene.add(target);
    }
}

// --- Device Orientation Logic ---
let deviceOrientation = null;

function handleOrientation(event) {
    deviceOrientation = event;
}

// --- Camera Feed Logic ---
async function startCamera() {
    try {
        const constraints = { video: { facingMode: 'environment' } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const videoElement = document.getElementById('camera-feed');
        videoElement.srcObject = stream;
        document.getElementById('camera-container').style.display = 'block';
    } catch (err) {
        console.error("Error accessing the camera: ", err);
        alert("Could not access the camera. Please ensure you have granted permission.");
    }
}

function startExperience() {
    // First, request orientation permission
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation, true);
                    // If permission is granted, also start the camera
                    startCamera();
                } else {
                    alert('Permission for device orientation not granted.');
                }
                // Hide overlay after user interaction
                document.getElementById('overlay').style.display = 'none';
            })
            .catch(console.error);
    } else {
        // Handle non-iOS 13+ devices
        window.addEventListener('deviceorientation', handleOrientation, true);
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
