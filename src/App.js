import { useState, useCallback, useMemo, useEffect } from 'react';

const API_KEY = 'AIzaSyCR7aNXAArVk2fS9mr3eGQRoPyQbG6wT6E';
const DAILY_QUOTA = 10000;
const QUOTA_KEY = 'yt_quota_v2';
const COPIED_IDS_KEY = 'yt_copied_ids';

const QUOTA_COSTS = { search: 100, videos: 1, channels: 1 };

const REGIONS = [
	{ code: 'US', label: '🇺🇸 USA' }, { code: 'GB', label: '🇬🇧 UK' },
	{ code: 'CA', label: '🇨🇦 Canada' }, { code: 'AU', label: '🇦🇺 Australia' },
	{ code: 'IN', label: '🇮🇳 India' }, { code: 'BD', label: '🇧🇩 Bangladesh' },
	{ code: 'PK', label: '🇵🇰 Pakistan' }, { code: 'DE', label: '🇩🇪 Germany' },
	{ code: 'FR', label: '🇫🇷 France' }, { code: 'JP', label: '🇯🇵 Japan' },
	{ code: 'KR', label: '🇰🇷 South Korea' }, { code: 'BR', label: '🇧🇷 Brazil' },
	{ code: 'MX', label: '🇲🇽 Mexico' }, { code: 'NG', label: '🇳🇬 Nigeria' },
	{ code: 'EG', label: '🇪🇬 Egypt' }, { code: 'SA', label: '🇸🇦 Saudi Arabia' },
	{ code: 'ID', label: '🇮🇩 Indonesia' }, { code: 'PH', label: '🇵🇭 Philippines' },
	{ code: 'TR', label: '🇹🇷 Turkey' }, { code: 'RU', label: '🇷🇺 Russia' },
];

const fmt = (n) => {
	if (n < 0) return 'N/A';
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
	if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
	return String(n);
};
const fmtK = fmt;
const getTodayKey = () => new Date().toISOString().slice(0, 10);

const loadQuotaFromStorage = async () => {
	try {
		const r = await window.storage.get(QUOTA_KEY);
		if (r) { const s = JSON.parse(r.value); if (s.date === getTodayKey()) return s.used || 0; }
	} catch {}
	return 0;
};
const saveQuotaToStorage = async (used) => {
	try { await window.storage.set(QUOTA_KEY, JSON.stringify({ date: getTodayKey(), used })); } catch {}
};
const loadCopiedIds = async () => {
	try { const r = await window.storage.get(COPIED_IDS_KEY); if (r) return new Set(JSON.parse(r.value)); } catch {}
	return new Set();
};
const saveCopiedIds = async (set) => {
	try { await window.storage.set(COPIED_IDS_KEY, JSON.stringify([...set])); } catch {}
};

const getResetSeconds = () => {
	const m = new Date(); m.setHours(24, 0, 0, 0); return Math.floor((m - new Date()) / 1000);
};
const fmtCountdown = (s) => `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

const copyRich = async (htmlLines, plainLines) => {
	const html = htmlLines.join('<br>'), plain = plainLines.join('\n');
	try {
		await navigator.clipboard.write([new ClipboardItem({
			'text/html': new Blob([html], { type: 'text/html' }),
			'text/plain': new Blob([plain], { type: 'text/plain' }),
		})]);
	} catch {
		const el = document.createElement('textarea');
		el.value = plain; document.body.appendChild(el); el.select();
		document.execCommand('copy'); document.body.removeChild(el);
	}
};
const copyText = async (text) => {
	try { await navigator.clipboard.writeText(text); } catch {
		const el = document.createElement('textarea');
		el.value = text; document.body.appendChild(el); el.select();
		document.execCommand('copy'); document.body.removeChild(el);
	}
};

const makeLines = (v) => {
	const url = `https://www.youtube.com/watch?v=${v.id}`;
	return {
		html: `<a href="${url}">${v.title}</a> - ${fmtK(v.subscriberCount)} subscribers - ${fmtK(v.viewCount)} views`,
		plain: `${v.title} (${url}) - ${fmtK(v.subscriberCount)} subscribers - ${fmtK(v.viewCount)} views`,
	};
};

