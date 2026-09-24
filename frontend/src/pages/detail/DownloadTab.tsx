// @ts-nocheck
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";

export default function DownloadTab() {
  return (
    <div className="fxd-card fxd-download" data-testid="detail-download">
      <div>
        <div className="fxd-download__icon"><DownloadRoundedIcon /></div>
        <h2 className="fxd-download__title">Download non ancora disponibile</h2>
        <p className="fxd-download__sub">Stiamo lavorando per renderlo disponibile nelle prossime versioni.</p>
      </div>
    </div>
  );
}
