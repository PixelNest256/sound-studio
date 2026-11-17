const uid = (() => {
    let n = 1;
    return prefix => `${prefix}-${Date.now().toString(36)}-${n++}`;
})();

const DEFAULT_TRACK_COLORS = ['t1', 't2', 't3', 't4', 't1', 't2'];

const createTrack = (name, index = 0) => ({
    id: uid('track'),
    name: name || `トラック${index + 1}`,
    color: DEFAULT_TRACK_COLORS[index % DEFAULT_TRACK_COLORS.length],
    muted: false,
    solo: false,
    volume: 1
});

const createClip = ({trackId, name, channels, sampleRate, start = 0, sourceOffset = 0, duration = null}) => {
    const sampleCount = channels[0] ? channels[0].length : 0;
    const totalDuration = sampleCount / sampleRate;
    const clipDuration = duration == null ? Math.max(0, totalDuration - sourceOffset) : duration;
    return {
        id: uid('clip'),
        trackId,
        name: name || 'clip',
        channels,
        sampleRate,
        timelineStart: Math.max(0, start),
        sourceOffset: Math.max(0, Math.min(totalDuration, sourceOffset)),
        duration: Math.max(0.01, Math.min(clipDuration, totalDuration - Math.max(0, sourceOffset))),
        effects: {
            eq: {enabled: false, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]},
            gain: {enabled: true, value: 1}
        },
        automation: {
            gain: [{t: 0, v: 0.5}, {t: 1, v: 0.5}]
        }
    };
};

const cloneChannels = channels => channels.map(ch => ch.slice());

const sliceChannelsRange = (channels, sampleRate, startSec, durationSec) => {
    const startSample = Math.max(0, Math.round(startSec * sampleRate));
    const sampleCount = Math.max(1, Math.round(durationSec * sampleRate));
    return channels.map(ch => {
        const end = Math.min(ch.length, startSample + sampleCount);
        const begin = Math.min(startSample, end);
        const out = ch.slice(begin, end);
        return out.length ? out : new Float32Array(1);
    });
};

// Return a clip whose channels contain exactly its audible region (sourceOffset..sourceOffset+duration)
// with sourceOffset reset to 0. Used to keep timeline clips in sync with the single-clip editor.
const bakeClip = clip => {
    const sr = clip.sampleRate;
    const channels = sliceChannelsRange(clip.channels, sr, clip.sourceOffset, clip.duration);
    return {
        ...clip,
        channels,
        sourceOffset: 0,
        duration: channels[0] ? channels[0].length / sr : clip.duration
    };
};

const clipEnd = clip => clip.timelineStart + clip.duration;
const sourceEnd = clip => clip.sourceOffset + clip.duration;

const snapTime = (time, enabled, step = 1) => (enabled ? Math.round(time / step) * step : time);

const moveClip = (clip, delta) => ({
    ...clip,
    timelineStart: Math.max(0, clip.timelineStart + delta)
});

const trimClipStart = (clip, newTimelineStart) => {
    const end = clipEnd(clip);
    const start = Math.max(0, Math.min(end - 0.01, newTimelineStart));
    const delta = start - clip.timelineStart;
    const newOffset = clip.sourceOffset + delta;
    const total = (clip.channels[0] ? clip.channels[0].length : 0) / clip.sampleRate;
    if (newOffset < 0 || newOffset >= total) return clip;
    return {
        ...clip,
        timelineStart: start,
        sourceOffset: newOffset,
        duration: end - start
    };
};

const trimClipEnd = (clip, newTimelineEnd) => {
    const start = clip.timelineStart;
    const end = Math.max(start + 0.01, newTimelineEnd);
    const total = (clip.channels[0] ? clip.channels[0].length : 0) / clip.sampleRate;
    const maxEnd = start + (total - clip.sourceOffset);
    const clamped = Math.min(end, maxEnd);
    return {
        ...clip,
        duration: Math.max(0.01, clamped - start)
    };
};

const splitClip = (clip, splitTime) => {
    if (splitTime <= clip.timelineStart + 0.02 || splitTime >= clipEnd(clip) - 0.02) return [bakeClip(clip)];
    const firstDuration = splitTime - clip.timelineStart;
    const secondDuration = clip.duration - firstDuration;
    const a = bakeClip({
        ...clip,
        duration: firstDuration,
        automation: cloneAutomation(clip.automation)
    });
    const b = bakeClip({
        ...clip,
        id: uid('clip'),
        timelineStart: splitTime,
        sourceOffset: clip.sourceOffset + firstDuration,
        duration: secondDuration,
        automation: cloneAutomation(clip.automation)
    });
    // keep automations simple (copy as-is; they are normalized 0..1 over clip)
    return [a, b];
};

const cloneAutomation = automation => {
    const out = {};
    Object.keys(automation || {}).forEach(k => {
        out[k] = (automation[k] || []).map(p => ({t: p.t, v: p.v}));
    });
    return out;
};

const duplicateClip = clip => bakeClip({
    ...clip,
    id: uid('clip'),
    name: `${clip.name}（コピー）`,
    channels: cloneChannels(clip.channels),
    effects: JSON.parse(JSON.stringify(clip.effects || {})),
    automation: cloneAutomation(clip.automation)
});

const valueAt = (points, t) => {
    if (!points || points.length === 0) return 0.5;
    const pts = points.slice().sort((a, b) => a.t - b.t);
    if (t <= pts[0].t) return pts[0].v;
    if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (t >= a.t && t <= b.t) {
            const r = (t - a.t) / Math.max(1e-6, b.t - a.t);
            return a.v + (b.v - a.v) * r;
        }
    }
    return pts[pts.length - 1].v;
};

const projectDuration = clips => {
    let d = 10;
    for (const c of clips) d = Math.max(d, clipEnd(c));
    return Math.ceil(d + 1);
};

export {
    bakeClip,
    clipEnd,
    cloneAutomation,
    cloneChannels,
    createClip,
    createTrack,
    duplicateClip,
    moveClip,
    projectDuration,
    sliceChannelsRange,
    snapTime,
    sourceEnd,
    splitClip,
    trimClipEnd,
    trimClipStart,
    uid,
    valueAt
};
