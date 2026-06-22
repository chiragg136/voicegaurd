/**
 * VoiceGuard ID - Audio Feature Extraction & Comparison
 * Extracts voice fingerprints using pitch (autocorrelation), spectral centroid, 
 * and log-spaced spectral energy bands, and compares them using cosine similarity.
 */

class VoiceProcessor {
    /**
     * Define the frequency bounds for our 16 log-spaced bands (range: ~80Hz to ~8000Hz).
     * These correspond to vocal tract characteristics.
     */
    static get BANDS() {
        return [
            { min: 80, max: 150 },
            { min: 150, max: 250 },
            { min: 250, max: 400 },
            { min: 400, max: 600 },
            { min: 600, max: 850 },
            { min: 850, max: 1150 },
            { min: 1150, max: 1500 },
            { min: 1500, max: 1900 },
            { min: 1900, max: 2400 },
            { min: 2400, max: 3000 },
            { min: 3000, max: 3700 },
            { min: 3700, max: 4500 },
            { min: 4500, max: 5400 },
            { min: 5400, max: 6500 },
            { min: 6500, max: 7800 },
            { min: 7800, max: 9500 }
        ];
    }

    /**
     * Pitch detection using the Autocorrelation method.
     * Finds the fundamental frequency (F0) of the voice in a window of time-domain samples.
     */
    static detectPitch(timeData, sampleRate) {
        const bufferSize = timeData.length;
        
        // Calculate Root Mean Square (RMS) to ensure there is enough signal volume (speech, not silence)
        let sumOfSquares = 0;
        for (let i = 0; i < bufferSize; i++) {
            sumOfSquares += timeData[i] * timeData[i];
        }
        const rms = Math.sqrt(sumOfSquares / bufferSize);
        if (rms < 0.015) return null; // Signal is too quiet (silence/noise)

        // Trim signal to focus on active part (autocorrelation search boundaries)
        let r1 = 0;
        let r2 = bufferSize - 1;
        const thres = 0.2;
        for (let i = 0; i < bufferSize / 2; i++) {
            if (Math.abs(timeData[i]) < thres) { r1 = i; } else { break; }
        }
        for (let i = bufferSize - 1; i >= bufferSize / 2; i--) {
            if (Math.abs(timeData[i]) < thres) { r2 = i; } else { break; }
        }
        const trimmedData = timeData.slice(r1, r2);
        const size = trimmedData.length;

        // Perform Autocorrelation
        const correlations = new Float32Array(size);
        for (let lag = 0; lag < size; lag++) {
            let sum = 0;
            for (let i = 0; i < size - lag; i++) {
                sum += trimmedData[i] * trimmedData[i + lag];
            }
            correlations[lag] = sum;
        }

        // Find the first peak after the initial peak at lag = 0
        // We restrict the search range to human vocal frequencies (50Hz to 400Hz)
        const minPeriod = Math.floor(sampleRate / 400); // Max frequency
        const maxPeriod = Math.floor(sampleRate / 50);  // Min frequency
        
        let bestOffset = -1;
        let bestCorrelation = -1;

        // Find local maxima in the correlation array within our period range
        for (let offset = minPeriod; offset <= maxPeriod; offset++) {
            const correlation = correlations[offset];
            
            // Check if it's a local maximum
            if (offset > 0 && offset < size - 1 && correlation > correlations[offset - 1] && correlation > correlations[offset + 1]) {
                if (correlation > bestCorrelation) {
                    bestCorrelation = correlation;
                    bestOffset = offset;
                }
            }
        }

        if (bestOffset !== -1) {
            const pitch = sampleRate / bestOffset;
            return pitch;
        }

        return null;
    }

    /**
     * Calculates the Spectral Centroid (brightness/center of mass of spectrum).
     */
    static calculateSpectralCentroid(freqData, sampleRate, fftSize) {
        let totalAmplitude = 0;
        let weightedFrequencySum = 0;

        const nyquist = sampleRate / 2;
        const binWidth = nyquist / freqData.length;

        for (let i = 0; i < freqData.length; i++) {
            const amp = freqData[i] / 255.0; // Normalise byte value to 0-1 range
            const frequency = i * binWidth;

            totalAmplitude += amp;
            weightedFrequencySum += frequency * amp;
        }

        if (totalAmplitude === 0) return 0;
        return weightedFrequencySum / totalAmplitude;
    }

    /**
     * Bins the linear frequency spectrum bins into our 16 log-spaced bands.
     */
    static getSpectralBands(freqData, sampleRate) {
        const nyquist = sampleRate / 2;
        const binWidth = nyquist / freqData.length;
        const bandValues = new Float32Array(this.BANDS.length);

        this.BANDS.forEach((band, index) => {
            let sum = 0;
            let count = 0;

            for (let i = 0; i < freqData.length; i++) {
                const freq = i * binWidth;
                if (freq >= band.min && freq <= band.max) {
                    sum += freqData[i] / 255.0; // Normalize
                    count++;
                }
            }

            bandValues[index] = count > 0 ? sum / count : 0;
        });

        // Normalize the band values vector to unit length
        let magnitude = 0;
        for (let i = 0; i < bandValues.length; i++) {
            magnitude += bandValues[i] * bandValues[i];
        }
        magnitude = Math.sqrt(magnitude);

        if (magnitude > 0) {
            for (let i = 0; i < bandValues.length; i++) {
                bandValues[i] /= magnitude;
            }
        }

        return Array.from(bandValues);
    }

