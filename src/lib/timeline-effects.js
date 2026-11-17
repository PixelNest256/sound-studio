import {BAND_FREQUENCIES} from './audio/effects/equalizer-effect.js';
import {valueAt} from './timeline.js';

const clamp01 = v => Math.max(0, Math.min(1, v));

const buildEqChain = (context, gains) => {
    const input = context.createGain();
    const output = context.createGain();
    const filters = BAND_FREQUENCIES.map((frequency, index) => {
        const filter = context.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = frequency;
        filter.Q.value = 1.4;
        filter.gain.value = Math.max(-12, Math.min(12, Number((gains || [])[index]) || 0));
        return filter;
    });
    let node = input;
    filters.forEach(f => { node.connect(f); node = f; });
    node.connect(output);
    return {input, output, filters};
};

const scheduleGainAutomation = (gainNode, baseGain, automation, whenStart, duration) => {
    const points = automation && automation.gain && automation.gain.length ? automation.gain : [{t: 0, v: 0.5}, {t: 1, v: 0.5}];
    // v 0..1 maps to 0..2
    gainNode.gain.cancelScheduledValues(0);
    points.slice().sort((a, b) => a.t - b.t).forEach((p, i) => {
        const t = whenStart + clamp01(p.t) * duration;
        const v = baseGain * (clamp01(p.v) * 2);
        if (i === 0) gainNode.gain.setValueAtTime(v, Math.max(0, t));
        else gainNode.gain.linearRampToValueAtTime(v, Math.max(0, t));
    });
};

export {
    buildEqChain,
    scheduleGainAutomation
};
