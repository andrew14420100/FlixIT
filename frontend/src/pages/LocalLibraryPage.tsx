// @ts-nocheck
import { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import { Link } from "react-router-dom";
import { MAIN_PATH } from "src/constant";

function useLibrary(page) {
  const [data, setData] = useState({ items: [], total: 0 });
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    async function load() {
      const token = localStorage.getItem("user_token");
      if (!token) { if (alive) { setData({ items: [], total: 0 }); setError("Accedi al tuo account FlixIT."); } return; }
      try {
        const res = await fetch("/api/local-video/library?page=" + page, { cache: "no-store", headers: { Authorization: "Bearer " + token } });
        if (!res.ok) throw new Error("Archivio locale non disponibile");
        const next = await res.json();
        if (alive) { setData(next); setError(""); }
      } catch (e) { if (alive) setError(e.message); }
    }
    load();
    const timer = setInterval(load, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [page]);
  return { ...data, error };
}

function VideoCard({ item }) {
  const watch = "/" + MAIN_PATH.watch + "/" + item.type + "/" + item.id +
    (item.type === "tv" ? "?s=" + item.season + "&e=" + item.episode : "");
  return <Box component={Link} to={watch} sx={{ textDecoration: "none", color: "inherit", display: "block", minWidth: 0, "&:hover img": { opacity: .8 } }}>
    <Box sx={{ aspectRatio: "2/3", borderRadius: 1.5, bgcolor: "#242424", overflow: "hidden", display: "grid", placeItems: "center" }}>
      {item.poster ? <Box component="img" loading="lazy" src={"https://image.tmdb.org/t/p/w342" + item.poster} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Typography sx={{ px: 1, textAlign: "center" }}>{item.title}</Typography>}
    </Box>
    <Typography noWrap fontWeight={650} sx={{ mt: 1 }}>{item.title}</Typography>
    {item.type === "tv" && <Typography variant="caption" color="text.secondary">S{item.season} · E{item.episode}</Typography>}
    <Stack direction="row" gap={.5} sx={{ mt: .5 }} flexWrap="wrap">
      {item.quality && <Chip size="small" label={item.quality} />}
      {item.hdr && <Chip size="small" label="HDR" />}
      {item.italian && <Chip size="small" label="ITA" />}
    </Stack>
  </Box>;
}

function Shelf({ items }) {
  return <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))", lg: "repeat(6, minmax(0, 1fr))" }, gap: 2 }}>
    {items.map(item => <VideoCard key={item.key} item={item} />)}
  </Box>;
}

export function LocalLibraryPreview() {
  const { items } = useLibrary(1);
  if (!items.length) return null;
  return <Box sx={{ px: { xs: 2, md: 5 }, py: 3 }}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
      <Typography variant="h5" fontWeight={700}>Archivio locale</Typography>
      <Button component={Link} to="/archivio-locale" color="inherit">Vedi tutto</Button>
    </Stack>
    <Shelf items={items.slice(0, 6)} />
  </Box>;
}

export function Component() {
  const [page, setPage] = useState(1);
  const { items, total, error } = useLibrary(page);
  return <Stack spacing={3} sx={{ px: { xs: 2, md: 5 }, pt: 12, pb: 6 }}>
    <Typography variant="h4" fontWeight={800}>Archivio locale</Typography>
    <Typography color="text.secondary">Contenuti importati e analizzati da FlixIT Studio</Typography>
    {error && <Alert severity="info">{error}</Alert>}
    {!error && !items.length && <Typography>Nessun contenuto disponibile.</Typography>}
    <Shelf items={items} />
    <Stack direction="row" gap={2}><Button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Indietro</Button><Button disabled={page * 24 >= total} onClick={() => setPage(p => p + 1)}>Avanti</Button></Stack>
  </Stack>;
}
