import { useState, useCallback, useMemo, useEffect } from 'react';

const API_KEY = 'AIzaSyCR7aNXAArVk2fS9mr3eGQRoPyQbG6wT6E';
const DAILY_QUOTA = 10000;
const QUOTA_KEY = 'yt_quota_v2';

const QUOTA_COSTS = { search: 100, videos: 1, channels: 1 };

const REGIONS = [
	{ code: 'US', label: '🇺🇸 USA' },
	{ code: 'GB', label: '🇬🇧 UK' },
	{ code: 'CA', label: '🇨🇦 Canada' },
	{ code: 'AU', label: '🇦🇺 Australia' },
	{ code: 'IN', label: '🇮🇳 India' },
	{ code: 'BD', label: '🇧🇩 Bangladesh' },
	{ code: 'PK', label: '🇵🇰 Pakistan' },
	{ code: 'DE', label: '🇩🇪 Germany' },
	{ code: 'FR', label: '🇫🇷 France' },
	{ code: 'JP', label: '🇯🇵 Japan' },
	{ code: 'KR', label: '🇰🇷 South Korea' },
	{ code: 'BR', label: '🇧🇷 Brazil' },
	{ code: 'MX', label: '🇲🇽 Mexico' },
	{ code: 'NG', label: '🇳🇬 Nigeria' },
	{ code: 'EG', label: '🇪🇬 Egypt' },
	{ code: 'SA', label: '🇸🇦 Saudi Arabia' },
	{ code: 'ID', label: '🇮🇩 Indonesia' },
	{ code: 'PH', label: '🇵🇭 Philippines' },
	{ code: 'TR', label: '🇹🇷 Turkey' },
	{ code: 'RU', label: '🇷🇺 Russia' },
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
		const result = await window.storage.get(QUOTA_KEY);
		if (result) {
			const saved = JSON.parse(result.value);
			if (saved.date === getTodayKey()) return saved.used || 0;
		}
	} catch {}
	return 0;
};

const saveQuotaToStorage = async (used) => {
	try {
		await window.storage.set(
			QUOTA_KEY,
			JSON.stringify({ date: getTodayKey(), used })
		);
	} catch {}
};

const getResetSeconds = () => {
	const midnight = new Date();
	midnight.setHours(24, 0, 0, 0);
	return Math.floor((midnight - new Date()) / 1000);
};

