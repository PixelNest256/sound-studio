import SharedAudioContext from './audio/shared-audio-context.js';
import {buildEqChain, scheduleGainAutomation} from './timeline-effects.js';

const anySolo = tracks => tracks.some(t => t.solo);

const trackAudible = (track, tracks) => {
    if (track.muted) return false;
    if (anySolo(tracks)) return track.solo;
    return true;
};

const createClipChain = (context, clip, track, tracks, destination, timelineOffset, whenBase) => {
    if (!trackAudible(track, tracks)) return {stop: () => {}, source: null};

    const buffer = context.createBuffer(clip.channels.length, clip.channels[0].length, clip.sampleRate);
    for (let c = 0; c < clip.channels.length; c++) buffer.getChannelData(c).set(clip.channels[c]);

    const source = context.createBufferSource();
    source.buffer = buffer;

    const clipGain = context.createGain();
    const baseGain = (typeof track.volume === 'number' ? track.volume : 1) * (clip.effects && clip.effects.gain && typeof clip.effects.gain.value === 'number' ? clip.effects.gain.value : 1);
    scheduleGainAutomation(clipGain, baseGain, clip.automation, whenBase + Math.max(0, clip.timelineStart - timelineOffset), clip.duration);

    let head = source;
    let tail = clipGain;

    if (clip.effects && clip.effects.eq && clip.effects.eq.enabled) {
        const eq = buildEqChain(context, clip.effects.eq.gains);
        head.connect(eq.input);
        head = eq.output;
    }

    head.connect(clipGain);
    clipGain.connect(destination);

    // schedule
    const clipStart = clip.timelineStart;
    const clipEnd = clip.timelineStart + clip.duration;
    const playFrom = timelineOffset;
    // when clip should start relative to whenBase
    const when = whenBase + Math.max(0, clipStart - playFrom);
    const offsetInClip = Math.max(0, playFrom - clipStart); // seconds into clip duration
    const sourceOffset = clip.sourceOffset + offsetInClip;
    const playDuration = Math.max(0, Math.min(clipEnd, Number.MAX_VALUE) - Math.max(clipStart, playFrom));
    if (playDuration > 0.001) {
        try {
            source.start(when, sourceOffset, playDuration);
        } catch (e) {
            // ignore scheduling errors
        }
    }

    return {
        source,
        stop: () => {
            try { source.stop(); } catch (e) {}
            try { source.disconnect(); } catch (e) {}
            try { clipGain.disconnect(); } catch (e) {}
        }
    };
};

class TimelinePlayer {
    constructor () {
        this.context = new SharedAudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 1;
        this.master.connect(this.context.destination);
        this.nodes = [];
        this.playing = false;
        this.startTimeline = 0;
        this.startContextTime = 0;
        this.raf = null;
        this.onUpdate = null;
        this.onEnded = null;
        this.duration = 0;
    }
    stop () {
        this.playing = false;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = null;
        this.nodes.forEach(n => n.stop());
        this.nodes = [];
    }
    getCurrentTime () {
        if (!this.playing) return this.startTimeline;
        return Math.min(this.duration, this.startTimeline + (this.context.currentTime - this.startContextTime));
    }
    play (tracks, clips, fromTime, duration, onUpdate, onEnded) {
        this.stop();
        this.duration = duration;
        this.startTimeline = Math.max(0, fromTime);
        this.startContextTime = this.context.currentTime + 0.05;
        this.onUpdate = onUpdate;
        this.onEnded = onEnded;
        this.playing = true;
        if (this.context.state === 'suspended') this.context.resume();

        clips.forEach(clip => {
            const track = tracks.find(t => t.id === clip.trackId);
            if (!track) return;
            const end = clip.timelineStart + clip.duration;
            if (end <= this.startTimeline || clip.timelineStart >= duration) return;
            const chain = createClipChain(this.context, clip, track, tracks, this.master, this.startTimeline, this.startContextTime);
            this.nodes.push(chain);
        });

        const tick = () => {
            if (!this.playing) return;
            const t = this.getCurrentTime();
            if (this.onUpdate) this.onUpdate(t);
            if (t >= duration - 0.01) {
                const cb = this.onEnded;
                this.stop();
                if (cb) cb();
                return;
            }
            this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
    }
}

const renderProjectToWav = async (tracks, clips, duration) => {
    const sampleRate = 44100;
    const length = Math.max(1, Math.ceil(duration * sampleRate));
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const context = new Offline(2, length, sampleRate);
    const master = context.createGain();
    master.connect(context.destination);
    clips.forEach(clip => {
        const track = tracks.find(t => t.id === clip.trackId);
        if (!track) return;
        const chain = createClipChain(context, clip, track, tracks, master, 0, 0);
        // chain nodes are scheduled into this offline context
    });
    const rendered = await context.startRendering();
    return rendered;
};

export {TimelinePlayer, renderProjectToWav};
