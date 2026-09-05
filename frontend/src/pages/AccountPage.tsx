// @ts-nocheck
import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import SupportAgentOutlinedIcon from "@mui/icons-material/SupportAgentOutlined";
import TicketsPanel from "src/components/support/TicketsPanel";
import {
  Box,
  Container,
  Typography,
  TextField,
  Button,
  Avatar,
  Divider,
  Alert,
  CircularProgress,
  IconButton,
  InputAdornment,
  LinearProgress,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import SaveIcon from "@mui/icons-material/Save";
import CloseIcon from "@mui/icons-material/Close";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import LogoutIcon from "@mui/icons-material/Logout";
import PersonIcon from "@mui/icons-material/Person";
import SettingsIcon from "@mui/icons-material/Settings";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import { MAIN_PATH } from "src/constant";
import { useContinueWatching, ContinueWatchingItem } from "src/hooks/useContinueWatching";
import { useAuthModal } from "src/store/authModal";

const API_URL = "";

import { AVATARS, avatarSrc } from "src/config/avatars";

interface User {
  id: string;
  email: string;
  name: string;
  profileImage: string | null;
}

export function Component() {
  const navigate = useNavigate();
  const { items: watchItems } = useContinueWatching();
  const openAuthModal = useAuthModal((st) => st.openModal);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const initialSection = searchParams.get("ticket") || searchParams.get("section") === "support" ? "support" : "profile";
  const [activeSection, setActiveSection] = useState<"profile" | "watching" | "settings" | "support">(initialSection);
  useEffect(() => { if (searchParams.get("ticket")) setActiveSection("support"); }, [searchParams]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);

  // Login/Register states
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  const token = localStorage.getItem("user_token");

  useEffect(() => {
    if (token) {
      fetchUserProfile();
      setIsLoggedIn(true);
    } else {
      setLoading(false);
      setIsLoggedIn(false);
    }
  }, [token]);

  const fetchUserProfile = async () => {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        localStorage.removeItem("user_token");
        setIsLoggedIn(false);
        setLoading(false);
        return;
      }
      const data = await response.json();
      setUser(data);
      setName(data.name);
      setEmail(data.email);
      setSelectedAvatar(data.profileImage);
      setIsLoggedIn(true);
    } catch {
      setError("Errore nel caricamento del profilo");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Credenziali non valide");
      }
      const data = await response.json();
      localStorage.setItem("user_token", data.token);
      setUser(data.user);
      setName(data.user.name);
      setEmail(data.user.email);
      setIsLoggedIn(true);
      setSuccess("Accesso effettuato!");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRegister = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: registerEmail, password: registerPassword, name: registerName }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Errore nella registrazione");
      }
      const data = await response.json();
      localStorage.setItem("user_token", data.token);
      setUser(data.user);
      setName(data.user.name);
      setEmail(data.user.email);
      setIsLoggedIn(true);
      setSuccess("Registrazione completata!");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    setError(null);
    try {
      const updates: any = {};
      if (name !== user?.name) updates.name = name;
      if (email !== user?.email) updates.email = email;
      if (password) updates.password = password;
      if (selectedAvatar !== user?.profileImage) updates.profileImage = selectedAvatar;

      const response = await fetch(`${API_URL}/api/auth/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Errore nell'aggiornamento");
      }
      const data = await response.json();
      if (data.token) localStorage.setItem("user_token", data.token);
      setUser(data);
      setPassword("");
      setEditMode(false);
      setShowAvatarPicker(false);
      setSuccess("Profilo aggiornato!");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("user_token");
    setUser(null);
    setIsLoggedIn(false);
    navigate(`/${MAIN_PATH.browse}`);
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm("Sei sicuro di voler eliminare il tuo account? Questa azione non può essere annullata.")) return;
    try {
      const response = await fetch(`${API_URL}/api/auth/profile`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        localStorage.removeItem("user_token");
        setUser(null);
        setIsLoggedIn(false);
        navigate(`/${MAIN_PATH.browse}`);
      }
    } catch {
      setError("Errore nell'eliminazione dell'account");
    }
  };

  const handleWatchClick = useCallback((item: ContinueWatchingItem) => {
    const base = `/${MAIN_PATH.watch}/${item.media_type}/${item.tmdb_id}`;
    if (item.media_type === "tv") {
      navigate(`${base}?s=${item.season || 1}&e=${item.episode || 1}${item.progress > 30 ? `&t=${Math.floor(item.progress)}` : ""}`);
    } else {
      navigate(`${base}${item.progress > 30 ? `?t=${Math.floor(item.progress)}` : ""}`);
    }
  }, [navigate]);

  const getAvatarProps = () => ({
    variant: "rounded",
    src: avatarSrc(selectedAvatar || user?.profileImage),
    sx: { width: 100, height: 100, borderRadius: "10px", bgcolor: "#222", border: "3px solid rgba(255,255,255,0.15)" },
  });

  // --- LOADING ---
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" bgcolor="#0a0a0a">
        <CircularProgress sx={{ color: "#e50914" }} />
      </Box>
    );
  }

  // --- LOGGED OUT: profile page only, auth lives in the header modal ---
  if (!isLoggedIn) {
    return (
      <Box sx={{ minHeight: "100vh", bgcolor: "#0a0a0a", pt: 14, pb: 8 }} data-testid="account-logged-out">
        <Container maxWidth="sm">
          <Box sx={{ bgcolor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 3, p: { xs: 4, sm: 6 }, textAlign: "left" }}>
            <PersonIcon sx={{ fontSize: 44, color: "#E50914", mb: 2 }} />
            <Typography sx={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: 24, color: "#fff", mb: 1 }}>Il tuo profilo</Typography>
            <Typography color="grey.500" sx={{ mb: 4 }}>Accedi per gestire il profilo, la tua lista e riprendere da dove hai lasciato.</Typography>
            <Box display="flex" gap={1.5} flexWrap="wrap">
              <Button variant="contained" onClick={() => openAuthModal("login")} data-testid="account-open-login"
                sx={{ bgcolor: "#E50914", fontWeight: 700, textTransform: "none", px: 3.5, py: 1.2, borderRadius: 2, "&:hover": { bgcolor: "#F6121D" } }}>
                Accedi
              </Button>
              <Button variant="outlined" onClick={() => openAuthModal("register")} data-testid="account-open-register"
                sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)", fontWeight: 600, textTransform: "none", px: 3.5, py: 1.2, borderRadius: 2, "&:hover": { borderColor: "#fff", bgcolor: "rgba(255,255,255,0.06)" } }}>
                Registrati
              </Button>
            </Box>
          </Box>
        </Container>
      </Box>
    );
  }

  // --- LOGGED IN - ACCOUNT PAGE ---
  const sideNav = [
    { key: "profile" as const, label: "Profilo", icon: <PersonIcon /> },
    { key: "watching" as const, label: "Continua a guardare", icon: <PlayCircleOutlineIcon />, badge: watchItems.length },
    { key: "support" as const, label: "Assistenza", icon: <SupportAgentOutlinedIcon /> },
    { key: "settings" as const, label: "Impostazioni", icon: <SettingsIcon /> },
  ];

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#0a0a0a", pt: { xs: 10, sm: 12 }, pb: 8 }} data-testid="account-page">
      <Container maxWidth="lg">
        {error && <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }} onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 3, borderRadius: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}

        <Box sx={{ display: "flex", gap: { xs: 0, md: 4 }, flexDirection: { xs: "column", md: "row" } }}>

          {/* Sidebar Navigation */}
          <Box sx={{
            width: { xs: "100%", md: 260 },
            flexShrink: 0,
            mb: { xs: 3, md: 0 },
          }}>
            {/* User Card */}
            <Box sx={{
              bgcolor: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 3,
              p: 3,
              mb: 2,
              textAlign: "center",
            }}>
              <Avatar {...getAvatarProps()} sx={{ ...getAvatarProps().sx, mx: "auto", mb: 2 }} data-testid="user-avatar" />
              <Typography variant="h6" color="#fff" fontWeight={600}>{user?.name}</Typography>
              <Typography variant="body2" color="grey.500" sx={{ mt: 0.5 }}>{user?.email}</Typography>
            </Box>

            {/* Nav Items */}
            <Box sx={{
              display: { xs: "flex", md: "block" },
              gap: 1,
              overflowX: { xs: "auto", md: "visible" },
            }}>
              {sideNav.map((item) => (
                <Button
                  key={item.key}
                  fullWidth
                  startIcon={item.icon}
                  onClick={() => setActiveSection(item.key)}
                  data-testid={`nav-${item.key}`}
                  sx={{
                    justifyContent: "flex-start",
                    color: activeSection === item.key ? "#fff" : "grey.500",
                    bgcolor: activeSection === item.key ? "rgba(229,9,20,0.15)" : "transparent",
                    borderLeft: { md: activeSection === item.key ? "3px solid #e50914" : "3px solid transparent" },
                    borderBottom: { xs: activeSection === item.key ? "2px solid #e50914" : "none", md: "none" },
                    borderRadius: { xs: 0, md: 1 },
                    py: 1.5,
                    px: 2,
                    mb: { md: 0.5 },
                    textTransform: "none",
                    fontWeight: activeSection === item.key ? 600 : 400,
                    whiteSpace: "nowrap",
                    transition: "all 0.2s ease",
                    "&:hover": { bgcolor: "rgba(255,255,255,0.06)", color: "#fff" },
                    "& .MuiBadge-badge": { bgcolor: "#e50914" },
                  }}
                >
                  {item.label}
                  {item.badge ? (
                    <Box sx={{ ml: "auto", bgcolor: "#e50914", color: "#fff", borderRadius: "50%", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                      {item.badge}
                    </Box>
                  ) : null}
                </Button>
              ))}
            </Box>
          </Box>

          {/* Main Content */}
          <Box sx={{ flex: 1, minWidth: 0 }}>

            {/* === PROFILO === */}
            {activeSection === "profile" && (
              <Box sx={{ bgcolor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 3, p: { xs: 3, sm: 4 } }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
                  <Typography variant="h5" color="#fff" fontWeight={700}>Profilo</Typography>
                  {!editMode ? (
                    <Button startIcon={<EditIcon />} onClick={() => setEditMode(true)}
                      sx={{ color: "#e50914", textTransform: "none", fontWeight: 600 }} data-testid="edit-profile-btn">
                      Modifica
                    </Button>
                  ) : (
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Button startIcon={<CloseIcon />} onClick={() => { setEditMode(false); setName(user?.name || ""); setEmail(user?.email || ""); setPassword(""); }}
                        sx={{ color: "grey.400", textTransform: "none" }}>Annulla</Button>
                      <Button startIcon={<SaveIcon />} variant="contained" onClick={handleSaveProfile} disabled={saving}
                        sx={{ bgcolor: "#e50914", textTransform: "none", fontWeight: 600, "&:hover": { bgcolor: "#b20710" } }} data-testid="save-profile-btn">
                        {saving ? <CircularProgress size={20} /> : "Salva"}
                      </Button>
                    </Box>
                  )}
                </Box>

                {/* Avatar Picker */}
                {editMode && (
                  <Box sx={{ mb: 4 }}>
                    <Typography variant="subtitle2" color="grey.400" mb={1.5}>Scegli avatar</Typography>
                    <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
                      {AVATARS.map((opt) => (
                        <Avatar key={opt.id}
                          variant="rounded"
                          src={opt.src}
                          alt={opt.label}
                          onClick={() => setSelectedAvatar(opt.id)}
                          data-testid={`avatar-option-${opt.id}`}
                          sx={{
                            width: 64, height: 64, borderRadius: "8px", bgcolor: opt.color, cursor: "pointer",
                            border: selectedAvatar === opt.id ? "3px solid #fff" : "3px solid transparent",
                            transition: "transform 0.2s ease, border-color 0.2s ease",
                            "&:hover": { transform: "scale(1.08)", border: "3px solid rgba(255,255,255,0.5)" },
                          }}
                        />
                      ))}
                    </Box>
                  </Box>
                )}

                <Divider sx={{ borderColor: "rgba(255,255,255,0.08)", mb: 3 }} />

                <Box display="flex" flexDirection="column" gap={2.5}>
                  <Box>
                    <Typography variant="caption" color="grey.500" mb={0.5} display="block">Nome utente</Typography>
                    {editMode ? (
                      <TextField value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" variant="outlined"
                        sx={{ "& .MuiOutlinedInput-root": { bgcolor: "rgba(255,255,255,0.06)", borderRadius: 1.5 } }} data-testid="name-input" />
                    ) : (
                      <Typography color="#fff" fontSize={16}>{user?.name}</Typography>
                    )}
                  </Box>
                  <Box>
                    <Typography variant="caption" color="grey.500" mb={0.5} display="block">Email</Typography>
                    {editMode ? (
                      <TextField type="email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth size="small" variant="outlined"
                        sx={{ "& .MuiOutlinedInput-root": { bgcolor: "rgba(255,255,255,0.06)", borderRadius: 1.5 } }} data-testid="email-edit-input" />
                    ) : (
                      <Typography color="#fff" fontSize={16}>{user?.email}</Typography>
                    )}
                  </Box>
                  {editMode && (
                    <Box>
                      <Typography variant="caption" color="grey.500" mb={0.5} display="block">Nuova password (opzionale)</Typography>
                      <TextField type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} fullWidth size="small" variant="outlined"
                        placeholder="Lascia vuoto per non cambiare"
                        sx={{ "& .MuiOutlinedInput-root": { bgcolor: "rgba(255,255,255,0.06)", borderRadius: 1.5 } }}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton onClick={() => setShowPassword(!showPassword)} size="small" sx={{ color: "grey.400" }}>
                                {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                        data-testid="password-edit-input"
                      />
                    </Box>
                  )}
                </Box>

                <Divider sx={{ borderColor: "rgba(255,255,255,0.08)", my: 3 }} />

                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="grey.500">Membro dal {user?.id ? new Date().toLocaleDateString("it-IT") : "—"}</Typography>
                </Box>
              </Box>
            )}

            {/* === CONTINUA A GUARDARE === */}
            {activeSection === "watching" && (
              <Box sx={{ bgcolor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 3, p: { xs: 3, sm: 4 } }}>
                <Typography variant="h5" color="#fff" fontWeight={700} mb={3}>
                  Continua a guardare
                </Typography>

                {watchItems.length === 0 ? (
                  <Box sx={{ textAlign: "center", py: 6 }}>
                    <PlayCircleOutlineIcon sx={{ fontSize: 60, color: "grey.700", mb: 2 }} />
                    <Typography color="grey.500" fontSize={16}>Non hai ancora iniziato nessun contenuto</Typography>
                    <Button onClick={() => navigate(`/${MAIN_PATH.browse}`)}
                      sx={{ mt: 2, color: "#e50914", textTransform: "none", fontWeight: 600 }}>
                      Esplora i contenuti
                    </Button>
                  </Box>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {watchItems.map((item) => {
                      const pct = item.duration > 0 ? Math.min((item.progress / item.duration) * 100, 100) : 0;
                      const remaining = item.duration > 0 ? Math.max(item.duration - item.progress, 0) : 0;
                      const remainMin = Math.ceil(remaining / 60);
                      return (
                        <Box key={`${item.tmdb_id}-${item.media_type}`}
                          onClick={() => handleWatchClick(item)}
                          data-testid={`watching-item-${item.tmdb_id}`}
                          sx={{
                            display: "flex", gap: 2, p: 2, borderRadius: 2, cursor: "pointer",
                            bgcolor: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.06)",
                            transition: "all 0.25s ease",
                            "&:hover": {
                              bgcolor: "rgba(255,255,255,0.08)",
                              borderColor: "rgba(229,9,20,0.3)",
                              transform: "translateX(4px)",
                              "& .play-overlay": { opacity: 1 },
                            },
                          }}>
                          {/* Poster */}
                          <Box sx={{ position: "relative", width: 120, minHeight: 70, borderRadius: 1.5, overflow: "hidden", flexShrink: 0 }}>
                            <Box component="img"
                              src={item.backdrop_path ? `https://image.tmdb.org/t/p/w300${item.backdrop_path}` : "/placeholder.jpg"}
                              alt={item.title}
                              sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                            <Box className="play-overlay" sx={{
                              position: "absolute", inset: 0, bgcolor: "rgba(0,0,0,0.5)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              opacity: 0, transition: "opacity 0.2s ease",
                            }}>
                              <PlayArrowIcon sx={{ color: "#fff", fontSize: 36 }} />
                            </Box>
                          </Box>

                          {/* Info */}
                          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                            <Typography color="#fff" fontWeight={600} fontSize={15} noWrap>{item.title || "Senza titolo"}</Typography>
                            <Typography variant="caption" color="grey.500" sx={{ mt: 0.3 }}>
                              {item.media_type === "tv" ? `S${item.season || 1} E${item.episode || 1}` : "Film"}
                              {remainMin > 0 && ` · ${remainMin} min rimanenti`}
                            </Typography>
                            <LinearProgress variant="determinate" value={pct}
                              sx={{
                                mt: 1, height: 4, borderRadius: 2, bgcolor: "rgba(255,255,255,0.1)",
                                "& .MuiLinearProgress-bar": { bgcolor: "#e50914", borderRadius: 2 },
                              }} />
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                )}
              </Box>
            )}

            {/* === IMPOSTAZIONI === */}
            {activeSection === "support" && <TicketsPanel token={token} />}

            {activeSection === "settings" && (
              <Box sx={{ bgcolor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 3, p: { xs: 3, sm: 4 } }}>
                <Typography variant="h5" color="#fff" fontWeight={700} mb={3}>Impostazioni</Typography>

                {/* Logout */}
                <Box sx={{
                  p: 3, borderRadius: 2, bgcolor: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", mb: 2,
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <Box>
                    <Typography color="#fff" fontWeight={600}>Esci dal tuo account</Typography>
                    <Typography variant="body2" color="grey.500">Verrai disconnesso da questo dispositivo</Typography>
                  </Box>
                  <Button startIcon={<LogoutIcon />} onClick={handleLogout} variant="outlined"
                    data-testid="logout-button"
                    sx={{
                      color: "#e50914", borderColor: "rgba(229,9,20,0.5)", textTransform: "none", fontWeight: 600,
                      "&:hover": { bgcolor: "rgba(229,9,20,0.1)", borderColor: "#e50914" },
                    }}>
                    Logout
                  </Button>
                </Box>

                {/* Delete Account */}
                <Box sx={{
                  p: 3, borderRadius: 2, bgcolor: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <Box>
                    <Typography color="#fff" fontWeight={600}>Elimina account</Typography>
                    <Typography variant="body2" color="grey.500">Questa azione è irreversibile</Typography>
                  </Box>
                  <Button startIcon={<DeleteForeverIcon />} onClick={handleDeleteAccount} variant="outlined"
                    data-testid="delete-account-button"
                    sx={{
                      color: "grey.500", borderColor: "rgba(255,255,255,0.15)", textTransform: "none",
                      "&:hover": { bgcolor: "rgba(229,9,20,0.1)", borderColor: "#e50914", color: "#e50914" },
                    }}>
                    Elimina
                  </Button>
                </Box>
              </Box>
            )}

          </Box>
        </Box>
      </Container>
    </Box>
  );
}

Component.displayName = "AccountPage";
