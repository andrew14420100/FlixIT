// @ts-nocheck
import { useNavigate } from "react-router-dom";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import { MAIN_PATH } from "src/constant";
import { seasonsText } from "./detailUtils";

function SimilarCard({ item, isTV }) {
  const navigate = useNavigate();
  const go = () => {
    window.scrollTo(0, 0);
    navigate(`/${MAIN_PATH.browse}/${item.type}/${item.id}`);
  };
  const onKey = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      go();
    }
  };

  const line1 = [isTV ? "Serie" : "Film", item.genre].filter(Boolean);
  const line2 = [item.year, isTV ? seasonsText(item.seasons) : ""].filter(Boolean);

  return (
    <div
      className="dp-similar-card"
      role="link"
      tabIndex={0}
      aria-label={item.title}
      onClick={go}
      onKeyDown={onKey}
      data-testid={`detail-similar-card-${item.id}`}
    >
      <div className="dp-similar-card__art">
        <img src={item.image} alt={item.title} loading="lazy" decoding="async" />
        {!item.embeddedTitle ? (
          <>
            <div className="dp-similar-card__shade" />
            <span className="dp-similar-card__title">{item.title}</span>
          </>
        ) : null}
      </div>
      <div className="dp-similar-card__foot">
        <div className="dp-similar-card__meta">
          <span>
            {line1.map((part, index) => (
              <span key={`${part}-${index}`} className="dp-similar-card__part">
                {index ? <span className="dp-hero__dot" aria-hidden="true">•</span> : null}
                {part}
              </span>
            ))}
          </span>
          <span>
            {line2.map((part, index) => (
              <span key={`${part}-${index}`} className="dp-similar-card__part">
                {index ? <span className="dp-hero__dot" aria-hidden="true">•</span> : null}
                {part}
              </span>
            ))}
            {item.certification ? (
              <span className="dp-similar-card__part">
                {line2.length ? <span className="dp-hero__dot" aria-hidden="true">•</span> : null}
                <span className="dp-badge">{item.certification}</span>
              </span>
            ) : null}
          </span>
        </div>
        <span className="dp-similar-card__add" aria-hidden="true"><AddRoundedIcon /></span>
      </div>
    </div>
  );
}

export default function DetailSimilar({ items, loading, isTV }) {
  return (
    <div data-testid="detail-similar">
      <h2 className="dp-section-title">Titoli simili</h2>
      {items.length ? (
        <div className="dp-similar-grid">
          {items.map((item) => <SimilarCard key={`${item.type}-${item.id}`} item={item} isTV={isTV} />)}
        </div>
      ) : (
        <div className="dp-card dp-empty dp-similar-empty" data-testid="detail-similar-empty">
          {loading ? "Caricamento titoli simili…" : "Nessun titolo simile disponibile."}
        </div>
      )}
    </div>
  );
}
