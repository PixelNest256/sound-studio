import React from 'react';

import {BAND_FREQUENCIES} from '../../lib/audio/effects/equalizer-effect.js';
import {decodeAudioFile} from '../../lib/audio-file.js';
import {downloadBlob} from '../../lib/download.js';
import {
    clipEnd,
    cloneAutomation,
    createClip,
    createTrack,
    duplicateClip,
    projectDuration,
    snapTime,
    splitClip,
    trimClipEnd,
    trimClipStart,
    valueAt
} from '../../lib/timeline.js';
import {renderProjectToWav, TimelinePlayer} from '../../lib/timeline-mixer.js';
import SoundEditor from '../../containers/sound-editor.jsx';
import './timeline.global.css';

const EQ_PRESETS = {
    'フラット': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    '低音ブースト': [8, 7, 5, 2, 0, 0, 0, 0, 0, 0],
    '声を聞きやすく': [-6, -4, -2, 0, 3, 5, 4, 2, 0, -2],
    'こもらせる': [2, 3, 2, 0, -4, -8, -10, -12, -12, -12],
    '電話ごえ': [-12, -12, -8, -2, 4, 6, 4, -4, -12, -12]
};
const FREQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const TRACK_COLORS = ['#b24fc4', '#3a8fc0', '#d49a1f', '#1f9c84', '#c45f4f'];

const fmt = s => {
    const sec = Math.max(0, s || 0);
    const m = Math.floor(sec / 60);
    const ss = (sec % 60).toFixed(2).padStart(5, '0');
    return `${String(m).padStart(2, '0')}:${ss}`;
};

const drawMiniWave = (canvas, channels) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width = Math.max(1, canvas.clientWidth * (window.devicePixelRatio || 1));
    const h = canvas.height = Math.max(1, canvas.clientHeight * (window.devicePixelRatio || 1));
    ctx.clearRect(0, 0, w, h);
    const data = channels && channels[0];
    if (!data || data.length === 0) return;
    const step = Math.max(1, Math.floor(data.length / w));
    ctx.fillStyle = 'rgba(31,27,22,0.35)';
    for (let x = 0; x < w; x++) {
        let min = 1, max = -1;
        const start = x * step;
        const end = Math.min(data.length, start + step);
        for (let i = start; i < end; i++) {
            const v = data[i];
            if (v < min) min = v;
            if (v > max) max = v;
        }
        if (min > max) { min = 0; max = 0; }
        const y1 = (1 - (max + 1) / 2) * h;
        const y2 = (1 - (min + 1) / 2) * h;
        ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
};

const WaveCanvas = ({channels}) => {
    const ref = React.useRef(null);
    React.useEffect(() => { drawMiniWave(ref.current, channels); });
    return <canvas ref={ref} />;
};

