// @ts-nocheck
import Popover from "@mui/material/Popover";
import Box from "@mui/material/Box";
import Avatar from "@mui/material/Avatar";
import Typography from "@mui/material/Typography";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import LogoutIcon from "@mui/icons-material/Logout";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

const ITEMS = [
  { id: "account", label: "Il mio account", hint: "Profilo, avatar, password", Icon: PersonOutlineIcon, to: "/account" },
  { id: "my-list", label: "La mia lista", hint: "Titoli salvati", Icon: BookmarkBorderIcon, to: "/my-list" },
  { id: "continue", label: "Continua a guardare", hint: "Riprendi da dove eri", Icon: PlayCircleOutlineIcon, to: "/browse#continua" },
];

const rowSx = {
  display: "flex", alignItems: "center", gap: 1.5, width: "100%", px: 1.5, py: 1.2, border: "none", borderRadius: "12px", cursor: "pointer", textAlign: "left",
  bgcolor: "transparent", color: "#fff", fontFamily: "'Inter', sans-serif", transition: "background-color 160ms ease, transform 160ms ease",
  "&:hover": { bgcolor: "rgba(255,255,255,0.07)", transform: "translateX(2px)" },
  "&:hover .pm-chevron": { opacity: 1, transform: "translateX(0)" },
};

export default function ProfileMenu({ anchorEl, onClose, user, avatarImage, onNavigate, onLogout }) {
  return (
    <Popover
      open={Boolean(anchorEl)} anchorEl={anchorEl} onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{ paper: { "data-testid": "profile-menu", sx: {
        mt: 1.5, width: 300, p: 1, borderRadius: "18px", bgcolor: "rgba(12,12,14,0.92)", backdropFilter: "blur(28px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.03) inset", overflow: "hidden",
      } } }}
    >
      <Box data-testid="profile-menu-header" sx={{ position: "relative", p: 2, borderRadius: "14px", overflow: "hidden",
        background: "linear-gradient(135deg, rgba(229,9,20,0.28) 0%, rgba(229,9,20,0.06) 60%, transparent 100%)", border: "1px solid rgba(229,9,20,0.18)" }}>
        <Box sx={{ position: "absolute", right: -30, top: -30, width: 110, height: 110, borderRadius: "50%", bgcolor: "rgba(229,9,20,0.25)", filter: "blur(30px)" }} />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, position: "relative" }}>
          <Avatar variant="rounded" src={avatarImage} sx={{ width: 48, height: 48, borderRadius: "12px", bgcolor: "#222", boxShadow: "0 6px 18px rgba(0,0,0,0.5)" }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap data-testid="profile-menu-name" sx={{ color: "#fff", fontWeight: 700, fontSize: 15, lineHeight: 1.2, fontFamily: "'Unbounded', sans-serif" }}>{user?.name || "Profilo"}</Typography>
            <Typography noWrap data-testid="profile-menu-email" sx={{ color: "rgba(255,255,255,0.55)", fontSize: 12.5, mt: 0.3 }}>{user?.email || ""}</Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 0.25 }}>
        {ITEMS.map(({ id, label, hint, Icon, to }) => (
          <Box key={id} component="button" type="button" onClick={() => onNavigate(to)} data-testid={`menu-${id}`} sx={rowSx}>
            <Box sx={{ width: 36, height: 36, borderRadius: "10px", display: "grid", placeItems: "center", bgcolor: "rgba(255,255,255,0.06)", flexShrink: 0 }}>
              <Icon sx={{ fontSize: 20, color: "rgba(255,255,255,0.85)" }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{label}</Typography>
              <Typography noWrap sx={{ fontSize: 12, color: "rgba(255,255,255,0.45)", mt: 0.2 }}>{hint}</Typography>
            </Box>
            <ChevronRightIcon className="pm-chevron" sx={{ fontSize: 18, color: "rgba(255,255,255,0.4)", opacity: 0, transform: "translateX(-4px)", transition: "opacity 160ms ease, transform 160ms ease" }} />
          </Box>
        ))}
      </Box>

      <Box sx={{ height: "1px", bgcolor: "rgba(255,255,255,0.07)", mx: 1.5, my: 1 }} />

      <Box component="button" type="button" onClick={onLogout} data-testid="menu-logout"
        sx={{ ...rowSx, py: 1.1, color: "#ff5a63", "&:hover": { bgcolor: "rgba(229,9,20,0.12)" } }}>
        <Box sx={{ width: 36, height: 36, borderRadius: "10px", display: "grid", placeItems: "center", bgcolor: "rgba(229,9,20,0.15)", flexShrink: 0 }}>
          <LogoutIcon sx={{ fontSize: 19, color: "#ff5a63" }} />
        </Box>
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Esci</Typography>
      </Box>
    </Popover>
  );
}
