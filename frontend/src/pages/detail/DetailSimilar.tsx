// @ts-nocheck
import HomepageSlider from "src/components/HomepageSlider";

/**
 * Titoli simili intentionally reuses the Home rail itself instead of maintaining
 * a second card implementation. This keeps card proportions, artwork policy,
 * hover expansion, trailer preview, navigation and mobile poster behaviour
 * identical to Home.
 */
export default function DetailSimilar({ items, loading }) {
  if (!items.length) {
    return (
      <div data-testid="detail-similar">
        <h2 className="dp-section-title">Titoli simili</h2>
        <div className="dp-card dp-empty dp-similar-empty" data-testid="detail-similar-empty">
          {loading ? "Caricamento titoli simili…" : "Nessun titolo simile disponibile."}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="detail-similar"
      className="dp-similar-home-rail"
      style={{
        position: "relative",
        overflow: "visible",
        marginLeft: "calc((100vw - var(--dp-content-w)) / -2)",
        marginRight: "calc((100vw - var(--dp-content-w)) / -2)",
      }}
    >
      <HomepageSlider
        rowId="detail-similar-home-cards"
        title="Titoli simili"
        items={items}
      />
    </div>
  );
}
