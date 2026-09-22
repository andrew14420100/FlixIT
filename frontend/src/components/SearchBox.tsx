// @ts-nocheck
import { filterAvailableAsync } from "src/hooks/useAvailability";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import MovieIcon from "@mui/icons-material/Movie";
import TvIcon from "@mui/icons-material/Tv";

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_KEY = "4f153630f8d7e92d542dde3a38fbddf2";
const SEARCH_CACHE_MS = 5 * 60 * 1000;
const searchCache = new Map<string, { at: number; items: any[] }>();

function normalizedQuery(value: string) {
  return String(value || "").trim().toLocaleLowerCase("it-IT");
}

export default function SearchBox() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width:899px)");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("all");
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const key = normalizedQuery(query);
    if (key.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    let alive = true;
    const controller = new AbortController();
    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) {
      setResults(hit.items);
      setLoading(false);
      return () => controller.abort();
    }

    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${TMDB_API}/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(key)}&language=it-IT&page=1`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok || !alive) return;
        const data = await res.json();
        const candidates = (data.results || [])
          .filter((item) => item.media_type === "movie" || item.media_type === "tv")
          .slice(0, 35);
        const available = (await filterAvailableAsync(candidates)).slice(0, 20);
        if (!alive) return;
        searchCache.set(key, { at: Date.now(), items: available });
        if (searchCache.size > 60) {
          const oldest = [...searchCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 20);
          oldest.forEach(([cacheKey]) => searchCache.delete(cacheKey));
        }
        setResults(available);
      } catch (error: any) {
        if (error?.name !== "AbortError" && alive) setResults([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 320);

    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (isMobile) return;
    const handler = (event) => {
      if (containerRef.current && event.target instanceof Node && !containerRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    const handler = () => setOpen(true);
    window.addEventListener("flixit-open-search", handler);
    return () => window.removeEventListener("flixit-open-search", handler);
  }, [isMobile]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!isMobile || !open) return;
    const previousBody = document.body.style.overflow;
    const previousHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBody;
      document.documentElement.style.overflow = previousHtml;
    };
  }, [isMobile, open]);

  const visible = results.filter((result) => tab === "all" || result.media_type === tab);
  const openResult = (result) => {
    navigate(`/browse/${result.media_type}/${result.id}`);
    setQuery("");
    setOpen(false);
  };

  if (isMobile) {
    const overlay = open && typeof document !== "undefined" ? createPortal(
      <Box data-testid="mobile-search-page" sx={{ position:"fixed", inset:0, zIndex:30000, bgcolor:"#050505", color:"#fff", pt:"max(14px, env(safe-area-inset-top, 0px))", pb:"calc(82px + env(safe-area-inset-bottom, 0px))", overflowY:"auto", overscrollBehavior:"contain" }}>
        <Box sx={{ display:"flex", alignItems:"center", gap:1, px:"14px", mb:1.5 }}>
          <Box sx={{ flex:1, minHeight:48, display:"flex", alignItems:"center", gap:1, bgcolor:"#232323", borderRadius:"6px", px:1.4 }}>
            <SearchIcon sx={{ fontSize:22, color:"rgba(255,255,255,.8)" }} />
            <input ref={inputRef} value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Cerca film, serie TV..." data-testid="search-input" style={{ flex:1, minWidth:0, border:0, outline:0, background:"transparent", color:"#fff", fontSize:"16px", fontFamily:'"Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif' }} />
            {loading ? <CircularProgress size={16} sx={{ color:'#e50914' }} /> : query ? <CloseIcon onClick={()=>{setQuery('');setResults([]);}} sx={{ fontSize:21, color:'rgba(255,255,255,.55)', cursor:'pointer' }} /> : null}
          </Box>
          <Box component="button" onClick={()=>setOpen(false)} sx={{ minWidth:58, minHeight:48, border:0, bgcolor:'transparent', color:'#fff', fontSize:14, fontWeight:600, p:.5, cursor:'pointer' }}>Chiudi</Box>
        </Box>

        {query.length >= 2 && <Typography sx={{ px:"14px", fontSize:16, fontWeight:600, mb:1.1 }}>Risultati per “{query}”</Typography>}
        <Box sx={{ px:"14px", display:'flex', gap:2.5, borderBottom:'1px solid rgba(255,255,255,.08)', mb:.5 }}>
          {[['all','Tutti'],['movie','Film'],['tv','Serie TV']].map(([key,label]) => <Box key={key} component="button" onClick={()=>setTab(key)} sx={{ position:'relative', minHeight:42, border:0, bgcolor:'transparent', color:tab===key?'#fff':'rgba(255,255,255,.58)', px:0, py:.8, fontSize:13, fontWeight:600, cursor:'pointer', '&::after':tab===key?{content:'""',position:'absolute',left:0,right:0,bottom:0,height:'2px',bgcolor:'#e50914'}:{} }}>{label}</Box>)}
        </Box>

        <Box>
          {visible.map((result) => (
            <Box key={`${result.media_type}-${result.id}`} onClick={()=>openResult(result)} data-testid={`search-result-${result.id}`} sx={{ display:'grid', gridTemplateColumns:'58px minmax(0,1fr)', gap:'12px', alignItems:'center', px:'14px', py:'8px', minHeight:90, cursor:'pointer' }}>
              <Box sx={{ width:58, height:82, borderRadius:'3px', overflow:'hidden', bgcolor:'#151515' }}>
                {result.poster_path ? <img src={`https://image.tmdb.org/t/p/w185${result.poster_path}`} alt={result.title || result.name || ''} loading="lazy" decoding="async" style={{width:'100%',height:'100%',objectFit:'cover'}} /> : result.media_type==='movie' ? <Box sx={{height:'100%',display:'grid',placeItems:'center'}}><MovieIcon sx={{color:'#333'}} /></Box> : <Box sx={{height:'100%',display:'grid',placeItems:'center'}}><TvIcon sx={{color:'#333'}} /></Box>}
              </Box>
              <Box sx={{ minWidth:0 }}>
                <Typography noWrap sx={{ fontSize:15, fontWeight:600 }}>{result.title || result.name}</Typography>
                <Typography sx={{ mt:.35, fontSize:12, color:'rgba(255,255,255,.54)' }}>{result.media_type==='movie'?'Film':'Serie TV'}{(result.release_date||result.first_air_date)?` · ${(result.release_date||result.first_air_date).slice(0,4)}`:''}</Typography>
              </Box>
            </Box>
          ))}
          {query.length >= 2 && !loading && visible.length === 0 && <Typography sx={{ px:'14px', py:4, fontSize:14, color:'rgba(255,255,255,.45)' }}>Nessun risultato</Typography>}
        </Box>
      </Box>,
      document.body
    ) : null;

    return (
      <Box ref={containerRef} data-testid="search-box" sx={{ position:"relative" }}>
        <Box onClick={() => setOpen(true)} sx={{ width:44, height:44, display:"grid", placeItems:"center", cursor:"pointer" }}><SearchIcon sx={{ fontSize:25, color:"rgba(255,255,255,.9)" }} /></Box>
        {overlay}
      </Box>
    );
  }

  return (
    <Box ref={containerRef} sx={{ position: "relative" }} data-testid="search-box">
      <Box sx={{ display:'flex',alignItems:'center',gap:'6px',bgcolor:open?'rgba(255,255,255,0.08)':'transparent',border:open?'1px solid rgba(255,255,255,0.15)':'1px solid transparent',borderRadius:'10px',px:open?1.5:.7,py:.5,transition:'all .22s cubic-bezier(.4,0,.2,1)',width:open?'380px':'42px',height:'42px',overflow:'hidden',cursor:open?'text':'pointer' }} onClick={()=>{if(!open)setOpen(true);}}>
        <SearchIcon sx={{ fontSize:24,color:open?'#fff':'rgba(255,255,255,.75)',flexShrink:0 }} />
        {open && <input ref={inputRef} value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Cerca film, serie TV..." data-testid="search-input" style={{background:'none',border:'none',outline:'none',color:'#fff',fontSize:'15px',fontFamily:'"Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',width:'100%',padding:0}} />}
        {open && query && <CloseIcon onClick={(event)=>{event.stopPropagation();setQuery('');setResults([]);}} sx={{fontSize:19,color:'rgba(255,255,255,.4)',cursor:'pointer',flexShrink:0}} />}
        {loading && <CircularProgress size={14} sx={{color:'#E50914',flexShrink:0}} />}
      </Box>
      {open && visible.length>0 && <Box sx={{position:'absolute',top:'calc(100% + 8px)',right:0,width:'400px',bgcolor:'rgba(12,12,12,.97)',border:'1px solid rgba(255,255,255,.08)',borderRadius:'12px',boxShadow:'0 20px 60px rgba(0,0,0,.6)',overflow:'hidden',zIndex:1100}}>{visible.slice(0,8).map(result=><Box key={`${result.media_type}-${result.id}`} onClick={()=>openResult(result)} data-testid={`search-result-${result.id}`} sx={{display:'flex',alignItems:'center',gap:1.5,px:1.5,py:1,cursor:'pointer','&:hover':{bgcolor:'rgba(255,255,255,.05)'}}}><Box sx={{width:36,height:52,borderRadius:'6px',overflow:'hidden',bgcolor:'#1a1a1a',flexShrink:0}}>{result.poster_path?<img src={`https://image.tmdb.org/t/p/w92${result.poster_path}`} alt="" loading="lazy" decoding="async" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:null}</Box><Box sx={{flex:1,minWidth:0}}><Typography sx={{fontSize:13,fontWeight:600,color:'#fff'}} noWrap>{result.title||result.name}</Typography><Typography sx={{fontSize:10.5,color:'rgba(255,255,255,.4)'}}>{result.media_type==='movie'?'Film':'Serie TV'} {(result.release_date||result.first_air_date||'').slice(0,4)}</Typography></Box></Box>)}</Box>}
    </Box>
  );
}
