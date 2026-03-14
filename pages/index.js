import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';

export default function Home() {
  const [tab, setTab] = useState('translate');
  const [inputText, setInputText] = useState('');
  const [segments, setSegments] = useState([]);
  const [fullZh, setFullZh] = useState("");
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

  // ── TRANSLATE ──
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
      setSegments(data.segments.map((s, i) => ({ id: i, en: s.en, zh: s.zh })));
      if (data.fullZh) setFullZh(data.fullZh);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // ── TTS ──
  function getBestVoice() {
    const voices = window.speechSynthesis.getVoices();
    const preferred = ['Samantha','Google US English','Microsoft Aria Online','Microsoft Aria','Alex','Karen','Victoria'];
    for (const name of preferred) {
      const v = voices.find(v => v.name.includes(name));
      if (v) return v;
    }
    return voices.find(v => v.lang.startsWith('en') && v.localService)
        || voices.find(v => v.lang.startsWith('en')) || null;
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

  // ── VOCAB ──
  function toggleSave(seg) {
    const key = seg.en.join(' ').toLowerCase();
    const exists = vocab.findIndex(v => v.word.toLowerCase() === key);
    if (exists >= 0) { saveVocab(vocab.filter((_, i) => i !== exists)); showToast('已取消收藏'); }
    else { saveVocab([{ word: seg.en.join(' '), zh: seg.zh.join(''), addedAt: Date.now() }, ...vocab]); showToast('⭐ 已收藏'); }
    setTooltipSeg(null);
  }
  function deleteVocab(i) {
    const w = vocab[i].word; saveVocab(vocab.filter((_, j) => j !== i));
    saveWalkQueue(walkQueue.filter(x => x.word !== w)); showToast('已删除');
  }
  function toggleWalkItem(i) {
    const v = vocab[i]; const idx = walkQueue.findIndex(w => w.word === v.word);
    if (idx >= 0) { saveWalkQueue(walkQueue.filter((_, j) => j !== idx)); showToast('已移除'); }
    else { saveWalkQueue([...walkQueue, { word: v.word, zh: v.zh }]); showToast('🎧 已加入走路听'); }
  }
  const isSaved = seg => vocab.some(v => v.word.toLowerCase() === seg.en.join(' ').toLowerCase());
  const inQueue = w => walkQueue.some(q => q.word === w);
  const activeSegId = speakingSeg ?? hoveredSeg;

  // ── WALK ──
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
      navigator.mediaSession.metadata = new MediaMetadata({ title: item.word, artist: item.zh, album: '🎧 走路听' });
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
        <title>Luca学英语</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #f3f2f1; --surface: #fff; --surface2: #faf9f8; --surface3: #f3f2f1;
          --border: #e1dfdd; --border2: #c8c6c4;
          --text: #201f1e; --text2: #605e5c; --text3: #a19f9d;
          --blue: #0078d4; --blue-dark: #005a9e; --blue-light: #eff6fc; --blue-mid: #c7e0f4;
          --yellow: #fff100; --yellow-bg: #fffde6;
          --green: #107c10; --red: #d13438; --red-light: #fde7e9;
          --shadow-sm: 0 1px 2px rgba(0,0,0,.06),0 1px 4px rgba(0,0,0,.04);
          --shadow: 0 2px 4px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.06);
          --shadow-lg: 0 8px 24px rgba(0,0,0,.12);
          --r: 4px; --r-lg: 8px;
        }
        body { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; font-size: 14px; line-height: 1.5; }

        .nav { background: 111111; display: flex; align-items: center; height: 48px; padding: 0 20px; position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
        .nav-logo { color: #fff; font-weight: 600; font-size: 15px; margin-right: 24px; display: flex; align-items: center; gap: 8px; }
        .nav-logo small { opacity: .75; font-weight: 400; font-size: 12px; }
        .nav-tabs { display: flex; height: 100%; }
        .nav-tab { height: 100%; padding: 0 16px; color: rgba(255,255,255,.8); border: none; background: none; cursor: pointer; font-size: 13px; font-weight: 500; font-family: inherit; border-bottom: 3px solid transparent; transition: all .15s; display: flex; align-items: center; }
        .nav-tab:hover { color: #fff; background: rgba(255,255,255,.1); }
        .nav-tab.active { color: #fff; border-bottom-color: #fff; }

        .page { max-width: 860px; margin: 0 auto; padding: 24px 20px; }
        .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-sm); overflow: hidden; margin-bottom: 16px; }
        .card-header { padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--surface2); display: flex; align-items: center; gap: 10px; min-height: 40px; }
        .card-title { font-size: 11px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: .07em; flex: 1; }
        .card-body { padding: 16px; }

        textarea { width: 100%; border: 1px solid var(--border2); border-radius: var(--r); padding: 12px 14px; font-family: inherit; font-size: 14px; line-height: 1.7; color: var(--text); background: var(--surface); resize: vertical; min-height: 110px; outline: none; transition: border-color .15s, box-shadow .15s; }
        textarea:focus { border-color: var(--blue); box-shadow: 0 0 0 1px var(--blue); }
        textarea::placeholder { color: var(--text3); }

        .btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 16px; border-radius: var(--r); font-size: 14px; font-weight: 500; font-family: inherit; cursor: pointer; border: 1px solid transparent; transition: all .12s; white-space: nowrap; }
        .btn-primary { background: var(--blue); color: #fff; border-color: var(--blue); }
        .btn-primary:hover { background: var(--blue-dark); }
        .btn-primary:disabled { opacity: .5; cursor: not-allowed; }
        .btn-secondary { background: var(--surface); color: var(--text); border-color: var(--border2); }
        .btn-secondary:hover { background: var(--surface3); }
        .btn-danger { background: transparent; color: var(--red); border-color: var(--border); }
        .btn-danger:hover { background: var(--red-light); border-color: var(--red); }

        .icon-btn { width: 28px; height: 28px; border-radius: var(--r); border: 1px solid var(--border); background: var(--surface); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 13px; transition: all .12s; color: var(--text2); flex-shrink: 0; }
        .icon-btn:hover { background: var(--blue-light); border-color: var(--blue-mid); color: var(--blue); }
        .icon-btn.active { background: var(--blue-light); border-color: var(--blue); color: var(--blue); }
        .icon-btn.danger:hover { background: var(--red-light); border-color: var(--red); color: var(--red); }

        .actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
        .tts-controls { display: flex; align-items: center; gap: 6px; }
        .speed-select { font-size: 12px; padding: 3px 6px; border: 1px solid var(--border); border-radius: var(--r); background: var(--surface); color: var(--text2); font-family: inherit; cursor: pointer; }

        /* BILINGUAL */
        .bilingual { padding: 20px 24px; }
        .bi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--text3); margin-bottom: 10px; }
        .bi-para { font-size: 16px; line-height: 2.1; }
        .seg-wrap { display: inline; }
        .seg { display: inline; cursor: pointer; border-radius: 3px; padding: 1px 3px; transition: background .1s; }
        .seg.hl-hover { background: var(--yellow); }
        .seg.hl-speak { background: var(--blue-mid); }
        .seg.is-saved { color: #7a5c00; }
        .bi-sep { height: 1px; background: var(--border); margin: 18px 0; }

        /* TOOLTIP */
        .seg-wrap { position: relative; display: inline; }
        .seg-tip { position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); background: #201f1e; color: #fff; border-radius: var(--r-lg); padding: 8px 12px; font-size: 12px; white-space: nowrap; z-index: 300; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .seg-tip::after { content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%); border: 5px solid transparent; border-top-color: #201f1e; }
        .tip-row { display: flex; gap: 5px; }
        .tip-btn { background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.2); color: #fff; border-radius: 3px; padding: 2px 8px; font-size: 11px; cursor: pointer; font-family: inherit; }
        .tip-btn:hover { background: rgba(255,255,255,.22); }
        .tip-btn.saved { color: #fff100; }

        .loading { padding: 48px; text-align: center; color: var(--text3); }
        .spinner { width: 32px; height: 32px; border: 3px solid var(--border); border-top-color: var(--blue); border-radius: 50%; animation: spin .7s linear infinite; margin: 0 auto 16px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .err { margin: 0 16px 16px; padding: 10px 14px; background: var(--red-light); border: 1px solid #f1b9bb; border-radius: var(--r); color: var(--red); font-size: 13px; }

        /* VOCAB */
        .page-head { margin-bottom: 20px; }
        .page-head h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
        .page-head p { color: var(--text2); font-size: 13px; }
        .toolbar { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; flex-wrap: wrap; }
        .count-badge { margin-left: auto; font-size: 12px; color: var(--text3); background: var(--surface3); border: 1px solid var(--border); border-radius: 100px; padding: 2px 10px; }
        .vocab-list { display: flex; flex-direction: column; gap: 6px; }
        .vocab-item { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 12px 16px; display: flex; align-items: center; gap: 12px; box-shadow: var(--shadow-sm); transition: border-color .12s; }
        .vocab-item:hover { border-color: var(--blue-mid); }
        .vocab-item.in-q { border-left: 3px solid var(--blue); }
        .vocab-word { font-size: 16px; font-weight: 600; min-width: 90px; }
        .vocab-zh { color: var(--text2); font-size: 13px; flex: 1; }
        .vocab-date { color: var(--text3); font-size: 11px; }
        .vocab-acts { display: flex; gap: 4px; }
        .empty { text-align: center; padding: 64px 24px; color: var(--text3); }
        .empty-icon { font-size: 44px; margin-bottom: 12px; }
        .empty-title { font-size: 16px; font-weight: 600; color: var(--text2); margin-bottom: 6px; }

        /* WALK */
        .walk-outer { max-width: 420px; margin: 28px auto 0; }
        .walk-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 40px 32px; text-align: center; box-shadow: var(--shadow); }
        .walk-progress { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text3); margin-bottom: 28px; }
        .walk-en { font-size: 42px; font-weight: 700; line-height: 1.15; min-height: 54px; margin-bottom: 12px; }
        .walk-zh { font-size: 20px; color: var(--text2); margin-bottom: 36px; min-height: 28px; }
        .walk-controls { display: flex; align-items: center; justify-content: center; gap: 14px; }
        .walk-btn { width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface2); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; transition: all .12s; }
        .walk-btn:hover { border-color: var(--blue); color: var(--blue); background: var(--blue-light); }
        .walk-play { width: 64px; height: 64px; border-radius: 50%; background: var(--blue); color: #fff; border: none; cursor: pointer; font-size: 26px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(0,120,212,.3); transition: all .12s; }
        .walk-play:hover { background: var(--blue-dark); transform: scale(1.05); }
        .walk-status { margin-top: 20px; font-size: 12px; color: var(--text3); display: flex; align-items: center; gap: 7px; justify-content: center; }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text3); }
        .dot.en { background: var(--blue); }
        .dot.zh { background: var(--green); }
        .dot.pause { background: #d29200; animation: pulse 1s infinite; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.3} }
        .walk-opts { margin-top: 18px; display: flex; align-items: center; gap: 8px; justify-content: center; font-size: 12px; color: var(--text2); }
        .walk-opts select { border: 1px solid var(--border); border-radius: var(--r); padding: 3px 8px; font-size: 12px; font-family: inherit; background: var(--surface); }

        .toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%) translateY(60px); background: #201f1e; color: #fff; padding: 8px 18px; border-radius: 100px; font-size: 13px; font-weight: 500; z-index: 1000; transition: transform .22s cubic-bezier(.34,1.56,.64,1); white-space: nowrap; pointer-events: none; box-shadow: var(--shadow-lg); }
        .toast.show { transform: translateX(-50%) translateY(0); }

        @media(max-width:600px){
          .page{padding:16px;} .nav{padding:0 12px;} .nav-logo small{display:none;}
          .bi-para{font-size:15px;} .bilingual{padding:16px;} .walk-en{font-size:34px;} .walk-card{padding:28px 20px;}
        }
      `}</style>

      <nav className="nav">
        <div className="nav-logo">📖 Luca学英语 <small>English Learning Tool</small></div>
        <div className="nav-tabs">
          {[['translate','翻译对照'],['vocab','收藏库'],['walk','🎧 走路听']].map(([id,label]) => (
            <button key={id} className={`nav-tab${tab===id?' active':''}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      </nav>

      {/* TRANSLATE */}
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
                <button className="btn btn-secondary" onClick={() => { setInputText(''); setSegments([]); setError(''); stopSpeech(); }}>清空</button>
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
                    <button className={`icon-btn${speechState==='playing'?' active':''}`} onClick={toggleSpeech}>
                      {speechState === 'idle' ? '▶' : speechState === 'playing' ? '⏸' : '▶'}
                    </button>
                    <button className="icon-btn" onClick={stopSpeech}>⏹</button>
                  </div>
                )}
              </div>
              {loading && <div className="loading"><div className="spinner"></div><div>翻译中...</div></div>}
              {error && <div className="err">❌ {error}</div>}
              {!loading && segments.length > 0 && (
                <div className="bilingual" onClick={() => setTooltipSeg(null)}>
                  <div className="bi-label">English</div>
                  <div className="bi-para">
                    {segments.map((seg, si) => {
                      const isActive = activeSegId === si;
                      const cls = `seg${isActive ? (speakingSeg===si ? ' hl-speak' : ' hl-hover') : ''}${isSaved(seg) ? ' is-saved' : ''}`;
                      return (
                        <span key={si} className="seg-wrap">
                          {tooltipSeg === si && (
                            <span className="seg-tip" onClick={e => e.stopPropagation()}>
                              <span style={{fontWeight:600,fontSize:13}}>{seg.en.join(' ')} → {seg.zh.join('')}</span>
                              <span className="tip-row">
                                <button className={`tip-btn${isSaved(seg)?' saved':''}`} onClick={() => toggleSave(seg)}>{isSaved(seg)?'⭐ 已收藏':'☆ 收藏'}</button>
                                <button className="tip-btn" onClick={() => { navigator.clipboard?.writeText(seg.en.join(' ')); showToast('已复制'); setTooltipSeg(null); }}>复制</button>
                                <button className="tip-btn" onClick={() => { window.speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(seg.en.join(' ')); u.lang='en-US'; const v=getBestVoice(); if(v) u.voice=v; window.speechSynthesis.speak(u); setTooltipSeg(null); }}>🔊</button>
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
                  <div className="bi-label">中文译文</div>
                  <div className="bi-para">
                    {segments.map((seg, si) => {
                      const isActive = activeSegId === si;
                      const cls = `seg${isActive ? (speakingSeg===si ? ' hl-speak' : ' hl-hover') : ''}`;
                      return (
                        <span key={si} className={cls}
                          onMouseEnter={() => setHoveredSeg(si)}
                          onMouseLeave={() => setHoveredSeg(null)}
                          onClick={e => { e.stopPropagation(); setTooltipSeg(tooltipSeg===si?null:si); }}
                        >{seg.zh.join('')}</span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* VOCAB */}
      {tab === 'vocab' && (
        <div className="page">
          <div className="page-head"><h1>我的单词本</h1><p>收藏的词组，可加入「走路听」在通勤时复习</p></div>
          <div className="toolbar">
            <button className="btn btn-primary" onClick={() => { if(!vocab.length){showToast('收藏库是空的');return;} const news=vocab.filter(v=>!inQueue(v.word)).map(v=>({word:v.word,zh:v.zh})); saveWalkQueue([...walkQueue,...news]); showToast(`🎧 已加入 ${vocab.length} 个`); }}>🎧 全部加入走路听</button>
            <button className="btn btn-danger" onClick={() => { if(vocab.length&&confirm(`确定清空全部 ${vocab.length} 个？`)){saveVocab([]);saveWalkQueue([]);} }}>🗑 清空</button>
            <span className="count-badge">共 {vocab.length} 个</span>
          </div>
          {vocab.length === 0 ? (
            <div className="empty"><div className="empty-icon">📭</div><div className="empty-title">还没有收藏</div><div>在翻译页面点击词组选择 ☆ 收藏</div></div>
          ) : (
            <div className="vocab-list">
              {vocab.map((v, i) => (
                <div key={i} className={`vocab-item${inQueue(v.word)?' in-q':''}`}>
                  <span className="vocab-word">{v.word}</span>
                  <span className="vocab-zh">{v.zh}</span>
                  <span className="vocab-date">{new Date(v.addedAt).toLocaleDateString('zh-CN',{month:'short',day:'numeric'})}</span>
                  <div className="vocab-acts">
                    <button className={`icon-btn${inQueue(v.word)?' active':''}`} onClick={() => toggleWalkItem(i)} title="走路听">🎧</button>
                    <button className="icon-btn" onClick={() => { const u=new SpeechSynthesisUtterance(v.word); u.lang='en-US'; const vv=getBestVoice(); if(vv) u.voice=vv; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); }} title="朗读">🔊</button>
                    <button className="icon-btn danger" onClick={() => deleteVocab(i)} title="删除">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* WALK */}
      {tab === 'walk' && (
        <div className="page">
          <div className="walk-outer">
            <div className="page-head" style={{textAlign:'center'}}><h1>🎧 走路听</h1><p>英文 → 中文，循环播报，解放双眼</p></div>
            <div className="walk-card">
              {walkQueue.length === 0 ? (
                <div>
                  <div style={{fontSize:48,marginBottom:14}}>🎒</div>
                  <div style={{fontSize:16,fontWeight:600,color:'var(--text2)',marginBottom:8}}>播放列表是空的</div>
                  <div style={{fontSize:13,color:'var(--text3)',marginBottom:20}}>去「收藏库」把词组加入走路听</div>
                  <button className="btn btn-primary" onClick={() => setTab('vocab')}>去收藏库 →</button>
                </div>
              ) : (
                <>
                  <div className="walk-progress">第 {walkIdx+1} / 共 {walkQueue.length} 词</div>
                  <div className="walk-en">{currentWalk?.word || '—'}</div>
                  <div className="walk-zh">{currentWalk?.zh || '—'}</div>
                  <div className="walk-controls">
                    <button className="walk-btn" onClick={() => walkNav(-1)}>⏮</button>
                    <button className="walk-play" onClick={toggleWalk}>{walkPlaying ? '⏸' : '▶'}</button>
                    <button className="walk-btn" onClick={() => walkNav(1)}>⏭</button>
                  </div>
                  <div className="walk-status">
                    <span className={`dot${walkPhase==='en'?' en':walkPhase==='zh'?' zh':walkPhase==='pause'?' pause':''}`}></span>
                    <span>{walkPhase==='en'?`英文：${currentWalk?.word}`:walkPhase==='zh'?`中文：${currentWalk?.zh}`:walkPhase==='pause'?'停顿中...':'点击播放'}</span>
                  </div>
                  <div className="walk-opts">停顿：<select value={walkPause} onChange={e=>setWalkPause(parseInt(e.target.value))}><option value={800}>短</option><option value={1200}>中</option><option value={2000}>长</option></select></div>
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
