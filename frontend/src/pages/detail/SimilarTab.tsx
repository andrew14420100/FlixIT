// @ts-nocheck
import { useNavigate } from "react-router-dom";
import AddRoundedIcon from "@mui/icons-material/AddRounded";

export default function SimilarTab({ items, loading, isTV }) {
  const navigate = useNavigate();

  return (
    <div data-testid="detail-similar">
      <h2 className="fxd-section-title">Titoli simili</h2>
      {items.length ? (
        <div className="fxd-similar-grid">
          {items.map((item) => (
            <div
              key={`${item.type}-${item.id}`}
              className="fxd-similar-card"
              role="link"
              tabIndex={0}
              onClick={() => { window.scrollTo(0, 0); navigate(`/browse/${item.type}/${item.id}`); }}
              onKeyDown={(event) => event.key === "Enter" && navigate(`/browse/${item.type}/${item.id}`)}
              data-testid={`detail-similar-card-${item.id}`}
            >
              <img src={item.image} alt={item.title} loading="lazy" decoding="async" />
              <div className="fxd-similar-card__shade" />
              {!item.embeddedTitle ? <span className="fxd-similar-card__title">{item.title}</span> : null}
              <div className="fxd-similar-card__foot">
                <div className="fxd-similar-card__meta">
                  <span>{isTV ? "Serie" : "Film"}{item.year ? ` • ${item.year}` : ""}</span>
                </div>
                <span className="fxd-similar-card__add" aria-hidden="true"><AddRoundedIcon /></span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="fxd-card fxd-empty" style={{ marginTop: 20 }} data-testid="detail-similar-empty">
          {loading ? "Caricamento titoli simili…" : "Nessun titolo simile disponibile."}
        </div>
      )}
    </div>
  );
}
