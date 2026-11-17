import PropTypes from 'prop-types';
import React from 'react';

import {BAND_FREQUENCIES} from '../../lib/audio/effects/equalizer-effect.js';
import styles from './sound-modal.css';

const PRESETS = {
    'フラット': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    '低音ブースト': [8, 7, 5, 2, 0, 0, 0, 0, 0, 0],
    '声を聞きやすく': [-6, -4, -2, 0, 3, 5, 4, 2, 0, -2],
    'こもらせる': [2, 3, 2, 0, -4, -8, -10, -12, -12, -12],
    '電話ごえ': [-12, -12, -8, -2, 4, 6, 4, -4, -12, -12]
};

const formatFreq = f => (f >= 1000 ? `${f / 1000}k` : `${f}`);

const EqModal = props => {
    const [gains, setGains] = React.useState([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const [preset, setPreset] = React.useState('フラット');

    React.useEffect(() => {
        const handleKeyDown = event => {
            if (event.key === 'Escape') props.onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [props.onClose]);

    const setBand = (index, value) => {
        setPreset('カスタム');
        setGains(prev => prev.map((g, i) => (i === index ? value : g)));
    };

    const applyPreset = name => {
        setPreset(name);
        setGains(PRESETS[name].slice());
    };

    const sampleCount = props.channels[0] ? props.channels[0].length : 0;
    const startSample = Math.floor((props.trimStart === null ? 0 : props.trimStart) * sampleCount);
    const endSample = Math.ceil((props.trimEnd === null ? 1 : props.trimEnd) * sampleCount);
    const duration = Math.max(0, endSample - startSample) / props.sampleRate;

    return (
        <div
            className={styles.backdrop}
            role="presentation"
            onMouseDown={event => {
                if (event.target === event.currentTarget) props.onClose();
            }}
        >
            <div
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-label="イコライザ"
                style={{width: 'min(640px, 100%)'}}
            >
                <h2 className={styles.title}>イコライザ</h2>
                <p className={styles.description}>
                    {`${props.trimStart === null ? '音声全体' : '選択範囲'} (${duration.toFixed(2)}秒) に適用します。`}
                </p>

                <div style={{display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14}}>
                    {Object.keys(PRESETS).map(name => (
                        <button
                            key={name}
                            type="button"
                            className={`${styles.button}${preset === name ? ` ${styles.primary}` : ''}`}
                            style={{padding: '4px 10px', fontSize: 12}}
                            onClick={() => applyPreset(name)}
                        >
                            {name}
                        </button>
                    ))}
                    {preset === 'カスタム' ? (
                        <span style={{fontSize: 12, color: 'var(--muted, #7b7266)', alignSelf: 'center'}}>カスタム</span>
                    ) : null}
                </div>

                <div style={{display: 'flex', gap: 8, alignItems: 'flex-end', height: 180, padding: '8px 4px', border: '1px solid var(--border, rgba(31,27,22,0.12))', borderRadius: 8, background: 'var(--bg, #f7f4ee)'}}>
                    {BAND_FREQUENCIES.map((freq, i) => (
                        <div key={freq} style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0}}>
                            <div style={{fontSize: 10, color: 'var(--muted, #7b7266)', marginBottom: 4}}>{gains[i] > 0 ? `+${gains[i]}` : gains[i]}</div>
                            <input
                                type="range"
                                min="-12"
                                max="12"
                                step="1"
                                value={gains[i]}
                                onChange={e => setBand(i, Number(e.target.value))}
                                style={{writingMode: 'vertical-lr', direction: 'rtl', width: 24, height: 110, accentColor: 'var(--accent, #855cd6)'}}
                                aria-label={`${formatFreq(freq)}Hz`}
                            />
                            <div style={{fontSize: 10, color: 'var(--muted, #7b7266)', marginTop: 4}}>{formatFreq(freq)}</div>
                        </div>
                    ))}
                </div>
                <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted, #7b7266)', marginTop: 4}}>
                    <span>-12 dB</span><span>+12 dB（縦スライダーで各帯域を調整）</span>
                </div>

                <div className={styles.actions}>
                    <button type="button" className={styles.button} onClick={props.onClose}>キャンセル</button>
                    <button
                        type="button"
                        className={`${styles.button} ${styles.primary}`}
                        onClick={() => props.onApply(gains.slice())}
                    >
                        適用
                    </button>
                </div>
            </div>
        </div>
    );
};

EqModal.propTypes = {
    channels: PropTypes.arrayOf(PropTypes.instanceOf(Float32Array)).isRequired,
    onApply: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
    sampleRate: PropTypes.number.isRequired,
    trimEnd: PropTypes.number,
    trimStart: PropTypes.number
};

export default EqModal;
