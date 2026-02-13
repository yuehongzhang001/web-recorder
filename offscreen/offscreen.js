let mediaRecorder;
let recordedChunks = [];

chrome.runtime.onMessage.addListener(async (message) => {
    switch (message.type) {
        case 'START_RECORDING_IN_OFFSCREEN':
            startRecording(message.streamId, message.duration);
            break;
        case 'STOP_RECORDING_IN_OFFSCREEN':
            stopRecording();
            break;
        case 'PAUSE_RECORDING_IN_OFFSCREEN':
            mediaRecorder?.pause();
            break;
        case 'RESUME_RECORDING_IN_OFFSCREEN':
            mediaRecorder?.resume();
            break;
    }
});

async function startRecording(streamId, duration) {
    recordedChunks = [];

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

    // Loopback audio to speakers so it's not muted during recording
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(audioContext.destination);

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });

    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };

    mediaRecorder.onstop = () => {
        saveRecording();
        stream.getTracks().forEach(track => track.stop());
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOPPED' });
    };

    mediaRecorder.start();

    if (duration) {
        setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                stopRecording();
            }
        }, duration * 1000);
    }
}

function stopRecording() {
    mediaRecorder?.stop();
}

function saveRecording() {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `web-record-${timestamp}.webm`;

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
