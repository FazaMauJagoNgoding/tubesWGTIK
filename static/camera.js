const startButton = document.getElementById("startButton");
const appElement = document.querySelector(".app");
const video = document.getElementById("video");
const frameCanvas = document.getElementById("frameCanvas");
const statusElement = document.getElementById("status");
const predictionText = document.getElementById("predictionText");
const confidenceText = document.getElementById("confidenceText");
const reasonsElement = document.getElementById("reasons");
const frameContext = frameCanvas.getContext("2d");

let isRunning = false;
let isPredicting = false;
let intervalId = null;

startButton.addEventListener("click", startCamera);

function setStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.className = isError ? "status error" : "status";
}

async function startCamera() {
    if (isRunning) return;

    try {
        startButton.disabled = true;
        setStatus("Membuka kamera...");

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Browser tidak mendukung kamera. Gunakan Chrome atau Edge.");
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: "user"
            },
            audio: false
        });

        video.srcObject = stream;
        await video.play();

        isRunning = true;
        startButton.hidden = true;
        setStatus("");
        intervalId = setInterval(sendFrame, 350);
    } catch (error) {
        startButton.disabled = false;
        setStatus(formatCameraError(error), true);
    }
}

function formatCameraError(error) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        return "Izin kamera ditolak. Klik ikon kamera/lock di address bar, lalu pilih Allow.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        return "Kamera tidak ditemukan. Pastikan webcam aktif/terpasang.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        return "Kamera sedang dipakai aplikasi lain. Tutup Zoom/Meet/Camera app lalu coba lagi.";
    }
    return "Error kamera: " + error.message;
}

async function sendFrame() {
    if (!isRunning || isPredicting || video.readyState < 2) return;

    isPredicting = true;
    try {
        drawFrameToCanvas();

        const image = frameCanvas.toDataURL("image/jpeg", 0.72);
        const response = await fetch("/predict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image })
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Backend gagal memproses frame");
        }

        updatePrediction(result);
    } catch (error) {
        setStatus("Backend error: " + error.message, true);
    } finally {
        isPredicting = false;
    }
}

function drawFrameToCanvas() {
    frameContext.save();
    frameContext.scale(-1, 1);
    frameContext.drawImage(video, -frameCanvas.width, 0, frameCanvas.width, frameCanvas.height);
    frameContext.restore();
}

function updatePrediction(result) {
    predictionText.textContent = result.detected ? result.label || "-" : "No pose detected";
    confidenceText.textContent = "Confidence: " + Math.round((result.confidence || 0) * 100) + "%";
    setStatus(result.detected ? "" : "Arahkan badan dan wajah ke kamera.");
    appElement.classList.toggle("show-detail", result.detected);
    renderReasons(result.reasons || []);
}

function renderReasons(reasons) {
    reasonsElement.innerHTML = "";

    reasons.forEach((reason) => {
        const item = document.createElement("li");
        item.textContent = reason;
        reasonsElement.appendChild(item);
    });
}

window.addEventListener("beforeunload", () => {
    if (intervalId) {
        clearInterval(intervalId);
    }
});
