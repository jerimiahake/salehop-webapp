'use client';

const TABS = [
  { key: 'browse', icon: '🏠', label: 'Browse' },
  { key: 'map', icon: '🗺️', label: 'Map' },
  { key: 'post', icon: '+', label: 'Post', isPost: true },
  { key: 'saved', icon: '★', label: 'Saved' },
  { key: 'account', icon: '👤', label: 'Account' },
];

export default function BottomNav({ active, onChange, savedCount, hidden }) {
  if (active === 'post' || hidden) return null;

  return (
    <div className="bottom-nav">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`nav-btn ${tab.isPost ? 'post' : ''} ${active === tab.key ? 'active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          <div className="ic">{tab.icon}</div>
          <div>{tab.label}</div>
          {tab.key === 'saved' && savedCount > 0 && <div className="badge">{savedCount}</div>}
        </button>
      ))}
    </div>
  );
}
