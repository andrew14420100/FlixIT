// @ts-nocheck
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";

export default function DetailDownload() {
  return (
    <div className="dp-card dp-download" data-testid="detail-download">
      <div className="dp-download__icon" aria-hidden="true"><DownloadRoundedIcon /></div>
      <h2 className="dp-download__title">Download non ancora disponibile</h2>
      <p className="dp-download__sub">Stiamo lavorando per renderlo disponibile nelle prossime versioni.</p>
    </div>
  );
}
