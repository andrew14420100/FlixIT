// @ts-nocheck
export default function DetailTabs({ tabs, active, onChange }) {
  const onKeyDown = (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === active);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    onChange(next.id);
    event.currentTarget.querySelector(`#dp-tab-${next.id}`)?.focus();
  };

  return (
    <div className="dp-tabs-wrap">
      <div className="dp-tabs" role="tablist" aria-label="Sezioni dettaglio" onKeyDown={onKeyDown} data-testid="detail-tabs">
        {tabs.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              id={`dp-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`dp-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              className={`dp-tab${isActive ? " is-active" : ""}`}
              onClick={() => onChange(tab.id)}
              data-testid={`detail-tab-${tab.id}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