const exportToCSV = (results) => {
	const headers = ['Title (linked)', 'URL', 'Channel', 'Channel URL', 'Subscribers', 'Views', 'Source Keyword'];
	const rows = results.map((v) => {
		const url = `https://www.youtube.com/watch?v=${v.id}`;
		const chUrl = `https://www.youtube.com/channel/${v.channelId}`;
		const esc = (s) => `"${String(s||'').replace(/"/g,'""')}"`;
		const hl = `"=HYPERLINK(""${url}"",""${String(v.title).replace(/"/g,"'")}"")"`;
		return [hl, esc(url), esc(v.channelTitle), esc(chUrl), esc(fmtK(v.subscriberCount)), esc(fmtK(v.viewCount)), esc(v.sourceKeyword||'')].join(',');
	});
	const blob = new Blob(['\uFEFF' + [headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob); a.download = `yt-filter-results-${getTodayKey()}.csv`;
	document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

const getMatchScore = (v, q, kw) => {
	const all = [...q.split(/\s+/), ...kw.split(',')].map(k=>k.trim().toLowerCase()).filter(Boolean);
	if (!all.length) return 0;
	const hay = (v.title + ' ' + (v.tags||[]).join(' ')).toLowerCase();
	return all.filter(k=>hay.includes(k)).length / all.length;
};

const CHANNEL_SIZE_OPTIONS = [
	{ key:'small',  label:'Small',  icon:'🌱', min:0,      max:10_000,
	  bgD:'#0c2a1a', txtD:'#34d399', brdD:'#165534', bgL:'#ecfdf5', txtL:'#065f46', brdL:'#a7f3d0' },
	{ key:'medium', label:'Medium', icon:'📈', min:10_000, max:50_000,
	  bgD:'#1a1507', txtD:'#f59e0b', brdD:'#55440a', bgL:'#fffbeb', txtL:'#92400e', brdL:'#fde68a' },
	{ key:'big',    label:'Big',    icon:'🏆', min:50_000, max:Infinity,
	  bgD:'#1a0a2e', txtD:'#a78bfa', brdD:'#4c1d95', bgL:'#f5f3ff', txtL:'#5b21b6', brdL:'#ddd6fe' },
];
const getSizeKey = (s) => { if (s<0) return null; if (s<10000) return 'small'; if (s<50000) return 'medium'; return 'big'; };

const DARK = {
	bg:'#07070f', surface:'#0d0d1a', surface2:'#0b0b16', surface4:'#111127',
	border:'#1e1e35', border2:'#1c1c2e', border3:'#2a2a40',
	text:'#e0e0ff', textDim:'#44445a', textMid:'#555575', textRow:'#e4e4f0',
	accent:'#6366f1', accent2:'#a78bfa', accent3:'#60a5fa', accent4:'#34d399', accentAmber:'#f59e0b',
	headerBg:'linear-gradient(135deg,#1a0533,#0f0f2e)',
	inputBg:'#0f0f1c', selectBg:'#0f0f1c',
	rowEven:'#0b0b16', rowOdd:'#0d0d1a', rowHover:'#13132a',
	rowHL:'rgba(251,191,36,0.08)', rowHLBorder:'rgba(251,191,36,0.35)', rowHLHover:'rgba(251,191,36,0.14)',
	pillHL:'#78350f', pillHLText:'#fbbf24',
	quotaRing:'#1e1e35', quotaBg:'#0f0f1c', tagBg:'#1e1b4b', tagText:'#a78bfa',
	btnSearch:'linear-gradient(135deg,#6d28d9,#4f46e5)', btnDis:'#1e1e3a', btnDisTxt:'#555',
	btnCopy:'#18181b', btnCopyBorder:'#3f3f46', btnCopyTxt:'#a1a1aa', btnCopied:'#16a34a',
	btnExport:'#0f2e1a', btnExportTxt:'#34d399', btnExportBorder:'#166534',
	btnMore:'#111127', btnMoreTxt:'#6366f1', btnMoreBorder:'#2a2a4a',
	tabActive:'linear-gradient(135deg,#6d28d9,#4f46e5)', tabActiveTxt:'#fff', tabInactiveTxt:'#44445a', tabBg:'#0a0a15',
	errBg:'#1a0505', errBorder:'#7f1d1d', errTxt:'#fca5a5',
	lViews:'#60a5fa', lSubs:'#a78bfa', lKw:'#34d399', lSearch:'#6366f1',
	copiedRowBg:'rgba(22,163,74,0.07)', chCopyBg:'#0d1a2a', chCopyBrd:'#1e3a5f', chCopyTxt:'#60a5fa',
};
const LIGHT = {
	bg:'#f0f2fa', surface:'#ffffff', surface2:'#f8f9fe', surface4:'#e8eaf6',
	border:'#d0d4f0', border2:'#dde0f5', border3:'#c4c8e8',
	text:'#1a1a3a', textDim:'#7880b0', textMid:'#9096c0', textRow:'#1a1a3a',
	accent:'#4f46e5', accent2:'#7c3aed', accent3:'#2563eb', accent4:'#059669', accentAmber:'#d97706',
	headerBg:'linear-gradient(135deg,#ede9fe,#e0e7ff)',
	inputBg:'#f8f9fe', selectBg:'#f8f9fe',
	rowEven:'#f8f9fe', rowOdd:'#ffffff', rowHover:'#ede9fe',
	rowHL:'rgba(217,119,6,0.07)', rowHLBorder:'rgba(217,119,6,0.3)', rowHLHover:'rgba(217,119,6,0.12)',
	pillHL:'#fef3c7', pillHLText:'#92400e',
	quotaRing:'#e0e4f5', quotaBg:'#f0f2fa', tagBg:'#ede9fe', tagText:'#6d28d9',
	btnSearch:'linear-gradient(135deg,#6d28d9,#4f46e5)', btnDis:'#e0e4f5', btnDisTxt:'#aab0d0',
	btnCopy:'#f0f2fa', btnCopyBorder:'#c4c8e8', btnCopyTxt:'#7880b0', btnCopied:'#059669',
	btnExport:'#ecfdf5', btnExportTxt:'#065f46', btnExportBorder:'#a7f3d0',
	btnMore:'#f0f2fa', btnMoreTxt:'#4f46e5', btnMoreBorder:'#c4c8e8',
	tabActive:'linear-gradient(135deg,#6d28d9,#4f46e5)', tabActiveTxt:'#fff', tabInactiveTxt:'#9096c0', tabBg:'#eef0fb',
	errBg:'#fff1f2', errBorder:'#fecdd3', errTxt:'#be123c',
	lViews:'#2563eb', lSubs:'#7c3aed', lKw:'#059669', lSearch:'#4f46e5',
	copiedRowBg:'rgba(5,150,105,0.06)', chCopyBg:'#eff6ff', chCopyBrd:'#bfdbfe', chCopyTxt:'#1d4ed8',
};

function QuotaCircle({ used, total, T }) {
	const pct = Math.min(used/total,1), remaining = Math.max(total-used,0);
	const r=54, circ=2*Math.PI*r, dash=circ*(1-pct);
	const color = pct<0.5?'#22c55e':pct<0.8?'#f59e0b':'#ef4444';
	const [cd, setCd] = useState(getResetSeconds());
	useEffect(() => { const t=setInterval(()=>setCd(getResetSeconds()),1000); return ()=>clearInterval(t); }, []);
	return (
		<div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
			<div style={{ position:'relative', width:130, height:130 }}>
				<svg width='130' height='130' style={{ transform:'rotate(-90deg)' }}>
					<circle cx='65' cy='65' r={r} fill='none' stroke={T.quotaRing} strokeWidth='10' />
					<circle cx='65' cy='65' r={r} fill='none' stroke={color} strokeWidth='10' strokeDasharray={circ} strokeDashoffset={dash} strokeLinecap='round' style={{ transition:'stroke-dashoffset .6s ease,stroke .4s' }} />
				</svg>
				<div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:1 }}>
					<span style={{ color, fontSize:22, fontWeight:800, fontFamily:"'JetBrains Mono',monospace", lineHeight:1 }}>{remaining.toLocaleString()}</span>
					<span style={{ color:T.textDim, fontSize:10 }}>left</span>
				</div>
			</div>
			<div style={{ textAlign:'center' }}>
				<div style={{ color:T.textDim, fontSize:10, marginBottom:3 }}>{used.toLocaleString()} / {total.toLocaleString()} used</div>
				<div style={{ width:120, height:4, background:T.quotaRing, borderRadius:4, overflow:'hidden' }}>
					<div style={{ width:`${pct*100}%`, height:'100%', background:color, borderRadius:4, transition:'width .5s' }} />
				</div>
			</div>
			<div style={{ background:T.quotaBg, border:`1px solid ${T.border}`, borderRadius:8, padding:'6px 12px', textAlign:'center', width:'100%', boxSizing:'border-box' }}>
				<div style={{ color:T.textDim, fontSize:9, letterSpacing:1, marginBottom:2 }}>RESETS IN</div>
				<div style={{ color:T.accent, fontSize:14, fontWeight:700, fontFamily:"'JetBrains Mono',monospace" }}>{fmtCountdown(cd)}</div>
			</div>
			<div style={{ width:'100%', background:T.quotaBg, border:`1px solid ${T.border}`, borderRadius:8, padding:'10px 12px' }}>
				<div style={{ color:T.textDim, fontSize:9, letterSpacing:1, marginBottom:6 }}>COST PER SEARCH</div>
				{[['Keyword search','~102 pts'],['Video URL lookup','~1–2 pts'],['Bulk URL (per video)','~2 pts'],['Load More','~102 pts']].map(([l,c])=>(
					<div key={l} style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
						<span style={{ color:T.textMid, fontSize:10 }}>{l}</span>
						<span style={{ color:T.accent2, fontSize:10, fontFamily:"'JetBrains Mono',monospace" }}>{c}</span>
					</div>
				))}
			</div>
		</div>
	);
}

function RowCopyBtn({ v, T, copiedIds, onCopy }) {
	const isCopied = copiedIds.has(v.id);
	const [flash, setFlash] = useState(false);
	const handle = async () => {
		const { html, plain } = makeLines(v);
		await copyRich([html], [plain]);
		onCopy(v.id); setFlash(true); setTimeout(()=>setFlash(false), 700);
	};
	return (
		<button onClick={handle} style={{
			background: isCopied ? (flash?'#16a34a':'#16a34a18') : T.btnCopy,
			color: isCopied ? (flash?'#fff':'#16a34a') : T.btnCopyTxt,
			border: `1.5px solid ${isCopied?'#16a34a':T.btnCopyBorder}`,
			borderRadius:6, padding:'4px 10px', fontSize:11, cursor:'pointer',
			transition:'all .15s', whiteSpace:'nowrap', fontFamily:"'JetBrains Mono',monospace",
			display:'flex', alignItems:'center', gap:4,
		}}>
			{isCopied?'✓':'📋'} {isCopied?'Copied':'Copy'}
		</button>
	);
}

function ChannelCopyBtn({ v, T }) {
	const [flash, setFlash] = useState(false);
	const chUrl = `https://www.youtube.com/channel/${v.channelId}`;
	const handle = async () => { await copyText(chUrl); setFlash(true); setTimeout(()=>setFlash(false),1400); };
	return (
		<button onClick={handle} title={`Copy: ${chUrl}`} style={{
			background: flash ? T.accent3+'22' : T.chCopyBg,
			color: flash ? T.accent3 : T.chCopyTxt,
			border: `1.5px solid ${flash?T.accent3:T.chCopyBrd}`,
			borderRadius:6, padding:'4px 10px', fontSize:11, cursor:'pointer',
			transition:'all .15s', whiteSpace:'nowrap', fontFamily:"'JetBrains Mono',monospace",
			display:'flex', alignItems:'center', gap:4,
		}}>
			{flash?'✓':'🔗'} {flash?'Copied':'Ch.'}
		</button>
	);
}

function SortBtn({ label, field, sortState, onSort, T, isDark }) {
	const active = sortState.field===field, dir = active?sortState.dir:null;
	return (
		<button onClick={()=>onSort(field)} style={{
			background: active?(isDark?'#1e1b4b':'#ede9fe'):'transparent',
			color: active?T.accent2:T.textDim, border:`1px solid ${active?T.accent2:T.border3}`,
			borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer',
			fontFamily:"'JetBrains Mono',monospace", display:'flex', alignItems:'center', gap:4,
		}}>
			{label} <span style={{ fontSize:10 }}>{dir==='desc'?'↓':dir==='asc'?'↑':'↕'}</span>
		</button>
	);
}

function MatchScoreBadge({ score }) {
	if (score<=0) return null;
	const pct = Math.round(score*100);
	const color = pct>=75?'#22c55e':pct>=40?'#f59e0b':'#94a3b8';
	return <span style={{ background:color+'22', color, border:`1px solid ${color}55`, fontSize:9, padding:'1px 6px', borderRadius:4, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", whiteSpace:'nowrap', flexShrink:0 }}>{pct}% match</span>;
}

function SizeBadge({ subs, isDark }) {
	const key = getSizeKey(subs);
	if (!key) return null;
	const o = CHANNEL_SIZE_OPTIONS.find(x=>x.key===key);
	return <span style={{ background:isDark?o.bgD:o.bgL, color:isDark?o.txtD:o.txtL, border:`1px solid ${isDark?o.brdD:o.brdL}`, fontSize:9, padding:'1px 6px', borderRadius:4, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", whiteSpace:'nowrap', flexShrink:0 }}>{o.icon} {o.label}</span>;
}

function VideoRow({ v, idx, isHighlighted, matchScore, T, isDark, copiedIds, onCopy }) {
	const url = `https://www.youtube.com/watch?v=${v.id}`;
	const isCopied = copiedIds.has(v.id);
	const baseBg = isCopied ? T.copiedRowBg : (idx%2===0?T.rowEven:T.rowOdd);
	const hlBg = isHighlighted ? T.rowHL : baseBg;
	return (
		<div
			style={{ display:'grid', gridTemplateColumns:'32px 1fr 130px 120px 90px 90px 72px', alignItems:'center', gap:10, padding:'11px 16px', borderBottom:`1px solid ${T.border2}`, borderLeft:isCopied?'3px solid #16a34a88':isHighlighted?`3px solid ${T.rowHLBorder}`:'3px solid transparent', background:hlBg, transition:'background .1s' }}
			onMouseEnter={e=>e.currentTarget.style.background=isHighlighted?T.rowHLHover:T.rowHover}
			onMouseLeave={e=>e.currentTarget.style.background=hlBg}
		>
			<span style={{ color:T.textDim, fontSize:12, fontFamily:'monospace', textAlign:'center' }}>{idx+1}</span>
			<div style={{ minWidth:0 }}>
				<div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3, flexWrap:'wrap' }}>
					{isHighlighted && <span style={{ background:T.pillHL, color:T.pillHLText, fontSize:9, padding:'1px 6px', borderRadius:4, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", whiteSpace:'nowrap', flexShrink:0 }}>✦ MATCH</span>}
					{isCopied && <span style={{ background:'#16a34a1a', color:'#16a34a', border:'1px solid #16a34a55', fontSize:9, padding:'1px 6px', borderRadius:4, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", whiteSpace:'nowrap', flexShrink:0 }}>✓ COPIED</span>}
					<MatchScoreBadge score={matchScore} />
					<a href={url} target='_blank' rel='noreferrer' style={{ color:T.textRow, fontWeight:600, fontSize:13, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', textDecoration:'none', display:'block' }} title={v.title} onMouseEnter={e=>e.currentTarget.style.color=T.accent2} onMouseLeave={e=>e.currentTarget.style.color=T.textRow}>{v.title}</a>
				</div>
				<div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
					<div style={{ color:T.accent, fontSize:11, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>📺 {v.channelTitle}</div>
					<SizeBadge subs={v.subscriberCount} isDark={isDark} />
					{v.sourceKeyword && <span style={{ background:T.tagBg, color:T.tagText, fontSize:9, padding:'1px 6px', borderRadius:4, fontFamily:"'JetBrains Mono',monospace", whiteSpace:'nowrap' }}>🔠 {v.sourceKeyword}</span>}
				</div>
			</div>
			<div style={{ textAlign:'right' }}>
				<div style={{ color:T.accent2, fontSize:12, fontWeight:600 }}>{fmt(v.subscriberCount)}</div>
				<div style={{ color:T.textDim, fontSize:10 }}>subscribers</div>
			</div>
			<div style={{ textAlign:'right' }}>
				<div style={{ color:T.accent3, fontSize:12, fontWeight:600 }}>{fmt(v.viewCount)}</div>
				<div style={{ color:T.textDim, fontSize:10 }}>views</div>
			</div>
			<div style={{ display:'flex', justifyContent:'center' }}><RowCopyBtn v={v} T={T} copiedIds={copiedIds} onCopy={onCopy} /></div>
			<div style={{ display:'flex', justifyContent:'center' }}>
				<a href={url} target='_blank' rel='noreferrer' style={{ background:'#dc2626', color:'#fff', borderRadius:6, padding:'4px 12px', fontSize:11, textDecoration:'none', fontWeight:700, whiteSpace:'nowrap', fontFamily:"'JetBrains Mono',monospace" }}>▶ Watch</a>
			</div>
			<div style={{ display:'flex', justifyContent:'center' }}><ChannelCopyBtn v={v} T={T} /></div>
		</div>
	);
}

// Multi-select channel size filter
function ChannelSizeFilter({ selected, onToggle, T, isDark, counts }) {
	const allSelected = selected.size === 0;
	return (
		<div>
			<label style={{ color:T.accent4, fontSize:10, fontWeight:700, display:'block', marginBottom:7, letterSpacing:1 }}>
				📡 CHANNEL SIZE <span style={{ color:T.textMid, fontWeight:400, fontSize:10 }}>(multiple select)</span>
			</label>
			<div style={{ display:'flex', gap:7, flexWrap:'wrap', alignItems:'center' }}>
				<button onClick={()=>onToggle(null)} style={{
					background: allSelected?(isDark?'#1e1b4b':'#ede9fe'):'transparent',
					color: allSelected?T.accent2:T.textDim,
					border:`1.5px solid ${allSelected?T.accent2:T.border3}`,
					borderRadius:20, padding:'5px 14px', fontSize:11, cursor:'pointer', fontFamily:'inherit',
					fontWeight:allSelected?700:400, transition:'all .15s',
					boxShadow:allSelected?`0 0 8px ${T.accent2}44`:'none',
					display:'flex', alignItems:'center', gap:6,
				}}>
					🌐 All
					<span style={{ background:allSelected?T.accent2:T.border3, color:allSelected?(isDark?'#0d0d1a':'#fff'):T.textDim, borderRadius:10, padding:'0 6px', fontSize:9, fontFamily:"'JetBrains Mono',monospace", fontWeight:700, minWidth:16, textAlign:'center' }}>{counts.total||0}</span>
				</button>
				{CHANNEL_SIZE_OPTIONS.map(o => {
					const active = selected.has(o.key);
					const bg=isDark?o.bgD:o.bgL, txt=isDark?o.txtD:o.txtL, brd=isDark?o.brdD:o.brdL;
					const cnt = counts[o.key]||0;
					return (
						<button key={o.key} onClick={()=>onToggle(o.key)} style={{
							background: active?bg:'transparent', color: active?txt:T.textDim,
							border:`1.5px solid ${active?brd:T.border3}`,
							borderRadius:20, padding:'5px 14px', fontSize:11, cursor:'pointer', fontFamily:'inherit',
							fontWeight:active?700:400, transition:'all .15s', display:'flex', alignItems:'center', gap:6,
							boxShadow:active?`0 0 8px ${brd}66`:'none',
						}}>
							{o.icon} {o.label}
							<span style={{ background:active?brd:T.border3, color:active?bg:T.textDim, borderRadius:10, padding:'0 6px', fontSize:9, fontFamily:"'JetBrains Mono',monospace", fontWeight:700, minWidth:16, textAlign:'center' }}>{cnt}</span>
						</button>
					);
				})}
			</div>
			<div style={{ marginTop:6, color:T.textMid, fontSize:9 }}>🌱 Small: 0–10K · 📈 Medium: 10K–50K · 🏆 Big: 50K+ · একাধিক size একসাথে select করা যাবে</div>
		</div>
	);
}

function MatchSortControl({ value, onChange, T, isDark }) {
	const opts = [{val:null,label:'Default',icon:'—'},{val:'desc',label:'Best ↓',icon:'✦'},{val:'asc',label:'Worst ↑',icon:'◇'}];
	return (
		<div style={{ display:'flex', alignItems:'center', gap:5 }}>
			<span style={{ color:T.textDim, fontSize:11 }}>Match:</span>
			{opts.map(({val,label,icon})=>{
				const active=value===val;
				return <button key={String(val)} onClick={()=>onChange(val)} style={{ background:active?(isDark?'#1e1b4b':'#ede9fe'):'transparent', color:active?T.accent2:T.textDim, border:`1px solid ${active?T.accent2:T.border3}`, borderRadius:6, padding:'3px 9px', fontSize:11, cursor:'pointer', fontFamily:"'JetBrains Mono',monospace", transition:'all .15s' }}>{icon} {label}</button>;
			})}
		</div>
	);
}

export default function App() {
	const [darkMode, setDarkMode] = useState(false); // default: light
	const T = darkMode ? DARK : LIGHT;
	const isDark = darkMode;

	const inputSt = { background:T.inputBg, border:`1px solid ${T.border3}`, borderRadius:8, color:T.text, padding:'8px 12px', fontSize:13, outline:'none', fontFamily:'inherit', width:'100%', boxSizing:'border-box' };
	const numSt = { ...inputSt, width:100 };

	const [query, setQuery] = useState('');
	const [videoUrl, setVideoUrl] = useState('');
	const [bulkUrls, setBulkUrls] = useState('');
	const [bulkKeywords, setBulkKeywords] = useState('');
	const [activeTab, setActiveTab] = useState('keyword');
	const [region, setRegion] = useState('US');
	const [minViews, setMinViews] = useState('2000');   // default 2k
	const [maxViews, setMaxViews] = useState('');
	const [minSubs, setMinSubs] = useState('1000');     // default 1k
	const [maxSubs, setMaxSubs] = useState('');
	const [keywords, setKeywords] = useState('');
	const [channelSizeSelected, setChannelSizeSelected] = useState(new Set()); // empty = all
	const [rawResults, setRawResults] = useState([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [nextPageToken, setNextPageToken] = useState('');
	const [searched, setSearched] = useState(false);
	const [allCopied, setAllCopied] = useState(false);
	const [sort, setSort] = useState({ field:null, dir:null });
	const [matchSort, setMatchSort] = useState(null);
	const [quotaUsed, setQuotaUsed] = useState(0);
	const [quotaLoaded, setQuotaLoaded] = useState(false);
	const [bulkProgress, setBulkProgress] = useState({ current:0, total:0 });
	const [copiedIds, setCopiedIds] = useState(new Set());

	useEffect(() => {
		loadQuotaFromStorage().then(v=>{setQuotaUsed(v);setQuotaLoaded(true);});
		loadCopiedIds().then(ids=>setCopiedIds(ids));
	}, []);

	const addQuota = (pts) => setQuotaUsed(prev=>{const n=prev+pts;saveQuotaToStorage(n);return n;});

	const handleCopyId = useCallback((id) => {
		setCopiedIds(prev=>{const n=new Set(prev);n.add(id);saveCopiedIds(n);return n;});
	}, []);

	const handleSort = (field) => setSort(prev=>{
		if (prev.field!==field) return {field,dir:'desc'};
		if (prev.dir==='desc') return {field,dir:'asc'};
		return {field:null,dir:null};
	});

	const handleSizeToggle = (key) => {
		if (key===null) { setChannelSizeSelected(new Set()); return; }
		setChannelSizeSelected(prev=>{const n=new Set(prev);n.has(key)?n.delete(key):n.add(key);return n;});
	};

	const matchScores = useMemo(()=>{
		const m={};
		rawResults.forEach(v=>{m[v.id]=getMatchScore(v,query,keywords);});
		return m;
	},[rawResults,query,keywords]);

	const sizeCounts = useMemo(()=>{
		const c={total:0,small:0,medium:0,big:0};
		rawResults.forEach(v=>{const k=getSizeKey(v.subscriberCount);if(k)c[k]++;c.total++;});
		return c;
	},[rawResults]);

	const results = useMemo(()=>{
		const kwList=keywords.split(',').map(k=>k.trim().toLowerCase()).filter(Boolean);
		let arr=rawResults.filter(v=>{
			if (minViews!==''&&v.viewCount<parseInt(minViews)) return false;
			if (maxViews!==''&&v.viewCount>parseInt(maxViews)) return false;
			if (minSubs!==''&&v.subscriberCount<parseInt(minSubs)) return false;
			if (maxSubs!==''&&v.subscriberCount>parseInt(maxSubs)) return false;
			if (kwList.length>0){const hay=(v.title+' '+v.tags.join(' ')).toLowerCase();if(!kwList.some(k=>hay.includes(k)))return false;}
			if (channelSizeSelected.size>0){const sk=getSizeKey(v.subscriberCount);if(!sk||!channelSizeSelected.has(sk))return false;}
			return true;
		});
		if (matchSort) arr=[...arr].sort((a,b)=>matchSort==='desc'?(matchScores[b.id]??0)-(matchScores[a.id]??0):(matchScores[a.id]??0)-(matchScores[b.id]??0));
		else if (sort.field){const k=sort.field==='views'?'viewCount':'subscriberCount';arr=[...arr].sort((a,b)=>sort.dir==='desc'?b[k]-a[k]:a[k]-b[k]);}
		return arr;
	},[rawResults,minViews,maxViews,minSubs,maxSubs,keywords,channelSizeSelected,sort,matchSort,matchScores]);

	const highlightedIds = useMemo(()=>{const s=new Set();results.forEach(v=>{if((matchScores[v.id]??0)>=0.5)s.add(v.id);});return s;},[results,matchScores]);

	const extractVideoId = (input) => {
		input=input.trim();
		const m=input.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
		if(m)return m[1];
		if(/^[\w-]{11}$/.test(input))return input;
		return null;
	};

	const fetchChannelSubs = async (items, qRef) => {
		const cids=[...new Set(items.map(i=>i.snippet.channelId))];
		const sub={};
		for(let j=0;j<cids.length;j+=50){
			try{
				const r=await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${cids.slice(j,j+50).join(',')}&key=${API_KEY}`);
				const d=await r.json();
				(d.items||[]).forEach(x=>{sub[x.id]=parseInt(x.statistics?.subscriberCount??-1);});
				qRef.cost+=QUOTA_COSTS.channels;
			}catch{}
		}
		return sub;
	};

	const doBulkSearch = useCallback(async()=>{
		const ids=bulkUrls.split('\n').map(l=>l.trim()).filter(Boolean).map(extractVideoId).filter(Boolean);
		if(!ids.length){setError('⚠️ Valid YouTube URL বা Video ID পাওয়া যায়নি।');return;}
		setLoading(true);setError('');setRawResults([]);setBulkProgress({current:0,total:ids.length});
		try{
			const all=[],q={cost:0};
			for(let i=0;i<ids.length;i+=50){
				const batch=ids.slice(i,i+50);
				const dr=await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${batch.join(',')}&key=${API_KEY}`);
				const dd=await dr.json();if(dd.error)throw new Error(dd.error.message);
				q.cost+=QUOTA_COSTS.videos;
				const sub=await fetchChannelSubs(dd.items||[],q);
				(dd.items||[]).forEach(x=>all.push({id:x.id,title:x.snippet.title,channelTitle:x.snippet.channelTitle,channelId:x.snippet.channelId,viewCount:parseInt(x.statistics?.viewCount??-1),subscriberCount:sub[x.snippet.channelId]??-1,tags:x.snippet.tags??[]}));
				setBulkProgress({current:Math.min(i+50,ids.length),total:ids.length});
			}
			addQuota(q.cost);setRawResults(all);setSearched(true);
		}catch(e){setError('❌ '+e.message);}
		finally{setLoading(false);setBulkProgress({current:0,total:0});}
	},[bulkUrls]);

	const doBulkKeywordSearch = useCallback(async()=>{
		const kws=bulkKeywords.split('\n').map(l=>l.trim()).filter(Boolean);
		if(!kws.length){setError('⚠️ কমপক্ষে একটা keyword দিন।');return;}
		setLoading(true);setError('');setRawResults([]);setBulkProgress({current:0,total:kws.length});
		try{
			const all=[],seen=new Set(),q={cost:0};
			for(let ki=0;ki<kws.length;ki++){
				const kw=kws[ki];
				try{
					const sr=await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=20&q=${encodeURIComponent(kw)}&regionCode=${region}&key=${API_KEY}`);
					const sd=await sr.json();if(sd.error)throw new Error(sd.error.message);
					q.cost+=QUOTA_COSTS.search;
					const ids=(sd.items||[]).map(i=>i.id.videoId).filter(id=>!seen.has(id));
					if(ids.length){
						const dr=await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids.join(',')}&key=${API_KEY}`);
						const dd=await dr.json();if(dd.error)throw new Error(dd.error.message);
						q.cost+=QUOTA_COSTS.videos;
						const sub=await fetchChannelSubs(dd.items||[],q);
						(dd.items||[]).forEach(x=>{if(!seen.has(x.id)){seen.add(x.id);all.push({id:x.id,title:x.snippet.title,channelTitle:x.snippet.channelTitle,channelId:x.snippet.channelId,viewCount:parseInt(x.statistics?.viewCount??-1),subscriberCount:sub[x.snippet.channelId]??-1,tags:x.snippet.tags??[],sourceKeyword:kw});}});
					}
				}catch{}
				setBulkProgress({current:ki+1,total:kws.length});
			}
			addQuota(q.cost);setRawResults(all);setSearched(true);
		}catch(e){setError('❌ '+e.message);}
		finally{setLoading(false);setBulkProgress({current:0,total:0});}
	},[bulkKeywords,region]);

	const doSearch = useCallback(async(pageToken='')=>{
		const hQ=query.trim(),hU=videoUrl.trim();
		if(!hQ&&!hU){setError('⚠️ Search query অথবা video URL দিন।');return;}
		setLoading(true);setError('');
		try{
			let raw=[],nextTk='',q={cost:0};
			if(hU){
				const vid=extractVideoId(videoUrl);if(!vid)throw new Error('Invalid YouTube URL or video ID.');
				const r=await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${vid}&key=${API_KEY}`);
				const d=await r.json();if(d.error)throw new Error(d.error.message);
				raw=d.items||[];q.cost+=QUOTA_COSTS.videos;
			}else{
				let url=`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=20&q=${encodeURIComponent(query)}&regionCode=${region}&key=${API_KEY}`;
				if(pageToken)url+=`&pageToken=${pageToken}`;
				const sr=await fetch(url);const sd=await sr.json();if(sd.error)throw new Error(sd.error.message);
				nextTk=sd.nextPageToken??'';
				const dr=await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${sd.items.map(i=>i.id.videoId).join(',')}&key=${API_KEY}`);
				const dd=await dr.json();if(dd.error)throw new Error(dd.error.message);
				raw=dd.items||[];q.cost+=QUOTA_COSTS.search+QUOTA_COSTS.videos;
			}
			const sub=await fetchChannelSubs(raw,q);addQuota(q.cost);
			const vids=raw.map(x=>({id:x.id,title:x.snippet.title,channelTitle:x.snippet.channelTitle,channelId:x.snippet.channelId,viewCount:parseInt(x.statistics?.viewCount??-1),subscriberCount:sub[x.snippet.channelId]??-1,tags:x.snippet.tags??[]}));
			setRawResults(prev=>pageToken?[...prev,...vids]:vids);
			setNextPageToken(nextTk);setSearched(true);
		}catch(e){setError('❌ '+e.message);}
		finally{setLoading(false);}
	},[query,videoUrl,region]);

	const copyAll = async () => {
		await copyRich(results.map(v=>makeLines(v).html), results.map(v=>makeLines(v).plain));
		setCopiedIds(prev=>{const n=new Set(prev);results.forEach(v=>n.add(v.id));saveCopiedIds(n);return n;});
		setAllCopied(true);setTimeout(()=>setAllCopied(false),1800);
	};

	const tabSt = (tab) => ({ padding:'7px 16px', fontSize:11, fontWeight:700, cursor:'pointer', border:'none', borderRadius:7, fontFamily:'inherit', letterSpacing:.5, transition:'all .15s', background:activeTab===tab?T.tabActive:'transparent', color:activeTab===tab?T.tabActiveTxt:T.tabInactiveTxt, boxShadow:activeTab===tab?'0 0 12px #6d28d944':'none' });

	const hlCount = results.filter(v=>highlightedIds.has(v.id)).length;
	const copiedCount = results.filter(v=>copiedIds.has(v.id)).length;

	return (
		<div style={{ minHeight:'100vh', background:T.bg, color:T.text, fontFamily:"'Syne',sans-serif", transition:'background .3s,color .3s' }}>
			<link href='https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap' rel='stylesheet' />

			{/* HEADER */}
			<div style={{ background:T.headerBg, borderBottom:`1px solid ${T.border}`, padding:'18px 28px', display:'flex', alignItems:'center', gap:14, justifyContent:'space-between' }}>
				<div style={{ display:'flex', alignItems:'center', gap:14 }}>
					<div style={{ width:34, height:34, background:'#dc2626', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>▶</div>
					<div>
						<h1 style={{ margin:0, fontSize:20, fontWeight:800, color:T.text }}>YouTube Filter Search</h1>
						<p style={{ margin:0, color:T.accent, fontSize:11 }}>Search and filter YouTube videos with advanced criteria. Powered by Makin</p>
					</div>
				</div>
				<button onClick={()=>setDarkMode(d=>!d)} style={{ background:isDark?'#1e1e35':'#e0e4f5', border:`1px solid ${T.border3}`, borderRadius:50, width:52, height:28, cursor:'pointer', position:'relative', transition:'background .3s', flexShrink:0 }}>
					<div style={{ position:'absolute', top:3, left:isDark?26:3, width:20, height:20, borderRadius:'50%', background:isDark?'#6366f1':'#fbbf24', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, transition:'left .3s,background .3s', boxShadow:'0 1px 4px rgba(0,0,0,.3)' }}>{isDark?'🌙':'☀️'}</div>
				</button>
			</div>

			<div style={{ display:'flex', maxWidth:1300, margin:'0 auto' }}>
				{/* MAIN */}
				<div style={{ flex:1, padding:'24px 20px', minWidth:0 }}>
					<div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:20, marginBottom:18 }}>
						{/* Tabs */}
						<div style={{ display:'flex', gap:4, marginBottom:16, background:T.tabBg, borderRadius:10, padding:4, width:'fit-content', flexWrap:'wrap' }}>
							{[['keyword','🔍 Keyword'],['url','🔗 Single URL'],['bulk','📋 Bulk URLs'],['bulkKeyword','🔠 Bulk Keywords']].map(([k,l])=>(<button key={k} style={tabSt(k)} onClick={()=>setActiveTab(k)}>{l}</button>))}
						</div>

						{activeTab==='keyword'&&<div style={{ marginBottom:14 }}><label style={{ color:T.lSearch, fontSize:10, fontWeight:700, display:'block', marginBottom:4, letterSpacing:1 }}>🔍 KEYWORD SEARCH</label><input type='text' placeholder='best tourist places in japan' value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&(setRawResults([]),doSearch())} style={inputSt}/></div>}
						{activeTab==='url'&&<div style={{ marginBottom:14 }}><label style={{ color:T.lSearch, fontSize:10, fontWeight:700, display:'block', marginBottom:4, letterSpacing:1 }}>🔗 VIDEO URL / ID</label><input type='text' placeholder='https://youtube.com/watch?v=...' value={videoUrl} onChange={e=>setVideoUrl(e.target.value)} onKeyDown={e=>e.key==='Enter'&&(setRawResults([]),doSearch())} style={inputSt}/></div>}
						{activeTab==='bulkKeyword'&&(
							<div style={{ marginBottom:14 }}>
								<label style={{ color:T.accentAmber, fontSize:10, fontWeight:700, display:'block', marginBottom:4, letterSpacing:1 }}>🔠 BULK KEYWORDS <span style={{ color:T.textMid, fontWeight:400 }}>(প্রতি line এ একটা keyword)</span></label>
								<textarea placeholder={'best travel vlog 2024\njapan street food\nbudget travel tips'} value={bulkKeywords} onChange={e=>setBulkKeywords(e.target.value)} rows={5} style={{ ...inputSt, resize:'vertical', lineHeight:1.6 }}/>
								<p style={{ color:T.textMid, fontSize:10, margin:'6px 0 0' }}>💡 প্রতিটা keyword এর জন্য আলাদা search হবে — duplicate বাদ যাবে</p>
								{loading&&bulkProgress.total>0&&<div style={{ marginTop:10 }}><div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}><span style={{ color:T.accentAmber, fontSize:10 }}>Searching: {bulkProgress.current<bulkProgress.total?`"${bulkKeywords.split('\n').filter(Boolean)[bulkProgress.current]||''}"`: 'Done'}</span><span style={{ color:T.textDim, fontSize:10, fontFamily:"'JetBrains Mono',monospace" }}>{bulkProgress.current}/{bulkProgress.total}</span></div><div style={{ height:4, background:T.border, borderRadius:4, overflow:'hidden' }}><div style={{ width:`${(bulkProgress.current/bulkProgress.total)*100}%`, height:'100%', background:T.accentAmber, borderRadius:4, transition:'width .3s' }}/></div></div>}
							</div>
						)}
						{activeTab==='bulk'&&(
							<div style={{ marginBottom:14 }}>
								<label style={{ color:T.accentAmber, fontSize:10, fontWeight:700, display:'block', marginBottom:4, letterSpacing:1 }}>📋 BULK URLs <span style={{ color:T.textMid, fontWeight:400 }}>(প্রতি line এ একটা URL বা Video ID)</span></label>
								<textarea placeholder={'https://youtube.com/watch?v=abc123\nhttps://youtu.be/def456\nghi789'} value={bulkUrls} onChange={e=>setBulkUrls(e.target.value)} rows={5} style={{ ...inputSt, resize:'vertical', lineHeight:1.6 }}/>
								<p style={{ color:T.textMid, fontSize:10, margin:'6px 0 0' }}>💡 YouTube link, youtu.be link, অথবা শুধু Video ID সাপোর্ট করে</p>
								{loading&&bulkProgress.total>0&&<div style={{ marginTop:10 }}><div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}><span style={{ color:T.accentAmber, fontSize:10 }}>Processing...</span><span style={{ color:T.textDim, fontSize:10, fontFamily:"'JetBrains Mono',monospace" }}>{bulkProgress.current}/{bulkProgress.total}</span></div><div style={{ height:4, background:T.border, borderRadius:4, overflow:'hidden' }}><div style={{ width:`${(bulkProgress.current/bulkProgress.total)*100}%`, height:'100%', background:T.accentAmber, borderRadius:4, transition:'width .3s' }}/></div></div>}
							</div>
						)}

						{/* Filters */}
						<div style={{ display:'flex', gap:14, alignItems:'flex-end', flexWrap:'wrap' }}>
							<div>
								<label style={{ color:T.accent4, fontSize:10, fontWeight:700, display:'block', marginBottom:4, letterSpacing:1 }}>🌍 REGION</label>
								<select value={region} onChange={e=>setRegion(e.target.value)} style={{ background:T.selectBg, border:`1px solid ${T.border3}`, borderRadius:8, color:T.text, padding:'8px 10px', fontSize:12, outline:'none', fontFamily:'inherit', cursor:'pointer', height:37 }}>
									{REGIONS.map(({code,label})=><option key={code} value={code}>{label}</option>)}
								</select>
							</div>
							<div>
								<label style={{ color:T.lViews, fontSize:10, fontWeight:700, display:'block', marginBottom:4, letterSpacing:1 }}>👁 VIEWS RANGE</label>
								<div style={{ display:'flex', gap:5, alignItems:'center' }}>
									<input type='number' placeholder='Min' value={minViews} onChange={e=>setMinViews(e.target.value)} style={numSt}/>
									<span style={{ color:T.textDim }}>–</span>
									<input type='number' placeholder='Max' value={maxViews} onChange={e=>setMaxViews(e.target.value)} style={numSt}/>
								</div>
							</div>
							<div>
								<label style={{ color:T.lSubs, fontSize:10, fontWeight:700, display:'block', marginBottom:4, letterSpacing:1 }}>📺 SUBSCRIBERS RANGE</label>
								<div style={{ display:'flex', gap:5, alignItems:'center' }}>
									<input type='number' placeholder='Min' value={minSubs} onChange={e=>setMinSubs(e.target.value)} style={numSt}/>
									<span style={{ color:T.textDim }}>–</span>
									<input type='number' placeholder='Max' value={maxSubs} onChange={e=>setMaxSubs(e.target.value)} style={numSt}/>
								</div>
							</div>
							<div style={{ flex:1, minWidth:140 }}>
								<label style={{ color:T.lKw, fontSize:10, fontWeight:700, display:'block', marginBottom:4, letterSpacing:1 }}>🏷 KEYWORDS <span style={{ color:T.textMid, fontWeight:400 }}>(comma)</span></label>
								<input type='text' placeholder='travel, vlog, japan' value={keywords} onChange={e=>setKeywords(e.target.value)} style={inputSt}/>
							</div>
							<button onClick={()=>{ if(activeTab==='bulk')doBulkSearch(); else if(activeTab==='bulkKeyword')doBulkKeywordSearch(); else{setRawResults([]);doSearch();} }} disabled={loading} style={{ background:loading?T.btnDis:T.btnSearch, color:loading?T.btnDisTxt:'#fff', border:'none', borderRadius:10, padding:'9px 22px', fontWeight:700, fontSize:13, cursor:loading?'not-allowed':'pointer', fontFamily:'inherit', whiteSpace:'nowrap', boxShadow:loading?'none':'0 0 18px #6d28d944', alignSelf:'flex-end', height:37 }}>
								{loading?'⏳':'🔍 Search'}
							</button>
						</div>
						<p style={{ color:T.textMid, fontSize:10, margin:'10px 0 0' }}>💡 Default: Min Views 2,000 · Min Subs 1,000 · সব filter optional</p>
					</div>

					{/* Channel Size Filter */}
					{searched&&rawResults.length>0&&(
						<div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:'14px 18px', marginBottom:14 }}>
							<ChannelSizeFilter selected={channelSizeSelected} onToggle={handleSizeToggle} T={T} isDark={isDark} counts={sizeCounts}/>
						</div>
					)}

					{error&&<div style={{ background:T.errBg, border:`1px solid ${T.errBorder}`, borderRadius:10, padding:'10px 14px', color:T.errTxt, marginBottom:14, fontSize:13 }}>{error}</div>}

					{searched&&(
						<div style={{ background:T.surface2, border:`1px solid ${T.border2}`, borderRadius:14, overflow:'hidden' }}>
							{/* Toolbar */}
							<div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', borderBottom:`1px solid ${T.border2}`, background:T.surface, flexWrap:'wrap', gap:8 }}>
								<div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
									<span style={{ color:T.accent, fontSize:12, fontWeight:700 }}>{results.length} result{results.length!==1?'s':''}</span>
									{copiedCount>0&&<><span style={{ color:T.border3 }}>|</span><span style={{ background:'#16a34a1a', color:'#16a34a', border:'1px solid #16a34a44', fontSize:10, padding:'2px 8px', borderRadius:5, fontWeight:700, fontFamily:"'JetBrains Mono',monospace" }}>✓ {copiedCount} copied</span></>}
									{hlCount>0&&<><span style={{ color:T.border3 }}>|</span><span style={{ background:T.pillHL, color:T.pillHLText, fontSize:10, padding:'2px 8px', borderRadius:5, fontWeight:700, fontFamily:"'JetBrains Mono',monospace" }}>✦ {hlCount} match{hlCount!==1?'es':''}</span></>}
									<span style={{ color:T.border3 }}>|</span>
									<span style={{ color:T.textDim, fontSize:11 }}>Sort:</span>
									<SortBtn label='Views' field='views' sortState={sort} onSort={f=>{setMatchSort(null);handleSort(f);}} T={T} isDark={isDark}/>
									<SortBtn label='Subscribers' field='subs' sortState={sort} onSort={f=>{setMatchSort(null);handleSort(f);}} T={T} isDark={isDark}/>
									<MatchSortControl value={matchSort} onChange={v=>{setMatchSort(v);if(v)setSort({field:null,dir:null});}} T={T} isDark={isDark}/>
								</div>
								{results.length>0&&(
									<div style={{ display:'flex', gap:8 }}>
										<button onClick={()=>exportToCSV(results)} style={{ background:T.btnExport, color:T.btnExportTxt, border:`1px solid ${T.btnExportBorder}`, borderRadius:6, padding:'4px 12px', fontSize:11, cursor:'pointer', fontFamily:"'JetBrains Mono',monospace", display:'flex', alignItems:'center', gap:5 }}>⬇ Export CSV</button>
										<button onClick={copyAll} style={{ background:allCopied?T.btnCopied:T.btnCopy, color:allCopied?'#fff':T.btnCopyTxt, border:`1px solid ${allCopied?T.btnCopied:T.btnCopyBorder}`, borderRadius:6, padding:'4px 12px', fontSize:11, cursor:'pointer', fontFamily:"'JetBrains Mono',monospace" }}>{allCopied?'✓ Copied All!':'📋 Copy All'}</button>
									</div>
								)}
							</div>
							{/* Table header */}
							<div style={{ display:'grid', gridTemplateColumns:'32px 1fr 130px 120px 90px 90px 72px', gap:10, padding:'7px 16px', background:T.surface4, borderBottom:`1px solid ${T.border2}` }}>
								{['#','TITLE & CHANNEL','SUBSCRIBERS','VIEWS','COPY','WATCH','CH. LINK'].map((h,i)=>(
									<span key={i} style={{ color:T.textDim, fontSize:9, fontWeight:700, letterSpacing:1, textAlign:i>=4?'center':i>=2?'right':'left' }}>{h}</span>
								))}
							</div>
							{results.length===0
								? <div style={{ textAlign:'center', color:T.textDim, padding:40, fontSize:13 }}>No results match your filters.</div>
								: results.map((v,i)=><VideoRow key={v.id} v={v} idx={i} isHighlighted={highlightedIds.has(v.id)} matchScore={matchScores[v.id]??0} T={T} isDark={isDark} copiedIds={copiedIds} onCopy={handleCopyId}/>)
							}
							{nextPageToken&&!loading&&activeTab!=='bulk'&&(
								<div style={{ textAlign:'center', padding:16, borderTop:`1px solid ${T.border2}` }}>
									<button onClick={()=>doSearch(nextPageToken)} style={{ background:T.btnMore, color:T.btnMoreTxt, border:`1px solid ${T.btnMoreBorder}`, borderRadius:8, padding:'7px 22px', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit' }}>Load More →</button>
								</div>
							)}
							{loading&&<div style={{ textAlign:'center', color:T.accent2, padding:28, fontSize:18 }}>⏳ Loading…</div>}
						</div>
					)}
				</div>

				{/* SIDEBAR */}
				<div style={{ width:200, flexShrink:0, padding:'24px 0 24px 16px', borderLeft:`1px solid ${T.border2}` }}>
					<div style={{ color:T.textDim, fontSize:9, fontWeight:700, letterSpacing:1, marginBottom:12 }}>API QUOTA</div>
					{quotaLoaded?<QuotaCircle used={quotaUsed} total={DAILY_QUOTA} T={T}/>:<div style={{ color:T.textDim, fontSize:11, textAlign:'center', paddingTop:20 }}>Loading…</div>}
				</div>
			</div>
		</div>
	);
}
