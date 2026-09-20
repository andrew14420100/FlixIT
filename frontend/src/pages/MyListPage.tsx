// @ts-nocheck
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import HorizontalCard from "src/components/HorizontalCard";
import useAutomaticMediaAssets from "src/hooks/useAutomaticMediaAssets";
import { MEDIA_TYPE } from "src/types/Common";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";

const getUserId = () => {
  let userId = localStorage.getItem("netflix_user_id");
  if (!userId) { userId = `user_${Math.random().toString(36).substr(2, 9)}`; localStorage.setItem("netflix_user_id", userId); }
  return userId;
};

function MobileListRow({ content }) {
  const navigate = useNavigate();
  const type = content.type === "tv" ? MEDIA_TYPE.Tv : MEDIA_TYPE.Movie;
  const assets = useAutomaticMediaAssets({ ...content, id: content.tmdbId }, type, true);
  const poster = assets?.poster_path || content.poster_path || "";
  const year = String(content.release_date || content.first_air_date || "").slice(0, 4);
  return (
    <Box onClick={() => navigate(`/browse/${content.type}/${content.tmdbId}`)} sx={{ display:"grid", gridTemplateColumns:"58px minmax(0,1fr) 28px", gap:"10px", alignItems:"center", minHeight:88, py:"7px", borderBottom:"1px solid rgba(255,255,255,.07)", cursor:"pointer" }}>
      <Box sx={{ width:58, height:82, bgcolor:"#161616", borderRadius:"3px", overflow:"hidden" }}>
        {poster ? <Box component="img" src={poster} alt={content.title} sx={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} /> : null}
      </Box>
      <Box sx={{ minWidth:0 }}>
        <Typography noWrap sx={{ fontSize:13.5, fontWeight:700, color:"#fff" }}>{content.title}</Typography>
        <Typography sx={{ mt:.4, fontSize:11, color:"rgba(255,255,255,.55)" }}>{content.type === "tv" ? "Serie TV" : "Film"}{year ? ` · ${year}` : ""}</Typography>
      </Box>
      <MoreHorizIcon sx={{ fontSize:19, color:"rgba(255,255,255,.7)" }} />
    </Box>
  );
}

export async function loader() { return null; }

export function Component() {
  const [myList, setMyList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const isMobile = useMediaQuery("(max-width:899px)");

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/user/list/${getUserId()}`);
        if (res.ok) { const data = await res.json(); setMyList(data.items || []); }
      } finally { setIsLoading(false); }
    };
    load();
  }, []);

  const filtered = myList.filter((x) => tab === "all" || x.type === tab);

  if (isMobile) {
    return (
      <Box data-testid="my-list-page" sx={{ minHeight:"100vh", bgcolor:"#050505", pt:"70px", pb:"80px", px:"14px", color:"#fff" }}>
        <Typography sx={{ fontSize:24, fontWeight:800, mb:1.8 }}>La mia lista</Typography>
        <Box sx={{ display:"flex", gap:2.5, borderBottom:"1px solid rgba(255,255,255,.08)", mb:1 }}>
          {[['all','Tutti'],['movie','Film'],['tv','Serie TV']].map(([key,label]) => (
            <Box key={key} component="button" onClick={() => setTab(key)} sx={{ position:"relative", border:0, bgcolor:"transparent", color:tab===key?'#fff':'rgba(255,255,255,.58)', px:0, pb:1, fontSize:12.5, fontWeight:600, cursor:"pointer", '&::after': tab===key ? { content:'""', position:'absolute', left:0, right:0, bottom:0, height:'2px', bgcolor:'#e50914' } : {} }}>{label}</Box>
          ))}
        </Box>
        {isLoading ? <Box sx={{ py:8, display:"grid", placeItems:"center" }}><CircularProgress size={28} sx={{ color:'#e50914' }} /></Box> : filtered.length === 0 ? <Typography sx={{ py:6, color:'rgba(255,255,255,.5)', fontSize:13 }}>La tua lista è vuota</Typography> : filtered.map((content) => <MobileListRow key={`${content.type}-${content.tmdbId}`} content={content} />)}
      </Box>
    );
  }

  return (
    <Box sx={{ pt: 10, px: { xs: 2, md: 4 }, minHeight: "100vh", bgcolor: "#141414" }}>
      <Typography variant="h4" sx={{ color: "#fff", fontWeight: 700, mb: 4 }}>La Mia Lista</Typography>
      {isLoading ? <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}><CircularProgress sx={{ color: "#e50914" }} /></Box> : myList.length === 0 ? <Box sx={{ textAlign: "center", py: 10 }}><Typography color="grey.500" variant="h6">La tua lista è vuota</Typography></Box> : <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>{myList.map((content, index) => <HorizontalCard key={content.tmdbId} content={content} index={index} totalCards={myList.length} />)}</Box>}
    </Box>
  );
}

Component.displayName = "MyListPage";
