// @ts-nocheck
import { useState } from "react";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import StarIcon from "@mui/icons-material/Star";

const ROWS_PER_COLUMN = 10;

// Filter button + popover with radio-style options laid out in columns.
export default function FilterDropdown({ id, label, options = [], value, onChange, renderOption, testId }) {
  const [anchor, setAnchor] = useState(null);
  const selected = options.find((o) => String(o.key) === String(value));
  const active = value !== undefined && value !== null && value !== "";
  const columns = Math.max(1, Math.ceil(options.length / ROWS_PER_COLUMN));

  const pick = (key) => { onChange(String(key) === String(value) ? null : key); setAnchor(null); };

  return (
    <>
      <Box component="button" type="button" onClick={(e) => setAnchor(e.currentTarget)} data-testid={testId || `archive-filter-${id}`}
        aria-haspopup="true" aria-expanded={Boolean(anchor)}
        sx={{
          height: 44, px: 1.8, minWidth: 0, flex: "1 1 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, cursor: "pointer",
          borderRadius: "10px", border: `1px solid ${active ? "rgba(229,9,20,0.7)" : "rgba(255,255,255,0.09)"}`,
          bgcolor: active ? "rgba(229,9,20,0.12)" : "rgba(255,255,255,0.05)", color: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: active ? 600 : 500,
          transition: "background-color 200ms ease, border-color 200ms ease, transform 150ms ease",
          "&:hover": { bgcolor: active ? "rgba(229,9,20,0.18)" : "rgba(255,255,255,0.09)", borderColor: active ? "#E50914" : "rgba(255,255,255,0.18)" },
        }}>
        <Typography component="span" noWrap sx={{ fontSize: 14, fontWeight: "inherit" }}>{selected ? selected.label : label}</Typography>
        <KeyboardArrowDownIcon sx={{ fontSize: 20, color: active ? "#ff5a63" : "rgba(255,255,255,0.5)", transition: "transform 250ms ease", transform: anchor ? "rotate(180deg)" : "none", flexShrink: 0 }} />
      </Box>

      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "bottom", horizontal: "left" }} transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { mt: 1, bgcolor: "rgba(14,14,16,0.97)", backdropFilter: "blur(24px)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", boxShadow: "0 24px 64px rgba(0,0,0,0.65)", p: 1.5 }, "data-testid": `archive-filter-${id}-menu` } }}>
        <Box sx={{ display: "grid", gridAutoFlow: "column", gridTemplateRows: `repeat(${Math.min(ROWS_PER_COLUMN, options.length)}, auto)`, gridTemplateColumns: `repeat(${columns}, minmax(150px, auto))`, columnGap: 1 }}>
          {options.map((o) => {
            const on = String(o.key) === String(value);
            return (
              <Box key={o.key} component="button" type="button" onClick={() => pick(o.key)} data-testid={`archive-option-${id}-${o.key}`}
                sx={{ display: "flex", alignItems: "center", gap: 1.2, px: 1.2, py: 0.9, border: "none", borderRadius: "8px", cursor: "pointer", textAlign: "left",
                  bgcolor: on ? "rgba(229,9,20,0.15)" : "transparent", color: on ? "#fff" : "rgba(255,255,255,0.8)", fontFamily: "'Inter', sans-serif", fontSize: 14,
                  transition: "background-color 150ms ease, color 150ms ease", "&:hover": { bgcolor: "rgba(255,255,255,0.07)", color: "#fff" } }}>
                <Box sx={{ width: 14, height: 14, borderRadius: "50%", flexShrink: 0, border: `2px solid ${on ? "#E50914" : "rgba(255,255,255,0.45)"}`, bgcolor: on ? "#E50914" : "transparent", boxShadow: on ? "0 0 0 3px rgba(229,9,20,0.25)" : "none", transition: "all 150ms ease" }} />
                {renderOption ? renderOption(o) : o.label}
              </Box>
            );
          })}
        </Box>
      </Popover>
    </>
  );
}

// 1..10 progressive stars: N filled, the rest dimmed
export const ratingOption = (o) => {
  const n = Number(o.key) || 0;
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 1 }} data-testid={`rating-stars-${n}`}>
      <Box component="span" sx={{ display: "inline-flex", gap: "1px" }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <StarIcon key={i} sx={{ fontSize: 13, color: i < n ? "#f5c518" : "rgba(255,255,255,0.18)" }} />
        ))}
      </Box>
      <Box component="span" sx={{ fontSize: 13, color: "rgba(255,255,255,0.7)", minWidth: 58 }}>{o.label}</Box>
    </Box>
  );
};
