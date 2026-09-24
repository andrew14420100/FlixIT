// @ts-nocheck
import { DETAIL_TABS } from "./detailUtils";

export default function DetailTabs({ active, onChange }) {
  return (
    <div className="fxd-tabs-wrap">
      <div className="fxd-tabs" role="tablist" aria-label="Sezioni dettaglio" data-testid="detail-tabs">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className={`fxd-tab${active === tab.id ? " is-active" : ""}`}
            onClick={() => onChange(tab.id)}
            data-testid={`detail-tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
