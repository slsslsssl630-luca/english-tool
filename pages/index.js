import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';

export default function Home() {
  const [tab, setTab] = useState('translate');
  const [inputText, setInputText] = useState('');
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(null);
  const [ttsIdx, setTtsIdx] = useState(null);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [vocab, setVocab] = useState([]);
  const [walkQueue, setWalkQueue] = useState([]);
  const [walkIdx, setWalkIdx] = useState(0);
  const [walkPlaying, setWalkPlaying] = useState(false);
  const [walkPhase, setWalkPhase] = useState('idle');
  const [walkPause, setWalkPause] = useState(1200);
  const [toast, setToast] = useState('');
  const [tooltipIdx, setTooltipIdx] = useState(null);
  const walkTimerRef = useRef(null);
  const walkPlayingRef = useRef(false);
  const toastTimerRef = useRef(null);

  // Load from localStorage
  useEffect(() => {
    try {
      setVocab(JSON.parse(localStorage.getItem('vocab') || '[]'));
      setWalkQueue(JSON.parse(localStorage.getItem('walkQueue') || '[]'));
    } catch(e) {}
  }, []);

  const saveVocab = (v) => { setVocab(v); localStorage.setItem('vocab', JSON.stringify(v)); };
  const saveWalkQueue = (q) => { setWalkQueue(q); localStorage.setItem('walkQueue', JSON.stringify(q)); };

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 2200);
  };

  // ── TRANSLATE ──────────────────────────────────────────
  function tokenize(text) {
    const tokens = [];
    const regex = /([a-zA-Z'''\-]+)|([^a-zA-Z\s]+)/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (m[1]) tokens.push({ type: 'word', val: m[1] });
      else if (m[2] && m[2].trim()) tokens.push({ type: 'punct', val: m[2].trim() });
    }
    return tokens;
  }

  async function doTranslate() {
    if (!inputText.trim()) { showToast('请先粘贴英文内容'); return; }
    setLoading(true); setError(''); setPairs([]); setTtsIdx(null); setTtsPlaying(false);
    window.speechSynthesis?.cancel();

    try {
      const tokens = tokenize(inputText.trim());
      const words = tokens.filter(t => t.type === 'word').map(t => t.val);
      if (!words.length) throw new Error('没有找到英文单词');

      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '翻译失败');

      // Reassemble with punctuation
      const result = [];
      let wordIdx = 0;
      tokens.forEach((token, i) => {
        if (token.type === 'word') {
          result.push({ en: token.val, zh: data.translations[wordIdx] || token.val, punct: '' });
          wordIdx++;
        } else {
          if (result.length > 0) result[result.length - 1].punct += token.val;
        }
      });
      setPairs(result);
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ── TTS ────────────────────────────────────────────────
  function playTTS() {
    if (!pairs.length) return;
    window.speechSynthesis.cancel();
    const text = pairs.map(p => p.en + (p.punct || '')).join(' ');
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'en-US'; utt.rate = ttsSpeed;
    let wi = 0;
    utt.onboundary = (e) => { if (e.name === 'word') { setTtsIdx(wi); wi++; } };
    utt.onend = () => { setTtsPlaying(false); setTtsIdx(null); };
    utt.onerror = () => { setTtsPlaying(false); setTtsIdx(null); };
    window.speechSynthesis.speak(utt);
    setTtsPlaying(true);
  }

  function stopTTS() {
    window.speechSynthesis?.cancel();
    setTtsPlaying(false); setTtsIdx(null);
  }

  function toggleTTS() { ttsPlaying ? stopTTS() : playTTS(); }

  // ── VOCAB ──────────────────────────────────────────────
  function toggleSave(idx) {
    const pair = pairs[idx];
    const exists = vocab.findIndex(v => v.word.toLowerCase() === pair.en.toLowerCase());
    if (exists >= 0) {
      saveVocab(vocab.filter((_, i) => i !== exists));
      showToast('已取消收藏');
    } else {
      saveVocab([{ word: pair.en, zh: pair.zh, addedAt: Date.now() }, ...vocab]);
      showToast('⭐ 已收藏「' + pair.en + '」');
    }
    setTooltipIdx(null);
  }

  function deleteVocab(i) {
    const word = vocab[i].word;
    saveVocab(vocab.filter((_, j) => j !== i));
    saveWalkQueue(walkQueue.filter(w => w.word !== word));
    showToast('已删除');
  }

  function toggleWalkQueue(i) {
    const v = vocab[i];
    const idx = walkQueue.findIndex(w => w.word === v.word);
    if (idx >= 0) { saveWalkQueue(walkQueue.filter((_, j) => j !== idx)); showToast('已从走路听移除'); }
    else { saveWalkQueue([...walkQueue, { word: v.word, zh: v.zh }]); showToast('🎧 已加入走路听'); }
  }

  function addAllToWalk() {
    if (!vocab.length) { showToast('收藏库是空的'); return; }
    const newItems = vocab.filter(v => !walkQueue.some(w => w.word === v.word)).map(v => ({ word: v.word, zh: v.zh }));
    saveWalkQueue([...walkQueue, ...newItems]);
    showToast(`🎧 已加入 ${vocab.length} 个单词`);
  }

  // ── WALK MODE ──────────────────────────────────────────
  walkPlayingRef.current = walkPlaying;

  const stopWalk = useCallback(() => {
    walkPlayingRef.current = false;
    setWalkPlaying(false);
    setWalkPhase('idle');
    clearTimeout(walkTimerRef.current);
    window.speechSynthesis?.cancel();
  }, []);

  const speakWalkStep = useCallback((idx, queue, pause) => {
    if (!walkPlayingRef.current || !queue.length) return;
    const item = queue[idx % queue.length];
    setWalkIdx(idx % queue.length);
    setWalkPhase('en');

    const uEn = new SpeechSynthesisUtterance(item.word);
    uEn.lang = 'en-US'; uEn.rate = 0.85;
    uEn.onend = () => {
      if (!walkPlayingRef.current) return;
      setWalkPhase('pause');
      walkTimerRef.current = setTimeout(() => {
        if (!walkPlayingRef.current) return;
        setWalkPhase('zh');
        const uZh = new SpeechSynthesisUtterance(item.zh);
        uZh.lang = 'zh-CN'; uZh.rate = 0.9;
        uZh.onend = () => {
          if (!walkPlayingRef.current) return;
          setWalkPhase('pause');
          walkTimerRef.current = setTimeout(() => {
            if (!walkPlayingRef.current) return;
            speakWalkStep(idx + 1, queue, pause);
          }, pause * 1.3);
        };
        window.speechSynthesis.speak(uZh);
      }, pause);
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(uEn);

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.word, artist: item.zh, album: '走路听 · 英语学习'
      });
    }
  }, []);

  function startWalk() {
    if (!walkQueue.length) return;
    walkPlayingRef.current = true;
    setWalkPlaying(true);
    speakWalkStep(walkIdx, walkQueue, walkPause);
  }

  function toggleWalk() { walkPlaying ? stopWalk() : startWalk(); }

  function walkPrev() {
    const wasPlaying = walkPlaying;
    stopWalk();
    const ni = (walkIdx - 1 + walkQueue.length) % walkQueue.length;
    setWalkIdx(ni);
    if (wasPlaying) { walkPlayingRef.current = true; setWalkPlaying(true); setTimeout(() => speakWalkStep(ni, walkQueue, walkPause), 100); }
  }

  function walkNext() {
    const wasPlaying = walkPlaying;
    stopWalk();
    const ni = (walkIdx + 1) % walkQueue.length;
    setWalkIdx(ni);
    if (wasPlaying) { walkPlayingRef.current = true; setWalkPlaying(true); setTimeout(() => speakWalkStep(ni, walkQueue, walkPause), 100); }
  }

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => { if (!walkPlayingRef.current) startWalk(); });
      navigator.mediaSession.setActionHandler('pause', stopWalk);
      navigator.mediaSession.setActionHandler('previoustrack', walkPrev);
      navigator.mediaSession.setActionHandler('nexttrack', walkNext);
    }
  }, [walkQueue, walkIdx, walkPause]);

  const isSaved = (word) => vocab.some(v => v.word.toLowerCase() === word.toLowerCase());
  const inQueue = (word) => walkQueue.some(w => w.word === word);
  const currentWalkItem = walkQueue[walkIdx] || null;

  return (
    <>
      <Head>
        <title>英语学习助手</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;600&family=DM+Sans:wght@300;400;500;600&family=DM+Mono&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        :root {
          --bg: #F7F4EF; --surface: #fff; --surface2: #F0EDE8; --border: #E2DDD6;
          --text: #1C1917; --text2: #6B6560; --text3: #A8A29E;
          --accent: #2D6A4F; --accent2: #52B788; --accent-light: #D8F3DC;
          --yellow: #FDE68A; --yellow-dark: #F59E0B;
          --blue: #BFDBFE; --blue-dark: #3B82F6;
          --gold: #D97706; --red: #EF4444;
          --shadow: 0 1px 3px rgba(0,0,0,.06),0 4px 12px rgba(0,0,0,.04);
          --shadow-lg: 0 8px 32px rgba(0,0,0,.1);
          --r: 12px;
        }
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;font-size:15px}
        nav{background:var(--surface);border-bottom:1px solid var(--border);padding:0 24px;display:flex;align-items:center;height:56px;position:sticky;top:0;z-index:100;box-shadow:0 1px 8px rgba(0,0,0,.05)}
        .logo{font-family:'Lora',serif;font-weight:600;font-size:18px;color:var(--accent);margin-right:28px}
        .tabs{display:flex;gap:4px}
        .tab{padding:6px 16px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;color:var(--text2);border:none;background:none;font-family:'DM Sans',sans-serif}
        .tab:hover{background:var(--surface2);color:var(--text)}
        .tab.active{background:var(--accent-light);color:var(--accent);font-weight:600}
        .page{max-width:900px;margin:0 auto;padding:32px 24px}
        .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:20px;margin-bottom:20px;box-shadow:var(--shadow)}
        .label{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin-bottom:10px}
        textarea{width:100%;border:1px solid var(--border);border-radius:8px;padding:14px 16px;font-family:'DM Sans',sans-serif;font-size:15px;line-height:1.7;color:var(--text);background:var(--bg);resize:vertical;min-height:120px;outline:none;transition:border-color .15s}
        textarea:focus{border-color:var(--accent2);background:var(--surface)}
        textarea::placeholder{color:var(--text3)}
        .actions{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
        .btn{display:inline-flex;align-items:center;gap:7px;padding:9px 18px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;border:none;transition:all .15s;font-family:'DM Sans',sans-serif}
        .btn-primary{background:var(--accent);color:#fff}
        .btn-primary:hover{background:#235c42;transform:translateY(-1px);box-shadow:0 4px 12px rgba(45,106,79,.3)}
        .btn-secondary{background:var(--surface2);color:var(--text);border:1px solid var(--border)}
        .btn-secondary:hover{background:var(--border)}
        .btn-ghost{background:transparent;color:var(--text2);border:1px solid var(--border)}
        .btn-ghost:hover{background:var(--surface2)}
        .btn:disabled{opacity:.5;cursor:not-allowed;transform:none!important}
        .result-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow);overflow:hidden}
        .result-header{padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;background:var(--surface2)}
        .result-title{font-size:13px;font-weight:600;color:var(--text2);flex:1}
        .tts-controls{display:flex;align-items:center;gap:8px}
        .tts-btn{width:34px;height:34px;border-radius:8px;border:1px solid var(--border);background:var(--surface);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .15s;color:var(--text2)}
        .tts-btn:hover{background:var(--accent-light);border-color:var(--accent2);color:var(--accent)}
        .tts-btn.playing{background:var(--accent);color:#fff;border-color:var(--accent)}
        .speed-select{font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);cursor:pointer;color:var(--text2);font-family:'DM Sans',sans-serif}
        .word-pairs{padding:24px;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start}
        .word-pair{display:inline-flex;flex-direction:column;align-items:center;padding:6px 10px;border-radius:8px;border:1.5px solid transparent;cursor:pointer;transition:all .12s;position:relative;background:var(--surface2);min-width:40px;user-select:none}
        .word-pair:hover{border-color:var(--yellow-dark);background:var(--yellow)}
        .word-pair.hl{background:var(--yellow);border-color:var(--yellow-dark)}
        .word-pair.tts-hl{background:var(--blue);border-color:var(--blue-dark)}
        .word-pair.saved{background:#FEF9E7;border-color:#F59E0B}
        .word-en{font-family:'Lora',serif;font-size:15px;color:var(--text);white-space:nowrap}
        .word-zh{font-size:11px;color:var(--text2);margin-top:2px;white-space:nowrap}
        .word-pair.saved .word-en{color:var(--gold)}
        .tooltip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:var(--text);color:#fff;border-radius:8px;padding:8px 12px;font-size:12px;white-space:nowrap;z-index:200;box-shadow:var(--shadow-lg);display:flex;flex-direction:column;align-items:center;gap:6px}
        .tooltip::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--text)}
        .tip-actions{display:flex;gap:6px}
        .tip-btn{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:5px;padding:3px 9px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif}
        .tip-btn:hover{background:rgba(255,255,255,.25)}
        .tip-btn.saved{color:#FDE68A}
        .punct{font-family:'Lora',serif;font-size:18px;color:var(--text3);align-self:flex-end;padding-bottom:4px}
        .loading{padding:48px;text-align:center;color:var(--text3)}
        .spinner{width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}
        @keyframes spin{to{transform:rotate(360deg)}}
        .error-box{padding:24px;color:var(--red);font-size:14px}
        .page-title{font-family:'Lora',serif;font-size:28px;font-weight:600;margin-bottom:6px}
        .page-subtitle{color:var(--text2);font-size:14px;margin-bottom:28px}
        .vocab-toolbar{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center}
        .vocab-count{font-size:13px;color:var(--text3);margin-left:auto}
        .vocab-list{display:flex;flex-direction:column;gap:8px}
        .vocab-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:14px 18px;display:flex;align-items:center;gap:16px;box-shadow:var(--shadow);transition:all .15s}
        .vocab-item:hover{border-color:var(--accent2)}
        .vocab-item.in-queue{border-left:3px solid var(--accent)}
        .vocab-word{font-family:'Lora',serif;font-size:18px;min-width:100px}
        .vocab-zh{color:var(--text2);font-size:14px;flex:1}
        .vocab-date{color:var(--text3);font-size:12px}
        .vocab-actions{display:flex;gap:6px}
        .icon-btn{width:30px;height:30px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .12s;color:var(--text2)}
        .icon-btn:hover{background:var(--accent-light);border-color:var(--accent2);color:var(--accent)}
        .icon-btn.danger:hover{background:#FEE2E2;border-color:var(--red);color:var(--red)}
        .icon-btn.active{background:var(--accent-light);color:var(--accent);border-color:var(--accent2)}
        .empty{text-align:center;padding:64px 24px;color:var(--text3)}
        .empty-icon{font-size:48px;margin-bottom:16px}
        .empty-title{font-size:18px;font-weight:600;color:var(--text2);margin-bottom:8px}
        .walk-wrap{max-width:480px;margin:40px auto 0}
        .walk-card{background:var(--surface);border:1px solid var(--border);border-radius:24px;padding:48px 40px;text-align:center;box-shadow:var(--shadow-lg)}
        .walk-progress{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-bottom:32px}
        .walk-en{font-family:'Lora',serif;font-size:48px;font-weight:600;color:var(--text);margin-bottom:16px;line-height:1.2;min-height:60px}
        .walk-zh{font-size:22px;color:var(--text2);margin-bottom:48px;min-height:32px}
        .walk-controls{display:flex;align-items:center;justify-content:center;gap:16px}
        .walk-btn{width:52px;height:52px;border-radius:50%;border:2px solid var(--border);background:var(--surface2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:20px;transition:all .15s}
        .walk-btn:hover{border-color:var(--accent2);color:var(--accent);background:var(--accent-light)}
        .walk-play{width:72px;height:72px;border-radius:50%;background:var(--accent);color:#fff;border:none;cursor:pointer;font-size:28px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(45,106,79,.35);transition:all .15s}
        .walk-play:hover{background:#235c42;transform:scale(1.05)}
        .walk-status{margin-top:24px;font-size:13px;color:var(--text3);display:flex;align-items:center;gap:8px;justify-content:center}
        .status-dot{width:8px;height:8px;border-radius:50%;background:var(--text3)}
        .status-dot.en{background:var(--blue-dark)}
        .status-dot.zh{background:var(--accent2)}
        .status-dot.pause{background:var(--yellow-dark);animation:pulse 1s infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .walk-speed{margin-top:20px;display:flex;align-items:center;gap:10px;justify-content:center;font-size:13px;color:var(--text2)}
        .walk-speed select{border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:13px;font-family:'DM Sans',sans-serif;background:var(--surface);color:var(--text)}
        .toast{position:fixed;bottom:32px;left:50%;transform:translateX(-50%) translateY(80px);background:var(--text);color:#fff;padding:10px 20px;border-radius:100px;font-size:13px;font-weight:500;z-index:1000;transition:transform .25s cubic-bezier(.34,1.56,.64,1);white-space:nowrap;pointer-events:none}
        .toast.show{transform:translateX(-50%) translateY(0)}
        @media(max-width:600px){.page{padding:20px 16px}nav{padding:0 16px}.logo{font-size:16px;margin-right:16px}.word-pairs{gap:6px;padding:16px}.walk-en{font-size:36px}.walk-card{padding:36px 24px}}
      `}</style>

      {/* NAV */}
      <nav>
        <div className="logo">📖 英语助手</div>
        <div className="tabs">
          {[['translate','翻译对照'],['vocab','收藏库'],['walk','🎧 走路听']].map(([id,label]) => (
            <button key={id} className={`tab${tab===id?' active':''}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      </nav>

      {/* TRANSLATE */}
      {tab === 'translate' && (
        <div className="page">
          <div className="card">
            <div className="label">粘贴英文段落</div>
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="Paste your English text here... 把英文粘贴到这里，自动翻译 ✨"
              rows={5}
            />
            <div className="actions">
              <button className="btn btn-primary" onClick={doTranslate} disabled={loading}>
                {loading ? '翻译中...' : '✨ 翻译'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setInputText(''); setPairs([]); setError(''); stopTTS(); }}>清空</button>
            </div>
          </div>

          {(loading || pairs.length > 0 || error) && (
            <div className="result-card">
              <div className="result-header">
                <span className="result-title">双语对照</span>
                {pairs.length > 0 && (
                  <div className="tts-controls">
                    <select className="speed-select" value={ttsSpeed} onChange={e => setTtsSpeed(parseFloat(e.target.value))}>
                      <option value={0.7}>慢速</option>
                      <option value={1}>正常</option>
                      <option value={1.3}>快速</option>
                    </select>
                    <button className={`tts-btn${ttsPlaying?' playing':''}`} onClick={toggleTTS}>{ttsPlaying ? '⏸' : '▶'}</button>
                    <button className="tts-btn" onClick={stopTTS}>⏹</button>
                  </div>
                )}
              </div>
              {loading && <div className="loading"><div className="spinner"></div><div>正在翻译中...</div></div>}
              {error && <div className="error-box">❌ 翻译失败：{error}</div>}
              {!loading && pairs.length > 0 && (
                <div className="word-pairs" onClick={() => setTooltipIdx(null)}>
                  {pairs.map((pair, i) => {
                    const saved = isSaved(pair.en);
                    return (
                      <span key={i} style={{display:'inline-flex',alignItems:'flex-end',gap:'2px'}}>
                        <span
                          className={`word-pair${highlightIdx===i?' hl':''}${ttsIdx===i?' tts-hl':''}${saved?' saved':''}`}
                          onMouseEnter={() => setHighlightIdx(i)}
                          onMouseLeave={() => setHighlightIdx(null)}
                          onClick={e => { e.stopPropagation(); setTooltipIdx(tooltipIdx===i?null:i); }}
                        >
                          {tooltipIdx === i && (
                            <span className="tooltip">
                              <span style={{fontWeight:600,fontSize:13}}>{pair.en} → {pair.zh}</span>
                              <span className="tip-actions">
                                <button className={`tip-btn${saved?' saved':''}`} onClick={e=>{e.stopPropagation();toggleSave(i)}}>{saved?'⭐ 已收藏':'☆ 收藏'}</button>
                                <button className="tip-btn" onClick={e=>{e.stopPropagation();navigator.clipboard?.writeText(pair.en);showToast('已复制');setTooltipIdx(null);}}>复制</button>
                              </span>
                            </span>
                          )}
                          <span className="word-en">{pair.en}</span>
                          <span className="word-zh">{pair.zh}</span>
                        </span>
                        {pair.punct && <span className="punct">{pair.punct}</span>}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* VOCAB */}
      {tab === 'vocab' && (
        <div className="page">
          <div className="page-title">我的单词本</div>
          <div className="page-subtitle">收藏的单词，可加入「走路听」复习</div>
          <div className="vocab-toolbar">
            <button className="btn btn-primary" onClick={addAllToWalk}>🎧 全部加入走路听</button>
            <button className="btn btn-ghost" style={{color:'#EF4444',borderColor:'#FCA5A5'}} onClick={() => { if(confirm(`确定清空全部 ${vocab.length} 个收藏单词吗？`)){saveVocab([]);saveWalkQueue([]);} }}>🗑 清空收藏</button>
            <span className="vocab-count">共 {vocab.length} 个单词</span>
          </div>
          {vocab.length === 0 ? (
            <div className="empty"><div className="empty-icon">📭</div><div className="empty-title">还没有收藏的单词</div><div>在翻译页面点击单词，选择 ☆ 收藏</div></div>
          ) : (
            <div className="vocab-list">
              {vocab.map((v, i) => (
                <div key={i} className={`vocab-item${inQueue(v.word)?' in-queue':''}`}>
                  <span className="vocab-word">{v.word}</span>
                  <span className="vocab-zh">{v.zh}</span>
                  <span className="vocab-date">{new Date(v.addedAt).toLocaleDateString('zh-CN',{month:'short',day:'numeric'})}</span>
                  <div className="vocab-actions">
                    <button className={`icon-btn${inQueue(v.word)?' active':''}`} onClick={() => toggleWalkQueue(i)} title={inQueue(v.word)?'从走路听移除':'加入走路听'}>🎧</button>
                    <button className="icon-btn" onClick={() => { const u=new SpeechSynthesisUtterance(v.word);u.lang='en-US';window.speechSynthesis.cancel();window.speechSynthesis.speak(u); }} title="朗读">🔊</button>
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
          <div className="walk-wrap">
            <div className="page-title" style={{textAlign:'center'}}>🎧 走路听</div>
            <div className="page-subtitle" style={{textAlign:'center',marginBottom:28}}>英文 → 中文，循环播报，解放双眼</div>
            <div className="walk-card">
              {walkQueue.length === 0 ? (
                <div>
                  <div style={{fontSize:48,marginBottom:16}}>🎒</div>
                  <div style={{fontSize:16,fontWeight:600,color:'var(--text2)',marginBottom:8}}>播放列表是空的</div>
                  <div style={{fontSize:13,color:'var(--text3)',marginBottom:20}}>去「收藏库」把单词加入走路听</div>
                  <button className="btn btn-primary" onClick={() => setTab('vocab')}>去收藏库 →</button>
                </div>
              ) : (
                <>
                  <div className="walk-progress">第 {walkIdx + 1} / 共 {walkQueue.length} 词</div>
                  <div className="walk-en">{currentWalkItem?.word || '—'}</div>
                  <div className="walk-zh">{currentWalkItem?.zh || '—'}</div>
                  <div className="walk-controls">
                    <button className="walk-btn" onClick={walkPrev}>⏮</button>
                    <button className="walk-play" onClick={toggleWalk}>{walkPlaying ? '⏸' : '▶'}</button>
                    <button className="walk-btn" onClick={walkNext}>⏭</button>
                  </div>
                  <div className="walk-status">
                    <span className={`status-dot${walkPhase==='en'?' en':walkPhase==='zh'?' zh':walkPhase==='pause'?' pause':''}`}></span>
                    <span>{walkPhase==='en'?`英文：${currentWalkItem?.word}`:walkPhase==='zh'?`中文：${currentWalkItem?.zh}`:walkPhase==='pause'?'停顿中...':'准备就绪'}</span>
                  </div>
                  <div className="walk-speed">
                    停顿时长：
                    <select value={walkPause} onChange={e => setWalkPause(parseInt(e.target.value))}>
                      <option value={800}>短 (0.8s)</option>
                      <option value={1200}>中 (1.2s)</option>
                      <option value={2000}>长 (2s)</option>
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
