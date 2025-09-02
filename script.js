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
    targetPlane.captureOrientation = camera.quaternion.clone(); // Store orientation
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

function drawSimpleGrid(context, planes) {
    // This is the fallback logic, refactored into a helper
    console.log("Drawing simple grid...");
    const rows = 6;
    const cols = 10;
    const tileWidth = context.canvas.width / cols;
    const tileHeight = context.canvas.height / rows;

    for (const plane of planes) {
        const colIndex = plane.gridIndex.col;
        const rowIndex = plane.gridIndex.row;

        if (rowIndex === 0 || rowIndex === rows - 1) {
            const dy = rowIndex * tileHeight;
            context.drawImage(plane.material.map.image, 0, dy, context.canvas.width, tileHeight);
        } else {
            const dx = colIndex * tileWidth;
            const dy = rowIndex * tileHeight;
            context.drawImage(plane.material.map.image, dx, dy, tileWidth, tileHeight);
        }
    }
}

function stitchImage() {
    console.log("Stitching final image with multi-row pipeline...");

    const finalWidth = 8192;
    const finalHeight = 4096;
    stitchedImageCanvas = document.createElement('canvas');
    stitchedImageCanvas.width = finalWidth;
    stitchedImageCanvas.height = finalHeight;
    const finalCtx = stitchedImageCanvas.getContext('2d');
    finalCtx.fillStyle = 'black';
    finalCtx.fillRect(0, 0, finalWidth, finalHeight);

    if (!window.cv || !window.cv.imread) {
        alert("OpenCV is not ready, showing simple grid.");
        drawSimpleGrid(finalCtx, targetPlanes.filter(p => p.captured && p.material.map));
        return;
    }

    const capturedPlanes = targetPlanes.filter(p => p.captured && p.material.map);
    if (capturedPlanes.length === 0) {
        return; // Nothing to draw
    }

    // Group planes by row and sort them
    const planesByRow = new Map();
    for (const plane of capturedPlanes) {
        const row = plane.gridIndex.row;
        if (!planesByRow.has(row)) planesByRow.set(row, []);
        planesByRow.get(row).push(plane);
    }
    for (const planes of planesByRow.values()) {
        planes.sort((a, b) => a.gridIndex.col - b.gridIndex.col);
    }

    const totalRows = 6;
    const totalCols = 10;
    const rowHeight = finalHeight / totalRows;

    // Process each row
    for (let i = 0; i < totalRows; i++) {
        if (!planesByRow.has(i) || planesByRow.get(i).length === 0) {
            continue; // Skip empty rows
        }

        let rowPlanes = planesByRow.get(i);
        let dy = i * rowHeight;

        // Handle polar rows by stretching
        if (i === 0 || i === totalRows - 1) {
            finalCtx.drawImage(rowPlanes[0].material.map.image, 0, dy, finalWidth, rowHeight);
            continue;
        }

        // Handle middle rows
        if (rowPlanes.length < 2) {
            // Not enough images to stitch, just draw the ones we have
            const tileWidth = finalWidth / totalCols;
            for(const plane of rowPlanes) {
                 const dx = plane.gridIndex.col * tileWidth;
                 finalCtx.drawImage(plane.material.map.image, dx, dy, tileWidth, rowHeight);
            }
        } else {
            // Stitch the row
            console.log(`Stitching row ${i} with ${rowPlanes.length} images.`);
            let rowMats = rowPlanes.map(plane => cv.imread(plane.material.map.image));

            let panorama = rowMats[0];
            for (let j = 1; j < rowMats.length; j++) {
                let nextImage = rowMats[j];
                let newPanorama = stitchPair(panorama, nextImage);
                panorama.delete();
                panorama = newPanorama;
            }

            // Draw the stitched row panorama to the final canvas
            let tempCanvas = document.createElement('canvas');
            cv.imshow(tempCanvas, panorama);
            finalCtx.drawImage(tempCanvas, 0, dy, finalWidth, rowHeight);

            panorama.delete();
            // Cleanup remaining source mats
            for(let j = 1; j < rowMats.length; j++) {
                 rowMats[j].delete();
            }
        }
    }
    console.log("Multi-row stitching process complete.");
}

function stitchPair(img1, img2) {
    // This function attempts to stitch img2 onto img1 and returns a new cv.Mat.
    // The caller is responsible for deleting the returned Mat.
    let keypoints1 = new cv.KeyPointVector();
    let keypoints2 = new cv.KeyPointVector();
    let descriptors1 = new cv.Mat();
    let descriptors2 = new cv.Mat();
    let orb = null;
    let matcher = null;
    let matches = null;
    let homography = null;
    let srcMat = null;
    let dstMat = null;
    let result = new cv.Mat();

    try {
        orb = new cv.ORB();
        orb.detectAndCompute(img1, new cv.Mat(), keypoints1, descriptors1);
        orb.detectAndCompute(img2, new cv.Mat(), keypoints2, descriptors2);

        matcher = new cv.BFMatcher(cv.NORM_HAMMING, true);
        matches = new cv.DMatchVector();
        matcher.match(descriptors1, descriptors2, matches);

        let srcPts = [];
        let dstPts = [];
        for (let i = 0; i < matches.size(); i++) {
            let match = matches.get(i);
            srcPts.push(keypoints1.get(match.queryIdx).pt.x, keypoints1.get(match.queryIdx).pt.y);
            dstPts.push(keypoints2.get(match.trainIdx).pt.x, keypoints2.get(match.trainIdx).pt.y);
        }

        if (srcPts.length < 8) { // Need at least 4 points (8 values)
            console.warn("Not enough matches to find homography. Returning base image.");
            img1.copyTo(result);
            return result;
        }

        srcMat = cv.matFromArray(srcPts.length / 2, 2, cv.CV_32F, srcPts);
        dstMat = cv.matFromArray(dstPts.length / 2, 2, cv.CV_32F, dstPts);

        homography = cv.findHomography(dstMat, srcMat, cv.RANSAC);

        if (homography.empty()) {
            console.warn("Could not find homography. Returning base image.");
            img1.copyTo(result);
            return result;
        }

        let dsize = new cv.Size(img1.cols + img2.cols, img1.rows);
        cv.warpPerspective(img2, result, homography, dsize);

        let roi = new cv.Rect(0, 0, img1.cols, img1.rows);
        img1.copyTo(result.roi(roi));

        return result;
    } catch (err) {
        console.error("Error in stitchPair:", err);
        img1.copyTo(result);
        return result;
    } finally {
        // Cleanup all created OpenCV objects
        if (keypoints1) keypoints1.delete();
        if (keypoints2) keypoints2.delete();
        if (descriptors1) descriptors1.delete();
        if (descriptors2) descriptors2.delete();
        if (orb) orb.delete();
        if (matcher) matcher.delete();
        if (matches) matches.delete();
        if (homography) homography.delete();
        if (srcMat) srcMat.delete();
        if (dstMat) dstMat.delete();
    }
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

function onOpenCvReady() {
    // cv is loaded, but we need to wait for the runtime to be initialized.
    cv.onRuntimeInitialized = () => {
        console.log("OpenCV.js is ready.");
        const startButton = document.getElementById('startButton');
        startButton.disabled = false;
        startButton.textContent = 'Start';
    }
}

function setupStartButton() {
    const startButton = document.getElementById('startButton');
    startButton.disabled = true;
    startButton.textContent = 'Loading OpenCV...';
    startButton.addEventListener('click', () => {
        startExperience();
    });
}

init();
setupStartButton();
