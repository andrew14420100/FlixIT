// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Stack from "@mui/material/Stack";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import QueueIcon from "@mui/icons-material/Queue";
import { adminAPI } from "../services/api";

async function adminRequest(path: string, options: RequestInit = {}) {
  const token = adminAPI.getToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || "Richiesta fallita");
  return data;
}

function qualityLabel(candidate: any) {
  if (!candidate) return "—";
  const h = Number(candidate.height || candidate.resolution || 0);
  const q = h >= 2160 ? "4K" : h >= 1440 ? "2K" : h >= 1080 ? "1080p" : h ? `${h}p` : "n/d";
  return `${q}${candidate.hdr ? candidate.dolby_vision ? " Dolby Vision" : " HDR" : " SDR"}`;
}

export default function TrailersPage() {
  const [mediaType, setMediaType] = useState("movie");
  const [tmdbId, setTmdbId] = useState("");
  const [data, setData] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [jobs, setJobs] = useState<any>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [applePage, setApplePage] = useState("");
  const [primePage, setPrimePage] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<any>(null);

  const selectedId = useMemo(() => Number(tmdbId), [tmdbId]);

  const loadConfig = async () => {
    try {
      const [cfg, queue] = await Promise.all([
        adminRequest("/api/admin/trailers/config"),
        adminRequest("/api/admin/trailers/jobs/status"),
      ]);
      setConfig(cfg); setJobs(queue);
    } catch (e: any) { setMessage({ type: "error", text: e.message }); }
  };

  useEffect(() => { loadConfig(); }, []);

  const load = async () => {
    if (!selectedId) return;
    setBusy(true); setMessage(null);
    try {
      const doc = await adminRequest(`/api/admin/trailers/${mediaType}/${selectedId}`);
      setData(doc);
      setManualUrl(doc?.manual?.url || "");
      setApplePage(doc?.providerPages?.apple_tv || "");
      setPrimePage(doc?.providerPages?.prime_video || "");
    } catch (e: any) { setMessage({ type: "error", text: e.message }); }
    finally { setBusy(false); }
  };

  const refresh = async () => {
    if (!selectedId) return;
    setBusy(true); setMessage(null);
    try {
      const doc = await adminRequest(`/api/admin/trailers/${mediaType}/${selectedId}/refresh`, { method: "POST" });
      setData(doc);
      setMessage({ type: "success", text: "Trailer risolto nuovamente. Gli override manuali sono stati preservati." });
      await loadConfig();
    } catch (e: any) { setMessage({ type: "error", text: e.message }); }
    finally { setBusy(false); }
  };

  const setManual = async (candidateId?: string) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const body = candidateId ? { candidate_id: candidateId } : { url: manualUrl.trim() };
      const doc = await adminRequest(`/api/admin/trailers/${mediaType}/${selectedId}/manual`, { method: "PUT", body: JSON.stringify(body) });
      setData(doc); setMessage({ type: "success", text: "Override manuale salvato." });
    } catch (e: any) { setMessage({ type: "error", text: e.message }); }
    finally { setBusy(false); }
  };

  const resetManual = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const doc = await adminRequest(`/api/admin/trailers/${mediaType}/${selectedId}/manual`, { method: "DELETE" });
      setData(doc); setManualUrl(""); setMessage({ type: "success", text: "Ripristinata la selezione automatica." });
    } catch (e: any) { setMessage({ type: "error", text: e.message }); }
    finally { setBusy(false); }
  };

  const saveProviderPage = async (provider: string, url: string) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const doc = await adminRequest(`/api/admin/trailers/${mediaType}/${selectedId}/provider-page`, {
        method: "PUT", body: JSON.stringify({ provider, url: url.trim() || null }),
      });
      setData(doc); setMessage({ type: "success", text: "Pagina provider salvata; contenuto messo in coda per una nuova risoluzione." });
    } catch (e: any) { setMessage({ type: "error", text: e.message }); }
    finally { setBusy(false); }
  };

  const queueCatalog = async () => {
    setBusy(true);
    try {
      const result = await adminRequest("/api/admin/trailers/catalog/queue", { method: "POST", body: JSON.stringify({ limit: 500 }) });
      setJobs(result); setMessage({ type: "success", text: `${result.queued || 0} contenuti messi/aggiornati in coda.` });
    } catch (e: any) { setMessage({ type: "error", text: e.message }); }
    finally { setBusy(false); }
  };

  const alternatives = data?.alternatives || [];
  const automaticId = data?.selected?.candidate_id;
  const manualId = data?.manual?.candidate?.candidate_id;

  return (
    <Box data-testid="trailers-admin-page">
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ color: "#fff", fontWeight: 800 }}>Trailer multi-provider</Typography>
          <Typography sx={{ color: "grey.500", mt: .5 }}>Apple TV · IMDb · Prime Video · Netflix pubblico — nessun YouTube quando il resolver è attivo.</Typography>
        </Box>
        <Button variant="contained" startIcon={<QueueIcon />} onClick={queueCatalog} disabled={busy} sx={{ bgcolor: "#e50914", alignSelf: { xs: "stretch", md: "center" } }}>Aggiorna gradualmente catalogo</Button>
      </Stack>

      {message && <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

      <Paper sx={{ p: 2.5, mb: 3, bgcolor: "#141414", color: "#fff" }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
          <Select value={mediaType} onChange={(e) => setMediaType(e.target.value)} size="small" sx={{ minWidth: 130, color: "#fff" }}>
            <MenuItem value="movie">Film</MenuItem><MenuItem value="tv">Serie TV</MenuItem>
          </Select>
          <TextField label="TMDB ID" value={tmdbId} onChange={(e) => setTmdbId(e.target.value.replace(/\D/g, ""))} size="small" sx={{ minWidth: 180 }} />
          <Button variant="outlined" onClick={load} disabled={!selectedId || busy}>Carica</Button>
          <Button variant="contained" startIcon={busy ? <CircularProgress size={16} /> : <RefreshIcon />} onClick={refresh} disabled={!selectedId || busy} sx={{ bgcolor: "#e50914" }}>Risolvi nuovamente trailer</Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2.5, mb: 3, bgcolor: "#141414", color: "#fff" }}>
        <Typography sx={{ fontWeight: 700, mb: 1.5 }}>Stato sistema</Typography>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Chip label={`Resolver: ${config?.enabled ? "ATTIVO" : "DISATTIVO"}`} color={config?.enabled ? "success" : "default"} />
          <Chip label="YouTube: DISATTIVO" color="success" />
          <Chip label={`Minimo: ${config?.minimum_resolution || 1080}p`} />
          <Chip label={`Cache metadata: ${config?.metadata_ttl_days || 14} giorni`} />
          <Chip label={`URL: ${config?.playback_ttl_hours || 3}h`} />
          <Chip label={`ffmpeg: ${config?.ffmpeg ? "OK" : "non disponibile"}`} color={config?.ffmpeg ? "success" : "warning"} />
          <Chip label={`Google discovery: ${config?.google_discovery_configured ? "OK" : "non configurata"}`} color={config?.google_discovery_configured ? "success" : "warning"} />
          {jobs?.counts && Object.entries(jobs.counts).map(([key, value]: any) => <Chip key={key} label={`${key}: ${value}`} />)}
        </Stack>
      </Paper>

      {data && (
        <>
          <Paper sx={{ p: 2.5, mb: 3, bgcolor: "#141414", color: "#fff" }}>
            <Typography sx={{ fontWeight: 700, mb: 2 }}>Override e discovery</Typography>
            <Stack spacing={2}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                <TextField fullWidth label="manualTrailerUrl (no YouTube)" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} />
                <Button variant="outlined" onClick={() => setManual()} disabled={!manualUrl.trim() || busy}>Usa URL manuale</Button>
                <Button variant="outlined" startIcon={<RestartAltIcon />} onClick={resetManual} disabled={busy}>Ripristina automatico</Button>
              </Stack>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                <TextField fullWidth label="Pagina Apple TV (opzionale, utile senza Google CSE)" value={applePage} onChange={(e) => setApplePage(e.target.value)} />
                <Button variant="outlined" onClick={() => saveProviderPage("apple_tv", applePage)} disabled={busy}>Salva Apple</Button>
              </Stack>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                <TextField fullWidth label="Pagina Prime Video (opzionale, utile senza Google CSE)" value={primePage} onChange={(e) => setPrimePage(e.target.value)} />
                <Button variant="outlined" onClick={() => saveProviderPage("prime_video", primePage)} disabled={busy}>Salva Prime</Button>
              </Stack>
            </Stack>
          </Paper>

          <Paper sx={{ p: 2.5, bgcolor: "#141414", color: "#fff" }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Alternative valide</Typography>
            <Typography sx={{ color: "grey.500", mb: 2, fontSize: 13 }}>Selezione automatica: {data?.selected ? `${data.selected.source} — ${qualityLabel(data.selected)} — ${data.selected.audio_language || "lingua n/d"}` : "nessun trailer >=1080p verificato"}</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead><TableRow><TableCell>Provider</TableCell><TableCell>Tipo</TableCell><TableCell>Qualità</TableCell><TableCell>Lingua</TableCell><TableCell>Bitrate</TableCell><TableCell>Codec</TableCell><TableCell>Confidence</TableCell><TableCell>Stato</TableCell><TableCell /></TableRow></TableHead>
                <TableBody>
                  {alternatives.map((c: any) => (
                    <TableRow key={c.candidate_id} selected={c.candidate_id === automaticId || c.candidate_id === manualId}>
                      <TableCell>{c.source}</TableCell><TableCell>{c.trailer_type}</TableCell><TableCell>{qualityLabel(c)}</TableCell><TableCell>{c.audio_language || "—"}</TableCell><TableCell>{c.bitrate ? `${(c.bitrate / 1_000_000).toFixed(1)} Mbps` : "—"}</TableCell><TableCell>{c.codec || "—"}</TableCell><TableCell>{Math.round((c.confidence || 0) * 100)}%</TableCell>
                      <TableCell>{c.candidate_id === manualId ? <Chip size="small" label="MANUALE" color="warning" /> : c.candidate_id === automaticId ? <Chip size="small" label="SELEZIONATO AUTOMATICAMENTE" color="success" /> : ""}</TableCell>
                      <TableCell><Button size="small" startIcon={<PlayCircleOutlineIcon />} onClick={() => setManual(c.candidate_id)}>Scegli</Button></TableCell>
                    </TableRow>
                  ))}
                  {!alternatives.length && <TableRow><TableCell colSpan={9} sx={{ color: "grey.500", textAlign: "center", py: 4 }}>Nessuna alternativa valida ancora risolta.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </>
      )}
    </Box>
  );
}
