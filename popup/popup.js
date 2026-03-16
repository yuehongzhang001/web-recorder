let currentMode = 'always';
let recordingState = 'idle';
let currentSessionId = null;

const setupView = document.getElementById('setup-view');
const recordingView = document.getElementById('recording-view');
const modeBtns = document.querySelectorAll('.mode-btn');
const timedSettings = document.getElementById('timed-settings');
const alwaysSettings = document.getElementById('always-settings');
const btnStart = document.getElementById('btn-start');
const btnPause = document.getElementById('btn-pause');
const btnResume = document.getElementById('btn-resume');
const btnStop = document.getElementById('btn-stop');
const btnExportLogs = document.getElementById('btn-export-logs');
const btnClearLogs = document.getElementById('btn-clear-logs');
const elapsedTimeDisplay = document.getElementById('elapsed-time');
const statusBadge = document.getElementById('status-badge');
const inputDuration = document.getElementById('input-duration');
const inputMaxDuration = document.getElementById('input-max-duration');

DebugLogger.init({
    context: 'popup',
    getSessionId: () => currentSessionId,
    getStateSnapshot: () => ({
        recordingState,
        currentMode
    })
});

// Initialize state from background
async function initState() {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    updateUI(state);
    DebugLogger.info('popup.initState.completed', {
        isRecording: state?.isRecording || false
    });
}

function updateUI(state) {
    currentSessionId = state?.sessionId || null;
    if (state.isRecording) {
        setupView.classList.remove('active');
        recordingView.classList.add('active');

        recordingState = state.isPaused ? 'paused' : 'recording';

        if (state.isPaused) {
            btnPause.classList.add('hidden');
            btnResume.classList.remove('hidden');
            statusBadge.textContent = 'Paused';
            statusBadge.classList.remove('recording');
            statusBadge.classList.add('paused');
        } else {
            btnPause.classList.remove('hidden');
            btnResume.classList.add('hidden');
            statusBadge.textContent = 'Recording';
            statusBadge.classList.add('recording');
            statusBadge.classList.remove('paused');
        }

        updateTimer(state.elapsedTime);
    } else {
        setupView.classList.add('active');
        recordingView.classList.remove('active');
    }
}

function updateTimer(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));

    const h = hours.toString().padStart(2, '0');
    const m = minutes.toString().padStart(2, '0');
    const s = seconds.toString().padStart(2, '0');

    elapsedTimeDisplay.textContent = `${h}:${m}:${s}`;
}

modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        DebugLogger.info('mode.changed', {
            currentMode
        });

        if (currentMode === 'timed') {
            timedSettings.classList.remove('hidden');
            alwaysSettings.classList.add('hidden');
        } else {
            timedSettings.classList.add('hidden');
            alwaysSettings.classList.remove('hidden');
        }
    });
});

btnStart.addEventListener('click', async () => {
    let duration;
    if (currentMode === 'timed') {
        duration = parseInt(inputDuration.value) * 60;
    } else {
        duration = parseInt(inputMaxDuration.value) * 60;
    }

    DebugLogger.info('recording.start.clicked', {
        currentMode,
        duration
    });

    const response = await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        mode: currentMode,
        duration: duration
    });

    if (response && !response.success) {
        DebugLogger.error('recording.start.failed', {
            error: response.error
        });
        alert('Failed to start recording: ' + response.error);
    }
});

btnPause.addEventListener('click', async () => {
    DebugLogger.info('recording.pause.clicked', {});
    await chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
});

btnResume.addEventListener('click', async () => {
    DebugLogger.info('recording.resume.clicked', {});
    await chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' });
});

btnStop.addEventListener('click', async () => {
    DebugLogger.info('recording.stop.clicked', {});
    await chrome.runtime.sendMessage({ type: 'STOP_RECORDING', reason: 'manual' });
});

btnExportLogs.addEventListener('click', async () => {
    DebugLogger.info('debugLogs.export.clicked', {});
    const response = await chrome.runtime.sendMessage({ type: 'GET_DEBUG_LOGS' });
    if (!response?.success) {
        DebugLogger.error('debugLogs.export.failed', {
            error: 'no_response'
        });
        return;
    }

    const exportedAt = response.exportedAt || new Date().toISOString();
    const timestamp = exportedAt.replace(/[:.]/g, '-');
    const filename = `web-recorder-debug-${timestamp}-${response.sessionId || 'no-session'}.json`;
    const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
});

btnClearLogs.addEventListener('click', async () => {
    DebugLogger.info('debugLogs.clear.clicked', {});
    await chrome.runtime.sendMessage({ type: 'CLEAR_DEBUG_LOGS' });
});

// Listen for state updates from background
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATE') {
        updateUI(message.state);
    }
});

initState();

// Update timer every second if recording
setInterval(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (state.isRecording && !state.isPaused) {
        updateTimer(state.elapsedTime);
    }
}, 1000);
