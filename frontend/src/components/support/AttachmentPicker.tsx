// @ts-nocheck
import { useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import AddPhotoAlternateOutlinedIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import CloseIcon from "@mui/icons-material/Close";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";

// Screenshot picker: uploads immediately to /api/tickets/upload and returns attachment ids to the parent.
export default function AttachmentPicker({ token, value = [], onChange, testId = "attachments" }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const pick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setError(null);
    const added = [];
    for (const f of files.slice(0, 4 - value.length)) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        const res = await fetch(`${API_URL}/api/tickets/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Caricamento non riuscito");
        added.push({ ...data, preview: URL.createObjectURL(f) });
      } catch (err) {
        setError(err.message);
      }
    }
    onChange([...value, ...added]);
    setUploading(false);
  };

  return (
    <Box data-testid={testId}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        {value.map((a) => (
          <Box key={a.id} sx={{ position: "relative", width: 72, height: 72, borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" }} data-testid={`${testId}-item-${a.id}`}>
            <img src={a.preview} alt={a.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <Box component="button" type="button" onClick={() => onChange(value.filter((x) => x.id !== a.id))} aria-label="Rimuovi allegato"
              sx={{ position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: "50%", border: "none", bgcolor: "rgba(0,0,0,0.7)", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }}>
              <CloseIcon sx={{ fontSize: 13 }} />
            </Box>
          </Box>
        ))}
        {value.length < 4 && (
          <Box component="button" type="button" onClick={() => inputRef.current?.click()} disabled={uploading} data-testid={`${testId}-add`}
            sx={{ width: 72, height: 72, borderRadius: "10px", border: "1px dashed rgba(255,255,255,0.3)", bgcolor: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.7)", cursor: "pointer", display: "grid", placeItems: "center",
              transition: "border-color 200ms ease, color 200ms ease", "&:hover": { borderColor: "#E50914", color: "#fff" } }}>
            {uploading ? <CircularProgress size={20} sx={{ color: "#E50914" }} /> : <AddPhotoAlternateOutlinedIcon sx={{ fontSize: 26 }} />}
          </Box>
        )}
        <Typography sx={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Screenshot (png/jpg, max 5 MB, fino a 4)</Typography>
      </Box>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={pick} data-testid={`${testId}-input`} />
      {error && <Typography data-testid={`${testId}-error`} sx={{ fontSize: 12.5, color: "#ff6b72", mt: 0.8 }}>{error}</Typography>}
    </Box>
  );
}
