import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

const API_KEY = 'AIzaSyCR7aNXAArVk2fS9mr3eGQRoPyQbG6wT6E';
const DAILY_QUOTA = 10000;

// YouTube API quota costs
const QUOTA_COSTS = {
	search: 100, // search.list
	videos: 1, // videos.list (per call, not per video)
	channels: 1, // channels.list (per call)
};

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => {
	if (n < 0) return 'N/A';
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
	if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
	return n.toLocaleString();
};

const getTodayKey = () => new Date().toISOString().slice(0, 10);

const loadQuota = () => {
	try {
		const saved = JSON.parse(localStorage.getItem('yt_quota') || '{}');
		if (saved.date === getTodayKey()) return saved.used || 0;
	} catch {}
	return 0;
};

const saveQuota = (used) => {
	try {
		localStorage.setItem(
			'yt_quota',
			JSON.stringify({ date: getTodayKey(), used })
		);
	} catch {}
};

// Time until midnight (quota reset)
const getResetSeconds = () => {
	const now = new Date();
	const midnight = new Date();
	midnight.setHours(24, 0, 0, 0);
	return Math.floor((midnight - now) / 1000);
};

const fmtCountdown = (sec) => {
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = sec % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

// ── copy helpers ──────────────────────────────────────────────────────────────
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
	const subs =
		v.subscriberCount >= 0 ? v.subscriberCount.toLocaleString() : 'N/A';
	const views = v.viewCount >= 0 ? v.viewCount.toLocaleString() : 'N/A';
	return {
		html: `<a href="${url}">${v.title}</a> - ${subs} subscribers - ${views} views`,
		plain: `${v.title} (${url}) - ${subs} subscribers - ${views} views`,
	};
};

