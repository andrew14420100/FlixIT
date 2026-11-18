// @ts-nocheck
import React, { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, LinearProgress, Paper, Stack, Typography } from "@mui/material";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import { Link } from "react-router-dom";

const API = "/api/admin/studio/v1";
async function api(path, init = {}) {
  const token = localStorage.getItem("admin_token");
  if (!token) throw new Error("Accedere come superadmin");
  const result = await fetch(API + path, {
    ...init, cache: "no-store", headers: { ...init.headers, Authorization: "Bearer " + token },
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(typeof data.detail === "string" ? data.detail : "HTTP " + result.status);
  return data;
}
const formatSize = n => (Number(n || 0) / 1024 ** 3).toFixed(2) + " GB";

export default function StudioPage() {
  const input = useRef(null);
  const [selected, setSelected] = useState([]);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState({ items: [], free: 0 });
  const [progress, setProgress] = useState({});
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);

  async function refresh() {
    try { setRemote(await api("/jobs")); setError(""); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer); }, []);
  const key = f => f.name + "|" + f.size + "|" + f.lastModified;
  function add(files) {
    if (busy) return;
    const candidates = Array.from(files || []).filter(f => /\.mp4$/i.test(f.name));
    if (candidates.length !== files.length) setError("Sono accettati soltanto file MP4.");
    setSelected(old => [...new Map([...old, ...candidates].map(f => [key(f), f])).values()]);
  }
  const patch = (f, data) => setProgress(p => ({ ...p, [key(f)]: { ...p[key(f)], ...data } }));

  async function transfer(file) {
    const fingerprint = "flixit-studio:" + key(file);
    let id = localStorage.getItem(fingerprint);
    patch(file, { status: "Identificazione TMDB...", error: "" });
    try {
      let job;
      if (id) {
        job = await api("/jobs/" + id);
        if (job.name !== file.name || job.size !== file.size) throw new Error("Il file non coincide con il caricamento salvato");
      } else {
        job = await api("/start", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, size: file.size, authorized: true }) });
        id = job.id;
        localStorage.setItem(fingerprint, id);
      }
      if (job.state !== "uploading") {
        patch(file, { percent: 100, status: "In archivio / elaborazione" }); return;
      }
      let at = job.offset;
      const chunkSize = 4 * 1024 ** 2;
      while (at < file.size) {
        patch(file, { status: "Caricamento", percent: Math.floor(at * 100 / file.size) });
        const block = file.slice(at, Math.min(at + chunkSize, file.size));
        try {
          const response = await api("/jobs/" + id + "/chunk?at=" + at, {
            method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: block,
          });
          at = response.offset;
        } catch (e) {
          // Response may have been lost after a successful write.
          const recovered = await api("/jobs/" + id).catch(() => null);
          if (recovered && recovered.offset > at) { at = recovered.offset; continue; }
          throw e;
        }
      }
      await api("/jobs/" + id + "/finish", { method: "POST" });
      patch(file, { percent: 100, status: "Caricato · elaborazione automatica" });
    } catch (e) { patch(file, { status: "Interrotto", error: e.message }); }
  }

  async function uploadAll() {
    if (busy || !authorized || !selected.length) return;
    setBusy(true);
    const queue = [...selected];
    async function worker() { while (queue.length) await transfer(queue.shift()); }
    try { await Promise.all([worker(), worker()]); }
    finally { setBusy(false); refresh(); }
  }

  async function cancel(job) {
    if (busy) return;
    try {
      await api("/jobs/" + job.id, { method: "DELETE" });
      for (const k of Object.keys(localStorage)) if (k.startsWith("flixit-studio:") && localStorage.getItem(k) === job.id) localStorage.removeItem(k);
      refresh();
    } catch (e) { setError(e.message); }
  }

  return <Stack spacing={3}>
    <Box><Typography variant="overline" color="text.secondary">GESTIONE MULTIMEDIALE</Typography>
      <Typography variant="h4" fontWeight={800}>FlixIT Studio</Typography>
      <Typography color="text.secondary">Caricamento multiplo MP4 · massimo due file in parallelo · elaborazione automatica</Typography>
    </Box>
    {error && <Alert severity="warning">{error}</Alert>}
    <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
      {[["Spazio libero", formatSize(remote.free)], ["In elaborazione", remote.items.filter(j => j.state === "processing").length], ["Pronti in archivio", remote.items.filter(j => j.state === "ready").length]].map(([label, value]) =>
        <Paper key={label} variant="outlined" sx={{ p: 2.5, flex: 1 }}><Typography color="text.secondary">{label}</Typography><Typography variant="h4" fontWeight={700}>{value}</Typography></Paper>)}
    </Stack>
    <Paper variant="outlined" onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
      sx={{ p: 5, textAlign: "center", borderStyle: "dashed", borderColor: drag ? "#e50914" : "divider", bgcolor: drag ? "action.hover" : "background.paper" }}>
      <CloudUploadOutlinedIcon sx={{ fontSize: 48, color: "text.secondary" }} />
      <Typography variant="h6" fontWeight={700}>Trascina qui i video</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>MP4 · fino a 20 GB per file, se lo spazio lo consente</Typography>
      <Button variant="contained" disabled={busy} onClick={() => input.current?.click()}>Seleziona file</Button>
      <input ref={input} type="file" accept=".mp4,video/mp4" multiple hidden onChange={e => { add(e.target.files); e.target.value = ""; }} />
    </Paper>
    <FormControlLabel control={<Checkbox checked={authorized} disabled={busy} onChange={e => setAuthorized(e.target.checked)} />}
      label="Confermo di possedere i diritti necessari per distribuire i video caricati." />
    <Stack direction="row" gap={2} flexWrap="wrap">
      <Button variant="contained" disabled={busy || !authorized || !selected.length} onClick={uploadAll}>{busy ? "Caricamento..." : "Carica o riprendi tutti"}</Button>
      <Button component={Link} to="/archivio-locale" variant="outlined">Apri archivio locale</Button>
      <Button disabled={busy} onClick={() => { setSelected([]); setProgress({}); }}>Svuota selezione</Button>
    </Stack>
    {selected.map(f => { const p = progress[key(f)] || {}; return <Paper key={key(f)} variant="outlined" sx={{ p: 2 }}>
      <Typography noWrap fontWeight={600}>{f.name}</Typography><Typography variant="caption" color="text.secondary">{formatSize(f.size)} · {p.status || "Da caricare"}</Typography>
      <LinearProgress variant="determinate" value={p.percent || 0} sx={{ my: 1, height: 6, borderRadius: 3 }} />
      <Typography variant="caption">{p.percent || 0}%</Typography>{p.error && <Alert severity="error">{p.error}</Alert>}
    </Paper>; })}
    <Typography variant="h6">Coda e archivio</Typography>
    {remote.items.length === 0 && <Typography color="text.secondary">Nessun caricamento registrato.</Typography>}
    {remote.items.map(j => <Paper key={j.id} variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
        <Box sx={{ minWidth: 0 }}><Typography noWrap fontWeight={600}>{j.title}</Typography><Typography variant="caption" color="text.secondary">{j.key} · {formatSize(j.size)}</Typography></Box>
        <Chip size="small" color={j.state === "ready" ? "success" : "default"} label={j.state === "ready" ? "In archivio" : j.state === "processing" ? "In attesa / elaborazione" : "Da completare"} />
      </Stack>
      {j.state === "uploading" && <><LinearProgress variant="determinate" value={Math.min(100, 100 * j.offset / j.size)} sx={{ my: 1 }} /><Button size="small" disabled={busy} color="error" onClick={() => cancel(j)}>Annulla caricamento</Button></>}
    </Paper>)}
    <Alert severity="info">Se un titolo è ambiguo, rinomina il file aggiungendo [tmdb-ID]. Per le serie usa Titolo S01E01.mp4. I file vengono pubblicati nell'archivio dopo l'analisi FFprobe; il player dipende dal codec disponibile nel browser. L'importatore deve rimanere in esecuzione.</Alert>
  </Stack>;
}
