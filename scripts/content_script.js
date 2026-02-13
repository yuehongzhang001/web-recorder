(function () {
    if (window.webRecorderControlsInitialized) return;
    window.webRecorderControlsInitialized = true;

    const container = document.createElement('div');
    container.className = 'web-recorder-controls';
    container.innerHTML = `
        <div class="web-recorder-dot"></div>
        <div class="web-recorder-timer">00:00:00</div>
        <div class="web-recorder-btn-group">
            <button class="web-recorder-icon-btn" id="web-recorder-pause" title="Pause">
                <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button class="web-recorder-icon-btn web-recorder-hidden" id="web-recorder-resume" title="Resume">
                <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
            </button>
            <button class="web-recorder-icon-btn stop" id="web-recorder-stop" title="Stop">
                <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>
            </button>
        </div>
    `;

    document.body.appendChild(container);

    const dot = container.querySelector('.web-recorder-dot');
    const timer = container.querySelector('.web-recorder-timer');
    const btnPause = container.querySelector('#web-recorder-pause');
    const btnResume = container.querySelector('#web-recorder-resume');
    const btnStop = container.querySelector('#web-recorder-stop');

    function updateTimer(ms) {
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor((ms / (1000 * 60)) % 60);
        const hours = Math.floor(ms / (1000 * 60 * 60));
        timer.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    btnPause.onclick = () => chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
    btnResume.onclick = () => chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' });
    btnStop.onclick = () => chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });

    function handleState(state) {
        if (state.isRecording) {
            if (!document.body.contains(container)) {
                document.body.appendChild(container);
            }
            updateTimer(state.elapsedTime);
            if (state.isPaused) {
                dot.classList.add('paused');
                btnPause.classList.add('web-recorder-hidden');
                btnResume.classList.remove('web-recorder-hidden');
            } else {
                dot.classList.remove('paused');
                btnPause.classList.remove('web-recorder-hidden');
                btnResume.classList.add('web-recorder-hidden');
            }
        } else {
            if (document.body.contains(container)) {
                container.remove();
            }
            window.webRecorderControlsInitialized = false;
        }
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'STATE_UPDATE') {
            handleState(message.state);
        }
    });

    // Initial state request
    chrome.runtime.sendMessage({ type: 'GET_STATE' }).then(state => {
        if (state) handleState(state);
    });
})();
