/**
 * VoiceGuard ID - Core UI & Audio Application Controller
 */

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements - Navigation & Header
    const sysStatusText = document.getElementById('system-status-text');
    const sysStatusDot = document.getElementById('system-status-dot');

    // UI Elements - Enrollment
    const enrollNameInput = document.getElementById('enroll-name');
    const btnEnrollRecord = document.getElementById('btn-enroll-record');
    const enrolledCount = document.getElementById('enrolled-count');
    const databaseList = document.getElementById('database-list');

    // UI Elements - Call Simulator
    const secSimulationStart = document.getElementById('sec-simulation-start');
    const btnSimulateCall = document.getElementById('btn-simulate-call');
    const secCallActive = document.getElementById('sec-call-active');
    const callLabel = document.getElementById('call-label');
    const callTimer = document.getElementById('call-timer');
    const pulseRings = document.getElementById('pulse-rings');
    const callSpeechPrompt = document.getElementById('call-speech-prompt');
    const btnDecline = document.getElementById('btn-decline');
    const btnAnswer = document.getElementById('btn-answer');
    const btnHangup = document.getElementById('btn-hangup');

    // UI Elements - Results
    const secCallResults = document.getElementById('sec-call-results');
    const resultMatchStroke = document.getElementById('result-match-stroke');
    const resultMatchPct = document.getElementById('result-match-pct');
    const resultStatusShield = document.getElementById('result-status-shield');
    const resultTitle = document.getElementById('result-title');
    const resultSubtitle = document.getElementById('result-subtitle');
    const resDetailPitch = document.getElementById('res-detail-pitch');
    const resDetailTimbre = document.getElementById('res-detail-timbre');
    const resDetailCentroid = document.getElementById('res-detail-centroid');
    const btnCloseResults = document.getElementById('btn-close-results');

    // UI Elements - Audit Logs
    const auditTrailList = document.getElementById('audit-trail-list');
    const btnClearLogs = document.getElementById('btn-clear-logs');

    // UI Elements - Modals
    const modalRecording = document.getElementById('modal-recording');
    const recordingCountdown = document.getElementById('recording-countdown');
    const btnCancelEnroll = document.getElementById('btn-cancel-enroll');

    // Canvas Elements
    const canvasOscilloscope = document.getElementById('canvas-oscilloscope');
    const canvasRadar = document.getElementById('canvas-radar');
    const canvasEnroll = document.getElementById('canvas-enroll-visualizer');
    const canvasComparison = document.getElementById('canvas-comparison');

    // Audio State
    let db = null;
    let enrolledSpeakers = new Map();
    let audioCtx = null;
    let analyserNode = null;
    let streamSource = null;
    let mediaRecorder = null;
    let mediaStream = null;
    
    let audioChunks = [];
    let voiceFrames = [];
    let frameCaptureInterval = null;
    let visualizerFrameId = null;

    let activeCallState = 'idle'; // idle, ringing, recording, analyzing
    let callTimerInterval = null;
    let callDurationSec = 0;
    let activeEnrollmentTimer = null;
    let currentRingtoneOsc = null;

    // Database structure
    const DB_NAME = 'AuraVoiceDB';
    const DB_VERSION = 1;
    
    // Playback state tracker
    let currentlyPlayingAudio = null;
    let currentlyPlayingLogId = null;
    let playbackFrameId = null;

    // Initialize IndexedDB
    function initDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = (e) => reject(e.target.error);
            request.onsuccess = (e) => {
                db = e.target.result;
                resolve(db);
            };
            
            request.onupgradeneeded = (e) => {
                const dbInstance = e.target.result;
                // Voiceprints Store
                if (!dbInstance.objectStoreNames.contains('voiceprints')) {
                    dbInstance.createObjectStore('voiceprints', { keyPath: 'id', autoIncrement: true });
                }
                // Call Logs Store
                if (!dbInstance.objectStoreNames.contains('call_logs')) {
                    dbInstance.createObjectStore('call_logs', { keyPath: 'id', autoIncrement: true });
                }
            };
        });
    }

    // Load Database Content
    async function loadData() {
        if (!db) return;
        
        // Load voiceprints
        const printsTx = db.transaction('voiceprints', 'readonly');
        const printsStore = printsTx.objectStore('voiceprints');
        const printsReq = printsStore.getAll();
        
        printsReq.onsuccess = () => {
            enrolledSpeakers.clear();
            printsReq.result.forEach(speaker => {
                enrolledSpeakers.set(speaker.id, speaker);
            });
            updateSpeakersList();
        };

        // Load logs
        loadLogs();
    }

    function loadLogs() {
        const logsTx = db.transaction('call_logs', 'readonly');
        const logsStore = logsTx.objectStore('call_logs');
        const logsReq = logsStore.getAll();
        
        logsReq.onsuccess = () => {
            const sortedLogs = logsReq.result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            renderCallLogs(sortedLogs);
        };
    }

    // Check mic permission
    async function checkMicPermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch (err) {
            console.error("Microphone permission denied:", err);
            return false;
        }
    }

    // Setup Web Audio Nodes
    async function setupAudioEngine() {
        if (audioCtx) return;
        
        // Standardize AudioContext across browsers
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
        
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 2048;
        analyserNode.minDecibels = -85;
        analyserNode.maxDecibels = -10;
        analyserNode.smoothingTimeConstant = 0.6;
    }

    // Start streaming mic and capturing frames
    async function startRecording() {
        await setupAudioEngine();
        
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamSource = audioCtx.createMediaStreamSource(mediaStream);
            streamSource.connect(analyserNode);

            // Record actual audio bytes for play back
            mediaRecorder = new MediaRecorder(mediaStream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunks.push(e.data);
                }
            };
            
            mediaRecorder.start();

            // Setup FFT and Time domain buffers
            const bufferLength = analyserNode.frequencyBinCount;
            const timeData = new Float32Array(bufferLength);
            const freqData = new Uint8Array(bufferLength);

            voiceFrames = [];

            // Frame extraction loop - every 50ms
            frameCaptureInterval = setInterval(() => {
                analyserNode.getFloat32TimeDomainData(timeData);
                analyserNode.getByteFrequencyData(freqData);

                // Check signal energy (Volume threshold) to ignore ambient silence
                let sumSquares = 0;
                for (let i = 0; i < timeData.length; i++) {
                    sumSquares += timeData[i] * timeData[i];
                }
                const rms = Math.sqrt(sumSquares / timeData.length);
                
                // Only capture frames with vocal volume
                if (rms > 0.015) {
                    voiceFrames.push({
                        timeData: new Float32Array(timeData),
                        freqData: new Uint8Array(freqData)
                    });
                }
            }, 50);

            return true;
        } catch (err) {
            console.error("Error accessing mic for recording:", err);
            alert("Could not access microphone. Please verify site permissions.");
            stopAudioRecording();
            return false;
        }
    }

    // Stop audio nodes and intervals
    function stopAudioRecording() {
        if (frameCaptureInterval) {
            clearInterval(frameCaptureInterval);
            frameCaptureInterval = null;
        }

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }

        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }

        if (streamSource) {
            streamSource.disconnect();
            streamSource = null;
        }

        if (visualizerFrameId) {
            cancelAnimationFrame(visualizerFrameId);
            visualizerFrameId = null;
        }
    }

    // SYSTEM STATUS HELPER
    function updateSystemStatus(status, recordingState = false) {
        sysStatusText.textContent = status;
        sysStatusDot.className = 'status-indicator';
        sysStatusText.className = 'status-value';
        
        if (recordingState) {
            sysStatusDot.classList.add('recording');
            sysStatusText.classList.add('recording');
        } else {
            sysStatusDot.classList.add('active');
            sysStatusText.classList.add('active');
        }
    }

    // ENROLLMENT PROCESS
    btnEnrollRecord.addEventListener('click', async () => {
        const name = enrollNameInput.value.trim();
        if (!name) {
            alert("Please input the person's name before enrolling.");
            enrollNameInput.focus();
            return;
        }

        const isAllowed = await checkMicPermission();
        if (!isAllowed) {
            alert("Microphone permission required for vocal enrollment.");
            return;
        }

        // Show Modal
        modalRecording.classList.remove('hidden');
        updateSystemStatus("ENROLLING SPEAKER", true);

        // Start Recording
        const started = await startRecording();
        if (!started) {
            modalRecording.classList.add('hidden');
            updateSystemStatus("STANDBY");
            return;
        }

        // Start visualizer inside modal
        startModalVisualizer();

        // Countdown Timer: 5 seconds
        let countdown = 5;
        recordingCountdown.textContent = countdown;
        
        activeEnrollmentTimer = setInterval(async () => {
            countdown--;
            recordingCountdown.textContent = countdown;

            if (countdown <= 0) {
                clearInterval(activeEnrollmentTimer);
                activeEnrollmentTimer = null;
                await finalizeEnrollment(name);
            }
        }, 1000);
    });

    // Finalize speaker data insertion
    async function finalizeEnrollment(name) {
        stopAudioRecording();
        modalRecording.classList.add('hidden');
        updateSystemStatus("STANDBY");

        if (voiceFrames.length < 15) {
            alert("Enrollment Failed: Audio capture was too short or silent. Please speak the passphrase clearly for the duration.");
            return;
        }

        const voiceprint = VoiceProcessor.compileVoiceprint(voiceFrames, audioCtx.sampleRate, 2048);
        if (!voiceprint || !voiceprint.bands) {
            alert("Enrollment Failed: Unable to calibrate voice characteristics. Ensure you speak clearly.");
            return;
        }

        // Insert into IndexedDB
        const transaction = db.transaction('voiceprints', 'readwrite');
        const store = transaction.objectStore('voiceprints');
        const newSpeaker = {
            name: name,
            voiceprint: voiceprint,
            regDate: new Date().toLocaleDateString()
        };

        const request = store.add(newSpeaker);
        request.onsuccess = () => {
            enrollNameInput.value = '';
            loadData();
        };

        request.onerror = (e) => {
            console.error("Error adding voiceprint:", e.target.error);
        };
    }

    // Cancel Enrollment
    btnCancelEnroll.addEventListener('click', () => {
        if (activeEnrollmentTimer) {
            clearInterval(activeEnrollmentTimer);
            activeEnrollmentTimer = null;
        }
        stopAudioRecording();
        modalRecording.classList.add('hidden');
        updateSystemStatus("STANDBY");
    });

    // Update Speakers UI List
    function updateSpeakersList() {
        enrolledCount.textContent = enrolledSpeakers.size;
        databaseList.innerHTML = '';

        if (enrolledSpeakers.size === 0) {
            databaseList.innerHTML = `
                <div class="empty-state">
                    <p>No enrolled voiceprints found in database.</p>
                </div>
            `;
            return;
        }

        enrolledSpeakers.forEach((speaker) => {
            const card = document.createElement('div');
            card.className = 'profile-card';
            
            const initials = speaker.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
            const pitchDisplay = speaker.voiceprint.pitch ? `${Math.round(speaker.voiceprint.pitch)}Hz` : 'N/A';
            
            card.innerHTML = `
                <div class="profile-avatar">${initials}</div>
                <div class="profile-info">
                    <div class="profile-name" title="${speaker.name}">${speaker.name}</div>
                    <div class="profile-meta">
                        <span>PITCH: ${pitchDisplay}</span>
                        <span>REG: ${speaker.regDate}</span>
                    </div>
                </div>
                <button class="btn-delete-profile" data-id="${speaker.id}" title="Remove Speaker">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            `;

            // Delete Event
            card.querySelector('.btn-delete-profile').addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Remove vocal signature for "${speaker.name}"?`)) {
                    deleteSpeaker(speaker.id);
                }
            });

            databaseList.appendChild(card);
        });
    }

    // Delete Speaker from Database
    function deleteSpeaker(id) {
        const tx = db.transaction('voiceprints', 'readwrite');
        const store = tx.objectStore('voiceprints');
        store.delete(id).onsuccess = () => {
            loadData();
        };
    }

    // SIMULATED INCOMING CALL LOGIC
    btnSimulateCall.addEventListener('click', () => {
        if (activeCallState !== 'idle') return;
        
        activeCallState = 'ringing';
        updateSystemStatus("INCOMING CALL SYSTEM", false);

        secSimulationStart.classList.add('hidden');
        secCallActive.classList.remove('hidden');
        secCallActive.className = 'active-call-interface ringing';

        callLabel.textContent = 'INCOMING CALL...';
        callTimer.textContent = '00:00';
        
        btnDecline.classList.remove('hidden');
        btnAnswer.classList.remove('hidden');
        btnHangup.classList.add('hidden');
        callSpeechPrompt.classList.add('hidden');
        
        canvasOscilloscope.classList.remove('hidden');
        canvasRadar.classList.add('hidden');

        // Play ringing sound effect via synthesised audio context
        startRingingBeep();
        startRingingVisualizer();
    });

    // Declined Incoming Call
    btnDecline.addEventListener('click', () => {
        stopRingingBeep();
        activeCallState = 'idle';
        updateSystemStatus("STANDBY");
        secCallActive.classList.add('hidden');
        secSimulationStart.classList.remove('hidden');
        if (visualizerFrameId) {
            cancelAnimationFrame(visualizerFrameId);
            visualizerFrameId = null;
        }
    });

    // Answer Incoming Call
    btnAnswer.addEventListener('click', async () => {
        stopRingingBeep();
        
        const isAllowed = await checkMicPermission();
        if (!isAllowed) {
            alert("Microphone permission required to answer and record calls.");
            activeCallState = 'idle';
            updateSystemStatus("STANDBY");
            secCallActive.classList.add('hidden');
            secSimulationStart.classList.remove('hidden');
            return;
        }

        activeCallState = 'recording';
        updateSystemStatus("CALL RECORDING ACTIVE", true);
        secCallActive.className = 'active-call-interface active';

        callLabel.textContent = 'RECORDING CALLED SPEAKER...';
        btnAnswer.classList.add('hidden');
        btnDecline.classList.add('hidden');
        btnHangup.classList.remove('hidden');
        callSpeechPrompt.classList.remove('hidden');
        
        canvasOscilloscope.classList.add('hidden');
        canvasRadar.classList.remove('hidden');

        const started = await startRecording();
        if (!started) {
            activeCallState = 'idle';
            updateSystemStatus("STANDBY");
            secCallActive.classList.add('hidden');
            secSimulationStart.classList.remove('hidden');
            return;
        }

        // Start Call Timer counter
        callDurationSec = 0;
        callTimer.textContent = '00:00';
        
        callTimerInterval = setInterval(() => {
            callDurationSec++;
            const m = String(Math.floor(callDurationSec / 60)).padStart(2, '0');
            const s = String(callDurationSec % 60).padStart(2, '0');
            callTimer.textContent = `${m}:${s}`;
            
            // Automatically stop after 6 seconds of voice print recording
            if (callDurationSec >= 6) {
                finalizeCallAnalysis();
            }
        }, 1000);

        startActiveCallVisualizer();
    });

    // Hangup Button Click
    btnHangup.addEventListener('click', () => {
        finalizeCallAnalysis();
    });

    // Stop recording, analyze, check match, and save log
    async function finalizeCallAnalysis() {
        if (callTimerInterval) {
            clearInterval(callTimerInterval);
            callTimerInterval = null;
        }

        updateSystemStatus("PROCESSING BIOMETRICS");
        
        // Wait briefly for last audio buffers to flush
        setTimeout(async () => {
            stopAudioRecording();
            activeCallState = 'analyzing';
            
            if (voiceFrames.length < 15) {
                alert("Recording too short. Unable to match speaker characteristics. Call disconnected.");
                activeCallState = 'idle';
                updateSystemStatus("STANDBY");
                secCallActive.classList.add('hidden');
                secSimulationStart.classList.remove('hidden');
                return;
            }

            const callerVoiceprint = VoiceProcessor.compileVoiceprint(voiceFrames, audioCtx.sampleRate, 2048);
            if (!callerVoiceprint) {
                alert("Analysis failed. Unable to identify voice features.");
                activeCallState = 'idle';
                updateSystemStatus("STANDBY");
                secCallActive.classList.add('hidden');
                secSimulationStart.classList.remove('hidden');
                return;
            }

            // Perform voice matcher against database
            let bestMatch = null;
            let highestScore = 0;
            let matchDetails = null;

            enrolledSpeakers.forEach(speaker => {
                const comparison = VoiceProcessor.compareVoiceprints(callerVoiceprint, speaker.voiceprint);
                if (comparison.score > highestScore) {
                    highestScore = comparison.score;
                    bestMatch = speaker;
                    matchDetails = comparison.details;
                }
            });

            // Threshold: 78% for verification match
            const IS_VERIFIED = highestScore >= 78;
            const finalSpeakerName = IS_VERIFIED ? bestMatch.name : 'Unknown Speaker / Impostor';
            const callerId = IS_VERIFIED ? bestMatch.id : null;

            // Compile audio chunk recording into blob
            const finalAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });

            // Store call in IndexedDB Logs
            const logEntry = {
                callerId: callerId,
                speakerName: finalSpeakerName,
                isVerified: IS_VERIFIED,
                score: highestScore,
                duration: callDurationSec,
                timestamp: new Date().toISOString(),
                audioBlob: finalAudioBlob,
                vDetails: matchDetails || {
                    pitch1: null,
                    pitch2: callerVoiceprint.pitch,
                    spectralSimilarity: 0,
                    centroidSimilarity: 0,
                    pitchSimilarity: 0
                }
            };

            const tx = db.transaction('call_logs', 'readwrite');
            const store = tx.objectStore('call_logs');
            const addReq = store.add(logEntry);

            addReq.onsuccess = () => {
                loadLogs();
                // Render results immediately
                displayResults(logEntry, callerVoiceprint, IS_VERIFIED ? bestMatch.voiceprint : null);
            };
        }, 300);
    }

    // DISPLAY CALL ANALYSIS RESULT CARD
    function displayResults(logEntry, callerVp, matchVp) {
        secCallActive.classList.add('hidden');
        secCallResults.classList.remove('hidden');
        activeCallState = 'idle';
        updateSystemStatus("STANDBY");

        // Animate Circle Matching Gauge
        const score = logEntry.score;
        const circumference = 2 * Math.PI * 15.9155; // 100
        const strokeDashOffset = circumference - (score / 100) * circumference;
        
        resultMatchStroke.setAttribute('stroke-dasharray', `${score}, 100`);
        resultMatchPct.textContent = `${score}%`;

        // Color updates
        if (logEntry.isVerified) {
            resultMatchStroke.setAttribute('stroke', 'var(--color-green)');
            resultMatchPct.setAttribute('fill', 'var(--color-green)');
            resultStatusShield.className = 'status-shield verified';
            resultStatusShield.innerHTML = `
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    <polyline points="9 11 11 13 15 9"></polyline>
                </svg>
            `;
            resultTitle.textContent = "IDENTITY VERIFIED";
            resultSubtitle.textContent = `Match speaker confirmed: ${logEntry.speakerName}`;
        } else {
            resultMatchStroke.setAttribute('stroke', 'var(--color-red)');
            resultMatchPct.setAttribute('fill', 'var(--color-red)');
            resultStatusShield.className = 'status-shield unauthorized';
            resultStatusShield.innerHTML = `
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
            `;
            resultTitle.textContent = "VERIFICATION FAILURE";
            resultSubtitle.textContent = "Voiceprint characteristics do not match any enrolled speaker.";
        }

        // Details Display
        const details = logEntry.vDetails;
        resDetailPitch.textContent = details.pitch2 ? `${Math.round(details.pitch2)}Hz` : 'Unstable';
        resDetailTimbre.textContent = `${details.spectralSimilarity}%`;
        resDetailCentroid.textContent = `${details.centroidSimilarity}%`;

        // Draw Comparison spectrum curves overlay
        drawComparisonChart(matchVp, callerVp);
    }

    // CLOSE RESULTS VIEW
    btnCloseResults.addEventListener('click', () => {
        secCallResults.classList.add('hidden');
        secSimulationStart.classList.remove('hidden');
    });

    // RENDER CALL LOG LIST
    function renderCallLogs(logs) {
        auditTrailList.innerHTML = '';
        if (logs.length === 0) {
            auditTrailList.innerHTML = `
                <div class="empty-state">
                    <p>No call logs recorded yet.</p>
                </div>
            `;
            return;
        }

        logs.forEach(log => {
            const logItem = document.createElement('div');
            logItem.className = 'log-item';
            
            const localTime = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const localDate = new Date(log.timestamp).toLocaleDateString();
            
            const isVerified = log.isVerified;
            const shieldClass = isVerified ? 'verified' : 'unauthorized';
            const scoreClass = isVerified ? 'verified' : 'unauthorized';
            
            logItem.innerHTML = `
                <div class="log-status-indicator ${shieldClass}">
                    ${isVerified ? `
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                            <polyline points="9 11 11 13 15 9"></polyline>
                        </svg>
                    ` : `
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                            <line x1="12" y1="9" x2="12" y2="13"></line>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                    `}
                </div>
                <div class="log-content">
                    <div class="log-main-row">
                        <span class="log-name">${log.speakerName}</span>
                        <span class="log-score ${scoreClass}">${log.score}% MATCH</span>
                    </div>
                    <span class="log-time">${localDate} ${localTime} • Dur: ${log.duration}s</span>
                    
                    <div class="log-audio-player">
                        <button class="btn-play-audio" data-id="${log.id}">
                            <svg class="play-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                            <svg class="pause-icon hidden" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                <rect x="6" y="4" width="4" height="16"></rect>
                                <rect x="14" y="4" width="4" height="16"></rect>
                            </svg>
                        </button>
                        <div class="audio-progress-bar" data-id="${log.id}">
                            <div class="audio-progress" id="progress-${log.id}"></div>
                        </div>
                        <span class="audio-duration" id="duration-${log.id}">0:00</span>
                    </div>
                </div>
            `;

            // Bind play controls
            const btnPlay = logItem.querySelector(`.btn-play-audio`);
            const progressBar = logItem.querySelector(`.audio-progress-bar`);
            
            btnPlay.addEventListener('click', () => {
                toggleAudioPlayback(log.id, log.audioBlob, btnPlay, progressBar);
            });

            progressBar.addEventListener('click', (e) => {
                seekAudioPlayback(e, log.id);
            });

            auditTrailList.appendChild(logItem);
        });
    }

    // AUDIO PLAYBACK MANAGEMENT
    function toggleAudioPlayback(id, audioBlob, btnPlay, progressBar) {
        const playIcon = btnPlay.querySelector('.play-icon');
        const pauseIcon = btnPlay.querySelector('.pause-icon');
        
        // Clicked on a currently playing log -> pause it
        if (currentlyPlayingLogId === id) {
            pauseCurrentAudio();
            return;
        }

        // Clicked on another log while something is playing -> pause previous
        if (currentlyPlayingAudio) {
            pauseCurrentAudio();
        }

        // Setup audio element from blob
        const audioUrl = URL.createObjectURL(audioBlob);
        currentlyPlayingAudio = new Audio(audioUrl);
        currentlyPlayingLogId = id;

        // Visual states
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');

        currentlyPlayingAudio.play();

        const durationText = document.getElementById(`duration-${id}`);

        currentlyPlayingAudio.addEventListener('loadedmetadata', () => {
            const m = Math.floor(currentlyPlayingAudio.duration / 60);
            const s = Math.floor(currentlyPlayingAudio.duration % 60);
            durationText.textContent = `${m}:${String(s).padStart(2, '0')}`;
        });

        // Animation loop for progress bar
        function updateProgress() {
            if (!currentlyPlayingAudio || currentlyPlayingLogId !== id) return;

            const progressElem = document.getElementById(`progress-${id}`);
            if (progressElem) {
                const pct = (currentlyPlayingAudio.currentTime / currentlyPlayingAudio.duration) * 100;
                progressElem.style.width = `${pct}%`;
            }

            const m = Math.floor(currentlyPlayingAudio.currentTime / 60);
            const s = Math.floor(currentlyPlayingAudio.currentTime % 60);
            durationText.textContent = `${m}:${String(s).padStart(2, '0')}`;

            if (!currentlyPlayingAudio.paused && !currentlyPlayingAudio.ended) {
                playbackFrameId = requestAnimationFrame(updateProgress);
            }
        }

        currentlyPlayingAudio.addEventListener('play', () => {
            playbackFrameId = requestAnimationFrame(updateProgress);
        });

        currentlyPlayingAudio.addEventListener('ended', () => {
            resetPlaybackUI(id);
        });

        currentlyPlayingAudio.addEventListener('pause', () => {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
        });
    }

    function pauseCurrentAudio() {
        if (currentlyPlayingAudio) {
            currentlyPlayingAudio.pause();
            if (playbackFrameId) {
                cancelAnimationFrame(playbackFrameId);
                playbackFrameId = null;
            }
            // Update button visual
            const activeBtn = document.querySelector(`.btn-play-audio[data-id="${currentlyPlayingLogId}"]`);
            if (activeBtn) {
                activeBtn.querySelector('.play-icon').classList.remove('hidden');
                activeBtn.querySelector('.pause-icon').classList.add('hidden');
            }
            currentlyPlayingLogId = null;
            currentlyPlayingAudio = null;
        }
    }

    function resetPlaybackUI(id) {
        if (playbackFrameId) {
            cancelAnimationFrame(playbackFrameId);
            playbackFrameId = null;
        }
        
        const progressElem = document.getElementById(`progress-${id}`);
        if (progressElem) progressElem.style.width = '0%';
        
        const activeBtn = document.querySelector(`.btn-play-audio[data-id="${id}"]`);
        if (activeBtn) {
            activeBtn.querySelector('.play-icon').classList.remove('hidden');
            activeBtn.querySelector('.pause-icon').classList.add('hidden');
        }

        const durationText = document.getElementById(`duration-${id}`);
        if (durationText && currentlyPlayingAudio) {
            const m = Math.floor(currentlyPlayingAudio.duration / 60);
            const s = Math.floor(currentlyPlayingAudio.duration % 60);
            durationText.textContent = `${m}:${String(s).padStart(2, '0')}`;
        }
        
        currentlyPlayingLogId = null;
        currentlyPlayingAudio = null;
    }

    function seekAudioPlayback(e, id) {
        if (currentlyPlayingLogId !== id || !currentlyPlayingAudio) return;
        
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        const seekPct = clickX / width;
        
        currentlyPlayingAudio.currentTime = seekPct * currentlyPlayingAudio.duration;
    }

    // CLEAR LOGS
    btnClearLogs.addEventListener('click', () => {
        if (confirm("Permanently erase all voice verification logs?")) {
            pauseCurrentAudio();
            const tx = db.transaction('call_logs', 'readwrite');
            const store = tx.objectStore('call_logs');
            store.clear().onsuccess = () => {
                loadLogs();
            };
        }
    });

    // REAL-TIME AUDIO VISUALIZERS (CANVAS DRAWINGS)

    // Modal recording visualizer (Enroll)
    function startModalVisualizer() {
        const ctx = canvasEnroll.getContext('2d');
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function draw() {
            if (activeCallState === 'idle' && modalRecording.classList.contains('hidden')) return;

            visualizerFrameId = requestAnimationFrame(draw);
            analyserNode.getByteFrequencyData(dataArray);

            const width = canvasEnroll.width = canvasEnroll.clientWidth;
            const height = canvasEnroll.height = canvasEnroll.clientHeight;

            ctx.fillStyle = 'rgba(6, 9, 19, 0.5)';
            ctx.fillRect(0, 0, width, height);

            const barWidth = (width / bufferLength) * 2.5;
            let barHeight;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                barHeight = dataArray[i] / 2;

                ctx.fillStyle = `rgba(0, 242, 254, ${dataArray[i] / 255.0})`;
                ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);

                x += barWidth;
            }
        }
        draw();
    }

    // Ringing state visualizer (Sine wave generator simulation)
    function startRingingVisualizer() {
        const ctx = canvasOscilloscope.getContext('2d');
        let angle = 0;

        function draw() {
            if (activeCallState !== 'ringing') return;

            visualizerFrameId = requestAnimationFrame(draw);
            
            const width = canvasOscilloscope.width = canvasOscilloscope.clientWidth;
            const height = canvasOscilloscope.height = canvasOscilloscope.clientHeight;

            ctx.clearRect(0, 0, width, height);

            // Draw generic calling sine wave
            ctx.beginPath();
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(0, 98, 255, 0.4)';
            
            for (let x = 0; x < width; x++) {
                const y = height / 2 + Math.sin(x * 0.015 + angle) * 20 * Math.sin(x * 0.003);
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Overlay glowing faster wave
            ctx.beginPath();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(0, 242, 254, 0.8)';
            for (let x = 0; x < width; x++) {
                const y = height / 2 + Math.sin(x * 0.03 - angle * 1.5) * 12 * Math.cos(x * 0.005);
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            angle += 0.08;
        }
        draw();
    }

    // Active call visualizer (Radar spectrum circle)
    function startActiveCallVisualizer() {
        const ctx = canvasRadar.getContext('2d');
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        let rotation = 0;

        function draw() {
            if (activeCallState !== 'recording') return;

            visualizerFrameId = requestAnimationFrame(draw);
            analyserNode.getByteFrequencyData(dataArray);

            const width = canvasRadar.width = canvasRadar.clientWidth;
            const height = canvasRadar.height = canvasRadar.clientHeight;
            const centerX = width / 2;
            const centerY = height / 2;
            const baseRadius = 55;

            ctx.clearRect(0, 0, width, height);

            // Draw radar grid circle
            ctx.beginPath();
            ctx.arc(centerX, centerY, baseRadius, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(38, 55, 94, 0.3)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Draw frequency peaks outward
            const numPoints = 80;
            const step = Math.floor(bufferLength / numPoints);
            
            ctx.beginPath();
            for (let i = 0; i < numPoints; i++) {
                const magnitude = dataArray[i * step] / 255.0;
                const amplitude = magnitude * 40;
                
                const angle = (i / numPoints) * 2 * Math.PI + rotation;
                
                const x1 = centerX + Math.cos(angle) * baseRadius;
                const y1 = centerY + Math.sin(angle) * baseRadius;
                const x2 = centerX + Math.cos(angle) * (baseRadius + amplitude);
                const y2 = centerY + Math.sin(angle) * (baseRadius + amplitude);

                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
            }
            ctx.strokeStyle = 'rgba(0, 242, 254, 0.75)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Draw radar sweep line
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(centerX + Math.cos(rotation) * (baseRadius + 20), centerY + Math.sin(rotation) * (baseRadius + 20));
            ctx.strokeStyle = 'rgba(0, 242, 254, 0.15)';
            ctx.lineWidth = 2;
            ctx.stroke();

            rotation += 0.015;
        }
        draw();
    }

    // DRAW OVERLAY SPECTRUM COMPARISON CHART
    function drawComparisonChart(matchVp, callerVp) {
        const ctx = canvasComparison.getContext('2d');
        const width = canvasComparison.width = canvasComparison.clientWidth;
        const height = canvasComparison.height = canvasComparison.clientHeight;

        ctx.clearRect(0, 0, width, height);

        const bandsLength = VoiceProcessor.BANDS.length;
        const paddingLeft = 10;
        const paddingRight = 10;
        const drawWidth = width - paddingLeft - paddingRight;

        // Draw grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
            const y = (height / 4) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // 1. Draw enrolled voiceprint curve (Purple area fill & line)
        if (matchVp && matchVp.bands) {
            ctx.beginPath();
            for (let i = 0; i < bandsLength; i++) {
                const val = matchVp.bands[i] || 0;
                const x = paddingLeft + (i / (bandsLength - 1)) * drawWidth;
                const y = height - (val * height * 0.78);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            // Connect to bottom right/left to fill
            ctx.lineTo(paddingLeft + drawWidth, height);
            ctx.lineTo(paddingLeft, height);
            ctx.closePath();
            
            ctx.fillStyle = 'rgba(125, 42, 232, 0.15)';
            ctx.fill();

            // Line stroke
            ctx.beginPath();
            for (let i = 0; i < bandsLength; i++) {
                const val = matchVp.bands[i] || 0;
                const x = paddingLeft + (i / (bandsLength - 1)) * drawWidth;
                const y = height - (val * height * 0.78);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(125, 42, 232, 0.85)';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        // 2. Draw caller voiceprint curve (Cyan line)
        if (callerVp && callerVp.bands) {
            ctx.beginPath();
            for (let i = 0; i < bandsLength; i++) {
                const val = callerVp.bands[i] || 0;
                const x = paddingLeft + (i / (bandsLength - 1)) * drawWidth;
                const y = height - (val * height * 0.78);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(0, 242, 254, 0.9)';
            ctx.shadowColor = 'rgba(0, 242, 254, 0.3)';
            ctx.shadowBlur = 6;
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Reset shadows
            ctx.shadowBlur = 0;
        }
    }

    // SYNTHESIZED BEATING RINGTONE
    function startRingingBeep() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContextClass();
        }
        
        try {
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }

            let playTime = 0;
            currentRingtoneOsc = setInterval(() => {
                // Ringing cadence: 1.5 seconds on, 2.5 seconds off
                if (activeCallState !== 'ringing') {
                    stopRingingBeep();
                    return;
                }

                const osc1 = audioCtx.createOscillator();
                const osc2 = audioCtx.createOscillator();
                const gain = audioCtx.createGain();

                osc1.type = 'sine';
                osc1.frequency.setValueAtTime(440, audioCtx.currentTime); // Standard US Ringback
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(480, audioCtx.currentTime);

                gain.gain.setValueAtTime(0, audioCtx.currentTime);
                gain.gain.linearRampToValueAtTime(0.06, audioCtx.currentTime + 0.05); // low volume
                gain.gain.setValueAtTime(0.06, audioCtx.currentTime + 1.2);
                gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.3);

                osc1.connect(gain);
                osc2.connect(gain);
                gain.connect(audioCtx.destination);

                osc1.start();
                osc2.start();
                
                osc1.stop(audioCtx.currentTime + 1.4);
                osc2.stop(audioCtx.currentTime + 1.4);
            }, 3000);
        } catch (e) {
            console.error("Synthesizer error:", e);
        }
    }

    function stopRingingBeep() {
        if (currentRingtoneOsc) {
            clearInterval(currentRingtoneOsc);
            currentRingtoneOsc = null;
        }
    }

    // Run Initialization
    initDatabase()
        .then(() => loadData())
        .catch(err => {
            console.error("Database failed to initialize:", err);
            alert("Database initialization error. Biometric storage unavailable.");
        });
});