const newClipFromBuffer = (trackId, name, buffer, start = 0) => ({
    id: `clip-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    trackId,
    name,
    channels: buffer.channels.map(ch => ch.slice()),
    sampleRate: buffer.sampleRate,
    timelineStart: Math.max(0, start),
    sourceOffset: 0,
    duration: buffer.channels[0] ? buffer.channels[0].length / buffer.sampleRate : 0,
    effects: {
        eq: {enabled: false, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]},
        gain: {enabled: true, value: 1}
    },
    automation: {
        gain: [{t: 0, v: 0.5}, {t: 1, v: 0.5}]
    }
});

class TimelineEditor extends React.Component {
    constructor (props) {
        super(props);
        const tracks = [
            {id: 'tr-1', name: 'BGM', muted: false, solo: false, volume: 1},
            {id: 'tr-2', name: 'ナレーション', muted: false, solo: false, volume: 1}
        ];
        this.state = {
            tracks,
            clips: [],
            selectedClipId: null,
            playhead: 0,
            playing: false,
            snap: true,
            pxPerSec: 80,
            graphParam: 'gain',
            eqPreset: 'フラット',
            busy: false,
            error: null,
            showGraph: false
        };
        this.player = new TimelinePlayer();
        this.fileInputRef = React.createRef();
        this.timelineRef = React.createRef();
        this.dragState = null;
        this.graphDrag = null;
        this.dragMoved = false;
        this.restartTimer = null;

        this.onImportClick = this.onImportClick.bind(this);
        this.onFileChange = this.onFileChange.bind(this);
        this.onAddTrack = this.onAddTrack.bind(this);
        this.onPlayToggle = this.onPlayToggle.bind(this);
        this.onStop = this.onStop.bind(this);
        this.onSplit = this.onSplit.bind(this);
        this.onDeleteClip = this.onDeleteClip.bind(this);
        this.onDuplicateClip = this.onDuplicateClip.bind(this);
        this.onExport = this.onExport.bind(this);
        this.onTimelineMouseDown = this.onTimelineMouseDown.bind(this);
        this.onGraphMouseDown = this.onGraphMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.updateSelectedClip = this.updateSelectedClip.bind(this);
        this.setTrack = this.setTrack.bind(this);
        this.applyEqPreset = this.applyEqPreset.bind(this);
        this.setEqBand = this.setEqBand.bind(this);
        this.onWheelZoom = this.onWheelZoom.bind(this);
        this.onClipChannelsChange = this.onClipChannelsChange.bind(this);
        this.onClipNameChange = this.onClipNameChange.bind(this);
        this.onCopyToNewFromClip = this.onCopyToNewFromClip.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
    }

    componentDidMount () {
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mouseup', this.onMouseUp);
        window.addEventListener('keydown', this.onKeyDown);
        this._nativeWheelHandler = e => this.onWheelZoom(e);
        if (this.timelineRef.current) {
            this.timelineRef.current.addEventListener('wheel', this._nativeWheelHandler, {passive: false});
        }
    }
    componentWillUnmount () {
        if (this.timelineRef.current && this._nativeWheelHandler) {
            this.timelineRef.current.removeEventListener('wheel', this._nativeWheelHandler);
        }
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('mouseup', this.onMouseUp);
        window.removeEventListener('keydown', this.onKeyDown);
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.player.stop();
    }

    projectDuration () {
        return Math.max(10, projectDuration(this.state.clips));
    }
    selectedClip () {
        return this.state.clips.find(c => c.id === this.state.selectedClipId) || null;
    }

    scheduleRestart (immediate = false) {
        if (!this.state.playing) return;
        if (this.restartTimer) clearTimeout(this.restartTimer);
        const doRestart = () => {
            this.restartTimer = null;
            if (!this.state.playing) return;
            const from = Math.min(this.state.playhead, this.projectDuration() - 0.05);
            const dur = this.projectDuration();
            this.player.stop();
            this.player.play(this.state.tracks, this.state.clips, from, dur,
                t => this.setState({playhead: t}),
                () => this.setState({playing: false, playhead: dur})
            );
        };
        if (immediate) doRestart();
        else this.restartTimer = setTimeout(doRestart, 120);
    }

    setStateAndMaybeRestart (updater, cb, immediate = false) {
        this.setState(updater, () => {
            this.scheduleRestart(immediate);
            if (cb) cb();
        });
    }

    onImportClick () { if (this.fileInputRef.current) this.fileInputRef.current.click(); }
    async onFileChange (e) {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        this.setState({busy: true, error: null});
        try {
            const buffer = await decodeAudioFile(file);
            const base = file.name.replace(/\.[^.]+$/, '') || 'clip';
            const trackId = this.state.tracks[0].id;
            const start = this.state.playhead;
            const clip = newClipFromBuffer(trackId, base, buffer, start);
            this.setState(s => ({clips: [...s.clips, clip], selectedClipId: clip.id, busy: false}), () => this.scheduleRestart(true));
        } catch (err) {
            this.setState({busy: false, error: '音声ファイルを読み込めませんでした。'});
        }
    }

    onAddTrack () {
        const idx = this.state.tracks.length;
        const track = {id: `tr-${Date.now()}-${idx}`, name: `トラック${idx + 1}`, muted: false, solo: false, volume: 1};
        this.setState(s => ({tracks: [...s.tracks, track]}));
    }

    onPlayToggle () {
        if (this.state.playing) { this.onStop(); return; }
        const dur = this.projectDuration();
        const from = this.state.playhead >= dur - 0.05 ? 0 : this.state.playhead;
        this.setState({playing: true, playhead: from});
        this.player.play(this.state.tracks, this.state.clips, from, dur,
            t => this.setState({playhead: t}),
            () => this.setState({playing: false, playhead: dur})
        );
    }
    onStop () {
        if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
        this.player.stop();
        this.setState({playing: false});
    }

    onSplit () {
        const clip = this.selectedClip();
        if (!clip) return;
        const t = this.state.playhead;
        if (t <= clip.timelineStart + 0.02 || t >= clipEnd(clip) - 0.02) return;
        const parts = splitClip(clip, t);
        this.setStateAndMaybeRestart(s => ({
            clips: s.clips.flatMap(c => (c.id === clip.id ? parts : [c])),
            selectedClipId: parts[0].id
        }), null, true);
    }
    onDeleteClip () {
        const id = this.state.selectedClipId;
        if (!id) return;
        this.setStateAndMaybeRestart(s => ({clips: s.clips.filter(c => c.id !== id), selectedClipId: null}), null, true);
    }
    onDuplicateClip () {
        const clip = this.selectedClip();
        if (!clip) return;
        const copy = duplicateClip(clip);
        copy.timelineStart = clipEnd(clip);
        this.setStateAndMaybeRestart(s => ({clips: [...s.clips, copy], selectedClipId: copy.id}), null, true);
    }

    async onExport () {
        if (this.state.clips.length === 0) return;
        this.onStop();
        this.setState({busy: true, error: null});
        try {
            const rendered = await renderProjectToWav(this.state.tracks, this.state.clips, this.projectDuration());
            const wavBuffer = await (await import('wav-encoder')).default.encode({
                sampleRate: rendered.sampleRate,
                channelData: Array.from({length: rendered.numberOfChannels}, (_, i) => rendered.getChannelData(i))
            });
            downloadBlob(new Blob([wavBuffer], {type: 'audio/wav'}), 'mix.wav');
            this.setState({busy: false});
        } catch (err) {
            this.setState({busy: false, error: '書き出しに失敗しました。'});
        }
    }

    updateSelectedClip (updater, immediate = false) {
        const id = this.state.selectedClipId;
        if (!id) return;
        this.setStateAndMaybeRestart(s => ({clips: s.clips.map(c => (c.id === id ? updater(c) : c))}), null, immediate);
    }
    setTrack (trackId, updater) {
        this.setStateAndMaybeRestart(s => ({tracks: s.tracks.map(t => (t.id === trackId ? updater(t) : t))}), null, true);
    }

    applyEqPreset (name) {
        const gains = (EQ_PRESETS[name] || EQ_PRESETS['フラット']).slice();
        this.setState({eqPreset: name});
        this.updateSelectedClip(c => ({...c, effects: {...c.effects, eq: {...c.effects.eq, enabled: true, gains}}}), true);
    }
    setEqBand (index, value) {
        this.setState({eqPreset: 'カスタム'});
        this.updateSelectedClip(c => {
            const gains = c.effects.eq.gains.slice();
            gains[index] = value;
            return {...c, effects: {...c.effects, eq: {...c.effects.eq, enabled: true, gains}}};
        }, false);
    }

    onClipChannelsChange (channels, sampleRate) {
        const id = this.state.selectedClipId;
        if (!id) return;
        this.setStateAndMaybeRestart(s => ({
            clips: s.clips.map(c => (c.id === id ? {
                ...c,
                channels,
                sampleRate,
                duration: (channels && channels[0]) ? channels[0].length / sampleRate : c.duration,
                sourceOffset: 0
            } : c))
        }), null, true);
    }
    onClipNameChange (name) {
        const id = this.state.selectedClipId;
        if (!id) return;
        this.setState(s => ({clips: s.clips.map(c => (c.id === id ? {...c, name} : c))}));
    }
    onCopyToNewFromClip (channels, sampleRate) {
        const sel = this.selectedClip();
        if (!sel) return;
        const clip = newClipFromBuffer(sel.trackId, `${sel.name} copy`, {channels, sampleRate}, clipEnd(sel));
        this.setStateAndMaybeRestart(s => ({clips: [...s.clips, clip], selectedClipId: clip.id}), null, true);
    }

    onKeyDown (e) {
        const sel = this.selectedClip();
        if (!sel) return;
        const tag = (e.target && e.target.tagName || '').toLowerCase();
        const editable = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
        if (editable) return;
        const step = this.state.snap ? 0.5 : 0.1;
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            this.updateSelectedClip(c => ({...c, timelineStart: Math.max(0, snapTime(c.timelineStart - step, this.state.snap, 0.5))}), true);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            this.updateSelectedClip(c => ({...c, timelineStart: snapTime(c.timelineStart + step, this.state.snap, 0.5)}), true);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const idx = this.state.tracks.findIndex(t => t.id === sel.trackId);
            const nextIdx = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
            if (nextIdx < 0 || nextIdx >= this.state.tracks.length) return;
            const trackId = this.state.tracks[nextIdx].id;
            this.updateSelectedClip(c => ({...c, trackId}), true);
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && !editable) {
            // don't hijack backspace in general inputs (we checked), but be conservative
            if (e.key === 'Delete') { e.preventDefault(); this.onDeleteClip(); }
        }
    }

    timelineLayout () {
        const el = this.timelineRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const leftGutter = 170;
        const laneX = rect.left + leftGutter;
        return {rect, leftGutter, laneX};
    }
    timeFromClientX (clientX) {
        const layout = this.timelineLayout();
        if (!layout) return 0;
        const x = clientX - layout.laneX + this.timelineRef.current.scrollLeft;
        return Math.max(0, x / this.state.pxPerSec);
    }
    trackIndexFromClientY (clientY) {
        const layout = this.timelineLayout();
        if (!layout) return 0;
        // ruler is 28px, lanes start after it
        const y = clientY - layout.rect.top - 28 + this.timelineRef.current.scrollTop;
        const idx = Math.floor(y / 72);
        return Math.max(0, Math.min(this.state.tracks.length - 1, idx));
    }

    onWheelZoom (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const el = this.timelineRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cursorPx = el.scrollLeft + e.clientX - rect.left - 150;
        const t = Math.max(0, cursorPx / this.state.pxPerSec);
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const next = Math.max(10, Math.min(200, this.state.pxPerSec * factor));
        this.setState({pxPerSec: next}, () => {
            if (this.timelineRef.current) {
                this.timelineRef.current.scrollLeft = Math.max(0, t * next - (e.clientX - rect.left - 150));
            }
        });
    }

    onTimelineMouseDown (e, clip, mode) {
        e.stopPropagation();
        if (e.button !== 0) return;
        this.setState({selectedClipId: clip.id});
        this.dragState = {
            mode, clipId: clip.id,
            startX: e.clientX, startY: e.clientY,
            orig: {...clip}, origTrackId: clip.trackId
        };
        this.dragMoved = false;
    }

    onMouseMove (e) {
        if (this.dragState) {
            const {mode, clipId, startX, orig} = this.dragState;
            const dxSec = (e.clientX - startX) / this.state.pxPerSec;
            if (Math.abs(e.clientX - startX) > 2 || Math.abs(e.clientY - (this.dragState.startY || e.clientY)) > 2) this.dragMoved = true;
            if (mode === 'move') {
                let t = Math.max(0, orig.timelineStart + dxSec);
                const trackIdx = this.trackIndexFromClientY(e.clientY);
                const targetTrackId = this.state.tracks[trackIdx] ? this.state.tracks[trackIdx].id : orig.trackId;
                const leftSnap = this.snapToClipBoundary(t, clipId);
                const rightSnap = this.snapToClipBoundary(t + orig.duration, clipId);
                if (leftSnap.snapped || rightSnap.snapped) {
                    const leftDist = Math.abs(leftSnap.value - t);
                    const rightDist = Math.abs((rightSnap.value - orig.duration) - t);
                    if (rightSnap.snapped && (!leftSnap.snapped || rightDist <= leftDist)) {
                        t = rightSnap.value - orig.duration;
                    } else {
                        t = leftSnap.value;
                    }
                } else {
                    t = leftSnap.value;
                }
                t = Math.max(0, t);
                this.setState({clips: this.state.clips.map(c => c.id === clipId ? {...c, timelineStart: t, trackId: targetTrackId} : c)});
            } else if (mode === 'trim-l') {
                const t = this.snapToClipBoundary(orig.timelineStart + dxSec, clipId).value;
                this.setState({clips: this.state.clips.map(c => c.id === clipId ? trimClipStart(orig, t) : c)});
            } else if (mode === 'trim-r') {
                const t = this.snapToClipBoundary(clipEnd(orig) + dxSec, clipId).value;
                this.setState({clips: this.state.clips.map(c => c.id === clipId ? trimClipEnd(orig, t) : c)});
            }
            this.scheduleRestart(false);
        }
        if (this.graphDrag) {
            const {clipId, param, index, rect, x0, x1} = this.graphDrag;
            let x = (e.clientX - rect.left) / rect.width;
            let y = 1 - (e.clientY - rect.top) / rect.height;
            const nx = Math.max(0, Math.min(1, (x - x0) / Math.max(0.0001, x1 - x0)));
            const ny = Math.max(0, Math.min(1, y));
            this.setState(s => ({
                clips: s.clips.map(c => {
                    if (c.id !== clipId) return c;
                    const pts = (c.automation[param] || []).map(p => ({...p})).sort((a, b) => a.t - b.t);
                    if (!pts[index]) return c;
                    let t = nx;
                    if (index === 0) t = 0;
                    else if (index === pts.length - 1) t = 1;
                    else t = Math.max(pts[index - 1].t, Math.min(pts[index + 1].t, t));
                    pts[index] = {t, v: ny};
                    return {...c, automation: {...c.automation, [param]: pts}};
                })
            }));
            this.scheduleRestart(false);
        }
    }

    onMouseUp () {
        if (this.dragState || this.graphDrag) {
            this.scheduleRestart(true);
        }
        this.dragState = null;
        this.graphDrag = null;
    }
    getClipSnapTargets (excludeClipId) {
        const targets = [];
        for (const c of this.state.clips) {
            if (c.id === excludeClipId) continue;
            targets.push(c.timelineStart);
            targets.push(clipEnd(c));
        }
        return targets;
    }

    snapToClipBoundary (value, excludeClipId) {
        if (!this.state.snap) return {value, snapped: false};
        const targets = this.getClipSnapTargets(excludeClipId);
        const threshold = 8 / this.state.pxPerSec;
        let best = value;
        let bestDist = threshold;
        let snapped = false;
        for (const t of targets) {
            const dist = Math.abs(t - value);
            if (dist < bestDist) {
                bestDist = dist;
                best = t;
                snapped = true;
            }
        }
        if (snapped) return {value: best, snapped: true};
        return {value: snapTime(value, true, 0.25), snapped: false};
    }



    onGraphMouseDown (e) {
        const clip = this.selectedClip();
        if (!clip) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const dur = this.projectDuration();
        const x0 = clip.timelineStart / dur;
        const x1 = clipEnd(clip) / dur;
        const x = (e.clientX - rect.left) / rect.width;
        const y = 1 - (e.clientY - rect.top) / rect.height;
        if (x < x0 || x > x1) return;
        const param = this.state.graphParam;
        const nx = (x - x0) / Math.max(0.0001, x1 - x0);
        const ny = Math.max(0, Math.min(1, y));

        if (e.target && e.target.dataset && e.target.dataset.ptIndex != null) {
            this.graphDrag = {clipId: clip.id, param, index: Number(e.target.dataset.ptIndex), rect, x0, x1};
            return;
        }
        this.setStateAndMaybeRestart(s => ({
            clips: s.clips.map(c => {
                if (c.id !== clip.id) return c;
                const pts = (c.automation[param] || []).map(p => ({...p}));
                pts.push({t: nx, v: ny});
                pts.sort((a, b) => a.t - b.t);
                return {...c, automation: {...c.automation, [param]: pts}};
            })
        }), null, true);
    }

    renderGraph () {
        const clip = this.selectedClip();
        const dur = this.projectDuration();
        if (!clip) {
            return <div className="tl-empty">クリップを選択すると、エフェクトの度合いを時間に沿って変化させるグラフを編集できます。</div>;
        }
        const param = this.state.graphParam;
        const pts = (clip.automation[param] || [{t: 0, v: 0.5}, {t: 1, v: 0.5}]).slice().sort((a, b) => a.t - b.t);
        const x0 = clip.timelineStart / dur;
        const x1 = clipEnd(clip) / dur;
        const W = 800; const H = 150;
        const toX = t => ((x0 + t * (x1 - x0)) * W);
        const toY = v => ((1 - v) * H);
        let d = `M ${toX(pts[0].t)} ${toY(pts[0].v)}`;
        for (let i = 1; i < pts.length; i++) d += ` L ${toX(pts[i].t)} ${toY(pts[i].v)}`;
        const area = `${d} L ${toX(pts[pts.length - 1].t)} ${H} L ${toX(pts[0].t)} ${H} Z`;
        return (
            <div className="tl-graph" onMouseDown={this.onGraphMouseDown}>
                <div className="tl-graph-out" style={{left: 0, width: `${x0 * 100}%`}} />
                <div className="tl-graph-out" style={{left: `${x1 * 100}%`, right: 0}} />
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                    {[0.25, 0.5, 0.75].map(v => <line key={v} x1="0" x2={W} y1={H * v} y2={H * v} stroke="rgba(31,27,22,0.12)" strokeDasharray="3 4" />)}
                    <path d={area} fill="rgba(133,92,214,0.18)" stroke="none" />
                    <path d={d} fill="none" stroke="#855cd6" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                </svg>
                {pts.map((p, i) => (
                    <div
                        key={i} className="tl-pt" data-pt-index={i}
                        onMouseDown={e => { e.stopPropagation(); this.onGraphMouseDown(e); }}
                        onDoubleClick={e => {
                            e.stopPropagation();
                            if (i === 0 || i === pts.length - 1) return;
                            this.setStateAndMaybeRestart(s => ({
                                clips: s.clips.map(c => c.id === clip.id ? {
                                    ...c, automation: {...c.automation, [param]: pts.filter((_, j) => j !== i)}
                                } : c)
                            }), null, true);
                        }}
                        style={{left: `${(x0 + p.t * (x1 - x0)) * 100}%`, top: `${(1 - p.v) * 100}%`}}
                    />
                ))}
                <div style={{position: 'absolute', left: `${(this.state.playhead / dur) * 100}%`, top: 0, bottom: 0, width: 2, background: 'rgba(31,27,22,0.5)', pointerEvents: 'none'}} />
            </div>
        );
    }

    render () {
        const {tracks, clips, selectedClipId, playhead, playing, snap, pxPerSec, graphParam, busy, error, showGraph} = this.state;
        const dur = this.projectDuration();
        const selected = this.selectedClip();
        const timelineWidth = Math.max(800, dur * pxPerSec);
        const params = [{key: 'gain', label: '音量'}];

        return (
            <div className="timeline-root-v2">
                <div className="tl-top-section">
                    <div className="tl-topbar">
                        <button className="tl-btn primary" onClick={this.onPlayToggle}>{playing ? '停止' : '再生'}</button>
                        <span className="tl-time">{fmt(playhead)} / {fmt(dur)}</span>
                        <button className="tl-btn" onClick={this.onSplit} disabled={!selected}>分割</button>
                        <button className="tl-btn" onClick={this.onDuplicateClip} disabled={!selected}>複製</button>
                        <button className="tl-btn" onClick={this.onDeleteClip} disabled={!selected}>削除</button>
                        <button className="tl-btn" onClick={this.onAddTrack}>＋トラック</button>
                        <button className="tl-btn" onClick={this.onImportClick}>音声を追加</button>
                        <button className="tl-btn" onClick={this.onExport} disabled={busy || clips.length === 0}>ミックスを書き出し</button>
                        <span className="tl-sp" />
                        <label className="tl-check"><input type="checkbox" checked={snap} onChange={e => this.setState({snap: e.target.checked})} />吸着</label>
                        <span className="tl-hint">Ctrl+スクロールで横方向ズーム</span>
                        <input ref={this.fileInputRef} type="file" accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac,.webm" hidden onChange={this.onFileChange} />
                    </div>

                    <div className="tl-workspace">
                        <div className="tl-main" ref={this.timelineRef}
                            onMouseDown={e => {
                                if (e.target === e.currentTarget || e.target.classList.contains('tl-ruler-inner') || e.target.classList.contains('tl-lane')) {
                                    const t = this.timeFromClientX(e.clientX);
                                    this.setState({playhead: t, selectedClipId: null});
                                    if (this.state.playing) this.scheduleRestart(true);
                                }
                            }}>
                            <div className="tl-grid" style={{width: timelineWidth + 170, position: 'relative'}}>
                                <div className="tl-corner">トラック</div>
                                <div className="tl-ruler" onClick={e => { this.setState({playhead: this.timeFromClientX(e.clientX)}); if (this.state.playing) this.scheduleRestart(true); }}>
                                    <div className="tl-ruler-inner" style={{width: timelineWidth}}>
                                        {Array.from({length: Math.ceil(dur) + 1}, (_, i) => (
                                            <div key={i} className="tl-ruler-mark" style={{left: i * pxPerSec}}>{i}s</div>
                                        ))}
                                    </div>
                                </div>
                                {tracks.map((track, ti) => (
                                    <React.Fragment key={track.id}>
                                        <div className="tl-head">
                                            <div className="tl-head-name"><span className="tl-dot" style={{background: TRACK_COLORS[ti % TRACK_COLORS.length]}} />{track.name}</div>
                                            <div className="tl-head-ctrls">
                                                <button className={`tl-mini ${track.muted ? 'on' : ''}`} onClick={() => this.setTrack(track.id, t => ({...t, muted: !t.muted}))} title="ミュート">M</button>
                                                <button className={`tl-mini ${track.solo ? 'on' : ''}`} onClick={() => this.setTrack(track.id, t => ({...t, solo: !t.solo}))} title="ソロ">S</button>
                                                <input className="tl-vol" type="range" min="0" max="1.5" step="0.01" value={track.volume} onChange={e => this.setTrack(track.id, t => ({...t, volume: Number(e.target.value)}))} />
                                            </div>
                                        </div>
                                        <div className="tl-lane" style={{width: timelineWidth}} onClick={e => { if (e.target === e.currentTarget) { this.setState({playhead: this.timeFromClientX(e.clientX), selectedClipId: null}); if (this.state.playing) this.scheduleRestart(true); } }}>
                                            {clips.filter(c => c.trackId === track.id).map(clip => {
                                                const left = clip.timelineStart * pxPerSec;
                                                const width = Math.max(14, clip.duration * pxPerSec);
                                                const badges = [];
                                                if (clip.effects.eq && clip.effects.eq.enabled) badges.push('EQ');
                                                return (
                                                    <div key={clip.id}
                                                        className={`tl-clip ${selectedClipId === clip.id ? 'sel' : ''}`}
                                                        style={{left, width, borderColor: TRACK_COLORS[ti % TRACK_COLORS.length] + '66', background: TRACK_COLORS[ti % TRACK_COLORS.length] + '22'}}
                                                        onMouseDown={e => this.onTimelineMouseDown(e, clip, 'move')}>
                                                        <div className="tl-handle l" onMouseDown={e => this.onTimelineMouseDown(e, clip, 'trim-l')} />
                                                        <div className="tl-handle r" onMouseDown={e => this.onTimelineMouseDown(e, clip, 'trim-r')} />
                                                        <div className="tl-clip-label">{clip.name}{badges.map(b => <span key={b} className="tl-badge">{b}</span>)}</div>
                                                        <WaveCanvas channels={clip.channels} />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </React.Fragment>
                                ))}
                                <div className="tl-playhead" style={{left: 170 + playhead * pxPerSec}} />
                            </div>
                        </div>

                        <aside className="tl-insp">
                            <div className="tl-sec">
                                <h3>クリップ/エフェクト {selected ? <small>{fmt(selected.timelineStart)}–{fmt(clipEnd(selected))}</small> : null}</h3>
                                {selected ? <div style={{fontSize: 13, fontWeight: 600, marginBottom: 6}}>{selected.name}</div> :
                                    <div style={{fontSize: 12, color: 'var(--muted,#7b7266)'}}>クリップを選択すると、エフェクト設定や下の詳細エディタで編集できます。クリップはドラッグで上下左右に移動できます。</div>}
                            </div>
                            {selected ? (
                                <>
                                    <div className="tl-sec">
                                        <h3>イコライザ <small>{this.state.eqPreset}</small></h3>
                                        <label className="tl-check" style={{marginBottom: 8}}>
                                            <input type="checkbox" checked={!!selected.effects.eq.enabled} onChange={e => this.updateSelectedClip(c => ({...c, effects: {...c.effects, eq: {...c.effects.eq, enabled: e.target.checked}}}), true)} /> 有効
                                        </label>
                                        <div style={{display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8}}>
                                            {Object.keys(EQ_PRESETS).map(name => (
                                                <button key={name} className={`tl-mini ${this.state.eqPreset === name ? 'on' : ''}`} onClick={() => this.applyEqPreset(name)}>{name}</button>
                                            ))}
                                        </div>
                                        <div className="tl-eq-bands">
                                            {BAND_FREQUENCIES.map((f, i) => (
                                                <div key={f} className="tl-eq-band">
                                                    <div>{selected.effects.eq.gains[i] > 0 ? `+${selected.effects.eq.gains[i]}` : selected.effects.eq.gains[i]}</div>
                                                    <input type="range" min="-12" max="12" step="1" value={selected.effects.eq.gains[i]} onChange={e => this.setEqBand(i, Number(e.target.value))} />
                                                    <div>{FREQ_LABELS[i]}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="tl-sec">
                                        <h3>エフェクト <button className="tl-mini" onClick={() => this.setState(s => ({showGraph: !s.showGraph}))}>{showGraph ? 'グラフを隠す' : 'グラフを表示'}</button></h3>
                                        <div className="tl-fx on">
                                            <div className="tl-fx-head"><b>音量</b><button className={`tl-mini ${graphParam === 'gain' ? 'on' : ''}`} onClick={() => this.setState({graphParam: 'gain', showGraph: true})}>◔ グラフ</button></div>
                                            <div className="tl-row"><span>基準音量</span><input type="range" min="0" max="1.5" step="0.01" value={selected.effects.gain.value} onChange={e => this.updateSelectedClip(c => ({...c, effects: {...c.effects, gain: {...c.effects.gain, value: Number(e.target.value)}}}), true)} /><span>{Math.round(selected.effects.gain.value * 100)}%</span></div>
                                        </div>
                                        {showGraph ? (
                                            <div className="tl-graph-inline">
                                                <div className="tl-modebar" style={{marginBottom: 6}}>
                                                    {params.map(p => <button key={p.key} className={`tl-mini ${graphParam === p.key ? 'on' : ''}`} onClick={() => this.setState({graphParam: p.key})}>{p.label}グラフ</button>)}
                                                </div>
                                                {this.renderGraph()}
                                            </div>
                                        ) : null}
                                    </div>
                                </>
                            ) : null}
                            {error ? <div className="tl-sec" style={{color: '#b91c1c'}}>{error}</div> : null}
                        </aside>
                    </div>
                </div>

                {selected ? (() => {
                    // Avoid remounting the detail editor on every frame while trimming the selected clip.
                    const isDraggingSelectedTrim = this.dragState && this.dragState.clipId === selected.id &&
                        (this.dragState.mode === 'trim-l' || this.dragState.mode === 'trim-r');
                    const viewClip = isDraggingSelectedTrim ? this.dragState.orig : selected;
                    const totalDur = viewClip.channels && viewClip.channels[0] ?
                        viewClip.channels[0].length / viewClip.sampleRate : 0;
                    const needsSlice = viewClip.sourceOffset > 0.0005 ||
                        Math.abs(viewClip.sourceOffset + viewClip.duration - totalDur) > 0.0005;
                    const editorChannels = needsSlice ?
                        sliceChannelsRange(viewClip.channels, viewClip.sampleRate, viewClip.sourceOffset, viewClip.duration) :
                        viewClip.channels;
                    const editorKey = `${viewClip.id}:${viewClip.sampleRate}:${editorChannels[0] ? editorChannels[0].length : 0}:${Math.round(viewClip.sourceOffset * 1000)}`;
                    return (
                    <div className="tl-detail-editor">
                        <div className="tl-detail-header">詳細編集: {selected.name} <span>（旧Scratch音声エディタで波形を細かく編集できます。変更はタイムラインのクリップに反映されます）</span></div>
                        <div className="tl-detail-body">
                            <SoundEditor
                                key={editorKey}
                                channels={editorChannels}
                                dataFormat={'wav'}
                                docId={selected.id}
                                name={selected.name}
                                sampleRate={viewClip.sampleRate}
                                size={0}
                                onChannelsChange={this.onClipChannelsChange}
                                onChangeName={this.onClipNameChange}
                                onCopyToNew={this.onCopyToNewFromClip}
                                onError={err => this.setState({error: err})}
                            />
                        </div>
                    </div>
                    );
                })() : null}
            </div>
        );
    }
}

export default TimelineEditor;
