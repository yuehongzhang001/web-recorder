importScripts('scripts/debug_logger.js');

let recordingState = {
    isRecording: false,
    isPaused: false,
    startTime: null,
    pauseTime: null,
    totalPausedTime: 0,
    targetTabId: null,
    mode: 'always',
    duration: null,
    sessionId: null,
    stopReason: null
};

const DEBUG_LOG_LIMIT = 300;
let debugLogs = [];
let lastSessionId = null;

DebugLogger.init({
    context: 'service_worker',
    disableRuntimeTransport: true,
    getSessionId: () => recordingState.sessionId,
    getStateSnapshot: () => ({
        isRecording: recordingState.isRecording,
        isPaused: recordingState.isPaused,
        targetTabId: recordingState.targetTabId,
        mode: recordingState.mode,
        duration: recordingState.duration,
        stopReason: recordingState.stopReason
    }),
    transport: addDebugLog
});

function addDebugLog(entry) {
    debugLogs.push(entry);
    if (debugLogs.length > DEBUG_LOG_LIMIT) {
        debugLogs = debugLogs.slice(-DEBUG_LOG_LIMIT);
    }
}

function createSessionId() {
    return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
        elapsedTime: elapsedTime,
        sessionId: recordingState.sessionId
    };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'GET_STATE':
            sendResponse(getPublicState());
            return false; // Sync response
        case 'GET_DEBUG_LOGS':
            sendResponse({
                success: true,
                logs: debugLogs,
                exportedAt: new Date().toISOString(),
                sessionId: recordingState.sessionId || lastSessionId
            });
            return false;
        case 'CLEAR_DEBUG_LOGS':
            debugLogs = [];
            DebugLogger.info('debugLogs.cleared', {
                by: sender?.url || 'unknown'
            });
            sendResponse({ success: true });
            return false;
        case 'DEBUG_LOG_ENTRY':
            addDebugLog(message.entry);
            return false;
        case 'START_RECORDING':
            startRecording(message.mode, message.duration)
                .then(() => sendResponse({ success: true }))
                .catch((err) => sendResponse({ success: false, error: err.message }));
            return true; // Async response
        case 'STOP_RECORDING':
            stopRecording(message.reason || 'manual');
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
            handleOffscreenStopped(message.reason || 'offscreen_stopped');
            sendResponse({ success: true });
            return false;
    }
    return false;
});

async function startRecording(mode, duration) {
    if (recordingState.isRecording) {
        DebugLogger.warn('recording.start.rejected', {
            reason: 'already_recording'
        });
        throw new Error('Recording is already in progress');
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        DebugLogger.error('recording.start.failed', {
            reason: 'no_active_tab'
        });
        throw new Error('No active tab found');
    }

    const sessionId = createSessionId();
    lastSessionId = sessionId;
    recordingState.targetTabId = tab.id;
    recordingState.mode = mode;
    recordingState.duration = duration;
    recordingState.sessionId = sessionId;
    recordingState.stopReason = null;

    DebugLogger.info('recording.start.requested', {
        mode,
        duration,
        tabId: tab.id,
        sessionId
    });

    // Create offscreen document if it doesn't exist
    if (!(await chrome.offscreen.hasDocument())) {
        DebugLogger.info('offscreen.create.requested', {
            url: 'offscreen/offscreen.html'
        });
        await chrome.offscreen.createDocument({
            url: 'offscreen/offscreen.html',
            reasons: ['USER_MEDIA'],
            justification: 'Recording tab content'
        });
        DebugLogger.info('offscreen.create.completed', {});
    }

    try {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        DebugLogger.info('streamId.created', {
            tabId: tab.id
        });

        // Set state BEFORE injecting to avoid race conditions
        await updateState({
            isRecording: true,
            isPaused: false,
            startTime: Date.now(),
            totalPausedTime: 0,
            pauseTime: null,
            stopReason: null,
            sessionId
        });

        // Inject content script for floating UI
        DebugLogger.info('contentScript.inject.requested', {
            tabId: tab.id
        });
        await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['scripts/content_script.css']
        });
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['scripts/debug_logger.js', 'scripts/content_script.js']
        });
        DebugLogger.info('contentScript.inject.completed', {
            tabId: tab.id
        });

        chrome.runtime.sendMessage({
            type: 'START_RECORDING_IN_OFFSCREEN',
            streamId: streamId,
            duration: duration,
            mode,
            sessionId
        });
        DebugLogger.info('offscreen.start.sent', {
            duration,
            mode
        });
    } catch (err) {
        DebugLogger.error('recording.start.failed', {
            error: err
        });
        await updateState({
            isRecording: false,
            isPaused: false,
            startTime: null,
            pauseTime: null,
            totalPausedTime: 0,
            targetTabId: null,
            sessionId: null,
            stopReason: 'start_failed'
        });
        throw err;
    }
}

function stopRecording(reason = 'manual') {
    DebugLogger.info('recording.stop.requested', {
        reason
    });
    recordingState.stopReason = reason;
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING_IN_OFFSCREEN', reason }).catch(() => { });
}

function pauseRecording() {
    DebugLogger.info('recording.pause.requested', {});
    chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING_IN_OFFSCREEN' }).catch(() => { });
    updateState({
        isPaused: true,
        pauseTime: Date.now()
    });
}

function resumeRecording() {
    DebugLogger.info('recording.resume.requested', {});
    chrome.runtime.sendMessage({ type: 'RESUME_RECORDING_IN_OFFSCREEN' }).catch(() => { });
    const pausedDuration = Date.now() - recordingState.pauseTime;
    updateState({
        isPaused: false,
        totalPausedTime: recordingState.totalPausedTime + pausedDuration,
        pauseTime: null
    });
}

async function handleOffscreenStopped(reason = 'offscreen_stopped') {
    DebugLogger.info('recording.stopped', {
        reason
    });

    // First update the recording state to false - this will broadcast to the tab
    await updateState({
        isRecording: false,
        isPaused: false,
        startTime: null,
        pauseTime: null,
        totalPausedTime: 0,
        stopReason: reason
    });

    // Then clear the target tab ID
    await updateState({
        targetTabId: null,
        sessionId: null
    });
}

// Watch for tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === recordingState.targetTabId) {
        DebugLogger.warn('tab.removed', {
            tabId
        });
        stopRecording('tab_closed');
    }
});
