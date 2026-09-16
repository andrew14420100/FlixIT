// @ts-nocheck
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Badge from "@mui/material/Badge";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import LockResetIcon from "@mui/icons-material/LockReset";
import DoneAllIcon from "@mui/icons-material/DoneAll";

const ICONS = { ticket_reply: ConfirmationNumberOutlinedIcon, ticket_status: ConfirmationNumberOutlinedIcon, ticket_new: ConfirmationNumberOutlinedIcon, ticket_message: ConfirmationNumberOutlinedIcon, notice: CampaignOutlinedIcon, password_reset: LockResetIcon };

export const timeAgo = (iso) => {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "adesso";
  if (diff < 3600) return `${Math.floor(diff / 60)} min fa`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h fa`;
  return `${Math.floor(diff / 86400)} g fa`;
};

export const bellPaperSx = {
  mt: 1.5, width: 360, maxWidth: "calc(100vw - 24px)", p: 1, borderRadius: "18px", bgcolor: "rgba(12,12,14,0.94)", backdropFilter: "blur(28px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 30px 80px rgba(0,0,0,0.7)", overflow: "hidden",
};

// Shared bell UI (main site + admin). `onOpenLink` decides where a notification navigates.
export function BellPopover({ items, unread, markRead, onOpenLink, testId = "notifications" }) {
  const [anchor, setAnchor] = useState(null);

  const open = (n) => { if (!n.read) markRead([n.id]); setAnchor(null); onOpenLink(n.link); };

  return (
    <>
      <IconButton onClick={(e) => setAnchor(e.currentTarget)} data-testid={`${testId}-bell`} aria-label="Notifiche"
        sx={{ color: "#fff", width: 42, height: 42, "&:hover": { bgcolor: "rgba(255,255,255,0.08)" } }}>
        <Badge badgeContent={unread} max={99} color="error" data-testid={`${testId}-badge`}
          sx={{ "& .MuiBadge-badge": { fontWeight: 700, fontSize: 10.5, minWidth: 18, height: 18, bgcolor: "#E50914", boxShadow: "0 0 0 2px #0a0a0a" } }}>
          <NotificationsNoneIcon sx={{ fontSize: 26 }} />
        </Badge>
      </IconButton>
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: bellPaperSx, "data-testid": `${testId}-menu` } }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.5, pt: 1, pb: 0.5 }}>
          <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 15, fontFamily: "'Unbounded', sans-serif" }}>Notifiche</Typography>
          {unread > 0 && (
            <Box component="button" type="button" onClick={() => markRead(null)} data-testid={`${testId}-mark-all`}
              sx={{ display: "flex", alignItems: "center", gap: 0.5, border: "none", background: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", "&:hover": { color: "#fff" } }}>
              <DoneAllIcon sx={{ fontSize: 16 }} /> Segna tutte lette
            </Box>
          )}
        </Box>
        <Box sx={{ maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 0.25, pr: 0.25 }}>
          {items.length === 0 && (
            <Typography data-testid={`${testId}-empty`} sx={{ color: "rgba(255,255,255,0.45)", fontSize: 13.5, textAlign: "center", py: 4 }}>Nessuna notifica</Typography>
          )}
          {items.map((n) => {
            const Icon = ICONS[n.type] || CampaignOutlinedIcon;
            return (
              <Box key={n.id} component="button" type="button" onClick={() => open(n)} data-testid={`notification-${n.id}`} data-read={n.read ? "true" : "false"}
                sx={{ display: "flex", gap: 1.5, width: "100%", textAlign: "left", px: 1.5, py: 1.2, border: "none", borderRadius: "12px", cursor: "pointer",
                  bgcolor: n.read ? "transparent" : "rgba(229,9,20,0.09)", color: "#fff", fontFamily: "'Inter', sans-serif", transition: "background-color 160ms ease",
                  "&:hover": { bgcolor: n.read ? "rgba(255,255,255,0.06)" : "rgba(229,9,20,0.15)" } }}>
                <Box sx={{ width: 36, height: 36, borderRadius: "10px", display: "grid", placeItems: "center", flexShrink: 0, bgcolor: n.read ? "rgba(255,255,255,0.06)" : "rgba(229,9,20,0.18)" }}>
                  <Icon sx={{ fontSize: 19, color: n.read ? "rgba(255,255,255,0.75)" : "#ff5a63" }} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap sx={{ fontSize: 13.5, fontWeight: n.read ? 500 : 700, lineHeight: 1.25 }}>{n.title}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", mt: 0.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.body}</Typography>
                  <Typography sx={{ fontSize: 11, color: "rgba(255,255,255,0.38)", mt: 0.4 }}>{timeAgo(n.created_at)}</Typography>
                </Box>
                {!n.read && <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "#E50914", mt: 1.2, flexShrink: 0 }} />}
              </Box>
            );
          })}
        </Box>
      </Popover>
    </>
  );
}

export default function NotificationsBell({ notifications }) {
  const navigate = useNavigate();
  return <BellPopover items={notifications.items} unread={notifications.unread} markRead={notifications.markRead} onOpenLink={(link) => navigate(link || "/account")} testId="notifications" />;
}
