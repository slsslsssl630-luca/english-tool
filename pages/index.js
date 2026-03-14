import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';

export default function Home() {
  const [tab, setTab] = useState('translate');
  const [inputText, setInputText] = useState('');
  const [segments, setSegments] = useState([]);
  const [fullZh, setFullZh] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hoveredSeg, setHoveredSeg] = useState(null);
  const [speakingSeg, setSpeakingSeg] = useState(null);
  const [speechState, setSpeechState] = useState('idle');
  const [ttsSpeed, setTtsSpeed] = useState(0.9);
  const [vocab, setVocab] = useState([]);
  const [walkQueue, setWalkQueue] = useState([]);
  const [walkIdx, setWalkIdx] = useState(0);
  const [walkPlaying, setWalkPlaying] = useState(false);
  const [walkPhase, setWalkPhase] = useState('idle');
  const [walkPause, setWalkPause] = useState(1200);
  const [toast, setToast] = useState('');
  const [tooltipSeg, setTooltipSeg] = useState(null);
  const walkPlayingRef = useRef(false);
  const walkTimerRef = useRef(null);
  const toastRef = useRef(null);

  useEffect(() => {
    try {
      setVocab(JSON.parse(localStorage.getItem('vocab') || '[]'));
      setWalkQueue(JSON.parse(localStorage.getItem('walkQueue') || '[]'));
    } catch(e) {}
  }, []);

  const saveVocab = v => { setVocab(v); localStorage.setItem('vocab', JSON.stringify(v)); };
  const saveWalkQueue = q => { setWalkQueue(q); localStorage.setItem('walkQueue', JSON.stringify(q)); };
  const showToast = msg => {
    setToast(msg); clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 2400);
  };

  async function doTranslate() {
    if (!inputText.trim()) return;
    setLoading(true); setError(''); setSegments([]); setFullZh('');
    stopSpeech(); setTooltipSeg(null);
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText.trim() })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '翻译失败');
      if (data.fullZh) setFullZh(data.fullZh);
      setSegments(data.segments.map((s, i) => ({ id: i, en: s.en, zh: s.zh })));
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function getBestVoice() {
    const voices = window.speechSynthesis.getVoices();
    const preferred = ['Samantha','Google US English','Microsoft Aria Online','Microsoft Aria','Alex','Karen'];
    for (const name of preferred) {
      const v = voices.find(v => v.name.includes(name)); if (v) return v;
    }
    return voices.find(v => v.lang.startsWith('en') && v.localService) || voices.find(v => v.lang.startsWith('en')) || null;
  }

  function buildCharMap(segs) {
    const map = []; let cursor = 0;
    segs.forEach(seg => {
      const text = seg.en.join(' ');
      map.push({ id: seg.id, start: cursor, end: cursor + text.length });
      cursor += text.length + 1;
    });
    return map;
  }

  function playSpeech() {
    if (!segments.length) return;
    window.speechSynthesis.cancel();
    const plainText = segments.map(s => s.en.join(' ')).join(' ');
    const charMap = buildCharMap(segments);
    const utt = new SpeechSynthesisUtterance(plainText);
    utt.lang = 'en-US'; utt.rate = ttsSpeed;
    const voice = getBestVoice(); if (voice) utt.voice = voice;
    utt.onboundary = e => {
      if (e.name !== 'word') return;
      const hit = charMap.find(m => e.charIndex >= m.start && e.charIndex < m.end);
      if (hit) setSpeakingSeg(hit.id);
    };
    utt.onend = () => { setSpeakingSeg(null); setSpeechState('idle'); };
    utt.onerror = () => { setSpeakingSeg(null); setSpeechState('idle'); };
    window.speechSynthesis.speak(utt);
    setSpeechState('playing');
  }

  function stopSpeech() { window.speechSynthesis?.cancel(); setSpeakingSeg(null); setSpeechState('idle'); }
  function toggleSpeech() {
    if (speechState === 'idle') playSpeech();
    else if (speechState === 'playing') { window.speechSynthesis.pause(); setSpeechState('paused'); }
    else { window.speechSynthesis.resume(); setSpeechState('playing'); }
  }

  function toggleSave(seg) {
    const key = seg.en.join(' ').toLowerCase();
    const exists = vocab.findIndex(v => v.word.toLowerCase() === key);
    if (exists >= 0) { saveVocab(vocab.filter((_, i) => i !== exists)); showToast('已取消收藏'); }
    else { saveVocab([{ word: seg.en.join(' '), zh: seg.zh.join(''), addedAt: Date.now() }, ...vocab]); showToast('已收藏 ★'); }
    setTooltipSeg(null);
  }
  function deleteVocab(i) {
    const w = vocab[i].word; saveVocab(vocab.filter((_, j) => j !== i));
    saveWalkQueue(walkQueue.filter(x => x.word !== w)); showToast('已删除');
  }
  function toggleWalkItem(i) {
    const v = vocab[i]; const idx = walkQueue.findIndex(w => w.word === v.word);
    if (idx >= 0) { saveWalkQueue(walkQueue.filter((_, j) => j !== idx)); showToast('已移除'); }
    else { saveWalkQueue([...walkQueue, { word: v.word, zh: v.zh }]); showToast('已加入走路听'); }
  }
  const isSaved = seg => vocab.some(v => v.word.toLowerCase() === seg.en.join(' ').toLowerCase());
  const inQueue = w => walkQueue.some(q => q.word === w);
  const activeSegId = speakingSeg ?? hoveredSeg;

  walkPlayingRef.current = walkPlaying;
  const stopWalk = useCallback(() => {
    walkPlayingRef.current = false; setWalkPlaying(false); setWalkPhase('idle');
    clearTimeout(walkTimerRef.current); window.speechSynthesis?.cancel();
  }, []);

  const speakWalkStep = useCallback((idx, queue, pause) => {
    if (!walkPlayingRef.current || !queue.length) return;
    const item = queue[idx % queue.length];
    setWalkIdx(idx % queue.length); setWalkPhase('en');
    const getZhVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      return voices.find(v => ['Tingting','Google 普通话','Huihui'].some(n => v.name.includes(n)))
          || voices.find(v => v.lang.startsWith('zh')) || null;
    };
    const uEn = new SpeechSynthesisUtterance(item.word);
    uEn.lang = 'en-US'; uEn.rate = 0.85;
    const ev = getBestVoice(); if (ev) uEn.voice = ev;
    uEn.onend = () => {
      if (!walkPlayingRef.current) return;
      setWalkPhase('pause');
      walkTimerRef.current = setTimeout(() => {
        if (!walkPlayingRef.current) return;
        setWalkPhase('zh');
        const uZh = new SpeechSynthesisUtterance(item.zh);
        uZh.lang = 'zh-CN'; uZh.rate = 0.9;
        const zv = getZhVoice(); if (zv) uZh.voice = zv;
        uZh.onend = () => {
          if (!walkPlayingRef.current) return;
          setWalkPhase('pause');
          walkTimerRef.current = setTimeout(() => {
            if (!walkPlayingRef.current) return;
            speakWalkStep(idx + 1, queue, pause);
          }, pause);
        };
        window.speechSynthesis.speak(uZh);
      }, pause);
    };
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(uEn);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: item.word, artist: item.zh, album: '走路听' });
    }
  }, []);

  function startWalk() {
    if (!walkQueue.length) return;
    walkPlayingRef.current = true; setWalkPlaying(true);
    speakWalkStep(walkIdx, walkQueue, walkPause);
  }
  function toggleWalk() { walkPlaying ? stopWalk() : startWalk(); }
  function walkNav(dir) {
    const was = walkPlaying; stopWalk();
    const ni = (walkIdx + dir + walkQueue.length) % walkQueue.length;
    setWalkIdx(ni);
    if (was) { walkPlayingRef.current = true; setWalkPlaying(true); setTimeout(() => speakWalkStep(ni, walkQueue, walkPause), 120); }
  }

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => !walkPlayingRef.current && startWalk());
      navigator.mediaSession.setActionHandler('pause', stopWalk);
      navigator.mediaSession.setActionHandler('previoustrack', () => walkNav(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => walkNav(1));
    }
  }, [walkQueue, walkIdx, walkPause]);

  const currentWalk = walkQueue[walkIdx] || null;

  return (
    <>
      <Head>
        <title>英语学习助手</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,400&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --glass: rgba(255,255,255,0.62);
          --glass-border: rgba(255,255,255,0.75);
          --glass-shadow: 0 8px 32px rgba(0,0,0,0.10), 0 1.5px 0 rgba(255,255,255,0.7) inset, 0 -1px 0 rgba(0,0,0,0.06) inset;
          --glass-nav: rgba(255,255,255,0.55);
          --blur: blur(24px) saturate(1.8);
          --blur-heavy: blur(40px) saturate(2);
          --text: #1c1c1e;
          --text2: #48484a;
          --text3: #8e8e93;
          --accent: #007aff;
          --accent2: #0a84ff;
          --accent-glass: rgba(0,122,255,0.15);
          --hl-hover: rgba(255,214,10,0.45);
          --hl-hover-border: rgba(255,190,0,0.6);
          --hl-speak: rgba(0,122,255,0.22);
          --hl-speak-border: rgba(0,122,255,0.5);
          --r: 14px;
          --r-sm: 10px;
          --r-lg: 20px;
          --r-pill: 100px;
        }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          min-height: 100vh;
          background: linear-gradient(135deg, #e8f4fd 0%, #f0e6ff 35%, #fce4ec 65%, #e8f5e9 100%);
          background-attachment: fixed;
          color: var(--text);
          font-size: 15px;
          line-height: 1.5;
          -webkit-font-smoothing: antialiased;
        }

        /* ── NAV ── */
        .nav {
          position: sticky; top: 0; z-index: 200;
          backdrop-filter: var(--blur-heavy);
          -webkit-backdrop-filter: var(--blur-heavy);
          background: var(--glass-nav);
          border-bottom: 1px solid var(--glass-border);
          box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 4px 24px rgba(0,0,0,0.08);
          padding: 0 24px;
          height: 52px;
          display: flex;
          align-items: center;
          gap: 0;
        }
        .nav-logo {
          font-size: 16px; font-weight: 700; color: var(--text);
          margin-right: 28px; display: flex; align-items: center; gap: 8px; letter-spacing: -0.3px;
        }
        .nav-logo small { font-weight: 400; font-size: 12px; color: var(--text3); }
        .nav-tabs { display: flex; height: 100%; gap: 2px; }
        .nav-tab {
          height: 100%; padding: 0 18px; border: none; background: none; cursor: pointer;
          font-size: 14px; font-weight: 500; font-family: inherit; color: var(--text2);
          border-bottom: 2.5px solid transparent; transition: all .18s; display: flex; align-items: center; gap: 6px;
          position: relative;
        }
        .nav-tab:hover { color: var(--text); }
        .nav-tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }

        /* ── PAGE ── */
        .page { max-width: 820px; margin: 0 auto; padding: 28px 20px; }

        /* ── GLASS CARD ── */
        .card {
          backdrop-filter: var(--blur);
          -webkit-backdrop-filter: var(--blur);
          background: var(--glass);
          border: 1px solid var(--glass-border);
          border-radius: var(--r-lg);
          box-shadow: var(--glass-shadow);
          overflow: hidden;
          margin-bottom: 16px;
          transition: box-shadow .2s;
        }
        .card:hover { box-shadow: 0 12px 40px rgba(0,0,0,0.13), 0 1.5px 0 rgba(255,255,255,0.8) inset; }
        .card-header {
          padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,0.6);
          background: rgba(255,255,255,0.3);
          display: flex; align-items: center; gap: 10px; min-height: 44px;
        }
        .card-title { font-size: 12px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: .07em; flex: 1; }
        .card-body { padding: 18px 20px; }

        /* ── TEXTAREA ── */
        textarea {
          width: 100%; border: 1.5px solid rgba(255,255,255,0.7);
          border-radius: var(--r-sm); padding: 14px 16px;
          font-family: inherit; font-size: 15px; line-height: 1.7; color: var(--text);
          background: rgba(255,255,255,0.5);
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          resize: vertical; min-height: 120px; outline: none;
          transition: border-color .15s, box-shadow .15s, background .15s;
        }
        textarea:focus {
          border-color: rgba(0,122,255,0.6);
          box-shadow: 0 0 0 3px rgba(0,122,255,0.12);
          background: rgba(255,255,255,0.72);
        }
        textarea::placeholder { color: var(--text3); }

        /* ── BUTTONS ── */
        .btn {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 9px 20px; border-radius: var(--r-pill);
          font-size: 14px; font-weight: 600; font-family: inherit;
          cursor: pointer; border: 1px solid transparent;
          transition: all .18s; white-space: nowrap; letter-spacing: -0.1px;
        }
        .btn-primary {
          background: var(--accent);
          color: #fff;
          box-shadow: 0 4px 16px rgba(0,122,255,0.3), 0 1px 0 rgba(255,255,255,0.25) inset;
        }
        .btn-primary:hover { background: #0066dd; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,122,255,0.38); }
        .btn-primary:active { transform: translateY(0); }
        .btn-primary:disabled { opacity: .45; cursor: not-allowed; transform: none; box-shadow: none; }
        .btn-glass {
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          background: rgba(255,255,255,0.55);
          border-color: rgba(255,255,255,0.8);
          color: var(--text);
          box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 1px 0 rgba(255,255,255,0.9) inset;
        }
        .btn-glass:hover { background: rgba(255,255,255,0.75); transform: translateY(-1px); }
        .btn-danger {
          background: rgba(255,59,48,0.1); color: #ff3b30;
          border-color: rgba(255,59,48,0.25);
        }
        .btn-danger:hover { background: rgba(255,59,48,0.18); }

        /* ── ICON BUTTONS ── */
        .icon-btn {
          width: 34px; height: 34px; border-radius: var(--r-sm);
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          background: rgba(255,255,255,0.5);
          border: 1px solid rgba(255,255,255,0.75);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: all .15s; color: var(--text2); flex-shrink: 0;
          box-shadow: 0 1px 4px rgba(0,0,0,0.08);
        }
        .icon-btn:hover { background: rgba(255,255,255,0.8); color: var(--accent); transform: translateY(-1px); box-shadow: 0 3px 10px rgba(0,0,0,0.12); }
        .icon-btn.active { background: var(--accent-glass); border-color: rgba(0,122,255,0.4); color: var(--accent); }
        .icon-btn.danger:hover { background: rgba(255,59,48,0.12); color: #ff3b30; border-color: rgba(255,59,48,0.3); }

        /* ── SVG ICONS ── */
        .icon { width: 18px; height: 18px; display: inline-block; vertical-align: middle; }

        /* ── ACTIONS ── */
        .actions { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; align-items: center; }
        .tts-controls { display: flex; align-items: center; gap: 8px; }
        .speed-select {
          font-size: 12px; padding: 4px 10px; border-radius: var(--r-pill);
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          background: rgba(255,255,255,0.55); border: 1px solid rgba(255,255,255,0.75);
          color: var(--text2); font-family: inherit; cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07);
        }

        /* ── BILINGUAL ── */
        .bilingual { padding: 22px 24px; }
        .bi-label {
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .1em; color: var(--text3); margin-bottom: 12px;
          display: flex; align-items: center; gap: 6px;
        }
        .bi-label::after { content: ''; flex: 1; height: 1px; background: rgba(0,0,0,0.07); }
        .bi-para { font-size: 16px; line-height: 2.15; }
        .seg-wrap { display: inline; position: relative; }
        .seg {
          display: inline; cursor: pointer;
          border-radius: 5px; padding: 1px 3px;
          transition: background .12s, box-shadow .12s;
        }
        .seg:hover { background: rgba(0,0,0,0.04); }
        .seg.hl-hover {
          background: var(--hl-hover);
          box-shadow: 0 0 0 1.5px var(--hl-hover-border);
        }
        .seg.hl-speak {
          background: var(--hl-speak);
          box-shadow: 0 0 0 1.5px var(--hl-speak-border);
        }
        .seg.is-saved { color: #b07a00; }
        .bi-sep { height: 1px; background: rgba(0,0,0,0.07); margin: 20px 0; }

        /* ── TOOLTIP ── */
        .seg-tip {
          position: absolute; bottom: calc(100% + 9px); left: 50%; transform: translateX(-50%);
          backdrop-filter: var(--blur-heavy); -webkit-backdrop-filter: var(--blur-heavy);
          background: rgba(30,30,32,0.82);
          color: #fff; border-radius: var(--r-sm); padding: 9px 14px;
          font-size: 12.5px; white-space: nowrap; z-index: 300;
          box-shadow: 0 8px 32px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.1) inset;
          border: 1px solid rgba(255,255,255,0.12);
          display: flex; flex-direction: column; align-items: center; gap: 7px;
        }
        .seg-tip::after {
          content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
          border: 5px solid transparent; border-top-color: rgba(30,30,32,0.82);
        }
        .tip-row { display: flex; gap: 5px; }
        .tip-btn {
          background: rgba(255,255,255,0.13); border: 1px solid rgba(255,255,255,0.2);
          color: #fff; border-radius: 6px; padding: 3px 10px;
          font-size: 11.5px; cursor: pointer; font-family: inherit;
          transition: background .12s;
        }
        .tip-btn:hover { background: rgba(255,255,255,0.22); }
        .tip-btn.saved { color: #ffd60a; border-color: rgba(255,214,10,0.35); }

        /* ── LOADING ── */
        .loading { padding: 52px; text-align: center; color: var(--text3); }
        .spinner {
          width: 36px; height: 36px;
          border: 3px solid rgba(0,0,0,0.08); border-top-color: var(--accent);
          border-radius: 50%; animation: spin .7s linear infinite; margin: 0 auto 16px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .err {
          margin: 0 20px 20px; padding: 12px 16px;
          background: rgba(255,59,48,0.1); border: 1px solid rgba(255,59,48,0.25);
          border-radius: var(--r-sm); color: #c0392b; font-size: 13.5px;
        }

        /* ── VOCAB ── */
        .page-head { margin-bottom: 22px; }
        .page-head h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.4px; margin-bottom: 4px; }
        .page-head p { color: var(--text2); font-size: 14px; }
        .toolbar { display: flex; gap: 10px; margin-bottom: 18px; align-items: center; flex-wrap: wrap; }
        .count-badge {
          margin-left: auto; font-size: 12px; color: var(--text3);
          backdrop-filter: blur(8px);
          background: rgba(255,255,255,0.5); border: 1px solid rgba(255,255,255,0.7);
          border-radius: var(--r-pill); padding: 3px 12px;
        }
        .vocab-list { display: flex; flex-direction: column; gap: 8px; }
        .vocab-item {
          backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
          background: var(--glass); border: 1px solid var(--glass-border);
          border-radius: var(--r); padding: 14px 18px;
          display: flex; align-items: center; gap: 14px;
          box-shadow: var(--glass-shadow); transition: all .18s;
        }
        .vocab-item:hover { transform: translateY(-1px); box-shadow: 0 10px 30px rgba(0,0,0,0.11); }
        .vocab-item.in-q { border-left: 3px solid var(--accent); }
        .vocab-word { font-size: 17px; font-weight: 600; min-width: 100px; letter-spacing: -0.2px; }
        .vocab-zh { color: var(--text2); font-size: 14px; flex: 1; }
        .vocab-date { color: var(--text3); font-size: 11px; }
        .vocab-acts { display: flex; gap: 5px; }
        .empty { text-align: center; padding: 72px 24px; color: var(--text3); }
        .empty-icon { font-size: 52px; margin-bottom: 14px; }
        .empty-title { font-size: 17px; font-weight: 600; color: var(--text2); margin-bottom: 7px; }

        /* ── WALK ── */
        .walk-outer { max-width: 400px; margin: 32px auto 0; }
        .walk-card {
          backdrop-filter: var(--blur-heavy); -webkit-backdrop-filter: var(--blur-heavy);
          background: rgba(255,255,255,0.68);
          border: 1px solid rgba(255,255,255,0.85);
          border-radius: 28px; padding: 44px 36px; text-align: center;
          box-shadow: 0 20px 60px rgba(0,0,0,0.14), 0 2px 0 rgba(255,255,255,0.9) inset;
        }
        .walk-progress { font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--text3); margin-bottom: 32px; }
        .walk-en { font-size: 44px; font-weight: 700; line-height: 1.15; min-height: 56px; margin-bottom: 10px; letter-spacing: -1px; }
        .walk-zh { font-size: 21px; color: var(--text2); margin-bottom: 44px; min-height: 30px; }
        .walk-controls { display: flex; align-items: center; justify-content: center; gap: 16px; }
        .walk-prev-next {
          width: 48px; height: 48px; border-radius: 50%;
          backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
          background: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.85);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: all .15s;
          box-shadow: 0 2px 10px rgba(0,0,0,0.09);
        }
        .walk-prev-next:hover { background: rgba(255,255,255,0.85); transform: scale(1.08); }
        .walk-play {
          width: 72px; height: 72px; border-radius: 50%;
          background: var(--accent); color: #fff; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 6px 24px rgba(0,122,255,0.42), 0 2px 0 rgba(255,255,255,0.3) inset;
          transition: all .18s;
        }
        .walk-play:hover { background: #0066dd; transform: scale(1.08); box-shadow: 0 10px 32px rgba(0,122,255,0.5); }
        .walk-status { margin-top: 22px; font-size: 12.5px; color: var(--text3); display: flex; align-items: center; gap: 8px; justify-content: center; }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text3); transition: background .3s; }
        .dot.en { background: var(--accent); }
        .dot.zh { background: #34c759; }
        .dot.pause { background: #ff9f0a; animation: pulse 1s infinite; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.3} }
        .walk-opts { margin-top: 20px; display: flex; align-items: center; gap: 8px; justify-content: center; font-size: 12.5px; color: var(--text2); }
        .walk-opts select {
          border-radius: var(--r-pill); padding: 4px 10px; font-size: 12px; font-family: inherit;
          backdrop-filter: blur(8px); background: rgba(255,255,255,0.55);
          border: 1px solid rgba(255,255,255,0.75); color: var(--text);
        }

        /* ── TOAST ── */
        .toast {
          position: fixed; bottom: 32px; left: 50%;
          transform: translateX(-50%) translateY(70px);
          backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
          background: rgba(30,30,32,0.78);
          color: #fff; padding: 10px 22px; border-radius: var(--r-pill);
          font-size: 13.5px; font-weight: 500; z-index: 1000;
          transition: transform .25s cubic-bezier(.34,1.56,.64,1);
          white-space: nowrap; pointer-events: none;
          border: 1px solid rgba(255,255,255,0.12);
          box-shadow: 0 8px 32px rgba(0,0,0,0.25);
        }
        .toast.show { transform: translateX(-50%) translateY(0); }

        @media(max-width:600px){
          .page{padding:16px;} .nav{padding:0 16px;} .nav-logo small{display:none;}
          .bi-para{font-size:15px;} .bilingual{padding:16px 18px;}
          .walk-en{font-size:36px;} .walk-card{padding:36px 22px; border-radius:22px;}
        }
      `}</style>

      {/* SVG icon defs */}
      <svg style={{display:'none'}} xmlns="http://www.w3.org/2000/svg">
        <symbol id="icon-play" viewBox="0 0 24 24"><path fill="currentColor" d="M8 5.14v14l11-7-11-7z"/></symbol>
        <symbol id="icon-pause" viewBox="0 0 24 24"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></symbol>
        <symbol id="icon-stop" viewBox="0 0 24 24"><path fill="currentColor" d="M6 6h12v12H6z"/></symbol>
        <symbol id="icon-speaker" viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></symbol>
        <symbol id="icon-walk" viewBox="0 0 24 24"><circle fill="currentColor" cx="13" cy="3.5" r="1.5"/><path fill="currentColor" d="M13 6l-3.5 4 2 1.5L9 16H6v2h3.5l1.5-4 2 2v4h2v-6l-2-2 1-2 1.5 2H19v-2h-2.5L13 6zm-4.5 9H5l1.5-4 2 2-1 2z"/></symbol>
        <symbol id="icon-star" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></symbol>
        <symbol id="icon-star-outline" viewBox="0 0 24 24"><path fill="currentColor" d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/></symbol>
        <symbol id="icon-copy" viewBox="0 0 24 24"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></symbol>
        <symbol id="icon-delete" viewBox="0 0 24 24"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></symbol>
        <symbol id="icon-prev" viewBox="0 0 24 24"><path fill="currentColor" d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></symbol>
        <symbol id="icon-next" viewBox="0 0 24 24"><path fill="currentColor" d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></symbol>
        <symbol id="icon-headphones" viewBox="0 0 24 24"><path fill="currentColor" d="M12 1C7.03 1 3 5.03 3 10v3c0 1.1.9 2 2 2h1c.55 0 1-.45 1-1v-3c0-.55-.45-1-1-1H5.07C5.56 7.19 8.47 5 12 5s6.44 2.19 6.93 5H17c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1h1v1c0 1.1-.9 2-2 2h-2c0-.55-.45-1-1-1s-1 .45-1 1 .45 1 1 1h2c2.21 0 4-1.79 4-4v-5c0-4.97-4.03-9-9-9z"/></symbol>
      </svg>

      {/* NAV */}
      <nav className="nav">
        <div className="nav-logo">📖 英语助手 <small>English Learning Tool</small></div>
        <div className="nav-tabs">
          <button className={`nav-tab${tab==='translate'?' active':''}`} onClick={() => setTab('translate')}>
            翻译对照
          </button>
          <button className={`nav-tab${tab==='vocab'?' active':''}`} onClick={() => setTab('vocab')}>
            收藏库
          </button>
          <button className={`nav-tab${tab==='walk'?' active':''}`} onClick={() => setTab('walk')}>
            <svg className="icon"><use href="#icon-headphones"/></svg>
            走路听
          </button>
        </div>
      </nav>

      {/* ── TRANSLATE ── */}
      {tab === 'translate' && (
        <div className="page">
          <div className="card">
            <div className="card-header"><span className="card-title">粘贴英文段落</span></div>
            <div className="card-body">
              <textarea value={inputText} onChange={e => setInputText(e.target.value)}
                placeholder="Paste your English text here...  把英文粘贴到这里，一键翻译 ✨" rows={5} />
              <div className="actions">
                <button className="btn btn-primary" onClick={doTranslate} disabled={loading || !inputText.trim()}>
                  {loading ? '翻译中...' : '✨ 翻译'}
                </button>
                <button className="btn btn-glass" onClick={() => { setInputText(''); setSegments([]); setFullZh(''); setError(''); stopSpeech(); }}>清空</button>
              </div>
            </div>
          </div>

          {(loading || segments.length > 0 || error) && (
            <div className="card">
              <div className="card-header">
                <span className="card-title">双语对照</span>
                {segments.length > 0 && (
                  <div className="tts-controls">
                    <select className="speed-select" value={ttsSpeed} onChange={e => { stopSpeech(); setTtsSpeed(parseFloat(e.target.value)); }}>
                      <option value={0.7}>慢速</option>
                      <option value={0.9}>正常</option>
                      <option value={1.15}>快速</option>
                    </select>
                    <button className={`icon-btn${speechState==='playing'?' active':''}`} onClick={toggleSpeech} title={speechState==='idle'?'朗读':speechState==='playing'?'暂停':'继续'}>
                      <svg className="icon"><use href={speechState==='playing'?'#icon-pause':'#icon-play'}/></svg>
                    </button>
                    <button className="icon-btn" onClick={stopSpeech} title="停止">
                      <svg className="icon"><use href="#icon-stop"/></svg>
                    </button>
                  </div>
                )}
              </div>

              {loading && <div className="loading"><div className="spinner"></div><div>翻译中，请稍候...</div></div>}
              {error && <div className="err">❌ {error}</div>}

              {!loading && segments.length > 0 && (
                <div className="bilingual" onClick={() => setTooltipSeg(null)}>
                  {/* English */}
                  <div className="bi-label">English</div>
                  <div className="bi-para">
                    {segments.map((seg, si) => {
                      const isActive = activeSegId === si;
                      const cls = `seg${isActive?(speakingSeg===si?' hl-speak':' hl-hover'):''}${isSaved(seg)?' is-saved':''}`;
                      return (
                        <span key={si} className="seg-wrap">
                          {tooltipSeg === si && (
                            <span className="seg-tip" onClick={e => e.stopPropagation()}>
                              <span style={{fontWeight:600}}>{seg.en.join(' ')} → {seg.zh.join('')}</span>
                              <span className="tip-row">
                                <button className={`tip-btn${isSaved(seg)?' saved':''}`} onClick={() => toggleSave(seg)}>
                                  {isSaved(seg)?'★ 已收藏':'☆ 收藏'}
                                </button>
                                <button className="tip-btn" onClick={() => { navigator.clipboard?.writeText(seg.en.join(' ')); showToast('已复制'); setTooltipSeg(null); }}>复制</button>
                                <button className="tip-btn" onClick={() => { window.speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(seg.en.join(' ')); u.lang='en-US'; const v=getBestVoice(); if(v) u.voice=v; window.speechSynthesis.speak(u); setTooltipSeg(null); }}>
                                  🔊
                                </button>
                              </span>
                            </span>
                          )}
                          <span className={cls}
                            onMouseEnter={() => setHoveredSeg(si)}
                            onMouseLeave={() => setHoveredSeg(null)}
                            onClick={e => { e.stopPropagation(); setTooltipSeg(tooltipSeg===si?null:si); }}
                          >{seg.en.join(' ')}</span>{' '}
                        </span>
                      );
                    })}
                  </div>

                  <div className="bi-sep" />

                  {/* Chinese — fullZh as natural paragraph, segments for hover */}
                  <div className="bi-label">中文译文</div>
                  <div className="bi-para">
                    {fullZh ? (
                      // Show natural fullZh, but overlay hover highlight via segments index
                      segments.map((seg, si) => {
                        const isActive = activeSegId === si;
                        const cls = `seg${isActive?(speakingSeg===si?' hl-speak':' hl-hover'):''}`;
                        return (
                          <span key={si} className={cls}
                            onMouseEnter={() => setHoveredSeg(si)}
                            onMouseLeave={() => setHoveredSeg(null)}
                            onClick={e => { e.stopPropagation(); setTooltipSeg(tooltipSeg===si?null:si); }}
                          >{seg.zh.join('')}</span>
                        );
                      })
                    ) : (
                      segments.map((seg, si) => {
                        const isActive = activeSegId === si;
                        const cls = `seg${isActive?(speakingSeg===si?' hl-speak':' hl-hover'):''}`;
                        return (
                          <span key={si} className={cls}
                            onMouseEnter={() => setHoveredSeg(si)}
                            onMouseLeave={() => setHoveredSeg(null)}
                            onClick={e => { e.stopPropagation(); setTooltipSeg(tooltipSeg===si?null:si); }}
                          >{seg.zh.join('')}</span>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── VOCAB ── */}
      {tab === 'vocab' && (
        <div className="page">
          <div className="page-head"><h1>我的单词本</h1><p>收藏的词组，可加入「走路听」在通勤时复习</p></div>
          <div className="toolbar">
            <button className="btn btn-primary" onClick={() => {
              if(!vocab.length){showToast('收藏库是空的');return;}
              const news=vocab.filter(v=>!inQueue(v.word)).map(v=>({word:v.word,zh:v.zh}));
              saveWalkQueue([...walkQueue,...news]); showToast(`已加入 ${vocab.length} 个词`);
            }}>
              <svg className="icon"><use href="#icon-headphones"/></svg>
              全部加入走路听
            </button>
            <button className="btn btn-danger" onClick={() => { if(vocab.length&&confirm(`确定清空全部 ${vocab.length} 个？`)){saveVocab([]);saveWalkQueue([]);} }}>
              <svg className="icon"><use href="#icon-delete"/></svg>
              清空
            </button>
            <span className="count-badge">共 {vocab.length} 个</span>
          </div>
          {vocab.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📭</div>
              <div className="empty-title">还没有收藏</div>
              <div>在翻译页面点击词组，选择 ☆ 收藏</div>
            </div>
          ) : (
            <div className="vocab-list">
              {vocab.map((v, i) => (
                <div key={i} className={`vocab-item${inQueue(v.word)?' in-q':''}`}>
                  <span className="vocab-word">{v.word}</span>
                  <span className="vocab-zh">{v.zh}</span>
                  <span className="vocab-date">{new Date(v.addedAt).toLocaleDateString('zh-CN',{month:'short',day:'numeric'})}</span>
                  <div className="vocab-acts">
                    <button className={`icon-btn${inQueue(v.word)?' active':''}`} onClick={() => toggleWalkItem(i)} title={inQueue(v.word)?'移出走路听':'加入走路听'}>
                      <svg className="icon"><use href="#icon-headphones"/></svg>
                    </button>
                    <button className="icon-btn" onClick={() => { const u=new SpeechSynthesisUtterance(v.word); u.lang='en-US'; const vv=getBestVoice(); if(vv) u.voice=vv; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); }} title="朗读">
                      <svg className="icon"><use href="#icon-speaker"/></svg>
                    </button>
                    <button className="icon-btn danger" onClick={() => deleteVocab(i)} title="删除">
                      <svg className="icon"><use href="#icon-delete"/></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── WALK ── */}
      {tab === 'walk' && (
        <div className="page">
          <div className="walk-outer">
            <div className="page-head" style={{textAlign:'center'}}>
              <h1>走路听</h1>
              <p>英文 → 中文，循环播报，解放双眼</p>
            </div>
            <div className="walk-card">
              {walkQueue.length === 0 ? (
                <div>
                  <div style={{fontSize:52,marginBottom:16}}>🎒</div>
                  <div style={{fontSize:17,fontWeight:600,color:'var(--text2)',marginBottom:8}}>播放列表是空的</div>
                  <div style={{fontSize:14,color:'var(--text3)',marginBottom:22}}>去「收藏库」把词组加入走路听</div>
                  <button className="btn btn-primary" onClick={() => setTab('vocab')}>去收藏库 →</button>
                </div>
              ) : (
                <>
                  <div className="walk-progress">第 {walkIdx+1} / 共 {walkQueue.length} 词</div>
                  <div className="walk-en">{currentWalk?.word || '—'}</div>
                  <div className="walk-zh">{currentWalk?.zh || '—'}</div>
                  <div className="walk-controls">
                    <button className="walk-prev-next" onClick={() => walkNav(-1)}>
                      <svg className="icon" style={{width:22,height:22}}><use href="#icon-prev"/></svg>
                    </button>
                    <button className="walk-play" onClick={toggleWalk}>
                      <svg style={{width:30,height:30,color:'#fff'}}><use href={walkPlaying?'#icon-pause':'#icon-play'}/></svg>
                    </button>
                    <button className="walk-prev-next" onClick={() => walkNav(1)}>
                      <svg className="icon" style={{width:22,height:22}}><use href="#icon-next"/></svg>
                    </button>
                  </div>
                  <div className="walk-status">
                    <span className={`dot${walkPhase==='en'?' en':walkPhase==='zh'?' zh':walkPhase==='pause'?' pause':''}`}></span>
                    <span>{walkPhase==='en'?`英文：${currentWalk?.word}`:walkPhase==='zh'?`中文：${currentWalk?.zh}`:walkPhase==='pause'?'停顿中...':'点击播放'}</span>
                  </div>
                  <div className="walk-opts">
                    停顿：
                    <select value={walkPause} onChange={e=>setWalkPause(parseInt(e.target.value))}>
                      <option value={800}>短</option>
                      <option value={1200}>中</option>
                      <option value={2000}>长</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={`toast${toast?' show':''}`}>{toast}</div>
    </>
  );
}
