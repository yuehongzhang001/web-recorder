let recordingState = {
    isRecording: false,
    isPaused: false,
    startTime: null,
    pauseTime: null,
    totalPausedTime: 0,
    targetTabId: null,
    mode: 'always',
    duration: null
};

async function updateState(newState) {
    recordingState = { ...recordingState, ...newState };
    broadcastState();
}

function broadcastState() {
    const state = getPublicState();
    // Send to popup/internal
    chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state }).catch(() => { });

    // Send to recorded tab
    if (recordingState.targetTabId) {
        chrome.tabs.sendMessage(recordingState.targetTabId, { type: 'STATE_UPDATE', state }).catch(() => { });
    }
}

// Periodic broadcast to keep UI in sync (timer, status)
setInterval(() => {
    if (recordingState.isRecording) {
        broadcastState();
    }
}, 1000);

function getPublicState() {
    let elapsedTime = 0;
    if (recordingState.isRecording) {
        if (recordingState.isPaused) {
            elapsedTime = recordingState.pauseTime - recordingState.startTime - recordingState.totalPausedTime;
        } else {
            elapsedTime = Date.now() - recordingState.startTime - recordingState.totalPausedTime;
        }
    }
    return {
        isRecording: recordingState.isRecording,
        isPaused: recordingState.isPaused,
        elapsedTime: elapsedTime
    };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'GET_STATE':
            sendResponse(getPublicState());
            return false; // Sync response
        case 'START_RECORDING':
            startRecording(message.mode, message.duration)
                .then(() => sendResponse({ success: true }))
                .catch((err) => sendResponse({ success: false, error: err.message }));
            return true; // Async response
        case 'STOP_RECORDING':
            stopRecording();
            sendResponse({ success: true });
            return false;
        case 'PAUSE_RECORDING':
            pauseRecording();
            sendResponse({ success: true });
            return false;
        case 'RESUME_RECORDING':
            resumeRecording();
            sendResponse({ success: true });
            return false;
        case 'OFFSCREEN_STOPPED':
            handleOffscreenStopped();
            sendResponse({ success: true });
            return false;
    }
    return false;
});

async function startRecording(mode, duration) {
    if (recordingState.isRecording) {
        throw new Error('Recording is already in progress');
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        throw new Error('No active tab found');
    }

    recordingState.targetTabId = tab.id;
    recordingState.mode = mode;
    recordingState.duration = duration;

    // Create offscreen document if it doesn't exist
    if (!(await chrome.offscreen.hasDocument())) {
        await chrome.offscreen.createDocument({
            url: 'offscreen/offscreen.html',
            reasons: ['USER_MEDIA'],
            justification: 'Recording tab content'
        });
    }

    try {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

        // Set state BEFORE injecting to avoid race conditions
        updateState({
            isRecording: true,
            isPaused: false,
            startTime: Date.now(),
            totalPausedTime: 0
        });

        // Inject content script for floating UI
        await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['scripts/content_script.css']
        });
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['scripts/content_script.js']
        });

        chrome.runtime.sendMessage({
            type: 'START_RECORDING_IN_OFFSCREEN',
            streamId: streamId,
            duration: duration
        });
    } catch (err) {
        console.error('Failed to get stream ID:', err);
        throw err;
    }
}

function stopRecording() {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING_IN_OFFSCREEN' });
    handleOffscreenStopped();
}

function pauseRecording() {
    chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING_IN_OFFSCREEN' });
    updateState({
        isPaused: true,
        pauseTime: Date.now()
    });
}

function resumeRecording() {
    chrome.runtime.sendMessage({ type: 'RESUME_RECORDING_IN_OFFSCREEN' });
    const pausedDuration = Date.now() - recordingState.pauseTime;
    updateState({
        isPaused: false,
        totalPausedTime: recordingState.totalPausedTime + pausedDuration,
        pauseTime: null
    });
}

async function handleOffscreenStopped() {
    // First update the recording state to false - this will broadcast to the tab
    await updateState({
        isRecording: false,
        isPaused: false,
        startTime: null,
        pauseTime: null,
        totalPausedTime: 0
    });

    // Then clear the target tab ID
    await updateState({
        targetTabId: null
    });
}

// Watch for tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === recordingState.targetTabId) {
        stopRecording();
    }
});