// ── Quota Circle ─────────────────────────────────────────────────────────────
function QuotaCircle({ used, total }) {
	const pct = Math.min(used / total, 1);
	const remaining = Math.max(total - used, 0);
	const r = 54;
	const circ = 2 * Math.PI * r;
	const dash = circ * (1 - pct);

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
					{/* track */}
					<circle
						cx='65'
						cy='65'
						r={r}
						fill='none'
						stroke='#1e1e35'
						strokeWidth='10'
					/>
					{/* progress */}
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
				{/* center text */}
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
					<span style={{ color: '#44445a', fontSize: 10, letterSpacing: 0.5 }}>
						left
					</span>
				</div>
			</div>

			<div style={{ textAlign: 'center' }}>
				<div style={{ color: '#44445a', fontSize: 10, marginBottom: 3 }}>
					{used.toLocaleString()} / {total.toLocaleString()} used
				</div>
				{/* progress bar */}
				<div
					style={{
						width: 120,
						height: 4,
						background: '#1e1e35',
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

			{/* reset countdown */}
			<div
				style={{
					background: '#0f0f1c',
					border: '1px solid #1e1e35',
					borderRadius: 8,
					padding: '6px 12px',
					textAlign: 'center',
					width: '100%',
					boxSizing: 'border-box',
				}}
			>
				<div
					style={{
						color: '#44445a',
						fontSize: 9,
						letterSpacing: 1,
						marginBottom: 2,
					}}
				>
					RESETS IN
				</div>
				<div
					style={{
						color: '#6366f1',
						fontSize: 14,
						fontWeight: 700,
						fontFamily: "'JetBrains Mono', monospace",
					}}
				>
					{fmtCountdown(countdown)}
				</div>
			</div>

			{/* per-search cost info */}
			<div
				style={{
					width: '100%',
					background: '#0f0f1c',
					border: '1px solid #1e1e35',
					borderRadius: 8,
					padding: '10px 12px',
				}}
			>
				<div
					style={{
						color: '#44445a',
						fontSize: 9,
						letterSpacing: 1,
						marginBottom: 6,
					}}
				>
					COST PER SEARCH
				</div>
				{[
					{ label: 'Keyword search', cost: '~102 pts' },
					{ label: 'Video URL lookup', cost: '~1–2 pts' },
					{ label: 'Load More', cost: '~102 pts' },
				].map(({ label, cost }) => (
					<div
						key={label}
						style={{
							display: 'flex',
							justifyContent: 'space-between',
							marginBottom: 4,
						}}
					>
						<span style={{ color: '#555575', fontSize: 10 }}>{label}</span>
						<span
							style={{
								color: '#a78bfa',
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

// ── Suggestions Panel ────────────────────────────────────────────────────────
const SUGGESTIONS = [
	{
		icon: '📅',
		title: 'Date filter',
		desc: 'Upload date অনুযায়ী filter করুন — last 24h, week, month, year।',
	},
	{
		icon: '⏱',
		title: 'Video duration filter',
		desc: 'Short (<4min), Medium, Long (>20min) অনুযায়ী filter।',
	},
	{
		icon: '🌍',
		title: 'Region filter',
		desc: 'Specific country-র trending videos খোঁজার option।',
	},
	{
		icon: '📊',
		title: 'Engagement rate',
		desc: 'Views ÷ Subscribers ratio দেখালে viral potential বোঝা যায়।',
	},
	{
		icon: '🔁',
		title: 'Bulk URL input',
		desc: 'একসাথে অনেকগুলো video URL paste করে সব-এর stats দেখুন।',
	},
	{
		icon: '💾',
		title: 'Export to CSV',
		desc: 'Filtered results CSV/Excel হিসেবে download করুন।',
	},
	{
		icon: '🔔',
		title: 'Like/Comment count',
		desc: 'Likes ও comments count দেখান — engagement বোঝার জন্য।',
	},
	{
		icon: '📌',
		title: 'Save searches',
		desc: 'বারবার ব্যবহার করা filters save করে রাখুন।',
	},
];

function SuggestionPanel() {
	const [open, setOpen] = useState(false);
	return (
		<div style={{ marginTop: 16 }}>
			<button
				onClick={() => setOpen((o) => !o)}
				style={{
					width: '100%',
					background: '#0f0f1c',
					border: '1px solid #2a2a40',
					borderRadius: 8,
					padding: '8px 12px',
					color: '#6366f1',
					fontSize: 11,
					fontWeight: 700,
					cursor: 'pointer',
					fontFamily: 'inherit',
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					letterSpacing: 0.5,
				}}
			>
				<span>💡 IMPROVEMENTS</span>
				<span style={{ fontSize: 10, color: '#44445a' }}>
					{open ? '▲' : '▼'}
				</span>
			</button>

			{open && (
				<div
					style={{
						marginTop: 8,
						display: 'flex',
						flexDirection: 'column',
						gap: 6,
					}}
				>
					{SUGGESTIONS.map(({ icon, title, desc }) => (
						<div
							key={title}
							style={{
								background: '#0b0b16',
								border: '1px solid #1c1c2e',
								borderRadius: 8,
								padding: '8px 10px',
							}}
						>
							<div
								style={{
									color: '#e0e0ff',
									fontSize: 11,
									fontWeight: 700,
									marginBottom: 2,
								}}
							>
								{icon} {title}
							</div>
							<div style={{ color: '#555575', fontSize: 10, lineHeight: 1.4 }}>
								{desc}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ── RowCopyBtn ────────────────────────────────────────────────────────────────
function RowCopyBtn({ v }) {
	const [copied, setCopied] = useState(false);
	const { html, plain } = makeLines(v);
	return (
		<button
			onClick={() => copyRich([html], [plain], setCopied)}
			style={{
				background: copied ? '#16a34a' : '#18181b',
				color: copied ? '#fff' : '#a1a1aa',
				border: `1px solid ${copied ? '#16a34a' : '#3f3f46'}`,
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

// ── SortBtn ───────────────────────────────────────────────────────────────────
function SortBtn({ label, field, sortState, onSort }) {
	const active = sortState.field === field;
	const dir = active ? sortState.dir : null;
	return (
		<button
			onClick={() => onSort(field)}
			style={{
				background: active ? '#1e1b4b' : 'transparent',
				color: active ? '#a78bfa' : '#44445a',
				border: `1px solid ${active ? '#4c1d95' : '#2a2a40'}`,
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
			{label}
			<span style={{ fontSize: 10 }}>
				{dir === 'desc' ? '↓' : dir === 'asc' ? '↑' : '↕'}
			</span>
		</button>
	);
}

// ── VideoRow ──────────────────────────────────────────────────────────────────
function VideoRow({ v, idx }) {
	const url = `https://www.youtube.com/watch?v=${v.id}`;
	return (
		<div
			style={{
				display: 'grid',
				gridTemplateColumns: '32px 1fr 130px 120px 80px 80px',
				alignItems: 'center',
				gap: 12,
				padding: '11px 16px',
				borderBottom: '1px solid #1c1c27',
				background: idx % 2 === 0 ? '#0b0b16' : '#0d0d1a',
				transition: 'background .1s',
			}}
			onMouseEnter={(e) => (e.currentTarget.style.background = '#13132a')}
			onMouseLeave={(e) =>
				(e.currentTarget.style.background =
					idx % 2 === 0 ? '#0b0b16' : '#0d0d1a')
			}
		>
			<span
				style={{
					color: '#44445a',
					fontSize: 12,
					fontFamily: 'monospace',
					textAlign: 'center',
				}}
			>
				{idx + 1}
			</span>

			<div style={{ minWidth: 0 }}>
				<a
					href={url}
					target='_blank'
					rel='noreferrer'
					style={{
						color: '#e4e4f0',
						fontWeight: 600,
						fontSize: 13,
						whiteSpace: 'nowrap',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						marginBottom: 3,
						textDecoration: 'none',
						display: 'block',
					}}
					title={v.title}
					onMouseEnter={(e) => (e.currentTarget.style.color = '#a78bfa')}
					onMouseLeave={(e) => (e.currentTarget.style.color = '#e4e4f0')}
				>
					{v.title}
				</a>
				<div
					style={{
						color: '#6366f1',
						fontSize: 11,
						whiteSpace: 'nowrap',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
					}}
				>
					📺 {v.channelTitle}
				</div>
			</div>

			<div style={{ textAlign: 'right' }}>
				<div style={{ color: '#a78bfa', fontSize: 12, fontWeight: 600 }}>
					{fmt(v.subscriberCount)}
				</div>
				<div style={{ color: '#44445a', fontSize: 10 }}>subscribers</div>
			</div>

			<div style={{ textAlign: 'right' }}>
				<div style={{ color: '#60a5fa', fontSize: 12, fontWeight: 600 }}>
					{fmt(v.viewCount)}
				</div>
				<div style={{ color: '#44445a', fontSize: 10 }}>views</div>
			</div>

			<div style={{ display: 'flex', justifyContent: 'center' }}>
				<RowCopyBtn v={v} />
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

// ── styles ────────────────────────────────────────────────────────────────────
const inputSt = {
	background: '#0f0f1c',
	border: '1px solid #2a2a40',
	borderRadius: 8,
	color: '#e0e0ff',
	padding: '8px 12px',
	fontSize: 13,
	outline: 'none',
	fontFamily: 'inherit',
	width: '100%',
	boxSizing: 'border-box',
};
const numSt = { ...inputSt, width: 100 };

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
	const [query, setQuery] = useState('');
	const [videoUrl, setVideoUrl] = useState('');
	const [minViews, setMinViews] = useState('');
	const [maxViews, setMaxViews] = useState('');
	const [minSubs, setMinSubs] = useState('');
	const [maxSubs, setMaxSubs] = useState('');
	const [keywords, setKeywords] = useState('');
	const [rawResults, setRawResults] = useState([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [nextPageToken, setNextPageToken] = useState('');
	const [searched, setSearched] = useState(false);
	const [allCopied, setAllCopied] = useState(false);
	const [sort, setSort] = useState({ field: null, dir: null });
	const [quotaUsed, setQuotaUsed] = useState(loadQuota);

	const addQuota = (pts) => {
		setQuotaUsed((prev) => {
			const next = prev + pts;
			saveQuota(next);
			return next;
		});
	};

	const handleSort = (field) => {
		setSort((prev) => {
			if (prev.field !== field) return { field, dir: 'desc' };
			if (prev.dir === 'desc') return { field, dir: 'asc' };
			return { field: null, dir: null };
		});
	};

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
			return true;
		});
		if (sort.field) {
			const key = sort.field === 'views' ? 'viewCount' : 'subscriberCount';
			arr = [...arr].sort((a, b) =>
				sort.dir === 'desc' ? b[key] - a[key] : a[key] - b[key]
			);
		}
		return arr;
	}, [rawResults, minViews, maxViews, minSubs, maxSubs, keywords, sort]);

	const fetchChannelSubs = async (channelId) => {
		try {
			const r = await fetch(
				`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}&key=${API_KEY}`
			);
			const d = await r.json();
			return parseInt(d.items?.[0]?.statistics?.subscriberCount ?? -1);
		} catch {
			return -1;
		}
	};

	const extractVideoId = (input) => {
		input = input.trim();
		const m = input.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
		if (m) return m[1];
		if (/^[\w-]{11}$/.test(input)) return input;
		return null;
	};

	const doSearch = useCallback(
		async (pageToken = '') => {
			const hasQuery = query.trim();
			const hasUrl = videoUrl.trim();
			if (!hasQuery && !hasUrl) {
				setError('⚠️ Search query অথবা video URL দিন।');
				return;
			}
			setLoading(true);
			setError('');

			try {
				let rawItems = [];
				let nextToken = '';
				let quotaCost = 0;

				if (hasUrl) {
					const vid = extractVideoId(videoUrl);
					if (!vid) throw new Error('Invalid YouTube URL or video ID.');
					const r = await fetch(
						`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${vid}&key=${API_KEY}`
					);
					const d = await r.json();
					if (d.error) throw new Error(d.error.message);
					rawItems = d.items || [];
					quotaCost += QUOTA_COSTS.videos;
				} else {
					let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=20&q=${encodeURIComponent(query)}&key=${API_KEY}`;
					if (pageToken) url += `&pageToken=${pageToken}`;
					const sr = await fetch(url);
					const sd = await sr.json();
					if (sd.error) throw new Error(sd.error.message);
					nextToken = sd.nextPageToken ?? '';
					const ids = sd.items.map((i) => i.id.videoId);
					const dr = await fetch(
						`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids.join(',')}&key=${API_KEY}`
					);
					const dd = await dr.json();
					if (dd.error) throw new Error(dd.error.message);
					rawItems = dd.items || [];
					quotaCost += QUOTA_COSTS.search + QUOTA_COSTS.videos;
				}

				const channelIds = [
					...new Set(rawItems.map((i) => i.snippet.channelId)),
				];
				const subMap = {};
				// batch channel requests — 1 quota cost per call regardless of how many ids
				const batchSize = 50;
				for (let i = 0; i < channelIds.length; i += batchSize) {
					const batch = channelIds.slice(i, i + batchSize);
					try {
						const r = await fetch(
							`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${batch.join(',')}&key=${API_KEY}`
						);
						const d = await r.json();
						(d.items || []).forEach((item) => {
							subMap[item.id] = parseInt(
								item.statistics?.subscriberCount ?? -1
							);
						});
						quotaCost += QUOTA_COSTS.channels;
					} catch {}
				}

				addQuota(quotaCost);

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
		[query, videoUrl]
	);

	const copyAll = () => {
		const htmlLines = results.map((v) => makeLines(v).html);
		const plainLines = results.map((v) => makeLines(v).plain);
		copyRich(htmlLines, plainLines, setAllCopied);
	};

	return (
		<div
			style={{
				minHeight: '100vh',
				background: '#07070f',
				color: '#e0e0ff',
				fontFamily: "'Syne', sans-serif",
			}}
		>
			<link
				href='https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap'
				rel='stylesheet'
			/>

			{/* header */}
			<div
				style={{
					background: 'linear-gradient(135deg,#1a0533,#0f0f2e)',
					borderBottom: '1px solid #1e1e3a',
					padding: '18px 28px',
					display: 'flex',
					alignItems: 'center',
					gap: 14,
				}}
			>
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
					<h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
						YouTube Filter Search
					</h1>
					<p style={{ margin: 0, color: '#6366f1', fontSize: 11 }}>
						যেকোনো একটা input দিলেই চলবে · Sort · Filter · Copy
					</p>
				</div>
			</div>

			{/* two-column layout */}
			<div
				style={{ display: 'flex', gap: 0, maxWidth: 1280, margin: '0 auto' }}
			>
				{/* ── main content ── */}
				<div style={{ flex: 1, padding: '24px 20px', minWidth: 0 }}>
					{/* input panel */}
					<div
						style={{
							background: '#0d0d1a',
							border: '1px solid #1e1e35',
							borderRadius: 14,
							padding: 20,
							marginBottom: 18,
						}}
					>
						<div
							style={{
								display: 'grid',
								gridTemplateColumns: '1fr 1fr',
								gap: 12,
								marginBottom: 14,
							}}
						>
							<div>
								<label
									style={{
										color: '#6366f1',
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
									placeholder='e.g. react tutorial 2024'
									value={query}
									onChange={(e) => {
										setQuery(e.target.value);
										if (e.target.value) setVideoUrl('');
									}}
									onKeyDown={(e) =>
										e.key === 'Enter' && (setRawResults([]), doSearch())
									}
									style={inputSt}
								/>
							</div>
							<div>
								<label
									style={{
										color: '#6366f1',
										fontSize: 10,
										fontWeight: 700,
										display: 'block',
										marginBottom: 4,
										letterSpacing: 1,
									}}
								>
									🔗 VIDEO URL / ID{' '}
									<span style={{ color: '#33334a', fontWeight: 400 }}>
										(optional)
									</span>
								</label>
								<input
									type='text'
									placeholder='https://youtube.com/watch?v=...'
									value={videoUrl}
									onChange={(e) => {
										setVideoUrl(e.target.value);
										if (e.target.value) setQuery('');
									}}
									onKeyDown={(e) =>
										e.key === 'Enter' && (setRawResults([]), doSearch())
									}
									style={inputSt}
								/>
							</div>
						</div>

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
										color: '#60a5fa',
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
									<span style={{ color: '#44445a' }}>–</span>
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
										color: '#a78bfa',
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
									<span style={{ color: '#44445a' }}>–</span>
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
										color: '#34d399',
										fontSize: 10,
										fontWeight: 700,
										display: 'block',
										marginBottom: 4,
										letterSpacing: 1,
									}}
								>
									🏷 KEYWORDS{' '}
									<span style={{ color: '#33334a', fontWeight: 400 }}>
										(comma)
									</span>
								</label>
								<input
									type='text'
									placeholder='react, hooks, beginner'
									value={keywords}
									onChange={(e) => setKeywords(e.target.value)}
									style={inputSt}
								/>
							</div>
							<button
								onClick={() => {
									setRawResults([]);
									doSearch();
								}}
								disabled={loading}
								style={{
									background: loading
										? '#1e1e3a'
										: 'linear-gradient(135deg,#6d28d9,#4f46e5)',
									color: loading ? '#555' : '#fff',
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
						<p style={{ color: '#2a2a45', fontSize: 10, margin: '10px 0 0' }}>
							💡 যেকোনো একটা input দিলেই চলবে — বাকি সব optional
						</p>
					</div>

					{error && (
						<div
							style={{
								background: '#1a0505',
								border: '1px solid #7f1d1d',
								borderRadius: 10,
								padding: '10px 14px',
								color: '#fca5a5',
								marginBottom: 14,
								fontSize: 13,
							}}
						>
							{error}
						</div>
					)}

					{/* results */}
					{searched && (
						<div
							style={{
								background: '#0b0b16',
								border: '1px solid #1c1c2e',
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
									borderBottom: '1px solid #1c1c2e',
									background: '#0d0d1c',
									flexWrap: 'wrap',
									gap: 8,
								}}
							>
								<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
									<span
										style={{ color: '#6366f1', fontSize: 12, fontWeight: 700 }}
									>
										{results.length} result{results.length !== 1 ? 's' : ''}
									</span>
									<span style={{ color: '#2a2a40' }}>|</span>
									<span style={{ color: '#44445a', fontSize: 11 }}>Sort:</span>
									<SortBtn
										label='Views'
										field='views'
										sortState={sort}
										onSort={handleSort}
									/>
									<SortBtn
										label='Subscribers'
										field='subs'
										sortState={sort}
										onSort={handleSort}
									/>
								</div>
								{results.length > 0 && (
									<button
										onClick={copyAll}
										style={{
											background: allCopied ? '#16a34a' : '#18181b',
											color: allCopied ? '#fff' : '#a1a1aa',
											border: `1px solid ${allCopied ? '#16a34a' : '#3f3f46'}`,
											borderRadius: 6,
											padding: '4px 12px',
											fontSize: 11,
											cursor: 'pointer',
											fontFamily: "'JetBrains Mono', monospace",
										}}
									>
										{allCopied ? '✓ Copied All!' : '📋 Copy All'}
									</button>
								)}
							</div>

							{/* col headers */}
							<div
								style={{
									display: 'grid',
									gridTemplateColumns: '32px 1fr 130px 120px 80px 80px',
									gap: 12,
									padding: '7px 16px',
									background: '#111127',
									borderBottom: '1px solid #1c1c2e',
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
											color: '#44445a',
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
										color: '#44445a',
										padding: 40,
										fontSize: 13,
									}}
								>
									No results match your filters.
								</div>
							) : (
								results.map((v, i) => <VideoRow key={v.id} v={v} idx={i} />)
							)}

							{nextPageToken && !loading && (
								<div
									style={{
										textAlign: 'center',
										padding: 16,
										borderTop: '1px solid #1c1c2e',
									}}
								>
									<button
										onClick={() => doSearch(nextPageToken)}
										style={{
											background: '#111127',
											color: '#6366f1',
											border: '1px solid #2a2a4a',
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
										color: '#7c3aed',
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

				{/* ── sidebar ── */}
				<div
					style={{
						width: 200,
						flexShrink: 0,
						padding: '24px 16px 24px 0',
						borderLeft: '1px solid #1c1c2e',
						paddingLeft: 16,
					}}
				>
					{/* quota heading */}
					<div
						style={{
							color: '#44445a',
							fontSize: 9,
							fontWeight: 700,
							letterSpacing: 1,
							marginBottom: 12,
						}}
					>
						API QUOTA
					</div>
					<QuotaCircle used={quotaUsed} total={DAILY_QUOTA} />

					{/* reset button */}
					<button
						onClick={() => {
							saveQuota(0);
							setQuotaUsed(0);
						}}
						style={{
							marginTop: 8,
							width: '100%',
							background: 'transparent',
							border: '1px solid #2a2a40',
							borderRadius: 6,
							color: '#44445a',
							fontSize: 10,
							padding: '5px 0',
							cursor: 'pointer',
							fontFamily: 'inherit',
						}}
					>
						↺ Reset counter
					</button>

					<SuggestionPanel />
				</div>
			</div>
		</div>
	);
}
