let mediaRecorder;
let recordedChunks = [];
let recordingTimeoutId = null;
let currentSessionId = null;
let stopReason = null;

DebugLogger.init({
    context: 'offscreen',
    getSessionId: () => currentSessionId,
    getStateSnapshot: () => ({
        recorderState: mediaRecorder?.state || 'inactive',
        chunkCount: recordedChunks.length,
        stopReason
    })
});

chrome.runtime.onMessage.addListener(async (message) => {
    switch (message.type) {
        case 'START_RECORDING_IN_OFFSCREEN':
            startRecording(message.streamId, message.duration, message.mode, message.sessionId);
            break;
        case 'STOP_RECORDING_IN_OFFSCREEN':
            stopRecording(message.reason || 'manual');
            break;
        case 'PAUSE_RECORDING_IN_OFFSCREEN':
            DebugLogger.info('recording.pause.requested', {});
            mediaRecorder?.pause();
            break;
        case 'RESUME_RECORDING_IN_OFFSCREEN':
            DebugLogger.info('recording.resume.requested', {});
            mediaRecorder?.resume();
            break;
    }
});

function clearRecordingTimeout() {
    if (recordingTimeoutId) {
        clearTimeout(recordingTimeoutId);
        DebugLogger.debug('timer.cleared', {});
        recordingTimeoutId = null;
    }
}

function attachTrackDebugListeners(stream) {
    stream.getTracks().forEach((track) => {
        ['ended', 'mute', 'unmute'].forEach((eventName) => {
            track.addEventListener(eventName, () => {
                DebugLogger.warn(`track.${eventName}`, {
                    kind: track.kind,
                    readyState: track.readyState,
                    enabled: track.enabled
                });
            });
        });
    });
}

async function startRecording(streamId, duration, mode, sessionId) {
    recordedChunks = [];
    currentSessionId = sessionId || null;
    stopReason = null;

    DebugLogger.info('recording.start.requested', {
        duration,
        mode,
        hasStreamId: Boolean(streamId)
    });

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            },
            video: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            }
        });
        DebugLogger.info('stream.acquired', {
            audioTracks: stream.getAudioTracks().length,
            videoTracks: stream.getVideoTracks().length
        });
        attachTrackDebugListeners(stream);

        // Loopback audio to speakers so it's not muted during recording
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(audioContext.destination);
        DebugLogger.debug('audio.loopback.connected', {});

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
        DebugLogger.info('mediaRecorder.created', {
            mimeType: mediaRecorder.mimeType
        });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onerror = (event) => {
            DebugLogger.error('mediaRecorder.error', {
                error: event.error || event
            });
        };

        mediaRecorder.onpause = () => {
            DebugLogger.info('mediaRecorder.paused', {});
        };

        mediaRecorder.onresume = () => {
            DebugLogger.info('mediaRecorder.resumed', {});
        };

        mediaRecorder.onstop = () => {
            DebugLogger.info('mediaRecorder.stopped', {
                chunkCount: recordedChunks.length,
                reason: stopReason
            });
            saveRecording();
            clearRecordingTimeout();
            stream.getTracks().forEach(track => track.stop());
            chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOPPED', reason: stopReason || 'offscreen_stop' }).catch(() => { });
            mediaRecorder = null;
            currentSessionId = null;
        };

        mediaRecorder.start();
        DebugLogger.info('mediaRecorder.started', {});

        clearRecordingTimeout();
        if (duration) {
            recordingTimeoutId = setTimeout(() => {
                DebugLogger.warn('timer.fired', {
                    duration
                });
                if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                    stopRecording(mode === 'timed' ? 'timed_completed' : 'max_duration_reached');
                }
            }, duration * 1000);
            DebugLogger.info('timer.created', {
                duration
            });
        }
    } catch (error) {
        DebugLogger.error('recording.start.failed', {
            error
        });
        throw error;
    }
}

function stopRecording(reason = 'manual') {
    stopReason = reason;
    DebugLogger.info('recording.stop.requested', {
        reason,
        recorderState: mediaRecorder?.state || 'inactive'
    });
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    } else {
        clearRecordingTimeout();
    }
}

function saveRecording() {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `web-record-${timestamp}.webm`;
    DebugLogger.info('recording.save.started', {
        filename,
        chunkCount: recordedChunks.length,
        blobSize: blob.size
    });

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
}
