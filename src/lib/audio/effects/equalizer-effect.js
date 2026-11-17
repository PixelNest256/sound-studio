const BAND_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

class EqualizerEffect {
    static get BAND_FREQUENCIES () {
        return BAND_FREQUENCIES;
    }
    constructor (audioContext, gains, startSeconds, endSeconds) {
        this.audioContext = audioContext;
        this.input = audioContext.createGain();
        this.output = audioContext.createGain();

        const bandGains = Array.isArray(gains) && gains.length === BAND_FREQUENCIES.length ?
            gains : BAND_FREQUENCIES.map(() => 0);

        this.filters = BAND_FREQUENCIES.map((frequency, index) => {
            const filter = audioContext.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = frequency;
            filter.Q.value = 1.4;
            filter.gain.value = Math.max(-12, Math.min(12, Number(bandGains[index]) || 0));
            return filter;
        });

        // Wet path: apply EQ only within [startSeconds, endSeconds] like other effects.
        this.wet = audioContext.createGain();
        this.dry = audioContext.createGain();
        const ramp = 0.01;
        if (typeof startSeconds === 'number' && typeof endSeconds === 'number') {
            const s = Math.max(0, startSeconds);
            const e = Math.max(s, endSeconds);
            this.wet.gain.setValueAtTime(0, 0);
            this.dry.gain.setValueAtTime(1, 0);
            this.wet.gain.setValueAtTime(0, Math.max(0, s - ramp));
            this.wet.gain.linearRampToValueAtTime(1, s);
            this.wet.gain.setValueAtTime(1, e);
            this.wet.gain.linearRampToValueAtTime(0, e + ramp);
            this.dry.gain.setValueAtTime(1, Math.max(0, s - ramp));
            this.dry.gain.linearRampToValueAtTime(0, s);
            this.dry.gain.setValueAtTime(0, e);
            this.dry.gain.linearRampToValueAtTime(1, e + ramp);
        } else {
            this.wet.gain.value = 1;
            this.dry.gain.value = 0;
        }

        this.input.connect(this.dry);
        this.dry.connect(this.output);

        let node = this.input;
        for (const filter of this.filters) {
            node.connect(filter);
            node = filter;
        }
        node.connect(this.wet);
        this.wet.connect(this.output);
    }
}

export {BAND_FREQUENCIES};
export default EqualizerEffect;
