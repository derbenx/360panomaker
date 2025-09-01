const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const captureButton = document.getElementById('capture');
const stitchButton = document.getElementById('stitch');
const context = canvas.getContext('2d');

// Constraints for the video stream
const constraints = {
    video: {
        facingMode: 'environment', // Use the rear camera
        width: { ideal: 1280 },
        height: { ideal: 720 }
    }
};

// Access the camera
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        video.play();
    } catch (err) {
        console.error("Error accessing the camera: ", err);
        alert("Could not access the camera. Please make sure you have granted permission.");
    }
}

let captures = []; // Array to store our captured image data and orientation

// Capture a frame from the video stream
captureButton.addEventListener('click', () => {
    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    // Draw the current video frame onto the canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get the image data from the canvas
    const imageData = canvas.toDataURL('image/jpeg', 0.8); // Use JPEG for smaller file size

    // Store the image data along with the current orientation
    const captureData = {
        image: imageData,
        orientation: { ...currentOrientation } // Create a copy of the orientation object
    };
    captures.push(captureData);

    console.log('Image captured and stored. Total captures:', captures.length);
    console.log('Stored data:', captureData);

    // Enable stitch button if we have enough images
    if (captures.length >= 2) {
        stitchButton.disabled = false;
    }

    // Provide visual feedback
    const container = document.getElementById('container');
    container.style.borderColor = '#00ff00';
    setTimeout(() => {
        container.style.borderColor = '#333';
    }, 500);
});

async function stitchImages() {
    if (!cvReady) {
        console.error('OpenCV.js is not ready.');
        alert('OpenCV is not ready. Please wait a moment.');
        return;
    }
    if (captures.length < 2) {
        console.error('Not enough images to stitch.');
        alert('You need at least two images to stitch.');
        return;
    }

    console.log('Starting sequential stitching process...');
    stitchButton.disabled = true;

    // --- Sort captures by orientation to ensure correct stitching order ---
    let sortedCaptures = captures.filter(c => c.orientation && c.orientation.alpha !== null);
    if (sortedCaptures.length < 2) {
        alert("Not enough captures with orientation data to stitch.");
        stitchButton.disabled = false;
        stitchButton.textContent = 'Stitch Images';
        return;
    }

    sortedCaptures.sort((a, b) => a.orientation.alpha - b.orientation.alpha);

    let largestGap = 0;
    let largestGapIndex = -1;
    for (let i = 0; i < sortedCaptures.length - 1; i++) {
        const gap = sortedCaptures[i+1].orientation.alpha - sortedCaptures[i].orientation.alpha;
        if (gap > largestGap) {
            largestGap = gap;
            largestGapIndex = i;
        }
    }

    // Heuristic to detect wraparound: if a gap is > 180 degrees, it's the one.
    if (largestGap > 180) {
        const part1 = sortedCaptures.slice(0, largestGapIndex + 1);
        const part2 = sortedCaptures.slice(largestGapIndex + 1);
        sortedCaptures = part2.concat(part1);
    }

    console.log("Stitching order based on alpha:", sortedCaptures.map(c => c.orientation.alpha.toFixed(1)));
    captures = sortedCaptures; // Use the sorted captures for the rest of the function

    const loadImageToMat = (imageData) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(cv.imread(canvas));
            };
            img.onerror = reject;
            img.src = imageData;
        });
    };

    let panorama;
    try {
        panorama = await loadImageToMat(captures[0].image);

        for (let i = 1; i < captures.length; i++) {
            stitchButton.textContent = `Stitching ${i + 1}/${captures.length}...`;
            console.log(`Stitching image ${i + 1} of ${captures.length}...`);

            const nextImageMat = await loadImageToMat(captures[i].image);

            const orb = new cv.ORB();
            const keypoints1 = new cv.KeyPointVector();
            const keypoints2 = new cv.KeyPointVector();
            const descriptors1 = new cv.Mat();
            const descriptors2 = new cv.Mat();
            const mask = new cv.Mat();
            const bf = new cv.BFMatcher(cv.NORM_HAMMING, true);
            const matches = new cv.DMatchVector();

            orb.detectAndCompute(panorama, mask, keypoints1, descriptors1);
            orb.detectAndCompute(nextImageMat, mask, keypoints2, descriptors2);

            if (descriptors1.empty() || descriptors2.empty()) {
                console.warn(`Could not find features in image ${i+1}. Skipping.`);
                nextImageMat.delete(); keypoints1.delete(); keypoints2.delete(); descriptors1.delete(); descriptors2.delete(); mask.delete(); bf.delete(); matches.delete();
                continue;
            }

            bf.match(descriptors1, descriptors2, matches);

            let good_matches = [];
            for (let j = 0; j < matches.size(); ++j) good_matches.push(matches.get(j));
            good_matches.sort((a, b) => a.distance - b.distance);
            good_matches = good_matches.slice(0, Math.min(30, good_matches.length));

            if (good_matches.length < 4) {
                console.warn(`Not enough good matches for image ${i+1}. Skipping.`);
                nextImageMat.delete(); keypoints1.delete(); keypoints2.delete(); descriptors1.delete(); descriptors2.delete(); mask.delete(); bf.delete(); matches.delete();
                continue;
            }

            const points1 = [];
            const points2 = [];
            for (let j = 0; j < good_matches.length; j++) {
                points1.push(keypoints1.get(good_matches[j].queryIdx).pt.x, keypoints1.get(good_matches[j].queryIdx).pt.y);
                points2.push(keypoints2.get(good_matches[j].trainIdx).pt.x, keypoints2.get(good_matches[j].trainIdx).pt.y);
            }

            const mat_points1 = cv.matFromArray(points1.length / 2, 1, cv.CV_32FC2, points1);
            const mat_points2 = cv.matFromArray(points2.length / 2, 1, cv.CV_32FC2, points2);
            const homography = cv.findHomography(mat_points2, mat_points1, cv.RANSAC, 5.0);

            if (homography.empty()) {
                console.warn(`Could not compute homography for image ${i+1}. Skipping.`);
                nextImageMat.delete(); keypoints1.delete(); keypoints2.delete(); descriptors1.delete(); descriptors2.delete(); mask.delete(); bf.delete(); matches.delete(); mat_points1.delete(); mat_points2.delete();
                continue;
            }

            const warpedImage = new cv.Mat();
            const dsize = new cv.Size(panorama.cols + nextImageMat.cols, Math.max(panorama.rows, nextImageMat.rows));
            cv.warpPerspective(nextImageMat, warpedImage, homography, dsize);

            const newPanorama = new cv.Mat(dsize.height, dsize.width, panorama.type(), new cv.Scalar(0, 0, 0, 255));
            panorama.copyTo(newPanorama.colRange(0, panorama.cols).rowRange(0, panorama.rows));
            cv.bitwise_or(newPanorama, warpedImage, newPanorama);

            panorama.delete();
            panorama = newPanorama;

            nextImageMat.delete(); keypoints1.delete(); keypoints2.delete(); descriptors1.delete(); descriptors2.delete(); mask.delete(); bf.delete(); matches.delete(); mat_points1.delete(); mat_points2.delete(); homography.delete(); warpedImage.delete();
        }

        console.log("Stitching complete. Displaying result.");
        cv.imshow('canvas', panorama);
        const panoramaDataUrl = canvas.toDataURL('image/jpeg');

        canvas.style.display = 'none';
        document.getElementById('container').style.display = 'none';
        document.getElementById('capture').style.display = 'none';
        document.getElementById('stitch').style.display = 'none';
        document.getElementById('sensor-data').style.display = 'none';

        const panoramaContainer = document.getElementById('panorama-container');
        const viewer = new PANOLENS.Viewer({ container: panoramaContainer, autoRotate: true, autoRotateSpeed: 0.3 });
        const imagePanorama = new PANOLENS.ImagePanorama(panoramaDataUrl);
        viewer.add(imagePanorama);

        panorama.delete();

    } catch (error) {
        console.error('An error occurred during stitching:', error);
        alert('An error occurred during stitching. Check the console for details.');
        if (panorama) panorama.delete();
    } finally {
        stitchButton.disabled = false;
        stitchButton.textContent = 'Stitch Images';
    }
}

