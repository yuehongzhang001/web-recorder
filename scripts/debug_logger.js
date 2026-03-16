(function (global) {
    const config = {
        context: 'unknown',
        getSessionId: () => null,
        getStateSnapshot: () => null,
        transport: null,
        disableRuntimeTransport: false
    };

    function safeValue(value, depth = 0) {
        if (value === null || value === undefined) {
            return value;
        }

        if (depth > 3) {
            return '[MaxDepth]';
        }

        if (Array.isArray(value)) {
            return value.slice(0, 20).map((item) => safeValue(item, depth + 1));
        }

        if (value instanceof Error) {
            return {
                name: value.name,
                message: value.message,
                stack: value.stack
            };
        }

        if (typeof value === 'object') {
            const output = {};
            Object.keys(value).slice(0, 30).forEach((key) => {
                output[key] = safeValue(value[key], depth + 1);
            });
            return output;
        }

        if (typeof value === 'function') {
            return '[Function]';
        }

        return value;
    }

    function getSnapshot(getter) {
        try {
            return safeValue(getter?.());
        } catch (error) {
            return {
                snapshotError: error.message
            };
        }
    }

    function writeConsole(level, entry) {
        const method = console[level] ? level : 'log';
        console[method](`[web-recorder][${entry.context}] ${entry.event}`, entry);
    }

    function sendToRuntime(entry) {
        if (config.disableRuntimeTransport || !global.chrome?.runtime?.sendMessage) {
            return;
        }

        try {
            const result = global.chrome.runtime.sendMessage({
                type: 'DEBUG_LOG_ENTRY',
                entry
            });

            if (result && typeof result.catch === 'function') {
                result.catch(() => { });
            }
        } catch (error) {
            console.warn('[web-recorder][logger] Failed to forward log entry', error);
        }
    }

    function log(level, event, payload = {}) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            event,
            context: config.context,
            sessionId: config.getSessionId?.() || null,
            recordingState: getSnapshot(config.getStateSnapshot),
            payload: safeValue(payload)
        };

        writeConsole(level, entry);

        try {
            config.transport?.(entry);
        } catch (error) {
            console.warn('[web-recorder][logger] Transport failed', error);
        }

        sendToRuntime(entry);
        return entry;
    }

    global.DebugLogger = {
        init(options = {}) {
            Object.assign(config, options);
        },
        debug(event, payload) {
            return log('debug', event, payload);
        },
        info(event, payload) {
            return log('info', event, payload);
        },
        warn(event, payload) {
            return log('warn', event, payload);
        },
        error(event, payload) {
            return log('error', event, payload);
        }
    };
})(globalThis);
