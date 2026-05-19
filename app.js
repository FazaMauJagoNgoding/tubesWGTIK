const CONFIG = {
  modelPath: "./",
  webcamSize: 320,
  flipWebcam: true,
  password: "test123",
  confidenceThreshold: 0.8,
  mobileLockMs: 3000,
  nundukSanctionMs: 15000,
  sideWatchingSanctionMs: 3000,
  penaltyDelayMs: 2000,
  maxSameViolation: 3,
  minKeypointConfidence: 0.35,
  minVisibleKeypoints: 5,
};

const state = {
  model: null,
  webcam: null,
  ctx: null,
  labelContainer: null,
  maxPredictions: 0,
  isRunning: false,
  isLocked: false,
  isPaused: false,
  cheatLimit: 5,
  timers: {
    mobileUseStartAt: null,
    nundukStartAt: null,
    sideWatchingStartAt: null,
  },
  penalties: {
    nunduk: 0,
    sideWatching: 0,
  },
  cooldowns: {
    nundukUntil: 0,
    sideWatchingUntil: 0,
  },
};

const elements = {
  startButton: document.getElementById("start-button"),
  status: document.getElementById("status"),
  cheatLimit: document.getElementById("cheat-limit"),
  activeDetection: document.getElementById("active-detection"),
  detectionDuration: document.getElementById("detection-duration"),
  canvas: document.getElementById("canvas"),
  lockScreen: document.getElementById("lock-screen"),
  lockForm: document.getElementById("lock-form"),
  lockReason: document.getElementById("lock-reason"),
  lockError: document.getElementById("lock-error"),
  passwordInput: document.getElementById("password-input"),
  pauseScreen: document.getElementById("pause-screen"),
  pauseReason: document.getElementById("pause-reason"),
  continueButton: document.getElementById("continue-button"),
  labelContainer: document.getElementById("label-container"),
};

elements.startButton.addEventListener("click", init);
elements.lockForm.addEventListener("submit", unlockProgram);
elements.continueButton.addEventListener("click", continueProgram);

async function init() {
  if (state.isRunning) return;

  elements.startButton.disabled = true;
  setStatus("Loading model...");

  try {
    assertCameraSupport();
    await loadModel();
    await setupWebcam();
    setupCanvas();
    renderPredictionSlots();
    startLoop();
  } catch (error) {
    console.error(error);
    setStatus(getCameraErrorMessage(error));
    elements.startButton.disabled = false;
  }
}

function assertCameraSupport() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Browser ini tidak mendukung akses kamera. Coba pakai Chrome/Edge terbaru.");
  }
}

async function loadModel() {
  const modelURL = CONFIG.modelPath + "model.json";
  const metadataURL = CONFIG.modelPath + "metadata.json";

  state.model = await tmPose.load(modelURL, metadataURL);
  state.maxPredictions = state.model.getTotalClasses();
}

async function setupWebcam() {
  setStatus("Meminta izin kamera...");
  state.webcam = new tmPose.Webcam(CONFIG.webcamSize, CONFIG.webcamSize, CONFIG.flipWebcam);
  await state.webcam.setup();

  setStatus("Menyalakan kamera...");
  await state.webcam.play();
}

function setupCanvas() {
  elements.canvas.width = CONFIG.webcamSize;
  elements.canvas.height = CONFIG.webcamSize;
  state.ctx = elements.canvas.getContext("2d");
  state.labelContainer = elements.labelContainer;
}

function renderPredictionSlots() {
  state.labelContainer.innerHTML = "";

  for (let i = 0; i < state.maxPredictions; i++) {
    const item = document.createElement("div");
    item.className = "prediction";
    item.innerHTML = `
      <div class="prediction-row">
        <span class="label">-</span>
        <span class="value">0%</span>
      </div>
      <div class="bar"><div class="bar-value"></div></div>
    `;
    state.labelContainer.appendChild(item);
  }
}

function startLoop() {
  state.isRunning = true;
  elements.startButton.textContent = "Running";
  setStatus("Webcam running.");
  window.requestAnimationFrame(loop);
}

async function loop() {
  try {
    state.webcam.update();
    drawCamera();
    await predict();
  } catch (error) {
    console.error(error);
    setStatus(`Kamera aktif, tapi prediksi gagal: ${error && error.message ? error.message : "unknown error"}`);
  }

  window.requestAnimationFrame(loop);
}