stitchButton.addEventListener('click', stitchImages);

// Start the camera when the page loads
startCamera();

// --- Device Orientation ---

const alphaSpan = document.getElementById('alpha');
const betaSpan = document.getElementById('beta');
const gammaSpan = document.getElementById('gamma');

let currentOrientation = {
    alpha: null,
    beta: null,
    gamma: null
};

function handleOrientation(event) {
    currentOrientation.alpha = event.alpha;
    currentOrientation.beta = event.beta;
    currentOrientation.gamma = event.gamma;

    alphaSpan.textContent = event.alpha ? event.alpha.toFixed(2) : 'null';
    betaSpan.textContent = event.beta ? event.beta.toFixed(2) : 'null';
    gammaSpan.textContent = event.gamma ? event.gamma.toFixed(2) : 'null';
}

// iOS 13+ requires user permission to access device orientation events.
// We need to request permission on a user gesture, like a button click.
function requestOrientationPermission() {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation);
                } else {
                    alert('Permission for device orientation not granted.');
                }
            })
            .catch(console.error);
    } else {
        // Handle non-iOS 13+ devices
        window.addEventListener('deviceorientation', handleOrientation);
    }
}

// For simplicity, we'll tie the permission request to the capture button for now.
// A better UX would be a dedicated "Enable Sensors" button.
captureButton.addEventListener('click', requestOrientationPermission, { once: true });

// --- OpenCV Integration ---

let cvReady = false;

function onOpenCvReady() {
    console.log('OpenCV.js is ready.');
    cvReady = true;
    // You can add a visual indicator here if you want
    document.getElementById('container').style.borderColor = '#4caf50'; // Green border
}