    /**
     * Compute cosine similarity between two numeric arrays of equal length.
     */
    static cosineSimilarity(vecA, vecB) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Generates a voiceprint object from a list of collected audio frames.
     * Each frame has: timeData (Float32Array) and freqData (Uint8Array)
     */
    static compileVoiceprint(frames, sampleRate, fftSize) {
        let totalPitch = 0;
        let pitchCount = 0;
        let totalCentroid = 0;
        let centroidCount = 0;
        
        const sumBands = new Array(this.BANDS.length).fill(0);
        let bandCount = 0;

        frames.forEach(frame => {
            // 1. Pitch
            const pitch = this.detectPitch(frame.timeData, sampleRate);
            if (pitch && pitch >= 60 && pitch <= 400) {
                totalPitch += pitch;
                pitchCount++;
            }

            // 2. Centroid
            const centroid = this.calculateSpectralCentroid(frame.freqData, sampleRate, fftSize);
            if (centroid > 0) {
                totalCentroid += centroid;
                centroidCount++;
            }

            // 3. Bands
            const bands = this.getSpectralBands(frame.freqData, sampleRate);
            // Verify there is active energy in bands
            const active = bands.some(val => val > 0);
            if (active) {
                for (let i = 0; i < bands.length; i++) {
                    sumBands[i] += bands[i];
                }
                bandCount++;
            }
        });

        if (bandCount === 0) return null; // No speech detected

        // Compute averages
        const avgPitch = pitchCount > 0 ? totalPitch / pitchCount : null;
        const avgCentroid = centroidCount > 0 ? totalCentroid / centroidCount : 0;
        
        const avgBands = sumBands.map(val => val / bandCount);
        // Normalize averaged band vector
        let magnitude = 0;
        for (let i = 0; i < avgBands.length; i++) {
            magnitude += avgBands[i] * avgBands[i];
        }
        magnitude = Math.sqrt(magnitude);
        if (magnitude > 0) {
            for (let i = 0; i < avgBands.length; i++) {
                avgBands[i] /= magnitude;
            }
        }

        return {
            pitch: avgPitch,
            centroid: avgCentroid,
            bands: avgBands,
            createdAt: new Date().toISOString()
        };
    }

    /**
     * Compares two voiceprints and returns a similarity score profile.
     */
    static compareVoiceprints(vp1, vp2) {
        if (!vp1 || !vp2) return { score: 0, details: {} };

        // 1. Spectral bands similarity (main indicator of vocal tract shape)
        const spectralSimilarity = this.cosineSimilarity(vp1.bands, vp2.bands);

        // 2. Pitch similarity (speaker fundamental frequency)
        let pitchSimilarity = 1.0;
        let pitchDiffHz = null;
        if (vp1.pitch && vp2.pitch) {
            pitchDiffHz = Math.abs(vp1.pitch - vp2.pitch);
            // Allow up to 25Hz difference with no penalty, then scale down
            const diffFactor = Math.max(0, pitchDiffHz - 25);
            pitchSimilarity = Math.max(0.6, 1.0 - (diffFactor / 180));
        } else {
            // Pitch missing in one or both, neutral similarity contribution
            pitchSimilarity = 0.85; 
        }

        // 3. Spectral Centroid similarity
        const centroidRatio = Math.min(vp1.centroid, vp2.centroid) / Math.max(vp1.centroid, vp2.centroid);
        const centroidSimilarity = Math.max(0.7, centroidRatio);

        // Combined Score: 
        // 75% Spectral bands, 15% Pitch similarity, 10% Centroid similarity
        let finalScore = (spectralSimilarity * 0.75) + (pitchSimilarity * 0.15) + (centroidSimilarity * 0.10);

        // Convert to percentage and cap
        let percentageScore = Math.round(finalScore * 100);
        percentageScore = Math.max(0, Math.min(100, percentageScore));

        return {
            score: percentageScore,
            details: {
                spectralSimilarity: Math.round(spectralSimilarity * 100),
                pitchSimilarity: Math.round(pitchSimilarity * 100),
                centroidSimilarity: Math.round(centroidSimilarity * 100),
                pitchDiffHz: pitchDiffHz ? Math.round(pitchDiffHz) : null,
                pitch1: vp1.pitch ? Math.round(vp1.pitch) : null,
                pitch2: vp2.pitch ? Math.round(vp2.pitch) : null
            }
        };
    }
}