async function predict() {
  const { pose, posenetOutput } = await state.model.estimatePose(state.webcam.canvas);
  const prediction = await state.model.predict(posenetOutput);
  const predictionsByClass = mapPredictions(prediction);

  updatePredictionUI(prediction);
  updateRules(predictionsByClass, pose);
  drawPose(pose);
}

function mapPredictions(prediction) {
  return prediction.reduce((result, item) => {
    result[item.className] = item.probability;
    return result;
  }, {});
}

function updatePredictionUI(prediction) {
  prediction.forEach((item, index) => {
    const probability = item.probability;
    const predictionEl = state.labelContainer.children[index];
    predictionEl.querySelector(".label").textContent = item.className;
    predictionEl.querySelector(".value").textContent = `${Math.round(probability * 100)}%`;
    predictionEl.querySelector(".bar-value").style.width = `${probability * 100}%`;
  });
}

function updateRules(predictionsByClass, pose) {
  if (state.isLocked || state.isPaused) return;

  const now = Date.now();
  const mobileUse = predictionsByClass["mobile-use"] || 0;
  const nunduk = predictionsByClass.nunduk || 0;
  const sideWatching = predictionsByClass["side-watching"] || 0;

  if (!isPersonDetected(pose)) {
    pauseProgram("User tidak terdeteksi di kamera.");
    return;
  }

  handleMobileUse(mobileUse, now);
  handleNunduk(nunduk, now);
  handleSideWatching(sideWatching, now);

  if (mobileUse < CONFIG.confidenceThreshold && nunduk < CONFIG.confidenceThreshold && sideWatching < CONFIG.confidenceThreshold) {
    setDetectionStatus("-", 0);
  }
}

function handleMobileUse(probability, now) {
  if (probability < CONFIG.confidenceThreshold) {
    state.timers.mobileUseStartAt = null;
    return;
  }

  state.timers.mobileUseStartAt = state.timers.mobileUseStartAt || now;
  const duration = now - state.timers.mobileUseStartAt;
  setDetectionStatus("mobile-use", duration);

  if (duration >= CONFIG.mobileLockMs) {
    lockProgram("Mobile-use terdeteksi >= 80% selama 3 detik.");
  }
}

function handleNunduk(probability, now) {
  if (now < state.cooldowns.nundukUntil) {
    state.timers.nundukStartAt = null;
    return;
  }

  if (probability < CONFIG.confidenceThreshold) {
    state.timers.nundukStartAt = null;
    return;
  }

  state.timers.nundukStartAt = state.timers.nundukStartAt || now;
  const duration = now - state.timers.nundukStartAt;
  setDetectionStatus("nunduk", duration);

  if (duration >= CONFIG.nundukSanctionMs) {
    applyPenalty("nunduk", "Nunduk terlalu lama. Batas kecurangan berkurang 1.");
    state.timers.nundukStartAt = null;
    state.cooldowns.nundukUntil = now + CONFIG.penaltyDelayMs;
  }
}

function handleSideWatching(probability, now) {
  if (now < state.cooldowns.sideWatchingUntil) {
    state.timers.sideWatchingStartAt = null;
    return;
  }

  if (probability < CONFIG.confidenceThreshold) {
    state.timers.sideWatchingStartAt = null;
    return;
  }

  state.timers.sideWatchingStartAt = state.timers.sideWatchingStartAt || now;
  const duration = now - state.timers.sideWatchingStartAt;
  setDetectionStatus("side-watching", duration);

  if (duration >= CONFIG.sideWatchingSanctionMs) {
    applyPenalty("side-watching", "Side-watching terdeteksi >= 80% selama 3 detik. Batas kecurangan berkurang 1.");
    state.timers.sideWatchingStartAt = null;
    state.cooldowns.sideWatchingUntil = now + CONFIG.penaltyDelayMs;
  }
}

function applyPenalty(type, message) {
  state.cheatLimit = Math.max(0, state.cheatLimit - 1);
  elements.cheatLimit.textContent = state.cheatLimit;
  setStatus(message);

  if (type === "nunduk") {
    state.penalties.nunduk += 1;
  }

  if (type === "side-watching") {
    state.penalties.sideWatching += 1;
  }

  if (state.cheatLimit <= 0) {
    lockProgram("Batas kecurangan habis.");
    return;
  }

  pauseAfterRepeatedViolation(type);
}

