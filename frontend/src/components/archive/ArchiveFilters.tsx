// @ts-nocheck
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import FilterDropdown, { ratingOption } from "./FilterDropdown";

export const FILTER_KEYS = ["q", "type", "genre", "country", "year", "rating", "views", "provider", "age", "quality"];

const DROPDOWNS = [
  { id: "type", label: "Tipo", source: "types" },
  { id: "genre", label: "Genere", source: "genres" },
  { id: "country", label: "Paese", source: "countries" },
  { id: "year", label: "Anno", source: "years" },
  { id: "rating", label: "Valutazione", source: "ratings", renderOption: ratingOption },
  { id: "views", label: "Views", source: "views" },
  { id: "provider", label: "Servizio", source: "providers" },
  { id: "age", label: "Età", source: "ages" },
  { id: "quality", label: "Qualità", source: "qualities" },
];

export default function ArchiveFilters({ options, filters, onChange, onReset }) {
  const [text, setText] = useState(filters.q || "");
  const activeCount = FILTER_KEYS.filter((k) => k !== "q" && filters[k]).length + (filters.q ? 1 : 0);

  useEffect(() => { setText(filters.q || ""); }, [filters.q]);
  useEffect(() => {
    const t = setTimeout(() => { if ((text || "") !== (filters.q || "")) onChange("q", text || null); }, 350);
    return () => clearTimeout(t);
  }, [text]);

  const genreOptions = (options?.genres || []).map((g) => ({ key: g.id, label: g.name }));

  return (
    <Box data-testid="archive-filters" sx={{ display: "flex", flexWrap: "wrap", gap: 1.2, alignItems: "center" }}>
      <Box sx={{ position: "relative", flex: "1.4 1 200px", minWidth: 200 }}>
        <SearchIcon sx={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 20, color: "rgba(255,255,255,0.5)", pointerEvents: "none" }} />
        <Box component="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Cerca per titolo..." data-testid="archive-search-input"
          sx={{ width: "100%", height: 44, pl: 5.2, pr: text ? 5 : 2, borderRadius: "10px", border: "1px solid rgba(255,255,255,0.09)", bgcolor: "rgba(255,255,255,0.05)", color: "#fff",
            fontFamily: "'Inter', sans-serif", fontSize: 14, outline: "none", transition: "border-color 200ms ease, background-color 200ms ease, box-shadow 200ms ease",
            "&::placeholder": { color: "rgba(255,255,255,0.45)" }, "&:hover": { bgcolor: "rgba(255,255,255,0.08)" },
            "&:focus": { borderColor: "#E50914", boxShadow: "0 0 0 3px rgba(229,9,20,0.22)" } }} />
        {text && (
          <Box component="button" type="button" onClick={() => setText("")} aria-label="Cancella ricerca" data-testid="archive-search-clear"
            sx={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", display: "flex", "&:hover": { color: "#fff" } }}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </Box>
        )}
      </Box>

      {DROPDOWNS.map((d) => (
        <FilterDropdown key={d.id} id={d.id} label={d.label} value={filters[d.id] ?? null} onChange={(v) => onChange(d.id, v)} renderOption={d.renderOption}
          options={d.id === "genre" ? genreOptions : options?.[d.source] || []} />
      ))}

      {activeCount > 0 && (
        <Box component="button" type="button" onClick={onReset} data-testid="archive-reset-filters"
          sx={{ height: 44, px: 2, borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", bgcolor: "transparent", color: "#fff", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 0.8, transition: "background-color 200ms ease, border-color 200ms ease", "&:hover": { bgcolor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.3)" } }}>
          <CloseIcon sx={{ fontSize: 17 }} /> Azzera ({activeCount})
        </Box>
      )}
    </Box>
  );
}