const fmtCountdown = (sec) => {
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = sec % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const copyRich = async (htmlLines, plainLines, setCopied) => {
	const html = htmlLines.join('<br>');
	const plain = plainLines.join('\n');
	try {
		await navigator.clipboard.write([
			new ClipboardItem({
				'text/html': new Blob([html], { type: 'text/html' }),
				'text/plain': new Blob([plain], { type: 'text/plain' }),
			}),
		]);
	} catch {
		const el = document.createElement('textarea');
		el.value = plain;
		document.body.appendChild(el);
		el.select();
		document.execCommand('copy');
		document.body.removeChild(el);
	}
	setCopied(true);
	setTimeout(() => setCopied(false), 1800);
};

const makeLines = (v) => {
	const url = `https://www.youtube.com/watch?v=${v.id}`;
	return {
		html: `<a href="${url}">${v.title}</a> - ${fmtK(v.subscriberCount)} subscribers - ${fmtK(v.viewCount)} views`,
		plain: `${v.title} (${url}) - ${fmtK(v.subscriberCount)} subscribers - ${fmtK(v.viewCount)} views`,
	};
};

const exportToCSV = (results) => {
	const headers = [
		'Title (linked)',
		'URL',
		'Channel',
		'Subscribers',
		'Views',
		'Source Keyword',
	];
	const rows = results.map((v) => {
		const url = `https://www.youtube.com/watch?v=${v.id}`;
		const escape = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
		const hyperlink = `"=HYPERLINK(""${url}"",""${String(v.title).replace(/"/g, "'")}"")"`;
		return [
			hyperlink,
			escape(url),
			escape(v.channelTitle),
			escape(fmtK(v.subscriberCount)),
			escape(fmtK(v.viewCount)),
			escape(v.sourceKeyword || ''),
		].join(',');
	});
	const blob = new Blob(['\uFEFF' + [headers.join(','), ...rows].join('\n')], {
		type: 'text/csv;charset=utf-8;',
	});
	const link = document.createElement('a');
	link.href = URL.createObjectURL(blob);
	link.download = `yt-filter-results-${getTodayKey()}.csv`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
};

const getMatchScore = (v, searchQuery, filterKeywords) => {
	const allKws = [...searchQuery.split(/\s+/), ...filterKeywords.split(',')]
		.map((k) => k.trim().toLowerCase())
		.filter(Boolean);
	if (allKws.length === 0) return 0;
	const hay = (v.title + ' ' + (v.tags || []).join(' ')).toLowerCase();
	return allKws.filter((k) => hay.includes(k)).length / allKws.length;
};

// ── Channel size helpers ──────────────────────────────────────────────────────
const CHANNEL_SIZES = [
	{ key: 'all', label: 'All Sizes', icon: '🌐', min: 0, max: Infinity },
	{ key: 'small', label: 'Small', icon: '🌱', min: 0, max: 10_000 },
	{ key: 'medium', label: 'Medium', icon: '📈', min: 10_000, max: 50_000 },
	{ key: 'big', label: 'Big', icon: '🏆', min: 50_000, max: Infinity },
];

const getChannelSizeKey = (subs) => {
	if (subs < 0) return null;
	if (subs < 10_000) return 'small';
	if (subs < 50_000) return 'medium';
	return 'big';
};

// ── Themes ────────────────────────────────────────────────────────────────────
const DARK = {
	bg: '#07070f',
	surface: '#0d0d1a',
	surface2: '#0b0b16',
	surface4: '#111127',
	border: '#1e1e35',
	border2: '#1c1c2e',
	border3: '#2a2a40',
	text: '#e0e0ff',
	textDim: '#44445a',
	textMid: '#555575',
	textRow: '#e4e4f0',
	accent: '#6366f1',
	accent2: '#a78bfa',
	accent3: '#60a5fa',
	accent4: '#34d399',
	accentAmber: '#f59e0b',
	headerBg: 'linear-gradient(135deg,#1a0533,#0f0f2e)',
	inputBg: '#0f0f1c',
	selectBg: '#0f0f1c',
	rowEven: '#0b0b16',
	rowOdd: '#0d0d1a',
	rowHover: '#13132a',
	rowHL: 'rgba(251,191,36,0.08)',
	rowHLBorder: 'rgba(251,191,36,0.35)',
	rowHLHover: 'rgba(251,191,36,0.14)',
	pillHL: '#78350f',
	pillHLText: '#fbbf24',
	quotaRing: '#1e1e35',
	quotaBg: '#0f0f1c',
	tagBg: '#1e1b4b',
	tagText: '#a78bfa',
	btnSearch: 'linear-gradient(135deg,#6d28d9,#4f46e5)',
	btnDis: '#1e1e3a',
	btnDisTxt: '#555',
	btnCopy: '#18181b',
	btnCopyBorder: '#3f3f46',
	btnCopyTxt: '#a1a1aa',
	btnCopied: '#16a34a',
	btnExport: '#0f2e1a',
	btnExportTxt: '#34d399',
	btnExportBorder: '#166534',
	btnMore: '#111127',
	btnMoreTxt: '#6366f1',
	btnMoreBorder: '#2a2a4a',
	tabActive: 'linear-gradient(135deg,#6d28d9,#4f46e5)',
	tabActiveTxt: '#fff',
	tabInactiveTxt: '#44445a',
	tabBg: '#0a0a15',
	errBg: '#1a0505',
	errBorder: '#7f1d1d',
	errTxt: '#fca5a5',
	lViews: '#60a5fa',
	lSubs: '#a78bfa',
	lKw: '#34d399',
	lSearch: '#6366f1',
	// channel size chip colors
	chipSmallBg: '#0c2a1a',
	chipSmallText: '#34d399',
	chipSmallBorder: '#165534',
	chipMediumBg: '#1a1a07',
	chipMediumText: '#f59e0b',
	chipMediumBorder: '#55440a',
	chipBigBg: '#1a0a2e',
	chipBigText: '#a78bfa',
	chipBigBorder: '#4c1d95',
	chipAllBg: '#0d0d1a',
	chipAllText: '#6366f1',
	chipAllBorder: '#2a2a50',
	// match sort
	matchSortBg: '#0f0f20',
	matchSortBorder: '#2a2a50',
	matchSortActiveBg: '#1e1b4b',
};
const LIGHT = {
	bg: '#f0f2fa',
	surface: '#ffffff',
	surface2: '#f8f9fe',
	surface4: '#e8eaf6',
	border: '#d0d4f0',
	border2: '#dde0f5',
	border3: '#c4c8e8',
	text: '#1a1a3a',
	textDim: '#7880b0',
	textMid: '#9096c0',
	textRow: '#1a1a3a',
	accent: '#4f46e5',
	accent2: '#7c3aed',
	accent3: '#2563eb',
	accent4: '#059669',
	accentAmber: '#d97706',
	headerBg: 'linear-gradient(135deg,#ede9fe,#e0e7ff)',
	inputBg: '#f8f9fe',
	selectBg: '#f8f9fe',
	rowEven: '#f8f9fe',
	rowOdd: '#ffffff',
	rowHover: '#ede9fe',
	rowHL: 'rgba(217,119,6,0.07)',
	rowHLBorder: 'rgba(217,119,6,0.3)',
	rowHLHover: 'rgba(217,119,6,0.12)',
	pillHL: '#fef3c7',
	pillHLText: '#92400e',
	quotaRing: '#e0e4f5',
	quotaBg: '#f0f2fa',
	tagBg: '#ede9fe',
	tagText: '#6d28d9',
	btnSearch: 'linear-gradient(135deg,#6d28d9,#4f46e5)',
	btnDis: '#e0e4f5',
	btnDisTxt: '#aab0d0',
	btnCopy: '#f0f2fa',
	btnCopyBorder: '#c4c8e8',
	btnCopyTxt: '#7880b0',
	btnCopied: '#059669',
	btnExport: '#ecfdf5',
	btnExportTxt: '#065f46',
	btnExportBorder: '#a7f3d0',
	btnMore: '#f0f2fa',
	btnMoreTxt: '#4f46e5',
	btnMoreBorder: '#c4c8e8',
	tabActive: 'linear-gradient(135deg,#6d28d9,#4f46e5)',
	tabActiveTxt: '#fff',
	tabInactiveTxt: '#9096c0',
	tabBg: '#eef0fb',
	errBg: '#fff1f2',
	errBorder: '#fecdd3',
	errTxt: '#be123c',
	lViews: '#2563eb',
	lSubs: '#7c3aed',
	lKw: '#059669',
	lSearch: '#4f46e5',
	chipSmallBg: '#ecfdf5',
	chipSmallText: '#065f46',
	chipSmallBorder: '#a7f3d0',
	chipMediumBg: '#fffbeb',
	chipMediumText: '#92400e',
	chipMediumBorder: '#fde68a',
	chipBigBg: '#f5f3ff',
	chipBigText: '#5b21b6',
	chipBigBorder: '#ddd6fe',
	chipAllBg: '#eef0fb',
	chipAllText: '#4f46e5',
	chipAllBorder: '#c7d2fe',
	matchSortBg: '#f0f2fa',
	matchSortBorder: '#c4c8e8',
	matchSortActiveBg: '#ede9fe',
};

// ── QuotaCircle ───────────────────────────────────────────────────────────────
function QuotaCircle({ used, total, T }) {
	const pct = Math.min(used / total, 1);
	const remaining = Math.max(total - used, 0);
	const r = 54,
		circ = 2 * Math.PI * r,
		dash = circ * (1 - pct);
	const color = pct < 0.5 ? '#22c55e' : pct < 0.8 ? '#f59e0b' : '#ef4444';
	const [countdown, setCountdown] = useState(getResetSeconds());
	useEffect(() => {
		const t = setInterval(() => setCountdown(getResetSeconds()), 1000);
		return () => clearInterval(t);
	}, []);
	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				gap: 10,
			}}
		>
			<div style={{ position: 'relative', width: 130, height: 130 }}>
				<svg width='130' height='130' style={{ transform: 'rotate(-90deg)' }}>
					<circle
						cx='65'
						cy='65'
						r={r}
						fill='none'
						stroke={T.quotaRing}
						strokeWidth='10'
					/>
					<circle
						cx='65'
						cy='65'
						r={r}
						fill='none'
						stroke={color}
						strokeWidth='10'
						strokeDasharray={circ}
						strokeDashoffset={dash}
						strokeLinecap='round'
						style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s' }}
					/>
				</svg>
				<div
					style={{
						position: 'absolute',
						inset: 0,
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						justifyContent: 'center',
						gap: 1,
					}}
				>
					<span
						style={{
							color,
							fontSize: 22,
							fontWeight: 800,
							fontFamily: "'JetBrains Mono', monospace",
							lineHeight: 1,
						}}
					>
						{remaining.toLocaleString()}
					</span>
					<span style={{ color: T.textDim, fontSize: 10 }}>left</span>
				</div>
			</div>
			<div style={{ textAlign: 'center' }}>
				<div style={{ color: T.textDim, fontSize: 10, marginBottom: 3 }}>
					{used.toLocaleString()} / {total.toLocaleString()} used
				</div>
				<div
					style={{
						width: 120,
						height: 4,
						background: T.quotaRing,
						borderRadius: 4,
						overflow: 'hidden',
					}}
				>
					<div
						style={{
							width: `${pct * 100}%`,
							height: '100%',
							background: color,
							borderRadius: 4,
							transition: 'width 0.5s',
						}}
					/>
				</div>
			</div>
			<div
				style={{
					background: T.quotaBg,
					border: `1px solid ${T.border}`,
					borderRadius: 8,
					padding: '6px 12px',
					textAlign: 'center',
					width: '100%',
					boxSizing: 'border-box',
				}}
			>
				<div
					style={{
						color: T.textDim,
						fontSize: 9,
						letterSpacing: 1,
						marginBottom: 2,
					}}
				>
					RESETS IN
				</div>
				<div
					style={{
						color: T.accent,
						fontSize: 14,
						fontWeight: 700,
						fontFamily: "'JetBrains Mono', monospace",
					}}
				>
					{fmtCountdown(countdown)}
				</div>
			</div>
			<div
				style={{
					width: '100%',
					background: T.quotaBg,
					border: `1px solid ${T.border}`,
					borderRadius: 8,
					padding: '10px 12px',
				}}
			>
				<div
					style={{
						color: T.textDim,
						fontSize: 9,
						letterSpacing: 1,
						marginBottom: 6,
					}}
				>
					COST PER SEARCH
				</div>
				{[
					['Keyword search', '~102 pts'],
					['Video URL lookup', '~1–2 pts'],
					['Bulk URL (per video)', '~2 pts'],
					['Load More', '~102 pts'],
				].map(([label, cost]) => (
					<div
						key={label}
						style={{
							display: 'flex',
							justifyContent: 'space-between',
							marginBottom: 4,
						}}
					>
						<span style={{ color: T.textMid, fontSize: 10 }}>{label}</span>
						<span
							style={{
								color: T.accent2,
								fontSize: 10,
								fontFamily: "'JetBrains Mono', monospace",
							}}
						>
							{cost}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function RowCopyBtn({ v, T }) {
	const [copied, setCopied] = useState(false);
	const { html, plain } = makeLines(v);
	return (
		<button
			onClick={() => copyRich([html], [plain], setCopied)}
			style={{
				background: copied ? T.btnCopied : T.btnCopy,
				color: copied ? '#fff' : T.btnCopyTxt,
				border: `1px solid ${copied ? T.btnCopied : T.btnCopyBorder}`,
				borderRadius: 6,
				padding: '4px 12px',
				fontSize: 11,
				cursor: 'pointer',
				transition: 'all .15s',
				whiteSpace: 'nowrap',
				fontFamily: "'JetBrains Mono', monospace",
			}}
		>
			{copied ? '✓' : 'Copy'}
		</button>
	);
}

function SortBtn({ label, field, sortState, onSort, T, isDark }) {
	const active = sortState.field === field;
	const dir = active ? sortState.dir : null;
	return (
		<button
			onClick={() => onSort(field)}
			style={{
				background: active ? (isDark ? '#1e1b4b' : '#ede9fe') : 'transparent',
				color: active ? T.accent2 : T.textDim,
				border: `1px solid ${active ? T.accent2 : T.border3}`,
				borderRadius: 6,
				padding: '3px 10px',
				fontSize: 11,
				cursor: 'pointer',
				fontFamily: "'JetBrains Mono', monospace",
				display: 'flex',
				alignItems: 'center',
				gap: 4,
			}}
		>
			{label}{' '}
			<span style={{ fontSize: 10 }}>
				{dir === 'desc' ? '↓' : dir === 'asc' ? '↑' : '↕'}
			</span>
		</button>
	);
}

// ── Match score pill inside row ───────────────────────────────────────────────
function MatchScoreBadge({ score, T }) {
	if (score <= 0) return null;
	const pct = Math.round(score * 100);
	const color = pct >= 75 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#94a3b8';
	return (
		<span
			style={{
				background: color + '22',
				color,
				border: `1px solid ${color}55`,
				fontSize: 9,
				padding: '1px 6px',
				borderRadius: 4,
				fontWeight: 700,
				fontFamily: "'JetBrains Mono', monospace",
				whiteSpace: 'nowrap',
				flexShrink: 0,
			}}
		>
			{pct}% match
		</span>
	);
}

// ── Channel size badge ────────────────────────────────────────────────────────
function ChannelSizeBadge({ subs, T }) {
	const key = getChannelSizeKey(subs);
	if (!key) return null;
	const cfg = {
		small: {
			label: '🌱 Small',
			bg: T.chipSmallBg,
			text: T.chipSmallText,
			border: T.chipSmallBorder,
		},
		medium: {
			label: '📈 Medium',
			bg: T.chipMediumBg,
			text: T.chipMediumText,
			border: T.chipMediumBorder,
		},
		big: {
			label: '🏆 Big',
			bg: T.chipBigBg,
			text: T.chipBigText,
			border: T.chipBigBorder,
		},
	}[key];
	return (
		<span
			style={{
				background: cfg.bg,
				color: cfg.text,
				border: `1px solid ${cfg.border}`,
				fontSize: 9,
				padding: '1px 6px',
				borderRadius: 4,
				fontWeight: 700,
				fontFamily: "'JetBrains Mono', monospace",
				whiteSpace: 'nowrap',
				flexShrink: 0,
			}}
		>
			{cfg.label}
		</span>
	);
}

function VideoRow({ v, idx, isHighlighted, matchScore, T }) {
	const url = `https://www.youtube.com/watch?v=${v.id}`;
	const baseBg = idx % 2 === 0 ? T.rowEven : T.rowOdd;
	const rowBg = isHighlighted ? T.rowHL : baseBg;
	return (
		<div
			style={{
				display: 'grid',
				gridTemplateColumns: '32px 1fr 130px 120px 80px 80px',
				alignItems: 'center',
				gap: 12,
				padding: '11px 16px',
				borderBottom: `1px solid ${T.border2}`,
				borderLeft: isHighlighted
					? `3px solid ${T.rowHLBorder}`
					: '3px solid transparent',
				background: rowBg,
				transition: 'background .1s',
			}}
			onMouseEnter={(e) =>
				(e.currentTarget.style.background = isHighlighted
					? T.rowHLHover
					: T.rowHover)
			}
			onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
		>
			<span
				style={{
					color: T.textDim,
					fontSize: 12,
					fontFamily: 'monospace',
					textAlign: 'center',
				}}
			>
				{idx + 1}
			</span>
			<div style={{ minWidth: 0 }}>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						marginBottom: 3,
						flexWrap: 'wrap',
					}}
				>
					{isHighlighted && (
						<span
							style={{
								background: T.pillHL,
								color: T.pillHLText,
								fontSize: 9,
								padding: '1px 6px',
								borderRadius: 4,
								fontWeight: 700,
								fontFamily: "'JetBrains Mono', monospace",
								whiteSpace: 'nowrap',
								flexShrink: 0,
							}}
						>
							✦ MATCH
						</span>
					)}
					<MatchScoreBadge score={matchScore} T={T} />
					<a
						href={url}
						target='_blank'
						rel='noreferrer'
						style={{
							color: T.textRow,
							fontWeight: 600,
							fontSize: 13,
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							textDecoration: 'none',
							display: 'block',
						}}
						title={v.title}
						onMouseEnter={(e) => (e.currentTarget.style.color = T.accent2)}
						onMouseLeave={(e) => (e.currentTarget.style.color = T.textRow)}
					>
						{v.title}
					</a>
				</div>
				<div
					style={{
						display: 'flex',
						gap: 6,
						alignItems: 'center',
						flexWrap: 'wrap',
					}}
				>
					<div
						style={{
							color: T.accent,
							fontSize: 11,
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
						}}
					>
						📺 {v.channelTitle}
					</div>
					<ChannelSizeBadge subs={v.subscriberCount} T={T} />
					{v.sourceKeyword && (
						<span
							style={{
								background: T.tagBg,
								color: T.tagText,
								fontSize: 9,
								padding: '1px 6px',
								borderRadius: 4,
								fontFamily: "'JetBrains Mono', monospace",
								whiteSpace: 'nowrap',
							}}
						>
							🔠 {v.sourceKeyword}
						</span>
					)}
				</div>
			</div>
			<div style={{ textAlign: 'right' }}>
				<div style={{ color: T.accent2, fontSize: 12, fontWeight: 600 }}>
					{fmt(v.subscriberCount)}
				</div>
				<div style={{ color: T.textDim, fontSize: 10 }}>subscribers</div>
			</div>
			<div style={{ textAlign: 'right' }}>
				<div style={{ color: T.accent3, fontSize: 12, fontWeight: 600 }}>
					{fmt(v.viewCount)}
				</div>
				<div style={{ color: T.textDim, fontSize: 10 }}>views</div>
			</div>
			<div style={{ display: 'flex', justifyContent: 'center' }}>
				<RowCopyBtn v={v} T={T} />
			</div>
			<div style={{ display: 'flex', justifyContent: 'center' }}>
				<a
					href={url}
					target='_blank'
					rel='noreferrer'
					style={{
						background: '#dc2626',
						color: '#fff',
						borderRadius: 6,
						padding: '4px 12px',
						fontSize: 11,
						textDecoration: 'none',
						fontWeight: 700,
						whiteSpace: 'nowrap',
						fontFamily: "'JetBrains Mono', monospace",
					}}
				>
					▶ View
				</a>
			</div>
		</div>
	);
}

// ── Channel Size Filter Pills ─────────────────────────────────────────────────
function ChannelSizeFilter({ value, onChange, T, counts }) {
	return (
		<div>
			<label
				style={{
					color: T.accent4,
					fontSize: 10,
					fontWeight: 700,
					display: 'block',
					marginBottom: 6,
					letterSpacing: 1,
				}}
			>
				📡 CHANNEL SIZE
			</label>
			<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
				{CHANNEL_SIZES.map(({ key, label, icon }) => {
					const active = value === key;
					const count = counts[key] ?? 0;
					const styles = {
						all: {
							bg: T.chipAllBg,
							text: T.chipAllText,
							border: T.chipAllBorder,
						},
						small: {
							bg: T.chipSmallBg,
							text: T.chipSmallText,
							border: T.chipSmallBorder,
						},
						medium: {
							bg: T.chipMediumBg,
							text: T.chipMediumText,
							border: T.chipMediumBorder,
						},
						big: {
							bg: T.chipBigBg,
							text: T.chipBigText,
							border: T.chipBigBorder,
						},
					}[key];
					return (
						<button
							key={key}
							onClick={() => onChange(key)}
							style={{
								background: active ? styles.bg : 'transparent',
								color: active ? styles.text : T.textDim,
								border: `1.5px solid ${active ? styles.border : T.border3}`,
								borderRadius: 20,
								padding: '4px 12px',
								fontSize: 11,
								cursor: 'pointer',
								fontFamily: 'inherit',
								fontWeight: active ? 700 : 400,
								transition: 'all .15s',
								display: 'flex',
								alignItems: 'center',
								gap: 5,
								boxShadow: active ? `0 0 8px ${styles.border}66` : 'none',
							}}
						>
							{icon} {label}
							{count > 0 && (
								<span
									style={{
										background: active ? styles.border : T.border3,
										color: active ? styles.bg : T.textDim,
										borderRadius: 10,
										padding: '0 5px',
										fontSize: 9,
										fontFamily: "'JetBrains Mono', monospace",
										fontWeight: 700,
										minWidth: 16,
										textAlign: 'center',
									}}
								>
									{count}
								</span>
							)}
						</button>
					);
				})}
			</div>
			<div style={{ marginTop: 5, color: T.textMid, fontSize: 9 }}>
				🌱 Small: 0–10K &nbsp;·&nbsp; 📈 Medium: 10K–50K &nbsp;·&nbsp; 🏆 Big:
				50K+
			</div>
		</div>
	);
}

// ── Match Sort Control ────────────────────────────────────────────────────────
function MatchSortControl({ value, onChange, T }) {
	// value: null | 'desc' | 'asc'
	const options = [
		{ val: null, label: 'Default', icon: '—' },
		{ val: 'desc', label: 'Best Match ↓', icon: '✦' },
		{ val: 'asc', label: 'Worst Match ↑', icon: '◇' },
	];
	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
			<span style={{ color: T.textDim, fontSize: 11 }}>Match:</span>
			{options.map(({ val, label, icon }) => {
				const active = value === val;
				return (
					<button
						key={String(val)}
						onClick={() => onChange(val)}
						style={{
							background: active
								? T === DARK
									? '#1e1b4b'
									: '#ede9fe'
								: 'transparent',
							color: active ? T.accent2 : T.textDim,
							border: `1px solid ${active ? T.accent2 : T.border3}`,
							borderRadius: 6,
							padding: '3px 9px',
							fontSize: 11,
							cursor: 'pointer',
							fontFamily: "'JetBrains Mono', monospace",
							transition: 'all .15s',
						}}
					>
						{icon} {label}
					</button>
				);
			})}
		</div>
	);
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
	const [darkMode, setDarkMode] = useState(true);
	const T = darkMode ? DARK : LIGHT;
	const inputSt = {
		background: T.inputBg,
		border: `1px solid ${T.border3}`,
		borderRadius: 8,
		color: T.text,
		padding: '8px 12px',
		fontSize: 13,
		outline: 'none',
		fontFamily: 'inherit',
		width: '100%',
		boxSizing: 'border-box',
	};
	const numSt = { ...inputSt, width: 100 };

	const [query, setQuery] = useState('');
	const [videoUrl, setVideoUrl] = useState('');
	const [bulkUrls, setBulkUrls] = useState('');
	const [bulkKeywords, setBulkKeywords] = useState('');
	const [activeTab, setActiveTab] = useState('keyword');
	const [region, setRegion] = useState('US');
	const [minViews, setMinViews] = useState('');
	const [maxViews, setMaxViews] = useState('');
	const [minSubs, setMinSubs] = useState('');
	const [maxSubs, setMaxSubs] = useState('');
	const [keywords, setKeywords] = useState('');
	const [channelSizeFilter, setChannelSizeFilter] = useState('all');
	const [rawResults, setRawResults] = useState([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [nextPageToken, setNextPageToken] = useState('');
	const [searched, setSearched] = useState(false);
	const [allCopied, setAllCopied] = useState(false);
	const [sort, setSort] = useState({ field: null, dir: null });
	const [matchSort, setMatchSort] = useState(null); // null | 'desc' | 'asc'
	const [quotaUsed, setQuotaUsed] = useState(0);
	const [quotaLoaded, setQuotaLoaded] = useState(false);
	const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });

	useEffect(() => {
		loadQuotaFromStorage().then((val) => {
			setQuotaUsed(val);
			setQuotaLoaded(true);
		});
	}, []);

	const addQuota = (pts) => {
		setQuotaUsed((prev) => {
			const next = prev + pts;
			saveQuotaToStorage(next);
			return next;
		});
	};

	const handleSort = (field) =>
		setSort((prev) => {
			if (prev.field !== field) return { field, dir: 'desc' };
			if (prev.dir === 'desc') return { field, dir: 'asc' };
			return { field: null, dir: null };
		});

	// Compute match scores for all raw results
	const matchScores = useMemo(() => {
		const map = {};
		rawResults.forEach((v) => {
			map[v.id] = getMatchScore(v, query, keywords);
		});
		return map;
	}, [rawResults, query, keywords]);

	// Count channel sizes for the filter badges
	const channelSizeCounts = useMemo(() => {
		const counts = { all: 0, small: 0, medium: 0, big: 0 };
		rawResults.forEach((v) => {
			const key = getChannelSizeKey(v.subscriberCount);
			if (key) counts[key]++;
		});
		counts.all = rawResults.length;
		return counts;
	}, [rawResults]);

	const results = useMemo(() => {
		const kwList = keywords
			.split(',')
			.map((k) => k.trim().toLowerCase())
			.filter(Boolean);
		let arr = rawResults.filter((v) => {
			if (minViews !== '' && v.viewCount < parseInt(minViews)) return false;
			if (maxViews !== '' && v.viewCount > parseInt(maxViews)) return false;
			if (minSubs !== '' && v.subscriberCount < parseInt(minSubs)) return false;
			if (maxSubs !== '' && v.subscriberCount > parseInt(maxSubs)) return false;
			if (kwList.length > 0) {
				const hay = (v.title + ' ' + v.tags.join(' ')).toLowerCase();
				if (!kwList.some((k) => hay.includes(k))) return false;
			}
			// Channel size filter
			if (channelSizeFilter !== 'all') {
				const size = CHANNEL_SIZES.find((s) => s.key === channelSizeFilter);
				if (
					size &&
					(v.subscriberCount < size.min || v.subscriberCount >= size.max)
				)
					return false;
			}
			return true;
		});

		// Sort priority: matchSort > views/subs sort
		if (matchSort) {
			arr = [...arr].sort((a, b) =>
				matchSort === 'desc'
					? (matchScores[b.id] ?? 0) - (matchScores[a.id] ?? 0)
					: (matchScores[a.id] ?? 0) - (matchScores[b.id] ?? 0)
			);
		} else if (sort.field) {
			const key = sort.field === 'views' ? 'viewCount' : 'subscriberCount';
			arr = [...arr].sort((a, b) =>
				sort.dir === 'desc' ? b[key] - a[key] : a[key] - b[key]
			);
		}
		return arr;
	}, [
		rawResults,
		minViews,
		maxViews,
		minSubs,
		maxSubs,
		keywords,
		channelSizeFilter,
		sort,
		matchSort,
		matchScores,
	]);

	const highlightedIds = useMemo(() => {
		const set = new Set();
		results.forEach((v) => {
			if ((matchScores[v.id] ?? 0) >= 0.5) set.add(v.id);
		});
		return set;
	}, [results, matchScores]);

	const extractVideoId = (input) => {
		input = input.trim();
		const m = input.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
		if (m) return m[1];
		if (/^[\w-]{11}$/.test(input)) return input;
		return null;
	};

	const fetchChannelSubs = async (items, quotaRef) => {
		const channelIds = [...new Set(items.map((i) => i.snippet.channelId))];
		const subMap = {};
		for (let j = 0; j < channelIds.length; j += 50) {
			try {
				const r = await fetch(
					`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelIds.slice(j, j + 50).join(',')}&key=${API_KEY}`
				);
				const d = await r.json();
				(d.items || []).forEach((item) => {
					subMap[item.id] = parseInt(item.statistics?.subscriberCount ?? -1);
				});
				quotaRef.cost += QUOTA_COSTS.channels;
			} catch {}
		}
		return subMap;
	};

	const doBulkSearch = useCallback(async () => {
		const ids = bulkUrls
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			.map(extractVideoId)
			.filter(Boolean);
		if (ids.length === 0) {
			setError('⚠️ Valid YouTube URL বা Video ID পাওয়া যায়নি।');
			return;
		}
		setLoading(true);
		setError('');
		setRawResults([]);
		setBulkProgress({ current: 0, total: ids.length });
		try {
			const allVideos = [];
			const q = { cost: 0 };
			for (let i = 0; i < ids.length; i += 50) {
				const batch = ids.slice(i, i + 50);
				const dr = await fetch(
					`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${batch.join(',')}&key=${API_KEY}`
				);
				const dd = await dr.json();
				if (dd.error) throw new Error(dd.error.message);
				q.cost += QUOTA_COSTS.videos;
				const subMap = await fetchChannelSubs(dd.items || [], q);
				(dd.items || []).forEach((item) =>
					allVideos.push({
						id: item.id,
						title: item.snippet.title,
						channelTitle: item.snippet.channelTitle,
						channelId: item.snippet.channelId,
						viewCount: parseInt(item.statistics?.viewCount ?? -1),
						subscriberCount: subMap[item.snippet.channelId] ?? -1,
						tags: item.snippet.tags ?? [],
					})
				);
				setBulkProgress({
					current: Math.min(i + 50, ids.length),
					total: ids.length,
				});
			}
			addQuota(q.cost);
			setRawResults(allVideos);
			setSearched(true);
		} catch (e) {
			setError('❌ ' + e.message);
		} finally {
			setLoading(false);
			setBulkProgress({ current: 0, total: 0 });
		}
	}, [bulkUrls]);

	const doBulkKeywordSearch = useCallback(async () => {
		const kwLines = bulkKeywords
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		if (kwLines.length === 0) {
			setError('⚠️ কমপক্ষে একটা keyword দিন।');
			return;
		}
		setLoading(true);
		setError('');
		setRawResults([]);
		setBulkProgress({ current: 0, total: kwLines.length });
		try {
			const allVideos = [];
			const seenIds = new Set();
			const q = { cost: 0 };
			for (let ki = 0; ki < kwLines.length; ki++) {
				const kw = kwLines[ki];
				try {
					const sr = await fetch(
						`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=20&q=${encodeURIComponent(kw)}&regionCode=${region}&key=${API_KEY}`
					);
					const sd = await sr.json();
					if (sd.error) throw new Error(sd.error.message);
					q.cost += QUOTA_COSTS.search;
					const ids = (sd.items || [])
						.map((i) => i.id.videoId)
						.filter((id) => !seenIds.has(id));
					if (ids.length > 0) {
						const dr = await fetch(
							`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids.join(',')}&key=${API_KEY}`
						);
						const dd = await dr.json();
						if (dd.error) throw new Error(dd.error.message);
						q.cost += QUOTA_COSTS.videos;
						const subMap = await fetchChannelSubs(dd.items || [], q);
						(dd.items || []).forEach((item) => {
							if (!seenIds.has(item.id)) {
								seenIds.add(item.id);
								allVideos.push({
									id: item.id,
									title: item.snippet.title,
									channelTitle: item.snippet.channelTitle,
									channelId: item.snippet.channelId,
									viewCount: parseInt(item.statistics?.viewCount ?? -1),
									subscriberCount: subMap[item.snippet.channelId] ?? -1,
									tags: item.snippet.tags ?? [],
									sourceKeyword: kw,
								});
							}
						});
					}
				} catch {}
				setBulkProgress({ current: ki + 1, total: kwLines.length });
			}
			addQuota(q.cost);
			setRawResults(allVideos);
			setSearched(true);
		} catch (e) {
			setError('❌ ' + e.message);
		} finally {
			setLoading(false);
			setBulkProgress({ current: 0, total: 0 });
		}
	}, [bulkKeywords, region]);

	const doSearch = useCallback(
		async (pageToken = '') => {
			const hasQuery = query.trim(),
				hasUrl = videoUrl.trim();
			if (!hasQuery && !hasUrl) {
				setError('⚠️ Search query অথবা video URL দিন।');
				return;
			}
			setLoading(true);
			setError('');
			try {
				let rawItems = [],
					nextToken = '';
				const q = { cost: 0 };
				if (hasUrl) {
					const vid = extractVideoId(videoUrl);
					if (!vid) throw new Error('Invalid YouTube URL or video ID.');
					const r = await fetch(
						`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${vid}&key=${API_KEY}`
					);
					const d = await r.json();
					if (d.error) throw new Error(d.error.message);
					rawItems = d.items || [];
					q.cost += QUOTA_COSTS.videos;
				} else {
					let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=20&q=${encodeURIComponent(query)}&regionCode=${region}&key=${API_KEY}`;
					if (pageToken) url += `&pageToken=${pageToken}`;
					const sr = await fetch(url);
					const sd = await sr.json();
					if (sd.error) throw new Error(sd.error.message);
					nextToken = sd.nextPageToken ?? '';
					const dr = await fetch(
						`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${sd.items.map((i) => i.id.videoId).join(',')}&key=${API_KEY}`
					);
					const dd = await dr.json();
					if (dd.error) throw new Error(dd.error.message);
					rawItems = dd.items || [];
					q.cost += QUOTA_COSTS.search + QUOTA_COSTS.videos;
				}
				const subMap = await fetchChannelSubs(rawItems, q);
				addQuota(q.cost);
				const videos = rawItems.map((item) => ({
					id: item.id,
					title: item.snippet.title,
					channelTitle: item.snippet.channelTitle,
					channelId: item.snippet.channelId,
					viewCount: parseInt(item.statistics?.viewCount ?? -1),
					subscriberCount: subMap[item.snippet.channelId] ?? -1,
					tags: item.snippet.tags ?? [],
				}));
				setRawResults((prev) => (pageToken ? [...prev, ...videos] : videos));
				setNextPageToken(nextToken);
				setSearched(true);
			} catch (e) {
				setError('❌ ' + e.message);
			} finally {
				setLoading(false);
			}
		},
		[query, videoUrl, region]
	);

	const copyAll = () =>
		copyRich(
			results.map((v) => makeLines(v).html),
			results.map((v) => makeLines(v).plain),
			setAllCopied
		);

	const tabStyle = (tab) => ({
		padding: '7px 16px',
		fontSize: 11,
		fontWeight: 700,
		cursor: 'pointer',
		border: 'none',
		borderRadius: 7,
		fontFamily: 'inherit',
		letterSpacing: 0.5,
		transition: 'all .15s',
		background: activeTab === tab ? T.tabActive : 'transparent',
		color: activeTab === tab ? T.tabActiveTxt : T.tabInactiveTxt,
		boxShadow: activeTab === tab ? '0 0 12px #6d28d944' : 'none',
	});
	const highlightCount = results.filter((v) => highlightedIds.has(v.id)).length;

	return (
		<div
			style={{
				minHeight: '100vh',
				background: T.bg,
				color: T.text,
				fontFamily: "'Syne', sans-serif",
				transition: 'background 0.3s, color 0.3s',
			}}
		>
			<link
				href='https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap'
				rel='stylesheet'
			/>

			{/* header */}
			<div
				style={{
					background: T.headerBg,
					borderBottom: `1px solid ${T.border}`,
					padding: '18px 28px',
					display: 'flex',
					alignItems: 'center',
					gap: 14,
					justifyContent: 'space-between',
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
					<div
						style={{
							width: 34,
							height: 34,
							background: '#dc2626',
							borderRadius: 8,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							fontSize: 16,
						}}
					>
						▶
					</div>
					<div>
						<h1
							style={{
								margin: 0,
								fontSize: 20,
								fontWeight: 800,
								color: T.text,
							}}
						>
							YouTube Filter Search
						</h1>
						<p style={{ margin: 0, color: T.accent, fontSize: 11 }}>
							Search and filter YouTube videos with advanced criteria. Powered
							by Makin
						</p>
					</div>
				</div>
				<button
					onClick={() => setDarkMode((d) => !d)}
					style={{
						background: darkMode ? '#1e1e35' : '#e0e4f5',
						border: `1px solid ${T.border3}`,
						borderRadius: 50,
						width: 52,
						height: 28,
						cursor: 'pointer',
						position: 'relative',
						transition: 'background 0.3s',
						flexShrink: 0,
					}}
				>
					<div
						style={{
							position: 'absolute',
							top: 3,
							left: darkMode ? 26 : 3,
							width: 20,
							height: 20,
							borderRadius: '50%',
							background: darkMode ? '#6366f1' : '#fbbf24',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							fontSize: 11,
							transition: 'left 0.3s, background 0.3s',
							boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
						}}
					>
						{darkMode ? '🌙' : '☀️'}
					</div>
				</button>
			</div>

			<div style={{ display: 'flex', maxWidth: 1280, margin: '0 auto' }}>
				{/* main */}
				<div style={{ flex: 1, padding: '24px 20px', minWidth: 0 }}>
					<div
						style={{
							background: T.surface,
							border: `1px solid ${T.border}`,
							borderRadius: 14,
							padding: 20,
							marginBottom: 18,
						}}
					>
						{/* Tabs */}
						<div
							style={{
								display: 'flex',
								gap: 4,
								marginBottom: 16,
								background: T.tabBg,
								borderRadius: 10,
								padding: 4,
								width: 'fit-content',
								flexWrap: 'wrap',
							}}
						>
							<button
								style={tabStyle('keyword')}
								onClick={() => setActiveTab('keyword')}
							>
								🔍 Keyword
							</button>
							<button
								style={tabStyle('url')}
								onClick={() => setActiveTab('url')}
							>
								🔗 Single URL
							</button>
							<button
								style={tabStyle('bulk')}
								onClick={() => setActiveTab('bulk')}
							>
								📋 Bulk URLs
							</button>
							<button
								style={tabStyle('bulkKeyword')}
								onClick={() => setActiveTab('bulkKeyword')}
							>
								🔠 Bulk Keywords
							</button>
						</div>

						{activeTab === 'keyword' && (
							<div style={{ marginBottom: 14 }}>
								<label
									style={{
										color: T.lSearch,
										fontSize: 10,
										fontWeight: 700,
										display: 'block',
										marginBottom: 4,
										letterSpacing: 1,
									}}
								>
									🔍 KEYWORD SEARCH
								</label>
								<input
									type='text'
									placeholder='best tourist places in japan'
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									onKeyDown={(e) =>
										e.key === 'Enter' && (setRawResults([]), doSearch())
									}
									style={inputSt}
								/>
							</div>
						)}
						{activeTab === 'url' && (
							<div style={{ marginBottom: 14 }}>
								<label
									style={{
										color: T.lSearch,
										fontSize: 10,
										fontWeight: 700,
										display: 'block',
										marginBottom: 4,
										letterSpacing: 1,
									}}
								>
									🔗 VIDEO URL / ID
								</label>
								<input
									type='text'
									placeholder='https://youtube.com/watch?v=...'
									value={videoUrl}
									onChange={(e) => setVideoUrl(e.target.value)}
									onKeyDown={(e) =>
										e.key === 'Enter' && (setRawResults([]), doSearch())
									}
									style={inputSt}
								/>
							</div>
						)}
						{activeTab === 'bulkKeyword' && (
							<div style={{ marginBottom: 14 }}>
								<label
									style={{
										color: T.accentAmber,
										fontSize: 10,
										fontWeight: 700,
										display: 'block',
										marginBottom: 4,
										letterSpacing: 1,
									}}
								>
									🔠 BULK KEYWORDS{' '}
									<span style={{ color: T.textMid, fontWeight: 400 }}>
										(প্রতি line এ একটা keyword)
									</span>
								</label>
								<textarea
									placeholder={
										'best travel vlog 2024\njapan street food\nbudget travel tips'
									}
									value={bulkKeywords}
									onChange={(e) => setBulkKeywords(e.target.value)}
									rows={5}
									style={{ ...inputSt, resize: 'vertical', lineHeight: 1.6 }}
								/>
								<p
									style={{ color: T.textMid, fontSize: 10, margin: '6px 0 0' }}
								>
									💡 প্রতিটা keyword এর জন্য আলাদা search হবে — সব results
									একসাথে দেখাবে, duplicate বাদ যাবে
								</p>
								{loading && bulkProgress.total > 0 && (
									<div style={{ marginTop: 10 }}>
										<div
											style={{
												display: 'flex',
												justifyContent: 'space-between',
												marginBottom: 4,
											}}
										>
											<span style={{ color: T.accentAmber, fontSize: 10 }}>
												Searching:{' '}
												{bulkProgress.current < bulkProgress.total
													? `"${bulkKeywords.split('\n').filter(Boolean)[bulkProgress.current] || ''}"`
													: 'Done'}
											</span>
											<span
												style={{
													color: T.textDim,
													fontSize: 10,
													fontFamily: "'JetBrains Mono', monospace",
												}}
											>
												{bulkProgress.current} / {bulkProgress.total}
											</span>
										</div>
										<div
											style={{
												height: 4,
												background: T.border,
												borderRadius: 4,
												overflow: 'hidden',
											}}
										>
											<div
												style={{
													width: `${(bulkProgress.current / bulkProgress.total) * 100}%`,
													height: '100%',
													background: T.accentAmber,
													borderRadius: 4,
													transition: 'width 0.3s',
												}}
											/>
										</div>
									</div>
								)}
							</div>
						)}
						{activeTab === 'bulk' && (
							<div style={{ marginBottom: 14 }}>
								<label
									style={{
										color: T.accentAmber,
										fontSize: 10,
										fontWeight: 700,
										display: 'block',
										marginBottom: 4,
										letterSpacing: 1,
									}}
								>
									📋 BULK URLs{' '}
									<span style={{ color: T.textMid, fontWeight: 400 }}>
										(প্রতি line এ একটা URL বা Video ID)
									</span>
								</label>
								<textarea
									placeholder={
										'https://youtube.com/watch?v=abc123\nhttps://youtu.be/def456\nghi789'
									}
									value={bulkUrls}
									onChange={(e) => setBulkUrls(e.target.value)}
									rows={5}
									style={{ ...inputSt, resize: 'vertical', lineHeight: 1.6 }}
								/>
								<p
									style={{ color: T.textMid, fontSize: 10, margin: '6px 0 0' }}
								>
									💡 YouTube link, youtu.be link, অথবা শুধু Video ID — সব format
									সাপোর্ট করে
								</p>
								{loading && bulkProgress.total > 0 && (
									<div style={{ marginTop: 10 }}>
										<div
											style={{
												display: 'flex',
												justifyContent: 'space-between',
												marginBottom: 4,
											}}
										>
											<span style={{ color: T.accentAmber, fontSize: 10 }}>
												Processing...
											</span>
											<span
												style={{
													color: T.textDim,
													fontSize: 10,
													fontFamily: "'JetBrains Mono', monospace",
												}}
											>
												{bulkProgress.current} / {bulkProgress.total}
											</span>
										</div>
										<div
											style={{
												height: 4,
												background: T.border,
												borderRadius: 4,
												overflow: 'hidden',
											}}
										>
											<div
												style={{
													width: `${(bulkProgress.current / bulkProgress.total) * 100}%`,
													height: '100%',
													background: T.accentAmber,
													borderRadius: 4,
													transition: 'width 0.3s',
												}}
											/>
										</div>
									</div>
								)}
							</div>
						)}

						{/* Filters row */}
						<div
							style={{
								display: 'flex',
								gap: 14,
								alignItems: 'flex-end',
								flexWrap: 'wrap',
							}}
						>
							<div>
								<label
									style={{
										color: T.accent4,
										fontSize: 10,
										fontWeight: 700,
										display: 'block',
										marginBottom: 4,
										letterSpacing: 1,
									}}
								>
									🌍 REGION
								</label>
								<select
									value={region}
									onChange={(e) => setRegion(e.target.value)}
									style={{
										background: T.selectBg,
										border: `1px solid ${T.border3}`,
										borderRadius: 8,
										color: T.text,
										padding: '8px 10px',
										fontSize: 12,
										outline: 'none',
										fontFamily: 'inherit',
										cursor: 'pointer',
										height: 37,
									}}
								>
									{REGIONS.map(({ code, label }) => (
										<option key={code} value={code}>
											{label}
										</option>
									))}
								</select>
							</div>
							<div>
								<label
									style={{
										color: T.lViews,
										fontSize: 10,
										fontWeight: 700,
										display: 'block',
										marginBottom: 4,
										letterSpacing: 1,
									}}
								>
									👁 VIEWS RANGE
								</label>
								<div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
									<input
										type='number'
										placeholder='Min'
										value={minViews}
										onChange={(e) => setMinViews(e.target.value)}
										style={numSt}
									/>
									<span style={{ color: T.textDim }}>–</span>
									<input
										type='number'
										placeholder='Max'
										value={maxViews}
										onChange={(e) => setMaxViews(e.target.value)}
										style={numSt}
									/>
								</div>
							</div>
							<div>
								<label
									style={{
										color: T.lSubs,
										fontSize: 10,
										fontWeight: 700,
										display: 'block',
										marginBottom: 4,
										letterSpacing: 1,
									}}
								>
									📺 SUBSCRIBERS RANGE
								</label>
								<div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
									<input
										type='number'
										placeholder='Min'
										value={minSubs}
										onChange={(e) => setMinSubs(e.target.value)}
										style={numSt}
									/>
									<span style={{ color: T.textDim }}>–</span>
									<input
										type='number'
										placeholder='Max'
										value={maxSubs}
										onChange={(e) => setMaxSubs(e.target.value)}
										style={numSt}
									/>
								</div>
							</div>
							<div style={{ flex: 1, minWidth: 140 }}>
								<label
									style={{
										color: T.lKw,
										fontSize: 10,
										fontWeight: 700,
										display: 'block',
										marginBottom: 4,
										letterSpacing: 1,
									}}
								>
									🏷 KEYWORDS{' '}
									<span style={{ color: T.textMid, fontWeight: 400 }}>
										(comma)
									</span>
								</label>
								<input
									type='text'
									placeholder='travel, vlog, japan'
									value={keywords}
									onChange={(e) => setKeywords(e.target.value)}
									style={inputSt}
								/>
							</div>
							<button
								onClick={() => {
									if (activeTab === 'bulk') doBulkSearch();
									else if (activeTab === 'bulkKeyword') doBulkKeywordSearch();
									else {
										setRawResults([]);
										doSearch();
									}
								}}
								disabled={loading}
								style={{
									background: loading ? T.btnDis : T.btnSearch,
									color: loading ? T.btnDisTxt : '#fff',
									border: 'none',
									borderRadius: 10,
									padding: '9px 22px',
									fontWeight: 700,
									fontSize: 13,
									cursor: loading ? 'not-allowed' : 'pointer',
									fontFamily: 'inherit',
									whiteSpace: 'nowrap',
									boxShadow: loading ? 'none' : '0 0 18px #6d28d944',
									alignSelf: 'flex-end',
									height: 37,
								}}
							>
								{loading ? '⏳' : '🔍 Search'}
							</button>
						</div>
						<p style={{ color: T.textMid, fontSize: 10, margin: '10px 0 0' }}>
							💡 যেকোনো একটা input দিলেই চলবে — বাকি সব optional
						</p>
					</div>

					{/* ── Channel size filter — shown after search ── */}
					{searched && rawResults.length > 0 && (
						<div
							style={{
								background: T.surface,
								border: `1px solid ${T.border}`,
								borderRadius: 12,
								padding: '14px 18px',
								marginBottom: 14,
							}}
						>
							<ChannelSizeFilter
								value={channelSizeFilter}
								onChange={setChannelSizeFilter}
								T={T}
								counts={channelSizeCounts}
							/>
						</div>
					)}

					{error && (
						<div
							style={{
								background: T.errBg,
								border: `1px solid ${T.errBorder}`,
								borderRadius: 10,
								padding: '10px 14px',
								color: T.errTxt,
								marginBottom: 14,
								fontSize: 13,
							}}
						>
							{error}
						</div>
					)}

					{searched && (
						<div
							style={{
								background: T.surface2,
								border: `1px solid ${T.border2}`,
								borderRadius: 14,
								overflow: 'hidden',
							}}
						>
							<div
								style={{
									display: 'flex',
									justifyContent: 'space-between',
									alignItems: 'center',
									padding: '10px 14px',
									borderBottom: `1px solid ${T.border2}`,
									background: T.surface,
									flexWrap: 'wrap',
									gap: 8,
								}}
							>
								<div
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 8,
										flexWrap: 'wrap',
									}}
								>
									<span
										style={{ color: T.accent, fontSize: 12, fontWeight: 700 }}
									>
										{results.length} result{results.length !== 1 ? 's' : ''}
									</span>
									{highlightCount > 0 && (
										<>
											<span style={{ color: T.border3 }}>|</span>
											<span
												style={{
													background: T.pillHL,
													color: T.pillHLText,
													fontSize: 10,
													padding: '2px 8px',
													borderRadius: 5,
													fontWeight: 700,
													fontFamily: "'JetBrains Mono', monospace",
												}}
											>
												✦ {highlightCount} keyword match
												{highlightCount !== 1 ? 'es' : ''}
											</span>
										</>
									)}
									<span style={{ color: T.border3 }}>|</span>
									<span style={{ color: T.textDim, fontSize: 11 }}>Sort:</span>
									<SortBtn
										label='Views'
										field='views'
										sortState={sort}
										onSort={(f) => {
											setMatchSort(null);
											handleSort(f);
										}}
										T={T}
										isDark={darkMode}
									/>
									<SortBtn
										label='Subscribers'
										field='subs'
										sortState={sort}
										onSort={(f) => {
											setMatchSort(null);
											handleSort(f);
										}}
										T={T}
										isDark={darkMode}
									/>
									<MatchSortControl
										value={matchSort}
										onChange={(v) => {
											setMatchSort(v);
											if (v) setSort({ field: null, dir: null });
										}}
										T={T}
									/>
								</div>
								{results.length > 0 && (
									<div style={{ display: 'flex', gap: 8 }}>
										<button
											onClick={() => exportToCSV(results)}
											style={{
												background: T.btnExport,
												color: T.btnExportTxt,
												border: `1px solid ${T.btnExportBorder}`,
												borderRadius: 6,
												padding: '4px 12px',
												fontSize: 11,
												cursor: 'pointer',
												fontFamily: "'JetBrains Mono', monospace",
												display: 'flex',
												alignItems: 'center',
												gap: 5,
											}}
										>
											⬇ Export CSV
										</button>
										<button
											onClick={copyAll}
											style={{
												background: allCopied ? T.btnCopied : T.btnCopy,
												color: allCopied ? '#fff' : T.btnCopyTxt,
												border: `1px solid ${allCopied ? T.btnCopied : T.btnCopyBorder}`,
												borderRadius: 6,
												padding: '4px 12px',
												fontSize: 11,
												cursor: 'pointer',
												fontFamily: "'JetBrains Mono', monospace",
											}}
										>
											{allCopied ? '✓ Copied All!' : '📋 Copy All'}
										</button>
									</div>
								)}
							</div>
							<div
								style={{
									display: 'grid',
									gridTemplateColumns: '32px 1fr 130px 120px 80px 80px',
									gap: 12,
									padding: '7px 16px',
									background: T.surface4,
									borderBottom: `1px solid ${T.border2}`,
								}}
							>
								{[
									'#',
									'TITLE & CHANNEL',
									'SUBSCRIBERS',
									'VIEWS',
									'COPY',
									'WATCH',
								].map((h, i) => (
									<span
										key={i}
										style={{
											color: T.textDim,
											fontSize: 9,
											fontWeight: 700,
											letterSpacing: 1,
											textAlign: i >= 4 ? 'center' : i >= 2 ? 'right' : 'left',
										}}
									>
										{h}
									</span>
								))}
							</div>
							{results.length === 0 ? (
								<div
									style={{
										textAlign: 'center',
										color: T.textDim,
										padding: 40,
										fontSize: 13,
									}}
								>
									No results match your filters.
								</div>
							) : (
								results.map((v, i) => (
									<VideoRow
										key={v.id}
										v={v}
										idx={i}
										isHighlighted={highlightedIds.has(v.id)}
										matchScore={matchScores[v.id] ?? 0}
										T={T}
									/>
								))
							)}
							{nextPageToken && !loading && activeTab !== 'bulk' && (
								<div
									style={{
										textAlign: 'center',
										padding: 16,
										borderTop: `1px solid ${T.border2}`,
									}}
								>
									<button
										onClick={() => doSearch(nextPageToken)}
										style={{
											background: T.btnMore,
											color: T.btnMoreTxt,
											border: `1px solid ${T.btnMoreBorder}`,
											borderRadius: 8,
											padding: '7px 22px',
											cursor: 'pointer',
											fontWeight: 700,
											fontSize: 12,
											fontFamily: 'inherit',
										}}
									>
										Load More →
									</button>
								</div>
							)}
							{loading && (
								<div
									style={{
										textAlign: 'center',
										color: T.accent2,
										padding: 28,
										fontSize: 18,
									}}
								>
									⏳ Loading…
								</div>
							)}
						</div>
					)}
				</div>

				{/* sidebar */}
				<div
					style={{
						width: 200,
						flexShrink: 0,
						padding: '24px 16px 24px 0',
						borderLeft: `1px solid ${T.border2}`,
						paddingLeft: 16,
					}}
				>
					<div
						style={{
							color: T.textDim,
							fontSize: 9,
							fontWeight: 700,
							letterSpacing: 1,
							marginBottom: 12,
						}}
					>
						API QUOTA
					</div>
					{quotaLoaded ? (
						<QuotaCircle used={quotaUsed} total={DAILY_QUOTA} T={T} />
					) : (
						<div
							style={{
								color: T.textDim,
								fontSize: 11,
								textAlign: 'center',
								paddingTop: 20,
							}}
						>
							Loading…
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