function pauseAfterRepeatedViolation(type) {
  if (type === "nunduk" && state.penalties.nunduk >= CONFIG.maxSameViolation) {
    state.penalties.nunduk = 0;
    pauseProgram("sistem terpause click tombol lanjutkan, untuk melanjutkan mengerjakan quis");
  }

  if (type === "side-watching" && state.penalties.sideWatching >= CONFIG.maxSameViolation) {
    state.penalties.sideWatching = 0;
    pauseProgram("sistem terpause click tombol lanjutkan, untuk melanjutkan mengerjakan quis");
  }
}

function lockProgram(reason) {
  state.isLocked = true;
  elements.lockReason.textContent = reason + " Masukkan password untuk membuka kembali.";
  elements.lockError.textContent = "";
  elements.passwordInput.value = "";
  elements.lockScreen.classList.add("active");
  elements.passwordInput.focus();
  setStatus("Program terkunci.");
}

function pauseProgram(reason) {
  state.isPaused = true;
  resetDetectionTimers();
  elements.pauseReason.textContent = reason || "sistem terpause click tombol lanjutkan, untuk melanjutkan mengerjakan quis";
  elements.pauseScreen.classList.add("active");
  elements.continueButton.focus();
  setStatus("Sistem terpause.");
}

function continueProgram() {
  state.isPaused = false;
  resetDetectionTimers();
  state.cooldowns.nundukUntil = Date.now() + CONFIG.penaltyDelayMs;
  state.cooldowns.sideWatchingUntil = Date.now() + CONFIG.penaltyDelayMs;
  elements.pauseScreen.classList.remove("active");
  setStatus("Sistem dilanjutkan.");
  setDetectionStatus("-", 0);
}

function unlockProgram(event) {
  event.preventDefault();

  if (elements.passwordInput.value !== CONFIG.password) {
    elements.lockError.textContent = "Password salah.";
    elements.passwordInput.select();
    return;
  }

  state.isLocked = false;
  state.isPaused = false;
  resetDetectionTimers();
  elements.lockScreen.classList.remove("active");
  elements.pauseScreen.classList.remove("active");
  setStatus("Program terbuka kembali.");
  setDetectionStatus("-", 0);
}

function resetDetectionTimers() {
  state.timers.mobileUseStartAt = null;
  state.timers.nundukStartAt = null;
  state.timers.sideWatchingStartAt = null;
}

function setDetectionStatus(label, durationMs) {
  elements.activeDetection.textContent = label;
  elements.detectionDuration.textContent = `${Math.floor(durationMs / 1000)}s`;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function drawCamera() {
  if (!state.webcam.canvas) return;

  state.ctx.drawImage(state.webcam.canvas, 0, 0);
}

function drawPose(pose) {
  if (!pose) return;

  const minPartConfidence = 0.5;
  tmPose.drawKeypoints(pose.keypoints, minPartConfidence, state.ctx);
  tmPose.drawSkeleton(pose.keypoints, minPartConfidence, state.ctx);
}

function isPersonDetected(pose) {
  if (!pose || !Array.isArray(pose.keypoints)) return false;

  const visibleKeypoints = pose.keypoints.filter((keypoint) => {
    return keypoint.score >= CONFIG.minKeypointConfidence;
  });

  return visibleKeypoints.length >= CONFIG.minVisibleKeypoints;
}

function getCameraErrorMessage(error) {
  if (error && error.name === "NotAllowedError") {
    return "Kamera diblokir. Klik ikon kamera/gembok di address bar, pilih Allow, lalu tekan Start lagi.";
  }

  if (error && error.name === "NotFoundError") {
    return "Kamera tidak ditemukan. Pastikan webcam tersambung dan tidak dimatikan.";
  }

  if (error && error.name === "NotReadableError") {
    return "Kamera sedang dipakai aplikasi lain. Tutup Zoom/Meet/Camera app, lalu coba lagi.";
  }

  return `Gagal menyalakan kamera: ${error && error.message ? error.message : "unknown error"}`;
}
